// Saves screenshots of the public website (desktop and phone). Usage: npx tsx scripts/site-shots.ts <dir>
import Fastify from 'fastify';
import puppeteer from 'puppeteer-core';
import { registerSite } from '../src/site';

(async () => {
  const out = process.argv[2] || '.';
  const app = Fastify();
  registerSite(app);
  await app.listen({ port: 3058 });
  const b = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
  const pg = await b.newPage();
  for (const [name, w] of [['desktop', 1280], ['phone', 390]] as const) {
    await pg.setViewport({ width: w, height: 900 });
    for (const p of ['/', '/refunds']) {
      await pg.goto('http://localhost:3058' + p, { waitUntil: 'networkidle0' });
      const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      console.log(name, p, 'horizontal overflow px:', over);
      await pg.screenshot({ path: `${out}/site-${name}-${p === '/' ? 'home' : 'refunds'}.png`, fullPage: true });
    }
  }
  await b.close();
  await app.close();
})();
