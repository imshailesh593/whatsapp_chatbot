import { SessionStage } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { admitAiReply } from './usage';
import { notifyAiDown, notifyBooked, notifyNewLead } from './alerts';
import { dispatchEvent } from './integrations';
import { logLeadEvent } from './crm';
import { startHandoff } from './handoff';
import { localize } from './language';
import { calendarConnected, handleBookingMessage, markLeadBooked } from './calendar';
import { channelOf } from '../lib/channel';
import { bookingReminderMessage, completionMessage, type BotConfig } from './botConfig';
import {
  AgentError,
  agentAvailable,
  applyTurn,
  contactFooter,
  footerRecentlySent,
  formMessage,
  runAgentTurn,
  type Turn
} from './agent';

/**
 * Runs one customer message through the AI conversation (see agent.ts for the rules the model is held to) and carries out
 * the result: sends the reply, keeps the session's service and answers up to date, creates the lead when the last question
 * is answered, and attaches the fixed messages (form link, the team's closing message, contact details, booking link).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** People type in bursts: wait a moment so one answer is written for several quick messages, like a person reading them. */
const waitMs = () => (process.env.AI_REPLY_WAIT_MS !== undefined ? Number(process.env.AI_REPLY_WAIT_MS) || 0 : 2500);

const latestMessage = new Map<string, number>();
let counter = 0;

/** The dashboard simulator delivers nothing and logs nothing, so its chat history is kept here (cleared with its Reset button). */
const simHistory = new Map<string, Turn[]>();
const historyKey = (workspaceId: string, phone: string) => `${workspaceId}|${phone}`;
export const clearSimHistory = (workspaceId: string, phone: string) => void simHistory.delete(historyKey(workspaceId, phone));
const remember = (workspaceId: string, phone: string, who: Turn['who'], text: string) => {
  const k = historyKey(workspaceId, phone);
  const list = simHistory.get(k) ?? [];
  list.push({ who, text });
  simHistory.set(k, list.slice(-40));
};

/** Is the AI conversation on for this business, and able to run? Otherwise the fixed menu flow answers. */
export const aiModeOn = (cfg: BotConfig) => cfg.ws.aiConversation && agentAvailable();

async function loadHistory(workspaceId: string, phone: string, capturing: boolean): Promise<Turn[]> {
  if (capturing) return [...(simHistory.get(historyKey(workspaceId, phone)) ?? [])];
  const rows = await prisma.webhookLog.findMany({ where: { workspaceId, phoneNumber: phone }, orderBy: { createdAt: 'desc' }, take: 30 });
  return rows
    .reverse()
    .map((r) => ({ who: (r.direction === 'INBOUND' ? 'Customer' : 'You') as Turn['who'], text: String((r.payload as { text?: string } | null)?.text ?? '') }))
    .filter((t) => t.text.trim());
}

const stringAnswers = (raw: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries((raw ?? {}) as Record<string, unknown>).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim()) as [string, string][]);

export const HICCUP_MESSAGE = 'Sorry, I had a small hiccup there. Could you send that once more?';

/**
 * What a customer gets while the AI cannot answer (no credit, outage, timeout). The old menu flow must not take over an AI
 * conversation: it reads the chat's stage as its own and answers with canned lines. So: one useful message with the way to
 * go ahead (the booking link when there is one), nothing about a callback, not repeated, and the team is told.
 */
export const outageMessage = (cfg: BotConfig) =>
  cfg.ws.bookingUrl.trim()
    ? `Thanks for your message! ${bookingReminderMessage(cfg)}`
    : "Thanks for your message! I can't answer this properly right now, but our team can see it here.";

const OUTAGE_QUIET_MS = 12 * 60 * 60 * 1000;

async function outageAlreadySent(workspaceId: string, phone: string, capturing: boolean, text: string): Promise<boolean> {
  if (capturing) return (simHistory.get(historyKey(workspaceId, phone)) ?? []).some((t) => t.who === 'You' && t.text === text);
  const rows = await prisma.webhookLog.findMany({
    where: { workspaceId, phoneNumber: phone, direction: 'OUTBOUND', createdAt: { gte: new Date(Date.now() - OUTAGE_QUIET_MS) } },
    select: { payload: true }
  });
  return rows.some((r) => (r.payload as { text?: string } | null)?.text === text);
}

/** A message that ends with the owner's own sign-off ("Anything else?") is complete: nothing is added under it. */
export const isSignedOff = (text: string) => /anything else\s*\?[\s*_]*$/i.test(text.trim());

export interface AiTurnArgs {
  cfg: BotConfig;
  workspaceId: string;
  phone: string;
  text: string;
  /** Delivers one WhatsApp message (or collects it in the simulator) */
  send: (to: string, body: string) => Promise<void>;
  capturing: boolean;
  /** The customer typed MENU or RESET: greet them afresh */
  freshStart?: boolean;
}

/**
 * Returns true when the message was dealt with (answered, or deliberately left to a later message of the same burst),
 * false when the plan's AI allowance is used up, so the fixed menu flow should answer instead.
 */
export async function handleAiTurn(a: AiTurnArgs): Promise<boolean> {
  const { cfg, workspaceId, phone, capturing } = a;
  const k = historyKey(workspaceId, phone);
  if (capturing) remember(workspaceId, phone, 'Customer', a.text);

  const mine = ++counter;
  latestMessage.set(k, mine);
  if (!capturing && waitMs() > 0) {
    await sleep(waitMs());
    if (latestMessage.get(k) !== mine) return true; // a newer message arrived; its turn will answer them all
  }

  const key = { workspaceId_phoneNumber: { workspaceId, phoneNumber: phone } };
  const session = await prisma.session.findUnique({ where: key });
  if (!session || session.isAgentPaused || session.stage === SessionStage.AGENT_TAKEOVER) return true;
  if (!capturing && !(await admitAiReply(cfg.ws))) return false;

  // what was said so far, and what the customer has sent since our last reply
  const history = await loadHistory(workspaceId, phone, capturing);
  let cut = history.length;
  while (cut > 0 && history[cut - 1].who === 'Customer') cut--;
  const before = history.slice(0, cut);
  const latest = history.slice(cut).map((t) => t.text);
  if (latest.length === 0) latest.push(a.text);

  const service = cfg.services.find((s) => s.key === session.selectedService) ?? null;
  const answers = stringAnswers(session.answers);
  const wasCompleted = session.stage === SessionStage.COMPLETED && !!service;
  const calendarOn = await calendarConnected(workspaceId);

  const out = async (body: string) => {
    if (!body.trim()) return;
    await a.send(phone, body);
    if (capturing) remember(workspaceId, phone, 'You', body);
  };

  let turn;
  try {
    turn = await runAgentTurn(
      { cfg, service, answers, completed: wasCompleted, language: session.language, calendarOn, firstReply: !before.some((t) => t.who === 'You'), freshStart: a.freshStart, channel: channelOf(phone) },
      before,
      latest
    );
  } catch (err) {
    const e = err as AgentError;
    console.error(`[ai ${workspaceId.slice(0, 8)}] turn failed (${e.kind}):`, e.message.slice(0, 200));
    // The AI could not answer (no credit, outage, timeout). The chat's stage and answers stay as they are, so the AI picks up where it left off
    if (e.kind !== 'bad_output') {
      const fallback = outageMessage(cfg);
      if (!(await outageAlreadySent(workspaceId, phone, capturing, fallback))) await out(fallback);
      if (!capturing) void notifyAiDown(workspaceId, phone, a.text, e.message);
      return true;
    }
    // The AI answered with something unusable twice: say so once instead of going quiet, but never repeat the apology back to back
    if (before[before.length - 1]?.text !== HICCUP_MESSAGE) await out(HICCUP_MESSAGE);
    return true;
  }
  if (turn.removed.length) console.warn(`[ai ${workspaceId.slice(0, 8)}] reply cleaned: ${turn.removed.join('; ')}`);

  const customerCorpus = [...before.filter((t) => t.who === 'Customer').map((t) => t.text), ...latest].join('\n');
  const applied = applyTurn({ cfg, service, answers, completed: wasCompleted, language: session.language }, turn, customerCorpus);
  if (applied.rejected.length) console.warn(`[ai ${workspaceId.slice(0, 8)}] answers refused (not in what the customer said): ${applied.rejected.join(', ')}`);

  // the fixed wording (the team's own closing text, links, contact details) in the customer's language when they chose one
  const fixed = (body: string) => localize({ ...cfg, ws: { ...cfg.ws, languageStep: true } }, body, applied.language, capturing);

  const questions = applied.service?.questions ?? [];
  const firstOpen = questions.findIndex((q) => !applied.answers[q.key]);
  const stage = !applied.service ? SessionStage.AWAITING_SERVICE_SELECTION : applied.completed ? SessionStage.COMPLETED : SessionStage.IN_QUESTIONNAIRE;
  const justCompleted = applied.completed && (!wasCompleted || applied.switched);
  const state = {
    stage,
    selectedService: applied.service?.key ?? null,
    currentStep: firstOpen === -1 ? questions.length : firstOpen,
    answers: applied.answers,
    language: applied.language
  };

  // The customer asks for a person: step back (only the team's own hand-off message goes out)
  if (turn.action === 'handoff' && cfg.ws.handoffEnabled) {
    await prisma.session.update({ where: key, data: state });
    await out(await fixed(await startHandoff(cfg, workspaceId, phone, session.id, { capturing })));
    return true;
  }

  let leadId: string | null = null;
  if (justCompleted && applied.service) {
    const [, lead] = await prisma.$transaction([
      prisma.session.update({ where: key, data: state }),
      prisma.lead.upsert({
        where: { sessionId: session.id },
        update: { serviceCategory: applied.service.key, collectedData: applied.answers },
        create: { workspaceId, sessionId: session.id, phoneNumber: phone, serviceCategory: applied.service.key, collectedData: applied.answers }
      })
    ]);
    leadId = lead.id;
    if (!capturing) void logLeadEvent(lead.id, workspaceId, 'created', applied.service.title, 'bot');
  } else {
    await prisma.session.update({ where: key, data: state });
  }

  // 1. the reply, in the AI's own words (never silent: fall back to the owner's wording of the next question)
  let reply = turn.reply;
  if (!reply && turn.action === 'none') {
    reply = firstOpen >= 0 ? await fixed(questions[firstOpen].prompt) : 'Thanks for your message. Our team will follow up with you shortly.';
  }
  await out(reply);

  // 2. fixed messages the system attaches
  if (!before.some((t) => t.who === 'You') && cfg.ws.formUrl.trim()) await out(await fixed(formMessage(cfg)));

  if (justCompleted && applied.service) {
    // the team's own summary (fees, inclusions, next steps), then how to reach them
    const closing = completionMessage(cfg, applied.service.key, applied.answers);
    for (const part of closing.split(/\n\s*-{3,}\s*\n/)) if (part.trim()) await out(await fixed(part.trim()));
    const url = cfg.ws.bookingUrl.trim();
    // the team's closing text that already gives the link, or signs off, gets nothing added under it
    const complete = isSignedOff(closing) || (!!url && closing.includes(url));
    const footer = complete ? '' : contactFooter(cfg);
    if (footer) await out(await fixed(footer));
    if (!capturing && leadId) {
      void notifyNewLead(workspaceId, session.id);
      void dispatchEvent(workspaceId, 'lead.created', session.id);
    }
    return true;
  }

  // 3. what the customer asked for
  const hasBooking = !!cfg.ws.bookingUrl.trim();
  if (turn.action === 'book' && calendarOn) {
    const fresh = await prisma.session.findUnique({ where: key });
    if (fresh && (await handleBookingMessage(cfg, fresh, 'book an appointment', capturing))) return true;
  }
  // a reply that asks something (such as the time that suits them) or signs off is left as it is
  const addLink = hasBooking && !reply.includes(cfg.ws.bookingUrl.trim()) && !isSignedOff(reply) && !(turn.action === 'book' && /\?\s*$/.test(reply));
  if ((turn.action === 'share_booking_link' || turn.action === 'book') && addLink) {
    await out(await fixed(bookingReminderMessage(cfg)));
  } else if (turn.action === 'booked' && hasBooking && applied.completed) {
    const moved = await markLeadBooked(workspaceId, phone, session.id, 'customer confirmed', !capturing);
    if (!capturing && moved) void notifyBooked(workspaceId, phone);
  } else if (turn.action === 'wrap_up' && !isSignedOff(reply) && !footerRecentlySent(cfg, [...before, ...(reply ? [{ who: 'You' as const, text: reply }] : [])])) {
    // the conversation is ending (even if the customer leaves before the last question): the team's number, and the priority 1:1 booking link
    const footer = contactFooter(cfg);
    if (footer) await out(await fixed(footer));
  }
  return true;
}
