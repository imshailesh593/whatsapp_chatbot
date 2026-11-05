import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, Calendar, CheckCircle2, Clock, ExternalLink, Megaphone, MessageSquare, Settings as Cog, Smartphone, Users } from 'lucide-react';
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
import Logo from './components/Logo';
import PlatformShell from './components/PlatformShell';
import Broadcasts from './components/Broadcasts';
import Analytics from './components/Analytics';
import { AppShell, Banner, Stat, ThemeToggle, type NavGroup } from './components/ui';
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

  if (user === undefined) return <div className="min-h-screen bg-app" />;
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
      <div className="min-h-screen bg-app text-fg flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p>Your account owner has not finished setting up the chatbot yet.</p>
        <button onClick={signOut} className="text-sm text-brand-text font-medium">Sign out</button>
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
    <div className="min-h-screen bg-app text-fg">
      <header className="h-16 bg-card border-b border-line px-4 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3"><Logo size={34} /><span className="font-semibold">Wappo</span></div>
        <div className="flex items-center gap-2"><ThemeToggle /><button onClick={onSignOut} className="text-sm text-muted hover:text-fg px-2">Sign out</button></div>
      </header>
      <div className="max-w-3xl mx-auto p-4 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Choose your plan</h1>
        <p className="text-sm text-muted mt-1 mb-6 max-w-xl">Subscribe to switch your bot on. You can set everything up first, but the bot stays off until you subscribe.</p>
        <Billing me={user} />
        <div className="mt-6 text-center">
          <button onClick={onSkip} className="px-5 py-2.5 text-sm font-medium text-fg2 border border-line-strong rounded-lg hover:bg-subtle transition">Set up my account first</button>
        </div>
      </div>
    </div>
  );
}

const PAGES: Record<Tab, { title: string; description: string }> = {
  crm: { title: 'Leads', description: 'Everyone who has chatted with your bot, and how far they got.' },
  inbox: { title: 'Inbox', description: 'Live conversations. Take over from the bot whenever a person is needed.' },
  simulator: { title: 'Bot simulator', description: 'Try the bot exactly as a customer sees it. Nothing is sent to real people.' },
  analytics: { title: 'Analytics', description: 'How your conversations turn into leads and bookings.' },
  broadcasts: { title: 'Broadcasts', description: 'Send an announcement to people who have chatted with you.' },
  config: { title: 'Settings', description: 'Connect WhatsApp, shape the bot, and manage your plan and team.' }
};

const ico = 'w-[18px] h-[18px]';
const topBtn = 'hidden md:inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-card text-sm text-fg2 hover:border-line-strong transition whitespace-nowrap';

function Console({ user, onSignedOut, onPlatform }: { user: AdminUser; onSignedOut: () => void; onPlatform?: () => void }) {
  const [tab, setTab] = useState<Tab>('crm');
  const [section, setSection] = useState('whatsapp');
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
  const openSettings = (s: string) => { setSection(s); setTab('config'); };

  const groups: NavGroup[] = [
    {
      label: 'Conversations',
      items: [
        { id: 'crm', label: 'Leads', icon: <Users className={ico} />, badge: <span className="px-1.5 py-0.5 text-[11px] font-semibold rounded-md bg-subtle text-fg2 tabular-nums">{stats.total}</span> },
        { id: 'inbox', label: 'Inbox', icon: <MessageSquare className={ico} /> }
      ]
    },
    {
      label: 'Automation',
      items: [
        { id: 'simulator', label: 'Simulator', icon: <Smartphone className={ico} />, badge: <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-brand-soft text-brand-text">TEST</span> },
        ...(!isAgent ? [{ id: 'broadcasts', label: 'Broadcasts', icon: <Megaphone className={ico} /> }] : [])
      ]
    },
    ...(!isAgent
      ? [
          { label: 'Insights', items: [{ id: 'analytics', label: 'Analytics', icon: <BarChart3 className={ico} /> }] },
          { label: 'Setup', items: [{ id: 'config', label: 'Settings', icon: <Cog className={ico} /> }] }
        ]
      : [])
  ];

  const waLabel = waReady ? 'Connected' : overview?.whatsapp === 'off' ? 'Disconnected' : overview?.whatsapp ?? '…';
  const planActive = !!billing?.active && billing.status !== 'past_due';

  const sidebarFooter = (
    <div className="space-y-2">
      {billing && billing.plan !== 'internal' && (
        <button onClick={() => !isAgent && openSettings('billing')} className="w-full text-left rounded-xl border border-line bg-sunken hover:bg-subtle transition p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg">{billing.planName}</span>
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${planActive ? 'bg-brand-soft text-brand-text' : 'bg-danger-soft text-danger'}`}>
              {planActive ? 'Active' : billing.status === 'past_due' ? 'Payment due' : 'Not subscribed'}
            </span>
          </div>
          {!planActive && !isAgent && <span className="text-xs text-brand-text font-medium mt-1 block">Choose a plan →</span>}
        </button>
      )}
      <div className="text-[11px] text-muted px-1 truncate">{user.role === 'owner' ? 'Owner' : user.role === 'admin' ? 'Admin' : 'Agent'} · {user.email}</div>
    </div>
  );

  const topRight = (
    <>
      <button onClick={() => !isAgent && openSettings('whatsapp')} title="WhatsApp connection" className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-card text-sm text-fg2 hover:border-line-strong transition whitespace-nowrap">
        <span className="relative flex h-2 w-2">
          {waReady && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-60" />}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${waReady ? 'bg-brand' : 'bg-danger'}`} />
        </span>
        <span className="hidden sm:inline">WhatsApp</span>
        <strong className="font-semibold text-fg">{waLabel}</strong>
      </button>
      {overview?.workspace.bookingUrl && (
        <a href={overview.workspace.bookingUrl} target="_blank" rel="noreferrer" className={topBtn}>
          <ExternalLink className="w-3.5 h-3.5" /><span>Booking link</span>
        </a>
      )}
      {onPlatform && (
        <button onClick={onPlatform} className={topBtn}>
          <Building2 className="w-3.5 h-3.5" /><span>Platform admin</span>
        </button>
      )}
      <ThemeToggle />
      <AccountMenu user={user} onSignOut={() => api.logout().finally(onSignedOut)} />
    </>
  );

  const banners = (
    <>
      {loadError && <Banner tone="danger">Could not load data: {loadError}</Banner>}
      {billing && billing.plan !== 'internal' && (!billing.active || billing.status === 'past_due') && (
        <Banner tone={billing.active ? 'warn' : 'danger'} action={!isAgent && <button onClick={() => openSettings('billing')} className="font-semibold underline">Choose a plan</button>}>
          {!billing.active
            ? 'Your bot has stopped replying to new customers: ' + (billing.reason === 'unpaid' ? 'choose a plan to switch it on.' : 'the subscription has ended.')
            : 'Your last payment failed. Update your payment method to keep the bot running.'}
        </Banner>
      )}
      {overview && !overview.workspace.botEnabled && (
        <Banner tone="warn" action={!isAgent && <button onClick={() => openSettings('business')} className="font-semibold underline">Go live in Settings</button>}>
          The bot is paused: it is not replying to customers yet.
        </Banner>
      )}
    </>
  );

  return (
    <BrandContext.Provider value={brand}>
      <StagesContext.Provider value={overview?.stages ?? []}>
        <AppShell
          brand={brand.businessName || 'Wappo'}
          subtitle={brand.tagline || 'WhatsApp lead console'}
          groups={groups}
          active={tab}
          onSelect={(id) => setTab(id as Tab)}
          sidebarFooter={sidebarFooter}
          topRight={topRight}
          title={PAGES[tab].title}
          description={PAGES[tab].description}
          banners={banners}
        >
          {tab === 'crm' && (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <Stat label="Total contacts" value={stats.total} icon={<Users className={ico} />} tone="info" />
              <Stat label="Fully qualified" value={stats.qualified} icon={<CheckCircle2 className={ico} />} tone="brand" />
              <Stat label="Bookings" value={stats.booked} icon={<Calendar className={ico} />} tone="violet" />
              <Stat label="In questionnaire" value={stats.inProgress} icon={<Clock className={ico} />} tone="warn" />
            </div>
          )}
          {tab === 'crm' && (
            <Crm contacts={contacts} includeTest={includeTest} onIncludeTest={setIncludeTest} onOpen={setSelected} onChanged={replaceContact} team={team} meId={user.id} />
          )}
          {tab === 'inbox' && <Inbox contacts={contacts} waReady={waReady} onChanged={replaceContact} />}
          {tab === 'simulator' && <Simulator onActivity={refresh} services={overview?.services ?? []} />}
          {tab === 'analytics' && !isAgent && <Analytics />}
          {tab === 'broadcasts' && !isAgent && overview && <Broadcasts overview={overview} waReady={waReady} />}
          {tab === 'config' && !isAgent && overview && <Settings overview={overview} me={user} onChanged={refresh} section={section} onSection={setSection} />}
        </AppShell>

        {selectedContact && (
          <Dossier
            contact={selectedContact}
            bookingUrl={overview?.workspace.bookingUrl ?? ''}
            team={team}
            onClose={() => setSelected(null)}
            onChanged={replaceContact}
          />
        )}
      </StagesContext.Provider>
    </BrandContext.Provider>
  );
}
