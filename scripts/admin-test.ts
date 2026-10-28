// Exercises the dashboard API via Fastify inject() against the real DB (no WhatsApp).
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'testtoken';
import Fastify from 'fastify';
import { registerAdmin } from '../src/admin';
import { setTransport } from '../src/services/transport';
import { prisma } from '../src/lib/prisma';
import { QUESTION_BRANCHES } from '../src/constants/questions';
import { handleIncomingMessage } from '../src/services/engine';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const sent: string[] = [];
setTransport({ sendText: async (_to, text) => void sent.push(text) });

(async () => {
  const app = Fastify();
  let wa = 'ready';
  registerAdmin(app, { getWaStatus: () => wa });
  const J = { 'content-type': 'application/json' };

  let r = await app.inject('/admin/api/contacts');
  ok(r.statusCode === 401, 'API requires login');
  r = await app.inject({ method: 'POST', url: '/admin/api/login', headers: J, payload: { token: 'wrong' } });
  ok(r.statusCode === 401, 'wrong token rejected');
  r = await app.inject({ method: 'POST', url: '/admin/api/login', headers: J, payload: { token: 'testtoken' } });
  const h = { cookie: String(r.headers['set-cookie']).split(';')[0], ...J };
  ok(r.statusCode === 200, 'login sets cookie');
  ok((await app.inject({ url: '/admin/api/me', headers: h })).json().authed === true, '/me reports authed');

  r = await app.inject({ url: '/admin/api/overview', headers: h });
  ok(r.json().services.length === 5 && r.json().whatsapp === 'ready', 'overview has 5 services + WA status');

  // Simulator drives the REAL engine and sends nothing
  const sim = async (text: string) => (await app.inject({ method: 'POST', url: '/admin/api/simulate', headers: h, payload: { id: 'tst', name: 'Sim <b>', text } })).json();
  await app.inject({ method: 'POST', url: '/admin/api/simulate/reset', headers: h, payload: { id: 'tst' } });
  let o = await sim('hi');
  ok(o.replies[0].includes('Welcome to MNS INSTITUTE'), 'simulator: welcome from real engine');
  o = await sim('2');
  ok(o.replies[0] === QUESTION_BRANCHES.LICENSING[0].question && o.state.totalSteps === 6, 'simulator: licensing Q1, 6 steps');
  for (let i = 0; i < 6; i++) o = await sim(`ans${i}`);
  ok(o.replies[0].includes('topmate.io'), 'simulator: completion with Topmate link');
  ok(sent.length === 0, 'simulator delivered nothing to WhatsApp');

  r = await app.inject({ url: '/admin/api/contacts', headers: h });
  ok(!r.json().contacts.some((c: any) => c.phone.startsWith('SIM-')), 'test contacts hidden by default');
  r = await app.inject({ url: '/admin/api/contacts?test=1', headers: h });
  const c = r.json().contacts.find((x: any) => x.phone === 'SIM-tst');
  ok(c && c.status === 'COMPLETED' && c.hasLead && c.progress === 100 && c.isTest, 'test contact listed with ?test=1 as completed lead');
  ok(c.answers.target_country === 'ans3' && c.targetCountry === 'ans3', 'answers + target country derived');

  // status / notes / pause
  const patch = async (payload: any) => app.inject({ method: 'PATCH', url: '/admin/api/contacts/SIM-tst', headers: h, payload });
  r = await patch({ status: 'CONSULTATION_BOOKED', notes: '=1+1 call back' });
  ok(r.json().contact.status === 'CONSULTATION_BOOKED' && r.json().contact.notes === '=1+1 call back', 'status + notes saved');
  r = await patch({ status: 'FOLLOW_UP' });
  ok(r.json().contact.status === 'FOLLOW_UP', 'follow-up status');
  r = await patch({ paused: true });
  ok(r.json().contact.botActive === false, 'bot paused');
  o = await sim('anyone there?');
  ok(o.replies.length === 0, 'paused simulator session gets no reply');
  ok((await patch({ paused: false })).json().contact.botActive === true, 'bot resumed');

  // human reply guard
  const send = (phone: string, text: string) => app.inject({ method: 'POST', url: `/admin/api/contacts/${phone}/send`, headers: h, payload: { text } });
  ok((await send('SIM-tst', 'hello')).statusCode === 400, 'cannot message simulator contacts');
  const real = await prisma.session.upsert({ where: { phoneNumber: '910000000009' }, update: { isAgentPaused: false }, create: { phoneNumber: '910000000009', contactName: 'Real' } });
  ok((await send('910000000009', 'hi')).statusCode === 409, 'cannot reply while bot is active');
  await prisma.session.update({ where: { id: real.id }, data: { isAgentPaused: true } });
  const n0 = sent.length;
  await handleIncomingMessage('910000000009', 'Real', 'hello bot');
  ok(sent.length === n0, 'real paused chat gets no bot reply');
  r = await app.inject({ url: '/admin/api/contacts/910000000009/messages', headers: h });
  ok(r.json().messages.some((m: any) => m.direction === 'INBOUND' && m.text === 'hello bot'), 'inbound message logged for thread view');
  wa = 'qr';
  ok((await send('910000000009', 'hi')).statusCode === 503, 'cannot reply when WhatsApp is disconnected');
  wa = 'ready';
  ok((await send('910000000009', 'Hello from counsellor')).statusCode === 200 && sent[0] === 'Hello from counsellor', 'human reply delivered when paused');
  r = await app.inject({ url: '/admin/api/contacts/910000000009/messages', headers: h });
  ok(r.json().messages.at(-1).direction === 'OUTBOUND', 'human reply logged as outbound');
  r = await app.inject({ method: 'PATCH', url: '/admin/api/contacts/910000000009', headers: h, payload: { notes: 'x' } });
  ok(r.statusCode === 409, 'notes refused before the questionnaire is complete');

  // CSV excludes test data and neutralises formulas
  await prisma.session.update({ where: { phoneNumber: 'SIM-tst' }, data: { contactName: '=cmd' } });
  r = await app.inject({ url: '/admin/api/export.csv', headers: h });
  ok(r.headers['content-type']?.toString().startsWith('text/csv') && !r.body.includes('SIM-tst'), 'CSV excludes simulator contacts');
  r = await app.inject({ url: '/admin/api/export.csv' });
  ok(r.statusCode === 401, 'CSV requires login');

  await app.inject({ method: 'POST', url: '/admin/api/simulate/reset', headers: h, payload: { id: 'tst' } });
  await prisma.webhookLog.deleteMany({ where: { phoneNumber: '910000000009' } });
  await prisma.session.delete({ where: { id: real.id } });
  console.log('ADMIN API OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
