// Webhooks, public API and click-to-chat attribution, against the real database.
// Usage: npx tsx scripts/integration-test.ts
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'testtoken';
import http from 'http';
import crypto from 'crypto';
import Fastify from 'fastify';
import { prisma } from '../src/lib/prisma';
import { setTransport } from '../src/services/transport';
import { handleIncomingMessage } from '../src/services/engine';
import { saveServices, invalidateConfig } from '../src/services/botConfig';
import { getTemplate } from '../src/templates';
import { assertPublicUrl, createApiKey, createWebhook, deliverDue } from '../src/services/integrations';
import { registerPublicApi } from '../src/publicApi';

function assert(c: any, msg: string) {
  if (!c) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ok -', msg);
}

const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let respondWith = 200;

async function main() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = respondWith;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  const hookUrl = `http://127.0.0.1:${port}/hook`;

  const run = Date.now().toString(36);
  const W = await prisma.workspace.create({
    data: { slug: `int-${run}`, name: 'Int', businessName: 'Int Co', botEnabled: true, onboardingCompleted: true, plan: 'growth', planStatus: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000) }
  });
  const S = await prisma.workspace.create({
    data: { slug: `ints-${run}`, name: 'IntS', businessName: 'Starter Co', botEnabled: true, onboardingCompleted: true, plan: 'starter', planStatus: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000) }
  });
  try {
    setTransport(W.id, { sendText: async () => undefined, ready: () => true });
    await saveServices(W.id, getTemplate('generic').services);

    console.log('[url safety]');
    for (const bad of ['http://example.com/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://192.168.0.5/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://localhost/x', 'ftp://example.com', 'https://user:pw@8.8.8.8/x', 'not a url']) {
      let threw = false;
      try { await assertPublicUrl(bad); } catch { threw = true; }
      assert(threw, `refuses ${bad}`);
    }
    assert((await assertPublicUrl('https://8.8.8.8/hook')).hostname === '8.8.8.8', 'accepts a public https address');

    process.env.ALLOW_HTTP_WEBHOOKS = '1'; // lets the test receiver on 127.0.0.1 through
    console.log('\n[webhook delivery]');
    const hook = await createWebhook(W.id, { url: hookUrl, events: ['lead.created', 'lead.stage_changed'] });
    assert(hook.secret.startsWith('whsec_') && hook.active, 'webhook created with a signing secret');
    const phone = `9111${run}`;
    await handleIncomingMessage(W.id, phone, 'Ria Shah', 'hi (ref: Summer24)');
    assert((await prisma.session.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: W.id, phoneNumber: phone } } }))?.source === 'summer24', 'campaign tag from the first message is stored as the source');
    await handleIncomingMessage(W.id, phone, 'Ria Shah', '3'); // "Something else", 1 question
    await handleIncomingMessage(W.id, phone, 'Ria Shah', 'Please call me back');
    await new Promise((r) => setTimeout(r, 400)); // events are queued in the background
    assert((await prisma.webhookDelivery.count({ where: { webhookId: hook.id, event: 'lead.created' } })) === 1, 'finishing the questions queues lead.created');
    assert(received.length === 0, 'nothing is delivered until the worker runs');
    await deliverDue();
    assert(received.length === 1, 'delivered');
    const got = received[0];
    const expectSig = 'sha256=' + crypto.createHmac('sha256', hook.secret).update(got.body).digest('hex');
    assert(got.headers['x-signature'] === expectSig && got.headers['x-event'] === 'lead.created', 'signed with the webhook secret (HMAC-SHA256) and labelled with the event');
    const payload = JSON.parse(got.body);
    assert(payload.lead.phone === phone && payload.lead.name === 'Ria Shah' && payload.lead.source === 'summer24' && payload.lead.stage === 'new', 'payload carries the lead, stage and source');
    assert(Object.values(payload.lead.answers).includes('Please call me back') && Object.keys(payload.lead.answers)[0].includes('how we can help'), 'answers are labelled with the question text');
    assert((await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hook.id } })).status === 'ok', 'delivery marked ok');

    console.log('\n[retries]');
    respondWith = 500;
    await handleIncomingMessage(W.id, phone, 'Ria', 'menu');
    await prisma.lead.updateMany({ where: { workspaceId: W.id, phoneNumber: phone }, data: { stageKey: 'contacted' } }); // direct DB change: no event
    const sess = await prisma.session.findFirstOrThrow({ where: { workspaceId: W.id, phoneNumber: phone } });
    const { dispatchEvent } = await import('../src/services/integrations');
    await dispatchEvent(W.id, 'lead.stage_changed', sess.id, { previousStage: 'new' });
    await deliverDue();
    let d = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hook.id, event: 'lead.stage_changed' } });
    assert(d.status === 'pending' && d.attempts === 1 && d.error === 'HTTP 500' && d.nextAttemptAt.getTime() > Date.now(), 'a failing receiver is retried later with backoff');
    for (let i = 0; i < 4; i++) {
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await deliverDue();
    }
    d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    assert(d.status === 'failed' && d.attempts === 5, 'gives up after 5 attempts');
    respondWith = 200;

    console.log('\n[subscriptions]');
    await prisma.webhook.update({ where: { id: hook.id }, data: { events: ['lead.created'] } });
    const n = await prisma.webhookDelivery.count({ where: { webhookId: hook.id } });
    await dispatchEvent(W.id, 'lead.stage_changed', sess.id);
    assert((await prisma.webhookDelivery.count({ where: { webhookId: hook.id } })) === n, 'events the webhook did not subscribe to are not queued');
    await prisma.webhook.update({ where: { id: hook.id }, data: { active: false, events: ['lead.created', 'lead.stage_changed'] } });
    await dispatchEvent(W.id, 'lead.stage_changed', sess.id);
    assert((await prisma.webhookDelivery.count({ where: { webhookId: hook.id } })) === n, 'disabled webhooks get nothing');
    await prisma.webhook.update({ where: { id: hook.id }, data: { active: true } });

    console.log('\n[public API]');
    const app = Fastify();
    registerPublicApi(app);
    const { key } = await createApiKey(W.id, 'test');
    const H = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
    assert((await app.inject('/api/v1/leads')).statusCode === 401 && (await app.inject({ url: '/api/v1/leads', headers: { authorization: 'Bearer lk_' + 'a'.repeat(48) } })).statusCode === 401, 'requires a valid key');
    let r = await app.inject({ url: '/api/v1/leads', headers: H });
    assert(r.statusCode === 200 && r.json().leads.length === 1 && r.json().leads[0].phone === phone, 'lists leads of this workspace');
    assert((await app.inject({ url: '/api/v1/leads?stage=won', headers: H })).json().leads.length === 0, 'filters by stage');
    assert((await app.inject({ url: `/api/v1/leads/${phone}`, headers: H })).json().lead.name === 'Ria Shah', 'fetch one lead');
    assert((await app.inject({ url: '/api/v1/leads/000', headers: H })).statusCode === 404, 'unknown lead is a 404');
    r = await app.inject({ method: 'PATCH', url: `/api/v1/leads/${phone}`, headers: H, payload: { stage: 'won', notes: 'closed via API' } });
    assert(r.json().lead.stage === 'won' && r.json().lead.notes === 'closed via API', 'update stage and notes');
    assert((await app.inject({ method: 'PATCH', url: `/api/v1/leads/${phone}`, headers: H, payload: { stage: 'nope' } })).statusCode === 400, 'unknown stage refused');
    await new Promise((r) => setTimeout(r, 200));
    assert((await prisma.webhookDelivery.count({ where: { webhookId: hook.id, event: 'lead.stage_changed' } })) > 0, 'API stage changes also fire lead.stage_changed');
    assert((await app.inject({ url: '/api/v1/stages', headers: H })).json().stages.length === 6, 'stages endpoint');
    const { key: k2 } = await createApiKey(S.id, 'starter');
    assert((await app.inject({ url: '/api/v1/leads', headers: { authorization: `Bearer ${k2}` } })).statusCode === 402, 'Starter plan has no API access');
    let last = 200;
    for (let i = 0; i < 62; i++) last = (await app.inject({ url: '/api/v1/stages', headers: H })).statusCode;
    assert(last === 429, 'rate limited to 60 requests a minute');
    await prisma.workspace.update({ where: { id: W.id }, data: { trialEndsAt: null, planStatus: 'canceled', currentPeriodEnd: new Date(Date.now() - 86_400_000) } });
    invalidateConfig(W.id);
    await new Promise((r) => setTimeout(r, 1));
    console.log('\nINTEGRATION TESTS PASSED');
  } finally {
    await prisma.workspace.deleteMany({ where: { id: { in: [W.id, S.id] } } });
    server.close();
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
