import { FormEvent, useState } from 'react';
import { Globe } from 'lucide-react';
import { api } from '../api';
import type { AdminUser } from '../types';

export default function Login({ onDone }: { onDone: (user: AdminUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(email, password);
      onDone(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center">
            <Globe className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <div className="font-extrabold text-white">MNS INSTITUTE</div>
            <div className="text-[11px] text-slate-400">Lead Intelligence Console</div>
          </div>
        </div>

        <label className="text-xs font-medium text-slate-300 block mb-1" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
          placeholder="you@example.com"
        />

        <label className="text-xs font-medium text-slate-300 block mb-1 mt-4" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />

        {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
        <button
          disabled={busy || !email || !password}
          className="w-full mt-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-lg transition disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-[11px] text-slate-500 mt-4 text-center">Forgot your password? Ask another admin to reset it.</p>
      </form>
    </div>
  );
}
