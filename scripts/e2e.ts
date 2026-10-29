// Engine-level end-to-end test against the real database with a fake WhatsApp transport.
// Creates two throwaway workspaces (a full funnel and a minimal one), checks isolation, then deletes them.
// Usage: npx tsx scripts/e2e.ts   (needs DATABASE_URL; GEMINI_API_KEY optional)
import dotenv from 'dotenv';
dotenv.config();
import { prisma } from '../src/lib/prisma';
import { setTransport, captureReplies } from '../src/services/transport';
import { handleIncomingMessage } from '../src/services/engine';
import { loadConfig, resolveService, saveServices, invalidateConfig, sanitizeServices } from '../src/services/botConfig';
import { getTemplate } from '../src/templates';
import { setSetting } from '../src/services/settings';
import { deliverAlert, sendTestAlert } from '../src/services/alerts';

const extra: string[] = [];
const sent: { ws: string; to: string; text: string }[] = [];
const wire = (ws: string) => setTransport(ws, { sendText: async (to, text) => void sent.push({ ws, to, text }), ready: () => true });
const replies = (ws: string, to: string) => sent.filter((s) => s.ws === ws && s.to === to).map((s) => s.text);

function assert(c: any, msg: string) {
  if (!c) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ok -', msg);
}

async function main() {
  const run = Date.now().toString(36);
  const A = await prisma.workspace.create({
    data: {
      slug: `e2e-a-${run}`, name: 'Acme Careers', businessName: 'Acme Careers', tagline: 'Your partner',
      welcomeIntro: 'We help with careers.', formUrl: 'https://forms.example/acme', bookingUrl: 'https://cal.example/acme',
      bookingLabel: 'consultation', bookingNote: 'Fees adjusted later.', botEnabled: true, onboardingCompleted: true, plan: 'internal', planStatus: 'active'
    }
  });
  const B = await prisma.workspace.create({
    data: { slug: `e2e-b-${run}`, name: 'Bolt Plumbing', businessName: 'Bolt Plumbing', botEnabled: true, onboardingCompleted: true, plan: 'internal', planStatus: 'active' }
  });
  try {
    wire(A.id);
    wire(B.id);
    const tplA = getTemplate('overseas-careers');
    await saveServices(A.id, tplA.services);
    await saveServices(B.id, getTemplate('generic').services);
    const cfgA = await loadConfig(A.id);
    const cfgB = await loadConfig(B.id);

    console.log('[service resolution]');
    for (const [input, want] of [['3', 'JOBS'], ['3.', 'JOBS'], ['option 2', 'LICENSING'], ['1️⃣', 'COACHING'], ['I need a visa', 'VISA_PR'], ['PR', 'VISA_PR'], ['I want to prepare', undefined], ['7', undefined], ['hello', undefined]] as const) {
      assert(resolveService(cfgA, input) === want, `A: "${input}" -> ${want}`);
    }
    assert(resolveService(cfgB, '2') === 'SUPPORT', 'B: "2" -> SUPPORT (menu is per workspace)');
    assert(resolveService(cfgB, 'I need support') === 'SUPPORT', 'B: keyword -> SUPPORT');
    assert(resolveService(cfgB, '4') === undefined, 'B: 4 is out of range');

    console.log('\n[full funnel per service, workspace A]');
    for (const [i, svc] of cfgA.services.entries()) {
      const phone = `9199${run}${i}`;
      const qs = svc.questions;
      await handleIncomingMessage(A.id, phone, 'Test', 'Hi');
      assert(replies(A.id, phone)[0].includes('Welcome to Acme Careers'), `${svc.key}: welcome uses workspace name`);
      assert(replies(A.id, phone)[0].includes('https://forms.example/acme'), `${svc.key}: welcome carries the form link`);
      await handleIncomingMessage(A.id, phone, 'Test', 'banana');
      assert(/valid number/.test(replies(A.id, phone)[1]), `${svc.key}: invalid selection re-prompted`);
      await handleIncomingMessage(A.id, phone, 'Test', String(i + 1));
      assert(replies(A.id, phone)[2] === qs[0].prompt, `${svc.key}: first question sent`);
      for (let q = 0; q < qs.length; q++) {
        await handleIncomingMessage(A.id, phone, 'Test', `answer-${q}`);
        if (q < qs.length - 1) assert(replies(A.id, phone).at(-1) === qs[q + 1].prompt, `${svc.key}: Q${q + 2} follows answer ${q + 1}`);
      }
      const done = replies(A.id, phone).at(-1)!;
      assert(done.includes('https://cal.example/acme') && done.includes('Acme Careers | Your partner'), `${svc.key}: completion with booking link and sign-off`);
      const lead = await prisma.lead.findFirst({ where: { workspaceId: A.id, phoneNumber: phone } });
      assert(lead?.serviceCategory === svc.key, `${svc.key}: lead saved with the service key`);
      const data = lead!.collectedData as Record<string, string>;
      assert(qs.every((q, k) => data[q.key] === `answer-${k}`), `${svc.key}: all ${qs.length} answers stored`);

      await handleIncomingMessage(A.id, phone, 'Test', 'how much is the fee');
      assert(replies(A.id, phone).at(-1)!.includes('cal.example'), `${svc.key}: fee question -> booking link`);
      await handleIncomingMessage(A.id, phone, 'Test', 'I have already booked');
      assert((await prisma.lead.findFirst({ where: { workspaceId: A.id, phoneNumber: phone } }))?.stageKey === 'booked', `${svc.key}: booking moves the lead to the Booked stage`);
      await handleIncomingMessage(A.id, phone, 'Test', 'menu');
      assert(replies(A.id, phone).at(-1)!.includes('Welcome to Acme Careers'), `${svc.key}: menu restarts the funnel`);
    }

    console.log('\n[workspace B: no form, no booking link]');
    const pb = `9188${run}`;
    await handleIncomingMessage(B.id, pb, 'Test', 'hello');
    const welcomeB = replies(B.id, pb)[0];
    assert(welcomeB.includes('Welcome to Bolt Plumbing') && !welcomeB.includes('http') && welcomeB.includes('1-3'), 'B welcome: own name, no links, 3 options');
    await handleIncomingMessage(B.id, pb, 'Test', '3');
    await handleIncomingMessage(B.id, pb, 'Test', 'Please call me');
    const doneB = replies(B.id, pb).at(-1)!;
    assert(!doneB.includes('http') && doneB.includes('Bolt Plumbing'), 'B completion has no booking block');

    console.log('\n[tenant isolation]');
    assert((await prisma.session.count({ where: { workspaceId: B.id } })) === 1, 'B sees only its own sessions');
    assert((await prisma.lead.count({ where: { workspaceId: A.id, phoneNumber: pb } })) === 0, "B's contact never leaks into A");
    // same phone number can chat with both businesses independently
    const shared = `9166${run}`;
    await handleIncomingMessage(A.id, shared, 'X', 'hi');
    await handleIncomingMessage(B.id, shared, 'X', 'hi');
    assert((await prisma.session.count({ where: { phoneNumber: shared } })) === 2, 'same customer has one session per business');

    console.log('\n[bot paused until go-live]');
    await prisma.workspace.update({ where: { id: B.id }, data: { botEnabled: false } });
    invalidateConfig(B.id);
    const nB = replies(B.id, pb).length;
    await handleIncomingMessage(B.id, pb, 'Test', 'anyone?');
    assert(replies(B.id, pb).length === nB, 'workspace with bot off sends nothing');

    console.log('\n[editing the menu while a customer is mid-flow]');
    const mid = `9155${run}`;
    await handleIncomingMessage(A.id, mid, 'Mid', 'hi');
    await handleIncomingMessage(A.id, mid, 'Mid', '3');
    await saveServices(A.id, [{ title: 'Only option', keywords: [], questions: [{ key: 'q', prompt: 'One question?' }] }]);
    await handleIncomingMessage(A.id, mid, 'Mid', 'answer');
    assert(replies(A.id, mid).at(-1)!.includes('Only option'), 'removed service -> customer is sent back to the new menu');

    console.log('\n[pipeline]');
    await saveServices(A.id, tplA.services);
    const won = `9122${run}`;
    await handleIncomingMessage(A.id, won, 'W', 'hi');
    await handleIncomingMessage(A.id, won, 'W', '5');
    for (let i = 0; i < 3; i++) await handleIncomingMessage(A.id, won, 'W', 'x');
    assert((await prisma.lead.findFirst({ where: { workspaceId: A.id, phoneNumber: won } }))?.stageKey === 'new', 'a finished lead starts in "new"');
    await prisma.lead.updateMany({ where: { workspaceId: A.id, phoneNumber: won }, data: { stageKey: 'won' } });
    await handleIncomingMessage(A.id, won, 'W', 'I have already booked');
    assert((await prisma.lead.findFirst({ where: { workspaceId: A.id, phoneNumber: won } }))?.stageKey === 'won', 'a closed (won) lead is not pulled back to Booked');

    console.log('\n[lead alerts]');
    await saveServices(A.id, tplA.services);
    process.env.SMTP_HOST = 'json';
    process.env.SMTP_FROM = 'bot@example.com';
    await prisma.workspace.update({ where: { id: A.id }, data: { notifyPhone: '+91 90000 00001', notifyEmail: 'owner@example.com' } });
    invalidateConfig(A.id);
    const ap = `9133${run}`;
    const q0 = cfgA.services[4].questions; // "Other Enquiry": 3 questions
    await handleIncomingMessage(A.id, ap, 'Priya', 'hi');
    await handleIncomingMessage(A.id, ap, 'Priya', '5');
    for (let i = 0; i < q0.length; i++) await handleIncomingMessage(A.id, ap, 'Priya', `alert-answer-${i}`);
    await new Promise((r) => setTimeout(r, 400));
    const alertMsg = replies(A.id, '919000000001').find((t) => t.includes('New lead'));
    assert(!!alertMsg && alertMsg.includes('Priya') && alertMsg.includes('Other Enquiry') && alertMsg.includes('alert-answer-0'), 'new-lead alert reaches the owner WhatsApp number with name, service and answers');
    assert((await prisma.webhookLog.count({ where: { workspaceId: A.id, phoneNumber: '919000000001' } })) === 0, 'owner alerts are not written into customer chat logs');
    const tr = await sendTestAlert(A.id, 'Acme Careers');
    assert(tr.whatsapp === 'sent' && tr.email === 'sent', 'test alert: both channels sent');
    await handleIncomingMessage(A.id, ap, 'Priya', 'I have already booked');
    await new Promise((r) => setTimeout(r, 400));
    assert(replies(A.id, '919000000001').some((t) => t.includes('Booking confirmed')), 'booking alert sent once the customer confirms');
    const n1 = replies(A.id, '919000000001').length;
    await handleIncomingMessage(A.id, ap, 'Priya', 'I have already booked');
    await new Promise((r) => setTimeout(r, 300));
    assert(replies(A.id, '919000000001').length === n1, 'booking alert is not repeated');
    // platform switch: alerts leave from the operator's own number instead of the client's
    await setSetting('platformSender', true);
    await prisma.workspace.update({ where: { id: A.id }, data: { notifyPhone: '919000000002' } });
    invalidateConfig(A.id);
    const platformWs = await prisma.workspace.findUnique({ where: { id: 'default-workspace' } });
    if (platformWs) {
      wire('default-workspace');
      const viaA = replies(A.id, '919000000002').length;
      const viaP = await deliverAlert(A.id, 'Hello', 'World');
      assert(viaP.whatsapp === 'sent' && replies('default-workspace', '919000000002').some((t) => t.startsWith('[Acme Careers]')) && replies(A.id, '919000000002').length === viaA, 'platform switch on: the alert is sent from the platform number, labelled with the business name');
      setTransport('default-workspace', null);
      assert((await deliverAlert(A.id, 'x', 'y')).whatsapp.startsWith('skipped: the platform WhatsApp number'), 'platform number offline: alert skipped with a clear reason');
    }
    await setSetting('platformSender', false);
    await prisma.workspace.update({ where: { id: A.id }, data: { notifyPhone: '+91 90000 00001' } });
    invalidateConfig(A.id);
    const none = await deliverAlert(B.id, 'x', 'y');
    assert(none.whatsapp.startsWith('skipped') && none.email.startsWith('skipped'), 'no channels configured: nothing sent, no error');
    await prisma.workspace.update({ where: { id: A.id }, data: { notifyPhone: 'abc' } });
    invalidateConfig(A.id);
    assert((await deliverAlert(A.id, 'x', 'y')).whatsapp.startsWith('skipped: the alert number'), 'invalid alert number is rejected');
    delete process.env.SMTP_HOST;
    await prisma.workspace.update({ where: { id: A.id }, data: { notifyPhone: '' } });
    invalidateConfig(A.id);
    assert((await deliverAlert(A.id, 'x', 'y')).email.startsWith('skipped: email sending'), 'email without SMTP is reported, not thrown');

    console.log('\n[plan access and limits]');
    const C = await prisma.workspace.create({
      data: { slug: `e2e-c-${run}`, name: 'Cedar', businessName: 'Cedar', botEnabled: true, onboardingCompleted: true, trialEndsAt: new Date(Date.now() + 86400000) }
    });
    extra.push(C.id);
    wire(C.id);
    await saveServices(C.id, getTemplate('generic').services);
    const pc = (n: number) => `9144${run}${n}`;
    await handleIncomingMessage(C.id, pc(1), 'T', 'hi');
    assert(replies(C.id, pc(1)).length === 1, 'active trial: bot replies');
    assert((await prisma.usage.findFirst({ where: { workspaceId: C.id } }))?.conversations === 1, 'a new chat counts as one conversation');
    await handleIncomingMessage(C.id, pc(1), 'T', 'menu');
    assert((await prisma.usage.findFirst({ where: { workspaceId: C.id } }))?.conversations === 1, 'follow-up messages in the same chat are not counted again');
    // conversation allowance used up: existing chats continue, new chats get nothing
    await prisma.usage.updateMany({ where: { workspaceId: C.id }, data: { conversations: 1500 } });
    const before = replies(C.id, pc(1)).length;
    await handleIncomingMessage(C.id, pc(1), 'T', '1');
    assert(replies(C.id, pc(1)).length === before + 1, 'limit reached: customers already chatting are still served');
    await handleIncomingMessage(C.id, pc(2), 'T', 'hi');
    assert(replies(C.id, pc(2)).length === 0 && (await prisma.session.count({ where: { workspaceId: C.id, phoneNumber: pc(2) } })) === 0, 'limit reached: no new chat is started');
    // trial over
    await prisma.workspace.update({ where: { id: C.id }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    invalidateConfig(C.id);
    const b2 = replies(C.id, pc(1)).length;
    await handleIncomingMessage(C.id, pc(1), 'T', 'anyone there');
    await handleIncomingMessage(C.id, pc(3), 'T', 'hi');
    assert(replies(C.id, pc(1)).length === b2 && replies(C.id, pc(3)).length === 0, 'trial expired: bot goes quiet for everyone');
    // simulator still works so the owner can finish setup
    const sim = await captureReplies(() => handleIncomingMessage(C.id, 'SIM-x', 'S', 'hi'));
    assert(sim.length === 1, 'trial expired: the simulator still works');
    // paying again restores service (new month's allowance)
    await prisma.usage.updateMany({ where: { workspaceId: C.id }, data: { conversations: 0 } });
    await prisma.workspace.update({ where: { id: C.id }, data: { plan: 'growth', planStatus: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
    invalidateConfig(C.id);
    await handleIncomingMessage(C.id, pc(3), 'T', 'hi');
    assert(replies(C.id, pc(3)).length === 1, 'subscription active: replies resume');

    console.log('\n[validation]');
    for (const bad of [[], [{ title: '', questions: [] }], [{ title: 'x', questions: [] }], Array.from({ length: 10 }, (_, i) => ({ title: `s${i}`, questions: [{ prompt: 'q' }] }))]) {
      let threw = false;
      try { sanitizeServices(bad); } catch { threw = true; }
      assert(threw, `rejects invalid menu (${JSON.stringify(bad).slice(0, 40)})`);
    }
    const dedup = sanitizeServices([{ title: 'Same', questions: [{ prompt: 'a' }, { prompt: 'b', key: 'q1' }] }, { title: 'Same', questions: [{ prompt: 'c' }] }]);
    assert(dedup[0].key !== dedup[1].key && dedup[0].questions[0].key !== dedup[0].questions[1].key, 'duplicate titles/keys are made unique');

    if (process.env.GEMINI_API_KEY) {
      console.log('\n[side question mid-flow, Gemini]');
      await saveServices(A.id, tplA.services);
      const sp = `9177${run}`;
      await handleIncomingMessage(A.id, sp, 'Test', 'hi');
      await handleIncomingMessage(A.id, sp, 'Test', '1');
      const before = replies(A.id, sp).length;
      await handleIncomingMessage(A.id, sp, 'Test', 'What is OET?');
      const after = replies(A.id, sp).slice(before);
      const s1 = await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: A.id, phoneNumber: sp } } });
      assert(s1!.currentStep === 0, 'side question did not consume the answer');
      assert(after.length === 2 && after[1] === tplA.services[0].questions[0].prompt, `Gemini answered then re-asked Q1: "${after[0].slice(0, 60)}…"`);
    } else {
      console.log('\n(no GEMINI_API_KEY: Gemini path skipped)');
    }
    console.log('\nALL E2E CHECKS PASSED');
  } finally {
    await prisma.workspace.deleteMany({ where: { id: { in: [A.id, B.id, ...extra] } } }); // cascades to sessions, leads, logs
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
