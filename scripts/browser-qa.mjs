// Browser QA over the local static server (scripts/serve.mjs) with Playwright and the system Chrome.
// Usage: node scripts/browser-qa.mjs [--only layout,axe,motion,keyboard,font,requests]
// Env: DIST (default dist), CHROME_PATH (default /usr/bin/google-chrome).
// Checks (light + dark, EN + KO, 390 + 1280 px unless noted):
//   layout    no horizontal scroll (before and after scrolling through the page); the theme applied
//   axe       axe-core: 0 violations
//   motion    prefers-reduced-motion: reduce -> document.getAnimations().length === 0 after load,
//             after scrolling, and after a runtime switch to reduce
//   keyboard  every control inside a figure is reached with Tab and changes the figure when operated
//             with the keyboard alone; every interactive figure has a text twin
//   font      /ko/: document.fonts.check('400 16px SCDream') and a loaded FontFace SCDream 400;
//             KO font transfer bytes; EN requests no font
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
const PAGES = [
  ['en', server.url],
  ['ko', server.url + 'ko/'],
];
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

  // ---- layout + axe --------------------------------------------------------------------------
  if (want('layout') || want('axe')) {
    for (const [lang, url] of PAGES) {
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          const tag = `${lang}/${theme}/${width}`;
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
    for (const [lang, url] of PAGES) {
      for (const theme of THEMES) {
        const tag = `${lang}/${theme}`;
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
    for (const [lang, url] of PAGES) {
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
        if (!figs.length) report('keyboard', false, `${lang}: no figure with controls found`);
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

  // ---- font ---------------------------------------------------------------------------------
  if (want('font')) {
    for (const [lang, url] of PAGES) {
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
            `ko: fonts.check('400 16px SCDream')=${info.check}; FontFace SCDream 400 loaded=${loaded400}; ` +
              `KO font transfer ${bytes} bytes (${per.join(', ') || 'no font requests'})`,
          );
        } else {
          const sc = info.faces.filter((f) => f.family === 'SCDream').length;
          report('font', fontReqs.length === 0 && sc === 0, `en: ${fontReqs.length} font request(s), ${sc} SCDream face(s), ${bytes} bytes`);
        }
      } finally {
        await ctx.close();
      }
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  await server.close();
}

if (want('requests')) {
  report('requests', foreign.size === 0, `${requestCount} request(s) observed, ${foreign.size} to another origin${foreign.size ? ': ' + [...foreign].slice(0, 5).join(', ') : ''}`);
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
