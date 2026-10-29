import Fastify from 'fastify';
import dotenv from 'dotenv';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { qrPageHtml } from './qrPage';
import { startWhatsApp, waFor, waSummary } from './services/whatsapp';
import { prisma } from './lib/prisma';
import { registerAdmin } from './admin';
import { DEFAULT_WORKSPACE_ID } from './lib/workspaces';
import { startBroadcastWorker } from './services/broadcast';
import { startWebhookWorker } from './services/integrations';
import { startFollowUpWorker } from './services/crm';
import { startAppointmentWorker } from './services/calendar';
import { startRenewalWorker } from './services/billing';
import { registerPublicApi } from './publicApi';

dotenv.config();

const app = Fastify({ logger: true });

const qrDataUrl = async (workspaceId: string) => {
  const c = waFor(workspaceId);
  return c.status === 'qr' && c.qr ? QRCode.toDataURL(c.qr, { width: 360, margin: 1 }) : null;
};

registerAdmin(app, { getQr: qrDataUrl });
registerPublicApi(app);

app.get('/health', async () => ({ ok: true, whatsapp: waFor(DEFAULT_WORKSPACE_ID).status, connections: waSummary() }));

// Operator shortcut for the default workspace on a headless server: /qr?token=<ADMIN_TOKEN>. Disabled unless ADMIN_TOKEN is set.
// Customers link their own number from inside the dashboard.
const tokenOk = (given: unknown) => {
  const t = process.env.ADMIN_TOKEN ?? '';
  const x = Buffer.from(String(given ?? '')), y = Buffer.from(t);
  return !!t && x.length === y.length && crypto.timingSafeEqual(x, y);
};

app.get('/qr', async (_req, reply) => {
  if (!process.env.ADMIN_TOKEN) return reply.status(404).send();
  const ws = await prisma.workspace.findUnique({ where: { id: DEFAULT_WORKSPACE_ID }, select: { businessName: true } });
  // The page itself is static; the token is checked on every /qr/status poll
  return reply
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .type('text/html; charset=utf-8')
    .send(qrPageHtml(ws?.businessName ?? 'WhatsApp'));
});

app.get('/qr/status', async (req, reply) => {
  if (!process.env.ADMIN_TOKEN) return reply.status(404).send();
  if (!tokenOk((req.query as Record<string, string>).token)) return reply.status(401).send({ error: 'unauthorized' });
  return reply.header('Cache-Control', 'no-store').send({ status: waFor(DEFAULT_WORKSPACE_ID).status, qr: await qrDataUrl(DEFAULT_WORKSPACE_ID) });
});

const broadcasts = startBroadcastWorker();
const webhooks = startWebhookWorker();
const followUps = startFollowUpWorker();
const appointments = startAppointmentWorker();
const renewals = startRenewalWorker();
let client: { stop(): Promise<void> } | null = null;
startWhatsApp()
  .then((c) => (client = c))
  .catch((err) => console.error('WhatsApp start failed:', err));

const shutdown = async () => {
  broadcasts.stop();
  webhooks.stop();
  followUps.stop();
  appointments.stop();
  renewals.stop();
  await app.close();
  await client?.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app
  .listen({ port: Number(process.env.PORT) || 3000, host: process.env.HOST || '0.0.0.0' })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
