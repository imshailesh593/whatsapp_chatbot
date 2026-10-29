import { prisma } from '../lib/prisma';
import { accessState, planById } from '../plans';
import { waFor } from './whatsapp';

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

function days(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    out.push(dayKey(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const pctChange = (now: number, before: number) => (before === 0 ? (now > 0 ? 100 : 0) : Math.round(((now - before) / before) * 1000) / 10);

/** Everything on the platform admin dashboard. Money is reported in INR (paise); other currencies are listed separately. */
export async function platformDashboard(period: number) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (period - 1));
  const prevSince = new Date(since.getTime() - period * 86_400_000);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const yearAgo = new Date(monthStart);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 11);

  const [workspaces, users, newUsers, payments, sessions, convPeriod, messages, contacts] = await Promise.all([
    prisma.workspace.findMany({ select: { id: true, plan: true, planStatus: true, trialEndsAt: true, currentPeriodEnd: true, createdAt: true } }),
    prisma.adminUser.count(),
    prisma.adminUser.count({ where: { createdAt: { gte: since } } }),
    prisma.payment.findMany({ where: { createdAt: { gte: yearAgo }, status: 'paid' }, select: { amount: true, currency: true, createdAt: true } }),
    prisma.session.count(),
    prisma.session.findMany({ where: { createdAt: { gte: since }, NOT: { phoneNumber: { startsWith: 'SIM-' } } }, select: { createdAt: true } }),
    prisma.webhookLog.findMany({ where: { createdAt: { gte: since }, NOT: { phoneNumber: { startsWith: 'SIM-' } } }, select: { createdAt: true, direction: true } }),
    prisma.session.count({ where: { NOT: { phoneNumber: { startsWith: 'SIM-' } } } })
  ]);

  const paid = workspaces.filter((w) => planById(w.plan) && w.planStatus === 'active' && accessState(w).active);
  const mrr = paid.reduce((s, w) => s + (planById(w.plan)?.price.INR ?? 0), 0);
  const inr = payments.filter((p) => p.currency === 'INR');
  const otherCurrencies: Record<string, number> = {};
  for (const p of payments) if (p.currency !== 'INR' && p.createdAt >= monthStart) otherCurrencies[p.currency] = (otherCurrencies[p.currency] ?? 0) + p.amount;

  const revenuePeriod = inr.filter((p) => p.createdAt >= since).reduce((s, p) => s + p.amount, 0);
  const paymentsThisMonth = inr.filter((p) => p.createdAt >= monthStart).reduce((s, p) => s + p.amount, 0);

  const dayList = days(period);
  const blank = () => Object.fromEntries(dayList.map((d) => [d, 0])) as Record<string, number>;
  const revenueDaily = blank();
  for (const p of inr) if (revenueDaily[dayKey(p.createdAt)] !== undefined) revenueDaily[dayKey(p.createdAt)] += p.amount;
  const newClientsDaily = blank();
  for (const w of workspaces) if (newClientsDaily[dayKey(w.createdAt)] !== undefined) newClientsDaily[dayKey(w.createdAt)]++;
  const inboundDaily = blank();
  const outboundDaily = blank();
  for (const m of messages) {
    const t = m.direction === 'INBOUND' ? inboundDaily : outboundDaily;
    if (t[dayKey(m.createdAt)] !== undefined) t[dayKey(m.createdAt)]++;
  }

  // last 12 calendar months of collected revenue
  const months: string[] = [];
  const mm = new Date(yearAgo);
  for (let i = 0; i < 12; i++) {
    months.push(monthKey(mm));
    mm.setUTCMonth(mm.getUTCMonth() + 1);
  }
  const monthly = Object.fromEntries(months.map((m) => [m, 0])) as Record<string, number>;
  for (const p of inr) if (monthly[monthKey(p.createdAt)] !== undefined) monthly[monthKey(p.createdAt)] += p.amount;

  const newClients = workspaces.filter((w) => w.createdAt >= since).length;
  const prevNewClients = workspaces.filter((w) => w.createdAt >= prevSince && w.createdAt < since).length;

  return {
    period,
    kpi: {
      mrr,
      arpu: paid.length ? Math.round(mrr / paid.length) : 0,
      revenue: revenuePeriod,
      paymentsThisMonth,
      otherCurrencies,
      activeSubscriptions: paid.length,
      trialing: workspaces.filter((w) => w.planStatus === 'trialing' && accessState(w).active).length,
      totalClients: workspaces.length,
      newClients,
      newClientsChange: pctChange(newClients, prevNewClients),
      totalUsers: users,
      newUsers,
      messages: messages.length,
      contacts,
      conversations: convPeriod.length,
      whatsappConnected: workspaces.filter((w) => waFor(w.id).status === 'ready').length,
      sessionsTotal: sessions
    },
    revenueDaily: dayList.map((d) => ({ label: d, value: revenueDaily[d] })),
    newClientsDaily: dayList.map((d) => ({ label: d, value: newClientsDaily[d] })),
    messagesDaily: dayList.map((d) => ({ label: d, inbound: inboundDaily[d], outbound: outboundDaily[d] })),
    monthlyRevenue: months.map((m) => ({ label: m, value: monthly[m] }))
  };
}
