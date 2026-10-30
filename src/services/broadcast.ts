import { LINK_QUIET_DAYS, outsideLinkQuiet } from '../lib/quiet';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { loadConfig } from './botConfig';
import { sendTextMessage, transportReady } from './transport';
import { accessState } from '../plans';
import { admitBroadcast } from './usage';

export interface AudienceFilters {
  /** Pipeline stage keys; empty = any stage */
  stages?: string[];
  /** Service keys; empty = any service */
  services?: string[];
  /** Only customers who wrote in within this many days (default 90) */
  activeWithinDays?: number;
  /** Also include people who have not finished the questions (default: finished leads only) */
  includeAnswering?: boolean;
}

export const OPT_OUT_FOOTER = 'Reply STOP to unsubscribe.';
export const MAX_TEXT = 1000;
const DAILY_CAP = () => Number(process.env.BROADCAST_DAILY_CAP) || 150;
const SEND_FROM_HOUR = 9;
const SEND_TO_HOUR = 20;

const cleanList = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 60)).slice(0, 30) : []);

export function normalizeFilters(raw: any): Required<AudienceFilters> {
  const days = Math.floor(Number(raw?.activeWithinDays));
  return {
    stages: cleanList(raw?.stages),
    services: cleanList(raw?.services),
    activeWithinDays: Number.isFinite(days) && days >= 1 ? Math.min(days, 365) : 90,
    includeAnswering: !!raw?.includeAnswering && cleanList(raw?.stages).length === 0
  };
}

function audienceWhere(workspaceId: string, f: Required<AudienceFilters>): Prisma.SessionWhereInput {
  return {
    workspaceId,
    phoneNumber: { not: { startsWith: 'SIM-' } },
    optedOut: false,
    ...outsideLinkQuiet(),
    lastInteractionAt: { gte: new Date(Date.now() - f.activeWithinDays * 86_400_000) },
    ...(f.services.length ? { selectedService: { in: f.services } } : {}),
    ...(f.stages.length ? { lead: { is: { stageKey: { in: f.stages } } } } : f.includeAnswering ? {} : { lead: { isNot: null } })
  };
}

export async function previewAudience(workspaceId: string, raw: unknown) {
  const f = normalizeFilters(raw);
  const where = audienceWhere(workspaceId, f);
  const [count, sample] = await Promise.all([
    prisma.session.count({ where }),
    prisma.session.findMany({ where, orderBy: { lastInteractionAt: 'desc' }, take: 5, select: { contactName: true, phoneNumber: true } })
  ]);
  return { count, sample: sample.map((s) => ({ name: s.contactName, phone: s.phoneNumber })), filters: f };
}

/** {name} -> first name (or "there"); always ends with the opt-out line. */
export function renderMessage(template: string, name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'’.-]/gu, '').slice(0, 30) || 'there';
  let t = template.replace(/\{name\}/gi, first).trim();
  if (!t.toLowerCase().includes('stop to unsubscribe')) t += `\n\n${OPT_OUT_FOOTER}`;
  return t;
}

export async function createBroadcast(workspaceId: string, createdBy: string, body: { name?: string; text?: string; filters?: unknown; scheduleAt?: string | null }) {
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const text = String(body.text ?? '').replace(/\r/g, '').trim();
  if (!name) throw new Error('Give the broadcast a name');
  if (!text) throw new Error('Write the message to send');
  if (text.length > MAX_TEXT) throw new Error(`The message is longer than ${MAX_TEXT} characters`);
  let scheduledAt: Date | null = null;
  if (body.scheduleAt) {
    scheduledAt = new Date(body.scheduleAt);
    if (isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60_000) throw new Error('Pick a time in the future');
  }
  const f = normalizeFilters(body.filters);
  const sessions = await prisma.session.findMany({ where: audienceWhere(workspaceId, f), select: { phoneNumber: true, contactName: true }, take: 5000 });
  if (sessions.length === 0) throw new Error('No customers match these filters');
  return prisma.$transaction(async (tx) => {
    const b = await tx.broadcast.create({
      data: { workspaceId, name, text, filters: f as unknown as Prisma.InputJsonValue, createdBy, total: sessions.length, status: scheduledAt ? 'scheduled' : 'draft', scheduledAt }
    });
    await tx.broadcastRecipient.createMany({ data: sessions.map((s) => ({ broadcastId: b.id, phone: s.phoneNumber, name: s.contactName })) });
    return b;
  });
}

export async function setStatus(workspaceId: string, id: string, action: 'start' | 'pause' | 'resume' | 'cancel') {
  const b = await prisma.broadcast.findFirst({ where: { id, workspaceId } });
  if (!b) throw new Error('Broadcast not found');
  const allowed: Record<string, string[]> = { start: ['draft', 'scheduled'], pause: ['sending'], resume: ['paused'], cancel: ['draft', 'scheduled', 'sending', 'paused'] };
  if (!allowed[action].includes(b.status)) throw new Error(`Cannot ${action} a broadcast that is ${b.status}`);
  if (action === 'cancel') {
    await prisma.$transaction([
      prisma.broadcastRecipient.updateMany({ where: { broadcastId: id, status: 'pending' }, data: { status: 'skipped' } }),
      prisma.broadcast.update({ where: { id }, data: { status: 'canceled', finishedAt: new Date(), note: '' } })
    ]);
  } else {
    await prisma.broadcast.update({
      where: { id },
      data: { status: action === 'pause' ? 'paused' : 'sending', note: '', startedAt: b.startedAt ?? (action === 'start' ? new Date() : null), scheduledAt: action === 'start' ? null : b.scheduledAt }
    });
  }
  return prisma.broadcast.findUniqueOrThrow({ where: { id } });
}

// ---------- sending ----------

function localHour(tz: string, d = new Date()): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(d)) % 24;
  } catch {
    return d.getUTCHours();
  }
}
export const inSendWindow = (tz: string, d = new Date()) => {
  const h = localHour(tz, d);
  return h >= SEND_FROM_HOUR && h < SEND_TO_HOUR;
};

const nextAt = new Map<string, number>();
let busy = false;

export interface TickOptions {
  /** Tests: ignore the daytime window and the pause between messages */
  fast?: boolean;
}

/** One pass of the sender: starts due scheduled broadcasts and delivers at most one message per business. */
export async function tick(opts: TickOptions = {}): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await prisma.broadcast.updateMany({ where: { status: 'scheduled', scheduledAt: { lte: new Date() } }, data: { status: 'sending', startedAt: new Date(), scheduledAt: null } });
    const active = await prisma.broadcast.findMany({ where: { status: 'sending' }, orderBy: { createdAt: 'asc' } });
    const seen = new Set<string>();
    for (const b of active) {
      if (seen.has(b.workspaceId)) continue; // one broadcast per business at a time
      seen.add(b.workspaceId);
      await sendOne(b, opts);
    }
  } finally {
    busy = false;
  }
}

async function finishIfEmpty(id: string): Promise<boolean> {
  if ((await prisma.broadcastRecipient.count({ where: { broadcastId: id, status: 'pending' } })) > 0) return false;
  await prisma.broadcast.update({ where: { id }, data: { status: 'done', finishedAt: new Date(), note: '' } });
  return true;
}

async function pause(id: string, note: string) {
  await prisma.broadcast.update({ where: { id }, data: { status: 'paused', note } });
}

async function sendOne(b: { id: string; workspaceId: string; text: string }, opts: TickOptions): Promise<void> {
  const { ws } = await loadConfig(b.workspaceId);
  if (!accessState(ws).active) return pause(b.id, 'Paused: your plan is not active.');
  if (!transportReady(b.workspaceId)) return; // wait for WhatsApp to reconnect
  if (!opts.fast) {
    if (!inSendWindow(ws.timezone)) return; // keep to daytime hours in the business's time zone
    if ((nextAt.get(b.workspaceId) ?? 0) > Date.now()) return;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sentToday = await prisma.broadcastRecipient.count({ where: { status: 'sent', sentAt: { gte: startOfDay }, broadcast: { workspaceId: b.workspaceId } } });
    if (sentToday >= DAILY_CAP()) return; // resumes tomorrow
  }

  const r = await prisma.broadcastRecipient.findFirst({ where: { broadcastId: b.id, status: 'pending' }, orderBy: { id: 'asc' } });
  if (!r) {
    await finishIfEmpty(b.id);
    return;
  }
  // Re-check consent right before sending: they may have replied STOP since the list was built
  const session = await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: b.workspaceId, phoneNumber: r.phone } }, select: { optedOut: true, consultLinkSentAt: true } });
  const quiet = !!session?.consultLinkSentAt && session.consultLinkSentAt.getTime() > Date.now() - LINK_QUIET_DAYS * 86_400_000;
  if (!session || session.optedOut || quiet) {
    await prisma.broadcastRecipient.update({ where: { id: r.id }, data: { status: 'skipped', error: quiet ? 'consultation link sent this week' : 'opted out' } });
    await finishIfEmpty(b.id);
    return;
  }
  if (!(await admitBroadcast(ws))) return pause(b.id, "Paused: this month's broadcast allowance is used up. Upgrade your plan or resume next month.");

  try {
    await sendTextMessage(b.workspaceId, r.phone, renderMessage(b.text, r.name));
    await prisma.$transaction([
      prisma.broadcastRecipient.update({ where: { id: r.id }, data: { status: 'sent', sentAt: new Date() } }),
      prisma.broadcast.update({ where: { id: b.id }, data: { sent: { increment: 1 } } })
    ]);
  } catch (err) {
    await prisma.$transaction([
      prisma.broadcastRecipient.update({ where: { id: r.id }, data: { status: 'failed', error: String((err as Error).message).slice(0, 200) } }),
      prisma.broadcast.update({ where: { id: b.id }, data: { failed: { increment: 1 } } })
    ]);
    const recent = await prisma.broadcastRecipient.findMany({ where: { broadcastId: b.id, status: { in: ['sent', 'failed'] } }, orderBy: { id: 'desc' }, take: 5, select: { status: true } });
    if (recent.length === 5 && recent.every((x) => x.status === 'failed')) await pause(b.id, 'Paused: five messages in a row failed to send. Check your WhatsApp connection, then resume.');
  }
  // 8 to 20 seconds between messages keeps the pattern human
  nextAt.set(b.workspaceId, Date.now() + 8000 + Math.random() * 12_000);
  await finishIfEmpty(b.id);
}

export function startBroadcastWorker(): { stop(): void } {
  const t = setInterval(() => tick().catch((e) => console.error('[broadcast] tick failed:', e)), 4000);
  return { stop: () => clearInterval(t) };
}
