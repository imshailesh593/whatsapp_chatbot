import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { summarizeForAgent } from './gemini';
import { deliverAlert } from './alerts';
import { logLeadEvent } from './crm';
import { admitAiReply } from './usage';
import type { BotConfig } from './botConfig';

// "talk to a person", "I want a real human", "call me", "customer care"... (English and common Hinglish). Not "call me": that is a normal answer to a question.
const PATTERNS = [
  /\b(talk|speak|chat|connect|transfer|put\s+me|get\s+me)\b.{0,25}\b(person|human|agent|representative|executive|advis[eo]r|counsel+or|manager|owner|staff|someone|somebody|team\s*member)\b/i,
  /\b(real|live|actual)\s+(person|human|agent)\b/i,
  /\b(human|representative)\s*(please|pls|plz)?\s*[.!]?$/i,
  /\bcustomer\s+(care|support|service)\b/i,
  /\b(need|want)\b.{0,20}\b(human|real person|someone)\b/i,
  /\b(insaan|aadmi|admi|banda|kisi|manager|sir|madam|team)\s+se\s+(baat|bat)\b/i
];

/** True when the customer is asking for a person rather than the bot. Short messages only: a long paragraph that happens to mention "agent" is not a request. */
export function wantsHuman(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 200) return false;
  return PATTERNS.some((re) => re.test(t));
}

export const defaultHandoffMessage = () => 'Of course. I have asked our team to take over, and a person will reply here shortly. Thank you for your patience.';

interface Turn {
  who: 'Customer' | 'Bot';
  text: string;
}

async function recentTurns(workspaceId: string, phone: string): Promise<Turn[]> {
  const rows = await prisma.webhookLog.findMany({ where: { workspaceId, phoneNumber: phone }, orderBy: { createdAt: 'desc' }, take: 16 });
  return rows
    .reverse()
    .map((r) => ({ who: (r.direction === 'INBOUND' ? 'Customer' : 'Bot') as Turn['who'], text: String((r.payload as { text?: string } | null)?.text ?? '').slice(0, 400) }))
    .filter((t) => t.text);
}

const pretty = (k: string) => k.replace(/_/g, ' ');

/** A summary that needs no AI: what we collected plus what the customer said last. */
export function plainSummary(name: string | null, answers: Record<string, string>, turns: Turn[]): string {
  const lines: string[] = [];
  const said = turns.filter((t) => t.who === 'Customer').slice(-3).map((t) => `"${t.text.slice(0, 160)}"`);
  if (Object.keys(answers).length) lines.push('Answers so far: ' + Object.entries(answers).slice(0, 8).map(([k, v]) => `${pretty(k)}: ${String(v).slice(0, 80)}`).join('; '));
  if (said.length) lines.push('Recent messages: ' + said.join(' · '));
  return lines.join('\n') || `${name || 'The customer'} asked to talk to a person.`;
}

/**
 * The customer asked for a person. Pauses the bot for that chat, tells the customer, then (in the background)
 * writes a short briefing and alerts the team. Returns the reply to send.
 */
export async function startHandoff(cfg: BotConfig, workspaceId: string, phone: string, sessionId: string, opts: { capturing: boolean }): Promise<string> {
  await prisma.session.update({ where: { id: sessionId }, data: { isAgentPaused: true, handoffAt: new Date(), handoffSummary: '', slotOffer: Prisma.DbNull } });
  if (!opts.capturing) void briefTeam(cfg, workspaceId, phone, sessionId);
  return cfg.ws.handoffMessage.trim() || defaultHandoffMessage();
}

async function briefTeam(cfg: BotConfig, workspaceId: string, phone: string, sessionId: string): Promise<void> {
  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { lead: true } });
    if (!session) return;
    const answers = ((session.lead ? session.lead.collectedData : session.answers) ?? {}) as Record<string, string>;
    const turns = await recentTurns(workspaceId, phone);
    let summary: string | null = null;
    if (turns.length && (await admitAiReply(cfg.ws))) summary = await summarizeForAgent(cfg, turns, answers);
    summary = summary || plainSummary(session.contactName, answers, turns);
    await prisma.session.update({ where: { id: sessionId }, data: { handoffSummary: summary.slice(0, 1500) } });
    if (session.lead) void logLeadEvent(session.lead.id, workspaceId, 'handoff', 'Customer asked for a person; bot paused', 'bot');
    const who = `${session.contactName || 'A customer'} · ${/^\d+$/.test(phone) ? '+' + phone : phone}`;
    const link = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    await deliverAlert(
      workspaceId,
      `🙋 ${who} wants to talk to a person`,
      `${summary}\n\nThe bot is paused for this chat. Reply to them on WhatsApp, then switch the bot back on in the dashboard when you are done.${link ? `\nOpen: ${link}/admin/` : ''}`
    );
  } catch (err) {
    console.error('[handoff] could not brief the team:', (err as Error).message);
  }
}
