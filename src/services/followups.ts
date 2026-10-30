import { SessionStage } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { accessState } from '../plans';
import { loadConfig, type BotConfig } from './botConfig';
import { inSendWindow } from './broadcast';
import { getStages } from './pipeline';
import { localize } from './language';
import { outsideLinkQuiet } from '../lib/quiet';
import { sendTextMessage, transportReady } from './transport';

/** Hours after the customer's last message at which a nudge may go out. */
export const FOLLOW_UP_HOURS = [24, 72];
const HOUR = 3_600_000;
/** Sessions that went quiet longer ago than the last step are left alone, so switching the feature on never messages old chats. */
const OLDEST_HOURS = FOLLOW_UP_HOURS[FOLLOW_UP_HOURS.length - 1] + 24;
const PER_TICK = 3;

export function followUpText(step: number, service: string): string {
  const what = service || 'your enquiry';
  return step === 0
    ? `Hello! Just checking in about ${what}. Do you have any questions, or would you like to speak to our team?`
    : `Hello! Are you still interested in ${what}? Reply here any time and we will help.`;
}

/** The step to send now: the latest one whose time has come (never several at once after a night or an outage), or null. */
export function dueStep(lastMessageAt: Date, alreadySent: number, now: number): number | null {
  const waited = (now - lastMessageAt.getTime()) / HOUR;
  let due: number | null = null;
  for (let i = alreadySent; i < FOLLOW_UP_HOURS.length; i++) if (waited >= FOLLOW_UP_HOURS[i]) due = i;
  return due;
}

/**
 * Sends the nudges that are due. A customer is left alone when: the business has not switched this on or is not live,
 * they said STOP, a person has taken over, the lead is won, lost or booked, or the plan has lapsed.
 * Messages go out only in daytime hours (the broadcast window of the business's time zone).
 */
export async function followUpTick(now = Date.now()): Promise<number> {
  const workspaces = await prisma.workspace.findMany({ where: { followUpsEnabled: true, botEnabled: true }, select: { id: true } });
  let sent = 0;
  for (const { id } of workspaces) {
    const cfg = await loadConfig(id);
    if (!accessState(cfg.ws).active || !transportReady(id) || !inSendWindow(cfg.ws.timezone, new Date(now))) continue;
    sent += await followUpWorkspace(cfg, now);
  }
  return sent;
}

async function followUpWorkspace(cfg: BotConfig, now: number): Promise<number> {
  const id = cfg.ws.id;
  const candidates = await prisma.session.findMany({
    where: {
      workspaceId: id,
      ...outsideLinkQuiet(now),
      optedOut: false,
      isAgentPaused: false,
      handoffAt: null,
      stage: { not: SessionStage.AGENT_TAKEOVER },
      followUpCount: { lt: FOLLOW_UP_HOURS.length },
      lastInteractionAt: { lte: new Date(now - FOLLOW_UP_HOURS[0] * HOUR), gte: new Date(now - OLDEST_HOURS * HOUR) }
    },
    include: { lead: { select: { stageKey: true } } },
    orderBy: { lastInteractionAt: 'asc' },
    take: 40
  });
  if (candidates.length === 0) return 0;
  // Won and lost stages (whatever the business calls them) and Booked mean there is nothing left to chase
  const closed = new Set((await getStages(id)).filter((s) => s.kind !== 'open').map((s) => s.key));
  closed.add('booked');

  let sent = 0;
  for (const s of candidates) {
    if (sent >= PER_TICK) break;
    if (s.lead && closed.has(s.lead.stageKey)) continue;
    const step = dueStep(s.lastInteractionAt, s.followUpCount, now);
    if (step === null) continue;
    // Claim first: two ticks can never send the same nudge, and a failing send is not retried in a loop
    const claimed = await prisma.session.updateMany({
      where: { id: s.id, followUpCount: s.followUpCount, lastInteractionAt: s.lastInteractionAt },
      data: { followUpCount: step + 1, lastFollowUpAt: new Date(now) }
    });
    if (claimed.count === 0) continue;
    try {
      const service = cfg.services.find((x) => x.key === s.selectedService)?.title ?? '';
      const text = await localize(cfg, followUpText(step, service), s.language, false);
      await sendTextMessage(id, s.phoneNumber, text);
      sent++;
    } catch (err) {
      console.error('[follow-up] could not send:', (err as Error).message);
    }
  }
  return sent;
}

export function startCustomerFollowUps(): { stop(): void } {
  const t = setInterval(() => followUpTick().catch((e) => console.error('[follow-up] pass failed:', e)), 60_000);
  return { stop: () => clearInterval(t) };
}
