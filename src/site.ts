import { SITE_JS } from './siteScript';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PRODUCT_NAME } from './brand';
import { PLANS, GRACE_DAYS } from './plans';
import { detectRegion, type Region } from './lib/geo';

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
@font-face{font-family:"Inter";src:url(/admin/inter.woff2) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
:root{--bg:#fff;--alt:#f6f9fc;--card:#fff;--ink:#0a2540;--ink2:#425466;--mute:#6b7c93;--line:#e3e8ee;--brand:#0a8a64;--brand2:#067a58;--soft:#e6f7f0;--accent:#10b981;--btn:#0a2540;--btnh:#16365a;--btnt:#fff;--warn:#fff8e6;--warnline:#f6dc9a;--danger:#c0264b;--shadow:10 37 64;--g1:#a7f3d0;--g2:#67e8f9;--g3:#c4b5fd;--g4:#fbcfe8}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
a{color:var(--brand);text-underline-offset:3px}a:hover{color:var(--brand2)}
::selection{background:color-mix(in srgb,var(--accent) 30%,transparent)}
.wrap{max-width:1160px;margin:0 auto;padding:0 28px}
header.top{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:saturate(1.8) blur(16px);-webkit-backdrop-filter:saturate(1.8) blur(16px);border-bottom:1px solid transparent}
header.top .wrap{display:flex;align-items:center;gap:24px;height:72px}
.logo{font-weight:650;font-size:19px;letter-spacing:-.02em;color:var(--ink);text-decoration:none;display:flex;align-items:center;gap:10px}
.logo img{width:32px;height:32px;border-radius:9px;display:block}
nav.main{display:flex;gap:2px;margin-left:auto;align-items:center}
nav.main a{color:var(--ink2);text-decoration:none;font-size:15px;font-weight:500;padding:8px 14px;border-radius:99px;transition:color .15s,background .15s}
nav.main a:hover{color:var(--ink);background:color-mix(in srgb,var(--ink) 6%,transparent)}
nav.main a.btn{margin-left:10px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:14px 26px;border-radius:99px;font-weight:600;text-decoration:none;font-size:16px;border:1px solid transparent;transition:transform .15s,box-shadow .2s,background .15s;letter-spacing:-.005em}
.btn.p{background:var(--btn);color:var(--btnt);box-shadow:0 1px 1px rgba(var(--shadow),.1),0 10px 24px -10px rgba(var(--shadow),.5)}
.btn.p:hover{background:var(--btnh);color:var(--btnt);transform:translateY(-1px)}
.btn.p:after{content:"→";font-weight:500;transition:transform .15s}.btn.p:hover:after{transform:translateX(3px)}
nav.main a.btn.p:after{content:none}
.btn.s{background:transparent;color:var(--ink);border-color:var(--line)}
.btn.s:hover{border-color:color-mix(in srgb,var(--ink) 30%,var(--line));color:var(--ink);background:var(--card)}
.btn.sm{padding:9px 20px;font-size:15px}
/* hero */
.hero{position:relative;padding:72px 0 40px;overflow:hidden}
.hero-bg{position:absolute;inset:0 0 auto 0;height:900px;background:radial-gradient(46% 52% at 88% 6%,color-mix(in srgb,var(--g2) 85%,transparent),transparent 72%),radial-gradient(40% 46% at 70% -6%,color-mix(in srgb,var(--g1) 90%,transparent),transparent 70%),radial-gradient(36% 44% at 100% 34%,color-mix(in srgb,var(--g3) 80%,transparent),transparent 72%),radial-gradient(30% 36% at 78% 44%,color-mix(in srgb,var(--g4) 60%,transparent),transparent 70%);opacity:.75;-webkit-mask-image:linear-gradient(180deg,#000 55%,transparent);mask-image:linear-gradient(180deg,#000 55%,transparent);pointer-events:none}
.hero-bg:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.22) 0 1px,transparent 1px 44px);-webkit-mask-image:radial-gradient(60% 60% at 85% 20%,#000,transparent 75%);mask-image:radial-gradient(60% 60% at 85% 20%,#000,transparent 75%)}
.hero .wrap{position:relative;display:grid;grid-template-columns:1fr 1.08fr;gap:48px;align-items:center}
.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--brand);font-weight:600;font-size:14px;letter-spacing:-.005em}
.eyebrow:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)}
h1{font-size:clamp(40px,5.8vw,68px);line-height:1.03;margin:18px 0 22px;letter-spacing:-.045em;font-weight:650}
h2{font-size:clamp(30px,4vw,46px);line-height:1.08;margin:0 0 16px;letter-spacing:-.04em;font-weight:650}
h3{font-size:19px;margin:0 0 8px;letter-spacing:-.02em;font-weight:650}
.lead{font-size:20px;color:var(--ink2);max-width:30em;line-height:1.55;letter-spacing:-.01em}
.cta{display:flex;flex-wrap:wrap;gap:12px;margin:32px 0 14px}
.fine{font-size:14px;color:var(--mute)}
.chips{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:26px;color:var(--ink2);font-size:14.5px;font-weight:500}
.chips span:before{content:"✓";color:var(--brand);font-weight:800;margin-right:7px}
/* product preview */
.stage{position:relative;padding:0 0 110px 0}
.win{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 50px 100px -30px rgba(var(--shadow),.35),0 30px 60px -30px rgba(0,0,0,.3);overflow:hidden;transform:perspective(1400px) rotateY(-6deg) rotateX(2deg);transform-origin:left center;transition:transform .5s}
.stage:hover .win{transform:perspective(1400px) rotateY(0) rotateX(0)}
.win-bar{display:flex;align-items:center;gap:7px;padding:13px 16px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--mute);font-weight:500;background:var(--alt)}
.win-bar i{width:10px;height:10px;border-radius:50%;background:var(--line);display:inline-block}
.win-bar span{margin-left:10px}
.win-body{padding:18px 18px 8px}
.win-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
.win-stats div{border:1px solid var(--line);border-radius:12px;padding:11px 14px;background:var(--bg)}
.win-stats b{display:block;font-size:22px;letter-spacing:-.03em;font-weight:650;line-height:1.2}.win-stats span{font-size:12px;color:var(--mute)}
.row{display:flex;align-items:center;gap:12px;padding:11px 4px;border-top:1px solid var(--line);font-size:14px}
.row .av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--g1),var(--g2));color:#064e3b;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}
.row div{flex:1;min-width:0;line-height:1.35}.row b{display:block;font-weight:600}.row small{color:var(--mute);font-size:12.5px}
.pill{font-style:normal;font-size:12px;font-weight:600;padding:3px 11px;border-radius:99px;background:var(--alt);color:var(--ink2);border:1px solid var(--line);white-space:nowrap}
.pill.hot{background:#ffe8e3;color:#b3261e;border-color:#ffd0c8}.pill.ok{background:var(--soft);color:var(--brand);border-color:color-mix(in srgb,var(--brand) 25%,transparent)}
.phone{background:#0b141a;border-radius:30px;padding:10px;max-width:300px;box-shadow:0 40px 70px -20px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.07) inset}
.stage .phone{position:absolute;right:-30px;bottom:0;width:230px;transform:rotate(3deg);z-index:2}
.phone .bar{background:#075e54;color:#fff;border-radius:20px 20px 0 0;padding:11px 14px;font-weight:600;font-size:13.5px;display:flex;align-items:center;gap:9px}
.phone .bar:before{content:"";width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.22)}
.chat{background:#0f1c22;padding:12px;border-radius:0 0 20px 20px;display:flex;flex-direction:column;gap:7px;font-size:13px}
.b{max-width:86%;padding:8px 11px;border-radius:11px;line-height:1.38}
.b.in{background:#1f2c34;color:#e9edef;border-top-left-radius:3px}
.b.out{background:#005c4b;color:#e9edef;align-self:flex-end;border-top-right-radius:3px}
.stage .chat .b{opacity:0;animation:pop .5s ease forwards}
.stage .chat .b:nth-child(1){animation-delay:.4s}.stage .chat .b:nth-child(2){animation-delay:1.3s}.stage .chat .b:nth-child(3){animation-delay:2.3s}.stage .chat .b:nth-child(4){animation-delay:3.1s}.stage .chat .b:nth-child(5){animation-delay:4s}
@keyframes pop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
/* sections */
section{padding:104px 0}
section.alt{background:var(--alt);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.sub{color:var(--ink2);max-width:40em;margin:0 0 44px;font-size:19px;line-height:1.55;letter-spacing:-.01em}
.center{text-align:center}.center .sub{margin-left:auto;margin-right:auto}
.grid{display:grid;gap:22px}
.g3{grid-template-columns:repeat(3,1fr)}.g2{grid-template-columns:repeat(2,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 1px 2px rgba(var(--shadow),.04)}
section.alt .card{background:var(--card)}
.card ul{margin:12px 0 0;padding-left:18px;color:var(--ink2);font-size:15px}.card li{margin:6px 0}
.num{width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--ink);font-weight:650;display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:15px}
.ico{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,color-mix(in srgb,var(--g1) 60%,var(--bg)),color-mix(in srgb,var(--g2) 45%,var(--bg)));display:flex;align-items:center;justify-content:center;font-size:23px;line-height:1;margin-bottom:18px}
/* feature split */
.split{display:grid;grid-template-columns:1fr 1.05fr;gap:80px;align-items:center}
.split h2{margin-bottom:16px}.split p{color:var(--ink2);font-size:18px;line-height:1.6}
.rev .vis{order:-1}
.tick{list-style:none;padding:0;margin:24px 0 0}.tick li{padding-left:34px;position:relative;margin:13px 0;color:var(--ink);font-weight:500;font-size:16.5px}
.tick li:before{content:"✓";position:absolute;left:0;top:1px;width:22px;height:22px;border-radius:50%;background:var(--soft);color:var(--brand);font-weight:800;font-size:11.5px;display:flex;align-items:center;justify-content:center}
.mock{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:22px;box-shadow:0 40px 80px -40px rgba(var(--shadow),.45)}
.mock .mh{display:flex;align-items:center;gap:6px;margin-bottom:16px;font-size:12.5px;color:var(--mute);font-weight:500}
.mock .mh i{width:10px;height:10px;border-radius:50%;background:var(--line);display:inline-block}
.mock .chat{border-radius:16px;padding:16px;font-size:14px}
.kan{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.kan h4{margin:0 0 10px;font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);font-weight:600}
.lc{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:11px 12px;margin-bottom:10px;font-size:13px;line-height:1.35;box-shadow:0 1px 2px rgba(var(--shadow),.05)}
.lc b{display:block;font-weight:600}.lc span{color:var(--mute)}
.tag{display:inline-block;font-size:11px;padding:2px 9px;border-radius:99px;background:var(--soft);color:var(--brand);font-weight:600;margin-top:5px}
.tag.hot{background:#ffe8e3;color:#b3261e}
.brief{border:1px solid var(--warnline);background:var(--warn);border-radius:14px;padding:14px 16px;font-size:14px;margin-bottom:14px}
.brief b{display:block;margin-bottom:4px}
.slot{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:13px 15px;margin:10px 0;font-size:14.5px;font-weight:600}
.slot em{font-style:normal;font-size:12px;color:var(--brand);background:var(--soft);padding:3px 10px;border-radius:99px;font-weight:600}
.ok{background:var(--soft);border-radius:14px;padding:14px 16px;font-size:14.5px;margin-top:12px}
.eg{font-size:12.5px;color:var(--mute);text-align:center;margin-top:14px}
/* numbers */
.stats{padding:0}.stats .wrap{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:0 28px}
.stat{padding:44px 20px;border-left:1px solid var(--line)}.stat:first-child{border-left:0;padding-left:0}
.stat b{display:block;font-size:48px;letter-spacing:-.045em;font-weight:650;line-height:1.1;background:linear-gradient(120deg,var(--ink),var(--brand));-webkit-background-clip:text;background-clip:text;color:transparent}.stat span{font-size:15px;color:var(--mute)}
/* vs */
.vs{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.vs .card h3{margin-bottom:14px;font-size:20px}.vs ul{list-style:none;padding:0;margin:0}.vs li{padding-left:32px;position:relative;margin:12px 0;color:var(--mute);font-size:16px}
.vs .bad li:before{content:"✕";position:absolute;left:0;top:1px;width:21px;height:21px;border-radius:50%;background:color-mix(in srgb,var(--danger) 13%,transparent);color:var(--danger);font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center}
.vs .good li:before{content:"✓";position:absolute;left:0;top:1px;width:21px;height:21px;border-radius:50%;background:var(--soft);color:var(--brand);font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center}
.vs .good li{color:var(--ink)}
.vs .good{border-color:color-mix(in srgb,var(--brand) 55%,var(--line));box-shadow:0 30px 60px -36px color-mix(in srgb,var(--brand) 60%,transparent)}
/* full list */
.fl{display:grid;grid-template-columns:repeat(3,1fr);gap:48px 40px}
.fl h3{display:flex;align-items:center;gap:10px;font-size:17px}.fl .ico{width:36px;height:36px;border-radius:10px;font-size:18px;margin:0}
.fl ul{list-style:none;padding:0;margin:14px 0 0;border-top:1px solid var(--line)}
.fl li{padding:11px 0;border-bottom:1px solid var(--line);color:var(--ink2);font-size:14.5px;line-height:1.5}
/* use cases */
.uses{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid var(--line);border-radius:22px;overflow:hidden;background:var(--card)}
.uses .card{border:0;border-radius:0;border-right:1px solid var(--line);border-bottom:1px solid var(--line);box-shadow:none;padding:32px}
.uses .card:nth-child(3n){border-right:0}.uses .card:nth-last-child(-n+3){border-bottom:0}
.uses .ico{width:44px;height:44px;font-size:21px;margin-bottom:16px}
/* steps */
.steps{position:relative}
.steps .card{background:transparent;border:0;border-top:1px solid var(--line);border-radius:0;box-shadow:none;padding:26px 8px 0 0}
.steps .num{margin-bottom:14px;background:var(--ink);color:var(--bg);border:0}
/* compare */
.scroll{overflow-x:auto}
.cmpbox{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:8px;box-shadow:0 1px 2px rgba(var(--shadow),.04)}
table.cmp{width:100%;border-collapse:collapse;font-size:15px;min-width:660px}
table.cmp th,table.cmp td{padding:16px 18px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
table.cmp tbody tr:last-child td{border-bottom:0}
table.cmp thead th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);font-weight:600}
table.cmp td:first-child{font-weight:600}
table.cmp .us{background:var(--soft);font-weight:600;color:var(--ink)}
/* pricing */
.price{font-size:64px;font-weight:650;letter-spacing:-.05em;line-height:1.05}.price small{font-size:17px;color:var(--mute);font-weight:500;letter-spacing:0}
.plan.pop{border:1px solid color-mix(in srgb,var(--brand) 45%,var(--line));position:relative;border-radius:26px;padding:40px;box-shadow:0 60px 100px -50px color-mix(in srgb,var(--brand) 65%,transparent),0 1px 2px rgba(var(--shadow),.05)}
.plan.pop:before{content:"";position:absolute;inset:-1px;border-radius:27px;padding:1px;background:linear-gradient(135deg,var(--g1),var(--g2),var(--g3),var(--g4));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.plan ul{list-style:none;padding:0;margin:26px 0 28px;display:grid;grid-template-columns:1fr 1fr;gap:4px 28px}.plan li{padding-left:28px;position:relative;margin:7px 0;color:var(--ink);font-size:15.5px}
.plan li:before{content:"✓";position:absolute;left:0;top:2px;width:19px;height:19px;border-radius:50%;background:var(--soft);color:var(--brand);font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center}
.plan li.no{color:var(--mute)}.plan li.no:before{content:"–";color:var(--mute);background:transparent}
.plan .btn{width:100%}
.plan h3{font-size:22px}
.note{background:var(--warn);border:1px solid var(--warnline);border-radius:18px;padding:20px 24px;font-size:15.5px}
details{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:0 24px;margin:12px 0;transition:border-color .15s,box-shadow .15s}
details[open]{border-color:color-mix(in srgb,var(--brand) 40%,var(--line));box-shadow:0 20px 40px -28px rgba(var(--shadow),.4)}
summary{cursor:pointer;font-weight:600;padding:20px 0;list-style:none;display:flex;justify-content:space-between;gap:16px;align-items:center;letter-spacing:-.01em}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";font-size:24px;line-height:1;color:var(--mute);font-weight:300;transition:transform .2s}
details[open] summary:after{transform:rotate(45deg);color:var(--brand)}
details p{margin:0 0 20px;color:var(--ink2)}
.cta-band{position:relative;overflow:hidden;background:linear-gradient(120deg,#052e2b 0%,#0a6b52 45%,#0e8ea0 80%,#5b5bd6 100%);color:#fff;border-radius:32px;padding:84px 32px;text-align:center}
.cta-band:before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.07) 0 2px,transparent 2px 46px)}
.cta-band>*{position:relative}
.cta-band h2{color:#fff;font-size:clamp(32px,4.6vw,54px)}.cta-band p{color:rgba(255,255,255,.85);margin:0 0 30px;font-size:19px}
.cta-band .btn.p{background:#fff;color:#052e2b;box-shadow:0 14px 34px -12px rgba(0,0,0,.5)}.cta-band .btn.p:hover{background:#ecfdf5;color:#052e2b}
footer{border-top:1px solid var(--line);padding:56px 0 40px;margin-top:0;font-size:15px;color:var(--mute);background:var(--alt)}
footer .cols{display:flex;flex-wrap:wrap;gap:36px;justify-content:space-between}
footer a{color:var(--ink2);margin-right:20px;text-decoration:none;display:inline-block;margin-bottom:8px}footer a:hover{color:var(--ink)}
.doc{max-width:780px;margin:0 auto;padding:64px 28px 32px}
.doc h1{font-size:44px;margin-top:0;letter-spacing:-.04em}.doc h2{font-size:23px;margin-top:40px;letter-spacing:-.025em}.doc p,.doc li{color:var(--ink2)}.doc ul{padding-left:22px}
.doc .meta{color:var(--mute);font-size:14px;margin-bottom:30px}
table.t{width:100%;border-collapse:collapse;font-size:15px;margin:14px 0}
table.t th,table.t td{border:1px solid var(--line);padding:11px 15px;text-align:left;vertical-align:top}table.t th{background:var(--alt)}
@media (max-width:980px){.hero .wrap{grid-template-columns:1fr;gap:36px}.stage{padding:0 0 64px 0;max-width:560px;margin:0 auto;width:100%}.stage .phone{right:-6px}.split{grid-template-columns:1fr;gap:40px}.rev .vis{order:2}.split .vis{order:2}.vs{grid-template-columns:1fr}.fl{grid-template-columns:1fr 1fr}.uses{grid-template-columns:1fr 1fr}.uses .card{border-right:1px solid var(--line)!important;border-bottom:1px solid var(--line)!important}.g3,.g4{grid-template-columns:1fr 1fr}.stats .wrap{grid-template-columns:1fr 1fr}.stat:nth-child(3){border-left:0;padding-left:0}section{padding:72px 0}nav.main a.h{display:none}}
@media (max-width:620px){.fl,.uses,.g3,.g2,.g4{grid-template-columns:1fr}.plan ul{grid-template-columns:1fr}.plan.pop{padding:28px 22px}.cta-band{padding:56px 22px;border-radius:24px}.wrap{padding:0 20px}.hero{padding:44px 0 24px}.stage .phone{width:200px;right:-6px}.stage{padding-bottom:60px}.stat b{font-size:38px}.price{font-size:52px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}.stage .chat .b{opacity:1}.win{transform:none}}

/* ---- techy layer: blueprint grid, mono labels, motion ---- */
@property --ang{syntax:"<angle>";initial-value:0deg;inherits:false}
:root{--mono:ui-monospace,SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace}
#prog{position:fixed;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#10b981,#22d3ee,#818cf8);transform-origin:left;transform:scaleX(0);z-index:60;pointer-events:none}
header.top{transition:border-color .2s,box-shadow .2s}
header.top.stuck{border-bottom-color:var(--line);box-shadow:0 8px 30px -22px rgba(var(--shadow),.5)}
.hero:before{content:"";position:absolute;inset:0;background-image:linear-gradient(color-mix(in srgb,var(--ink) 7%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--ink) 7%,transparent) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(70% 80% at 70% 30%,#000,transparent 78%);mask-image:radial-gradient(70% 80% at 70% 30%,#000,transparent 78%);pointer-events:none}
.orb{position:absolute;border-radius:50%;filter:blur(64px);pointer-events:none;animation:float 16s ease-in-out infinite}
.orb.o1{width:340px;height:340px;right:6%;top:40px;background:color-mix(in srgb,var(--g2) 70%,transparent)}
.orb.o2{width:280px;height:280px;right:28%;top:300px;background:color-mix(in srgb,var(--g3) 60%,transparent);animation-delay:-7s;animation-duration:19s}
@keyframes float{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(-36px,26px) scale(1.08)}66%{transform:translate(30px,-22px) scale(.94)}}
.eyebrow{font-family:var(--mono);text-transform:uppercase;letter-spacing:.09em;font-size:12.5px;font-weight:600}
.eyebrow:before{animation:ping 2.4s ease-out infinite}
@keyframes ping{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 55%,transparent)}80%,100%{box-shadow:0 0 0 9px transparent}}
.btn.p{position:relative;overflow:hidden}
.btn.p:before{content:"";position:absolute;top:0;left:-70%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.38),transparent);transform:skewX(-20deg);animation:shine 5s ease-in-out infinite}
@keyframes shine{0%,62%{left:-70%}100%{left:140%}}
.btn.s,.btn.p{will-change:transform}
/* reveal on scroll (only when the script runs) */
.js .rv{opacity:0;transform:translateY(26px);transition:opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1)}
.js .rv.in{opacity:1;transform:none}
/* pointer spotlight */
.card,.mock,.term{position:relative}
.card:after,.mock:after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(340px circle at var(--mx,-999px) var(--my,-999px),color-mix(in srgb,var(--accent) 15%,transparent),transparent 70%);opacity:0;transition:opacity .25s}
.card:hover:after,.mock:hover:after{opacity:1}
/* live event ticker */
.ticker{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--alt);overflow:hidden;padding:15px 0;white-space:nowrap;font:500 13px/1 var(--mono);color:var(--ink2);-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.ticker .track{display:inline-flex;gap:54px;animation:marq 60s linear infinite;padding-left:54px}
.ticker:hover .track{animation-play-state:paused}
.ticker span{display:inline-flex;align-items:center;gap:9px}
.ticker i{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent);display:inline-block}
.ticker time{color:var(--mute)}.ticker b{color:var(--brand);font-weight:600}
@keyframes marq{to{transform:translateX(-50%)}}
/* flow diagram */
.flow{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:28px 24px;overflow-x:auto;box-shadow:0 40px 80px -50px rgba(var(--shadow),.4)}
.flow svg{width:100%;min-width:820px;height:auto;display:block}
.flow .node rect{fill:var(--bg);stroke:var(--line);stroke-width:1.5}
.flow .node.hot rect{stroke:var(--accent);filter:drop-shadow(0 8px 18px color-mix(in srgb,var(--accent) 35%,transparent))}
.flow .node text{fill:var(--ink);font:600 15px Inter,system-ui,sans-serif;text-anchor:middle}
.flow .node .sm{fill:var(--mute);font:500 12px var(--mono)}
.flow .base{stroke:var(--line);stroke-width:2;fill:none}
.flow .run{stroke:url(#fg);stroke-width:2.5;fill:none;stroke-dasharray:7 9;animation:dash 1.1s linear infinite}
@keyframes dash{to{stroke-dashoffset:-32}}
.flow .pulse{fill:var(--accent)}
.flow .ring{fill:none;stroke:var(--accent);stroke-width:2;transform-box:fill-box;transform-origin:center;animation:ring 2.6s ease-out infinite}
@keyframes ring{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.4);opacity:0}}
/* code window */
.term{background:#0a1020;color:#d7e3f4;border-radius:20px;border:1px solid #1c2842;font:13.5px/1.75 var(--mono);box-shadow:0 50px 90px -40px rgba(10,16,32,.7);overflow:hidden}
.term .tb{display:flex;align-items:center;gap:7px;padding:13px 16px;border-bottom:1px solid #1c2842;color:#7f93b4;font-size:12px}
.term .tb i{width:10px;height:10px;border-radius:50%;background:#26334f;display:inline-block}
.term .tb span{margin-left:8px}
.term .code{padding:18px 20px 22px;overflow-x:auto}
.split>*,.grid>*,.vs>*{min-width:0}
.term{max-width:100%}
.term .ln{display:block;white-space:pre;overflow:hidden;max-width:100%}
.js .term:not(.typing) .ln{max-width:0}
.term.typing .ln{max-width:0;animation:type .8s steps(38,end) forwards;animation-delay:calc(var(--i)*.42s)}
@keyframes type{from{max-width:0}to{max-width:100%}}
.term .k{color:#7dd3fc}.term .s{color:#86efac}.term .n{color:#fcd34d}.term .c{color:#64789c}.term .m{color:#f9a8d4}
.term .caret:after{content:"▍";color:#86efac;animation:blink 1s steps(1) infinite;margin-left:2px}
@keyframes blink{50%{opacity:0}}
.chipsrow{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
.chipsrow span{font:500 12.5px var(--mono);border:1px solid var(--line);border-radius:8px;padding:6px 11px;background:var(--card);color:var(--ink2)}
/* pricing outline turns */
.plan.pop:before{background:conic-gradient(from var(--ang),var(--g1),var(--g2),var(--g3),var(--g4),var(--g1));animation:spin 7s linear infinite}
@keyframes spin{to{--ang:360deg}}
.stat b{font-variant-numeric:tabular-nums}
@media (max-width:620px){.orb{display:none}.ticker{font-size:12px}}
@media (prefers-reduced-motion:reduce){.term .ln{max-width:100%!important}.orb,.ticker .track,.btn.p:before{animation:none!important}#prog{display:none}}
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
<meta property="og:title" content="${esc(d.title)}"><meta property="og:description" content="${esc(d.description)}"><meta property="og:type" content="website">${base() ? `<meta property="og:image" content="${esc(base())}/admin/wappo-logo.jpg">` : ''}
<meta name="theme-color" content="#047857"><meta name="color-scheme" content="light">
<link rel="preload" href="/admin/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="icon" type="image/png" href="/admin/wappo-icon-64.png">
<link rel="apple-touch-icon" href="/admin/wappo-icon.png">
${canon}
<style>${CSS}</style>
${d.landing ? '<script src="/site.js" defer></script>' : ''}
</head><body>
${d.landing ? '<div id="prog" aria-hidden="true"></div>' : ''}
<header class="top"><div class="wrap">
<a class="logo" href="/"><img src="/admin/wappo-icon.png" alt="${name} logo" width="32" height="32">${name}</a>
<nav class="main">
<a class="h" href="${anchor('features')}">Features</a><a class="h" href="${anchor('how')}">How it works</a><a class="h" href="${anchor('pricing')}">Pricing</a><a class="h" href="${anchor('faq')}">FAQ</a>
<a href="/admin/">Sign in</a><a class="btn p sm" href="/admin/?plan=pro">${signupOpen() ? 'Get started' : 'Open dashboard'}</a>
</nav></div></header>
${d.body}
<footer><div class="wrap"><div class="cols">
<div><img src="/admin/wappo-icon.png" alt="" width="36" height="36" style="border-radius:10px;display:block;margin-bottom:8px"><strong>${name}</strong><br>A WhatsApp lead-capture and follow-up service operated by <strong>${who}</strong>.<br>© ${year} ${who}. All rights reserved.</div>
<div><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms &amp; Conditions</a><a href="/refunds">Refund &amp; Cancellation</a><a href="/shipping">Shipping &amp; Delivery</a><a href="/contact">Contact</a></div>
</div>
<p class="fine" style="margin-top:18px">${name} is an independent service. It is not affiliated with, endorsed by or sponsored by WhatsApp or Meta Platforms, Inc. WhatsApp is a trademark of its owner.</p>
</div></footer>
</body></html>`;
}

// ---------- landing ----------

const FEATURE_ICONS: Record<string, string> = { 'Capture and qualify': '🎯', 'Answer and hand over': '💬', 'Book and follow up': '📅', 'Manage your leads (CRM)': '📊', 'Grow and measure': '📈', 'Connect your tools': '🔌' };

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
      'Customers pick a date, then a time, right in the chat. Use the built-in calendar, or connect Google Calendar so the bot also avoids your other events and adds each booking to it.',
      'Every booking is confirmed to the customer on WhatsApp and alerted to you straight away, with a reminder before it starts.',
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

/** The sentence above the price: which currency is shown and why. */
const pricingLead = (region: Region) =>
  region === 'IN'
    ? 'One plan with everything included, shown in Indian rupees with UPI and card payment. The price is for your country, found from your IP address.'
    : 'One plan with everything included, shown in US dollars with PayPal and card payment. The price is for your country, found from your IP address.';

/** The plan card in the visitor's currency, with a link to see the other one (a wrong guess is one click to fix). */
function planCardsHtml(region: Region, path: string): string {
  const rupees = region === 'IN';
  const anchor = path === '/' ? '#pricing' : '';
  return PLANS.map((p) => {
    const l = p.limits;
    const price = rupees
      ? `<div class="price">${inr(p.price.INR)}<small> / month</small></div><div class="fine" style="margin-top:4px">Shown in Indian rupees. <a href="${path}?region=world${anchor}">Show US dollars (${usd(p.price.USD)})</a></div>`
      : `<div class="price">${usd(p.price.USD)}<small> / month</small></div><div class="fine" style="margin-top:4px">Shown in US dollars. <a href="${path}?region=in${anchor}">Paying from India? Show rupees (${inr(p.price.INR)})</a></div>`;
    return `<div class="card plan pop">
<h3>${esc(p.name)}</h3><p class="fine" style="margin:0 0 8px">${esc(p.blurb)}</p>
${price}
<ul>
<li>${n(l.conversations)} new conversations a month</li>
<li>${n(l.aiReplies)} AI answers a month</li>
<li>${l.seats} team members</li>
<li>${n(l.broadcasts)} broadcast messages a month</li>
<li>1 WhatsApp number</li>
<li>CRM, inbox, simulator, analytics</li>
<li>In-chat appointment booking and human hand-off</li>
<li class="${p.integrations ? '' : 'no'}">Webhooks and REST API${p.integrations ? '' : ' (not included)'}</li>
<li>Free updates and email support</li>
<li>${rupees ? 'Monthly subscription: UPI AutoPay or card' : 'Monthly subscription: PayPal or card'}</li>
</ul>
<a class="btn p" href="/admin/?plan=pro">Subscribe</a>
<p class="fine" style="margin-top:8px">Renews automatically every month. Cancel any time.</p>
</div>`;
  }).join('');
}

function landing(region: Region): string {
  const name = esc(PRODUCT_NAME);
  const planCards = planCardsHtml(region, '/');

  const faq: [string, string][] = [
    ['Do I need the official WhatsApp Business API?', `No. ${PRODUCT_NAME} links to your existing WhatsApp number through WhatsApp's "Linked devices" feature, the same way WhatsApp Web works. There is no Meta approval process and no per-message fee from us.`],
    ['Is it safe for my number?', 'The bot replies to people who message you first, which is normal use. Because this is not the official business API, WhatsApp can restrict any number that sends bulk or unwanted messages. We keep broadcasts slow, daytime-only and capped, and honour STOP, but we recommend a dedicated business number and only messaging people who have contacted you or agreed to hear from you.'],
    ['What does the AI do, and what does it not do?', 'It answers questions from the facts you give it (prices, hours, policies), in the language the customer writes in. If the answer is not in your notes it does not guess. It also writes the short briefing when a customer asks for a person, and helps you set up. The questions customers must answer are always the ones you wrote.'],
    ['Can customers talk to a real person?', 'Yes. If a customer asks for a human, the bot stops replying in that chat and alerts you with a summary. You reply from your phone or the dashboard, then hand the chat back to the bot when you are done.'],
    ['How does appointment booking work?', 'Set your working days, hours and appointment length once. The customer replies BOOK, picks a date, then picks a time. The bot books it, confirms it to them on WhatsApp, alerts you and reminds them before it starts. You can use the built-in calendar or connect Google Calendar.'],
    ['How much does it cost, and can I cancel?', `One plan with everything included: ${inr(PLANS[0].price.INR)} a month in India, ${usd(PLANS[0].price.USD)} a month everywhere else. It is a monthly subscription that renews automatically. Cancel any time from your dashboard and keep access until the end of the period you paid for. See the <a href="/refunds">refund and cancellation policy</a>.`],
    ['How does the monthly auto-debit work?', `You subscribe once and approve the recurring payment: in India with UPI AutoPay or a card (through Razorpay), elsewhere with PayPal or a card. After that the monthly amount is debited automatically on the same date, and you are notified before each debit. Nothing is charged until you approve. To stop, cancel under Plan &amp; billing (or from your UPI app or PayPal) and no further payments are taken.`],
    ['What happens when my plan ends?', `The bot stops replying to new messages, but your leads and settings stay safe. A paid plan whose renewal fails keeps working for a ${GRACE_DAYS}-day grace period so you can fix the payment.`],
    ['Who can see my customers\' chats?', `Only you and the team members you add. We process the messages to run the service and never sell them. Read the <a href="/privacy">privacy policy</a> for details, including which providers are involved.`],
    ['What do I need to start?', 'A phone with WhatsApp (a business number is best), an email address, and about ten minutes. Sign up, describe your business or choose a template, scan the QR code and go live.']
  ];

  const body = `
<section class="hero"><div class="hero-bg" aria-hidden="true"><span class="orb o1"></span><span class="orb o2"></span></div><div class="wrap">
<div>
<span class="eyebrow">WhatsApp lead capture, on your own number</span>
<h1>Turn every WhatsApp enquiry into a qualified lead.</h1>
<p class="lead">${name} greets new customers on your WhatsApp number, asks the right questions, answers common questions with AI, books appointments into your calendar and hands the hot ones to you. No Meta approval, no code.</p>
<div class="cta"><a class="btn p" href="/admin/?plan=pro">${signupOpen() ? 'Get started' : 'Open the dashboard'}</a><a class="btn s" href="#features">See everything it does</a></div>
<div class="fine">${signupOpen() ? 'No card needed to start. ' : ''}Set up in about ten minutes.</div>
<div class="chips"><span>Your own number</span><span>Replies in the customer's language</span><span>Book dates and times in chat</span><span>Built-in CRM</span></div>
</div>
<div class="stage" aria-hidden="true">
<div class="win"><div class="win-bar"><i></i><i></i><i></i><span>Leads · Glow Dental Clinic</span></div>
<div class="win-body">
<div class="win-stats"><div><b>128</b><span>Conversations</span></div><div><b>46</b><span>Qualified</span></div><div><b>19</b><span>Booked</span></div></div>
<div class="row"><span class="av">PS</span><div><b>Priya S.</b><small>Whitening · all 4 answers saved</small></div><em class="pill hot">Hot lead</em></div>
<div class="row"><span class="av">RM</span><div><b>Rohan M.</b><small>Braces · asked for a person</small></div><em class="pill">Follow-up</em></div>
<div class="row"><span class="av">ND</span><div><b>Neha D.</b><small>Check-up · reminder sent</small></div><em class="pill ok">Booked Tue 11:00</em></div>
</div></div>
<div class="phone"><div class="bar">Glow Dental Clinic</div><div class="chat">
<div class="b out">Hi, do you do teeth whitening?</div>
<div class="b in">Welcome! Reply with a number:<br>1️⃣ Check-up 2️⃣ Whitening 3️⃣ Braces</div>
<div class="b out">2</div>
<div class="b in">Great! Reply <b>BOOK</b> to pick a date and time.</div></div></div>
</div>
</div></section>

<div class="ticker" aria-hidden="true"><div class="track"><span><i></i><time>09:41:02</time> new chat <b>+91 98••• ••210</b> · Whitening</span><span><i></i><time>09:41:09</time> answers saved 4/4 <b>Priya S.</b> · lead created</span><span><i></i><time>09:41:15</time> booked <b>Tue 11:00</b> · alert sent to you</span><span><i></i><time>09:42:31</time> webhook 200 <b>lead.created</b> · Google Sheets</span><span><i></i><time>09:44:08</time> asked for a person <b>Rohan M.</b> · AI briefing sent</span><span><i></i><time>09:47:50</time> reminder sent <b>Neha D.</b> · Tue 11:00</span><span><i></i><time>09:52:13</time> new chat <b>+44 7••• ••918</b> · Check-up</span><span><i></i><time>09:52:40</time> replied in <b>Hindi</b> · language chosen by the customer</span><span><i></i><time>09:41:02</time> new chat <b>+91 98••• ••210</b> · Whitening</span><span><i></i><time>09:41:09</time> answers saved 4/4 <b>Priya S.</b> · lead created</span><span><i></i><time>09:41:15</time> booked <b>Tue 11:00</b> · alert sent to you</span><span><i></i><time>09:42:31</time> webhook 200 <b>lead.created</b> · Google Sheets</span><span><i></i><time>09:44:08</time> asked for a person <b>Rohan M.</b> · AI briefing sent</span><span><i></i><time>09:47:50</time> reminder sent <b>Neha D.</b> · Tue 11:00</span><span><i></i><time>09:52:13</time> new chat <b>+44 7••• ••918</b> · Check-up</span><span><i></i><time>09:52:40</time> replied in <b>Hindi</b> · language chosen by the customer</span></div></div>

<section class="stats"><div class="wrap">
<div class="stat"><b>10 min</b><span>typical set-up</span></div>
<div class="stat"><b>24 / 7</b><span>replies, even at night</span></div>
<div class="stat"><b>9 × 12</b><span>services × questions each</span></div>
<div class="stat"><b>1 plan</b><span>everything included</span></div>
</div></section>

<section><div class="wrap">
<div class="center"><h2>Your WhatsApp inbox, without the chaos</h2>
<p class="sub">Enquiries arrive at all hours. Replying late, or asking the same five questions by hand, is where leads go cold.</p></div>
<div class="vs">
<div class="card bad"><h3>Without ${name}</h3><ul>
<li>Enquiries sit unanswered overnight and on weekends</li>
<li>You type the same questions and prices again and again</li>
<li>Details are scattered across chats, notes and memory</li>
<li>Booking a time takes ten messages back and forth</li>
<li>You never know which ad or post a lead came from</li>
</ul></div>
<div class="card good"><h3>With ${name}</h3><ul>
<li>Every new customer gets an instant, friendly reply</li>
<li>The bot asks your questions and answers the common ones</li>
<li>Each lead is saved with their answers, stage and history</li>
<li>Customers pick a date and a time and it lands in your calendar</li>
<li>Tracked links show which campaign each lead came from</li>
</ul></div>
</div></div></section>

<section class="alt"><div class="wrap split">
<div>
<span class="eyebrow">Capture and qualify</span>
<h2 style="margin-top:14px">Ask the right questions, every time</h2>
<p>Describe your business and the AI assistant drafts your service menu and questions. Customers answer one at a time on the chat app they already use. You get a finished lead, not a half-typed thread.</p>
<ul class="tick"><li>Up to 9 services with up to 12 questions each</li><li>Templates for real estate, clinics, B2B services, overseas careers and more</li><li>Test everything in the simulator before going live</li></ul>
</div>
<div class="vis"><div class="mock"><div class="mh"><i></i><i></i><i></i>&nbsp;Example conversation</div><div class="chat">
<div class="b in">Which area are you looking in?</div>
<div class="b out">Whitefield, Bangalore</div>
<div class="b in">What is your budget range?</div>
<div class="b out">80 lakh to 1 crore</div>
<div class="b in">When do you plan to buy?</div>
<div class="b out">Within 3 months</div>
<div class="b in">Thank you! Our team will contact you shortly. ✅</div>
</div></div></div>
</div></section>

<section><div class="wrap split rev">
<div class="vis"><div class="mock"><div class="mh"><i></i><i></i><i></i>&nbsp;Example inbox</div>
<div class="brief"><b>🙋 Needs a person · AI briefing</b>Rohan is buying a 3-bedroom in Whitefield, budget 80 lakh to 1 crore, within 3 months. He asked to speak to someone about a site visit this weekend.</div>
<div class="chat"><div class="b out">Can I talk to someone about visiting this weekend?</div><div class="b in">Of course. I have asked our team to message you here shortly.</div></div>
</div><div class="eg">Illustration with example data</div></div>
<div>
<span class="eyebrow">Answer and hand over</span>
<h2 style="margin-top:14px">AI that answers, and steps back when a person is needed</h2>
<p>The AI replies to side questions in the customer's own language, using only the facts you wrote down. If someone asks for a real person, the bot stops, tells them, and sends you a short briefing so you can pick up without re-reading the chat.</p>
<ul class="tick"><li>No invented prices or promises</li><li>Pause the bot for one chat and reply yourself</li><li>Hand the chat back to the bot when you are done</li></ul>
</div>
</div></section>

<section class="alt"><div class="wrap split">
<div>
<span class="eyebrow">Book and follow up</span>
<h2 style="margin-top:14px">Appointments that book themselves</h2>
<p>Customers pick a date, then a time, right in WhatsApp. The bot books it, confirms it to them, alerts you and reminds them before it starts. Use the built-in calendar or connect Google Calendar. Nobody can take the same slot twice.</p>
<ul class="tick"><li>Your working days, hours, buffers and appointment length</li><li>Customers can cancel or reschedule by message</li><li>Instant alerts to your WhatsApp or email</li></ul>
</div>
<div class="vis"><div class="mock"><div class="mh"><i></i><i></i><i></i>&nbsp;Example booking</div>
<div class="slot">Tue, 11:00 – 11:30 <em>Free</em></div>
<div class="slot">Tue, 15:30 – 16:00 <em>Free</em></div>
<div class="slot">Wed, 10:00 – 10:30 <em>Free</em></div>
<div class="ok">✅ Booked: <b>Tue, 11:00</b>. A reminder will be sent before it starts.</div>
</div><div class="eg">Illustration with example data</div></div>
</div></section>

<section><div class="wrap split rev">
<div class="vis"><div class="mock"><div class="mh"><i></i><i></i><i></i>&nbsp;Example pipeline</div>
<div class="kan">
<div><h4>New</h4><div class="lc"><b>Priya S.</b><span>Whitening</span><br><span class="tag hot">Hot</span></div><div class="lc"><b>Amit K.</b><span>Check-up</span></div></div>
<div><h4>Follow-up</h4><div class="lc"><b>Rohan M.</b><span>Braces</span><br><span class="tag">Call Fri</span></div></div>
<div><h4>Booked</h4><div class="lc"><b>Neha D.</b><span>Check-up</span><br><span class="tag">Tue 11:00</span></div><div class="lc"><b>Karan P.</b><span>Whitening</span></div></div>
</div></div><div class="eg">Illustration with example data</div></div>
<div>
<span class="eyebrow">Manage your leads</span>
<h2 style="margin-top:14px">A simple CRM built in</h2>
<p>Every lead lands in a board you can move through your own stages, with owner, tags, notes and a full timeline. Add teammates with roles, and export to CSV any time.</p>
<ul class="tick"><li>List and board views, search and filters</li><li>Follow-up reminders on any lead</li><li>Analytics: conversations, funnel, sources and drop-off points</li></ul>
</div>
</div></section>

<section class="alt" id="flow"><div class="wrap">
<div class="center"><span class="eyebrow">How a message travels</span><h2 style="margin-top:14px">From first message to booked, in seconds</h2>
<p class="sub">Every step happens on its own, around the clock. You only step in when a person is really needed.</p></div>
<div class="flow"><svg viewBox="0 0 1000 220" role="img" aria-label="A customer message goes to the AI assistant, becomes a lead in the CRM, books an appointment and alerts you">
<defs><linearGradient id="fg" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="980" y2="0"><stop offset="0" stop-color="#10b981"/><stop offset=".55" stop-color="#22d3ee"/><stop offset="1" stop-color="#818cf8"/></linearGradient></defs>
<path class="base" d="M20 110 H980"/><path class="run" d="M20 110 H980"/>
<circle class="pulse" r="6"><animateMotion dur="6s" repeatCount="indefinite" path="M20 110 H980"/></circle>
<circle class="pulse" r="4" opacity=".6"><animateMotion dur="6s" begin="-3s" repeatCount="indefinite" path="M20 110 H980"/></circle>
<g class="node"><rect x="20" y="68" width="152" height="84" rx="16"/><text x="96" y="104">Customer</text><text class="sm" x="96" y="128">WhatsApp</text></g>
<g class="node hot"><circle class="ring" cx="298" cy="110" r="22"/><rect x="222" y="68" width="152" height="84" rx="16"/><text x="298" y="104">AI assistant</text><text class="sm" x="298" y="128">asks + answers</text></g>
<g class="node"><rect x="424" y="68" width="152" height="84" rx="16"/><text x="500" y="104">Lead saved</text><text class="sm" x="500" y="128">CRM + stage</text></g>
<g class="node"><rect x="626" y="68" width="152" height="84" rx="16"/><text x="702" y="104">Booking</text><text class="sm" x="702" y="128">date + time</text></g>
<g class="node"><rect x="828" y="68" width="152" height="84" rx="16"/><text x="904" y="104">You</text><text class="sm" x="904" y="128">instant alert</text></g>
</svg></div>
</div></section>

<section><div class="wrap split rev">
<div class="vis"><div class="term"><div class="tb"><i></i><i></i><i></i><span>webhook · lead.created</span></div><div class="code"><span class="ln c" style="--i:0"># every new lead is pushed to your tools, signed and retried</span><span class="ln" style="--i:1"><span class="m">POST</span> https://hooks.your-app.com/wappo</span><span class="ln" style="--i:2"><span class="k">X-Event</span>: <span class="s">lead.created</span></span><span class="ln" style="--i:3"><span class="k">X-Signature</span>: <span class="s">sha256=9f2c…</span></span><span class="ln" style="--i:4">{</span><span class="ln" style="--i:5">  <span class="k">"event"</span>: <span class="s">"lead.created"</span>,</span><span class="ln" style="--i:6">  <span class="k">"lead"</span>: { <span class="k">"name"</span>: <span class="s">"Priya S."</span>, <span class="k">"service"</span>: <span class="s">"Whitening"</span>,</span><span class="ln" style="--i:7">           <span class="k">"stage"</span>: <span class="s">"new"</span>, <span class="k">"answers"</span>: { <span class="c">…</span> } }</span><span class="ln" style="--i:8">}</span><span class="ln c" style="--i:9"># or read and move leads yourself</span><span class="ln" style="--i:10"><span class="n">$</span> curl -H <span class="s">"Authorization: Bearer lk_…"</span> \\</span><span class="ln caret" style="--i:11">       https://your-app.com/api/v1/leads</span></div></div><div class="eg">Illustration: real payloads carry the full lead and every answer</div></div>
<div>
<span class="eyebrow">Connect your tools</span>
<h2 style="margin-top:14px">Plug it into everything you already use</h2>
<p>Every new lead and every stage change can be sent to Zapier, Make, n8n, a Google Sheet or your own server. A REST API lets your systems read leads and move them through your pipeline.</p>
<ul class="tick"><li>Signed webhooks with automatic retries</li><li>Secret API keys you create and revoke yourself</li><li>Included in the plan, no extra fee</li></ul>
<div class="chipsrow"><span>Zapier</span><span>Make</span><span>n8n</span><span>Google Sheets</span><span>Your own server</span></div>
</div>
</div></section>

<section class="alt" id="features"><div class="wrap">
<div class="center"><h2>Everything in the box</h2>
<p class="sub">One service covers the whole journey from first message to booked appointment. This is the complete list of what you get.</p></div>
<div class="fl">${FEATURES.map((f) => `<div><h3><span class="ico">${FEATURE_ICONS[f.title] ?? '✨'}</span>${esc(f.title)}</h3><ul>${f.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
</div></section>

<section><div class="wrap">
<div class="center"><h2>Built for businesses that live on WhatsApp</h2>
<p class="sub">If customers message you to ask, enquire or book, it fits.</p></div>
<div class="uses">
<div class="card"><div class="ico">🏠</div><h3>Real estate</h3><p class="fine">Capture area, budget and timeline, then hand serious buyers to an agent.</p></div>
<div class="card"><div class="ico">🦷</div><h3>Clinics and dentists</h3><p class="fine">Collect the reason for the visit and book appointments around your day.</p></div>
<div class="card"><div class="ico">🎓</div><h3>Education and overseas careers</h3><p class="fine">Qualify students by course, country and intake before a counsellor calls.</p></div>
<div class="card"><div class="ico">💼</div><h3>B2B and agencies</h3><p class="fine">Ask about size, need and timeline, and push qualified leads to your CRM by webhook.</p></div>
<div class="card"><div class="ico">💇</div><h3>Salons and wellness</h3><p class="fine">Answer price and timing questions instantly and fill your calendar.</p></div>
<div class="card"><div class="ico">📚</div><h3>Coaches and courses</h3><p class="fine">Turn ad clicks into conversations and follow up with those who are still thinking.</p></div>
</div></div></section>

<section class="alt" id="how"><div class="wrap">
<div class="center"><h2>Live in four steps</h2>
<p class="sub">No developers needed.</p></div>
<div class="grid g4 steps">
<div class="card"><div class="num">1</div><h3>Sign up and subscribe</h3><p class="fine">Create your account with your email. ${signupOpen() ? 'Then subscribe: approve the monthly payment once and your bot is switched on.' : ''}</p></div>
<div class="card"><div class="num">2</div><h3>Describe your business</h3><p class="fine">Tell the AI assistant what you do, or pick a template. Review the menu and questions it proposes.</p></div>
<div class="card"><div class="num">3</div><h3>Scan the QR code</h3><p class="fine">Link your WhatsApp number from Linked devices. Test everything in the simulator first.</p></div>
<div class="card"><div class="num">4</div><h3>Go live</h3><p class="fine">Press go live. Leads arrive in your dashboard and your phone as they happen.</p></div>
</div></div></section>

<section><div class="wrap">
<div class="center"><h2>How it compares</h2>
<p class="sub">An honest look at the usual options for answering WhatsApp enquiries.</p></div>
<div class="cmpbox scroll"><table class="cmp"><thead><tr><th></th><th>Replying by hand</th><th>Official Business API tools</th><th class="us">${name}</th></tr></thead><tbody>
<tr><td>Works on your existing number</td><td>Yes</td><td>Usually needs a number moved to the API</td><td class="us">Yes, linked in one QR scan</td></tr>
<tr><td>Meta approval needed</td><td>No</td><td>Yes</td><td class="us">No</td></tr>
<tr><td>Replies at night and weekends</td><td>Only if you are awake</td><td>Yes</td><td class="us">Yes</td></tr>
<tr><td>Asks your qualifying questions</td><td>Typed by hand</td><td>Depends on the tool</td><td class="us">Yes, built in</td></tr>
<tr><td>Books appointments in the chat</td><td>Manual</td><td>Depends on the tool</td><td class="us">Yes: the customer picks a date and a time</td></tr>
<tr><td>Risk of WhatsApp restricting the number</td><td>Low</td><td>Low</td><td class="us">Higher for bulk messaging, so we limit broadcasts</td></tr>
</tbody></table></div>
</div></section>

<section class="alt" id="pricing"><div class="wrap">
<div class="center"><h2>Simple monthly pricing</h2>
<p class="sub">${pricingLead(region)} It is a subscription: you approve it once, it is debited automatically every month, and you can cancel at any time. Taxes, if applicable, are extra.</p></div>
<div class="grid" style="max-width:720px;margin:0 auto">${planCards}</div>
<p class="fine center" style="margin-top:20px">What counts: a "new conversation" is a customer who messages you for the first time in a calendar month; limits reset every month. See the <a href="/refunds">refund and cancellation policy</a> and the <a href="/terms">terms</a>.</p>
</div></section>

<section id="trust"><div class="wrap">
<h2>Honest about how it works</h2>
<div class="note"><strong>Please read:</strong> ${name} connects to WhatsApp through the "Linked devices" feature on your own number. It is not the official WhatsApp Business API. WhatsApp can limit or ban numbers that send bulk or unwanted messages, and we cannot prevent that. Use a number you can afford to risk, message only people who contacted you or agreed to hear from you, and keep broadcasts relevant and polite.</div>
<div class="grid g3" style="margin-top:20px">
<div class="card"><h3>Your data</h3><p class="fine">Each business has its own isolated workspace. Google tokens are stored encrypted, passwords are hashed, webhooks are signed. You can delete everything at any time.</p></div>
<div class="card"><h3>Your customers</h3><p class="fine">The bot only answers people who message you. STOP is honoured automatically and broadcasts are limited to protect your reputation.</p></div>
<div class="card"><h3>Your control</h3><p class="fine">Pause the bot for the whole business or for one chat in a click. Customers can always reach a human.</p></div>
</div></div></section>

<section class="alt" id="faq"><div class="wrap" style="max-width:860px">
<div class="center"><h2>Questions, answered</h2></div>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}
</div></section>

<section><div class="wrap"><div class="cta-band">
<h2>Stop losing leads in your WhatsApp inbox.</h2>
<p>${signupOpen() ? `Get ${name} running on your own WhatsApp number.` : `Open the dashboard to get started.`}</p>
<a class="btn p" href="/admin/?plan=pro">${signupOpen() ? 'Get started' : 'Open the dashboard'}</a>
</div></div></section>`;
  return page({ title: `${PRODUCT_NAME}: WhatsApp lead capture, CRM and appointment booking`, description: `${PRODUCT_NAME} turns WhatsApp enquiries into qualified leads: guided questions, AI answers, human hand-off, in-chat appointment booking, CRM, broadcasts and analytics on your own number. ${inr(PLANS[0].price.INR)} a month in India, ${usd(PLANS[0].price.USD)} elsewhere.`, path: '/', body, landing: true });
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
<li>Usage and billing data: plan, usage counters, payment status and references. We do not store card numbers; payments are handled by Razorpay, Stripe or PayPal.</li>
<li>The WhatsApp link: a session credential created when you scan the QR code, stored on our server so the bot stays connected.</li>
<li>If you connect Google Calendar: your Google account email and an access (refresh) token, stored encrypted, plus the calendar events we create for bookings and the free/busy times we read to offer slots.</li>
<li>Technical data: sign-in times, IP address in security logs, an audit log of administrative actions.</li>
<li>Approximate location: when you visit our website or billing page we use your IP address to work out your country, only to show prices in the right currency (rupees in India, dollars elsewhere). The lookup runs on our own server with an offline database; your address is not sent to anyone for this and is not stored for this purpose.</li>
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
<tr><td>Razorpay, Stripe and PayPal</td><td>Payment processing for subscriptions.</td></tr>
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

<h2>7. Plans and payment</h2>
<ul>
<li>Plans, prices and limits are shown on our <a href="/#pricing">pricing section</a> and in your dashboard. Prices are in Indian rupees or US dollars; applicable taxes, if any, are extra.</li>
<li>The Service starts when your first payment is confirmed. We may change plans, prices and promotions with notice.</li>
<li>Paid plans are billed monthly in advance and renew automatically through Razorpay (rupees; UPI AutoPay or card mandate), or PayPal or Stripe (dollars) until you cancel. By subscribing you authorise us and our payment provider to debit your chosen payment method every month at the price shown when you subscribed, and you will be notified before each debit as the payment network requires.</li>
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
<p>The Service depends on providers such as WhatsApp, Google, Razorpay, Stripe, PayPal, email and hosting providers. Their availability and terms are outside our control, and an outage or change by a provider may affect the Service.</p>

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
  return doc('Refund & Cancellation Policy', '/refunds', `Cancellation and refund rules for ${PRODUCT_NAME}.`, `
<p>This policy applies to paid plans of ${p}, operated by <strong>${esc(operator())}</strong>. The Service is a digital subscription, delivered online as soon as your plan is active. Nothing is shipped.</p>

<h2>1. How billing works</h2>
<ul>
<li>Paid plans are billed monthly in advance, in Indian rupees (Razorpay) or US dollars (Stripe or PayPal).</li>
<li>You subscribe once by approving a recurring payment (UPI AutoPay or card e-mandate through Razorpay, or PayPal or card). The plan then renews and the amount is debited automatically each month until you cancel.</li>
<li>You are told before each debit. You can cancel the mandate at any time in your dashboard, in your UPI app, or by emailing us from your account email.</li>
<li>If a renewal payment fails you keep access for a ${GRACE_DAYS}-day grace period.</li>
</ul>

<h2>2. Cancelling</h2>
<ul>
<li>You can cancel any time under <strong>Plan &amp; billing → Cancel subscription</strong> in your dashboard, or by emailing us from your account email.</li>
<li>Cancellation stops future renewals. You keep full access until the end of the period you have already paid for. There are no cancellation fees.</li>
</ul>

<h2>3. Refunds</h2>
<ul>
<li><strong>First-payment refund.</strong> If you are not satisfied with a paid plan, you may ask for a full refund of your <em>first</em> payment within <strong>7 days</strong> of that payment. After a refund, your account moves off the paid plan.</li>
<li><strong>Duplicate or wrong charges.</strong> If you were charged twice, charged the wrong amount or charged after a valid cancellation, we will refund the extra amount in full. Please tell us within 30 days of the charge.</li>
<li><strong>Extended outage.</strong> If the Service is unavailable for more than 72 hours in a row in a billing month because of a fault on our side, we will credit or refund the affected part of that month on request.</li>
<li><strong>Otherwise,</strong> payments for a month already started are not refundable, and we do not give partial refunds for unused days after cancelling.</li>
</ul>

<h2>4. What is not refundable</h2>
<ul>
<li>Renewals after the 7-day first-payment window, unless covered by section 3.</li>
<li>Any restriction, suspension or ban of your WhatsApp number by WhatsApp or Meta. This is outside our control (see the <a href="/terms">Terms</a>).</li>
<li>Plans or days given free of charge (redeem codes, promotional offers or referral rewards).</li>
<li>Accounts closed for breaking the acceptable-use rules in the Terms.</li>
</ul>

<h2>5. How to ask for a refund</h2>
<p>Email us from your account email with your business name and the payment reference or date. We review requests within 3 working days.</p>

<h2>6. How refunds are paid</h2>
<p>Approved refunds are returned to the original payment method. Banks and payment providers usually take 5 to 7 working days to show the money in your account after we process it. We cannot speed up that step.</p>

<h2>7. Contact</h2>
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
<ul><li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms &amp; Conditions</a></li><li><a href="/refunds">Refund &amp; Cancellation Policy</a></li><li><a href="/shipping">Shipping &amp; Delivery Policy</a></li><li><a href="/pricing">Pricing</a></li></ul></main>`
  });
}

function shipping(): string {
  const p = esc(PRODUCT_NAME);
  return doc('Shipping & Delivery Policy', '/shipping', `How ${PRODUCT_NAME} is delivered: it is a digital subscription service with no physical shipping.`, `
<p>${p} is a digital software service operated by <strong>${esc(operator())}</strong>. Nothing physical is sold or shipped, so there are no shipping charges, courier delays or delivery addresses to provide.</p>
<h2>How the service is delivered</h2>
<ul>
<li><strong>Account.</strong> You create your account online. Right after sign-up you choose the plan and pay on the payment provider's secure page.</li>
<li><strong>Paid plan.</strong> When your payment is confirmed by the payment provider, your plan is activated automatically, usually within a few minutes. There is nothing to download or wait for.</li>
<li><strong>WhatsApp link.</strong> You link your own WhatsApp number yourself by scanning a QR code. We do not ship SIM cards, devices or hardware.</li>
<li><strong>Receipts.</strong> Payment confirmations and receipts are sent to you by the payment provider (Razorpay, PayPal or Stripe) and are listed in your dashboard under Plan &amp; billing.</li>
</ul>
<h2>If your plan does not switch on</h2>
<p>If you have paid and your plan is not active within 24 hours, or if you were charged twice, contact us with your account email and the payment reference. We will activate the plan or refund the extra charge as set out in our <a href="/refunds">Refund &amp; Cancellation Policy</a>.</p>
<h2>Availability</h2>
<p>The service is available online worldwide, subject to our <a href="/terms">Terms &amp; Conditions</a>. Prices are shown in rupees for customers in India and in US dollars elsewhere.</p>
<h2>Contact</h2>
${contactLines()}`);
}

function about(): string {
  const p = esc(PRODUCT_NAME);
  return page({
    title: `About | ${PRODUCT_NAME}`,
    description: `${PRODUCT_NAME} helps businesses turn WhatsApp enquiries into qualified leads, bookings and follow-ups.`,
    path: '/about',
    body: `<main class="doc"><h1>About ${p}</h1>
<p>${p} is a WhatsApp lead-capture and follow-up service. A business links its own WhatsApp number, and the service greets new customers, asks the right questions, answers common questions with AI using only the facts the business provides, books appointments into Google Calendar and hands conversations to a person when asked.</p>
<h2>What you can do with it</h2>
<ul>
<li>Capture and qualify enquiries automatically, in the customer's own language.</li>
<li>Manage leads in a built-in CRM with stages, owners, notes and follow-up dates.</li>
<li>Send paced broadcasts to people who already chatted with you, and measure results.</li>
<li>Connect other tools with webhooks and a REST API.</li>
</ul>
<h2>Who runs it</h2>
<p>${p} is operated by <strong>${esc(operator())}</strong>. It is an independent service and is not affiliated with WhatsApp or Meta.</p>
${contactLines()}
<p><a href="/pricing">See pricing</a> or <a href="/contact">contact us</a>.</p></main>`
  });
}

function pricing(region: Region): string {
  const p = esc(PRODUCT_NAME);
  return page({
    title: `Pricing | ${PRODUCT_NAME}`,
    description: `${PRODUCT_NAME} pricing: ${inr(PLANS[0].price.INR)} a month in India, ${usd(PLANS[0].price.USD)} a month elsewhere.`,
    path: '/pricing',
    body: `<main class="doc" style="max-width:760px"><h1>Pricing</h1>
<p>${pricingLead(region)} Customers in India pay in Indian rupees by subscription (UPI AutoPay or card, through Razorpay); customers elsewhere pay in US dollars (PayPal or card).</p>
<div class="grid" style="max-width:460px;margin:24px 0">${planCardsHtml(region, '/pricing')}</div>
<h2>Good to know</h2>
<ul>
<li>It is a monthly subscription: you approve the recurring payment once and it is debited automatically every month on the same date, with a reminder before each debit. Cancel any time and you keep access until the end of the period you have paid for.</li>
<li>If we change the price later, people already subscribed keep the price they signed up at.</li>
<li>Prices are per business, per month. Taxes such as GST, where they apply, are added at checkout.</li>
<li>A "new conversation" is a customer who messages you for the first time in a calendar month. Limits reset every month.</li>
<li>Refunds and cancellation are explained in the <a href="/refunds">Refund &amp; Cancellation Policy</a>. The service is digital: see <a href="/shipping">Shipping &amp; Delivery</a>.</li>
</ul>
<h2>Questions about ${p} pricing</h2>
${contactLines()}</main>`
  });
}

const notFound = () =>
  page({ title: `Page not found | ${PRODUCT_NAME}`, description: 'Page not found', path: '/404', body: `<main class="doc"><h1>Page not found</h1><p>That page does not exist. <a href="/">Go to the home page</a>.</p></main>` });

// ---------- routes ----------

export const SITE_PATHS = ['/', '/about', '/pricing', '/privacy', '/terms', '/refunds', '/shipping', '/contact'] as const;

export function registerSite(app: FastifyInstance): void {
  // Pages that show a price depend on who is looking, so they must never be stored and handed to someone in another country
  const send = (reply: FastifyReply, html: string, status = 200, perVisitor = false) =>
    reply
      .status(status)
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', perVisitor ? 'private, no-cache' : 'public, max-age=300')
      .header('Vary', perVisitor ? 'Cookie, X-Real-Ip, X-Forwarded-For' : 'Accept-Encoding')
      .header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'strict-origin-when-cross-origin')
      .send(html);

  const regionOf = (req: { headers: Record<string, string | string[] | undefined>; ip: string; query: unknown }, reply: FastifyReply): Region => {
    const d = detectRegion(req.headers, req.ip, req.query as Record<string, unknown>);
    if (d.setCookie) reply.header('Set-Cookie', d.setCookie);
    return d.region;
  };

  app.get('/', async (req, reply) => send(reply, landing(regionOf(req, reply)), 200, true));
  app.get('/privacy', async (_req, reply) => send(reply, privacy()));
  app.get('/terms', async (_req, reply) => send(reply, terms()));
  app.get('/refunds', async (_req, reply) => send(reply, refunds()));
  app.get('/contact', async (_req, reply) => send(reply, contact()));
  app.get('/about', async (_req, reply) => send(reply, about()));
  app.get('/pricing', async (req, reply) => send(reply, pricing(regionOf(req, reply)), 200, true));
  app.get('/shipping', async (_req, reply) => send(reply, shipping()));

  app.get('/site.js', async (_req, reply) => reply.header('Content-Type', 'application/javascript; charset=utf-8').header('Cache-Control', 'public, max-age=300').header('X-Content-Type-Options', 'nosniff').send(SITE_JS));

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
