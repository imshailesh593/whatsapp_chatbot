import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { AdminUser, Overview, ServiceId } from '../types';
import Admins from './Admins';
import { SERVICE_STYLE } from '../config';

export default function Settings({ overview, me }: { overview: Overview; me: AdminUser }) {
  const [active, setActive] = useState<ServiceId>(overview.services[0].id);
  const branch = overview.services.find((s) => s.id === active)!;

  return (
    <div className="space-y-6">
      <Admins me={me} />
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <h3 className="font-bold text-white text-base flex items-center space-x-2">
          <span>Topmate Consultation Link</span>
          <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-full font-semibold">1-ON-1 BOOKING</span>
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Sent at the end of every questionnaire together with “Fees will be adjusted in the process.” To change it, set <code className="text-emerald-400">TOPMATE_URL</code> in the server's <code className="text-emerald-400">.env</code> and restart the bot.
        </p>
        <div className="mt-4 flex items-center space-x-3">
          <input readOnly value={overview.topmateUrl} className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-200" />
          <a href={overview.topmateUrl} target="_blank" rel="noreferrer"
            className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 flex items-center space-x-1.5 transition">
            <span>Test URL</span><ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <div className="border-b border-slate-800 pb-4 mb-4">
          <h3 className="font-bold text-white text-base">Question Matrix (sequential flow)</h3>
          <p className="text-xs text-slate-400">Questions are sent strictly one at a time. This is the live configuration the bot is using.</p>
        </div>
        <div className="flex flex-wrap gap-2 mb-6">
          {overview.services.map((s) => (
            <button key={s.id} onClick={() => setActive(s.id)}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
                s.id === active ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'}`}>
              <span>{SERVICE_STYLE[s.id].icon}</span><span>{s.title}</span>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 rounded-full">{s.questions.length}Q</span>
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {branch.questions.map((q, i) => (
            <div key={q.key} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-start space-x-3">
              <span className="w-6 h-6 rounded-lg bg-slate-800 text-emerald-400 text-xs font-bold flex items-center justify-center border border-slate-700 shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-right text-[10px] text-slate-500 font-mono mb-0.5">slot: {q.key}</div>
                <p className="text-xs text-slate-200">{q.prompt}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
