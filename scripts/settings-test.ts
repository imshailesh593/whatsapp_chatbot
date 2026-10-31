// Operator settings: keys saved in the panel (encrypted, applied at once), plan editing, Razorpay/PayPal plan creation,
// the webhook secret, the Resend test email and billing emails. Uses fake Razorpay, PayPal and Resend.
// Usage: npx tsx scripts/settings-test.ts   (needs DATABASE_URL)
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'testtoken';
process.env.SESSION_SECRET = 'settings-test-secret';
process.env.ADMIN_EMAIL = '';
process.env.GEMINI_API_KEY = '';
process.env.PUBLIC_URL = 'https://bot.example';
for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_PLAN_PRO', 'RAZORPAY_MODE', 'RESEND_API_KEY', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_FROM', 'PAYPAL_PLAN_PRO']) delete process.env[k];
import crypto from 'crypto';
import Fastify from 'fastify';
import { registerAdmin } from '../src/admin';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/auth';
import { loadRuntimeConfig } from '../src/services/runtimeConfig';
import { loadPlanOverrides } from '../src/services/planConfig';
import { handleRazorpayWebhook, providersAvailable } from '../src/services/billing';
import { setSetting } from '../src/services/settings';
import { PLANS, PLAN_DEFAULTS } from '../src/plans';
import { registerSite } from '../src/site';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const DOMAIN = '@settings-test.local';
const EMAIL_OWNER = 'owner-settings@example.com';

// ---- fake Razorpay and Resend ----
const rzCalls: any[] = [];
const mails: any[] = [];
let planSeq = 0;
let resendFails = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url);
  const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status });
  if (u.startsWith('https://api.razorpay.com/v1')) {
    const path = u.replace('https://api.razorpay.com/v1', '');
    const body = init.body ? JSON.parse(init.body) : null;
    rzCalls.push({ method: init.method ?? 'GET', path, body, auth: init.headers?.Authorization });
    if (path === '/plans' && init.method === 'POST') return json({ id: `plan_new${++planSeq}` });
    return json({ error: { description: 'not found' } }, 404);
  }
  if (u === 'https://api.resend.com/emails') {
    if (resendFails) return json({ message: 'The domain is not verified' }, 403);
    mails.push({ auth: init.headers?.Authorization, ...JSON.parse(init.body) });
    return json({ id: 'em_1' });
  }
  return realFetch(url, init);
}) as any;

async function cleanup() {
  await prisma.billingEvent.deleteMany({ where: { id: { startsWith: 'razorpay:setx_' } } });
  await prisma.workspace.deleteMany({ where: { adminUsers: { some: { email: { in: [EMAIL_OWNER] } } } } });
  await prisma.workspace.deleteMany({ where: { adminUsers: { some: { email: { endsWith: DOMAIN } } } } });
  await prisma.adminUser.deleteMany({ where: { email: { in: [EMAIL_OWNER] } } });
  await prisma.adminUser.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.setting.deleteMany({ where: { key: { in: ['runtimeConfig', 'planOverrides'] } } });
}

(async () => {
  await cleanup();
  await setSetting('affiliate', {});
  const app = Fastify();
  registerAdmin(app, { getQr: async () => null });
  registerSite(app);
  const J = { 'content-type': 'application/json' };
  const call = (h: any, method: any, url: string, payload?: any) => app.inject({ method, url, headers: h, payload });
  const cookieOf = (r: any) => ({ cookie: String(r.headers['set-cookie']).split(';')[0], ...J });

  const opWs = await prisma.workspace.create({ data: { slug: `set-op-${Date.now().toString(36)}`, name: 'Ops', businessName: 'Ops', plan: 'internal', planStatus: 'active', onboardingCompleted: true } });
  await prisma.adminUser.create({ data: { email: `op${DOMAIN}`, passwordHash: await hashPassword('operator password 1'), role: 'owner', isSuperAdmin: true, workspaceId: opWs.id } });
  const hOp = cookieOf(await call(J, 'POST', '/admin/api/login', { email: `op${DOMAIN}`, password: 'operator password 1' }));
  let r = await call(J, 'POST', '/admin/api/signup', { businessName: 'Biz Co', email: EMAIL_OWNER, password: 'biz owner password' });
  const hBiz = cookieOf(r);
  const bizId = r.json().user.workspace.id as string;

  console.log('[access]');
  for (const [m, u] of [['GET', '/admin/api/super/config'], ['PUT', '/admin/api/super/config'], ['POST', '/admin/api/super/razorpay/create-plan'], ['POST', '/admin/api/super/razorpay/webhook-secret'], ['POST', '/admin/api/super/email/test'], ['PUT', '/admin/api/super/plans/pro']] as const)
    ok((await call(hBiz, m, u, {})).statusCode === 403, `a business cannot use ${m} ${u}`);

  console.log('\n[keys saved in the panel]');
  r = await call(hOp, 'GET', '/admin/api/super/config');
  ok(r.statusCode === 200 && r.json().fields.every((f: any) => !f.set) && r.json().razorpayMode === 'subscription' && r.json().razorpayWebhook === 'https://bot.example/webhooks/razorpay', 'at first nothing is set, mode is subscription and the webhook address is shown');
  ok((await call(hOp, 'PUT', '/admin/api/super/config', { values: { RAZORPAY_KEY_ID: 'nope' } })).statusCode === 400, 'a key id that does not start with rzp_ is refused');
  ok((await call(hOp, 'PUT', '/admin/api/super/config', { values: { RESEND_API_KEY: 'abc' } })).statusCode === 400, 'a Resend key that does not start with re_ is refused');
  ok((await call(hOp, 'PUT', '/admin/api/super/config', { values: { MAIL_FROM: 'no-at-sign' } })).statusCode === 400, 'a sender without an address is refused');
  ok((await call(hOp, 'PUT', '/admin/api/super/config', { values: { PAYPAL_CLIENT_SECRET: 'x' } })).statusCode === 400, 'only the listed keys can be changed');
  r = await call(hOp, 'PUT', '/admin/api/super/config', { values: { RAZORPAY_KEY_ID: 'rzp_live_abc123', RAZORPAY_KEY_SECRET: 'secret_value_9876', RAZORPAY_WEBHOOK_SECRET: 'whsec_panel_1', RESEND_API_KEY: 're_test_key_4321', MAIL_FROM: 'Wappo <hello@wappoai.com>' } });
  ok(r.statusCode === 200, 'valid keys are saved');
  ok(process.env.RAZORPAY_KEY_ID === 'rzp_live_abc123' && process.env.RESEND_API_KEY === 're_test_key_4321', 'and take effect at once, with no restart');
  const view = JSON.stringify(r.json());
  ok(!view.includes('secret_value_9876') && !view.includes('whsec_panel_1') && !view.includes('re_test_key_4321'), 'no secret is sent back to the browser');
  const f = (k: string) => r.json().fields.find((x: any) => x.key === k);
  ok(f('RAZORPAY_KEY_SECRET').preview === '••••9876' && f('RAZORPAY_KEY_SECRET').source === 'panel' && f('RAZORPAY_KEY_ID').preview === 'rzp_live_abc123', 'secrets show only their last four characters; ids show in full');
  ok(r.json().email.configured && r.json().email.provider === 'resend', 'email now reports Resend as on');
  const stored = (await prisma.setting.findUnique({ where: { key: 'runtimeConfig' } }))!.value as Record<string, string>;
  ok(!JSON.stringify(stored).includes('secret_value_9876') && !JSON.stringify(stored).includes('rzp_live_abc123'), 'in the database the values are encrypted');
  const entries = (await prisma.auditLog.findMany({ where: { action: 'config.update' } })).map((a) => a.detail).join('|');
  ok(entries.includes('RAZORPAY_KEY_SECRET') && !entries.includes('secret_value_9876'), 'the audit log names the keys changed, never their values');
  delete process.env.RAZORPAY_KEY_ID;
  await loadRuntimeConfig();
  ok(process.env.RAZORPAY_KEY_ID === 'rzp_live_abc123', 'after a restart the saved keys are loaded again');
  r = await call(hOp, 'PUT', '/admin/api/super/config', { values: { RAZORPAY_KEY_ID: '' } });
  ok(!r.json().fields.find((x: any) => x.key === 'RAZORPAY_KEY_ID').set && !process.env.RAZORPAY_KEY_ID, 'clearing a key removes it');
  await call(hOp, 'PUT', '/admin/api/super/config', { values: { RAZORPAY_KEY_ID: 'rzp_live_abc123' } });

  console.log('\n[razorpay: mode, webhook secret and plan]');
  ok(providersAvailable().razorpay === false, 'keys and a webhook secret are not enough without a plan id');
  r = await call(hOp, 'POST', '/admin/api/super/razorpay/create-plan');
  ok(r.statusCode === 200 && r.json().plans[0].razorpayPlanId === 'plan_new1', 'the operator creates the Razorpay plan from the panel');
  const created = rzCalls.find((c) => c.method === 'POST' && c.path === '/plans')!;
  ok(created.body.period === 'monthly' && created.body.interval === 1 && created.body.item.amount === PLANS[0].price.INR && created.body.item.currency === 'INR', 'it is monthly and priced like our plan');
  ok(created.auth === 'Basic ' + Buffer.from('rzp_live_abc123:secret_value_9876').toString('base64'), 'it uses the keys saved in the panel');
  ok(process.env.RAZORPAY_PLAN_PRO === 'plan_new1' && providersAvailable().razorpay === true, 'the plan id is stored and Razorpay is now ready');
  r = await call(hOp, 'POST', '/admin/api/super/razorpay/webhook-secret');
  const secret = r.json().secret as string;
  ok(r.statusCode === 200 && secret.length >= 24 && process.env.RAZORPAY_WEBHOOK_SECRET === secret, 'a new webhook secret is generated, saved and returned once');
  ok(!JSON.stringify((await call(hOp, 'GET', '/admin/api/super/config')).json()).includes(secret), 'and never shown again');
  r = await call(hOp, 'PUT', '/admin/api/super/config', { values: { RAZORPAY_MODE: 'link' } });
  ok(r.json().razorpayMode === 'link', 'the mode can be switched to payment links');
  r = await call(hOp, 'PUT', '/admin/api/super/config', { values: { RAZORPAY_MODE: 'subscription' } });
  ok(r.json().razorpayMode === 'subscription' && !process.env.RAZORPAY_MODE, '...and back to subscriptions');

  console.log('\n[editing the plan]');
  const priceBefore = PLANS[0].price.INR;
  ok((await call(hOp, 'PUT', '/admin/api/super/plans/nope', { name: 'X' })).statusCode === 400, 'an unknown plan is refused');
  ok((await call(hOp, 'PUT', '/admin/api/super/plans/pro', { priceInr: 0 })).statusCode === 400 && (await call(hOp, 'PUT', '/admin/api/super/plans/pro', { limits: { conversations: 0 } })).statusCode === 400 && (await call(hOp, 'PUT', '/admin/api/super/plans/pro', { name: 'X' })).statusCode === 400, 'a zero price, zero chats or a one-letter name are refused');
  r = await call(hOp, 'PUT', '/admin/api/super/plans/pro', { name: 'Pro Plus', priceInr: 799, priceUsd: 29, limits: { conversations: 2500, seats: 8 }, blurb: 'Everything included, now with more room for your team.' });
  ok(r.statusCode === 200 && PLANS[0].name === 'Pro Plus' && PLANS[0].price.INR === 79_900 && PLANS[0].price.USD === 2_900 && PLANS[0].limits.conversations === 2500 && PLANS[0].limits.seats === 8 && PLANS[0].limits.aiReplies === PLAN_DEFAULTS[0].limits.aiReplies, 'name, prices and limits change, and what was not sent stays as it was');
  r = await call(hOp, 'GET', '/admin/api/super/plans');
  ok(r.json().plans[0].price.INR === 79_900 && r.json().plans[0].blurb.includes('more room'), 'the plans list shows the change');
  const page = (await app.inject({ method: 'GET', url: '/?region=in' })).body;
  ok(page.includes('₹799') && page.includes('Pro Plus') && !page.includes('₹499'), 'the website shows the new price and name straight away');
  ok((await app.inject({ method: 'GET', url: '/?region=world' })).body.includes('$29'), '...and the new dollar price');
  PLANS[0].price.INR = 49_900;
  PLANS[0].name = 'x';
  await loadPlanOverrides();
  ok(PLANS[0].name === 'Pro Plus' && PLANS[0].price.INR === 79_900, 'after a restart the saved plan is loaded again');
  r = await call(hOp, 'POST', '/admin/api/super/razorpay/create-plan');
  ok(rzCalls.filter((c) => c.method === 'POST' && c.path === '/plans').pop()!.body.item.amount === 79_900 && process.env.RAZORPAY_PLAN_PRO === 'plan_new2', 'creating the Razorpay plan again uses the new price and switches new subscribers to it');
  r = await call(hOp, 'POST', '/admin/api/super/plans/pro/reset');
  ok(r.statusCode === 200 && PLANS[0].name === PLAN_DEFAULTS[0].name && PLANS[0].price.INR === priceBefore, 'reset puts the plan back as shipped');

  console.log('\n[an existing subscriber keeps their plan when the plan id changes]');
  const sub = 'sub_setx_1';
  await prisma.workspace.update({ where: { id: bizId }, data: { providerSubscriptionId: sub, billingProvider: 'razorpay' } });
  const hook = async (id: string, event: string, entity: any) => {
    const raw = JSON.stringify({ event, payload: { subscription: { entity }, payment: { entity: { id: `pay_${id}`, amount: 49_900, currency: 'INR' } } } });
    const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest('hex');
    return handleRazorpayWebhook(raw, sig, id);
  };
  ok((await hook('setx_1', 'subscription.charged', { id: sub, plan_id: 'plan_old_unknown', notes: { workspaceId: bizId, plan: 'pro' }, current_end: Math.floor(Date.now() / 1000) + 30 * 86400 })).status === 200, 'a charge on an older Razorpay plan is accepted');
  const biz = await prisma.workspace.findUniqueOrThrow({ where: { id: bizId } });
  ok(biz.planStatus === 'active' && biz.plan === 'pro', 'and still switches the plan on');

  console.log('\n[email through Resend]');
  r = await call(hOp, 'POST', '/admin/api/super/email/test', { to: 'not-an-email' });
  ok(r.statusCode === 400, 'a bad test address is refused');
  r = await call(hOp, 'POST', '/admin/api/super/email/test', { to: 'me@example.com' });
  ok(r.statusCode === 200 && mails.some((m) => m.to[0] === 'me@example.com' && m.from === 'Wappo <hello@wappoai.com>' && m.auth === 'Bearer re_test_key_4321'), 'the test email goes through Resend with the saved key and sender');
  resendFails = true;
  r = await call(hOp, 'POST', '/admin/api/super/email/test', { to: 'me@example.com' });
  ok(r.statusCode === 400 && /domain is not verified/.test(r.json().error), 'a Resend error is shown to the operator in Resend\'s words');
  resendFails = false;

  console.log('\n[billing emails to the owner]');
  const wait = () => new Promise((res) => setTimeout(res, 300));
  const to = () => mails.filter((m) => m.to[0] === EMAIL_OWNER);
  await prisma.workspace.update({ where: { id: bizId }, data: { planStatus: 'inactive', currentPeriodEnd: null } });
  mails.length = 0;
  await hook('setx_2', 'subscription.activated', { id: sub, plan_id: process.env.RAZORPAY_PLAN_PRO, notes: { workspaceId: bizId, plan: 'pro' }, current_end: Math.floor(Date.now() / 1000) + 30 * 86400 });
  await wait();
  ok(to().some((m) => /subscription is active/.test(m.subject)), 'a new subscription gets an "active" email');
  mails.length = 0;
  await hook('setx_3', 'subscription.charged', { id: sub, plan_id: process.env.RAZORPAY_PLAN_PRO, notes: { workspaceId: bizId, plan: 'pro' }, current_end: Math.floor(Date.now() / 1000) + 60 * 86400 });
  await wait();
  ok(to().some((m) => /Payment received/.test(m.subject) && /₹499/.test(m.text)), 'each payment gets a receipt with the amount');
  mails.length = 0;
  await hook('setx_4', 'subscription.halted', { id: sub, notes: { workspaceId: bizId, plan: 'pro' } });
  await wait();
  ok(to().some((m) => /did not go through/.test(m.subject)), 'a failed payment gets an "action needed" email');
  mails.length = 0;
  await hook('setx_5', 'subscription.cancelled', { id: sub, notes: { workspaceId: bizId, plan: 'pro' }, current_end: Math.floor(Date.now() / 1000) + 5 * 86400 });
  await wait();
  ok(to().some((m) => /cancelled/.test(m.subject) && /You keep access until/.test(m.text)), 'a cancellation says until when access lasts');
  delete process.env.RESEND_API_KEY;
  mails.length = 0;
  await hook('setx_6', 'subscription.activated', { id: sub, notes: { workspaceId: bizId, plan: 'pro' }, current_end: Math.floor(Date.now() / 1000) + 30 * 86400 });
  await wait();
  ok(mails.length === 0, 'with email switched off nothing is sent and the webhook still succeeds');

  await cleanup();
  console.log('\nSETTINGS TESTS OK');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
