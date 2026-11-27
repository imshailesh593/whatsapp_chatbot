import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { decryptToken, encryptToken } from './calendar';
import { logMessage, sendTextMessage, setSocialSender } from './transport';
import { handleIncomingMessage } from './engine';
import { loadConfig } from './botConfig';
import { accessState } from '../plans';
import { admitAiReply } from './usage';
import { agentAvailable } from './agent';
import { DEFAULT_PUBLIC_REPLY, defaultDm, looksLikeNoise, matchesKeywords, publicSafe, writeCommentReply } from './commentAi';

/**
 * Instagram and Facebook Messenger through Meta's official Graph API. A business logs in with Facebook and shares its Page
 * (and the Instagram account linked to it); Meta then posts every direct message to /webhooks/meta, the same conversation
 * engine answers it, and the reply goes back through the Page's messages endpoint. Chats are keyed "ig:<id>" / "fb:<id>".
 *
 * Meta's rules this respects: webhooks are signed (we verify them), a reply is allowed within 24 hours of the customer's last
 * message (so no follow-ups or broadcasts to these chats), and messages are plain text with length limits.
 */

const env = (k: string) => (process.env[k] ?? '').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const metaConfigured = () => !!env('META_APP_ID') && !!env('META_APP_SECRET') && !!env('META_VERIFY_TOKEN');
const graphBase = () => `https://graph.facebook.com/${env('META_GRAPH_VERSION') || 'v24.0'}`;
const redirectUri = (publicUrl: string) => `${publicUrl.replace(/\/$/, '')}/admin/api/meta/callback`;

/** What the business is asked to allow when it logs in with Facebook. */
const SCOPES = (env('META_SCOPES') || 'pages_show_list,pages_messaging,pages_manage_metadata,pages_read_engagement,pages_manage_engagement,instagram_basic,instagram_manage_messages,instagram_manage_comments,business_management').split(',').map((s) => s.trim()).filter(Boolean);

// ---------- webhook safety ----------

/** Did this request really come from Meta? Meta signs the exact body with the app secret. */
export function signatureOk(raw: string, header: string | undefined, secret = env('META_APP_SECRET')): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const want = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const got = header.slice('sha256='.length);
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Meta's one-off check when the webhook is added in the app dashboard: answer the challenge if our token matches. */
export function verifyChallenge(q: Record<string, unknown>): string | null {
  const token = env('META_VERIFY_TOKEN');
  const got = String(q['hub.verify_token'] ?? '');
  if (!token || q['hub.mode'] !== 'subscribe' || got.length !== token.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token))) return null;
  return String(q['hub.challenge'] ?? '');
}

export interface InboundSocial {
  channel: 'ig' | 'fb';
  /** The Page id (Messenger) or the Instagram account id the message was sent to */
  accountId: string;
  /** The customer's id on that channel */
  senderId: string;
  text: string;
  mid: string;
  /** A photo, voice note, sticker...: nothing we can read */
  media: boolean;
}

/** The customer messages in a webhook body. Echoes of our own replies, delivery and read receipts are left out. */
export function parseWebhook(body: any): InboundSocial[] {
  const out: InboundSocial[] = [];
  const channel = body?.object === 'instagram' ? 'ig' : body?.object === 'page' ? 'fb' : null;
  if (!channel) return out;
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const ev of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const senderId = String(ev?.sender?.id ?? '');
      const accountId = String(entry?.id ?? ev?.recipient?.id ?? '');
      if (!senderId || !accountId || senderId === accountId) continue;
      const m = ev?.message;
      if (m) {
        if (m.is_echo) continue;
        const text = typeof m.text === 'string' ? m.text.trim() : '';
        const media = !text && Array.isArray(m.attachments) && m.attachments.length > 0;
        if (text || media) out.push({ channel, accountId, senderId, text: text.slice(0, 2000), mid: String(m.mid ?? ''), media });
      } else if (ev?.postback) {
        // a tapped button or menu item: its title is what the customer chose
        const text = String(ev.postback.title ?? ev.postback.payload ?? '').trim();
        if (text) out.push({ channel, accountId, senderId, text: text.slice(0, 500), mid: String(ev.postback.mid ?? ''), media: false });
      }
    }
  }
  return out;
}

export interface InboundComment {
  channel: 'ig' | 'fb';
  accountId: string;
  commentId: string;
  postId: string;
  commenterId: string;
  commenterName: string;
  text: string;
}

/** The new top-level comments in a webhook body. Replies inside a thread and the business's own comments are left out. */
export function parseComments(body: any): InboundComment[] {
  const out: InboundComment[] = [];
  const channel = body?.object === 'instagram' ? 'ig' : body?.object === 'page' ? 'fb' : null;
  if (!channel) return out;
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    const accountId = String(entry?.id ?? '');
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = ch?.value ?? {};
      let c: InboundComment | null = null;
      if (channel === 'fb' && ch?.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
        // a reply inside a thread has the parent comment as its parent; a top-level comment has the post
        if (v.parent_id && v.post_id && String(v.parent_id) !== String(v.post_id)) continue;
        c = { channel, accountId, commentId: String(v.comment_id ?? ''), postId: String(v.post_id ?? ''), commenterId: String(v.from?.id ?? ''), commenterName: String(v.from?.name ?? ''), text: String(v.message ?? '') };
      } else if (channel === 'ig' && ch?.field === 'comments') {
        if (v.parent_id) continue;
        c = { channel, accountId, commentId: String(v.id ?? ''), postId: String(v.media?.id ?? ''), commenterId: String(v.from?.id ?? ''), commenterName: String(v.from?.username ?? ''), text: String(v.text ?? '') };
      }
      if (!c || !c.commentId || !c.commenterId || c.commenterId === accountId || !c.text.trim()) continue;
      c.text = c.text.trim().slice(0, 1000);
      out.push(c);
    }
  }
  return out;
}

// ---------- the Graph API ----------

export class GraphError extends Error {
  constructor(message: string, readonly code?: number, readonly subcode?: number) {
    super(message);
  }
  /** The login or token is no longer valid: the business has to connect again. */
  get needsReconnect() {
    return this.code === 190;
  }
}

async function graph<T = any>(path: string, o: { method?: 'GET' | 'POST' | 'DELETE'; token?: string; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const url = new URL(graphBase() + path);
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: o.method ?? 'GET',
    // the token travels in a header, not in the URL, so it stays out of logs
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    signal: AbortSignal.timeout(20_000)
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const e = data?.error ?? {};
    const window = e.code === 10 && e.error_subcode === 2018278;
    throw new GraphError(
      window ? 'Meta only allows a reply within 24 hours of the customer\'s last message' : `Meta error ${e.code ?? res.status}${e.error_subcode ? `/${e.error_subcode}` : ''}: ${e.message ?? 'request failed'}`,
      e.code,
      e.error_subcode
    );
  }
  return data as T;
}

// ---------- sending ----------

/** Instagram and Messenger show plain text: the WhatsApp *bold* marks would appear as stars. */
export const plainText = (t: string) => t.replace(/\*([^*\n]+)\*/g, '$1');

/** Splits a long message at paragraph or sentence ends so each part fits the channel's limit. */
export function chunkText(text: string, max: number): string[] {
  let rest = text.replace(/\r/g, '').trim();
  const out: string[] = [];
  while (rest.length > max) {
    const cut = rest.slice(0, max);
    let at = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf(' '));
    if (at < max * 0.5) at = max - 1; // no good place to cut: hard cut
    out.push(rest.slice(0, at + 1).trim());
    rest = rest.slice(at + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** The chat key of a customer: channel, the business's Instagram account or Page, and the customer's id on it ("ig:1784…:5521…"). */
export const socialKey = (channel: 'ig' | 'fb', accountId: string, senderId: string) => `${channel}:${accountId}:${senderId}`;
export function parseSocialKey(key: string): { channel: 'ig' | 'fb'; accountId: string; senderId: string } | null {
  const [channel, accountId, senderId, ...extra] = key.split(':');
  return (channel === 'ig' || channel === 'fb') && accountId && senderId && extra.length === 0 ? { channel, accountId, senderId } : null;
}

/** Sends one message to a customer on Instagram or Messenger, through the Page or Instagram account they wrote to. */
export async function sendSocial(workspaceId: string, to: string, text: string): Promise<void> {
  const k = parseSocialKey(to);
  if (!k) throw new Error('Not an Instagram or Facebook chat');
  const channel = k.channel;
  const recipient = k.senderId;
  const conn = await prisma.metaConnection.findFirst({ where: { workspaceId, ...(channel === 'ig' ? { igUserId: k.accountId } : { pageId: k.accountId }) } });
  if (!conn) throw new Error('That Instagram account or Page is not connected for this business any more');
  const token = decryptToken(conn.tokenEnc);
  // a short "typing…" first: it feels like a person (cosmetic, never fatal)
  await graph(`/${conn.pageId}/messages`, { method: 'POST', token, body: { recipient: { id: recipient }, sender_action: 'typing_on' } }).catch(() => undefined);
  const parts = chunkText(plainText(text), channel === 'ig' ? 950 : 1900);
  for (const [i, part] of parts.entries()) {
    if (i > 0) await sleep(500);
    try {
      await graph(`/${conn.pageId}/messages`, { method: 'POST', token, body: { recipient: { id: recipient }, messaging_type: 'RESPONSE', message: { text: part } } });
    } catch (err) {
      if (err instanceof GraphError && err.needsReconnect) console.error(`[meta ${workspaceId.slice(0, 8)}] the Page login has expired: the business must connect again`);
      throw err;
    }
  }
}
setSocialSender(sendSocial);

// ---------- receiving ----------

/** Meta sends a webhook again when we are slow: remember the last message ids so nobody gets two answers. */
const seen = new Set<string>();
function firstTime(mid: string): boolean {
  if (!mid) return true;
  if (seen.has(mid)) return false;
  seen.add(mid);
  if (seen.size > 5000) seen.delete(seen.values().next().value as string);
  return true;
}

async function findConnection(m: { channel: 'ig' | 'fb'; accountId: string }) {
  return prisma.metaConnection.findFirst({ where: m.channel === 'ig' ? { igUserId: m.accountId } : { pageId: m.accountId } });
}

/** The customer's name, once, when we have not seen them before. Best effort: null when Meta does not give it. */
async function profileName(conn: { workspaceId: string; tokenEnc: string }, m: InboundSocial, key: string): Promise<string | null> {
  const known = await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: conn.workspaceId, phoneNumber: key } }, select: { contactName: true } });
  if (known) return known.contactName;
  try {
    const p = await graph<{ name?: string; username?: string }>(`/${m.senderId}`, { token: decryptToken(conn.tokenEnc), query: { fields: m.channel === 'ig' ? 'name,username' : 'name' } });
    return (p.name || p.username || '').slice(0, 80) || null;
  } catch {
    return null;
  }
}

/** Hands every customer message in a webhook to the conversation engine. Returns how many it took. */
export async function processWebhook(body: unknown): Promise<number> {
  let taken = 0;
  for (const m of parseWebhook(body)) {
    if (!firstTime(m.mid)) continue;
    const conn = await findConnection(m);
    if (!conn) continue;
    const key = socialKey(m.channel, m.accountId, m.senderId);
    if (m.media) {
      await sendTextMessage(conn.workspaceId, key, 'Sorry, I can only read text messages right now. Please type your reply. 🙏').catch(() => undefined);
      continue;
    }
    const name = await profileName(conn, m, key);
    taken++;
    // not awaited: Meta wants our answer within seconds, the reply (and the AI) can take longer
    void handleIncomingMessage(conn.workspaceId, key, name ?? undefined, m.text, m.mid).catch((err) => console.error(`[meta ${conn.workspaceId.slice(0, 8)}] could not handle a message:`, (err as Error).message));
  }
  for (const c of parseComments(body)) {
    const conn = await findConnection(c);
    if (!conn) continue;
    taken++;
    void handleComment(conn, c).catch((err) => console.error(`[meta ${conn.workspaceId.slice(0, 8)}] could not handle a comment:`, (err as Error).message));
  }
  return taken;
}

// ---------- comments ----------

const HOURLY_LIMIT = 60;
const postTexts = new Map<string, string>();

/** The text of the post that was commented on, once, to give the reply some context. Best effort. */
async function postText(conn: { tokenEnc: string }, c: InboundComment): Promise<string> {
  if (!c.postId) return '';
  const hit = postTexts.get(c.postId);
  if (hit !== undefined) return hit;
  let text = '';
  try {
    const p = await graph<{ message?: string; caption?: string }>(`/${c.postId}`, { token: decryptToken(conn.tokenEnc), query: { fields: c.channel === 'ig' ? 'caption' : 'message' } });
    text = String(p.caption ?? p.message ?? '').slice(0, 600);
  } catch {
    /* no context is fine */
  }
  if (postTexts.size >= 500) postTexts.delete(postTexts.keys().next().value as string);
  postTexts.set(c.postId, text);
  return text;
}

/**
 * One comment on a post: reply to it in public and message the commenter privately (a "private reply", which Meta allows for
 * 7 days after the comment, once per comment). Held back by the business's switch and keyword rules, by noise filters, by a
 * once-per-person-per-post rule and by an hourly limit, so a busy or abusive comment section cannot make the bot run wild.
 */
export async function handleComment(conn: { workspaceId: string; pageId: string; tokenEnc: string }, c: InboundComment): Promise<void> {
  const cfg = await loadConfig(conn.workspaceId);
  const ws = cfg.ws;
  if (!ws.commentRepliesEnabled || !ws.botEnabled || !accessState(ws).active) return;
  // claim the comment first: a webhook Meta sends again finds the row and stops
  let claim: { id: string; createdAt: Date };
  try {
    claim = await prisma.commentEvent.create({ data: { id: c.commentId, workspaceId: conn.workspaceId, channel: c.channel, accountId: c.accountId, postId: c.postId, commenterId: c.commenterId, commenterName: c.commenterName.slice(0, 80), text: c.text, status: 'processing' } });
  } catch {
    return;
  }
  const finish = (status: 'replied' | 'skipped' | 'failed', data: { note?: string; replyText?: string; dmText?: string } = {}) => prisma.commentEvent.update({ where: { id: c.commentId }, data: { status, ...data } });

  if (looksLikeNoise(c.text)) return void (await finish('skipped', { note: 'Only an emoji, a link or tags: nothing to answer' }));
  if (ws.commentReplyMode !== 'all' && !matchesKeywords(c.text, ws.commentKeywords)) return void (await finish('skipped', { note: 'No keyword in the comment' }));
  // Comments are handled in parallel, so the limits count the ones still in flight too, and only those that arrived before this
  // one (same moment: the lower id first): of two simultaneous comments exactly one goes ahead, and a burst cannot overshoot.
  const live = { in: ['replied', 'processing'] };
  const before = { OR: [{ createdAt: { lt: claim.createdAt } }, { createdAt: claim.createdAt, id: { lt: claim.id } }] };
  const hourAgo = new Date(Date.now() - 3_600_000);
  if ((await prisma.commentEvent.count({ where: { accountId: c.accountId, status: live, AND: [{ createdAt: { gte: hourAgo } }, before] } })) >= HOURLY_LIMIT) return void (await finish('skipped', { note: `Hourly limit of ${HOURLY_LIMIT} replies reached` }));
  const already = await prisma.commentEvent.findFirst({ where: { accountId: c.accountId, postId: c.postId, commenterId: c.commenterId, status: live, AND: [{ createdAt: { gte: new Date(Date.now() - 86_400_000) } }, before] }, select: { id: true } });
  if (already) return void (await finish('skipped', { note: 'Already answered this person on this post today' }));

  const sendDm = ws.commentSendDm;
  let reply = '';
  let dm = '';
  let aiNote = '';
  if (agentAvailable() && (await admitAiReply(ws))) {
    try {
      const plan = await writeCommentReply(cfg, { channel: c.channel, text: c.text, commenterName: c.commenterName || null, postText: await postText(conn, c) }, sendDm);
      if (plan.skip) return void (await finish('skipped', { note: `Left for a person: ${plan.reason || 'not suitable for an automatic reply'}` }));
      reply = plan.reply;
      dm = plan.dm;
      if (plan.removed.length) aiNote = `cleaned: ${plan.removed.join('; ')}`;
    } catch (err) {
      aiNote = `AI unavailable (${(err as Error).message.slice(0, 80)}): standard texts used`;
    }
  }
  if (!reply) reply = publicSafe(ws.commentReplyTemplate.trim()) || DEFAULT_PUBLIC_REPLY;
  if (sendDm && !dm) dm = defaultDm(cfg, c.commenterName || null);

  const token = decryptToken(conn.tokenEnc);
  const problems: string[] = [];
  let sent = 0;
  try {
    // Facebook: reply under the comment; Instagram: reply to the comment
    await graph(c.channel === 'ig' ? `/${c.commentId}/replies` : `/${c.commentId}/comments`, { method: 'POST', token, body: { message: reply } });
    sent++;
  } catch (err) {
    problems.push(`public reply: ${(err as Error).message}`);
  }
  if (sendDm && dm) {
    try {
      await graph(`/${conn.pageId}/messages`, { method: 'POST', token, body: { recipient: { comment_id: c.commentId }, message: { text: chunkText(plainText(dm), c.channel === 'ig' ? 950 : 1900)[0] } } });
      sent++;
      // the private message belongs to this person's chat, so the AI knows what was already said when they answer
      await logMessage(conn.workspaceId, socialKey(c.channel, c.accountId, c.commenterId), 'OUTBOUND', dm);
    } catch (err) {
      problems.push(`private message: ${(err as Error).message}`);
    }
  }
  await finish(sent > 0 ? 'replied' : 'failed', { replyText: reply, dmText: dm, note: [...problems, aiNote].filter(Boolean).join(' | ').slice(0, 500) });
}

// ---------- connecting a business ----------

const stateSecret = () => process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || '';
const signState = (body: string) => crypto.createHmac('sha256', stateSecret()).update('meta-state:' + body).digest('base64url');

/** Signed, short-lived state so the callback knows which business started the connection. */
export function makeMetaState(workspaceId: string, nonce: string): string {
  const body = Buffer.from(JSON.stringify({ w: workspaceId, exp: Date.now() + 10 * 60_000, n: nonce })).toString('base64url');
  return `${body}.${signState(body)}`;
}

/** A fresh random value for one connect attempt: it goes in the state and in an HttpOnly cookie of the browser that started it. */
export const newNonce = () => crypto.randomBytes(16).toString('hex');
export const NONCE_COOKIE = 'meta_nonce';

/**
 * The business the state was made for, when the signature is genuine, it has not expired and its nonce equals the one in the
 * browser's cookie: a callback link started in another browser (or forged) is refused.
 */
export function readMetaState(state: string, cookieNonce: string): string | null {
  const [body, sig] = String(state ?? '').split('.');
  if (!body || !sig) return null;
  const want = signState(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { w?: string; exp?: number; n?: string };
    const n = String(p.n ?? '');
    if (!p.w || !p.exp || p.exp <= Date.now() || !n || n.length !== cookieNonce.length || !crypto.timingSafeEqual(Buffer.from(n), Buffer.from(cookieNonce))) return null;
    return p.w;
  } catch {
    return null;
  }
}

export function metaAuthUrl(workspaceId: string, publicUrl: string, nonce: string): string {
  const q = new URLSearchParams({ client_id: env('META_APP_ID'), redirect_uri: redirectUri(publicUrl), state: makeMetaState(workspaceId, nonce), response_type: 'code' });
  // Business-type apps use Facebook Login for Business: a saved configuration holds the permissions, so no scope list is sent
  const configId = env('META_LOGIN_CONFIG_ID');
  if (configId) q.set('config_id', configId);
  else q.set('scope', SCOPES.join(','));
  return `https://www.facebook.com/${env('META_GRAPH_VERSION') || 'v24.0'}/dialog/oauth?${q}`;
}

export interface ConnectResult {
  connected: { pageName: string; igUsername: string }[];
  skipped: string[];
}

/**
 * After the Facebook login: connects every Page the business shared (and the Instagram account linked to each), subscribes
 * them to messages and saves their tokens. A Page already connected to another business is skipped, never taken over.
 */
export async function completeMetaConnection(workspaceId: string, code: string, publicUrl: string): Promise<ConnectResult> {
  const app = { client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET') };
  const short = await graph<{ access_token: string }>('/oauth/access_token', { method: 'POST', body: { ...app, redirect_uri: redirectUri(publicUrl), code } });
  const long = await graph<{ access_token: string }>('/oauth/access_token', { method: 'POST', body: { ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token } });
  const accounts = await graph<{ data?: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>('/me/accounts', {
    token: long.access_token,
    query: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50' }
  });
  const pages = accounts.data ?? [];
  if (pages.length === 0) throw new Error('No Facebook Page was shared. Connect again and choose your Pages when Facebook asks.');
  const result: ConnectResult = { connected: [], skipped: [] };
  for (const page of pages) {
    const ig = page.instagram_business_account;
    const takenPage = await prisma.metaConnection.findUnique({ where: { pageId: page.id } });
    const takenIg = ig ? await prisma.metaConnection.findUnique({ where: { igUserId: ig.id } }) : null;
    if ((takenPage && takenPage.workspaceId !== workspaceId) || (takenIg && takenIg.workspaceId !== workspaceId)) {
      result.skipped.push(`${page.name} (already connected to another business)`);
      continue;
    }
    try {
      // from now on Meta posts this Page's messages (and its Instagram messages) to /webhooks/meta
      await graph(`/${page.id}/subscribed_apps`, { method: 'POST', token: page.access_token, query: { subscribed_fields: 'messages,messaging_postbacks,feed' } });
      // Instagram comments arrive through the Instagram account's own subscription (best effort: not every setup needs it)
      if (ig) await graph(`/${ig.id}/subscribed_apps`, { method: 'POST', token: page.access_token, query: { subscribed_fields: 'comments,messages' } }).catch(() => undefined);
    } catch (err) {
      result.skipped.push(`${page.name} (${(err as Error).message})`);
      continue;
    }
    const data = { workspaceId, pageName: page.name.slice(0, 120), igUserId: ig?.id ?? null, igUsername: (ig?.username ?? '').slice(0, 80), tokenEnc: encryptToken(page.access_token) };
    await prisma.metaConnection.upsert({ where: { pageId: page.id }, update: data, create: { pageId: page.id, ...data } });
    result.connected.push({ pageName: data.pageName, igUsername: data.igUsername });
  }
  if (result.connected.length === 0) throw new Error(`Nothing could be connected: ${result.skipped.join('; ')}`);
  return result;
}

/** Disconnects one Page (and its Instagram account), or all of the business's when no Page is given. */
export async function disconnectMeta(workspaceId: string, pageId?: string): Promise<void> {
  const conns = await prisma.metaConnection.findMany({ where: { workspaceId, ...(pageId ? { pageId } : {}) } });
  for (const c of conns) {
    // stop Meta sending this Page's messages to us (best effort: the row goes either way)
    await graph(`/${c.pageId}/subscribed_apps`, { method: 'DELETE', token: decryptToken(c.tokenEnc) }).catch(() => undefined);
    await prisma.metaConnection.delete({ where: { pageId: c.pageId } });
  }
}

export async function metaStatus(workspaceId: string) {
  const conns = await prisma.metaConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
  return {
    configured: metaConfigured(),
    connected: conns.length > 0,
    accounts: conns.map((c) => ({ pageId: c.pageId, pageName: c.pageName, igUsername: c.igUsername, hasInstagram: !!c.igUserId }))
  };
}

/** The signed_request Meta sends to the data-deletion URL: returns its user id when the signature is genuine. */
export function readSignedRequest(signed: string, secret = env('META_APP_SECRET')): { user_id?: string } | null {
  const [sig, payload] = String(signed ?? '').split('.');
  if (!sig || !payload || !secret) return null;
  const want = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
