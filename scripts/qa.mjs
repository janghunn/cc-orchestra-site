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
// The project page's contract (the site root): section ids in order; no <figure>; the comparison table.
const PROJECT = { sections: ['hero', 'editions', 'compare'], table: 'tbl-editions' };
// The cc-orch overview's contract: its ten section ids in order.
const OVERVIEW = { sections: ['hero', 'problem', 'how', 'routing', 'gates', 'providers', 'lifecycle', 'helpers', 'limits', 'faq'] };
// The workflow page's contract: section ids and figure ids in order; figures that must show the Illustrative chip;
// a link to the cc-orch overview (../).
const WORKFLOW = {
  sections: ['hero', 'loop', 'methods', 'flows', 'roles', 'manual', 'tips'],
  figures: ['fig-loop', 'fig-pipeline', 'fig-reviews', 'fig-gpu', 'fig-roles'],
  illustrative: ['fig-loop', 'fig-reviews', 'fig-gpu'],
  links: ['../'],
};
// The beginners' guide contract: section ids in order; no <figure>; links to the cc-orch overview (../) and to the
// research page (../workflow/).
const GUIDE = { sections: ['hero', 'why', 'roles', 'files', 'compare', 'costs', 'choose'], links: ['../', '../workflow/'] };
// The cc-doc page contract: section ids in order; no <figure>; no comparison table (it moved to the project page), but
// id="tbl-editions" stays on a non-table element (the editions section's button row); links to the project page (../)
// and its comparison (../#compare).
const DOC = { sections: ['hero', 'desk', 'copies', 'guard', 'formats', 'editions'], links: ['../', '../#compare'], alias: 'tbl-editions' };
// Same-language link targets on each page kind (KO pages use the same values inside /ko/).
const LINKS = {
  project: { project: './', overview: 'cc-orch/', workflow: 'cc-orch/workflow/', guide: 'cc-orch/guide/', doc: 'cc-doc/' },
  overview: { project: '../', overview: './', workflow: 'workflow/', guide: 'guide/', doc: '../cc-doc/' },
  workflow: { project: '../../', overview: '../', workflow: './', guide: '../guide/', doc: '../../cc-doc/' },
  guide: { project: '../../', overview: '../', workflow: '../workflow/', guide: './', doc: '../../cc-doc/' },
  doc: { project: '../', overview: '../cc-orch/', workflow: '../cc-orch/workflow/', guide: '../cc-orch/guide/', doc: './' },
};
// Page kinds of the cc-orch edition (they carry the nav.sn-pages tabs) and the edition overview of each page kind.
const ORCH_KINDS = ['overview', 'workflow', 'guide'];
const EDITION = { overview: 'overview', workflow: 'overview', guide: 'overview', doc: 'doc' };
// The ten content pages. hreflang: the absolute URLs of the page pair; toggle: the language link's hreflang and href.
const PAGES = [
  { page: 'project', lang: 'en', file: 'index.html', hreflang: ['', 'ko/'], toggle: ['ko', 'ko/'] },
  { page: 'project', lang: 'ko', file: 'ko/index.html', hreflang: ['', 'ko/'], toggle: ['en', '../?lang=en'] },
  { page: 'overview', lang: 'en', file: 'cc-orch/index.html', hreflang: ['cc-orch/', 'ko/cc-orch/'], toggle: ['ko', '../ko/cc-orch/'] },
  { page: 'overview', lang: 'ko', file: 'ko/cc-orch/index.html', hreflang: ['cc-orch/', 'ko/cc-orch/'], toggle: ['en', '../../cc-orch/?lang=en'] },
  { page: 'workflow', lang: 'en', file: 'cc-orch/workflow/index.html', hreflang: ['cc-orch/workflow/', 'ko/cc-orch/workflow/'], toggle: ['ko', '../../ko/cc-orch/workflow/'] },
  { page: 'workflow', lang: 'ko', file: 'ko/cc-orch/workflow/index.html', hreflang: ['cc-orch/workflow/', 'ko/cc-orch/workflow/'], toggle: ['en', '../../../cc-orch/workflow/?lang=en'] },
  { page: 'guide', lang: 'en', file: 'cc-orch/guide/index.html', hreflang: ['cc-orch/guide/', 'ko/cc-orch/guide/'], toggle: ['ko', '../../ko/cc-orch/guide/'] },
  { page: 'guide', lang: 'ko', file: 'ko/cc-orch/guide/index.html', hreflang: ['cc-orch/guide/', 'ko/cc-orch/guide/'], toggle: ['en', '../../../cc-orch/guide/?lang=en'] },
  { page: 'doc', lang: 'en', file: 'cc-doc/index.html', hreflang: ['cc-doc/', 'ko/cc-doc/'], toggle: ['ko', '../ko/cc-doc/'] },
  { page: 'doc', lang: 'ko', file: 'ko/cc-doc/index.html', hreflang: ['cc-doc/', 'ko/cc-doc/'], toggle: ['en', '../../cc-doc/?lang=en'] },
];
// The redirect pages at the old workflow and guide addresses: not content pages (no hreflang pair, not linked, not in
// Lighthouse or the crawl), but written by every build and checked on their own.
const REDIRECTS = [
  { file: 'workflow/index.html', lang: 'en', target: '../cc-orch/workflow/' },
  { file: 'guide/index.html', lang: 'en', target: '../cc-orch/guide/' },
  { file: 'ko/workflow/index.html', lang: 'ko', target: '../cc-orch/workflow/' },
  { file: 'ko/guide/index.html', lang: 'ko', target: '../cc-orch/guide/' },
];
const CONTENT = {
  project: 'content/project.{lang}.json',
  overview: 'content/{lang}.json',
  workflow: 'content/workflow.{lang}.json',
  guide: 'content/guide.{lang}.json',
  doc: 'content/doc.{lang}.json',
  site: 'content/site.{lang}.json',
};
// A real SITE_URL appears exactly in the two hreflang alternates of every page in PAGES (never counted from the output).
const ALLOW_COUNT = 2 * PAGES.length;
// Every HTML file a build writes: the content pages and the redirect pages.
const HTML_FILES = [...PAGES.map((p) => p.file), ...REDIRECTS.map((r) => r.file)];
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
    const stale = HTML_FILES.filter((f) => !fresh(path.join(DIST, f)));
    const ok = r.ran && r.code === 0 && stale.length === 0;
    if (!ok && r.out.trim()) show(indent(r.out));
    line('build', ok ? 'PASS' : 'FAIL', `node scripts/build.mjs --out ${rel(DIST)} -> exit ${r.code}; ${ok ? `${HTML_FILES.length} HTML files (${PAGES.length} content pages, ${REDIRECTS.length} redirect pages) written by this run: ${HTML_FILES.join(', ')}` : `missing or not rewritten by this run: ${stale.join(', ') || '(none)'}`}`);
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
      if (!exists(f)) {
        problems.push(`${rel(f)} missing`);
        continue;
      }
      for (const m of read(f).matchAll(/\{\{f:([A-Za-z0-9_.]+)\}\}/g)) used.add(m[1]);
    }
    // Own properties only, as in build.mjs getPath: `in` and `v[seg]` would resolve toString, constructor, ... through Object.prototype.
    const isRoute = (v) => v && typeof v === 'object' && Object.hasOwn(v, 'model') && Object.hasOwn(v, 'effort');
    for (const key of used) {
      let v = facts;
      for (const seg of key.split('.')) v = v !== null && typeof v === 'object' && Object.hasOwn(v, seg) ? v[seg] : undefined;
      if (v === undefined) problems.push(`{{f:${key}}} does not resolve in facts.json`);
      else if (typeof v === 'object' && !isRoute(v)) problems.push(`{{f:${key}}} resolves to an object that is not a route`);
    }
    line('facts', problems.length ? 'FAIL' : 'PASS', problems.length ? problems.slice(0, 8).join('; ') : `no "{{" in ${textFiles.length} built text files; ${used.size} facts keys used, all resolve`);
  },

  structure() {
    const problems = [];
    const info = {};
    const attr = (tag, name) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
    const hasClass = (tag, c) => (attr(tag, 'class') || '').split(/\s+/).includes(c);
    const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const plain = (html) => decode(text(html)).trim();
    const anchorsOf = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ tag: m[0].slice(0, m[0].indexOf('>') + 1), inner: m[2], index: m.index }));
    // accessible name of a link: aria-label, else its text
    const nameOf = (a) => decode(attr(a.tag, 'aria-label') ?? plain(a.inner));
    const navsOf = (html, c) => [...html.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)].filter((m) => hasClass(m[0], c)).map((m) => ({ tag: `<nav${m[1]}>`, inner: m[2], index: m.index }));
    const idsOf = (html) => [...html.matchAll(/<[a-z][a-z0-9-]*\b[^>]*?\sid=["']([^"']+)["']/gi)].map((m) => m[1]);
    const scriptsOf = (html) => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const FORWARD = /location\.replace\(\s*["']cc-orch\/["']\s*\+\s*(?:\w+\.)?location\.search\s*\+\s*(?:\w+\.)?location\.hash\s*\)/;
    // the old-fragment list of a project page's forwarder: a JS array of strings, or one string of space-separated ids
    const forwardList = (html) => {
      const js = scriptsOf(html).find((s) => FORWARD.test(s));
      if (js === undefined) return null;
      const arrays = [...js.matchAll(/\[\s*((?:"[^"]*"|'[^']*')(?:\s*,\s*(?:"[^"]*"|'[^']*'))*)\s*,?\s*\]/g)].map((m) => [...m[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2]));
      const strings = [...js.matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2]).filter((v) => /^[\s,|]*[A-Za-z][\w-]*(?:[\s,|]+[A-Za-z][\w-]*)+[\s,|]*$/.test(v)).map((v) => v.split(/[\s,|]+/).filter(Boolean));
      const all = [...arrays, ...strings].sort((a, b) => b.length - a.length);
      return all[0] || null;
    };
    // the EN page's inlined saved-language target: location.replace("<target>" + location.hash)
    const koTargets = (html) => scriptsOf(html).flatMap((s) => [...s.matchAll(/location\.replace\(\s*["']([^"']*)["']\s*\+\s*(?:\w+\.)?location\.hash\s*\)/g)].map((m) => m[1]));
    const site = {};
    for (const lang of ['en', 'ko']) {
      const f = path.join(ROOT, CONTENT.site.replace('{lang}', lang));
      if (!exists(f)) problems.push(`${rel(f)} missing`);
      else site[lang] = JSON.parse(read(f)).site || {};
    }
    const project = {};
    for (const lang of ['en', 'ko']) {
      const f = path.join(ROOT, CONTENT.project.replace('{lang}', lang));
      if (!exists(f)) problems.push(`${rel(f)} missing`);
      else project[lang] = JSON.parse(read(f));
    }
    const built = {};
    for (const p of PAGES) {
      const file = path.join(DIST, p.file);
      const tag = p.file;
      if (!exists(file)) {
        problems.push(`${rel(file)} missing`);
        continue;
      }
      const html = read(file);
      built[p.file] = html;
      const S = site[p.lang] || {};
      const L = LINKS[p.page];
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
      for (const m of html.matchAll(/\s(href|src)=["']\//gi)) problems.push(`${tag}: root-relative ${m[1]}="/..." (breaks under the Pages project path)`);
      // saved language: the EN page's inlined target is its toggle href
      if (p.lang === 'en') {
        const t = koTargets(html);
        if (t.length !== 1 || t[0] !== tHref) problems.push(`${tag}: inlined saved-language target(s) [${t.join(', ')}], want exactly [${tHref}] (the toggle href)`);
      }
      // the old-fragment forwarder runs on the project pages only
      if (p.page !== 'project' && scriptsOf(html).some((s) => FORWARD.test(s))) problems.push(`${tag}: has the old-fragment forwarder (project pages only)`);

      // the shell: header, sub-bar, footer sitemap
      const header = /<header\b[^>]*>([\s\S]*?)<\/header>/i.exec(html);
      if (!header || !hasClass(header[0].slice(0, header[0].indexOf('>') + 1), 'topbar')) problems.push(`${tag}: no header.topbar`);
      const headerHtml = header?.[1] || '';
      const mainAt = html.search(/<main\b/i);
      const mainEnd = html.search(/<\/main>/i);
      if (mainAt < 0 || mainEnd < 0) problems.push(`${tag}: no <main>`);
      const brands = anchorsOf(html).filter((a) => hasClass(a.tag, 'brand'));
      if (!anchorsOf(headerHtml).some((a) => hasClass(a.tag, 'brand'))) problems.push(`${tag}: no a.brand in the top bar`);
      for (const a of brands) {
        if (attr(a.tag, 'href') !== L.project) problems.push(`${tag}: a.brand href="${attr(a.tag, 'href')}", want "${L.project}" (project page)`);
        if (nameOf(a) !== S.homeLabel) problems.push(`${tag}: a.brand accessible name "${nameOf(a)}", want "${S.homeLabel}" (site.homeLabel)`);
      }
      const eds = navsOf(html, 'sn-eds');
      if (!navsOf(headerHtml, 'sn-eds').length) problems.push(`${tag}: no nav.sn-eds in the top bar`);
      const edCurrent = p.page === 'project' ? {} : p.page === EDITION[p.page] ? { [EDITION[p.page]]: 'page' } : { [EDITION[p.page]]: 'true' };
      for (const n of eds) {
        const links = anchorsOf(n.inner);
        const hrefs = links.map((a) => attr(a.tag, 'href'));
        if (hrefs.join(' ') !== `${L.overview} ${L.doc}`) problems.push(`${tag}: nav.sn-eds links [${hrefs.join(', ')}], want exactly [${L.overview}, ${L.doc}]`);
        if (attr(n.tag, 'aria-label') !== S.edsLabel) problems.push(`${tag}: nav.sn-eds aria-label "${attr(n.tag, 'aria-label')}", want "${S.edsLabel}"`);
        for (const [ed, a] of [['overview', links[0]], ['doc', links[1]]]) {
          if (!a) continue;
          const got = attr(a.tag, 'aria-current');
          if (got !== edCurrent[ed]) problems.push(`${tag}: nav.sn-eds link ${attr(a.tag, 'href')} aria-current="${got ?? ''}", want "${edCurrent[ed] ?? ''}"`);
        }
      }
      const sub = /<\/header>\s*(?:<!--[\s\S]*?-->\s*)*(<[a-z][a-z0-9-]*\b[^>]*>)/i.exec(html);
      const subAt = sub ? sub.index : -1;
      if (!sub || !hasClass(sub[1], 'sn-sub')) problems.push(`${tag}: the element right after </header> is not .sn-sub (${sub ? sub[1].slice(0, 60) : 'none'})`);
      const inSub = (n) => subAt >= 0 && n.index > subAt && (mainAt < 0 || n.index < mainAt);
      const pages = navsOf(html, 'sn-pages');
      if (ORCH_KINDS.includes(p.page)) {
        if (pages.length !== 1) problems.push(`${tag}: ${pages.length} nav.sn-pages, want 1`);
        for (const n of pages) {
          if (!inSub(n)) problems.push(`${tag}: nav.sn-pages is not in the sub-bar`);
          if (attr(n.tag, 'aria-label') !== S.orchPagesLabel) problems.push(`${tag}: nav.sn-pages aria-label "${attr(n.tag, 'aria-label')}", want "${S.orchPagesLabel}"`);
          const links = anchorsOf(n.inner);
          const hrefs = links.map((a) => attr(a.tag, 'href'));
          if (hrefs.join(' ') !== `${L.overview} ${L.workflow} ${L.guide}`) problems.push(`${tag}: nav.sn-pages links [${hrefs.join(', ')}], want [${L.overview}, ${L.workflow}, ${L.guide}]`);
          const cur = links.filter((a) => attr(a.tag, 'aria-current') === 'page').map((a) => attr(a.tag, 'href'));
          if (cur.join() !== './') problems.push(`${tag}: nav.sn-pages aria-current="page" on [${cur.join(', ')}], want exactly [./]`);
          if (links[0] && attr(links[0].tag, 'aria-label') !== S.orchOverviewLabel) problems.push(`${tag}: first nav.sn-pages link aria-label "${attr(links[0].tag, 'aria-label')}", want "${S.orchOverviewLabel}"`);
        }
      } else if (pages.length) problems.push(`${tag}: ${pages.length} nav.sn-pages, want none outside cc-orch`);
      const toc = navsOf(html, 'sn-toc');
      if (p.page === 'project') {
        if (toc.length) problems.push(`${tag}: ${toc.length} nav.sn-toc, want none on the project page`);
      } else {
        if (toc.length !== 1) problems.push(`${tag}: ${toc.length} nav.sn-toc, want 1`);
        for (const n of toc) {
          if (!inSub(n)) problems.push(`${tag}: nav.sn-toc is not in the sub-bar`);
          if (!/<ul\b[^>]*\bclass=["'][^"']*\bnavlinks\b/i.test(n.inner)) problems.push(`${tag}: nav.sn-toc has no ul.navlinks`);
          const by = attr(n.tag, 'aria-labelledby');
          const byEl = by ? new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\sid=["']${escRe(by)}["'][^>]*>([\\s\\S]*?)</\\1>`, 'i').exec(html) : null;
          const name = attr(n.tag, 'aria-label') ?? (byEl ? plain(byEl[2]) : undefined);
          if (name !== S.tocLabel) problems.push(`${tag}: nav.sn-toc name "${name ?? ''}", want "${S.tocLabel}" (site.tocLabel)`);
          if (!plain(n.inner).includes(S.tocLabel) && !(byEl && plain(byEl[2]) === S.tocLabel)) problems.push(`${tag}: nav.sn-toc does not show the prefix "${S.tocLabel}"`);
          const ids = new Set(idsOf(html));
          const links = anchorsOf(n.inner).map((a) => attr(a.tag, 'href'));
          if (!links.length) problems.push(`${tag}: nav.sn-toc has no links`);
          for (const h of links) if (!h?.startsWith('#') || !ids.has(h.slice(1))) problems.push(`${tag}: nav.sn-toc link ${h} is not a section of this page`);
        }
      }
      const foot = navsOf(html, 'sn-foot');
      if (foot.length !== 1) problems.push(`${tag}: ${foot.length} nav.sn-foot, want 1`);
      for (const n of foot) {
        if (mainEnd >= 0 && n.index < mainEnd) problems.push(`${tag}: nav.sn-foot is not after </main>`);
        if (attr(n.tag, 'aria-label') !== S.footLabel) problems.push(`${tag}: nav.sn-foot aria-label "${attr(n.tag, 'aria-label')}", want "${S.footLabel}"`);
        const links = anchorsOf(n.inner);
        const hrefs = new Set(links.map((a) => attr(a.tag, 'href')));
        const want = Object.values(L);
        const missing = want.filter((h) => !hrefs.has(h));
        const extra = [...hrefs].filter((h) => !want.includes(h));
        if (missing.length || extra.length) problems.push(`${tag}: nav.sn-foot links missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`);
        const cur = links.filter((a) => attr(a.tag, 'aria-current') === 'page').map((a) => attr(a.tag, 'href'));
        if (cur.join() !== './') problems.push(`${tag}: nav.sn-foot aria-current="page" on [${cur.join(', ')}], want exactly [./]`);
        for (const [h, label, key] of [[L.overview, S.orchOverviewLabel, 'orchOverviewLabel'], [L.doc, S.docOverviewLabel, 'docOverviewLabel']]) {
          const a = links.find((x) => attr(x.tag, 'href') === h);
          if (a && attr(a.tag, 'aria-label') !== label) problems.push(`${tag}: nav.sn-foot link ${h} aria-label "${attr(a.tag, 'aria-label')}", want "${label}" (site.${key})`);
        }
      }

      // page contracts
      const sections = [...html.matchAll(/<section\b[^>]*\bid=["']([^"']+)["']/gi)].map((m) => m[1]);
      const figures = [...html.matchAll(/<figure\b[^>]*\bid=["']([^"']+)["']/gi)].map((m) => m[1]);
      const hrefs = anchors.map((a) => attr(a, 'href'));
      const contract = { project: PROJECT, overview: OVERVIEW, workflow: WORKFLOW, guide: GUIDE, doc: DOC }[p.page];
      if (sections.join() !== contract.sections.join()) problems.push(`${tag}: section ids [${sections}], want [${contract.sections}]`);
      for (const h of contract.links || []) if (!hrefs.includes(h)) problems.push(`${tag}: no link href="${h}"`);
      if (p.page === 'project') {
        if (/<figure\b/i.test(html)) problems.push(`${tag}: has a <figure>, the project page has none`);
        if (!new RegExp(`<table\\b[^>]*\\sid=["']${PROJECT.table}["']`, 'i').test(html)) problems.push(`${tag}: no table#${PROJECT.table}`);
      }
      if (p.page === 'workflow') {
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
      if (p.page === 'guide' && /<figure\b/i.test(html)) problems.push(`${tag}: has a <figure>, the guide has none`);
      if (p.page === 'doc') {
        if (/<figure\b/i.test(html)) problems.push(`${tag}: has a <figure>, the cc-doc page has none`);
        if (new RegExp(`<table\\b[^>]*\\sid=["']${DOC.alias}["']`, 'i').test(html)) problems.push(`${tag}: still has table#${DOC.alias} (it moved to the project page)`);
        if (!idsOf(html).includes(DOC.alias)) problems.push(`${tag}: no id="${DOC.alias}" (the alias for old links)`);
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

    // old overview fragments: each project page forwards every id of the built overview that it does not use itself
    const ovEn = built['cc-orch/index.html'];
    const ovKo = built['ko/cc-orch/index.html'];
    let forwardCount = 0;
    if (ovEn && ovKo) {
      const ov = new Set(idsOf(ovEn));
      const ovK = new Set(idsOf(ovKo));
      if ([...ov].sort().join() !== [...ovK].sort().join()) problems.push('overview: the EN and KO pages have different id sets');
      for (const f of ['index.html', 'ko/index.html']) {
        const html = built[f];
        if (!html) continue;
        const own = new Set(idsOf(html));
        const list = forwardList(html);
        if (!list) {
          problems.push(`${f}: no old-fragment forwarder with a list of ids (location.replace("cc-orch/" + location.search + location.hash))`);
          continue;
        }
        forwardCount = list.length;
        const set = new Set(list);
        const want = [...ov].filter((id) => !own.has(id));
        const missing = want.filter((id) => !set.has(id));
        const owned = list.filter((id) => own.has(id));
        const extra = list.filter((id) => !ov.has(id));
        if (missing.length) problems.push(`${f}: forward list lacks overview id(s) ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` (+${missing.length - 8})` : ''}`);
        if (owned.length) problems.push(`${f}: forward list holds id(s) the project page uses: ${owned.join(', ')}`);
        if (extra.length) problems.push(`${f}: forward list holds id(s) that are not on the overview: ${extra.join(', ')}`);
      }
    } else problems.push('old fragments: the built overview pages are missing');

    // the redirect pages at the old addresses
    for (const r of REDIRECTS) {
      const file = path.join(DIST, r.file);
      if (!exists(file)) {
        problems.push(`${rel(file)} missing`);
        continue;
      }
      const html = read(file);
      const tag = r.file;
      const T = escRe(r.target);
      const moved = project[r.lang]?.moved || {};
      if (!new RegExp(`<html\\b[^>]*\\slang=["']${r.lang}["']`, 'i').test(html)) problems.push(`${tag}: <html lang="${r.lang}"> missing`);
      if (!/<meta\b(?=[^>]*\sname=["']robots["'])(?=[^>]*\scontent=["']noindex["'])[^>]*>/i.test(html)) problems.push(`${tag}: no <meta name="robots" content="noindex">`);
      if (!new RegExp(`<meta\\b(?=[^>]*\\shttp-equiv=["']refresh["'])(?=[^>]*\\scontent=["']0;\\s*url=${T}["'])[^>]*>`, 'i').test(html)) problems.push(`${tag}: no <meta http-equiv="refresh" content="0; url=${r.target}">`);
      if (!scriptsOf(html).some((s) => new RegExp(`location\\.replace\\(\\s*["']${T}["']\\s*\\+\\s*(?:\\w+\\.)?location\\.search\\s*\\+\\s*(?:\\w+\\.)?location\\.hash\\s*\\)`).test(s))) problems.push(`${tag}: no script location.replace("${r.target}" + location.search + location.hash)`);
      const links = anchorsOf(html).filter((a) => attr(a.tag, 'href') === r.target);
      if (!links.length) problems.push(`${tag}: no fallback link href="${r.target}"`);
      if (moved.link && !links.some((a) => plain(a.inner) === moved.link)) problems.push(`${tag}: fallback link text is not "${moved.link}" (moved.link)`);
      const title = plain(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
      if (!moved.title || title !== moved.title) problems.push(`${tag}: <title> "${title}", want "${moved.title}" (moved.title)`);
      if (/<link\b[^>]*\bhreflang=/i.test(html)) problems.push(`${tag}: has an hreflang link`);
      if (html.includes(SITE_URL) || html.includes(PLACEHOLDER)) problems.push(`${tag}: contains the SITE_URL`);
      if (/\ssrc\s*=/i.test(html) || /<link\b[^>]*\brel=["']?(?:stylesheet|preload|modulepreload)/i.test(html)) problems.push(`${tag}: loads an external asset`);
      for (const m of html.matchAll(/\s(href|src)=["']\//gi)) problems.push(`${tag}: root-relative ${m[1]}="/..."`);
      const dest = path.join(path.dirname(file), r.target, 'index.html');
      if (!exists(dest)) problems.push(`${tag}: target ${r.target} resolves to ${rel(dest)}, which is not in the build`);
    }

    line(
      'structure',
      problems.length ? 'FAIL' : 'PASS',
      problems.length
        ? problems.join('; ')
        : `${PAGES.length} content pages; lang en/ko; 2 absolute hreflang links per page from ${SITE_URL}; toggle links; EN saved-language target = toggle href; no root-relative href or src; ` +
            `shell on every page: a.brand -> project page, nav.sn-eds with the two edition links, .sn-sub after the header, nav.sn-pages (3 links, one aria-current="page") on the ${ORCH_KINDS.length * 2} cc-orch pages only, nav.sn-toc on the old page kinds, nav.sn-foot with the five same-language pages; ` +
            `project sections [${PROJECT.sections.join(', ')}], no figure, table#${PROJECT.table}; overview sections [${OVERVIEW.sections.join(', ')}]; workflow figures have [data-twin] and Illustrative chips, link ${WORKFLOW.links.join(' and ')}; ` +
            `guide sections [${GUIDE.sections.join(', ')}], no figure, links ${GUIDE.links.join(' and ')}; doc sections [${DOC.sections.join(', ')}], no figure, no table#${DOC.alias} (id kept as alias), links ${DOC.links.join(' and ')}; ` +
            `old fragments: both project pages forward the ${forwardCount} overview ids they do not use, and no other page forwards; ` +
            `${REDIRECTS.length} redirect pages (${REDIRECTS.map((r) => r.file).join(', ')}): refresh, script and fallback link to their target, lang, noindex, no hreflang, no SITE_URL, target in the build; ${summary.join('; ')}`,
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
    const allow = SITE_URL !== PLACEHOLDER ? ['--allow', SITE_URL, '--allow-count', String(ALLOW_COUNT)] : [];
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
      `safety-grep.sh ${rel(DIST)}${priv ? ' --require-private' : ''}${allow.length ? ` --allow <SITE_URL> --allow-count ${ALLOW_COUNT}` : ''} -> exit ${a.code} (${lastLine(a.out)}); ` +
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
    for (const f of HTML_FILES) if (!htmlFiles.includes(path.join(DIST, f))) problems.push(`${f} missing, so not checked`);
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
    // the redirect pages load no stylesheet and name no font
    const redirectPages = REDIRECTS.map((r) => path.join(DIST, r.file));
    const linked = (file) =>
      exists(file)
        ? [...read(file).matchAll(/<link\b[^>]*rel=["']?stylesheet[^>]*>/gi)]
            .map((m) => /href=["']([^"']+)/i.exec(m[0])?.[1])
            .filter(Boolean)
            .map((h) => path.resolve(path.dirname(file), h.split(/[?#]/)[0]))
        : [];
    const enCss = enPages.flatMap(linked);
    const noSc = [...enPages, ...redirectPages, path.join(DIST, 'assets/site.css'), path.join(DIST, 'assets/site.js'), ...enCss];
    for (const f of [...new Set(noSc)]) {
      if (!exists(f)) problems.push(`${rel(f)} missing`);
      else if (read(f).includes('SCDream')) problems.push(`"SCDream" found in ${rel(f)}`);
    }
    const koFont = path.join(DIST, 'assets/ko-font.css');
    if (!exists(koFont) || !read(koFont).includes('SCDream')) problems.push('dist/assets/ko-font.css missing or without SCDream');
    for (const ko of koPages) if (!linked(ko).includes(koFont)) problems.push(`${path.relative(DIST, ko)} does not link assets/ko-font.css`);
    for (const en of [...enPages, ...redirectPages]) if (linked(en).includes(koFont)) problems.push(`${path.relative(DIST, en)} links assets/ko-font.css`);
    const names = (fs_) => fs_.map((f) => path.relative(DIST, f)).join(', ');
    line(
      'fonts',
      problems.length ? 'FAIL' : 'PASS',
      problems.length ? problems.join('; ') : `sha256 OK and official for ${seen.join(', ')}; no "SCDream" in ${names(enPages)}, the ${redirectPages.length} redirect pages, site.css, site.js; ${names(koPages)} link ko-font.css (SCDream), ${names(enPages)} and the redirect pages do not`,
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
    for (const p of HTML_FILES) {
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
