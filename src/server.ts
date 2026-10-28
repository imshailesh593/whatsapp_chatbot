import Fastify from 'fastify';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import { startWhatsApp, waState } from './services/whatsapp';
import { prisma } from './lib/prisma';

dotenv.config();

const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true, whatsapp: waState.status }));

// Browser-friendly QR for headless servers: /qr?token=<ADMIN_TOKEN>. Disabled unless ADMIN_TOKEN is set.
app.get('/qr', async (req, reply) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return reply.status(404).send();
  if ((req.query as Record<string, string>).token !== token) return reply.status(401).send('Unauthorized');

  reply.type('text/html');
  if (waState.status === 'ready') return '<h2>WhatsApp is connected ✅</h2>';
  if (!waState.qr) return '<meta http-equiv="refresh" content="3"><h2>Waiting for QR…</h2>';
  const img = await QRCode.toDataURL(waState.qr, { width: 320 });
  return `<meta http-equiv="refresh" content="15"><h2>Scan with WhatsApp → Linked devices</h2><img src="${img}">`;
});

const client = startWhatsApp();

const shutdown = async () => {
  await app.close();
  await client.destroy().catch(() => undefined);
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
