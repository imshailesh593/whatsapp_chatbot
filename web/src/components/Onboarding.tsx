import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Globe, Loader2, Send, Sparkles } from 'lucide-react';
import { api } from '../api';
import type { AdminUser, ChatTurn, Draft, TemplateInfo } from '../types';
import WhatsAppLink from './WhatsAppLink';
import Simulator from './Simulator';
import { BrandContext } from '../brand';

const GREETING =
  "Hi! I'll set up your WhatsApp chatbot with you. First, tell me about your business: what do you do, and which industry are you in?";
const STEPS = ['Your business', 'Links', 'WhatsApp', 'Test & go live'];

export default function Onboarding({ user, onDone, onSignOut }: { user: AdminUser; onDone: () => void; onSignOut: () => void }) {
  const [step, setStep] = useState(0);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [useTemplates, setUseTemplates] = useState(false);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [history, setHistory] = useState<ChatTurn[]>([{ role: 'assistant', text: GREETING }]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [links, setLinks] = useState({ bookingUrl: '', formUrl: '', notifyEmail: user.email });
  const [businessName, setBusinessName] = useState(user.workspace?.businessName ?? '');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.onboardingInfo().then((i) => { setAiAvailable(i.aiAvailable); if (!i.aiAvailable) setUseTemplates(true); }).catch(() => { setAiAvailable(false); setUseTemplates(true); });
    api.templates().then(setTemplates).catch(() => undefined);
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [history, busy]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatTurn[] = [...history, { role: 'user', text }];
    setHistory(next);
    setInput('');
    setBusy(true);
    setError('');
    try {
      const res = await api.onboardingChat(next, draft);
      setHistory([...next, { role: 'assistant', text: res.reply }]);
      setDraft(res.draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseTemplate(id: string) {
    setBusy(true);
    setError('');
    try {
      const w = await api.applyTemplate(id);
      setPicked(id);
      setBusinessName(w.businessName);
      setDraft(null);
      setStep(1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveLinks(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (draft) await api.onboardingApply(draft, links);
      else await api.saveWorkspace({ ...links, businessName });
      setStep(2);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish(live: boolean) {
    setBusy(true);
    setError('');
    try {
      if (live) await api.setLive(true);
      await api.onboardingComplete();
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const input$ = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500';
  const brand = { businessName: draft?.businessName || businessName || user.workspace?.businessName || '', tagline: draft?.tagline ?? '' };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="bg-slate-950 border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center"><Globe className="w-5 h-5 text-slate-950" /></div>
            <div>
              <div className="font-extrabold text-white text-sm">Set up your chatbot</div>
              <div className="text-[11px] text-slate-400">{user.workspace?.businessName}</div>
            </div>
          </div>
          <button onClick={onSignOut} className="text-xs text-slate-400 hover:text-white">Sign out</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <ol className="flex flex-wrap gap-2 mb-6">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              i === step ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : i < step ? 'text-slate-300 border-slate-700' : 'text-slate-500 border-slate-800'}`}>
              <span className="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">{i < step ? <Check className="w-3 h-3" /> : i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        {step === 0 && !useTemplates && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-slate-950 border border-slate-800 rounded-2xl flex flex-col h-[70vh] min-h-[420px]">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center space-x-2 text-sm font-bold text-white">
                <Sparkles className="w-4 h-4 text-emerald-400" /><span>Setup assistant</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {history.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-emerald-600/80 text-white' : 'bg-slate-900 border border-slate-800 text-slate-200'}`}>{m.text}</div>
                  </div>
                ))}
                {busy && <div className="flex items-center space-x-2 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Thinking…</span></div>}
                <div ref={bottom} />
              </div>
              {error && <p className="px-4 text-xs text-rose-400" role="alert">{error}</p>}
              <form onSubmit={send} className="p-3 border-t border-slate-800 flex items-center gap-2">
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe your business…" maxLength={1500} className={input$} disabled={aiAvailable === null} autoFocus />
                <button disabled={busy || !input.trim()} className="p-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg disabled:opacity-40"><Send className="w-4 h-4" /></button>
              </form>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 h-[70vh] min-h-[420px] overflow-y-auto">
              {draft ? (
                <DraftView draft={draft} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 text-sm px-6">
                  <Sparkles className="w-8 h-8 mb-3 text-slate-700" />
                  <p>Your menu and questions will appear here as soon as the assistant knows enough about your business.</p>
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2 sticky bottom-0 bg-slate-950 pt-3">
                <button disabled={!draft || busy} onClick={() => setStep(1)}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg disabled:opacity-40">Looks good, continue</button>
                <button onClick={() => setUseTemplates(true)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700">Use a template instead</button>
              </div>
              {draft && <p className="text-[11px] text-slate-500 mt-2">Not quite right? Tell the assistant what to change, for example “add a question about budget”.</p>}
            </div>
          </div>
        )}

        {step === 0 && useTemplates && (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-white font-bold">Pick a starting point</h2>
            <p className="text-xs text-slate-400 mt-1">
              {aiAvailable === false ? 'The AI assistant is not available right now. ' : ''}You can edit every service and question afterwards.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
              {templates.map((t) => (
                <button key={t.id} disabled={busy} onClick={() => chooseTemplate(t.id)}
                  className={`text-left p-4 rounded-xl border bg-slate-900 hover:border-emerald-500/60 transition ${picked === t.id ? 'border-emerald-500' : 'border-slate-800'}`}>
                  <div className="font-semibold text-sm text-white">{t.label}</div>
                  <div className="text-xs text-slate-400 mt-1">{t.description}</div>
                  <div className="text-[11px] text-slate-500 mt-2">{t.services} services</div>
                </button>
              ))}
            </div>
            {aiAvailable && <button onClick={() => setUseTemplates(false)} className="mt-4 text-xs text-emerald-400 hover:text-emerald-300">Back to the assistant</button>}
            {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
          </div>
        )}

        {step === 1 && (
          <form onSubmit={saveLinks} className="bg-slate-950 border border-slate-800 rounded-2xl p-5 max-w-2xl space-y-4">
            <h2 className="text-white font-bold">Links and contact (all optional)</h2>
            {!draft && (
              <div>
                <label className="text-xs text-slate-300 block mb-1">Business name shown to customers</label>
                <input required value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={input$} />
              </div>
            )}
            <div>
              <label className="text-xs text-slate-300 block mb-1">Booking or payment link</label>
              <input value={links.bookingUrl} onChange={(e) => setLinks({ ...links, bookingUrl: e.target.value })} placeholder="https://cal.com/you" className={input$} />
              <p className="text-[11px] text-slate-500 mt-1">Sent to customers when they finish the questions. Leave empty if you do not take bookings.</p>
            </div>
            <div>
              <label className="text-xs text-slate-300 block mb-1">Form to share in the first message</label>
              <input value={links.formUrl} onChange={(e) => setLinks({ ...links, formUrl: e.target.value })} placeholder="https://tally.so/r/…" className={input$} />
            </div>
            <div>
              <label className="text-xs text-slate-300 block mb-1">Email for lead alerts</label>
              <input type="email" value={links.notifyEmail} onChange={(e) => setLinks({ ...links, notifyEmail: e.target.value })} className={input$} />
              <p className="text-[11px] text-slate-500 mt-1">You get an email when a customer finishes the questions (if email sending is set up on this server). Add a WhatsApp number later in Settings.</p>
            </div>
            {error && <p className="text-xs text-rose-400" role="alert">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(0)} className="px-4 py-2 bg-slate-800 text-slate-200 text-xs rounded-lg border border-slate-700">Back</button>
              <button disabled={busy} className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg disabled:opacity-50">{busy ? 'Saving…' : 'Save & continue'}</button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="max-w-2xl space-y-4">
            <WhatsAppLink />
            <p className="text-xs text-slate-400">Use the phone number your customers already message. It stays your own WhatsApp account, linked like WhatsApp Web, and every reply, broadcast and alert goes out from it. WhatsApp can restrict numbers that send unwanted messages, so keep your messages relevant. You can do this later from Settings.</p>
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="px-4 py-2 bg-slate-800 text-slate-200 text-xs rounded-lg border border-slate-700">Back</button>
              <button onClick={() => setStep(3)} className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg">Continue</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <BrandContext.Provider value={brand}>
            <div className="space-y-4">
              <p className="text-sm text-slate-300">Chat with your bot below exactly like a customer would. Nothing is sent to WhatsApp from this screen.</p>
              <Simulator onActivity={() => undefined} services={(draft?.services ?? []).map((s, i) => ({ id: String(i), title: s.title }))} />
              {error && <p className="text-xs text-rose-400" role="alert">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setStep(2)} className="px-4 py-2 bg-slate-800 text-slate-200 text-xs rounded-lg border border-slate-700">Back</button>
                <button disabled={busy} onClick={() => finish(true)} className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg disabled:opacity-50">Go live</button>
                <button disabled={busy} onClick={() => finish(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700 disabled:opacity-50">Finish, keep the bot paused for now</button>
              </div>
              <p className="text-[11px] text-slate-500">The bot only replies to customers after you go live. You can switch it on or off any time in Settings.</p>
            </div>
          </BrandContext.Provider>
        )}
      </div>
    </div>
  );
}

function DraftView({ draft }: { draft: Draft }) {
  return (
    <div>
      <h3 className="text-white font-bold">{draft.businessName || 'Your business'}</h3>
      {draft.tagline && <p className="text-xs text-emerald-400">{draft.tagline}</p>}
      {draft.description && <p className="text-xs text-slate-400 mt-1">{draft.description}</p>}
      <div className="mt-4 space-y-3">
        {draft.services.map((s, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <div className="text-sm font-semibold text-white">{i + 1}. {s.title}</div>
            <ol className="mt-2 space-y-1 list-decimal list-inside text-xs text-slate-300">
              {s.questions.map((q, j) => <li key={j}>{q.prompt}</li>)}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
