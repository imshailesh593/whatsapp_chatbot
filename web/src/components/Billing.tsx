import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { api } from '../api';
import type { AdminUser, BillingInfo } from '../types';

const money = (minor: number, cur: string) =>
  new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(minor / 100);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : 0);

function Bar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-400 mb-1">
        <span>{label}</span>
        <span className="text-slate-300">{used.toLocaleString()} / {limit === null ? 'unlimited' : limit.toLocaleString()}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full ${pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${limit === null ? 4 : Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

export default function Billing({ me }: { me: AdminUser }) {
  const [b, setB] = useState<BillingInfo | null>(null);
  const [busy, setBusy] = useState('');
  // The owner can switch currency if the guess from their IP address is wrong
  const [chosen, setChosen] = useState<'INR' | 'USD' | null>(null);
  const [error, setError] = useState('');
  const owner = me.role === 'owner';
  const [code, setCode] = useState('');
  const [redeemed, setRedeemed] = useState('');

  const load = useCallback(() => api.billing().then(setB).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);

  async function go(key: string, fn: () => Promise<{ url: string }>) {
    setBusy(key);
    setError('');
    try {
      window.location.href = (await fn()).url;
    } catch (err) {
      setError((err as Error).message);
      setBusy('');
    }
  }

  async function redeem() {
    setBusy('redeem');
    setError('');
    setRedeemed('');
    try {
      const r = await api.redeemCode(code);
      setRedeemed(`Code applied: ${r.plan === 'trial' ? 'trial extended by' : 'plan active for'} ${r.days} days.`);
      setCode('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function cancel() {
    if (!window.confirm('Cancel your subscription? You keep full access until the end of the period you have paid for.')) return;
    setBusy('cancel');
    try {
      await api.cancelSubscription();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (!b) return <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 text-xs text-slate-500">{error || 'Loading billing…'}</div>;

  const internal = b.plan === 'internal';
  const currency: 'INR' | 'USD' = chosen ?? b.currency ?? 'USD';
  const anyProvider = b.providers.stripe || b.providers.razorpay || b.providers.paypal;
  // Paid by a one-off link: it does not renew by itself, so the owner can pay again at any time
  const linkPaid = b.provider === 'razorpay_link';
  const statusText =
    b.status === 'trialing' ? (b.active ? `Free trial · ${daysLeft(b.trialEndsAt)} days left` : 'Free trial ended')
    : b.status === 'active' && b.provider === 'razorpay_link' ? `Paid until ${day(b.currentPeriodEnd)} · renew before then`
    : b.status === 'active' ? (b.cancelAtPeriodEnd ? `Cancels on ${day(b.currentPeriodEnd)}` : `Renews on ${day(b.currentPeriodEnd)}`)
    : b.status === 'past_due' ? 'Payment failed: please update your payment method'
    : b.active ? `Ends on ${day(b.currentPeriodEnd)}` : 'Subscription ended';
  const pill = !b.active ? 'bg-rose-500/15 text-rose-300 border-rose-500/40' : b.status === 'past_due' ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-white text-base flex items-center space-x-2"><CreditCard className="w-4 h-4 text-emerald-400" /><span>Plan &amp; billing</span></h3>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{b.planName}</span>
            {!internal && <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${pill}`}>{statusText}</span>}
            {internal && <span className="text-[11px] text-slate-400">Not billed</span>}
          </div>
        </div>
        {owner && b.provider === 'stripe' && b.status !== 'trialing' && (
          <button onClick={() => go('portal', api.billingPortal)} disabled={!!busy} className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 disabled:opacity-50">
            Manage payment method &amp; invoices
          </button>
        )}
      </div>

      {!b.active && (
        <p className="mt-3 text-xs text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded-lg p-3">
          Your bot is not replying to new customers because {b.reason === 'trial_expired' ? 'the free trial has ended' : 'the subscription has ended'}. Choose a plan below to switch it back on.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Bar label="New conversations this month" used={b.usage.conversations} limit={b.limits.conversations} />
        <Bar label="AI answers this month" used={b.usage.aiReplies} limit={b.limits.aiReplies} />
        <Bar label="Team members" used={b.usage.seats} limit={b.limits.seats} />
        <Bar label="Broadcast messages this month" used={b.usage.broadcasts} limit={b.limits.broadcasts} />
      </div>

      {!internal && (
        <>
          <div className="mt-6 grid grid-cols-1 max-w-sm gap-4">
            {b.plans.map((p) => {
              const current = b.plan !== 'trial' && b.plan !== 'internal' && b.status === 'active'; // there is one plan; older plan names count as it
              return (
                <div key={p.id} className={`rounded-xl border p-4 ${current ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-slate-800 bg-slate-900'}`}>
                  <div className="flex items-baseline justify-between">
                    <div className="font-bold text-white">{p.name}</div>
                    {current && <span className="text-[10px] text-emerald-300">Current plan</span>}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{p.blurb}</div>
                  <div className="mt-3 text-lg font-extrabold text-white">{money(p.price[currency], currency)}<span className="text-xs font-medium text-slate-400"> /month</span></div>
                  <button type="button" onClick={() => setChosen(currency === 'INR' ? 'USD' : 'INR')} className="text-[11px] text-slate-500 hover:text-slate-300 underline">
                    {currency === 'INR' ? `Not in India? Show ${money(p.price.USD, 'USD')}` : `Paying from India? Show ${money(p.price.INR, 'INR')}`}
                  </button>
                  <ul className="mt-3 space-y-1 text-xs text-slate-300">
                    <li>{p.limits.conversations.toLocaleString()} new conversations / month</li>
                    <li>{p.limits.aiReplies.toLocaleString()} AI answers / month</li>
                    <li>{p.limits.seats} team members</li>
                    <li>{p.limits.broadcasts.toLocaleString()} broadcast messages / month</li>
                    <li>1 WhatsApp number</li>
                  </ul>
                  {owner && (!current || linkPaid) && (
                    <div className="mt-4 flex flex-col gap-2">
                      {currency === 'INR' && <button disabled={!b.providers.razorpay || !!busy} onClick={() => go(`rz-${p.id}`, () => api.checkout(p.id, 'razorpay'))}
                        className="py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg disabled:opacity-40 flex items-center justify-center space-x-1.5">
                        {busy === `rz-${p.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<span>{current ? 'Renew for 30 days (₹)' : 'Pay in ₹ (UPI, cards)'}</span>
                      </button>}
                      {!current && currency === 'USD' && b.providers.paypal && <button disabled={!!busy} onClick={() => go(`pp-${p.id}`, () => api.checkout(p.id, 'paypal'))}
                        className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 disabled:opacity-40 flex items-center justify-center space-x-1.5">
                        {busy === `pp-${p.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<span>Pay in $ (PayPal)</span>
                      </button>}
                      {!current && currency === 'USD' && (b.providers.stripe || !b.providers.paypal) && <button disabled={!b.providers.stripe || !!busy} onClick={() => go(`st-${p.id}`, () => api.checkout(p.id, 'stripe'))}
                        className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 disabled:opacity-40 flex items-center justify-center space-x-1.5">
                        {busy === `st-${p.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<span>Pay in $ (card)</span>
                      </button>}
                    </div>
                  )}
                  {owner && !current && currency === 'INR' && !b.providers.razorpay && (
                    <p className="mt-2 text-[11px] text-amber-300">Payment in rupees is being set up. <button type="button" onClick={() => setChosen('USD')} className="underline">Pay in dollars instead</button></p>
                  )}
                </div>
              );
            })}
          </div>
          {owner && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Have a code?" maxLength={32}
                className="w-44 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white uppercase placeholder:normal-case" />
              <button onClick={redeem} disabled={!code.trim() || !!busy} className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 disabled:opacity-40">Apply code</button>
              {redeemed && <span className="text-xs text-emerald-300">{redeemed}</span>}
            </div>
          )}
          {anyProvider && owner && <p className="text-[11px] text-slate-500 mt-3">You pay on the payment provider&apos;s secure page. After paying, come back here: your plan switches on as soon as the payment is confirmed (usually within a minute; refresh if it still shows the trial).</p>}
          {!anyProvider && <p className="text-[11px] text-slate-500 mt-3">Online payment is not switched on for this account yet. Contact support to activate a plan.</p>}
          {!owner && <p className="text-[11px] text-slate-500 mt-3">Only the account owner can change the plan.</p>}
          {owner && b.status === 'active' && !b.cancelAtPeriodEnd && b.provider && !linkPaid && (
            <button onClick={cancel} disabled={!!busy} className="mt-4 text-xs text-slate-400 hover:text-rose-300 underline disabled:opacity-50">Cancel subscription</button>
          )}
        </>
      )}

      {b.payments.length > 0 && (
        <div className="mt-6">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Payments</h4>
          <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-xl overflow-hidden text-xs">
            {b.payments.map((p) => (
              <div key={p.id} className="flex justify-between px-3.5 py-2 bg-slate-900/50">
                <span className="text-slate-300">{day(p.at)} · {p.plan || 'plan'}</span>
                <span className="text-slate-200">{money(p.amount, p.currency)} · {p.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
    </div>
  );
}
