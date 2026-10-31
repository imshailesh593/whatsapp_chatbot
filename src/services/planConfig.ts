import { PLANS, PLAN_DEFAULTS, type Limits, type PlanDef } from '../plans';
import { getSetting, setSetting } from './settings';

/** What the operator changed in the admin panel, per plan id. Everything else keeps the value from src/plans.ts. */
interface PlanOverride {
  name?: string;
  blurb?: string;
  price?: { INR: number; USD: number };
  limits?: Limits;
  integrations?: boolean;
}

const STORE = 'planOverrides';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function applyOne(def: PlanDef, o: PlanOverride | undefined) {
  const base = PLAN_DEFAULTS.find((p) => p.id === def.id)!;
  def.name = o?.name ?? base.name;
  def.blurb = o?.blurb ?? base.blurb;
  def.price = clone(o?.price ?? base.price);
  def.limits = clone(o?.limits ?? base.limits);
  def.integrations = o?.integrations ?? base.integrations;
}

/** Call once at start-up. */
export async function loadPlanOverrides(): Promise<void> {
  const stored = await getSetting<Record<string, PlanOverride>>(STORE, {});
  for (const p of PLANS) applyOne(p, stored[p.id]);
}

const whole = (v: unknown, min: number, max: number, label: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  return n;
};

/** Validates and saves changes to one plan. Prices are in the smallest unit (paise and cents) in the API. Throws a readable Error. */
export async function updatePlan(id: string, body: Record<string, any>): Promise<PlanDef> {
  const def = PLANS.find((p) => p.id === id);
  if (!def) throw new Error('Unknown plan');
  const next: PlanOverride = {
    name: def.name,
    blurb: def.blurb,
    price: clone(def.price),
    limits: clone(def.limits),
    integrations: def.integrations
  };
  if (body.name !== undefined) {
    const n = String(body.name).replace(/\s+/g, ' ').trim();
    if (n.length < 2 || n.length > 40) throw new Error('The plan name must be 2 to 40 characters');
    next.name = n;
  }
  if (body.blurb !== undefined) {
    const b = String(body.blurb).replace(/\s+/g, ' ').trim();
    if (b.length < 10 || b.length > 300) throw new Error('The description must be 10 to 300 characters');
    next.blurb = b;
  }
  if (body.priceInr !== undefined) next.price!.INR = Math.round(whole(Math.round(Number(body.priceInr) * 100), 100, 100_000_00, 'The rupee price (₹1 to ₹1,00,000)'));
  if (body.priceUsd !== undefined) next.price!.USD = Math.round(whole(Math.round(Number(body.priceUsd) * 100), 100, 10_000_00, 'The dollar price ($1 to $10,000)'));
  const lim = body.limits ?? {};
  if (lim.conversations !== undefined) next.limits!.conversations = whole(lim.conversations, 1, 10_000_000, 'Conversations');
  if (lim.aiReplies !== undefined) next.limits!.aiReplies = whole(lim.aiReplies, 0, 10_000_000, 'AI answers');
  if (lim.seats !== undefined) next.limits!.seats = whole(lim.seats, 1, 1000, 'Team members');
  if (lim.broadcasts !== undefined) next.limits!.broadcasts = whole(lim.broadcasts, 0, 10_000_000, 'Broadcasts');
  if (body.integrations !== undefined) next.integrations = !!body.integrations;
  const stored = { ...(await getSetting<Record<string, PlanOverride>>(STORE, {})), [id]: next };
  await setSetting(STORE, stored);
  applyOne(def, next);
  return def;
}

/** Puts a plan back to what src/plans.ts says. */
export async function resetPlan(id: string): Promise<PlanDef> {
  const def = PLANS.find((p) => p.id === id);
  if (!def) throw new Error('Unknown plan');
  const stored = { ...(await getSetting<Record<string, PlanOverride>>(STORE, {})) };
  delete stored[id];
  await setSetting(STORE, stored);
  applyOne(def, undefined);
  return def;
}
