import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { sendTextMessage, transportReady } from './transport';
import { deliverAlert } from './alerts';
import { getStages } from './pipeline';
import { dispatchEvent } from './integrations';
import { logLeadEvent } from './crm';
import type { BotConfig } from './botConfig';

// ---------- secrets ----------

const appSecret = () => process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || '';
const key = () => crypto.createHash('sha256').update('calendar:' + appSecret()).digest();

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function decryptToken(blob: string): string {
  const [iv, tag, enc] = blob.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ---------- Google OAuth ----------

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const redirectUri = (publicUrl: string) => `${publicUrl.replace(/\/$/, '')}/admin/api/calendar/callback`;
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'];

const sign = (body: string) => crypto.createHmac('sha256', appSecret()).update('calendar-state:' + body).digest('base64url');

/** Signed, short-lived state so the callback knows which business started the connection. */
export function makeState(workspaceId: string): string {
  const body = Buffer.from(JSON.stringify({ w: workspaceId, exp: Date.now() + 10 * 60_000, n: crypto.randomBytes(6).toString('hex') })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readState(state: string): string | null {
  const [body, sig] = String(state ?? '').split('.');
  if (!body || !sig) return null;
  const want = sign(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { w?: string; exp?: number };
    return p.w && p.exp && p.exp > Date.now() ? p.w : null;
  } catch {
    return null;
  }
}

export function authUrl(workspaceId: string, publicUrl: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(publicUrl),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: makeState(workspaceId)
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

const TIMEOUT = 15_000;

async function googleJson<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.body && typeof rest.body === 'string' && rest.body.startsWith('{') ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(TIMEOUT)
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new Error(`Google ${res.status}: ${data?.error?.message ?? data?.error_description ?? data?.error ?? text.slice(0, 120)}`);
  return data as T;
}

const tokenForm = (params: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '', ...params }).toString()
});

/** Finishes the connection after Google sends the owner back with a code. */
export async function completeConnection(workspaceId: string, code: string, publicUrl: string): Promise<void> {
  const t = await googleJson<{ access_token: string; refresh_token?: string; id_token?: string; expires_in?: number }>(
    'https://oauth2.googleapis.com/token',
    tokenForm({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(publicUrl) })
  );
  if (!t.refresh_token) throw new Error('Google did not allow ongoing access. Remove this app from your Google account permissions and connect again.');
  let email = '';
  try {
    email = String(JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64url').toString('utf8')).email ?? '');
  } catch {
    /* the email is only shown to the owner */
  }
  const data = { refreshToken: encryptToken(t.refresh_token), googleEmail: email };
  await prisma.calendarConfig.upsert({ where: { workspaceId }, update: data, create: { workspaceId, ...data } });
  tokens.delete(workspaceId);
}

const tokens = new Map<string, { token: string; exp: number }>();

async function accessToken(workspaceId: string, refreshEnc: string): Promise<string> {
  const hit = tokens.get(workspaceId);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const t = await googleJson<{ access_token: string; expires_in?: number }>(
    'https://oauth2.googleapis.com/token',
    tokenForm({ grant_type: 'refresh_token', refresh_token: decryptToken(refreshEnc) })
  );
  tokens.set(workspaceId, { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

export async function disconnect(workspaceId: string): Promise<void> {
  const cfg = await prisma.calendarConfig.findUnique({ where: { workspaceId } });
  if (!cfg) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: decryptToken(cfg.refreshToken) }).toString(), signal: AbortSignal.timeout(TIMEOUT) });
  } catch {
    /* revoking is best-effort: the link is removed here either way */
  }
  await prisma.calendarConfig.delete({ where: { workspaceId } });
  tokens.delete(workspaceId);
  await prisma.session.updateMany({ where: { workspaceId }, data: { slotOffer: Prisma.DbNull } }).catch(() => undefined);
}

// ---------- time zones ----------

function offsetMinutes(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Wall-clock time in a zone to a UTC timestamp (handles daylight saving). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = offsetMinutes(guess, tz);
  let t = guess - off * 60000;
  const off2 = offsetMinutes(t, tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return t;
}

const safeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
};

export const formatSlot = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: safeZone(tz) }).format(d).replace(/\b(am|pm)\b/, (x) => x.toUpperCase());

// ---------- slots ----------

export interface Rules {
  slotMinutes: number;
  bufferMinutes: number;
  workDays: string;
  workStart: string;
  workEnd: string;
  noticeHours: number;
  daysAhead: number;
}
export interface Busy {
  start: number;
  end: number;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * Free start times within working hours, earliest first, at most two per day so the offer spans several days.
 * Pure: the caller supplies the busy intervals.
 */
export function generateSlots(now: number, tzRaw: string, r: Rules, busy: Busy[], limit = 40): Date[] {
  const tz = safeZone(tzRaw);
  const days = new Set(r.workDays.split(',').map(Number));
  const from = now + r.noticeHours * 3600_000;
  const slot = r.slotMinutes * 60_000;
  const buf = r.bufferMinutes * 60_000;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const out: Date[] = [];
  for (let i = 0; i <= r.daysAhead && out.length < limit; i++) {
    const day = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day + i));
    const iso = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (!days.has(iso)) continue;
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate();
    let taken = 0;
    for (let t = minutesOf(r.workStart); t + r.slotMinutes <= minutesOf(r.workEnd) && taken < 2; t += r.slotMinutes) {
      const start = zonedToUtc(y, mo, d, Math.floor(t / 60), t % 60, tz);
      if (start < from || start > now + r.daysAhead * 86_400_000 + 86_400_000) continue;
      if (busy.some((b) => start < b.end + buf && start + slot > b.start - buf)) continue;
      out.push(new Date(start));
      taken++;
    }
  }
  return out;
}

// ---------- Google Calendar calls ----------

async function busyTimes(cfg: { workspaceId: string; refreshToken: string; calendarId: string }, from: number, to: number): Promise<Busy[]> {
  const token = await accessToken(cfg.workspaceId, cfg.refreshToken);
  const res = await googleJson<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    token,
    body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: cfg.calendarId }] })
  });
  const mine = res.calendars?.[cfg.calendarId]?.busy ?? Object.values(res.calendars ?? {})[0]?.busy ?? [];
  return mine.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
}

async function ourBusy(workspaceId: string, from: number, to: number): Promise<Busy[]> {
  const rows = await prisma.appointment.findMany({ where: { workspaceId, status: 'confirmed', startsAt: { lt: new Date(to) }, endsAt: { gt: new Date(from) } } });
  return rows.map((a) => ({ start: a.startsAt.getTime(), end: a.endsAt.getTime() }));
}

export async function availableSlots(workspaceId: string, tz: string, now = Date.now()): Promise<Date[]> {
  const cfg = await prisma.calendarConfig.findUnique({ where: { workspaceId } });
  if (!cfg) return [];
  const to = now + (cfg.daysAhead + 2) * 86_400_000;
  const busy = [...(await busyTimes(cfg, now, to)), ...(await ourBusy(workspaceId, now, to))];
  return generateSlots(now, tz, cfg, busy);
}

const locks = new Map<string, Promise<unknown>>();
/** One booking at a time per business, so two customers cannot take the same slot. */
function exclusive<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(workspaceId) ?? Promise.resolve()).catch(() => undefined).then(fn);
  locks.set(workspaceId, run);
  return run;
}

export type BookResult = { ok: true; appointmentId: string; start: Date } | { ok: false; reason: 'taken' | 'unavailable' };

export function bookSlot(cfg: BotConfig, phone: string, name: string | null, start: Date, details: string): Promise<BookResult> {
  const workspaceId = cfg.ws.id;
  return exclusive(workspaceId, async () => {
    const cal = await prisma.calendarConfig.findUnique({ where: { workspaceId } });
    if (!cal) return { ok: false, reason: 'unavailable' } as const;
    const end = new Date(start.getTime() + cal.slotMinutes * 60_000);
    try {
      const busy = [...(await busyTimes(cal, start.getTime() - 3600_000, end.getTime() + 3600_000)), ...(await ourBusy(workspaceId, start.getTime() - 3600_000, end.getTime() + 3600_000))];
      const buf = cal.bufferMinutes * 60_000;
      if (busy.some((b) => start.getTime() < b.end + buf && end.getTime() > b.start - buf)) return { ok: false, reason: 'taken' } as const;
      const token = await accessToken(workspaceId, cal.refreshToken);
      const ev = await googleJson<{ id: string }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendarId)}/events`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          summary: `${name || 'Customer'} · ${cfg.ws.businessName}`,
          description: `Booked through WhatsApp by ${name || 'a customer'} (+${phone})\n\n${details}`.slice(0, 2000),
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() }
        })
      });
      const row = await prisma.appointment.create({ data: { workspaceId, phoneNumber: phone, name, startsAt: start, endsAt: end, googleEventId: ev.id } });
      return { ok: true, appointmentId: row.id, start } as const;
    } catch (err) {
      console.error('[calendar] booking failed:', (err as Error).message);
      void warnOwner(workspaceId, cfg.ws.businessName, (err as Error).message);
      return { ok: false, reason: 'unavailable' } as const;
    }
  });
}

const lastWarn = new Map<string, number>();
async function warnOwner(workspaceId: string, business: string, why: string): Promise<void> {
  if ((lastWarn.get(workspaceId) ?? 0) > Date.now() - 3600_000) return;
  lastWarn.set(workspaceId, Date.now());
  await deliverAlert(workspaceId, `⚠️ ${business}: calendar booking is not working`, `A customer tried to book but your Google Calendar did not respond (${why.slice(0, 160)}). Open Bot & Settings → Appointments and reconnect Google if this keeps happening.`);
}

/** Cancels an appointment and removes it from Google. Returns the cancelled row, or null. */
export async function cancelAppointment(workspaceId: string, id: string): Promise<{ phoneNumber: string; startsAt: Date } | null> {
  const a = await prisma.appointment.findFirst({ where: { id, workspaceId, status: 'confirmed' } });
  if (!a) return null;
  await prisma.appointment.update({ where: { id }, data: { status: 'canceled' } });
  const cal = await prisma.calendarConfig.findUnique({ where: { workspaceId } });
  if (cal && a.googleEventId) {
    try {
      const token = await accessToken(workspaceId, cal.refreshToken);
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendarId)}/events/${encodeURIComponent(a.googleEventId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
    } catch (err) {
      console.error('[calendar] could not remove the Google event:', (err as Error).message);
    }
  }
  return { phoneNumber: a.phoneNumber, startsAt: a.startsAt };
}

export const nextAppointment = (workspaceId: string, phone: string) =>
  prisma.appointment.findFirst({ where: { workspaceId, phoneNumber: phone, status: 'confirmed', startsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } });

// ---------- the booking conversation ----------

export const calendarConnected = async (workspaceId: string) => !!(await prisma.calendarConfig.findUnique({ where: { workspaceId }, select: { workspaceId: true } }));

const BOOK_RE = /\b(book|schedule|appointment|slot|slots|meeting|available|availability|fix a time|set up a call)\b/i;
// "How much is an appointment?" is a question for the AI, not a request for times
const PRICE_Q_RE = /\b(how much|fee|fees|cost|price|charges?|rate)\b/i;
const OFFER_TTL_MS = 30 * 60_000;
const ALREADY_RE = /already\s+booked|i\s+(have\s+)?booked|booking\s+done|booked\s+(a\s+)?(slot|consultation|appointment|call)/i;
const CANCEL_RE = /\b(cancel|reschedule)\b.{0,30}\b(appointment|booking|slot|meeting|call|it)\b/i;
const PAGE = 5;
const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

interface Offer {
  slots: string[];
  page: number;
  at: number;
}

/** Marks the lead as Booked unless it is already there or the team has closed it. Returns true if it moved. */
export async function markLeadBooked(workspaceId: string, phone: string, sessionId: string, reason: string, sideEffects = true): Promise<boolean> {
  const lead = await prisma.lead.findFirst({ where: { workspaceId, phoneNumber: phone }, select: { id: true, stageKey: true } });
  if (!lead) return false;
  const kind = (await getStages(workspaceId)).find((st) => st.key === lead.stageKey)?.kind ?? 'open';
  if (lead.stageKey === 'booked' || kind !== 'open') return false;
  await prisma.lead.update({ where: { id: lead.id }, data: { stageKey: 'booked' } });
  if (sideEffects) {
    void dispatchEvent(workspaceId, 'lead.stage_changed', sessionId, { previousStage: lead.stageKey });
    void logLeadEvent(lead.id, workspaceId, 'stage', `${lead.stageKey} → booked (${reason})`, 'bot');
  }
  return true;
}

function offerText(slots: Date[], tz: string, page: number, more: boolean): string {
  const lines = slots.map((d, i) => `${NUMBERS[i]} ${formatSlot(d, tz)}`);
  return [`Here are the next available times (${tz.replace(/_/g, ' ')}):`, ...lines, '', `Reply with a number to book${more ? ', or MORE for later times' : ''}.`].join('\n');
}

/**
 * Handles a message from a customer who has finished the questions, when the business has a calendar linked.
 * Returns true when it replied (the caller should stop), false when the message is not about booking.
 */
export async function handleBookingMessage(cfg: BotConfig, session: { id: string; phoneNumber: string; contactName: string | null; slotOffer: unknown; answers: unknown }, text: string, capturing: boolean): Promise<boolean> {
  const workspaceId = cfg.ws.id;
  const phone = session.phoneNumber;
  const tz = cfg.ws.timezone || 'UTC';
  const send = (body: string) => sendTextMessage(workspaceId, phone, body);
  const clearOffer = () => prisma.session.update({ where: { id: session.id }, data: { slotOffer: Prisma.DbNull } });
  const lower = text.toLowerCase().trim();
  const raw = (session.slotOffer ?? null) as Offer | null;
  // Times offered a while ago may be gone: a later "2" must not book them
  const offer = raw && raw.at && Date.now() - raw.at < OFFER_TTL_MS ? raw : null;

  const showSlots = async (page: number) => {
    let all: Date[];
    try {
      all = await availableSlots(workspaceId, tz);
    } catch (err) {
      console.error('[calendar] availability failed:', (err as Error).message);
      void warnOwner(workspaceId, cfg.ws.businessName, (err as Error).message);
      await send('Sorry, I cannot see our calendar right now. Our team will get back to you to fix a time.');
      return;
    }
    const slice = all.slice(page * PAGE, page * PAGE + PAGE);
    if (slice.length === 0) {
      await clearOffer();
      await send(page === 0 ? 'There are no free times in the coming days. Our team will get in touch to fix a time with you.' : 'That is all the times I have open for now. Our team can arrange another time if you need one.');
      return;
    }
    await prisma.session.update({ where: { id: session.id }, data: { slotOffer: { slots: slice.map((d) => d.toISOString()), page, at: Date.now() } satisfies Offer } });
    await send(offerText(slice, tz, page, all.length > (page + 1) * PAGE));
  };

  // Choosing from the list we just offered
  if (offer?.slots?.length) {
    const n = /^\s*([1-9])\s*[.)]?\s*$/.exec(text)?.[1];
    if (lower === 'more') {
      await showSlots(offer.page + 1);
      return true;
    }
    if (/^(no|none|cancel|later|skip|not now)$/.test(lower)) {
      await clearOffer();
      await send('No problem. Message me whenever you want to book a time.');
      return true;
    }
    if (n) {
      const pick = offer.slots[Number(n) - 1];
      if (!pick) {
        await send(`Please reply with a number from 1 to ${offer.slots.length}.`);
        return true;
      }
      if (capturing) {
        // The simulator must never put a real event in the owner's calendar
        await clearOffer();
        await send(`✅ (Simulator) Would book ${formatSlot(new Date(pick), tz)}. Nothing was added to the calendar.`);
        return true;
      }
      const existing = await nextAppointment(workspaceId, phone);
      if (existing) await cancelAppointment(workspaceId, existing.id); // choosing again replaces the earlier booking
      const start = new Date(pick);
      const answers = (session.answers ?? {}) as Record<string, string>;
      const details = Object.entries(answers).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v).slice(0, 200)}`).join('\n');
      const r = await bookSlot(cfg, phone, session.contactName, start, details);
      if (!r.ok) {
        if (r.reason === 'taken') {
          await send('Sorry, that time was just taken. Here are fresh options.');
          await showSlots(0);
        } else {
          await clearOffer();
          await send('Sorry, I could not complete the booking just now. Our team will contact you to fix a time.');
        }
        return true;
      }
      await clearOffer();
      const when = formatSlot(r.start, tz);
      const cal = await prisma.calendarConfig.findUnique({ where: { workspaceId } });
      await send(`✅ Booked: ${when} (${cal?.slotMinutes ?? 30} min). We will remind you before it starts. Reply CANCEL APPOINTMENT if you cannot make it.`);
      void markLeadBooked(workspaceId, phone, session.id, 'appointment booked');
      const lead = await prisma.lead.findFirst({ where: { workspaceId, phoneNumber: phone }, select: { id: true } });
      if (lead) void logLeadEvent(lead.id, workspaceId, 'appointment', `Booked ${when}`, 'bot');
      void deliverAlert(workspaceId, `📅 New appointment: ${session.contactName || 'a customer'}`, `${when}\n+${phone}${details ? '\n\n' + details : ''}`);
      return true;
    }
  }

  if (CANCEL_RE.test(text) && text.length < 120) {
    const a = await nextAppointment(workspaceId, phone);
    if (!a) return false;
    await cancelAppointment(workspaceId, a.id);
    const when = formatSlot(a.startsAt, tz);
    const resched = /reschedule/i.test(text);
    await send(resched ? `Cancelled your ${when} appointment. Let me find you another time.` : `Cancelled your appointment on ${when}. Message me any time to book another.`);
    if (!capturing) void deliverAlert(workspaceId, `❌ Appointment cancelled: ${session.contactName || phone}`, `The customer cancelled ${when}.`);
    if (resched) await showSlots(0);
    return true;
  }

  if (BOOK_RE.test(text) && !ALREADY_RE.test(text) && !(text.includes('?') && PRICE_Q_RE.test(text)) && text.length < 140) {
    const a = await nextAppointment(workspaceId, phone);
    if (a && !/\b(another|new|different|change)\b/i.test(text)) {
      await send(`You already have an appointment on ${formatSlot(a.startsAt, tz)}. Reply CANCEL APPOINTMENT to cancel it, or "new appointment" to pick another time.`);
      return true;
    }
    await showSlots(0);
    return true;
  }
  return false;
}

// ---------- reminders ----------

export async function reminderTick(now = Date.now()): Promise<number> {
  const due = await prisma.appointment.findMany({ where: { status: 'confirmed', reminderSent: false, startsAt: { gt: new Date(now), lt: new Date(now + 48 * 3600_000) } }, include: { workspace: { include: { calendar: true } } }, take: 50 });
  let sent = 0;
  for (const a of due) {
    const hours = a.workspace.calendar?.reminderHours ?? 0;
    if (hours <= 0 || a.startsAt.getTime() - now > hours * 3600_000) continue;
    if (!transportReady(a.workspaceId)) continue;
    try {
      await sendTextMessage(a.workspaceId, a.phoneNumber, `⏰ Reminder: your appointment with ${a.workspace.businessName} is at ${formatSlot(a.startsAt, a.workspace.timezone || 'UTC')}. Reply CANCEL APPOINTMENT if you cannot make it.`);
      await prisma.appointment.update({ where: { id: a.id }, data: { reminderSent: true } });
      sent++;
    } catch (err) {
      console.error('[calendar] reminder failed:', (err as Error).message);
    }
  }
  return sent;
}

export function startAppointmentWorker(): { stop(): void } {
  const t = setInterval(() => reminderTick().catch((e) => console.error('[calendar] reminder pass failed:', e)), 60_000);
  return { stop: () => clearInterval(t) };
}

// ---------- settings ----------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const whole = (v: unknown, min: number, max: number, label: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  return n;
};

/** Validates the booking rules an owner can change. Throws a readable Error. */
export function cleanRules(b: Record<string, unknown>): Partial<Rules & { reminderHours: number }> {
  const out: Partial<Rules & { reminderHours: number }> = {};
  if (b.slotMinutes !== undefined) out.slotMinutes = whole(b.slotMinutes, 10, 240, 'Appointment length');
  if (b.bufferMinutes !== undefined) out.bufferMinutes = whole(b.bufferMinutes, 0, 120, 'Break between appointments');
  if (b.noticeHours !== undefined) out.noticeHours = whole(b.noticeHours, 0, 168, 'Minimum notice');
  if (b.daysAhead !== undefined) out.daysAhead = whole(b.daysAhead, 1, 60, 'How far ahead customers can book');
  if (b.reminderHours !== undefined) out.reminderHours = whole(b.reminderHours, 0, 48, 'Reminder time');
  if (b.workDays !== undefined) {
    const days = [...new Set((Array.isArray(b.workDays) ? b.workDays : String(b.workDays).split(',')).map((x) => Number(x)))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 7).sort();
    if (days.length === 0) throw new Error('Choose at least one working day');
    out.workDays = days.join(',');
  }
  if (b.workStart !== undefined) {
    if (!HHMM.test(String(b.workStart))) throw new Error('Opening time must look like 09:00');
    out.workStart = String(b.workStart);
  }
  if (b.workEnd !== undefined) {
    if (!HHMM.test(String(b.workEnd))) throw new Error('Closing time must look like 18:00');
    out.workEnd = String(b.workEnd);
  }
  return out;
}
