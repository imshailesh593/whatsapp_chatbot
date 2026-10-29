/** Standalone, dependency-free page for linking WhatsApp. Polls /qr/status with the same token it was opened with. */
import { BUSINESS_NAME } from "./brand";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);

export const QR_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect WhatsApp · ${esc(BUSINESS_NAME)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%278%27 fill=%27%2310b981%27/%3E%3Ccircle cx=%2716%27 cy=%2716%27 r=%277%27 fill=%27none%27 stroke=%27%23020617%27 stroke-width=%272.5%27/%3E%3C/svg%3E">
<style>
:root{--bg:#0f172a;--panel:#020617;--line:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--accent:#10b981;--accent2:#2dd4bf;--warn:#f59e0b;--bad:#f43f5e}
*{box-sizing:border-box}
main>*,header>*{min-width:0}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:radial-gradient(1200px 600px at 50% -10%,#0b3b33 0%,var(--bg) 55%);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:100%;max-width:860px;background:var(--panel);border:1px solid var(--line);border-radius:20px;box-shadow:0 25px 60px rgba(0,0,0,.45);overflow:hidden}
header{display:flex;align-items:center;gap:12px;padding:18px 24px;border-bottom:1px solid var(--line)}
.logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;box-shadow:0 8px 24px rgba(16,185,129,.25)}
.logo svg{width:20px;height:20px}
header b{display:block;font-size:16px;letter-spacing:.2px}
header span{font-size:12px;color:var(--muted)}
.pill{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:#0b1220;color:var(--muted);white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--warn)}
.pill.ok .dot{background:var(--accent);box-shadow:0 0 0 4px rgba(16,185,129,.18)}
.pill.bad .dot{background:var(--bad)}
.pill.ok{color:#a7f3d0}
main{display:grid;grid-template-columns:1.1fr .9fr;gap:0}
.left{padding:28px 28px 28px 32px}
.right{padding:28px 32px 28px 28px;display:grid;place-items:center;border-left:1px solid var(--line);background:linear-gradient(180deg,#07101f,#020617)}
h1{margin:0 0 6px;font-size:22px;letter-spacing:-.2px}
.sub{margin:0 0 22px;color:var(--muted);font-size:14px}
ol{list-style:none;margin:0;padding:0;display:grid;gap:14px}
li{display:flex;gap:14px;align-items:flex-start}
.n{flex:none;width:28px;height:28px;border-radius:9px;background:#0b1f1b;border:1px solid #14532d;color:var(--accent);font-weight:700;font-size:13px;display:grid;place-items:center}
li p{margin:2px 0 0;color:#cbd5e1}
li small{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}
.note{margin-top:22px;padding:12px 14px;border:1px solid #3b2f0b;background:#1a1405;color:#fcd34d;border-radius:12px;font-size:12.5px}
.box{width:280px;height:280px;border-radius:20px;background:#fff;display:grid;place-items:center;position:relative;box-shadow:0 0 0 8px #0b1220,0 0 0 9px var(--line)}
.box img{width:248px;height:248px;image-rendering:pixelated;display:none}
.box.show img{display:block}
.state{display:none;text-align:center;padding:24px;color:#0f172a}
.box.wait .state.wait,.box.ok .state.ok,.box.bad .state.bad{display:block}
.box.wait,.box.ok,.box.bad{background:#0b1220;color:var(--text)}
.state{color:var(--text)}
.state h3{margin:10px 0 4px;font-size:17px}
.state p{margin:0;color:var(--muted);font-size:13px}
.spin{width:36px;height:36px;margin:0 auto;border-radius:50%;border:3px solid #1e293b;border-top-color:var(--accent);animation:s 0.9s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
.check{width:64px;height:64px;margin:0 auto;border-radius:50%;background:rgba(16,185,129,.15);display:grid;place-items:center}
.check svg{width:32px;height:32px;stroke:var(--accent)}
.hint{margin-top:18px;text-align:center;font-size:12.5px;color:var(--muted);min-height:20px}
a.btn{display:inline-block;margin-top:14px;padding:9px 16px;border-radius:10px;background:var(--accent);color:#04201d;font-weight:700;font-size:13px;text-decoration:none}
@media(max-width:720px){header{padding:14px 16px;gap:10px}.brand span{display:none}.brand b{white-space:nowrap}.pill{padding:5px 10px;font-size:11.5px}main{grid-template-columns:1fr}.right{border-left:0;border-bottom:1px solid var(--line);order:-1;padding:24px}.left{padding:24px}.box{width:250px;height:250px}.box img{width:220px;height:220px}}
</style>
</head>
<body>
<div class="card">
  <header>
    <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#020617" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg></div>
    <div class="brand"><b>${esc(BUSINESS_NAME)}</b><span>WhatsApp Lead Console</span></div>
    <div class="pill" id="pill"><span class="dot"></span><span id="pilltext">Checking…</span></div>
  </header>
  <main>
    <section class="left">
      <h1 id="title">Connect your WhatsApp</h1>
      <p class="sub" id="sub">Link the business number so the bot can answer enquiries.</p>
      <ol>
        <li><span class="n">1</span><div><p>Open <b>WhatsApp</b> on the business phone</p><small>Use the number customers will message.</small></div></li>
        <li><span class="n">2</span><div><p>Go to <b>Settings → Linked devices → Link a device</b></p><small>On iPhone: Settings. On Android: tap ⋮ then Linked devices.</small></div></li>
        <li><span class="n">3</span><div><p><b>Point the camera</b> at the code on this screen</p><small>The code refreshes by itself. No need to reload this page.</small></div></li>
      </ol>
      <div class="note">Keep this phone online at least once every couple of weeks, or WhatsApp will unlink the bot.</div>
    </section>
    <section class="right">
      <div>
        <div class="box wait" id="box">
          <img id="qr" alt="WhatsApp QR code">
          <div class="state wait"><div class="spin"></div><h3 id="waitTitle">Starting up…</h3><p id="waitSub">A QR code will appear in a moment.</p></div>
          <div class="state ok"><div class="check"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></div><h3>WhatsApp connected</h3><p>The bot is answering messages.</p><a class="btn" href="/admin/">Open dashboard</a></div>
          <div class="state bad"><h3>Link unavailable</h3><p id="badSub">Check the link and try again.</p></div>
        </div>
        <div class="hint" id="hint"></div>
      </div>
    </section>
  </main>
</div>
<script>
(function () {
  var token = new URLSearchParams(location.search).get('token') || '';
  var box = document.getElementById('box'), img = document.getElementById('qr');
  var pill = document.getElementById('pill'), pillText = document.getElementById('pilltext');
  var title = document.getElementById('title'), sub = document.getElementById('sub'), hint = document.getElementById('hint');
  var waitTitle = document.getElementById('waitTitle'), waitSub = document.getElementById('waitSub'), badSub = document.getElementById('badSub');
  var lastQr = '', qrSince = 0;

  function mode(m) { box.className = 'box ' + m; }
  function setPill(cls, text) { pill.className = 'pill ' + cls; pillText.textContent = text; }

  function render(d) {
    if (d.status === 'ready') {
      mode('ok'); setPill('ok', 'Connected');
      title.textContent = 'You are all set'; sub.textContent = 'This number is linked. You can close this page.'; hint.textContent = '';
      lastQr = ''; return;
    }
    if (d.status === 'qr' && d.qr) {
      if (d.qr !== lastQr) { lastQr = d.qr; img.src = d.qr; qrSince = Date.now(); }
      mode('show'); setPill('', 'Waiting for scan');
      title.textContent = 'Scan to connect'; sub.textContent = 'Link the business number so the bot can answer enquiries.';
      hint.textContent = 'Code refreshes automatically';
      return;
    }
    mode('wait'); lastQr = '';
    if (d.status === 'disconnected') {
      setPill('bad', 'Reconnecting'); waitTitle.textContent = 'Reconnecting…'; waitSub.textContent = 'Lost the connection. Retrying automatically.';
    } else {
      setPill('', 'Starting'); waitTitle.textContent = 'Starting up…'; waitSub.textContent = 'A QR code will appear in a moment.';
    }
    title.textContent = 'Connect your WhatsApp'; hint.textContent = '';
  }

  function failed(msg) { mode('bad'); setPill('bad', 'Unavailable'); badSub.textContent = msg; hint.textContent = ''; }

  function tick() {
    fetch('/qr/status?token=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { failed('This link is missing a valid token.'); return null; }
        if (r.status === 404) { failed('The QR page is disabled on this server.'); return null; }
        return r.json();
      })
      .then(function (d) { if (d) render(d); })
      .catch(function () { failed('Cannot reach the server. Retrying…'); });
  }
  tick(); setInterval(tick, 2000);
})();
</script>
</body>
</html>`;
