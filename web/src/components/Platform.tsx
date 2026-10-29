import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { PlatformWorkspace } from '../types';

const WA: Record<string, string> = { ready: 'text-emerald-400', qr: 'text-amber-400', off: 'text-slate-500' };

export default function Platform() {
  const [rows, setRows] = useState<PlatformWorkspace[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => api.platformWorkspaces().then(setRows).catch((e) => setError((e as Error).message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function toggle(w: PlatformWorkspace) {
    if (w.botEnabled && !window.confirm(`Suspend the bot for ${w.businessName}? It will stop replying to their customers.`)) return;
    await api.platformBot(w.id, !w.botEnabled).catch((e) => setError((e as Error).message));
    load();
  }

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl shadow-lg overflow-hidden">
      <div className="p-5 border-b border-slate-800">
        <h3 className="font-bold text-white text-base">All businesses ({rows.length})</h3>
        <p className="text-xs text-slate-400 mt-1">Platform view. Only you can see this tab.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/70 text-slate-400 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="py-3 px-4">Business</th>
              <th className="py-3 px-4">Owner</th>
              <th className="py-3 px-4">WhatsApp</th>
              <th className="py-3 px-4">Leads / contacts</th>
              <th className="py-3 px-4">Setup</th>
              <th className="py-3 px-4">Bot</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map((w) => (
              <tr key={w.id}>
                <td className="py-3 px-4"><div className="font-semibold text-slate-100">{w.businessName}</div><div className="text-[11px] text-slate-500">{w.industry} · {new Date(w.createdAt).toLocaleDateString()}</div></td>
                <td className="py-3 px-4 text-slate-300">{w.owner ?? '—'}</td>
                <td className={`py-3 px-4 font-semibold ${WA[w.whatsapp] ?? 'text-amber-400'}`}>{w.whatsapp}</td>
                <td className="py-3 px-4 text-slate-300">{w.leads} / {w.contacts}</td>
                <td className="py-3 px-4 text-slate-300">{w.onboardingCompleted ? 'Done' : 'Onboarding'}</td>
                <td className="py-3 px-4">
                  <button onClick={() => toggle(w)} className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${w.botEnabled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                    {w.botEnabled ? 'Live' : 'Paused'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="text-xs text-rose-400 p-4" role="alert">{error}</p>}
    </div>
  );
}
