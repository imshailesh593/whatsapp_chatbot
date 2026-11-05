import { FormEvent, useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import type { ChatTurn, Draft, Overview, ServiceDef } from '../types';

const GREETING_NEW = "Hi! Tell me about your business: what do you do, and what can customers choose from? I'll design the menu and the questions the bot asks.";
const GREETING_EDIT = 'I can see your current menu on the right. Tell me what to change, for example "add a question about budget" or "make it more formal". Or press "Start from scratch" and describe your business.';

/** The business profile and current menu as a draft, so Gemini edits what exists instead of starting over. */
const seed = (o: Overview): Draft => ({
  industry: o.workspace.industry || 'generic',
  businessName: o.workspace.businessName,
  tagline: o.workspace.tagline,
  description: o.workspace.description,
  welcomeIntro: o.workspace.welcomeIntro,
  tone: o.workspace.tone,
  languages: o.workspace.languages,
  bookingLabel: o.workspace.bookingLabel,
  bookingNote: o.workspace.bookingNote,
  knowledge: o.workspace.knowledge,
  services: o.services.map((s) => ({ key: s.id, title: s.title, keywords: s.keywords, closingMessage: '', questions: s.questions.map((q) => ({ key: q.key, prompt: q.prompt })) }))
});

/**
 * Gemini designs the menu and the questions in a chat. Nothing is saved here: "Use this menu" puts the proposal into the
 * editor, where the owner can still adjust it and presses Save changes.
 */
export default function MenuAssistant({ overview, onUse, onClose }: { overview: Overview; onUse: (services: ServiceDef[]) => void; onClose: () => void }) {
  const hasMenu = overview.services.length > 0;
  const [history, setHistory] = useState<ChatTurn[]>([{ role: 'assistant', text: hasMenu ? GREETING_EDIT : GREETING_NEW }]);
  const [draft, setDraft] = useState<Draft | null>(hasMenu ? seed(overview) : null);
  const [changed, setChanged] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { api.onboardingInfo().then((i) => setAvailable(i.aiAvailable)).catch(() => setAvailable(false)); }, []);
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
      // The seeded greeting is ours, not Gemini's: only the conversation the owner has had is sent
      const res = await api.onboardingChat(next, draft);
      setHistory([...next, { role: 'assistant', text: res.reply }]);
      if (res.draft) {
        setDraft(res.draft);
        setChanged(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setDraft(null);
    setChanged(false);
    setHistory([{ role: 'assistant', text: GREETING_NEW }]);
  }

  function use() {
    if (!draft) return;
    // Keep each service's closing message when the assistant did not write one
    const before = new Map(overview.services.map((s) => [s.title.trim().toLowerCase(), s.closingMessage ?? '']));
    onUse(draft.services.map((s) => ({ ...s, closingMessage: s.closingMessage || before.get(s.title.trim().toLowerCase()) || '' })));
  }

  const input$ = 'w-full bg-sunken border border-line rounded-lg px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-brand/40';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Set up the menu with Gemini">
      <div className="w-full max-w-5xl max-h-[92vh] bg-card border border-line rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm font-bold text-fg"><Sparkles className="w-4 h-4 text-brand-text" /><span>Set up the menu and questions with Gemini</span></div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-fg" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {available === false ? (
          <p className="p-6 text-sm text-warn">Gemini is not available right now. You can still write the menu and questions by hand, or start from a template.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 min-h-0 flex-1">
            <div className="flex flex-col min-h-[320px] max-h-[70vh] lg:max-h-none border-b lg:border-b-0 lg:border-r border-line">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {history.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-brand text-on-brand' : 'bg-sunken border border-line text-fg'}`}>{m.text}</div>
                  </div>
                ))}
                {busy && <div className="flex items-center space-x-2 text-xs text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Thinking…</span></div>}
                <div ref={bottom} />
              </div>
              {error && <p className="px-4 pb-2 text-xs text-danger" role="alert">{error}</p>}
              <form onSubmit={send} className="p-3 border-t border-line flex items-center gap-2">
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={hasMenu ? 'What should change?' : 'Describe your business…'} maxLength={1500} className={input$} autoFocus />
                <button disabled={busy || !input.trim()} className="p-2.5 bg-brand hover:bg-brand text-on-brand rounded-lg disabled:opacity-40" aria-label="Send"><Send className="w-4 h-4" /></button>
              </form>
            </div>

            <div className="flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-4">
                {draft && draft.services.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[11px] text-muted">{changed ? 'Gemini’s proposal' : 'Your current menu'}</p>
                    {draft.services.map((s, i) => (
                      <div key={i} className="bg-sunken border border-line rounded-xl p-3">
                        <div className="text-sm font-semibold text-fg">{i + 1}. {s.title}</div>
                        <ol className="mt-2 space-y-1 list-decimal list-inside text-xs text-fg2">
                          {s.questions.map((q, j) => <li key={j}>{q.prompt}</li>)}
                        </ol>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center text-muted text-sm px-6">
                    <Sparkles className="w-8 h-8 mb-3 text-fg2" />
                    <p>The menu and questions appear here as soon as Gemini knows enough about your business.</p>
                  </div>
                )}
              </div>
              <div className="p-3 border-t border-line flex flex-wrap items-center gap-2">
                <button disabled={!draft || !changed || busy} onClick={use} className="px-4 py-2 bg-brand hover:bg-brand text-on-brand font-bold text-xs rounded-lg disabled:opacity-40">Use this menu</button>
                {hasMenu && <button onClick={startOver} disabled={busy} className="px-3.5 py-2 bg-subtle hover:bg-subtle text-fg text-xs rounded-lg border border-line disabled:opacity-40">Start from scratch</button>}
                <button onClick={onClose} className="px-3.5 py-2 text-muted hover:text-fg text-xs">Cancel</button>
                <span className="text-[11px] text-muted">It goes into the editor first; nothing changes for customers until you press Save changes.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
