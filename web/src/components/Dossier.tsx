import { useState } from 'react';
import { Calendar, Phone, UserCheck, Zap } from 'lucide-react';
import { api } from '../api';
import type { Contact } from '../types';
import { useStages } from '../stages';
import { serviceStyle, humanize, displayPhone, waLink } from '../config';

interface Props {
  contact: Contact;
  bookingUrl: string;
  onClose: () => void;
  onChanged: (c: Contact) => void;
}

export default function Dossier({ contact, bookingUrl, onClose, onChanged }: Props) {
  const [notes, setNotes] = useState(contact.notes ?? '');
  const stages = useStages();
  const [status, setStatus] = useState<string>(contact.pipeline ?? 'new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const svc = contact.service ? serviceStyle(contact.service, contact.serviceTitle) : null;

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (contact.hasLead) onChanged(await api.patch(contact.phone, { notes, stage: status }));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleBot() {
    try {
      onChanged(await api.patch(contact.phone, { paused: contact.botActive }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h3 className="text-base font-bold text-white">{contact.name || 'Unknown'}</h3>
              {svc && <span className={`text-[10px] px-2 py-0.5 rounded font-semibold border ${svc.badge}`}>{svc.icon} {svc.shortTitle}</span>}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {displayPhone(contact.phone)}
              {contact.targetCountry && ` • Target: ${contact.targetCountry}`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition">✕</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1">Lead Stage</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={!contact.hasLead}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
              >
                {!contact.hasLead && <option value="new">⏳ Still answering the questionnaire</option>}
                {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1">Automation</label>
              <button
                type="button"
                onClick={toggleBot}
                disabled={contact.isTest}
                className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center space-x-1.5 border transition disabled:opacity-50 ${
                  contact.botActive ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60' : 'bg-rose-950 text-rose-300 border-rose-700/60'
                }`}
              >
                {contact.botActive ? <Zap className="w-3.5 h-3.5 text-emerald-400" /> : <UserCheck className="w-3.5 h-3.5 text-rose-400" />}
                <span>{contact.botActive ? 'Bot answering (click to take over)' : 'Human mode (click to resume bot)'}</span>
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Collected Answers</h4>
            <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 divide-y divide-slate-800/80">
              {Object.entries(contact.answers).length === 0 && <p className="text-slate-500">No answers yet.</p>}
              {Object.entries(contact.answers).map(([key, val]) => (
                <div key={key} className="py-2 first:pt-0 last:pb-0">
                  <span className="text-[10px] text-slate-500 uppercase font-semibold block">{humanize(key)}</span>
                  <span className="text-xs text-slate-200 font-medium mt-0.5 block whitespace-pre-wrap break-words">{val}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Internal Counsellor Notes</label>
            <textarea
              rows={4}
              value={notes}
              maxLength={4000}
              disabled={!contact.hasLead}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              placeholder={contact.hasLead ? 'Verification notes, call outcomes, meeting notes…' : 'Notes unlock once the questionnaire is complete.'}
            />
          </div>
          {error && <p className="text-rose-400">{error}</p>}
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-2">
            {!contact.isTest && (
              <a href={waLink(contact.phone)} target="_blank" rel="noreferrer"
                className="px-3 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition">
                <Phone className="w-3.5 h-3.5" /><span>WhatsApp Chat</span>
              </a>
            )}
            {bookingUrl && <a href={bookingUrl} target="_blank" rel="noreferrer"
              className="px-3 py-2 bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border border-purple-500/40 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition">
              <Calendar className="w-3.5 h-3.5" /><span>Booking link</span>
            </a>}
          </div>
          <div className="flex items-center space-x-2">
            <button onClick={onClose} className="px-3.5 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition">Cancel</button>
            <button onClick={save} disabled={busy}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow disabled:opacity-60">
              {busy ? 'Saving…' : 'Save & Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
