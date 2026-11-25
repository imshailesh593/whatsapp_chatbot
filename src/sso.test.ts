import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

process.env.SESSION_SECRET = 'test-session-secret';
process.env.SSO_ENABLED = '1';
process.env.SSO_CLIENT_ID = 'test-client';
process.env.SSO_CLIENT_SECRET = 'test-secret';
process.env.SSO_BASE_URL = 'https://auth.zexyai.com';
process.env.PUBLIC_URL = 'https://wappoai.com';
process.env.HUB_FEED_KEY = 'k'.repeat(48);

const ssoP = import('./sso');
const authP = import('./lib/auth');
const feedP = import('./hubFeed');

async function app() {
  const { registerSso } = await ssoP;
  const { registerHubFeed } = await feedP;
  const a = Fastify();
  registerSso(a);
  registerHubFeed(a);
  return a;
}

test('next is limited to console paths', async () => {
  const { safeNext } = await ssoP;
  assert.equal(safeNext('/admin/'), '/admin/');
  assert.equal(safeNext('/admin/#/inbox'), '/admin/#/inbox');
  assert.equal(safeNext('https://evil.example/'), '/admin/');
  assert.equal(safeNext('//evil.example/admin'), '/admin/');
  assert.equal(safeNext('/administrator'), '/admin/');
  assert.equal(safeNext('/admin/"><script>'), '/admin/');
  assert.equal(safeNext(undefined), '/admin/');
});

test('only platform staff can be signed in, never a customer account', async () => {
  const { isStaffAccount } = await ssoP;
  assert.equal(isStaffAccount({ isSuperAdmin: true, workspaceId: 'customer-ws' }), true);
  assert.equal(isStaffAccount({ isSuperAdmin: false, workspaceId: 'default-workspace' }), true);
  assert.equal(isStaffAccount({ isSuperAdmin: false, workspaceId: 'customer-ws' }), false);
});

test('signed values reject tampering and expiry', async () => {
  const { signValue, readValue } = await authP;
  const s = signValue({ state: 'abc' }, 60);
  assert.deepEqual(readValue(s), { state: 'abc' });
  const [body, sig] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ v: { state: 'evil' }, exp: Date.now() + 60_000 })).toString('base64url');
  assert.equal(readValue(`${forged}.${sig}`), null);
  assert.equal(readValue(`${body}.x${sig.slice(1)}`), null);
  assert.equal(readValue(signValue({ state: 'old' }, -1)), null);
  assert.equal(readValue(undefined), null);
});

test('start redirects to Authentik with PKCE and sets a Lax state cookie', async () => {
  const a = await app();
  const res = await a.inject({ method: 'GET', url: '/admin/api/sso/start?next=/admin/', headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(res.statusCode, 302);
  const loc = new URL(String(res.headers.location));
  assert.equal(loc.origin + loc.pathname, 'https://auth.zexyai.com/application/o/authorize/');
  assert.equal(loc.searchParams.get('scope'), 'openid email profile');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://wappoai.com/admin/api/sso/callback');
  const cookie = String(res.headers['set-cookie']);
  assert.match(cookie, /^mns_sso=.+; HttpOnly; SameSite=Lax; Path=\/admin\/api\/sso; Max-Age=600; Secure$/);
});

test('callback without the matching state cookie is refused before any network call', async () => {
  const a = await app();
  const none = await a.inject({ method: 'GET', url: '/admin/api/sso/callback?code=x&state=y' });
  assert.equal(none.statusCode, 302);
  assert.equal(none.headers.location, '/admin/?sso=failed');

  const start = await a.inject({ method: 'GET', url: '/admin/api/sso/start' });
  const stateCookie = String(start.headers['set-cookie']).split(';')[0];
  const wrong = await a.inject({ method: 'GET', url: '/admin/api/sso/callback?code=x&state=not-the-state', headers: { cookie: stateCookie } });
  assert.equal(wrong.headers.location, '/admin/?sso=failed');
});

test('both sign-in routes 404 while disabled', async () => {
  const a = await app();
  process.env.SSO_ENABLED = '0';
  try {
    assert.equal((await a.inject({ method: 'GET', url: '/admin/api/sso/start' })).statusCode, 404);
    assert.equal((await a.inject({ method: 'GET', url: '/admin/api/sso/callback?code=x&state=y' })).statusCode, 404);
  } finally {
    process.env.SSO_ENABLED = '1';
  }
});

test('hub feed needs the exact key', async () => {
  const { feedKeyOk } = await feedP;
  const key = 'k'.repeat(48);
  assert.equal(feedKeyOk(`Bearer ${key}`, key), true);
  assert.equal(feedKeyOk(`Bearer ${key}x`, key), false);
  assert.equal(feedKeyOk(key, key), false);
  assert.equal(feedKeyOk(undefined, key), false);
  assert.equal(feedKeyOk('Bearer short', 'short'), false); // too-short keys are never accepted

  const a = await app();
  assert.equal((await a.inject({ method: 'GET', url: '/internal/hub/feed' })).statusCode, 401);
  assert.equal((await a.inject({ method: 'GET', url: '/internal/hub/feed', headers: { authorization: 'Bearer wrong' } })).statusCode, 401);
});

test('money is shown in major units', async () => {
  const { money } = await feedP;
  assert.equal(money(49900, 'INR'), '₹499');
  assert.equal(money(1950, 'USD'), '$19.50');
});
