import { useEffect, useRef, useState } from 'react';
import { CheckCheck, MoreVertical, Phone, RotateCcw, Send } from 'lucide-react';
import { api } from '../api';

interface Msg {
  id: number;
  sender: 'bot' | 'user';
  text: string;
  time: string;
}
interface SimState {
  stage: string;
  service: string | null;
  step: number;
  totalSteps: number;
}

const SIM_ID = 'console';
const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
let seq = 0;

const QUICK = [
  { n: '1', label: '📚 1️⃣ Coaching Exam', cls: 'bg-blue-950/40 hover:bg-blue-900/50 border-blue-800/50 text-blue-300' },
  { n: '2', label: '🩺 2️⃣ Medical Licensing', cls: 'bg-emerald-950/40 hover:bg-emerald-900/50 border-emerald-800/50 text-emerald-300' },
  { n: '3', label: '💼 3️⃣ International Jobs', cls: 'bg-purple-950/40 hover:bg-purple-900/50 border-purple-800/50 text-purple-300' },
  { n: '4', label: '✈️ 4️⃣ Visa & PR', cls: 'bg-amber-950/40 hover:bg-amber-900/50 border-amber-800/50 text-amber-300' }
];

import { useBrand } from '../brand';
export default function Simulator({ onActivity }: { onActivity: () => void }) {
  const brand = useBrand();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [state, setState] = useState<SimState>({ stage: 'WELCOME', service: null, step: 0, totalSteps: 0 });
  const [name, setName] = useState('Dr. Samir Khan');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(raw: string, showUser = true) {
    const value = raw.trim();
    if (!value || busy) return;
    setError('');
    if (showUser) setMessages((m) => [...m, { id: ++seq, sender: 'user', text: value, time: now() }]);
    setText('');
    setBusy(true);
    try {
      const res = await api.simulate(SIM_ID, name, value);
      await new Promise((r) => setTimeout(r, 350));
      setMessages((m) => [...m, ...res.replies.map((t) => ({ id: ++seq, sender: 'bot' as const, text: t, time: now() }))]);
      setState(res.state);
      onActivity();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setMessages([]);
    setBusy(true);
    try {
      await api.simulateReset(SIM_ID);
    } finally {
      setBusy(false);
    }
    setState({ stage: 'WELCOME', service: null, step: 0, totalSteps: 0 });
    await send('hi', false);
  }

  useEffect(() => {
    restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const menuOpen = state.stage === 'AWAITING_SERVICE_SELECTION';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-white text-base">Bot Testing Controls</h3>
              <p className="text-xs text-slate-400">Runs the live bot logic. Nothing is sent to WhatsApp.</p>
            </div>
            <button onClick={restart} className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition">
              <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
              <span>Reset Chat</span>
            </button>
          </div>

          <div className="space-y-4 mt-4">
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">Simulated candidate name (applies after reset)</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500" />
            </div>

            <div>
              <span className="text-xs font-medium text-slate-300 block mb-2">1-click service pickers:</span>
              <div className="grid grid-cols-2 gap-2">
                {QUICK.map((q) => (
                  <button key={q.n} onClick={() => send(q.n)} disabled={!menuOpen || busy}
                    className={`p-2 text-left rounded-lg border text-xs transition disabled:opacity-40 ${q.cls}`}>
                    {q.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">Also try side questions like “What is OET?” (answered by Gemini when its key is set), or type <em>menu</em>.</p>
            </div>

            <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 text-xs space-y-2">
              <Row k="Active branch" v={state.service ?? 'None (awaiting selection)'} cls="text-emerald-400" />
              <Row k="Current step" v={state.service ? `Q${Math.min(state.step + 1, state.totalSteps)} of ${state.totalSteps}` : 'Menu'} />
              <Row k="Session stage" v={state.stage} cls={state.stage === 'COMPLETED' ? 'text-purple-400' : 'text-amber-400'} />
            </div>
            <p className="text-[11px] text-slate-500">Completed test runs appear in the CRM when “Show simulator data” is ticked.</p>
            {error && <p className="text-xs text-rose-400">{error}</p>}
          </div>
        </div>
      </div>

      <div className="lg:col-span-7 flex justify-center">
        <div className="w-full max-w-[420px] bg-slate-950 rounded-[40px] p-3 shadow-2xl border-4 border-slate-800">
          <div className="relative bg-[#075E54] rounded-t-[32px] pt-3 pb-2 px-4 text-white">
            <div className="w-20 h-4 bg-slate-950 rounded-full mx-auto mb-2 opacity-60" />
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-full bg-emerald-300 text-slate-900 font-bold flex items-center justify-center text-xs shadow">{brand.businessName.slice(0, 3).toUpperCase()}</div>
                <div>
                  <h4 className="font-semibold text-xs leading-none">{brand.businessName}</h4>
                  <p className="text-[10px] text-emerald-100 opacity-90 mt-0.5">{busy ? 'typing…' : 'online'}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2"><Phone className="w-4 h-4" /><MoreVertical className="w-4 h-4" /></div>
            </div>
          </div>

          <div ref={scroller} className="h-[460px] overflow-y-auto p-3 space-y-3 bg-[#0b141a] text-slate-100 text-xs"
            style={{ backgroundImage: 'radial-gradient(#1f2c34 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 leading-relaxed shadow-md whitespace-pre-wrap break-words ${
                  m.sender === 'user' ? 'bg-[#005c4b] text-emerald-50 rounded-tr-none' : 'bg-[#202c33] text-slate-100 rounded-tl-none border border-slate-700/40'}`}>
                  {m.text}
                  <div className="flex items-center justify-end space-x-1 mt-1 text-[9px] text-slate-400">
                    <span>{m.time}</span>
                    {m.sender === 'user' && <CheckCheck className="w-3.5 h-3.5 text-blue-400 inline" />}
                  </div>
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center space-x-1.5 bg-[#202c33] w-20 px-3 py-2 rounded-2xl text-slate-400">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            )}
          </div>

          <div className="bg-[#202c33] rounded-b-[32px] p-2.5 flex items-center space-x-2 border-t border-slate-800">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(text)}
              placeholder="Type your reply..."
              className="flex-1 bg-[#2a3942] text-xs text-white placeholder-slate-400 rounded-full px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            <button onClick={() => send(text)} disabled={busy}
              className="w-9 h-9 rounded-full bg-[#00a884] hover:bg-[#008f70] text-slate-950 flex items-center justify-center transition shadow disabled:opacity-60">
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, cls = 'text-slate-200' }: { k: string; v: string; cls?: string }) {
  return (
    <div className="flex justify-between text-slate-400">
      <span>{k}:</span>
      <span className={`font-semibold ${cls}`}>{v}</span>
    </div>
  );
}
