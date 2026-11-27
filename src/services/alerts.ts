import { contactLabel } from '../lib/channel';
import { prisma } from '../lib/prisma';
import { loadConfig } from './botConfig';
import { sendRaw, transportReady } from './transport';
import { getSetting } from './settings';
import { emailConfigured, sendEmail } from './mailer';
import { DEFAULT_WORKSPACE_ID } from '../lib/workspaces';

export const smtpConfigured = emailConfigured;

export type ChannelResult = 'sent' | `skipped: ${string}` | `failed: ${string}`;
export interface AlertResult {
  whatsapp: ChannelResult;
  email: ChannelResult;
}

const digits = (p: string) => p.replace(/\D/g, '');
const validPhone = (p: string) => /^\d{8,15}$/.test(digits(p));
const prettyKey = (k: string) => k.replace(/_/g, ' ');
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const dashboardUrl = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '') + '/admin/';

/** Delivers one alert to every channel the business configured. Never throws. */
export async function deliverAlert(workspaceId: string, subject: string, body: string, alsoEmail?: string | null): Promise<AlertResult> {
  const { ws } = await loadConfig(workspaceId);
  const result: AlertResult = { whatsapp: 'skipped: no WhatsApp number set', email: 'skipped: no email set' };

  // Platform switch: send alerts from the operator's own WhatsApp number instead of the client's
  const viaPlatform = (await getSetting<boolean>('platformSender', false)) && workspaceId !== DEFAULT_WORKSPACE_ID;
  const sender = viaPlatform ? DEFAULT_WORKSPACE_ID : workspaceId;
  if (ws.notifyPhone.trim()) {
    if (!validPhone(ws.notifyPhone)) result.whatsapp = 'skipped: the alert number is not a valid phone number';
    else if (!transportReady(sender)) result.whatsapp = viaPlatform ? 'skipped: the platform WhatsApp number is not connected' : 'skipped: WhatsApp is not connected';
    else {
      try {
        await sendRaw(sender, digits(ws.notifyPhone), viaPlatform ? `[${ws.businessName}]\n${subject}\n\n${body}` : `${subject}\n\n${body}`);
        result.whatsapp = 'sent';
      } catch (err) {
        result.whatsapp = `failed: ${(err as Error).message}`;
      }
    }
  }

  const recipients = [...new Set([ws.notifyEmail.trim(), (alsoEmail ?? '').trim()].filter(Boolean))];
  if (recipients.length) {
    if (!smtpConfigured()) result.email = 'skipped: email sending is not set up on this server';
    else {
      try {
        await sendEmail(recipients, subject, body);
        result.email = 'sent';
      } catch (err) {
        result.email = `failed: ${(err as Error).message}`;
      }
    }
  }
  return result;
}

function leadText(name: string | null, phone: string, service: string, answers: Record<string, string>): string {
  const lines = Object.entries(answers)
    .slice(0, 10)
    .map(([k, v]) => `• ${prettyKey(k)}: ${cut(String(v), 160)}`);
  const link = dashboardUrl();
  return [`${name || 'Unknown'} · ${contactLabel(phone)}`, `Service: ${service}`, ...lines, link !== '/admin/' ? `\nOpen: ${link}` : ''].filter(Boolean).join('\n');
}

/** A customer finished the questionnaire. */
export async function notifyNewLead(workspaceId: string, sessionId: string): Promise<void> {
  try {
    const [cfg, session] = await Promise.all([loadConfig(workspaceId), prisma.session.findUnique({ where: { id: sessionId }, include: { lead: true } })]);
    if (!session?.lead) return;
    const service = cfg.services.find((s) => s.key === session.lead!.serviceCategory)?.title ?? session.lead.serviceCategory;
    const answers = session.lead.collectedData as Record<string, string>;
    await deliverAlert(workspaceId, `🔔 New lead for ${cfg.ws.businessName}`, leadText(session.contactName, session.phoneNumber, service, answers));
  } catch (err) {
    console.error('[alerts] new lead alert failed:', (err as Error).message);
  }
}

const AI_DOWN_EVERY_MS = 60 * 60 * 1000;
const aiDownAlerted = new Map<string, number>();

/** AI replies are failing, so customers are waiting for a person. At most one alert an hour per business; the operator hears too. */
export async function notifyAiDown(workspaceId: string, phone: string, text: string, reason: string): Promise<void> {
  if (Date.now() - (aiDownAlerted.get(workspaceId) ?? 0) < AI_DOWN_EVERY_MS) return;
  aiDownAlerted.set(workspaceId, Date.now());
  try {
    const cfg = await loadConfig(workspaceId);
    const why = /spending cap/i.test(reason) ? 'The Gemini monthly spending cap is used up. Raise it at https://ai.studio/spend' : cut(reason, 200);
    const body = [`AI replies are failing for ${cfg.ws.businessName}.`, why, `Latest customer waiting: ${contactLabel(phone)}: "${cut(text, 160)}"`, `Reply to waiting chats from the inbox: ${dashboardUrl()}`].join('\n');
    const subject = '⚠️ The AI is not replying';
    console.error('[alerts] AI down:', JSON.stringify(await deliverAlert(workspaceId, subject, body)));
    if (workspaceId !== DEFAULT_WORKSPACE_ID) await deliverAlert(DEFAULT_WORKSPACE_ID, subject, body);
  } catch (err) {
    console.error('[alerts] AI outage alert failed:', (err as Error).message);
  }
}

/** A customer says they have booked. */
export async function notifyBooked(workspaceId: string, phone: string): Promise<void> {
  try {
    const session = await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId, phoneNumber: phone } } });
    const cfg = await loadConfig(workspaceId);
    await deliverAlert(workspaceId, `🗓 Booking confirmed by customer`, `${session?.contactName || 'A customer'} · ${contactLabel(phone)} says they have booked ${cfg.ws.bookingLabel}.`);
  } catch (err) {
    console.error('[alerts] booking alert failed:', (err as Error).message);
  }
}

export const sendTestAlert = (workspaceId: string, businessName: string) =>
  deliverAlert(workspaceId, `✅ Test alert from ${businessName}`, 'Lead alerts are working. You will get a message like this whenever a customer finishes your questions.');
