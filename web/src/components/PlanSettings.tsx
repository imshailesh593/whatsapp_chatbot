import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ConfigInfo } from '../types';

const card = 'bg-white border border-slate-200 rounded-xl shadow-sm';
const input = 'border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-green-600';
const btn = 'px-4 py-2 bg-[#4b7f2c] hover:bg-green-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50';
const btn2 = 'px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-300 disabled:opacity-50';

type Plan = Awaited<ReturnType<typeof api.platformPlans>>['plans'][number];

/** Edit a plan's name, description, prices and limits. Existing subscribers keep the price they subscribed at. */
export function PlanEditor({ plan, onChanged }: { plan: Plan; onChanged: () => void }) {
  const make = (p: Plan) => ({
    name: p.name,
    blurb: p.blurb,
    priceInr: String(p.price.INR / 100),
    priceUsd: String(p.price.USD / 100),
    conversations: String(p.limits.conversations),
    aiReplies: String(p.limits.aiReplies),
    seats: String(p.limits.seats),
    broadcasts: String(p.limits.broadcasts),
    integrations: p.integrations
  });
  const [f, setF] = useState(make(plan));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setF(make(plan)), [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const priceChanged = Math.round(Number(f.priceInr) * 100) !== plan.price.INR || Math.round(Number(f.priceUsd) * 100) !== plan.price.USD;

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(done);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const save = () =>
    run(
      () =>
        api.platformUpdatePlan(plan.id, {
          name: f.name,
          blurb: f.blurb,
          priceInr: Number(f.priceInr),
          priceUsd: Number(f.priceUsd),
          integrations: f.integrations,
          limits: { conversations: Number(f.conversations), aiReplies: Number(f.aiReplies), seats: Number(f.seats), broadcasts: Number(f.broadcasts) }
        }),
      'Saved. The website and the dashboard show the new details now.'
    );
  const lab = 'text-xs text-slate-600 block';

  return (
    <div className={card + ' p-5'}>
      <h3 className="font-bold text-slate-900">Edit the {plan.name} plan</h3>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className={lab}>Plan name<input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className={lab}>Price in India (₹ per month)<input className={input} type="number" min={1} step="0.01" value={f.priceInr} onChange={(e) => setF({ ...f, priceInr: e.target.value })} /></label>
        <label className={lab + ' sm:col-span-2'}>Description<input className={input} value={f.blurb} onChange={(e) => setF({ ...f, blurb: e.target.value })} /></label>
        <label className={lab}>Price elsewhere ($ per month)<input className={input} type="number" min={1} step="0.01" value={f.priceUsd} onChange={(e) => setF({ ...f, priceUsd: e.target.value })} /></label>
        <label className="text-xs text-slate-600 flex items-end gap-2 pb-2"><input type="checkbox" checked={f.integrations} onChange={(e) => setF({ ...f, integrations: e.target.checked })} />Includes webhooks and the REST API</label>
        <label className={lab}>New chats per month<input className={input} type="number" min={1} value={f.conversations} onChange={(e) => setF({ ...f, conversations: e.target.value })} /></label>
        <label className={lab}>AI answers per month<input className={input} type="number" min={0} value={f.aiReplies} onChange={(e) => setF({ ...f, aiReplies: e.target.value })} /></label>
        <label className={lab}>Team members<input className={input} type="number" min={1} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} /></label>
        <label className={lab}>Broadcast messages per month<input className={input} type="number" min={0} value={f.broadcasts} onChange={(e) => setF({ ...f, broadcasts: e.target.value })} /></label>
      </div>
      {priceChanged && (
        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          Payment providers cannot change the price of an existing plan. After saving, go to Settings, Payments and email keys, and press <strong>Create plan at the current price</strong> for Razorpay (and PayPal). Until then new subscribers would still be charged the old amount. People who already subscribed keep the price they signed up at.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className={btn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</button>
        <button className={btn2} disabled={busy} onClick={() => { if (confirm('Put this plan back to the details in the code?')) run(() => api.platformResetPlan(plan.id), 'Plan reset.'); }}>Reset to default</button>
        {msg && <span className="text-sm text-green-700">{msg}</span>}
        {error && <span className="text-sm text-rose-600" role="alert">{error}</span>}
      </div>
    </div>
  );
}

const GROUPS: { title: string; hint: string; keys: string[] }[] = [
  {
    title: 'Razorpay (₹ subscriptions)',
    hint: 'From the Razorpay dashboard: Account & Settings, API keys. The webhook secret is the one you set when you add the webhook below.',
    keys: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_PLAN_PRO']
  },
  { title: 'PayPal plan ($)', hint: 'The PayPal keys stay in the server settings. The plan id is filled in for you by the button below.', keys: ['PAYPAL_PLAN_PRO'] },
  {
    title: 'Email (Resend)',
    hint: 'Used for lead alerts and for payment receipts and reminders to your customers. Verify your sending domain in Resend first.',
    keys: ['RESEND_API_KEY', 'MAIL_FROM']
  }
];

/** Keys and connection settings for payments and email, saved encrypted and applied at once. */
export function KeysCard() {
  const [cfg, setCfg] = useState<ConfigInfo | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [secret, setSecret] = useState('');
  const [testTo, setTestTo] = useState('');
  const load = useCallback(() => {
    api.platformConfig().then(setCfg).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  async function act(name: string, fn: () => Promise<string | void>) {
    setBusy(name);
    setError('');
    setMsg('');
    try {
      const m = await fn();
      if (m) setMsg(m);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }
  const save = (keys: string[]) =>
    act('save', async () => {
      const values = Object.fromEntries(keys.filter((k) => vals[k]).map((k) => [k, vals[k]]));
      if (!Object.keys(values).length) throw new Error('Type a value first');
      setCfg(await api.platformSaveConfig(values));
      setVals((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k))));
      return 'Saved and applied.';
    });
  const clear = (key: string) =>
    act('clear', async () => {
      setCfg(await api.platformSaveConfig({ [key]: '' }));
      return 'Cleared: the server setting (if any) is used again.';
    });
  if (!cfg) return <div className={card + ' p-5 text-sm text-slate-500'}>{error || 'Loading…'}</div>;
  const field = (k: string) => cfg.fields.find((x) => x.key === k)!;

  return (
    <div className={card + ' p-5'}>
      <h3 className="font-bold text-slate-900">Payments and email keys</h3>
      <p className="text-sm text-slate-500 mt-1">
        Saved encrypted in the database and used straight away, with no restart. A value saved here wins over the server <code>.env</code>. Saved secrets are never shown again, only their last four characters.
      </p>
      <div className="mt-4 space-y-6">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">{g.title}</h4>
            <p className="text-xs text-slate-500 mt-1">{g.hint}</p>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {g.keys.map((k) => {
                const f = field(k);
                return (
                  <label key={k} className="text-xs text-slate-600 block">
                    {f.label}{' '}
                    {f.set ? (
                      <span className="text-green-700">· set ({f.source === 'panel' ? 'saved here' : 'server .env'}: {f.preview})</span>
                    ) : (
                      <span className="text-amber-700">· not set</span>
                    )}
                    <div className="flex gap-2 mt-1">
                      <input
                        className={input}
                        type={f.secret ? 'password' : 'text'}
                        autoComplete="off"
                        placeholder={f.set ? 'Type to replace' : 'Paste it here'}
                        value={vals[k] ?? ''}
                        onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                      />
                      {f.source === 'panel' && <button type="button" className={btn2} disabled={!!busy} onClick={() => clear(k)}>Clear</button>}
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className={btn} disabled={!!busy} onClick={() => save(g.keys)}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
              {g.title.startsWith('Razorpay') && (
                <>
                  <button className={btn2} disabled={!!busy} onClick={() => act('plan', async () => { const r = await api.platformRazorpayPlan(); return `Razorpay plan created and in use: ${r.plans[0]?.razorpayPlanId}`; })}>
                    {busy === 'plan' ? 'Creating…' : 'Create plan at the current price'}
                  </button>
                  <button className={btn2} disabled={!!busy} onClick={() => act('secret', async () => { const r = await api.platformWebhookSecret(); setSecret(r.secret); return 'New webhook secret saved. Paste it into Razorpay now.'; })}>
                    Generate a webhook secret
                  </button>
                </>
              )}
              {g.title.startsWith('PayPal') && (
                <button className={btn2} disabled={!!busy} onClick={() => act('pp', async () => { const r = await api.platformPaypalPlan(); return `PayPal plan created and in use: ${r.plans[0]?.paypalPlanId}`; })}>
                  {busy === 'pp' ? 'Creating…' : 'Create plan at the current price'}
                </button>
              )}
            </div>
            {g.title.startsWith('Razorpay') && (
              <div className="mt-3 text-xs text-slate-600 space-y-1.5">
                <p>
                  <strong>Mode:</strong>{' '}
                  <select
                    className="border border-slate-300 rounded-lg px-2 py-1"
                    value={cfg.razorpayMode}
                    onChange={(e) => act('mode', async () => { setCfg(await api.platformSaveConfig({ RAZORPAY_MODE: e.target.value })); return 'Mode saved.'; })}
                  >
                    <option value="subscription">Subscription: auto-debit every month (UPI AutoPay or card)</option>
                    <option value="link">One-off payment link: 30 days, the customer pays again to renew</option>
                  </select>
                </p>
                <p>
                  In Razorpay, Settings, Webhooks, add this address and tick the <em>subscription</em> and <em>payment</em> events: <code className="break-all">{cfg.razorpayWebhook}</code>
                </p>
                {secret && <p className="bg-amber-50 border border-amber-200 rounded-lg p-3">Webhook secret (shown only now): <code className="break-all select-all">{secret}</code></p>}
                <p>A price change needs a new Razorpay plan: press <em>Create plan at the current price</em> after editing the plan. Existing subscribers keep the old price.</p>
              </div>
            )}
            {g.title.startsWith('Email') && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>Email is <strong className={cfg.email.configured ? 'text-green-700' : 'text-amber-700'}>{cfg.email.configured ? `on (${cfg.email.provider})` : 'off'}</strong>.</span>
                <input className={input + ' !w-64'} placeholder="Send a test to (email)" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                <button className={btn2} disabled={!!busy} onClick={() => act('mail', async () => { const r = await api.platformEmailTest(testTo); return `Test email sent to ${r.to}.`; })}>
                  {busy === 'mail' ? 'Sending…' : 'Send test email'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {msg && <p className="text-sm text-green-700 mt-3">{msg}</p>}
      {error && <p className="text-sm text-rose-600 mt-3" role="alert">{error}</p>}
    </div>
  );
}
