import { useMemo, useState } from 'react';
import { Clock, Download, LayoutGrid, List, Phone, Search, UserCheck, Zap } from 'lucide-react';
import { api } from '../api';
import type { AdminRow, Contact } from '../types';
import { useStages } from '../stages';
import { serviceStyle, stageBadge, ago, displayPhone, waLink } from '../config';

interface Props {
  contacts: Contact[];
  includeTest: boolean;
  onIncludeTest: (v: boolean) => void;
  onOpen: (phone: string) => void;
  onChanged: (c: Contact) => void;
  team: AdminRow[];
  meId: string;
}

export default function Crm({ contacts, includeTest, onIncludeTest, onOpen, onChanged, team, meId }: Props) {
  const [view, setView] = useState<'list' | 'board'>(() => (localStorage.getItem('crmView') === 'board' ? 'board' : 'list'));
  const [owner, setOwner] = useState<string>('ALL');
  const [tag, setTag] = useState<string>('ALL');
  const [dueOnly, setDueOnly] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [boardError, setBoardError] = useState('');
  const [search, setSearch] = useState('');
  const [service, setService] = useState<string>('ALL');
  const stages = useStages();
  const [status, setStatus] = useState<string>('ALL');

  const serviceOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) if (c.service) m.set(c.service, c.serviceTitle ?? c.service);
    return [...m.entries()];
  }, [contacts]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter(
      (c) =>
        (!q || (c.name ?? '').toLowerCase().includes(q) || c.phone.includes(q) || (c.targetCountry ?? '').toLowerCase().includes(q)) &&
        (service === 'ALL' || c.service === service) &&
        (status === 'ALL' || (c.pipeline ?? 'answering') === status) &&
        (owner === 'ALL' || (owner === 'ME' ? c.ownerId === meId : owner === 'NONE' ? !c.ownerId : c.ownerId === owner)) &&
        (tag === 'ALL' || c.tags.includes(tag)) &&
        (!dueOnly || (!!c.followUpAt && new Date(c.followUpAt).getTime() <= Date.now()))
    );
  }, [contacts, search, service, status, owner, tag, dueOnly, meId]);

  const allTags = useMemo(() => [...new Set(contacts.flatMap((c) => c.tags))].sort(), [contacts]);
  const dueCount = useMemo(() => contacts.filter((c) => c.followUpAt && new Date(c.followUpAt).getTime() <= Date.now()).length, [contacts]);

  async function moveTo(phone: string, stage: string) {
    const c = contacts.find((x) => x.phone === phone);
    if (!c || !c.hasLead || c.pipeline === stage) return;
    setBoardError('');
    try {
      onChanged(await api.patch(phone, { stage }));
    } catch (err) {
      setBoardError((err as Error).message);
    }
  }

  const select = 'bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-emerald-500';

  async function toggleBot(c: Contact) {
    onChanged(await api.patch(c.phone, { paused: c.botActive }));
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name, phone, or country..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <select value={service} onChange={(e) => setService(e.target.value)} className={select}>
            <option value="ALL">All Services</option>
            {serviceOptions.map(([id, title]) => (
              <option key={id} value={id}>{title}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={select}>
            <option value="ALL">All Statuses</option>
            <option value="answering">⏳ Answering</option>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={select}>
            <option value="ALL">Anyone</option>
            <option value="ME">My leads</option>
            <option value="NONE">Unassigned</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
          </select>
          {allTags.length > 0 && (
            <select value={tag} onChange={(e) => setTag(e.target.value)} className={select}>
              <option value="ALL">All tags</option>
              {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
            </select>
          )}
          <button onClick={() => setDueOnly((v) => !v)} className={`flex items-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium border transition ${dueOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : 'bg-slate-900 text-slate-300 border-slate-700/80'}`}>
            <Clock className="w-3.5 h-3.5" /><span>Follow-ups due{dueCount ? ` (${dueCount})` : ''}</span>
          </button>
          <div className="flex rounded-lg overflow-hidden border border-slate-700/80">
            <button onClick={() => { setView('list'); localStorage.setItem('crmView', 'list'); }} title="List" className={`px-2.5 py-2 ${view === 'list' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-900 text-slate-400'}`}><List className="w-3.5 h-3.5" /></button>
            <button onClick={() => { setView('board'); localStorage.setItem('crmView', 'board'); }} title="Board" className={`px-2.5 py-2 ${view === 'board' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-900 text-slate-400'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
          </div>
          <label className="flex items-center space-x-1.5 text-[11px] text-slate-400 cursor-pointer">
            <input type="checkbox" checked={includeTest} onChange={(e) => onIncludeTest(e.target.checked)} />
            <span>Show simulator data</span>
          </label>
          <a
            href="/admin/api/export.csv"
            className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg text-xs font-medium border border-slate-700 transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {view === 'board' && (
        <div>
          {boardError && <p className="text-xs text-rose-400 mb-2" role="alert">{boardError}</p>}
          <p className="text-[11px] text-slate-500 mb-2">Drag a card to another column to change its stage. People still answering the questions are not shown here.</p>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {stages.map((st) => {
              const cards = rows.filter((c) => c.pipeline === st.key);
              return (
                <div key={st.key}
                  onDragOver={(e) => { e.preventDefault(); setOverStage(st.key); }}
                  onDragLeave={() => setOverStage((o) => (o === st.key ? null : o))}
                  onDrop={(e) => { e.preventDefault(); setOverStage(null); const p = e.dataTransfer.getData('text/plain') || dragging; if (p) moveTo(p, st.key); setDragging(null); }}
                  className={`w-64 shrink-0 rounded-xl border p-2.5 ${overStage === st.key ? 'border-emerald-500/70 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/70'}`}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${stageBadge(stages, st.key).cls}`}>{st.label}</span>
                    <span className="text-[11px] text-slate-500">{cards.length}</span>
                  </div>
                  <div className="space-y-2 min-h-[60px]">
                    {cards.map((c) => (
                      <div key={c.phone} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.phone); setDragging(c.phone); }} onDragEnd={() => setDragging(null)}
                        onClick={() => onOpen(c.phone)}
                        className="bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-lg p-2.5 cursor-grab active:cursor-grabbing text-xs">
                        <div className="font-semibold text-slate-100 truncate">{c.name || 'Unknown'}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">{c.serviceTitle ?? '—'} · {ago(c.lastActivity)}</div>
                        {(c.tags.length > 0 || c.followUpAt || c.ownerEmail) && (
                          <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                            {c.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">#{t}</span>)}
                            {c.followUpAt && <span className={`text-[10px] flex items-center space-x-0.5 ${new Date(c.followUpAt).getTime() <= Date.now() ? 'text-amber-300' : 'text-slate-500'}`}><Clock className="w-2.5 h-2.5" /><span>{new Date(c.followUpAt).toLocaleDateString()}</span></span>}
                            {c.ownerEmail && <span className="text-[10px] text-slate-500 truncate">{c.ownerEmail.split('@')[0]}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === 'list' && <div className="bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Contact & Phone</th>
                <th className="py-3 px-4">Service</th>
                <th className="py-3 px-4">Target Country</th>
                <th className="py-3 px-4">Funnel Progress</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Bot</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((c) => {
                const svc = c.service ? serviceStyle(c.service, c.serviceTitle) : null;
                return (
                  <tr key={c.phone} className="hover:bg-slate-900/50 transition cursor-pointer" onClick={() => onOpen(c.phone)}>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-100">
                        {c.name || 'Unknown'}
                        {c.isTest && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">TEST</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{displayPhone(c.phone)} · {ago(c.lastActivity)}</div>
                      {(c.tags.length > 0 || c.ownerEmail || c.followUpAt) && (
                        <div className="mt-1 flex flex-wrap gap-1 items-center">
                          {c.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">#{t}</span>)}
                          {c.ownerEmail && <span className="text-[10px] text-slate-500">· {c.ownerEmail.split('@')[0]}</span>}
                          {c.followUpAt && <span className={`text-[10px] ${new Date(c.followUpAt).getTime() <= Date.now() ? 'text-amber-300' : 'text-slate-500'}`}>· follow up {new Date(c.followUpAt).toLocaleDateString()}</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {svc ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${svc.badge}`}>
                          <span className="mr-1">{svc.icon}</span>
                          {svc.shortTitle}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Choosing service…</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300 font-medium">{c.targetCountry || '—'}</td>
                    <td className="py-3.5 px-4">
                      <div className="w-32">
                        <div className="text-[10px] text-slate-400 mb-1">{c.progress}% complete</div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${c.progress === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${c.progress}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${stageBadge(stages, c.pipeline).cls}`}>
                        {stageBadge(stages, c.pipeline).label}
                      </span>
                    </td>
                    <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleBot(c)}
                        disabled={c.isTest}
                        className={`flex items-center space-x-1.5 text-[11px] px-2.5 py-1 rounded-lg border font-medium transition disabled:opacity-40 ${
                          c.botActive
                            ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/50'
                            : 'bg-rose-950/40 border-rose-700/50 text-rose-400 hover:bg-rose-900/50'
                        }`}
                        title={c.botActive ? 'Bot is answering. Click to pause and take over.' : 'Bot paused (human mode). Click to resume.'}
                      >
                        {c.botActive ? <Zap className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                        <span>{c.botActive ? 'Bot Active' : 'Human Mode'}</span>
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end space-x-2">
                        {!c.isTest && (
                          <a
                            href={waLink(c.phone)}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 transition"
                            title="Open WhatsApp chat"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => onOpen(c.phone)}
                          className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 font-medium transition"
                        >
                          View Dossier
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">
              {contacts.length === 0 ? 'No conversations yet. Leads appear here as soon as someone messages the bot.' : 'No contacts match these filters.'}
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
