import { FormEvent, useEffect, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { api } from '../api';
import { Sparkles } from 'lucide-react';
import type { Workspace } from '../types';

type Fields = Pick<
  Workspace,
  'timezone' | 'businessName' | 'tagline' | 'description' | 'welcomeIntro' | 'tone' | 'languages' | 'bookingLabel' | 'bookingUrl' | 'bookingNote' | 'formUrl' | 'knowledge' | 'aiInstructions' | 'notifyEmail' | 'notifyPhone' | 'handoffEnabled' | 'handoffMessage' | 'languageStep' | 'languageWelcome' | 'followUpsEnabled'
>;

const pick = (w: Workspace): Fields => ({
  timezone: w.timezone, businessName: w.businessName, tagline: w.tagline, description: w.description, welcomeIntro: w.welcomeIntro, tone: w.tone,
  languages: w.languages, bookingLabel: w.bookingLabel, bookingUrl: w.bookingUrl, bookingNote: w.bookingNote, formUrl: w.formUrl,
  knowledge: w.knowledge, aiInstructions: w.aiInstructions ?? '', notifyEmail: w.notifyEmail, notifyPhone: w.notifyPhone, handoffEnabled: w.handoffEnabled, handoffMessage: w.handoffMessage, languageStep: w.languageStep, languageWelcome: w.languageWelcome, followUpsEnabled: w.followUpsEnabled
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

  // The Gemini prompter: describe the change in plain words, review the proposal, then apply it to the box and save
  const [ask, setAsk] = useState('');
  const [proposal, setProposal] = useState<{ instructions: string; summary: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  async function suggest() {
    setAsking(true);
    setAskError('');
    setProposal(null);
    try {
      setProposal(await api.suggestInstructions(ask, f.aiInstructions));
    } catch (err) {
      setAskError((err as Error).message);
    } finally {
      setAsking(false);
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

  const input = 'w-full bg-sunken border border-line rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-brand/40';
  const label = 'text-[11px] font-medium text-muted block mb-1';

  return (
    <div className="bg-card border border-line rounded-2xl p-5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-fg text-base">Business &amp; bot</h3>
          <p className="text-xs text-muted mt-1">What customers see in the greeting and sign-off, and what the AI knows about you.</p>
        </div>
        <button type="button" onClick={toggleLive}
          className={`flex items-center space-x-1.5 px-4 py-2 font-bold text-xs rounded-lg border transition ${
            workspace.botEnabled ? 'bg-brand-soft text-brand-text border-brand/40 hover:bg-brand-soft' : 'bg-warn-soft text-warn border-warn-line/40 hover:bg-warn-soft'}`}>
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
        <div className="sm:col-span-2 border-t border-line pt-4">
          <h4 className="text-sm font-bold text-fg flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-brand-text" />How the bot answers questions</h4>
          <p className="text-[11px] text-muted mt-1">Rules for the style of free answers: length, tone, what to ask back, when to bring in a person. Facts (prices, hours, links) belong in the box above. Describe a change and Gemini rewrites the rules for you to review.</p>
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Answering instructions</label>
          <textarea rows={5} value={f.aiInstructions} maxLength={4000} onChange={set('aiInstructions')} className={input}
            placeholder={'- Keep answers under four short lines\n- Always end by asking which service they are interested in\n- If the customer sounds upset, offer to connect them with a person'} />
        </div>
        <div className="sm:col-span-2 bg-sunken border border-line rounded-xl p-3">
          <label className={label}>Ask Gemini to change how the bot answers</label>
          <div className="flex gap-2">
            <input value={ask} maxLength={1000} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (ask.trim().length > 2 && !asking) suggest(); } }}
              className={input} placeholder="e.g. Make answers shorter and friendlier, and always ask for the customer's city" />
            <button type="button" onClick={suggest} disabled={asking || ask.trim().length < 3} className="px-4 py-2 bg-subtle hover:bg-subtle text-brand-text text-xs font-semibold rounded-lg border border-line disabled:opacity-40 whitespace-nowrap">{asking ? 'Thinking…' : 'Suggest change'}</button>
          </div>
          {askError && <p className="text-[11px] text-danger mt-2" role="alert">{askError}</p>}
          {proposal && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] text-brand-text">{proposal.summary}</p>
              <textarea readOnly rows={Math.min(10, proposal.instructions.split('\n').length + 1)} value={proposal.instructions} className={input + ' bg-card'} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => { setF((x) => ({ ...x, aiInstructions: proposal.instructions })); setProposal(null); setAsk(''); setNote('Instructions updated below: press Save to keep them, then try them in the Bot Simulator.'); }}
                  className="px-4 py-2 bg-brand hover:bg-brand text-on-brand font-bold text-xs rounded-lg">Use these instructions</button>
                <button type="button" onClick={() => setProposal(null)} className="px-3.5 py-2 bg-subtle hover:bg-subtle text-fg text-xs rounded-lg border border-line">Discard</button>
                <span className="text-[11px] text-muted">Nothing changes until you press Save.</span>
              </div>
            </div>
          )}
        </div>
        <div className="sm:col-span-2 border-t border-line pt-4">
          <h4 className="text-sm font-bold text-fg">Lead alerts</h4>
          <p className="text-[11px] text-muted mt-1">Get a message the moment a customer finishes the questions, or says they have booked.</p>
        </div>
        <div>
          <label className={label}>Email</label>
          <input type="email" value={f.notifyEmail} onChange={set('notifyEmail')} className={input} placeholder="you@example.com" />
          {alertInfo && !alertInfo.emailAvailable && <p className="text-[11px] text-warn mt-1">Email sending is not set up on this server yet.</p>}
        </div>
        <div>
          <label className={label}>WhatsApp number (with country code)</label>
          <input value={f.notifyPhone} onChange={set('notifyPhone')} className={input} placeholder="919876543210" />
          {alertInfo && !alertInfo.whatsappReady && <p className="text-[11px] text-warn mt-1">Connect WhatsApp first: alerts are sent from your linked number.</p>}
        </div>
        <div className="sm:col-span-2 border-t border-line pt-4">
          <h4 className="text-sm font-bold text-fg">Talk to a person</h4>
          <p className="text-[11px] text-muted mt-1">When a customer asks for a human, the bot stops replying in that chat, you get a short AI briefing on WhatsApp or email, and the chat shows as &ldquo;Needs a person&rdquo;. Switch the bot back on for that chat when you are done.</p>
        </div>
        <label className="sm:col-span-2 flex items-center gap-2 text-xs text-fg2">
          <input type="checkbox" checked={f.handoffEnabled} onChange={(e) => setF((x) => ({ ...x, handoffEnabled: e.target.checked }))} />
          <span>Let customers ask for a person</span>
        </label>
        {f.handoffEnabled && (
          <div className="sm:col-span-2"><label className={label}>What the customer is told (optional)</label><input value={f.handoffMessage} maxLength={300} onChange={set('handoffMessage')} className={input} placeholder="Of course. I have asked our team to take over, and a person will reply here shortly." /></div>
        )}
        <div className="sm:col-span-2 border-t border-line pt-4">
          <h4 className="text-sm font-bold text-fg">Language and follow-ups</h4>
          <p className="text-[11px] text-muted mt-1">Ask which language the customer prefers before showing the menu, and nudge people who go quiet.</p>
        </div>
        <label className="sm:col-span-2 flex items-center gap-2 text-xs text-fg2">
          <input type="checkbox" checked={f.languageStep} onChange={(e) => setF((x) => ({ ...x, languageStep: e.target.checked }))} />
          <span>Ask the customer's preferred language first. The menu, questions and replies are then translated by AI (this uses your monthly AI answers)</span>
        </label>
        {f.languageStep && (
          <div className="sm:col-span-2"><label className={label}>First message (asks for the language; empty uses the standard one)</label><textarea value={f.languageWelcome} rows={3} maxLength={500} onChange={set('languageWelcome')} className={`${input} resize-y`} placeholder="Hello! Welcome... Which language would you prefer for our conversation?" /></div>
        )}
        <label className="sm:col-span-2 flex items-center gap-2 text-xs text-fg2">
          <input type="checkbox" checked={f.followUpsEnabled} onChange={(e) => setF((x) => ({ ...x, followUpsEnabled: e.target.checked }))} />
          <span>Follow up automatically one day and three days after a customer's last message, in daytime hours only, until they reply, are sent the consultation link (then none for a week), book, say STOP, or the lead is Won or Lost</span>
        </label>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={testAlert} disabled={busy || (!f.notifyEmail && !f.notifyPhone)} className="px-4 py-2 bg-subtle hover:bg-subtle text-fg text-xs rounded-lg border border-line disabled:opacity-40">Save &amp; send a test alert</button>
          {testResult && (
            <span className="text-[11px] text-fg2">
              WhatsApp: <strong className={testResult.whatsapp === 'sent' ? 'text-brand-text' : 'text-warn'}>{testResult.whatsapp}</strong>
              {' · '}Email: <strong className={testResult.email === 'sent' ? 'text-brand-text' : 'text-warn'}>{testResult.email}</strong>
            </span>
          )}
        </div>
        <div className="sm:col-span-2 flex items-center gap-3 sticky bottom-3 z-20 bg-sunken/95 backdrop-blur border border-line rounded-xl px-4 py-3">
          <button disabled={busy} className="px-5 py-2 bg-brand hover:bg-brand text-on-brand font-bold text-xs rounded-lg transition disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          {note && <span className="text-xs text-brand-text">{note}</span>}
          {error && <span className="text-xs text-danger" role="alert">{error}</span>}
        </div>
      </form>
    </div>
  );
}
