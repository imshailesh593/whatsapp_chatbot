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
    return <div className="bg-slate-950 border border-slate-800 rounded-2xl p-10 text-center text-slate-500 text-sm">No conversations yet.</div>;
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
    <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl h-[700px] flex flex-col md:flex-row">
      {/* conversations */}
      <div className="w-full md:w-80 max-h-48 md:max-h-none border-r border-slate-800 bg-slate-900/60 flex flex-col">
        <div className="p-3.5 border-b border-slate-800">
          <h3 className="font-bold text-sm text-white">Conversations</h3>
          <p className="text-[11px] text-slate-400">Select a contact to monitor or take over</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {list.map((c) => (
            <div key={c.phone} onClick={() => setActivePhone(c.phone)}
              className={`p-3 cursor-pointer transition flex items-start justify-between ${c.phone === active.phone ? 'bg-slate-800/80 border-l-4 border-emerald-400' : 'hover:bg-slate-900'}`}>
              <div className="min-w-0">
                <div className="font-semibold text-xs text-white truncate">{c.name || 'Unknown'}</div>
                <div className="text-[11px] text-slate-400">{displayPhone(c.phone)}</div>
                <div className="text-[10px] text-slate-500 mt-1 truncate">
                  {c.service ? c.serviceTitle : 'Choosing service'}{c.targetCountry ? ` • ${c.targetCountry}` : ''}
                </div>
              </div>
              <div className="text-right shrink-0 ml-2">
                <span className={`inline-block w-2 h-2 rounded-full ${c.botActive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <div className="text-[9px] text-slate-400 mt-1">{ago(c.lastActivity)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* thread */}
      <div className="flex-1 min-w-0 flex flex-col bg-slate-950">
        <div className="p-3.5 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center font-bold text-xs text-emerald-400 border border-slate-700 shrink-0">
              {(active.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                {active.name || 'Unknown'} <span className="text-[10px] text-slate-400 font-normal">({displayPhone(active.phone)})</span>
              </h4>
              <p className="text-[10px] text-slate-400">{svc ? `${svc.icon} ${svc.shortTitle}` : 'Choosing service'}</p>
            </div>
          </div>
          <button onClick={toggleBot}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition shadow-sm ${
              active.botActive ? 'bg-emerald-950/60 text-emerald-300 border-emerald-600/60 hover:bg-emerald-900/60' : 'bg-rose-950/60 text-rose-300 border-rose-600/60 hover:bg-rose-900/60'}`}>
            {active.botActive ? <Zap className="w-3.5 h-3.5 text-emerald-400" /> : <UserCheck className="w-3.5 h-3.5 text-rose-400" />}
            <span>{active.botActive ? 'Bot automated' : 'Human takeover active'}</span>
          </button>
        </div>

        <div ref={scroller} className="flex-1 p-4 overflow-y-auto space-y-2.5 bg-[#090d14] text-xs">
          {messages.length === 0 && <p className="text-center text-slate-500 mt-6">No messages recorded for this contact yet.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'INBOUND' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 whitespace-pre-wrap break-words border ${
                m.direction === 'INBOUND' ? 'bg-slate-900 text-slate-200 border-slate-800' : 'bg-[#005c4b] text-emerald-50 border-emerald-900/50'}`}>
                {m.text}
                <div className="text-[9px] text-slate-400 mt-1 text-right">
                  {m.direction === 'INBOUND' ? 'Customer' : brand.businessName} · {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {!active.botActive && (
            <div className="text-center my-2">
              <span className="bg-rose-950/60 text-rose-300 border border-rose-800/60 px-3 py-1 rounded-full text-[10px] font-semibold">
                ⚠️ Human takeover: bot replies are paused for this number.
              </span>
            </div>
          )}
        </div>

        <div className="px-3 py-2 bg-slate-900/70 border-t border-slate-800 flex items-center space-x-2 overflow-x-auto text-[11px]">
          <span className="text-slate-400 font-medium whitespace-nowrap">Canned:</span>
          {CANNED.map((c, i) => (
            <button key={i} onClick={() => setReply(c)} disabled={!canReply}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg whitespace-nowrap border border-slate-700 transition disabled:opacity-40">
              {c.slice(0, 30)}…
            </button>
          ))}
        </div>

        <div className="p-3 bg-slate-900 border-t border-slate-800">
          {error && <p className="text-[11px] text-rose-400 mb-2">{error}</p>}
          <div className="flex items-center space-x-2">
            <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && canReply && sendReply()}
              disabled={!canReply}
              placeholder={!waReady ? 'WhatsApp is not connected' : active.botActive ? 'Take over (button above) to type a manual message…' : 'Type a reply to send via WhatsApp…'}
              className="flex-1 bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500 disabled:opacity-50" />
            <button onClick={sendReply} disabled={!canReply || !reply.trim() || sending}
              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition disabled:opacity-50 flex items-center space-x-1.5">
              <span>{sending ? 'Sending…' : 'Send'}</span><Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-slate-500 mt-1.5">Messages you type directly on the linked phone are not recorded here.</p>
        </div>
      </div>

      {/* dossier column */}
      <div className="hidden lg:flex w-72 border-l border-slate-800 bg-slate-900/40 p-4 flex-col justify-between overflow-y-auto">
        <div className="space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Contact quick dossier</h4>
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs space-y-2">
            <div><span className="text-slate-500 text-[10px] block">Target destination</span><span className="font-semibold text-slate-200">{active.targetCountry || '—'}</span></div>
            <div>
              <span className="text-slate-500 text-[10px] block">Pipeline status</span>
              <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${stageBadge(stages, active.pipeline).cls}`}>{stageBadge(stages, active.pipeline).label}</span>
            </div>
            {Object.entries(active.answers).map(([k, v]) => (
              <div key={k}><span className="text-slate-500 text-[10px] block capitalize">{humanize(k)}</span><span className="text-slate-300 break-words">{v}</span></div>
            ))}
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">Counsellor notes</label>
            <textarea rows={5} value={notes} maxLength={4000} disabled={!active.hasLead} onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              placeholder={active.hasLead ? 'Internal notes…' : 'Available once the questionnaire is complete'} />
            <button onClick={saveNotes} disabled={!active.hasLead}
              className="mt-2 w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition disabled:opacity-40">
              {saved ? '✓ Saved' : 'Save notes'}
            </button>
          </div>
        </div>
        <div className="pt-4 border-t border-slate-800 space-y-2">
          <a href={waLink(active.phone)} target="_blank" rel="noreferrer"
            className="w-full flex items-center justify-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold py-2 rounded-xl text-xs transition">
            <Phone className="w-3.5 h-3.5" /><span>Open in WhatsApp</span><ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
