import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Phone, Send, UserCheck, Zap } from 'lucide-react';
import { api } from '../api';
import type { ChatMessage, Contact } from '../types';
import { serviceStyle, stageBadge, ago, displayPhone, humanize, waLink } from '../config';

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
}

import { useBrand } from '../brand';
import { useStages } from '../stages';
export default function Inbox({ contacts, waReady, onChanged }: Props) {
  const brand = useBrand();
  const stages = useStages();
  const list = useMemo(() => contacts.filter((c) => !c.isTest), [contacts]);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const active = list.find((c) => c.phone === activePhone) ?? list[0] ?? null;
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

  if (!active) {
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

  const canReply = !active.botActive && waReady;
  const svc = active.service ? serviceStyle(active.service, active.serviceTitle) : null;

  return (
    <div className="bg-card border border-line rounded-2xl overflow-hidden shadow-2xl h-[700px] flex flex-col md:flex-row">
      {/* conversations */}
      <div className="w-full md:w-80 max-h-48 md:max-h-none border-r border-line bg-sunken/60 flex flex-col">
        <div className="p-3.5 border-b border-line">
          <h3 className="font-bold text-sm text-fg">Conversations</h3>
          <p className="text-[11px] text-muted">Select a contact to monitor or take over</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-line/60">
          {list.map((c) => (
            <div key={c.phone} onClick={() => setActivePhone(c.phone)}
              className={`p-3 cursor-pointer transition flex items-start justify-between ${c.phone === active.phone ? 'bg-subtle/80 border-l-4 border-brand/40' : 'hover:bg-sunken'}`}>
              <div className="min-w-0">
                <div className="font-semibold text-xs text-fg truncate">{c.name || 'Unknown'}</div>
                <div className="text-[11px] text-muted">{displayPhone(c.phone)}</div>
                <div className="text-[10px] text-muted mt-1 truncate">
                  {c.service ? c.serviceTitle : 'Choosing service'}{c.targetCountry ? ` • ${c.targetCountry}` : ''}
                </div>
              </div>
              <div className="text-right shrink-0 ml-2">
                <span className={`inline-block w-2 h-2 rounded-full ${c.botActive ? 'bg-brand' : 'bg-danger'}`} />
                <div className="text-[9px] text-muted mt-1">{ago(c.lastActivity)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* thread */}
      <div className="flex-1 min-w-0 flex flex-col bg-card">
        <div className="p-3.5 border-b border-line bg-sunken/40 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-subtle flex items-center justify-center font-bold text-xs text-brand-text border border-line shrink-0">
              {(active.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h4 className="text-xs sm:text-sm font-bold text-fg truncate">
                {active.name || 'Unknown'} <span className="text-[10px] text-muted font-normal">({displayPhone(active.phone)})</span>
              </h4>
              <p className="text-[10px] text-muted">{svc ? `${svc.icon} ${svc.shortTitle}` : 'Choosing service'}</p>
            </div>
          </div>
          <button onClick={toggleBot}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition shadow-sm ${
              active.botActive ? 'bg-brand-soft text-brand-text border-brand/60 hover:bg-brand-soft' : 'bg-danger-soft text-danger border-danger-line/60 hover:bg-danger-soft'}`}>
            {active.botActive ? <Zap className="w-3.5 h-3.5 text-brand-text" /> : <UserCheck className="w-3.5 h-3.5 text-danger" />}
            <span>{active.botActive ? 'Bot automated' : 'Human takeover active'}</span>
          </button>
        </div>

        <div ref={scroller} className="flex-1 p-4 overflow-y-auto space-y-2.5 bg-[#090d14] text-xs">
          {messages.length === 0 && <p className="text-center text-muted mt-6">No messages recorded for this contact yet.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'INBOUND' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 whitespace-pre-wrap break-words border ${
                m.direction === 'INBOUND' ? 'bg-sunken text-fg border-line' : 'bg-[#005c4b] text-on-brand border-brand/50'}`}>
                {m.text}
                <div className="text-[9px] text-muted mt-1 text-right">
                  {m.direction === 'INBOUND' ? 'Customer' : brand.businessName} · {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {!active.botActive && (
            <div className="text-center my-2">
              <span className="bg-danger-soft text-danger border border-danger-line/60 px-3 py-1 rounded-full text-[10px] font-semibold">
                ⚠️ {active.handoffAt ? 'The customer asked for a person: ' : 'Human takeover: '}bot replies are paused for this number.
              </span>
              {active.handoffSummary && <p className="mt-2 mx-auto max-w-md text-[11px] text-fg2 bg-sunken border border-line rounded-lg p-2.5 text-left whitespace-pre-line"><strong className="text-fg">Briefing:</strong> {active.handoffSummary}</p>}
            </div>
          )}
        </div>

        <div className="px-3 py-2 bg-sunken/70 border-t border-line flex items-center space-x-2 overflow-x-auto text-[11px]">
          <span className="text-muted font-medium whitespace-nowrap">Canned:</span>
          {CANNED.map((c, i) => (
            <button key={i} onClick={() => setReply(c)} disabled={!canReply}
              className="bg-subtle hover:bg-subtle text-fg2 px-2.5 py-1 rounded-lg whitespace-nowrap border border-line transition disabled:opacity-40">
              {c.slice(0, 30)}…
            </button>
          ))}
        </div>

        <div className="p-3 bg-sunken border-t border-line">
          {error && <p className="text-[11px] text-danger mb-2">{error}</p>}
          <div className="flex items-center space-x-2">
            <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && canReply && sendReply()}
              disabled={!canReply}
              placeholder={!waReady ? 'WhatsApp is not connected' : active.botActive ? 'Take over (button above) to type a manual message…' : 'Type a reply to send via WhatsApp…'}
              className="flex-1 bg-card border border-line text-xs text-fg placeholder-muted rounded-lg px-3 py-2.5 focus:outline-none focus:border-brand/40 disabled:opacity-50" />
            <button onClick={sendReply} disabled={!canReply || !reply.trim() || sending}
              className="px-4 py-2.5 bg-brand hover:bg-brand text-on-brand font-bold text-xs rounded-lg transition disabled:opacity-50 flex items-center space-x-1.5">
              <span>{sending ? 'Sending…' : 'Send'}</span><Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-muted mt-1.5">Messages you type directly on the linked phone are not recorded here.</p>
        </div>
      </div>

      {/* dossier column */}
      <div className="hidden lg:flex w-72 border-l border-line bg-sunken/40 p-4 flex-col justify-between overflow-y-auto">
        <div className="space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted">Contact quick dossier</h4>
          <div className="bg-card p-3 rounded-xl border border-line text-xs space-y-2">
            <div><span className="text-muted text-[10px] block">Target destination</span><span className="font-semibold text-fg">{active.targetCountry || '—'}</span></div>
            <div>
              <span className="text-muted text-[10px] block">Pipeline status</span>
              <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${stageBadge(stages, active.pipeline).cls}`}>{stageBadge(stages, active.pipeline).label}</span>
            </div>
            {Object.entries(active.answers).map(([k, v]) => (
              <div key={k}><span className="text-muted text-[10px] block capitalize">{humanize(k)}</span><span className="text-fg2 break-words">{v}</span></div>
            ))}
          </div>
          <div>
            <label className="text-xs font-semibold text-fg2 block mb-1">Counsellor notes</label>
            <textarea rows={5} value={notes} maxLength={4000} disabled={!active.hasLead} onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-card border border-line rounded-xl p-2.5 text-xs text-fg focus:outline-none focus:border-brand/40 disabled:opacity-50"
              placeholder={active.hasLead ? 'Internal notes…' : 'Available once the questionnaire is complete'} />
            <button onClick={saveNotes} disabled={!active.hasLead}
              className="mt-2 w-full py-1.5 rounded-lg bg-subtle hover:bg-subtle border border-line text-xs font-semibold text-fg transition disabled:opacity-40">
              {saved ? '✓ Saved' : 'Save notes'}
            </button>
          </div>
        </div>
        <div className="pt-4 border-t border-line space-y-2">
          <a href={waLink(active.phone)} target="_blank" rel="noreferrer"
            className="w-full flex items-center justify-center space-x-2 bg-brand hover:bg-brand text-on-brand font-bold py-2 rounded-xl text-xs transition">
            <Phone className="w-3.5 h-3.5" /><span>Open in WhatsApp</span><ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
