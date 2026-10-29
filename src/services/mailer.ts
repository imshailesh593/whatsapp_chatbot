import nodemailer from 'nodemailer';

/** Email goes out through Resend (RESEND_API_KEY) when set, otherwise through plain SMTP. MAIL_FROM falls back to SMTP_FROM. */
const fromAddress = () => process.env.MAIL_FROM || process.env.SMTP_FROM || '';
const useResend = () => !!process.env.RESEND_API_KEY;

export const emailConfigured = () => !!fromAddress() && (useResend() || !!process.env.SMTP_HOST);
export const emailProvider = (): 'resend' | 'smtp' | 'none' => (!emailConfigured() ? 'none' : useResend() ? 'resend' : 'smtp');

let smtp: nodemailer.Transporter | null = null;
const transporter = () => {
  // SMTP_HOST=json is a no-network mode used by the automated tests
  smtp ??= process.env.SMTP_HOST === 'json' ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined
  });
  return smtp;
};

export async function sendEmail(to: string[], subject: string, text: string): Promise<void> {
  const cleanSubject = subject.replace(/[\r\n]+/g, ' ');
  if (!useResend()) {
    await transporter().sendMail({ from: fromAddress(), to: to.join(', '), subject: cleanSubject, text });
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress(), to, subject: cleanSubject, text }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = detail.slice(0, 200);
    try {
      message = (JSON.parse(detail) as { message?: string }).message ?? message;
    } catch {
      /* keep raw text */
    }
    throw new Error(`Resend ${res.status}: ${message}`);
  }
}
