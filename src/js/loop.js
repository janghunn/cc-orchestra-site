/* cc-orchestra-site / loop.js: Figure 1 of the workflow page ([data-viz-loop]), the research loop.
   Vanilla, ES5, no globals, no network. Does nothing on a page without [data-viz-loop].
   - Stage nodes ([data-loop-node]); exactly one is active (aria-current="step"). Step goes to the
     next stage and wraps from the last back to the first; Reset goes back to the first.
   - Run starts autoplay (one stage per data-interval ms, default 1600) for one full lap, then stops;
     while it plays the button reads Pause and pressing it stops. Autoplay starts only after Run.
   - Under prefers-reduced-motion or html.motion-off (the global "Pause motion" button, viz.js) Run
     advances exactly one stage, nothing animates, and a running autoplay stops at once.
   - Caption ([data-loop-caption], role=status) shows "Stage n: title - text" from the node's data-cap.
   - Where the hub is shown (wide screens), its hand points at the active node: the angle is measured
     from the layout and grows with Run and Step, so the hand turns forward round the loop; Reset takes
   the shortest way back (CSS custom property --hand).
     The newly active node gets a one-shot is-arrived class. CSS animates transform and opacity only. */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var L = doc.querySelector('[data-viz-loop]');
  if (!L) return;

  function all(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function still() { return reduce.matches || root.classList.contains('motion-off'); }

  var nodes = all('[data-loop-node]', L);
  var n = nodes.length;
  if (!n) return;
  var cur = 0;
  var hand = null;
  var left = 0;
  var timer = null;
  var arrived = null;
  var interval = parseInt(L.getAttribute('data-interval'), 10) || 1600;
  var runBtn = L.querySelector('[data-loop-run]');
  var runLabel = L.querySelector('[data-loop-run-label]') || runBtn;
  var stepBtn = L.querySelector('[data-loop-step]');
  var resetBtn = L.querySelector('[data-loop-reset]');
  var caption = L.querySelector('[data-loop-caption]');
  var num = L.querySelector('[data-loop-num]');
  var hub = L.querySelector('.loop-hub');

  /* clockwise angle from the hub centre to the active node centre, raised by whole turns until it is
     not behind the previous one; nearest = take the shortest way instead (Reset, resize) */
  function aim(nearest) {
    if (!hub || !hub.offsetParent) { hand = null; return; }
    var h = hub.getBoundingClientRect();
    var r = nodes[cur].getBoundingClientRect();
    var a = Math.atan2(r.left + r.width / 2 - (h.left + h.width / 2), (h.top + h.height / 2) - (r.top + r.height / 2)) * 180 / Math.PI;
    if (hand === null || nearest) {
      if (hand !== null) a += Math.round((hand - a) / 360) * 360;
    } else {
      while (a < hand - .5) a += 360;
    }
    hand = a;
    L.style.setProperty('--hand', a.toFixed(2) + 'deg');
  }

  function clearArrived() {
    clearTimeout(arrived);
    nodes.forEach(function (node) { node.classList.remove('is-arrived'); });
  }
  function render(animate, nearest) {
    nodes.forEach(function (node, i) {
      node.classList.toggle('is-active', i === cur);
      if (i === cur) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
    });
    clearArrived();
    if (animate && !still()) {
      var node = nodes[cur];
      void node.offsetWidth;
      node.classList.add('is-arrived');
      arrived = setTimeout(clearArrived, 700);
    }
    L.setAttribute('data-step', String(cur + 1));
    aim(!!nearest);
    if (num) num.textContent = String(cur + 1);
    if (caption) {
      var t = nodes[cur].getAttribute('data-cap') || '';
      if (caption.textContent !== t) caption.textContent = t;
    }
    if (runBtn) {
      runLabel.textContent = L.getAttribute(timer ? 'data-label-pause' : 'data-label-run') || '';
      runBtn.classList.toggle('is-running', !!timer);
    }
  }
  function next(animate) {
    cur = (cur + 1) % n;
    render(animate);
  }
  function halt() { if (timer) { clearInterval(timer); timer = null; } }
  function stop() { halt(); render(false); }

  if (runBtn) runBtn.addEventListener('click', function () {
    if (timer) { stop(); return; }
    if (still()) { next(false); return; }
    left = n;
    timer = setInterval(function () {
      if (still()) { stop(); return; }
      next(true);
      if (--left <= 0) stop();
    }, interval);
    next(true);
    left -= 1;
  });
  if (stepBtn) stepBtn.addEventListener('click', function () { halt(); next(true); });
  if (resetBtn) resetBtn.addEventListener('click', function () {
    halt();
    cur = 0;
    render(false, true);
  });

  /* stop at once when motion is reduced or paused (media change, or html.motion-off toggled) */
  function onStill() { if (still()) { if (timer) stop(); clearArrived(); } }
  if (reduce.addEventListener) reduce.addEventListener('change', onStill);
  else if (reduce.addListener) reduce.addListener(onStill);
  if (window.MutationObserver) new MutationObserver(onStill).observe(root, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('resize', function () { aim(true); });
  render(false);
}());
