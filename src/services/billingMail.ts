import { prisma } from '../lib/prisma';
import { PRODUCT_NAME } from '../brand';
import { planById } from '../plans';
import { emailConfigured, sendEmail } from './mailer';

type Kind = 'paid' | 'failed' | 'cancelled' | 'activated';

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount / 100);

/**
 * Tells the business owner about a billing event. Never throws: a billing webhook must not fail because an email did.
 * Does nothing until email is set up (Resend in the admin panel, or SMTP).
 */
export async function sendBillingEmail(workspaceId: string, kind: Kind, info: { amount?: number; currency?: string; plan?: string; until?: Date | null } = {}): Promise<void> {
  try {
    if (!emailConfigured()) return;
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, include: { adminUsers: { where: { role: 'owner' }, take: 1 } } });
    const to = ws?.adminUsers[0]?.email;
    if (!ws || !to || to.endsWith('.local')) return;
    const plan = planById(info.plan ?? ws.plan)?.name ?? 'your plan';
    const until = info.until ? info.until.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    const sign = `\n\n${PRODUCT_NAME}\nQuestions? Just reply to this email.`;
    const mail: Record<Kind, [string, string]> = {
      activated: [
        `Your ${PRODUCT_NAME} subscription is active`,
        `Hello,\n\nThank you for subscribing to ${plan}. Your subscription is active and your bot can now reply to your customers.\n\nIt renews automatically every month. You can cancel any time under Plan & billing in your dashboard and keep access until the end of the period you paid for.${sign}`
      ],
      paid: [
        `Payment received: ${PRODUCT_NAME}`,
        `Hello,\n\nWe received your payment${info.amount ? ` of ${money(info.amount, info.currency ?? 'INR')}` : ''} for ${plan}.${until ? ` Your plan is paid up to ${until}.` : ''}\n\nThe next payment is taken automatically; you do not need to do anything.${sign}`
      ],
      failed: [
        `Action needed: your ${PRODUCT_NAME} payment did not go through`,
        `Hello,\n\nWe could not collect your latest ${plan} payment. Your bot keeps working for a few days, then stops replying to customers.\n\nPlease check the payment method on your UPI AutoPay, card or PayPal subscription, or subscribe again under Plan & billing in your dashboard.${sign}`
      ],
      cancelled: [
        `Your ${PRODUCT_NAME} subscription was cancelled`,
        `Hello,\n\nYour ${plan} subscription has been cancelled and will not renew.${until ? ` You keep access until ${until}.` : ''}\n\nYou can subscribe again any time under Plan & billing in your dashboard.${sign}`
      ]
    };
    await sendEmail([to], mail[kind][0], mail[kind][1]);
  } catch (err) {
    console.error('[billing mail] could not send:', (err as Error).message);
  }
}
