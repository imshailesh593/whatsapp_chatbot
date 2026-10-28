import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Prisma, SessionStage } from '@prisma/client';
import { prisma } from './lib/prisma';
import { QUESTION_BRANCHES, TOPMATE_URL } from './constants/questions';
import { handleIncomingMessage } from './services/engine';
import { captureReplies, sendTextMessage } from './services/transport';

const SERVICE_LABELS: Record<string, string> = {
  COACHING: 'Coaching & Exam Preparation',
  LICENSING: 'Medical Licensing',
  JOBS: 'International Jobs',
  VISA_PR: 'Visa & Permanent Residency (PR)',
  GENERAL: 'Other Enquiry'
};
const COUNTRY_KEYS = ['target_country', 'destination_country', 'preferred_countries', 'relevant_country'];
const SIM_PREFIX = 'SIM-';
const WEB_DIST = path.join(__dirname, '..', 'web', 'dist');

type Status = 'IN_PROGRESS' | 'COMPLETED' | 'CONSULTATION_BOOKED' | 'FOLLOW_UP';

const sign = (token: string) => crypto.createHmac('sha256', token).update('mns-admin-session').digest('hex');
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function cookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
}

type SessionWithLead = Prisma.SessionGetPayload<{ include: { lead: true } }>;

function toContact(s: SessionWithLead) {
  const lead = s.lead;
  const answers = ((lead ? lead.collectedData : s.answers) ?? {}) as Record<string, string>;
  const service = lead?.serviceCategory ?? s.selectedService ?? null;
  const total = service ? QUESTION_BRANCHES[service].length : 0;
  const status: Status = !lead
    ? 'IN_PROGRESS'
    : lead.isBookedTopmate
      ? 'CONSULTATION_BOOKED'
      : lead.followUp
        ? 'FOLLOW_UP'
        : 'COMPLETED';
  const progress = lead ? 100 : total ? Math.round((s.currentStep / total) * 100) : 0;
  const countryKey = COUNTRY_KEYS.find((k) => answers[k]);
  return {
    phone: s.phoneNumber,
    name: s.contactName,
    service,
    status,
    stage: s.stage,
    step: s.currentStep,
    totalSteps: total,
    progress,
    targetCountry: countryKey ? answers[countryKey] : null,
    botActive: !s.isAgentPaused,
    answers,
    notes: lead?.counsellorNotes ?? null,
    hasLead: !!lead,
    receivedAt: (lead?.createdAt ?? s.createdAt).toISOString(),
    lastActivity: s.lastInteractionAt.toISOString(),
    isTest: s.phoneNumber.startsWith(SIM_PREFIX)
  };
}

export function registerAdmin(app: FastifyInstance, opts: { getWaStatus: () => string }): void {
  const token = process.env.ADMIN_TOKEN;
  const attempts = new Map<string, { n: number; reset: number }>();

  const authed = (req: FastifyRequest) => !!token && safeEq(cookie(req, 'mns_admin') ?? '', sign(token));
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!token) return reply.status(404).send();
    if (!authed(req)) return reply.status(401).send({ error: 'unauthorized' });
  };
  const secureFlag = (req: FastifyRequest) => (req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '');

  // ---- auth ----
  app.post('/admin/api/login', async (req, reply) => {
    if (!token) return reply.status(404).send();
    const ip = String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0].trim();
    const now = Date.now();
    const a = attempts.get(ip);
    if (a && a.reset > now && a.n >= 10) return reply.status(429).send({ error: 'Too many attempts. Try again later.' });
    const given = String((req.body as any)?.token ?? '');
    if (!safeEq(given, token)) {
      attempts.set(ip, a && a.reset > now ? { n: a.n + 1, reset: a.reset } : { n: 1, reset: now + 15 * 60_000 });
      return reply.status(401).send({ error: 'Wrong token' });
    }
    reply.header('Set-Cookie', `mns_admin=${sign(token)}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=2592000${secureFlag(req)}`);
    return { ok: true };
  });

  app.post('/admin/api/logout', async (_req, reply) => {
    reply.header('Set-Cookie', 'mns_admin=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0');
    return { ok: true };
  });

  app.get('/admin/api/me', async (req, reply) => {
    if (!token) return reply.status(404).send();
    return { authed: authed(req) };
  });

  // ---- data ----
  app.get('/admin/api/overview', { preHandler: guard }, async () => ({
    whatsapp: opts.getWaStatus(),
    topmateUrl: TOPMATE_URL,
    services: Object.entries(SERVICE_LABELS).map(([id, title]) => ({
      id,
      title,
      questions: QUESTION_BRANCHES[id].map((q) => ({ key: q.key, prompt: q.question }))
    }))
  }));

  app.get('/admin/api/contacts', { preHandler: guard }, async (req) => {
    const includeTest = (req.query as any).test === '1';
    const sessions = await prisma.session.findMany({
      where: includeTest ? {} : { phoneNumber: { not: { startsWith: SIM_PREFIX } } },
      include: { lead: true },
      orderBy: { lastInteractionAt: 'desc' },
      take: 1000
    });
    return { contacts: sessions.map(toContact) };
  });

  app.get('/admin/api/contacts/:phone/messages', { preHandler: guard }, async (req) => {
    const { phone } = req.params as { phone: string };
    const rows = await prisma.webhookLog.findMany({ where: { phoneNumber: phone }, orderBy: { createdAt: 'desc' }, take: 200 });
    return {
      messages: rows
        .reverse()
        .map((r) => ({ id: r.id, direction: r.direction, text: (r.payload as any)?.text ?? '', at: r.createdAt.toISOString() }))
    };
  });

  app.patch('/admin/api/contacts/:phone', { preHandler: guard }, async (req, reply) => {
    const { phone } = req.params as { phone: string };
    const b = (req.body ?? {}) as { paused?: boolean; notes?: string; status?: Status };
    const session = await prisma.session.findUnique({ where: { phoneNumber: phone }, include: { lead: true } });
    if (!session) return reply.status(404).send({ error: 'Contact not found' });

    if (typeof b.paused === 'boolean') {
      await prisma.session.update({ where: { phoneNumber: phone }, data: { isAgentPaused: b.paused } });
    }
    if (b.notes !== undefined || b.status !== undefined) {
      if (!session.lead) return reply.status(409).send({ error: 'Notes and status can be set once the questionnaire is complete' });
      const data: Prisma.LeadUpdateInput = {};
      if (b.notes !== undefined) data.counsellorNotes = String(b.notes).slice(0, 4000) || null;
      if (b.status === 'COMPLETED') Object.assign(data, { isBookedTopmate: false, followUp: false });
      if (b.status === 'CONSULTATION_BOOKED') Object.assign(data, { isBookedTopmate: true, followUp: false });
      if (b.status === 'FOLLOW_UP') Object.assign(data, { isBookedTopmate: false, followUp: true });
      await prisma.lead.update({ where: { id: session.lead.id }, data });
    }
    const fresh = await prisma.session.findUnique({ where: { phoneNumber: phone }, include: { lead: true } });
    return { contact: toContact(fresh!) };
  });

  // Human reply from the Live Inbox. Only while the bot is paused for that chat, so it can't talk over the bot.
  app.post('/admin/api/contacts/:phone/send', { preHandler: guard }, async (req, reply) => {
    const { phone } = req.params as { phone: string };
    const text = String((req.body as any)?.text ?? '').trim().slice(0, 4000);
    if (!text) return reply.status(400).send({ error: 'Message is empty' });
    if (phone.startsWith(SIM_PREFIX)) return reply.status(400).send({ error: 'Cannot message a simulator contact' });
    const session = await prisma.session.findUnique({ where: { phoneNumber: phone } });
    if (!session) return reply.status(404).send({ error: 'Contact not found' });
    if (!session.isAgentPaused) return reply.status(409).send({ error: 'Pause the bot for this chat before replying manually' });
    if (opts.getWaStatus() !== 'ready') return reply.status(503).send({ error: 'WhatsApp is not connected' });
    try {
      await sendTextMessage(phone, text);
    } catch (err) {
      return reply.status(502).send({ error: `Could not send: ${(err as Error).message}` });
    }
    return { ok: true };
  });

  // ---- simulator: runs the real engine, delivers nothing ----
  const simPhone = (id: unknown) => SIM_PREFIX + String(id ?? 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);

  app.post('/admin/api/simulate', { preHandler: guard }, async (req, reply) => {
    const b = (req.body ?? {}) as { id?: string; name?: string; text?: string };
    const text = String(b.text ?? '').trim().slice(0, 1000);
    if (!text) return reply.status(400).send({ error: 'Message is empty' });
    const phone = simPhone(b.id);
    const replies = await captureReplies(() => handleIncomingMessage(phone, b.name?.slice(0, 80) || 'Simulator User', text));
    const s = await prisma.session.findUnique({ where: { phoneNumber: phone } });
    return {
      replies,
      state: {
        stage: s?.stage ?? SessionStage.WELCOME,
        service: s?.selectedService ?? null,
        step: s?.currentStep ?? 0,
        totalSteps: s?.selectedService ? QUESTION_BRANCHES[s.selectedService].length : 0
      }
    };
  });

  app.post('/admin/api/simulate/reset', { preHandler: guard }, async (req) => {
    const phone = simPhone((req.body as any)?.id);
    await prisma.webhookLog.deleteMany({ where: { phoneNumber: phone } });
    await prisma.session.deleteMany({ where: { phoneNumber: phone } });
    return { ok: true };
  });

  // ---- export ----
  app.get('/admin/api/export.csv', { preHandler: guard }, async (_req, reply) => {
    const sessions = await prisma.session.findMany({
      where: { phoneNumber: { not: { startsWith: SIM_PREFIX } }, lead: { isNot: null } },
      include: { lead: true },
      orderBy: { createdAt: 'desc' }
    });
    // Neutralise spreadsheet formula injection from user-typed text
    const cell = (v: unknown) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = ['Received,Name,Phone,Service,Status,Notes,Answers'].concat(
      sessions.map((s) => {
        const c = toContact(s);
        return [
          c.receivedAt,
          c.name,
          c.phone,
          c.service ? SERVICE_LABELS[c.service] : '',
          c.status,
          c.notes,
          Object.entries(c.answers).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' | ')
        ].map(cell).join(',');
      })
    );
    reply.header('Content-Disposition', 'attachment; filename="mns-leads.csv"');
    return reply.type('text/csv; charset=utf-8').send('﻿' + lines.join('\r\n'));
  });

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
