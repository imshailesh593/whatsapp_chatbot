import Fastify from 'fastify';
import dotenv from 'dotenv';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { QR_PAGE_HTML } from './qrPage';
import { startWhatsApp, waState } from './services/whatsapp';
import { prisma } from './lib/prisma';
import { registerAdmin } from './admin';

dotenv.config();

const app = Fastify({ logger: true });

registerAdmin(app, { getWaStatus: () => waState.status });

app.get('/health', async () => ({ ok: true, whatsapp: waState.status }));

// Browser-friendly QR for headless servers: /qr?token=<ADMIN_TOKEN>. Disabled unless ADMIN_TOKEN is set.
const tokenOk = (given: unknown) => {
  const t = process.env.ADMIN_TOKEN ?? '';
  const x = Buffer.from(String(given ?? '')), y = Buffer.from(t);
  return !!t && x.length === y.length && crypto.timingSafeEqual(x, y);
};

app.get('/qr', async (_req, reply) => {
  if (!process.env.ADMIN_TOKEN) return reply.status(404).send();
  // The page itself is static; the token is checked on every /qr/status poll
  return reply
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .type('text/html; charset=utf-8')
    .send(QR_PAGE_HTML);
});

app.get('/qr/status', async (req, reply) => {
  if (!process.env.ADMIN_TOKEN) return reply.status(404).send();
  if (!tokenOk((req.query as Record<string, string>).token)) return reply.status(401).send({ error: 'unauthorized' });
  const qr = waState.status === 'qr' && waState.qr ? await QRCode.toDataURL(waState.qr, { width: 360, margin: 1 }) : null;
  return reply.header('Cache-Control', 'no-store').send({ status: waState.status, qr });
});

const client = startWhatsApp();

const shutdown = async () => {
  await app.close();
  await client.stop();
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
