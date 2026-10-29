// PayPal subscriptions: plan creation, setup checks, checkout, every webhook event and cancelling. Uses a fake PayPal.
// Usage: npx tsx scripts/paypal-test.ts   (needs DATABASE_URL)
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'testtoken';
process.env.ADMIN_EMAIL = '';
process.env.GEMINI_API_KEY = '';
process.env.PAYPAL_CLIENT_ID = 'pp_client_id';
process.env.PAYPAL_CLIENT_SECRET = 'pp_client_secret';
process.env.PAYPAL_MODE = 'live';
process.env.PUBLIC_URL = 'https://bot.example';
delete process.env.PAYPAL_WEBHOOK_ID;
for (const p of ['PRO']) delete process.env[`PAYPAL_PLAN_${p}`];
import Fastify from 'fastify';
import { registerAdmin } from '../src/admin';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/auth';
import { providersAvailable } from '../src/services/billing';
import { checkPaypal, createPaypalPlans, ensurePaypalWebhook } from '../src/services/paypal';
import { setSetting } from '../src/services/settings';
import { PLANS, accessState } from '../src/plans';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const DOMAIN = '@paypal-test.local';
const DAY = 86_400_000;

// ---- a fake PayPal ----
const apiCalls: { method: string; path: string; auth: string; body: any; headers: Record<string, string> }[] = [];
const byRequestId = new Map<string, any>();
const plansById = new Map<string, any>();
const subs = new Map<string, any>();
let seq = 0;
let tokenFails = false;
let hooks: { id: string; url: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api-m.paypal.com')) return realFetch(url, init);
  const path = u.replace('https://api-m.paypal.com', '');
  const isForm = typeof init.body === 'string' && !init.body.startsWith('{');
  const body = init.body && !isForm ? JSON.parse(init.body) : init.body ?? null;
  const headers = (init.headers ?? {}) as Record<string, string>;
  apiCalls.push({ method: init.method ?? 'GET', path, auth: String(headers.Authorization ?? ''), body, headers });
  const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status });
  if (path === '/v1/oauth2/token') return tokenFails ? json({ error: 'invalid_client', error_description: 'Client Authentication failed' }, 401) : json({ access_token: 'tok_abc', expires_in: 32000 });
  const rid = headers['PayPal-Request-Id'];
  if (rid && byRequestId.has(rid)) return json(byRequestId.get(rid), 201);
  if (path === '/v1/catalogs/products' && init.method === 'POST') {
    const o = { id: `PROD-FAKE${++seq}`, ...body };
    if (rid) byRequestId.set(rid, o);
    return json(o, 201);
  }
  if (path === '/v1/billing/plans' && init.method === 'POST') {
    const o = { id: `P-FAKE${++seq}`, status: 'ACTIVE', ...body };
    plansById.set(o.id, o);
    if (rid) byRequestId.set(rid, o);
    return json(o, 201);
  }
  if (path.startsWith('/v1/billing/plans/')) {
    const p = plansById.get(path.slice('/v1/billing/plans/'.length));
    return p ? json(p) : json({ name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.' }, 404);
  }
  if (path === '/v1/billing/subscriptions' && init.method === 'POST') {
    const id = `I-FAKESUB${++seq}`;
    const o = { id, status: 'APPROVAL_PENDING', plan_id: body.plan_id, custom_id: body.custom_id, links: [{ rel: 'approve', href: `https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-${id}` }] };
    subs.set(id, o);
    return json(o, 201);
  }
  const sm = path.match(/^\/v1\/billing\/subscriptions\/([^/]+)(\/cancel)?$/);
  if (sm) {
    const s = subs.get(decodeURIComponent(sm[1]));
    if (!s) return json({ name: 'RESOURCE_NOT_FOUND', message: 'not found' }, 404);
    if (sm[2]) return new Response(null, { status: 204 });
    return json(s);
  }
  if (path === '/v1/notifications/webhooks' && (init.method ?? 'GET') === 'GET') return json({ webhooks: hooks });
  if (path === '/v1/notifications/webhooks' && init.method === 'POST') {
    const o = { id: `WH-FAKE${++seq}`, url: body.url, event_types: body.event_types };
    hooks.push(o);
    return json(o, 201);
  }
  if (path === '/v1/notifications/verify-webhook-signature') return json({ verification_status: body.transmission_sig === 'good' && body.webhook_id === process.env.PAYPAL_WEBHOOK_ID ? 'SUCCESS' : 'FAILURE' });
  return json({ message: 'not found' }, 404);
}) as any;

async function cleanup() {
  await prisma.billingEvent.deleteMany({ where: { id: { startsWith: 'paypal:ppt_' } } });
  await prisma.workspace.deleteMany({ where: { adminUsers: { some: { email: { endsWith: DOMAIN } } } } });
  await prisma.adminUser.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

(async () => {
  await cleanup();
  await setSetting('affiliate', {});
  const app = Fastify();
  registerAdmin(app, { getQr: async () => null });
  const J = { 'content-type': 'application/json' };
  const call = (h: any, method: any, url: string, payload?: any) => app.inject({ method, url, headers: h, payload });
  const cookieOf = (r: any) => ({ cookie: String(r.headers['set-cookie']).split(';')[0], ...J });

  console.log('[availability]');
  ok(providersAvailable().paypal === false, 'credentials alone are not enough: the webhook id and three plan ids are needed');

  console.log('\n[creating the PayPal plans and webhook]');
  const made = await createPaypalPlans();
  ok(made.length === 1 && made.every((m) => m.created && /^P-FAKE\d+$/.test(m.paypalPlanId)), 'one PayPal plan is created for each of our plans');
  const products = apiCalls.filter((c) => c.path === '/v1/catalogs/products');
  ok(products.length === 1 && products[0].body.type === 'SERVICE', 'under one product');
  const postedPlans = apiCalls.filter((c) => c.method === 'POST' && c.path === '/v1/billing/plans');
  const cycle = (c: any) => c.body.billing_cycles[0];
  ok(postedPlans.every((c) => cycle(c).frequency.interval_unit === 'MONTH' && cycle(c).frequency.interval_count === 1 && cycle(c).total_cycles === 0 && cycle(c).pricing_scheme.fixed_price.currency_code === 'USD'), 'each renews monthly with no end, in dollars');
  ok(PLANS.every((p) => postedPlans.some((c) => cycle(c).pricing_scheme.fixed_price.value === (p.price.USD / 100).toFixed(2))), 'with exactly our dollar prices');
  ok(postedPlans[0].auth === 'Bearer tok_abc', 'calls use the OAuth token');
  ok(apiCalls.find((c) => c.path === '/v1/oauth2/token')!.auth === 'Basic ' + Buffer.from('pp_client_id:pp_client_secret').toString('base64'), 'the token is fetched with the client id and secret');
  ok(apiCalls.filter((c) => c.path === '/v1/oauth2/token').length === 1, 'the token is reused, not fetched for every call');
  const again = await createPaypalPlans();
  ok(again.length === 1 && again.every((a) => !a.created === false || a.paypalPlanId === made.find((m) => m.plan === a.plan)!.paypalPlanId), 'running it again returns the same plans (stable request ids prevent duplicates)');
  for (const m of made) process.env[`PAYPAL_PLAN_${m.plan.toUpperCase()}`] = m.paypalPlanId;
  const hook1 = await ensurePaypalWebhook('https://bot.example/webhooks/paypal');
  const hook2 = await ensurePaypalWebhook('https://bot.example/webhooks/paypal');
  ok(hook1.created && !hook2.created && hook1.id === hook2.id, 'the webhook is registered once and then reused');
  const hookCall = apiCalls.find((c) => c.path === '/v1/notifications/webhooks' && c.method === 'POST')!;
  ok(['BILLING.SUBSCRIPTION.ACTIVATED', 'PAYMENT.SALE.COMPLETED', 'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.SUSPENDED'].every((e) => hookCall.body.event_types.some((t: any) => t.name === e)), 'it subscribes to the events we act on');
  process.env.PAYPAL_WEBHOOK_ID = hook1.id;
  ok(providersAvailable().paypal === true, 'with credentials, plan ids and the webhook id, PayPal is ready');

  console.log('\n[setup checklist]');
  let checks = await checkPaypal(false);
  ok(checks.every((c) => c.ok) && checks.some((c) => /LIVE mode/.test(c.detail)), 'the offline checklist is all green and says live mode');
  checks = await checkPaypal(true);
  ok(checks.some((c) => c.label === 'PayPal connection' && c.ok) && PLANS.every((p) => checks.some((c) => c.label === `${p.name} plan in PayPal` && c.ok)), 'the live check proves the credentials and each plan');
  const growthId = process.env.PAYPAL_PLAN_PRO!;
  plansById.get(growthId)!.billing_cycles[0].pricing_scheme.fixed_price.value = '1.00';
  checks = await checkPaypal(true);
  ok(checks.find((c) => c.label === 'Pro plan in PayPal')!.ok === false, 'a plan whose price differs from ours is flagged');
  plansById.get(growthId)!.billing_cycles[0].pricing_scheme.fixed_price.value = (PLANS.find((p) => p.id === 'pro')!.price.USD / 100).toFixed(1);
  tokenFails = true;
  const stale = apiCalls.length;
  checks = await checkPaypal(true);
  ok(checks.some((c) => c.label === 'PayPal connection' && c.ok), 'a cached token keeps working');
  tokenFails = false;
  void stale;

  // an operator and a business
  const opWs = await prisma.workspace.create({ data: { slug: `pp-op-${Date.now().toString(36)}`, name: 'Ops', businessName: 'Ops', plan: 'internal', planStatus: 'active', onboardingCompleted: true } });
  await prisma.adminUser.create({ data: { email: `op${DOMAIN}`, passwordHash: await hashPassword('operator password 1'), role: 'owner', isSuperAdmin: true, workspaceId: opWs.id } });
  const hOp = cookieOf(await call(J, 'POST', '/admin/api/login', { email: `op${DOMAIN}`, password: 'operator password 1' }));
  let r = await call(J, 'POST', '/admin/api/signup', { businessName: 'Pay Co', email: `owner${DOMAIN}`, password: 'pay owner password' });
  const hO = cookieOf(r);
  const wsId = r.json().user.workspace.id as string;
  await call(hO, 'POST', '/admin/api/admins', { email: `adm${DOMAIN}`, password: 'pay admin password', role: 'admin' });
  const hAdm = cookieOf(await call(J, 'POST', '/admin/api/login', { email: `adm${DOMAIN}`, password: 'pay admin password' }));
  const row = () => prisma.workspace.findUniqueOrThrow({ where: { id: wsId } });

  console.log('\n[the operator setup page]');
  ok((await call(hO, 'GET', '/admin/api/super/payments-setup')).statusCode === 403, 'a business cannot see the payments setup');
  r = await call(hOp, 'GET', '/admin/api/super/payments-setup?live=1');
  ok(r.statusCode === 200 && r.json().paypalReady === true && r.json().paypalWebhook === 'https://bot.example/webhooks/paypal' && r.json().paypal.length >= 4, 'the operator sees the PayPal checklist and the webhook address');
  ok(!JSON.stringify(r.json()).includes('pp_client_secret') && !JSON.stringify(r.json()).includes('tok_abc'), 'no secret is ever sent to the browser');
  r = await call(hO, 'GET', '/admin/api/billing');
  ok(r.json().providers.paypal === true, 'the billing page tells the owner PayPal is available');

  console.log('\n[starting a subscription]');
  ok((await call(hAdm, 'POST', '/admin/api/billing/checkout', { plan: 'pro', provider: 'paypal' })).statusCode === 403, 'only the owner can start a payment');
  r = await call(hO, 'POST', '/admin/api/billing/checkout', { plan: 'pro', provider: 'paypal' });
  ok(r.statusCode === 200 && /^https:\/\/www\.paypal\.com\/webapps\/billing\/subscriptions\?ba_token=/.test(r.json().url), 'the owner is sent to PayPal\'s approval page');
  const subCall = apiCalls.filter((c) => c.path === '/v1/billing/subscriptions' && c.method === 'POST').at(-1)!;
  ok(subCall.body.plan_id === growthId && subCall.body.custom_id === `${wsId}:pro` && subCall.body.subscriber.email_address === `owner${DOMAIN}`, 'it uses the Pro plan and carries the business id');
  ok(subCall.body.application_context.return_url === 'https://bot.example/admin/?billing=success' && subCall.body.application_context.cancel_url === 'https://bot.example/admin/?billing=cancelled', 'and returns the owner to the dashboard');
  const subId = (await row()).providerSubscriptionId!;
  ok(/^I-FAKESUB\d+$/.test(subId) && (await row()).billingProvider === 'paypal' && (await row()).plan === 'trial', 'the pending subscription is remembered but nothing is switched on yet');

  console.log('\n[webhooks]');
  const hook = (id: string, type: string, resource: any, sig = 'good') => {
    const raw = JSON.stringify({ id, event_type: type, resource });
    return app.inject({
      method: 'POST', url: '/webhooks/paypal', payload: raw,
      headers: { 'content-type': 'application/json', 'paypal-transmission-sig': sig, 'paypal-transmission-id': 'tid', 'paypal-transmission-time': new Date().toISOString(), 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-auth-algo': 'SHA256withRSA' }
    });
  };
  const end1 = new Date(Date.now() + 30 * DAY);
  const subRes = (next: Date, extra: any = {}) => ({ id: subId, plan_id: growthId, custom_id: `${wsId}:pro`, status: 'ACTIVE', billing_info: { next_billing_time: next.toISOString() }, ...extra });
  ok((await hook('ppt_bad', 'BILLING.SUBSCRIPTION.ACTIVATED', subRes(end1), 'forged')).statusCode === 400, 'an event PayPal does not vouch for is rejected');
  ok((await row()).plan === 'trial', '...and changes nothing');
  ok((await app.inject({ method: 'POST', url: '/webhooks/paypal', headers: J, payload: JSON.stringify({ id: 'x' }) })).statusCode === 400, 'an event with no PayPal headers is rejected');
  ok((await hook('ppt_1', 'BILLING.SUBSCRIPTION.ACTIVATED', subRes(end1))).statusCode === 200, 'BILLING.SUBSCRIPTION.ACTIVATED is accepted');
  let w = await row();
  ok(w.plan === 'pro' && w.planStatus === 'active' && w.billingProvider === 'paypal' && accessState(w).active, 'the plan is switched on');
  ok(Math.abs(w.currentPeriodEnd!.getTime() - end1.getTime()) < 1000, 'the period end is the next billing date from PayPal');
  ok(w.providerSubscriptionId === subId, 'the subscription id is kept');

  await setSetting('affiliate', { enabled: true, percent: 20, months: 12, bonusDays: 0 });
  const referrer = await prisma.workspace.create({ data: { slug: `pp-ref-${Date.now().toString(36)}`, name: 'Ref', businessName: 'Ref', botEnabled: false, onboardingCompleted: true } });
  await prisma.workspace.update({ where: { id: wsId }, data: { referredById: referrer.id } });
  const end2 = new Date(end1.getTime() + 30 * DAY);
  subs.get(subId).billing_info = { next_billing_time: end2.toISOString() };
  subs.get(subId).custom_id = `${wsId}:pro`;
  const sale = (id: string) => ({ id, billing_agreement_id: subId, state: 'completed', amount: { total: '19.00', currency: 'USD' } });
  ok((await hook('ppt_2', 'PAYMENT.SALE.COMPLETED', sale('SALE-1'))).statusCode === 200, 'PAYMENT.SALE.COMPLETED is accepted');
  ok(Math.abs((await row()).currentPeriodEnd!.getTime() - end2.getTime()) < 1000, 'a monthly charge moves the period end to the next billing date');
  ok((await prisma.payment.count({ where: { workspaceId: wsId, providerRef: 'SALE-1', amount: 1900, currency: 'USD', provider: 'paypal', status: 'paid' } })) === 1, 'the charge is recorded as a payment of $19.00');
  ok((await prisma.affiliateCommission.count({ where: { affiliateId: referrer.id } })) === 1, 'and earns the referrer a commission');
  await hook('ppt_2', 'PAYMENT.SALE.COMPLETED', sale('SALE-1'));
  await hook('ppt_2b', 'PAYMENT.SALE.COMPLETED', sale('SALE-1'));
  ok((await prisma.payment.count({ where: { workspaceId: wsId } })) === 1 && (await prisma.affiliateCommission.count({ where: { affiliateId: referrer.id } })) === 1, 'PayPal repeating an event or a payment is counted once');

  await hook('ppt_3', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', subRes(end2));
  ok((await row()).planStatus === 'past_due', 'a failed renewal puts the plan in grace (past due)');
  const end3 = new Date(end2.getTime() + 30 * DAY);
  subs.get(subId).billing_info = { next_billing_time: end3.toISOString() };
  await hook('ppt_4', 'PAYMENT.SALE.COMPLETED', sale('SALE-2'));
  w = await row();
  ok(w.planStatus === 'active' && (await prisma.payment.count({ where: { workspaceId: wsId } })) === 2 && Math.abs(w.currentPeriodEnd!.getTime() - end3.getTime()) < 1000, 'a later successful charge restores it');
  await hook('ppt_5', 'BILLING.SUBSCRIPTION.SUSPENDED', subRes(end3));
  ok((await row()).planStatus === 'past_due', 'suspended (retries exhausted) is past due');
  await hook('ppt_6', 'BILLING.SUBSCRIPTION.RE-ACTIVATED', subRes(end3));
  ok((await row()).planStatus === 'active', 're-activated is active again');
  await hook('ppt_7', 'BILLING.SUBSCRIPTION.ACTIVATED', subRes(end3, { custom_id: undefined }));
  ok((await row()).planStatus === 'active' && (await row()).plan === 'pro', 'an event without our custom id is still matched by the subscription id and the plan id');
  ok((await hook('ppt_8', 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-UNKNOWN', plan_id: 'P-X', billing_info: { next_billing_time: end1.toISOString() } })).body === 'no workspace', 'an unknown subscription is ignored safely');
  ok((await hook('ppt_9', 'PAYMENT.SALE.COMPLETED', { id: 'SALE-X', amount: { total: '5.00', currency: 'USD' } })).body === 'not a subscription', 'a one-off sale with no subscription is ignored');
  const before = await row();
  const other = await hook('ppt_10', 'BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-OLDCHECKOUT', custom_id: `${wsId}:pro`, plan_id: growthId });
  ok(other.body === 'stale subscription' && (await row()).planStatus === before.planStatus, 'an event about an old, abandoned checkout cannot disturb the current plan');

  console.log('\n[cancelling]');
  ok((await call(hAdm, 'POST', '/admin/api/billing/cancel')).statusCode === 403, 'only the owner can cancel');
  ok((await call(hO, 'POST', '/admin/api/billing/cancel')).statusCode === 200, 'the owner cancels');
  const cancel = apiCalls.filter((c) => /\/cancel$/.test(c.path)).at(-1)!;
  ok(cancel.path === `/v1/billing/subscriptions/${subId}/cancel` && cancel.method === 'POST', 'PayPal is told to stop future charges');
  w = await row();
  ok(w.cancelAtPeriodEnd === true && w.planStatus === 'active' && accessState(w).active, 'the plan keeps working until the end of the paid period');
  await hook('ppt_11', 'BILLING.SUBSCRIPTION.CANCELLED', subRes(end3));
  w = await row();
  ok(w.planStatus === 'canceled' && accessState(w).active && Math.abs(w.currentPeriodEnd!.getTime() - end3.getTime()) < 1000 && w.cancelAtPeriodEnd === true, 'PayPal confirming the cancellation keeps access to the end date already paid for');
  await prisma.workspace.update({ where: { id: wsId }, data: { currentPeriodEnd: new Date(Date.now() - DAY) } });
  ok(!accessState(await row()).active, 'and access stops once that date has passed');

  console.log('\n[a trial is not cancelled by an abandoned checkout]');
  r = await call(J, 'POST', '/admin/api/signup', { businessName: 'Trial Co', email: `trial${DOMAIN}`, password: 'trial owner password' });
  const hT = cookieOf(r);
  const tId = r.json().user.workspace.id as string;
  await call(hT, 'POST', '/admin/api/billing/checkout', { plan: 'pro', provider: 'paypal' });
  const tSub = (await prisma.workspace.findUniqueOrThrow({ where: { id: tId } })).providerSubscriptionId!;
  await hook('ppt_12', 'BILLING.SUBSCRIPTION.CANCELLED', { id: tSub, custom_id: `${tId}:pro`, plan_id: process.env.PAYPAL_PLAN_PRO });
  const t = await prisma.workspace.findUniqueOrThrow({ where: { id: tId } });
  ok(t.plan === 'trial' && t.planStatus === 'trialing' && accessState(t).active, 'cancelling a checkout that was never paid leaves the free trial alone');

  console.log('\n[wrong credentials]');
  process.env.PAYPAL_CLIENT_SECRET = 'wrong';
  tokenFails = true;
  checks = await checkPaypal(true);
  ok(checks.some((c) => c.label === 'PayPal connection' && !c.ok && /rejected the credentials/.test(c.detail)), 'wrong credentials are reported clearly');
  r = await call(hT, 'POST', '/admin/api/billing/checkout', { plan: 'pro', provider: 'paypal' });
  ok(r.statusCode === 400 && /rejected the credentials/.test(r.json().error) && !JSON.stringify(r.json()).includes('wrong'), 'checkout fails with a clear message and no secret');
  process.env.PAYPAL_CLIENT_SECRET = 'pp_client_secret';
  tokenFails = false;

  await cleanup();
  await prisma.workspace.deleteMany({ where: { id: { in: [referrer.id, opWs.id] } } }).catch(() => null);
  await setSetting('affiliate', {});
  console.log('\nPAYPAL TESTS OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
