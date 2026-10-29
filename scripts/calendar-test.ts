// Google Calendar booking: slot maths, token handling, and the WhatsApp booking conversation against a fake Google.
// Usage: npx tsx scripts/calendar-test.ts   (needs DATABASE_URL)
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'testtoken';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csecret';
process.env.GEMINI_API_KEY = '';
import { prisma } from '../src/lib/prisma';
import { setTransport, captureReplies } from '../src/services/transport';
import { handleIncomingMessage } from '../src/services/engine';
import { saveServices, invalidateConfig } from '../src/services/botConfig';
import { getTemplate } from '../src/templates';
import {
  encryptToken, decryptToken, makeState, readState, zonedToUtc, generateSlots, formatSlot, encryptToken as enc, reminderTick, cleanRules, completeConnection, authUrl, disconnect
} from '../src/services/calendar';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const sent: { ws: string; to: string; text: string }[] = [];
const replies = (ws: string, to: string) => sent.filter((s) => s.ws === ws && s.to === to).map((s) => s.text);

// ---- a fake Google ----
const calls: { method: string; url: string; body: any }[] = [];
let busy: { start: string; end: string }[] = [];
let failBusy = false;
let eventSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url);
  if (!/google|oauth2/.test(u)) return realFetch(url, init);
  const body = typeof init.body === 'string' ? (init.body.startsWith('{') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : null;
  calls.push({ method: init.method ?? 'GET', url: u, body });
  const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status });
  if (u.includes('oauth2.googleapis.com/token')) {
    if (body.grant_type === 'authorization_code') {
      const id = Buffer.from(JSON.stringify({ email: 'owner@clinic.test' })).toString('base64url');
      return json(body.code === 'norefresh' ? { access_token: 'at' } : { access_token: 'at1', refresh_token: 'rt1', id_token: `x.${id}.y`, expires_in: 3600 });
    }
    return json({ access_token: 'at-' + body.refresh_token, expires_in: 3600 });
  }
  if (u.includes('oauth2.googleapis.com/revoke')) return json({});
  if (u.endsWith('/freeBusy')) {
    if (failBusy) return json({ error: { message: 'boom' } }, 500);
    return json({ calendars: { primary: { busy } } });
  }
  if (u.includes('/events') && init.method === 'POST') return json({ id: 'ev' + ++eventSeq });
  if (u.includes('/events/') && init.method === 'DELETE') return new Response(null, { status: 204 });
  return json({}, 404);
}) as any;

(async () => {
  console.log('[time zones and slots]');
  ok(new Date(zonedToUtc(2026, 11, 4, 10, 0, 'Asia/Kolkata')).toISOString() === '2026-11-04T04:30:00.000Z', '10:00 in India is 04:30 UTC');
  ok(new Date(zonedToUtc(2026, 11, 2, 9, 0, 'America/New_York')).toISOString() === '2026-11-02T14:00:00.000Z', 'daylight saving is respected (New York, after the clocks change)');
  ok(new Date(zonedToUtc(2026, 10, 30, 9, 0, 'America/New_York')).toISOString() === '2026-10-30T13:00:00.000Z', '...and before it');
  const rules = { slotMinutes: 30, bufferMinutes: 0, workDays: '1,2,3,4,5', workStart: '09:00', workEnd: '18:00', noticeHours: 4, daysAhead: 14 };
  const now = Date.parse('2026-11-04T04:00:00Z'); // Wed 4 Nov, 09:30 in India
  const slots = generateSlots(now, 'Asia/Kolkata', rules, []);
  ok(slots.length > 0 && slots.every((d) => d.getTime() >= now + 4 * 3600_000), 'nothing is offered inside the minimum notice');
  ok(slots[0].toISOString() === '2026-11-04T08:00:00.000Z', 'first slot is 13:30 India time today (09:30 + 4h notice)');
  const perDay = new Map<string, number>();
  for (const d of slots) {
    const day = formatSlot(d, 'Asia/Kolkata').split(',').slice(0, 2).join(',');
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  ok([...perDay.values()].every((n) => n <= 2), 'at most two slots per day, so an offer spans several days');
  ok(!slots.some((d) => [0, 6].includes(new Date(d.getTime() + 5.5 * 3600_000).getUTCDay())), 'weekends are skipped');
  const blocked = generateSlots(now, 'Asia/Kolkata', rules, [{ start: Date.parse('2026-11-04T08:00:00Z'), end: Date.parse('2026-11-04T09:00:00Z') }]);
  ok(blocked[0].toISOString() === '2026-11-04T09:00:00.000Z', 'a busy period is skipped');
  const buffered = generateSlots(now, 'Asia/Kolkata', { ...rules, bufferMinutes: 30 }, [{ start: Date.parse('2026-11-04T08:00:00Z'), end: Date.parse('2026-11-04T08:30:00Z') }]);
  ok(buffered[0].toISOString() === '2026-11-04T09:00:00.000Z', 'the break between appointments is kept');
  ok(generateSlots(now, 'Not/AZone', rules, []).length > 0, 'an unknown time zone falls back to UTC instead of crashing');

  console.log('\n[tokens and sign-in state]');
  const blob = encryptToken('refresh-secret');
  ok(blob !== 'refresh-secret' && !blob.includes('refresh-secret') && decryptToken(blob) === 'refresh-secret', 'refresh tokens are stored encrypted');
  ok(enc('x') !== enc('x'), 'encryption is salted per value');
  let tampered = false;
  try { decryptToken(blob.slice(0, -2) + 'AA'); } catch { tampered = true; }
  ok(tampered, 'a tampered token is rejected');
  const st = makeState('ws-1');
  ok(readState(st) === 'ws-1', 'sign-in state round-trips');
  ok(readState(st.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))) === null && readState('garbage') === null && readState('') === null, 'forged or missing state is refused');
  ok(authUrl('ws-1', 'https://x.example').includes('access_type=offline') && authUrl('ws-1', 'https://x.example').includes(encodeURIComponent('https://x.example/admin/api/calendar/callback')), 'consent link asks for offline access and uses the callback URL');

  console.log('\n[settings validation]');
  const bad = (b: any) => { try { cleanRules(b); return false; } catch { return true; } };
  ok(bad({ slotMinutes: 5 }) && bad({ slotMinutes: 'x' }) && bad({ workDays: [] }) && bad({ workStart: '9am' }) && bad({ daysAhead: 400 }), 'out-of-range or malformed settings are refused');
  ok(cleanRules({ workDays: [5, 1, 1, 9], slotMinutes: 45 }).workDays === '1,5', 'working days are cleaned and sorted');

  console.log('\n[booking conversation]');
  const run = Date.now().toString(36);
  const W = await prisma.workspace.create({
    data: { slug: `cal-${run}`, name: 'Clinic', businessName: 'Calm Clinic', timezone: 'Asia/Kolkata', botEnabled: true, onboardingCompleted: true, plan: 'internal', planStatus: 'active', notifyPhone: '919000000009' }
  });
  try {
    setTransport(W.id, { sendText: async (to, text) => void sent.push({ ws: W.id, to, text }), ready: () => true });
    await saveServices(W.id, getTemplate('generic').services);
    const finish = async (phone: string, name: string) => {
      await handleIncomingMessage(W.id, phone, name, 'hi');
      await handleIncomingMessage(W.id, phone, name, '1');
      for (let i = 0; i < 3; i++) await handleIncomingMessage(W.id, phone, name, `answer ${i}`);
    };
    const p1 = `9161${run}`;
    await finish(p1, 'Asha');
    const before = replies(W.id, p1).length;
    await handleIncomingMessage(W.id, p1, 'Asha', 'I want to book an appointment');
    ok(!replies(W.id, p1).slice(before).some((t) => t.includes('Reply with a number')), 'no calendar linked: the bot does not offer times');

    // connect through the OAuth completion path
    await completeConnection(W.id, 'good-code', 'https://bot.example');
    let cfg = await prisma.calendarConfig.findUnique({ where: { workspaceId: W.id } });
    ok(!!cfg && cfg.googleEmail === 'owner@clinic.test' && cfg.refreshToken !== 'rt1' && decryptToken(cfg.refreshToken) === 'rt1', 'connecting stores the account email and an encrypted refresh token');
    const exch = calls.find((c) => c.body?.grant_type === 'authorization_code')!;
    ok(exch.body.redirect_uri === 'https://bot.example/admin/api/calendar/callback' && exch.body.client_secret === 'csecret', 'the code is exchanged server-side with the callback URL');
    let noRefresh = '';
    try { await completeConnection(W.id, 'norefresh', 'https://bot.example'); } catch (e) { noRefresh = (e as Error).message; }
    ok(/ongoing access/.test(noRefresh), 'Google returning no refresh token gives a clear error');
    invalidateConfig(W.id);

    await handleIncomingMessage(W.id, p1, 'Asha', 'hello, can I book a slot?');
    let offer = replies(W.id, p1).at(-1)!;
    ok(offer.includes('Reply with a number to book') && offer.includes('1️⃣') && offer.includes('5️⃣') && offer.includes('MORE'), 'asking to book returns five numbered times');
    ok(offer.includes('Asia/Kolkata'), 'times are shown in the business time zone');
    ok(!!(await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: p1 } }))!.slotOffer, 'the offered times are remembered');
    const fb = calls.filter((c) => c.url.endsWith('/freeBusy')).at(-1)!;
    ok(fb.body.items[0].id === 'primary', 'availability is read from Google free/busy');

    await handleIncomingMessage(W.id, p1, 'Asha', '9');
    ok(/number from 1 to 5/.test(replies(W.id, p1).at(-1)!), 'a number outside the list is corrected');
    await handleIncomingMessage(W.id, p1, 'Asha', 'more');
    const page2 = replies(W.id, p1).at(-1)!;
    ok(page2.includes('1️⃣') && page2 !== offer, 'MORE shows later times');
    await handleIncomingMessage(W.id, p1, 'Asha', 'book an appointment');
    offer = replies(W.id, p1).at(-1)!;

    // someone else takes the first time while Asha is deciding
    const offered = (await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: p1 } }))!.slotOffer as { slots: string[] };
    const first = new Date(offered.slots[0]);
    busy = [{ start: first.toISOString(), end: new Date(first.getTime() + 1800_000).toISOString() }];
    await handleIncomingMessage(W.id, p1, 'Asha', '1');
    ok(/just taken/.test(replies(W.id, p1).at(-2)!) && replies(W.id, p1).at(-1)!.includes('Reply with a number'), 'a time taken in the meantime is refused and fresh options are offered');
    ok(!calls.some((c) => c.url.includes('/events') && c.method === 'POST'), 'nothing was created in the calendar for the taken slot');
    busy = [];

    const offered2 = (await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: p1 } }))!.slotOffer as { slots: string[] };
    await handleIncomingMessage(W.id, p1, 'Asha', '2');
    await new Promise((r) => setTimeout(r, 400));
    const done = replies(W.id, p1).at(-1)!;
    ok(done.startsWith('✅ Booked:') && done.includes('CANCEL APPOINTMENT'), 'the customer gets a confirmation');
    const ev = calls.filter((c) => c.url.includes('/events') && c.method === 'POST').at(-1)!;
    ok(ev.body.start.dateTime === offered2.slots[1] && /Asha/.test(ev.body.summary) && ev.body.description.includes('answer 0'), 'the Google event has the chosen time, the customer and their answers');
    const appt = await prisma.appointment.findFirst({ where: { workspaceId: W.id, phoneNumber: p1, status: 'confirmed' } });
    ok(!!appt && appt.googleEventId === 'ev1' && appt.startsAt.toISOString() === offered2.slots[1], 'the appointment is recorded with its Google event id');
    ok((await prisma.lead.findFirst({ where: { workspaceId: W.id, phoneNumber: p1 } }))!.stageKey === 'booked', 'the lead moves to Booked');
    ok(replies(W.id, '919000000009').some((t) => t.includes('New appointment') && t.includes('Asha')), 'the owner is alerted');
    ok(!(await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: p1 } }))!.slotOffer, 'the offer is cleared after booking');

    await handleIncomingMessage(W.id, p1, 'Asha', 'can I schedule a meeting');
    ok(/already have an appointment/.test(replies(W.id, p1).at(-1)!), 'a second booking request points to the existing appointment');
    await handleIncomingMessage(W.id, p1, 'Asha', 'I have already booked');
    ok(!replies(W.id, p1).at(-1)!.includes('Reply with a number'), '"I have already booked" is not treated as a request for times');

    // a second customer cannot take the same time
    const p2 = `9162${run}`;
    await finish(p2, 'Bala');
    await handleIncomingMessage(W.id, p2, 'Bala', 'appointment please');
    const o3 = (await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: p2 } }))!.slotOffer as { slots: string[] };
    ok(!o3.slots.includes(offered2.slots[1]), 'a booked time is no longer offered to others');

    // two customers pick the same time at once: only one wins
    const p3 = `9163${run}`;
    await finish(p3, 'Chen');
    await handleIncomingMessage(W.id, p3, 'Chen', 'appointment please');
    await prisma.session.updateMany({ where: { workspaceId: W.id, phoneNumber: { in: [p2, p3] } }, data: { slotOffer: { slots: [o3.slots[0]], page: 0 } } });
    await Promise.all([handleIncomingMessage(W.id, p2, 'Bala', '1'), handleIncomingMessage(W.id, p3, 'Chen', '1')]);
    const taken = await prisma.appointment.count({ where: { workspaceId: W.id, startsAt: new Date(o3.slots[0]), status: 'confirmed' } });
    ok(taken === 1, 'simultaneous bookings of one time: exactly one succeeds');

    // cancelling
    const delBefore = calls.filter((c) => c.method === 'DELETE').length;
    await handleIncomingMessage(W.id, p1, 'Asha', 'cancel appointment');
    ok(/Cancelled your appointment/.test(replies(W.id, p1).at(-1)!), 'the customer can cancel');
    ok(calls.filter((c) => c.method === 'DELETE').length === delBefore + 1 && calls.at(-1)!.url.endsWith('/events/ev1'), 'the Google event is deleted');
    ok((await prisma.appointment.findFirst({ where: { workspaceId: W.id, phoneNumber: p1 } }))!.status === 'canceled', 'the appointment is marked cancelled');
    ok(replies(W.id, '919000000009').some((t) => t.includes('Appointment cancelled')), 'the owner is told');
    await handleIncomingMessage(W.id, p1, 'Asha', 'cancel appointment');
    ok(!replies(W.id, p1).at(-1)!.startsWith('Cancelled'), 'with nothing to cancel the bot does not claim it did');

    // simulator never touches the calendar
    const evBefore = calls.filter((c) => c.url.includes('/events') && c.method === 'POST').length;
    const sim = `SIM-${run}`;
    await captureReplies(async () => {
      await handleIncomingMessage(W.id, sim, 'Sim', 'hi');
      await handleIncomingMessage(W.id, sim, 'Sim', '1');
      for (let i = 0; i < 3; i++) await handleIncomingMessage(W.id, sim, 'Sim', `a${i}`);
      await handleIncomingMessage(W.id, sim, 'Sim', 'book appointment');
      await handleIncomingMessage(W.id, sim, 'Sim', '1');
    });
    ok(calls.filter((c) => c.url.includes('/events') && c.method === 'POST').length === evBefore, 'the test chat never creates a real calendar event');

    // Google down
    failBusy = true;
    const p4 = `9164${run}`;
    await finish(p4, 'Dev');
    await handleIncomingMessage(W.id, p4, 'Dev', 'book appointment');
    ok(/cannot see our calendar/.test(replies(W.id, p4).at(-1)!), 'Google failing gives the customer a graceful message');
    await new Promise((r) => setTimeout(r, 300));
    ok(replies(W.id, '919000000009').some((t) => t.includes('calendar booking is not working')), 'and the owner is warned');
    failBusy = false;

    // reminders
    cfg = await prisma.calendarConfig.update({ where: { workspaceId: W.id }, data: { reminderHours: 2 } });
    const soon = await prisma.appointment.create({ data: { workspaceId: W.id, phoneNumber: p2, name: 'Bala', startsAt: new Date(Date.now() + 90 * 60_000), endsAt: new Date(Date.now() + 120 * 60_000) } });
    const far = await prisma.appointment.create({ data: { workspaceId: W.id, phoneNumber: p3, name: 'Chen', startsAt: new Date(Date.now() + 20 * 3600_000), endsAt: new Date(Date.now() + 21 * 3600_000) } });
    ok((await reminderTick()) >= 1, 'a reminder goes out when the appointment is within the reminder window');
    ok(replies(W.id, p2).some((t) => t.startsWith('⏰ Reminder')), 'the reminder reaches the customer');
    ok((await prisma.appointment.findUnique({ where: { id: far.id } }))!.reminderSent === false, 'an appointment further away is left alone');
    const n = replies(W.id, p2).length;
    await reminderTick();
    ok(replies(W.id, p2).length === n && (await prisma.appointment.findUnique({ where: { id: soon.id } }))!.reminderSent, 'each reminder is sent once');

    // disconnect
    await disconnect(W.id);
    ok(!(await prisma.calendarConfig.findUnique({ where: { workspaceId: W.id } })) && calls.some((c) => c.url.includes('/revoke')), 'disconnecting removes the link and revokes access at Google');
    const m = replies(W.id, p1).length;
    await handleIncomingMessage(W.id, p1, 'Asha', 'appointment please');
    ok(!replies(W.id, p1).slice(m).some((t) => t.includes('Reply with a number')), 'after disconnecting the bot stops offering times');
  } finally {
    setTransport(W.id, null);
    await prisma.workspace.delete({ where: { id: W.id } });
    globalThis.fetch = realFetch;
  }
  console.log('\nCALENDAR TESTS OK');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
