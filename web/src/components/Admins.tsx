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

  const input = 'bg-sunken border border-line rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-brand/40';

  return (
    <div className="bg-card border border-line rounded-2xl p-5 shadow-lg">
      <h3 className="font-bold text-fg text-base">Team</h3>
      <p className="text-xs text-muted mt-1">
        <strong>Admins</strong> can change settings and the bot. <strong>Agents</strong> can work leads and reply in the inbox only.
      </p>

      <div className="mt-4 divide-y divide-line/70 border border-line rounded-xl overflow-hidden">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-3.5 py-2.5 text-xs bg-sunken/50">
            <div className="min-w-0">
              <div className="text-fg font-medium truncate">
                {r.email}
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-subtle text-fg2">{ROLE_LABEL[r.role]}</span>
                {r.id === me.id && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-brand-soft text-brand-text">you</span>}
              </div>
              <div className="text-[11px] text-muted">Last sign-in: {when(r.lastLoginAt)}</div>
            </div>
            {r.id !== me.id && (
              <button onClick={() => remove(r)} title="Remove" className="p-1.5 rounded-lg text-danger hover:bg-danger-soft border border-transparent hover:border-danger-line/60 transition">
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
        <button disabled={busy} className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-brand hover:bg-brand text-on-brand font-bold text-xs rounded-lg transition disabled:opacity-60">
          <UserPlus className="w-3.5 h-3.5" /><span>Add</span>
        </button>
      </form>
      <p className="text-[11px] text-muted mt-2">Share the password with them privately; they can change it from the account menu.</p>
      {error && <p className="text-xs text-danger mt-2" role="alert">{error}</p>}
    </div>
  );
}
