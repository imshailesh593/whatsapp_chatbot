import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../api';
import { COLOR_CLS } from '../config';
import type { StageDef } from '../types';

const COLORS = Object.keys(COLOR_CLS);
const LOCKED = ['new', 'booked'];

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 1 || j >= list.length) return list; // "New lead" stays first
  const copy = list.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

export default function PipelineEditor({ stages: initial, onSaved }: { stages: StageDef[]; onSaved: () => void }) {
  const [stages, setStages] = useState<StageDef[]>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(stages) !== saved;

  const patch = (i: number, p: Partial<StageDef>) => setStages((s) => s.map((x, k) => (k === i ? { ...x, ...p } : x)));

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await api.saveStages(stages);
      setStages(res);
      setSaved(JSON.stringify(res));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500';
  const iconBtn = 'p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition';

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-white text-base">Lead pipeline</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            The stages a lead moves through. New leads start in <strong>New lead</strong>; when a customer says they have booked, the bot moves them to <strong>Booked</strong>. Those two stay, you can rename them and add your own.
          </p>
        </div>
        <button onClick={save} disabled={busy || !dirty} className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition disabled:opacity-40">
          <Save className="w-3.5 h-3.5" /><span>{busy ? 'Saving…' : 'Save pipeline'}</span>
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {stages.map((s, i) => (
          <div key={s.key + i} className="flex flex-wrap items-center gap-2">
            <span className={'inline-block w-3 h-3 rounded-full border ' + (COLOR_CLS[s.color] ?? COLOR_CLS.slate)} />
            <input value={s.label} maxLength={40} onChange={(e) => patch(i, { label: e.target.value })} className={input + ' flex-1 min-w-[140px]'} />
            <select value={s.color} onChange={(e) => patch(i, { color: e.target.value })} className={input}>
              {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={s.kind} disabled={LOCKED.includes(s.key)} onChange={(e) => patch(i, { kind: e.target.value as StageDef['kind'] })} className={input + ' disabled:opacity-50'}>
              <option value="open">In progress</option>
              <option value="won">Closed: won</option>
              <option value="lost">Closed: lost</option>
            </select>
            <button className={iconBtn} disabled={i <= 1} onClick={() => setStages(move(stages, i, -1))} title="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
            <button className={iconBtn} disabled={i === 0 || i === stages.length - 1} onClick={() => setStages(move(stages, i, 1))} title="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
            <button className={iconBtn + ' hover:text-rose-400'} disabled={LOCKED.includes(s.key)} onClick={() => setStages(stages.filter((_, k) => k !== i))} title="Remove (leads in it go back to New lead)"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <button disabled={stages.length >= 12} onClick={() => setStages([...stages, { key: '', label: '', color: 'slate', kind: 'open' }])}
        className="mt-3 flex items-center space-x-1 text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-40">
        <Plus className="w-3.5 h-3.5" /><span>Add stage</span>
      </button>
      {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
    </div>
  );
}
