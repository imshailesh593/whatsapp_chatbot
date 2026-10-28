import { SessionStage, ServiceCategory } from '@prisma/client';
import {
  QUESTION_BRANCHES,
  SERVICE_SELECTION_MAP,
  SERVICE_KEYWORDS,
  WELCOME_MESSAGE,
  INVALID_SELECTION_MESSAGE,
  COMPLETION_MESSAGE,
  CONSULTATION_REMINDER_MESSAGE,
  POST_COMPLETION_MESSAGE,
  BOOKED_CONFIRMATION_MESSAGE
} from '../constants/questions';
import { prisma } from '../lib/prisma';
import { sendTextMessage as send, logMessage, isCapturing } from './transport';
import { answerFreeform } from './gemini';

const RESET_COMMANDS = ['reset', 'menu', 'restart', 'start'];
const BOOKED_RE = /already\s+booked|i\s+(have\s+)?booked|booking\s+done|booked\s+(a\s+)?(slot|consultation)/i;

/** Maps "3", "3.", "option 3", "3️⃣" or "international jobs" to a branch key. */
export function resolveService(text: string): string | undefined {
  const digit = text.match(/^\D*([1-5])\D*$/);
  if (digit) return SERVICE_SELECTION_MAP[digit[1]];
  const lower = text.toLowerCase();
  return SERVICE_KEYWORDS.find(([re]) => re.test(lower))?.[1];
}

/** Answer a side question via Gemini. Returns false if Gemini had nothing (not configured / failed). */
async function tryAnswer(to: string, question: string): Promise<boolean> {
  const answer = await answerFreeform(question);
  if (!answer) return false;
  await send(to, answer);
  return true;
}

const looksLikeQuestion = (t: string) => t.includes('?') && t.length > 3;

export async function handleIncomingMessage(
  phoneNumber: string,
  contactName: string | undefined,
  incomingText: string
): Promise<void> {
  const text = incomingText.trim();
  if (!text) return;
  if (!isCapturing()) await logMessage(phoneNumber, 'INBOUND', text);
  const lower = text.toLowerCase();

  // 1. Fetch or create session
  let session = await prisma.session.findUnique({ where: { phoneNumber } });
  if (!session) {
    session = await prisma.session.create({
      data: { phoneNumber, contactName: contactName || null }
    });
  } else {
    await prisma.session.update({
      where: { phoneNumber },
      data: { lastInteractionAt: new Date() }
    });
  }

  // A human agent has taken over: suppress automated replies
  if (session.isAgentPaused || session.stage === SessionStage.AGENT_TAKEOVER) return;

  // 2. Global reset commands
  if (RESET_COMMANDS.includes(lower)) {
    await prisma.session.update({
      where: { phoneNumber },
      data: {
        stage: SessionStage.AWAITING_SERVICE_SELECTION,
        selectedService: null,
        currentStep: 0,
        answers: {}
      }
    });
    await send(phoneNumber, WELCOME_MESSAGE);
    return;
  }

  // 3. Stage state machine
  switch (session.stage) {
    case SessionStage.WELCOME: {
      await prisma.session.update({
        where: { phoneNumber },
        data: { stage: SessionStage.AWAITING_SERVICE_SELECTION }
      });
      await send(phoneNumber, WELCOME_MESSAGE);
      break;
    }

    case SessionStage.AWAITING_SERVICE_SELECTION: {
      const branchKey = resolveService(text);
      if (!branchKey) {
        if (looksLikeQuestion(text) && (await tryAnswer(phoneNumber, text))) {
          await send(phoneNumber, 'To get started, please reply with the option number (1-5) for the service you need. 😊');
        } else {
          await send(phoneNumber, INVALID_SELECTION_MESSAGE);
        }
        return;
      }

      await prisma.session.update({
        where: { phoneNumber },
        data: {
          stage: SessionStage.IN_QUESTIONNAIRE,
          selectedService: branchKey as ServiceCategory,
          currentStep: 0,
          answers: {}
        }
      });
      await send(phoneNumber, QUESTION_BRANCHES[branchKey][0].question);
      break;
    }

    case SessionStage.IN_QUESTIONNAIRE: {
      const branch = session.selectedService;
      const questions = branch ? QUESTION_BRANCHES[branch] : undefined;
      if (!branch || !questions || session.currentStep >= questions.length) {
        // Corrupt state: restart the funnel instead of crashing
        await prisma.session.update({
          where: { phoneNumber },
          data: {
            stage: SessionStage.AWAITING_SERVICE_SELECTION,
            selectedService: null,
            currentStep: 0,
            answers: {}
          }
        });
        await send(phoneNumber, WELCOME_MESSAGE);
        return;
      }

      const step = session.currentStep;

      // A side question mid-flow: answer it, then repeat the pending question (answer not consumed)
      if (looksLikeQuestion(text) && (await tryAnswer(phoneNumber, text))) {
        await send(phoneNumber, questions[step].question);
        return;
      }

      const updatedAnswers = {
        ...(session.answers as Record<string, string>),
        [questions[step].key]: text
      };
      const nextStep = step + 1;

      if (nextStep < questions.length) {
        await prisma.session.update({
          where: { phoneNumber },
          data: { currentStep: nextStep, answers: updatedAnswers }
        });
        await send(phoneNumber, questions[nextStep].question);
      } else {
        await prisma.$transaction([
          prisma.session.update({
            where: { phoneNumber },
            data: { stage: SessionStage.COMPLETED, currentStep: nextStep, answers: updatedAnswers }
          }),
          prisma.lead.upsert({
            where: { sessionId: session.id },
            update: { serviceCategory: branch, collectedData: updatedAnswers },
            create: {
              sessionId: session.id,
              phoneNumber,
              serviceCategory: branch,
              collectedData: updatedAnswers
            }
          })
        ]);
        await send(phoneNumber, COMPLETION_MESSAGE);
      }
      break;
    }

    case SessionStage.COMPLETED: {
      if (BOOKED_RE.test(text)) {
        await prisma.lead.updateMany({ where: { phoneNumber }, data: { isBookedTopmate: true } });
        await send(phoneNumber, BOOKED_CONFIRMATION_MESSAGE);
      } else if (/consultation|book|fee/.test(lower)) {
        await send(phoneNumber, CONSULTATION_REMINDER_MESSAGE);
      } else if (!(await tryAnswer(phoneNumber, text))) {
        await send(phoneNumber, POST_COMPLETION_MESSAGE);
      }
      break;
    }

    default:
      await send(phoneNumber, WELCOME_MESSAGE);
  }
}
