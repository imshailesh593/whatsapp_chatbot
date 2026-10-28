import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import dotenv from 'dotenv';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import crypto from 'crypto';
import { handleIncomingMessage } from './services/engine';
import { verifySignature } from './lib/signature';
import { extractMessages } from './lib/extract';
import { prisma } from './lib/prisma';

dotenv.config();

const app: FastifyInstance = Fastify({ logger: true });
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

const webhookQueue = new Queue('whatsapp-inbound', { connection: redis });

class LockBusyError extends Error {}

// Release the lock only if we still own it
const RELEASE_LOCK =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

// Per-user mutex: a busy lock throws, and BullMQ retries the job with backoff
const worker = new Worker(
  'whatsapp-inbound',
  async (job) => {
    const { from, name, text } = job.data;
    const lockKey = `lock:wa:${from}`;
    const token = crypto.randomUUID();

    const acquired = await redis.set(lockKey, token, 'EX', 30, 'NX');
    if (!acquired) throw new LockBusyError(`busy: ${from}`);

    try {
      await handleIncomingMessage(from, name, text);
    } catch (err) {
      app.log.error({ err, from }, 'Worker processing failure');
    } finally {
      await redis.eval(RELEASE_LOCK, 1, lockKey, token);
    }
  },
  { connection: redis, concurrency: 10 }
);

// Keep the raw bytes around: the HMAC signature must be checked against them
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  (req as any).rawBody = body;
  try {
    done(null, JSON.parse((body as Buffer).toString('utf8')));
  } catch (err) {
    (err as any).statusCode = 400;
    done(err as Error, undefined);
  }
});

// 1. Meta webhook verification (GET)
app.get('/api/v1/whatsapp/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
  const q = req.query as Record<string, string>;
  if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
    app.log.info('Meta Webhook verified successfully.');
    return reply.status(200).send(q['hub.challenge']);
  }
  return reply.status(403).send('Verification failed');
});

// 2. Inbound events (POST)
app.post('/api/v1/whatsapp/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    app.log.error('WHATSAPP_APP_SECRET is not set; rejecting webhook');
    return reply.status(500).send();
  }
  const sig = req.headers['x-hub-signature-256'] as string | undefined;
  if (!verifySignature((req as any).rawBody, sig, secret)) {
    return reply.status(401).send('Invalid signature');
  }

  // ACK first so Meta doesn't retry; enqueue afterwards
  reply.status(200).send({ status: 'EVENT_RECEIVED' });

  try {
    for (const msg of extractMessages(req.body)) {
      // jobId = WhatsApp message id, so Meta redeliveries are deduplicated
      await webhookQueue.add(
        'inbound-message',
        { from: msg.from, name: msg.name, text: msg.text },
        {
          jobId: msg.id,
          attempts: 20,
          backoff: { type: 'fixed', delay: 500 },
          removeOnComplete: 1000,
          removeOnFail: 1000
        }
      );
    }
  } catch (err) {
    app.log.error({ err }, 'Failed to enqueue inbound message');
  }
});

app.get('/health', async () => ({ ok: true }));

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  await app.close();
  await worker.close();
  await webhookQueue.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
