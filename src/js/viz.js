/* cc-orchestra-site / viz.js: state for the page's figures. Vanilla, ES5, no globals, no network.
   - Global "Pause motion" button (button[data-motion-toggle]): adds html.motion-off, which removes every
     animation and transition (same picture as prefers-reduced-motion), reveals everything, stops Viz A
     autoplay; the choice is saved in localStorage "ppk-motion" (head.js applies it before first paint).
   - Hero: animations pause while the hero is off screen (and, via kit.js, while the tab is hidden).
   - Risk state shared by Viz A (risk selector), Viz C (row buttons) and Table 1 (current row).
   - Viz A ([data-viz-a]): Run/Pause, Step, Reset; autoplay only after Run; under reduced motion or
     paused motion, Run advances exactly one step. Caption is a polite live region; the active node
     gets aria-current="step".
   - Viz B ([data-viz-b]): hover or focus on a role highlights its counterpart; pressing pins it.
   - Viz C ([data-viz-c]): the selected row is highlighted; its cells light left to right (<= 600 ms). */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var MOTION_KEY = 'ppk-motion';

  function all(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function media(q) { return window.matchMedia ? window.matchMedia(q) : { matches: false }; }
  function onMedia(m, fn) {
    if (m.addEventListener) m.addEventListener('change', fn);
    else if (m.addListener) m.addListener(fn);
  }
  var reduce = media('(prefers-reduced-motion: reduce)');
  function still() { return reduce.matches || root.classList.contains('motion-off'); }
  /* restart a one-shot CSS entrance: remove the class, force a style flush, add it back, drop it later */
  function replay(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    clearTimeout(el.vizTimer);
    if (still()) return;
    void el.offsetWidth;
    el.classList.add(cls);
    el.vizTimer = setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  var listeners = [];
  function onStill(fn) { listeners.push(fn); }
  function notifyStill() { listeners.forEach(function (fn) { fn(); }); }

  /* ---- global motion pause ---- */
  var motionBtns = all('[data-motion-toggle]');
  function paintMotion() {
    var off = root.classList.contains('motion-off');
    motionBtns.forEach(function (b) {
      var label = b.querySelector('[data-motion-label]') || b;
      label.textContent = b.getAttribute(off ? 'data-label-resume' : 'data-label-pause') || label.textContent;
    });
  }
  motionBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var off = !root.classList.contains('motion-off');
      root.classList.toggle('motion-off', off);
      try { window.localStorage.setItem(MOTION_KEY, off ? 'off' : 'on'); } catch (e) { /* storage blocked */ }
      if (off) all('.rv').forEach(function (el) { el.classList.add('is-in'); });
      paintMotion();
      notifyStill();
    });
  });
  if (root.classList.contains('motion-off')) all('.rv').forEach(function (el) { el.classList.add('is-in'); });
  paintMotion();
  onMedia(reduce, notifyStill);

  /* ---- hero: pause its loops while it is off screen ---- */
  var hero = doc.querySelector('.hero');
  if (hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { hero.classList.toggle('is-offscreen', !en.isIntersecting); });
    }).observe(hero);
  }

  /* ---- shared risk state ---- */
  var A = doc.querySelector('[data-viz-a]');
  var C = doc.querySelector('[data-viz-c]');
  var riskData = {};
  var risk = '';
  all('[data-viz-a] [data-risk]').forEach(function (b) {
    var id = b.getAttribute('data-risk');
    riskData[id] = {
      gates: ' ' + (b.getAttribute('data-gates') || '') + ' ',
      lead: b.getAttribute('data-lead') || '',
      cap: b.getAttribute('data-cap') || ''
    };
    if (b.getAttribute('aria-pressed') === 'true') risk = id;
  });
  var riskButtons = all('button[data-risk]');
  var renderA = function () {};

  function setRisk(id, animate) {
    if (!riskData[id]) return;
    var changed = id !== risk;
    risk = id;
    riskButtons.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-risk') === id ? 'true' : 'false'); });
    all('[data-row]', C || doc).forEach(function (row) {
      var on = row.getAttribute('data-row') === id;
      row.classList.toggle('is-sel', on);
      if (on && animate && changed) replay(row, 'is-lighting', 700);
      if (!on) row.classList.remove('is-lighting');
    });
    all('tr[data-risk-row]').forEach(function (tr) { tr.classList.toggle('is-cur', tr.getAttribute('data-risk-row') === id); });
    renderA(false, changed);
  }
  riskButtons.forEach(function (b) {
    b.addEventListener('click', function () { setRisk(b.getAttribute('data-risk'), true); });
  });

  /* ---- Viz A: four-tier flow ---- */
  if (A) (function () {
    var nodes = all('[data-node]', A);
    var n = nodes.length;
    var step = 0;
    var timer = null;
    var interval = parseInt(A.getAttribute('data-interval'), 10) || 1900;
    var runBtn = A.querySelector('[data-run]');
    var runLabel = A.querySelector('[data-run-label]') || runBtn;
    var stepBtn = A.querySelector('[data-step]');
    var resetBtn = A.querySelector('[data-reset]');
    var caption = A.querySelector('[data-caption]');
    var leadText = A.querySelector('[data-lead-text]');
    var gatesNode = A.querySelector('[data-gates-node]');
    var gatesIndex = gatesNode ? nodes.indexOf(gatesNode) + 1 : n;
    var items = all('[data-gate]', A);
    var labelOn = A.getAttribute('data-label-on') || '';
    var labelOff = A.getAttribute('data-label-off') || '';

    function render(animate, riskChanged) {
      var rd = riskData[risk] || { gates: '', lead: '', cap: '' };
      A.setAttribute('data-step', String(step));
      nodes.forEach(function (node, i) {
        var k = i + 1;
        node.classList.toggle('is-active', k === step);
        node.classList.toggle('is-done', k < step);
        node.classList.remove('is-feeding');
        if (k === step) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
        if (animate && !still() && k === step - 1) {
          void node.offsetWidth;
          node.classList.add('is-feeding');
        }
      });
      items.forEach(function (it) {
        var on = rd.gates.indexOf(' ' + it.getAttribute('data-gate') + ' ') > -1;
        var st = it.querySelector('[data-gate-state]');
        it.classList.toggle('is-off', !on);
        it.classList.toggle('is-lit', on && step >= gatesIndex);
        if (st) st.textContent = on ? labelOn : labelOff;
      });
      if (gatesNode && step >= gatesIndex && (riskChanged || (animate && step === gatesIndex))) replay(gatesNode, 'is-lighting', 900);
      if (leadText && rd.lead) leadText.textContent = rd.lead;
      if (caption) {
        var t;
        if (step === 0) t = A.getAttribute('data-cap-idle');
        else if (step > n) t = A.getAttribute('data-cap-done');
        else t = nodes[step - 1].getAttribute('data-cap') || rd.cap;
        if (caption.textContent !== t) caption.textContent = t;
      }
      if (runBtn) {
        runLabel.textContent = A.getAttribute(timer ? 'data-label-pause' : 'data-label-run');
        runBtn.classList.toggle('is-running', !!timer);
      }
    }
    renderA = render;
    function next() { step = step >= n + 1 ? 0 : step + 1; render(true, false); }
    function halt() { if (timer) { clearInterval(timer); timer = null; } }
    function stop() { halt(); render(false, false); }
    if (runBtn) runBtn.addEventListener('click', function () {
      if (timer) { stop(); return; }
      if (still()) { next(); return; }
      if (step >= n + 1) step = 0;
      timer = setInterval(function () {
        if (still() || step >= n + 1) { stop(); return; }
        next();
        if (step >= n + 1) stop();
      }, interval);
      next();
    });
    if (stepBtn) stepBtn.addEventListener('click', function () { halt(); next(); });
    if (resetBtn) resetBtn.addEventListener('click', function () { halt(); step = 0; render(false, false); });
    onStill(function () { if (still() && timer) stop(); });
  }());

  if (risk) setRisk(risk, false);

  /* ---- Viz B: counterpart highlight ---- */
  var B = doc.querySelector('[data-viz-b]');
  if (B) (function () {
    var items = all('.vb-item', B);
    var links = all('.vb-link', B);
    var pinned = '';
    function hl(role) {
      items.forEach(function (it) { it.classList.toggle('is-hl', !!role && it.getAttribute('data-role') === role); });
      links.forEach(function (l) { l.classList.toggle('is-hl', !!role && l.getAttribute('data-role') === role); });
      B.classList.toggle('has-hl', !!role);
    }
    function pin(role) {
      pinned = role;
      items.forEach(function (it) { it.setAttribute('aria-pressed', role && it.getAttribute('data-role') === role ? 'true' : 'false'); });
      hl(role);
    }
    items.forEach(function (it) {
      var role = it.getAttribute('data-role');
      it.addEventListener('mouseenter', function () { hl(role); });
      it.addEventListener('mouseleave', function () { hl(pinned); });
      it.addEventListener('focus', function () { hl(role); });
      it.addEventListener('blur', function () { hl(pinned); });
      it.addEventListener('click', function () { pin(pinned === role ? '' : role); });
    });
    B.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && pinned) { pin(''); }
    });
  }());
}());
