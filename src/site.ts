import type { FastifyInstance, FastifyReply } from 'fastify';
import { PRODUCT_NAME } from './brand';
import { PLANS, TRIAL_DAYS, GRACE_DAYS } from './plans';

/**
 * The public website: landing page, privacy policy, terms, refund policy and contact page.
 * Plain server-rendered HTML with no scripts, so it is fast, readable everywhere and safe to index.
 */

const UPDATED = '29 October 2026';

const env = (k: string) => (process.env[k] ?? '').trim();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Who runs the service. The footer and every legal page name this person. */
const operator = () => env('OPERATOR_NAME') || 'Rajni';
const supportEmail = () => env('SUPPORT_EMAIL');
const supportPhone = () => env('SUPPORT_PHONE');
const address = () => env('BUSINESS_ADDRESS');
const hours = () => env('SUPPORT_HOURS');
const jurisdiction = () => env('LEGAL_JURISDICTION') || "the operator's place of residence in India";
const signupOpen = () => env('SIGNUP_ENABLED') !== '0';
const base = () => env('PUBLIC_URL').replace(/\/$/, '');

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const usd = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
const n = (v: number) => v.toLocaleString('en-IN');

const CSS = `
:root{--bg:#f7f8f5;--card:#fff;--ink:#14201a;--mute:#56645b;--line:#e2e7df;--brand:#2f6b3a;--brand2:#1f4f2a;--soft:#e8f2e6;--accent:#25d366;--warn:#fff7e0;--warnline:#ecd48a}
@media (prefers-color-scheme:dark){:root{--bg:#0d1511;--card:#121c16;--ink:#e8f0ea;--mute:#9fb0a5;--line:#22322a;--brand:#4ea25e;--brand2:#7ed08d;--soft:#16261b;--warn:#2a2410;--warnline:#5b4d1a}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--brand)}a:hover{color:var(--brand2)}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
header.top{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;gap:20px;height:60px}
.logo{font-weight:800;font-size:18px;color:var(--ink);text-decoration:none;display:flex;align-items:center;gap:8px}
.logo i{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--brand));display:inline-block}
nav.main{display:flex;gap:18px;margin-left:auto;align-items:center}
nav.main a{color:var(--mute);text-decoration:none;font-size:14px;font-weight:600}
nav.main a:hover{color:var(--ink)}
.btn{display:inline-block;padding:11px 20px;border-radius:10px;font-weight:700;text-decoration:none;font-size:15px;border:1px solid transparent}
.btn.p{background:var(--brand);color:#fff}.btn.p:hover{background:var(--brand2);color:#fff}
.btn.s{background:var(--card);color:var(--ink);border-color:var(--line)}
.btn.sm{padding:8px 14px;font-size:14px}
.hero{padding:64px 0 48px}
.hero .wrap{display:grid;grid-template-columns:1.15fr .85fr;gap:40px;align-items:center}
.eyebrow{display:inline-block;background:var(--soft);color:var(--brand);font-weight:700;font-size:13px;padding:5px 12px;border-radius:99px}
h1{font-size:clamp(32px,5vw,50px);line-height:1.1;margin:16px 0;letter-spacing:-.02em}
h2{font-size:clamp(24px,3.4vw,34px);line-height:1.2;margin:0 0 10px;letter-spacing:-.01em}
h3{font-size:18px;margin:0 0 6px}
.lead{font-size:18px;color:var(--mute);max-width:36em}
.cta{display:flex;flex-wrap:wrap;gap:12px;margin:26px 0 10px}
.fine{font-size:13px;color:var(--mute)}
.phone{background:#0b141a;border-radius:26px;padding:12px;max-width:340px;margin:0 auto;box-shadow:0 24px 60px rgba(0,0,0,.25)}
.phone .bar{background:#075e54;color:#fff;border-radius:16px 16px 0 0;padding:10px 14px;font-weight:700;font-size:14px}
.chat{background:#0f1c22;padding:12px;border-radius:0 0 16px 16px;display:flex;flex-direction:column;gap:8px;font-size:13.5px}
.b{max-width:84%;padding:8px 11px;border-radius:10px;line-height:1.4}
.b.in{background:#1f2c34;color:#e9edef;border-top-left-radius:2px}
.b.out{background:#005c4b;color:#e9edef;align-self:flex-end;border-top-right-radius:2px}
section{padding:54px 0}
section.alt{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.sub{color:var(--mute);max-width:46em;margin:0 0 28px}
.grid{display:grid;gap:18px}
.g3{grid-template-columns:repeat(3,1fr)}.g2{grid-template-columns:repeat(2,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
section.alt .card{background:var(--bg)}
.card ul{margin:10px 0 0;padding-left:18px;color:var(--mute);font-size:15px}.card li{margin:5px 0}
.num{width:34px;height:34px;border-radius:50%;background:var(--soft);color:var(--brand);font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:10px}
.price{font-size:34px;font-weight:800;letter-spacing:-.02em}.price small{font-size:14px;color:var(--mute);font-weight:600}
.plan.pop{border:2px solid var(--brand)}
.plan ul{list-style:none;padding:0;margin:14px 0 18px}.plan li{padding-left:24px;position:relative;margin:7px 0;color:var(--ink);font-size:15px}
.plan li:before{content:"✓";position:absolute;left:0;color:var(--brand);font-weight:800}
.plan li.no{color:var(--mute)}.plan li.no:before{content:"–";color:var(--mute)}
.note{background:var(--warn);border:1px solid var(--warnline);border-radius:14px;padding:16px 18px;font-size:15px}
details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:10px 0}
summary{cursor:pointer;font-weight:700}details p{margin:10px 0 0;color:var(--mute)}
.cta-band{background:linear-gradient(135deg,var(--brand2),var(--brand));color:#fff;border-radius:22px;padding:40px;text-align:center}
.cta-band h2{color:#fff}.cta-band .btn.p{background:#fff;color:var(--brand2)}
footer{border-top:1px solid var(--line);padding:34px 0;margin-top:20px;font-size:14px;color:var(--mute)}
footer .cols{display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between}
footer a{color:var(--mute);margin-right:16px}
.doc{max-width:760px;margin:0 auto;padding:44px 20px 20px}
.doc h1{font-size:34px}.doc h2{font-size:21px;margin-top:34px}.doc p,.doc li{color:var(--ink)}.doc ul{padding-left:22px}
.doc .meta{color:var(--mute);font-size:14px;margin-bottom:24px}
table.t{width:100%;border-collapse:collapse;font-size:14.5px;margin:12px 0}
table.t th,table.t td{border:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top}table.t th{background:var(--soft)}
@media (max-width:860px){.hero .wrap{grid-template-columns:1fr}.g3,.g4{grid-template-columns:1fr 1fr}nav.main a.h{display:none}}
@media (max-width:560px){.g3,.g2,.g4{grid-template-columns:1fr}.cta-band{padding:28px 20px}}
`;

type Doc = { title: string; description: string; path: string; body: string; landing?: boolean };

function page(d: Doc): string {
  const name = esc(PRODUCT_NAME);
  const who = esc(operator());
  const canon = base() ? `<link rel="canonical" href="${esc(base() + d.path)}">` : '';
  const year = new Date().getFullYear();
  const anchor = (id: string) => (d.landing ? `#${id}` : `/#${id}`);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.title)}</title>
<meta name="description" content="${esc(d.description)}">
<meta property="og:title" content="${esc(d.title)}"><meta property="og:description" content="${esc(d.description)}"><meta property="og:type" content="website">
<meta name="theme-color" content="#2f6b3a">
${canon}
<style>${CSS}</style>
</head><body>
<header class="top"><div class="wrap">
<a class="logo" href="/"><i></i>${name}</a>
<nav class="main">
<a class="h" href="${anchor('features')}">Features</a><a class="h" href="${anchor('how')}">How it works</a><a class="h" href="${anchor('pricing')}">Pricing</a><a class="h" href="${anchor('faq')}">FAQ</a>
<a href="/admin/">Sign in</a><a class="btn p sm" href="/admin/">${signupOpen() ? 'Start free' : 'Open dashboard'}</a>
</nav></div></header>
${d.body}
<footer><div class="wrap"><div class="cols">
<div><strong>${name}</strong><br>A WhatsApp lead-capture and follow-up service operated by <strong>${who}</strong>.<br>© ${year} ${who}. All rights reserved.</div>
<div><a href="/privacy">Privacy Policy</a><a href="/terms">Terms &amp; Conditions</a><a href="/refunds">Refund &amp; Cancellation</a><a href="/contact">Contact</a></div>
</div>
<p class="fine" style="margin-top:18px">${name} is an independent service. It is not affiliated with, endorsed by or sponsored by WhatsApp or Meta Platforms, Inc. WhatsApp is a trademark of its owner.</p>
</div></footer>
</body></html>`;
}

// ---------- landing ----------

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: 'Capture and qualify',
    items: [
      'Works on your own WhatsApp number: link it once by scanning a QR code, like WhatsApp Web.',
      'Greets every new customer, shows a numbered menu of your services and asks your questions one at a time.',
      'Up to 9 services with up to 12 questions each. Customers can pick by number or keyword.',
      'Finished conversations become leads with all the answers saved.',
      'Guided set-up: an AI assistant interviews you about your business and drafts the menu and questions, or start from a ready template (real estate, clinic, B2B services, overseas careers, general).',
      'Test the bot in a built-in simulator before it ever talks to a customer.'
    ]
  },
  {
    title: 'Answer and hand over',
    items: [
      'AI answers side questions in the customer\'s own language, using only the facts you wrote down. It does not invent prices or promises.',
      'When a customer asks for a real person, the bot steps back, tells them, and sends you a short AI briefing of who they are and what they want.',
      'Live inbox with full message history. Pause the bot for one chat and reply yourself, from the dashboard or from your phone with !pause and !resume.',
      'Customers can type menu to start over, or STOP to leave your lists.'
    ]
  },
  {
    title: 'Book and follow up',
    items: [
      'Connect Google Calendar: the bot offers real free times, books the one the customer picks, adds it to your calendar and sends a reminder before it starts.',
      'Customers can cancel or reschedule by message. Two people can never take the same slot.',
      'Instant lead alerts to your WhatsApp or email: new lead, booked, cancelled, asked for a person.',
      'Set a follow-up date on any lead and get a reminder when it is due.'
    ]
  },
  {
    title: 'Manage your leads (CRM)',
    items: [
      'List and board views with your own pipeline stages (New, Contacted, Follow-up, Booked, Won, Lost, or your own).',
      'Owner, tags, notes and a full timeline for every lead. Search and filter by service, stage, owner or tag.',
      'Export contacts to a CSV file any time.',
      'Team roles: owner, admin and agent, so staff see only what they need.'
    ]
  },
  {
    title: 'Grow and measure',
    items: [
      'Broadcasts to the people you choose, sent slowly, in daytime hours only, with a daily cap and automatic STOP handling to protect your number.',
      'Personalise each message with the customer\'s name.',
      'Analytics: conversations and leads per day, funnel, leads by stage, by service and by campaign, and the question where customers give up.',
      'Tracked chat links for your website, ads and posters, so you see which campaign each lead came from.'
    ]
  },
  {
    title: 'Connect your tools',
    items: [
      'Webhooks: every new lead or stage change is sent to Zapier, Make, n8n, your server or a Google Sheet. Requests are signed and retried.',
      'REST API with secret keys to read leads and change their stage from your own systems.',
      'Refer a business and earn a commission on its payments (when the referral programme is on).',
      'Your data stays yours: delete your business and everything in it at any time.'
    ]
  }
];

function landing(): string {
  const name = esc(PRODUCT_NAME);
  const planCards = PLANS.map((p, i) => {
    const l = p.limits;
    return `<div class="card plan${p.id === 'growth' ? ' pop' : ''}">
<h3>${esc(p.name)}</h3><p class="fine" style="margin:0 0 8px">${esc(p.blurb)}</p>
<div class="price">${inr(p.price.INR)}<small> / month</small></div><div class="fine">or ${usd(p.price.USD)} / month</div>
<ul>
<li>${n(l.conversations)} new conversations a month</li>
<li>${n(l.aiReplies)} AI answers a month</li>
<li>${l.seats} team members</li>
<li>${n(l.broadcasts)} broadcast messages a month</li>
<li>1 WhatsApp number</li>
<li>CRM, inbox, simulator, analytics</li>
<li>Google Calendar booking and human hand-off</li>
<li class="${p.integrations ? '' : 'no'}">Webhooks and REST API${p.integrations ? '' : ' (not included)'}</li>
</ul>
<a class="btn ${p.id === 'growth' ? 'p' : 's'}" href="/admin/">${signupOpen() ? `Start ${TRIAL_DAYS}-day free trial` : 'Get started'}</a>
${i === 1 ? '<div class="fine" style="margin-top:8px">Most popular</div>' : ''}
</div>`;
  }).join('');

  const faq: [string, string][] = [
    ['Do I need the official WhatsApp Business API?', `No. ${PRODUCT_NAME} links to your existing WhatsApp number through WhatsApp's "Linked devices" feature, the same way WhatsApp Web works. There is no Meta approval process and no per-message fee from us.`],
    ['Is it safe for my number?', 'The bot replies to people who message you first, which is normal use. Because this is not the official business API, WhatsApp can restrict any number that sends bulk or unwanted messages. We keep broadcasts slow, daytime-only and capped, and honour STOP, but we recommend a dedicated business number and only messaging people who have contacted you or agreed to hear from you.'],
    ['What does the AI do, and what does it not do?', 'It answers questions from the facts you give it (prices, hours, policies), in the language the customer writes in. If the answer is not in your notes it does not guess. It also writes the short briefing when a customer asks for a person, and helps you set up. The questions customers must answer are always the ones you wrote.'],
    ['Can customers talk to a real person?', 'Yes. If a customer asks for a human, the bot stops replying in that chat and alerts you with a summary. You reply from your phone or the dashboard, then hand the chat back to the bot when you are done.'],
    ['How does appointment booking work?', 'Connect your Google Calendar once and set your working days, hours and appointment length. The bot offers real free times from your calendar, books the one the customer chooses and reminds them before it starts.'],
    ['How much does it cost, and can I cancel?', `Plans start at ${inr(PLANS[0].price.INR)} a month. You can try it free for ${TRIAL_DAYS} days. Cancel any time from your dashboard and keep access until the end of the period you paid for. See the <a href="/refunds">refund and cancellation policy</a>.`],
    ['What happens when my plan or trial ends?', `The bot stops replying to new messages, but your leads and settings stay safe. A paid plan whose renewal fails keeps working for a ${GRACE_DAYS}-day grace period so you can fix the payment.`],
    ['Who can see my customers\' chats?', `Only you and the team members you add. We process the messages to run the service and never sell them. Read the <a href="/privacy">privacy policy</a> for details, including which providers are involved.`],
    ['What do I need to start?', 'A phone with WhatsApp (a business number is best), an email address, and about ten minutes. Sign up, describe your business or choose a template, scan the QR code and go live.']
  ];

  const body = `
<section class="hero"><div class="wrap">
<div>
<span class="eyebrow">WhatsApp lead capture, on your own number</span>
<h1>Turn every WhatsApp enquiry into a qualified lead.</h1>
<p class="lead">${name} greets new customers on your WhatsApp number, asks the right questions, answers common questions with AI, books appointments into your calendar and hands the hot ones to you. No Meta approval, no code.</p>
<div class="cta"><a class="btn p" href="/admin/">${signupOpen() ? `Start your ${TRIAL_DAYS}-day free trial` : 'Open the dashboard'}</a><a class="btn s" href="#features">See everything it does</a></div>
<div class="fine">${signupOpen() ? 'No card needed to start. ' : ''}Set up in about ten minutes.</div>
</div>
<div class="phone" aria-hidden="true"><div class="bar">Glow Dental Clinic</div><div class="chat">
<div class="b out">Hi, do you do teeth whitening?</div>
<div class="b in">Welcome to Glow Dental! Reply with a number:<br>1️⃣ Check-up<br>2️⃣ Whitening<br>3️⃣ Braces</div>
<div class="b out">2</div>
<div class="b in">Great choice. Have you had whitening before?</div>
<div class="b out">No, first time</div>
<div class="b in">Thanks! Reply <b>BOOK</b> to pick a time that suits you.</div>
</div></div>
</div></section>

<section class="alt" id="features"><div class="wrap">
<h2>Everything in the box</h2>
<p class="sub">One service covers the whole journey from first message to booked appointment. This is the complete list of what you get.</p>
<div class="grid g3">${FEATURES.map((f) => `<div class="card"><h3>${esc(f.title)}</h3><ul>${f.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
</div></section>

<section id="how"><div class="wrap">
<h2>Live in four steps</h2>
<p class="sub">No developers needed.</p>
<div class="grid g4">
<div class="card"><div class="num">1</div><h3>Sign up</h3><p class="fine">Create your account with your email. ${signupOpen() ? `Your ${TRIAL_DAYS}-day trial starts straight away.` : ''}</p></div>
<div class="card"><div class="num">2</div><h3>Describe your business</h3><p class="fine">Tell the AI assistant what you do, or pick a template. Review the menu and questions it proposes.</p></div>
<div class="card"><div class="num">3</div><h3>Scan the QR code</h3><p class="fine">Link your WhatsApp number from Linked devices. Test everything in the simulator first.</p></div>
<div class="card"><div class="num">4</div><h3>Go live</h3><p class="fine">Press go live. Leads arrive in your dashboard and your phone as they happen.</p></div>
</div></div></section>

<section class="alt" id="pricing"><div class="wrap">
<h2>Simple monthly pricing</h2>
<p class="sub">Pay in rupees (UPI or card) or in dollars (card). Every plan includes a ${TRIAL_DAYS}-day free trial with the Growth plan's limits. Plans renew monthly and you can cancel at any time. Taxes, if applicable, are extra.</p>
<div class="grid g3">${planCards}</div>
<p class="fine" style="margin-top:16px">What counts: a "new conversation" is a customer who messages you for the first time in a calendar month; limits reset every month. See the <a href="/refunds">refund and cancellation policy</a> and the <a href="/terms">terms</a>.</p>
</div></section>

<section id="trust"><div class="wrap">
<h2>Honest about how it works</h2>
<div class="note"><strong>Please read:</strong> ${name} connects to WhatsApp through the "Linked devices" feature on your own number. It is not the official WhatsApp Business API. WhatsApp can limit or ban numbers that send bulk or unwanted messages, and we cannot prevent that. Use a number you can afford to risk, message only people who contacted you or agreed to hear from you, and keep broadcasts relevant and polite.</div>
<div class="grid g3" style="margin-top:20px">
<div class="card"><h3>Your data</h3><p class="fine">Each business has its own isolated workspace. Google tokens are stored encrypted, passwords are hashed, webhooks are signed. You can delete everything at any time.</p></div>
<div class="card"><h3>Your customers</h3><p class="fine">The bot only answers people who message you. STOP is honoured automatically and broadcasts are limited to protect your reputation.</p></div>
<div class="card"><h3>Your control</h3><p class="fine">Pause the bot for the whole business or for one chat in a click. Customers can always reach a human.</p></div>
</div></div></section>

<section class="alt" id="faq"><div class="wrap">
<h2>Questions, answered</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}
</div></section>

<section><div class="wrap"><div class="cta-band">
<h2>Stop losing leads in your WhatsApp inbox.</h2>
<p>${signupOpen() ? `Try ${name} free for ${TRIAL_DAYS} days.` : `Open the dashboard to get started.`}</p>
<a class="btn p" href="/admin/">${signupOpen() ? 'Start free' : 'Open the dashboard'}</a>
</div></div></section>`;
  return page({ title: `${PRODUCT_NAME}: WhatsApp lead capture, CRM and appointment booking`, description: `${PRODUCT_NAME} turns WhatsApp enquiries into qualified leads: guided questions, AI answers, human hand-off, Google Calendar booking, CRM, broadcasts and analytics on your own number. Plans from ${inr(PLANS[0].price.INR)} a month.`, path: '/', body, landing: true });
}

// ---------- legal pages ----------

const doc = (title: string, path: string, description: string, html: string) =>
  page({ title: `${title} | ${PRODUCT_NAME}`, description, path, body: `<main class="doc"><h1>${esc(title)}</h1><p class="meta">Last updated: ${UPDATED}</p>${html}</main>` });

function contactLines(): string {
  const rows: string[] = [`<li><strong>Operator:</strong> ${esc(operator())}</li>`];
  if (supportEmail()) rows.push(`<li><strong>Email:</strong> <a href="mailto:${esc(supportEmail())}">${esc(supportEmail())}</a></li>`);
  if (supportPhone()) rows.push(`<li><strong>Phone / WhatsApp:</strong> ${esc(supportPhone())}</li>`);
  if (address()) rows.push(`<li><strong>Address:</strong> ${esc(address())}</li>`);
  if (hours()) rows.push(`<li><strong>Support hours:</strong> ${esc(hours())}</li>`);
  return `<ul>${rows.join('')}</ul>`;
}

function privacy(): string {
  const p = esc(PRODUCT_NAME);
  const o = esc(operator());
  return doc('Privacy Policy', '/privacy', `How ${PRODUCT_NAME} collects, uses and protects personal data.`, `
<p>This policy explains what personal data ${p} (the "Service"), operated by <strong>${o}</strong> ("we", "us", the "Operator"), collects, why, who it is shared with and the choices you have. It is written to meet the requirements of the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000 of India, and applies to everyone who uses the Service.</p>

<h2>1. Two kinds of people, two roles</h2>
<ul>
<li><strong>Business customers</strong> (people who sign up and use the dashboard). For their account data, we decide how it is used, so we are the data fiduciary / controller.</li>
<li><strong>End customers</strong> (people who send a WhatsApp message to a business that uses the Service). The business decides why and how their messages are used and we process them on the business's behalf as a processor. If you are an end customer and want your data corrected or deleted, please ask the business you messaged. You may also write to us (see section 11) and we will pass your request on or act on it where we can.</li>
</ul>

<h2>2. What we collect</h2>
<p><strong>From business customers:</strong></p>
<ul>
<li>Account data: name of business, email address, password (stored only as a one-way hash), role and team members you add.</li>
<li>Business settings: description, services, questions, notes, links, time zone, alert contact details and pipeline stages.</li>
<li>Usage and billing data: plan, usage counters, payment status and references. We do not store card numbers; payments are handled by Razorpay or Stripe.</li>
<li>The WhatsApp link: a session credential created when you scan the QR code, stored on our server so the bot stays connected.</li>
<li>If you connect Google Calendar: your Google account email and an access (refresh) token, stored encrypted, plus the calendar events we create for bookings and the free/busy times we read to offer slots.</li>
<li>Technical data: sign-in times, IP address in security logs, an audit log of administrative actions.</li>
</ul>
<p><strong>About end customers (on behalf of the business):</strong></p>
<ul>
<li>Phone number and WhatsApp display name.</li>
<li>The content of messages exchanged with the business's number, and the answers given to the business's questions.</li>
<li>Appointment details and any notes the business adds.</li>
</ul>
<p>We do not intentionally collect sensitive personal data. Businesses must not ask customers for card numbers, passwords or government identity numbers through the bot.</p>

<h2>3. Why we use it (purposes)</h2>
<ul>
<li>To provide the Service: run the bot, store leads, send alerts, book appointments and show your dashboard.</li>
<li>To secure the Service, prevent abuse and keep records of administrative actions.</li>
<li>To bill you, apply plans, process referrals and respond to support requests.</li>
<li>To improve reliability. We do not sell personal data, and we do not use end customers' messages for advertising.</li>
</ul>

<h2>4. Legal basis and consent</h2>
<p>We process business customers' data to perform our agreement with them and, where required, with their consent, which they may withdraw by closing their account. Businesses are responsible for having a lawful basis (such as the customer contacting them first, or consent) for messaging their own customers and for any broadcast they send.</p>

<h2>5. Who we share data with</h2>
<p>Only the providers needed to run the Service, under their own terms and privacy policies:</p>
<table class="t"><tr><th>Provider</th><th>Why</th></tr>
<tr><td>Meta / WhatsApp</td><td>The messaging network through which messages travel.</td></tr>
<tr><td>Google (Gemini AI)</td><td>Generates answers, onboarding suggestions and hand-off briefings. The text of the relevant conversation and your business notes are sent to the model to produce a reply.</td></tr>
<tr><td>Google (Sign-in and Calendar)</td><td>Only if you connect a calendar. We use the access only to read free/busy times and create or delete booking events.</td></tr>
<tr><td>Razorpay and Stripe</td><td>Payment processing for subscriptions.</td></tr>
<tr><td>Resend or another email provider</td><td>Sends alert emails, if you enable email alerts.</td></tr>
<tr><td>Cloud hosting provider</td><td>Servers and storage on which the Service and its database run.</td></tr>
</table>
<p>We may also disclose data if required by law, a court or a government authority, or to protect rights, safety and the integrity of the Service. If the Service is ever sold or transferred, data may move with it under the same protections.</p>
<p><strong>Google user data.</strong> Our use and transfer of information received from Google APIs will follow the Google API Services User Data Policy, including its Limited Use requirements. Calendar data is used only to provide the booking feature you ask for, is not used for advertising and is not shared except as needed to provide the Service.</p>

<h2>6. Cookies</h2>
<p>The public website sets no cookies. The dashboard sets one essential, HttpOnly session cookie to keep you signed in. We do not use advertising or third-party tracking cookies.</p>

<h2>7. How long we keep data</h2>
<ul>
<li>Account and business data: for as long as your account exists.</li>
<li>When a business deletes its account (or asks us to), we delete its workspace, chats, leads, team and WhatsApp and Google links. Encrypted backups may retain copies for up to 90 days before they are overwritten.</li>
<li>Billing records and the audit log may be kept for as long as the law or legitimate accounting needs require.</li>
</ul>

<h2>8. Security</h2>
<p>Each business's data is kept in its own workspace. Passwords are hashed, Google tokens are encrypted, webhooks are signed, traffic uses HTTPS, and administrative actions are logged. No system is perfectly secure; if a breach affecting your personal data occurs we will notify the affected persons and the Data Protection Board of India as the law requires.</p>

<h2>9. Your rights</h2>
<p>Subject to law you may: ask what data we hold about you and how it is used; ask us to correct or complete it; ask us to erase it; withdraw consent; nominate someone to exercise your rights if you die or become incapacitated; and complain to us about how your data is handled. Business customers can export contacts and delete their data from the dashboard. For anything else, contact us as below.</p>

<h2>10. Children</h2>
<p>The Service is for businesses and is not directed at anyone under 18. We do not knowingly collect personal data from children. If you believe a child's data has reached us, tell us and we will delete it.</p>

<h2>11. Contact and grievance officer</h2>
<p>For privacy requests and complaints, contact the Operator and grievance officer. We aim to acknowledge within 3 working days and resolve within 30 days.</p>
${contactLines()}

<h2>12. Changes</h2>
<p>We may update this policy. The date at the top shows the latest version, and for significant changes we will notify business customers by email or in the dashboard.</p>`);
}

function terms(): string {
  const p = esc(PRODUCT_NAME);
  const o = esc(operator());
  return doc('Terms & Conditions', '/terms', `The terms for using ${PRODUCT_NAME}.`, `
<p>These terms are an agreement between you and <strong>${o}</strong> (the "Operator", "we", "us") for the use of ${p} (the "Service"). By creating an account or using the Service you agree to them. If you use the Service for a business, you confirm you can bind that business. If you do not agree, do not use the Service.</p>

<h2>1. The Service</h2>
<p>${p} lets a business link its own WhatsApp number to an automated assistant that greets customers, asks questions, answers common questions with AI, hands conversations to people, books appointments in Google Calendar, stores leads in a CRM, sends alerts and broadcasts, and offers analytics and integrations. Features may change over time. The Service is delivered digitally, immediately on activation; nothing is shipped.</p>

<h2>2. Accounts</h2>
<ul>
<li>You must be at least 18 and provide accurate information.</li>
<li>You are responsible for your password and for everything done through your account and your team's accounts. Tell us promptly about any unauthorised use.</li>
<li>Owners can add team members; you are responsible for what they do.</li>
</ul>

<h2>3. WhatsApp: how it connects, and the risk</h2>
<ul>
<li>The Service connects to your WhatsApp number through WhatsApp's "Linked devices" feature. It is <strong>not</strong> the official WhatsApp Business API and is not affiliated with or endorsed by WhatsApp or Meta.</li>
<li>WhatsApp's own terms apply to your use of WhatsApp. WhatsApp can restrict, suspend or ban numbers at its sole discretion, especially for bulk or unwanted messaging, and may change or block this way of connecting at any time.</li>
<li>You use the Service at your own risk with regard to your WhatsApp account. We are not responsible for any restriction or loss of a number, or for interruptions caused by WhatsApp.</li>
<li>We recommend a dedicated business number.</li>
</ul>

<h2>4. Acceptable use</h2>
<p>You agree not to use the Service to: send spam or unsolicited bulk messages; message people who have not contacted you or agreed to be messaged; break any law, including data-protection, telecom, consumer and marketing laws; harass, threaten or deceive anyone; send illegal, hateful, sexually explicit, fraudulent or malicious content; collect sensitive data such as card numbers or passwords through the bot; infringe others' rights; attempt to break, overload or reverse engineer the Service; resell it without our written permission; or interfere with other users. We may suspend or end accounts that break these rules, with or without notice where there is a risk of harm.</p>

<h2>5. Your responsibilities for your customers</h2>
<p>You are responsible for the content you configure (menus, questions, notes, broadcasts), for having a lawful basis and any needed consent to message your customers, for honouring opt-outs (the Service handles STOP automatically), for telling your customers how you use their data, and for the accuracy of facts you give the AI. For personal data of your customers, you decide the purpose and means and we act as your processor under our <a href="/privacy">Privacy Policy</a>.</p>

<h2>6. AI-generated content</h2>
<p>Answers and summaries are generated by AI from the information you provide and the customer's message. AI can be wrong or incomplete. Check important facts and do not rely on it for legal, medical, financial or other professional advice. You are responsible for how you use outputs and for reviewing your bot's behaviour in the simulator before going live.</p>

<h2>7. Plans, free trial and payment</h2>
<ul>
<li>Plans, prices and limits are shown on our <a href="/#pricing">pricing section</a> and in your dashboard. Prices are in Indian rupees or US dollars; applicable taxes, if any, are extra.</li>
<li>A new business may get a free trial of ${TRIAL_DAYS} days with Growth-plan limits. We may change or end trials and promotions.</li>
<li>Paid plans are billed monthly in advance and renew automatically through Razorpay (rupees) or Stripe (dollars) until you cancel. You authorise us and our payment provider to charge your chosen payment method.</li>
<li>Monthly limits (new conversations, AI answers, team members, broadcast messages) reset each calendar month. When a limit is reached the related feature stops until the next month or an upgrade, as explained in your dashboard.</li>
<li>If a payment fails, the plan continues for a ${GRACE_DAYS}-day grace period. If the problem is not fixed the bot stops replying.</li>
<li>We may change prices with at least 30 days' notice before your next renewal.</li>
<li>Cancellations and refunds are covered by our <a href="/refunds">Refund &amp; Cancellation Policy</a>.</li>
</ul>

<h2>8. Your data</h2>
<p>You own your data and content. You give us permission to store and process it only to provide the Service, as described in the <a href="/privacy">Privacy Policy</a>. You can export contacts and delete your business at any time. We do not claim ownership of your customers' conversations.</p>

<h2>9. Our property</h2>
<p>The Service, its software, design and branding belong to the Operator or its licensors. We give you a limited, non-exclusive, non-transferable right to use it while your account is active. These terms do not transfer any ownership to you.</p>

<h2>10. Third-party services</h2>
<p>The Service depends on providers such as WhatsApp, Google, Razorpay, Stripe, email and hosting providers. Their availability and terms are outside our control, and an outage or change by a provider may affect the Service.</p>

<h2>11. Availability and support</h2>
<p>We aim to keep the Service available but do not promise uninterrupted or error-free operation. We may carry out maintenance, and the Service can be affected by events beyond our control. Support is provided by email as described on the <a href="/contact">contact page</a>.</p>

<h2>12. Suspension and termination</h2>
<p>You can cancel at any time from your dashboard. We may suspend or terminate your access if you breach these terms, if required by law, or if non-payment continues beyond the grace period. On termination your right to use the Service ends; we will delete your data as described in the Privacy Policy.</p>

<h2>13. Disclaimers</h2>
<p>The Service is provided "as is" and "as available", without warranties of any kind, to the fullest extent allowed by law. We do not warrant that it will meet your needs, generate leads or sales, be uninterrupted, or that WhatsApp will keep allowing this connection method.</p>

<h2>14. Limit of liability</h2>
<p>To the fullest extent allowed by law, the Operator is not liable for indirect, incidental, special, consequential or punitive losses, or for lost profits, revenue, leads, data or goodwill, or for the restriction or loss of a WhatsApp number. Our total liability for any claim relating to the Service is limited to the amount you paid us for the Service in the three months before the event that gave rise to the claim. Nothing here limits liability that cannot be limited by law.</p>

<h2>15. Indemnity</h2>
<p>You agree to compensate and hold harmless the Operator against claims, losses and costs arising from your content, your messages to customers, your breach of these terms or the law, or your use of the Service.</p>

<h2>16. Changes</h2>
<p>We may update these terms. We will give notice of material changes by email or in the dashboard, and continued use after the change means you accept it. The date above shows the latest version.</p>

<h2>17. Governing law and disputes</h2>
<p>These terms are governed by the laws of India. Courts at ${esc(jurisdiction())} have exclusive jurisdiction over disputes, subject to any mandatory consumer rights. Please contact us first and we will try to resolve any complaint in good faith.</p>

<h2>18. Contact</h2>
${contactLines()}`);
}

function refunds(): string {
  const p = esc(PRODUCT_NAME);
  return doc('Refund & Cancellation Policy', '/refunds', `Free trial, cancellation and refund rules for ${PRODUCT_NAME}.`, `
<p>This policy applies to paid plans of ${p}, operated by <strong>${esc(operator())}</strong>. The Service is a digital subscription, delivered online as soon as your plan is active. Nothing is shipped.</p>

<h2>1. Free trial</h2>
<p>New businesses can try the Service free for ${TRIAL_DAYS} days with Growth-plan limits. No payment method is needed to start a trial, and no charge is made unless you choose a paid plan.</p>

<h2>2. How billing works</h2>
<ul>
<li>Paid plans are billed monthly in advance, in Indian rupees (Razorpay) or US dollars (Stripe).</li>
<li>Plans renew automatically each month until you cancel.</li>
<li>If a renewal payment fails you keep access for a ${GRACE_DAYS}-day grace period.</li>
</ul>

<h2>3. Cancelling</h2>
<ul>
<li>You can cancel any time under <strong>Plan &amp; billing → Cancel subscription</strong> in your dashboard, or by emailing us from your account email.</li>
<li>Cancellation stops future renewals. You keep full access until the end of the period you have already paid for. There are no cancellation fees.</li>
</ul>

<h2>4. Refunds</h2>
<ul>
<li><strong>First-payment refund.</strong> If you are not satisfied with a paid plan, you may ask for a full refund of your <em>first</em> payment within <strong>7 days</strong> of that payment. After a refund, your account moves off the paid plan.</li>
<li><strong>Duplicate or wrong charges.</strong> If you were charged twice, charged the wrong amount or charged after a valid cancellation, we will refund the extra amount in full. Please tell us within 30 days of the charge.</li>
<li><strong>Extended outage.</strong> If the Service is unavailable for more than 72 hours in a row in a billing month because of a fault on our side, we will credit or refund the affected part of that month on request.</li>
<li><strong>Otherwise,</strong> payments for a month already started are not refundable, and we do not give partial refunds for unused days after cancelling.</li>
</ul>

<h2>5. What is not refundable</h2>
<ul>
<li>Renewals after the 7-day first-payment window, unless covered by section 4.</li>
<li>Any restriction, suspension or ban of your WhatsApp number by WhatsApp or Meta. This is outside our control (see the <a href="/terms">Terms</a>).</li>
<li>Plans or days given free of charge (trials, redeem codes, promotional offers or referral rewards).</li>
<li>Accounts closed for breaking the acceptable-use rules in the Terms.</li>
</ul>

<h2>6. How to ask for a refund</h2>
<p>Email us from your account email with your business name and the payment reference or date. We review requests within 3 working days.</p>

<h2>7. How refunds are paid</h2>
<p>Approved refunds are returned to the original payment method. Banks and payment providers usually take 5 to 7 working days to show the money in your account after we process it. We cannot speed up that step.</p>

<h2>8. Contact</h2>
${contactLines()}`);
}

function contact(): string {
  const p = esc(PRODUCT_NAME);
  return page({
    title: `Contact | ${PRODUCT_NAME}`,
    description: `How to reach the team behind ${PRODUCT_NAME} for support, billing and privacy requests.`,
    path: '/contact',
    body: `<main class="doc"><h1>Contact us</h1><p class="meta">Support for ${p}</p>
<p>We are happy to help with questions about the Service, billing, refunds and privacy requests.</p>
${contactLines()}
<h2>What to include</h2>
<p>Your business name, the email you sign in with and a short description of the problem. For billing, add the payment date or reference. For privacy requests, say what you want us to do with your data.</p>
<h2>Policies</h2>
<ul><li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms &amp; Conditions</a></li><li><a href="/refunds">Refund &amp; Cancellation Policy</a></li></ul></main>`
  });
}

const notFound = () =>
  page({ title: `Page not found | ${PRODUCT_NAME}`, description: 'Page not found', path: '/404', body: `<main class="doc"><h1>Page not found</h1><p>That page does not exist. <a href="/">Go to the home page</a>.</p></main>` });

// ---------- routes ----------

export const SITE_PATHS = ['/', '/privacy', '/terms', '/refunds', '/contact'] as const;

export function registerSite(app: FastifyInstance): void {
  const send = (reply: FastifyReply, html: string, status = 200) =>
    reply
      .status(status)
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'strict-origin-when-cross-origin')
      .send(html);

  app.get('/', async (_req, reply) => send(reply, landing()));
  app.get('/privacy', async (_req, reply) => send(reply, privacy()));
  app.get('/terms', async (_req, reply) => send(reply, terms()));
  app.get('/refunds', async (_req, reply) => send(reply, refunds()));
  app.get('/contact', async (_req, reply) => send(reply, contact()));

  app.get('/robots.txt', async (_req, reply) =>
    reply.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /qr\nDisallow: /api/\n${base() ? `Sitemap: ${base()}/sitemap.xml\n` : ''}`)
  );
  app.get('/sitemap.xml', async (req, reply) => {
    const origin = base() || `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
    const urls = SITE_PATHS.map((p) => `<url><loc>${esc(origin + p)}</loc></url>`).join('');
    return reply.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  // Unknown pages outside the dashboard and API get a friendly page (the API keeps its own JSON errors)
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && !url.startsWith('/admin') && !url.startsWith('/api') && !url.startsWith('/webhooks') && req.headers.accept?.includes('text/html')) return send(reply, notFound(), 404);
    return reply.status(404).send({ error: 'Not found' });
  });
}
