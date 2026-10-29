import { SessionStage } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sendTextMessage, logMessage, isCapturing } from './transport';
import { answerFreeform } from './gemini';
import { accessState } from '../plans';
import { admitAiReply, admitConversation } from './usage';
import { notifyBooked, notifyNewLead } from './alerts';
import { getStages } from './pipeline';
import { dispatchEvent } from './integrations';
import { logLeadEvent } from './crm';
import {
  loadConfig,
  resolveService,
  welcomeMessage,
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
const BOOKED_RE = /already\s+booked|i\s+(have\s+)?booked|booking\s+done|booked\s+(a\s+)?(slot|consultation|appointment|call)/i;

const looksLikeQuestion = (t: string) => t.includes('?') && t.length > 3;

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
    const answer = await answerFreeform(cfg, question);
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
    await prisma.session.update({ where: key, data: { lastInteractionAt: new Date() } });
  }

  // A human agent has taken over, or the workspace has not gone live yet: suppress automated replies
  if (session.isAgentPaused || session.stage === SessionStage.AGENT_TAKEOVER) return;
  if (!cfg.ws.botEnabled && !isCapturing()) return;
  if (!isCapturing() && !accessState(cfg.ws).active) return;
  if (cfg.services.length === 0) return;

  // Customers can leave broadcast lists at any time; they can come back with START / MENU
  if (OPT_OUT_COMMANDS.includes(lower)) {
    await prisma.session.update({ where: key, data: { optedOut: true } });
    if (!session.isAgentPaused) await send(phoneNumber, "You have been unsubscribed from our updates. Reply START any time if you want to chat with us again.");
    return;
  }

  // 2. Global reset commands
  if (RESET_COMMANDS.includes(lower)) {
    await prisma.session.update({
      where: key,
      data: { stage: SessionStage.AWAITING_SERVICE_SELECTION, selectedService: null, currentStep: 0, answers: {}, optedOut: false }
    });
    await send(phoneNumber, welcomeMessage(cfg));
    return;
  }

  // 3. Stage state machine
  switch (session.stage) {
    case SessionStage.WELCOME: {
      await prisma.session.update({ where: key, data: { stage: SessionStage.AWAITING_SERVICE_SELECTION } });
      await send(phoneNumber, welcomeMessage(cfg));
      break;
    }

    case SessionStage.AWAITING_SERVICE_SELECTION: {
      const serviceKey = resolveService(cfg, text);
      if (!serviceKey) {
        if (looksLikeQuestion(text) && (await tryAnswer(text))) {
          await send(phoneNumber, menuPrompt(cfg));
        } else {
          await send(phoneNumber, invalidSelectionMessage(cfg));
        }
        return;
      }

      await prisma.session.update({
        where: key,
        data: { stage: SessionStage.IN_QUESTIONNAIRE, selectedService: serviceKey, currentStep: 0, answers: {} }
      });
      await send(phoneNumber, cfg.services.find((s) => s.key === serviceKey)!.questions[0].prompt);
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
        await send(phoneNumber, welcomeMessage(cfg));
        return;
      }

      const step = session.currentStep;

      // A side question mid-flow: answer it, then repeat the pending question (answer not consumed)
      if (looksLikeQuestion(text) && (await tryAnswer(text))) {
        await send(phoneNumber, questions[step].prompt);
        return;
      }

      const updatedAnswers = { ...(session.answers as Record<string, string>), [questions[step].key]: text };
      const nextStep = step + 1;

      if (nextStep < questions.length) {
        await prisma.session.update({ where: key, data: { currentStep: nextStep, answers: updatedAnswers } });
        await send(phoneNumber, questions[nextStep].prompt);
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
        await send(phoneNumber, completionMessage(cfg));
        if (!isCapturing()) {
          void notifyNewLead(workspaceId, session.id);
          void dispatchEvent(workspaceId, 'lead.created', session.id);
        }
      }
      break;
    }

    case SessionStage.COMPLETED: {
      const hasBooking = !!cfg.ws.bookingUrl.trim();
      if (hasBooking && BOOKED_RE.test(text)) {
        // Move the lead to "Booked" unless it is already there or has been closed (won / lost) by the team
        const lead = await prisma.lead.findFirst({ where: { workspaceId, phoneNumber }, select: { id: true, stageKey: true } });
        const kind = lead ? (await getStages(workspaceId)).find((st) => st.key === lead.stageKey)?.kind ?? 'open' : 'open';
        const moved = !!lead && lead.stageKey !== 'booked' && kind === 'open';
        if (moved) {
          await prisma.lead.update({ where: { id: lead!.id }, data: { stageKey: 'booked' } });
          if (!isCapturing()) {
            void dispatchEvent(workspaceId, 'lead.stage_changed', session.id, { previousStage: lead!.stageKey });
            void logLeadEvent(lead!.id, workspaceId, 'stage', `${lead!.stageKey} → booked (customer confirmed)`, 'bot');
          }
        }
        await send(phoneNumber, bookedConfirmationMessage());
        if (!isCapturing() && moved) void notifyBooked(workspaceId, phoneNumber);
      } else if (hasBooking && /consultation|appointment|book|fee/.test(lower)) {
        await send(phoneNumber, bookingReminderMessage(cfg));
      } else if (looksLikeQuestion(text) && (await tryAnswer(text))) {
        // answered a genuine question
      } else if (!(await lastReplyWas(workspaceId, phoneNumber, postCompletionMessage()))) {
        await send(phoneNumber, postCompletionMessage());
      }
      // otherwise stay quiet: the same acknowledgement was already the last thing we sent
      break;
    }

    default:
      await send(phoneNumber, welcomeMessage(cfg));
  }
}
