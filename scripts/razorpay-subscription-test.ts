// Razorpay subscriptions (the default): plan creation, setup checks, checkout, every webhook event and cancelling.
// Uses a fake Razorpay. Usage: npx tsx scripts/razorpay-subscription-test.ts   (needs DATABASE_URL)
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'testtoken';
process.env.ADMIN_EMAIL = '';
process.env.GEMINI_API_KEY = '';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_sub';
process.env.PUBLIC_URL = 'https://bot.example';
delete process.env.RAZORPAY_MODE;
for (const p of ['PRO']) delete process.env[`RAZORPAY_PLAN_${p}`];
import crypto from 'crypto';
import Fastify from 'fastify';
import { registerAdmin } from '../src/admin';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/auth';
import { providersAvailable } from '../src/services/billing';
import { checkRazorpay, createPlans } from '../src/services/razorpaySetup';
import { setSetting } from '../src/services/settings';
import { PLANS, accessState } from '../src/plans';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const DOMAIN = '@rzsub-test.local';
const DAY = 86_400_000;

// ---- a fake Razorpay ----
const apiCalls: { method: string; path: string; auth: string; body: any }[] = [];
let planSeq = 0;
let subSeq = 0;
let authFails = false;
const plansById = new Map<string, any>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.razorpay.com/v1')) return realFetch(url, init);
  const path = u.replace('https://api.razorpay.com/v1', '');
  const body = init.body ? JSON.parse(init.body) : null;
  apiCalls.push({ method: init.method ?? 'GET', path, auth: String(init.headers?.Authorization ?? ''), body });
  const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status });
  if (authFails) return json({ error: { description: 'Authentication failed' } }, 401);
  if (path.startsWith('/plans?')) return json({ items: [] });
  if (path === '/plans' && init.method === 'POST') {
    const id = `plan_fake${++planSeq}`;
    plansById.set(id, { id, ...body });
    return json({ id });
  }
  if (path.startsWith('/plans/')) {
    const p = plansById.get(path.slice(7));
    return p ? json(p) : json({ error: { description: 'The id provided does not exist' } }, 400);
  }
  if (path === '/subscriptions' && init.method === 'POST') return json({ id: `sub_fake${++subSeq}`, short_url: `https://rzp.io/i/sub${subSeq}` });
  if (/^\/subscriptions\/[^/]+\/cancel$/.test(path)) return json({ id: path.split('/')[2], status: 'active' });
  return json({ error: { description: 'not found' } }, 404);
}) as any;

async function cleanup() {
  await prisma.billingEvent.deleteMany({ where: { id: { startsWith: 'razorpay:rzs_' } } });
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
  ok(providersAvailable().razorpay === false, 'keys alone are not enough: the three plan ids are needed');

  console.log('\n[creating the Razorpay plans]');
  const made = await createPlans();
  ok(made.length === 1 && made.every((m) => m.created && /^plan_fake\d$/.test(m.razorpayPlanId)), 'one Razorpay plan is created for each of our plans');
  const postedPlans = apiCalls.filter((c) => c.method === 'POST' && c.path === '/plans');
  ok(postedPlans.every((c) => c.body.period === 'monthly' && c.body.interval === 1 && c.body.item.currency === 'INR'), 'each is monthly and in rupees');
  ok(PLANS.every((p) => postedPlans.some((c) => c.body.item.amount === p.price.INR && c.body.notes.plan === p.id)), 'with exactly our prices (in paise)');
  ok(postedPlans[0].auth === 'Basic ' + Buffer.from('rzp_test_key:rzp_test_secret').toString('base64'), 'using the account keys');
  for (const m of made) process.env[`RAZORPAY_PLAN_${m.plan.toUpperCase()}`] = m.razorpayPlanId;
  const before = apiCalls.length;
  const again = await createPlans();
  ok(again.every((a) => !a.created) && apiCalls.length === before, 'running it again creates nothing (Razorpay cannot delete plans)');
  ok(providersAvailable().razorpay === true, 'with keys, plan ids and the webhook secret, Razorpay is ready');
  const keep = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = '';
  ok(providersAvailable().razorpay === false, 'without the webhook secret it is reported as not ready (a payment could never switch a plan on)');
  process.env.RAZORPAY_WEBHOOK_SECRET = keep;

  console.log('\n[setup checklist]');
  let checks = await checkRazorpay(false);
  ok(checks.every((c) => c.ok) && checks.some((c) => /TEST mode/.test(c.detail)), 'the offline checklist is all green and says the keys are test keys');
  checks = await checkRazorpay(true);
  ok(checks.some((c) => c.label === 'Razorpay connection' && c.ok) && PLANS.every((p) => checks.some((c) => c.label === `${p.name} plan in Razorpay` && c.ok)), 'the live check proves the keys and each plan');
  plansById.get(process.env.RAZORPAY_PLAN_PRO!)!.item.amount = 100;
  checks = await checkRazorpay(true);
  ok(checks.find((c) => c.label === 'Pro plan in Razorpay')!.ok === false && /must match/.test(checks.find((c) => c.label === 'Pro plan in Razorpay')!.detail), 'a plan whose price differs from ours is flagged');
  plansById.get(process.env.RAZORPAY_PLAN_PRO!)!.item.amount = PLANS.find((p) => p.id === 'pro')!.price.INR;
  authFails = true;
  checks = await checkRazorpay(true);
  ok(checks.some((c) => c.label === 'Razorpay connection' && !c.ok && /Authentication failed/.test(c.detail)), 'wrong keys are reported with Razorpay\'s own message');
  authFails = false;

  // an operator and a business
  const opWs = await prisma.workspace.create({ data: { slug: `rzs-op-${Date.now().toString(36)}`, name: 'Ops', businessName: 'Ops', plan: 'internal', planStatus: 'active', onboardingCompleted: true } });
  await prisma.adminUser.create({ data: { email: `op${DOMAIN}`, passwordHash: await hashPassword('operator password 1'), role: 'owner', isSuperAdmin: true, workspaceId: opWs.id } });
  const hOp = cookieOf(await call(J, 'POST', '/admin/api/login', { email: `op${DOMAIN}`, password: 'operator password 1' }));
  let r = await call(J, 'POST', '/admin/api/signup', { businessName: 'Sub Co', email: `owner${DOMAIN}`, password: 'sub owner password' });
  const hO = cookieOf(r);
  const wsId = r.json().user.workspace.id as string;
  await call(hO, 'POST', '/admin/api/admins', { email: `adm${DOMAIN}`, password: 'sub admin password', role: 'admin' });
  const hAdm = cookieOf(await call(J, 'POST', '/admin/api/login', { email: `adm${DOMAIN}`, password: 'sub admin password' }));
  const row = () => prisma.workspace.findUniqueOrThrow({ where: { id: wsId } });

  console.log('\n[the operator setup page]');
  ok((await call(hO, 'GET', '/admin/api/super/payments-setup')).statusCode === 403, 'a business cannot see the payments setup');
  r = await call(hOp, 'GET', '/admin/api/super/payments-setup?live=1');
  ok(r.statusCode === 200 && r.json().razorpayReady === true && r.json().razorpayWebhook === 'https://bot.example/webhooks/razorpay' && r.json().razorpay.length > 5, 'the operator sees the checklist and the exact webhook address to add');
  ok(r.json().stripeReady === false && r.json().stripe.some((c: any) => !c.ok), 'Stripe is reported as not set up');
  ok(!JSON.stringify(r.json()).includes('rzp_test_secret') && !JSON.stringify(r.json()).includes('whsec_sub'), 'no secret is ever sent to the browser');

  console.log('\n[starting a subscription]');
  ok((await call(hAdm, 'POST', '/admin/api/billing/checkout', { plan: 'pro', provider: 'razorpay' })).statusCode === 403, 'only the owner can start a payment');
  r = await call(hO, 'POST', '/admin/api/billing/checkout', { plan: 'pro', provider: 'razorpay' });
  ok(r.statusCode === 200 && /^https:\/\/rzp\.io\/i\/sub\d$/.test(r.json().url), 'the owner is sent to Razorpay\'s hosted payment page');
  const sub = apiCalls.filter((c) => c.path === '/subscriptions').at(-1)!;
  ok(sub.body.plan_id === process.env.RAZORPAY_PLAN_PRO && sub.body.total_count >= 12 && sub.body.notes.workspaceId === wsId && sub.body.notes.plan === 'pro', 'the subscription uses the Pro plan and carries the business id');
  const subId = (await row()).providerSubscriptionId!;
  ok(/^sub_fake\d$/.test(subId) && (await row()).billingProvider === 'razorpay', 'the pending subscription is remembered');
  ok((await row()).plan === 'trial', 'nothing is switched on until Razorpay confirms payment');

  console.log('\n[webhooks]');
  const hook = (id: string, event: string, payload: any, secret = 'whsec_sub') => {
    const raw = JSON.stringify({ event, payload });
    return app.inject({ method: 'POST', url: '/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex'), 'x-razorpay-event-id': id }, payload: raw });
  };
  const end1 = Math.floor((Date.now() + 30 * DAY) / 1000);
  const body = (end: number, withNotes = true) => ({
    subscription: { entity: { id: subId, plan_id: process.env.RAZORPAY_PLAN_PRO, customer_id: 'cust_1', current_end: end, ...(withNotes ? { notes: { workspaceId: wsId, plan: 'pro' } } : {}) } },
    payment: { entity: { id: 'pay_s1', amount: 49_900, currency: 'INR' } }
  });
  ok((await hook('rzs_bad', 'subscription.activated', body(end1), 'wrong')).statusCode === 400, 'a webhook with a bad signature is rejected');
  ok((await row()).plan === 'trial', '...and changes nothing');
  ok((await hook('rzs_1', 'subscription.activated', body(end1))).statusCode === 200, 'subscription.activated is accepted');
  let w = await row();
  ok(w.plan === 'pro' && w.planStatus === 'active' && w.billingProvider === 'razorpay' && accessState(w).active, 'the plan is switched on');
  ok(Math.abs(w.currentPeriodEnd!.getTime() - end1 * 1000) < 1000 && w.providerCustomerId === 'cust_1', 'the period end comes from Razorpay');
  await setSetting('affiliate', { enabled: true, percent: 20, months: 12, bonusDays: 0 });
  const referrer = await prisma.workspace.create({ data: { slug: `rzs-ref-${Date.now().toString(36)}`, name: 'Ref', businessName: 'Ref', botEnabled: false, onboardingCompleted: true } });
  await prisma.workspace.update({ where: { id: wsId }, data: { referredById: referrer.id } });
  const end2 = end1 + 30 * 86400;
  await hook('rzs_2', 'subscription.charged', body(end2));
  ok(Math.abs((await row()).currentPeriodEnd!.getTime() - end2 * 1000) < 1000, 'a monthly charge moves the period end forward');
  ok((await prisma.payment.count({ where: { workspaceId: wsId, providerRef: 'pay_s1', amount: 49_900, status: 'paid' } })) === 1, 'the charge is recorded as a payment');
  ok((await prisma.affiliateCommission.count({ where: { affiliateId: referrer.id } })) === 1, 'and earns the referrer a commission');
  await hook('rzs_2', 'subscription.charged', body(end2));
  await hook('rzs_2b', 'subscription.charged', body(end2));
  ok((await prisma.payment.count({ where: { workspaceId: wsId } })) === 1 && (await prisma.affiliateCommission.count({ where: { affiliateId: referrer.id } })) === 1, 'Razorpay repeating an event or a payment is counted once');
  await hook('rzs_3', 'subscription.pending', body(end2));
  ok((await row()).planStatus === 'past_due', 'a failed renewal puts the plan in grace (past due)');
  await hook('rzs_4', 'subscription.charged', { ...body(end2 + 30 * 86400), payment: { entity: { id: 'pay_s2', amount: 49_900, currency: 'INR' } } });
  w = await row();
  ok(w.planStatus === 'active' && (await prisma.payment.count({ where: { workspaceId: wsId } })) === 2, 'a later successful charge restores it');
  await hook('rzs_5', 'subscription.halted', body(end2));
  ok((await row()).planStatus === 'past_due', 'halted (retries exhausted) is past due');
  await hook('rzs_6', 'subscription.resumed', body(end2 + 30 * 86400));
  ok((await row()).planStatus === 'active', 'resumed is active again');
  await hook('rzs_7', 'subscription.activated', body(end2, false));
  ok((await row()).planStatus === 'active' && (await row()).plan === 'pro', 'a webhook without our notes is still matched by the subscription id and the plan id');
  ok((await hook('rzs_8', 'subscription.activated', { subscription: { entity: { id: 'sub_unknown', plan_id: 'plan_x', current_end: end1 } } })).body === 'no workspace', 'an unknown subscription is ignored safely');

  console.log('\n[cancelling]');
  ok((await call(hAdm, 'POST', '/admin/api/billing/cancel')).statusCode === 403, 'only the owner can cancel');
  ok((await call(hO, 'POST', '/admin/api/billing/cancel')).statusCode === 200, 'the owner cancels');
  const cancel = apiCalls.filter((c) => /\/cancel$/.test(c.path)).at(-1)!;
  ok(cancel.path === `/subscriptions/${subId}/cancel` && cancel.body.cancel_at_cycle_end === 1, 'Razorpay is told to stop after the current period');
  ok((await row()).cancelAtPeriodEnd === true && accessState(await row()).active, 'access continues until the period ends');
  await hook('rzs_9', 'subscription.cancelled', body(Math.floor((Date.now() - DAY) / 1000)));
  w = await row();
  ok(w.planStatus === 'canceled' && !accessState(w).active, 'once Razorpay reports it cancelled and the period is over, the bot stops replying');

  await setSetting('affiliate', {});
  await prisma.workspace.deleteMany({ where: { id: { in: [opWs.id, referrer.id] } } });
  await cleanup();
  globalThis.fetch = realFetch;
  console.log('\nRAZORPAY SUBSCRIPTION TESTS OK');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  globalThis.fetch = realFetch;
  try { await setSetting('affiliate', {}); await cleanup(); } catch { /* best effort */ }
  await prisma.$disconnect();
  process.exit(1);
});
