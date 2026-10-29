import { prisma } from '../lib/prisma';
import { PLANS, planById } from '../plans';
import { getSetting, setSetting } from './settings';
import { activatePaidPlan } from './paidPlan';
import { recordCommission } from './affiliate';
import { deliverAlert } from './alerts';
import { DEFAULT_WORKSPACE_ID } from '../lib/workspaces';

/**
 * Payments without a payment-gateway API: the operator publishes pay links or UPI/bank details, the owner pays and
 * submits the payment reference, and the operator confirms it (or a matching Razorpay webhook confirms it).
 */

export interface PayInfo {
  /** One optional https pay link per plan (a Razorpay payment link made in the Razorpay dashboard, or any other) */
  links: Record<string, string>;
  /** Free text shown to owners: UPI id, bank details, "pay and paste the reference below" */
  instructions: string;
}

export async function getPayInfo(): Promise<PayInfo> {
  const v = await getSetting<Partial<PayInfo>>('payInfo', {});
  return { links: { ...(v.links ?? {}) }, instructions: String(v.instructions ?? '') };
}

/** Validates and saves the pay links and instructions. Throws a readable Error. */
export async function savePayInfo(body: Record<string, unknown>): Promise<PayInfo> {
  const links: Record<string, string> = {};
  const given = (body.links ?? {}) as Record<string, unknown>;
  for (const p of PLANS) {
    const raw = String(given[p.id] ?? '').trim();
    if (!raw) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new Error(`The ${p.name} link is not a valid web address`);
    }
    if (u.protocol !== 'https:') throw new Error(`The ${p.name} link must start with https://`);
    if (raw.length > 300) throw new Error(`The ${p.name} link is too long`);
    links[p.id] = u.toString();
  }
  const instructions = String(body.instructions ?? '').replace(/\r/g, '').trim().slice(0, 600);
  const info: PayInfo = { links, instructions };
  await setSetting('payInfo', info);
  return info;
}

export const payEnabled = (i: PayInfo) => Object.keys(i.links).length > 0 || !!i.instructions;

const MAX_PENDING = 3;
const REF_RE = /^[A-Za-z0-9_.@/-]{6,64}$/;

/** An owner says they paid, and gives the payment reference (Razorpay payment id, UPI reference, bank UTR). */
export async function submitClaim(workspaceId: string, planId: string, referenceRaw: unknown): Promise<string | null> {
  const plan = planById(planId);
  if (!plan) return 'Choose a plan';
  const reference = String(referenceRaw ?? '').trim();
  if (!REF_RE.test(reference)) return 'Enter the payment reference exactly as shown on your receipt (6 to 64 letters and digits)';
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws || ws.plan === 'internal') return 'This workspace is not billed';
  if (ws.providerSubscriptionId && ws.planStatus === 'active') return 'You already have an active subscription';
  if (!payEnabled(await getPayInfo())) return 'Payments by reference are not set up yet';
  if ((await prisma.payment.count({ where: { workspaceId, provider: 'manual', status: 'pending' } })) >= MAX_PENDING) return 'You already have payments waiting to be confirmed. Please wait for them to be checked.';
  try {
    await prisma.payment.create({ data: { workspaceId, provider: 'manual', providerRef: reference, plan: plan.id, amount: plan.price.INR, currency: 'INR', status: 'pending' } });
  } catch {
    return 'That payment reference has already been submitted';
  }
  void deliverAlert(DEFAULT_WORKSPACE_ID, `💳 Payment to confirm: ${ws.businessName}`, `${ws.businessName} says they paid ₹${plan.price.INR / 100} for the ${plan.name} plan.\nReference: ${reference}\n\nCheck it in your payment account, then approve it in Platform admin → Payments.`);
  return null;
}

/** The operator checked the money arrived. Switches the plan on. Returns an error message or null. */
export async function approveClaim(id: string): Promise<string | null> {
  const p = await prisma.payment.findUnique({ where: { id } });
  if (!p || p.provider !== 'manual') return 'Payment not found';
  if (p.status !== 'pending') return `This payment is already ${p.status}`;
  if (!(await activatePaidPlan(p.workspaceId, p.plan, 'manual_pay'))) return 'That business or plan no longer exists';
  const row = await prisma.payment.update({ where: { id }, data: { status: 'paid' } });
  await recordCommission(row);
  return null;
}

export async function rejectClaim(id: string): Promise<string | null> {
  const p = await prisma.payment.findUnique({ where: { id } });
  if (!p || p.provider !== 'manual') return 'Payment not found';
  if (p.status !== 'pending') return `This payment is already ${p.status}`;
  await prisma.payment.update({ where: { id }, data: { status: 'rejected' } });
  return null;
}

/** For a Razorpay payment that carries no business id: find the owner by the payer's email and the plan by the exact price. */
export async function matchByPayer(email: unknown, amount: number): Promise<{ workspaceId: string; planId: string } | null> {
  const address = String(email ?? '').trim().toLowerCase();
  const plan = PLANS.find((p) => p.price.INR === amount);
  if (!address || !plan) return null;
  const owner = await prisma.adminUser.findFirst({ where: { email: address, role: 'owner' }, select: { workspaceId: true } });
  return owner ? { workspaceId: owner.workspaceId, planId: plan.id } : null;
}

/** A payment nobody could be matched to: kept in the audit log so the operator can sort it out by hand. */
export const recordUnmatched = (payId: string, amount: number, email: unknown) =>
  prisma.auditLog
    .create({ data: { actor: 'razorpay', action: 'payment.unmatched', detail: `${payId} · ₹${amount / 100} · ${String(email ?? 'no email').slice(0, 80)}` } })
    .catch(() => undefined);
