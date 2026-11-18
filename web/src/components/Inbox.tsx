import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCheck, ExternalLink, Info, MessageSquareText, Phone, Search, Send, UserCheck, X, Zap } from 'lucide-react';
import { api } from '../api';
import type { ChatMessage, Contact } from '../types';
import { serviceStyle, stageBadge, ago, displayPhone, humanize, waLink, isSocialChat } from '../config';

const CANNED = [
  'Hello! I am a team member taking over this conversation from the assistant.',
  'Could you please share a few more details here so we can help you better?',
  'We have noted your booking. Our team will connect at the chosen time.',
  'Thanks for your patience, we will get back to you shortly.'
];

interface Props {
  contacts: Contact[];
  waReady: boolean;
  onChanged: (c: Contact) => void;
  /** Chat to show first (set when a contact is opened from the lead card) */
  initialPhone?: string | null;
}

import { useBrand } from '../brand';
import { useStages } from '../stages';
export default function Inbox({ contacts, waReady, onChanged, initialPhone }: Props) {
  const brand = useBrand();
  const stages = useStages();
  const list = useMemo(() => contacts.filter((c) => !c.isTest), [contacts]);
  const [activePhone, setActivePhone] = useState<string | null>(initialPhone ?? null);
  useEffect(() => { if (initialPhone) { setActivePhone(initialPhone); setShowChat(true); } }, [initialPhone]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'person' | 'bot'>('all');
  const [info, setInfo] = useState(false);
  const [canned, setCanned] = useState(false);
  const [showChat, setShowChat] = useState(!!initialPhone);

  const active = list.find((c) => c.phone === activePhone) ?? null;
  const phone = active?.phone ?? null;

  // keep notes box in sync when switching contact
  useEffect(() => {
    setNotes(active?.notes ?? '');
    setError('');
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const loadMessages = useCallback(async () => {
    if (!phone) return;
    try {
      setMessages(await api.messages(phone));
    } catch {
      // transient; next poll retries
    }
  }, [phone]);

  useEffect(() => {
    setMessages([]);
    loadMessages();
    const t = setInterval(loadMessages, 5000);
    return () => clearInterval(t);
  }, [loadMessages]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, phone]);

  // opening a chat (or a customer writing while it is open) marks it as read for the team
  const unreadHere = active?.unread ?? 0;
  useEffect(() => {
    if (!active || unreadHere === 0) return;
    api.markRead(active.phone).then(() => onChanged({ ...active, unread: 0 })).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, unreadHere]);

  if (list.length === 0) {
    return <div className="bg-card border border-line rounded-2xl p-10 text-center text-muted text-sm">No conversations yet.</div>;
  }

  async function toggleBot() {
    setError('');
    try {
      onChanged(await api.patch(active!.phone, { paused: active!.botActive }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sendReply() {
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    setError('');
    try {
      await api.send(active!.phone, text);
      setReply('');
      await loadMessages();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function saveNotes() {
    setError('');
    try {
      onChanged(await api.patch(active!.phone, { notes }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const canReply = !!active && !active.botActive && waReady;
  const svc = active?.service ? serviceStyle(active.service, active.serviceTitle) : null;

  const q = query.trim().toLowerCase();
  const shown = list.filter((c) => (filter === 'all' || (filter === 'person' ? !c.botActive : c.botActive)) && (!q || (c.name || '').toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, '') || '\u0000') || (c.name === null && 'unknown'.includes(q))));
  const hue = (t: string) => { let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const Avatar = ({ c, size = 49 }: { c: Contact; size?: number }) => (
    <div className="rounded-full flex items-center justify-center font-semibold text-white shrink-0 select-none" style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue(c.phone)} 45% 42%)` }}>
      {(c.name || '?').trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
  const dayLabel = (iso: string) => {
    const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const sub = (c: Contact) => (c.service ? c.serviceTitle : 'Choosing service') + (c.targetCountry ? ` • ${c.targetCountry}` : '');

  return (
    <div className="h-[calc(100vh-190px)] min-h-[560px] flex overflow-hidden rounded-xl border border-[#d1d7db] dark:border-[#222d34] bg-white dark:bg-[#111b21] text-[#111b21] dark:text-[#e9edef] shadow-card">
      {/* chat list */}
      <aside className={`${showChat ? 'hidden' : 'flex'} md:flex w-full md:w-[380px] lg:w-[400px] shrink-0 flex-col border-r border-[#e9edef] dark:border-[#222d34] bg-white dark:bg-[#111b21]`}>
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-[22px] font-bold">Chats</h3>
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-[#f0f2f5] dark:bg-[#202c33] px-3.5 py-2">
            <Search className="w-4 h-4 text-[#54656f] dark:text-[#aebac1] shrink-0" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or start a new chat"
              className="w-full bg-transparent outline-none text-[15px] placeholder-[#667781] dark:placeholder-[#8696a0]" />
          </div>
          <div className="mt-3 flex gap-2 text-[14px]">
            {([['all', 'All'], ['person', 'Needs a person'], ['bot', 'Bot active']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-3 py-1 rounded-full border transition ${filter === k ? 'bg-[#d9fdd3] dark:bg-[#103529] border-transparent text-[#008069] dark:text-[#06cf9c] font-semibold' : 'border-[#e9edef] dark:border-[#2a3942] text-[#54656f] dark:text-[#8696a0] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33]'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {shown.length === 0 && <p className="p-6 text-center text-[14px] text-[#667781] dark:text-[#8696a0]">No chats match.</p>}
          {shown.map((c) => (
            <div key={c.phone} onClick={() => { setActivePhone(c.phone); setShowChat(true); }}
              className={`flex items-center gap-3.5 pl-3.5 pr-4 cursor-pointer ${c.phone === active?.phone ? 'bg-[#f0f2f5] dark:bg-[#2a3942]' : 'hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]'}`}>
              <Avatar c={c} />
              <div className="flex-1 min-w-0 py-3 border-b border-[#e9edef] dark:border-[#222d34]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[17px] truncate ${c.unread > 0 ? 'font-semibold' : 'font-medium'}`}>{c.name || displayPhone(c.phone)}</span>
                  <span className={`text-[12.5px] shrink-0 ${c.unread > 0 ? 'text-[#1fa855] dark:text-[#06cf9c] font-semibold' : 'text-[#667781] dark:text-[#8696a0]'}`}>{ago(c.lastActivity)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className={`text-[14.5px] truncate ${c.unread > 0 ? 'text-[#111b21] dark:text-[#e9edef]' : 'text-[#667781] dark:text-[#8696a0]'}`}>{c.name ? `${displayPhone(c.phone)} · ` : ''}{sub(c)}</span>
                  <span className="shrink-0 flex items-center gap-1.5">
                    {!c.botActive && <span className="w-5 h-5 rounded-full bg-[#fff5c4] dark:bg-[#3a3217] text-[#8a6d00] dark:text-[#ffd279] flex items-center justify-center" title="Needs a person"><UserCheck className="w-3 h-3" /></span>}
                    {c.unread > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#25d366] text-[#0b141a] text-[12px] font-bold flex items-center justify-center" title={`${c.unread} unread`}>{c.unread > 99 ? '99+' : c.unread}</span>}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* conversation */}
      {!active ? (
        <section className="hidden md:flex flex-1 flex-col items-center justify-center gap-2 bg-[#f0f2f5] dark:bg-[#222e35] text-center px-8">
          <MessageSquareText className="w-14 h-14 text-[#8696a0]" />
          <div className="text-[28px] font-light text-[#41525d] dark:text-[#e9edef]">Your conversations</div>
          <p className="text-[14.5px] text-[#667781] dark:text-[#8696a0] max-w-sm">Select a chat to read it, reply, or take over from the bot.</p>
        </section>
      ) : (<>
      <section className={`${showChat ? 'flex' : 'hidden'} md:flex flex-1 min-w-0 flex-col`}>
        <header className="h-[60px] shrink-0 flex items-center gap-3 px-4 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#e9edef] dark:border-[#222d34]">
          <button className="md:hidden p-1 -ml-1 text-[#54656f] dark:text-[#aebac1]" onClick={() => setShowChat(false)} aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
          <button onClick={() => setInfo((v) => !v)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
            <Avatar c={active} size={40} />
            <div className="min-w-0">
              <div className="text-[16.5px] font-medium truncate">{active.name || 'Unknown'} <span className="text-[13px] font-normal text-[#667781] dark:text-[#8696a0]">{displayPhone(active.phone)}</span></div>
              <div className="text-[13px] text-[#667781] dark:text-[#8696a0] truncate">{svc ? `${svc.icon} ${svc.shortTitle}` : 'Choosing service'}</div>
            </div>
          </button>
          <button onClick={toggleBot}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13.5px] font-semibold transition ${active.botActive ? 'bg-[#d9fdd3] dark:bg-[#103529] text-[#008069] dark:text-[#06cf9c]' : 'bg-[#ffe3e0] dark:bg-[#3a1d1d] text-[#c0392b] dark:text-[#ff8a80]'}`}>
            {active.botActive ? <Zap className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
            <span>{active.botActive ? 'Bot automated' : 'Human takeover'}</span>
          </button>
          <button onClick={() => setInfo((v) => !v)} className={`p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${info ? 'text-[#008069] dark:text-[#06cf9c]' : 'text-[#54656f] dark:text-[#aebac1]'}`} title="Contact info" aria-label="Contact info"><Info className="w-5 h-5" /></button>
        </header>

        <div ref={scroller} className="flex-1 overflow-y-auto px-4 sm:px-[7%] py-4 bg-[#efeae2] dark:bg-[#0b141a]"
          style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><g fill='none' stroke='%23808080' stroke-opacity='.07' stroke-width='2'><circle cx='20' cy='22' r='7'/><path d='M70 14l10 10M80 14L70 24'/><rect x='24' y='72' width='14' height='10' rx='3'/><path d='M82 78c4-8 12-8 16 0s-12 8-16 0z'/></g></svg>\")" }}>
          {messages.length === 0 && <p className="mx-auto w-fit mt-6 px-3 py-1.5 rounded-lg bg-white/90 dark:bg-[#182229] text-[13.5px] text-[#54656f] dark:text-[#8696a0] shadow-sm">No messages recorded for this contact yet.</p>}
          {messages.map((m, i) => {
            const out = m.direction !== 'INBOUND';
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
            const first = newDay || prev.direction !== m.direction;
            return (
              <div key={m.id}>
                {newDay && <div className="flex justify-center my-3"><span className="px-3 py-1 rounded-lg bg-white/90 dark:bg-[#182229] text-[12.5px] text-[#54656f] dark:text-[#8696a0] shadow-sm">{dayLabel(m.at)}</span></div>}
                <div className={`flex ${out ? 'justify-end' : 'justify-start'} ${first ? 'mt-2' : 'mt-0.5'}`}>
                  <div className={`relative max-w-[85%] sm:max-w-[65%] rounded-lg px-2.5 pt-1.5 pb-1 shadow-[0_1px_0.5px_rgba(11,20,26,.13)] ${out ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef]' : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef]'} ${first ? (out ? 'rounded-tr-none' : 'rounded-tl-none') : ''}`}>
                    {first && <span aria-hidden className={`absolute top-0 w-2 h-3 ${out ? '-right-2 bg-[#d9fdd3] dark:bg-[#005c4b]' : '-left-2 bg-white dark:bg-[#202c33]'}`} style={{ clipPath: out ? 'polygon(0 0, 0 100%, 100% 0)' : 'polygon(100% 0, 100% 100%, 0 0)' }} />}
                    <span className="text-[15px] leading-[21px] whitespace-pre-wrap break-words">{m.text}</span>
                    <span className="float-right ml-3 mt-1.5 -mb-0.5 flex items-center gap-1 text-[11.5px] text-[#667781] dark:text-[#ffffff99] leading-none">
                      {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {out && <CheckCheck className="w-4 h-4 text-[#53bdeb]" />}
                    </span>
                    <span className="clear-both block" />
                  </div>
                </div>
              </div>
            );
          })}
          {!active.botActive && (
            <div className="flex flex-col items-center my-4 gap-2">
              <span className="max-w-[90%] text-center px-3 py-1.5 rounded-lg bg-[#fff5c4] dark:bg-[#182229] text-[13px] text-[#54656f] dark:text-[#ffd279] shadow-sm">
                {active.handoffAt ? 'The customer asked for a person: ' : 'Human takeover: '}bot replies are paused for this number.
              </span>
              {active.handoffSummary && <p className="max-w-[90%] sm:max-w-[65%] px-3 py-2 rounded-lg bg-white dark:bg-[#202c33] text-[14px] whitespace-pre-line shadow-sm"><strong>Briefing:</strong> {active.handoffSummary}</p>}
            </div>
          )}
        </div>

        <footer className="shrink-0 relative bg-[#f0f2f5] dark:bg-[#202c33] px-3 py-2.5">
          {canned && (
            <div className="absolute bottom-full left-3 mb-2 w-[min(420px,92%)] rounded-xl bg-white dark:bg-[#233138] shadow-pop border border-[#e9edef] dark:border-[#2a3942] overflow-hidden z-10">
              {CANNED.map((c, i) => (
                <button key={i} disabled={!canReply} onClick={() => { setReply(c); setCanned(false); }}
                  className="block w-full text-left px-4 py-2.5 text-[14.5px] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] disabled:opacity-40 border-b last:border-0 border-[#e9edef] dark:border-[#2a3942]">{c}</button>
              ))}
            </div>
          )}
          {error && <p className="text-[13.5px] text-[#c0392b] dark:text-[#ff8a80] mb-1.5 px-1">{error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={() => setCanned((v) => !v)} className="p-2.5 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-black/5 dark:hover:bg-white/10" title="Quick replies" aria-label="Quick replies"><MessageSquareText className="w-5 h-5" /></button>
            <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && canReply && sendReply()}
              disabled={!canReply}
              placeholder={!waReady ? 'WhatsApp is not connected' : active.botActive ? 'Take over (button above) to type a message' : 'Type a message'}
              className="flex-1 min-w-0 rounded-lg bg-white dark:bg-[#2a3942] px-4 py-2.5 text-[15px] outline-none placeholder-[#667781] dark:placeholder-[#8696a0] disabled:opacity-60" />
            <button onClick={sendReply} disabled={!canReply || !reply.trim() || sending} aria-label="Send"
              className="w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#008f72] text-white flex items-center justify-center transition disabled:opacity-40">
              <Send className="w-[18px] h-[18px]" />
            </button>
          </div>
        </footer>
      </section>

      {/* contact info */}
      {info && (
        <aside className="hidden lg:flex w-[340px] shrink-0 flex-col border-l border-[#e9edef] dark:border-[#222d34] bg-[#f0f2f5] dark:bg-[#111b21]">
          <div className="h-[60px] shrink-0 flex items-center gap-4 px-4 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#e9edef] dark:border-[#222d34]">
            <button onClick={() => setInfo(false)} className="p-1 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-black/5 dark:hover:bg-white/10" aria-label="Close"><X className="w-5 h-5" /></button>
            <span className="text-[16px] font-medium">Contact info</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="bg-white dark:bg-[#111b21] py-6 flex flex-col items-center gap-2">
              <Avatar c={active} size={120} />
              <div className="text-[20px] font-medium mt-2">{active.name || 'Unknown'}</div>
              <div className="text-[15px] text-[#667781] dark:text-[#8696a0]">{displayPhone(active.phone)}</div>
              {!isSocialChat(active.phone) && (
                <a href={waLink(active.phone)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#e9edef] dark:border-[#2a3942] text-[14px] text-[#008069] dark:text-[#06cf9c] font-semibold hover:bg-[#f0f2f5] dark:hover:bg-[#202c33]">
                  <Phone className="w-4 h-4" /><span>Open in WhatsApp</span><ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            <div className="mt-2 bg-white dark:bg-[#111b21] px-5 py-4 space-y-3 text-[15px]">
              <div><div className="text-[13px] text-[#667781] dark:text-[#8696a0]">Target destination</div><div>{active.targetCountry || '—'}</div></div>
              <div><div className="text-[13px] text-[#667781] dark:text-[#8696a0]">Pipeline status</div>
                <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[13px] font-semibold border ${stageBadge(stages, active.pipeline).cls}`}>{stageBadge(stages, active.pipeline).label}</span></div>
              {Object.entries(active.answers).map(([k, v]) => (
                <div key={k}><div className="text-[13px] text-[#667781] dark:text-[#8696a0] capitalize">{humanize(k)}</div><div className="break-words">{v}</div></div>
              ))}
            </div>
            <div className="mt-2 bg-white dark:bg-[#111b21] px-5 py-4">
              <label className="text-[13px] text-[#667781] dark:text-[#8696a0] block mb-1.5">Counsellor notes</label>
              <textarea rows={5} value={notes} maxLength={4000} disabled={!active.hasLead} onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg bg-[#f0f2f5] dark:bg-[#202c33] p-3 text-[15px] outline-none placeholder-[#667781] dark:placeholder-[#8696a0] disabled:opacity-60"
                placeholder={active.hasLead ? 'Internal notes…' : 'Available once the questionnaire is complete'} />
              <button onClick={saveNotes} disabled={!active.hasLead} className="mt-2 w-full py-2 rounded-lg bg-[#00a884] hover:bg-[#008f72] text-white text-[14.5px] font-semibold disabled:opacity-40">
                {saved ? '✓ Saved' : 'Save notes'}
              </button>
            </div>
          </div>
        </aside>
      )}
      </>)}
    </div>
  );
}
