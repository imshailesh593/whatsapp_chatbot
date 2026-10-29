// Payments without a gateway API: operator pay links/instructions, owner payment references, operator approval,
// Razorpay webhook auto-confirmation (by reference or payer email), and renewal reminders.
// Usage: npx tsx scripts/manual-pay-test.ts   (needs DATABASE_URL)
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'testtoken';
process.env.ADMIN_EMAIL = '';
process.env.GEMINI_API_KEY = '';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_manual';
delete process.env.RAZORPAY_MODE;
import crypto from 'crypto';
import Fastify from 'fastify';
import { registerAdmin } from '../src/admin';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/auth';
import { providersAvailable, renewalTick } from '../src/services/billing';
import { setTransport } from '../src/services/transport';
import { setSetting } from '../src/services/settings';
import { accessState } from '../src/plans';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const DOMAIN = '@manualpay-test.local';
const DAY = 86_400_000;

async function cleanup() {
  await prisma.billingEvent.deleteMany({ where: { id: { startsWith: 'razorpay:mp_' } } });
  await prisma.billingEvent.deleteMany({ where: { id: { startsWith: 'renewal:' } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actor: { endsWith: DOMAIN } }, { action: 'payment.unmatched', detail: { contains: 'pay_mp' } }] } });
  await prisma.workspace.deleteMany({ where: { adminUsers: { some: { email: { endsWith: DOMAIN } } } } });
  await prisma.adminUser.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

(async () => {
  await cleanup();
  await setSetting('payInfo', {});
  await setSetting('affiliate', {});
  const app = Fastify();
  registerAdmin(app, { getQr: async () => null });
  const J = { 'content-type': 'application/json' };
  const call = (h: any, method: any, url: string, payload?: any) => app.inject({ method, url, headers: h, payload });
  const cookieOf = (r: any) => ({ cookie: String(r.headers['set-cookie']).split(';')[0], ...J });
  const login = async (email: string, password: string) => cookieOf(await call(J, 'POST', '/admin/api/login', { email, password }));

  // an operator (platform admin) and a business with an owner and an admin
  const opWs = await prisma.workspace.create({ data: { slug: `mp-op-${Date.now().toString(36)}`, name: 'Ops', businessName: 'Ops', plan: 'internal', planStatus: 'active', onboardingCompleted: true } });
  await prisma.adminUser.create({ data: { email: `op${DOMAIN}`, passwordHash: await hashPassword('operator password 1'), role: 'owner', isSuperAdmin: true, workspaceId: opWs.id } });
  const hOp = await login(`op${DOMAIN}`, 'operator password 1');
  let r = await call(J, 'POST', '/admin/api/signup', { businessName: 'Manual Pay Co', email: `owner${DOMAIN}`, password: 'manual owner password' });
  const hO = cookieOf(r);
  const wsId = r.json().user.workspace.id as string;
  await call(hO, 'POST', '/admin/api/admins', { email: `adm${DOMAIN}`, password: 'manual admin password', role: 'admin' });
  const hAdm = await login(`adm${DOMAIN}`, 'manual admin password');
  const row = () => prisma.workspace.findUniqueOrThrow({ where: { id: wsId } });

  console.log('[operator pay settings]');
  ok(providersAvailable().razorpay === false, 'no Razorpay API keys: the API route is off');
  ok((await call(hO, 'GET', '/admin/api/super/pay-info')).statusCode === 403 && (await call(hO, 'PUT', '/admin/api/super/pay-info', {})).statusCode === 403, 'a business cannot read or change the operator pay settings');
  ok((await call(hOp, 'PUT', '/admin/api/super/pay-info', { links: { growth: 'http://pay.example/g' } })).statusCode === 400, 'a pay link must be https');
  ok((await call(hOp, 'PUT', '/admin/api/super/pay-info', { links: { growth: 'not a url' } })).statusCode === 400, 'a pay link must be a web address');
  r = await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'growth', reference: 'UTR123456789' });
  ok(r.statusCode === 400 && /not set up/.test(r.json().error), 'before the operator sets it up, nothing can be submitted');
  r = await call(hOp, 'PUT', '/admin/api/super/pay-info', { links: { starter: 'https://rzp.io/l/starter', growth: 'https://rzp.io/l/growth', bogus: 'https://x.example' }, instructions: 'UPI: pay@bank\nAfter paying, paste the reference.' });
  ok(r.statusCode === 200 && r.json().links.growth === 'https://rzp.io/l/growth' && !r.json().links.bogus && !r.json().links.scale, 'pay links and instructions are saved (unknown plans dropped)');
  r = await call(hO, 'GET', '/admin/api/billing');
  ok(r.json().pay.enabled && r.json().pay.links.starter === 'https://rzp.io/l/starter' && /UPI/.test(r.json().pay.instructions), 'owners see the pay links and instructions in Plan & billing');

  console.log('\n[the owner submits a payment reference]');
  const alerts: string[] = [];
  const dflt = await prisma.workspace.findUnique({ where: { id: 'default-workspace' } });
  if (dflt) {
    await prisma.workspace.update({ where: { id: 'default-workspace' }, data: { notifyPhone: '919000000099' } });
    setTransport('default-workspace', { sendText: async (_to, t) => void alerts.push(t), ready: () => true });
  }
  ok((await call(hAdm, 'POST', '/admin/api/billing/claim', { plan: 'growth', reference: 'UTR123456789' })).statusCode === 403, 'only the owner can submit a payment');
  ok((await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'platinum', reference: 'UTR123456789' })).statusCode === 400, 'an unknown plan is refused');
  ok((await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'growth', reference: 'x' })).statusCode === 400, 'a too-short reference is refused');
  ok((await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'growth', reference: '<script>alert(1)</script>' })).statusCode === 400, 'a reference with odd characters is refused');
  ok((await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'growth', reference: 'UTR123456789' })).statusCode === 200, 'the owner submits the reference');
  await new Promise((r2) => setTimeout(r2, 300));
  if (dflt) ok(alerts.some((t) => t.includes('Payment to confirm') && t.includes('Manual Pay Co') && t.includes('UTR123456789')), 'the operator is alerted with business, plan and reference');
  ok((await row()).plan === 'trial', 'submitting a reference changes nothing by itself');
  ok((await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'growth', reference: 'UTR123456789' })).statusCode === 400, 'the same reference cannot be submitted twice');
  await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'starter', reference: 'UTR-second-1' });
  await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'starter', reference: 'UTR-third-33' });
  r = await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'starter', reference: 'UTR-fourth-44' });
  ok(r.statusCode === 400 && /waiting to be confirmed/.test(r.json().error), 'no more than three payments can wait at once');
  r = await call(hO, 'GET', '/admin/api/billing');
  ok(r.json().payments.filter((p: any) => p.status === 'pending').length === 3, 'the owner sees their payments as waiting');

  console.log('\n[the operator confirms]');
  r = await call(hOp, 'GET', '/admin/api/super/payments');
  const pend = r.json().payments.filter((p: any) => p.business === 'Manual Pay Co' && p.status === 'pending');
  const growthClaim = pend.find((p: any) => p.ref === 'UTR123456789');
  ok(pend.length === 3 && growthClaim.provider === 'manual' && growthClaim.amount === 299_900 && growthClaim.plan === 'growth', 'pending payments are listed with their reference, plan and price');
  ok((await call(hO, 'POST', `/admin/api/super/payments/${growthClaim.id}/approve`)).statusCode === 403, 'a business cannot approve payments');
  ok((await call(hOp, 'POST', `/admin/api/super/payments/${growthClaim.id}/bogus`)).statusCode === 404, 'unknown actions are refused');
  await setSetting('affiliate', { enabled: true, percent: 20, months: 12, bonusDays: 0 });
  // make the business a referred one to check the commission
  const referrer = await prisma.workspace.create({ data: { slug: `mp-ref-${Date.now().toString(36)}`, name: 'Referrer', businessName: 'Referrer', botEnabled: false, onboardingCompleted: true } });
  await prisma.adminUser.create({ data: { email: `referrer${DOMAIN}`, passwordHash: await hashPassword('referrer password 1'), role: 'owner', workspaceId: referrer.id } });
  await prisma.workspace.update({ where: { id: wsId }, data: { referredById: referrer.id } });
  ok((await call(hOp, 'POST', `/admin/api/super/payments/${growthClaim.id}/approve`)).statusCode === 200, 'the operator approves');
  let w = await row();
  ok(w.plan === 'growth' && w.planStatus === 'active' && w.billingProvider === 'manual_pay' && accessState(w).active && Math.abs(w.currentPeriodEnd!.getTime() - (Date.now() + 30 * DAY)) < 60_000, 'the plan switches on for 30 days');
  ok((await prisma.payment.findUnique({ where: { id: growthClaim.id } }))!.status === 'paid', 'the payment becomes paid');
  const com = await prisma.affiliateCommission.findFirst({ where: { affiliateId: referrer.id } });
  ok(!!com && com.amount === 59_980, 'the referrer earns their commission');
  ok((await call(hOp, 'POST', `/admin/api/super/payments/${growthClaim.id}/approve`)).statusCode === 400, 'approving twice is refused (no extra days)');
  const rej = pend.find((p: any) => p.ref === 'UTR-second-1');
  ok((await call(hOp, 'POST', `/admin/api/super/payments/${rej.id}/reject`)).statusCode === 200 && (await prisma.payment.findUnique({ where: { id: rej.id } }))!.status === 'rejected', 'the operator can reject a payment');
  ok((await call(hOp, 'POST', `/admin/api/super/payments/${rej.id}/approve`)).statusCode === 400 && (await row()).plan === 'growth', 'a rejected payment cannot be approved later');
  r = await call(hO, 'POST', '/admin/api/billing/cancel');
  ok(r.statusCode === 400 && /nothing to cancel/.test(r.json().error), 'there is nothing to cancel on a plan paid by reference');
  await prisma.coupon.create({ data: { code: 'MPCODE01', plan: 'trial', days: 5, note: 'mp' } });
  r = await call(hO, 'POST', '/admin/api/billing/redeem', { code: 'MPCODE01' });
  ok(r.statusCode === 400 && /active plan/.test(r.json().error) && (await row()).plan === 'growth', 'a redeem code cannot overwrite the plan that was just paid for');
  await prisma.coupon.deleteMany({ where: { note: 'mp' } });

  console.log('\n[Razorpay webhook without API keys]');
  const hook = (id: string, payload: any, secret = 'whsec_manual') => {
    const raw = JSON.stringify({ event: 'payment_link.paid', payload });
    return app.inject({ method: 'POST', url: '/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex'), 'x-razorpay-event-id': id }, payload: raw });
  };
  const paid = (payId: string, amount: number, email?: string) => ({ payment_link: { entity: { id: 'plink_dash', notes: {}, amount_paid: amount } }, payment: { entity: { id: payId, amount, currency: 'INR', email } } });
  await prisma.workspace.update({ where: { id: wsId }, data: { plan: 'trial', planStatus: 'trialing', currentPeriodEnd: null, billingProvider: null } });
  await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'growth', reference: 'pay_mpAbC12345' });
  ok((await hook('mp_1', paid('pay_mpabc12345', 299_900), 'wrong')).statusCode === 400, 'a webhook with a bad signature is rejected');
  ok((await hook('mp_1', paid('pay_mpabc12345', 299_900))).body === 'ok', 'a webhook for a submitted reference confirms it (case-insensitive)');
  w = await row();
  ok(w.plan === 'growth' && w.planStatus === 'active' && (await prisma.payment.count({ where: { workspaceId: wsId, providerRef: 'pay_mpAbC12345', status: 'paid', provider: 'manual' } })) === 1, 'the plan is on and the submitted payment is marked paid, not duplicated');
  const end = w.currentPeriodEnd!.getTime();
  await hook('mp_1', paid('pay_mpabc12345', 299_900));
  await hook('mp_1b', paid('pay_mpabc12345', 299_900));
  ok((await row()).currentPeriodEnd!.getTime() === end, 'the same payment arriving again adds no days');

  await prisma.workspace.update({ where: { id: wsId }, data: { plan: 'trial', planStatus: 'trialing', currentPeriodEnd: null } });
  await call(hO, 'POST', '/admin/api/billing/claim', { plan: 'scale', reference: 'pay_mpShort01' });
  await hook('mp_2', paid('pay_mpShort01', 100_000));
  ok((await row()).plan === 'trial' && (await prisma.payment.findFirst({ where: { providerRef: 'pay_mpShort01' } }))!.status === 'pending', 'a payment for less than the plan price leaves the submission waiting for the operator');

  ok((await hook('mp_3', paid('pay_mpEmail01', 299_900, `OWNER${DOMAIN}`))).body === 'ok', 'a payment with no reference is matched by the payer email and the exact plan price');
  w = await row();
  ok(w.plan === 'growth' && w.planStatus === 'active', '...and switches that business on');
  ok((await hook('mp_4', paid('pay_mpNobody1', 299_900, 'stranger@example.com'))).body === 'unmatched', 'a payment from an unknown payer is not applied');
  ok(!!(await prisma.auditLog.findFirst({ where: { action: 'payment.unmatched', detail: { contains: 'pay_mpNobody1' } } })), '...and is written to the audit log for the operator');
  ok((await hook('mp_5', paid('pay_mpOdd0001', 123_456, `owner${DOMAIN}`))).body === 'unmatched', 'an amount that matches no plan is not guessed at');

  console.log('\n[renewal reminders for manual payers]');
  const sent: string[] = [];
  setTransport(wsId, { sendText: async (_to, t) => void sent.push(t), ready: () => true });
  await prisma.workspace.update({ where: { id: wsId }, data: { billingProvider: 'manual_pay', notifyPhone: '919000000001', currentPeriodEnd: new Date(Date.now() + 2 * DAY) } });
  ok((await renewalTick()) === 1, 'three days before the end a reminder goes out');
  const msg = sent.find((t) => t.includes('plan ends'))!;
  ok(!!msg && msg.includes('https://rzp.io/l/growth') && msg.includes('payment reference'), 'it carries the operator pay link and says to submit the reference');
  ok((await renewalTick()) === 0, 'once per period');

  setTransport(wsId, null);
  if (dflt) {
    setTransport('default-workspace', null);
    await prisma.workspace.update({ where: { id: 'default-workspace' }, data: { notifyPhone: dflt.notifyPhone } });
  }
  await setSetting('payInfo', {});
  await setSetting('affiliate', {});
  await prisma.workspace.deleteMany({ where: { id: { in: [opWs.id, referrer.id] } } });
  await cleanup();
  console.log('\nMANUAL PAYMENT TESTS OK');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  try {
    await setSetting('payInfo', {});
    await setSetting('affiliate', {});
    await cleanup();
  } catch { /* best effort */ }
  await prisma.$disconnect();
  process.exit(1);
});
