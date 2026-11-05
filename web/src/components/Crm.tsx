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

  const select = 'h-9 bg-sunken border border-line/80 rounded-lg px-3 text-xs text-fg2 focus:outline-none focus:border-brand/40';

  async function toggleBot(c: Contact) {
    onChanged(await api.patch(c.phone, { paused: c.botActive }));
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-line rounded-2xl shadow-card p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name, phone, or country..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-sunken border border-line/80 rounded-lg pl-9 pr-3 h-9 text-xs text-fg placeholder-muted focus:outline-none focus:border-brand/40"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <button onClick={() => setDueOnly((v) => !v)} className={`inline-flex items-center gap-1.5 h-9 px-3 whitespace-nowrap rounded-lg text-xs font-medium border transition ${dueOnly ? 'bg-warn-soft text-warn border-warn-line/50' : 'bg-sunken text-fg2 border-line/80'}`}>
            <Clock className="w-3.5 h-3.5" /><span>Follow-ups due{dueCount ? ` (${dueCount})` : ''}</span>
          </button>
          <div className="flex h-9 rounded-lg overflow-hidden border border-line/80">
            <button onClick={() => { setView('list'); localStorage.setItem('crmView', 'list'); }} title="List" className={`px-2.5 inline-flex items-center ${view === 'list' ? 'bg-brand-soft text-brand-text' : 'bg-sunken text-muted'}`}><List className="w-3.5 h-3.5" /></button>
            <button onClick={() => { setView('board'); localStorage.setItem('crmView', 'board'); }} title="Board" className={`px-2.5 inline-flex items-center ${view === 'board' ? 'bg-brand-soft text-brand-text' : 'bg-sunken text-muted'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
          </div>
          <label className="inline-flex items-center gap-1.5 h-9 whitespace-nowrap text-[11px] text-muted cursor-pointer">
            <input type="checkbox" checked={includeTest} onChange={(e) => onIncludeTest(e.target.checked)} />
            <span>Show simulator data</span>
          </label>
          <a
            href="/admin/api/export.csv"
            className="inline-flex items-center gap-1.5 h-9 whitespace-nowrap bg-subtle hover:bg-subtle text-fg px-3 rounded-lg text-xs font-medium border border-line transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {view === 'board' && (
        <div>
          {boardError && <p className="text-xs text-danger mb-2" role="alert">{boardError}</p>}
          <p className="text-[11px] text-muted mb-2">Drag a card to another column to change its stage. People still answering the questions are not shown here.</p>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {stages.map((st) => {
              const cards = rows.filter((c) => c.pipeline === st.key);
              return (
                <div key={st.key}
                  onDragOver={(e) => { e.preventDefault(); setOverStage(st.key); }}
                  onDragLeave={() => setOverStage((o) => (o === st.key ? null : o))}
                  onDrop={(e) => { e.preventDefault(); setOverStage(null); const p = e.dataTransfer.getData('text/plain') || dragging; if (p) moveTo(p, st.key); setDragging(null); }}
                  className={`w-64 shrink-0 rounded-xl border p-2.5 ${overStage === st.key ? 'border-brand/70 bg-brand-soft' : 'border-line bg-card/70'}`}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${stageBadge(stages, st.key).cls}`}>{st.label}</span>
                    <span className="text-[11px] text-muted">{cards.length}</span>
                  </div>
                  <div className="space-y-2 min-h-[60px]">
                    {cards.map((c) => (
                      <div key={c.phone} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.phone); setDragging(c.phone); }} onDragEnd={() => setDragging(null)}
                        onClick={() => onOpen(c.phone)}
                        className="bg-sunken border border-line hover:border-line-strong rounded-lg p-2.5 cursor-grab active:cursor-grabbing text-xs">
                        <div className="font-semibold text-fg truncate">{c.name || 'Unknown'}</div>
                        <div className="text-[11px] text-muted mt-0.5 truncate">{c.serviceTitle ?? '—'} · {ago(c.lastActivity)}</div>
                        {(c.tags.length > 0 || c.followUpAt || c.ownerEmail) && (
                          <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                            {c.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded bg-subtle text-fg2 text-[10px]">#{t}</span>)}
                            {c.followUpAt && <span className={`text-[10px] flex items-center space-x-0.5 ${new Date(c.followUpAt).getTime() <= Date.now() ? 'text-warn' : 'text-muted'}`}><Clock className="w-2.5 h-2.5" /><span>{new Date(c.followUpAt).toLocaleDateString()}</span></span>}
                            {c.ownerEmail && <span className="text-[10px] text-muted truncate">{c.ownerEmail.split('@')[0]}</span>}
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

      {view === 'list' && <div className="bg-card/80 border border-line rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-sunken/90 border-b border-line text-muted font-semibold uppercase text-[10px] tracking-wider">
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
            <tbody className="divide-y divide-line/60">
              {rows.map((c) => {
                const svc = c.service ? serviceStyle(c.service, c.serviceTitle) : null;
                return (
                  <tr key={c.phone} className="hover:bg-sunken/50 transition cursor-pointer" onClick={() => onOpen(c.phone)}>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-fg">
                        {c.name || 'Unknown'}
                        {c.isTest && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-subtle text-muted">TEST</span>}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">{displayPhone(c.phone)} · {ago(c.lastActivity)}</div>
                      {(c.tags.length > 0 || c.ownerEmail || c.followUpAt) && (
                        <div className="mt-1 flex flex-wrap gap-1 items-center">
                          {c.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded bg-subtle text-fg2 text-[10px]">#{t}</span>)}
                          {c.ownerEmail && <span className="text-[10px] text-muted">· {c.ownerEmail.split('@')[0]}</span>}
                          {c.followUpAt && <span className={`text-[10px] ${new Date(c.followUpAt).getTime() <= Date.now() ? 'text-warn' : 'text-muted'}`}>· follow up {new Date(c.followUpAt).toLocaleDateString()}</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {svc ? (
                        <span title={svc.shortTitle} className={`inline-flex max-w-[260px] items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${svc.badge}`}>
                          <span className="mr-1.5 text-[7px] leading-none shrink-0">{svc.icon}</span>
                          <span className="truncate">{svc.shortTitle}</span>
                        </span>
                      ) : (
                        <span className="text-muted text-[11px]">Choosing service…</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-fg2 font-medium">{c.targetCountry || '—'}</td>
                    <td className="py-3.5 px-4">
                      <div className="w-32">
                        <div className="text-[10px] text-muted mb-1">{c.progress}% complete</div>
                        <div className="w-full h-1.5 bg-subtle rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${c.progress === 100 ? 'bg-brand' : 'bg-warn'}`} style={{ width: `${c.progress}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-semibold border ${stageBadge(stages, c.pipeline).cls}`}>
                        {stageBadge(stages, c.pipeline).label}
                      </span>
                    </td>
                    <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleBot(c)}
                        disabled={c.isTest}
                        className={`flex items-center space-x-1.5 whitespace-nowrap text-[11px] px-2.5 py-1 rounded-lg border font-medium transition disabled:opacity-40 ${
                          c.botActive
                            ? 'bg-brand-soft border-brand/50 text-brand-text hover:bg-brand-soft'
                            : 'bg-danger-soft border-danger-line/50 text-danger hover:bg-danger-soft'
                        }`}
                        title={c.botActive ? 'Bot is answering. Click to pause and take over.' : c.handoffAt ? 'The customer asked for a person. Click to hand the chat back to the bot.' : 'Bot paused (human mode). Click to resume.'}
                      >
                        {c.botActive ? <Zap className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                        <span>{c.botActive ? 'Bot Active' : c.handoffAt ? 'Needs a person' : 'Human Mode'}</span>
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end space-x-2">
                        {!c.isTest && (
                          <a
                            href={waLink(c.phone)}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg bg-brand-soft text-brand-text hover:bg-brand-soft border border-brand/30 transition"
                            title="Open WhatsApp chat"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => onOpen(c.phone)}
                          className="px-2.5 py-1 text-xs whitespace-nowrap bg-subtle hover:bg-subtle text-fg rounded-lg border border-line font-medium transition"
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
            <div className="p-8 text-center text-muted text-sm">
              {contacts.length === 0 ? 'No conversations yet. Leads appear here as soon as someone messages the bot.' : 'No contacts match these filters.'}
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
