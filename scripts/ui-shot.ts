// Dev helper: seeds sample conversations in the local DB, serves the dashboard, screenshots each tab.
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'shot';
import Fastify from 'fastify';
import puppeteer from 'puppeteer';
import { registerAdmin } from '../src/admin';
import { prisma } from '../src/lib/prisma';
import { captureReplies, setTransport, logMessage } from '../src/services/transport';
import { handleIncomingMessage } from '../src/services/engine';
import { QUESTION_BRANCHES } from '../src/constants/questions';

const OUT = process.argv[2];
const people: [string, string, string, number, string[]][] = [
  ['919820044512', 'Dr. Ananya Deshmukh', '2', 6, ['General Physician (MBBS)', 'MBBS, KEM Mumbai', '4.5 years', 'UAE - DHA', 'Yes - MMC', 'DataFlow pending']],
  ['919745581920', 'Rohan Varghese', '1', 5, ['OET for Nursing', 'B.Sc Nursing staff nurse', 'Intermediate', 'Within 2 months', 'English + Malayalam']],
  ['919412077341', 'Pooja Sharma', '3', 4, ['ICU Nurse', 'GNM + Post Basic B.Sc', '6 years', 'Germany']],
  ['919876521004', 'Jaspreet Singh Brar', '4', 5, ['Australia 189/190', 'Punjab, India', 'PR', 'Civil Engineer (B.Tech)', 'Yes - CDR started']]
];

(async () => {
  setTransport({ sendText: async () => {} });
  for (const [phone, name, svc, n, answers] of people) {
    await prisma.session.deleteMany({ where: { phoneNumber: phone } });
    await prisma.webhookLog.deleteMany({ where: { phoneNumber: phone } });
    const say = (t: string) => captureReplies(() => handleIncomingMessage(phone, name, t));
    await say('hi'); await say(svc);
    for (let i = 0; i < n && i < answers.length; i++) await say(answers[i]);
    await logMessage(phone, 'INBOUND', 'Hi'); await logMessage(phone, 'OUTBOUND', 'Welcome to MNS INSTITUTE…');
  }
  await prisma.lead.updateMany({ where: { phoneNumber: '919820044512' }, data: { isBookedTopmate: true, counsellorNotes: 'Topmate confirmed Thu 4 PM.' } });
  await prisma.session.updateMany({ where: { phoneNumber: '919820044512' }, data: { isAgentPaused: true } });

  const app = Fastify();
  registerAdmin(app, { getWaStatus: () => 'ready' });
  await app.listen({ port: 3055 });

  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1366, height: 900 });
  const errors: string[] = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await pg.goto('http://localhost:3055/admin/', { waitUntil: 'networkidle0' });
  await pg.screenshot({ path: `${OUT}/0-login.png` });
  await pg.type('input[type=password]', 'shot');
  await pg.click('button');
  await pg.waitForSelector('tbody tr', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500));
  await pg.screenshot({ path: `${OUT}/1-crm.png` });
  await pg.click('tbody tr');
  await new Promise((r) => setTimeout(r, 500));
  await pg.screenshot({ path: `${OUT}/2-dossier.png` });
  await pg.keyboard.press('Escape');
  await pg.mouse.click(20, 400);
  const tabs = await pg.$$('header button');
  const click = async (label: string, file: string, wait = 1200) => {
    for (const t of await pg.$$('header button')) {
      if ((await t.evaluate((e) => e.textContent ?? '')).includes(label)) { await t.click(); break; }
    }
    await new Promise((r) => setTimeout(r, wait));
    await pg.screenshot({ path: `${OUT}/${file}` });
  };
  await click('Live Inbox', '3-inbox.png');
  await click('Bot Simulator', '4-simulator.png', 2000);
  await pg.click('button.p-2'); // pick service 1
  await new Promise((r) => setTimeout(r, 1500));
  await pg.screenshot({ path: `${OUT}/5-simulator-q.png` });
  await click('Questionnaires', '6-settings.png');
  console.log('page errors:', errors.length ? errors : 'none');
  await b.close(); await app.close();
  for (const [phone] of people) await prisma.session.deleteMany({ where: { phoneNumber: phone } });
  await prisma.session.deleteMany({ where: { phoneNumber: 'SIM-console' } });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
