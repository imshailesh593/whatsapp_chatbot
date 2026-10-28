import { SessionStage, ServiceCategory } from '@prisma/client';
import {
  QUESTION_BRANCHES,
  SERVICE_SELECTION_MAP,
  WELCOME_MESSAGE,
  INVALID_SELECTION_MESSAGE,
  COMPLETION_MESSAGE,
  CONSULTATION_REMINDER_MESSAGE,
  POST_COMPLETION_MESSAGE
} from '../constants/questions';
import { prisma } from '../lib/prisma';
import { sendTextMessage, sendServiceList } from './whatsapp';

const RESET_COMMANDS = ['reset', 'menu', 'restart', 'start'];

async function sendWelcome(phoneNumber: string): Promise<void> {
  try {
    await sendServiceList(phoneNumber, WELCOME_MESSAGE);
  } catch {
    // Interactive messages can fail on unsupported clients; fall back to plain text.
    await sendTextMessage(phoneNumber, WELCOME_MESSAGE);
  }
}

export async function handleIncomingMessage(
  phoneNumber: string,
  contactName: string | undefined,
  incomingText: string
): Promise<void> {
  const text = incomingText.trim();
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
    await sendWelcome(phoneNumber);
    return;
  }

  // 3. Stage state machine
  switch (session.stage) {
    case SessionStage.WELCOME: {
      await prisma.session.update({
        where: { phoneNumber },
        data: { stage: SessionStage.AWAITING_SERVICE_SELECTION }
      });
      await sendWelcome(phoneNumber);
      break;
    }

    case SessionStage.AWAITING_SERVICE_SELECTION: {
      const branchKey = SERVICE_SELECTION_MAP[text];
      if (!branchKey) {
        await sendTextMessage(phoneNumber, INVALID_SELECTION_MESSAGE);
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
      await sendTextMessage(phoneNumber, QUESTION_BRANCHES[branchKey][0].question);
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
        await sendWelcome(phoneNumber);
        return;
      }

      const step = session.currentStep;
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
        await sendTextMessage(phoneNumber, questions[nextStep].question);
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
        await sendTextMessage(phoneNumber, COMPLETION_MESSAGE);
      }
      break;
    }

    case SessionStage.COMPLETED: {
      if (/already\s+booked|i\s+(have\s+)?booked|booking\s+done|booked\s+(a\s+)?(slot|consultation)/i.test(text)) {
        await prisma.lead.updateMany({ where: { phoneNumber }, data: { isBookedTopmate: true } });
        await sendTextMessage(
          phoneNumber,
          'Thank you for confirming! 🙌 Our counsellor will connect with you shortly regarding your booked consultation.'
        );
      } else if (/consultation|book|fee/.test(lower)) {
        await sendTextMessage(phoneNumber, CONSULTATION_REMINDER_MESSAGE);
      } else {
        await sendTextMessage(phoneNumber, POST_COMPLETION_MESSAGE);
      }
      break;
    }

    default:
      await sendWelcome(phoneNumber);
  }
}
