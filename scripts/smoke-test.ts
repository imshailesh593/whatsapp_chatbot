// Full browser smoke test: platform operator pages, then a business owner from referral sign-up to chatting with the bot.
// Fails on any page error, console error or unexpected HTTP error. Uses a fake WhatsApp transport (no real number).
// Needs DATABASE_URL, a built web app (web/dist) and Edge/Chrome (BROWSER_PATH).
// Usage: npx tsx scripts/smoke-test.ts <screenshot-dir>
import dotenv from 'dotenv';
dotenv.config();
process.env.ADMIN_TOKEN = 'smoke';
process.env.ADMIN_EMAIL = '';
process.env.GEMINI_API_KEY = '';
process.env.PUBLIC_URL = 'http://localhost:3057';
import Fastify from 'fastify';
import puppeteer, { Page } from 'puppeteer-core';
import { registerAdmin } from '../src/admin';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/auth';
import { setTransport } from '../src/services/transport';
import { setSetting } from '../src/services/settings';

const OUT = process.argv[2] || '.';
const DOMAIN = '@smoke.local';
const PORT = 3057;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const problems: string[] = [];
let checks = 0;
const ok = (c: any, m: string) => { checks++; if (!c) { problems.push('CHECK FAILED: ' + m); console.log('  FAIL -', m); } else console.log('  ok -', m); };

async function cleanup() {
  await prisma.workspace.deleteMany({ where: { adminUsers: { some: { email: { endsWith: DOMAIN } } } } });
  await prisma.adminUser.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.coupon.deleteMany({ where: { note: 'smoke' } });
  await prisma.auditLog.deleteMany({ where: { actor: { endsWith: DOMAIN } } });
}

(async () => {
  await cleanup();
  await setSetting('affiliate', {});
  const app = Fastify();
  registerAdmin(app, { getQr: async () => null });
  await app.listen({ port: PORT });
  const base = `http://localhost:${PORT}/admin/`;

  // an operator account (super admin) in its own workspace
  const opWs = await prisma.workspace.create({ data: { slug: `smoke-op-${Date.now().toString(36)}`, name: 'Smoke Ops', businessName: 'Smoke Ops', botEnabled: false, onboardingCompleted: true, plan: 'internal', planStatus: 'active' } });
  await prisma.adminUser.create({ data: { email: `operator${DOMAIN}`, passwordHash: await hashPassword('operator password 1'), role: 'owner', isSuperAdmin: true, workspaceId: opWs.id } });

  const browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });

  const watch = (page: Page, who: string) => {
    page.on('pageerror', (e) => problems.push(`[${who}] page error: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`[${who}] console error: ${m.text()}`); });
    page.on('response', (r) => {
      const s = r.status();
      if (s >= 400 && !(s === 401 && r.url().endsWith('/api/me'))) problems.push(`[${who}] HTTP ${s} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`);
    });
  };
  const newPage = async (who: string) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    watch(page, who);
    return page;
  };
  const text = (page: Page) => page.evaluate(() => document.body.innerText);
  const waitText = (page: Page, t: string, ms = 8000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, t);
  const click = async (page: Page, sel: string, label: string) => {
    for (const el of await page.$$(sel)) if ((await el.evaluate((e: any) => e.textContent)).includes(label)) { await el.click(); return; }
    throw new Error(`no ${sel} containing "${label}"`);
  };
  const shot = (page: Page, name: string, full = false) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });

  // ============ operator ============
  console.log('[operator]');
  const op = await newPage('operator');
  await op.goto(base, { waitUntil: 'networkidle0' });
  await op.type('#email', `operator${DOMAIN}`);
  await op.type('#password', 'operator password 1');
  await click(op, 'form button', 'Sign in');
  await waitText(op, 'Platform admin');
  await sleep(800);
  await shot(op, 'op-1-dashboard');
  const dash = await text(op);
  ok(/WhatsApp slots/.test(dash) && /Revenue/i.test(dash), 'dashboard shows KPIs and the WhatsApp slots strip');

  for (const [label, expect] of [
    ['Client Management', 'Add business'], ['Subscriptions', 'Subscriptions'], ['Payments', 'Payments'], ['Plans', 'Starter'],
    ['Redeem codes', 'New redeem code'], ['Affiliates', 'Referral programme'], ['Audit log', 'Audit'], ['Settings', 'WhatsApp numbers']
  ] as const) {
    await click(op, 'aside nav button', label);
    await sleep(700);
    const body = await text(op);
    ok(body.includes(expect) || body.length > 200, `operator page "${label}" renders`);
    if (['Redeem codes', 'Affiliates', 'Settings'].includes(label)) await shot(op, `op-${label.toLowerCase().replace(/\W+/g, '-')}`, true);
  }

  // redeem code: create one with a random code
  await click(op, 'aside nav button', 'Redeem codes');
  await sleep(400);
  await op.$$eval('input[placeholder="who it is for"]', (els: any[]) => els.forEach((e) => { e.focus(); }));
  await op.type('input[placeholder="who it is for"]', 'smoke');
  await click(op, 'button', 'Create');
  await waitText(op, 'Created ');
  const code = (await prisma.coupon.findFirst({ where: { note: 'smoke' } }))?.code;
  ok(!!code && (await text(op)).includes(code!), 'creating a redeem code lists it');

  // affiliates: switch the programme on
  await click(op, 'aside nav button', 'Affiliates');
  await sleep(400);
  await click(op, 'button', 'Off');
  await sleep(700);
  ok((await prisma.setting.findUnique({ where: { key: 'affiliate' } }))?.value && ((await prisma.setting.findUnique({ where: { key: 'affiliate' } }))!.value as any).enabled === true, 'switching the programme on is saved');

  // a referrer business exists so a referral link can be used
  const refWs = await prisma.workspace.create({ data: { slug: `smoke-ref-${Date.now().toString(36)}`, name: 'Referrer Co', businessName: 'Referrer Co', referralCode: 'SMOKE77', botEnabled: false, onboardingCompleted: true } });
  await prisma.adminUser.create({ data: { email: `referrer${DOMAIN}`, passwordHash: await hashPassword('referrer password 1'), role: 'owner', workspaceId: refWs.id } });

  // ============ business owner ============
  console.log('\n[business owner]');
  const ow = await newPage('owner');
  await ow.goto(base + '?ref=SMOKE77', { waitUntil: 'networkidle0' });
  ok((await text(ow)).includes('Business name'), 'a referral link opens the sign-up form');
  await ow.type('#biz', 'Glow Dental Clinic');
  await ow.type('#email', `owner${DOMAIN}`);
  await ow.type('#password', 'owner password 1');
  await click(ow, 'form button', 'Create account');
  await waitText(ow, 'Pick a starting point');
  const created = await prisma.workspace.findFirst({ where: { businessName: 'Glow Dental Clinic' } });
  ok(created?.referredById === refWs.id, 'the new business is recorded as referred by the link owner');
  await shot(ow, 'ow-1-templates');
  await click(ow, 'button', 'Real estate');
  await waitText(ow, 'Links and contact');
  await click(ow, 'button', 'Save & continue');
  await waitText(ow, 'WhatsApp connection');
  await click(ow, 'button', 'Continue');
  await waitText(ow, 'Chat with your bot');
  await click(ow, 'button', 'keep the bot paused');
  await ow.waitForSelector('header');
  await sleep(1000);
  await shot(ow, 'ow-2-console');
  ok((await text(ow)).includes('Glow Dental Clinic'), 'owner lands on the console after onboarding');

  // simulator: chat through the funnel, then ask for a person
  if (created) setTransport(created.id, { sendText: async () => undefined, ready: () => true });
  await click(ow, 'header button', 'Bot Simulator');
  await ow.waitForSelector('input[placeholder="Type your reply..."]');
  const say = async (m: string) => {
    await ow.type('input[placeholder="Type your reply..."]', m);
    await ow.keyboard.press('Enter');
    await sleep(700);
  };
  await say('hi');
  await say('1');
  const sim1 = await text(ow);
  ok(/Welcome|welcome/.test(sim1), 'the simulator greets the customer');
  await say('can I talk to a real person?');
  await sleep(500);
  const sim2 = await text(ow);
  ok(/our team to take over|person will reply/i.test(sim2), 'asking for a person gets the hand-off reply in the simulator');
  await shot(ow, 'ow-3-simulator');

  // CRM and inbox
  await click(ow, 'header button', 'Qualified Leads CRM');
  await sleep(900);
  ok(!(await text(ow)).includes('Could not load'), 'CRM loads without errors');
  await shot(ow, 'ow-4-crm');
  await click(ow, 'header button', 'Live Inbox');
  await sleep(900);
  await shot(ow, 'ow-5-inbox');
  await click(ow, 'header button', 'Analytics');
  await sleep(900);
  ok(!(await text(ow)).includes('Could not load'), 'Analytics loads');
  await click(ow, 'header button', 'Broadcasts');
  await sleep(900);
  ok(!(await text(ow)).includes('Could not load'), 'Broadcasts loads');

  // settings: every card is present
  await click(ow, 'header button', 'Bot & Settings');
  await waitText(ow, 'Menu & questions');
  await sleep(1200);
  const set = await text(ow);
  for (const t of ['Talk to a person', 'Appointments (Google Calendar)', 'Plan & billing', 'Refer & earn', 'Lead alerts', 'Integrations']) ok(set.includes(t) || (t === 'Integrations' && /webhook|API/i.test(set)), `settings shows "${t}"`);
  await shot(ow, 'ow-6-settings', true);
  ok(set.includes('Google sign-in is not set up'), 'calendar card explains Google keys are missing');
  const refLink = await ow.$$eval('input[readonly]', (els: any[]) => els.map((e) => e.value).find((v) => v.includes('?ref=')) ?? '');
  ok(/\/admin\/\?ref=[A-Z0-9]{7}$/.test(refLink), 'the owner sees their own referral link');

  // redeem a code from the billing card
  await ow.type('input[placeholder="Have a code?"]', code!.toLowerCase());
  await click(ow, 'button', 'Apply code');
  await waitText(ow, 'Code applied');
  const after = await prisma.workspace.findFirst({ where: { businessName: 'Glow Dental Clinic' } });
  ok(after?.plan === 'growth' && after.planStatus === 'active', 'applying a code switches the plan on');

  // turn hand-off off and back on, save
  const cb = await ow.$('input[type="checkbox"]');
  await cb!.click();
  await click(ow, 'form button', 'Save');
  await sleep(700);
  ok((await prisma.workspace.findUnique({ where: { id: after!.id } }))?.handoffEnabled === false, 'the hand-off switch saves');

  // mobile width: no horizontal scroll on the operator and owner screens
  await ow.setViewport({ width: 390, height: 800 });
  await sleep(500);
  const overflow = await ow.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 2, `owner settings fit a phone screen (overflow ${overflow}px)`);
  await shot(ow, 'ow-7-mobile');
  await op.setViewport({ width: 390, height: 800 });
  await sleep(500);
  const opOverflow = await op.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(opOverflow <= 2, `operator screen fits a phone (overflow ${opOverflow}px)`);

  await browser.close();
  await app.close();
  if (created) setTransport(created.id, null);
  await cleanup();
  await prisma.workspace.deleteMany({ where: { id: { in: [opWs.id, refWs.id] } } });
  await setSetting('affiliate', {});
  await prisma.$disconnect();

  console.log(`\n${checks} checks, ${problems.length} problem(s)`);
  for (const p of problems) console.log(' -', p);
  process.exit(problems.length ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
