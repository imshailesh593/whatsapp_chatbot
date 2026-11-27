import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from './lib/prisma';
import { DEFAULT_WORKSPACE_ID } from './lib/workspaces';
import { connectionStatus } from './services/whatsapp';

/*
 * Read-only feed for the Admin Hub (auth.zexyai.com/hub): what needs attention now
 * ("open") and what happened recently ("events"). Called server-to-server with
 * HUB_FEED_KEY as a bearer token; 404 when no key is configured. Returns counts and
 * short labels only, never message contents or contact details beyond a name.
 */

export type Severity = 'high' | 'medium' | 'info';
export interface OpenItem { key: string; severity: Severity; title: string; count: number; url: string }
export interface FeedEvent { id: string; type: string; severity: Severity; title: string; at: string; url: string }

const DAY = 86_400_000;

export function feedKeyOk(header: unknown, key = process.env.HUB_FEED_KEY ?? ''): boolean {
  if (key.length < 32 || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(key);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

export function money(amount: number, currency: string): string {
  const major = amount / 100;
  const sym = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : `${currency} `;
  return `${sym}${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function buildFeed(now = new Date()) {
  const threeDays = new Date(now.getTime() - 3 * DAY);
  const week = new Date(now.getTime() - 7 * DAY);

  const [handoffs, pastDue, active, signups, payments, handoffEvents] = await Promise.all([
    prisma.session.count({ where: { workspaceId: DEFAULT_WORKSPACE_ID, isAgentPaused: true, handoffAt: { gte: threeDays } } }),
    prisma.workspace.count({ where: { planStatus: 'past_due', NOT: { plan: 'internal' } } }),
    prisma.workspace.findMany({ where: { planStatus: 'active', botEnabled: true, NOT: { id: DEFAULT_WORKSPACE_ID } }, select: { id: true } }),
    prisma.workspace.findMany({ where: { createdAt: { gte: week }, NOT: { id: DEFAULT_WORKSPACE_ID } }, select: { id: true, businessName: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.payment.findMany({ where: { createdAt: { gte: week }, status: 'paid' }, select: { id: true, amount: true, currency: true, createdAt: true, workspace: { select: { businessName: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.session.findMany({ where: { workspaceId: DEFAULT_WORKSPACE_ID, handoffAt: { gte: week } }, select: { id: true, contactName: true, handoffAt: true }, orderBy: { handoffAt: 'desc' }, take: 50 })
  ]);
  const disconnected = active.filter((w) => connectionStatus(w.id) === 'disconnected').length;

  const open: OpenItem[] = [];
  if (handoffs) open.push({ key: 'handoffs_waiting', severity: 'high', title: `${plural(handoffs, 'chat', 'chats')} asked for a person (last 3 days)`, count: handoffs, url: '/admin/' });
  if (disconnected) open.push({ key: 'whatsapp_disconnected', severity: 'high', title: `${plural(disconnected, 'paying business has', 'paying businesses have')} a disconnected WhatsApp number`, count: disconnected, url: '/admin/' });
  if (pastDue) open.push({ key: 'payments_past_due', severity: 'medium', title: `${plural(pastDue, 'business is', 'businesses are')} past due on payment`, count: pastDue, url: '/admin/' });

  const events: FeedEvent[] = [
    ...signups.map((w) => ({ id: `signup:${w.id}`, type: 'signup', severity: 'info' as const, title: `New business signed up: ${w.businessName}`, at: w.createdAt.toISOString(), url: '/admin/' })),
    ...payments.map((p) => ({ id: `payment:${p.id}`, type: 'payment', severity: 'info' as const, title: `Payment received: ${money(p.amount, p.currency)} from ${p.workspace.businessName}`, at: p.createdAt.toISOString(), url: '/admin/' })),
    ...handoffEvents.map((s) => ({ id: `handoff:${s.id}:${s.handoffAt!.getTime()}`, type: 'handoff', severity: 'medium' as const, title: `Chat asked for a person: ${s.contactName || 'a customer'}`, at: s.handoffAt!.toISOString(), url: '/admin/' }))
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);

  return { app: 'wappo', generated_at: now.toISOString(), open, events };
}

export function registerHubFeed(app: FastifyInstance) {
  app.get('/internal/hub/feed', async (req, reply) => {
    if (!process.env.HUB_FEED_KEY) return reply.status(404).send();
    if (!feedKeyOk(req.headers.authorization)) return reply.status(401).send({ error: 'unauthorized' });
    return reply.header('Cache-Control', 'no-store').send(await buildFeed());
  });
}
