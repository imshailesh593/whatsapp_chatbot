// Razorpay payment-link billing: link creation, the payment_link.paid webhook, renewals and safety checks (fake Razorpay).
// Usage: npx tsx scripts/razorpay-link-test.ts   (needs DATABASE_URL)
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'testtoken';
process.env.ADMIN_EMAIL = '';
process.env.GEMINI_API_KEY = '';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_rz';
process.env.PUBLIC_URL = 'https://bot.example';
delete process.env.RAZORPAY_MODE;
import crypto from 'crypto';
import Fastify from 'fastify';
import { registerAdmin } from '../src/admin';
import { prisma } from '../src/lib/prisma';
import { providersAvailable, renewalTick } from '../src/services/billing';
import { setTransport } from '../src/services/transport';
import { setSetting } from '../src/services/settings';
import { accessState, PLANS } from '../src/plans';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const DOMAIN = '@rzlink-test.local';
const DAY = 86_400_000;

// ---- a fake Razorpay ----
const apiCalls: { url: string; auth: string; body: any }[] = [];
let linkSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.razorpay.com')) return realFetch(url, init);
  apiCalls.push({ url: u, auth: String(init.headers?.Authorization ?? ''), body: init.body ? JSON.parse(init.body) : null });
  if (u.endsWith('/payment_links')) return new Response(JSON.stringify({ id: `plink_${++linkSeq}`, short_url: `https://rzp.io/i/test${linkSeq}` }), { status: 200 });
  return new Response(JSON.stringify({ error: { description: 'not found' } }), { status: 404 });
}) as any;

async function cleanup() {
  await prisma.billingEvent.deleteMany({ where: { id: { startsWith: 'razorpay:rzl_' } } });
  await prisma.billingEvent.deleteMany({ where: { id: { startsWith: 'renewal:' } } });
  await prisma.workspace.deleteMany({ where: { adminUsers: { some: { email: { endsWith: DOMAIN } } } } });
  await prisma.adminUser.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

(async () => {
  await cleanup();
  const app = Fastify();
  registerAdmin(app, { getQr: async () => null });
  const J = { 'content-type': 'application/json' };
  const call = (h: any, method: any, url: string, payload?: any) => app.inject({ method, url, headers: h, payload });
  const cookieOf = (r: any) => ({ cookie: String(r.headers['set-cookie']).split(';')[0], ...J });

  console.log('[availability]');
  ok(providersAvailable().razorpay === true, 'payment-link mode needs only the keys and webhook secret (no plan ids, no live website)');
  const keep = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = '';
  ok(providersAvailable().razorpay === false, 'without a webhook secret payments could never be applied, so it is reported as not set up');
  process.env.RAZORPAY_WEBHOOK_SECRET = keep;
  process.env.RAZORPAY_MODE = 'subscription';
  ok(providersAvailable().razorpay === false, 'subscription mode still needs the Razorpay plan ids');
  delete process.env.RAZORPAY_MODE;

  // a business with an owner and an agent
  let r = await call(J, 'POST', '/admin/api/signup', { businessName: 'Link Co', email: `owner${DOMAIN}`, password: 'link owner password' });
  const hO = cookieOf(r);
  const wsId = r.json().user.workspace.id as string;
  r = await call(hO, 'POST', '/admin/api/admins', { email: `agent${DOMAIN}`, password: 'link agent password', role: 'admin' });
  const hAdmin = cookieOf(await call(J, 'POST', '/admin/api/login', { email: `agent${DOMAIN}`, password: 'link agent password' }));

  console.log('\n[creating a payment link]');
  r = await call(hAdmin, 'POST', '/admin/api/billing/checkout', { plan: 'growth', provider: 'razorpay' });
  ok(r.statusCode === 403, 'only the owner can start a payment');
  r = await call(hO, 'POST', '/admin/api/billing/checkout', { plan: 'nope', provider: 'razorpay' });
  ok(r.statusCode === 400, 'an unknown plan is refused');
  r = await call(hO, 'POST', '/admin/api/billing/checkout', { plan: 'growth', provider: 'razorpay' });
  ok(r.statusCode === 200 && r.json().url === 'https://rzp.io/i/test1', 'the owner gets a hosted payment link');
  const created = apiCalls.at(-1)!;
  ok(created.url === 'https://api.razorpay.com/v1/payment_links' && created.auth === 'Basic ' + Buffer.from('rzp_test_key:rzp_test_secret').toString('base64'), 'it is created with the account keys');
  ok(created.body.amount === 299_900 && created.body.currency === 'INR' && created.body.accept_partial === false, 'amount is the plan price in paise, no part payment');
  ok(created.body.notes.workspaceId === wsId && created.body.notes.plan === 'growth', 'the business and plan travel with the link');
  ok(created.body.reference_id.length <= 40 && created.body.notify.email === false && created.body.reminder_enable === false, 'reference id fits Razorpay limits and Razorpay sends nothing itself');
  ok(created.body.callback_url === 'https://bot.example/admin/?billing=success', 'the customer returns to the dashboard afterwards');
  ok((await prisma.workspace.findUnique({ where: { id: wsId } }))!.plan === 'trial', 'creating a link changes nothing until it is paid');
  r = await call(hO, 'GET', '/admin/api/billing');
  ok(r.json().providers.razorpay === true, 'the dashboard offers the rupee payment');

  console.log('\n[the payment_link.paid webhook]');
  const hook = (id: string, event: string, payload: any, secret = 'whsec_rz') => {
    const raw = JSON.stringify({ event, payload });
    return app.inject({ method: 'POST', url: '/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex'), 'x-razorpay-event-id': id }, payload: raw });
  };
  const paid = (payId: string, plan: string, amount: number, workspaceId = wsId) => ({
    payment_link: { entity: { id: 'plink_1', notes: { workspaceId, plan }, amount_paid: amount } },
    payment: { entity: { id: payId, amount, currency: 'INR' } }
  });
  const row = () => prisma.workspace.findUniqueOrThrow({ where: { id: wsId } });

  ok((await hook('rzl_bad', 'payment_link.paid', paid('pay_x', 'growth', 299_900), 'wrong')).statusCode === 400, 'a webhook with a bad signature is rejected');
  ok((await row()).plan === 'trial', '...and changes nothing');
  ok((await hook('rzl_1', 'payment_link.paid', paid('pay_1', 'growth', 299_900))).statusCode === 200, 'a paid link is accepted');
  let w = await row();
  ok(w.plan === 'growth' && w.planStatus === 'active' && w.billingProvider === 'razorpay_link' && w.providerSubscriptionId === null, 'the plan is switched on, paid by link');
  ok(Math.abs(w.currentPeriodEnd!.getTime() - (Date.now() + 30 * DAY)) < 60_000 && accessState(w).active, 'for 30 days from now');
  ok((await prisma.payment.count({ where: { workspaceId: wsId, providerRef: 'pay_1', amount: 299_900, status: 'paid' } })) === 1, 'the payment is recorded');
  const end1 = w.currentPeriodEnd!.getTime();

  await hook('rzl_1', 'payment_link.paid', paid('pay_1', 'growth', 299_900));
  await hook('rzl_1b', 'payment_link.paid', paid('pay_1', 'growth', 299_900));
  ok((await row()).currentPeriodEnd!.getTime() === end1 && (await prisma.payment.count({ where: { workspaceId: wsId } })) === 1, 'Razorpay repeating an event, or the same payment, does not give extra days');

  await hook('rzl_2', 'payment_link.paid', paid('pay_2', 'growth', 299_900));
  ok(Math.abs((await row()).currentPeriodEnd!.getTime() - (end1 + 30 * DAY)) < 1000, 'paying again for the same plan before it ends adds 30 more days');

  await hook('rzl_3', 'payment_link.paid', paid('pay_3', 'scale', 10_000));
  w = await row();
  ok(w.plan === 'growth' && (await prisma.payment.count({ where: { workspaceId: wsId, providerRef: 'pay_3' } })) === 1, 'an underpayment is recorded but does not switch a plan on');

  await hook('rzl_4', 'payment_link.paid', paid('pay_4', 'starter', 99_900));
  w = await row();
  ok(w.plan === 'starter' && Math.abs(w.currentPeriodEnd!.getTime() - (Date.now() + 30 * DAY)) < 60_000, 'a different plan starts now for 30 days');

  ok((await hook('rzl_5', 'payment_link.paid', paid('pay_5', 'growth', 299_900, 'no-such-workspace'))).body === 'ignored', 'a link for an unknown business is ignored');
  ok((await hook('rzl_6', 'payment_link.paid', paid('pay_6', 'platinum', 299_900))).body === 'ignored', 'a link for an unknown plan is ignored');
  await prisma.workspace.update({ where: { id: wsId }, data: { plan: 'internal' } });
  ok((await hook('rzl_7', 'payment_link.paid', paid('pay_7', 'growth', 299_900))).body === 'ignored' && (await row()).plan === 'internal', 'the unbilled internal business cannot be changed by a payment');
  await prisma.workspace.update({ where: { id: wsId }, data: { plan: 'starter' } });

  console.log('\n[owner experience]');
  r = await call(hO, 'GET', '/admin/api/billing');
  ok(r.json().provider === 'razorpay_link' && r.json().status === 'active', 'the billing card reports a link-paid plan');
  r = await call(hO, 'POST', '/admin/api/billing/cancel');
  ok(r.statusCode === 400 && /nothing to cancel/.test(r.json().error), 'cancel explains there is nothing to cancel');
  ok((await call(hO, 'POST', '/admin/api/billing/checkout', { plan: 'starter', provider: 'razorpay' })).statusCode === 200, 'the owner can renew at any time');
  await prisma.workspace.update({ where: { id: wsId }, data: { providerSubscriptionId: 'sub_card', billingProvider: 'stripe' } });
  r = await call(hO, 'POST', '/admin/api/billing/checkout', { plan: 'growth', provider: 'razorpay' });
  ok(r.statusCode === 400 && /active subscription/.test(r.json().error), 'a business with a card subscription is not sold a second plan by link');
  await prisma.workspace.update({ where: { id: wsId }, data: { providerSubscriptionId: null, billingProvider: 'razorpay_link' } });

  console.log('\n[renewal reminders]');
  const sent: string[] = [];
  setTransport(wsId, { sendText: async (_to, text) => void sent.push(text), ready: () => true });
  await prisma.workspace.update({ where: { id: wsId }, data: { notifyPhone: '919000000001', currentPeriodEnd: new Date(Date.now() + 10 * DAY) } });
  ok((await renewalTick()) === 0, 'a plan with many days left gets no reminder');
  await prisma.workspace.update({ where: { id: wsId }, data: { currentPeriodEnd: new Date(Date.now() + 2 * DAY) } });
  const before = linkSeq;
  ok((await renewalTick()) === 1 && linkSeq === before + 1, 'three days before the end a fresh link is created and sent');
  const msg = sent.find((t) => t.includes('plan ends'))!;
  ok(!!msg && /https:\/\/rzp\.io\/i\/test\d+/.test(msg) && msg.includes('₹999'), 'the alert carries the link and the price');
  ok((await renewalTick()) === 0 && linkSeq === before + 1, 'only one reminder per period');
  const lastLink = apiCalls.at(-1)!;
  ok(lastLink.body.notes.plan === 'starter' && lastLink.body.amount === 99_900, 'the reminder link is for the plan they are on');

  console.log('\n[referral commission on link payments]');
  await setSetting('affiliate', { enabled: true, percent: 20, months: 12, bonusDays: 0 });
  const referrer = (await prisma.workspace.findUniqueOrThrow({ where: { id: wsId } }));
  r = await call(J, 'POST', '/admin/api/signup', { businessName: 'Referred Link Co', email: `ref${DOMAIN}`, password: 'referred link password', ref: (await call(hO, 'GET', '/admin/api/referral')).json().code });
  const refId = r.json().user.workspace.id as string;
  ok((await prisma.workspace.findUniqueOrThrow({ where: { id: refId } })).referredById === referrer.id, 'a referred business signs up');
  await hook('rzl_8', 'payment_link.paid', paid('pay_8', 'growth', 299_900, refId));
  const c = await prisma.affiliateCommission.findFirst({ where: { affiliateId: wsId } });
  ok(!!c && c.amount === 59_980 && c.status === 'pending', 'the referrer earns their share when the referred business pays by link');
  await setSetting('affiliate', {});

  console.log('\n[redeem codes next to link payments]');
  await prisma.coupon.create({ data: { code: 'RZLINK01', plan: 'trial', days: 5, note: 'rzl' } });
  r = await call(hO, 'POST', '/admin/api/billing/redeem', { code: 'RZLINK01' });
  ok(r.statusCode === 400 && /active plan/.test(r.json().error) && (await row()).plan === 'starter', 'a code cannot overwrite a plan that is running');
  await prisma.workspace.update({ where: { id: wsId }, data: { currentPeriodEnd: new Date(Date.now() - DAY) } });
  ok((await call(hO, 'POST', '/admin/api/billing/redeem', { code: 'RZLINK01' })).statusCode === 200, 'once the paid period has ended a code can be used');
  await prisma.coupon.deleteMany({ where: { note: 'rzl' } });

  setTransport(wsId, null);
  await cleanup();
  globalThis.fetch = realFetch;
  console.log('\nRAZORPAY LINK TESTS OK');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  globalThis.fetch = realFetch;
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
