import { prisma } from '../lib/prisma';
import { getSetting, setSetting } from './settings';

export interface AffiliateSettings {
  enabled: boolean;
  /** Share of each payment, in percent */
  percent: number;
  /** A referred business earns the referrer commission on its first N payments */
  months: number;
}

const DEFAULTS: AffiliateSettings = { enabled: false, percent: 20, months: 12 };

export async function getAffiliateSettings(): Promise<AffiliateSettings> {
  return { ...DEFAULTS, ...(await getSetting<Partial<AffiliateSettings>>('affiliate', {})) };
}

const whole = (v: unknown, min: number, max: number, label: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  return n;
};

/** Validates and saves the programme rules. Throws a readable Error. */
export async function saveAffiliateSettings(body: Record<string, unknown>): Promise<AffiliateSettings> {
  const cur = await getAffiliateSettings();
  const next: AffiliateSettings = {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : cur.enabled,
    percent: body.percent === undefined ? cur.percent : whole(body.percent, 1, 80, 'Commission'),
    months: body.months === undefined ? cur.months : whole(body.months, 1, 60, 'Number of payments')
  };
  await setSetting('affiliate', next);
  return next;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 7 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const normalizeRef = (raw: unknown) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/** Every business has a referral code, created the first time it is needed. */
export async function ensureReferralCode(workspaceId: string): Promise<string> {
  const w = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { referralCode: true } });
  if (w.referralCode) return w.referralCode;
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    try {
      await prisma.workspace.update({ where: { id: workspaceId }, data: { referralCode: code } });
      return code;
    } catch {
      /* code already taken: try another */
    }
  }
  throw new Error('Could not create a referral code, please try again');
}

/** The business a sign-up link belongs to, or null (programme off, unknown code). */
export async function referrerFor(rawCode: unknown): Promise<string | null> {
  const code = normalizeRef(rawCode);
  if (!code || !(await getAffiliateSettings()).enabled) return null;
  return (await prisma.workspace.findUnique({ where: { referralCode: code }, select: { id: true } }))?.id ?? null;
}

/** Called when a payment is recorded: the referrer earns a share of the referred business's first N payments. */
export async function recordCommission(payment: { id: string; workspaceId: string; amount: number; currency: string; status: string }): Promise<void> {
  try {
    if (payment.status !== 'paid' || payment.amount <= 0) return;
    const s = await getAffiliateSettings();
    if (!s.enabled) return;
    const ws = await prisma.workspace.findUnique({ where: { id: payment.workspaceId }, select: { referredById: true, businessName: true } });
    if (!ws?.referredById || ws.referredById === payment.workspaceId) return;
    if (!(await prisma.workspace.findUnique({ where: { id: ws.referredById }, select: { id: true } }))) return;
    if ((await prisma.affiliateCommission.count({ where: { referredId: payment.workspaceId, status: { not: 'void' } } })) >= s.months) return;
    const amount = Math.floor((payment.amount * s.percent) / 100);
    if (amount <= 0) return;
    await prisma.affiliateCommission.create({
      data: { affiliateId: ws.referredById, referredId: payment.workspaceId, referredName: ws.businessName, paymentId: payment.id, amount, currency: payment.currency }
    });
  } catch (err) {
    // the same payment reported twice hits the unique paymentId: nothing to do
    if ((err as { code?: string }).code !== 'P2002') console.error('[affiliate] commission failed:', (err as Error).message);
  }
}

const mask = (name: string) => (name.length <= 3 ? name[0] + '…' : name.slice(0, 3) + '…');

type Totals = Record<string, { pending: number; approved: number; paid: number }>;
const addTotal = (t: Totals, currency: string, status: string, amount: number) => {
  if (status === 'void') return;
  t[currency] ??= { pending: 0, approved: 0, paid: 0 };
  t[currency][status as 'pending' | 'approved' | 'paid'] += amount;
};

/** What a business sees on its "Refer and earn" card. */
export async function referralOverview(workspaceId: string, publicUrl: string) {
  const [s, code, w] = await Promise.all([
    getAffiliateSettings(),
    ensureReferralCode(workspaceId),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { payoutDetails: true } })
  ]);
  const [referred, commissions] = await Promise.all([
    prisma.workspace.findMany({ where: { referredById: workspaceId }, select: { id: true, businessName: true, createdAt: true, planStatus: true, plan: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.affiliateCommission.findMany({ where: { affiliateId: workspaceId }, orderBy: { createdAt: 'desc' }, take: 100 })
  ]);
  const totals: Totals = {};
  for (const c of commissions) addTotal(totals, c.currency, c.status, c.amount);
  const paying = new Set(commissions.map((c) => c.referredId));
  return {
    enabled: s.enabled,
    percent: s.percent,
    months: s.months,
    code,
    link: `${publicUrl.replace(/\/$/, '')}/admin/?ref=${code}`,
    payoutDetails: w.payoutDetails,
    signedUp: referred.length,
    paying: paying.size,
    totals,
    referrals: referred.map((r) => ({ name: mask(r.businessName), joinedAt: r.createdAt.toISOString(), paying: paying.has(r.id) })),
    commissions: commissions.map((c) => ({ id: c.id, referred: mask(c.referredName), amount: c.amount, currency: c.currency, status: c.status, at: c.createdAt.toISOString(), paidAt: c.paidAt?.toISOString() ?? null }))
  };
}

/** The operator's view: every referrer with what they are owed. */
export async function affiliateAdminOverview() {
  const [settings, grouped, referredCounts, rows] = await Promise.all([
    getAffiliateSettings(),
    prisma.affiliateCommission.groupBy({ by: ['affiliateId', 'currency', 'status'], _sum: { amount: true } }),
    prisma.workspace.groupBy({ by: ['referredById'], where: { referredById: { not: null } }, _count: { _all: true } }),
    prisma.affiliateCommission.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { affiliate: { select: { businessName: true, payoutDetails: true } } } })
  ]);
  const ids = new Set<string>([...grouped.map((g) => g.affiliateId), ...referredCounts.map((r) => r.referredById!)]);
  const names = await prisma.workspace.findMany({ where: { id: { in: [...ids] } }, select: { id: true, businessName: true, referralCode: true, payoutDetails: true } });
  const affiliates = names.map((n) => {
    const totals: Totals = {};
    for (const g of grouped.filter((x) => x.affiliateId === n.id)) addTotal(totals, g.currency, g.status, g._sum.amount ?? 0);
    return { id: n.id, businessName: n.businessName, code: n.referralCode, payoutDetails: n.payoutDetails, referred: referredCounts.find((r) => r.referredById === n.id)?._count._all ?? 0, totals };
  });
  return {
    settings,
    affiliates,
    commissions: rows.map((c) => ({ id: c.id, affiliate: c.affiliate.businessName, payoutDetails: c.affiliate.payoutDetails, referred: c.referredName, amount: c.amount, currency: c.currency, status: c.status, at: c.createdAt.toISOString(), paidAt: c.paidAt?.toISOString() ?? null }))
  };
}

const NEXT: Record<string, string[]> = { pending: ['approved', 'void'], approved: ['paid', 'void'], paid: [], void: [] };

/** Moves a commission along pending → approved → paid (or void). Returns an error message or null. */
export async function setCommissionStatus(id: string, status: string): Promise<string | null> {
  const c = await prisma.affiliateCommission.findUnique({ where: { id } });
  if (!c) return 'Commission not found';
  if (!NEXT[c.status]?.includes(status)) return `A ${c.status} commission cannot be marked ${status}`;
  await prisma.affiliateCommission.update({ where: { id }, data: { status, paidAt: status === 'paid' ? new Date() : null } });
  return null;
}
