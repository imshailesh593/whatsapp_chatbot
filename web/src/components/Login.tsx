import { FormEvent, useState } from 'react';
import { Globe } from 'lucide-react';
import { api } from '../api';

export default function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center space-x-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center">
            <Globe className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <div className="font-extrabold text-white">MNS INSTITUTE</div>
            <div className="text-[11px] text-slate-400">Lead Intelligence Console</div>
          </div>
        </div>
        <label className="text-xs font-medium text-slate-300 block mb-1">Admin token</label>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
        />
        {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
        <button
          disabled={busy || !token}
          className="w-full mt-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-lg transition disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
