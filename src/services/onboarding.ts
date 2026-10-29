import { getClient, geminiModel } from './gemini';
import { sanitizeServices, MAX_QUESTIONS, MAX_SERVICES } from './botConfig';
import type { TemplateService } from '../templates';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** The bot definition the assistant proposes; applied to the workspace only after the owner confirms. */
export interface Draft {
  industry: string;
  businessName: string;
  tagline: string;
  description: string;
  welcomeIntro: string;
  tone: string;
  languages: string;
  bookingLabel: string;
  bookingNote: string;
  knowledge: string;
  services: TemplateService[];
}

export interface OnboardingReply {
  reply: string;
  draft: Draft | null;
}

const SYSTEM = `You are the setup assistant of a SaaS product that runs WhatsApp lead-qualification chatbots for businesses. You are talking to the business owner, who is setting up their own chatbot. You design the bot's menu and question lists together with them.

How to run the conversation:
1. If you do not yet know the business and its industry, your FIRST question must ask what the business does and which industry it is in. Do not ask anything else first.
2. Then learn, one or two short questions at a time (never a long list): what services/products customers can pick from (the menu), who their customers are, what the team needs to know about a customer before talking to them (this decides the questions), the business name and a one-line tagline, tone and languages, a booking or payment link if any, and any facts the chatbot should be able to answer (prices, hours, policies) - only if the owner wants the bot to quote them.
3. As soon as you know the industry and at least the main services (usually after 2-4 exchanges), propose a complete draft. Choose industry-appropriate services and questions yourself, drawing on what is typical for that industry, and use what the owner told you. Do not wait to be asked for every detail; offer sensible defaults and let the owner correct them.
4. After a draft exists, apply the owner's change requests ("add a question about budget", "remove the last service", "make it more formal") and return the FULL updated draft each time.
5. Keep your chat replies short and friendly (under 70 words). When you have shown a draft, tell the owner they can keep refining it or press "Apply & continue".

Draft rules: ${MAX_SERVICES} services at most (3-6 is ideal), 3-7 questions per service (at most ${MAX_QUESTIONS}). Each question is one short WhatsApp message a customer can answer by typing, with example options in brackets when helpful. Questions must never ask for passwords, card numbers or ID numbers. Service "keywords" are lowercase words a customer might type to pick that service. Never invent prices or facts for the knowledge field: only include what the owner told you.

Respond ONLY with JSON of this exact shape:
{"reply": string, "draft": null | {"industry": string, "businessName": string, "tagline": string, "description": string, "welcomeIntro": string, "tone": string, "languages": string, "bookingLabel": string, "bookingNote": string, "knowledge": string, "services": [{"title": string, "keywords": [string], "questions": [{"key": string, "prompt": string}]}]}}
Use draft = null until you have enough information. "description" is one or two sentences about what the business does (used to brief the chatbot). "welcomeIntro" is one friendly sentence shown under the greeting. "bookingLabel" completes "schedule a ___ here" (e.g. "consultation", "site visit", "appointment"). "key" is a short snake_case id.`;

const str = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

/** Validates whatever the model returned; anything unusable becomes null so the UI keeps the previous draft. */
export function parseDraft(raw: any): Draft | null {
  if (!raw || typeof raw !== 'object') return null;
  try {
    const services = sanitizeServices(raw.services);
    return {
      industry: str(raw.industry, 60) || 'generic',
      businessName: str(raw.businessName, 80),
      tagline: str(raw.tagline, 120),
      description: str(raw.description, 500),
      welcomeIntro: str(raw.welcomeIntro, 300),
      tone: str(raw.tone, 40) || 'friendly',
      languages: str(raw.languages, 80) || 'English',
      bookingLabel: str(raw.bookingLabel, 60) || 'call with our team',
      bookingNote: str(raw.bookingNote, 200),
      knowledge: str(raw.knowledge, 8000),
      services
    };
  } catch {
    return null;
  }
}

export const onboardingAvailable = () => !!getClient();

export async function onboardingTurn(history: ChatTurn[], currentDraft: Draft | null): Promise<OnboardingReply> {
  const ai = getClient();
  if (!ai) throw new Error('AI assistant is not configured');
  const turns = history.slice(-30).map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: str(t.text, 2000) }]
  }));
  if (turns.length === 0 || turns[0].role !== 'user') turns.unshift({ role: 'user', parts: [{ text: 'Hi, I want to set up my chatbot.' }] });

  const system = currentDraft
    ? `${SYSTEM}\n\nThe current draft shown to the owner (modify this when they ask for changes):\n${JSON.stringify(currentDraft)}`
    : SYSTEM;

  const res = await ai.models.generateContent({
    model: geminiModel(),
    contents: turns,
    config: {
      systemInstruction: system,
      temperature: 0.5,
      maxOutputTokens: 6000,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 }
    }
  });
  const text = res.text?.trim() ?? '';
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The assistant sent an unreadable answer, please try again');
  }
  return {
    reply: str(parsed.reply, 1500) || 'Could you tell me a little more about your business?',
    draft: parseDraft(parsed.draft) ?? currentDraft
  };
}
