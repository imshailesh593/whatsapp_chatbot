import { FormEvent, useEffect, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { api } from '../api';
import type { Workspace } from '../types';

type Fields = Pick<
  Workspace,
  'timezone' | 'businessName' | 'tagline' | 'description' | 'welcomeIntro' | 'tone' | 'languages' | 'bookingLabel' | 'bookingUrl' | 'bookingNote' | 'formUrl' | 'knowledge' | 'notifyEmail' | 'notifyPhone'
>;

const pick = (w: Workspace): Fields => ({
  timezone: w.timezone, businessName: w.businessName, tagline: w.tagline, description: w.description, welcomeIntro: w.welcomeIntro, tone: w.tone,
  languages: w.languages, bookingLabel: w.bookingLabel, bookingUrl: w.bookingUrl, bookingNote: w.bookingNote, formUrl: w.formUrl,
  knowledge: w.knowledge, notifyEmail: w.notifyEmail, notifyPhone: w.notifyPhone
});

export default function BusinessProfile({ workspace, onSaved }: { workspace: Workspace; onSaved: () => void }) {
  const [f, setF] = useState<Fields>(() => pick(workspace));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [alertInfo, setAlertInfo] = useState<{ emailAvailable: boolean; whatsappReady: boolean } | null>(null);
  const [testResult, setTestResult] = useState<{ whatsapp: string; email: string } | null>(null);
  useEffect(() => { api.alertInfo().then(setAlertInfo).catch(() => undefined); }, []);

  async function testAlert() {
    setBusy(true);
    setError('');
    setTestResult(null);
    try {
      await api.saveWorkspace(f);
      setTestResult(await api.testAlert());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof Fields) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      await api.saveWorkspace(f);
      setNote('Saved.');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLive() {
    const next = !workspace.botEnabled;
    if (next && !window.confirm('Switch the bot on? It will start replying to everyone who messages your linked WhatsApp number.')) return;
    setError('');
    try {
      await api.setLive(next);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const input = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500';
  const label = 'text-[11px] font-medium text-slate-400 block mb-1';

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-white text-base">Business &amp; bot</h3>
          <p className="text-xs text-slate-400 mt-1">What customers see in the greeting and sign-off, and what the AI knows about you.</p>
        </div>
        <button type="button" onClick={toggleLive}
          className={`flex items-center space-x-1.5 px-4 py-2 font-bold text-xs rounded-lg border transition ${
            workspace.botEnabled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25' : 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'}`}>
          {workspace.botEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{workspace.botEnabled ? 'Bot is live · pause' : 'Bot is paused · go live'}</span>
        </button>
      </div>

      <form onSubmit={save} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className={label}>Business name</label><input required value={f.businessName} maxLength={80} onChange={set('businessName')} className={input} /></div>
        <div><label className={label}>Tagline (sign-off line)</label><input value={f.tagline} maxLength={120} onChange={set('tagline')} className={input} placeholder="Optional" /></div>
        <div className="sm:col-span-2"><label className={label}>What your business does (briefs the AI)</label><textarea rows={2} value={f.description} maxLength={500} onChange={set('description')} className={input} /></div>
        <div className="sm:col-span-2"><label className={label}>Greeting line shown under &ldquo;Welcome to …&rdquo;</label><input value={f.welcomeIntro} maxLength={300} onChange={set('welcomeIntro')} className={input} /></div>
        <div><label className={label}>Tone</label>
          <select value={f.tone} onChange={set('tone')} className={input}>
            {[...new Set(['friendly', 'professional', 'formal', 'casual', f.tone])].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div><label className={label}>Time zone (broadcasts go out 9:00-20:00 here)</label><input value={f.timezone} maxLength={60} onChange={set('timezone')} className={input} placeholder="Asia/Kolkata" /></div>
        <div><label className={label}>Languages customers use</label><input value={f.languages} maxLength={80} onChange={set('languages')} className={input} /></div>
        <div><label className={label}>Booking / payment link</label><input value={f.bookingUrl} maxLength={300} onChange={set('bookingUrl')} className={input} placeholder="https://cal.com/you" /></div>
        <div><label className={label}>What it is called (&ldquo;schedule a ___&rdquo;)</label><input value={f.bookingLabel} maxLength={80} onChange={set('bookingLabel')} className={input} placeholder="consultation" /></div>
        <div className="sm:col-span-2"><label className={label}>Note shown with the booking link (optional)</label><input value={f.bookingNote} maxLength={200} onChange={set('bookingNote')} className={input} placeholder="e.g. Fees are adjusted in the process." /></div>
        <div className="sm:col-span-2"><label className={label}>Form to share in the greeting (optional)</label><input value={f.formUrl} maxLength={300} onChange={set('formUrl')} className={input} placeholder="https://tally.so/r/…" /></div>
        <div className="sm:col-span-2">
          <label className={label}>Facts the AI may use when customers ask questions (prices, hours, policies, FAQs)</label>
          <textarea rows={6} value={f.knowledge} maxLength={8000} onChange={set('knowledge')} className={input} placeholder="Opening hours: Mon–Sat 9–6&#10;Consultation costs ₹500…&#10;The AI will not invent anything that is not written here." />
        </div>
        <div className="sm:col-span-2 border-t border-slate-800 pt-4">
          <h4 className="text-sm font-bold text-white">Lead alerts</h4>
          <p className="text-[11px] text-slate-500 mt-1">Get a message the moment a customer finishes the questions, or says they have booked.</p>
        </div>
        <div>
          <label className={label}>Email</label>
          <input type="email" value={f.notifyEmail} onChange={set('notifyEmail')} className={input} placeholder="you@example.com" />
          {alertInfo && !alertInfo.emailAvailable && <p className="text-[11px] text-amber-400 mt-1">Email sending is not set up on this server yet.</p>}
        </div>
        <div>
          <label className={label}>WhatsApp number (with country code)</label>
          <input value={f.notifyPhone} onChange={set('notifyPhone')} className={input} placeholder="919876543210" />
          {alertInfo && !alertInfo.whatsappReady && <p className="text-[11px] text-amber-400 mt-1">Connect WhatsApp first: alerts are sent from your linked number.</p>}
        </div>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={testAlert} disabled={busy || (!f.notifyEmail && !f.notifyPhone)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 disabled:opacity-40">Save &amp; send a test alert</button>
          {testResult && (
            <span className="text-[11px] text-slate-300">
              WhatsApp: <strong className={testResult.whatsapp === 'sent' ? 'text-emerald-400' : 'text-amber-300'}>{testResult.whatsapp}</strong>
              {' · '}Email: <strong className={testResult.email === 'sent' ? 'text-emerald-400' : 'text-amber-300'}>{testResult.email}</strong>
            </span>
          )}
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button disabled={busy} className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          {note && <span className="text-xs text-emerald-400">{note}</span>}
          {error && <span className="text-xs text-rose-400" role="alert">{error}</span>}
        </div>
      </form>
    </div>
  );
}
