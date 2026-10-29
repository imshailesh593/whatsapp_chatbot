import { BUSINESS_NAME } from '../src/brand';
// Engine-level end-to-end test against the real database with a fake WhatsApp transport.
// Usage: npx tsx scripts/e2e.ts   (needs DATABASE_URL; GEMINI_API_KEY optional)
import dotenv from 'dotenv';
dotenv.config();
import { prisma } from '../src/lib/prisma';
import { setTransport } from '../src/services/transport';
import { handleIncomingMessage, resolveService } from '../src/services/engine';
import { QUESTION_BRANCHES } from '../src/constants/questions';

const sent: { to: string; text: string }[] = [];
setTransport({ sendText: async (to, text) => void sent.push({ to, text }) });
const replies = (to: string) => sent.filter((s) => s.to === to).map((s) => s.text);

function assert(c: any, msg: string) {
  if (!c) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ok -', msg);
}

async function main() {
  console.log('[service resolution]');
  for (const [input, want] of [['3', 'JOBS'], ['3.', 'JOBS'], ['option 2', 'LICENSING'], ['1️⃣', 'COACHING'], ['I need a visa', 'VISA_PR'], ['PR', 'VISA_PR'], ['I want to prepare', undefined], ['7', undefined], ['hello', undefined]] as const) {
    assert(resolveService(input) === want, `"${input}" -> ${want}`);
  }

  const created: string[] = [];
  const services = ['COACHING', 'LICENSING', 'JOBS', 'VISA_PR', 'GENERAL'];
  const run = Date.now().toString().slice(-6);

  for (let i = 0; i < services.length; i++) {
    const svc = services[i];
    const phone = `9199${run}${i}`;
    created.push(phone);
    const qs = QUESTION_BRANCHES[svc];
    console.log(`\n[${svc}] ${phone}`);

    await handleIncomingMessage(phone, 'Test', 'Hi');
    assert(replies(phone)[0].includes('Welcome to ' + BUSINESS_NAME), 'welcome sent');

    await handleIncomingMessage(phone, 'Test', 'banana');
    assert(/valid number/.test(replies(phone)[1]), 'invalid selection re-prompted');

    await handleIncomingMessage(phone, 'Test', String(i + 1));
    assert(replies(phone)[2] === qs[0].question, 'first question sent');

    for (let q = 0; q < qs.length; q++) {
      await handleIncomingMessage(phone, 'Test', `answer-${q}`);
      if (q < qs.length - 1) assert(replies(phone).at(-1) === qs[q + 1].question, `Q${q + 2} follows answer ${q + 1}`);
    }
    assert(replies(phone).at(-1)!.includes('https://topmate.io/mnsinstitute/'), 'completion message with Topmate link');

    const lead = await prisma.lead.findFirst({ where: { phoneNumber: phone } });
    assert(lead?.serviceCategory === svc, 'lead saved with correct category');
    const data = lead!.collectedData as Record<string, string>;
    assert(qs.every((q, k) => data[q.key] === `answer-${k}`), `all ${qs.length} answers stored`);

    await handleIncomingMessage(phone, 'Test', 'how much is the fee');
    assert(replies(phone).at(-1)!.includes('topmate.io'), 'fee question -> consultation link');

    await handleIncomingMessage(phone, 'Test', 'I have already booked');
    assert((await prisma.lead.findFirst({ where: { phoneNumber: phone } }))?.isBookedTopmate === true, 'booking flips isBookedTopmate');

    await handleIncomingMessage(phone, 'Test', 'menu');
    assert(replies(phone).at(-1)!.includes('Welcome to ' + BUSINESS_NAME), 'menu restarts the funnel');
  }

  console.log('\n[side question mid-flow]');
  const sp = `9177${run}0`;
  await handleIncomingMessage(sp, 'Test', 'hi');
  await handleIncomingMessage(sp, 'Test', '1');
  const before = replies(sp).length;
  await handleIncomingMessage(sp, 'Test', 'What is OET?');
  const after = replies(sp).slice(before);
  const s1 = await prisma.session.findUnique({ where: { phoneNumber: sp } });
  if (process.env.GEMINI_API_KEY) {
    assert(s1!.currentStep === 0, 'side question did not consume the answer');
    assert(after.length === 2 && after[1] === QUESTION_BRANCHES.COACHING[0].question, `Gemini answered then re-asked Q1: "${after[0].slice(0, 60)}…"`);
  } else {
    console.log('  (no GEMINI_API_KEY: treated as plain answer, Gemini path skipped)');
  }

  console.log('\n[agent takeover]');
  await prisma.session.update({ where: { phoneNumber: sp }, data: { isAgentPaused: true } });
  const n = replies(sp).length;
  await handleIncomingMessage(sp, 'Test', 'anyone there?');
  assert(replies(sp).length === n, 'paused session gets no bot reply');

  const mine = [...created, sp];
  await prisma.webhookLog.deleteMany({ where: { phoneNumber: { in: mine } } });
  await prisma.session.deleteMany({ where: { phoneNumber: { in: mine } } });
  console.log('\nALL E2E CHECKS PASSED');
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
