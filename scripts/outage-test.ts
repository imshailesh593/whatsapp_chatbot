// While the AI cannot answer: one useful reply, no canned callback line, not repeated, and the chat is left as it was.
// Usage: npx tsx scripts/outage-test.ts   (needs DATABASE_URL; no WhatsApp; the Gemini key is deliberately invalid)
import dotenv from 'dotenv';
dotenv.config();
process.env.GEMINI_API_KEY = 'invalid-key-for-the-outage-test';
process.env.AI_REPLY_WAIT_MS = '0';
import { SessionStage } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { setTransport } from '../src/services/transport';
import { handleIncomingMessage } from '../src/services/engine';
import { loadConfig, saveServices, invalidateConfig, postCompletionMessage } from '../src/services/botConfig';
import { outageMessage } from '../src/services/aiChat';
import { getTemplate } from '../src/templates';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const sent: string[] = [];

(async () => {
  const run = Date.now().toString(36);
  const W = (await prisma.workspace.create({ data: { slug: `out-${run}`, name: 'Inst', businessName: 'Test Institute', botEnabled: true, onboardingCompleted: true, plan: 'internal', planStatus: 'active', aiConversation: true, bookingUrl: 'https://example.com/book', bookingLabel: '1:1 meeting' } })).id;
  setTransport(W, { sendText: async (_t, text) => void sent.push(text), ready: () => true });
  try {
    await saveServices(W, getTemplate('clinic')!.services);
    invalidateConfig(W);
    const cfg = await loadConfig(W);
    const say = async (phone: string, text: string) => { sent.length = 0; await handleIncomingMessage(W, phone, text); return [...sent]; };
    const where = (phone: string) => ({ workspaceId_phoneNumber: { workspaceId: W, phoneNumber: phone } });
    const finished = (phone: string) => prisma.session.create({ data: { workspaceId: W, phoneNumber: phone, stage: SessionStage.COMPLETED, selectedService: cfg.services[0].key, currentStep: 9 } });

    // a customer whose chat was finished before the AI went down (the case in the screenshots)
    await finished('911111111111');
    const first = await say('911111111111', 'HELLOW');
    ok(first.length === 1 && first[0] === outageMessage(cfg) && first[0].includes('https://example.com/book'), 'AI down: the finished chat gets one reply with the booking link');
    ok(!/in touch|has your details|MENU|call/i.test(first[0]), 'no callback promise and no menu wording');
    ok((await say('911111111111', 'i want to start DHA coaching')).length === 0, 'the same message is not repeated');
    ok((await prisma.session.findUnique({ where: where('911111111111') }))!.stage === SessionStage.COMPLETED, 'the chat is left as it was for the AI to pick up');
    const fresh = await say('922222222222', 'DHA fees?');
    ok(fresh.length === 1 && fresh[0] === outageMessage(cfg), 'a new customer gets the same single useful reply, not a numbered menu');

    // businesses on the menu flow: the canned line is gone too
    await prisma.workspace.update({ where: { id: W }, data: { aiConversation: false } });
    invalidateConfig(W);
    await finished('933333333333');
    const hello = await say('933333333333', 'HELLOW');
    ok(hello.length === 1 && hello[0] !== postCompletionMessage() && (await prisma.session.findUnique({ where: where('933333333333') }))!.stage === SessionStage.AWAITING_SERVICE_SELECTION, 'menu flow: a fresh hello starts afresh');
    await prisma.session.update({ where: where('933333333333'), data: { stage: SessionStage.COMPLETED } });
    const target = cfg.services[1];
    const into = await say('933333333333', `i want to start ${target.keywords[0]}`);
    ok(into.length === 1 && into[0].includes(target.questions[0].prompt), 'menu flow: asking for a service goes into that service');
    ok(!/in touch soon|has your details/i.test(postCompletionMessage()), 'the canned callback line no longer exists');
    console.log('\nOUTAGE OK');
  } finally {
    setTransport(W, null);
    await prisma.workspace.delete({ where: { id: W } });
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
