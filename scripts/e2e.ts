// End-to-end smoke test. Requires: server running (npm run dev) with GRAPH_API_BASE_URL=http://127.0.0.1:4010
// Usage: npx tsx scripts/e2e.ts
import http from 'http';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { QUESTION_BRANCHES } from '../src/constants/questions';

dotenv.config();
const prisma = new PrismaClient();
const SECRET = process.env.WHATSAPP_APP_SECRET!;
const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;

const sent: { to: string; body: any }[] = [];
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => {
    const body = JSON.parse(data || '{}');
    if (body.to) sent.push({ to: body.to, body });
    res.setHeader('content-type', 'application/json');
    res.end('{"messages":[{"id":"ok"}]}');
  });
});

let n = 0;
async function inbound(from: string, text: string, interactive = false) {
  const message: any = { id: `wamid.${Date.now()}.${n++}`, from, timestamp: '1' };
  if (interactive) {
    message.type = 'interactive';
    message.interactive = { type: 'list_reply', list_reply: { id: text, title: 'x' } };
  } else {
    message.type = 'text';
    message.text = { body: text };
  }
  const payload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: from, profile: { name: 'Test' } }], messages: [message] } }] }]
  });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const r = await fetch(`${BASE}/api/v1/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body: payload
  });
  if (r.status !== 200) throw new Error(`webhook ${r.status}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(from: string, count: number) {
  for (let i = 0; i < 60; i++) {
    if (sent.filter((s) => s.to === from).length >= count) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${count} replies to ${from}, got ${sent.filter((s) => s.to === from).length}`);
}

function assert(c: any, msg: string) {
  if (!c) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ok -', msg);
}

async function main() {
  await new Promise<void>((r) => mock.listen(4010, r));

  // Security: bad signature / bad verify token
  const bad = await fetch(`${BASE}/api/v1/whatsapp/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' }, body: '{}'
  });
  assert(bad.status === 401, 'bad signature rejected (401)');
  const v = await fetch(`${BASE}/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${process.env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=abc123`);
  assert((await v.text()) === 'abc123', 'GET verification echoes challenge');
  const v2 = await fetch(`${BASE}/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x`);
  assert(v2.status === 403, 'wrong verify token rejected (403)');

  const services = ['COACHING', 'LICENSING', 'JOBS', 'VISA_PR', 'GENERAL'];
  const run = Date.now().toString().slice(-6);
  for (let i = 0; i < services.length; i++) {
    const svc = services[i];
    const phone = `9199${run}${i}`;
    console.log(`\n[${svc}] ${phone}`);
    await prisma.session.deleteMany({ where: { phoneNumber: phone } });

    await inbound(phone, 'Hi');
    await waitFor(phone, 1);
    assert(sent.find((s) => s.to === phone)!.body.type === 'interactive', 'welcome sent as interactive list');

    await inbound(phone, 'banana');
    await waitFor(phone, 2);
    assert(/valid number/.test(sent.filter((s) => s.to === phone)[1].body.text.body), 'invalid selection re-prompted');

    await inbound(phone, String(i + 1), i % 2 === 0); // alternate list-reply vs typed
    const qs = QUESTION_BRANCHES[svc];
    let expected = 3;
    await waitFor(phone, expected);
    assert(sent.filter((s) => s.to === phone)[2].body.text.body === qs[0].question, 'first question sent');

    for (let q = 0; q < qs.length; q++) {
      await inbound(phone, `answer-${q}`);
      expected++;
      await waitFor(phone, expected);
    }
    const last = sent.filter((s) => s.to === phone).at(-1)!.body.text.body as string;
    assert(last.includes('https://topmate.io/mnsinstitute/'), 'completion message with Topmate link');

    const lead = await prisma.lead.findFirst({ where: { phoneNumber: phone } });
    assert(lead?.serviceCategory === svc, 'lead saved with correct category');
    const data = lead!.collectedData as Record<string, string>;
    assert(qs.every((q, k) => data[q.key] === `answer-${k}`), `all ${qs.length} answers stored under correct keys`);

    // post-completion behaviour
    await inbound(phone, 'I have already booked');
    await waitFor(phone, expected + 1);
    const lead2 = await prisma.lead.findFirst({ where: { phoneNumber: phone } });
    assert(lead2?.isBookedTopmate === true, 'booked confirmation flips isBookedTopmate');
  }

  // dedupe: same wamid delivered twice -> one reply
  console.log('\n[dedupe]');
  const dp = `9188${run}0`;
  const msg = { id: 'wamid.DUP.' + run, from: dp, type: 'text', text: { body: 'hello' } };
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [msg] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  for (let k = 0; k < 2; k++) {
    await fetch(`${BASE}/api/v1/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: payload });
  }
  await sleep(2500);
  assert(sent.filter((s) => s.to === dp).length === 1, 'duplicate delivery produced a single reply');

  // agent takeover silences bot
  console.log('\n[agent takeover]');
  await prisma.session.update({ where: { phoneNumber: dp }, data: { isAgentPaused: true } });
  await inbound(dp, 'anyone there?');
  await sleep(1500);
  assert(sent.filter((s) => s.to === dp).length === 1, 'paused session gets no bot reply');

  console.log('\nALL E2E CHECKS PASSED');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
