// The public website: landing page, privacy, terms, refunds, contact. No database needed.
// Usage: npx tsx scripts/site-test.ts
process.env.PRODUCT_NAME = 'Test Console';
delete process.env.OPERATOR_NAME;
delete process.env.SUPPORT_EMAIL;
delete process.env.SUPPORT_PHONE;
delete process.env.BUSINESS_ADDRESS;
delete process.env.SIGNUP_ENABLED;
process.env.PUBLIC_URL = 'https://site.example/';
import Fastify from 'fastify';
import { registerSite } from '../src/site';
import { PLANS } from '../src/plans';

const ok = (c: any, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ok -', m); };

(async () => {
  const app = Fastify();
  registerSite(app);
  const get = (url: string, accept = 'text/html') => app.inject({ method: 'GET', url, headers: { accept } });

  console.log('[pages exist]');
  const paths = ['/', '/about', '/pricing', '/privacy', '/terms', '/refunds', '/shipping', '/contact'];
  const html: Record<string, string> = {};
  for (const p of paths) {
    const r = await get(p);
    html[p] = r.body;
    ok(r.statusCode === 200 && /text\/html/.test(String(r.headers['content-type'])) && r.body.startsWith('<!doctype html>'), `${p} is a normal HTML page`);
  }

  console.log('\n[every page]');
  for (const p of paths) {
    const b = html[p];
    ok(b.includes('© ' + new Date().getFullYear() + ' Rajni'), `${p}: the footer names the operator, Rajni`);
    ok(['/about', '/pricing', '/privacy', '/terms', '/refunds', '/shipping', '/contact'].every((l) => b.includes(`href="${l}"`)), `${p}: the footer links every policy and company page`);
    ok(!/<script/i.test(b), `${p}: no scripts`);
    ok(/<title>[^<]{10,}<\/title>/.test(b) && /<meta name="description" content="[^"]{20,}">/.test(b) && b.includes('width=device-width'), `${p}: has a title, description and is mobile-ready`);
    ok(b.includes(`<link rel="canonical" href="https://site.example${p}">`), `${p}: canonical address uses PUBLIC_URL`);
  }
  ok((await get('/')).headers['content-security-policy']!.toString().includes("default-src 'none'"), 'pages are served with a strict content security policy');

  ok(html['/'].includes('src="/admin/wappo-icon.png"') && html['/'].includes('rel="icon"') && html['/'].includes('property="og:image" content="https://site.example/admin/wappo-logo.jpg"'), 'the Wappo logo is in the header and footer, is the browser-tab icon and the share image');
  ok((await get('/')).headers['content-security-policy']!.toString().includes("img-src 'self' data:"), "the policy allows the site's own images");

  console.log('\n[landing page]');
  const l = html['/'];
  ok(/<h1>[^<]*WhatsApp[^<]*<\/h1>/.test(l), 'a clear headline about WhatsApp leads');
  for (const p of PLANS) ok(l.includes(p.name) && l.includes('₹' + (p.price.INR / 100).toLocaleString('en-IN')) && l.includes('$' + p.price.USD / 100), `pricing shows ${p.name} in rupees and dollars`);
  ok(!/free trial/i.test(l), 'there is no free trial on the landing page');
  for (const f of ['Capture and qualify', 'Answer and hand over', 'Book and follow up', 'Manage your leads (CRM)', 'Grow and measure', 'Connect your tools']) ok(l.includes(f), `feature group "${f}" is listed`);
  for (const w of ['Google Calendar', 'Broadcasts', 'Webhooks', 'REST API', 'simulator', 'Analytics', 'real person']) ok(l.toLowerCase().includes(w.toLowerCase()), `the page mentions ${w}`);
  ok((l.match(/<details>/g) ?? []).length >= 8, 'an FAQ with at least eight questions');
  ok(l.includes('not the official WhatsApp Business API') && l.includes('can limit or ban numbers'), 'it is honest that this is not the official API and numbers can be restricted');
  ok(l.includes('not affiliated with, endorsed by or sponsored by WhatsApp'), 'the non-affiliation notice is in the footer');
  ok(l.includes('Get started') && !/free trial/i.test(l), 'sign-up open: the main button says Get started');
  ok(!/\bMNS\b|Topmate|Samir/.test(l), 'no leftover content from the original single business');

  console.log('\n[policies]');
  const pv = html['/privacy'];
  ok(['Digital Personal Data Protection', 'grievance officer', 'Razorpay', 'Stripe', 'Gemini', 'Google API Services User Data Policy', 'processor', 'Your rights'].every((k) => pv.includes(k)), 'privacy policy covers the legal basics, providers, Google data and rights');
  ok(pv.includes('data fiduciary') && pv.includes('Cookies'), '...roles and cookies');
  const tm = html['/terms'];
  ok(['Acceptable use', 'Linked devices', 'AI-generated content', 'Limit of liability', 'Governing law', 'Indemnity', 'Plans and payment'].every((k) => tm.includes(k)), 'terms cover use, WhatsApp risk, AI, liability, law and billing');
  ok(tm.includes('laws of India') && tm.includes('the operator&#39;s place of residence in India'), 'governing law is India (jurisdiction placeholder is generic until set)');
  const rf = html['/refunds'];
  ok(['7 days', '5 to 7 working days', 'Cancel subscription', 'Duplicate or wrong charges', 'not refundable', 'How billing works'].every((k) => rf.includes(k)) && !/free trial/i.test(rf), 'refund policy states the window, timeline, cancellation steps and exclusions');
  ok(pv.includes('Operator:') && html['/contact'].includes('Operator:') && rf.includes('Operator:'), 'contact details block (operator name) appears on the policies');
  ok(!html['/contact'].includes('mailto:'), 'with no email configured, no empty mailto link is shown');

  console.log('\n[shipping, about and pricing: the pages payment providers ask for]');
  const sh = html['/shipping'];
  ok(sh.includes('digital software service') && sh.includes('no shipping charges') && sh.includes('activated automatically') && sh.includes('24 hours'), 'the shipping page explains it is a digital service with nothing shipped, and when a paid plan switches on');
  ok(sh.includes('Operator:') && sh.includes('href="/refunds"'), '...with the operator details and a link to the refund policy');
  const ab = html['/about'];
  ok(ab.includes('operated by <strong>Rajni</strong>') && ab.includes('not affiliated with WhatsApp or Meta') && ab.includes('Operator:'), 'the about page says what the service is and who runs it');
  const pr = html['/pricing'];
  ok(PLANS.every((p) => pr.includes('₹' + (p.price.INR / 100).toLocaleString('en-IN')) && pr.includes('$' + p.price.USD / 100)), 'the pricing page shows the plan in rupees and in dollars');
  ok(pr.includes('Taxes') && pr.includes('debited automatically every month') && !/free trial/i.test(pr) && pr.includes('href="/refunds"') && pr.includes('href="/shipping"'), '...with billing terms, the subscription wording and links to refunds and delivery');

  console.log('\n[prices follow the visitor\'s country]');
  const visit = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers: { accept: 'text/html', ...headers } });
  const IND = { 'x-real-ip': '49.36.1.1' };
  const ABROAD = { 'x-real-ip': '8.8.8.8' };
  const rupee = '₹' + (PLANS[0].price.INR / 100).toLocaleString('en-IN');
  const dollar = '$' + PLANS[0].price.USD / 100;
  const card = (cur: string) => `<div class="price">${cur}<small> / month</small></div>`;
  for (const path of ['/', '/pricing']) {
    const inIndia = (await visit(path, IND)).body;
    ok(inIndia.includes(card(rupee)) && !inIndia.includes(card(dollar)) && inIndia.includes('?region=world') && inIndia.includes('UPI AutoPay or card'), `${path}: a visitor in India sees rupees, UPI and a link to dollars`);
    const abroad = (await visit(path, ABROAD)).body;
    ok(abroad.includes(card(dollar)) && !abroad.includes(card(rupee)) && abroad.includes('?region=in') && abroad.includes('PayPal or card'), `${path}: a visitor abroad sees dollars, PayPal and a link to rupees`);
    ok((await visit(path)).body.includes(card(dollar)), `${path}: an unknown visitor sees dollars`);
    ok((await visit(path, { ...IND, cookie: 'region=OTHER' })).body.includes(card(dollar)), `${path}: a remembered choice beats the address`);
    ok((await visit(path + '?region=in', ABROAD)).body.includes(card(rupee)), `${path}: ?region=in shows rupees to anyone`);
  }
  const switched = await visit('/pricing?region=world', IND);
  ok(String(switched.headers['set-cookie']).startsWith('region=OTHER;') && switched.body.includes(card(dollar)), 'choosing dollars is remembered in a cookie');
  const priced = await visit('/', IND);
  ok(priced.headers['cache-control'] === 'private, no-cache' && String(priced.headers['vary']).includes('X-Real-Ip'), 'a page with a price is never stored for other visitors');
  ok(String((await visit('/privacy')).headers['cache-control']).startsWith('public'), 'pages without prices stay cacheable');
  ok(html['/privacy'].includes('use your IP address to work out your country'), 'the privacy policy says the address is used for the currency');

  console.log('\n[contact details come from settings, and are escaped]');
  process.env.SUPPORT_EMAIL = 'help@site.example';
  process.env.SUPPORT_PHONE = '+91 90000 00000';
  process.env.BUSINESS_ADDRESS = '12 Test Street <script>alert(1)</script>, Pune';
  process.env.OPERATOR_NAME = 'Rajni "R" <b>';
  const c = (await get('/contact')).body;
  ok(c.includes('mailto:help@site.example') && c.includes('+91 90000 00000') && c.includes('12 Test Street'), 'email, phone and address are shown when set');
  ok(!c.includes('<script>') && c.includes('&lt;script&gt;') && !c.includes('<b>') && c.includes('Rajni &quot;R&quot; &lt;b&gt;'), 'values are HTML-escaped, so settings cannot inject markup');
  delete process.env.OPERATOR_NAME;

  console.log('\n[sign-up closed]');
  process.env.SIGNUP_ENABLED = '0';
  const closed = (await get('/')).body;
  ok(!closed.includes('Start free') && !closed.includes('Start your 14-day') && closed.includes('Open the dashboard'), 'with sign-up off the buttons say Open the dashboard, not Start free');
  delete process.env.SIGNUP_ENABLED;

  console.log('\n[links, robots and errors]');
  const hrefs = [...new Set([...l.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]))].filter((h) => !h.startsWith('/admin/'));
  ok(l.includes('href="/admin/?plan=pro"') && !l.includes('class="btn p" href="/admin/"'), 'the call-to-action buttons open sign-up and then the payment page (/admin/?plan=pro)');
  for (const h of hrefs) ok((await get(h)).statusCode === 200, `internal link ${h} works`);
  ok(/href="#features"/.test(l) && /id="features"/.test(l) && /id="pricing"/.test(l) && /id="faq"/.test(l) && /id="how"/.test(l), 'in-page anchors have targets');
  const robots = (await get('/robots.txt', 'text/plain')).body;
  ok(robots.includes('Disallow: /admin/') && robots.includes('Sitemap: https://site.example/sitemap.xml'), 'robots.txt hides the dashboard and points to the sitemap');
  const sm = (await get('/sitemap.xml', 'application/xml')).body;
  ok(paths.every((p) => sm.includes(`<loc>https://site.example${p}</loc>`)), 'the sitemap lists every page');
  const nf = await get('/nope');
  ok(nf.statusCode === 404 && nf.body.includes('Page not found') && nf.body.includes('Rajni'), 'an unknown page shows a friendly 404 with the same footer');
  const api = await get('/api/whatever', 'application/json');
  ok(api.statusCode === 404 && api.json().error === 'Not found', 'unknown API paths still return JSON, not HTML');
  ok((await get('/admin/nothing', 'text/html')).headers['content-type']?.toString().includes('json'), 'dashboard paths keep their own error format');

  console.log('\nSITE TESTS OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
