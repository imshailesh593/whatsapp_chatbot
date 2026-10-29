import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Overview, ServiceDef, TemplateInfo } from '../types';

const MAX_SERVICES = 9;
const MAX_QUESTIONS = 12;

const fromOverview = (o: Overview): ServiceDef[] =>
  o.services.map((s) => ({ title: s.title, keywords: s.keywords, questions: s.questions.map((q) => ({ key: q.key, prompt: q.prompt })) }));

const keyFrom = (prompt: string) =>
  prompt.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').split('_').slice(0, 3).join('_') || 'q';

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const copy = list.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

export default function BotBuilder({ overview, onSaved }: { overview: Overview; onSaved: () => void }) {
  const [services, setServices] = useState<ServiceDef[]>(() => fromOverview(overview));
  const [saved, setSaved] = useState(() => JSON.stringify(fromOverview(overview)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const dirty = useMemo(() => JSON.stringify(services) !== saved, [services, saved]);

  useEffect(() => { api.templates().then(setTemplates).catch(() => undefined); }, []);

  const patchService = (i: number, p: Partial<ServiceDef>) => setServices((s) => s.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const patchQuestion = (i: number, j: number, prompt: string) =>
    patchService(i, { questions: services[i].questions.map((q, k) => (k === j ? { ...q, prompt } : q)) });

  async function save() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      // Questions typed in the builder have no key yet: derive a stable one from the wording
      const payload = services.map((s) => ({
        ...s,
        questions: s.questions.map((q) => ({ key: q.key || keyFrom(q.prompt), prompt: q.prompt }))
      }));
      await api.saveServices(payload);
      setSaved(JSON.stringify(services));
      setNote('Saved. New conversations use this menu straight away.');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function useTemplate(id: string) {
    if (!id) return;
    if (!window.confirm('Replace your current menu and questions with this template? Existing leads are kept.')) return;
    try {
      await api.applyTemplate(id);
      onSaved();
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const input = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500';
  const iconBtn = 'p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition';

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4 mb-4">
        <div>
          <h3 className="font-bold text-white text-base">Menu &amp; questions</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Customers pick a service by number or keyword, then answer its questions one at a time. Test every change in the Bot Simulator tab.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value="" onChange={(e) => useTemplate(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-300">
            <option value="">Start from a template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button onClick={save} disabled={busy || !dirty}
            className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition disabled:opacity-40">
            <Save className="w-3.5 h-3.5" /><span>{busy ? 'Saving…' : 'Save changes'}</span>
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {services.map((s, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-slate-800 text-emerald-400 text-xs font-bold flex items-center justify-center border border-slate-700 shrink-0">{i + 1}</span>
              <input value={s.title} maxLength={80} onChange={(e) => patchService(i, { title: e.target.value })} placeholder="Service name shown in the menu" className={`${input} font-semibold`} />
              <button className={iconBtn} disabled={i === 0} onClick={() => setServices(move(services, i, -1))} title="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button className={iconBtn} disabled={i === services.length - 1} onClick={() => setServices(move(services, i, 1))} title="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
              <button className={`${iconBtn} hover:text-rose-400`} disabled={services.length === 1} onClick={() => setServices(services.filter((_, k) => k !== i))} title="Remove service"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <label className="text-[11px] text-slate-500 block mt-3 mb-1">Keywords that also select this service (comma separated)</label>
            <input value={s.keywords.join(', ')} onChange={(e) => patchService(i, { keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })} placeholder="e.g. price, quote, buy" className={input} />

            <div className="mt-3 space-y-2">
              {s.questions.map((q, j) => (
                <div key={j} className="flex items-start gap-2">
                  <span className="text-[10px] text-slate-500 font-mono w-5 pt-2.5 text-right shrink-0">Q{j + 1}</span>
                  <textarea value={q.prompt} rows={2} maxLength={500} onChange={(e) => patchQuestion(i, j, e.target.value)} placeholder="What the bot asks" className={`${input} resize-y`} />
                  <div className="flex flex-col">
                    <button className={iconBtn} disabled={j === 0} onClick={() => patchService(i, { questions: move(s.questions, j, -1) })} title="Move up"><ArrowUp className="w-3 h-3" /></button>
                    <button className={iconBtn} disabled={j === s.questions.length - 1} onClick={() => patchService(i, { questions: move(s.questions, j, 1) })} title="Move down"><ArrowDown className="w-3 h-3" /></button>
                  </div>
                  <button className={`${iconBtn} hover:text-rose-400 mt-1`} disabled={s.questions.length === 1} onClick={() => patchService(i, { questions: s.questions.filter((_, k) => k !== j) })} title="Remove question"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button disabled={s.questions.length >= MAX_QUESTIONS} onClick={() => patchService(i, { questions: [...s.questions, { key: '', prompt: '' }] })}
                className="flex items-center space-x-1 text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-40 mt-1">
                <Plus className="w-3.5 h-3.5" /><span>Add question</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      <button disabled={services.length >= MAX_SERVICES} onClick={() => setServices([...services, { title: '', keywords: [], questions: [{ key: '', prompt: '' }] }])}
        className="mt-4 flex items-center space-x-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 disabled:opacity-40">
        <Plus className="w-3.5 h-3.5" /><span>Add service</span>
      </button>
      {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
      {note && <p className="text-xs text-emerald-400 mt-3">{note}</p>}
    </div>
  );
}
