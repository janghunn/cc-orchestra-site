// Browser QA over the local static server (scripts/serve.mjs) with Playwright and the system Chrome.
// Usage: node scripts/browser-qa.mjs [--only layout,shell,targets,axe,motion,keyboard,loop-motion,font,clearance,editions,redirects,fragments,focus-ring,saved-lang,requests]
// Env: DIST (default dist), CHROME_PATH (default /usr/bin/google-chrome).
// Content pages: /, /ko/ (project), /cc-orch/, /ko/cc-orch/ (overview), /cc-orch/workflow/, /ko/cc-orch/workflow/,
// /cc-orch/guide/, /ko/cc-orch/guide/, /cc-doc/, /ko/cc-doc/. Redirect pages: /workflow/, /guide/, /ko/workflow/,
// /ko/guide/ (only opened by the redirects check). Checks (light + dark, every content page, 390 + 1280 px unless noted):
//   layout    no horizontal scroll (before and after scrolling through the page); the theme applied;
//             inside <main>: workflow pages a[href="../"], guide pages a[href="../"] and a[href="../workflow/"], cc-doc
//             pages a[href="../"] and a[href="../#compare"], visible (non-zero box) and focusable; at 390 px the top bar
//             (header.topbar) is at most 64 px high
//   shell     the brand link (header.topbar a.brand) to the same-language project page and, inside nav.sn-eds, a link
//             to each edition overview, visible and focusable; cc-orch pages: the three nav.sn-pages tabs too
//   targets   (light only) every displayed link in .topbar, .sn-sub and .sn-foot is at least 44 px high
//   axe       axe-core: 0 violations
//   motion    prefers-reduced-motion: reduce -> document.getAnimations().length === 0 after load,
//             after scrolling, and after a runtime switch to reduce
//   keyboard  every control inside a figure is reached with Tab and changes the figure when operated
//             with the keyboard alone; every interactive figure has a text twin; overview and workflow pages
//             have at least one figure with controls (the project, guide and cc-doc pages have no figure); the
//             workflow pages have fig-loop
//   loop-motion  workflow pages, motion enabled: fig-loop Run (keyboard) autoplays (>= 2 stage changes
//             within 2 x data-interval) and reads Pause; Pause, the global "Pause motion" button and a
//             runtime switch to prefers-reduced-motion: reduce each stop it for 2 intervals
//   font      KO pages: document.fonts.check('400 16px SCDream') and a loaded FontFace SCDream 400;
//             KO font transfer bytes; EN pages request no font
//   clearance overview EN and KO, 1280 px: top bar and sub-bar are sticky, and after opening #gates the section's
//             heading top is at or below the bottom of the sticky block
//   editions  project pages, 390 + 1280 px: the cc-orch and cc-doc edition links (keyboard) land on the same-language
//             edition overview
//   redirects each old address ends on its new one (/workflow/ -> /cc-orch/workflow/, ... and
//             /workflow/?lang=en#tips -> /cc-orch/workflow/?lang=en#tips)
//   fragments /#how -> /cc-orch/#how, /#how-title -> /cc-orch/#how-title, /ko/#faq -> /ko/cc-orch/#faq; /#compare and
//             /#main stay on /; /cc-doc/#tbl-editions shows that element in the viewport below the sticky block
//             (390 + 1280 px); on the open project page (EN, KO) setting location.hash to #how in the same tab ends
//             on the same-language cc-orch/#how, and #compare stays
//   focus-ring  a link reached with Tab shows its focus ring (:focus-visible, an outline) and the ring (its box grown
//             by outline-offset + outline-width) lies inside the padding box of every ancestor up to .sn-sub or
//             header.topbar whose overflow is not visible, and no sticky or fixed box that is not its ancestor paints
//             over it (document.elementsFromPoint at points on the outline stroke): the nav.sn-pages tabs at 390 px on
//             the cc-orch pages, the displayed nav.sn-eds links at 390 and 1280 px on every page
//   saved-lang with Korean saved by the EN project page's language link, each EN content URL ends on its KO twin and
//             /#how on /ko/cc-orch/#how; each EN content URL with ?lang=en stays EN
//   requests  every request the browser makes stays on the server origin
// Prints "BROWSER <check> PASS|FAIL <detail>". Exit 0 all PASS, 1 any FAIL, 77 environment
// unavailable (no Chrome, or no loopback socket).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, process.env.DIST || 'dist');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const oi = process.argv.indexOf('--only');
const ONLY = oi >= 0 ? new Set(process.argv[oi + 1].split(',')) : null;
const want = (c) => !ONLY || ONLY.has(c);

const results = [];
const report = (check, ok, detail) => {
  results.push(ok);
  console.log(`BROWSER ${check} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
};

if (!fs.existsSync(CHROME)) {
  console.log(`BROWSER SKIP no Chrome at ${CHROME}`);
  process.exit(77);
}
const { chromium } = await import('playwright-core');
const { default: AxeBuilder } = await import('@axe-core/playwright');

let server;
try {
  server = await startServer(DIST);
} catch (e) {
  if (/EPERM|EACCES|EADDRNOTAVAIL/.test(String(e.code || e.message))) {
    console.log(`BROWSER SKIP cannot listen on loopback: ${e.code || e.message}`);
    process.exit(77);
  }
  throw e;
}
const ORIGIN = new URL(server.url).origin;
// the EN route of each page kind below the server root (the KO twin is ko/<route>)
const ROUTES = { project: '', overview: 'cc-orch/', workflow: 'cc-orch/workflow/', guide: 'cc-orch/guide/', doc: 'cc-doc/' };
// [tag, lang, url, page kind: project | overview | workflow | guide | doc]
const PAGES = Object.entries(ROUTES).flatMap(([kind, r]) => [
  ['/' + r, 'en', server.url + r, kind],
  ['/ko/' + r, 'ko', server.url + 'ko/' + r, kind],
]);
// same-language link targets on each page kind (KO pages use the same values inside /ko/)
const LINKS = {
  project: { project: './', overview: 'cc-orch/', workflow: 'cc-orch/workflow/', guide: 'cc-orch/guide/', doc: 'cc-doc/' },
  overview: { project: '../', overview: './', workflow: 'workflow/', guide: 'guide/', doc: '../cc-doc/' },
  workflow: { project: '../../', overview: '../', workflow: './', guide: '../guide/', doc: '../../cc-doc/' },
  guide: { project: '../../', overview: '../', workflow: '../workflow/', guide: './', doc: '../../cc-doc/' },
  doc: { project: '../', overview: '../cc-orch/', workflow: '../cc-orch/workflow/', guide: '../cc-orch/guide/', doc: './' },
};
const ORCH_KINDS = new Set(['overview', 'workflow', 'guide']);
// links inside <main> each page kind must offer visible and focusable at every width (inside <main> only: the shared
// tabs and sitemap carry the same hrefs; the shell links are checked by "shell")
const NAV_LINKS = { project: [], overview: [], workflow: ['../'], guide: ['../', '../workflow/'], doc: ['../', '../#compare'] };
// page kinds that must have at least one figure with controls
const FIGURE_KINDS = new Set(['overview', 'workflow']);
// fig-loop button labels, from the workflow content (the template prints them verbatim)
const LOOP_LABELS = Object.fromEntries(
  ['en', 'ko'].map((l) => {
    const f = path.join(ROOT, `content/workflow.${l}.json`);
    const loop = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).loop || {} : {};
    return [l, { run: loop.run, pause: loop.pause }];
  }),
);
const THEMES = ['light', 'dark'];
const WIDTHS = [390, 1280];

let browser;
const foreign = new Set();
let requestCount = 0;
function watch(ctx) {
  ctx.on('request', (r) => {
    requestCount++;
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    try {
      if (new URL(u).origin !== ORIGIN) foreign.add(u);
    } catch {
      foreign.add(u);
    }
  });
}
async function newPage(opts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  watch(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    scrollTo(0, 0);
  });
}
const settle = (page, ms = 800) => page.waitForTimeout(ms);

try {
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  // ---- layout + shell + targets + axe -------------------------------------------------------
  if (want('layout') || want('shell') || want('targets') || want('axe')) {
    for (const [name, , url, kind] of PAGES) {
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          const tag = `${name} ${theme}/${width}`;
          const { ctx, page, errors } = await newPage({ viewport: { width, height: 844 }, colorScheme: theme });
          try {
            await page.goto(url, { waitUntil: 'load' });
            const overflow = () =>
              page.evaluate(() => ({
                sw: document.documentElement.scrollWidth,
                cw: document.documentElement.clientWidth,
              }));
            const o1 = await overflow();
            await scrollThrough(page);
            await settle(page);
            const o2 = await overflow();
            const dark = await page.evaluate(() => {
              const c = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).map(Number);
              const l = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
              return l < 0.5;
            });
            if (want('layout')) {
              const ok = o1.sw <= o1.cw && o2.sw <= o2.cw && dark === (theme === 'dark') && errors.length === 0;
              report(
                'layout',
                ok,
                `${tag}: scrollWidth ${o2.sw} <= clientWidth ${o2.cw}; theme ${dark ? 'dark' : 'light'}` +
                  (errors.length ? `; page errors: ${errors.slice(0, 3).join(' | ')}` : ''),
              );
              for (const href of NAV_LINKS[kind]) {
                // workflow and guide pages link to the cc-orch overview (guide also to the workflow page), cc-doc pages to the project page and its comparison
                const link = await page.evaluate((href) => {
                  const all = [...document.querySelectorAll(`main a[href="${href}"]`)];
                  const ok = all.filter((a) => {
                    const r = a.getBoundingClientRect();
                    if (!a.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || !(r.width > 0 && r.height > 0)) return false;
                    a.focus();
                    const focused = document.activeElement === a && a.tabIndex >= 0;
                    a.blur();
                    return focused;
                  });
                  return { total: all.length, ok: ok.length };
                }, href);
                report('layout', link.ok > 0, `${tag}: ${link.ok} of ${link.total} main a[href="${href}"] visible and focusable`);
              }
              if (width === 390) {
                const h = await page.evaluate(() => document.querySelector('header.topbar')?.getBoundingClientRect().height ?? null);
                report('layout', h !== null && h <= 64, `${tag}: top bar ${h === null ? 'MISSING (header.topbar)' : `${Math.round(h * 10) / 10} px high`} (max 64)`);
              }
            }
            if (want('shell')) {
              const L = LINKS[kind];
              const abs = (h) => new URL(h, url).href;
              const wantLinks = {
                brand: abs(L.project),
                eds: [abs(L.overview), abs(L.doc)],
                tabs: ORCH_KINDS.has(kind) ? [abs(L.overview), abs(L.workflow), abs(L.guide)] : [],
              };
              const got = await page.evaluate((w) => {
                const usable = (a) => {
                  const r = a.getBoundingClientRect();
                  if (!a.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || !(r.width > 0 && r.height > 0)) return false;
                  a.focus();
                  const focused = document.activeElement === a && a.tabIndex >= 0;
                  a.blur();
                  return focused;
                };
                const count = (sel, href) => [...document.querySelectorAll(sel)].filter((a) => a.href === href && usable(a)).length;
                return {
                  brand: count('header.topbar a.brand', w.brand),
                  eds: w.eds.map((h) => count('nav.sn-eds a', h)),
                  tabs: w.tabs.map((h) => count('nav.sn-pages a', h)),
                };
              }, wantLinks);
              const path_ = (h) => new URL(h).pathname;
              report('shell', got.brand > 0, `${tag}: brand link to ${path_(wantLinks.brand)} visible and focusable (${got.brand})`);
              wantLinks.eds.forEach((h, i) => report('shell', got.eds[i] > 0, `${tag}: nav.sn-eds link to ${path_(h)} visible and focusable (${got.eds[i]})`));
              wantLinks.tabs.forEach((h, i) => report('shell', got.tabs[i] > 0, `${tag}: nav.sn-pages tab to ${path_(h)} visible and focusable (${got.tabs[i]})`));
            }
            if (want('targets') && theme === 'light') {
              const t = await page.evaluate(() => {
                const missing = ['.topbar', '.sn-sub', '.sn-foot'].filter((sel) => !document.querySelector(sel));
                const shown = { '.topbar': 0, '.sn-sub': 0, '.sn-foot': 0 };
                const small = [];
                for (const sel of Object.keys(shown)) {
                  for (const a of document.querySelectorAll(`${sel} a[href]`)) {
                    const r = a.getBoundingClientRect();
                    if (!a.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || !(r.width > 0 && r.height > 0)) continue;
                    shown[sel]++;
                    if (Math.round(r.height * 100) / 100 < 44) small.push(`${sel} "${a.textContent.trim().slice(0, 24)}" ${Math.round(r.height * 10) / 10} px`);
                  }
                }
                return { missing, shown, small };
              });
              const ok = !t.missing.length && t.shown['.topbar'] > 0 && t.shown['.sn-foot'] > 0 && !t.small.length;
              report(
                'targets',
                ok,
                `${tag}: displayed links ${Object.entries(t.shown).map(([k, v]) => `${k} ${v}`).join(', ')}; ${t.small.length} below 44 px` +
                  (t.small.length ? `: ${t.small.slice(0, 5).join('; ')}` : '') +
                  (t.missing.length ? `; MISSING ${t.missing.join(', ')}` : ''),
              );
            }
            if (want('axe')) {
              const res = await new AxeBuilder({ page }).analyze();
              const v = res.violations;
              report(
                'axe',
                v.length === 0,
                `${tag}: ${v.length} violation(s)` +
                  (v.length ? ': ' + v.map((x) => `${x.id} x${x.nodes.length} (${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')})`).join('; ') : '') +
                  `, ${res.passes.length} rules passed, ${res.incomplete.length} incomplete`,
              );
            }
          } finally {
            await ctx.close();
          }
        }
      }
    }
  }

  // ---- reduced motion -----------------------------------------------------------------------
  if (want('motion')) {
    for (const [name, , url] of PAGES) {
      for (const theme of THEMES) {
        const tag = `${name} ${theme}`;
        let { ctx, page } = await newPage({ colorScheme: theme, reducedMotion: 'reduce' });
        try {
          await page.goto(url, { waitUntil: 'load' });
          await settle(page, 300);
          const a1 = await page.evaluate(() => document.getAnimations().length);
          await scrollThrough(page);
          await settle(page, 300);
          const a2 = await page.evaluate(() => document.getAnimations().length);
          report('motion', a1 === 0 && a2 === 0, `${tag} reduce: getAnimations() after load ${a1}, after scrolling ${a2}`);
        } finally {
          await ctx.close();
        }
        ({ ctx, page } = await newPage({ colorScheme: theme, reducedMotion: 'no-preference' }));
        try {
          await page.goto(url, { waitUntil: 'load' });
          await settle(page, 500);
          const before = await page.evaluate(() => document.getAnimations().length);
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await settle(page, 900);
          const after = await page.evaluate(() => document.getAnimations().length);
          report('motion', after === 0, `${tag} runtime switch to reduce: getAnimations() ${before} -> ${after}`);
        } finally {
          await ctx.close();
        }
      }
    }
  }

  // ---- keyboard ------------------------------------------------------------------------------
  if (want('keyboard')) {
    for (const [lang, , url, kind] of PAGES) {
      const { ctx, page } = await newPage({ colorScheme: 'light', reducedMotion: 'reduce' });
      try {
        await page.goto(url, { waitUntil: 'load' });
        const figs = await page.evaluate(() => {
          const FOCUSABLE = 'button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])';
          const out = [];
          document.querySelectorAll('figure').forEach((f, fi) => {
            const ctrls = [...f.querySelectorAll(FOCUSABLE)].filter((c) => !c.disabled && c.checkVisibility());
            if (!ctrls.length) return;
            f.setAttribute('data-qa-fig', String(fi));
            const ids = ctrls.map((c, ci) => {
              c.setAttribute('data-qa-ctl', `${fi}.${ci}`);
              return {
                id: `${fi}.${ci}`,
                tag: c.tagName.toLowerCase(),
                type: c.getAttribute('type') || '',
                name: c.getAttribute('name') || '',
                label: (c.getAttribute('aria-label') || c.labels?.[0]?.textContent || c.textContent || '').trim().slice(0, 40),
              };
            });
            // text twin: a table, list or <details> in the figure or referenced by aria-describedby / aria-details
            const refs = (f.getAttribute('aria-describedby') || '') + ' ' + (f.getAttribute('aria-details') || '');
            const referenced = refs.split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
            const twin =
              f.querySelector('table, details, ol, ul, [data-twin], .twin, .text-twin') ||
              referenced.find((r) => r.matches('table, details, ol, ul, [data-twin], .twin, .text-twin') || r.querySelector('table, ol, ul')) ||
              (f.nextElementSibling && f.nextElementSibling.matches('table, details, [data-twin], .twin, .text-twin') ? f.nextElementSibling : null);
            out.push({ fig: String(fi), id: f.id || `(figure ${fi})`, ctrls: ids, twin: !!twin });
          });
          return out;
        });
        if (!figs.length && FIGURE_KINDS.has(kind)) report('keyboard', false, `${lang}: no figure with controls found`);
        if (kind === 'workflow') {
          const loop = figs.find((f) => f.id === 'fig-loop');
          report('keyboard', !!loop, `${lang}: fig-loop ${loop ? `present with ${loop.ctrls.length} control(s)` : 'MISSING (or has no controls)'}`);
        }
        const snapshot = (fi) =>
          page.evaluate((fi) => {
            const f = document.querySelector(`[data-qa-fig="${fi}"]`);
            const live = [...document.querySelectorAll('[aria-live]')].map((e) => e.textContent).join('|');
            return f.outerHTML + '\n' + live + '\n' + document.activeElement?.getAttribute('data-qa-ctl');
          }, fi);
        const radioGroups = new Set();
        for (const f of figs) {
          report('keyboard', f.twin, `${lang} ${f.id}: text twin ${f.twin ? 'present' : 'MISSING'}`);
          for (const c of f.ctrls) {
            const isRadio = c.tag === 'input' && c.type === 'radio';
            if (isRadio && radioGroups.has(c.name)) continue;
            // reach the control from the top of the page with Tab only
            await page.evaluate(() => {
              document.activeElement?.blur();
              scrollTo(0, 0);
            });
            await page.keyboard.press('Tab'); // first stop
            let reached = false;
            for (let i = 0; i < 400; i++) {
              const at = await page.evaluate(() => document.activeElement?.getAttribute('data-qa-ctl') || '');
              if (at === c.id || (isRadio && at && (await page.evaluate((n) => document.activeElement?.name === n, c.name)))) {
                reached = true;
                break;
              }
              await page.keyboard.press('Tab');
            }
            if (!reached) {
              report('keyboard', false, `${lang} ${f.id}: control "${c.label || c.tag}" not reachable with Tab`);
              continue;
            }
            const before = await snapshot(f.fig);
            let keys;
            if (isRadio) {
              radioGroups.add(c.name);
              keys = ['ArrowRight'];
            } else if (c.tag === 'select') keys = ['ArrowDown'];
            else if (c.tag === 'a') keys = ['Enter'];
            else keys = ['Enter'];
            for (const k of keys) await page.keyboard.press(k);
            await settle(page, 350);
            let after = await snapshot(f.fig);
            let how = keys.join('+');
            if (after === before && c.tag !== 'a' && !isRadio) {
              await page.keyboard.press('Space');
              await settle(page, 350);
              after = await snapshot(f.fig);
              how = 'Space';
            }
            // a focus-only control (e.g. a hover/focus highlight) counts as operated when focusing it changed the figure
            const ok = after !== before || (await focusChanges(page, f.fig, c.id));
            report('keyboard', ok, `${lang} ${f.id}: "${c.label || c.tag}"${isRadio ? ' (radio group ' + c.name + ')' : ''} via Tab + ${how}: ${ok ? 'state changed' : 'no change'}`);
          }
        }
      } finally {
        await ctx.close();
      }
    }
  }

  // ---- loop motion (workflow pages, motion enabled) ------------------------------------------
  if (want('loop-motion')) {
    for (const [name, lang, url, kind] of PAGES) {
      if (kind !== 'workflow') continue;
      const labels = LOOP_LABELS[lang];
      const { ctx, page, errors } = await newPage({ colorScheme: 'light', reducedMotion: 'no-preference' });
      try {
        await page.goto(url, { waitUntil: 'load' });
        const setup = await page.evaluate((labels) => {
          const root = document.querySelector('#fig-loop[data-viz-loop], #fig-loop [data-viz-loop]');
          if (!root) return { error: 'no [data-viz-loop] in #fig-loop' };
          const fig = root.closest('#fig-loop');
          const btn = [...fig.querySelectorAll('button')].find((b) => b.innerText.trim() === labels.run);
          if (!btn) return { error: `no button reading "${labels.run}" in #fig-loop` };
          btn.setAttribute('data-qa-run', '');
          return { interval: Number(root.getAttribute('data-interval')), nodes: root.querySelectorAll('[data-loop-node]').length };
        }, labels);
        // a lap is one autoplay run over all stages; a stop check needs >= 2 intervals of lap left after one tick
        const problem =
          setup.error ||
          (!(setup.interval > 0) && 'data-interval on [data-viz-loop] is not a positive number of ms') ||
          (setup.nodes < 4 && `${setup.nodes} [data-loop-node] stage(s): a lap is too short to show that autoplay stops`);
        if (problem) {
          report('loop-motion', false, `${name}: ${problem}`);
          continue;
        }
        const iv = setup.interval;
        // the active stage: which element carries aria-current="step", plus the live caption text
        const state = () =>
          page.evaluate(() => {
            const fig = document.getElementById('fig-loop');
            const cur = fig.querySelector('[aria-current="step"]');
            const live = [...fig.querySelectorAll('[aria-live]')].map((e) => e.textContent.trim()).join('|');
            return `${cur ? [...fig.querySelectorAll('*')].indexOf(cur) : -1}|${live}`;
          });
        const label = () => page.evaluate(() => document.querySelector('[data-qa-run]').innerText.trim());
        const press = async () => {
          await page.focus('[data-qa-run]');
          await page.keyboard.press('Enter');
        };
        // number of stage changes seen within `ms` (returns early once `need` are seen)
        const changes = async (ms, need = Infinity) => {
          let last = await state();
          let n = 0;
          const end = Date.now() + ms;
          while (Date.now() < end && n < need) {
            await page.waitForTimeout(50);
            const s = await state();
            if (s !== last) n++;
            last = s;
          }
          return n;
        };
        const window2 = 2 * iv + 300; // two intervals, plus timer slack
        const stops = async () => {
          await page.waitForTimeout(150);
          return (await changes(2 * iv)) === 0;
        };

        await press();
        const ran = await changes(window2);
        const runLabel = await label();
        const current = await page.evaluate(() => !!document.querySelector('#fig-loop [aria-current="step"]'));
        report(
          'loop-motion',
          ran >= 2 && runLabel === labels.pause && current && errors.length === 0,
          `${name}: Run (Enter) -> ${ran} stage change(s) in ${window2} ms (${setup.nodes} stages, interval ${iv} ms), button reads "${runLabel}", aria-current="step" ${current ? 'set' : 'MISSING'}` +
            (errors.length ? `; page errors: ${errors.slice(0, 3).join(' | ')}` : ''),
        );

        await press();
        const pausedLabel = await label();
        const pauseStops = await stops();
        report('loop-motion', pauseStops && pausedLabel === labels.run, `${name}: Pause -> ${pauseStops ? 'no stage change' : 'stage still CHANGING'} for 2 intervals, button reads "${pausedLabel}"`);

        await press();
        const restarted = (await changes(window2, 1)) >= 1;
        await page.click('[data-motion-toggle]', { timeout: 3000 });
        const globalStops = await stops();
        report('loop-motion', restarted && globalStops, `${name}: Run then global "Pause motion" -> ${restarted ? 'was running' : 'did NOT restart'}; ${globalStops ? 'no stage change' : 'stage still CHANGING'} for 2 intervals`);
        await page.click('[data-motion-toggle]', { timeout: 3000 }); // resume global motion
        await page.waitForTimeout(150);

        // start a fresh lap (Run autoplays one lap, then stops), so the lap cannot end during the check
        if ((await label()) === labels.pause) await press();
        await press();
        const running = (await label()) === labels.pause && (await changes(window2, 1)) >= 1;
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const reduceStops = await stops();
        const anims = await page.evaluate(() => document.getAnimations().length);
        report(
          'loop-motion',
          running && reduceStops && anims === 0,
          `${name}: Run then runtime switch to reduce -> ${running ? 'was running' : 'did NOT restart'}; ${reduceStops ? 'no stage change' : 'stage still CHANGING'} for 2 intervals; getAnimations() ${anims}`,
        );
      } catch (e) {
        report('loop-motion', false, `${name}: ${String(e.message || e).split('\n')[0]}`);
      } finally {
        await ctx.close();
      }
    }
  }

  // ---- font ---------------------------------------------------------------------------------
  if (want('font')) {
    for (const [name, lang, url] of PAGES) {
      const { ctx, page } = await newPage({});
      const fontReqs = [];
      page.on('requestfinished', async (r) => {
        if (/\.(otf|ttf|woff2?)(\?|$)/i.test(r.url())) fontReqs.push(r);
      });
      try {
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await settle(page, 300);
        const info = await page.evaluate(() => ({
          check: document.fonts.check('400 16px SCDream'),
          faces: [...document.fonts].map((f) => ({ family: f.family.replace(/["']/g, ''), weight: String(f.weight), status: f.status })),
        }));
        let bytes = 0;
        const per = [];
        for (const r of fontReqs) {
          const s = await r.sizes();
          bytes += s.responseBodySize + s.responseHeadersSize;
          per.push(`${new URL(r.url()).pathname} ${s.responseBodySize} B body`);
        }
        if (lang === 'ko') {
          const loaded400 = info.faces.some((f) => f.family === 'SCDream' && f.weight === '400' && f.status === 'loaded');
          report(
            'font',
            info.check && loaded400,
            `${name}: fonts.check('400 16px SCDream')=${info.check}; FontFace SCDream 400 loaded=${loaded400}; ` +
              `KO font transfer ${bytes} bytes (${per.join(', ') || 'no font requests'})`,
          );
        } else {
          const sc = info.faces.filter((f) => f.family === 'SCDream').length;
          report('font', fontReqs.length === 0 && sc === 0, `${name}: ${fontReqs.length} font request(s), ${sc} SCDream face(s), ${bytes} bytes`);
        }
      } finally {
        await ctx.close();
      }
    }
  }
  // ---- fragment clearance under the sticky block (overview, 1280 px) --------------------------
  if (want('clearance')) {
    for (const [name, , url, kind] of PAGES) {
      if (kind !== 'overview') continue;
      const tag = `${name}#gates 1280`;
      const { ctx, page } = await newPage({ viewport: { width: 1280, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' });
      try {
        await page.goto(url + '#gates', { waitUntil: 'load' });
        await settle(page);
        const c = await page.evaluate(stickyClearance, '#gates h2');
        const ok = !c.error && c.stuck.topbar && c.stuck.sub && c.scrollY > 0 && c.top >= c.bottom - 0.5;
        report(
          'clearance',
          ok,
          `${tag}: ${c.error || `top bar sticky ${c.stuck.topbar}, sub-bar sticky ${c.stuck.sub}; scrollY ${c.scrollY}; heading top ${c.top} px, sticky block bottom ${c.bottom} px`}`,
        );
      } catch (e) {
        report('clearance', false, `${tag}: ${String(e.message || e).split('\n')[0]}`);
      } finally {
        await ctx.close();
      }
    }
  }

  // ---- edition links on the project pages ------------------------------------------------------
  if (want('editions')) {
    for (const [name, lang, url, kind] of PAGES) {
      if (kind !== 'project') continue;
      for (const width of WIDTHS) {
        for (const ed of ['overview', 'doc']) {
          const target = new URL(LINKS.project[ed], url).href;
          const tag = `${name} ${width}: edition link to ${new URL(target).pathname}`;
          const { ctx, page } = await newPage({ viewport: { width, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' });
          try {
            await page.goto(url, { waitUntil: 'load' });
            const marked = await page.evaluate((target) => {
              const a = [...document.querySelectorAll('nav.sn-eds a')].find((x) => {
                const r = x.getBoundingClientRect();
                return x.href === target && x.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && r.width > 0 && r.height > 0;
              });
              if (a) a.setAttribute('data-qa-ed', '');
              return !!a;
            }, target);
            if (!marked) {
              report('editions', false, `${tag}: no displayed nav.sn-eds link`);
              continue;
            }
            await page.focus('[data-qa-ed]');
            await Promise.all([page.waitForURL((u) => u.href !== url, { waitUntil: 'load', timeout: 10000 }), page.keyboard.press('Enter')]);
            const got = await page.evaluate(() => ({ href: location.href, lang: document.documentElement.lang }));
            report('editions', got.href === target && got.lang === lang, `${tag} (Enter) lands on ${new URL(got.href).pathname}, lang ${got.lang} (want ${new URL(target).pathname}, ${lang})`);
          } catch (e) {
            report('editions', false, `${tag}: ${String(e.message || e).split('\n')[0]}`);
          } finally {
            await ctx.close();
          }
        }
      }
    }
  }

  // ---- redirect pages and old overview fragments --------------------------------------------
  const REDIRECT_CASES = [
    ['workflow/', 'cc-orch/workflow/'],
    ['guide/', 'cc-orch/guide/'],
    ['ko/workflow/', 'ko/cc-orch/workflow/'],
    ['ko/guide/', 'ko/cc-orch/guide/'],
    ['workflow/?lang=en#tips', 'cc-orch/workflow/?lang=en#tips'],
  ];
  const FRAGMENT_CASES = [
    ['#how', 'cc-orch/#how'],
    ['#how-title', 'cc-orch/#how-title'],
    ['ko/#faq', 'ko/cc-orch/#faq'],
    ['#compare', '#compare'],
    ['#main', '#main'],
  ];
  if (want('redirects') || want('fragments')) {
    const cases = [...(want('redirects') ? REDIRECT_CASES.map((c) => ['redirects', ...c]) : []), ...(want('fragments') ? FRAGMENT_CASES.map((c) => ['fragments', ...c]) : [])];
    for (const [check, from, to] of cases) {
      const { ctx, page } = await newPage({ colorScheme: 'light', reducedMotion: 'reduce' });
      try {
        const got = await land(page, from, to);
        report(check, got === '/' + to, `/${from} ends on ${got} (want /${to})`);
      } catch (e) {
        report(check, false, `/${from}: ${String(e.message || e).split('\n')[0]}`);
      } finally {
        await ctx.close();
      }
    }
  }
  if (want('fragments')) {
    for (const width of WIDTHS) {
      const tag = `/cc-doc/#tbl-editions ${width}`;
      const { ctx, page } = await newPage({ viewport: { width, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' });
      try {
        await page.goto(server.url + 'cc-doc/#tbl-editions', { waitUntil: 'load' });
        await settle(page);
        const c = await page.evaluate(stickyClearance, '#tbl-editions');
        const ok = !c.error && c.stuck.topbar && c.shown && c.top >= c.bottom - 0.5 && c.top < c.innerHeight;
        report(
          'fragments',
          ok,
          `${tag}: ${c.error || `element displayed ${c.shown}, top ${c.top} px (sticky block bottom ${c.bottom} px, viewport ${c.innerHeight} px)`}`,
        );
      } catch (e) {
        report('fragments', false, `${tag}: ${String(e.message || e).split('\n')[0]}`);
      } finally {
        await ctx.close();
      }
    }
  }

  if (want('fragments')) {
    // the open project page: a hash set in the same tab (no reload) is forwarded too, unless the page owns it
    for (const [base, cases] of [
      ['', [['#how', 'cc-orch/#how'], ['#compare', '#compare']]],
      ['ko/', [['#how', 'ko/cc-orch/#how'], ['#compare', 'ko/#compare']]],
    ]) {
      for (const [hash, to] of cases) {
        const tag = `/${base} then location.hash = '${hash}' (same tab)`;
        const { ctx, page } = await newPage({ colorScheme: 'light', reducedMotion: 'reduce' });
        try {
          await page.goto(server.url + base, { waitUntil: 'load' });
          await settle(page, 300);
          await page.evaluate((h) => {
            location.hash = h;
          }, hash);
          const want = '/' + to;
          const at = () => {
            const u = new URL(page.url());
            return u.pathname + u.search + u.hash;
          };
          try {
            await page.waitForURL(() => at() === want, { waitUntil: 'load', timeout: 10000 });
          } catch {
            // reported from the end URL
          }
          await settle(page, 1000);
          report('fragments', at() === want, `${tag} ends on ${at()} (want ${want})`);
        } catch (e) {
          report('fragments', false, `${tag}: ${String(e.message || e).split('\n')[0]}`);
        } finally {
          await ctx.close();
        }
      }
    }
  }

  // ---- focus ring not clipped (cc-orch tabs at 390 px; edition links at 390 and 1280 px) ---------
  if (want('focus-ring')) {
    for (const [name, , url, kind] of PAGES) {
      for (const width of WIDTHS) {
        const sels = [...(width === 390 && ORCH_KINDS.has(kind) ? ['nav.sn-pages a'] : []), 'nav.sn-eds a'];
        const { ctx, page } = await newPage({ viewport: { width, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' });
        try {
          await page.goto(url, { waitUntil: 'load' });
          const targets = await page.evaluate((sels) => {
            const shown = (a) => {
              const r = a.getBoundingClientRect();
              return a.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && r.width > 0 && r.height > 0;
            };
            const out = [];
            for (const sel of sels) {
              [...document.querySelectorAll(sel)].filter(shown).forEach((a, i) => {
                a.setAttribute('data-qa-ring', `${sel}#${i}`);
                out.push({ id: `${sel}#${i}`, sel, label: a.textContent.trim().slice(0, 24) });
              });
            }
            return out;
          }, sels);
          for (const sel of sels) if (!targets.some((t) => t.sel === sel)) report('focus-ring', false, `${name} ${width}: no displayed ${sel}`);
          for (const t of targets) {
            const tag = `${name} ${width}: ${t.sel} "${t.label}"`;
            // reach the link with Tab from the top of the page (keyboard focus, so :focus-visible applies)
            await page.evaluate(() => {
              document.activeElement?.blur();
              scrollTo(0, 0);
            });
            let reached = false;
            for (let i = 0; i < 80 && !reached; i++) {
              await page.keyboard.press('Tab');
              reached = await page.evaluate((id) => document.activeElement?.getAttribute('data-qa-ring') === id, t.id);
            }
            if (!reached) {
              report('focus-ring', false, `${tag}: not reached with Tab`);
              continue;
            }
            const r = await page.evaluate(() => {
              const a = document.activeElement;
              const cs = getComputedStyle(a);
              const width = parseFloat(cs.outlineWidth) || 0;
              const grow = (parseFloat(cs.outlineOffset) || 0) + width;
              const b = a.getBoundingClientRect();
              const ring = { l: b.left - grow, t: b.top - grow, r: b.right + grow, b: b.bottom + grow };
              const stop = a.closest('.sn-sub, header.topbar');
              const clips = [];
              for (let e = a.parentElement; e; e = e === stop ? null : e.parentElement) {
                const s = getComputedStyle(e);
                if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
                const eb = e.getBoundingClientRect();
                const pad = { l: eb.left + e.clientLeft, t: eb.top + e.clientTop };
                pad.r = pad.l + e.clientWidth;
                pad.b = pad.t + e.clientHeight;
                const inside = ring.l >= pad.l - 0.5 && ring.t >= pad.t - 0.5 && ring.r <= pad.r + 0.5 && ring.b <= pad.b + 0.5;
                const where = `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).trim().split(/\s+/).join('.') : ''}`;
                clips.push({ where, inside, overflow: `${s.overflowX}/${s.overflowY}`, pad: [pad.l, pad.t, pad.r, pad.b].map((x) => Math.round(x * 10) / 10) });
              }
              // paint order: at points on the middle of the outline stroke, what document.elementsFromPoint lists above the
              // link and its ancestors; a hit inside a sticky or fixed box that is not an ancestor of the link covers the ring
              const fixedOf = (e) => {
                for (; e && e !== document.documentElement; e = e.parentElement) if (/^(sticky|fixed)$/.test(getComputedStyle(e).position)) return e;
                return null;
              };
              const mid = width / 2;
              const pts = [];
              for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
                const x = ring.l + (ring.r - ring.l) * f;
                const y = ring.t + (ring.b - ring.t) * f;
                pts.push([x, ring.t + mid], [x, ring.b - mid], [ring.l + mid, y], [ring.r - mid, y]);
              }
              const covers = new Set(); let sampled = 0;
              for (const [x, y] of pts) {
                if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue; else sampled++;
                for (const e of document.elementsFromPoint(x, y)) {
                  if (e === a || e.contains(a) || a.contains(e)) break;
                  const f = fixedOf(e);
                  if (f && !f.contains(a)) {
                    covers.add(`${f.tagName.toLowerCase()}${f.className ? '.' + String(f.className).trim().split(/\s+/).join('.') : ''}`);
                    break;
                  }
                }
              }
              return {
                focusVisible: a.matches(':focus-visible'),
                style: cs.outlineStyle,
                covered: [...covers], sampled,
                width,
                grow,
                ring: [ring.l, ring.t, ring.r, ring.b].map((x) => Math.round(x * 10) / 10),
                stop: !!stop,
                clips,
              };
            });
            const bad = r.clips.filter((c) => !c.inside);
            // the ring may sit inside the link (negative offset); it must exist and nothing may clip it
            const ok = r.focusVisible && r.style !== 'none' && r.width > 0 && r.stop && !bad.length && !r.covered.length && r.sampled > 0;
            report(
              'focus-ring',
              ok,
              `${tag}: :focus-visible ${r.focusVisible}, outline ${r.style} ${r.width} px (offset + width ${r.grow} px), ring box [${r.ring.join(', ')}]; ` +
                (r.clips.length ? r.clips.map((c) => `${c.where} (${c.overflow}) padding box [${c.pad.join(', ')}] ${c.inside ? 'contains it' : 'CLIPS it'}`).join('; ') : 'no clipping ancestor') +
                (r.covered.length ? `; COVERED by ${r.covered.join(', ')} (sticky/fixed, paints above it)` : '; no sticky or fixed box over it') + `; ${r.sampled} point(s) sampled` +
                (r.stop ? '' : '; not inside .sn-sub or header.topbar'),
            );
          }
        } catch (e) {
          report('focus-ring', false, `${name} ${width}: ${String(e.message || e).split('\n')[0]}`);
        } finally {
          await ctx.close();
        }
      }
    }
  }

  // ---- saved language ------------------------------------------------------------------------
  if (want('saved-lang')) {
    const { ctx, page } = await newPage({ colorScheme: 'light', reducedMotion: 'reduce' });
    // save Korean the way a visitor does: the EN project page's language link (keyboard)
    const saveKo = async () => {
      await page.goto(server.url + '?lang=en', { waitUntil: 'load' });
      await page.focus('a[data-lang-link="ko"]');
      await Promise.all([page.waitForURL((u) => new URL(u).pathname === '/ko/', { waitUntil: 'load', timeout: 10000 }), page.keyboard.press('Enter')]);
      return page.evaluate(() => {
        try {
          return localStorage.getItem('ppk-lang');
        } catch {
          return null;
        }
      });
    };
    const cases = [
      ...Object.values(ROUTES).map((r) => [r, 'ko/' + r]),
      ['#how', 'ko/cc-orch/#how'],
      ...Object.values(ROUTES).map((r) => [r + '?lang=en', r + '?lang=en']),
    ];
    try {
      for (const [from, to] of cases) {
        try {
          const saved = await saveKo();
          if (saved !== 'ko') {
            report('saved-lang', false, `/${from}: saving Korean through the language link left ppk-lang=${saved}`);
            continue;
          }
          const got = await land(page, from, to);
          const lang = await page.evaluate(() => document.documentElement.lang);
          const wantLang = to.startsWith('ko/') ? 'ko' : 'en';
          report('saved-lang', got === '/' + to && lang === wantLang, `Korean saved: /${from} ends on ${got}, lang ${lang} (want /${to}, ${wantLang})`);
        } catch (e) {
          report('saved-lang', false, `/${from}: ${String(e.message || e).split('\n')[0]}`);
        }
      }
    } finally {
      await ctx.close();
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  await server.close();
}

if (want('requests')) {
  report('requests', foreign.size === 0, `${requestCount} request(s) observed, ${foreign.size} to another origin${foreign.size ? ': ' + [...foreign].slice(0, 5).join(', ') : ''}`);
}

// open /<from> below the server root and wait until the URL is /<to> (redirects run by script); then wait for any later
// redirect and return the final path + query + hash
async function land(page, from, to) {
  const want = '/' + to;
  const at = () => {
    const u = new URL(page.url());
    return u.pathname + u.search + u.hash;
  };
  try {
    await page.goto(server.url + from, { waitUntil: 'load' });
  } catch (e) {
    if (!/interrupted|ERR_ABORTED/.test(String(e.message || e))) throw e;
  }
  try {
    await page.waitForURL(() => at() === want, { waitUntil: 'load', timeout: 10000 });
  } catch {
    // reported by the caller from the final URL
  }
  await settle(page, 1000);
  return at();
}

// in the page: the bottom of the sticky block (the sticky or fixed self-or-ancestors of header.topbar and .sn-sub) and the
// top of the element `sel`
function stickyClearance(sel) {
  const stickyOf = (q) => {
    for (let e = document.querySelector(q); e && e !== document.documentElement; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === 'sticky' || p === 'fixed') return e;
    }
    return null;
  };
  const el = document.querySelector(sel);
  if (!el) return { error: `no ${sel}` };
  if (!document.querySelector('header.topbar')) return { error: 'no header.topbar' };
  const s = { topbar: stickyOf('header.topbar'), sub: document.querySelector('.sn-sub') ? stickyOf('.sn-sub') : null };
  const blocks = [s.topbar, s.sub].filter(Boolean);
  const r = el.getBoundingClientRect();
  const round = (x) => Math.round(x * 10) / 10;
  return {
    stuck: { topbar: !!s.topbar, sub: !!s.sub },
    bottom: blocks.length ? round(Math.max(...blocks.map((b) => b.getBoundingClientRect().bottom))) : 0,
    top: round(r.top),
    shown: el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && r.width > 0 && r.height > 0,
    scrollY: Math.round(scrollY),
    innerHeight,
  };
}

async function focusChanges(page, fi, id) {
  return page.evaluate(
    ([fi, id]) => {
      const f = document.querySelector(`[data-qa-fig="${fi}"]`);
      const c = f.querySelector(`[data-qa-ctl="${id}"]`);
      c.blur();
      const a = f.outerHTML;
      c.focus();
      const b = f.outerHTML;
      return a !== b;
    },
    [fi, id],
  );
}

const failed = results.filter((r) => !r).length;
console.log(`browser-qa: ${failed ? 'FAIL' : 'PASS'} (${results.length} checks, ${failed} failed)`);
process.exit(failed ? 1 : 0);
