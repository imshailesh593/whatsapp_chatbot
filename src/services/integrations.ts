import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { loadConfig } from './botConfig';
import { getStages } from './pipeline';

export const EVENTS = ['lead.created', 'lead.stage_changed'] as const;
export type EventName = (typeof EVENTS)[number];
export const MAX_WEBHOOKS = 5;
export const MAX_KEYS = 5;
const MAX_ATTEMPTS = 5;

// ---------- URL safety (a customer-supplied URL must never reach our own network) ----------

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Only https URLs that resolve to public addresses. Throws a readable Error otherwise. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('That is not a valid URL');
  }
  const allowHttp = process.env.ALLOW_HTTP_WEBHOOKS === '1';
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) throw new Error('The URL must start with https://');
  if (u.username || u.password) throw new Error('Do not put a username or password in the URL');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addrs.length === 0) throw new Error('That address could not be found');
  if (!allowHttp && addrs.some(isPrivateIp)) throw new Error('That address points to a private network');
  return u;
}

// ---------- webhooks ----------

export const newSecret = () => 'whsec_' + crypto.randomBytes(24).toString('hex');

export async function createWebhook(workspaceId: string, body: { url?: string; events?: string[] }) {
  const u = await assertPublicUrl(String(body.url ?? '').trim());
  const events = (Array.isArray(body.events) && body.events.length ? body.events : [...EVENTS]).filter((e): e is EventName => (EVENTS as readonly string[]).includes(e));
  if (events.length === 0) throw new Error('Choose at least one event');
  if ((await prisma.webhook.count({ where: { workspaceId } })) >= MAX_WEBHOOKS) throw new Error(`You can have up to ${MAX_WEBHOOKS} webhooks`);
  return prisma.webhook.create({ data: { workspaceId, url: u.toString(), secret: newSecret(), events } });
}

const sign = (secret: string, body: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

/** The lead as an integration sees it. */
export async function leadSnapshot(workspaceId: string, sessionId: string) {
  const [cfg, stages, s] = await Promise.all([loadConfig(workspaceId), getStages(workspaceId), prisma.session.findUnique({ where: { id: sessionId }, include: { lead: true } })]);
  if (!s?.lead) return null;
  const service = cfg.services.find((x) => x.key === s.lead!.serviceCategory);
  const answers = s.lead.collectedData as Record<string, string>;
  return {
    phone: s.phoneNumber,
    name: s.contactName,
    service: service?.title ?? s.lead.serviceCategory,
    answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [service?.questions.find((q) => q.key === k)?.prompt ?? k, v])),
    answersByKey: answers,
    stage: s.lead.stageKey,
    stageLabel: stages.find((x) => x.key === s.lead!.stageKey)?.label ?? s.lead.stageKey,
    source: s.source,
    notes: s.lead.counsellorNotes,
    createdAt: s.lead.createdAt.toISOString()
  };
}

/** Queues the event for every active webhook subscribed to it. Never throws (integrations must not break the chat). */
export async function dispatchEvent(workspaceId: string, event: EventName, sessionId: string, extra: Record<string, unknown> = {}): Promise<void> {
  try {
    const hooks = await prisma.webhook.findMany({ where: { workspaceId, active: true, events: { has: event } } });
    if (hooks.length === 0) return;
    const lead = await leadSnapshot(workspaceId, sessionId);
    if (!lead) return;
    const { ws } = await loadConfig(workspaceId);
    const payload = { id: crypto.randomUUID(), event, createdAt: new Date().toISOString(), workspace: { id: ws.id, name: ws.businessName }, lead, ...extra };
    await prisma.webhookDelivery.createMany({ data: hooks.map((h) => ({ webhookId: h.id, event, payload: payload as unknown as Prisma.InputJsonValue })) });
  } catch (err) {
    console.error('[integrations] could not queue event:', (err as Error).message);
  }
}

const backoff = (attempt: number) => Math.min(6 * 3600_000, 30_000 * 4 ** (attempt - 1)); // 30s, 2m, 8m, 32m, 2h…

async function deliver(d: { id: string; webhookId: string; event: string; payload: unknown; attempts: number }): Promise<void> {
  const hook = await prisma.webhook.findUnique({ where: { id: d.webhookId } });
  if (!hook || !hook.active) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'failed', error: 'webhook removed or disabled' } });
    return;
  }
  const attempts = d.attempts + 1;
  const body = JSON.stringify(d.payload);
  let code: number | null = null;
  let error = '';
  try {
    await assertPublicUrl(hook.url); // re-check at send time (DNS can change)
    const res = await fetch(hook.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'LeadConsole-Webhook/1', 'X-Event': d.event, 'X-Signature': sign(hook.secret, body) },
      body
    });
    code = res.status;
    // Google Apps Script runs doPost, then answers 302 to a result page: that still counts as delivered
    const appsScriptRedirect = res.status >= 300 && res.status < 400 && new URL(hook.url).hostname === 'script.google.com';
    if ((res.status < 200 || res.status >= 300) && !appsScriptRedirect) error = `HTTP ${res.status}`;
  } catch (err) {
    error = String((err as Error).message).slice(0, 200);
  }
  if (!error) await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'ok', attempts, responseCode: code, error: '' } });
  else if (attempts >= MAX_ATTEMPTS) await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'failed', attempts, responseCode: code, error } });
  else await prisma.webhookDelivery.update({ where: { id: d.id }, data: { attempts, responseCode: code, error, nextAttemptAt: new Date(Date.now() + backoff(attempts)) } });
}

let delivering = false;
/** One pass: delivers every due pending event (also exported for tests). */
export async function deliverDue(): Promise<number> {
  if (delivering) return 0;
  delivering = true;
  try {
    const due = await prisma.webhookDelivery.findMany({ where: { status: 'pending', nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 20 });
    await Promise.all(due.map((d) => deliver(d).catch((e) => console.error('[webhook] delivery crashed:', e))));
    return due.length;
  } finally {
    delivering = false;
  }
}

export function startWebhookWorker(): { stop(): void } {
  const t = setInterval(() => {
    deliverDue().catch((e) => console.error('[webhook] pass failed:', e));
    // keep the log small
    prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } }).catch(() => undefined);
  }, 10_000);
  return { stop: () => clearInterval(t) };
}

// ---------- API keys ----------

const hashKey = (k: string) => crypto.createHash('sha256').update(k).digest('hex');

export async function createApiKey(workspaceId: string, nameRaw: string) {
  const name = String(nameRaw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'API key';
  if ((await prisma.apiKey.count({ where: { workspaceId } })) >= MAX_KEYS) throw new Error(`You can have up to ${MAX_KEYS} API keys`);
  const key = 'lk_' + crypto.randomBytes(24).toString('hex');
  const row = await prisma.apiKey.create({ data: { workspaceId, name, prefix: key.slice(0, 9), hash: hashKey(key) } });
  return { row, key }; // `key` is returned to the caller once and never stored
}

export async function workspaceForKey(authorization: string | undefined): Promise<{ workspaceId: string; keyId: string } | null> {
  const m = /^Bearer\s+(lk_[a-f0-9]{48})$/.exec(authorization ?? '');
  if (!m) return null;
  const row = await prisma.apiKey.findUnique({ where: { hash: hashKey(m[1]) } });
  if (!row) return null;
  void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { workspaceId: row.workspaceId, keyId: row.id };
}
