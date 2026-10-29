import { prisma } from '../lib/prisma';
import { loadConfig } from './botConfig';
import { accessState } from '../plans';
import { deliverAlert } from './alerts';

export type LeadEventType = 'created' | 'stage' | 'owner' | 'tags' | 'follow_up' | 'note' | 'handoff' | 'appointment';

export async function logLeadEvent(leadId: string, workspaceId: string, type: LeadEventType, detail = '', actor = 'bot'): Promise<void> {
  try {
    await prisma.leadEvent.create({ data: { leadId, workspaceId, type, detail: detail.slice(0, 300), actor: actor.slice(0, 120) } });
  } catch (err) {
    console.error('[crm] could not log lead event:', (err as Error).message);
  }
}

/** Tags are short lowercase words; blanks and duplicates are dropped. */
export function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error('Tags must be a list');
  const out: string[] = [];
  for (const t of input) {
    const v = String(t).toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').trim().replace(/\s+/g, '-').slice(0, 24);
    if (v && !out.includes(v)) out.push(v);
  }
  if (out.length > 10) throw new Error('At most 10 tags per lead');
  return out;
}

/** Sends a reminder for every lead whose follow-up time has come. */
export async function followUpTick(): Promise<number> {
  const due = await prisma.lead.findMany({
    where: { followUpAt: { lte: new Date() }, followUpNotified: false },
    include: { session: { select: { contactName: true, phoneNumber: true } } },
    take: 50
  });
  let sent = 0;
  for (const l of due) {
    // Mark first so a slow or failing channel can never cause a reminder storm
    const claimed = await prisma.lead.updateMany({ where: { id: l.id, followUpNotified: false }, data: { followUpNotified: true } });
    if (claimed.count === 0) continue;
    const { ws } = await loadConfig(l.workspaceId);
    if (!accessState(ws).active) continue;
    const owner = l.ownerId ? await prisma.adminUser.findUnique({ where: { id: l.ownerId }, select: { email: true } }) : null;
    const who = l.session.contactName || 'A lead';
    const phone = /^\d+$/.test(l.session.phoneNumber) ? '+' + l.session.phoneNumber : l.session.phoneNumber;
    await deliverAlert(l.workspaceId, `⏰ Follow-up due: ${who}`, `${who} · ${phone}${l.counsellorNotes ? `\nNotes: ${l.counsellorNotes.slice(0, 300)}` : ''}${owner ? `\nOwner: ${owner.email}` : ''}`, owner?.email);
    sent++;
  }
  return sent;
}

export function startFollowUpWorker(): { stop(): void } {
  const t = setInterval(() => followUpTick().catch((e) => console.error('[crm] follow-up pass failed:', e)), 60_000);
  return { stop: () => clearInterval(t) };
}
