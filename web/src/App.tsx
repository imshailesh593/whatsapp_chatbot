import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, Megaphone, Calendar, CheckCircle2, Clock, ExternalLink, Globe, MessageSquare, ShieldCheck, Smartphone, Users } from 'lucide-react';
import { api, UnauthorizedError } from './api';
import type { AdminRow, AdminUser, BillingInfo, Contact, Overview } from './types';
import AccountMenu from './components/AccountMenu';
import Login from './components/Login';
import Crm from './components/Crm';
import Simulator from './components/Simulator';
import Inbox from './components/Inbox';
import Settings from './components/Settings';
import Dossier from './components/Dossier';
import Onboarding from './components/Onboarding';
import Billing from './components/Billing';
import PlatformShell from './components/PlatformShell';
import Broadcasts from './components/Broadcasts';
import Analytics from './components/Analytics';
import { BrandContext } from './brand';
import { StagesContext } from './stages';

type Tab = 'crm' | 'simulator' | 'inbox' | 'broadcasts' | 'analytics' | 'config';

type Mode = 'platform' | 'business';

export default function App() {
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('mode') === 'business' ? 'business' : 'platform'));
  const switchMode = (m: Mode) => {
    localStorage.setItem('mode', m);
    setMode(m);
  };

  useEffect(() => {
    api.me().then((r) => setUser(r.authed && r.user ? r.user : null)).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="min-h-screen bg-slate-900" />;
  if (!user) return <Login onDone={setUser} />;
  const signOut = () => api.logout().finally(() => setUser(null));
  const platformMode = user.isSuperAdmin && mode === 'platform';
  const reloadUser = () => api.me().then((r) => setUser(r.authed && r.user ? r.user : null)).catch(() => undefined);
  if (platformMode) {
    return <PlatformShell user={user} onBusiness={() => switchMode('business')} onSignOut={signOut} />;
  }
  if (wantsCheckout(user)) {
    return <CheckoutPage user={user} onSkip={() => { clearCheckout(); reloadUser(); }} onSignOut={signOut} />;
  }
  if (user.workspace && !user.workspace.onboardingCompleted) {
    return user.role === 'agent' ? (
      <div className="min-h-screen bg-slate-900 text-slate-200 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p>Your account owner has not finished setting up the chatbot yet.</p>
        <button onClick={signOut} className="text-xs text-emerald-400">Sign out</button>
      </div>
    ) : (
      <Onboarding user={user} onDone={reloadUser} onSignOut={signOut} />
    );
  }
  return <Console user={user} onSignedOut={() => setUser(null)} onPlatform={user.isSuperAdmin ? () => switchMode('platform') : undefined} />;
}

// Coming from the website's "Get started" button: after signing in or signing up, the owner lands on the payment page first
const clearCheckout = () => { try { sessionStorage.removeItem('lk_checkout'); } catch { /* storage unavailable */ } };
function wantsCheckout(user: AdminUser): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('billing')) { clearCheckout(); return false; } // back from the payment provider
    if (sessionStorage.getItem('lk_checkout') !== '1') return false;
  } catch {
    return false;
  }
  return user.role === 'owner' && !user.isSuperAdmin && !!user.workspace;
}

function CheckoutPage({ user, onSkip, onSignOut }: { user: AdminUser; onSkip: () => void; onSignOut: () => void }) {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-extrabold text-white">Choose your plan</h1>
            <p className="text-xs text-slate-400 mt-1">Pay now to switch on your plan, or start your free trial and pay later from Plan &amp; billing.</p>
          </div>
          <button onClick={onSignOut} className="text-xs text-slate-400 hover:text-slate-200">Sign out</button>
        </div>
        <Billing me={user} />
        <div className="mt-4 text-center">
          <button onClick={onSkip} className="px-4 py-2 text-sm text-emerald-300 hover:text-emerald-200 border border-slate-700 rounded-lg">Start my free trial first</button>
        </div>
      </div>
    </div>
  );
}

const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : 0);

function Console({ user, onSignedOut, onPlatform }: { user: AdminUser; onSignedOut: () => void; onPlatform?: () => void }) {
  const [tab, setTab] = useState<Tab>('crm');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [team, setTeam] = useState<AdminRow[]>([]);
  useEffect(() => { api.admins().then(setTeam).catch(() => undefined); }, []);
  const [includeTest, setIncludeTest] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [c, o, bl] = await Promise.all([api.contacts(includeTest), api.overview(), api.billing().catch(() => null)]);
      setContacts(c);
      setOverview(o);
      setBilling(bl);
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
      booked: real.filter((c) => c.pipeline === 'booked').length,
      inProgress: real.filter((c) => !c.hasLead).length
    };
  }, [contacts]);

  const brand = useMemo(() => ({ businessName: overview?.workspace.businessName ?? user.workspace?.businessName ?? '', tagline: overview?.workspace.tagline ?? '' }), [overview, user]);
  const isAgent = user.role === 'agent';
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
    <BrandContext.Provider value={brand}>
    <StagesContext.Provider value={overview?.stages ?? []}>
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
                  <span className="font-extrabold text-base tracking-tight text-white">{brand.businessName}</span>
                  {brand.tagline && (
                    <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold tracking-wide">
                      {brand.tagline}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">WhatsApp Lead Intelligence Console</p>
              </div>
            </div>

            <div className="flex items-center space-x-3 text-xs text-slate-300">
              <button onClick={() => setTab('config')} title="Manage WhatsApp connection" className="hidden md:flex items-center space-x-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700">
                <span className="relative flex h-2 w-2">
                  {waReady && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${waReady ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                </span>
                <span>
                  WhatsApp: <strong>{waReady ? 'Connected' : overview?.whatsapp === 'off' ? 'Disconnected' : overview?.whatsapp ?? '…'}</strong>
                </span>
              </button>
              {overview?.workspace.bookingUrl && (
                <a
                  href={overview.workspace.bookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden md:flex items-center space-x-1.5 text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 px-3 py-1.5 rounded-lg transition"
                >
                  <span>Booking link</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {onPlatform && <button onClick={onPlatform} className="hidden md:flex items-center space-x-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 px-3 py-1.5 rounded-lg hover:bg-emerald-900/40"><Building2 className="w-3.5 h-3.5" /><span>Platform admin</span></button>}
              <AccountMenu user={user} onSignOut={() => api.logout().finally(onSignedOut)} />
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
            {!isAgent && tabBtn('analytics', <BarChart3 className="w-4 h-4" />, 'Analytics')}
            {!isAgent && tabBtn('broadcasts', <Megaphone className="w-4 h-4" />, 'Broadcasts')}
            {!isAgent && tabBtn('config', <ShieldCheck className="w-4 h-4" />, 'Bot & Settings')}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {loadError && (
          <div className="mb-4 p-3 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-300 text-xs">
            Could not load data: {loadError}
          </div>
        )}

        {billing && billing.plan !== 'internal' && (!billing.active || billing.status === 'past_due' || (billing.status === 'trialing' && daysLeft(billing.trialEndsAt) <= 3)) && (
          <div className={`mb-4 p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${billing.active ? 'bg-amber-950/40 border-amber-800/60 text-amber-200' : 'bg-rose-950/50 border-rose-800/60 text-rose-200'}`}>
            <span>
              {!billing.active
                ? 'Your bot has stopped replying to new customers: ' + (billing.reason === 'trial_expired' ? 'the free trial has ended.' : 'the subscription has ended.')
                : billing.status === 'past_due'
                  ? 'Your last payment failed. Update your payment method to keep the bot running.'
                  : `Your free trial ends in ${daysLeft(billing.trialEndsAt)} day(s).`}
            </span>
            {!isAgent && <button onClick={() => setTab('config')} className="font-semibold underline">Choose a plan</button>}
          </div>
        )}

        {overview && !overview.workspace.botEnabled && (
          <div className="mb-4 p-3 rounded-lg bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2">
            <span>The bot is paused: it is not replying to customers yet.</span>
            {!isAgent && <button onClick={() => setTab('config')} className="font-semibold underline">Open Bot &amp; Settings to go live</button>}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {kpi('Total Contacts', stats.total, 'text-white', <Users className="w-5 h-5" />, 'bg-blue-500/10 border-blue-500/20 text-blue-400')}
          {kpi('Fully Qualified', stats.qualified, 'text-emerald-400', <CheckCircle2 className="w-5 h-5" />, 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400')}
          {kpi('Bookings', stats.booked, 'text-purple-400', <Calendar className="w-5 h-5" />, 'bg-purple-500/10 border-purple-500/20 text-purple-400')}
          {kpi('In Questionnaire', stats.inProgress, 'text-amber-400', <Clock className="w-5 h-5" />, 'bg-amber-500/10 border-amber-500/20 text-amber-400')}
        </div>

        {tab === 'crm' && (
          <Crm contacts={contacts} includeTest={includeTest} onIncludeTest={setIncludeTest} onOpen={setSelected} onChanged={replaceContact} team={team} meId={user.id} />
        )}
        {tab === 'inbox' && <Inbox contacts={contacts} waReady={waReady} onChanged={replaceContact} />}
        {tab === 'simulator' && <Simulator onActivity={refresh} services={overview?.services ?? []} />}
        {tab === 'analytics' && !isAgent && <Analytics />}
        {tab === 'broadcasts' && !isAgent && overview && <Broadcasts overview={overview} waReady={waReady} />}
        {tab === 'config' && !isAgent && overview && <Settings overview={overview} me={user} onChanged={refresh} />}
      </main>

      {selectedContact && (
        <Dossier
          contact={selectedContact}
          bookingUrl={overview?.workspace.bookingUrl ?? ''}
          team={team}
          onClose={() => setSelected(null)}
          onChanged={replaceContact}
        />
      )}
    </div>
    </StagesContext.Provider>
    </BrandContext.Provider>
  );
}
