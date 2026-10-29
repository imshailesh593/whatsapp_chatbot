import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Prisma, SessionStage, Workspace } from '@prisma/client';
import { prisma } from './lib/prisma';
import {
  MIN_PASSWORD_LENGTH,
  authConfigured,
  bootstrapAdmin,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  readSession,
  signSession,
  verifyAgainstDummy,
  verifyPassword
} from './lib/auth';
import { createWorkspaceWithOwner } from './lib/workspaces';
import { handleIncomingMessage } from './services/engine';
import { captureReplies, sendTextMessage } from './services/transport';
import { invalidateConfig, loadConfig, saveServices, seedDefaultWorkspace, type BotConfig } from './services/botConfig';
import { onboardingAvailable, onboardingTurn, parseDraft, type ChatTurn, type Draft } from './services/onboarding';
import { TEMPLATES, getTemplate } from './templates';
import { SlotsFullError, connectionSlots, serverMemory, waFor } from './services/whatsapp';
import { PRODUCT_NAME } from './brand';
import { sendTestAlert, smtpConfigured } from './services/alerts';
import { getStages, saveStages, stageExists } from './services/pipeline';
import QRCode from 'qrcode';
import { analytics } from './services/analytics';
import { platformDashboard } from './services/platformStats';
import { getSetting, setSetting } from './services/settings';
import { cleanTags, logLeadEvent } from './services/crm';
import { EVENTS, assertPublicUrl, createApiKey, createWebhook, deliverDue, dispatchEvent, leadSnapshot } from './services/integrations';
import { createBroadcast, previewAudience, setStatus as setBroadcastStatus } from './services/broadcast';
import { transportReady } from './services/transport';
import { PLANS, accessState, currentPeriod, planById } from './plans';
import { createCoupon, grantPlan, redeemCoupon } from './services/coupons';
import { affiliateAdminOverview, getAffiliateSettings, referralOverview, referrerFor, saveAffiliateSettings, setCommissionStatus } from './services/affiliate';
import { authUrl, cancelAppointment, cleanRules, completeConnection, disconnect as disconnectCalendar, formatSlot, googleConfigured, readState } from './services/calendar';
import { getUsage } from './services/usage';
import { cancelSubscription, handleRazorpayWebhook, handleStripeWebhook, openPortal, providersAvailable, startCheckout } from './services/billing';

const SIM_PREFIX = 'SIM-';
const WEB_DIST = path.join(__dirname, '..', 'web', 'dist');

type Role = 'owner' | 'admin' | 'agent';

interface AdminCtx {
  id: string;
  email: string;
  workspaceId: string;
  role: Role;
  isSuperAdmin: boolean;
}

function cookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
}

type SessionWithLead = Prisma.SessionGetPayload<{ include: { lead: true } }>;

function toContact(s: SessionWithLead, cfg: BotConfig, owners: Map<string, string> = new Map()) {
  const lead = s.lead;
  const answers = ((lead ? lead.collectedData : s.answers) ?? {}) as Record<string, string>;
  const serviceKey = lead?.serviceCategory ?? s.selectedService ?? null;
  const service = serviceKey ? cfg.services.find((x) => x.key === serviceKey) : undefined;
  const total = service?.questions.length ?? 0;
  // Pipeline stage key once the questionnaire is complete; null while the customer is still answering
  const pipeline = lead ? lead.stageKey : null;
  const progress = lead ? 100 : total ? Math.round((s.currentStep / total) * 100) : 0;
  const locationKey = Object.keys(answers).find((k) => /country|location|city|destination/.test(k) && answers[k]);
  return {
    phone: s.phoneNumber,
    name: s.contactName,
    service: serviceKey,
    serviceTitle: service?.title ?? serviceKey,
    pipeline,
    ownerId: lead?.ownerId ?? null,
    ownerEmail: lead?.ownerId ? owners.get(lead.ownerId) ?? null : null,
    tags: lead?.tags ?? [],
    followUpAt: lead?.followUpAt?.toISOString() ?? null,
    source: s.source,
    stage: s.stage,
    step: s.currentStep,
    totalSteps: total,
    progress,
    targetCountry: locationKey ? answers[locationKey] : null,
    botActive: !s.isAgentPaused,
    handoffAt: s.handoffAt?.toISOString() ?? null,
    handoffSummary: s.handoffAt ? s.handoffSummary : '',
    answers: labelAnswers(answers, service?.questions),
    notes: lead?.counsellorNotes ?? null,
    hasLead: !!lead,
    receivedAt: (lead?.createdAt ?? s.createdAt).toISOString(),
    lastActivity: s.lastInteractionAt.toISOString(),
    isTest: s.phoneNumber.startsWith(SIM_PREFIX)
  };
}

/** Answers are stored by question key; keep the key (stable) and let the UI prettify it. */
const labelAnswers = (answers: Record<string, string>, _qs?: { key: string; prompt: string }[]) => answers;

const WS_FIELDS = [
  'industry',
  'businessName',
  'tagline',
  'description',
  'welcomeIntro',
  'formUrl',
  'bookingUrl',
  'bookingLabel',
  'bookingNote',
  'tone',
  'knowledge',
  'languages',
  'timezone',
  'notifyEmail',
  'notifyPhone',
  'handoffMessage'
] as const;
const WS_MAX: Record<(typeof WS_FIELDS)[number], number> = {
  industry: 60,
  businessName: 80,
  tagline: 120,
  description: 500,
  welcomeIntro: 300,
  formUrl: 300,
  bookingUrl: 300,
  bookingLabel: 80,
  bookingNote: 200,
  tone: 40,
  knowledge: 8000,
  languages: 80,
  timezone: 60,
  notifyEmail: 254,
  notifyPhone: 40,
  handoffMessage: 300
};
const URL_FIELDS = new Set(['formUrl', 'bookingUrl']);

function pickWorkspaceFields(body: Record<string, unknown>): { data: Partial<Record<(typeof WS_FIELDS)[number], string>> } | { error: string } {
  const data: Partial<Record<(typeof WS_FIELDS)[number], string>> = {};
  for (const f of WS_FIELDS) {
    if (body[f] === undefined) continue;
    let v = String(body[f] ?? '').replace(/\r/g, '').trim().slice(0, WS_MAX[f]);
    if (URL_FIELDS.has(f) && v) {
      if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
      try {
        new URL(v);
      } catch {
        return { error: `${f === 'formUrl' ? 'Form' : 'Booking'} link is not a valid URL` };
      }
    }
    if (f === 'businessName' && !v) return { error: 'Business name cannot be empty' };
    if (f === 'timezone' && v) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
      } catch {
        return { error: 'Time zone not recognised. Use a name like Asia/Kolkata or Europe/London' };
      }
    }
    data[f] = v;
  }
  return { data };
}

const publicWorkspace = (w: Workspace) => ({
  id: w.id,
  slug: w.slug,
  industry: w.industry,
  businessName: w.businessName,
  tagline: w.tagline,
  description: w.description,
  welcomeIntro: w.welcomeIntro,
  formUrl: w.formUrl,
  bookingUrl: w.bookingUrl,
  bookingLabel: w.bookingLabel,
  bookingNote: w.bookingNote,
  tone: w.tone,
  knowledge: w.knowledge,
  languages: w.languages,
  timezone: w.timezone,
  notifyEmail: w.notifyEmail,
  notifyPhone: w.notifyPhone,
  handoffEnabled: w.handoffEnabled,
  handoffMessage: w.handoffMessage,
  onboardingCompleted: w.onboardingCompleted,
  botEnabled: w.botEnabled
});

export function registerAdmin(app: FastifyInstance, opts: { getQr: (workspaceId: string) => Promise<string | null> }): void {
  const enabled = authConfigured();
  const attempts = new Map<string, { n: number; reset: number }>();
  const signups = new Map<string, { n: number; reset: number }>();

  // Accept an empty body with Content-Type: application/json (DELETE/POST without payload) instead of failing with 400
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    (_req as any).rawBody = body;
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      (err as any).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  (async () => {
    await bootstrapAdmin();
    await seedDefaultWorkspace();
  })().catch((e) => console.error('[admin] bootstrap failed:', e));

  const adminOf = async (req: FastifyRequest): Promise<AdminCtx | null> => {
    const uid = readSession(cookie(req, 'mns_admin'));
    const u = uid ? await prisma.adminUser.findUnique({ where: { id: uid } }) : null;
    return u ? { id: u.id, email: u.email, workspaceId: u.workspaceId, role: u.role as Role, isSuperAdmin: u.isSuperAdmin } : null;
  };
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!enabled) return reply.status(404).send();
    const admin = await adminOf(req);
    if (!admin) return reply.status(401).send({ error: 'unauthorized' });
    (req as any).admin = admin;
  };
  /** Owners and admins may change settings; agents only work leads and the inbox. */
  const manager = async (req: FastifyRequest, reply: FastifyReply) => {
    const denied = await guard(req, reply);
    if (denied) return denied;
    if (me(req).role === 'agent') return reply.status(403).send({ error: 'Your role cannot change settings' });
  };
  const ownerOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    const denied = await guard(req, reply);
    if (denied) return denied;
    if (me(req).role !== 'owner') return reply.status(403).send({ error: 'Only the account owner can manage billing' });
  };
  const superOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    const denied = await guard(req, reply);
    if (denied) return denied;
    if (!me(req).isSuperAdmin) return reply.status(403).send({ error: 'Platform admins only' });
  };
  const me = (req: FastifyRequest) => (req as any).admin as AdminCtx;
  const wsId = (req: FastifyRequest) => me(req).workspaceId;
  const secureFlag = (req: FastifyRequest) => (req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '');
  const setSession = (req: FastifyRequest, reply: FastifyReply, userId: string) =>
    reply.header('Set-Cookie', `mns_admin=${signSession(userId)}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=2592000${secureFlag(req)}`);
  const clientIp = (req: FastifyRequest) => String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0].trim();

  // Failed-login throttle per IP and per email (in memory; resets on restart)
  const throttled = (m: Map<string, { n: number; reset: number }>, k: string, max = 10) => {
    const a = m.get(k);
    return !!a && a.reset > Date.now() && a.n >= max;
  };
  const bump = (m: Map<string, { n: number; reset: number }>, k: string, windowMs = 15 * 60_000) => {
    const now = Date.now();
    const a = m.get(k);
    m.set(k, a && a.reset > now ? { n: a.n + 1, reset: a.reset } : { n: 1, reset: now + windowMs });
  };

  const meView = async (a: AdminCtx) => {
    const w = await prisma.workspace.findUnique({ where: { id: a.workspaceId } });
    return {
      id: a.id,
      email: a.email,
      role: a.role,
      isSuperAdmin: a.isSuperAdmin,
      workspace: w ? { id: w.id, businessName: w.businessName, onboardingCompleted: w.onboardingCompleted, botEnabled: w.botEnabled } : null
    };
  };

  // ---- auth ----
  // Public: the login screen has no workspace yet
  app.get('/admin/api/brand', async () => ({ productName: PRODUCT_NAME, signupEnabled: process.env.SIGNUP_ENABLED !== '0' }));

  app.post('/admin/api/login', async (req, reply) => {
    if (!enabled) return reply.status(404).send();
    const email = normalizeEmail((req.body as any)?.email);
    const password = String((req.body as any)?.password ?? '');
    const ip = clientIp(req);
    if (throttled(attempts, `ip:${ip}`) || throttled(attempts, `em:${email}`)) {
      return reply.status(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
    }
    const user = email ? await prisma.adminUser.findUnique({ where: { email } }) : null;
    const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);
    if (!user || !ok) {
      bump(attempts, `ip:${ip}`);
      bump(attempts, `em:${email}`);
      return reply.status(401).send({ error: 'Wrong email or password' });
    }
    await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    setSession(req, reply, user.id);
    return { ok: true, user: await meView({ id: user.id, email: user.email, workspaceId: user.workspaceId, role: user.role as Role, isSuperAdmin: user.isSuperAdmin }) };
  });

  // Self-service sign-up: creates a new workspace (paused until the owner goes live) and its owner
  app.post('/admin/api/signup', async (req, reply) => {
    if (!enabled || process.env.SIGNUP_ENABLED === '0') return reply.status(404).send();
    const b = (req.body ?? {}) as { businessName?: string; email?: string; password?: string; ref?: string };
    const ip = clientIp(req);
    if (throttled(signups, `ip:${ip}`, 5)) return reply.status(429).send({ error: 'Too many sign-ups from this network. Try again later.' });
    const businessName = String(b.businessName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const email = normalizeEmail(b.email);
    const password = String(b.password ?? '');
    if (!businessName) return reply.status(400).send({ error: 'Enter your business name' });
    if (!isValidEmail(email)) return reply.status(400).send({ error: 'Enter a valid email address' });
    if (password.length < MIN_PASSWORD_LENGTH) return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    if (await prisma.adminUser.findUnique({ where: { email } })) return reply.status(409).send({ error: 'An account with this email already exists. Sign in instead.' });
    bump(signups, `ip:${ip}`, 60 * 60_000);
    const referredById = await referrerFor(b.ref);
    const ws = await createWorkspaceWithOwner({ businessName, email, password, referredById, bonusTrialDays: (await getAffiliateSettings()).bonusDays });
    const owner = ws.adminUsers[0];
    setSession(req, reply, owner.id);
    return { ok: true, user: await meView({ id: owner.id, email, workspaceId: ws.id, role: 'owner', isSuperAdmin: false }) };
  });

  app.post('/admin/api/logout', async (_req, reply) => {
    reply.header('Set-Cookie', 'mns_admin=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0');
    return { ok: true };
  });

  app.get('/admin/api/me', async (req, reply) => {
    if (!enabled) return reply.status(404).send();
    const admin = await adminOf(req);
    return admin ? { authed: true, user: await meView(admin) } : { authed: false };
  });

  app.post('/admin/api/password', { preHandler: guard }, async (req, reply) => {
    const b = (req.body ?? {}) as { current?: string; next?: string };
    const next = String(b.next ?? '');
    if (next.length < MIN_PASSWORD_LENGTH) return reply.status(400).send({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    const user = await prisma.adminUser.findUnique({ where: { id: me(req).id } });
    if (!user || !(await verifyPassword(String(b.current ?? ''), user.passwordHash))) {
      return reply.status(403).send({ error: 'Current password is incorrect' });
    }
    await prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
    return { ok: true };
  });

  // ---- team (admin users of this workspace) ----
  app.get('/admin/api/admins', { preHandler: guard }, async (req) => {
    const rows = await prisma.adminUser.findMany({ where: { workspaceId: wsId(req) }, orderBy: { createdAt: 'asc' } });
    return {
      admins: rows.map((a) => ({
        id: a.id,
        email: a.email,
        role: a.role,
        createdAt: a.createdAt.toISOString(),
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null
      }))
    };
  });

  app.post('/admin/api/admins', { preHandler: manager }, async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string; role?: string };
    const email = normalizeEmail(b.email);
    const password = String(b.password ?? '');
    const role = b.role === 'agent' ? 'agent' : 'admin';
    const wsRow = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) } });
    const seatLimit = accessState(wsRow).limits.seats;
    if (seatLimit !== Infinity && (await prisma.adminUser.count({ where: { workspaceId: wsId(req) } })) >= seatLimit) {
      return reply.status(402).send({ error: `Your plan includes ${seatLimit} team members. Upgrade to add more.` });
    }
    if (!isValidEmail(email)) return reply.status(400).send({ error: 'Enter a valid email address' });
    if (password.length < MIN_PASSWORD_LENGTH) return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    if (await prisma.adminUser.findUnique({ where: { email } })) return reply.status(409).send({ error: 'That email is already registered' });
    const a = await prisma.adminUser.create({ data: { email, passwordHash: await hashPassword(password), workspaceId: wsId(req), role } });
    return { admin: { id: a.id, email: a.email, role: a.role } };
  });

  app.delete('/admin/api/admins/:id', { preHandler: manager }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === me(req).id) return reply.status(400).send({ error: 'You cannot remove your own account' });
    const target = await prisma.adminUser.findFirst({ where: { id, workspaceId: wsId(req) } });
    if (!target) return reply.status(404).send({ error: 'Team member not found' });
    if (target.role === 'owner' && me(req).role !== 'owner') return reply.status(403).send({ error: 'Only an owner can remove an owner' });
    await prisma.adminUser.delete({ where: { id } });
    return { ok: true };
  });

  // ---- billing ----
  const publicUrl = (req: FastifyRequest) =>
    process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
  const num = (n: number) => (n === Infinity ? null : n);

  // ---- refer and earn ----
  app.get('/admin/api/referral', { preHandler: guard }, async (req) => referralOverview(wsId(req), publicUrl(req)));
  app.put('/admin/api/referral', { preHandler: ownerOnly }, async (req) => {
    const details = String((req.body as any)?.payoutDetails ?? '').replace(/\r/g, '').trim().slice(0, 300);
    await prisma.workspace.update({ where: { id: wsId(req) }, data: { payoutDetails: details } });
    return { ok: true };
  });

  // ---- Google Calendar booking ----
  app.get('/admin/api/calendar', { preHandler: guard }, async (req) => {
    const w = wsId(req);
    const [cal, appts, ws] = await Promise.all([
      prisma.calendarConfig.findUnique({ where: { workspaceId: w } }),
      prisma.appointment.findMany({ where: { workspaceId: w, status: 'confirmed', startsAt: { gt: new Date(Date.now() - 86_400_000) } }, orderBy: { startsAt: 'asc' }, take: 50 }),
      prisma.workspace.findUniqueOrThrow({ where: { id: w }, select: { timezone: true } })
    ]);
    return {
      googleAvailable: googleConfigured(),
      connected: !!cal,
      email: cal?.googleEmail ?? '',
      timezone: ws.timezone,
      settings: cal ? { slotMinutes: cal.slotMinutes, bufferMinutes: cal.bufferMinutes, workDays: cal.workDays.split(',').map(Number), workStart: cal.workStart, workEnd: cal.workEnd, noticeHours: cal.noticeHours, daysAhead: cal.daysAhead, reminderHours: cal.reminderHours } : null,
      appointments: appts.map((a) => ({ id: a.id, phone: a.phoneNumber, name: a.name, startsAt: a.startsAt.toISOString(), when: formatSlot(a.startsAt, ws.timezone), past: a.startsAt.getTime() < Date.now() }))
    };
  });

  app.get('/admin/api/calendar/connect', { preHandler: manager }, async (req, reply) => {
    if (!googleConfigured()) return reply.status(400).send({ error: 'Google sign-in is not set up on this server yet. Ask the platform operator to add the Google keys.' });
    return { url: authUrl(wsId(req), publicUrl(req)) };
  });

  // Google sends the owner back here. No session cookie is needed: the signed state says which business it is.
  app.get('/admin/api/calendar/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const w = readState(String(q.state ?? ''));
    if (!w || q.error || !q.code) return reply.redirect('/admin/?calendar=denied');
    try {
      await completeConnection(w, q.code, publicUrl(req));
      await prisma.auditLog.create({ data: { actor: 'calendar', action: 'calendar.connect', workspaceId: w, detail: '' } }).catch(() => undefined);
      return reply.redirect('/admin/?calendar=connected');
    } catch (err) {
      console.error('[calendar] connect failed:', (err as Error).message);
      return reply.redirect('/admin/?calendar=error');
    }
  });

  app.put('/admin/api/calendar', { preHandler: manager }, async (req, reply) => {
    const cal = await prisma.calendarConfig.findUnique({ where: { workspaceId: wsId(req) } });
    if (!cal) return reply.status(409).send({ error: 'Connect Google Calendar first' });
    let data;
    try {
      data = cleanRules((req.body ?? {}) as Record<string, unknown>);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    if ((data.workStart ?? cal.workStart) >= (data.workEnd ?? cal.workEnd)) return reply.status(400).send({ error: 'Closing time must be after opening time' });
    await prisma.calendarConfig.update({ where: { workspaceId: wsId(req) }, data });
    return { ok: true };
  });

  app.post('/admin/api/calendar/disconnect', { preHandler: manager }, async (req) => {
    await disconnectCalendar(wsId(req));
    return { ok: true };
  });

  app.post('/admin/api/appointments/:id/cancel', { preHandler: manager }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const gone = await cancelAppointment(wsId(req), id);
    if (!gone) return reply.status(404).send({ error: 'Appointment not found' });
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) }, select: { timezone: true, businessName: true } });
    // Tell the customer, if the number is connected (best effort)
    if (waFor(wsId(req)).status === 'ready') {
      void sendTextMessage(wsId(req), gone.phoneNumber, `Your appointment with ${ws.businessName} on ${formatSlot(gone.startsAt, ws.timezone)} has been cancelled. Message us any time to book another.`).catch(() => undefined);
    }
    return { ok: true };
  });

  // A business owner redeems a code from the operator (free days or a plan without a payment)
  app.post('/admin/api/billing/redeem', { preHandler: manager }, async (req, reply) => {
    if (throttled(attempts, `rc:${wsId(req)}`, 10)) return reply.status(429).send({ error: 'Too many wrong codes. Try again in 15 minutes.' });
    const r = await redeemCoupon(wsId(req), (req.body as any)?.code);
    if (!r.ok) {
      bump(attempts, `rc:${wsId(req)}`);
      return reply.status(400).send({ error: r.error });
    }
    void audit(req, 'coupon.redeem', wsId(req), `${r.plan} for ${r.days} days`);
    return r;
  });

  app.get('/admin/api/billing', { preHandler: guard }, async (req) => {
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) } });
    const access = accessState(w);
    const [usage, seats, payments] = await Promise.all([
      getUsage(w.id),
      prisma.adminUser.count({ where: { workspaceId: w.id } }),
      prisma.payment.findMany({ where: { workspaceId: w.id }, orderBy: { createdAt: 'desc' }, take: 12 })
    ]);
    return {
      plan: w.plan,
      planName: planById(w.plan)?.name ?? (w.plan === 'internal' ? 'Internal' : 'Free trial'),
      status: w.planStatus,
      active: access.active,
      reason: access.reason,
      trialEndsAt: w.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: w.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: w.cancelAtPeriodEnd,
      provider: w.billingProvider,
      limits: { conversations: num(access.limits.conversations), aiReplies: num(access.limits.aiReplies), seats: num(access.limits.seats), broadcasts: num(access.limits.broadcasts) },
      usage: { ...usage, seats },
      providers: providersAvailable(),
      plans: PLANS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, price: p.price, limits: p.limits })),
      payments: payments.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, plan: p.plan, at: p.createdAt.toISOString() }))
    };
  });

  app.post('/admin/api/billing/checkout', { preHandler: ownerOnly }, async (req, reply) => {
    const b = (req.body ?? {}) as { plan?: string; provider?: string };
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) } });
    if (w.plan === 'internal') return reply.status(400).send({ error: 'This workspace is not billed' });
    if (b.provider !== 'stripe' && b.provider !== 'razorpay') return reply.status(400).send({ error: 'Choose a payment method' });
    try {
      return await startCheckout(w, String(b.plan), b.provider, me(req).email, publicUrl(req));
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/admin/api/billing/portal', { preHandler: ownerOnly }, async (req, reply) => {
    try {
      return await openPortal(await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) } }), publicUrl(req));
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/admin/api/billing/cancel', { preHandler: ownerOnly }, async (req, reply) => {
    try {
      await cancelSubscription(await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) } }));
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    return { ok: true };
  });

  // Provider webhooks (public; authenticated by signature over the raw body)
  app.post('/webhooks/stripe', async (req, reply) => {
    const r = await handleStripeWebhook((req as any).rawBody ?? '', req.headers['stripe-signature'] as string | undefined).catch((e) => {
      console.error('[stripe webhook]', e);
      return { status: 500, body: 'error' };
    });
    return reply.status(r.status).send(r.body);
  });
  app.post('/webhooks/razorpay', async (req, reply) => {
    const r = await handleRazorpayWebhook(
      (req as any).rawBody ?? '',
      req.headers['x-razorpay-signature'] as string | undefined,
      req.headers['x-razorpay-event-id'] as string | undefined
    ).catch((e) => {
      console.error('[razorpay webhook]', e);
      return { status: 500, body: 'error' };
    });
    return reply.status(r.status).send(r.body);
  });

  // ---- workspace settings ----
  app.get('/admin/api/overview', { preHandler: guard }, async (req) => {
    const cfg = await loadConfig(wsId(req));
    return {
      whatsapp: waFor(wsId(req)).status,
      workspace: publicWorkspace(cfg.ws),
      stages: await getStages(wsId(req)),
      services: cfg.services.map((s) => ({ id: s.key, title: s.title, keywords: s.keywords, questions: s.questions.map((q) => ({ key: q.key, prompt: q.prompt })) }))
    };
  });

  app.put('/admin/api/workspace', { preHandler: manager }, async (req, reply) => {
    const picked = pickWorkspaceFields((req.body ?? {}) as Record<string, unknown>);
    if ('error' in picked) return reply.status(400).send({ error: picked.error });
    const flag = (req.body as any)?.handoffEnabled;
    const w = await prisma.workspace.update({ where: { id: wsId(req) }, data: { ...picked.data, ...(typeof flag === 'boolean' ? { handoffEnabled: flag } : {}) } });
    invalidateConfig(w.id);
    return { workspace: publicWorkspace(w) };
  });

  app.put('/admin/api/services', { preHandler: manager }, async (req, reply) => {
    try {
      await saveServices(wsId(req), (req.body as any)?.services);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    const cfg = await loadConfig(wsId(req));
    return { services: cfg.services.map((s) => ({ id: s.key, title: s.title, keywords: s.keywords, questions: s.questions })) };
  });

  app.get('/admin/api/templates', { preHandler: guard }, async () => ({
    templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description, services: t.services.length }))
  }));

  app.post('/admin/api/templates/apply', { preHandler: manager }, async (req, reply) => {
    const t = getTemplate(String((req.body as any)?.id ?? ''));
    await saveServices(wsId(req), t.services);
    const w = await prisma.workspace.update({
      where: { id: wsId(req) },
      data: { industry: t.id, welcomeIntro: t.welcomeIntro, bookingLabel: t.bookingLabel }
    });
    invalidateConfig(w.id);
    return { workspace: publicWorkspace(w) };
  });

  // Go live / pause: a new workspace never replies to customers until the owner switches it on
  app.post('/admin/api/workspace/live', { preHandler: manager }, async (req) => {
    const botEnabled = !!(req.body as any)?.enabled;
    const w = await prisma.workspace.update({ where: { id: wsId(req) }, data: { botEnabled } });
    invalidateConfig(w.id);
    return { workspace: publicWorkspace(w) };
  });

  // ---- lead alerts ----
  app.get('/admin/api/alerts', { preHandler: guard }, async (req) => ({ emailAvailable: smtpConfigured(), whatsappReady: transportReady(wsId(req)) }));
  app.post('/admin/api/alerts/test', { preHandler: manager }, async (req) => {
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) } });
    return sendTestAlert(w.id, w.businessName);
  });

  // ---- AI onboarding assistant ----
  app.get('/admin/api/onboarding', { preHandler: guard }, async (req) => {
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) } });
    return { aiAvailable: onboardingAvailable(), completed: w.onboardingCompleted, businessName: w.businessName };
  });

  app.post('/admin/api/onboarding/chat', { preHandler: manager }, async (req, reply) => {
    if (!onboardingAvailable()) return reply.status(503).send({ error: 'The AI assistant is not available right now. Pick a template instead.' });
    const b = (req.body ?? {}) as { history?: ChatTurn[]; draft?: unknown };
    const history = (Array.isArray(b.history) ? b.history : [])
      .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
      .map((t) => ({ role: t.role, text: t.text }));
    const ip = clientIp(req);
    if (throttled(attempts, `ob:${wsId(req)}`, 120)) return reply.status(429).send({ error: 'Too many assistant requests, please wait a few minutes' });
    bump(attempts, `ob:${wsId(req)}`, 60 * 60_000);
    try {
      return await onboardingTurn(history, parseDraft(b.draft));
    } catch (err) {
      console.error('[onboarding] failed:', (err as Error).message, ip);
      return reply.status(502).send({ error: 'The assistant could not answer just now. Please try again.' });
    }
  });

  app.post('/admin/api/onboarding/apply', { preHandler: manager }, async (req, reply) => {
    const b = (req.body ?? {}) as { draft?: unknown; extras?: Record<string, unknown> };
    const draft: Draft | null = parseDraft(b.draft);
    if (!draft) return reply.status(400).send({ error: 'The proposed setup is incomplete. Ask the assistant to fix it.' });
    const extras = pickWorkspaceFields({ ...(b.extras ?? {}) });
    if ('error' in extras) return reply.status(400).send({ error: extras.error });
    await saveServices(wsId(req), draft.services);
    const picked = pickWorkspaceFields({
      industry: draft.industry,
      businessName: draft.businessName || undefined,
      tagline: draft.tagline,
      description: draft.description,
      welcomeIntro: draft.welcomeIntro,
      tone: draft.tone,
      languages: draft.languages,
      bookingLabel: draft.bookingLabel,
      bookingNote: draft.bookingNote,
      knowledge: draft.knowledge
    });
    if ('error' in picked) return reply.status(400).send({ error: picked.error });
    const w = await prisma.workspace.update({
      where: { id: wsId(req) },
      data: { ...picked.data, ...extras.data, onboarding: JSON.parse(JSON.stringify(draft)), onboardingCompleted: true }
    });
    invalidateConfig(w.id);
    return { workspace: publicWorkspace(w) };
  });

  app.post('/admin/api/onboarding/complete', { preHandler: manager }, async (req) => {
    const w = await prisma.workspace.update({ where: { id: wsId(req) }, data: { onboardingCompleted: true } });
    invalidateConfig(w.id);
    return { workspace: publicWorkspace(w) };
  });

  // ---- WhatsApp link (one per workspace) ----
  const waSnapshot = async (id: string) => ({ status: waFor(id).status, qr: await opts.getQr(id) });
  app.get('/admin/api/whatsapp', { preHandler: guard }, async (req, reply) => reply.header('Cache-Control', 'no-store').send(await waSnapshot(wsId(req))));
  app.post('/admin/api/whatsapp/connect', { preHandler: manager }, async (req, reply) => {
    try {
      await waFor(wsId(req)).connect();
    } catch (err) {
      if (err instanceof SlotsFullError) {
        console.warn(`[wa] slots full: ${wsId(req)} could not link a number`);
        void audit(req, 'wa.slots_full', wsId(req), 'a customer tried to link a number but all slots are used');
        return reply.status(503).send({ error: err.message });
      }
      throw err;
    }
    return waSnapshot(wsId(req));
  });
  app.post('/admin/api/whatsapp/disconnect', { preHandler: manager }, async (req) => {
    await waFor(wsId(req)).disconnect();
    return waSnapshot(wsId(req));
  });

  // ---- pipeline stages ----
  app.get('/admin/api/stages', { preHandler: guard }, async (req) => ({ stages: await getStages(wsId(req)) }));
  app.put('/admin/api/stages', { preHandler: manager }, async (req, reply) => {
    try {
      return { stages: await saveStages(wsId(req), (req.body as any)?.stages) };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // ---- analytics ----
  app.get('/admin/api/analytics', { preHandler: manager }, async (req) => {
    const d = parseInt(String((req.query as any).days ?? '30'), 10);
    return analytics(wsId(req), [7, 30, 90].includes(d) ? d : 30);
  });

  // ---- integrations: webhooks, API keys, click-to-chat ----
  const needIntegrations = async (req: FastifyRequest, reply: FastifyReply) => {
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) } });
    if (!accessState(w).integrations) {
      reply.status(402).send({ error: 'Webhooks and the API are available on Growth and Scale plans. Upgrade in Settings.' });
      return true;
    }
    return false;
  };
  const hookView = (h: any) => ({ id: h.id, url: h.url, events: h.events, active: h.active, secret: h.secret, createdAt: h.createdAt.toISOString() });

  app.get('/admin/api/integrations', { preHandler: manager }, async (req) => {
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId(req) } });
    const [hooks, keys] = await Promise.all([
      prisma.webhook.findMany({ where: { workspaceId: w.id }, orderBy: { createdAt: 'asc' }, include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
      prisma.apiKey.findMany({ where: { workspaceId: w.id }, orderBy: { createdAt: 'asc' } })
    ]);
    return {
      enabled: accessState(w).integrations,
      events: EVENTS,
      phone: waFor(w.id).phone,
      webhooks: hooks.map((h) => ({ ...hookView(h), last: h.deliveries[0] ? { status: h.deliveries[0].status, error: h.deliveries[0].error, at: h.deliveries[0].createdAt.toISOString() } : null })),
      apiKeys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() }))
    };
  });

  app.post('/admin/api/webhooks', { preHandler: manager }, async (req, reply) => {
    if (await needIntegrations(req, reply)) return;
    try {
      return { webhook: hookView(await createWebhook(wsId(req), (req.body ?? {}) as any)) };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.patch('/admin/api/webhooks/:id', { preHandler: manager }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { active?: boolean; events?: string[] };
    const h = await prisma.webhook.findFirst({ where: { id, workspaceId: wsId(req) } });
    if (!h) return reply.status(404).send({ error: 'Webhook not found' });
    const events = Array.isArray(b.events) ? b.events.filter((e) => (EVENTS as readonly string[]).includes(e)) : undefined;
    if (events && events.length === 0) return reply.status(400).send({ error: 'Choose at least one event' });
    return { webhook: hookView(await prisma.webhook.update({ where: { id }, data: { ...(typeof b.active === 'boolean' ? { active: b.active } : {}), ...(events ? { events } : {}) } })) };
  });

  app.delete('/admin/api/webhooks/:id', { preHandler: manager }, async (req, reply) => {
    const r = await prisma.webhook.deleteMany({ where: { id: (req.params as { id: string }).id, workspaceId: wsId(req) } });
    return r.count ? { ok: true } : reply.status(404).send({ error: 'Webhook not found' });
  });

  app.get('/admin/api/webhooks/:id/deliveries', { preHandler: manager }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.webhook.findFirst({ where: { id, workspaceId: wsId(req) } }))) return reply.status(404).send({ error: 'Webhook not found' });
    const rows = await prisma.webhookDelivery.findMany({ where: { webhookId: id }, orderBy: { createdAt: 'desc' }, take: 20 });
    return { deliveries: rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, responseCode: d.responseCode, error: d.error, at: d.createdAt.toISOString() })) };
  });

  // Sends a sample "lead.created" so the owner can see their receiver working (uses their newest real lead, or sample data)
  app.post('/admin/api/webhooks/:id/test', { preHandler: manager }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const h = await prisma.webhook.findFirst({ where: { id, workspaceId: wsId(req) } });
    if (!h) return reply.status(404).send({ error: 'Webhook not found' });
    try {
      await assertPublicUrl(h.url);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    const latest = await prisma.lead.findFirst({ where: { workspaceId: wsId(req), phoneNumber: { not: { startsWith: 'SIM-' } } }, orderBy: { createdAt: 'desc' }, select: { sessionId: true } });
    const lead = latest ? await leadSnapshot(wsId(req), latest.sessionId) : null;
    const payload = {
      id: 'test-' + Date.now(), event: 'lead.created', test: true, createdAt: new Date().toISOString(), workspace: { id: wsId(req) },
      lead: lead ?? { phone: '910000000000', name: 'Sample Customer', service: 'Sample service', answers: { 'What do you need?': 'A sample answer' }, stage: 'new', stageLabel: 'New lead', source: null, notes: null, createdAt: new Date().toISOString() }
    };
    const d = await prisma.webhookDelivery.create({ data: { webhookId: id, event: 'lead.created', payload: payload as any } });
    await deliverDue();
    const done = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    return { status: done.status, responseCode: done.responseCode, error: done.error };
  });

  app.post('/admin/api/api-keys', { preHandler: manager }, async (req, reply) => {
    if (await needIntegrations(req, reply)) return;
    try {
      const { row, key } = await createApiKey(wsId(req), (req.body as any)?.name);
      return { key, apiKey: { id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt.toISOString(), lastUsedAt: null } };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });
  app.delete('/admin/api/api-keys/:id', { preHandler: manager }, async (req, reply) => {
    const r = await prisma.apiKey.deleteMany({ where: { id: (req.params as { id: string }).id, workspaceId: wsId(req) } });
    return r.count ? { ok: true } : reply.status(404).send({ error: 'Key not found' });
  });

  // QR code for a click-to-chat link
  app.post('/admin/api/chat-link/qr', { preHandler: guard }, async (req, reply) => {
    const url = String((req.body as any)?.url ?? '');
    if (!/^https:\/\/wa\.me\//.test(url) || url.length > 600) return reply.status(400).send({ error: 'Not a WhatsApp link' });
    return { qr: await QRCode.toDataURL(url, { width: 320, margin: 1 }) };
  });

  // ---- broadcasts ----
  const broadcastView = (b: any) => ({
    id: b.id, name: b.name, text: b.text, status: b.status, note: b.note, total: b.total, sent: b.sent, failed: b.failed,
    filters: b.filters, scheduledAt: b.scheduledAt?.toISOString() ?? null, startedAt: b.startedAt?.toISOString() ?? null,
    finishedAt: b.finishedAt?.toISOString() ?? null, createdAt: b.createdAt.toISOString(), createdBy: b.createdBy
  });
  app.get('/admin/api/broadcasts', { preHandler: manager }, async (req) => ({
    broadcasts: (await prisma.broadcast.findMany({ where: { workspaceId: wsId(req) }, orderBy: { createdAt: 'desc' }, take: 50 })).map(broadcastView)
  }));
  app.post('/admin/api/broadcasts/audience', { preHandler: manager }, async (req) => previewAudience(wsId(req), (req.body as any)?.filters));
  app.post('/admin/api/broadcasts', { preHandler: manager }, async (req, reply) => {
    try {
      return { broadcast: broadcastView(await createBroadcast(wsId(req), me(req).email, (req.body ?? {}) as any)) };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });
  app.get('/admin/api/broadcasts/:id', { preHandler: manager }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await prisma.broadcast.findFirst({ where: { id, workspaceId: wsId(req) } });
    if (!b) return reply.status(404).send({ error: 'Broadcast not found' });
    const recipients = await prisma.broadcastRecipient.findMany({ where: { broadcastId: id }, orderBy: { id: 'asc' }, take: 200 });
    return { broadcast: broadcastView(b), recipients: recipients.map((r) => ({ phone: r.phone, name: r.name, status: r.status, error: r.error, sentAt: r.sentAt?.toISOString() ?? null })) };
  });
  app.post('/admin/api/broadcasts/:id/:action', { preHandler: manager }, async (req, reply) => {
    const { id, action } = req.params as { id: string; action: string };
    if (!['start', 'pause', 'resume', 'cancel'].includes(action)) return reply.status(404).send();
    try {
      return { broadcast: broadcastView(await setBroadcastStatus(wsId(req), id, action as any)) };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  const ownerMap = async (workspaceId: string) =>
    new Map((await prisma.adminUser.findMany({ where: { workspaceId }, select: { id: true, email: true } })).map((u) => [u.id, u.email] as const));

  // ---- contacts / leads ----
  app.get('/admin/api/contacts/:phone/events', { preHandler: guard }, async (req) => {
    const { phone } = req.params as { phone: string };
    const lead = await prisma.lead.findFirst({ where: { workspaceId: wsId(req), phoneNumber: phone }, select: { id: true } });
    const rows = lead ? await prisma.leadEvent.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: 'desc' }, take: 50 }) : [];
    return { events: rows.map((e) => ({ id: e.id, type: e.type, detail: e.detail, actor: e.actor, at: e.createdAt.toISOString() })) };
  });

  app.get('/admin/api/contacts', { preHandler: guard }, async (req) => {
    const includeTest = (req.query as any).test === '1';
    const cfg = await loadConfig(wsId(req));
    const sessions = await prisma.session.findMany({
      where: { workspaceId: wsId(req), ...(includeTest ? {} : { phoneNumber: { not: { startsWith: SIM_PREFIX } } }) },
      include: { lead: true },
      orderBy: { lastInteractionAt: 'desc' },
      take: 1000
    });
    const owners = await ownerMap(wsId(req));
    return { contacts: sessions.map((s) => toContact(s, cfg, owners)) };
  });

  app.get('/admin/api/contacts/:phone/messages', { preHandler: guard }, async (req) => {
    const { phone } = req.params as { phone: string };
    const rows = await prisma.webhookLog.findMany({
      where: { workspaceId: wsId(req), phoneNumber: phone },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    return {
      messages: rows
        .reverse()
        .map((r) => ({ id: r.id, direction: r.direction, text: (r.payload as any)?.text ?? '', at: r.createdAt.toISOString() }))
    };
  });

  app.patch('/admin/api/contacts/:phone', { preHandler: guard }, async (req, reply) => {
    const { phone } = req.params as { phone: string };
    const w = wsId(req);
    const key = { workspaceId_phoneNumber: { workspaceId: w, phoneNumber: phone } };
    const b = (req.body ?? {}) as { paused?: boolean; notes?: string; stage?: string; ownerId?: string | null; tags?: unknown; followUpAt?: string | null };
    const session = await prisma.session.findUnique({ where: key, include: { lead: true } });
    if (!session) return reply.status(404).send({ error: 'Contact not found' });

    if (typeof b.paused === 'boolean') {
      // Switching the bot back on ends a hand-off
      await prisma.session.update({ where: key, data: b.paused ? { isAgentPaused: true } : { isAgentPaused: false, handoffAt: null, handoffSummary: '' } });
    }
    const crmEdit = b.ownerId !== undefined || b.tags !== undefined || b.followUpAt !== undefined;
    if (b.notes !== undefined || b.stage !== undefined || crmEdit) {
      if (!session.lead) return reply.status(409).send({ error: 'Notes and stage can be set once the questionnaire is complete' });
      if (b.stage !== undefined && !(await stageExists(w, b.stage))) return reply.status(400).send({ error: 'Unknown pipeline stage' });
      const owners = await ownerMap(w);
      if (b.ownerId && !owners.has(b.ownerId)) return reply.status(400).send({ error: 'That person is not on your team' });
      let tags: string[] | undefined;
      try {
        if (b.tags !== undefined) tags = cleanTags(b.tags);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      let followUp: Date | null | undefined;
      if (b.followUpAt !== undefined) {
        followUp = b.followUpAt ? new Date(b.followUpAt) : null;
        if (followUp && isNaN(followUp.getTime())) return reply.status(400).send({ error: 'Invalid follow-up date' });
      }
      const data: Prisma.LeadUpdateInput = {};
      if (b.notes !== undefined) data.counsellorNotes = String(b.notes).slice(0, 4000) || null;
      if (b.stage !== undefined) data.stageKey = b.stage;
      if (b.ownerId !== undefined) data.ownerId = b.ownerId || null;
      if (tags) data.tags = tags;
      if (followUp !== undefined) {
        data.followUpAt = followUp;
        data.followUpNotified = false;
      }
      await prisma.lead.update({ where: { id: session.lead.id }, data });
      const lid = session.lead.id;
      const actor = me(req).email;
      if (b.stage !== undefined && b.stage !== session.lead.stageKey) void logLeadEvent(lid, w, 'stage', `${session.lead.stageKey} → ${b.stage}`, actor);
      if (b.ownerId !== undefined && (b.ownerId || null) !== session.lead.ownerId) void logLeadEvent(lid, w, 'owner', b.ownerId ? owners.get(b.ownerId)! : 'unassigned', actor);
      if (tags && tags.join() !== session.lead.tags.join()) void logLeadEvent(lid, w, 'tags', tags.join(', ') || 'none', actor);
      if (followUp !== undefined) void logLeadEvent(lid, w, 'follow_up', followUp ? followUp.toISOString() : 'cleared', actor);
      if (b.notes !== undefined && (String(b.notes).slice(0, 4000) || null) !== session.lead.counsellorNotes) void logLeadEvent(lid, w, 'note', 'notes updated', actor);
      if (b.stage !== undefined && b.stage !== session.lead.stageKey) void dispatchEvent(w, 'lead.stage_changed', session.id, { previousStage: session.lead.stageKey });
    }
    const fresh = await prisma.session.findUnique({ where: key, include: { lead: true } });
    return { contact: toContact(fresh!, await loadConfig(w), await ownerMap(w)) };
  });

  // Human reply from the Live Inbox. Only while the bot is paused for that chat, so it can't talk over the bot.
  app.post('/admin/api/contacts/:phone/send', { preHandler: guard }, async (req, reply) => {
    const { phone } = req.params as { phone: string };
    const w = wsId(req);
    const text = String((req.body as any)?.text ?? '').trim().slice(0, 4000);
    if (!text) return reply.status(400).send({ error: 'Message is empty' });
    if (phone.startsWith(SIM_PREFIX)) return reply.status(400).send({ error: 'Cannot message a simulator contact' });
    const session = await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: w, phoneNumber: phone } } });
    if (!session) return reply.status(404).send({ error: 'Contact not found' });
    if (!session.isAgentPaused) return reply.status(409).send({ error: 'Pause the bot for this chat before replying manually' });
    if (waFor(w).status !== 'ready') return reply.status(503).send({ error: 'WhatsApp is not connected' });
    try {
      await sendTextMessage(w, phone, text);
    } catch (err) {
      return reply.status(502).send({ error: `Could not send: ${(err as Error).message}` });
    }
    return { ok: true };
  });

  // ---- simulator: runs the real engine, delivers nothing ----
  const simPhone = (id: unknown) => SIM_PREFIX + String(id ?? 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);

  app.post('/admin/api/simulate', { preHandler: guard }, async (req, reply) => {
    const b = (req.body ?? {}) as { id?: string; name?: string; text?: string };
    const w = wsId(req);
    const text = String(b.text ?? '').trim().slice(0, 1000);
    if (!text) return reply.status(400).send({ error: 'Message is empty' });
    const phone = simPhone(b.id);
    const replies = await captureReplies(() => handleIncomingMessage(w, phone, b.name?.slice(0, 80) || 'Simulator User', text));
    const s = await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: w, phoneNumber: phone } } });
    const cfg = await loadConfig(w);
    return {
      replies,
      state: {
        stage: s?.stage ?? SessionStage.WELCOME,
        service: s?.selectedService ?? null,
        step: s?.currentStep ?? 0,
        totalSteps: cfg.services.find((x) => x.key === s?.selectedService)?.questions.length ?? 0
      }
    };
  });

  app.post('/admin/api/simulate/reset', { preHandler: guard }, async (req) => {
    const phone = simPhone((req.body as any)?.id);
    await prisma.webhookLog.deleteMany({ where: { workspaceId: wsId(req), phoneNumber: phone } });
    await prisma.session.deleteMany({ where: { workspaceId: wsId(req), phoneNumber: phone } });
    return { ok: true };
  });

  // ---- export ----
  app.get('/admin/api/export.csv', { preHandler: guard }, async (req, reply) => {
    const cfg = await loadConfig(wsId(req));
    const sessions = await prisma.session.findMany({
      where: { workspaceId: wsId(req), phoneNumber: { not: { startsWith: SIM_PREFIX } }, lead: { isNot: null } },
      include: { lead: true },
      orderBy: { createdAt: 'desc' }
    });
    // Neutralise spreadsheet formula injection from user-typed text
    const cell = (v: unknown) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const stageLabel = new Map((await getStages(wsId(req))).map((st) => [st.key, st.label]));
    const lines = ['Received,Name,Phone,Service,Stage,Notes,Answers'].concat(
      sessions.map((s) => {
        const c = toContact(s, cfg);
        return [
          c.receivedAt,
          c.name,
          c.phone,
          c.serviceTitle ?? '',
          c.pipeline ? stageLabel.get(c.pipeline) ?? c.pipeline : 'Answering',
          c.notes,
          Object.entries(c.answers).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' | ')
        ].map(cell).join(',');
      })
    );
    reply.header('Content-Disposition', 'attachment; filename="leads.csv"');
    return reply.type('text/csv; charset=utf-8').send('﻿' + lines.join('\r\n'));
  });

  // ---- platform admin (you): every business, plans, support tools ----
  const audit = (req: FastifyRequest, action: string, workspaceId: string | null, detail = '') =>
    prisma.auditLog.create({ data: { actor: me(req).email, action, workspaceId, detail: detail.slice(0, 300) } }).catch(() => undefined);

  app.get('/admin/api/super/dashboard', { preHandler: superOnly }, async (req) => {
    const d = parseInt(String((req.query as any).days ?? '30'), 10);
    return platformDashboard([7, 30, 90].includes(d) ? d : 30);
  });

  app.get('/admin/api/super/payments', { preHandler: superOnly }, async () => {
    const rows = await prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { workspace: { select: { businessName: true } } } });
    return { payments: rows.map((p) => ({ id: p.id, business: p.workspace.businessName, provider: p.provider, plan: p.plan, amount: p.amount, currency: p.currency, status: p.status, at: p.createdAt.toISOString() })) };
  });

  app.get('/admin/api/super/subscriptions', { preHandler: superOnly }, async () => {
    const rows = await prisma.workspace.findMany({ where: { plan: { in: ['starter', 'growth', 'scale'] } }, orderBy: { currentPeriodEnd: 'asc' }, include: { adminUsers: { where: { role: 'owner' }, take: 1 } } });
    return {
      subscriptions: rows.map((w) => ({
        id: w.id, business: w.businessName, owner: w.adminUsers[0]?.email ?? null, plan: w.plan, status: w.planStatus, access: accessState(w).reason,
        provider: w.billingProvider, renews: w.currentPeriodEnd?.toISOString() ?? null, cancelAtPeriodEnd: w.cancelAtPeriodEnd, priceInr: planById(w.plan)?.price.INR ?? 0
      }))
    };
  });

  app.get('/admin/api/super/plans', { preHandler: superOnly }, async () => {
    const counts = await prisma.workspace.groupBy({ by: ['plan'], _count: { _all: true } });
    const n = new Map(counts.map((c) => [c.plan, c._count._all]));
    return { plans: PLANS.map((p) => ({ id: p.id, name: p.name, price: p.price, limits: p.limits, integrations: p.integrations, clients: n.get(p.id) ?? 0 })), trial: n.get('trial') ?? 0, internal: n.get('internal') ?? 0 };
  });

  const platformSettings = async () => ({ platformSender: await getSetting<boolean>('platformSender', false), ...(await connectionSlots()), ...serverMemory() });
  app.get('/admin/api/super/settings', { preHandler: superOnly }, async () => platformSettings());
  app.put('/admin/api/super/settings', { preHandler: superOnly }, async (req) => {
    const b = (req.body ?? {}) as { platformSender?: boolean; maxConnections?: number };
    if (Number.isInteger(b.maxConnections) && b.maxConnections! >= 1 && b.maxConnections! <= 500) {
      await setSetting('waMaxConnections', b.maxConnections);
      await audit(req, 'setting.waMaxConnections', null, String(b.maxConnections));
    }
    if (typeof b.platformSender === 'boolean') {
      await setSetting('platformSender', b.platformSender);
      await audit(req, 'setting.platformSender', null, b.platformSender ? 'alerts sent from the platform WhatsApp number' : 'alerts sent from each client number');
    }
    return platformSettings();
  });

  app.get('/admin/api/super/overview', { preHandler: superOnly }, async () => {
    const rows = await prisma.workspace.findMany();
    const paid = rows.filter((w) => planById(w.plan) && w.planStatus === 'active' && accessState(w).active);
    const mrr = paid.reduce((sum, w) => sum + (planById(w.plan)?.price.INR ?? 0), 0);
    return {
      businesses: rows.length,
      paying: paid.length,
      trialing: rows.filter((w) => w.planStatus === 'trialing' && accessState(w).active).length,
      lapsed: rows.filter((w) => w.plan !== 'internal' && !accessState(w).active).length,
      whatsappConnected: rows.filter((w) => waFor(w.id).status === 'ready').length,
      leads: await prisma.lead.count(),
      mrrInr: mrr
    };
  });

  app.get('/admin/api/super/workspaces', { preHandler: superOnly }, async () => {
    const period = currentPeriod();
    const [rows, usage, activity] = await Promise.all([
      prisma.workspace.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { leads: true, sessions: true, adminUsers: true } }, adminUsers: { where: { role: 'owner' }, orderBy: { createdAt: 'asc' }, take: 1 } }
      }),
      prisma.usage.findMany({ where: { period } }),
      prisma.session.groupBy({ by: ['workspaceId'], _max: { lastInteractionAt: true } })
    ]);
    const used = new Map(usage.map((u) => [u.workspaceId, u.conversations]));
    const last = new Map(activity.map((x) => [x.workspaceId, x._max.lastInteractionAt]));
    return {
      workspaces: rows.map((w) => ({
        id: w.id,
        businessName: w.businessName,
        slug: w.slug,
        industry: w.industry,
        owner: w.adminUsers[0]?.email ?? null,
        whatsapp: waFor(w.id).status,
        botEnabled: w.botEnabled,
        plan: w.plan,
        planStatus: w.planStatus,
        planAccess: accessState(w).reason,
        trialEndsAt: w.trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: w.currentPeriodEnd?.toISOString() ?? null,
        onboardingCompleted: w.onboardingCompleted,
        leads: w._count.leads,
        contacts: w._count.sessions,
        users: w._count.adminUsers,
        conversationsThisMonth: used.get(w.id) ?? 0,
        lastActivity: last.get(w.id)?.toISOString() ?? null,
        createdAt: w.createdAt.toISOString()
      }))
    };
  });

  app.post('/admin/api/super/workspaces', { preHandler: superOnly }, async (req, reply) => {
    const b = (req.body ?? {}) as { businessName?: string; email?: string; password?: string; plan?: string; days?: number };
    const businessName = String(b.businessName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const email = normalizeEmail(b.email);
    const password = String(b.password ?? '');
    if (!businessName) return reply.status(400).send({ error: 'Enter the business name' });
    if (!isValidEmail(email)) return reply.status(400).send({ error: 'Enter a valid owner email' });
    if (password.length < MIN_PASSWORD_LENGTH) return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    if (await prisma.adminUser.findUnique({ where: { email } })) return reply.status(409).send({ error: 'That email already has an account' });
    const ws = await createWorkspaceWithOwner({ businessName, email, password });
    if (b.plan && b.plan !== 'trial') {
      const err = await grantPlan(ws.id, String(b.plan), b.days);
      if (err) return reply.status(400).send({ error: err });
    }
    await audit(req, 'workspace.create', ws.id, `${businessName} (${email}) on ${b.plan || 'trial'}`);
    return { id: ws.id };
  });

  app.get('/admin/api/super/workspaces/:id', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const w = await prisma.workspace.findUnique({ where: { id }, include: { adminUsers: { orderBy: { createdAt: 'asc' } } } });
    if (!w) return reply.status(404).send({ error: 'Workspace not found' });
    const [usage, payments, log] = await Promise.all([
      getUsage(id),
      prisma.payment.findMany({ where: { workspaceId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.auditLog.findMany({ where: { workspaceId: id }, orderBy: { createdAt: 'desc' }, take: 15 })
    ]);
    const lim = accessState(w).limits;
    return {
      id: w.id,
      businessName: w.businessName,
      plan: w.plan,
      planStatus: w.planStatus,
      billingProvider: w.billingProvider,
      trialEndsAt: w.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: w.currentPeriodEnd?.toISOString() ?? null,
      limits: { conversations: lim.conversations === Infinity ? null : lim.conversations, aiReplies: lim.aiReplies === Infinity ? null : lim.aiReplies, broadcasts: lim.broadcasts === Infinity ? null : lim.broadcasts },
      usage,
      users: w.adminUsers.map((u) => ({ id: u.id, email: u.email, role: u.role, isSuperAdmin: u.isSuperAdmin, lastLoginAt: u.lastLoginAt?.toISOString() ?? null })),
      payments: payments.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, plan: p.plan, at: p.createdAt.toISOString() })),
      audit: log.map((l) => ({ id: l.id, actor: l.actor, action: l.action, detail: l.detail, at: l.createdAt.toISOString() }))
    };
  });

  app.post('/admin/api/super/workspaces/:id/bot', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const w = await prisma.workspace.findUnique({ where: { id } });
    if (!w) return reply.status(404).send({ error: 'Workspace not found' });
    const enabled = !!(req.body as any)?.enabled;
    await prisma.workspace.update({ where: { id }, data: { botEnabled: enabled } });
    invalidateConfig(id);
    await audit(req, enabled ? 'bot.enable' : 'bot.suspend', id, w.businessName);
    return { ok: true };
  });

  app.post('/admin/api/super/workspaces/:id/plan', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { plan?: string; days?: number };
    if (!(await prisma.workspace.findUnique({ where: { id } }))) return reply.status(404).send({ error: 'Workspace not found' });
    const err = await grantPlan(id, String(b.plan), b.days);
    if (err) return reply.status(400).send({ error: err });
    await audit(req, 'plan.set', id, `${b.plan} for ${Math.floor(Number(b.days) || 30)} days`);
    return { ok: true };
  });

  // Permanently removes a business and everything it owns (chats, leads, team, WhatsApp link)
  app.post('/admin/api/super/workspaces/:id/delete', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const w = await prisma.workspace.findUnique({ where: { id } });
    if (!w) return reply.status(404).send({ error: 'Workspace not found' });
    if (id === 'default-workspace' || id === wsId(req)) return reply.status(400).send({ error: 'You cannot delete your own business' });
    if (String((req.body as any)?.confirm ?? '').trim() !== w.businessName) return reply.status(400).send({ error: 'Type the exact business name to confirm' });
    await waFor(id).disconnect().catch(() => undefined);
    await prisma.workspace.delete({ where: { id } });
    invalidateConfig(id);
    await audit(req, 'workspace.delete', null, w.businessName);
    return { ok: true };
  });

  app.post('/admin/api/super/users/:id/password', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const password = String((req.body as any)?.password ?? '');
    if (password.length < MIN_PASSWORD_LENGTH) return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    const u = await prisma.adminUser.findUnique({ where: { id } });
    if (!u) return reply.status(404).send({ error: 'User not found' });
    await prisma.adminUser.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    await audit(req, 'user.password_reset', u.workspaceId, u.email);
    return { ok: true };
  });

  app.delete('/admin/api/super/users/:id', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === me(req).id) return reply.status(400).send({ error: 'You cannot remove your own account' });
    const u = await prisma.adminUser.findUnique({ where: { id } });
    if (!u) return reply.status(404).send({ error: 'User not found' });
    await prisma.adminUser.delete({ where: { id } });
    await audit(req, 'user.remove', u.workspaceId, u.email);
    return { ok: true };
  });

  // Support tool: continue as the business owner. Replaces your own session; sign out and back in to return.
  app.post('/admin/api/super/workspaces/:id/impersonate', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const owner = await prisma.adminUser.findFirst({ where: { workspaceId: id }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] });
    if (!owner) return reply.status(404).send({ error: 'This business has no users' });
    await audit(req, 'impersonate', id, `as ${owner.email}`);
    setSession(req, reply, owner.id);
    return { ok: true };
  });

  const couponRow = (c: any) => ({
    id: c.id, code: c.code, plan: c.plan, days: c.days, maxRedemptions: c.maxRedemptions, redeemed: c.redeemedCount,
    expiresAt: c.expiresAt?.toISOString() ?? null, active: c.active, note: c.note, createdAt: c.createdAt.toISOString()
  });
  app.get('/admin/api/super/coupons', { preHandler: superOnly }, async () => ({
    coupons: (await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })).map(couponRow)
  }));
  app.post('/admin/api/super/coupons', { preHandler: superOnly }, async (req, reply) => {
    const r = await createCoupon((req.body ?? {}) as any, me(req).email);
    if ('error' in r) return reply.status(400).send({ error: r.error });
    await audit(req, 'coupon.create', null, r.code);
    return { ok: true, code: r.code };
  });
  app.post('/admin/api/super/coupons/:id/active', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const active = !!(req.body as any)?.active;
    const c = await prisma.coupon.findUnique({ where: { id } });
    if (!c) return reply.status(404).send({ error: 'Code not found' });
    await prisma.coupon.update({ where: { id }, data: { active } });
    await audit(req, active ? 'coupon.enable' : 'coupon.disable', null, c.code);
    return { ok: true };
  });
  app.delete('/admin/api/super/coupons/:id', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await prisma.coupon.findUnique({ where: { id } });
    if (!c) return reply.status(404).send({ error: 'Code not found' });
    await prisma.coupon.delete({ where: { id } });
    await audit(req, 'coupon.delete', null, c.code);
    return { ok: true };
  });

  app.get('/admin/api/super/affiliates', { preHandler: superOnly }, async () => affiliateAdminOverview());
  app.put('/admin/api/super/affiliates/settings', { preHandler: superOnly }, async (req, reply) => {
    try {
      const s = await saveAffiliateSettings((req.body ?? {}) as Record<string, unknown>);
      await audit(req, 'affiliate.settings', null, `${s.enabled ? 'on' : 'off'} · ${s.percent}% · ${s.months} payments · +${s.bonusDays} days`);
      return s;
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });
  app.post('/admin/api/super/commissions/:id/status', { preHandler: superOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const status = String((req.body as any)?.status ?? '');
    const err = await setCommissionStatus(id, status);
    if (err) return reply.status(err === 'Commission not found' ? 404 : 400).send({ error: err });
    await audit(req, 'commission.' + status, null, id);
    return { ok: true };
  });

  app.get('/admin/api/super/audit', { preHandler: superOnly }, async () => ({
    entries: (await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })).map((l) => ({ id: l.id, actor: l.actor, action: l.action, workspaceId: l.workspaceId, detail: l.detail, at: l.createdAt.toISOString() }))
  }));

  // ---- SPA (built from /web) ----
  app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));
  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.register(fastifyStatic, { root: WEB_DIST, prefix: '/admin/' });
  } else {
    app.get('/admin/', async (_req, reply) =>
      reply.type('text/html').send('<h2>Dashboard not built</h2><p>Run <code>npm run build:web</code>.</p>')
    );
  }
}
