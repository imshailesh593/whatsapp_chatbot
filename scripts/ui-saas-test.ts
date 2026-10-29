// Browser test of the SaaS flow: sign-up -> onboarding (template path) -> console -> bot builder.
// Needs DATABASE_URL and Edge/Chrome (BROWSER_PATH). Usage: npx tsx scripts/ui-saas-test.ts <screenshot-dir>
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'x';
process.env.GEMINI_API_KEY = '';
import Fastify from 'fastify';
import puppeteer from 'puppeteer-core';
import { registerAdmin } from '../src/admin';
import { prisma } from '../src/lib/prisma';

const OUT = process.argv[2] || '.';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cleanup = async () => {
    await prisma.workspace.deleteMany({ where: { adminUsers: { some: { email: { endsWith: '@ui-test.local' } } } } });
  };
  await cleanup();
  const app = Fastify();
  registerAdmin(app, { getQr: async () => null });
  await app.listen({ port: 3056 });
  const b = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1280, height: 900 });
  const errs: string[] = [];
  pg.on('pageerror', (e) => errs.push(String(e)));
  const click = async (sel: string, text: string) => {
    for (const t of await pg.$$(sel)) if ((await t.evaluate((e: any) => e.textContent)).includes(text)) { await t.click(); return; }
    throw new Error(`no ${sel} containing "${text}"`);
  };

  await pg.goto('http://localhost:3056/admin/', { waitUntil: 'networkidle0' });
  await click('button', 'Create an account');
  await pg.type('#biz', 'Glow Dental Clinic');
  await pg.type('#email', 'owner@ui-test.local');
  await pg.type('#password', 'owner-password-1');
  await pg.screenshot({ path: `${OUT}/1-signup.png` });
  await click('form button', 'Create account');

  await pg.waitForFunction(() => document.body.innerText.includes('Pick a starting point'), { timeout: 8000 });
  await pg.screenshot({ path: `${OUT}/2-templates.png` });
  await click('button', 'Real estate');
  await pg.waitForFunction(() => document.body.innerText.includes('Links and contact'));
  await pg.type('input[placeholder="https://cal.com/you"]', 'cal.com/glow');
  await pg.screenshot({ path: `${OUT}/3-links.png` });
  await click('button', 'Save & continue');
  await pg.waitForFunction(() => document.body.innerText.includes('WhatsApp connection'));
  await pg.screenshot({ path: `${OUT}/4-whatsapp.png` });
  await click('button', 'Continue');
  await pg.waitForFunction(() => document.body.innerText.includes('Chat with your bot'));
  // type in the simulator like a customer
  await pg.waitForSelector('input[placeholder], textarea');
  await sleep(500);
  await pg.screenshot({ path: `${OUT}/5-test.png` });
  await click('button', 'keep the bot paused');
  await pg.waitForSelector('header', { timeout: 8000 });
  await sleep(1200);
  await pg.screenshot({ path: `${OUT}/6-console.png` });
  const title = await pg.$eval('header', (e: any) => e.innerText);
  const paused = (await pg.evaluate(() => document.body.innerText)).includes('The bot is paused');
  await click('header button', 'Bot & Settings');
  await pg.waitForFunction(() => document.body.innerText.includes('Menu & questions'));
  await sleep(500);
  await pg.screenshot({ path: `${OUT}/7-builder.png`, fullPage: true });
  console.log('header shows business:', title.includes('Glow Dental Clinic'), '| paused banner:', paused, '| page errors:', errs.length ? errs : 'none');
  await b.close();
  await app.close();
  await cleanup();
  process.exit(0);
})().catch(async (e) => { console.error(e); process.exit(1); });
