import { SessionStage } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sendTextMessage, logMessage, isCapturing } from './transport';
import { answerFreeform } from './gemini';
import { accessState } from '../plans';
import { admitAiReply, admitConversation } from './usage';
import { notifyBooked, notifyNewLead } from './alerts';
import { dispatchEvent } from './integrations';
import { logLeadEvent } from './crm';
import { startHandoff, wantsHuman } from './handoff';
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

export async function handleIncomingMessage(
  workspaceId: string,
  phoneNumber: string,
  contactName: string | undefined,
  incomingText: string,
  messageId?: string
): Promise<void> {
  const text = incomingText.trim();
  if (!text) return;
  if (!isCapturing()) await logMessage(workspaceId, phoneNumber, 'INBOUND', text, messageId);
  const lower = text.toLowerCase();

  const cfg: BotConfig = await loadConfig(workspaceId);
  const send = (to: string, body: string) => sendTextMessage(workspaceId, to, body);
  const key = { workspaceId_phoneNumber: { workspaceId, phoneNumber } };

  /** Answer a side question via Gemini. Returns false if Gemini had nothing (not configured / failed). */
  const tryAnswer = async (question: string): Promise<boolean> => {
    // Over the plan's AI allowance the bot keeps to its fixed replies
    if (!isCapturing() && !(await admitAiReply(cfg.ws))) return false;
    const answer = await answerFreeform(cfg, question, cfg.ws.languageStep ? session?.language : null);
    if (!answer) return false;
    await send(phoneNumber, answer);
    return true;
  };

  // 1. Fetch or create session
  let session = await prisma.session.findUnique({ where: key });
  if (!session) {
    // Trial over / subscription lapsed, or this month's conversation allowance is used: do not start new chats
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

  /** Bot copy in the language the customer chose (businesses that ask for it); plain English otherwise */
  const speak = async (body: string) => send(phoneNumber, await localize(cfg, body, session!.language, isCapturing()));
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
  if (cfg.ws.languageStep && session.language && !offeredLanguages(cfg.ws.languages).includes(session.language) && !OPT_OUT_COMMANDS.includes(lower)) {
    session = await prisma.session.update({ where: key, data: { language: null, stage: SessionStage.AWAITING_LANGUAGE, selectedService: null, currentStep: 0, answers: {} } });
    await send(phoneNumber, languagePrompt(cfg));
    return;
  }

  // Customers can leave broadcast lists at any time; they can come back with START / MENU
  if (OPT_OUT_COMMANDS.includes(lower)) {
    await prisma.session.update({ where: key, data: { optedOut: true } });
    if (!session.isAgentPaused) await send(phoneNumber, "You have been unsubscribed from our updates. Reply START any time if you want to chat with us again.");
    return;
  }

  // The customer asks for a person: step back, tell them, and brief the team
  if (cfg.ws.handoffEnabled && wantsHuman(text)) {
    await speak(await startHandoff(cfg, workspaceId, phoneNumber, session.id, { capturing: isCapturing() }));
    return;
  }

  // Customers can change the language at any time (workspaces that ask for it)
  if (cfg.ws.languageStep && LANGUAGE_COMMANDS.includes(lower)) {
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
    await entry();
    return;
  }

  // 3. Stage state machine
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
        // A long closing message can be split into separate WhatsApp messages with a line of --- (easier to read than one huge block)
        for (const part of completionMessage(cfg, service.key, updatedAnswers).split(/\n\s*-{3,}\s*\n/)) {
          if (part.trim()) await speak(part.trim());
        }
        if (!isCapturing()) {
          void notifyNewLead(workspaceId, session.id);
          void dispatchEvent(workspaceId, 'lead.created', session.id);
        }
      }
      break;
    }

    case SessionStage.COMPLETED: {
      // A linked Google Calendar: offer real free times and book them
      if ((await calendarConnected(workspaceId)) && (await handleBookingMessage(cfg, session, text, isCapturing()))) return;
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
