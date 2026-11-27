import type { Workspace } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { slugKey, getTemplate, type TemplateService } from '../templates';

export interface BotQuestion {
  key: string;
  prompt: string;
}
export interface BotService {
  key: string;
  title: string;
  keywords: string[];
  questions: BotQuestion[];
  closingMessage: string;
}
export interface BotConfig {
  ws: Workspace;
  services: BotService[];
}

export const MAX_SERVICES = 9;
export const MAX_QUESTIONS = 12;

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; cfg: BotConfig }>();

export function invalidateConfig(workspaceId: string): void {
  cache.delete(workspaceId);
}

export async function loadConfig(workspaceId: string): Promise<BotConfig> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cfg;
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: { services: { orderBy: { position: 'asc' }, include: { questions: { orderBy: { position: 'asc' } } } } }
  });
  const { services, ...rest } = ws;
  const cfg: BotConfig = {
    ws: rest,
    services: services.map((s) => ({
      key: s.key,
      title: s.title,
      keywords: s.keywords,
      closingMessage: s.closingMessage,
      questions: s.questions.map((q) => ({ key: q.key, prompt: q.prompt }))
    }))
  };
  cache.set(workspaceId, { at: Date.now(), cfg });
  return cfg;
}

// ---------- validation / persistence of the bot definition ----------

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Normalises user/AI supplied services into a safe, de-duplicated list. Throws a readable Error when unusable. */
export function sanitizeServices(input: unknown): TemplateService[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Add at least one service');
  if (input.length > MAX_SERVICES) throw new Error(`At most ${MAX_SERVICES} services are supported`);
  const usedKeys = new Set<string>();
  return input.map((raw: any, i) => {
    const title = clean(raw?.title, 80);
    if (!title) throw new Error(`Service ${i + 1} needs a title`);
    let key = clean(raw?.key, 40) ? slugKey(raw.key) : slugKey(title);
    for (let n = 2; usedKeys.has(key); n++) key = `${slugKey(title)}_${n}`;
    usedKeys.add(key);
    const qs = Array.isArray(raw?.questions) ? raw.questions : [];
    if (qs.length === 0) throw new Error(`"${title}" needs at least one question`);
    if (qs.length > MAX_QUESTIONS) throw new Error(`"${title}" has more than ${MAX_QUESTIONS} questions`);
    const qKeys = new Set<string>();
    const questions = qs.map((q: any, j: number) => {
      const prompt = clean(q?.prompt, 500);
      if (!prompt) throw new Error(`"${title}": question ${j + 1} is empty`);
      let qk =
        clean(q?.key, 40)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || `q${j + 1}`;
      for (let n = 2; qKeys.has(qk); n++) qk = `${qk.replace(/_\d+$/, '')}_${n}`;
      qKeys.add(qk);
      return { key: qk, prompt };
    });
    const keywords = (Array.isArray(raw?.keywords) ? raw.keywords : [])
      .map((k: unknown) => clean(k, 40).toLowerCase())
      .filter(Boolean)
      .slice(0, 12);
    const closingMessage = String(raw?.closingMessage ?? '').replace(/\r/g, '').trim().slice(0, 3000);
    return { key, title, keywords, questions, closingMessage };
  });
}

/** Replaces a workspace's whole bot definition. Existing sessions keep working when service keys are unchanged. */
export async function saveServices(workspaceId: string, input: unknown): Promise<void> {
  const services = sanitizeServices(input);
  await prisma.$transaction(async (tx) => {
    await tx.service.deleteMany({ where: { workspaceId } });
    for (const [position, s] of services.entries()) {
      await tx.service.create({
        data: {
          workspaceId,
          key: s.key!,
          title: s.title,
          keywords: s.keywords,
          closingMessage: s.closingMessage ?? '',
          position,
          questions: { create: s.questions.map((q, p) => ({ key: q.key, prompt: q.prompt, position: p })) }
        }
      });
    }
  });
  invalidateConfig(workspaceId);
}

/** Existing default workspace (pre-SaaS data): fill it from environment variables + the original funnel. */
export async function seedDefaultWorkspace(): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: 'default-workspace' }, include: { _count: { select: { services: true } } } });
  if (!ws || ws._count.services > 0) return;
  const tpl = getTemplate('overseas-careers');
  const env = process.env;
  await prisma.workspace.update({
    where: { id: ws.id },
    data: {
      name: env.BUSINESS_NAME || ws.name,
      businessName: env.BUSINESS_NAME || 'Your Business',
      tagline: env.BUSINESS_TAGLINE || '',
      description: env.BUSINESS_DESCRIPTION || '',
      welcomeIntro: env.WELCOME_INTRO || tpl.welcomeIntro,
      formUrl: env.FORM_URL || '',
      bookingUrl: env.TOPMATE_URL || '',
      bookingLabel: tpl.bookingLabel,
      bookingNote: env.TOPMATE_URL ? 'Fees will be adjusted in the process.' : '',
      industry: 'overseas-careers',
      onboardingCompleted: true
    }
  });
  await saveServices(ws.id, tpl.services);
  console.log('[saas] seeded default workspace from environment + original funnel');
}

// ---------- customer-facing message copy, built from the workspace config ----------

// Plain "1." numbering reads like a person typing; emoji keycaps look like a machine
const menuLines = (cfg: BotConfig) => cfg.services.map((s, i) => `${i + 1}. ${s.title}`).join('\n');

const bold = (t: string) => `*${t}*`;

const formLine = (url: string) => `Could you fill in this quick form so we know a little about you? ${url}`;

export function welcomeMessage(cfg: BotConfig): string {
  const { ws } = cfg;
  const parts = [`Hi, welcome to ${ws.businessName.split('|')[0].trim()}!`];
  if (ws.welcomeIntro.trim()) parts.push(ws.welcomeIntro.trim());
  if (ws.formUrl.trim()) parts.push(formLine(ws.formUrl.trim()));
  parts.push(`What are you looking for?\n${menuLines(cfg)}`);
  parts.push(`Just reply with the number (1-${cfg.services.length}).`);
  return parts.join('\n\n');
}

/** The menu on its own (the language question has already been asked and answered): one message, form link included. */
export function menuOnlyMessage(cfg: BotConfig): string {
  const form = cfg.ws.formUrl.trim();
  return [
    ...(form ? [formLine(form)] : []),
    `What do you need help with?\n${menuLines(cfg)}`,
    `Reply with the number (1-${cfg.services.length}). You can type LANGUAGE any time to change the language.`
  ].join('\n\n');
}

export const DEFAULT_LANGUAGE_WELCOME = 'Hi, thanks for reaching out! Which language would you like to chat in?';

/** The first message of a workspace that asks the customer's language before showing the menu. */
export const languagePromptMessage = (cfg: BotConfig) => cfg.ws.languageWelcome.trim() || DEFAULT_LANGUAGE_WELCOME;

export const menuPrompt = (cfg: BotConfig) => `Which of these can I help you with? Just reply with the number (1-${cfg.services.length}).`;

export function invalidSelectionMessage(cfg: BotConfig): string {
  return `Sorry, I didn't quite catch that. Which of these can I help you with?\n${menuLines(cfg)}\n\nJust reply with the number (1-${cfg.services.length}).`;
}

function bookingBlock(cfg: BotConfig, lead: string): string[] {
  const { ws } = cfg;
  if (!ws.bookingUrl.trim()) return [];
  const out = [`${lead} ${ws.bookingLabel} here: ${ws.bookingUrl.trim()}`];
  return out;
}

/**
 * A closing message can hold parts shown only for some customers: "[if profession ~ nurs|staff nurse]...[/if]" is kept when the
 * answer to the question called "profession" contains any of the words after "~" (separated by |), and dropped otherwise.
 */
export function renderClosing(text: string, answers: Record<string, unknown>): string {
  return text
    .replace(/\[if (\w+) ~ ([^\]\n]+)\]([\s\S]*?)\[\/if\]/g, (_m, key: string, words: string, body: string) => {
      const value = String(answers[key] ?? '').toLowerCase();
      return words.split('|').some((w) => w.trim() && value.includes(w.trim().toLowerCase())) ? body : '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function completionMessage(cfg: BotConfig, serviceKey?: string | null, answers: Record<string, unknown> = {}): string {
  const { ws } = cfg;
  const own = cfg.services.find((s) => s.key === serviceKey)?.closingMessage.trim();
  if (own) return renderClosing(own, answers);
  const parts = ["Thanks, that's everything I needed. Our team will go through your details and get back to you soon."];
  parts.push(...bookingBlock(cfg, 'If you like, you can also book a'));
  if (ws.bookingUrl.trim()) parts.push('If you have already booked, just let me know.');
  if (ws.bookingNote.trim()) parts.push(bold(ws.bookingNote.trim()));
  return parts.join('\n\n');
}

export function bookingReminderMessage(cfg: BotConfig): string {
  const { ws } = cfg;
  const parts = [`You can book a ${ws.bookingLabel} here: ${ws.bookingUrl.trim()}`];
  if (ws.bookingNote.trim()) parts.push(bold(`Note: ${ws.bookingNote.trim()}`));
  return parts.join('\n\n');
}

export const postCompletionMessage = () => 'Thanks! Our team has your details and will be in touch soon. If you need anything else just ask, or type MENU to start over.';

export const bookedConfirmationMessage = () => "Great, thanks for letting us know. Our team will be in touch about your booking.";

export const UNSUPPORTED_MEDIA_MESSAGE = "Sorry, I can only read text messages at the moment. Could you type that out for me?";

/** "3", "option 3", "3️⃣" or a service keyword/title word → service key. */
export function resolveService(cfg: BotConfig, text: string): string | undefined {
  const digit = text.match(/^\D*([1-9])\D*$/);
  if (digit) return cfg.services[Number(digit[1]) - 1]?.key;
  const lower = text.toLowerCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const s of cfg.services) {
    if (s.keywords.some((k) => new RegExp(`(^|[^a-z0-9])${esc(k)}([^a-z0-9]|$)`).test(lower))) return s.key;
  }
  return undefined;
}
