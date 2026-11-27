import { SessionStage } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { batchReplies, sendTextMessage, logMessage, isCapturing } from './transport';
import { answerFreeform } from './gemini';
import { aiModeOn, handleAiTurn } from './aiChat';
import { accessState } from '../plans';
import { admitAiReply, admitConversation } from './usage';
import { notifyBooked, notifyNewLead } from './alerts';
import { dispatchEvent } from './integrations';
import { logLeadEvent } from './crm';
import { askedIfBot, botIdentityReply, startHandoff, wantsHuman } from './handoff';
import { languageFallbackMessage, languageHintMessage, languagePrompt, localize, offeredLanguages, parseLanguage } from './language';
import { calendarConnected, handleBookingMessage, markLeadBooked } from './calendar';
import {
  loadConfig,
  resolveService,
  welcomeMessage,
  menuOnlyMessage,
  menuPrompt,
  invalidSelectionMessage,
  completionMessage,
  bookingReminderMessage,
  postCompletionMessage,
  bookedConfirmationMessage,
  type BotConfig
} from './botConfig';

const RESET_COMMANDS = ['reset', 'menu', 'restart', 'start'];
const OPT_OUT_COMMANDS = ['stop', 'unsubscribe', 'stop all'];
const LANGUAGE_COMMANDS = ['language', 'change language', 'lang', 'भाषा'];
// The consultation link goes out only when the customer asks for more information, a detailed talk or to book (fee questions are answered, not redirected)
const BOOK_COMMAND_RE = /^(book|book now|book appointment|book an appointment|book a call|book a consultation|schedule|schedule a call)$/i;
const ALREADY_BOOKED_RE = /already\s+booked|i\s+(have\s+)?booked|booking\s+done/i;
const MORE_INFO_RE = /\bconsultation\b|\bappointment\b|\bbook(ing)?\b|\bmore\s+(info|information|details)\b|\bmore\b\W*$|know more|tell me more|\bdiscuss\b|\bcounsel(l)?(ing|or)?\b|jaankari|janakari|one[- ]to[- ]one/i;
const BOOKED_RE = /already\s+booked|i\s+(have\s+)?booked|booking\s+done|booked\s+(a\s+)?(slot|consultation|appointment|call)/i;

// A question mark, or a plain price question typed without one ("DHA fees", "ielts price", "kitna charge")
const PRICE_RE = /\b(fees?|prices?|pricing|cost|costs|charges?|how much|kitna|kitne)\b/i;
export const looksLikeQuestion = (t: string) => t.length > 3 && (t.includes('?') || PRICE_RE.test(t));

/** True when the most recent message we sent to this chat was exactly `text` (avoids repeating ourselves). */
async function lastReplyWas(workspaceId: string, phone: string, text: string): Promise<boolean> {
  if (isCapturing()) return false;
  const last = await prisma.webhookLog.findFirst({
    where: { workspaceId, phoneNumber: phone, direction: 'OUTBOUND' },
    orderBy: { createdAt: 'desc' }
  });
  return (last?.payload as { text?: string } | null)?.text === text;
}

/** The last few messages of this chat (oldest first), without the one being answered, so the AI keeps the thread of the conversation. */
async function recentChat(workspaceId: string, phone: string, current: string): Promise<{ role: 'user' | 'model'; text: string }[]> {
  if (isCapturing()) return [];
  const rows = await prisma.webhookLog.findMany({ where: { workspaceId, phoneNumber: phone }, orderBy: { createdAt: 'desc' }, take: 8 });
  const turns = rows
    .reverse()
    .map((r) => ({ role: (r.direction === 'INBOUND' ? 'user' : 'model') as 'user' | 'model', text: String((r.payload as { text?: string } | null)?.text ?? '').trim() }))
    .filter((t) => t.text);
  if (turns.length && turns[turns.length - 1].role === 'user' && turns[turns.length - 1].text === current) turns.pop();
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

/**
 * One incoming message, one reply: whatever the conversation says in answer (a side answer and the next question, say) is
 * merged into a single WhatsApp message, never two or three in a row.
 * `inboundLogged` is set when the caller already stored the customer's message(s) in the chat log.
 */
export function handleIncomingMessage(
  workspaceId: string,
  phoneNumber: string,
  contactName: string | undefined,
  incomingText: string,
  messageId?: string,
  inboundLogged = false
): Promise<void> {
  return batchReplies(workspaceId, phoneNumber, () => processIncoming(workspaceId, phoneNumber, contactName, incomingText, messageId, inboundLogged));
}

async function processIncoming(
  workspaceId: string,
  phoneNumber: string,
  contactName: string | undefined,
  incomingText: string,
  messageId: string | undefined,
  inboundLogged: boolean
): Promise<void> {
  const text = incomingText.trim();
  if (!text) return;
  if (!isCapturing() && !inboundLogged) await logMessage(workspaceId, phoneNumber, 'INBOUND', text, messageId);
  const lower = text.toLowerCase();

  const cfg: BotConfig = await loadConfig(workspaceId);
  const bookingUrl = cfg.ws.bookingUrl.trim();
  const send = async (to: string, body: string) => {
    await sendTextMessage(workspaceId, to, body);
    // The consultation link went out: leave this customer alone (no follow-ups, no broadcasts) for a week
    if (bookingUrl && body.includes(bookingUrl) && !isCapturing()) await prisma.session.updateMany({ where: { workspaceId, phoneNumber: to }, data: { consultLinkSentAt: new Date() } });
  };
  const key = { workspaceId_phoneNumber: { workspaceId, phoneNumber } };

  /** Answer a side question via Gemini. Returns false if Gemini had nothing (not configured / failed). */
  const tryAnswer = async (question: string): Promise<boolean> => {
    // Over the plan's AI allowance the bot keeps to its fixed replies
    if (!isCapturing() && !(await admitAiReply(cfg.ws))) return false;
    const answer = await answerFreeform(cfg, question, cfg.ws.languageStep ? session?.language : null, await recentChat(workspaceId, phoneNumber, question));
    if (!answer) return false;
    await send(phoneNumber, answer);
    return true;
  };

  // 1. Fetch or create session
  let session = await prisma.session.findUnique({ where: key });
  if (!session) {
    // Not paid yet / subscription lapsed, or this month's conversation allowance is used: do not start new chats
    if (!isCapturing() && (!accessState(cfg.ws).active || !(await admitConversation(cfg.ws)))) return;
    // A click-to-chat link can carry a campaign tag: "... (ref: summer24)"
    const source = /\(ref:\s*([A-Za-z0-9_-]{1,30})\)/i.exec(text)?.[1]?.toLowerCase() ?? null;
    session = await prisma.session.create({ data: { workspaceId, phoneNumber, contactName: contactName || null, source } });
  } else {
    await prisma.session.update({ where: key, data: { lastInteractionAt: new Date(), followUpCount: 0 } });
  }

  // A human agent has taken over, or the workspace has not gone live yet: suppress automated replies
  if (session.isAgentPaused || session.stage === SessionStage.AGENT_TAKEOVER) return;
  if (!cfg.ws.botEnabled && !isCapturing()) return;
  if (!isCapturing() && !accessState(cfg.ws).active) return;
  if (cfg.services.length === 0) return;
  // The whole conversation is written by the AI around the business's questions; without it (switched off, no key, plan allowance used) the fixed menu flow below answers
  const aiOn = aiModeOn(cfg);

  /** Bot copy in the language the customer chose (businesses that ask for it); plain English otherwise */
  const speak = async (body: string) => {
    // A line of --- in a message written by the owner is now just a paragraph break: the customer gets one message
    const one = body.replace(/\n\s*-{3,}\s*\n/g, '\n\n').trim();
    if (one) await send(phoneNumber, await localize(cfg, one, session!.language, isCapturing()));
  };
  /** The first thing a customer sees: the language question (when the business asks it and they have not answered yet), else the menu */
  const entry = async () => {
    if (cfg.ws.languageStep && !session!.language) {
      await prisma.session.update({ where: key, data: { stage: SessionStage.AWAITING_LANGUAGE } });
      await send(phoneNumber, languagePrompt(cfg));
    } else if (cfg.ws.languageStep) {
      await speak(menuOnlyMessage(cfg));
    } else {
      await send(phoneNumber, welcomeMessage(cfg));
    }
  };

  // A language this business does not offer (an old wrong answer, or the list changed): ask again instead of translating into it
  if (!aiOn && cfg.ws.languageStep && session.language && !offeredLanguages(cfg.ws.languages).includes(session.language) && !OPT_OUT_COMMANDS.includes(lower)) {
    session = await prisma.session.update({ where: key, data: { language: null, stage: SessionStage.AWAITING_LANGUAGE, selectedService: null, currentStep: 0, answers: {} } });
    await send(phoneNumber, languagePrompt(cfg));
    return;
  }

  // Customers can leave broadcast lists at any time; they can come back with START / MENU
  if (OPT_OUT_COMMANDS.includes(lower)) {
    await prisma.session.update({ where: key, data: { optedOut: true } });
    if (!session.isAgentPaused) await send(phoneNumber, "Done, you're unsubscribed. Just message START whenever you'd like to chat again.");
    return;
  }

  // "Are you a bot?" / "is this a real person?": answered honestly and warmly, and a person is offered. It is not a hand-off request.
  if (askedIfBot(text)) {
    await speak(botIdentityReply(cfg));
    return;
  }

  // The customer asks for a person: step back, tell them, and brief the team
  if (cfg.ws.handoffEnabled && wantsHuman(text)) {
    await speak(await startHandoff(cfg, workspaceId, phoneNumber, session.id, { capturing: isCapturing() }));
    return;
  }

  // Customers can change the language at any time (workspaces that ask for it)
  if (!aiOn && cfg.ws.languageStep && LANGUAGE_COMMANDS.includes(lower)) {
    await prisma.session.update({ where: key, data: { stage: SessionStage.AWAITING_LANGUAGE, language: null, selectedService: null, currentStep: 0, answers: {} } });
    session.language = null;
    await send(phoneNumber, languagePrompt(cfg));
    return;
  }

  // 2. Global reset commands
  if (RESET_COMMANDS.includes(lower)) {
    await prisma.session.update({
      where: key,
      data: { stage: SessionStage.AWAITING_SERVICE_SELECTION, selectedService: null, currentStep: 0, answers: {}, optedOut: false }
    });
    if (aiOn && (await handleAiTurn({ cfg, workspaceId, phone: phoneNumber, text: 'Hi', send, capturing: isCapturing(), freshStart: true }))) return;
    await entry();
    return;
  }

  // A customer in the middle of picking a date or a time: their number or MORE / BACK belongs to the booking, whatever stage the chat is in
  if (session.slotOffer && (await calendarConnected(workspaceId)) && (await handleBookingMessage(cfg, session, text, isCapturing()))) return;
  // BOOK on its own starts booking from the menu too
  if (session.stage === SessionStage.AWAITING_SERVICE_SELECTION && BOOK_COMMAND_RE.test(lower) && (await calendarConnected(workspaceId)) && (await handleBookingMessage(cfg, session, 'book an appointment', isCapturing()))) return;

  // 3. The AI conversation (replies, questions, lead, booking and hand-off all follow from what the customer writes)
  if (aiOn && (await handleAiTurn({ cfg, workspaceId, phone: phoneNumber, text, send, capturing: isCapturing() }))) return;

  // Stage state machine of the fixed menu flow
  switch (session.stage) {
    case SessionStage.WELCOME: {
      await prisma.session.update({ where: key, data: { stage: SessionStage.AWAITING_SERVICE_SELECTION } });
      await entry();
      break;
    }

    case SessionStage.AWAITING_LANGUAGE: {
      // The business stopped asking for a language: carry on with the menu
      if (!cfg.ws.languageStep) {
        await prisma.session.update({ where: key, data: { stage: SessionStage.AWAITING_SERVICE_SELECTION, language: null, answers: {} } });
        await send(phoneNumber, welcomeMessage(cfg));
        break;
      }
      const parsed = parseLanguage(text, offeredLanguages(cfg.ws.languages));
      // A reply that is not a language ("Hy", "hello", a question) gets one hint; a second miss carries on in English
      const misses = Number((session.answers as Record<string, unknown> | null)?._lang_misses ?? 0);
      if (!parsed && misses < 1) {
        await prisma.session.update({ where: key, data: { answers: { _lang_misses: misses + 1 } } });
        await send(phoneNumber, languageHintMessage(cfg));
        return;
      }
      const language = parsed ?? 'English';
      await prisma.session.update({ where: key, data: { stage: SessionStage.AWAITING_SERVICE_SELECTION, language, answers: {} } });
      session.language = language;
      if (!parsed) await send(phoneNumber, languageFallbackMessage());
      await speak(menuOnlyMessage(cfg));
      break;
    }

    case SessionStage.AWAITING_SERVICE_SELECTION: {
      const serviceKey = resolveService(cfg, text);
      if (!serviceKey) {
        if (looksLikeQuestion(text) && (await tryAnswer(text))) {
          await speak(menuPrompt(cfg));
        } else {
          await speak(invalidSelectionMessage(cfg));
        }
        return;
      }

      await prisma.session.update({
        where: key,
        data: { stage: SessionStage.IN_QUESTIONNAIRE, selectedService: serviceKey, currentStep: 0, answers: {} }
      });
      await speak(cfg.services.find((s) => s.key === serviceKey)!.questions[0].prompt);
      break;
    }

    case SessionStage.IN_QUESTIONNAIRE: {
      const service = cfg.services.find((s) => s.key === session!.selectedService);
      const questions = service?.questions;
      if (!service || !questions || session.currentStep >= questions.length) {
        // Corrupt state (or the menu was edited): restart the funnel instead of crashing
        await prisma.session.update({
          where: key,
          data: { stage: SessionStage.AWAITING_SERVICE_SELECTION, selectedService: null, currentStep: 0, answers: {} }
        });
        await entry();
        return;
      }

      const step = session.currentStep;

      // A side question mid-flow: answer it, then repeat the pending question (answer not consumed)
      if (looksLikeQuestion(text) && (await tryAnswer(text))) {
        await speak(questions[step].prompt);
        return;
      }

      const updatedAnswers = { ...(session.answers as Record<string, string>), [questions[step].key]: text };
      const nextStep = step + 1;

      if (nextStep < questions.length) {
        await prisma.session.update({ where: key, data: { currentStep: nextStep, answers: updatedAnswers } });
        await speak(questions[nextStep].prompt);
      } else {
        const [, newLead] = await prisma.$transaction([
          prisma.session.update({
            where: key,
            data: { stage: SessionStage.COMPLETED, currentStep: nextStep, answers: updatedAnswers }
          }),
          prisma.lead.upsert({
            where: { sessionId: session.id },
            update: { serviceCategory: service.key, collectedData: updatedAnswers },
            create: {
              workspaceId,
              sessionId: session.id,
              phoneNumber,
              serviceCategory: service.key,
              collectedData: updatedAnswers
            }
          })
        ]);
        if (!isCapturing()) void logLeadEvent(newLead.id, workspaceId, 'created', service.title, 'bot');
        await speak(completionMessage(cfg, service.key, updatedAnswers));
        if (!isCapturing()) {
          void notifyNewLead(workspaceId, session.id);
          void dispatchEvent(workspaceId, 'lead.created', session.id);
        }
      }
      break;
    }

    case SessionStage.COMPLETED: {
      // A linked Google Calendar: offer real free times and book them
      const calendarOn = await calendarConnected(workspaceId);
      // With booking on, "more info" means the customer wants a consultation: offer dates instead of a link
      const bookingText = calendarOn && !looksLikeQuestion(text) && MORE_INFO_RE.test(lower) && !ALREADY_BOOKED_RE.test(text) && !/\b(cancel|reschedule)\b/i.test(lower) ? 'book an appointment' : text;
      if (calendarOn && (await handleBookingMessage(cfg, session, bookingText, isCapturing()))) return;
      const hasBooking = !!cfg.ws.bookingUrl.trim();
      if (hasBooking && BOOKED_RE.test(text)) {
        // Move the lead to "Booked" unless it is already there or has been closed (won / lost) by the team
        const moved = await markLeadBooked(workspaceId, phoneNumber, session.id, 'customer confirmed', !isCapturing());
        await speak(bookedConfirmationMessage());
        if (!isCapturing() && moved) void notifyBooked(workspaceId, phoneNumber);
      } else if (hasBooking && MORE_INFO_RE.test(lower)) {
        await speak(bookingReminderMessage(cfg));
      } else if (looksLikeQuestion(text) && (await tryAnswer(text))) {
        // answered a genuine question
      } else if (/^(h+i+|he+y+|hello+w?|hlo+|hy|namaste|good (morning|afternoon|evening))[\s!.,]*$/i.test(lower)) {
        // A fresh hello starts afresh
        await prisma.session.update({ where: key, data: { stage: SessionStage.AWAITING_SERVICE_SELECTION, selectedService: null, currentStep: 0, answers: {} } });
        await entry();
      } else if (resolveService(cfg, text)) {
        // They are asking for something on the menu: take them into it
        const serviceKey = resolveService(cfg, text)!;
        await prisma.session.update({ where: key, data: { stage: SessionStage.IN_QUESTIONNAIRE, selectedService: serviceKey, currentStep: 0, answers: {} } });
        await speak(cfg.services.find((s) => s.key === serviceKey)!.questions[0].prompt);
      } else {
        const ack = await localize(cfg, postCompletionMessage(), session.language, isCapturing());
        if (!(await lastReplyWas(workspaceId, phoneNumber, ack))) await send(phoneNumber, ack);
      }
      // otherwise stay quiet: the same acknowledgement was already the last thing we sent
      break;
    }

    default:
      await entry();
  }
}
