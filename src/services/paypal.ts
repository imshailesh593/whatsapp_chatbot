import { PLANS, planById } from '../plans';
import { PRODUCT_NAME } from '../brand';

const env = (k: string) => (process.env[k] ?? '').trim();

/** `live` unless PAYPAL_MODE=sandbox, so a forgotten setting can never send test payments to the wrong place silently. */
export const paypalMode = (): 'live' | 'sandbox' => (env('PAYPAL_MODE') === 'sandbox' ? 'sandbox' : 'live');
const apiBase = () => (paypalMode() === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');
export const paypalKeys = () => !!env('PAYPAL_CLIENT_ID') && !!env('PAYPAL_CLIENT_SECRET');
export const paypalPlanEnv = (planId: string) => `PAYPAL_PLAN_${planId.toUpperCase()}`;

/** Billing events we need PayPal to send to /webhooks/paypal. */
export const PAYPAL_EVENTS = [
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.RE-ACTIVATED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'PAYMENT.SALE.COMPLETED'
];

let cached: { token: string; expires: number; key: string } | null = null;

async function accessToken(): Promise<string> {
  const key = `${paypalMode()}:${env('PAYPAL_CLIENT_ID')}:${env('PAYPAL_CLIENT_SECRET')}`;
  if (cached && cached.key === key && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${env('PAYPAL_CLIENT_ID')}:${env('PAYPAL_CLIENT_SECRET')}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000)
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data.access_token) {
    throw new Error(`PayPal rejected the credentials (${data?.error_description ?? data?.error ?? res.status}). Check the client id and secret, and that PAYPAL_MODE matches (live or sandbox)`);
  }
  cached = { token: data.access_token, expires: Date.now() + Number(data.expires_in ?? 300) * 1000, key };
  return cached.token;
}

export async function pp<T = any>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as any;
  if (!res.ok) {
    const detail = data?.details?.[0]?.description ?? data?.message ?? data?.error_description;
    throw new Error(`PayPal error (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return data as T;
}

const money = (cents: number) => (cents / 100).toFixed(2);

/** A hosted PayPal page where the owner approves a recurring monthly payment. */
export async function createSubscription(opts: { ourPlanId: string; workspaceId: string; email: string; brand: string; returnUrl: string; cancelUrl: string }): Promise<{ id: string; approveUrl: string }> {
  const plan = env(paypalPlanEnv(opts.ourPlanId));
  if (!plan) throw new Error('This plan is not set up in PayPal yet');
  const sub = await pp<{ id: string; links?: { rel: string; href: string }[] }>('POST', '/v1/billing/subscriptions', {
    plan_id: plan,
    custom_id: `${opts.workspaceId}:${opts.ourPlanId}`,
    subscriber: { email_address: opts.email },
    application_context: {
      brand_name: opts.brand.slice(0, 127),
      user_action: 'SUBSCRIBE_NOW',
      shipping_preference: 'NO_SHIPPING',
      return_url: opts.returnUrl,
      cancel_url: opts.cancelUrl
    }
  });
  const approveUrl = sub.links?.find((l) => l.rel === 'approve')?.href ?? '';
  // The page we send an owner to must really be PayPal's
  if (!sub.id || !/^https:\/\/([a-z0-9-]+\.)*paypal\.com\//i.test(approveUrl)) throw new Error('PayPal did not return an approval page');
  return { id: sub.id, approveUrl };
}

export const getSubscription = (id: string) => pp<any>('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`);

export const cancelPaypalSubscription = (id: string) =>
  pp('POST', `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: 'Cancelled by the customer' });

/** Asks PayPal whether a webhook really came from PayPal. Needs PAYPAL_WEBHOOK_ID. */
export async function verifyPaypalWebhook(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  const webhookId = env('PAYPAL_WEBHOOK_ID');
  const h = (k: string) => String(headers[k] ?? '');
  if (!webhookId || !h('paypal-transmission-sig')) return false;
  try {
    const r = await pp<{ verification_status?: string }>('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: h('paypal-auth-algo'),
      cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: event
    });
    return r.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}

/**
 * Creates one monthly USD PayPal plan per plan of ours that has no plan id in the environment yet, plus the product
 * they belong to. Stable request ids make a repeated run return the same objects instead of creating duplicates.
 */
/** With `force` a new PayPal plan is created even when one is configured (after a price change: PayPal plans cannot change price). */
export async function createPaypalPlans(force = false): Promise<{ plan: string; paypalPlanId: string; created: boolean }[]> {
  if (!paypalKeys()) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET first');
  const out: { plan: string; paypalPlanId: string; created: boolean }[] = [];
  let productId = env('PAYPAL_PRODUCT_ID');
  for (const p of PLANS) {
    const existing = force ? '' : env(paypalPlanEnv(p.id));
    if (existing) {
      out.push({ plan: p.id, paypalPlanId: existing, created: false });
      continue;
    }
    if (!productId) {
      const prod = await pp<{ id: string }>('POST', '/v1/catalogs/products', { name: PRODUCT_NAME, type: 'SERVICE', category: 'SOFTWARE' }, { 'PayPal-Request-Id': 'lead-console-product-v1' });
      productId = prod.id;
    }
    const made = await pp<{ id: string }>(
      'POST',
      '/v1/billing/plans',
      {
        product_id: productId,
        name: `${p.name} plan (monthly)`,
        description: p.blurb.slice(0, 120),
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: { interval_unit: 'MONTH', interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: money(p.price.USD), currency_code: 'USD' } }
          }
        ],
        payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CANCEL', payment_failure_threshold: 3 }
      },
      { 'PayPal-Request-Id': `lead-console-plan-${p.id}-${p.price.USD}`, Prefer: 'return=representation' }
    );
    out.push({ plan: p.id, paypalPlanId: made.id, created: true });
  }
  return out;
}

/** Registers our webhook address with PayPal (or finds it if it is already registered) and returns its id. */
export async function ensurePaypalWebhook(url: string): Promise<{ id: string; created: boolean }> {
  const list = await pp<{ webhooks?: { id: string; url: string }[] }>('GET', '/v1/notifications/webhooks');
  const found = list.webhooks?.find((w) => w.url === url);
  if (found) return { id: found.id, created: false };
  const made = await pp<{ id: string }>('POST', '/v1/notifications/webhooks', { url, event_types: PAYPAL_EVENTS.map((name) => ({ name })) });
  return { id: made.id, created: true };
}

export interface SetupCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/** What is and is not ready for PayPal payments. With `live` it also calls PayPal to prove the credentials and each plan. */
export async function checkPaypal(live: boolean): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];
  const keys = paypalKeys();
  checks.push({ label: 'API credentials', ok: keys, detail: keys ? `Set (${paypalMode().toUpperCase()} mode${paypalMode() === 'sandbox' ? ': no real money moves' : ''})` : 'Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to the server .env' });
  checks.push({ label: 'Webhook id', ok: !!env('PAYPAL_WEBHOOK_ID'), detail: env('PAYPAL_WEBHOOK_ID') ? 'Set' : 'Without it payments can never switch a plan on. Run: node dist/cli/paypalSetup.js, then add PAYPAL_WEBHOOK_ID' });
  for (const p of PLANS) {
    const id = env(paypalPlanEnv(p.id));
    checks.push({ label: `${p.name} plan id`, ok: !!id, detail: id ? id : `Run: node dist/cli/paypalSetup.js, then add ${paypalPlanEnv(p.id)}` });
  }
  if (!live || !keys) return checks;

  try {
    await accessToken();
    checks.push({ label: 'PayPal connection', ok: true, detail: 'The credentials work' });
  } catch (err) {
    checks.push({ label: 'PayPal connection', ok: false, detail: (err as Error).message });
    return checks;
  }
  for (const p of PLANS) {
    const id = env(paypalPlanEnv(p.id));
    if (!id) continue;
    try {
      const plan = await pp<any>('GET', `/v1/billing/plans/${encodeURIComponent(id)}`);
      const cycle = plan.billing_cycles?.find((c: any) => c.tenure_type === 'REGULAR');
      const price = cycle?.pricing_scheme?.fixed_price;
      const good = plan.status === 'ACTIVE' && cycle?.frequency?.interval_unit === 'MONTH' && cycle?.frequency?.interval_count === 1 && price?.currency_code === 'USD' && Number(price?.value) === p.price.USD / 100; // PayPal may return 19.0 for 19.00
      checks.push({
        label: `${p.name} plan in PayPal`,
        ok: good,
        detail: good ? `Active, $${price.value} every month` : `Must be ACTIVE and $${money(p.price.USD)} USD monthly; found ${plan.status} ${price?.value ?? '?'} ${price?.currency_code ?? ''} per ${cycle?.frequency?.interval_unit ?? '?'}. Create a new plan and update ${paypalPlanEnv(p.id)}`
      });
    } catch (err) {
      checks.push({ label: `${p.name} plan in PayPal`, ok: false, detail: (err as Error).message });
    }
  }
  return checks;
}

export const planFromPaypal = (customId?: string, planId?: string): string | undefined => {
  const fromCustom = customId?.split(':')[1];
  if (fromCustom && planById(fromCustom)) return fromCustom;
  return PLANS.find((p) => env(paypalPlanEnv(p.id)) === planId)?.id;
};
