import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './lib/prisma';
import { loadConfig } from './services/botConfig';
import { accessState } from './plans';
import { dispatchEvent, leadSnapshot, workspaceForKey } from './services/integrations';
import { getStages, stageExists } from './services/pipeline';
import { logLeadEvent } from './services/crm';

const hits = new Map<string, { n: number; reset: number }>();
const LIMIT_PER_MINUTE = 60;

/** Public REST API, authenticated with `Authorization: Bearer lk_...` (keys are created in the dashboard). */
export function registerPublicApi(app: FastifyInstance): void {
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const k = await workspaceForKey(req.headers.authorization);
    if (!k) return reply.status(401).send({ error: 'Invalid or missing API key' });
    const now = Date.now();
    const h = hits.get(k.keyId);
    if (!h || h.reset < now) hits.set(k.keyId, { n: 1, reset: now + 60_000 });
    else if (++h.n > LIMIT_PER_MINUTE) return reply.header('Retry-After', '60').status(429).send({ error: 'Rate limit: 60 requests per minute' });
    const { ws } = await loadConfig(k.workspaceId);
    const access = accessState(ws);
    if (!access.integrations) return reply.status(402).send({ error: 'The API needs an active plan' });
    if (!access.active) return reply.status(402).send({ error: 'This account is not active' });
    (req as any).wsId = k.workspaceId;
  };
  const ws = (req: FastifyRequest) => (req as any).wsId as string;

  app.get('/api/v1/stages', { preHandler: auth }, async (req) => ({ stages: await getStages(ws(req)) }));

  app.get('/api/v1/leads', { preHandler: auth }, async (req) => {
    const q = req.query as { stage?: string; since?: string; limit?: string };
    const since = q.since ? new Date(q.since) : null;
    const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10) || 50, 1), 100);
    const sessions = await prisma.session.findMany({
      where: {
        workspaceId: ws(req),
        phoneNumber: { not: { startsWith: 'SIM-' } },
        lead: { is: { ...(q.stage ? { stageKey: q.stage } : {}), ...(since && !isNaN(since.getTime()) ? { createdAt: { gt: since } } : {}) } }
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true }
    });
    const leads = (await Promise.all(sessions.map((s) => leadSnapshot(ws(req), s.id)))).filter(Boolean);
    return { leads, next: leads.length === limit ? (leads[leads.length - 1] as any).createdAt : null };
  });

  const sessionByPhone = (req: FastifyRequest) =>
    prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: ws(req), phoneNumber: (req.params as { phone: string }).phone } }, include: { lead: true } });

  app.get('/api/v1/leads/:phone', { preHandler: auth }, async (req, reply) => {
    const s = await sessionByPhone(req);
    const lead = s?.lead ? await leadSnapshot(ws(req), s.id) : null;
    return lead ? { lead } : reply.status(404).send({ error: 'Lead not found' });
  });

  app.patch('/api/v1/leads/:phone', { preHandler: auth }, async (req, reply) => {
    const s = await sessionByPhone(req);
    if (!s?.lead) return reply.status(404).send({ error: 'Lead not found' });
    const b = (req.body ?? {}) as { stage?: string; notes?: string };
    if (b.stage !== undefined && !(await stageExists(ws(req), String(b.stage)))) return reply.status(400).send({ error: 'Unknown stage' });
    const before = s.lead.stageKey;
    await prisma.lead.update({
      where: { id: s.lead.id },
      data: { ...(b.stage !== undefined ? { stageKey: String(b.stage) } : {}), ...(b.notes !== undefined ? { counsellorNotes: String(b.notes).slice(0, 4000) || null } : {}) }
    });
    if (b.stage !== undefined && b.stage !== before) {
      void dispatchEvent(ws(req), 'lead.stage_changed', s.id, { previousStage: before });
      void logLeadEvent(s.lead.id, ws(req), 'stage', `${before} → ${b.stage}`, 'api');
    }
    return { lead: await leadSnapshot(ws(req), s.id) };
  });
}
