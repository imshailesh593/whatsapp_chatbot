import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Plus, Send, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { api, type EditableMessage } from '../api';

const MAX_PARTS = 3;

const toParts = (text: string) => {
  const parts = text.split(/\s*\[split\]\s*/i).filter((p) => p.trim());
  return parts.length ? parts : [''];
};
const fromParts = (parts: string[], multiline: boolean) => parts.map((p) => p.trim()).filter(Boolean).join(multiline ? '\n[split]\n' : ' [split] ');
const same = (a: string[], b: string[]) => a.map((x) => x.trim()).join('\u0000') === b.map((x) => x.trim()).join('\u0000');

interface ChatLine {
  who: 'you' | 'gemini';
  text: string;
}

const QUICK = ['Make it shorter', 'Split into two messages', 'Make it warmer and friendlier', 'Use simpler words'];

export default function MessageEditor({
  messages,
  selectedId,
  onSelect,
  onChanged,
  onTest
}: {
  messages: EditableMessage[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** A save or undo happened: here is the fresh list */
  onChanged: (messages: EditableMessage[]) => void;
  /** Restart the test chat to see the saved wording */
  onTest: () => void;
}) {
  const message = messages.find((m) => m.id === selectedId) ?? null;
  const groups = [...new Set(messages.map((m) => m.group))];

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="message-pick" className="text-xs font-medium text-fg2 block mb-1">Message to edit</label>
        <select id="message-pick" value={selectedId} onChange={(e) => onSelect(e.target.value)}
          className="w-full bg-sunken border border-line rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-brand/40">
          <option value="">Choose a saved message…</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {messages.filter((m) => m.group === g).map((m) => (
                <option key={m.id} value={m.id}>{m.label}: {m.text.replace(/\s+/g, ' ').slice(0, 55)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {message ? (
        <Editor key={message.id} message={message} onChanged={onChanged} onTest={onTest} />
      ) : (
        <p className="text-[12.5px] text-muted">
          Pick a message here, or press <strong>Edit</strong> under a bot reply in the test chat. Replies that Gemini writes live have no saved text:
          change how it writes them in Settings, under the AI answering instructions. The menu and other built-in lines cannot be edited here yet.
        </p>
      )}
    </div>
  );
}

function Editor({ message, onChanged, onTest }: { message: EditableMessage; onChanged: (m: EditableMessage[]) => void; onTest: () => void }) {
  const [parts, setParts] = useState(() => toParts(message.text));
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState<'' | 'gemini' | 'save'>('');
  const [error, setError] = useState('');
  const [blocking, setBlocking] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  /** The server asked to confirm these warnings before saving */
  const [mustConfirm, setMustConfirm] = useState(false);
  const [done, setDone] = useState('');
  const chatBox = useRef<HTMLDivElement>(null);

  // a save, an undo or a change made elsewhere: start again from what is stored
  useEffect(() => {
    setParts(toParts(message.text));
    setBlocking([]);
    setWarnings([]);
    setMustConfirm(false);
  }, [message.text]);

  useEffect(() => {
    chatBox.current?.scrollTo({ top: chatBox.current.scrollHeight, behavior: 'smooth' });
  }, [chat, busy]);

  const dirty = !same(parts, toParts(message.text));
  const draft = fromParts(parts, message.multiline);
  const length = draft.length;

  const changeParts = (next: string[]) => {
    setParts(next);
    setBlocking([]);
    setWarnings([]);
    setMustConfirm(false);
    setError('');
    setDone('');
  };

  async function askGemini(text: string) {
    const request = text.trim();
    if (request.length < 3 || busy) return;
    setBusy('gemini');
    setError('');
    setDone('');
    setChat((c) => [...c, { who: 'you', text: request }]);
    setAsk('');
    try {
      const earlier = chat.filter((l) => l.who === 'you').map((l) => l.text);
      const res = await api.suggestMessage(message.id, draft, request, earlier);
      changeParts(toParts(res.text));
      setBlocking(res.errors);
      setWarnings(res.warnings);
      setChat((c) => [...c, { who: 'gemini', text: res.note || 'I updated the draft below.' }]);
    } catch (err) {
      setError((err as Error).message);
      setAsk(request);
    } finally {
      setBusy('');
    }
  }

  async function save(confirm: boolean) {
    setBusy('save');
    setError('');
    try {
      const res = await api.saveMessage(message.id, message.text, draft, confirm);
      if (!res.saved) {
        setWarnings(res.warnings);
        setMustConfirm(true);
      } else {
        onChanged(res.messages);
        setMustConfirm(false);
        setWarnings([]);
        setDone('Saved. Customers get this wording from now on.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function undo() {
    setBusy('save');
    setError('');
    try {
      onChanged((await api.undoMessage(message.id)).messages);
      setDone('Undone. The earlier wording is back.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted">{message.aiNote}</p>

      <div className="bg-sunken border border-line rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
          <Sparkles className="w-3.5 h-3.5 text-brand-text" /> Ask Gemini to change it
        </div>
        {(chat.length > 0 || busy === 'gemini') && (
          <div ref={chatBox} className="max-h-40 overflow-y-auto space-y-1.5" aria-live="polite">
            {chat.map((l, i) => (
              <div key={i} className={`flex ${l.who === 'you' ? 'justify-end' : 'justify-start'}`}>
                <p className={`max-w-[90%] rounded-xl px-3 py-1.5 text-xs whitespace-pre-wrap ${l.who === 'you' ? 'bg-brand-soft text-brand-text' : 'bg-card border border-line text-fg'}`}>{l.text}</p>
              </div>
            ))}
            {busy === 'gemini' && <p className="text-xs text-muted">Gemini is writing…</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {QUICK.filter((q) => message.splittable || !q.startsWith('Split')).map((q) => (
            <button key={q} onClick={() => askGemini(q)} disabled={!!busy}
              className="px-2.5 py-1 rounded-full border border-line bg-card text-[12px] text-fg2 hover:border-brand/50 disabled:opacity-50">{q}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askGemini(ask)} maxLength={600}
            aria-label="What should Gemini change?" placeholder="e.g. keep only the fee and the booking link"
            className="flex-1 min-w-0 bg-card border border-line rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-brand/40" />
          <button onClick={() => askGemini(ask)} disabled={!!busy || ask.trim().length < 3} aria-label="Send to Gemini"
            className="px-3 rounded-lg bg-brand text-slate-100 disabled:opacity-50"><Send className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">{dirty ? 'Draft (not saved)' : 'Saved wording'}</span>
          <span className={`text-[12px] ${length > message.max ? 'text-danger font-semibold' : 'text-muted'}`}>{length} / {message.max}</span>
        </div>
        {parts.map((p, i) => (
          <div key={i}>
            {parts.length > 1 && (
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] text-muted">Message {i + 1} of {parts.length}</span>
                <button onClick={() => changeParts(parts.filter((_, j) => j !== i))} className="flex items-center gap-1 text-[12px] text-muted hover:text-danger">
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              </div>
            )}
            <textarea value={p} rows={Math.min(12, Math.max(2, p.split('\n').length + Math.floor(p.length / 55)))}
              aria-label={parts.length > 1 ? `Message ${i + 1}` : 'Message text'}
              onChange={(e) => changeParts(parts.map((x, j) => (j === i ? e.target.value : x)))}
              className="w-full bg-sunken border border-line rounded-xl px-3 py-2 text-xs leading-relaxed text-fg resize-y focus:outline-none focus:border-brand/40" />
          </div>
        ))}
        {message.splittable && parts.length < MAX_PARTS && (
          <button onClick={() => changeParts([...parts, ''])} className="flex items-center gap-1 text-[12px] font-semibold text-brand-text">
            <Plus className="w-3.5 h-3.5" /> Add another message
          </button>
        )}
        {parts.length > 1 && <p className="text-[12px] text-muted">These arrive as separate WhatsApp messages, in this order, about a second apart.</p>}
        {/\[if /.test(draft) && <p className="text-[12px] text-muted">The [if …] … [/if] tags show that text only to matching customers. Keep them as they are.</p>}
      </div>

      {blocking.length > 0 && <Notice tone="text-danger" title="This draft cannot be saved" items={blocking} />}
      {warnings.length > 0 && <Notice tone="text-warn" title="Check these details before saving" items={warnings} />}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => save(mustConfirm)} disabled={!dirty || !!busy || !draft || length > message.max}
          className="px-4 py-2 rounded-lg bg-brand text-slate-100 text-xs font-semibold disabled:opacity-40">
          {busy === 'save' ? 'Saving…' : mustConfirm ? 'Save anyway' : 'Save'}
        </button>
        {dirty && (
          <button onClick={() => changeParts(toParts(message.text))} disabled={!!busy} className="px-3 py-2 rounded-lg border border-line text-xs font-semibold text-fg">Discard draft</button>
        )}
        {!dirty && message.canUndo && (
          <button onClick={undo} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line text-xs font-semibold text-fg">
            <Undo2 className="w-3.5 h-3.5" /> Undo last save
          </button>
        )}
        {done && !dirty && <button onClick={onTest} className="px-3 py-2 rounded-lg border border-line text-xs font-semibold text-fg">Restart test chat</button>}
      </div>
      {done && !dirty && <p className="text-xs text-brand-text" role="status">{done}</p>}
      {dirty && <p className="text-[12px] text-warn">Saving changes what real customers receive from then on.</p>}
    </div>
  );
}

function Notice({ tone, title, items }: { tone: string; title: string; items: string[] }) {
  return (
    <div className="bg-sunken border border-line rounded-xl p-3 text-xs" role="alert">
      <p className={`flex items-center gap-1.5 font-semibold ${tone}`}><AlertTriangle className="w-3.5 h-3.5" /> {title}</p>
      <ul className="mt-1 list-disc pl-5 text-fg2 space-y-0.5">
        {items.map((x) => <li key={x} className="break-words">{x}</li>)}
      </ul>
    </div>
  );
}
