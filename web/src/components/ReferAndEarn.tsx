import { useCallback, useEffect, useState } from 'react';
import { Copy, Gift } from 'lucide-react';
import { api } from '../api';
import type { AdminUser, ReferralInfo } from '../types';

const card = 'bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg';
const money = (minor: number, cur: string) => new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(minor / 100);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const STATUS: Record<string, string> = { pending: 'text-amber-300', approved: 'text-sky-300', paid: 'text-emerald-300', void: 'text-slate-500' };

export default function ReferAndEarn({ me }: { me: AdminUser }) {
  const [r, setR] = useState<ReferralInfo | null>(null);
  const [payout, setPayout] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => api.referral().then((x) => { setR(x); setPayout(x.payoutDetails); }).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);

  if (!r) return error ? <div className={card + ' text-xs text-rose-400'}>{error}</div> : null;
  if (!r.enabled) return null;
  const owner = me.role === 'owner';
  const currencies = Object.keys(r.totals);

  async function savePayout() {
    setError('');
    setNote('');
    try {
      await api.saveReferralPayout(payout);
      setNote('Saved.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className={card}>
      <h3 className="font-bold text-white text-base flex items-center space-x-2"><Gift className="w-4 h-4 text-emerald-400" /><span>Refer &amp; earn</span></h3>
      <p className="text-[11px] text-slate-500 mt-1">
        Share your link. When a business signs up through it, you earn {r.percent}% of what it pays for its first {r.months} payments.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input readOnly value={r.link} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200" />
        <button onClick={() => navigator.clipboard?.writeText(r.link).then(() => setNote('Link copied.')).catch(() => undefined)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 flex items-center space-x-1.5"><Copy className="w-3.5 h-3.5" /><span>Copy</span></button>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3"><div className="text-slate-500 text-[11px]">Signed up</div><div className="text-white font-bold text-lg">{r.signedUp}</div></div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3"><div className="text-slate-500 text-[11px]">Paying</div><div className="text-white font-bold text-lg">{r.paying}</div></div>
        {(['pending', 'paid'] as const).map((k) => (
          <div key={k} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <div className="text-slate-500 text-[11px]">{k === 'pending' ? 'Waiting for approval' : 'Paid out'}</div>
            <div className="text-white font-bold text-lg">{currencies.length ? currencies.map((c) => money(r.totals[c][k] + (k === 'pending' ? r.totals[c].approved : 0), c)).join(' · ') : '—'}</div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label className="text-[11px] font-semibold text-slate-400 block mb-1" htmlFor="payout">Where should we send your earnings? (UPI id, bank details, PayPal…)</label>
        <div className="flex gap-2">
          <input id="payout" value={payout} maxLength={300} disabled={!owner} onChange={(e) => setPayout(e.target.value)} className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 disabled:opacity-60" placeholder="UPI: you@bank" />
          {owner && <button onClick={savePayout} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg">Save</button>}
        </div>
      </div>

      {r.commissions.length > 0 && (
        <div className="mt-4 divide-y divide-slate-800/70 border border-slate-800 rounded-xl overflow-hidden text-xs">
          {r.commissions.map((c) => (
            <div key={c.id} className="flex justify-between px-3.5 py-2 bg-slate-900/50">
              <span className="text-slate-300">{day(c.at)} · {c.referred}</span>
              <span className="text-slate-200">{money(c.amount, c.currency)} · <span className={STATUS[c.status]}>{c.status}</span></span>
            </div>
          ))}
        </div>
      )}
      {note && <p className="text-xs text-emerald-400 mt-3">{note}</p>}
      {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
    </div>
  );
}
