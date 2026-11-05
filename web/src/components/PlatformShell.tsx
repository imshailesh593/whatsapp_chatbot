import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Briefcase, ClipboardList, CreditCard, FileText, LayoutDashboard, LogOut, Package, Receipt, Repeat, Settings as Cog, Users, MessageSquare, Banknote, TrendingUp, Building2, UserPlus, Ticket, Gift
} from 'lucide-react';
import { api } from '../api';
import { ago } from '../config';
import type { AdminUser, AffiliateAdmin, CouponInfo, PaymentsSetup, PlatformSettingsInfo } from '../types';
import Platform from './Platform';
import { AppShell, ThemeToggle, type NavGroup } from './ui';
import { KeysCard, PlanEditor } from './PlanSettings';

type View = 'dashboard' | 'clients' | 'subscriptions' | 'payments' | 'plans' | 'coupons' | 'affiliates' | 'audit' | 'settings';

const NAV: { id: View; label: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
  { id: 'clients', label: 'Client Management', icon: <Users className="w-[18px] h-[18px]" /> },
  { id: 'subscriptions', label: 'Subscriptions', icon: <CreditCard className="w-[18px] h-[18px]" /> },
  { id: 'payments', label: 'Payments', icon: <Receipt className="w-[18px] h-[18px]" /> },
  { id: 'plans', label: 'Plans', icon: <Package className="w-[18px] h-[18px]" /> },
  { id: 'coupons', label: 'Redeem codes', icon: <Ticket className="w-[18px] h-[18px]" /> },
  { id: 'affiliates', label: 'Affiliates', icon: <Gift className="w-[18px] h-[18px]" /> },
  { id: 'audit', label: 'Audit log', icon: <ClipboardList className="w-[18px] h-[18px]" /> },
  { id: 'settings', label: 'Settings', icon: <Cog className="w-[18px] h-[18px]" /> }
];

const GREEN = 'rgb(var(--brand))';
const inr = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
const money = (minor: number, cur: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(minor / 100);
const card = 'bg-card border border-line rounded-xl shadow-sm';

const PAGES: Record<View, string> = {
  dashboard: 'Overview of the whole platform: revenue, clients and activity.',
  clients: 'Every business on the platform. Open one to support it or change its plan.',
  subscriptions: 'Who is subscribed, through which provider, and when each plan renews.',
  payments: 'Every payment received, newest first.',
  plans: 'Edit the plan, its prices and its limits.',
  coupons: 'Codes that give a business a plan without a payment.',
  affiliates: 'The referral programme: who joined through whom and what is owed.',
  audit: 'A record of every change made here.',
  settings: 'Platform switches, payment and email keys.'
};

export default function PlatformShell({ user, onBusiness, onSignOut }: { user: AdminUser; onBusiness: () => void; onSignOut: () => void }) {
  const [view, setView] = useState<View>('dashboard');
  const groups: NavGroup[] = [
    { label: 'Platform', items: NAV.filter((n) => ['dashboard', 'clients', 'subscriptions', 'payments'].includes(n.id)).map((n) => ({ id: n.id, label: n.label, icon: n.icon })) },
    { label: 'Commerce', items: NAV.filter((n) => ['plans', 'coupons', 'affiliates'].includes(n.id)).map((n) => ({ id: n.id, label: n.label, icon: n.icon })) },
    { label: 'System', items: NAV.filter((n) => ['audit', 'settings'].includes(n.id)).map((n) => ({ id: n.id, label: n.label, icon: n.icon })) }
  ];
  const label = NAV.find((n) => n.id === view)?.label ?? '';
  return (
    <AppShell
      brand="Platform admin"
      subtitle="Wappo operator"
      groups={groups}
      active={view}
      onSelect={(id) => setView(id as View)}
      sidebarFooter={
        <div className="space-y-2">
          <button onClick={onBusiness} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-fg2 hover:bg-subtle transition">
            <Briefcase className="w-[18px] h-[18px] text-muted" /><span>My business</span>
          </button>
          <div className="flex items-center gap-2.5 px-3 pt-1">
            <span className="w-8 h-8 rounded-full bg-brand text-on-brand text-xs font-bold flex items-center justify-center">{user.email.slice(0, 2).toUpperCase()}</span>
            <div className="min-w-0"><div className="text-xs text-fg font-semibold truncate">System admin</div><div className="text-[11px] text-muted truncate">{user.email}</div></div>
          </div>
        </div>
      }
      topRight={
        <>
          <button onClick={onBusiness} className="hidden md:inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-card text-sm text-fg2 hover:border-line-strong transition whitespace-nowrap"><Briefcase className="w-3.5 h-3.5" /><span>My business</span></button>
          <ThemeToggle />
          <button onClick={onSignOut} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-card text-sm text-fg2 hover:border-line-strong transition whitespace-nowrap"><LogOut className="w-3.5 h-3.5" /><span className="hidden sm:inline">Log out</span></button>
        </>
      }
      title={label}
      description={PAGES[view]}
    >
      {view === 'dashboard' && <Dashboard />}
      {view === 'clients' && <Platform />}
      {view === 'subscriptions' && <Subscriptions />}
      {view === 'payments' && <Payments />}
      {view === 'plans' && <Plans />}
      {view === 'coupons' && <Coupons />}
      {view === 'affiliates' && <Affiliates />}
      {view === 'audit' && <AuditView />}
      {view === 'settings' && <PlatformSettings />}
    </AppShell>
  );
}

// ---------- Dashboard ----------

function Kpi({ label, value, sub, icon, delta }: { label: string; value: string | number; sub?: string; icon: ReactNode; delta?: number }) {
  return (
    <div className={card + ' p-4'}>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">{label}</p>
        <span className="w-8 h-8 rounded-lg bg-brand-soft text-brand-text flex items-center justify-center">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-fg mt-2">{value}</p>
      {delta !== undefined ? <p className={`text-[11px] mt-0.5 font-medium ${delta >= 0 ? 'text-brand-text' : 'text-danger'}`}>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% vs previous period</p> : sub ? <p className="text-[11px] text-muted mt-0.5">{sub}</p> : <p className="text-[11px] mt-0.5">&nbsp;</p>}
    </div>
  );
}

function Capacity({ c }: { c: { used: number; max: number; botRssMb: number; systemTotalMb: number; systemFreeMb: number } }) {
  const pct = Math.min(100, Math.round((c.used / c.max) * 100));
  const warn = pct >= 80;
  return (
    <div className={card + ' p-4 flex flex-wrap items-center gap-x-8 gap-y-3 ' + (warn ? 'border-warn-line bg-warn-soft' : '')}>
      <div className="min-w-[220px] flex-1">
        <div className="flex justify-between text-xs mb-1"><span className="font-semibold text-fg2">WhatsApp slots</span><span className="text-fg2">{c.used} of {c.max} in use</span></div>
        <div className="h-2 rounded-full bg-subtle overflow-hidden"><div className={'h-full ' + (pct >= 100 ? 'bg-danger' : warn ? 'bg-warn' : 'bg-brand')} style={{ width: Math.max(pct, 2) + '%' }} /></div>
      </div>
      <div className="text-xs text-fg2">Bot memory <strong>{c.botRssMb} MB</strong> · server free <strong>{c.systemFreeMb}</strong> of {c.systemTotalMb} MB</div>
      {warn && <div className="text-xs font-semibold text-warn">{pct >= 100 ? 'Full: new customers cannot link a number.' : 'Nearly full.'} Raise the limit in Settings once the server has room.</div>}
    </div>
  );
}

interface Point { label: string; value: number }

/** Bars with a value tooltip on hover, a 3-step y axis and sparse x labels. */
function BarChart({ data, format = (n: number) => String(n), color = GREEN, empty = 'No data in this period' }: { data: Point[]; format?: (n: number) => string; color?: string; empty?: string }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const [hover, setHover] = useState<number | null>(null);
  if (max === 0) return <div className="h-44 flex items-center justify-center text-xs text-muted">{empty}</div>;
  const ticks = [max, max / 2, 0];
  const step = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div>
      <div className="flex">
        <div className="flex flex-col justify-between h-44 pr-2 text-[10px] text-muted text-right w-12">{ticks.map((t, i) => <span key={i}>{format(Math.round(t))}</span>)}</div>
        <div className="flex-1 relative h-44 border-b border-l border-line flex items-end gap-[2px] px-1" onMouseLeave={() => setHover(null)}>
          {[0.5].map((g) => <div key={g} className="absolute left-0 right-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} />)}
          {data.map((d, i) => (
            <div key={d.label} className="flex-1 h-full flex items-end relative" onMouseEnter={() => setHover(i)}>
              <div className="w-full rounded-t" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 3 : 0, background: color, opacity: hover === null || hover === i ? 1 : 0.55 }} />
              {hover === i && <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-10 bg-fg text-fg text-[10px] rounded px-2 py-1 whitespace-nowrap">{d.label}: {format(d.value)}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="flex pl-12 pr-1 text-[10px] text-muted mt-1">{data.map((d, i) => <span key={d.label} className="flex-1 relative h-3">{i % step === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{d.label.slice(5) || d.label}</span>}</span>)}</div>
    </div>
  );
}

function LineChart({ data, format = (n: number) => String(n) }: { data: Point[]; format?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const [hover, setHover] = useState<number | null>(null);
  if (max === 0) return <div className="h-44 flex items-center justify-center text-xs text-muted">No payments recorded yet</div>;
  const W = 600, H = 170, pad = 6;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  return (
    <div>
      <div className="flex">
        <div className="flex flex-col justify-between h-44 pr-2 text-[10px] text-muted text-right w-14">{[max, max / 2, 0].map((t, i) => <span key={i}>{format(Math.round(t))}</span>)}</div>
        <div className="flex-1 relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
            {[0, 0.5, 1].map((g) => <line key={g} x1={0} x2={W} y1={H - pad - g * (H - pad * 2)} y2={H - pad - g * (H - pad * 2)} stroke="#e2e8f0" strokeDasharray="3 3" />)}
            <path d={path} fill="none" stroke={GREEN} strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {data.map((d, i) => <rect key={i} x={x(i) - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />)}
            {hover !== null && <circle cx={x(hover)} cy={y(data[hover].value)} r={4} fill={GREEN} stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          </svg>
          {hover !== null && <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-fg text-fg text-[10px] rounded px-2 py-1 whitespace-nowrap">{data[hover].label}: {format(data[hover].value)}</div>}
        </div>
      </div>
      <div className="flex pl-14 text-[10px] text-muted mt-1 justify-between"><span>{data[0].label}</span><span>{data[data.length - 1].label}</span></div>
    </div>
  );
}

interface DashboardData {
  period: number;
  capacity: { used: number; max: number; botRssMb: number; systemTotalMb: number; systemFreeMb: number };
  kpi: Record<string, any>;
  revenueDaily: Point[];
  newClientsDaily: Point[];
  messagesDaily: { label: string; inbound: number; outbound: number }[];
  monthlyRevenue: Point[];
}

function Dashboard() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setD(null);
    api.platformDashboard(days).then(setD).catch((e) => setError((e as Error).message));
  }, [days]);
  const messages = useMemo(() => d?.messagesDaily.map((m) => ({ label: m.label, value: m.inbound + m.outbound })) ?? [], [d]);
  if (!d) return <p className="text-sm text-muted">{error || 'Loading…'}</p>;
  const k = d.kpi;
  const other = Object.entries(k.otherCurrencies as Record<string, number>).map(([c, v]) => money(v, c)).join(' · ');

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg border border-line bg-card p-1">
          {[7, 30, 90].map((n) => <button key={n} onClick={() => setDays(n)} className={`px-3.5 py-1.5 rounded-md text-sm font-semibold ${days === n ? 'bg-brand text-on-brand' : 'text-fg2 hover:bg-subtle'}`}>{n}d</button>)}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi label="MRR" value={inr(k.mrr)} sub={`ARPU ${inr(k.arpu)}`} icon={<Banknote className="w-4 h-4" />} />
        <Kpi label="Revenue" value={inr(k.revenue)} sub={`last ${days} days`} icon={<TrendingUp className="w-4 h-4" />} />
        <Kpi label="Payments this month" value={inr(k.paymentsThisMonth)} sub={other || undefined} icon={<Receipt className="w-4 h-4" />} />
        <Kpi label="Active subscriptions" value={k.activeSubscriptions} sub="paying clients" icon={<CreditCard className="w-4 h-4" />} />
        <Kpi label="Total clients" value={k.totalClients} sub={`${k.whatsappConnected} WhatsApp linked`} icon={<Building2 className="w-4 h-4" />} />
        <Kpi label="New clients" value={k.newClients} delta={k.newClientsChange} icon={<UserPlus className="w-4 h-4" />} />
        <Kpi label="Total users" value={k.totalUsers} sub={`+${k.newUsers} this period`} icon={<Users className="w-4 h-4" />} />
        <Kpi label="Messages" value={k.messages} sub={`last ${days} days`} icon={<MessageSquare className="w-4 h-4" />} />
        <Kpi label="Contacts" value={k.contacts} icon={<ClipboardList className="w-4 h-4" />} />
        <Kpi label="Conversations" value={k.conversations} sub={`started in the last ${days} days`} icon={<Repeat className="w-4 h-4" />} />
      </div>

      <Capacity c={d.capacity} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className={card + ' p-5'}><h3 className="font-bold text-fg">Revenue by month</h3><p className="text-xs text-muted mb-3">Payments collected, last 12 months (₹)</p><LineChart data={d.monthlyRevenue} format={inr} /></div>
        <div className={card + ' p-5'}><h3 className="font-bold text-fg">Revenue</h3><p className="text-xs text-muted mb-3">Last {days} days (₹)</p><BarChart data={d.revenueDaily} format={inr} empty="No payments in this period" /></div>
        <div className={card + ' p-5'}><h3 className="font-bold text-fg">New clients</h3><p className="text-xs text-muted mb-3">Last {days} days</p><BarChart data={d.newClientsDaily} empty="No new clients in this period" /></div>
        <div className={card + ' p-5'}><h3 className="font-bold text-fg">Messages</h3><p className="text-xs text-muted mb-3">Sent and received across all clients, last {days} days</p><BarChart data={messages} empty="No messages in this period" /></div>
      </div>
    </div>
  );
}

// ---------- lists ----------

function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className={card + ' overflow-x-auto'}>
      <table className="w-full text-left text-sm">
        <thead className="bg-sunken text-muted text-[11px] uppercase tracking-wider"><tr>{head.map((h) => <th key={h} className="py-3 px-4 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && <p className="p-6 text-center text-sm text-muted">{empty}</p>}
    </div>
  );
}

function Subscriptions() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.platformSubscriptions>> | null>(null);
  useEffect(() => { api.platformSubscriptions().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <Table head={['Business', 'Owner', 'Plan', 'Status', 'Billed via', 'Renews / ends', 'Price']} empty={rows.length === 0 ? 'No paid subscriptions yet.' : undefined}>
      {rows.map((s) => (
        <tr key={s.id}>
          <td className="py-3 px-4 font-semibold text-fg">{s.business}</td><td className="py-3 px-4 text-fg2">{s.owner ?? '—'}</td>
          <td className="py-3 px-4 capitalize">{s.plan}</td>
          <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s.access === 'ok' ? 'bg-brand-soft text-brand-text' : 'bg-danger-soft text-danger'}`}>{s.cancelAtPeriodEnd ? 'cancelling' : s.access === 'ok' ? s.status : s.access.replace('_', ' ')}</span></td>
          <td className="py-3 px-4 text-fg2">{s.provider ?? 'granted manually'}</td>
          <td className="py-3 px-4 text-fg2">{s.renews ? new Date(s.renews).toLocaleDateString() : '—'}</td>
          <td className="py-3 px-4">{inr(s.priceInr)}/mo</td>
        </tr>
      ))}
    </Table>
  );
}

function Payments() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.platformPayments>> | null>(null);
  useEffect(() => { api.platformPayments().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <Table head={['Date', 'Business', 'Plan', 'Provider', 'Amount', 'Status']} empty={rows.length === 0 ? 'No payments yet. They appear here when Stripe, Razorpay or PayPal report a charge.' : undefined}>
      {rows.map((p) => (
        <tr key={p.id}><td className="py-3 px-4 text-fg2">{new Date(p.at).toLocaleString()}</td><td className="py-3 px-4 font-semibold text-fg">{p.business}</td><td className="py-3 px-4 capitalize">{p.plan || '—'}</td><td className="py-3 px-4 text-fg2">{p.provider}</td><td className="py-3 px-4">{money(p.amount, p.currency)}</td><td className="py-3 px-4"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-soft text-brand-text">{p.status}</span></td></tr>
      ))}
    </Table>
  );
}

function Plans() {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.platformPlans>> | null>(null);
  useEffect(() => { api.platformPlans().then(setD).catch(() => undefined); }, []);
  if (!d) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="space-y-3">
      <Table head={['Plan', 'Price / month', 'Chats', 'AI answers', 'Team', 'Broadcasts', 'Webhooks & API', 'Clients']}>
        {d.plans.map((p) => (
          <tr key={p.id}><td className="py-3 px-4 font-semibold text-fg">{p.name}</td><td className="py-3 px-4">{inr(p.price.INR)} · {money(p.price.USD, 'USD')}</td><td className="py-3 px-4">{p.limits.conversations.toLocaleString()}</td><td className="py-3 px-4">{p.limits.aiReplies.toLocaleString()}</td><td className="py-3 px-4">{p.limits.seats}</td><td className="py-3 px-4">{p.limits.broadcasts.toLocaleString()}</td><td className="py-3 px-4">{p.integrations ? 'Yes' : 'No'}</td><td className="py-3 px-4 font-semibold">{p.clients}</td></tr>
        ))}
      </Table>
      <p className="text-xs text-muted">{d.internal} internal. Edit a plan below; payment providers need a new plan at the new price (Settings, Payments and email keys).</p>
      {d.plans.map((p) => <PlanEditor key={p.id} plan={p} onChanged={() => api.platformPlans().then(setD).catch(() => undefined)} />)}
    </div>
  );
}

function Coupons() {
  const [rows, setRows] = useState<CouponInfo[]>([]);
  const [plan, setPlan] = useState('pro');
  const [days, setDays] = useState('30');
  const [uses, setUses] = useState('1');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => api.platformCoupons().then(setRows).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setError('');
    setMsg('');
    try {
      const r = await api.platformCreateCoupon({ code: code.trim() || undefined, plan, days: Number(days), maxRedemptions: uses.trim() ? Number(uses) : null, note });
      setMsg(`Created ${r.code}`);
      setCode('');
      setNote('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); await load(); } catch (err) { setError((err as Error).message); }
  };
  const field = 'border border-line-strong rounded-lg px-3 py-2 text-sm';
  return (
    <div className="space-y-5">
      <div className={card + ' p-5'}>
        <h3 className="font-bold text-fg">New redeem code</h3>
        <p className="text-sm text-muted mt-1">Gives a business a plan with no payment. A business enters it under Plan &amp; billing. Use it for pilots, partners and goodwill.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-fg2">Plan<select value={plan} onChange={(e) => setPlan(e.target.value)} className={field + ' block mt-1'}>
            <option value="pro">Pro</option></select></label>
          <label className="text-xs text-fg2">Days<input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className={field + ' block mt-1 w-24'} /></label>
          <label className="text-xs text-fg2">Uses (empty = unlimited)<input type="number" min={1} value={uses} onChange={(e) => setUses(e.target.value)} className={field + ' block mt-1 w-32'} /></label>
          <label className="text-xs text-fg2">Code (empty = random)<input value={code} onChange={(e) => setCode(e.target.value)} maxLength={32} className={field + ' block mt-1 w-40 uppercase'} /></label>
          <label className="text-xs text-fg2">Note<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="who it is for" className={field + ' block mt-1 w-48'} /></label>
          <button onClick={create} className="px-4 py-2 bg-brand hover:bg-brand-strong text-on-brand text-sm font-semibold rounded-lg">Create</button>
        </div>
        {msg && <p className="text-sm text-brand-text mt-2">{msg}</p>}
        {error && <p className="text-sm text-danger mt-2" role="alert">{error}</p>}
      </div>
      <Table head={['Code', 'Gives', 'Used', 'Note', '']} empty={rows.length === 0 ? 'No codes yet.' : undefined}>
        {rows.map((c) => (
          <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
            <td className="py-3 px-4 font-mono font-semibold text-fg">{c.code}</td>
            <td className="py-3 px-4">{c.plan + ' · ' + c.days + ' days'}</td>
            <td className="py-3 px-4">{c.redeemed}{c.maxRedemptions ? ' / ' + c.maxRedemptions : ''}</td>
            <td className="py-3 px-4 text-fg2">{c.note}</td>
            <td className="py-3 px-4 text-right whitespace-nowrap">
              <button onClick={() => run(() => api.platformCouponActive(c.id, !c.active))} className="text-xs text-brand-text font-semibold mr-3">{c.active ? 'Disable' : 'Enable'}</button>
              <button onClick={() => window.confirm('Delete ' + c.code + '?') && run(() => api.platformDeleteCoupon(c.id))} className="text-xs text-danger font-semibold">Delete</button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Affiliates() {
  const [d, setD] = useState<AffiliateAdmin | null>(null);
  const [form, setForm] = useState({ percent: '20', months: '12' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api.platformAffiliates().then((x) => {
    setD(x);
    setForm({ percent: String(x.settings.percent), months: String(x.settings.months) });
  }).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, done = '') => {
    setError('');
    setMsg('');
    try { await fn(); if (done) setMsg(done); await load(); } catch (err) { setError((err as Error).message); }
  };
  if (!d) return <p className="text-sm text-muted">{error || 'Loading…'}</p>;
  const owed = (t: AffiliateAdmin['affiliates'][number]['totals']) => Object.entries(t).map(([c, v]) => `${money(v.pending + v.approved, c)} owed`).join(' · ') || '—';
  const paidOut = (t: AffiliateAdmin['affiliates'][number]['totals']) => Object.entries(t).map(([c, v]) => money(v.paid, c)).join(' · ') || '—';
  const field = 'border border-line-strong rounded-lg px-3 py-2 text-sm w-24 block mt-1';
  const act = 'text-xs font-semibold mr-3';
  return (
    <div className="space-y-5">
      <div className={card + ' p-5'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-fg">Referral programme</h3>
            <p className="text-sm text-muted mt-1">Every business gets a sign-up link. The referrer earns a share of the referred business&apos;s first payments. You approve each commission and pay it out yourself.</p>
          </div>
          <button onClick={() => run(() => api.platformAffiliateSettings({ enabled: !d.settings.enabled }))} className={`px-4 py-2 rounded-lg text-sm font-semibold ${d.settings.enabled ? 'bg-brand text-on-brand' : 'bg-subtle text-fg2'}`}>{d.settings.enabled ? 'On' : 'Off'}</button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-fg2">Commission %<input type="number" min={1} max={80} value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} className={field} /></label>
          <label className="text-xs text-fg2">For the first N payments<input type="number" min={1} max={60} value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} className={field} /></label>
          <button onClick={() => run(() => api.platformAffiliateSettings({ percent: Number(form.percent), months: Number(form.months) }), 'Saved')} className="px-4 py-2 bg-brand hover:bg-brand-strong text-on-brand text-sm font-semibold rounded-lg">Save</button>
        </div>
        {msg && <p className="text-sm text-brand-text mt-2">{msg}</p>}
        {error && <p className="text-sm text-danger mt-2" role="alert">{error}</p>}
      </div>

      <Table head={['Referrer', 'Referred', 'Owed', 'Paid out', 'Pay to']} empty={d.affiliates.length === 0 ? 'No referrals yet.' : undefined}>
        {d.affiliates.map((a) => (
          <tr key={a.id}><td className="py-3 px-4 font-semibold text-fg">{a.businessName} <span className="font-mono text-xs text-muted">{a.code}</span></td><td className="py-3 px-4">{a.referred}</td><td className="py-3 px-4">{owed(a.totals)}</td><td className="py-3 px-4">{paidOut(a.totals)}</td><td className="py-3 px-4 text-fg2">{a.payoutDetails || <span className="text-warn">not given yet</span>}</td></tr>
        ))}
      </Table>

      <h3 className="font-bold text-fg">Commissions</h3>
      <Table head={['When', 'Referrer', 'From', 'Amount', 'Status', '']} empty={d.commissions.length === 0 ? 'Nothing earned yet. Commissions appear when a referred business pays.' : undefined}>
        {d.commissions.map((c) => (
          <tr key={c.id}>
            <td className="py-3 px-4 text-fg2 whitespace-nowrap">{ago(c.at)}</td>
            <td className="py-3 px-4">{c.affiliate}<div className="text-xs text-muted">{c.payoutDetails}</div></td>
            <td className="py-3 px-4">{c.referred}</td>
            <td className="py-3 px-4 font-semibold">{money(c.amount, c.currency)}</td>
            <td className="py-3 px-4">{c.status}</td>
            <td className="py-3 px-4 text-right whitespace-nowrap">
              {c.status === 'pending' && <button onClick={() => run(() => api.platformCommissionStatus(c.id, 'approved'))} className={act + ' text-brand-text'}>Approve</button>}
              {c.status === 'approved' && <button onClick={() => window.confirm('Mark as paid? Do this after you have sent the money.') && run(() => api.platformCommissionStatus(c.id, 'paid'))} className={act + ' text-brand-text'}>Mark paid</button>}
              {(c.status === 'pending' || c.status === 'approved') && <button onClick={() => window.confirm('Void this commission?') && run(() => api.platformCommissionStatus(c.id, 'void'))} className={act + ' text-danger'}>Void</button>}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function AuditView() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.platformAudit>>>([]);
  useEffect(() => { api.platformAudit().then(setRows).catch(() => undefined); }, []);
  return (
    <Table head={['When', 'Who', 'Action', 'Detail']} empty={rows.length === 0 ? 'Nothing recorded yet.' : undefined}>
      {rows.map((a) => <tr key={a.id}><td className="py-3 px-4 text-fg2 whitespace-nowrap">{ago(a.at)}</td><td className="py-3 px-4">{a.actor}</td><td className="py-3 px-4 font-semibold text-fg">{a.action}</td><td className="py-3 px-4 text-fg2">{a.detail}</td></tr>)}
    </Table>
  );
}

// ---------- settings ----------

function PaymentsSetupCard() {
  const [d, setD] = useState<PaymentsSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (live: boolean) => {
    setBusy(true);
    setError('');
    try { setD(await api.platformPaymentsSetup(live)); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { load(false); }, [load]);
  const rows = (items: PaymentsSetup['razorpay']) => items.map((c) => (
    <li key={c.label} className="flex items-start gap-2 text-sm"><span className={c.ok ? 'text-brand-text' : 'text-danger'}>{c.ok ? '✓' : '✗'}</span><span><strong className="text-fg">{c.label}</strong> <span className="text-muted">{c.detail}</span></span></li>
  ));
  return (
    <div className={card + ' p-5'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-fg">Payments setup</h3>
          <p className="text-sm text-muted mt-1">Owners can pay online once the keys, webhook and plans below are all ticked. Keys live in the server <code>.env</code>, never in the browser.</p>
        </div>
        <button onClick={() => load(true)} disabled={busy} className="px-4 py-2 bg-brand hover:bg-brand-strong text-on-brand text-sm font-semibold rounded-lg disabled:opacity-50">{busy ? 'Checking…' : 'Check connections'}</button>
      </div>
      {error && <p className="text-sm text-danger mt-2" role="alert">{error}</p>}
      {d && (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Razorpay (₹) {d.razorpayReady ? <span className="text-brand-text normal-case">· ready</span> : <span className="text-warn normal-case">· not ready</span>}</h4>
            <ul className="space-y-1.5">{rows(d.razorpay)}</ul>
            <p className="text-xs text-muted mt-3">Webhook address to add in Razorpay: <code className="break-all">{d.razorpayWebhook}</code></p>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Stripe ($) {d.stripeReady ? <span className="text-brand-text normal-case">· ready</span> : <span className="text-warn normal-case">· not set up</span>}</h4>
            <ul className="space-y-1.5">{rows(d.stripe)}</ul>
            <p className="text-xs text-muted mt-3">Webhook address to add in Stripe: <code className="break-all">{d.stripeWebhook}</code></p>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">PayPal ($) {d.paypalReady ? <span className="text-brand-text normal-case">· ready</span> : <span className="text-warn normal-case">· not ready</span>}</h4>
            <ul className="space-y-1.5">{rows(d.paypal)}</ul>
            <p className="text-xs text-muted mt-3">Webhook address (registered for you by <code>paypalSetup</code>): <code className="break-all">{d.paypalWebhook}</code></p>
          </div>
        </div>
      )}
    </div>
  );
}

function PlatformSettings() {
  const [on, setOn] = useState<boolean | null>(null);
  const [cap, setCap] = useState<PlatformSettingsInfo | null>(null);
  const [maxInput, setMaxInput] = useState('');
  const [saved, setSaved] = useState('');
  const [wa, setWa] = useState<string>('…');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.platformSettings().then((s) => { setOn(s.platformSender); setCap(s); setMaxInput(String(s.max)); }).catch((e) => setError((e as Error).message));
    api.platformWorkspaces().then((w) => setWa(w.find((x) => x.id === 'default-workspace')?.whatsapp ?? 'off')).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function flip() {
    if (on === null) return;
    setError('');
    try {
      setOn((await api.platformSetSettings({ platformSender: !on })).platformSender);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveMax() {
    setError('');
    setSaved('');
    try {
      const s = await api.platformSetSettings({ maxConnections: Number(maxInput) });
      setCap(s);
      setMaxInput(String(s.max));
      setSaved('Saved');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className={card + ' p-5'}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-fg">Use my own WhatsApp number for platform messages</h3>
            <p className="text-sm text-muted mt-1">When on, lead alerts and follow-up reminders for every client are sent from <strong>your</strong> linked WhatsApp number instead of each client&rsquo;s own. Customer chats and broadcasts still use the client&rsquo;s number.</p>
            <p className="text-xs mt-2">Your number is currently: <strong className={wa === 'ready' ? 'text-brand-text' : 'text-warn'}>{wa === 'ready' ? 'connected' : wa}</strong>{wa !== 'ready' && ' (link it under My business → Bot & Settings; alerts are skipped while it is not connected)'}</p>
          </div>
          <button role="switch" aria-checked={!!on} onClick={flip} disabled={on === null}
            className={`relative w-12 h-7 rounded-full shrink-0 transition ${on ? 'bg-brand' : 'bg-line-strong'}`}>
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-card shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {error && <p className="text-sm text-danger mt-3" role="alert">{error}</p>}
      </div>
      {cap && (
        <div className={card + ' p-5'}>
          <h3 className="font-bold text-fg">How many WhatsApp numbers this server holds</h3>
          <p className="text-sm text-muted mt-1">Every linked number keeps a live session in memory (about 115 MB each). When all slots are used, new customers see a &ldquo;slots full&rdquo; message instead of a QR code, and you get an entry in the audit log. Customers who are already linked are never affected. Unscanned QR codes release their slot after 5 minutes.</p>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <input type="number" min={1} max={500} value={maxInput} onChange={(e) => setMaxInput(e.target.value)} className="w-24 border border-line-strong rounded-lg px-3 py-2 text-sm" />
            <button onClick={saveMax} className="px-4 py-2 bg-brand hover:bg-brand-strong text-on-brand text-sm font-semibold rounded-lg">Save limit</button>
            <span className="text-sm text-fg2">{cap.used} in use · server has {cap.systemFreeMb} MB free of {cap.systemTotalMb} MB</span>
            {saved && <span className="text-sm text-brand-text">{saved}</span>}
          </div>
        </div>
      )}
      <KeysCard />
      <PaymentsSetupCard />
      <p className="text-xs text-muted flex items-center space-x-1.5"><FileText className="w-3.5 h-3.5" /><span>Every change here is written to the audit log.</span></p>
    </div>
  );
}
