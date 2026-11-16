import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarDays, CreditCard, Loader2, Megaphone, MessageSquare, Phone, RefreshCw, Sparkles, Users } from 'lucide-react';
import { api } from '../api';
import type { AdminUser, BillingInfo } from '../types';

const money = (minor: number, cur: string) =>
  new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(minor / 100);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Bar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted mb-1">
        <span>{label}</span>
        <span className="text-fg2">{used.toLocaleString()} / {limit === null ? 'unlimited' : limit.toLocaleString()}</span>
      </div>
      <div className="h-1.5 rounded-full bg-subtle overflow-hidden">
        <div className={`h-full ${pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${limit === null ? 4 : Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}


// A grainy gradient for the highlighted plan (the grain is an inline SVG noise)
const GRADIENT = 'radial-gradient(95% 80% at 8% 10%, #22d3ee 0%, transparent 62%), radial-gradient(90% 85% at 96% 92%, #0a8a64 0%, transparent 66%), radial-gradient(70% 70% at 88% 8%, #34d399 0%, transparent 60%), #0a2540';
const NOISE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/** One plan: a card with the name and price, the buttons under it, then what is included. */
function PlanColumn(p: { title: string; sub: string; price: string; unit: string; note: string; hot?: boolean; badge?: string; rows: [typeof MessageSquare, string][]; intro: string; buttons?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={`snap-start px-2 sm:px-3 flex flex-col ${p.className ?? ''}`}>
      <div className={`relative overflow-hidden isolate rounded-3xl min-h-[230px] p-5 flex flex-col justify-between ${p.hot ? 'text-white' : 'bg-sunken text-fg border border-line'}`} style={p.hot ? { background: GRADIENT } : undefined}>
        {p.hot && <div aria-hidden className="absolute inset-0 -z-10 opacity-50 mix-blend-overlay pointer-events-none" style={{ backgroundImage: NOISE }} />}
        <div>
          <div className="text-2xl font-semibold tracking-tight">{p.title}</div>
          {p.badge && <span className="inline-block mt-2 text-xs font-semibold px-3 py-0.5 rounded-full border border-white/80">{p.badge}</span>}
          <div className="mt-2 text-xs opacity-80">{p.sub}</div>
        </div>
        <div>
          <span className="text-4xl font-semibold tracking-tight">{p.price}</span><span className="text-sm opacity-75"> {p.unit}</span>
          <div className="mt-1 text-xs opacity-85">{p.note}</div>
        </div>
      </div>
      {p.buttons && <div className="mt-4 flex flex-col gap-2">{p.buttons}</div>}
      {p.footer}
      <div className="mt-6 text-sm text-fg2">{p.intro} <span className="text-muted">↴</span></div>
      <ul className="mt-2 border-t border-dotted border-line-strong">
        {p.rows.map(([Icon, text]) => (
          <li key={text} className="flex items-center gap-3 py-3 text-sm text-fg border-b border-dotted border-line-strong"><Icon className="w-4 h-4 shrink-0 text-fg2" /><span>{text}</span></li>
        ))}
      </ul>
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
  // "Choose Monthly" or "Choose Yearly" on the website: that card is highlighted
  const preferred = (() => { try { const v = sessionStorage.getItem('lk_period'); return v === 'month' || v === 'year' ? v : null; } catch { return null; } })();
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
      setRedeemed(`Code applied: plan active for ${r.days} days.`);
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

  if (!b) return <div className="bg-card border border-line rounded-2xl p-5 text-xs text-muted">{error || 'Loading billing…'}</div>;

  const internal = b.plan === 'internal';
  const currency: 'INR' | 'USD' = chosen ?? b.currency ?? 'USD';
  const anyProvider = b.providers.stripe || b.providers.razorpay || b.providers.paypal;
  // Paid by a one-off link: it does not renew by itself, so the owner can pay again at any time
  const linkPaid = b.provider === 'razorpay_link';
  const statusText =
    b.status === 'inactive' ? 'No plan yet: choose a plan below'
    : b.status === 'active' && b.provider === 'razorpay_link' ? `Paid until ${day(b.currentPeriodEnd)} · renew before then`
    : b.status === 'active' ? (b.cancelAtPeriodEnd ? `Cancels on ${day(b.currentPeriodEnd)}` : `Renews on ${day(b.currentPeriodEnd)}`)
    : b.status === 'past_due' ? 'Payment failed: please update your payment method'
    : b.active ? `Ends on ${day(b.currentPeriodEnd)}` : 'Subscription ended';
  const pill = !b.active ? 'bg-danger-soft text-danger border-danger-line/40' : b.status === 'past_due' ? 'bg-warn-soft text-warn border-warn-line/40' : 'bg-brand-soft text-brand-text border-brand/40';

  return (
    <div className="bg-card border border-line rounded-2xl p-5 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-fg text-base flex items-center space-x-2"><CreditCard className="w-4 h-4 text-brand-text" /><span>Plan &amp; billing</span></h3>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-fg">{b.planName}</span>
            {!internal && <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${pill}`}>{statusText}</span>}
            {internal && <span className="text-[11px] text-muted">Not billed</span>}
          </div>
        </div>
        {owner && b.provider === 'stripe' && b.status !== 'inactive' && (
          <button onClick={() => go('portal', api.billingPortal)} disabled={!!busy} className="px-3.5 py-2 bg-subtle hover:bg-subtle text-fg text-xs rounded-lg border border-line disabled:opacity-50">
            Manage payment method &amp; invoices
          </button>
        )}
      </div>

      {!b.active && (
        <p className="mt-3 text-xs text-danger bg-danger-soft border border-danger-line/60 rounded-lg p-3">
          Your bot is not replying to new customers because {b.reason === 'unpaid' ? 'you have not subscribed yet' : 'the subscription has ended'}. Choose a plan below to switch it on.
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
          <div className="mt-6 grid grid-flow-col auto-cols-[84%] sm:grid-flow-row sm:grid-cols-2 sm:auto-cols-auto max-w-4xl overflow-x-auto sm:overflow-visible snap-x snap-mandatory pb-2 -mx-1">
            {b.plans.flatMap((p) => {
              const current = b.plan !== 'internal' && b.status === 'active'; // one plan sold monthly or yearly; older plan names count as it
              const monthMinor = p.price[currency];
              const yearMinor = currency === 'INR' ? p.yearlyINR : p.yearlyUSD;
              const save = Math.round(100 - (yearMinor / (monthMinor * 12)) * 100);
              const perMonth = currency === 'USD' ? `$${(yearMinor / 1200).toFixed(2)}` : money(Math.round(yearMinor / 12), 'INR');
              const rows: [typeof MessageSquare, string][] = [
                [MessageSquare, `${p.limits.conversations.toLocaleString()} new conversations / month`],
                [Sparkles, `${p.limits.aiReplies.toLocaleString()} AI answers / month`],
                [Users, `${p.limits.seats} team members`],
                [Megaphone, `${p.limits.broadcasts.toLocaleString()} broadcast messages / month`],
                [Phone, '1 WhatsApp number'],
                [CalendarDays, 'CRM, inbox, booking and hand-off']
              ];
              const btn = 'w-full py-3 text-sm font-semibold rounded-full disabled:opacity-40 flex items-center justify-center gap-1.5';
              const dark = `${btn} bg-fg text-app hover:opacity-90`;
              const wanted = (period: 'month' | 'year') => (preferred === period ? 'ring-2 ring-brand/50 rounded-3xl' : '');
              return [
                <PlanColumn key={`${p.id}-month`} className={wanted('month')} title="Monthly" sub={`${p.name} plan, paid month by month`} price={money(monthMinor, currency)} unit="/ month" note="Cancel any time" rows={rows} intro="Everything included"
                  footer={
                    <button type="button" onClick={() => setChosen(currency === 'INR' ? 'USD' : 'INR')} className="mt-3 text-[11px] text-muted hover:text-fg2 underline">
                      {currency === 'INR' ? `Not in India? Show ${money(p.price.USD, 'USD')} / ${money(p.yearlyUSD, 'USD')}` : `Paying from India? Show ${money(p.price.INR, 'INR')} / ${money(p.yearlyINR, 'INR')}`}
                    </button>
                  }
                  buttons={
                    owner && (!current || linkPaid) && (
                      <>
                        {currency === 'INR' && <button disabled={!b.providers.razorpay || !!busy} onClick={() => go(`rz-${p.id}`, () => api.checkout(p.id, 'razorpay', 'month'))} className={dark}>
                          {busy === `rz-${p.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<span>{current ? 'Renew for 30 days' : 'Choose Monthly'}</span>
                        </button>}
                        {!current && currency === 'USD' && b.providers.paypal && <button disabled={!!busy} onClick={() => go(`pp-${p.id}`, () => api.checkout(p.id, 'paypal', 'month'))} className={dark}>
                          {busy === `pp-${p.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<span>Choose Monthly</span>
                        </button>}
                        {!current && currency === 'USD' && (b.providers.stripe || !b.providers.paypal) && <button disabled={!b.providers.stripe || !!busy} onClick={() => go(`st-${p.id}`, () => api.checkout(p.id, 'stripe'))} className={`${btn} border border-line-strong text-fg hover:bg-sunken`}>
                          {busy === `st-${p.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<span>Choose Monthly (card)</span>
                        </button>}
                        {!current && currency === 'INR' && !b.providers.razorpay && (
                          <p className="text-[11px] text-warn">Payments in rupees are being set up. <button type="button" onClick={() => setChosen('USD')} className="underline">Pay in dollars instead</button></p>
                        )}
                      </>
                    )
                  }
                />,
                <PlanColumn key={`${p.id}-year`} className={wanted('year')} hot badge="Best value" title="Yearly" sub={`${p.name} plan, paid once a year`} price={money(yearMinor, currency)} unit="/ year" note={`Just ${perMonth} a month · save ${save}%`}
                  rows={[[CreditCard, `You save ${money(monthMinor * 12 - yearMinor, currency)} a year`], [RefreshCw, 'One payment a year, no monthly bills']]} intro="Everything in Monthly, plus"
                  buttons={
                    owner && !current && (
                      (currency === 'INR' ? b.providers.razorpay && b.providers.razorpayYearly : b.providers.paypal && b.providers.paypalYearly) ? (
                        <button disabled={!!busy} onClick={() => go(`y-${p.id}`, () => api.checkout(p.id, currency === 'INR' ? 'razorpay' : 'paypal', 'year'))} className={dark}>
                          {busy === `y-${p.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<span>Choose Yearly</span>
                        </button>
                      ) : (
                        <p className="text-[11px] text-warn">Yearly billing is not set up yet.</p>
                      )
                    )
                  }
                />
              ];
            })}
          </div>
          {owner && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Have a code?" maxLength={32}
                className="w-44 bg-sunken border border-line rounded-lg px-3 py-2 text-xs text-fg uppercase placeholder:normal-case" />
              <button onClick={redeem} disabled={!code.trim() || !!busy} className="px-3.5 py-2 bg-subtle hover:bg-subtle text-fg text-xs rounded-lg border border-line disabled:opacity-40">Apply code</button>
              {redeemed && <span className="text-xs text-brand-text">{redeemed}</span>}
            </div>
          )}
          {anyProvider && owner && <p className="text-[11px] text-muted mt-3">You approve the recurring payment (UPI AutoPay, card or PayPal) on the payment provider&apos;s secure page. It is then debited automatically every month, or every year on the yearly plan, and you can cancel any time here. After approving, come back: your plan switches on as soon as the first payment is confirmed (usually within a minute; refresh if it still shows no plan).</p>}
          {!anyProvider && <p className="text-[11px] text-muted mt-3">Online payment is not switched on for this account yet. Contact support to activate a plan.</p>}
          {!owner && <p className="text-[11px] text-muted mt-3">Only the account owner can change the plan.</p>}
          {owner && b.status === 'active' && !b.cancelAtPeriodEnd && b.provider && !linkPaid && (
            <button onClick={cancel} disabled={!!busy} className="mt-4 text-xs text-muted hover:text-danger underline disabled:opacity-50">Cancel subscription</button>
          )}
        </>
      )}

      {b.payments.length > 0 && (
        <div className="mt-6">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Payments</h4>
          <div className="divide-y divide-line/70 border border-line rounded-xl overflow-hidden text-xs">
            {b.payments.map((p) => (
              <div key={p.id} className="flex justify-between px-3.5 py-2 bg-sunken/50">
                <span className="text-fg2">{day(p.at)} · {p.plan || 'plan'}</span>
                <span className="text-fg">{money(p.amount, p.currency)} · {p.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-xs text-danger mt-3" role="alert">{error}</p>}
    </div>
  );
}
