import crypto from 'crypto';
import type { Workspace } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { invalidateConfig } from './botConfig';
import { PLANS, planById, TRIAL_DAYS } from '../plans';

export type Provider = 'stripe' | 'razorpay';

const env = (k: string) => process.env[k] ?? '';

export function providersAvailable(): Record<Provider, boolean> {
  return {
    stripe: !!env('STRIPE_SECRET_KEY') && PLANS.every((p) => !!env(`STRIPE_PRICE_${p.id.toUpperCase()}`)),
    razorpay: !!env('RAZORPAY_KEY_ID') && !!env('RAZORPAY_KEY_SECRET') && PLANS.every((p) => !!env(`RAZORPAY_PLAN_${p.id.toUpperCase()}`))
  };
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error?.message ?? data?.error?.description ?? `Payment provider error (${res.status})`);
  return data as T;
}

const stripe = <T>(path: string, body: Record<string, string>) =>
  call<T>(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(body)
  });

const razorpay = <T>(path: string, body: unknown) =>
  call<T>(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`).toString('base64'),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

/** Starts a subscription purchase and returns the provider-hosted page to send the owner to. */
export async function startCheckout(ws: Workspace, planId: string, provider: Provider, email: string, baseUrl: string): Promise<{ url: string }> {
  const plan = planById(planId);
  if (!plan) throw new Error('Unknown plan');
  if (!providersAvailable()[provider]) throw new Error('This payment method is not set up yet');
  const back = `${baseUrl}/admin/`;
  if (provider === 'stripe') {
    const body: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': env(`STRIPE_PRICE_${plan.id.toUpperCase()}`),
      'line_items[0][quantity]': '1',
      success_url: `${back}?billing=success`,
      cancel_url: `${back}?billing=cancelled`,
      client_reference_id: ws.id,
      'subscription_data[metadata][workspaceId]': ws.id,
      'subscription_data[metadata][plan]': plan.id
    };
    if (ws.providerCustomerId && ws.billingProvider === 'stripe') body.customer = ws.providerCustomerId;
    else body.customer_email = email;
    const s = await stripe<{ url: string }>('/checkout/sessions', body);
    return { url: s.url };
  }
  const sub = await razorpay<{ id: string; short_url: string }>('/subscriptions', {
    plan_id: env(`RAZORPAY_PLAN_${plan.id.toUpperCase()}`),
    total_count: 120,
    customer_notify: 1,
    notes: { workspaceId: ws.id, plan: plan.id }
  });
  await prisma.workspace.update({ where: { id: ws.id }, data: { billingProvider: 'razorpay', providerSubscriptionId: sub.id } });
  invalidateConfig(ws.id);
  return { url: sub.short_url };
}

export async function openPortal(ws: Workspace, baseUrl: string): Promise<{ url: string }> {
  if (ws.billingProvider !== 'stripe' || !ws.providerCustomerId) throw new Error('No Stripe subscription to manage');
  const s = await stripe<{ url: string }>('/billing_portal/sessions', { customer: ws.providerCustomerId, return_url: `${baseUrl}/admin/` });
  return { url: s.url };
}

/** Cancel at the end of the paid period (the owner keeps access until then). */
export async function cancelSubscription(ws: Workspace): Promise<void> {
  if (!ws.providerSubscriptionId || !ws.billingProvider) throw new Error('No active subscription');
  if (ws.billingProvider === 'stripe') await stripe(`/subscriptions/${ws.providerSubscriptionId}`, { cancel_at_period_end: 'true' });
  else await razorpay(`/subscriptions/${ws.providerSubscriptionId}/cancel`, { cancel_at_cycle_end: 1 });
  await prisma.workspace.update({ where: { id: ws.id }, data: { cancelAtPeriodEnd: true } });
  invalidateConfig(ws.id);
}

// ---------- applying provider state to the workspace ----------

interface SubState {
  plan?: string;
  status: 'active' | 'past_due' | 'canceled';
  periodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  provider: Provider;
  customerId?: string | null;
  subscriptionId?: string | null;
}

export async function applySubscription(workspaceId: string, s: SubState): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws || ws.plan === 'internal') return;
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      plan: s.plan && planById(s.plan) ? s.plan : ws.plan === 'trial' ? 'growth' : ws.plan,
      planStatus: s.status,
      currentPeriodEnd: s.periodEnd === undefined ? ws.currentPeriodEnd : s.periodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd ?? ws.cancelAtPeriodEnd,
      billingProvider: s.provider,
      providerCustomerId: s.customerId ?? ws.providerCustomerId,
      providerSubscriptionId: s.subscriptionId ?? ws.providerSubscriptionId
    }
  });
  invalidateConfig(workspaceId);
}

async function firstTime(id: string): Promise<boolean> {
  try {
    await prisma.billingEvent.create({ data: { id } });
    return true;
  } catch {
    return false; // already processed
  }
}

async function recordPayment(workspaceId: string, p: { provider: Provider; ref: string; plan: string; amount: number; currency: string; status: string }) {
  await prisma.payment
    .create({ data: { workspaceId, provider: p.provider, providerRef: p.ref, plan: p.plan, amount: p.amount, currency: p.currency.toUpperCase(), status: p.status } })
    .catch(() => undefined); // same payment reported twice
}

const secondsToDate = (s: unknown) => (typeof s === 'number' ? new Date(s * 1000) : null);

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- Stripe webhook ----------

export function verifyStripeSignature(raw: string, header: string | undefined, secret: string, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return header.split(',').some((kv) => kv.startsWith('v1=') && safeEqual(kv.slice(3), expected));
}

async function workspaceForStripe(obj: any): Promise<string | null> {
  const direct = obj?.metadata?.workspaceId ?? obj?.client_reference_id ?? obj?.subscription_details?.metadata?.workspaceId;
  if (direct) return String(direct);
  const sub = obj?.object === 'subscription' ? obj.id : obj?.subscription;
  const cust = obj?.customer;
  const w = await prisma.workspace.findFirst({
    where: { OR: [...(sub ? [{ providerSubscriptionId: String(sub) }] : []), ...(cust ? [{ providerCustomerId: String(cust) }] : [])] },
    select: { id: true }
  });
  return w?.id ?? null;
}

export async function handleStripeWebhook(raw: string, signature: string | undefined): Promise<{ status: number; body: string }> {
  if (!verifyStripeSignature(raw, signature, env('STRIPE_WEBHOOK_SECRET'))) return { status: 400, body: 'bad signature' };
  const event = JSON.parse(raw);
  if (!(await firstTime(`stripe:${event.id}`))) return { status: 200, body: 'duplicate' };
  const obj = event.data?.object;
  const wsId = await workspaceForStripe(obj);
  if (!wsId) return { status: 200, body: 'no workspace' };

  switch (event.type) {
    case 'checkout.session.completed':
      await applySubscription(wsId, { status: 'active', provider: 'stripe', customerId: obj.customer, subscriptionId: obj.subscription, plan: obj.metadata?.plan });
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const st = String(obj.status);
      const status = st === 'active' || st === 'trialing' ? 'active' : st === 'past_due' || st === 'unpaid' ? 'past_due' : 'canceled';
      await applySubscription(wsId, {
        status,
        provider: 'stripe',
        plan: obj.metadata?.plan,
        customerId: obj.customer,
        subscriptionId: obj.id,
        periodEnd: secondsToDate(obj.current_period_end ?? obj.items?.data?.[0]?.current_period_end),
        cancelAtPeriodEnd: !!obj.cancel_at_period_end
      });
      break;
    }
    case 'customer.subscription.deleted':
      await applySubscription(wsId, { status: 'canceled', provider: 'stripe', periodEnd: new Date(), cancelAtPeriodEnd: false });
      break;
    case 'invoice.paid':
      await recordPayment(wsId, {
        provider: 'stripe',
        ref: String(obj.id),
        plan: String(obj.lines?.data?.[0]?.metadata?.plan ?? obj.subscription_details?.metadata?.plan ?? ''),
        amount: Number(obj.amount_paid ?? 0),
        currency: String(obj.currency ?? 'usd'),
        status: 'paid'
      });
      await applySubscription(wsId, {
        status: 'active',
        provider: 'stripe',
        periodEnd: secondsToDate(obj.lines?.data?.[0]?.period?.end)
      });
      break;
    case 'invoice.payment_failed':
      await applySubscription(wsId, { status: 'past_due', provider: 'stripe' });
      break;
  }
  return { status: 200, body: 'ok' };
}

// ---------- Razorpay webhook ----------

export function verifyRazorpaySignature(raw: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  return safeEqual(signature, crypto.createHmac('sha256', secret).update(raw).digest('hex'));
}

export async function handleRazorpayWebhook(raw: string, signature: string | undefined, eventId: string | undefined): Promise<{ status: number; body: string }> {
  if (!verifyRazorpaySignature(raw, signature, env('RAZORPAY_WEBHOOK_SECRET'))) return { status: 400, body: 'bad signature' };
  const event = JSON.parse(raw);
  if (eventId && !(await firstTime(`razorpay:${eventId}`))) return { status: 200, body: 'duplicate' };
  const sub = event.payload?.subscription?.entity;
  const pay = event.payload?.payment?.entity;
  const wsId: string | null =
    sub?.notes?.workspaceId ??
    pay?.notes?.workspaceId ??
    (sub?.id ? (await prisma.workspace.findFirst({ where: { providerSubscriptionId: String(sub.id) }, select: { id: true } }))?.id ?? null : null);
  if (!wsId) return { status: 200, body: 'no workspace' };
  const planFromId = (planId?: string) => PLANS.find((p) => env(`RAZORPAY_PLAN_${p.id.toUpperCase()}`) === planId)?.id;
  const plan: string | undefined = sub?.notes?.plan ?? planFromId(sub?.plan_id);
  const base = { provider: 'razorpay' as const, subscriptionId: sub?.id ? String(sub.id) : undefined, customerId: sub?.customer_id ?? undefined, plan };

  switch (event.event) {
    case 'subscription.activated':
    case 'subscription.charged':
    case 'subscription.resumed':
      await applySubscription(wsId, { ...base, status: 'active', periodEnd: secondsToDate(sub?.current_end), cancelAtPeriodEnd: false });
      if (event.event === 'subscription.charged' && pay) {
        await recordPayment(wsId, { provider: 'razorpay', ref: String(pay.id), plan: plan ?? '', amount: Number(pay.amount ?? 0), currency: String(pay.currency ?? 'INR'), status: 'paid' });
      }
      break;
    case 'subscription.pending':
    case 'subscription.halted':
      await applySubscription(wsId, { ...base, status: 'past_due' });
      break;
    case 'subscription.cancelled':
    case 'subscription.completed':
      await applySubscription(wsId, { ...base, status: 'canceled', periodEnd: secondsToDate(sub?.current_end) ?? new Date(), cancelAtPeriodEnd: false });
      break;
  }
  return { status: 200, body: 'ok' };
}

export const trialEndDate = (from = new Date()) => new Date(from.getTime() + TRIAL_DAYS * 86_400_000);
