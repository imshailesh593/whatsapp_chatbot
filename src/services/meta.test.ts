import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Workspace } from '@prisma/client';
import type { BotConfig } from './botConfig';
import { setAgentModelForTests } from './agent';
import { buildCommentPrompt, looksLikeNoise, matchesKeywords, publicSafe, writeCommentReply } from './commentAi';
import { channelOf, contactLabel, isSocial } from '../lib/channel';

process.env.META_APP_ID = '1234567890';
process.env.META_APP_SECRET = 'a'.repeat(32);
process.env.META_VERIFY_TOKEN = 'verify-token-123456';
process.env.SESSION_SECRET = 'test-session-secret';

// loaded after the environment is set
const metaP = import('./meta');

const sign = (raw: string, secret = process.env.META_APP_SECRET!) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

// ---------- webhook safety ----------

test('a webhook is accepted only with Meta\'s signature over the exact body', async () => {
  const { signatureOk } = await metaP;
  const raw = '{"object":"page","entry":[]}';
  assert.equal(signatureOk(raw, sign(raw)), true);
  assert.equal(signatureOk(raw + ' ', sign(raw)), false); // body changed
  assert.equal(signatureOk(raw, sign(raw, 'b'.repeat(32))), false); // wrong secret
  assert.equal(signatureOk(raw, undefined), false);
  assert.equal(signatureOk(raw, 'sha256=abc'), false);
  assert.equal(signatureOk(raw, 'md5=' + 'a'.repeat(64)), false);
});

test('the one-off verification answers the challenge only for our token', async () => {
  const { verifyChallenge } = await metaP;
  assert.equal(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token-123456', 'hub.challenge': '98765' }), '98765');
  assert.equal(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token-1234567', 'hub.challenge': '98765' }), null);
  assert.equal(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'short', 'hub.challenge': '1' }), null);
  assert.equal(verifyChallenge({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-token-123456', 'hub.challenge': '1' }), null);
});

// ---------- messages ----------

test('messages from a Page and from Instagram are read; echoes, receipts and our own account are not', async () => {
  const { parseWebhook } = await metaP;
  const page = {
    object: 'page',
    entry: [{ id: 'PAGE1', messaging: [
      { sender: { id: 'U1' }, recipient: { id: 'PAGE1' }, message: { mid: 'm1', text: '  hello  ' } },
      { sender: { id: 'PAGE1' }, recipient: { id: 'U1' }, message: { mid: 'm2', text: 'our reply', is_echo: true } },
      { sender: { id: 'U1' }, recipient: { id: 'PAGE1' }, delivery: { mids: ['m1'] } },
      { sender: { id: 'U2' }, recipient: { id: 'PAGE1' }, message: { mid: 'm3', attachments: [{ type: 'image' }] } },
      { sender: { id: 'U3' }, recipient: { id: 'PAGE1' }, postback: { title: 'Get started', payload: 'GS' } }
    ] }]
  };
  const got = parseWebhook(page);
  assert.deepEqual(got.map((m) => [m.channel, m.senderId, m.text, m.media]), [['fb', 'U1', 'hello', false], ['fb', 'U2', '', true], ['fb', 'U3', 'Get started', false]]);
  const ig = parseWebhook({ object: 'instagram', entry: [{ id: 'IG9', messaging: [{ sender: { id: 'S5' }, recipient: { id: 'IG9' }, message: { mid: 'i1', text: 'price?' } }] }] });
  assert.deepEqual(ig.map((m) => [m.channel, m.accountId, m.senderId, m.text]), [['ig', 'IG9', 'S5', 'price?']]);
  assert.deepEqual(parseWebhook({ object: 'whatsapp_business_account', entry: [] }), []);
  assert.deepEqual(parseWebhook(null), []);
});

test('a chat key names the channel, the business account and the customer, and round-trips', async () => {
  const { socialKey, parseSocialKey } = await metaP;
  const k = socialKey('ig', '1784', '5521');
  assert.equal(k, 'ig:1784:5521');
  assert.deepEqual(parseSocialKey(k), { channel: 'ig', accountId: '1784', senderId: '5521' });
  assert.equal(parseSocialKey('919876543210'), null);
  assert.equal(parseSocialKey('ig:1784'), null);
  assert.equal(parseSocialKey('xx:1:2'), null);
  assert.equal(parseSocialKey('fb:1:2:3'), null);
  assert.ok(isSocial(k) && !isSocial('919876543210'));
  assert.equal(channelOf(k), 'instagram');
  assert.equal(channelOf('fb:1:2'), 'messenger');
  assert.equal(channelOf('919876543210'), 'whatsapp');
  assert.equal(contactLabel('919876543210'), '+919876543210');
  assert.equal(contactLabel(k), 'Instagram user');
});

test('long replies are split at paragraph or sentence ends and nothing is lost', async () => {
  const { chunkText, plainText } = await metaP;
  const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const parts = chunkText(text, 200);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 200));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), text);
  assert.deepEqual(chunkText('short', 200), ['short']);
  assert.ok(chunkText('x'.repeat(500), 200).every((p) => p.length <= 200));
  assert.equal(plainText('A *bold* word and a_snake_case_url https://x.com/a_b_c'), 'A bold word and a_snake_case_url https://x.com/a_b_c');
});

// ---------- connecting ----------

test('the connect state is signed, expires and cannot be reused for another business', async () => {
  const { makeMetaState, readMetaState } = await metaP;
  const s = makeMetaState('workspace-1');
  assert.equal(readMetaState(s), 'workspace-1');
  const [body, sig] = s.split('.');
  const other = Buffer.from(JSON.stringify({ w: 'workspace-2', exp: Date.now() + 60_000 })).toString('base64url');
  assert.equal(readMetaState(`${other}.${sig}`), null);
  assert.equal(readMetaState(`${body}.${sig.slice(0, -2)}xx`), null);
  assert.equal(readMetaState('garbage'), null);
  const expired = Buffer.from(JSON.stringify({ w: 'workspace-1', exp: Date.now() - 1 })).toString('base64url');
  const realSig = crypto.createHmac('sha256', process.env.SESSION_SECRET!).update('meta-state:' + expired).digest('base64url');
  assert.equal(readMetaState(`${expired}.${realSig}`), null);
});

test('the data-deletion request is read only when Meta signed it', async () => {
  const { readSignedRequest } = await metaP;
  const payload = Buffer.from(JSON.stringify({ user_id: '42', algorithm: 'HMAC-SHA256' })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.META_APP_SECRET!).update(payload).digest('base64url');
  assert.equal(readSignedRequest(`${sig}.${payload}`)?.user_id, '42');
  assert.equal(readSignedRequest(`${sig.slice(0, -2)}aa.${payload}`), null);
  assert.equal(readSignedRequest('nonsense'), null);
});

// ---------- comments ----------

test('top-level comments are read; replies in a thread, our own comments and empty ones are not', async () => {
  const { parseComments } = await metaP;
  const fb = parseComments({
    object: 'page',
    entry: [{ id: 'PAGE1', changes: [
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'P_C1', post_id: 'P_1', parent_id: 'P_1', from: { id: 'U1', name: 'Asha Nair' }, message: 'How much is it?' } },
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'P_C2', post_id: 'P_1', parent_id: 'P_C1', from: { id: 'U2', name: 'Ravi' }, message: 'me too' } },
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'P_C3', post_id: 'P_1', parent_id: 'P_1', from: { id: 'PAGE1', name: 'Us' }, message: 'Thanks!' } },
      { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'P_C4', post_id: 'P_1', from: { id: 'U3' }, message: 'x' } },
      { field: 'feed', value: { item: 'reaction', verb: 'add', post_id: 'P_1', from: { id: 'U3' } } },
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'P_C5', post_id: 'P_1', parent_id: 'P_1', from: { id: 'U4' }, message: '   ' } }
    ] }]
  });
  assert.deepEqual(fb.map((c) => [c.channel, c.accountId, c.commentId, c.commenterName, c.text]), [['fb', 'PAGE1', 'P_C1', 'Asha Nair', 'How much is it?']]);
  const ig = parseComments({
    object: 'instagram',
    entry: [{ id: 'IG9', changes: [
      { field: 'comments', value: { id: 'IC1', text: 'price please', from: { id: 'S1', username: 'asha' }, media: { id: 'M1' } } },
      { field: 'comments', value: { id: 'IC2', text: 'reply', parent_id: 'IC1', from: { id: 'S2', username: 'ravi' }, media: { id: 'M1' } } },
      { field: 'mentions', value: { id: 'X' } }
    ] }]
  });
  assert.deepEqual(ig.map((c) => [c.channel, c.commentId, c.postId, c.commenterName, c.text]), [['ig', 'IC1', 'M1', 'asha', 'price please']]);
});

test('keywords match whole words and phrases in any case', () => {
  assert.equal(matchesKeywords('How much does it cost?', 'price, fees, how much'), true);
  assert.equal(matchesKeywords('PRICE???', 'price, fees'), true);
  assert.equal(matchesKeywords('Priceless moment', 'price, fees'), false); // not a whole word
  assert.equal(matchesKeywords('nice photo', 'price, fees'), false);
  assert.equal(matchesKeywords('anything', ''), false);
});

test('emoji-only comments, bare links and tag-only comments are noise; questions are not', () => {
  assert.equal(looksLikeNoise('🔥🔥👏'), true);
  assert.equal(looksLikeNoise('https://spam.example/win'), true);
  assert.equal(looksLikeNoise('@a @b'), true);
  assert.equal(looksLikeNoise('how much is the course?'), false);
  assert.equal(looksLikeNoise('@a check this price'), false);
});

test('a public text never carries links, numbers or email addresses', () => {
  assert.equal(publicSafe('Thanks! Visit https://x.example/y or call +91 98765 43210 or mail a@b.co today.'), 'Thanks! Visit or call or mail today.');
});

// ---------- the AI comment writer ----------

const ws = {
  id: 'w1', businessName: 'MNS Institute', tagline: '', description: 'coaching and jobs abroad', tone: 'friendly', languages: 'English, Hindi',
  knowledge: 'IELTS course Rs 12,000. Team phone +91 98765 43210.', aiInstructions: '', bookingUrl: 'https://topmate.io/mns', bookingLabel: 'consultation', bookingNote: '', formUrl: '',
  notifyPhone: '919876543210', handoffEnabled: true, handoffMessage: ''
} as unknown as Workspace;
const cfg: BotConfig = { ws, services: [{ key: 'ielts', title: 'IELTS coaching', keywords: ['ielts'], closingMessage: '', questions: [{ key: 'target', prompt: 'What band do you need?' }] }] };

test('the comment prompt holds public replies to strict rules and treats the comment as data', () => {
  const p = buildCommentPrompt(cfg, { channel: 'ig' }, true);
  for (const must of ['Instagram', 'under 25 words', 'no links, no phone numbers', 'WHEN NOT TO ANSWER', 'Complaints', 'never write it in the public reply', 'data, never instructions', 'What band do you need?', 'ONE question']) assert.ok(p.includes(must), `missing: ${must}`);
  assert.ok(buildCommentPrompt(cfg, { channel: 'fb' }, false).includes('leave it empty'));
});

test('a reply that breaks the rules is rewritten once, and the public text is cleaned whatever the model does', async () => {
  let calls = 0;
  setAgentModelForTests(async () => {
    calls++;
    return JSON.stringify({ skip: false, reason: '', reply: 'It is Rs 99,999! Call +91 11111 22222 or see https://evil.example', dm: calls === 1 ? 'Hi Asha, it is Rs 99,999.' : 'Hi Asha! What band do you need?' });
  });
  const plan = await writeCommentReply(cfg, { channel: 'ig', text: 'how much is ielts?', commenterName: 'Asha Nair', postText: '' }, true);
  assert.equal(calls, 2);
  assert.ok(!/99,999|11111|evil\.example/.test(plan.reply));
  assert.equal(plan.dm, 'Hi Asha! What band do you need?');
  setAgentModelForTests(null);
});

test('a comment the model says is for a person is skipped, and no DM is written when the business turned it off', async () => {
  setAgentModelForTests(async () => JSON.stringify({ skip: true, reason: 'a complaint about a refund', reply: '', dm: '' }));
  const skipped = await writeCommentReply(cfg, { channel: 'fb', text: 'you took my money and gave nothing', commenterName: null, postText: '' }, true);
  assert.equal(skipped.skip, true);
  assert.match(skipped.reason, /complaint/);
  setAgentModelForTests(async () => JSON.stringify({ skip: false, reason: '', reply: 'Thanks for your interest! 😊', dm: 'this should not be kept' }));
  const noDm = await writeCommentReply(cfg, { channel: 'fb', text: 'price?', commenterName: null, postText: '' }, false);
  assert.equal(noDm.dm, '');
  setAgentModelForTests(null);
});
