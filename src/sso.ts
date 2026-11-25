import crypto from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './lib/prisma';
import { normalizeEmail, readValue, signSession, signValue } from './lib/auth';
import { DEFAULT_WORKSPACE_ID } from './lib/workspaces';

/*
 * Platform-staff single sign-in through the Admin Hub (Authentik at auth.zexyai.com).
 *
 * Only for the operator's own team: an account must already exist here AND be a
 * platform admin (isSuperAdmin) or belong to the operator's own workspace. Customer
 * accounts can never be signed into this way, even if an Authentik user had the same
 * email. Never creates accounts. Password login is unchanged and stays the way in
 * if Authentik is down. Off (404) unless SSO_ENABLED=1.
 *
 * Flow: /admin/api/sso/start -> Authentik -> /admin/api/sso/callback. The code is
 * exchanged server-side with the client secret (PKCE too), and the identity comes
 * from Authentik's userinfo endpoint over TLS.
 */

const STATE_COOKIE = 'mns_sso';
const SESSION_DAYS_SSO = 0.5; // 12 h, the same as the Admin Hub session

export const ssoEnabled = () => process.env.SSO_ENABLED === '1' && !!process.env.SSO_CLIENT_ID && !!process.env.SSO_CLIENT_SECRET;
const base = () => (process.env.SSO_BASE_URL || 'https://auth.zexyai.com').replace(/\/+$/, '');
const publicUrl = () => (process.env.PUBLIC_URL || 'https://wappoai.com').replace(/\/+$/, '');
export const redirectUri = () => `${publicUrl()}/admin/api/sso/callback`;

/** Only same-site console paths; anything else falls back to the console home. */
export function safeNext(next: unknown): string {
  const s = typeof next === 'string' ? next : '';
  return /^\/admin(\/[A-Za-z0-9\-._~/?#&=%]*)?$/.test(s) && !s.startsWith('//') ? s : '/admin/';
}

/** Checked here too (Authentik's policy binding already enforces it). */
export const requiredGroup = () => process.env.SSO_REQUIRED_GROUP || 'app-wappo';
export const inRequiredGroup = (groups: string[]) => groups.includes(requiredGroup());

/** The operator's team only: never a customer's account. */
export function isStaffAccount(u: { isSuperAdmin: boolean; workspaceId: string }): boolean {
  return u.isSuperAdmin || u.workspaceId === DEFAULT_WORKSPACE_ID;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function newAuthRequest(next: string) {
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const url = new URL(`${base()}/application/o/authorize/`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SSO_CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  }).toString();
  return { url: url.toString(), saved: { state, verifier, next } };
}

/** Code -> access token -> userinfo. Throws on any failure. */
async function identityFor(code: string, verifier: string): Promise<{ sub: string; email: string; groups: string[] }> {
  const auth = Buffer.from(`${process.env.SSO_CLIENT_ID}:${process.env.SSO_CLIENT_SECRET}`).toString('base64');
  const tokenRes = await fetch(`${base()}/application/o/token/`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!tokenRes.ok) throw new Error(`token endpoint answered ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error('no access token');
  const infoRes = await fetch(`${base()}/application/o/userinfo/`, { headers: { authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
  if (!infoRes.ok) throw new Error(`userinfo answered ${infoRes.status}`);
  const info = (await infoRes.json()) as { sub?: string; email?: string; groups?: unknown };
  if (!info.sub) throw new Error('no subject');
  return { sub: String(info.sub), email: normalizeEmail(info.email), groups: Array.isArray(info.groups) ? info.groups.map(String) : [] };
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
}

const secure = (req: FastifyRequest) => (req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function registerSso(app: FastifyInstance) {
  const fail = (reply: FastifyReply) => reply.redirect('/admin/?sso=failed');

  app.get('/admin/api/sso/start', async (req, reply) => {
    if (!ssoEnabled()) return reply.status(404).send();
    const { url, saved } = newAuthRequest(safeNext((req.query as Record<string, unknown>)?.next));
    // Lax, not Strict: the callback arrives as a top-level navigation from Authentik's domain
    reply.header('Set-Cookie', `${STATE_COOKIE}=${signValue(saved, 600)}; HttpOnly; SameSite=Lax; Path=/admin/api/sso; Max-Age=600${secure(req)}`);
    return reply.redirect(url);
  });

  app.get('/admin/api/sso/callback', async (req, reply) => {
    if (!ssoEnabled()) return reply.status(404).send();
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const saved = readValue<{ state: string; verifier: string; next: string }>(readCookie(req, STATE_COOKIE));
    const clearState = `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/admin/api/sso; Max-Age=0${secure(req)}`;
    if (!saved || !q.code || !q.state || q.state.length !== saved.state.length || !crypto.timingSafeEqual(Buffer.from(q.state), Buffer.from(saved.state))) {
      req.log.warn('[sso] missing or mismatched state');
      return fail(reply.header('Set-Cookie', clearState));
    }
    try {
      const { sub, email, groups } = await identityFor(q.code, saved.verifier);
      if (!inRequiredGroup(groups)) {
        req.log.warn({ sub }, '[sso] refused: not in the required Authentik group');
        return fail(reply.header('Set-Cookie', clearState));
      }
      const user =
        (await prisma.adminUser.findUnique({ where: { ssoSubject: sub } })) ??
        (email ? await prisma.adminUser.findFirst({ where: { email, ssoSubject: null } }) : null);
      if (!user || !isStaffAccount(user)) {
        req.log.warn({ sub, email }, '[sso] refused: no matching staff account');
        return fail(reply.header('Set-Cookie', clearState));
      }
      await prisma.adminUser.update({ where: { id: user.id }, data: { ssoSubject: sub, lastLoginAt: new Date() } });
      req.log.info({ userId: user.id }, '[sso] signed in');
      const session = `mns_admin=${signSession(user.id, SESSION_DAYS_SSO)}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${Math.round(SESSION_DAYS_SSO * 86400)}${secure(req)}`;
      // 200 + meta refresh, not a 302: the console's session cookie is SameSite=Strict, and a redirect chain that
      // started on Authentik's domain would not send it, showing "signed out" until a refresh. No script (strict CSP).
      const next = escapeAttr(saved.next);
      return reply
        .header('Set-Cookie', [clearState, session])
        .header('Cache-Control', 'no-store')
        .type('text/html')
        .send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${next}"><title>Signing in…</title><p>Signing in… <a href="${next}">Continue</a></p>`);
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, '[sso] callback failed');
      return fail(reply.header('Set-Cookie', clearState));
    }
  });
}
