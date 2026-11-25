import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, Share2, Unplug } from 'lucide-react';
import { api } from '../api';
import type { ZernioStatus } from '../types';

const LABEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok', twitter: 'X (Twitter)', threads: 'Threads', pinterest: 'Pinterest' };

/** Connect other social accounts (Instagram, LinkedIn, YouTube, TikTok and more) to this business. */
export default function ZernioLink() {
  const [status, setStatus] = useState<ZernioStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try { setStatus(await api.zernioStatus()); } catch (err) { setError((err as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // The connection page sends the owner back to /admin/?zernio=connected
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.get('zernio')) return;
    setNote('Account connected.');
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setError(''); setNote('');
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  }
  const connect = (p: string) => run(`c-${p}`, async () => { window.location.href = (await api.zernioConnect(p)).url; });
  const disconnect = (id: string, name: string) => {
    if (!window.confirm(`Disconnect ${name}?`)) return;
    run(`d-${id}`, async () => { await api.zernioDisconnect(id); setNote('Disconnected.'); await load(); });
  };

  if (!status) return <div className="bg-card border border-line rounded-2xl p-5 text-xs text-muted">{error || 'Loading…'}</div>;
  if (!status.configured) return null;

  return (
    <div className="bg-card border border-line rounded-2xl p-5 shadow-lg">
      <h3 className="font-bold text-fg text-base flex items-center gap-2"><Share2 className="w-4 h-4 text-brand-text" /><span>More social accounts</span></h3>
      <p className="mt-1 text-xs text-muted max-w-xl">Connect your other accounts to this business. You will sign in on the platform's own page and choose what to share.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {status.platforms.map((p) => (
          <button key={p} onClick={() => connect(p)} disabled={!!busy} className="px-3 py-1.5 bg-subtle hover:bg-subtle border border-line-strong text-fg text-xs font-semibold rounded-lg disabled:opacity-40 flex items-center gap-1.5">
            {busy === `c-${p}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}<span>{LABEL[p] ?? p}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      {note && <p className="mt-3 text-xs text-brand-text">{note}</p>}
      {status.accounts.length > 0 ? (
        <ul className="mt-4 divide-y divide-line border border-line rounded-xl">
          {status.accounts.map((a) => (
            <li key={a.id} className="p-3 flex items-center justify-between gap-2">
              <div className="min-w-0 text-sm text-fg"><span className="font-semibold">{LABEL[a.platform] ?? a.platform}</span><span className="text-muted"> · {a.name}</span>{!a.active && <span className="ml-2 text-[12px] text-warn">needs reconnecting</span>}</div>
              <button onClick={() => disconnect(a.id, a.name)} disabled={!!busy} className="text-xs text-muted hover:text-danger flex items-center gap-1 disabled:opacity-40"><Unplug className="w-3.5 h-3.5" />Disconnect</button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-[12.5px] text-muted">Nothing connected yet.</p>}
    </div>
  );
}
