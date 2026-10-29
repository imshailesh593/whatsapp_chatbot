import { PLANS } from '../plans';
import { razorpayLinkMode } from './billing';

const env = (k: string) => process.env[k] ?? '';
const auth = () => 'Basic ' + Buffer.from(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`).toString('base64');

async function rz<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error?.description ?? `Razorpay error (${res.status})`);
  return data as T;
}

export const planEnvName = (planId: string) => `RAZORPAY_PLAN_${planId.toUpperCase()}`;

/** Creates one monthly Razorpay Plan per plan of ours that has no plan id configured yet. Razorpay cannot delete plans, so never run it twice. */
export async function createPlans(): Promise<{ plan: string; razorpayPlanId: string; created: boolean }[]> {
  if (!env('RAZORPAY_KEY_ID') || !env('RAZORPAY_KEY_SECRET')) throw new Error('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET first');
  const out: { plan: string; razorpayPlanId: string; created: boolean }[] = [];
  for (const p of PLANS) {
    const existing = env(planEnvName(p.id));
    if (existing) {
      out.push({ plan: p.id, razorpayPlanId: existing, created: false });
      continue;
    }
    const made = await rz<{ id: string }>('POST', '/plans', {
      period: 'monthly',
      interval: 1,
      item: { name: `${p.name} plan`, amount: p.price.INR, currency: 'INR', description: p.blurb },
      notes: { plan: p.id }
    });
    out.push({ plan: p.id, razorpayPlanId: made.id, created: true });
  }
  return out;
}

export interface SetupCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * A checklist of what is and is not ready for Razorpay payments. With `live` it also calls Razorpay to prove the
 * keys work and that each configured plan exists with the right price and billing period.
 */
export async function checkRazorpay(live: boolean): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];
  const keys = !!env('RAZORPAY_KEY_ID') && !!env('RAZORPAY_KEY_SECRET');
  const link = razorpayLinkMode();
  checks.push({ label: 'API keys', ok: keys, detail: keys ? (env('RAZORPAY_KEY_ID').startsWith('rzp_test') ? 'Set (TEST mode keys: no real money moves)' : 'Set (live keys)') : 'Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server .env' });
  checks.push({ label: 'Webhook secret', ok: !!env('RAZORPAY_WEBHOOK_SECRET'), detail: env('RAZORPAY_WEBHOOK_SECRET') ? 'Set' : 'Without it payments can never switch a plan on. Add RAZORPAY_WEBHOOK_SECRET' });
  checks.push({ label: 'Mode', ok: true, detail: link ? 'Payment links (30 days at a time, owner renews by paying again)' : 'Subscriptions (renew by themselves)' });

  if (!link) {
    for (const p of PLANS) {
      const id = env(planEnvName(p.id));
      checks.push({ label: `${p.name} plan id`, ok: !!id, detail: id ? id : `Run: node dist/cli/razorpaySetup.js, then add ${planEnvName(p.id)}` });
    }
  }
  if (!live || !keys) return checks;

  try {
    await rz('GET', '/plans?count=1');
    checks.push({ label: 'Razorpay connection', ok: true, detail: 'The keys work' });
  } catch (err) {
    checks.push({ label: 'Razorpay connection', ok: false, detail: `${(err as Error).message}. Check the keys and that your account is activated for the mode you use` });
    return checks;
  }
  if (!link) {
    for (const p of PLANS) {
      const id = env(planEnvName(p.id));
      if (!id) continue;
      try {
        const plan = await rz<{ period: string; interval: number; item: { amount: number; currency: string } }>('GET', `/plans/${encodeURIComponent(id)}`);
        const right = plan.period === 'monthly' && plan.interval === 1 && plan.item.amount === p.price.INR && plan.item.currency === 'INR';
        checks.push({ label: `${p.name} plan in Razorpay`, ok: right, detail: right ? `₹${p.price.INR / 100} monthly` : `Razorpay has ${plan.item.currency} ${plan.item.amount / 100} per ${plan.interval} ${plan.period}; ours is ₹${p.price.INR / 100} monthly. The price in Razorpay must match` });
      } catch (err) {
        checks.push({ label: `${p.name} plan in Razorpay`, ok: false, detail: (err as Error).message });
      }
    }
  }
  return checks;
}
