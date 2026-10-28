import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Clock, ExternalLink, Globe, LogOut, MessageSquare, ShieldCheck, Smartphone, Users } from 'lucide-react';
import { api, UnauthorizedError } from './api';
import type { Contact, Overview } from './types';
import Login from './components/Login';
import Crm from './components/Crm';
import Simulator from './components/Simulator';
import Inbox from './components/Inbox';
import Settings from './components/Settings';
import Dossier from './components/Dossier';

type Tab = 'crm' | 'simulator' | 'inbox' | 'config';

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    api.me().then((r) => setAuthed(r.authed)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="min-h-screen bg-slate-900" />;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <Console onSignedOut={() => setAuthed(false)} />;
}

function Console({ onSignedOut }: { onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('crm');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [includeTest, setIncludeTest] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([api.contacts(includeTest), api.overview()]);
      setContacts(c);
      setOverview(o);
      setLoadError('');
    } catch (err) {
      if (err instanceof UnauthorizedError) onSignedOut();
      else setLoadError((err as Error).message);
    }
  }, [includeTest, onSignedOut]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const replaceContact = (c: Contact) => setContacts((prev) => prev.map((x) => (x.phone === c.phone ? c : x)));

  const stats = useMemo(() => {
    const real = contacts.filter((c) => !c.isTest);
    return {
      total: real.length,
      qualified: real.filter((c) => c.hasLead).length,
      booked: real.filter((c) => c.status === 'CONSULTATION_BOOKED').length,
      inProgress: real.filter((c) => !c.hasLead).length
    };
  }, [contacts]);

  const waReady = overview?.whatsapp === 'ready';
  const selectedContact = contacts.find((c) => c.phone === selected) ?? null;

  const tabBtn = (id: Tab, icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center space-x-2 px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition whitespace-nowrap ${
        tab === id
          ? 'border-emerald-400 text-emerald-400 bg-slate-900/60'
          : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
      }`}
    >
      {icon}
      <span>{label}</span>
      {extra}
    </button>
  );

  const kpi = (label: string, value: number, color: string, icon: React.ReactNode, tint: string) => (
    <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between">
      <div>
        <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{label}</p>
        <p className={`text-xl sm:text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
      </div>
      <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${tint}`}>{icon}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      <header className="bg-slate-950 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Globe className="w-5 h-5 text-slate-950" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-extrabold text-base tracking-tight text-white">MNS INSTITUTE</span>
                  <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold tracking-wide">
                    JOBS & LICENSING
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">WhatsApp Lead Intelligence Console</p>
              </div>
            </div>

            <div className="flex items-center space-x-3 text-xs text-slate-300">
              <div className="hidden md:flex items-center space-x-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                <span className="relative flex h-2 w-2">
                  {waReady && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${waReady ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                </span>
                <span>
                  WhatsApp: <strong>{waReady ? 'Connected' : overview?.whatsapp ?? '…'}</strong>
                </span>
              </div>
              {overview && (
                <a
                  href={overview.topmateUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden md:flex items-center space-x-1.5 text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 px-3 py-1.5 rounded-lg transition"
                >
                  <span>Topmate</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={() => api.logout().finally(onSignedOut)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-900 text-slate-300 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>

          <div className="flex space-x-1 -mb-px border-t border-slate-800/60 pt-1 overflow-x-auto">
            {tabBtn('crm', <Users className="w-4 h-4" />, 'Qualified Leads CRM', (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-slate-800 text-slate-300 rounded-full">{stats.total}</span>
            ))}
            {tabBtn('inbox', <MessageSquare className="w-4 h-4" />, 'Live Inbox & Human Takeover')}
            {tabBtn('simulator', <Smartphone className="w-4 h-4 text-emerald-400" />, 'Bot Simulator', (
              <span className="ml-1 px-1.5 rounded text-[9px] bg-emerald-500/20 text-emerald-300 font-bold">TEST</span>
            ))}
            {tabBtn('config', <ShieldCheck className="w-4 h-4" />, 'Questionnaires & Settings')}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {loadError && (
          <div className="mb-4 p-3 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-300 text-xs">
            Could not load data: {loadError}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {kpi('Total Contacts', stats.total, 'text-white', <Users className="w-5 h-5" />, 'bg-blue-500/10 border-blue-500/20 text-blue-400')}
          {kpi('Fully Qualified', stats.qualified, 'text-emerald-400', <CheckCircle2 className="w-5 h-5" />, 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400')}
          {kpi('Topmate Consultations', stats.booked, 'text-purple-400', <Calendar className="w-5 h-5" />, 'bg-purple-500/10 border-purple-500/20 text-purple-400')}
          {kpi('In Questionnaire', stats.inProgress, 'text-amber-400', <Clock className="w-5 h-5" />, 'bg-amber-500/10 border-amber-500/20 text-amber-400')}
        </div>

        {tab === 'crm' && (
          <Crm contacts={contacts} includeTest={includeTest} onIncludeTest={setIncludeTest} onOpen={setSelected} onChanged={replaceContact} />
        )}
        {tab === 'inbox' && <Inbox contacts={contacts} waReady={waReady} onChanged={replaceContact} />}
        {tab === 'simulator' && <Simulator onActivity={refresh} />}
        {tab === 'config' && overview && <Settings overview={overview} />}
      </main>

      {selectedContact && (
        <Dossier
          contact={selectedContact}
          topmateUrl={overview?.topmateUrl ?? ''}
          onClose={() => setSelected(null)}
          onChanged={replaceContact}
        />
      )}
    </div>
  );
}
