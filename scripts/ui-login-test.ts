// Browser test of the dashboard login + admin management. Needs DATABASE_URL and Edge/Chrome (BROWSER_PATH).
// Usage: npx tsx scripts/ui-login-test.ts <screenshot-dir>
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'x';
import Fastify from 'fastify';
import puppeteer from 'puppeteer-core';
import { registerAdmin } from '../src/admin';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/auth';

const OUT = process.argv[2];
(async () => {
  await prisma.adminUser.deleteMany({ where: { email: { endsWith: '@ui-test.local' } } });
  await prisma.adminUser.create({ data: { email: 'owner@ui-test.local', passwordHash: await hashPassword('owner-password-1') } });
  const app = Fastify();
  registerAdmin(app, { getWaStatus: () => 'ready' });
  await app.listen({ port: 3056 });
  const b = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1280, height: 800 });
  const errs: string[] = [];
  pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto('http://localhost:3056/admin/', { waitUntil: 'networkidle0' });
  await pg.screenshot({ path: `${OUT}/a-login.png` });
  await pg.type('#email', 'owner@ui-test.local');
  await pg.type('#password', 'wrong-password');
  await pg.click('form button');
  await pg.waitForSelector('[role=alert]');
  await pg.screenshot({ path: `${OUT}/b-login-error.png` });
  await pg.$eval('#password', (e: any) => (e.value = ''));
  await pg.type('#password', 'owner-password-1');
  await pg.click('form button');
  await pg.waitForSelector('header');
  await new Promise((r) => setTimeout(r, 800));
  // account menu
  const btns = await pg.$$('header button');
  for (const t of btns) if ((await t.evaluate((e: any) => e.textContent)).includes('owner@')) { await t.click(); break; }
  await new Promise((r) => setTimeout(r, 300));
  await pg.screenshot({ path: `${OUT}/c-menu.png` });
  // settings tab -> admins card -> add admin
  await pg.mouse.click(10, 500);
  for (const t of await pg.$$('header button')) if ((await t.evaluate((e: any) => e.textContent)).includes('Questionnaires')) { await t.click(); break; }
  await pg.waitForSelector('input[placeholder="new.admin@example.com"]');
  await pg.type('input[placeholder="new.admin@example.com"]', 'second@ui-test.local');
  await pg.type('input[placeholder^="Password"]', 'second-password-1');
  for (const t of await pg.$$('button')) if ((await t.evaluate((e: any) => e.textContent)).includes('Add admin')) { await t.click(); break; }
  await new Promise((r) => setTimeout(r, 800));
  await pg.screenshot({ path: `${OUT}/d-admins.png` });
  const rows = await pg.$$eval('div.divide-y > div', (els) => els.length);
  // reload keeps session
  await pg.reload({ waitUntil: 'networkidle0' });
  const stillIn = !!(await pg.$('header'));
  // sign out
  for (const t of await pg.$$('header button')) if ((await t.evaluate((e: any) => e.textContent)).includes('owner@')) { await t.click(); break; }
  for (const t of await pg.$$('button')) if ((await t.evaluate((e: any) => e.textContent)).includes('Sign out')) { await t.click(); break; }
  await pg.waitForSelector('#email');
  console.log('admin rows after add:', rows, '| session survives reload:', stillIn, '| back at login after sign out: true | page errors:', errs.length ? errs : 'none');
  await b.close(); await app.close();
  await prisma.adminUser.deleteMany({ where: { email: { endsWith: '@ui-test.local' } } });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
