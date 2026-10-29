import type { Workspace } from '@prisma/client';

// Plan catalogue. Prices are placeholders: edit here, then create matching products in Stripe / Razorpay
// and put their ids in the environment (STRIPE_PRICE_<PLAN>, RAZORPAY_PLAN_<PLAN>).
export interface PlanDef {
  id: 'starter' | 'growth' | 'scale';
  name: string;
  /** Smallest unit: paise (INR) and cents (USD), per month */
  price: { INR: number; USD: number };
  limits: Limits;
  blurb: string;
}

export interface Limits {
  /** New customer conversations per calendar month */
  conversations: number;
  /** AI-written answers to side questions per month */
  aiReplies: number;
  /** Team members (owner included) */
  seats: number;
}

export const PLANS: PlanDef[] = [
  { id: 'starter', name: 'Starter', price: { INR: 99_900, USD: 1_200 }, limits: { conversations: 300, aiReplies: 300, seats: 2 }, blurb: 'One number, a small team, getting started.' },
  { id: 'growth', name: 'Growth', price: { INR: 299_900, USD: 3_500 }, limits: { conversations: 1_500, aiReplies: 2_000, seats: 5 }, blurb: 'For businesses with steady enquiries.' },
  { id: 'scale', name: 'Scale', price: { INR: 799_900, USD: 9_500 }, limits: { conversations: 6_000, aiReplies: 10_000, seats: 15 }, blurb: 'High volume and bigger teams.' }
];

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 3;
const UNLIMITED: Limits = { conversations: Infinity, aiReplies: Infinity, seats: Infinity };

export const planById = (id: string) => PLANS.find((p) => p.id === id);

export type AccessState = {
  /** The bot may reply to customers */
  active: boolean;
  /** Short machine-readable reason when not active */
  reason: 'ok' | 'trial_expired' | 'canceled' | 'past_due';
  limits: Limits;
};

const day = 86_400_000;

/** Pure function of the workspace row: can this business use the product right now, and within which limits? */
export function accessState(ws: Pick<Workspace, 'plan' | 'planStatus' | 'trialEndsAt' | 'currentPeriodEnd'>, now = Date.now()): AccessState {
  if (ws.plan === 'internal') return { active: true, reason: 'ok', limits: UNLIMITED };
  // A trial gets the Growth limits so owners can try the real product
  const limits = (planById(ws.plan === 'trial' ? 'growth' : ws.plan) ?? PLANS[1]).limits;
  if (ws.planStatus === 'trialing') {
    const ok = !!ws.trialEndsAt && ws.trialEndsAt.getTime() > now;
    return { active: ok, reason: ok ? 'ok' : 'trial_expired', limits };
  }
  const end = ws.currentPeriodEnd?.getTime() ?? 0;
  if (ws.planStatus === 'active') return { active: end + GRACE_DAYS * day > now, reason: end + GRACE_DAYS * day > now ? 'ok' : 'past_due', limits };
  if (ws.planStatus === 'past_due') return { active: end + GRACE_DAYS * day > now, reason: 'past_due', limits };
  if (ws.planStatus === 'canceled') return { active: end > now, reason: end > now ? 'ok' : 'canceled', limits };
  return { active: false, reason: 'canceled', limits };
}

export const currentPeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
