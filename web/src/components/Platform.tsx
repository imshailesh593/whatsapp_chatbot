import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { LogIn, Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { ago } from '../config';
import type { AuditEntry, PlatformDetail, PlatformOverview, PlatformWorkspace } from '../types';

const PLANS = ['', 'pro', 'internal'];
const WA: Record<string, string> = { ready: 'text-green-700', qr: 'text-amber-600', off: 'text-slate-500' };
const inr = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
const input = 'bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-green-600';
const card = 'bg-white border border-slate-200 rounded-2xl shadow-lg';

const planLabel = (w: PlatformWorkspace) =>
  w.plan === 'internal' ? 'internal' : w.planAccess === 'ok' ? `${w.plan} · ${w.planStatus}` : `${w.plan} · ${w.planAccess.replace('_', ' ')}`;

export default function Platform() {
  const [rows, setRows] = useState<PlatformWorkspace[]>([]);
  const [stats, setStats] = useState<PlatformOverview | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.platformWorkspaces().then(setRows).catch((e) => setError((e as Error).message));
    api.platformOverview().then(setStats).catch(() => undefined);
    api.platformAudit().then(setAudit).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(
      (w) =>
        (!s || w.businessName.toLowerCase().includes(s) || (w.owner ?? '').toLowerCase().includes(s)) &&
        (filter === 'all' ||
          (filter === 'paying' && ['pro', 'starter', 'growth', 'scale'].includes(w.plan) && w.planStatus === 'active' && w.planAccess === 'ok') ||
          (filter === 'lapsed' && w.plan !== 'internal' && w.planAccess !== 'ok') ||
          (filter === 'setup' && !w.onboardingCompleted))
    );
  }, [rows, q, filter]);

  async function toggle(w: PlatformWorkspace) {
    if (w.botEnabled && !window.confirm(`Suspend the bot for ${w.businessName}? It will stop replying to their customers.`)) return;
    await api.platformBot(w.id, !w.botEnabled).catch((e) => setError((e as Error).message));
    load();
  }

  const tile = (label: string, value: string | number, hint?: string) => (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5">
      <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-0.5 text-slate-900">{value}</p>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {tile('Businesses', stats.businesses)}
          {tile('Paying', stats.paying)}
          {tile('Lapsed', stats.lapsed, 'not paid or plan ended')}
          {tile('WhatsApp linked', stats.whatsappConnected)}
          {tile('Monthly revenue', inr(stats.mrrInr), 'from active paid plans')}
        </div>
      )}

      <div className={card}>
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3 justify-between">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search business or owner…" className={input + ' pl-9 w-64'} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {['all', 'paying', 'lapsed', 'setup'].map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filter === f ? 'bg-green-100 text-green-800 border-green-400' : 'bg-white text-slate-500 border-slate-300'}`}>
                {f === 'setup' ? 'Setting up' : f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
            <button onClick={() => setCreating(true)} className="flex items-center space-x-1.5 px-3.5 py-2 bg-green-700 hover:bg-green-800 text-white font-bold text-xs rounded-lg">
              <Plus className="w-3.5 h-3.5" /><span>Add business</span>
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Business</th>
                <th className="py-3 px-4">Owner</th>
                <th className="py-3 px-4">WhatsApp</th>
                <th className="py-3 px-4">Plan</th>
                <th className="py-3 px-4">Chats this month</th>
                <th className="py-3 px-4">Leads</th>
                <th className="py-3 px-4">Last activity</th>
                <th className="py-3 px-4">Bot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {shown.map((w) => (
                <tr key={w.id} onClick={() => setOpenId(w.id)} className="hover:bg-slate-50 cursor-pointer">
                  <td className="py-3 px-4"><div className="font-semibold text-slate-900">{w.businessName}</div><div className="text-[11px] text-slate-500">{w.onboardingCompleted ? w.industry : 'setting up'} · joined {new Date(w.createdAt).toLocaleDateString()}</div></td>
                  <td className="py-3 px-4 text-slate-700">{w.owner ?? '—'}</td>
                  <td className={`py-3 px-4 font-semibold ${WA[w.whatsapp] ?? 'text-amber-600'}`}>{w.whatsapp}</td>
                  <td className="py-3 px-4 text-slate-700">{planLabel(w)}</td>
                  <td className="py-3 px-4 text-slate-700">{w.conversationsThisMonth}</td>
                  <td className="py-3 px-4 text-slate-700">{w.leads}</td>
                  <td className="py-3 px-4 text-slate-500">{w.lastActivity ? ago(w.lastActivity) : '—'}</td>
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => toggle(w)} className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${w.botEnabled ? 'bg-green-100 text-green-800 border-green-300' : 'bg-slate-100 text-slate-500 border-slate-300'}`}>{w.botEnabled ? 'Live' : 'Paused'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="p-6 text-center text-xs text-slate-500">No businesses match.</p>}
        </div>
        {error && <p className="text-xs text-rose-600 p-4" role="alert">{error}</p>}
      </div>

      <div className={card + ' p-5'}>
        <h3 className="font-bold text-slate-900 text-base mb-3">Recent operator activity</h3>
        {audit.length === 0 && <p className="text-xs text-slate-500">Nothing yet.</p>}
        <div className="divide-y divide-slate-200 text-xs">
          {audit.slice(0, 12).map((a) => (
            <div key={a.id} className="py-2 flex justify-between gap-3"><span className="text-slate-700"><strong>{a.action}</strong>{a.detail ? ' · ' + a.detail : ''}</span><span className="text-slate-500 whitespace-nowrap">{a.actor.split('@')[0]} · {ago(a.at)}</span></div>
          ))}
        </div>
      </div>

      {creating && <CreateBusiness onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); setOpenId(id); }} />}
      {openId && <Detail id={openId} onClose={() => { setOpenId(null); load(); }} />}
    </div>
  );
}

function CreateBusiness({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ businessName: '', email: '', password: '', plan: '', days: 30 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated((await api.platformCreate(f)).id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-white/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-2xl">
        <h3 className="text-base font-bold text-slate-900">Add a business</h3>
        <p className="text-[11px] text-slate-500">Creates the account and its owner login. The owner finishes setup (menu, questions, WhatsApp) when they first sign in. Give them the password privately.</p>
        <input required placeholder="Business name" value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} className={input + ' w-full'} />
        <input required type="email" placeholder="Owner email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={input + ' w-full'} />
        <input required minLength={10} placeholder="Temporary password (min 10 characters)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={input + ' w-full'} />
        <div className="flex gap-2">
          <select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value, days: 30 })} className={input + ' flex-1'}>
            {PLANS.map((p) => <option key={p} value={p}>{p || 'no plan (pays first)'}</option>)}
          </select>
          <input type="number" min={1} max={3650} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} className={input + ' w-24'} title="Days" />
          <span className="text-xs text-slate-500 self-center">days</span>
        </div>
        {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-slate-500">Cancel</button>
          <button disabled={busy} className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white font-bold text-xs rounded-lg disabled:opacity-50">{busy ? 'Creating…' : 'Create business'}</button>
        </div>
      </form>
    </div>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<PlatformDetail | null>(null);
  const [plan, setPlan] = useState('pro');
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(() => api.platformDetail(id).then((x) => { setD(x); setPlan(x.plan); }).catch((e) => setError((e as Error).message)), [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok = '') => {
    setError('');
    setNote('');
    try {
      await fn();
      if (ok) setNote(ok);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!d) return <div className="fixed inset-0 z-50 bg-white/40 flex items-center justify-center text-slate-500 text-sm">{error || 'Loading…'}</div>;
  const use = (label: string, used: number, limit: number | null) => (
    <div className="bg-white border border-slate-200 rounded-lg p-2.5"><div className="text-[10px] text-slate-500 uppercase">{label}</div><div className="text-sm text-slate-900 font-semibold">{used}{limit === null ? '' : ` / ${limit}`}</div></div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-white/40 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div className="w-full max-w-xl bg-white border-l border-slate-200 h-full overflow-y-auto p-5 space-y-5 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h3 className="text-lg font-bold text-slate-900">{d.businessName}</h3><p className="text-slate-500 mt-0.5">{d.plan} · {d.planStatus}{d.billingProvider ? ` · billed via ${d.billingProvider}` : ''}</p></div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-900"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {use('Chats this month', d.usage.conversations, d.limits.conversations)}
          {use('AI answers', d.usage.aiReplies, d.limits.aiReplies)}
          {use('Broadcasts', d.usage.broadcasts, d.limits.broadcasts)}
        </div>
        <p className="text-slate-500">
          {d.planStatus === 'inactive' ? 'Not paid yet' : d.currentPeriodEnd ? `Paid until ${new Date(d.currentPeriodEnd).toLocaleDateString()}` : ''}
        </p>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2">
          <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">Set plan (no payment needed)</h4>
          <div className="flex gap-2 items-center">
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className={input}>{PLANS.map((p) => <option key={p} value={p}>{p || 'no plan (pays first)'}</option>)}</select>
            <input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} className={input + ' w-24'} />
            <span className="text-slate-500">days</span>
            <button onClick={() => run(() => api.platformPlan(d.id, plan, days), 'Plan updated')} className="px-3.5 py-2 bg-green-700 text-white font-bold rounded-lg">Apply</button>
          </div>
        </div>

        <div>
          <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-2">People</h4>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
            {d.users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-3 py-2 bg-white">
                <div><div className="text-slate-800">{u.email} <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{u.role}{u.isSuperAdmin ? ' · platform' : ''}</span></div><div className="text-[11px] text-slate-500">Last sign-in: {u.lastLoginAt ? ago(u.lastLoginAt) : 'never'}</div></div>
                <div className="flex gap-1.5">
                  <button onClick={() => { const p = window.prompt(`New password for ${u.email} (min 10 characters):`); if (p) run(() => api.platformResetPassword(u.id, p), `Password reset for ${u.email}`); }} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 text-slate-800">Reset password</button>
                  <button onClick={() => { if (window.confirm(`Remove ${u.email}?`)) run(() => api.platformRemoveUser(u.id)); }} className="p-1.5 text-slate-500 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {d.payments.length > 0 && (
          <div>
            <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-2">Payments</h4>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {d.payments.map((p) => <div key={p.id} className="flex justify-between px-3 py-2 bg-white text-slate-700"><span>{new Date(p.at).toLocaleDateString()} · {p.plan}</span><span>{new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency }).format(p.amount / 100)} · {p.status}</span></div>)}
            </div>
          </div>
        )}

        {d.audit.length > 0 && (
          <div>
            <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-2">Operator history</h4>
            <div className="space-y-1 text-slate-500">{d.audit.map((a) => <div key={a.id} className="flex justify-between gap-3"><span><strong className="text-slate-700">{a.action}</strong> {a.detail}</span><span className="whitespace-nowrap">{ago(a.at)}</span></div>)}</div>
          </div>
        )}

        {note && <p className="text-green-700">{note}</p>}
        {error && <p className="text-rose-600" role="alert">{error}</p>}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
          <button onClick={async () => { if (window.confirm('Continue as this business owner? Your own session is replaced; sign out and back in to return.')) { try { await api.platformImpersonate(d.id); window.location.href = '/admin/'; } catch (err) { setError((err as Error).message); } } }}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg border border-slate-300"><LogIn className="w-3.5 h-3.5" /><span>Sign in as owner</span></button>
          <button onClick={() => { const c = window.prompt(`This permanently deletes ${d.businessName}, all its chats, leads and team, and unlinks its WhatsApp.\n\nType the business name to confirm:`); if (c) run(async () => { await api.platformDelete(d.id, c); onClose(); }); }}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg border border-rose-200"><Trash2 className="w-3.5 h-3.5" /><span>Delete business</span></button>
        </div>
      </div>
    </div>
  );
}
