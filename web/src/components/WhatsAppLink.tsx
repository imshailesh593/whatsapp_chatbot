import { useCallback, useEffect, useState } from 'react';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
import { api } from '../api';
import type { WaSnapshot } from '../types';

const LABEL: Record<string, { text: string; dot: string }> = {
  ready: { text: 'Connected', dot: 'bg-emerald-500' },
  qr: { text: 'Waiting for QR scan', dot: 'bg-amber-400' },
  starting: { text: 'Starting…', dot: 'bg-amber-400' },
  authenticated: { text: 'Finishing sign-in…', dot: 'bg-amber-400' },
  disconnected: { text: 'Reconnecting…', dot: 'bg-amber-400' },
  off: { text: 'Disconnected', dot: 'bg-rose-500' }
};

export default function WhatsAppLink({ onChanged }: { onChanged?: () => void }) {
  const [snap, setSnap] = useState<WaSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const poll = useCallback(() => api.whatsapp().then(setSnap).catch(() => undefined), []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [poll]);

  async function run(action: () => Promise<WaSnapshot>) {
    setBusy(true);
    setError('');
    try {
      setSnap(await action());
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    if (!window.confirm('Disconnect WhatsApp? The bot will stop replying and this number will be unlinked from the phone until you connect again.')) return;
    run(api.whatsappDisconnect);
  }

  const status = snap?.status ?? 'starting';
  const label = LABEL[status] ?? { text: status, dot: 'bg-amber-400' };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-white text-base">WhatsApp connection</h3>
          <div className="flex items-center space-x-2 mt-1 text-xs text-slate-300">
            <span className={`inline-flex h-2 w-2 rounded-full ${label.dot}`} />
            <span>{label.text}</span>
          </div>
        </div>
        {status === 'off' ? (
          <button disabled={busy} onClick={() => run(api.whatsappConnect)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}<span>Connect WhatsApp</span>
          </button>
        ) : (
          <button disabled={busy} onClick={disconnect}
            className="flex items-center space-x-1.5 px-4 py-2 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 font-bold text-xs rounded-lg border border-rose-800/60 transition disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2Off className="w-3.5 h-3.5" />}<span>Disconnect</span>
          </button>
        )}
      </div>

      {status === 'qr' && snap?.qr && (
        <div className="mt-4 flex flex-col sm:flex-row items-center gap-5">
          <img src={snap.qr} alt="WhatsApp QR code" className="w-56 h-56 rounded-xl bg-white p-2" />
          <ol className="text-xs text-slate-300 space-y-1.5 list-decimal list-inside">
            <li>Open WhatsApp on the phone you want to use for the bot</li>
            <li>Settings → Linked devices → Link a device</li>
            <li>Scan this code (it refreshes automatically)</li>
          </ol>
        </div>
      )}
      {status === 'off' && (
        <p className="text-xs text-slate-400 mt-3">The bot is switched off and will not reply to anyone. Press Connect to show a new QR code and link a number.</p>
      )}
      {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
    </div>
  );
}
