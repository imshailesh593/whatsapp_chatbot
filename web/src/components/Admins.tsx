import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { api } from '../api';
import type { AdminRow, AdminUser } from '../types';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', agent: 'Agent' } as const;

export default function Admins({ me }: { me: AdminUser }) {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'agent'>('agent');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.admins().then(setRows).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.addAdmin(email, password, role);
      setEmail('');
      setPassword('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AdminRow) {
    if (!window.confirm(`Remove ${row.email}? They will be signed out immediately.`)) return;
    setError('');
    try {
      await api.removeAdmin(row.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const input = 'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500';

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
      <h3 className="font-bold text-white text-base">Team</h3>
      <p className="text-xs text-slate-400 mt-1">
        <strong>Admins</strong> can change settings and the bot. <strong>Agents</strong> can work leads and reply in the inbox only.
      </p>

      <div className="mt-4 divide-y divide-slate-800/70 border border-slate-800 rounded-xl overflow-hidden">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-3.5 py-2.5 text-xs bg-slate-900/50">
            <div className="min-w-0">
              <div className="text-slate-200 font-medium truncate">
                {r.email}
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{ROLE_LABEL[r.role]}</span>
                {r.id === me.id && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">you</span>}
              </div>
              <div className="text-[11px] text-slate-500">Last sign-in: {when(r.lastLoginAt)}</div>
            </div>
            {r.id !== me.id && (
              <button onClick={() => remove(r)} title="Remove" className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-950/50 border border-transparent hover:border-rose-800/60 transition">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={add} className="mt-4 flex flex-col sm:flex-row gap-2">
        <input type="email" required placeholder="new.person@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={`${input} flex-1`} />
        <input type="password" required minLength={10} placeholder="Password (min 10 characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} flex-1`} />
        <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'agent')} className={input}>
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </select>
        <button disabled={busy} className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition disabled:opacity-60">
          <UserPlus className="w-3.5 h-3.5" /><span>Add</span>
        </button>
      </form>
      <p className="text-[11px] text-slate-500 mt-2">Share the password with them privately; they can change it from the account menu.</p>
      {error && <p className="text-xs text-rose-400 mt-2" role="alert">{error}</p>}
    </div>
  );
}
