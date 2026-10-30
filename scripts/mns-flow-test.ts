// The operator's own business setup (MNS Institute group): the language question, translated menu and questions, per-service
// closing messages with the right links, the AI notes, price questions typed without "?", and the 1/3/6/48-hour follow-ups.
// Usage: npx tsx scripts/mns-flow-test.ts   (needs DATABASE_URL; no Gemini key needed, translation is faked)
import dotenv from 'dotenv';
dotenv.config();
process.env.GEMINI_API_KEY = '';
import { prisma } from '../src/lib/prisma';
import { setTransport } from '../src/services/transport';
import { handleIncomingMessage, looksLikeQuestion } from '../src/services/engine';
import { invalidateConfig, loadConfig, resolveService } from '../src/services/botConfig';
import { setTranslatorForTests } from '../src/services/gemini';
import { languageOptionsText, offeredLanguages, parseLanguage } from '../src/services/language';
import { applyOwnBusiness, OWN_KNOWLEDGE, OWN_PROFILE, OWN_SERVICES } from '../src/ownBusiness';
import { dueStep, followUpTick, FOLLOW_UP_HOURS } from '../src/services/followups';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };
const sent: { to: string; text: string }[] = [];
const to = (phone: string) => sent.filter((s) => s.to === phone).map((s) => s.text);
let translations = 0;
setTranslatorForTests(async (text, language) => { translations++; return `[${language}] ${text}`; });

(async () => {
  const run = Date.now().toString(36);
  const W = await prisma.workspace.create({
    data: { slug: `mns-${run}`, name: 'MNS group', businessName: 'x', botEnabled: true, onboardingCompleted: true, plan: 'internal', planStatus: 'active', timezone: 'UTC' }
  });
  setTransport(W.id, { sendText: async (t, text) => void sent.push({ to: t, text }), ready: () => true });
  try {
    await applyOwnBusiness(W.id);
    const cfg = await loadConfig(W.id);
    const say = async (phone: string, text: string) => handleIncomingMessage(W.id, phone, 'Test', text);

    console.log('[the setup itself]');
    ok(cfg.services.length === 9 && cfg.services.every((s) => s.questions.length >= 2 && s.questions.length <= 12), 'nine menu options, each with its own questions');
    ok(cfg.services.map((s) => s.key).join() === 'COACHING,PROMETRIC_MATERIAL,LICENSING,JOBS,GERMAN,VISA_PR,WAPPO,ZEXY_AI,GENERAL', 'in the agreed order');
    ok(cfg.ws.languageStep && cfg.ws.languages === 'English, Hindi, Hinglish, Tamil, Malayalam' && cfg.ws.followUpsEnabled && cfg.ws.handoffEnabled && cfg.ws.formUrl === 'https://tally.so/r/7Rrl70', 'the language question is on with the five languages; follow-ups and hand-off are on; the profile form link is kept');
    ok(OWN_KNOWLEDGE.length < 8000 && cfg.ws.knowledge === OWN_KNOWLEDGE, 'the AI notes fit the limit and are saved');
    for (const [needle, why] of [
      ['Rs 14,500 for two months, or Rs 12,000', 'coaching prices'], ['Never offer one-month DHA', 'DHA is two months only'], ['Rs 8,000', 'study material price'],
      ['ONLY for nursing candidates', 'recorded lectures only for nurses'], ['Rs 1,75,000', 'licensing packages'], ['Rs 40,000', 'post-result fee'],
      ['Rs 6,500', 'job assistance enrollment'], ['Rs 43,500', 'job assistance balance'], ['Rs 70,000 for four months', 'German course'],
      ['Rs 499 per month', 'WAPPO price'], ['Rs 14,500 for two months. Includes topic-based', 'managed social media'], ['https://www.wappoai.com', 'the one WAPPO address'],
      ['https://zexyai.com', 'ZEXY AI address'], ['https://topmate.io/mnsinstitute/', 'consultation link'], ['https://www.mnsinstitutejobs.com', 'jobs website']
    ] as const) ok(OWN_KNOWLEDGE.includes(needle), `the notes carry ${why}`);
    ok(!/wappoai\.(in|co|app)\b|wappo\.ai/i.test(OWN_KNOWLEDGE + JSON.stringify(OWN_SERVICES)), 'no outdated WAPPO address anywhere');
    const numbers = (OWN_KNOWLEDGE + OWN_PROFILE.handoffMessage + JSON.stringify(OWN_SERVICES)).match(/\d{10,}/g) ?? [];
    ok(numbers.length > 0 && numbers.every((n) => n === '8700825077'), 'the only phone number anywhere is the team number 8700825077');
    ok(OWN_PROFILE.handoffMessage.includes('+91 8700825077') && OWN_KNOWLEDGE.includes('on +91 8700825077'), 'the hand-off message and the "call our team" answer carry it');
    const closingOf = (key: string) => cfg.services.find((s) => s.key === key)!.closingMessage;
    ok(closingOf('JOBS').includes('https://www.mnsinstitutejobs.com') && closingOf('WAPPO').includes('https://www.wappoai.com') && closingOf('ZEXY_AI').includes('https://zexyai.com'), 'each service closes with its own link');
    ok(['COACHING', 'LICENSING', 'VISA_PR'].every((k) => closingOf(k).includes('https://topmate.io/mnsinstitute/')), 'coaching, licensing and visa close with the consultation link');
    ok(!/₹|Rs\.? ?\d/.test(cfg.services.map((s) => s.closingMessage).join(' ')), 'no prices are pushed in the closing messages');

    console.log('\n[service words]');
    for (const [input, want] of [
      ['1', 'COACHING'], ['IELTS', 'COACHING'], ['DHA study material', 'PROMETRIC_MATERIAL'], ['test series', 'PROMETRIC_MATERIAL'], ['licensing', 'LICENSING'],
      ['jobs', 'JOBS'], ['German', 'GERMAN'], ['I need a visa', 'VISA_PR'], ['Malta', 'VISA_PR'], ['wappo', 'WAPPO'], ['video editing', 'ZEXY_AI'], ['9', 'GENERAL']
    ] as const) ok(resolveService(cfg, input) === want, `"${input}" selects ${want}`);

    console.log('\n[as shipped: the very first message asks for a language]');
    const FIVE = ['English', 'Hindi', 'Hinglish', 'Tamil', 'Malayalam'];
    const first = `9190${run}9`;
    await say(first, 'Hello');
    const ask = to(first)[0];
    ok(ask.startsWith(OWN_PROFILE.languageWelcome) && !/₹|Rs/.test(ask), 'the first reply asks which language the customer prefers, with no prices');
    ok(['1️⃣ English', '2️⃣ हिन्दी (Hindi)', '3️⃣ Hinglish', '4️⃣ தமிழ் (Tamil)', '5️⃣ മലയാളം (Malayalam)'].every((l) => ask.includes(l)) && !/6️⃣/.test(ask), 'it lists exactly English, Hindi, Hinglish, Tamil and Malayalam, numbered');
    ok(!ask.includes('tally.so') && !ask.includes('1️⃣ Coaching'), 'the menu and the form come after the language is chosen, not before');
    ok((await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: first } }))!.stage === 'AWAITING_LANGUAGE', 'the chat waits for the answer');
    await say(first, 'Telugu');
    ok(to(first)[1].startsWith('Sorry, I did not catch that') && to(first)[1].includes('Malayalam') && !to(first)[1].includes('Telugu'), 'a language that is not offered gets the choice list again');
    await say(first, '5');
    ok((await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: first } }))!.language === 'Malayalam' && to(first)[2].startsWith('[Malayalam] 📝'), '5 means Malayalam, and the form and menu arrive in Malayalam');
    for (const [reply, want] of [['1', 'English'], ['2', 'Hindi'], ['3', 'Hinglish'], ['4', 'Tamil'], ['hindi', 'Hindi'], ['Hinglish', 'Hinglish'], ['தமிழ்', 'Tamil'], ['മലയാളം', 'Malayalam'], ['english', 'English']] as const) {
      const p = `9190${run}${want.slice(0, 2)}${reply.length}${reply.charCodeAt(0) % 97}`;
      await say(p, 'hi');
      await say(p, reply);
      ok((await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: p } }))!.language === want, `"${reply}" chooses ${want}`);
    }
    const hinglishChat = `9190${run}Hl`;
    await say(hinglishChat, 'hi');
    await say(hinglishChat, '3');
    ok(to(hinglishChat).at(-1)!.startsWith('[Hinglish] 📝'), 'Hinglish is passed to the translator as its own language');
    const stuck = `9190${run}8`;
    await prisma.workspace.update({ where: { id: W.id }, data: { languageStep: false } });
    invalidateConfig(W.id);
    await prisma.session.create({ data: { workspaceId: W.id, phoneNumber: stuck, stage: 'AWAITING_LANGUAGE', language: 'Hy' } });
    await say(stuck, 'hello');
    ok(to(stuck)[0].includes('Welcome to') && (await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: stuck } }))!.stage === 'AWAITING_SERVICE_SELECTION', 'if a business stops asking, a chat left on the language question carries on with the menu');
    await prisma.workspace.update({ where: { id: W.id }, data: { languageStep: true } });
    invalidateConfig(W.id);

    console.log('\n[a chat left on a language the business does not offer]');
    for (const [tag, wrong] of [['Hy', 'Hy'], ['Te', 'Telugu']] as const) {
      const p = `9190${run}W${tag}`;
      await prisma.session.create({ data: { workspaceId: W.id, phoneNumber: p, stage: 'AWAITING_SERVICE_SELECTION', language: wrong } });
      await say(p, 'hello');
      const row = await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: p } });
      ok(to(p)[0].startsWith(OWN_PROFILE.languageWelcome) && row!.language === null && row!.stage === 'AWAITING_LANGUAGE', `a chat stuck on "${wrong}" is asked for its language again, in English`);
    }

    console.log('\n[language answers]');
    for (const [input, want] of [['1', 'English'], ['english', 'English'], ['2', 'Hindi'], ['हिन्दी', 'Hindi'], ['hindi', 'Hindi'], ['tamil', 'Tamil'], ['Telugu', 'Telugu']] as const) ok(parseLanguage(input) === want, `"${input}" is ${want}`);
    ok(parseLanguage('what is the fee?') === null && parseLanguage('') === null && parseLanguage('a'.repeat(40)) === null, 'a question or nonsense is not taken as a language');
    ok(['Hy', 'hy', 'hey', 'Hello', 'hi', 'hii', 'ok', 'yes', 'Nursing'].every((w) => parseLanguage(w) === null), 'greetings and ordinary words are not languages ("Hy" is the code for Armenian, but a customer typing it means hi)');
    ok(parseLanguage('Armenian') === 'Armenian' && parseLanguage('in tamil') === 'Tamil' && parseLanguage('தமிழ்') === 'Tamil', 'real languages are still recognised, by name or in their own script');
    const FIVE_ = offeredLanguages('English, Hindi, Hinglish, Tamil, Malayalam');
    ok(FIVE_.join() === 'English,Hindi,Hinglish,Tamil,Malayalam' && offeredLanguages('English').join() === 'English,Hindi', 'the offered languages come from the business\'s setting, in order, with a safe default');
    ok(parseLanguage('3', FIVE_) === 'Hinglish' && parseLanguage('5', FIVE_) === 'Malayalam' && parseLanguage('6', FIVE_) === null && parseLanguage('telugu', FIVE_) === null && parseLanguage('Armenian', FIVE_) === null && parseLanguage('മലയാളം', FIVE_) === 'Malayalam' && parseLanguage('हिन्दी', FIVE_) === 'Hindi', 'with a list, numbers follow it and languages outside it are refused');
    ok(languageOptionsText(FIVE_).split('\n').length === 5, 'the choice list has one line per language');

    console.log('\n[a Hindi-speaking customer, licensing]');
    const hi = `9190${run}1`;
    await say(hi, 'Hi');
    ok(to(hi)[0].startsWith(OWN_PROFILE.languageWelcome) && !/₹|Rs/.test(to(hi)[0]), 'the first reply is the welcome that asks for the language, with no prices');
    ok((await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: hi } }))!.stage === 'AWAITING_LANGUAGE', 'the chat waits for the language');
    await say(hi, 'what is the price?');
    ok(to(hi).length === 2 && to(hi)[1].startsWith('Sorry, I did not catch that') && to(hi)[1].includes('Malayalam'), 'a question instead of a language gets the choice list again');
    await say(hi, 'Hindi');
    ok((await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: hi } }))!.language === 'Hindi', 'the language is remembered');
    const menu = to(hi)[2];
    ok(menu.startsWith('[Hindi] 📝 Please fill out this short form') && menu.includes('https://tally.so/r/7Rrl70') && menu.includes('Then, to assist you better') && (menu.match(/\n/g) ?? []).length >= 10 && /9️⃣/.test(menu) && !/Welcome to/.test(menu), 'the form link and the nine-option menu come next, translated');
    await say(hi, '3');
    ok(to(hi)[3] === '[Hindi] What is your current profession?', 'the first licensing question is translated');
    const answers = ['Staff nurse', 'B.Sc Nursing, 2018', '5 years', 'No gap', 'India, wants to work in the UAE', 'No', 'Not yet'];
    for (const a of answers) await say(hi, a);
    const last = to(hi).at(-1)!;
    ok(last.startsWith('[Hindi] Thank you for sharing your details') && last.includes('https://topmate.io/mnsinstitute/'), 'the licensing closing message arrives translated, with the consultation link');
    const lead = await prisma.lead.findFirst({ where: { workspaceId: W.id, phoneNumber: hi } });
    ok(lead?.serviceCategory === 'LICENSING' && Object.keys(lead.collectedData as object).sort().join() === 'profession,qualification,experience,gap,location,existing_license,exam_status'.split(',').sort().join(), 'the lead is saved with all seven answers');
    await say(hi, 'menu');
    ok(to(hi).at(-1)!.startsWith('[Hindi] 📝') && to(hi).at(-1)!.includes('to assist you better'), 'MENU shows the menu again without asking the language again');

    console.log('\n[a customer who types a greeting as the language]');
    const hy = `9190${run}7`;
    await say(hy, 'Hi');
    await say(hy, 'Hy');
    ok(to(hy)[1].startsWith('Sorry, I did not catch that'), '"Hy" is not taken as Armenian: the customer gets a hint');
    ok((await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: hy } }))!.language === null, '...and no language is stored');
    await say(hy, 'hello');
    ok(to(hy)[2] === 'No problem, we will continue in English. Type *LANGUAGE* at any time to change it.' && to(hy)[3].includes('to assist you better') && !to(hy)[3].startsWith('['), 'a second miss carries on in English, with the menu');
    ok((await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: hy } }))!.language === 'English', '...and English is stored');
    await say(hy, 'language');
    ok(to(hy).at(-1)!.startsWith(OWN_PROFILE.languageWelcome) && to(hy).at(-1)!.includes('5️⃣'), 'LANGUAGE asks the language question again');
    await say(hy, 'Tamil');
    ok((await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: hy } }))!.language === 'Tamil' && to(hy).at(-1)!.startsWith('[Tamil]'), 'a language on the list works when asked for by name');
    ok(to(hy).at(-1)!.includes('type *LANGUAGE*'), 'the menu tells customers how to change the language');

    console.log('\n[an English-speaking customer, WAPPO and jobs]');
    const en = `9190${run}2`;
    const before = translations;
    await say(en, 'hello');
    await say(en, '1');
    ok(to(en)[1].startsWith('📝 Please fill out this short form') && to(en)[1].includes('https://tally.so/r/7Rrl70') && !to(en)[1].startsWith('['), 'English customers get the form link and the menu as written');
    await say(en, 'wappo');
    ok(to(en)[2].startsWith('What type of business'), 'WAPPO asks about the business, not healthcare questions');
    for (const a of ['A dental clinic', 'Answer enquiries', 'CRM', 'Need help preparing']) await say(en, a);
    ok(to(en).at(-1)!.includes('https://www.wappoai.com'), 'WAPPO closes with wappoai.com');
    ok(translations === before, 'nothing is sent to the translator for English');
    const en2 = `9190${run}3`;
    await say(en2, 'hi'); await say(en2, 'english'); await say(en2, '4');
    ok(to(en2).at(-1) === 'What is your current profession?', 'jobs starts with the profile questions');
    for (const a of ['Nurse', 'GNM 2015', '8 years', 'None', 'India', 'Canada', 'No']) await say(en2, a);
    ok(to(en2).at(-1)!.includes('https://www.mnsinstitutejobs.com') && to(en2).at(-1)!.includes('https://topmate.io/mnsinstitute/'), 'jobs closes with the website and the consultation link');

    console.log('\n[price questions without a question mark]');
    for (const t of ['DHA fees', 'ielts price', 'how much for german', 'kitna charge hai', 'what is the cost?']) ok(looksLikeQuestion(t), `"${t}" reaches the AI`);
    for (const t of ['Staff nurse', 'B.Sc Nursing 2018', 'ok', 'yes']) ok(!looksLikeQuestion(t), `"${t}" is just an answer`);

    console.log('\n[follow-ups]');
    ok(FOLLOW_UP_HOURS.join() === '1,3,6,48', 'the schedule is 1, 3, 6 and 48 hours');
    const t0 = new Date('2026-11-03T12:00:00Z').getTime();
    const H = 3_600_000;
    ok(dueStep(new Date(t0 - 30 * 60_000), 0, t0) === null && dueStep(new Date(t0 - 1 * H), 0, t0) === 0 && dueStep(new Date(t0 - 7 * H), 0, t0) === 2 && dueStep(new Date(t0 - 7 * H), 3, t0) === null && dueStep(new Date(t0 - 49 * H), 3, t0) === 3, 'the right step is picked, and only one even after a long gap');
    const mk = async (tag: string, hoursAgo: number, data: Record<string, unknown> = {}, stageKey?: string) => {
      const phone = `9199${run}${tag}`;
      const s = await prisma.session.create({
        data: { workspaceId: W.id, phoneNumber: phone, stage: 'IN_QUESTIONNAIRE', selectedService: 'JOBS', language: null, lastInteractionAt: new Date(t0 - hoursAgo * H), ...data }
      });
      if (stageKey) await prisma.lead.create({ data: { workspaceId: W.id, sessionId: s.id, phoneNumber: phone, serviceCategory: 'JOBS', collectedData: {}, stageKey } });
      return phone;
    };
    const q1 = await mk('a', 1.5);
    const q2 = await mk('b', 7, { language: 'Hindi' });
    const skipped = [
      await mk('c', 2, { optedOut: true }), await mk('d', 2, { isAgentPaused: true }), await mk('e', 2, { handoffAt: new Date(t0 - H) }),
      await mk('f', 2, {}, 'won'), await mk('g', 2, {}, 'lost'), await mk('h', 2, {}, 'booked'), await mk('i', 100), await mk('j', 0.5), await mk('k', 2, { followUpCount: 4 })
    ];
    const open = await mk('l', 2, {}, 'new');
    invalidateConfig(W.id);
    sent.length = 0;
    const outside = new Date('2026-11-03T22:30:00Z').getTime();
    ok((await followUpTick(outside)) === 0 && sent.length === 0, 'nothing goes out at night');
    await prisma.workspace.update({ where: { id: W.id }, data: { followUpsEnabled: false } });
    invalidateConfig(W.id);
    ok((await followUpTick(t0)) === 0, 'nothing goes out when the business has not switched it on');
    await prisma.workspace.update({ where: { id: W.id }, data: { followUpsEnabled: true } });
    invalidateConfig(W.id);
    const n = await followUpTick(t0);
    ok(n === 3 && to(q1).length === 1 && to(q2).length === 1 && to(open).length === 1, 'three eligible customers are nudged, one message each');
    ok(to(q1)[0].startsWith('Hello! I am following up on our previous discussion about International Job Assistance'), 'the first nudge names the service they were asking about');
    ok(to(q2)[0].startsWith('[Hindi] Hello! I wanted to check whether you have decided'), 'a customer silent for 7 hours gets the third nudge, once, in their language');
    ok(skipped.every((p) => to(p).length === 0), 'opted out, taken over, handed off, won, lost, booked, too old, too recent and finished sequences are all left alone');
    ok((await followUpTick(t0)) === 0, 'running again straight away sends nothing more');
    const later = await followUpTick(t0 + 2 * H);
    ok(later >= 1 && to(q1).length === 2 && to(q1)[1].startsWith('Hello! Do you have any update regarding'), 'two hours later the second nudge goes out to the first customer');
    await say(q1, 'Sorry, I was busy. Yes interested');
    ok((await prisma.session.findFirst({ where: { workspaceId: W.id, phoneNumber: q1 } }))!.followUpCount === 0, 'a reply from the customer resets the sequence');
    const stopper = await mk('m', 2);
    await say(stopper, 'STOP');
    ok((await followUpTick(t0 + 10 * H)) >= 0 && to(stopper).every((t) => !/following up/i.test(t)), 'a customer who sends STOP is never nudged');

    console.log('\nMNS FLOW TESTS OK');
  } finally {
    setTransport(W.id, null);
    await prisma.workspace.delete({ where: { id: W.id } }).catch(() => null);
    setTranslatorForTests(null);
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
