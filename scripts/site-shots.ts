// Screenshots of the public website in light and dark, desktop and phone, to look at the design.
// Usage: npx tsx scripts/site-shots.ts <output-dir>
import dotenv from 'dotenv';
dotenv.config();
process.env.PUBLIC_URL = 'http://localhost:3058';
import Fastify from 'fastify';
import puppeteer from 'puppeteer-core';
import { registerAdmin } from '../src/admin';
import { registerSite } from '../src/site';

const OUT = process.argv[2] || '.';
const PORT = 3058;

(async () => {
  const app = Fastify();
  registerAdmin(app, { getQr: async () => null });
  registerSite(app);
  await app.listen({ port: PORT });
  const browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const problems: string[] = [];
  for (const [theme, width, height, tag] of [['light', 1366, 900, 'desktop'], ['dark', 1366, 900, 'desktop-dark'], ['light', 390, 800, 'phone'], ['dark', 390, 800, 'phone-dark']] as const) {
    for (const [path, name, full] of [['/?region=in', 'home', true], ['/pricing?region=in', 'pricing', false]] as const) {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
      await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle0' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 2) problems.push(`${name} ${tag}: sideways overflow ${overflow}px`);
      const font = await page.evaluate(() => document.fonts.check('16px Inter'));
      if (!font) problems.push(`${name} ${tag}: the Inter font did not load`);
      if (full && tag === 'desktop') {
        // the whole page, in screen-sized pieces so each can be read
        const total = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let i = 0; i * height < total; i++) await page.screenshot({ path: `${OUT}/${name}-${tag}-${i}.png`, clip: { x: 0, y: i * height, width, height: Math.min(height, total - i * height) }, captureBeyondViewport: true });
      } else {
        await page.screenshot({ path: `${OUT}/${name}-${tag}.png`, clip: { x: 0, y: 0, width, height }, captureBeyondViewport: true });
      }
      await page.close();
    }
  }
  await browser.close();
  await app.close();
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no problems');
  process.exit(problems.length ? 1 : 0);
})();
