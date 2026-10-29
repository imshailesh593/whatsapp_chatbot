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
    return { key, title, keywords, questions };
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

const NUM = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const menuLines = (cfg: BotConfig) => cfg.services.map((s, i) => `${NUM[i + 1] ?? `${i + 1}.`} ${s.title}`).join('\n');

const bold = (t: string) => `*${t}*`;

export function welcomeMessage(cfg: BotConfig): string {
  const { ws } = cfg;
  const parts = [`Hello 👋 Welcome to ${ws.businessName}! 🌍`];
  if (ws.welcomeIntro.trim()) parts.push(ws.welcomeIntro.trim());
  if (ws.formUrl.trim()) {
    parts.push(`📝 Please fill out this short form so our team can understand your profile:\n👉 ${ws.formUrl.trim()}`);
    parts.push('Then, to assist you better, please select the service you are looking for:');
  } else {
    parts.push('To assist you better, please select the service you are looking for:');
  }
  parts.push(menuLines(cfg));
  parts.push(`Please reply with the option number (1-${cfg.services.length}). 😊`);
  return parts.join('\n\n');
}

export const menuPrompt = (cfg: BotConfig) => `To get started, please reply with the option number (1-${cfg.services.length}) for the service you need. 😊`;

export function invalidSelectionMessage(cfg: BotConfig): string {
  return `Please reply with a valid number between 1 and ${cfg.services.length} to choose your service. 😊\n\n${menuLines(cfg)}`;
}

function bookingBlock(cfg: BotConfig, lead: string): string[] {
  const { ws } = cfg;
  if (!ws.bookingUrl.trim()) return [];
  const out = [`${lead} ${ws.bookingLabel} here:\n👉 ${ws.bookingUrl.trim()}`];
  return out;
}

export function completionMessage(cfg: BotConfig): string {
  const { ws } = cfg;
  const parts = [
    'Thank you for sharing your details! 🙌',
    'Our team will review your requirements and guide you regarding the relevant process and next steps.'
  ];
  parts.push(...bookingBlock(cfg, 'You can also schedule a'));
  if (ws.bookingUrl.trim()) parts.push('If you have already booked, please let us know here.');
  if (ws.bookingNote.trim()) parts.push(bold(ws.bookingNote.trim()));
  parts.push(`${ws.businessName}${ws.tagline.trim() ? ` | ${ws.tagline.trim()}` : ''} 🌍`);
  return parts.join('\n\n');
}

export function bookingReminderMessage(cfg: BotConfig): string {
  const { ws } = cfg;
  const parts = [`You can schedule your ${ws.bookingLabel} using this link:\n👉 ${ws.bookingUrl.trim()}`];
  if (ws.bookingNote.trim()) parts.push(bold(`Note: ${ws.bookingNote.trim()}`));
  return parts.join('\n\n');
}

export const postCompletionMessage = () =>
  'Thank you for your message! Our team has received your details and will reach out shortly.\n\nTo restart the service menu, type *MENU*.';

export const bookedConfirmationMessage = () =>
  'Thank you for confirming! 🙌 Our team will connect with you shortly regarding your booking.';

export const UNSUPPORTED_MEDIA_MESSAGE = 'Sorry, I can only read text messages right now. Please type your reply. 🙏';

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
