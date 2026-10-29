import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Megaphone, Pause, Play, Send, X } from 'lucide-react';
import { api } from '../api';
import { ago } from '../config';
import type { BroadcastInfo, Overview } from '../types';

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  scheduled: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  sending: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  paused: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  done: 'bg-green-500/20 text-green-300 border-green-500/40',
  canceled: 'bg-rose-500/20 text-rose-300 border-rose-500/40'
};

export default function Broadcasts({ overview, waReady }: { overview: Overview; waReady: boolean }) {
  const [list, setList] = useState<BroadcastInfo[]>([]);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [stages, setStages] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const [answering, setAnswering] = useState(false);
  const [schedule, setSchedule] = useState('');
  const [audience, setAudience] = useState<{ count: number; sample: { name: string | null; phone: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => api.broadcasts().then(setList).catch((e) => setError((e as Error).message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const filters = { stages, services, activeWithinDays: days, includeAnswering: answering && stages.length === 0 };
  const key = JSON.stringify(filters);
  useEffect(() => {
    const t = setTimeout(() => api.audience(filters).then(setAudience).catch(() => setAudience(null)), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const toggle = (arr: string[], set: (v: string[]) => void, k: string) => set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createBroadcast({ name, text, filters, scheduleAt: schedule ? new Date(schedule).toISOString() : null });
      setName('');
      setText('');
      setSchedule('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(b: BroadcastInfo, action: 'start' | 'pause' | 'resume' | 'cancel') {
    if (action === 'start' && !window.confirm(`Send "${b.name}" to ${b.total} customers? Messages go out slowly from your own WhatsApp number, one every 8 to 20 seconds, during the daytime only.`)) return;
    if (action === 'cancel' && !window.confirm('Cancel this broadcast? Messages already sent stay sent.')) return;
    setError('');
    try {
      await api.broadcastAction(b.id, action);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const input = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500';
  const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${on ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'}`;

  return (
    <div className="space-y-6">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <h3 className="font-bold text-white text-base flex items-center space-x-2"><Megaphone className="w-4 h-4 text-emerald-400" /><span>New broadcast</span></h3>
        <p className="text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-900/50 rounded-lg p-3 mt-3">
          Broadcasts are sent from your own WhatsApp number. WhatsApp can restrict numbers that send unwanted messages, so only write to customers who have chatted with you, keep it relevant,
          and expect a few replies of STOP. Every message ends with an unsubscribe line, goes out slowly, and only between 9:00 and 20:00 in your time zone.
        </p>
        {!waReady && <p className="text-xs text-rose-300 mt-3">WhatsApp is not connected: broadcasts will wait until it is.</p>}

        <form onSubmit={create} className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div><label className="text-[11px] text-slate-400 block mb-1">Name (only you see this)</label><input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Diwali offer" /></div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Message · use {'{name}'} for their first name</label>
              <textarea required rows={6} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} className={input} placeholder="Hi {name}, we have a few slots open this week…" />
              <div className="text-[10px] text-slate-500 mt-1">{text.length}/1000 · &ldquo;Reply STOP to unsubscribe.&rdquo; is added automatically</div>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Send at (optional, leave empty to start it yourself)</label>
              <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} className={input} />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-[11px] text-slate-400 mb-1">Pipeline stage (none selected = all finished leads)</div>
              <div className="flex flex-wrap gap-1.5">{overview.stages.map((s) => <button type="button" key={s.key} onClick={() => toggle(stages, setStages, s.key)} className={chip(stages.includes(s.key))}>{s.label}</button>)}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400 mb-1">Service (none selected = any)</div>
              <div className="flex flex-wrap gap-1.5">{overview.services.map((s) => <button type="button" key={s.id} onClick={() => toggle(services, setServices, s.id)} className={chip(services.includes(s.id))}>{s.title}</button>)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[11px] text-slate-400">Wrote to you within the last
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="ml-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200">
                  {[7, 30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
                </select>
              </label>
              <label className="text-[11px] text-slate-400 flex items-center space-x-1.5">
                <input type="checkbox" disabled={stages.length > 0} checked={answering && stages.length === 0} onChange={(e) => setAnswering(e.target.checked)} />
                <span>Include people who did not finish the questions</span>
              </label>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs">
              <div className="text-white font-semibold">{audience ? `${audience.count} customer${audience.count === 1 ? '' : 's'} will receive this` : 'Counting…'}</div>
              {audience && audience.sample.length > 0 && <div className="text-slate-400 mt-1">e.g. {audience.sample.map((s) => s.name || s.phone).join(', ')}</div>}
            </div>
            <button disabled={busy || !audience?.count} className="flex items-center space-x-1.5 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg disabled:opacity-40">
              <Send className="w-3.5 h-3.5" /><span>{schedule ? 'Schedule broadcast' : 'Create draft'}</span>
            </button>
          </div>
        </form>
        {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-2xl shadow-lg overflow-hidden">
        <div className="p-5 border-b border-slate-800"><h3 className="font-bold text-white text-base">Your broadcasts</h3></div>
        {list.length === 0 && <p className="p-5 text-xs text-slate-500">Nothing sent yet.</p>}
        <div className="divide-y divide-slate-800/70">
          {list.map((b) => {
            const pct = b.total ? Math.round(((b.sent + b.failed) / b.total) * 100) : 0;
            return (
              <div key={b.id} className="p-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-100 text-sm">{b.name}</span>
                    <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_CLS[b.status] ?? STATUS_CLS.draft}`}>{b.status}</span>
                    <div className="text-[11px] text-slate-500 mt-0.5">{ago(b.createdAt)} · {b.createdBy}{b.scheduledAt ? ` · scheduled for ${new Date(b.scheduledAt).toLocaleString()}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(b.status === 'draft' || b.status === 'scheduled') && <button onClick={() => act(b, 'start')} className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-500 text-slate-950 font-bold rounded-lg"><Play className="w-3 h-3" /><span>Send now</span></button>}
                    {b.status === 'sending' && <button onClick={() => act(b, 'pause')} className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 text-slate-200 rounded-lg border border-slate-700"><Pause className="w-3 h-3" /><span>Pause</span></button>}
                    {b.status === 'paused' && <button onClick={() => act(b, 'resume')} className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-500 text-slate-950 font-bold rounded-lg"><Play className="w-3 h-3" /><span>Resume</span></button>}
                    {['draft', 'scheduled', 'sending', 'paused'].includes(b.status) && <button onClick={() => act(b, 'cancel')} className="p-1.5 text-slate-400 hover:text-rose-400" title="Cancel"><X className="w-4 h-4" /></button>}
                  </div>
                </div>
                <p className="mt-2 text-slate-300 whitespace-pre-wrap line-clamp-2">{b.text}</p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                  <span className="text-slate-400 whitespace-nowrap">{b.sent} sent{b.failed ? ` · ${b.failed} failed` : ''} / {b.total}</span>
                </div>
                {b.note && <p className="mt-2 text-amber-300">{b.note}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
