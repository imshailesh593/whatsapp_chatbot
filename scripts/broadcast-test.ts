// Broadcast sender tests against the real database with a fake WhatsApp transport.
// Usage: npx tsx scripts/broadcast-test.ts
import dotenv from 'dotenv';
dotenv.config();
import { prisma } from '../src/lib/prisma';
import { setTransport } from '../src/services/transport';
import { handleIncomingMessage } from '../src/services/engine';
import { saveServices, invalidateConfig } from '../src/services/botConfig';
import { getTemplate } from '../src/templates';
import { createBroadcast, inSendWindow, previewAudience, renderMessage, setStatus, tick } from '../src/services/broadcast';

const sent: { ws: string; to: string; text: string }[] = [];
let ready = true;
const wire = (ws: string) => setTransport(ws, { sendText: async (to, text) => void sent.push({ ws, to, text }), ready: () => ready });
const to = (ws: string, phone: string) => sent.filter((s) => s.ws === ws && s.to === phone).map((s) => s.text);

function assert(c: any, msg: string) {
  if (!c) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ok -', msg);
}

async function addContact(workspaceId: string, phone: string, name: string, opts: { lead?: string; optedOut?: boolean; daysAgo?: number } = {}) {
  const s = await prisma.session.create({
    data: {
      workspaceId, phoneNumber: phone, contactName: name, optedOut: !!opts.optedOut, selectedService: 'SUPPORT',
      lastInteractionAt: new Date(Date.now() - (opts.daysAgo ?? 1) * 86_400_000)
    }
  });
  if (opts.lead) await prisma.lead.create({ data: { workspaceId, sessionId: s.id, phoneNumber: phone, serviceCategory: 'SUPPORT', collectedData: {}, stageKey: opts.lead } });
}

async function main() {
  const run = Date.now().toString(36);
  const mk = (slug: string, extra: object = {}) =>
    prisma.workspace.create({ data: { slug: `bc-${slug}-${run}`, name: slug, businessName: slug, botEnabled: true, onboardingCompleted: true, plan: 'internal', planStatus: 'active', ...extra } });
  const D = await mk('d');
  const E = await mk('e', { plan: 'growth', planStatus: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000) });
  try {
    wire(D.id);
    wire(E.id);
    await saveServices(D.id, getTemplate('generic').services);
    await addContact(D.id, 'p1', 'Asha Rao', { lead: 'new' });
    await addContact(D.id, 'p2', 'Ben Cole', { lead: 'booked' });
    await addContact(D.id, 'p3', 'Cara', {}); // still answering
    await addContact(D.id, 'p4', 'Dev', { lead: 'new', optedOut: true });
    await addContact(D.id, 'p5', 'Old', { lead: 'new', daysAgo: 200 });
    await addContact(D.id, 'SIM-x', 'Sim', { lead: 'new' });

    console.log('[audience]');
    assert((await previewAudience(D.id, {})).count === 2, 'default audience: finished leads, not opted out, active within 90 days, no simulator contacts');
    assert((await previewAudience(D.id, { stages: ['booked'] })).count === 1, 'filter by stage');
    assert((await previewAudience(D.id, { includeAnswering: true })).count === 3, 'include people still answering');
    assert((await previewAudience(D.id, { activeWithinDays: 365 })).count === 3, 'longer activity window');
    assert((await previewAudience(D.id, { services: ['NOPE'] })).count === 0, 'filter by service');

    console.log('\n[message]');
    assert(renderMessage('Hi {name}, offer!', 'Asha Rao').startsWith('Hi Asha, offer!') && renderMessage('Hi {NAME}', null).startsWith('Hi there'), '{name} uses the first name');
    assert(renderMessage('x', 'A').endsWith('Reply STOP to unsubscribe.') && renderMessage('x. reply stop to unsubscribe', 'A').match(/unsubscribe/gi)!.length === 1, 'opt-out line always present, never duplicated');

    console.log('\n[sending]');
    let bc = await createBroadcast(D.id, 't', { name: 'Offer', text: 'Hi {name}, 10% off this week.' });
    assert(bc.status === 'draft' && bc.total === 2, 'draft created with the audience snapshot');
    await tick({ fast: true });
    assert(sent.length === 0, 'a draft sends nothing');
    await setStatus(D.id, bc.id, 'start');
    await tick({ fast: true });
    assert((await prisma.broadcast.findUniqueOrThrow({ where: { id: bc.id } })).sent === 1, 'one message per pass');
    await tick({ fast: true });
    await tick({ fast: true });
    bc = await prisma.broadcast.findUniqueOrThrow({ where: { id: bc.id } });
    assert(bc.status === 'done' && bc.sent === 2 && bc.finishedAt, 'finishes after the last recipient');
    assert(to(D.id, 'p1')[0].startsWith('Hi Asha,') && to(D.id, 'p1')[0].endsWith('Reply STOP to unsubscribe.'), 'personalised, with opt-out line');
    assert((await prisma.webhookLog.count({ where: { workspaceId: D.id, phoneNumber: 'p1', direction: 'OUTBOUND' } })) === 1, 'broadcast shows up in the customer thread');
    assert((await prisma.usage.findFirst({ where: { workspaceId: D.id } }))?.broadcasts === 2, 'messages counted against the monthly allowance');

    console.log('\n[opt-out]');
    await handleIncomingMessage(D.id, 'p1', 'Asha', 'STOP');
    assert((await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: D.id, phoneNumber: 'p1' } } }))?.optedOut === true && to(D.id, 'p1').at(-1)!.includes('unsubscribed'), 'STOP opts the customer out and confirms');
    assert((await previewAudience(D.id, {})).count === 1, 'opted-out customers leave the audience');
    const b2 = await createBroadcast(D.id, 't', { name: 'Second', text: 'Hello again' });
    await prisma.session.update({ where: { workspaceId_phoneNumber: { workspaceId: D.id, phoneNumber: 'p2' } }, data: { optedOut: true } });
    await setStatus(D.id, b2.id, 'start');
    await tick({ fast: true });
    const r2 = await prisma.broadcastRecipient.findFirst({ where: { broadcastId: b2.id } });
    assert(r2?.status === 'skipped' && r2.error === 'opted out' && to(D.id, 'p2').length === 1, 'someone who opts out after the list was built is skipped at send time');
    await handleIncomingMessage(D.id, 'p1', 'Asha', 'start');
    assert((await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: D.id, phoneNumber: 'p1' } } }))?.optedOut === false, 'START brings them back');

    console.log('\n[controls]');
    await prisma.session.update({ where: { workspaceId_phoneNumber: { workspaceId: D.id, phoneNumber: 'p2' } }, data: { optedOut: false } });
    const b3 = await createBroadcast(D.id, 't', { name: 'Third', text: 'Pausable' });
    await setStatus(D.id, b3.id, 'start');
    await setStatus(D.id, b3.id, 'pause');
    const n = sent.length;
    await tick({ fast: true });
    assert(sent.length === n, 'paused broadcasts do not send');
    let threw = false;
    try { await setStatus(D.id, b3.id, 'start'); } catch { threw = true; }
    assert(threw, 'cannot start a paused broadcast (resume instead)');
    await setStatus(D.id, b3.id, 'resume');
    ready = false;
    await tick({ fast: true });
    assert(sent.length === n, 'waits while WhatsApp is disconnected');
    ready = true;
    await setStatus(D.id, b3.id, 'cancel');
    await tick({ fast: true });
    assert(sent.length === n && (await prisma.broadcastRecipient.count({ where: { broadcastId: b3.id, status: 'skipped' } })) > 0, 'cancel stops the run and skips what is left');
    let t2 = false;
    try { await createBroadcast(D.id, 't', { name: 'x', text: 'y', filters: { services: ['NOPE'] } }); } catch { t2 = true; }
    assert(t2, 'refuses an empty audience');

    console.log('\n[schedule]');
    const b4 = await createBroadcast(D.id, 't', { name: 'Later', text: 'Scheduled', scheduleAt: new Date(Date.now() + 3_600_000).toISOString() });
    await tick({ fast: true });
    assert((await prisma.broadcast.findUniqueOrThrow({ where: { id: b4.id } })).status === 'scheduled', 'future schedule waits');
    await prisma.broadcast.update({ where: { id: b4.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await tick({ fast: true });
    assert((await prisma.broadcast.findUniqueOrThrow({ where: { id: b4.id } })).status === 'sending', 'due schedule starts');
    await setStatus(D.id, b4.id, 'cancel');

    console.log('\n[plan limit]');
    await saveServices(E.id, getTemplate('generic').services);
    await addContact(E.id, 'e1', 'Eve', { lead: 'new' });
    await prisma.usage.create({ data: { workspaceId: E.id, period: new Date().toISOString().slice(0, 7), broadcasts: 1000 } });
    const be = await createBroadcast(E.id, 't', { name: 'Over', text: 'Too many' });
    await setStatus(E.id, be.id, 'start');
    await tick({ fast: true });
    const after = await prisma.broadcast.findUniqueOrThrow({ where: { id: be.id } });
    assert(after.status === 'paused' && after.note.includes('allowance') && to(E.id, 'e1').length === 0, 'monthly allowance used up: paused with an explanation, nothing sent');
    await prisma.workspace.update({ where: { id: E.id }, data: { plan: 'pro', planStatus: 'inactive' } });
    invalidateConfig(E.id);
    await prisma.usage.deleteMany({ where: { workspaceId: E.id } });
    await setStatus(E.id, be.id, 'resume');
    await tick({ fast: true });
    assert((await prisma.broadcast.findUniqueOrThrow({ where: { id: be.id } })).note.includes('plan is not active'), 'inactive plan pauses broadcasts');

    console.log('\n[send window]');
    assert(inSendWindow('Asia/Kolkata', new Date('2026-03-01T04:30:00Z')) && !inSendWindow('Asia/Kolkata', new Date('2026-03-01T17:00:00Z')) && !inSendWindow('Asia/Kolkata', new Date('2026-03-01T01:00:00Z')), 'only 9:00-20:00 in the business time zone');
    assert(inSendWindow('Not/AZone', new Date('2026-03-01T10:00:00Z')), 'an invalid time zone falls back to UTC');

    console.log('\nBROADCAST TESTS PASSED');
  } finally {
    await prisma.workspace.deleteMany({ where: { id: { in: [D.id, E.id] } } });
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
