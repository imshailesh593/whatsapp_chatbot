import type { Workspace } from '@prisma/client';

// Plan catalogue: one plan, priced per currency (rupees for Indian customers, dollars for the rest). To change the
// price edit it here, then create matching plans in Stripe / Razorpay / PayPal and put their ids in the environment
// (STRIPE_PRICE_PRO, RAZORPAY_PLAN_PRO, PAYPAL_PLAN_PRO).
export interface PlanDef {
  id: 'pro';
  name: string;
  /** Smallest unit: paise (INR) and cents (USD), per month */
  price: { INR: number; USD: number };
  limits: Limits;
  /** Webhooks and the REST API */
  integrations: boolean;
  blurb: string;
}

export interface Limits {
  /** New customer conversations per calendar month */
  conversations: number;
  /** AI-written answers to side questions per month */
  aiReplies: number;
  /** Team members (owner included) */
  seats: number;
  /** Broadcast messages sent per month */
  broadcasts: number;
}

export const PLANS: PlanDef[] = [
  { id: 'pro', name: 'Pro', price: { INR: 49_900, USD: 1_900 }, limits: { conversations: 1_500, aiReplies: 2_000, seats: 5, broadcasts: 1_000 }, integrations: true, blurb: 'Everything included: one WhatsApp number, AI answers, calendar booking, CRM, broadcasts and integrations.' }
];

/** Plans that were sold before there was a single plan. Their subscribers and old records are treated as the one plan. */
const LEGACY_PLAN_IDS = ['starter', 'growth', 'scale'];

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 3;
const UNLIMITED: Limits = { conversations: Infinity, aiReplies: Infinity, seats: Infinity, broadcasts: Infinity };

export const planById = (id: string) => PLANS.find((p) => p.id === id) ?? (LEGACY_PLAN_IDS.includes(id) ? PLANS[0] : undefined);

export type AccessState = {
  /** The bot may reply to customers */
  active: boolean;
  /** Short machine-readable reason when not active */
  reason: 'ok' | 'trial_expired' | 'canceled' | 'past_due';
  limits: Limits;
  integrations: boolean;
};

const day = 86_400_000;

/** Pure function of the workspace row: can this business use the product right now, and within which limits? */
export function accessState(ws: Pick<Workspace, 'plan' | 'planStatus' | 'trialEndsAt' | 'currentPeriodEnd'>, now = Date.now()): AccessState {
  if (ws.plan === 'internal') return { active: true, reason: 'ok', limits: UNLIMITED, integrations: true };
  // A trial gets the full plan so owners can try the real product
  const def = planById(ws.plan === 'trial' ? 'pro' : ws.plan) ?? PLANS[0];
  const limits = def.limits;
  const integrations = def.integrations;
  if (ws.planStatus === 'trialing') {
    const ok = !!ws.trialEndsAt && ws.trialEndsAt.getTime() > now;
    return { active: ok, reason: ok ? 'ok' : 'trial_expired', limits, integrations };
  }
  const end = ws.currentPeriodEnd?.getTime() ?? 0;
  if (ws.planStatus === 'active') return { active: end + GRACE_DAYS * day > now, reason: end + GRACE_DAYS * day > now ? 'ok' : 'past_due', limits, integrations };
  if (ws.planStatus === 'past_due') return { active: end + GRACE_DAYS * day > now, reason: 'past_due', limits, integrations };
  if (ws.planStatus === 'canceled') return { active: end > now, reason: end > now ? 'ok' : 'canceled', limits, integrations };
  return { active: false, reason: 'canceled', limits, integrations };
}

export const currentPeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
