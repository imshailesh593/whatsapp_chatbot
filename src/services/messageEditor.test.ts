import test from 'node:test';
import assert from 'node:assert/strict';
import type { Workspace } from '@prisma/client';
import type { BotConfig } from './botConfig';
import { joinParts, splitMessage, stripSplit } from '../lib/split';
import { buildSystemPrompt, guardReply } from './agent';
import { batchReplies, captureReplies, sendTextMessage, setTransport } from './transport';
import { checkEdit, listMessages, matchSources, parseSuggestion, protectedDetails } from './messageEditor';

const closing = [
  'Thank you! Pro Nurse Placement: Total Rs 50,000.',
  '[if profession ~ nurs]',
  'Nurses can start with the IELTS course.',
  '[/if]',
  'Book here: https://topmate.io/mns/consult or call +91 98765 43210.'
].join('\n');

const cfg: BotConfig = {
  ws: {
    id: 'w1',
    businessName: 'MNS Institute',
    tagline: '',
    description: '',
    knowledge: '',
    welcomeIntro: 'We help nurses find work abroad.',
    languageWelcome: '',
    handoffMessage: 'Our team will take over from here.',
    bookingNote: 'Fees will be adjusted in the process.',
    bookingLabel: 'consultation',
    bookingUrl: 'https://topmate.io/mns/consult',
    formUrl: '',
    notifyPhone: '',
    aiInstructions: '',
    languages: 'English',
    tone: 'friendly',
    handoffEnabled: true
  } as unknown as Workspace,
  services: [
    { key: 'nurse', title: 'Nursing', keywords: [], closingMessage: closing, questions: [{ key: 'profession', prompt: 'What is your profession? [split] And how many years?' }] }
  ]
};
const messages = listMessages(cfg);
const byId = (id: string) => messages.find((m) => m.id === id)!;

test('split: parts in order, at most three, the rest stays in the last one', () => {
  assert.deepEqual(splitMessage('One [split] Two'), ['One', 'Two']);
  assert.deepEqual(splitMessage('a\n[SPLIT]\nb\n[split]\nc\n[split]\nd'), ['a', 'b', 'c\n\nd']);
  assert.deepEqual(splitMessage('a\n---\nb'), ['a\n---\nb']);
  assert.equal(stripSplit('One [split] Two'), 'One Two');
  assert.equal(joinParts(['One', 'Two'], false), 'One [split] Two');
});

test('delivery: a saved split becomes separate messages, everything else stays merged', async () => {
  const sent = await captureReplies(() =>
    batchReplies('w1', 'x', async () => {
      await sendTextMessage('w1', 'x', 'Hello');
      await sendTextMessage('w1', 'x', 'First part [split] Second part');
      await sendTextMessage('w1', 'x', 'Footer');
    })
  );
  assert.deepEqual(sent, ['Hello\n\nFirst part', 'Second part\n\nFooter']);
});

test('delivery: without the marker there is still exactly one message', async () => {
  const sent = await captureReplies(() =>
    batchReplies('w1', 'x', async () => {
      await sendTextMessage('w1', 'x', 'One');
      await sendTextMessage('w1', 'x', 'Two');
    })
  );
  assert.deepEqual(sent, ['One\n\nTwo']);
  setTransport('w1', null);
});

test('the AI never sees the marker and cannot use it', () => {
  const prompt = buildSystemPrompt({ cfg, service: cfg.services[0], answers: {}, completed: false, language: null, calendarOn: false, firstReply: true });
  assert.ok(!/\[split\]/i.test(prompt));
  assert.ok(!/\[split\]/i.test(guardReply('Sure. [split] What is your profession?', cfg).text));
});

test('editable messages: the saved texts, and which of them a reply came from', () => {
  assert.deepEqual(messages.map((m) => m.id), ['ws.welcomeIntro', 'ws.handoffMessage', 'ws.bookingNote', 'question.nurse.profession', 'closing.nurse']);
  assert.deepEqual(matchSources('Our team will take over from here.', messages), ['ws.handoffMessage']);
  assert.ok(matchSources('What is your profession?', messages).includes('question.nurse.profession'));
  assert.deepEqual(matchSources('Happy to help, what are you looking for today?', messages), []);
});

test('protected details: links, phones and prices', () => {
  const found = protectedDetails(closing);
  assert.ok(found.includes('https://topmate.io/mns/consult'));
  assert.ok(found.includes('rs50000'));
  assert.ok(found.includes('+919876543210'));
});

test('checks: rewording and splitting are fine; lost details warn; broken tags and too many parts are refused', () => {
  const m = byId('closing.nurse');
  const split = closing.replace('Book here:', '[split]\nBook here:');
  assert.deepEqual(checkEdit(m, split), { errors: [], warnings: [] });
  const noPrice = checkEdit(m, closing.replace('Rs 50,000', 'affordable'));
  assert.deepEqual(noPrice.errors, []);
  assert.match(noPrice.warnings.join(' '), /rs50000/);
  assert.match(checkEdit(m, closing.replace('[/if]', '')).errors.join(' '), /\[if/);
  assert.match(checkEdit(m, `${closing} [split] a [split] b [split] c`).errors.join(' '), /At most 3/);
  assert.match(checkEdit(byId('ws.bookingNote'), 'Fees [split] later.').errors.join(' '), /cannot be split/);
  assert.match(checkEdit(m, '   ').errors.join(' '), /empty/);
});

test('suggestions: cleaned, limited, and never split where that is not allowed', () => {
  assert.equal(parseSuggestion('{"parts":["Hi","Bye","x","y"],"note":"ok"}', byId('question.nurse.profession')).text, 'Hi [split] Bye [split] x');
  assert.equal(parseSuggestion('{"parts":["Fees","later."],"note":""}', byId('ws.bookingNote')).text, 'Fees later.');
  assert.throws(() => parseSuggestion('not json', byId('closing.nurse')));
  assert.throws(() => parseSuggestion('{"parts":[],"note":""}', byId('closing.nurse')));
});
