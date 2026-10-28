import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { verifySignature } from './signature';
import { extractMessages } from './extract';
import { QUESTION_BRANCHES, SERVICE_SELECTION_MAP } from '../constants/questions';

test('verifySignature accepts valid and rejects tampered bodies', () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.equal(verifySignature(body, sig, 's3cret'), true);
  assert.equal(verifySignature(Buffer.from('{"a":2}'), sig, 's3cret'), false);
  assert.equal(verifySignature(body, undefined, 's3cret'), false);
  assert.equal(verifySignature(body, 'sha256=zz', 's3cret'), false);
});

test('extractMessages handles text and list replies, ignores statuses', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      contacts: [{ wa_id: '911', profile: { name: 'Asha' } }],
      messages: [
        { id: 'w1', from: '911', type: 'text', text: { body: 'Hi' } },
        { id: 'w2', from: '911', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: '3', title: 'x' } } },
        { id: 'w3', from: '911', type: 'image' }
      ]
    } }, { field: 'messages', value: { statuses: [{}] } }] }]
  };
  const msgs = extractMessages(payload);
  assert.deepEqual(msgs.map((m) => [m.id, m.text, m.name]), [['w1', 'Hi', 'Asha'], ['w2', '3', 'Asha']]);
});

test('question matrix matches blueprint counts', () => {
  const counts = Object.fromEntries(Object.entries(QUESTION_BRANCHES).map(([k, v]) => [k, v.length]));
  assert.deepEqual(counts, { COACHING: 5, LICENSING: 6, JOBS: 7, VISA_PR: 5, GENERAL: 3 });
  for (const v of Object.values(SERVICE_SELECTION_MAP)) assert.ok(QUESTION_BRANCHES[v]);
});
