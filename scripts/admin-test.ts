// Exercises the dashboard API (multi-tenant) via Fastify inject() against the real DB (no WhatsApp).
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'testtoken';
process.env.ADMIN_EMAIL = '';
process.env.GEMINI_API_KEY = '';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_test';
process.env.STRIPE_SECRET_KEY = '';
process.env.RAZORPAY_KEY_ID = ''; // onboarding assistant must degrade gracefully
import crypto from 'crypto';
import Fastify from 'fastify';
import { accessState } from '../src/plans';
import { invalidateConfig } from '../src/services/botConfig';
import { registerAdmin } from '../src/admin';
import { setTransport } from '../src/services/transport';
import { waFor } from '../src/services/whatsapp';
import { prisma } from '../src/lib/prisma';
import { handleIncomingMessage } from '../src/services/engine';
import { parseDraft } from '../src/services/onboarding';
import { hashPassword } from '../src/lib/auth';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const sent: string[] = [];
const DOMAIN = '@admin-test.local';

async function cleanup() {
  await prisma.billingEvent.deleteMany({ where: { OR: [{ id: { startsWith: 'stripe:evt_' } }, { id: { startsWith: 'razorpay:rz_' } }] } });
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
  const login = (email: string, password: string) => call(J, 'POST', '/admin/api/login', { email, password });

  let r = await app.inject('/admin/api/contacts');
  ok(r.statusCode === 401, 'API requires login');
  ok((await app.inject('/admin/api/brand')).json().productName, 'public brand endpoint (no company hard-coded)');

  // ---- sign-up creates an isolated workspace ----
  ok((await call(J, 'POST', '/admin/api/signup', { businessName: '', email: `a${DOMAIN}`, password: 'long enough pw' })).statusCode === 400, 'sign-up needs a business name');
  ok((await call(J, 'POST', '/admin/api/signup', { businessName: 'Acme', email: 'bad', password: 'long enough pw' })).statusCode === 400, 'sign-up needs a valid email');
  ok((await call(J, 'POST', '/admin/api/signup', { businessName: 'Acme', email: `a${DOMAIN}`, password: 'short' })).statusCode === 400, 'sign-up needs a long password');
  r = await call(J, 'POST', '/admin/api/signup', { businessName: 'Acme Test', email: `A${DOMAIN}`, password: 'acme owner password' });
  ok(r.statusCode === 200 && r.json().user.role === 'owner' && r.json().user.workspace.onboardingCompleted === false && r.json().user.workspace.botEnabled === false, 'sign-up: owner of a new workspace, onboarding pending, bot off');
  const hA = cookieOf(r);
  const wsA = r.json().user.workspace.id as string;
  ok((await call(J, 'POST', '/admin/api/signup', { businessName: 'Dup', email: `a${DOMAIN}`, password: 'acme owner password' })).statusCode === 409, 'duplicate email refused');
  r = await call(J, 'POST', '/admin/api/signup', { businessName: 'Bravo Test', email: `b${DOMAIN}`, password: 'bravo owner password' });
  const hB = cookieOf(r);
  const wsB = r.json().user.workspace.id as string;

  ok((await login(`a${DOMAIN}`, 'wrong password!!')).statusCode === 401, 'wrong password rejected');
  ok((await login(`nobody${DOMAIN}`, 'acme owner password')).statusCode === 401, 'unknown email rejected');
  ok((await call(J, 'GET', '/admin/api/contacts')).statusCode === 401 && (await app.inject({ url: '/admin/api/contacts', headers: { cookie: 'mns_admin=forged.value' } })).statusCode === 401, 'forged / missing cookie rejected');
  ok((await call(hA, 'GET', '/admin/api/me')).json().user.email === `a${DOMAIN}`, '/me returns the signed-in user');

  // ---- onboarding ----
  r = await call(hA, 'GET', '/admin/api/onboarding');
  ok(r.json().aiAvailable === false && r.json().completed === false, 'onboarding status (AI off in this test)');
  ok((await call(hA, 'POST', '/admin/api/onboarding/chat', { history: [{ role: 'user', text: 'hi' }] })).statusCode === 503, 'assistant unavailable -> 503 so the UI can fall back to templates');
  r = await call(hA, 'GET', '/admin/api/templates');
  ok(r.json().templates.length >= 4, 'templates listed');
  r = await call(hA, 'POST', '/admin/api/templates/apply', { id: 'clinic' });
  ok(r.json().workspace.industry === 'clinic', 'template applied');
  r = await call(hA, 'GET', '/admin/api/overview');
  ok(r.json().services.length === 2 && r.json().services[0].title === 'Book an appointment', 'overview shows the template services');
  ok(!parseDraft({ services: [] }) && !!parseDraft({ businessName: 'X', services: [{ title: 'S', questions: [{ prompt: 'Q?' }] }] }), 'draft parser rejects empty drafts, accepts valid ones');
  r = await call(hA, 'POST', '/admin/api/onboarding/apply', {
    draft: { industry: 'dental', businessName: 'Acme Dental', tagline: 'Smile', description: 'A dental clinic', welcomeIntro: 'We look after your smile.', tone: 'friendly', languages: 'English', bookingLabel: 'check-up', bookingNote: '', knowledge: 'Open Mon-Sat 9-6.',
      services: [{ title: 'Check-up', keywords: ['checkup', 'cleaning'], questions: [{ key: 'name', prompt: 'Your name?' }, { prompt: 'Preferred day?' }] }, { title: 'Braces', keywords: ['braces'], questions: [{ prompt: 'Age?' }] }] },
    extras: { bookingUrl: 'cal.example/acme' }
  });
  ok(r.statusCode === 200 && r.json().workspace.onboardingCompleted && r.json().workspace.businessName === 'Acme Dental' && r.json().workspace.bookingUrl === 'https://cal.example/acme', 'assistant draft applied (business, services, https-normalised link, onboarding done)');
  ok((await call(hA, 'POST', '/admin/api/onboarding/apply', { draft: { services: [] } })).statusCode === 400, 'incomplete draft refused');

  // ---- bot builder + settings ----
  ok((await call(hA, 'PUT', '/admin/api/services', { services: [] })).statusCode === 400, 'builder refuses an empty menu');
  r = await call(hA, 'PUT', '/admin/api/services', { services: [{ title: 'Check-up', keywords: ['checkup'], questions: [{ key: 'name', prompt: 'Your name?' }, { key: 'day', prompt: 'Preferred day?' }] }, { title: 'Braces', keywords: ['braces'], questions: [{ key: 'age', prompt: 'Age?' }] }] });
  ok(r.statusCode === 200 && r.json().services.length === 2, 'builder saves the menu');
  ok((await call(hA, 'PUT', '/admin/api/workspace', { formUrl: 'not a url at all %%' })).statusCode === 400, 'bad form URL refused');
  r = await call(hA, 'PUT', '/admin/api/workspace', { tagline: 'Healthy teeth', businessName: 'Acme Dental' });
  ok(r.json().workspace.tagline === 'Healthy teeth', 'settings saved');
  ok((await call(hA, 'PUT', '/admin/api/workspace', { businessName: '  ' })).statusCode === 400, 'empty business name refused');

  // ---- simulator drives the REAL engine, per workspace ----
  const sim = async (h: any, text: string) => (await call(h, 'POST', '/admin/api/simulate', { id: 'tst', name: 'Sim <b>', text })).json();
  await call(hA, 'POST', '/admin/api/simulate/reset', { id: 'tst' });
  let o = await sim(hA, 'hi');
  ok(o.replies[0].includes('Welcome to Acme Dental') && o.replies[0].includes('1️⃣ Check-up') && o.replies[0].includes('2️⃣ Braces'), 'simulator: welcome + menu from this workspace');
  o = await sim(hA, 'braces please');
  ok(o.replies[0] === 'Age?' && o.state.totalSteps === 1, 'simulator: keyword picks the service');
  o = await sim(hA, '34');
  ok(o.replies[0].includes('https://cal.example/acme') && o.replies[0].includes('Acme Dental | Healthy teeth'), 'simulator: completion with booking link + sign-off');
  ok(sent.length === 0, 'simulator delivered nothing to WhatsApp');

  // ---- isolation between tenants ----
  r = await call(hB, 'GET', '/admin/api/contacts?test=1');
  ok(r.json().contacts.length === 0, "tenant B cannot see tenant A's contacts");
  ok((await call(hB, 'PATCH', '/admin/api/contacts/SIM-tst', { paused: true })).statusCode === 404, "tenant B cannot modify tenant A's contact");
  ok((await call(hB, 'GET', '/admin/api/contacts/SIM-tst/messages')).json().messages.length === 0, "tenant B cannot read tenant A's messages");
  await call(hB, 'POST', '/admin/api/templates/apply', { id: 'generic' });
  o = await sim(hB, 'hi');
  ok(o.replies[0].includes('Welcome to Bravo Test'), 'tenant B has its own bot');
  ok((await call(hA, 'GET', '/admin/api/admins')).json().admins.length === 1, 'team list is per workspace');
  ok((await call(hA, 'GET', '/admin/api/super/workspaces')).statusCode === 403, 'tenants cannot use platform admin endpoints');

  // ---- roles ----
  ok((await call(hA, 'POST', '/admin/api/admins', { email: `agent${DOMAIN}`, password: 'agent password 1', role: 'agent' })).statusCode === 200, 'owner adds an agent');
  const agent = await login(`agent${DOMAIN}`, 'agent password 1');
  const hAg = cookieOf(agent);
  ok(agent.json().user.role === 'agent', 'agent signs in');
  ok((await call(hAg, 'GET', '/admin/api/contacts')).statusCode === 200, 'agent can work leads');
  ok((await call(hAg, 'PUT', '/admin/api/workspace', { tagline: 'hack' })).statusCode === 403 && (await call(hAg, 'PUT', '/admin/api/services', { services: [] })).statusCode === 403, 'agent cannot change settings or the bot');
  ok((await call(hAg, 'POST', '/admin/api/whatsapp/disconnect')).statusCode === 403 && (await call(hAg, 'POST', '/admin/api/admins', { email: `x${DOMAIN}`, password: 'agent password 1' })).statusCode === 403, 'agent cannot unlink WhatsApp or add users');
  const agentId = (await prisma.adminUser.findUnique({ where: { email: `agent${DOMAIN}` } }))!.id;
  ok((await call(hB, 'DELETE', '/admin/api/admins/' + agentId)).statusCode === 404, "tenant B cannot remove tenant A's user");
  ok((await call(hA, 'DELETE', '/admin/api/admins/' + agentId)).statusCode === 200 && (await call(hAg, 'GET', '/admin/api/contacts')).statusCode === 401, 'removed user loses access immediately');
  const ownerId = (await prisma.adminUser.findUnique({ where: { email: `a${DOMAIN}` } }))!.id;
  ok((await call(hA, 'DELETE', '/admin/api/admins/' + ownerId)).statusCode === 400, 'cannot remove yourself');
  r = await call(hA, 'POST', '/admin/api/password', { current: 'nope nope nope', next: 'brand new password' });
  ok(r.statusCode === 403, 'password change needs the current password');
  r = await call(hA, 'POST', '/admin/api/password', { current: 'acme owner password', next: 'brand new password' });
  ok(r.statusCode === 200 && (await login(`a${DOMAIN}`, 'brand new password')).statusCode === 200, 'password change works');

  // ---- contacts, status, human takeover ----
  r = await call(hA, 'GET', '/admin/api/contacts');
  ok(!r.json().contacts.some((c: any) => c.phone.startsWith('SIM-')), 'test contacts hidden by default');
  r = await call(hA, 'GET', '/admin/api/contacts?test=1');
  const c = r.json().contacts.find((x: any) => x.phone === 'SIM-tst');
  ok(c && c.status === 'COMPLETED' && c.hasLead && c.progress === 100 && c.isTest && c.serviceTitle === 'Braces' && c.answers.age === '34', 'test contact listed as a completed lead with service title + answers');
  const patch = (payload: any) => call(hA, 'PATCH', '/admin/api/contacts/SIM-tst', payload);
  r = await patch({ status: 'CONSULTATION_BOOKED', notes: '=1+1 call back' });
  ok(r.json().contact.status === 'CONSULTATION_BOOKED' && r.json().contact.notes === '=1+1 call back', 'status + notes saved');
  ok((await patch({ status: 'FOLLOW_UP' })).json().contact.status === 'FOLLOW_UP', 'follow-up status');
  ok((await patch({ paused: true })).json().contact.botActive === false, 'bot paused');
  o = await sim(hA, 'anyone there?');
  ok(o.replies.length === 0, 'paused simulator session gets no reply');
  ok((await patch({ paused: false })).json().contact.botActive === true, 'bot resumed');

  const send = (phone: string, text: string) => call(hA, 'POST', `/admin/api/contacts/${phone}/send`, { text });
  ok((await send('SIM-tst', 'hello')).statusCode === 400, 'cannot message simulator contacts');
  const real = await prisma.session.create({ data: { workspaceId: wsA, phoneNumber: '910000000009', contactName: 'Real' } });
  ok((await send('910000000009', 'hi')).statusCode === 409, 'cannot reply while bot is active');
  await prisma.session.update({ where: { id: real.id }, data: { isAgentPaused: true } });
  // deliver through a fake link for this workspace
  const link = waFor(wsA);
  setTransport(wsA, { sendText: async (_to, text) => void sent.push(text) });
  await prisma.workspace.update({ where: { id: wsA }, data: { botEnabled: true } });
  await call(hA, 'POST', '/admin/api/workspace/live', { enabled: true });
  const n0 = sent.length;
  await handleIncomingMessage(wsA, '910000000009', 'Real', 'hello bot');
  ok(sent.length === n0, 'real paused chat gets no bot reply');
  r = await call(hA, 'GET', '/admin/api/contacts/910000000009/messages');
  ok(r.json().messages.some((m: any) => m.direction === 'INBOUND' && m.text === 'hello bot'), 'inbound message logged for thread view');
  ok((await send('910000000009', 'hi')).statusCode === 503, 'cannot reply when WhatsApp is not connected');
  link.status = 'ready';
  ok((await send('910000000009', 'Hello from the team')).statusCode === 200 && sent.at(-1) === 'Hello from the team', 'human reply delivered when paused');
  link.status = 'off';
  r = await call(hA, 'GET', '/admin/api/contacts/910000000009/messages');
  ok(r.json().messages.at(-1).direction === 'OUTBOUND', 'human reply logged as outbound');
  ok((await call(hA, 'PATCH', '/admin/api/contacts/910000000009', { notes: 'x' })).statusCode === 409, 'notes refused before the questionnaire is complete');

  // ---- go live / pause ----
  r = await call(hB, 'POST', '/admin/api/workspace/live', { enabled: true });
  ok(r.json().workspace.botEnabled === true, 'owner can go live');

  // ---- CSV ----
  await prisma.session.update({ where: { workspaceId_phoneNumber: { workspaceId: wsA, phoneNumber: 'SIM-tst' } }, data: { contactName: '=cmd' } });
  r = await call(hA, 'GET', '/admin/api/export.csv');
  ok(r.headers['content-type']?.toString().startsWith('text/csv') && !r.body.includes('SIM-tst'), 'CSV excludes simulator contacts');
  ok((await app.inject('/admin/api/export.csv')).statusCode === 401, 'CSV requires login');

  // ---- billing ----
  r = await call(hA, 'GET', '/admin/api/billing');
  ok(r.json().plan === 'trial' && r.json().status === 'trialing' && r.json().active && r.json().limits.conversations === 1500 && r.json().providers.stripe === false, 'billing: new workspace is on a 14-day trial with Growth limits, no providers configured');
  ok(r.json().plans.length === 3 && !!r.json().trialEndsAt, 'billing: plans and trial end listed');
  ok((await call(hA, 'POST', '/admin/api/billing/checkout', { plan: 'growth', provider: 'stripe' })).statusCode === 400, 'checkout refused while the provider is not configured');
  await call(hA, 'POST', '/admin/api/admins', { email: `agent2${DOMAIN}`, password: 'agent password 2', role: 'agent' });
  const hAg2 = cookieOf(await login(`agent2${DOMAIN}`, 'agent password 2'));
  ok((await call(hAg2, 'GET', '/admin/api/billing')).statusCode === 200 && (await call(hAg2, 'POST', '/admin/api/billing/checkout', { plan: 'growth', provider: 'stripe' })).statusCode === 403, 'only the owner can start checkout');
  ok((await call(hAg2, 'POST', '/admin/api/billing/cancel')).statusCode === 403, 'only the owner can cancel');

  const stripeEvent = (id: string, type: string, object: any, secret = 'whsec_test', ts = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify({ id, type, data: { object } });
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
    return app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` }, payload: raw });
  };
  const wsRow = () => prisma.workspace.findUniqueOrThrow({ where: { id: wsA } });
  const future = Math.floor(Date.now() / 1000) + 30 * 86400;
  ok((await stripeEvent('evt_bad', 'invoice.paid', {}, 'wrong-secret')).statusCode === 400, 'stripe webhook: bad signature rejected');
  ok((await stripeEvent('evt_old', 'invoice.paid', {}, 'whsec_test', Math.floor(Date.now() / 1000) - 3600)).statusCode === 400, 'stripe webhook: stale timestamp rejected');
  ok((await stripeEvent('evt_1', 'checkout.session.completed', { client_reference_id: wsA, customer: 'cus_1', subscription: 'sub_1', metadata: {} })).statusCode === 200, 'stripe: checkout completed');
  ok((await wsRow()).providerSubscriptionId === 'sub_1' && (await wsRow()).planStatus === 'active', 'stripe: subscription linked, workspace active');
  await stripeEvent('evt_2', 'customer.subscription.updated', { object: 'subscription', id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { workspaceId: wsA, plan: 'starter' }, current_period_end: future, cancel_at_period_end: false });
  let w = await wsRow();
  ok(w.plan === 'starter' && w.planStatus === 'active' && Math.abs(w.currentPeriodEnd!.getTime() / 1000 - future) < 2, 'stripe: plan + period end applied');
  ok((await stripeEvent('evt_2', 'customer.subscription.updated', { object: 'subscription', id: 'sub_1', metadata: { workspaceId: wsA, plan: 'scale' } })).body === 'duplicate' && (await wsRow()).plan === 'starter', 'stripe: replayed event is ignored');
  await stripeEvent('evt_3', 'invoice.paid', { id: 'in_1', subscription: 'sub_1', customer: 'cus_1', amount_paid: 99900, currency: 'inr', lines: { data: [{ metadata: { plan: 'starter' }, period: { end: future } }] } });
  ok((await prisma.payment.count({ where: { workspaceId: wsA } })) === 1, 'stripe: payment recorded once');
  r = await call(hA, 'GET', '/admin/api/billing');
  ok(r.json().payments[0].amount === 99900 && r.json().planName === 'Starter' && r.json().limits.seats === 2, 'billing: starter limits and payment history shown');
  await stripeEvent('evt_4', 'invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_1' });
  w = await wsRow();
  ok(w.planStatus === 'past_due' && accessState(w).active, 'stripe: payment failure -> past_due, still active during the grace period');
  await stripeEvent('evt_5', 'customer.subscription.deleted', { object: 'subscription', id: 'sub_1', customer: 'cus_1', metadata: { workspaceId: wsA } });
  w = await wsRow();
  ok(w.planStatus === 'canceled' && !accessState(w).active, 'stripe: subscription deleted -> access ends');

  const rzp = (id: string, type: string, payload: any, secret = 'rzp_test') => {
    const raw = JSON.stringify({ event: type, payload });
    return app.inject({ method: 'POST', url: '/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex'), 'x-razorpay-event-id': id }, payload: raw });
  };
  const rzpBody = { subscription: { entity: { id: 'sub_rz', notes: { workspaceId: wsA, plan: 'growth' }, current_end: future } }, payment: { entity: { id: 'pay_1', amount: 299900, currency: 'INR' } } };
  ok((await rzp('rz_bad', 'subscription.charged', rzpBody, 'nope')).statusCode === 400, 'razorpay webhook: bad signature rejected');
  ok((await rzp('rz_1', 'subscription.charged', rzpBody)).statusCode === 200, 'razorpay: charged');
  w = await wsRow();
  ok(w.plan === 'growth' && w.planStatus === 'active' && w.billingProvider === 'razorpay' && accessState(w).active, 'razorpay: reactivated on Growth');
  ok((await prisma.payment.count({ where: { workspaceId: wsA, provider: 'razorpay' } })) === 1, 'razorpay: payment recorded');
  await rzp('rz_2', 'subscription.halted', rzpBody);
  ok((await wsRow()).planStatus === 'past_due', 'razorpay: halted -> past_due');
  await rzp('rz_3', 'subscription.cancelled', rzpBody);
  ok((await wsRow()).planStatus === 'canceled', 'razorpay: cancelled');

  // seats follow the plan (starter = 2): owner + agent + agent2 already exist, so the next one is refused
  await prisma.workspace.update({ where: { id: wsA }, data: { plan: 'starter', planStatus: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
  invalidateConfig(wsA);
  ok((await call(hA, 'POST', '/admin/api/admins', { email: `s2${DOMAIN}`, password: 'seat password 1', role: 'agent' })).statusCode === 402, 'seat limit of the plan is enforced');

  // ---- platform admin ----
  await prisma.adminUser.create({ data: { email: `root${DOMAIN}`, passwordHash: await hashPassword('platform admin pw 1'), workspaceId: wsB, role: 'owner', isSuperAdmin: true } });
  const hRoot = cookieOf(await login(`root${DOMAIN}`, 'platform admin pw 1'));
  r = await call(hRoot, 'GET', '/admin/api/super/workspaces');
  ok(r.statusCode === 200 && r.json().workspaces.some((w: any) => w.id === wsA) && r.json().workspaces.some((w: any) => w.id === wsB), 'platform admin lists all workspaces');
  ok((await call(hRoot, 'POST', `/admin/api/super/workspaces/${wsA}/bot`, { enabled: false })).statusCode === 200 && (await prisma.workspace.findUnique({ where: { id: wsA } }))!.botEnabled === false, 'platform admin can suspend a bot');

  for (let i = 0; i < 10; i++) await login(`victim${DOMAIN}`, 'x');
  ok((await login(`victim${DOMAIN}`, 'x')).statusCode === 429, 'repeated failures are throttled');

  await cleanup();
  console.log('ADMIN API OK');
  process.exit(0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
