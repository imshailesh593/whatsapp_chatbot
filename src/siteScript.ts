/**
 * The motion on the public landing page, served as /site.js (same origin, so the page policy only needs script-src 'self').
 * Everything is progressive enhancement: without it, or with "reduce motion" switched on, the page is complete and still.
 */
export const SITE_JS = `(function () {
  var d = document, root = d.documentElement;
  root.classList.add('js');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // top bar gets a border once you scroll, and a thin progress line shows how far down you are
  var bar = d.getElementById('prog'), top = d.querySelector('header.top');
  function onScroll() {
    var y = window.scrollY || 0, h = root.scrollHeight - window.innerHeight;
    if (top) top.classList.toggle('stuck', y > 8);
    if (bar && !reduce) bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, y / h) : 0) + ')';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (reduce) return;

  // sections and cards rise into view as they appear
  var targets = d.querySelectorAll('main section:not(.hero) h2, main section:not(.hero) .sub, main section:not(.hero) .card, main section:not(.hero) .mock, main section:not(.hero) .tick, main section:not(.hero) .stat, main section:not(.hero) .fl > div, main section:not(.hero) details, main section:not(.hero) .term, main section:not(.hero) .flow, main section:not(.hero) .cmpbox');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    targets.forEach(function (el, i) {
      el.classList.add('rv');
      el.style.transitionDelay = (i % 4) * 70 + 'ms';
      io.observe(el);
    });
  }

  // numbers count up when they come into view
  var nums = d.querySelectorAll('.stat b');
  if ('IntersectionObserver' in window) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        co.unobserve(e.target);
        var el = e.target, text = el.textContent || '', m = /^(\\d+)(.*)$/.exec(text);
        if (!m) return;
        var end = parseInt(m[1], 10), rest = m[2], t0 = null, dur = 1100;
        function step(t) {
          if (t0 === null) t0 = t;
          var p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(end * eased) + rest;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    nums.forEach(function (n) { co.observe(n); });
  }

  // a soft light follows the pointer across cards
  d.addEventListener('pointermove', function (ev) {
    var c = ev.target && ev.target.closest ? ev.target.closest('.card, .mock, .term') : null;
    if (!c) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
    c.style.setProperty('--my', (ev.clientY - r.top) + 'px');
  }, { passive: true });

  // the product preview leans towards the pointer
  var stage = d.querySelector('.stage');
  if (stage && window.matchMedia('(hover: hover)').matches) {
    var win = stage.querySelector('.win'), phone = stage.querySelector('.phone');
    stage.addEventListener('pointermove', function (ev) {
      var r = stage.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5;
      if (win) win.style.transform = 'perspective(1400px) rotateY(' + (x * 7 - 3) + 'deg) rotateX(' + (2 - y * 6) + 'deg)';
      if (phone) phone.style.transform = 'translate(' + (x * -14) + 'px,' + (y * -10) + 'px) rotate(3deg)';
    });
    stage.addEventListener('pointerleave', function () {
      if (win) win.style.transform = '';
      if (phone) phone.style.transform = '';
    });
  }

  // the code window types itself once it is on screen
  var term = d.querySelector('.term');
  if (term && 'IntersectionObserver' in window) {
    var to = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { term.classList.add('typing'); to.disconnect(); } });
    }, { threshold: 0.4 });
    to.observe(term);
  }
})();
`;
