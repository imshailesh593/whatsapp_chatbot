import { useCallback, useEffect, useState } from 'react';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
import { api } from '../api';
import type { WaSnapshot } from '../types';

const LABEL: Record<string, { text: string; dot: string }> = {
  ready: { text: 'Connected', dot: 'bg-brand' },
  qr: { text: 'Waiting for QR scan', dot: 'bg-warn' },
  starting: { text: 'Starting…', dot: 'bg-warn' },
  authenticated: { text: 'Finishing sign-in…', dot: 'bg-warn' },
  disconnected: { text: 'Reconnecting…', dot: 'bg-warn' },
  off: { text: 'Disconnected', dot: 'bg-danger' }
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
  const label = LABEL[status] ?? { text: status, dot: 'bg-warn' };

  return (
    <div className="bg-card border border-line rounded-2xl p-5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-fg text-base">WhatsApp connection</h3>
          <div className="flex items-center space-x-2 mt-1 text-xs text-fg2">
            <span className={`inline-flex h-2 w-2 rounded-full ${label.dot}`} />
            <span>{label.text}</span>
          </div>
        </div>
        {status === 'off' ? (
          <button disabled={busy} onClick={() => run(api.whatsappConnect)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-brand hover:bg-brand text-on-brand font-bold text-xs rounded-lg transition disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}<span>Connect WhatsApp</span>
          </button>
        ) : (
          <button disabled={busy} onClick={disconnect}
            className="flex items-center space-x-1.5 px-4 py-2 bg-danger-soft hover:bg-danger-soft text-danger font-bold text-xs rounded-lg border border-danger-line/60 transition disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2Off className="w-3.5 h-3.5" />}<span>Disconnect</span>
          </button>
        )}
      </div>

      {status === 'qr' && snap?.qr && (
        <div className="mt-4 flex flex-col sm:flex-row items-center gap-5">
          <img src={snap.qr} alt="WhatsApp QR code" className="w-56 h-56 rounded-xl bg-card p-2" />
          <ol className="text-xs text-fg2 space-y-1.5 list-decimal list-inside">
            <li>Open WhatsApp on the phone you want to use for the bot</li>
            <li>Settings → Linked devices → Link a device</li>
            <li>Scan this code (it refreshes automatically)</li>
          </ol>
        </div>
      )}
      {status === 'off' && (
        <p className="text-xs text-muted mt-3">The bot is switched off and will not reply to anyone. Press Connect to show a new QR code and link a number.</p>
      )}
      {error && <p className="text-xs text-danger mt-3" role="alert">{error}</p>}
    </div>
  );
}
