// One customer message, one reply; messages sent in a burst are answered once; a human tone; and an honest answer when someone asks
// whether they are talking to a bot. Uses fake transports (no WhatsApp, no Gemini).
// Usage: npx tsx scripts/human-test.ts   (needs DATABASE_URL)
import dotenv from 'dotenv';
dotenv.config();
process.env.GEMINI_API_KEY = '';
import { prisma } from '../src/lib/prisma';
import { batchReplies, captureReplies, sendTextMessage, setTransport } from '../src/services/transport';
import { handleIncomingMessage } from '../src/services/engine';
import { saveServices, invalidateConfig, welcomeMessage, menuOnlyMessage, invalidSelectionMessage, loadConfig, completionMessage, postCompletionMessage } from '../src/services/botConfig';
import { askedIfBot, wantsHuman, botIdentityReply } from '../src/services/handoff';
import { MessageBurst } from '../src/lib/burst';
import { getTemplate } from '../src/templates';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sent: { to: string; text: string }[] = [];
const to = (p: string) => sent.filter((s) => s.to === p).map((s) => s.text);

(async () => {
  console.log('[one reply per message: the transport]');
  const run = Date.now().toString(36);
  const W0 = (await prisma.workspace.create({ data: { slug: `hum0-${run}`, name: 'T', businessName: 'T', plan: 'internal', planStatus: 'active' } })).id;
  setTransport(W0, { sendText: async (t, text) => void sent.push({ to: t, text }), ready: () => true });
  await batchReplies(W0, 'A', async () => {
    await sendTextMessage(W0, 'A', 'Sure, the fee is 500.');
    await sendTextMessage(W0, 'A', 'Sure, the fee is 500.'); // an accidental repeat
    await sendTextMessage(W0, 'B', 'to somebody else');
    await sendTextMessage(W0, 'A', 'What is your name?');
    ok(to('A').length === 0 && to('B').length === 1, 'while a message is being handled nothing goes to that customer yet, and other people are not held back');
  }).catch(() => undefined);
  ok(to('A').length === 1 && to('A')[0] === 'Sure, the fee is 500.\n\nWhat is your name?', 'everything for that customer leaves as ONE message, in order, with an accidental repeat dropped');
  let late = Promise.resolve();
  await batchReplies(W0, 'A', async () => { late = sleep(20).then(() => sendTextMessage(W0, 'A', 'a background task finishing later')); });
  await late;
  ok(to('A').length === 2 && to('A')[1] === 'a background task finishing later', 'a background task that finishes after the reply was sent still goes out on its own');
  await batchReplies(W0, 'A', async () => { /* says nothing */ });
  ok(to('A').length === 2, 'handling a message that needs no reply sends nothing');
  const cap = await captureReplies(() => batchReplies(W0, 'A', async () => { await sendTextMessage(W0, 'A', 'one'); await sendTextMessage(W0, 'A', 'two'); }));
  ok(cap.length === 1 && cap[0] === 'one\n\ntwo', 'the test chat in the dashboard shows the same single reply');
  setTransport(W0, null);

  console.log('\n[messages sent in a burst are answered once]');
  const got: { key: string; texts: string[] }[] = [];
  const burst = new MessageBurst((key, items) => got.push({ key, texts: items.map((i) => i.text) }), () => 120, 400);
  burst.add('c1', { text: 'hi', id: '1' });
  await sleep(40);
  burst.add('c1', { text: 'hello', id: '2' });
  await sleep(40);
  burst.add('c1', { text: 'anyone there?', id: '3' });
  burst.add('c2', { text: 'price?', id: '4' });
  await sleep(60);
  ok(got.length === 0, 'it waits while the customer is still typing');
  await sleep(200);
  ok(got.length === 2 && got.find((g) => g.key === 'c1')!.texts.join('|') === 'hi|hello|anyone there?' && got.find((g) => g.key === 'c2')!.texts.join('|') === 'price?', 'three quick messages become one batch, and another chat is not mixed in');
  burst.add('c1', { text: 'thanks', id: '5' });
  await sleep(200);
  ok(got.length === 3 && got[2].texts.join('|') === 'thanks', 'a later message starts a new batch');
  const t0 = Date.now();
  let flushedAt = 0;
  const endless = new MessageBurst(() => { if (!flushedAt) flushedAt = Date.now() - t0; }, () => 150, 400);
  for (let i = 0; i < 12; i++) { endless.add('x', { text: String(i), id: String(i) }); await sleep(60); }
  await sleep(250);
  ok(flushedAt > 0 && flushedAt <= 520, `a customer who keeps typing is still answered for the first time within the maximum wait (${flushedAt} ms)`);

  console.log('\n[are you a bot?]');
  for (const t of ['are you a bot?', 'Are you human??', 'is this a real person?', 'am I talking to a robot', 'Are you AI', 'is this automated?', 'r u a bot', 'are you a real person', 'bot ho kya', 'aap bot ho?', 'are you real?', 'Is this a bot']) ok(askedIfBot(t), `"${t}" is a question about what they are talking to`);
  for (const t of ['are you open on Sunday?', 'are you a real estate company?', 'is this about AI courses?', 'I want to talk to a real person', 'talk to a human please', 'what is the fee', 'I am a nurse', 'is it automated billing?', 'can I speak with an agent']) ok(!askedIfBot(t), `"${t}" is not`);
  ok(wantsHuman('I want to talk to a real person') && wantsHuman('talk to a human please'), 'asking for a person is still a hand-off request');

  const W = await prisma.workspace.create({
    data: { slug: `hum-${run}`, name: 'Clinic', businessName: 'Glow Dental Clinic | Glow Kids', botEnabled: true, onboardingCompleted: true, plan: 'internal', planStatus: 'active', handoffEnabled: true }
  });
  setTransport(W.id, { sendText: async (t, text) => void sent.push({ to: t, text }), ready: () => true });
  try {
    await saveServices(W.id, getTemplate('generic').services);
    invalidateConfig(W.id);
    const cfg = await loadConfig(W.id);
    const say = async (p: string, text: string) => {
      const before = to(p).length;
      await handleIncomingMessage(W.id, p, 'Asha', text);
      const n = to(p).length - before;
      if (n > 1) throw new Error(`FAIL: "${text}" got ${n} replies`);
      return n === 1 ? to(p).at(-1)! : '';
    };
    const p1 = `9170${run}1`;
    ok((await say(p1, 'hi')).length > 0 && !/\b(bot|AI|robot|automated)\b/i.test(to(p1)[0]), 'the bot does not announce that it is a bot');
    const identity = await say(p1, 'wait, are you a bot?');
    ok(/virtual assistant/.test(identity) && /not a person/.test(identity) && /pass you over/.test(identity) && identity.includes('Glow Dental Clinic') && !identity.includes('Glow Kids'), 'asked directly, it says honestly that it is the business\'s virtual assistant, not a person, and offers a person');
    ok(!/I am (a )?human|I\'m (a )?human|real person here/i.test(identity) && identity === botIdentityReply(cfg), 'it never claims to be a person');
    let row = await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: p1 } });
    ok(row!.isAgentPaused === false && row!.handoffAt === null, 'that question does not hand the chat to the team: the bot carries on');
    const again = await say(p1, 'is this a real person?');
    ok(/not a person/.test(again), 'asked another way, same honest answer');
    const handoff = await say(p1, 'ok then I want to talk to a real person');
    row = await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: p1 } });
    ok(row!.isAgentPaused === true && /pass this to our team/i.test(handoff), 'asking for a person still hands the chat over, in a short natural sentence');
    await prisma.workspace.update({ where: { id: W.id }, data: { handoffEnabled: false } });
    invalidateConfig(W.id);
    ok(!/pass you over/.test(botIdentityReply(await loadConfig(W.id))), 'with hand-off switched off it does not promise a person');

    console.log('\n[the copy reads like a person typing]');
    const robotic = /Please reply with|kindly|valid number|option number|Dear customer|we regret|inconvenience/i;
    const texts = [welcomeMessage(cfg), menuOnlyMessage(cfg), invalidSelectionMessage(cfg), completionMessage(cfg, null, {}), postCompletionMessage()];
    ok(texts.every((t) => !robotic.test(t)), 'no stiff phrases such as "Please reply with the option number"');
    ok(texts.every((t) => !/[✅🙌📝👉]|⃣/u.test(t)), 'no emoji numbering or decorative emoji');
    ok(texts.every((t) => t.length < 700), 'every standard message is short enough to read at a glance');
    ok(welcomeMessage(cfg).startsWith('Hi, welcome to Glow Dental Clinic!') && !welcomeMessage(cfg).includes('Glow Kids'), 'the greeting uses the first name of the business, like a person would');

    console.log('\n[the questionnaire: still one reply for each answer]');
    const p2 = `9170${run}2`;
    await prisma.workspace.update({ where: { id: W.id }, data: { botEnabled: true } });
    invalidateConfig(W.id);
    await say(p2, 'hello');
    await say(p2, '1');
    let count = 0;
    for (const a of ['Whitefield', 'Apartment', '80 lakh', 'Within 3 months', 'extra answer']) {
      const before = to(p2).length;
      await handleIncomingMessage(W.id, p2, 'Asha', a);
      count += to(p2).length - before;
    }
    ok(count <= 5, `five answers in a row got ${count} replies in total, never more than one each`);
    await sleep(500);
  } finally {
    setTransport(W.id, null);
    await prisma.workspace.delete({ where: { id: W.id } }).catch(() => null);
    await prisma.$disconnect();
  }
  console.log('\nHUMAN TESTS OK');
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
