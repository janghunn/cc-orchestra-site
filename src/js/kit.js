/* web-style-gradient / kit.js  (copied from the kit; cc-orchestra-site changes are marked "site:")
   site: the site has two pages (/ and /ko/), so the in-page language swap is replaced by a real link
   (a[data-lang-link]) that keeps the #hash and saves the choice in localStorage "ppk-lang"; the theme
   button reads its labels from data-label-to-dark / data-label-to-light (the page copy).
   Vanilla, dependency-free, ES5-compatible. One IIFE; the only global is window.PPK.
   Parts: theme toggle (+ system tracking), language link, reveal-on-scroll, hero drift pause,
   step-flow controller, copy buttons, reduced-motion video handling.
   Hooks (data attributes): data-theme-toggle, data-lang-link, .rv, data-flow (+ data-flow-node, data-flow-select,
   data-flow-mode, data-flow-modes, data-flow-state, data-flow-run, data-flow-step, data-flow-reset,
   data-flow-caption), data-copy (+ data-copy-status, data-copy-label), video[data-autoplay]. */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var THEME_KEY = 'ppk-theme';
  var LANG_KEY = 'ppk-lang';
  var STR = {
    en: {
      toDark: 'Switch to dark theme', toLight: 'Switch to light theme', langBtn: '한국어',
      copied: 'Copied to clipboard', copiedShort: 'Copied', copyFail: 'Copy failed. Select the text and copy it manually.',
      run: 'Run', pause: 'Pause', on: 'active', off: 'skipped'
    },
    ko: {
      toDark: '어두운 테마로 전환', toLight: '밝은 테마로 전환', langBtn: 'English',
      copied: '클립보드에 복사했습니다', copiedShort: '복사됨',
      copyFail: '복사하지 못했습니다. 텍스트를 직접 선택해 복사하세요.',
      run: '실행', pause: '일시정지', on: '사용', off: '생략'
    }
  };

  root.classList.add('js');

  function all(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if ((el.matches || el.msMatchesSelector || el.webkitMatchesSelector).call(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }
  function media(q) { return window.matchMedia ? window.matchMedia(q) : { matches: false }; }
  function onMedia(m, fn) {
    if (m.addEventListener) m.addEventListener('change', fn);
    else if (m.addListener) m.addListener(fn);
  }
  function lang() { return root.lang === 'ko' ? 'ko' : 'en'; }
  function str(key) { return STR[lang()][key]; }
  function emit(name) {
    var ev;
    try { ev = new CustomEvent(name); } catch (e) { ev = doc.createEvent('CustomEvent'); ev.initCustomEvent(name, false, false, null); }
    doc.dispatchEvent(ev);
  }
  function readTheme() {
    try {
      var v = window.localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) { return null; }
  }
  function writeTheme(v) {
    try { window.localStorage.setItem(THEME_KEY, v); } catch (e) { /* storage blocked: choice lasts for this page view */ }
  }

  /* Capture the copy-button labels once, before copy feedback changes the text. */
  all('[data-copy-label]').forEach(function (el) {
    if (!el.hasAttribute('data-en')) el.setAttribute('data-en', el.textContent);
  });

  var reduce = media('(prefers-reduced-motion: reduce)');
  var prefersDark = media('(prefers-color-scheme: dark)');

  /* ---- theme ---- */
  var themeDefault = root.getAttribute('data-theme-default') || 'system';
  var override = readTheme();

  function theme() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function systemTheme() { return prefersDark.matches ? 'dark' : 'light'; }
  function paintTheme() {
    var cur = theme();
    all('[data-theme-toggle]').forEach(function (b) {
      /* site: labels come from the page copy when present */
      var k = cur === 'dark' ? 'toLight' : 'toDark';
      b.setAttribute('aria-label', b.getAttribute(cur === 'dark' ? 'data-label-to-light' : 'data-label-to-dark') || str(k));
    });
    all('meta[name="color-scheme"]').forEach(function (m) { m.setAttribute('content', cur); });
  }
  function setTheme(next, persist) {
    next = next === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    if (persist) { override = next; writeTheme(next); }
    paintTheme();
  }
  if (!root.getAttribute('data-theme')) {
    setTheme(override || (themeDefault === 'system' ? systemTheme() : themeDefault), false);
  } else {
    paintTheme();
  }
  onMedia(prefersDark, function () {
    if (!override && themeDefault === 'system') setTheme(systemTheme(), false);
  });

  /* ---- language (site: a link to the other page, not an in-page swap) ----
     The click keeps the current #hash and remembers the choice; the EN page's head script reads it
     (and "?lang=en" in the KO page's link wins over it, so English is never bounced back to KO). */
  function setLang(next) {
    var a = doc.querySelector('a[data-lang-link="' + (next === 'ko' ? 'ko' : 'en') + '"]');
    if (a) a.click();
  }
  all('a[data-lang-link]').forEach(function (a) {
    a.addEventListener('click', function () {
      var next = a.getAttribute('data-lang-link') === 'ko' ? 'ko' : 'en';
      var base = (a.getAttribute('href') || '').split('#')[0];
      try { window.localStorage.setItem(LANG_KEY, next); } catch (e) { /* storage blocked: the link still works */ }
      if (window.location.hash) a.setAttribute('href', base + window.location.hash);
    });
  });

  /* ---- copy buttons ---- */
  var globalStatus = null;
  function statusFor(btn) {
    var scope = closest(btn, '[data-copy-scope]') || btn.parentNode;
    var s = scope ? scope.querySelector('[data-copy-status]') : null;
    if (!s) {
      if (!globalStatus) {
        globalStatus = doc.createElement('span');
        globalStatus.className = 'vh';
        globalStatus.setAttribute('role', 'status');
        globalStatus.setAttribute('aria-live', 'polite');
        doc.body.appendChild(globalStatus);
      }
      s = globalStatus;
    }
    return s;
  }
  function copyText(text, done) {
    var settled = false;
    function finish(ok) { if (!settled) { settled = true; done(ok); } }
    function fallback() {
      if (settled) return;
      var ta = doc.createElement('textarea');
      var active = doc.activeElement;
      var ok = false;
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      doc.body.appendChild(ta);
      ta.select();
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      doc.body.removeChild(ta);
      if (active && active.focus) active.focus();
      finish(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      setTimeout(fallback, 1500);
      navigator.clipboard.writeText(text).then(function () { finish(true); }, fallback);
    } else {
      fallback();
    }
  }
  function onCopy(btn) {
    var sel = btn.getAttribute('data-copy');
    var scope = closest(btn, '[data-copy-scope]');
    var src = sel ? doc.querySelector(sel) : (scope && scope.querySelector('pre, code'));
    var status = statusFor(btn);
    var label = btn.querySelector('[data-copy-label]');
    if (!src) return;
    status.textContent = '';
    copyText(src.textContent.replace(/\s+$/, ''), function (ok) {
      status.textContent = str(ok ? 'copied' : 'copyFail');
      if (label && ok) label.textContent = str('copiedShort');
      clearTimeout(btn.ppkTimer);
      btn.ppkTimer = setTimeout(function () {
        status.textContent = '';
        /* restore the label in the language shown now, never from a snapshot */
        if (label) label.textContent = label.getAttribute('data-' + lang()) || label.getAttribute('data-en') || '';
      }, 3000);
    });
  }

  doc.addEventListener('click', function (e) {
    var b = closest(e.target, '[data-theme-toggle],[data-copy]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    if (b.hasAttribute('data-theme-toggle')) setTheme(theme() === 'dark' ? 'light' : 'dark', true);
    else onCopy(b);
  });

  /* ---- reveal on scroll ---- */
  function revealAll() { all('.rv').forEach(function (el) { el.classList.add('is-in'); }); }
  if (reduce.matches || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
    all('.rv').forEach(function (el) { io.observe(el); });
  }

  /* ---- hero drift: pause while the tab is hidden ---- */
  function syncHidden() {
    if (doc.hidden) root.classList.add('is-hidden'); else root.classList.remove('is-hidden');
  }
  doc.addEventListener('visibilitychange', function () { syncHidden(); syncVideos(); });
  syncHidden();

  /* ---- video[data-autoplay]: plays muted when motion is allowed, paused with controls otherwise ---- */
  function syncVideos() {
    all('video[data-autoplay]').forEach(function (v) {
      v.muted = true;
      v.setAttribute('playsinline', '');
      if (reduce.matches || doc.hidden) {
        v.pause();
        if (reduce.matches) v.controls = true;
      } else {
        var p = v.play && v.play();
        if (p && p.catch) p.catch(function () { v.controls = true; });
      }
    });
  }
  syncVideos();

  /* ---- step-flow ---- */
  function initFlow(el) {
    var nodes = all('[data-flow-node]', el);
    var n = nodes.length;
    var step = 0;
    var timer = null;
    var interval = parseInt(el.getAttribute('data-flow-interval'), 10) || 1900;
    var runBtn = el.querySelector('[data-flow-run]');
    var stepBtn = el.querySelector('[data-flow-step]');
    var resetBtn = el.querySelector('[data-flow-reset]');
    var caption = el.querySelector('[data-flow-caption]');
    var modeBtns = all('[data-flow-select] [data-flow-mode]', el);
    var mode = '';
    modeBtns.forEach(function (b) { if (b.getAttribute('aria-pressed') === 'true') mode = b.getAttribute('data-flow-mode'); });
    if (!mode && modeBtns.length) mode = modeBtns[0].getAttribute('data-flow-mode');

    function text(src, base) {
      var l = lang();
      var keys = ['data-' + base + '-' + l + '-' + mode, 'data-' + base + '-' + l, 'data-' + base + '-en-' + mode, 'data-' + base + '-en'];
      for (var i = 0; i < keys.length; i++) if (src.hasAttribute(keys[i])) return src.getAttribute(keys[i]);
      return '';
    }
    function label(src, key) {
      return (src && src.getAttribute('data-label-' + key + '-' + lang())) || str(key);
    }
    function render(animate) {
      el.setAttribute('data-step', String(step));
      nodes.forEach(function (node, i) {
        var k = i + 1;
        node.classList.toggle('is-active', k === step);
        node.classList.toggle('is-done', k < step);
        node.classList.remove('is-feeding');
        if (k === step) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
        if (animate && !reduce.matches && k === step - 1) {
          void node.offsetWidth;
          node.classList.add('is-feeding');
        }
      });
      all('[data-flow-modes]', el).forEach(function (it) {
        var on = (' ' + it.getAttribute('data-flow-modes') + ' ').indexOf(' ' + mode + ' ') > -1;
        var st = it.querySelector('[data-flow-state]');
        it.classList.toggle('is-off', !on);
        var owner = closest(it, '[data-flow-node]');
        var k = owner ? nodes.indexOf(owner) + 1 : n;
        it.classList.toggle('is-on', on && step >= k);
        if (st) st.textContent = label(el, on ? 'on' : 'off');
      });
      if (caption) {
        var t = step === 0 ? text(el, 'cap-idle') : step > n ? text(el, 'cap-done') : text(nodes[step - 1], 'cap');
        caption.textContent = t;
      }
      if (runBtn) {
        var rl = runBtn.querySelector('[data-flow-run-label]') || runBtn;
        rl.textContent = label(runBtn, timer ? 'pause' : 'run');
        runBtn.setAttribute('aria-pressed', timer ? 'true' : 'false');
      }
    }
    function next() { step = step >= n + 1 ? 0 : step + 1; render(true); }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      render(false);
    }
    if (runBtn) runBtn.addEventListener('click', function () {
      if (timer) { stop(); return; }
      if (reduce.matches) { next(); return; }
      if (step >= n + 1) step = 0;
      timer = setInterval(function () {
        if (reduce.matches || step >= n + 1) { stop(); return; }
        next();
        if (step >= n + 1) stop();
      }, interval);
      next();
    });
    if (stepBtn) stepBtn.addEventListener('click', function () {
      if (timer) { clearInterval(timer); timer = null; }
      next();
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      if (timer) { clearInterval(timer); timer = null; }
      step = 0;
      render(false);
    });
    modeBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-flow-mode');
        modeBtns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        render(false);
      });
    });
    onMedia(reduce, function () { if (reduce.matches && timer) stop(); });
    doc.addEventListener('ppk:lang', function () { render(false); });
    render(false);
  }
  all('[data-flow]').forEach(initFlow);

  onMedia(reduce, function () {
    if (reduce.matches) revealAll();
    syncVideos();
  });

  window.PPK = {
    setTheme: function (t) { setTheme(t, true); },
    setLang: setLang,
    theme: theme,
    lang: lang
  };
}());
