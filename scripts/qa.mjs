// One-command QA for the site. Prints one "QA <id> PASS|FAIL|SKIP <detail>" line per check.
// Usage: node scripts/qa.mjs [--static] [--only id,id]
//   --static   skip the checks that need a browser and loopback sockets (browser, lighthouse, links)
// Env: DIST (output dir, default dist), SITE_URL (as for the build), SAFETY_PRIVATE_PATTERNS
//   (private patterns file; required by the safety check), QA_ALLOW_NO_PRIVATE=1 (run the safety
//   check without private patterns; prints a WARN, never valid as release evidence),
//   CLAIMS_SOURCE_REPO and CLAIMS_WORKSPACE_ROOTS (passed to scripts/check-claims.mjs).
// Exit 0 = no FAIL, 1 = at least one FAIL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, process.env.DIST || 'dist');
const PLACEHOLDER = 'https://example.invalid/cc-orchestra-site/';
const SITE_URL = process.env.SITE_URL || PLACEHOLDER;
const STATIC = process.argv.includes('--static');
const oi = process.argv.indexOf('--only');
const ONLY = oi >= 0 ? new Set(process.argv[oi + 1].split(',')) : null;
const OFFICIAL = {
  'SCDream4.otf': '1dc288e8cfdf96eb083c0b016fb5f107bc83208e748b6a61422404b9e42a95a4',
  'SCDream6.otf': '7dd3e0240002feedd37d0f33033a44e17b1ab11f84a93acf8482184adc33aa1a',
};
const BUDGET = { html: 40960, css: 25600, js: 30720, enFonts: 122880 };
// The workflow page's contract: section ids and figure ids in order; figures that must show the Illustrative chip.
const WORKFLOW = {
  sections: ['hero', 'loop', 'methods', 'flows', 'roles', 'manual', 'tips'],
  figures: ['fig-loop', 'fig-pipeline', 'fig-reviews', 'fig-gpu', 'fig-roles'],
  illustrative: ['fig-loop', 'fig-reviews', 'fig-gpu'],
};
// The built pages. hreflang: the absolute URLs of the page pair; toggle: the language link's hreflang and href.
const PAGES = [
  { page: 'home', lang: 'en', file: 'index.html', hreflang: ['', 'ko/'], toggle: ['ko', 'ko/'] },
  { page: 'home', lang: 'ko', file: 'ko/index.html', hreflang: ['', 'ko/'], toggle: ['en', '../?lang=en'] },
  { page: 'workflow', lang: 'en', file: 'workflow/index.html', hreflang: ['workflow/', 'ko/workflow/'], toggle: ['ko', '../ko/workflow/'] },
  { page: 'workflow', lang: 'ko', file: 'ko/workflow/index.html', hreflang: ['workflow/', 'ko/workflow/'], toggle: ['en', '../../workflow/?lang=en'] },
];
const CONTENT = { home: 'content/{lang}.json', workflow: 'content/workflow.{lang}.json' };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rel = (p) => path.relative(ROOT, p) || '.';
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
function walk(dir, out = []) {
  if (!exists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
// Run a child. `ran` is true only if it launched, was not killed and returned an exit status;
// `code` is that status, or a reason string ("launch failed: EPERM", "killed by SIGTERM").
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.error) return { ran: false, code: `launch failed: ${r.error.code || r.error.message}`, out };
  if (r.signal) return { ran: false, code: `killed by ${r.signal}`, out };
  if (typeof r.status !== 'number') return { ran: false, code: 'no exit status', out };
  return { ran: true, code: r.status, out };
}
// PASS only if the child ran, exited 0 and printed its own success line.
const passed = (r, re) => r.ran && r.code === 0 && re.test(r.out);
const skipped = (r, re) => r.ran && r.code === 77 && re.test(r.out);
const show = (s) => s && console.log(s);
const lastLine = (s) => s.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
const indent = (s, n = 40) => {
  const ls = s.trimEnd().split('\n').filter(Boolean);
  const shown = ls.length > n ? [...ls.slice(0, n), `... ${ls.length - n} more line(s)`] : ls;
  return shown.map((l) => '    ' + l).join('\n');
};

const results = [];
function line(id, status, detail) {
  results.push({ id, status });
  console.log(`QA ${id} ${status} ${detail}`);
}

// ---------------------------------------------------------------------------------------------------
const checks = {
  build() {
    if (!exists(path.join(ROOT, 'scripts/build.mjs'))) return line('build', 'FAIL', 'scripts/build.mjs is missing');
    const started = Date.now() - 2000;
    const r = sh(process.execPath, ['scripts/build.mjs', '--out', DIST]);
    const fresh = (p) => exists(p) && fs.statSync(p).mtimeMs >= started;
    const stale = PAGES.map((p) => p.file).filter((f) => !fresh(path.join(DIST, f)));
    const ok = r.ran && r.code === 0 && stale.length === 0;
    if (!ok && r.out.trim()) show(indent(r.out));
    line('build', ok ? 'PASS' : 'FAIL', `node scripts/build.mjs --out ${rel(DIST)} -> exit ${r.code}; ${ok ? `${PAGES.map((p) => p.file).join(', ')} written by this run` : `missing or not rewritten by this run: ${stale.join(', ') || '(none)'}`}`);
  },

  facts() {
    const problems = [];
    const textFiles = walk(DIST).filter((f) => /\.(html|css|js|txt|svg|json)$/.test(f));
    for (const f of textFiles) if (read(f).includes('{{')) problems.push(`leftover "{{" in ${rel(f)}`);
    if (!textFiles.length) problems.push(`no built text files in ${rel(DIST)}`);
    const facts = JSON.parse(read(path.join(ROOT, 'facts.json')));
    const contentFiles = Object.values(CONTENT).flatMap((t) => ['en', 'ko'].map((l) => path.join(ROOT, t.replace('{lang}', l))));
    const sources = [...contentFiles, ...walk(path.join(ROOT, 'src'))];
    const used = new Set();
    for (const f of sources) {
      if (!exists(f)) continue;
      for (const m of read(f).matchAll(/\{\{f:([A-Za-z0-9_.]+)\}\}/g)) used.add(m[1]);
    }
    const isRoute = (v) => v && typeof v === 'object' && 'model' in v && 'effort' in v;
    for (const key of used) {
      let v = facts;
      for (const seg of key.split('.')) v = v != null && typeof v === 'object' ? v[seg] : undefined;
      if (v === undefined) problems.push(`{{f:${key}}} does not resolve in facts.json`);
      else if (typeof v === 'object' && !isRoute(v)) problems.push(`{{f:${key}}} resolves to an object that is not a route`);
    }
    line('facts', problems.length ? 'FAIL' : 'PASS', problems.length ? problems.slice(0, 8).join('; ') : `no "{{" in ${textFiles.length} built text files; ${used.size} facts keys used, all resolve`);
  },

  structure() {
    const problems = [];
    const info = {};
    const attr = (tag, name) => new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag)?.[1];
    const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    for (const p of PAGES) {
      const file = path.join(DIST, p.file);
      const tag = p.file;
      if (!exists(file)) {
        problems.push(`${rel(file)} missing`);
        continue;
      }
      const html = read(file);
      const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] || '';
      if (!new RegExp(`\\blang=["']${p.lang}["']`).test(htmlTag)) problems.push(`${tag}: <html lang="${p.lang}"> missing`);
      const alts = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /\brel=["']?alternate/i.test(t) && /\bhreflang=/i.test(t));
      const hl = Object.fromEntries(alts.map((t) => [/hreflang=["']?([^"'\s>]+)/i.exec(t)[1], /href=["']([^"']+)/i.exec(t)?.[1]]));
      const [wantEn, wantKo] = p.hreflang.map((s) => SITE_URL + s);
      if (alts.length !== 2) problems.push(`${tag}: ${alts.length} hreflang links, want 2 (en, ko)`);
      if (hl.en !== wantEn) problems.push(`${tag}: hreflang en href is ${hl.en}, want ${wantEn}`);
      if (hl.ko !== wantKo) problems.push(`${tag}: hreflang ko href is ${hl.ko}, want ${wantKo}`);
      for (const h of Object.values(hl)) if (!/^https?:\/\//.test(h || '')) problems.push(`${tag}: hreflang href not absolute: ${h}`);
      const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
      const [tLang, tHref] = p.toggle;
      const toggle = anchors.find((a) => attr(a, 'hreflang') === tLang && attr(a, 'href') === tHref);
      if (!toggle) problems.push(`${tag}: language toggle link missing (hreflang="${tLang}" href="${tHref}")`);
      if (p.page === 'home' && !anchors.some((a) => attr(a, 'href') === 'workflow/')) problems.push(`${tag}: no nav link href="workflow/"`);
      if (p.page === 'workflow' && !anchors.some((a) => attr(a, 'href') === '../')) problems.push(`${tag}: no home link href="../"`);
      const sections = [...html.matchAll(/<section\b[^>]*\bid=["']([^"']+)["']/gi)].map((m) => m[1]);
      const figures = [...html.matchAll(/<figure\b[^>]*\bid=["']([^"']+)["']/gi)].map((m) => m[1]);
      if (p.page === 'home' && sections.length !== 10) problems.push(`${tag}: ${sections.length} sections with an id, want 10`);
      if (p.page === 'workflow') {
        if (sections.join() !== WORKFLOW.sections.join()) problems.push(`${tag}: section ids [${sections}], want [${WORKFLOW.sections}]`);
        if (figures.join() !== WORKFLOW.figures.join()) problems.push(`${tag}: figure ids [${figures}], want [${WORKFLOW.figures}]`);
        const chip = JSON.parse(read(path.join(ROOT, CONTENT.workflow.replace('{lang}', p.lang)))).meta?.illustrative;
        if (!chip) problems.push(`${tag}: meta.illustrative missing in the ${p.lang} workflow content`);
        // every <figure> has a [data-twin] element inside it or referenced by aria-describedby
        for (const m of html.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi)) {
          const id = attr(m[1], 'id') || '(no id)';
          const refs = (attr(m[1], 'aria-describedby') || '').split(/\s+/).filter(Boolean);
          const inside = /<[a-z][a-z0-9-]*\b[^>]*\sdata-twin\b/i.test(m[2]);
          const referenced = refs.some((r) => new RegExp(`<[a-z][a-z0-9-]*\\b(?=[^>]*\\bid=["']${escRe(r)}["'])(?=[^>]*\\sdata-twin\\b)[^>]*>`, 'i').test(html));
          if (!inside && !referenced) problems.push(`${tag}: figure ${id} has no [data-twin] element (inside or via aria-describedby)`);
          if (chip && WORKFLOW.illustrative.includes(id) && !text(m[2]).includes(chip)) problems.push(`${tag}: figure ${id} lacks the "${chip}" chip`);
        }
      }
      const main = /<main\b[\s\S]*<\/main>/i.exec(html)?.[0] || html;
      const skeleton = [...main.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)]
        .map((m) => {
          const id = /\bid=["']([^"']*)["']/i.exec(m[2])?.[1] || '';
          const cls = /\bclass=["']([^"']*)["']/i.exec(m[2])?.[1] || '';
          return `${m[1].toLowerCase()}#${id}.${cls}`;
        })
        .join('\n');
      (info[p.page] ||= {})[p.lang] = { sections, figures, skeleton };
    }
    const summary = [];
    for (const [page, { en, ko } = {}] of Object.entries(info)) {
      if (!en || !ko) continue;
      if (en.sections.join() !== ko.sections.join()) problems.push(`${page}: section ids differ: en [${en.sections}] ko [${ko.sections}]`);
      if (en.figures.join() !== ko.figures.join()) problems.push(`${page}: figure ids differ: en [${en.figures}] ko [${ko.figures}]`);
      if (en.skeleton !== ko.skeleton) {
        const a = en.skeleton.split('\n');
        const b = ko.skeleton.split('\n');
        const i = a.findIndex((x, k) => x !== b[k]);
        problems.push(`${page}: <main> element structure differs at element ${i}: en "${a[i]}" ko "${b[i]}"`);
      }
      summary.push(`${page}: ${en.sections.length} sections [${en.sections.join(', ')}], figures [${en.figures.join(', ')}], same <main> structure EN = KO (${en.skeleton.split('\n').length} elements)`);
    }
    line(
      'structure',
      problems.length ? 'FAIL' : 'PASS',
      problems.length
        ? problems.join('; ')
        : `${PAGES.length} pages; lang en/ko; 2 absolute hreflang links per page from ${SITE_URL}; toggle links; home nav links workflow/, workflow home link ../; ` +
            `workflow figures have [data-twin] and Illustrative chips; ${summary.join('; ')}`,
    );
  },

  safety() {
    let priv = process.env.SAFETY_PRIVATE_PATTERNS || '';
    const dflt = path.join(os.homedir(), '.config/cc-orchestra-site/private-patterns.tsv');
    if (!priv && exists(dflt)) priv = dflt;
    const base = [];
    if (priv) base.push('--require-private', '--private', priv);
    else if (process.env.QA_ALLOW_NO_PRIVATE === '1') {
      console.log('    WARN ******************************************************************');
      console.log('    WARN safety check running WITHOUT private patterns (QA_ALLOW_NO_PRIVATE=1).');
      console.log('    WARN This run is not valid as release evidence.');
      console.log('    WARN ******************************************************************');
    } else {
      return line('safety', 'FAIL', 'private patterns file not found: set SAFETY_PRIVATE_PATTERNS (or QA_ALLOW_NO_PRIVATE=1 for a non-evidence run)');
    }
    const allow = SITE_URL !== PLACEHOLDER ? ['--allow', SITE_URL, '--allow-count', '8'] : [];
    const env = { ...process.env };
    delete env.SAFETY_PRIVATE_PATTERNS;
    const a = sh('bash', ['safety-grep.sh', rel(DIST), ...base, ...allow], { env });
    const b = sh('bash', ['safety-grep.sh', '.', '--source-mode', ...base], { env });
    const clean = /^SAFETY-GREP: CLEAN /m;
    const ok = passed(a, clean) && passed(b, clean);
    if (!passed(a, clean)) show(indent(a.out));
    if (!passed(b, clean)) show(indent(b.out));
    line(
      'safety',
      ok ? 'PASS' : 'FAIL',
      `safety-grep.sh ${rel(DIST)}${priv ? ' --require-private' : ''}${allow.length ? ' --allow <SITE_URL> --allow-count 8' : ''} -> exit ${a.code} (${lastLine(a.out)}); ` +
        `safety-grep.sh . --source-mode -> exit ${b.code} (${lastLine(b.out)})${priv ? '' : '; WITHOUT private patterns'}`,
    );
  },

  'safety-tests'() {
    const r = sh('bash', ['tests/safety-grep.test.sh'], { env: { ...process.env, DIST } });
    const ok = passed(r, /^# safety-grep tests: [1-9][0-9]* passed, 0 failed$/m);
    if (!ok) show(indent(r.out.split('\n').filter((l) => !l.startsWith('ok ')).join('\n')));
    line('safety-tests', ok ? 'PASS' : 'FAIL', `bash tests/safety-grep.test.sh -> exit ${r.code}; ${lastLine(r.out)}`);
  },

  'no-network'() {
    const problems = [];
    const BASE = 'https://qa.invalid/site/';
    const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html'));
    const cssFiles = walk(DIST).filter((f) => f.endsWith('.css'));
    const jsFiles = walk(DIST).filter((f) => /\.m?js$/.test(f));
    let refs = 0;
    const checkUrl = (u, where, pageUrl) => {
      u = u.trim().replace(/^["']|["']$/g, '');
      if (!u || /^(data|blob|about):/i.test(u) || u.startsWith('#')) return;
      refs++;
      let abs;
      try {
        abs = new URL(u, pageUrl);
      } catch {
        problems.push(`${where}: unparsable URL ${u}`);
        return;
      }
      if (abs.origin !== new URL(BASE).origin) problems.push(`${where}: loads from another origin: ${u}`);
    };
    const cssUrls = (css, where, pageUrl) => {
      for (const m of css.matchAll(/url\(\s*([^)]*?)\s*\)/gi)) checkUrl(m[1], where, pageUrl);
      for (const m of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) checkUrl(m[1], where, pageUrl);
    };
    const jsBad = (js, where) => {
      for (const tok of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'import(', 'importScripts', 'new Worker(']) {
        if (js.includes(tok)) problems.push(`${where}: uses ${tok}`);
      }
    };
    for (const f of htmlFiles) {
      const html = read(f);
      const pageUrl = new URL(path.relative(DIST, f).split(path.sep).join('/'), BASE).href;
      const where = rel(f);
      for (const m of html.matchAll(/<[a-z][a-z0-9-]*\b[^>]*>/gi)) {
        const tag = m[0];
        const name = /^<([a-z0-9-]+)/i.exec(tag)[1].toLowerCase();
        for (const am of tag.matchAll(/\s(src|srcset|poster|data|href|action|formaction|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
          const attr = am[1].toLowerCase();
          const val = am[2].replace(/^["']|["']$/g, '');
          if (attr === 'href' && name !== 'link' && name !== 'image' && name !== 'use') continue; // <a href> is navigation
          if (attr === 'href' && name === 'link' && /\brel=["']?alternate/i.test(tag)) continue;
          if ((attr === 'action' || attr === 'formaction')) {
            problems.push(`${where}: form submission target ${val}`);
            continue;
          }
          if (attr === 'data' && name !== 'object') continue;
          if (attr === 'srcset') for (const part of val.split(',')) checkUrl(part.trim().split(/\s+/)[0], where, pageUrl);
          else checkUrl(val, where, pageUrl);
        }
      }
      cssUrls(html, where, pageUrl);
      for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) jsBad(m[1], `${where} inline script`);
    }
    for (const f of cssFiles) cssUrls(read(f), rel(f), new URL(path.relative(DIST, f).split(path.sep).join('/'), BASE).href);
    for (const f of jsFiles) jsBad(read(f), rel(f));
    if (!htmlFiles.length) problems.push(`no HTML files in ${rel(DIST)}`);
    line(
      'no-network',
      problems.length ? 'FAIL' : 'PASS',
      problems.length ? problems.slice(0, 10).join('; ') : `${refs} resource URL(s) in ${htmlFiles.length} HTML, ${cssFiles.length} CSS files all same-origin; no network APIs in ${jsFiles.length} JS file(s) or inline scripts`,
    );
  },

  fonts() {
    const problems = [];
    const dir = path.join(DIST, 'fonts/ko');
    const sums = path.join(dir, 'SHA256SUMS');
    const seen = [];
    if (!exists(sums)) problems.push('dist/fonts/ko/SHA256SUMS missing');
    else {
      for (const l of read(sums).split('\n').filter(Boolean)) {
        const [hash, name] = l.trim().split(/\s+\*?/);
        const f = path.join(dir, name);
        if (!exists(f)) {
          problems.push(`${name}: missing`);
          continue;
        }
        const got = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
        if (got !== hash) problems.push(`${name}: sha256 mismatch`);
        if (OFFICIAL[name] && OFFICIAL[name] !== hash) problems.push(`${name}: SHA256SUMS differs from the official hash`);
        seen.push(name);
      }
      for (const n of Object.keys(OFFICIAL)) if (!seen.includes(n)) problems.push(`${n}: not listed in SHA256SUMS`);
    }
    for (const f of walk(DIST).filter((f) => /\.(otf|ttf|woff2?)$/i.test(f))) {
      if (!seen.includes(path.basename(f)) || path.dirname(f) !== dir) problems.push(`unlisted font file ${rel(f)}`);
    }
    const enPages = PAGES.filter((p) => p.lang === 'en').map((p) => path.join(DIST, p.file));
    const koPages = PAGES.filter((p) => p.lang === 'ko').map((p) => path.join(DIST, p.file));
    const linked = (file) =>
      exists(file)
        ? [...read(file).matchAll(/<link\b[^>]*rel=["']?stylesheet[^>]*>/gi)]
            .map((m) => /href=["']([^"']+)/i.exec(m[0])?.[1])
            .filter(Boolean)
            .map((h) => path.resolve(path.dirname(file), h.split(/[?#]/)[0]))
        : [];
    const enCss = enPages.flatMap(linked);
    const noSc = [...enPages, path.join(DIST, 'assets/site.css'), path.join(DIST, 'assets/site.js'), ...enCss];
    for (const f of [...new Set(noSc)]) {
      if (!exists(f)) problems.push(`${rel(f)} missing`);
      else if (read(f).includes('SCDream')) problems.push(`"SCDream" found in ${rel(f)}`);
    }
    const koFont = path.join(DIST, 'assets/ko-font.css');
    if (!exists(koFont) || !read(koFont).includes('SCDream')) problems.push('dist/assets/ko-font.css missing or without SCDream');
    for (const ko of koPages) if (!linked(ko).includes(koFont)) problems.push(`${path.relative(DIST, ko)} does not link assets/ko-font.css`);
    for (const en of enPages) if (linked(en).includes(koFont)) problems.push(`${path.relative(DIST, en)} links assets/ko-font.css`);
    const names = (fs_) => fs_.map((f) => path.relative(DIST, f)).join(', ');
    line(
      'fonts',
      problems.length ? 'FAIL' : 'PASS',
      problems.length ? problems.join('; ') : `sha256 OK and official for ${seen.join(', ')}; no "SCDream" in ${names(enPages)}, site.css, site.js; ${names(koPages)} link ko-font.css (SCDream), ${names(enPages)} do not`,
    );
  },

  budgets() {
    const gz = (f) => {
      const r = spawnSync('gzip', ['-9', '-c', f], { maxBuffer: 64 << 20 });
      if (r.error || r.signal || r.status !== 0) throw new Error(`gzip failed on ${f}: ${r.error?.code || r.signal || 'exit ' + r.status}`);
      return r.stdout.length;
    };
    const problems = [];
    const parts = [];
    for (const { file: p } of PAGES) {
      const f = path.join(DIST, p);
      if (!exists(f)) {
        problems.push(`${p} missing`);
        continue;
      }
      const n = gz(f);
      parts.push(`${p} ${n} B`);
      if (n > BUDGET.html) problems.push(`${p} ${n} B > ${BUDGET.html}`);
    }
    const all = walk(DIST);
    const sum = (fs_) => fs_.reduce((a, f) => a + gz(f), 0);
    const css = sum(all.filter((f) => f.endsWith('.css')));
    const js = sum(all.filter((f) => /\.m?js$/.test(f)));
    if (css > BUDGET.css) problems.push(`CSS ${css} B > ${BUDGET.css}`);
    if (js > BUDGET.js) problems.push(`JS ${js} B > ${BUDGET.js}`);
    // EN fonts: font files the EN pages or their stylesheets reference
    const fontFiles = new Set();
    for (const en of PAGES.filter((p) => p.lang === 'en').map((p) => path.join(DIST, p.file))) {
      if (!exists(en)) continue;
      const enHtml = read(en);
      const sheets = [...enHtml.matchAll(/<link\b[^>]*rel=["']?stylesheet[^>]*>/gi)].map((m) => path.resolve(path.dirname(en), (/href=["']([^"']+)/i.exec(m[0])?.[1] || '').split(/[?#]/)[0]));
      const texts = [[en, enHtml], ...sheets.filter(exists).map((s) => [s, read(s)])];
      for (const [f, t] of texts) for (const m of t.matchAll(/["'(]([^"'()]+\.(?:otf|ttf|woff2?))/gi)) fontFiles.add(path.resolve(path.dirname(f), m[1]));
    }
    const enFonts = [...fontFiles].filter(exists).reduce((a, f) => a + gz(f), 0);
    if (enFonts > BUDGET.enFonts) problems.push(`EN fonts ${enFonts} B > ${BUDGET.enFonts}`);
    const ko = all.filter((f) => f.endsWith('.otf')).map((f) => `${path.basename(f)} ${fs.statSync(f).size} B raw / ${gz(f)} B gzip`);
    line(
      'budgets',
      problems.length ? 'FAIL' : 'PASS',
      `${problems.length ? problems.join('; ') + '; ' : ''}gzip -9: ${parts.join(', ')} (max ${BUDGET.html} each); CSS ${css} B (max ${BUDGET.css}); JS ${js} B (max ${BUDGET.js}); EN fonts ${enFonts} B (max ${BUDGET.enFonts}); KO OTF (exempt): ${ko.join(', ') || 'none'}`,
    );
  },

  contrast() {
    const r = sh(process.execPath, ['scripts/contrast.mjs', '--quiet']);
    const ok = passed(r, /^contrast: PASS \([1-9][0-9]* pair checks, 0 below minimum/m);
    if (!ok) show(indent(r.out));
    line('contrast', ok ? 'PASS' : 'FAIL', `exit ${r.code}; ${lastLine(r.out) || 'no output'}`);
  },

  claims() {
    const env = { ...process.env };
    for (const k of ['CLAIMS_SOURCE_REPO', 'CLAIMS_WORKSPACE_ROOTS']) if (!env[k]) delete env[k];
    const r = sh(process.execPath, ['scripts/check-claims.mjs'], { env });
    const ok = passed(r, /^check-claims: PASS \([1-9][0-9]* leaf keys covered, [1-9][0-9]* claims/m);
    if (!ok) show(indent(r.out));
    line('claims', ok ? 'PASS' : 'FAIL', `exit ${r.code}; ${lastLine(r.out) || 'no output'}`);
  },

  deps() {
    const problems = [];
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
    const lockPath = path.join(ROOT, 'package-lock.json');
    if (!exists(lockPath)) return line('deps', 'FAIL', 'package-lock.json missing');
    const lock = JSON.parse(read(lockPath));
    if (!(lock.lockfileVersion >= 2)) problems.push(`lockfileVersion ${lock.lockfileVersion}`);
    if (pkg.dependencies && Object.keys(pkg.dependencies).length) problems.push('runtime dependencies present');
    const dev = pkg.devDependencies || {};
    for (const [n, v] of Object.entries(dev)) if (!/^\d+\.\d+\.\d+$/.test(v)) problems.push(`${n}@${v} is not an exact version`);
    const rootDev = lock.packages?.['']?.devDependencies || {};
    if (JSON.stringify(rootDev) !== JSON.stringify(dev)) problems.push('package-lock.json root devDependencies differ from package.json (run npm install)');
    for (const [n, v] of Object.entries(dev)) {
      const got = lock.packages?.[`node_modules/${n}`]?.version;
      if (got !== v) problems.push(`${n}: lockfile has ${got}, package.json ${v}`);
    }
    const scripts = Object.entries(lock.packages || {}).filter(([k, v]) => k && v.hasInstallScript).map(([k, v]) => `${k.replace(/^.*node_modules\//, '')}@${v.version}`);
    const readme = exists(path.join(ROOT, 'README.md')) ? read(path.join(ROOT, 'README.md')) : '';
    const depSection = readme.split(/^## /m).find((sec) => sec.startsWith('Dependencies')) || '';
    if (!depSection) problems.push('README.md has no "## Dependencies" section');
    for (const s of scripts) if (!depSection.includes(s.replace(/@[^@]+$/, ''))) problems.push(`${s} has an install script and is not justified in README Dependencies`);
    for (const n of Object.keys(dev)) if (depSection && !depSection.includes(n)) problems.push(`devDependency ${n} not listed in README Dependencies`);
    const count = Object.keys(lock.packages || {}).filter(Boolean).length;
    line(
      'deps',
      problems.length ? 'FAIL' : 'PASS',
      `${problems.length ? problems.join('; ') + '; ' : ''}${count} locked packages; devDependencies exact: ${Object.entries(dev).map(([n, v]) => `${n}@${v}`).join(', ')}; hasInstallScript: ${scripts.length ? scripts.join(', ') : 'none'}`,
    );
  },

  browser() {
    if (STATIC) return line('browser', 'SKIP', '--static');
    const r = sh(process.execPath, ['scripts/browser-qa.mjs'], { env: { ...process.env, DIST } });
    show(indent(r.out, 200));
    if (skipped(r, /^BROWSER SKIP /m)) return line('browser', 'SKIP', lastLine(r.out));
    line('browser', passed(r, /^browser-qa: PASS \([1-9][0-9]* checks, 0 failed\)$/m) ? 'PASS' : 'FAIL', `exit ${r.code}; ${lastLine(r.out) || 'no output'}`);
  },

  lighthouse() {
    if (STATIC) return line('lighthouse', 'SKIP', '--static');
    const r = sh(process.execPath, ['scripts/lighthouse.mjs'], { env: { ...process.env, DIST } });
    show(indent(r.out));
    if (skipped(r, /^LIGHTHOUSE SKIP /m)) return line('lighthouse', 'SKIP', lastLine(r.out));
    const ok = passed(r, /^lighthouse: PASS /m) && (r.out.match(/^LIGHTHOUSE \/\S* PASS /gm) || []).length === PAGES.length;
    line('lighthouse', ok ? 'PASS' : 'FAIL', `exit ${r.code}; ${lastLine(r.out) || 'no output'}`);
  },

  async links() {
    if (STATIC) return line('links', 'SKIP', '--static');
    const { startServer } = await import('./serve.mjs');
    let server;
    try {
      server = await startServer(DIST);
    } catch (e) {
      if (/EPERM|EACCES|EADDRNOTAVAIL/.test(String(e.code || e.message))) return line('links', 'SKIP', `cannot listen on loopback: ${e.code}`);
      return line('links', 'FAIL', String(e.message || e));
    }
    try {
      const { check } = await import('linkinator');
      const origin = new URL(server.url).origin;
      const res = await check({
        path: server.url,
        recurse: true,
        checkCss: true,
        checkFragments: true,
        timeout: 10000,
        linksToSkip: async (l) => !l.startsWith(origin),
      });
      if (!res || !Array.isArray(res.links) || !res.links.some((l) => l.state === 'OK' && l.url.startsWith(origin))) {
        return line('links', 'FAIL', 'linkinator returned no checked internal links');
      }
      const broken = res.links.filter((l) => l.state === 'BROKEN');
      const ok = res.links.filter((l) => l.state === 'OK').length;
      const skipped = res.links.filter((l) => l.state === 'SKIPPED').length;
      for (const b of broken) console.log(`    BROKEN ${b.status} ${b.url.replace(origin, '')} (from ${String(b.parent || '').replace(origin, '')})`);
      const reachedPaths = new Set(res.links.filter((l) => l.state === 'OK' && l.url.startsWith(origin)).map((l) => new URL(l.url).pathname));
      const pagePaths = PAGES.map((p) => '/' + p.file.replace(/index\.html$/, ''));
      const unreached = pagePaths.filter((u) => !reachedPaths.has(u));
      for (const u of unreached) console.log(`    NOT REACHED ${u}`);
      line(
        'links',
        broken.length || unreached.length ? 'FAIL' : 'PASS',
        `linkinator: ${ok} internal link(s) OK, ${broken.length} broken, ${skipped} external skipped (fragments checked); ${pagePaths.length - unreached.length} of ${pagePaths.length} pages reached from /` +
          (unreached.length ? ` (not reached: ${unreached.join(', ')})` : ''),
      );
    } catch (e) {
      line('links', 'FAIL', `linkinator error: ${e.message || e}`);
    } finally {
      await server.close();
    }
  },
};

const ORDER = ['build', 'facts', 'structure', 'safety', 'safety-tests', 'no-network', 'fonts', 'budgets', 'contrast', 'claims', 'deps', 'browser', 'lighthouse', 'links'];
console.log(`QA run: DIST=${rel(DIST)} SITE_URL=${SITE_URL === PLACEHOLDER ? '(placeholder)' : '(set)'}${STATIC ? ' --static' : ''}`);
for (const id of ORDER) {
  if (ONLY && !ONLY.has(id)) continue;
  try {
    await checks[id]();
  } catch (e) {
    line(id, 'FAIL', `check crashed: ${e.message || e}`);
  }
}
const fails = results.filter((r) => r.status === 'FAIL').map((r) => r.id);
const skips = results.filter((r) => r.status === 'SKIP').map((r) => r.id);
console.log(`QA ${fails.length ? 'FAIL' : 'PASS'}: ${results.length - fails.length - skips.length} passed, ${fails.length} failed${fails.length ? ' (' + fails.join(', ') + ')' : ''}, ${skips.length} skipped${skips.length ? ' (' + skips.join(', ') + ')' : ''}`);
process.exit(fails.length ? 1 : 0);
