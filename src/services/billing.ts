import crypto from 'crypto';
import { recordCommission } from './affiliate';
import { deliverAlert } from './alerts';
import type { Workspace } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { invalidateConfig } from './botConfig';
import { PLANS, planById, TRIAL_DAYS } from '../plans';

export type Provider = 'stripe' | 'razorpay';

const env = (k: string) => process.env[k] ?? '';

/**
 * Razorpay works in one of two ways:
 *  - subscriptions (default): recurring monthly plans that renew by themselves (UPI AutoPay / cards). The three
 *    Razorpay Plans are created once with `node dist/cli/razorpaySetup.js`; webhooks keep the app in step.
 *  - payment links (RAZORPAY_MODE=link): a one-off hosted payment for 30 days; the owner pays again to renew.
 */
export const razorpayLinkMode = () => env('RAZORPAY_MODE') === 'link';
export const LINK_DAYS = 30;

export function providersAvailable(): Record<Provider, boolean> {
  const keys = !!env('RAZORPAY_KEY_ID') && !!env('RAZORPAY_KEY_SECRET');
  return {
    stripe: !!env('STRIPE_SECRET_KEY') && PLANS.every((p) => !!env(`STRIPE_PRICE_${p.id.toUpperCase()}`)),
    // Without the webhook secret a payment could never switch a plan on, so it counts as not set up
    razorpay: keys && !!env('RAZORPAY_WEBHOOK_SECRET') && (razorpayLinkMode() || PLANS.every((p) => !!env(`RAZORPAY_PLAN_${p.id.toUpperCase()}`)))
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
  if (razorpayLinkMode()) {
    // A paid-up card or UPI subscription is managed by the provider, not by one-off links
    if (ws.providerSubscriptionId && ws.planStatus === 'active') throw new Error('You already have an active subscription');
    return { url: await createPaymentLink(ws, plan.id, email, back + '?billing=success') };
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

/** A hosted Razorpay page for one payment: LINK_DAYS days of a plan. The webhook turns the plan on when it is paid. */
async function createPaymentLink(ws: Pick<Workspace, 'id' | 'businessName'>, planId: string, email: string | null, callbackUrl: string): Promise<string> {
  const plan = planById(planId);
  if (!plan) throw new Error('Unknown plan');
  const link = await razorpay<{ id: string; short_url: string }>('/payment_links', {
    amount: plan.price.INR,
    currency: 'INR',
    accept_partial: false,
    description: `${plan.name} plan, ${LINK_DAYS} days`.slice(0, 250),
    reference_id: `${ws.id.slice(0, 8)}-${plan.id}-${Date.now().toString(36)}`,
    customer: email ? { name: ws.businessName.slice(0, 50), email } : { name: ws.businessName.slice(0, 50) },
    notify: { email: false, sms: false },
    reminder_enable: false,
    notes: { workspaceId: ws.id, plan: plan.id },
    callback_url: callbackUrl,
    callback_method: 'get'
  });
  return link.short_url;
}

export async function openPortal(ws: Workspace, baseUrl: string): Promise<{ url: string }> {
  if (ws.billingProvider !== 'stripe' || !ws.providerCustomerId) throw new Error('No Stripe subscription to manage');
  const s = await stripe<{ url: string }>('/billing_portal/sessions', { customer: ws.providerCustomerId, return_url: `${baseUrl}/admin/` });
  return { url: s.url };
}

/** Cancel at the end of the paid period (the owner keeps access until then). */
export async function cancelSubscription(ws: Workspace): Promise<void> {
  if (ws.billingProvider === 'razorpay_link') throw new Error('Your plan is paid by link and does not renew by itself, so there is nothing to cancel. It simply ends on the date shown.');
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
  const row = await prisma.payment
    .create({ data: { workspaceId, provider: p.provider, providerRef: p.ref, plan: p.plan, amount: p.amount, currency: p.currency.toUpperCase(), status: p.status } })
    .catch(() => null); // same payment reported twice
  if (row) await recordCommission(row);
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
  if (event.event === 'payment_link.paid') return applyPaymentLink(event);
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

/** A payment link was paid: switch the plan on (or extend it) for LINK_DAYS days. */
async function applyPaymentLink(event: any): Promise<{ status: number; body: string }> {
  const link = event.payload?.payment_link?.entity;
  const pay = event.payload?.payment?.entity;
  const wsId = String(link?.notes?.workspaceId ?? pay?.notes?.workspaceId ?? '');
  const plan = planById(String(link?.notes?.plan ?? pay?.notes?.plan ?? ''));
  const ws = wsId ? await prisma.workspace.findUnique({ where: { id: wsId } }) : null;
  if (!ws || !plan || !pay?.id || ws.plan === 'internal') return { status: 200, body: 'ignored' };

  const amount = Number(pay.amount ?? link?.amount_paid ?? 0);
  const row = await prisma.payment
    .create({ data: { workspaceId: ws.id, provider: 'razorpay', providerRef: String(pay.id), plan: plan.id, amount, currency: String(pay.currency ?? 'INR').toUpperCase(), status: 'paid' } })
    .catch(() => null); // the same payment reported twice
  if (!row) return { status: 200, body: 'duplicate' };
  await recordCommission(row);
  if (amount < plan.price.INR) return { status: 200, body: 'underpaid' }; // recorded, but not enough to switch the plan on

  const now = Date.now();
  // Paying again for the same plan before it ends adds days; a different plan starts now
  const stacking = ws.plan === plan.id && ws.planStatus === 'active' && !!ws.currentPeriodEnd && ws.currentPeriodEnd.getTime() > now;
  const from = stacking ? ws.currentPeriodEnd!.getTime() : now;
  await prisma.workspace.update({
    where: { id: ws.id },
    data: { plan: plan.id, planStatus: 'active', currentPeriodEnd: new Date(from + LINK_DAYS * 86_400_000), cancelAtPeriodEnd: false, billingProvider: 'razorpay_link', providerSubscriptionId: null }
  });
  invalidateConfig(ws.id);
  return { status: 200, body: 'ok' };
}

/** Link-paid plans do not renew by themselves: a few days before the end the owner gets a fresh payment link. */
export async function renewalTick(now = Date.now(), baseUrl = process.env.PUBLIC_URL ?? ''): Promise<number> {
  if (!providersAvailable().razorpay || !razorpayLinkMode()) return 0;
  const due = await prisma.workspace.findMany({
    where: { billingProvider: 'razorpay_link', planStatus: 'active', currentPeriodEnd: { gt: new Date(now), lt: new Date(now + 3 * 86_400_000) } },
    include: { adminUsers: { where: { role: 'owner' }, take: 1 } },
    take: 50
  });
  let sent = 0;
  for (const ws of due) {
    const plan = planById(ws.plan);
    if (!plan || !(await firstTime(`renewal:${ws.id}:${ws.currentPeriodEnd!.toISOString().slice(0, 10)}`))) continue;
    try {
      const url = await createPaymentLink(ws, plan.id, ws.adminUsers[0]?.email ?? null, `${baseUrl.replace(/\/$/, '')}/admin/?billing=success`);
      const end = ws.currentPeriodEnd!.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      await deliverAlert(ws.id, `⏰ Your ${plan.name} plan ends on ${end}`, `To keep your bot replying, pay ₹${plan.price.INR / 100} for ${LINK_DAYS} more days: ${url}\n\nYou can also pay from Plan & billing in the dashboard.`);
      sent++;
    } catch (err) {
      console.error('[billing] renewal reminder failed:', (err as Error).message);
    }
  }
  return sent;
}

export function startRenewalWorker(): { stop(): void } {
  const t = setInterval(() => renewalTick().catch((e) => console.error('[billing] renewal pass failed:', e)), 3600_000);
  return { stop: () => clearInterval(t) };
}

export const trialEndDate = (from = new Date()) => new Date(from.getTime() + TRIAL_DAYS * 86_400_000);
