import { prisma } from '../lib/prisma';
import { invalidateConfig } from './botConfig';
import { planById } from '../plans';

const day = 86_400_000;

/** Plans a code may grant: the free trial (extends it) or one of the paid plans, never 'internal'. */
export const grantablePlan = (plan: string) => plan === 'trial' || !!planById(plan);

/** Puts a business on a plan without a payment (pilots, extensions, comps). Returns an error message or null. */
export async function grantPlan(id: string, plan: string, daysRaw: unknown, from = Date.now()): Promise<string | null> {
  const days = Math.min(Math.max(Math.floor(Number(daysRaw) || 30), 1), 3650);
  const end = new Date(from + days * day);
  if (plan === 'trial') await prisma.workspace.update({ where: { id }, data: { plan: 'trial', planStatus: 'trialing', trialEndsAt: end } });
  else if (plan === 'internal' || planById(plan)) await prisma.workspace.update({ where: { id }, data: { plan, planStatus: 'active', currentPeriodEnd: end, cancelAtPeriodEnd: false } });
  else return 'Unknown plan';
  invalidateConfig(id);
  return null;
}

export const normalizeCode = (raw: unknown) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);

export function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I)
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export interface CouponInput {
  code?: string;
  plan?: string;
  days?: number;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
  note?: string;
}

export async function createCoupon(input: CouponInput, createdBy: string): Promise<{ error: string } | { id: string; code: string }> {
  const plan = String(input.plan ?? '');
  if (!grantablePlan(plan)) return { error: 'Choose a plan: trial, starter, growth or scale' };
  const days = Math.floor(Number(input.days));
  if (!Number.isFinite(days) || days < 1 || days > 3650) return { error: 'Days must be between 1 and 3650' };
  const max = input.maxRedemptions == null || (input.maxRedemptions as unknown) === '' ? null : Math.floor(Number(input.maxRedemptions));
  if (max !== null && (!Number.isFinite(max) || max < 1 || max > 100000)) return { error: 'Uses must be between 1 and 100000, or empty for unlimited' };
  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) return { error: 'The expiry date is not valid' };
  }
  const code = input.code ? normalizeCode(input.code) : randomCode();
  if (code.length < 4) return { error: 'A code needs at least 4 letters or digits' };
  if (await prisma.coupon.findUnique({ where: { code } })) return { error: 'That code already exists' };
  const row = await prisma.coupon.create({ data: { code, plan, days, maxRedemptions: max, expiresAt, note: String(input.note ?? '').slice(0, 200), createdBy } });
  return { id: row.id, code: row.code };
}

export type RedeemResult = { ok: true; plan: string; days: number } | { ok: false; error: string };

/** A business owner redeems a code. Generic errors, so codes cannot be probed for existence. */
export async function redeemCoupon(workspaceId: string, rawCode: unknown): Promise<RedeemResult> {
  const code = normalizeCode(rawCode);
  const invalid: RedeemResult = { ok: false, error: 'This code is not valid, has expired or has been used up.' };
  if (!code) return invalid;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) return invalid;
  if (ws.plan === 'internal') return { ok: false, error: 'This account is not billed, so codes do not apply.' };
  if (ws.planStatus === 'active' && ws.providerSubscriptionId) return { ok: false, error: 'You have a paid subscription. Contact support to apply a code.' };
  // A code must never replace a plan that is currently running (paid, or granted by the operator)
  if (ws.planStatus === 'active' && ws.currentPeriodEnd && ws.currentPeriodEnd.getTime() > Date.now()) return { ok: false, error: 'You already have an active plan. Use a code once it has ended.' };

  const c = await prisma.coupon.findUnique({ where: { code } });
  if (!c || !c.active || (c.expiresAt && c.expiresAt.getTime() < Date.now())) return invalid;
  if (await prisma.couponRedemption.findUnique({ where: { couponId_workspaceId: { couponId: c.id, workspaceId } } })) return { ok: false, error: 'You have already used this code.' };

  // Claim a use atomically so two businesses cannot both take the last one
  const claimed = await prisma.coupon.updateMany({
    where: c.maxRedemptions == null ? { id: c.id, active: true } : { id: c.id, active: true, redeemedCount: { lt: c.maxRedemptions } },
    data: { redeemedCount: { increment: 1 } }
  });
  if (claimed.count === 0) return invalid;
  try {
    await prisma.couponRedemption.create({ data: { couponId: c.id, workspaceId } });
  } catch {
    await prisma.coupon.update({ where: { id: c.id }, data: { redeemedCount: { decrement: 1 } } });
    return { ok: false, error: 'You have already used this code.' };
  }
  // A trial code adds to what is left of the trial; a plan code starts a fresh period
  const base = c.plan === 'trial' && ws.planStatus === 'trialing' && ws.trialEndsAt && ws.trialEndsAt.getTime() > Date.now() ? ws.trialEndsAt.getTime() : Date.now();
  const err = await grantPlan(workspaceId, c.plan, c.days, base);
  if (err) return { ok: false, error: err };
  return { ok: true, plan: c.plan, days: c.days };
}
