import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Copy, Link as LinkIcon, Plug, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { IntegrationsInfo } from '../types';

const SHEETS_SCRIPT = `function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var l = d.lead;
  SpreadsheetApp.getActiveSheet().appendRow([
    new Date(), l.name, l.phone, l.service, l.stageLabel, l.source || '', JSON.stringify(l.answers)
  ]);
  return ContentService.createTextOutput('ok');
}`;

const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => undefined);
const input = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500';
const card = 'bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg';

export default function Integrations() {
  const [info, setInfo] = useState<IntegrationsInfo | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.integrations().then(setInfo).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);
  if (!info) return <div className={card + ' text-xs text-slate-500'}>{error || 'Loading integrations…'}</div>;

  return (
    <div className="space-y-6">
      <ChatLink phone={info.phone} />
      {!info.enabled && (
        <div className={card + ' border-amber-900/60'}>
          <h3 className="font-bold text-white text-base flex items-center space-x-2"><Plug className="w-4 h-4 text-amber-300" /><span>Webhooks &amp; API</span></h3>
          <p className="text-xs text-amber-200 mt-2">Webhooks, Google Sheets sync and the REST API need an active plan. Choose one in the Plan &amp; billing section below.</p>
        </div>
      )}
      {info.enabled && <Webhooks info={info} reload={load} />}
      {info.enabled && <Keys info={info} reload={load} />}
    </div>
  );
}

function Webhooks({ info, reload }: { info: IntegrationsInfo; reload: () => void }) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(info.events);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, string>>({});
  const [log, setLog] = useState<{ id: string; rows: { id: string; event: string; status: string; attempts: number; error: string; at: string }[] } | null>(null);
  const [showScript, setShowScript] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createWebhook(url, events);
      setUrl('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setResult((r) => ({ ...r, [id]: 'Sending…' }));
    try {
      const r = await api.testWebhook(id);
      setResult((x) => ({ ...x, [id]: r.status === 'ok' ? `Delivered (HTTP ${r.responseCode})` : `Failed: ${r.error || 'no response'}` }));
      reload();
    } catch (err) {
      setResult((x) => ({ ...x, [id]: (err as Error).message }));
    }
  }

  return (
    <div className={card}>
      <h3 className="font-bold text-white text-base flex items-center space-x-2"><Plug className="w-4 h-4 text-emerald-400" /><span>Webhooks</span></h3>
      <p className="text-xs text-slate-400 mt-1">We POST a signed JSON message to your URL when a lead is created or moves stage. Works with Zapier, Make, n8n, your own server, or Google Sheets (below).</p>

      <div className="mt-4 space-y-3">
        {info.webhooks.map((h) => (
          <div key={h.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 break-all text-slate-200 font-medium">{h.url}</div>
              <div className="flex items-center gap-2">
                <button onClick={() => test(h.id)} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-200">Send test</button>
                <button onClick={async () => setLog({ id: h.id, rows: await api.deliveries(h.id) })} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-200">Log</button>
                <button onClick={async () => { await api.patchWebhook(h.id, { active: !h.active }); reload(); }} className={`px-2.5 py-1 rounded-lg border ${h.active ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>{h.active ? 'On' : 'Off'}</button>
                <button onClick={async () => { if (window.confirm('Delete this webhook?')) { await api.deleteWebhook(h.id); reload(); } }} className="p-1.5 text-slate-400 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>Events: {h.events.join(', ')}</span>
              <span className="flex items-center space-x-1">Secret: <code className="ml-1 text-slate-300">{h.secret.slice(0, 12)}…</code>
                <button onClick={() => copy(h.secret)} className="text-emerald-400 hover:text-emerald-300 flex items-center space-x-0.5"><Copy className="w-3 h-3" /><span>copy</span></button></span>
              {h.last && <span className={h.last.status === 'ok' ? 'text-emerald-400' : h.last.status === 'failed' ? 'text-rose-400' : 'text-amber-300'}>Last: {h.last.status}{h.last.error ? ` (${h.last.error})` : ''}</span>}
            </div>
            {result[h.id] && <div className="mt-2 text-[11px] text-slate-300">{result[h.id]}</div>}
            {log?.id === h.id && (
              <div className="mt-2 border-t border-slate-800 pt-2 space-y-1">
                {log.rows.length === 0 && <div className="text-slate-500">No deliveries yet.</div>}
                {log.rows.map((d) => <div key={d.id} className="flex justify-between text-[11px]"><span className="text-slate-300">{d.event} · {new Date(d.at).toLocaleString()}</span><span className={d.status === 'ok' ? 'text-emerald-400' : d.status === 'failed' ? 'text-rose-400' : 'text-amber-300'}>{d.status} · {d.attempts} tr{d.attempts === 1 ? 'y' : 'ies'}{d.error ? ` · ${d.error}` : ''}</span></div>)}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={add} className="mt-4 flex flex-col sm:flex-row gap-2">
        <input required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" className={input} />
        <div className="flex items-center gap-3 text-[11px] text-slate-300">
          {info.events.map((ev) => <label key={ev} className="flex items-center space-x-1 whitespace-nowrap"><input type="checkbox" checked={events.includes(ev)} onChange={() => setEvents((x) => (x.includes(ev) ? x.filter((y) => y !== ev) : [...x, ev]))} /><span>{ev}</span></label>)}
        </div>
        <button disabled={busy || events.length === 0} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg disabled:opacity-40 whitespace-nowrap">Add webhook</button>
      </form>
      {error && <p className="text-xs text-rose-400 mt-2" role="alert">{error}</p>}

      <button onClick={() => setShowScript((s) => !s)} className="mt-4 text-xs text-emerald-400 hover:text-emerald-300 underline">Send leads to a Google Sheet</button>
      {showScript && (
        <div className="mt-2 text-xs text-slate-300 space-y-2">
          <ol className="list-decimal list-inside space-y-1 text-slate-400">
            <li>Open your Google Sheet → Extensions → Apps Script, and paste this code:</li>
          </ol>
          <pre className="bg-slate-900 border border-slate-800 rounded-lg p-3 overflow-x-auto text-[11px]">{SHEETS_SCRIPT}</pre>
          <button onClick={() => copy(SHEETS_SCRIPT)} className="text-emerald-400 flex items-center space-x-1"><Copy className="w-3 h-3" /><span>Copy code</span></button>
          <ol start={2} className="list-decimal list-inside space-y-1 text-slate-400">
            <li>Deploy → New deployment → type &ldquo;Web app&rdquo; → who has access: &ldquo;Anyone&rdquo; → Deploy.</li>
            <li>Copy the Web app URL (it starts with https://script.google.com/…) and add it above as a webhook.</li>
          </ol>
        </div>
      )}
    </div>
  );
}

function Keys({ info, reload }: { info: IntegrationsInfo; reload: () => void }) {
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api.createApiKey(name || 'API key');
      setFresh(r.key);
      setName('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className={card}>
      <h3 className="font-bold text-white text-base">REST API</h3>
      <p className="text-xs text-slate-400 mt-1">Read leads and change their stage from your own systems. 60 requests per minute per key.</p>
      {fresh && (
        <div className="mt-3 bg-emerald-950/30 border border-emerald-800/60 rounded-lg p-3 text-xs">
          <div className="text-emerald-300 font-semibold">Copy your key now, it will not be shown again:</div>
          <div className="mt-1 flex items-center gap-2"><code className="break-all text-slate-100">{fresh}</code><button onClick={() => copy(fresh)} className="text-emerald-400"><Copy className="w-3.5 h-3.5" /></button></div>
        </div>
      )}
      <div className="mt-3 divide-y divide-slate-800/70 border border-slate-800 rounded-xl overflow-hidden">
        {info.apiKeys.length === 0 && <div className="px-3.5 py-2.5 text-xs text-slate-500 bg-slate-900/50">No keys yet.</div>}
        {info.apiKeys.map((k) => (
          <div key={k.id} className="flex items-center justify-between px-3.5 py-2.5 text-xs bg-slate-900/50">
            <div><span className="text-slate-200 font-medium">{k.name}</span> <code className="text-slate-500 ml-2">{k.prefix}…</code>
              <div className="text-[11px] text-slate-500">Last used: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}</div></div>
            <button onClick={async () => { if (window.confirm('Revoke this key? Anything using it stops working.')) { await api.deleteApiKey(k.id); reload(); } }} className="p-1.5 text-slate-400 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <form onSubmit={create} className="mt-3 flex gap-2">
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Key name (e.g. CRM sync)" className={input} />
        <button className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg whitespace-nowrap">Create key</button>
      </form>
      {error && <p className="text-xs text-rose-400 mt-2" role="alert">{error}</p>}
      <pre className="mt-4 bg-slate-900 border border-slate-800 rounded-lg p-3 overflow-x-auto text-[11px] text-slate-300">{`curl -H "Authorization: Bearer lk_…" \\
  "${location.origin}/api/v1/leads?stage=new&limit=20"

curl -X PATCH -H "Authorization: Bearer lk_…" -H "Content-Type: application/json" \\
  -d '{"stage":"won","notes":"Signed"}' \\
  "${location.origin}/api/v1/leads/<phone>"`}</pre>
    </div>
  );
}

function ChatLink({ phone }: { phone: string | null }) {
  const [text, setText] = useState('Hi, I would like to know more.');
  const [tag, setTag] = useState('');
  const [qr, setQr] = useState('');
  const link = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text + (tag ? ` (ref: ${tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30)})` : ''))}` : '';
  useEffect(() => {
    if (!link) return;
    const t = setTimeout(() => api.chatLinkQr(link).then((r) => setQr(r.qr)).catch(() => setQr('')), 300);
    return () => clearTimeout(t);
  }, [link]);

  return (
    <div className={card}>
      <h3 className="font-bold text-white text-base flex items-center space-x-2"><LinkIcon className="w-4 h-4 text-emerald-400" /><span>Click-to-chat links</span></h3>
      <p className="text-xs text-slate-400 mt-1">Put these on your website, ads, posters or social bios. The campaign tag is saved on every lead it brings in, so you can see which campaign works.</p>
      {!phone ? (
        <p className="text-xs text-amber-300 mt-3">Connect WhatsApp first: the link uses your linked number.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5">
          <div className="space-y-3">
            <div><label className="text-[11px] text-slate-400 block mb-1">Message the customer starts with</label><input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} className={input} /></div>
            <div><label className="text-[11px] text-slate-400 block mb-1">Campaign tag (optional, letters, numbers, - and _)</label><input value={tag} maxLength={30} onChange={(e) => setTag(e.target.value)} placeholder="instagram-bio" className={input} /></div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-[11px] break-all text-slate-300">{link}</div>
            <div className="flex gap-2">
              <button onClick={() => copy(link)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 flex items-center space-x-1"><Copy className="w-3 h-3" /><span>Copy link</span></button>
              <button onClick={() => copy(`<a href="${link}" target="_blank" rel="noopener">Chat with us on WhatsApp</a>`)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 flex items-center space-x-1"><Copy className="w-3 h-3" /><span>Copy website button HTML</span></button>
            </div>
          </div>
          {qr && <img src={qr} alt="QR code for the chat link" className="w-40 h-40 rounded-lg bg-white p-1.5 justify-self-center" />}
        </div>
      )}
    </div>
  );
}
