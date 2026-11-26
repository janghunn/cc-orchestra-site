#!/usr/bin/env node
/* cc-orchestra-site / scripts/build.mjs
   Zero-dependency assembly script. A page table (PAGES below) lists each page: one template + two copy
   tables (EN, KO) -> two outputs, all sharing facts.json, the shared copy (content/site.en.json,
   site.ko.json, read as site.* by every template) and the assets:
     project   src/project.html   content/project.en.json, project.ko.json    -> index.html, ko/index.html
     overview  src/page.html      content/en.json, ko.json                    -> cc-orch/index.html,
                                                                                 ko/cc-orch/index.html
     workflow  src/workflow.html  content/workflow.en.json, workflow.ko.json  -> cc-orch/workflow/index.html,
                                                                                 ko/cc-orch/workflow/index.html
     guide     src/guide.html     content/guide.en.json, guide.ko.json        -> cc-orch/guide/index.html,
                                                                                 ko/cc-orch/guide/index.html
     doc       src/doc.html       content/doc.en.json, doc.ko.json            -> cc-doc/index.html,
                                                                                 ko/cc-doc/index.html
   plus four redirect pages for the old addresses (REDIRECTS below: workflow/, guide/, ko/workflow/, ko/guide/,
   their text from moved.* of the project copy), shared assets/css/tokens.css (the kit token file, copied verbatim
   so its ACCENT fences stay), assets/site.css, assets/site.js, the KO-only assets/ko-font.css and the vendored fonts.

   Usage: node scripts/build.mjs [--out DIR] [--content-dir DIR] [--facts FILE]
     --out          output directory (default: <repo>/dist). Built in a fresh sibling temp dir and swapped
                    in only after a complete build, so a failed or killed build never leaves a half-written DIR.
                    Refused (exit 1, nothing deleted): the repo or an ancestor, .git, a source dir, $HOME, /, a
                    symlink, or an existing non-empty dir without the .cc-site-build marker every build writes.
     --content-dir  directory holding every page's copy tables (project.en.json, project.ko.json, en.json,
                    ko.json, workflow.en.json, workflow.ko.json, guide.en.json, guide.ko.json, doc.en.json,
                    doc.ko.json) and the shared copy (site.en.json, site.ko.json); default: <repo>/content
     --facts        facts file (default: <repo>/facts.json)
   Env: SITE_URL (absolute http(s) URL ending in "/"; default https://example.invalid/cc-orchestra-site/),
        used only for the two <link rel="alternate" hreflang> tags per content page (none on redirect pages).
   Exit 0 on success, 1 on any build error in any page (unknown placeholder, missing content key, leftover
   "{{", a content key present in one language only, an unknown facts path, disallowed markup in copy, a
   shared site.* key no page of a language renders, an unknown partial).

   Template language (src/project.html, src/page.html, src/workflow.html, src/guide.html, src/doc.html and
   the partials they include):
     {{t:REF}}    copy as inline HTML (only <em> <strong> <code> <br> allowed; {{f:..}} inside resolved)
     {{a:REF}}    copy as attribute-safe plain text (tags stripped)
     {{cap:REF}}  like t:, with a leading "Figure 1." / "Table 2." label wrapped in <span class="fig-label">
     {{u:REF}}    an absolute https:// URL from the copy
     {{v:REF}}    a plain value (escaped)       {{f:PATH}}  a facts value (a route renders "Model @ effort")
     {{name}}     a build variable: lang, root, otherLang, otherHref, hrefEn, hrefKo, headScript, and the
                  same-language links from this page: siteHref (project page), orchHref (cc-orch overview),
                  workflowHref, guideHref, docHref; homeHref is the old name of orchHref, still read by the
                  workflow and guide <main>
     {{> NAME}}   the partial src/partials/NAME.html, rendered in place with the caller's copy, variables,
                  view data and used-key set (an unknown NAME fails the build)
     {{#each REF}}..{{/each}}   loop; inside: "." item, ".x" item field, @i (0-based), @n (1-based)
     {{#if REF}}..{{else}}..{{/if}}   "!REF" negates; "REF?" treats a missing key as false
   REF: "a.b.0" = content path ("site.x" = shared copy), ".x" = loop item, "$x.y" = computed view data,
   "@i"/"@n"/"@first"/"@last". View data on every page: $isKo, and $nav for the shell (isProject, isOverview,
   isWorkflow, isGuide, isDoc, inOrch, and orchCurrent / docCurrent: the aria-current value of the edition
   links, "page" on that edition's overview, "true" on its other pages, "" elsewhere). */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER_URL = 'https://example.invalid/cc-orchestra-site/';
const LANGS = ['en', 'ko'];
const GATE_IDS = ['self-check', 'codex-verify', 'codex-review', 'claude-verifier'];
const GATE_FAMILY = { 'self-check': 'a', 'codex-verify': 'b', 'codex-review': 'b', 'claude-verifier': 'a' };
const DEFAULT_RISK = 'normal';
const FONT_FILES = ['SCDream4.otf', 'SCDream6.otf', 'SHA256SUMS', 'LICENSE-S-Core-Dream.txt'];
/* Every output carries this marker; an existing --out dir is replaced only if it has it (or is empty). */
const MARKER = '.cc-site-build';
const MARKER_TEXT = 'cc-orchestra-site build output (scripts/build.mjs); safe to delete with the rest of this directory\n';
const SOURCE_DIRS = ['src', 'content', 'scripts', 'fonts', 'tests', '.github', 'design'];
/* The pages. Per page: template, copy table per language (in --content-dir) and route: the page's directory
   inside each language tree ("" = the root; KO pages live under ko/). Output path, asset prefix, language
   toggle, hreflang URLs, the EN-only redirect target (koTarget = the EN toggle, see head.js) and every
   same-language link are derived from the routes (pageVars below).
   unusedOk: copy keys the page does not render on purpose; any other key no template tag reads fails the
   build. meta.langName: the page's own language name (the toggle shows the other one); footer.fontLink:
   renders only next to the KO-only font credit (empty on EN); lifecycle.tree.0.1: the overview root row's
   empty note (the root folder is shown in the panel head).
   view: the overview's computed view data (risk levels, gate cells, Viz B curves); every page gets $isKo, $nav.
   forwardFrom: the page whose rendered ids (minus this page's own) this page forwards to that page's route
   when the address has one of them as its #hash (old overview fragments on the project page, see head.js).
   moved: this page's copy holds moved.*, the text of the redirect pages. */
const PAGES = [
  {
    id: 'project',
    template: 'src/project.html',
    content: { en: 'project.en.json', ko: 'project.ko.json' },
    route: '',
    unusedOk: ['meta.langName', 'footer.fontLink'],
    view: false,
    forwardFrom: 'overview',
    moved: true
  },
  {
    id: 'overview',
    template: 'src/page.html',
    content: { en: 'en.json', ko: 'ko.json' },
    route: 'cc-orch/',
    unusedOk: ['meta.langName', 'footer.fontLink', 'lifecycle.tree.0.1'],
    view: true
  },
  {
    id: 'workflow',
    template: 'src/workflow.html',
    content: { en: 'workflow.en.json', ko: 'workflow.ko.json' },
    route: 'cc-orch/workflow/',
    unusedOk: ['meta.langName', 'footer.fontLink'],
    view: false
  },
  {
    id: 'guide',
    template: 'src/guide.html',
    content: { en: 'guide.en.json', ko: 'guide.ko.json' },
    route: 'cc-orch/guide/',
    unusedOk: ['meta.langName', 'footer.fontLink'],
    view: false
  },
  {
    id: 'doc',
    template: 'src/doc.html',
    content: { en: 'doc.en.json', ko: 'doc.ko.json' },
    route: 'cc-doc/',
    unusedOk: ['meta.langName', 'footer.fontLink'],
    view: false
  }
];
/* the cc-orch edition: its overview first; the other pages of the edition are its tabs */
const ORCH_PAGES = ['overview', 'workflow', 'guide'];
const DOC_PAGES = ['doc'];
/* Redirect pages at the old addresses of the moved pages: output, language (whose moved.* copy it shows) and
   the new address relative to the output. Each holds a meta refresh, a script that keeps ?query and #hash,
   and a visible link; no hreflang pair and no SITE_URL. */
const REDIRECTS = [
  { out: 'workflow/index.html', lang: 'en', target: '../cc-orch/workflow/' },
  { out: 'guide/index.html', lang: 'en', target: '../cc-orch/guide/' },
  { out: 'ko/workflow/index.html', lang: 'ko', target: '../cc-orch/workflow/' },
  { out: 'ko/guide/index.html', lang: 'ko', target: '../cc-orch/guide/' }
];
const REDIRECT_TEMPLATE = `<!doctype html>
<html lang="{{lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url={{target}}">
<title>{{a:moved.title}}</title>
<script>location.replace("{{target}}" + location.search + location.hash);</script>
</head>
<body>
<p>{{t:moved.text}} <a href="{{target}}">{{t:moved.link}}</a></p>
</body>
</html>
`;

class BuildError extends Error {}
function fail(msg) { throw new BuildError(msg); }

/* ---------- arguments ---------- */
function parseArgs(argv) {
  const opts = { out: path.join(REPO, 'dist'), contentDir: path.join(REPO, 'content'), facts: path.join(REPO, 'facts.json') };
  const names = { '--out': 'out', '--content-dir': 'contentDir', '--facts': 'facts' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const flag = eq > -1 ? a.slice(0, eq) : a;
    if (!Object.hasOwn(names, flag)) fail(`unknown argument: ${a}`);
    const val = eq > -1 ? a.slice(eq + 1) : argv[++i];
    if (!val) fail(`missing value for ${flag}`);
    opts[names[flag]] = path.resolve(process.cwd(), val);
  }
  return opts;
}

/* ---------- helpers ---------- */
const read = (p) => {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { fail(`cannot read ${path.relative(REPO, p) || p}: ${e.code || e.message}`); }
};
function readJson(p) {
  const s = read(p);
  try { return JSON.parse(s); } catch (e) { fail(`invalid JSON in ${p}: ${e.message}`); }
}
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;

/* Own properties only: `in` would resolve toString, constructor, ... through Object.prototype. */
function getPath(obj, segs) {
  let cur = obj;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, s)) return { found: false };
    cur = cur[s];
  }
  return { found: true, value: cur };
}

/* Same keys, same types, same array lengths in both languages. */
function compareShape(a, b, where, out) {
  if (Array.isArray(a) !== Array.isArray(b) || isObj(a) !== isObj(b) || typeof a !== typeof b) {
    out.push(`${where || '(root)'}: different type in en and ko`);
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${where}: array length ${a.length} (en) vs ${b.length} (ko)`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) compareShape(a[i], b[i], `${where}.${i}`, out);
  } else if (isObj(a)) {
    for (const k of Object.keys(a)) if (!Object.hasOwn(b, k)) out.push(`${where ? where + '.' : ''}${k}: present in en only`);
    for (const k of Object.keys(b)) if (!Object.hasOwn(a, k)) out.push(`${where ? where + '.' : ''}${k}: present in ko only`);
    for (const k of Object.keys(a)) if (Object.hasOwn(b, k)) compareShape(a[k], b[k], where ? `${where}.${k}` : k, out);
  }
}

/* [path, value] for every leaf (keys may themselves contain dots, as in _claims) */
function leaves(v, prefix, out) {
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${prefix}.${i}`, out));
  else if (isObj(v)) for (const k of Object.keys(v)) leaves(v[k], prefix ? `${prefix}.${k}` : k, out);
  else out.push([prefix, v]);
  return out;
}

function leafPaths(v, prefix, out) {
  if (Array.isArray(v)) v.forEach((x, i) => leafPaths(x, `${prefix}.${i}`, out));
  else if (isObj(v)) for (const k of Object.keys(v)) leafPaths(v[k], prefix ? `${prefix}.${k}` : k, out);
  else out.push(prefix);
  return out;
}

/* ---------- facts ---------- */
function makeFacts(facts) {
  return function fact(p) {
    const r = getPath(facts, p.split('.'));
    if (!r.found) fail(`unknown facts path: {{f:${p}}}`);
    const v = r.value;
    if (isObj(v) && typeof v.model === 'string' && typeof v.effort === 'string') return `${v.model} @ ${v.effort}`;
    if (v === null || typeof v === 'object') fail(`facts path is not a value or route: {{f:${p}}}`);
    return String(v);
  };
}

/* ---------- copy strings ---------- */
const ALLOWED_TAG = /^<\/?(em|strong|code)>$|^<br\s*\/?>$/;
const ENTITY = /^&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/;

function makeCopy(fact) {
  function resolveFacts(str, where) {
    return str.replace(/\{\{([^{}]*)\}\}/g, (m, inner) => {
      const mm = /^f:([A-Za-z0-9_.-]+)$/.exec(inner.trim());
      if (!mm) fail(`unknown placeholder ${m} in ${where}`);
      try { return escHtml(fact(mm[1])); } catch (e) { throw e instanceof BuildError ? new BuildError(`${e.message} in ${where}`) : e; }
    });
  }
  /* Inline HTML: allowed tags kept, entities kept, everything else escaped; stray "<tag>" is an error. */
  function rich(str, where) {
    if (typeof str !== 'string') fail(`${where}: expected a string`);
    const s = resolveFacts(str, where);
    if (s.includes('{{') || s.includes('}}')) fail(`leftover "{{" or "}}" in ${where}`);
    let out = '';
    const open = [];
    for (let i = 0; i < s.length;) {
      const c = s[i];
      if (c === '<') {
        const end = s.indexOf('>', i);
        const tag = end > -1 ? s.slice(i, end + 1) : '';
        if (!tag || !ALLOWED_TAG.test(tag)) fail(`disallowed markup ${JSON.stringify(s.slice(i, i + 20))} in ${where}`);
        const name = /^<\/?(\w+)/.exec(tag)[1];
        if (name !== 'br') {
          if (tag[1] === '/') {
            if (open.pop() !== name) fail(`unbalanced </${name}> in ${where}`);
          } else open.push(name);
        }
        out += tag.startsWith('<br') ? '<br>' : tag;
        i = end + 1;
      } else if (c === '&') {
        const m = ENTITY.exec(s.slice(i));
        if (m) { out += m[0]; i += m[0].length; } else { out += '&amp;'; i++; }
      } else if (c === '>') { out += '&gt;'; i++; } else if (c === '"') { out += '&quot;'; i++; } else { out += c; i++; }
    }
    if (open.length) fail(`unclosed <${open[open.length - 1]}> in ${where}`);
    return out;
  }
  function plain(str, where) {
    return rich(str, where).replace(/<br>/g, ' ').replace(/<\/?\w+>/g, '');
  }
  function caption(str, where) {
    const h = rich(str, where);
    const m = /^([^\s.<>]+\s?\d+\.)\s+/.exec(h);
    return m ? `<span class="fig-label">${m[1]}</span> ${h.slice(m[0].length)}` : h;
  }
  return { rich, plain, caption };
}

/* ---------- template ---------- */
/* name: the file the error messages name; partials: the chain of partials being parsed (no include cycle);
   at: prefix of the line numbers inside a partial ("partials/x.html:"), so an error names the partial's line */
function parseTemplate(src, name, partials = [], at = '') {
  const re = /\{\{([^{}]+)\}\}/g;
  const rootNode = { type: 'root', body: [] };
  const stack = [rootNode];
  let last = 0;
  let m;
  const cur = () => stack[stack.length - 1];
  const push = (node) => { const n = cur(); (n.inAlt ? n.alt : n.body).push(node); };
  const line = (idx) => at + src.slice(0, idx).split('\n').length;
  while ((m = re.exec(src))) {
    if (m.index > last) push({ type: 'text', value: src.slice(last, m.index) });
    last = re.lastIndex;
    const tag = m[1].trim();
    const ln = line(m.index);
    let mm;
    if ((mm = /^#each\s+(\S+)$/.exec(tag))) {
      const node = { type: 'each', ref: mm[1], body: [], line: ln };
      push(node); stack.push(node);
    } else if ((mm = /^#if\s+(\S+)$/.exec(tag))) {
      const node = { type: 'if', ref: mm[1], body: [], alt: null, inAlt: false, line: ln };
      push(node); stack.push(node);
    } else if (tag === 'else') {
      const n = cur();
      if (n.type !== 'if' || n.inAlt) fail(`${name}:${ln}: {{else}} outside {{#if}}`);
      n.alt = []; n.inAlt = true;
    } else if (tag === '/each' || tag === '/if') {
      const n = stack.pop();
      if (!n || n.type !== tag.slice(1)) fail(`${name}:${ln}: unexpected {{${tag}}}`);
    } else if ((mm = /^>\s*([a-z][a-z0-9-]*)$/.exec(tag))) {
      const file = path.join(REPO, 'src/partials', `${mm[1]}.html`);
      if (!fs.existsSync(file)) fail(`${name}:${ln}: unknown partial {{> ${mm[1]}}} (no src/partials/${mm[1]}.html)`);
      if (partials.includes(mm[1])) fail(`${name}:${ln}: partial ${mm[1]} includes itself`);
      /* without the file's final newline, so an include on its own line leaves no blank line */
      const sub = parseTemplate(read(file).replace(/\n$/, ''), name, [...partials, mm[1]], `partials/${mm[1]}.html:`);
      push({ type: 'include', body: sub.body, line: ln });
    } else if ((mm = /^(t|a|cap|u|v|f):(\S+)$/.exec(tag))) {
      push({ type: 'out', kind: mm[1], ref: mm[2], line: ln });
    } else if (/^[A-Za-z][A-Za-z0-9]*$/.test(tag)) {
      push({ type: 'var', name: tag, line: ln });
    } else {
      fail(`${name}:${ln}: unknown placeholder {{${tag}}}`);
    }
  }
  if (last < src.length) push({ type: 'text', value: src.slice(last) });
  if (stack.length !== 1) fail(`${name}: unclosed {{#${cur().type}}} from line ${cur().line}`);
  return rootNode;
}

function makeRenderer({ name, content, view, vars, copy, fact, used }) {
  /* mark = record the key as used by the page (outputs and conditions; a loop over an array does not
     count as using its items, so a key no template tag reads is reported) */
  function lookup(ref, scope, line, optional, mark = true) {
    const where = `${name}:${line}`;
    if (ref === '@i' || ref === '@n' || ref === '@first' || ref === '@last') {
      if (!scope.loop) fail(`${where}: ${ref} outside {{#each}}`);
      return { found: true, value: { '@i': scope.loop.i, '@n': scope.loop.i + 1, '@first': scope.loop.i === 0, '@last': scope.loop.last }[ref] };
    }
    if (ref === '.' || ref.startsWith('.')) {
      if (!scope.loop) fail(`${where}: "${ref}" outside {{#each}}`);
      const segs = ref === '.' ? [] : ref.slice(1).split('.');
      const r = getPath(scope.loop.item, segs);
      if (!r.found && !optional) fail(`${where}: missing content key ${scope.loop.path}${ref === '.' ? '' : ref}`);
      if (r.found && scope.loop.path && mark) used.add(`${scope.loop.path}${ref === '.' ? '' : ref}`);
      return { ...r, path: scope.loop.path ? `${scope.loop.path}${ref === '.' ? '' : ref}` : null };
    }
    if (ref.startsWith('$')) {
      const r = getPath(view, ref.slice(1).split('.'));
      if (!r.found && !optional) fail(`${where}: unknown view value ${ref}`);
      return { ...r, path: null };
    }
    const r = getPath(content, ref.split('.'));
    if (!r.found && !optional) fail(`${where}: missing content key ${ref}`);
    if (r.found && mark) used.add(ref);
    return { ...r, path: ref };
  }
  function truthy(v) { return Array.isArray(v) ? v.length > 0 : Boolean(v); }
  function render(nodes, scope) {
    let out = '';
    for (const n of nodes) {
      if (n.type === 'text') out += n.value;
      else if (n.type === 'var') {
        if (!Object.hasOwn(vars, n.name)) fail(`${name}:${n.line}: unknown build variable {{${n.name}}}`);
        out += vars[n.name];
      } else if (n.type === 'out') {
        if (n.kind === 'f') { out += escHtml(fact(n.ref)); continue; }
        const r = lookup(n.ref, scope, n.line, false);
        const where = r.path ? `content ${r.path}` : `${name}:${n.line} ${n.ref}`;
        const v = r.value;
        if (n.kind === 'v') {
          if (v !== null && typeof v === 'object') fail(`${name}:${n.line}: ${n.ref} is not a value`);
          out += escHtml(v);
        } else if (n.kind === 'u') {
          if (typeof v !== 'string' || !/^https:\/\/[A-Za-z0-9.-]+(\/[^\s"<>]*)?$/.test(v)) fail(`${where}: not an absolute https:// URL`);
          out += escHtml(v);
        } else if (n.kind === 't') out += copy.rich(v, where);
        else if (n.kind === 'a') out += copy.plain(v, where);
        else if (n.kind === 'cap') out += copy.caption(v, where);
      } else if (n.type === 'include') {
        out += render(n.body, scope);
      } else if (n.type === 'if') {
        let ref = n.ref; let neg = false; let optional = false;
        if (ref.startsWith('!')) { neg = true; ref = ref.slice(1); }
        if (ref.endsWith('?')) { optional = true; ref = ref.slice(0, -1); }
        const r = lookup(ref, scope, n.line, optional);
        const ok = r.found && truthy(r.value);
        out += render((neg ? !ok : ok) ? n.body : (n.alt || []), scope);
      } else if (n.type === 'each') {
        const r = lookup(n.ref, scope, n.line, false, false);
        if (!Array.isArray(r.value)) fail(`${name}:${n.line}: {{#each ${n.ref}}} needs an array`);
        r.value.forEach((item, i) => {
          out += render(n.body, { loop: { item, i, last: i === r.value.length - 1, path: r.path ? `${r.path}.${i}` : null }, parent: scope });
        });
      }
    }
    return out;
  }
  return render;
}

/* ---------- view data computed from facts + copy ---------- */
function buildView(content, facts, lang) {
  const rg = facts.riskGates;
  if (!isObj(rg) || !Object.keys(rg).length) fail('facts.riskGates must be a non-empty object');
  const c = (p) => {
    const r = getPath(content, p.split('.'));
    if (!r.found) fail(`missing content key ${p} (${lang})`);
    return r.value;
  };
  const cols = c('gates.cols');
  if (!Array.isArray(cols) || cols.length !== GATE_IDS.length) fail(`content gates.cols must list ${GATE_IDS.length} columns`);
  const ids = Object.keys(rg);
  if (!ids.includes(DEFAULT_RISK)) fail(`facts.riskGates has no "${DEFAULT_RISK}" entry`);
  const risks = ids.map((id, i) => {
    const g = rg[id];
    if (!Array.isArray(g.gates) || !g.gates.every((x) => GATE_IDS.includes(x))) fail(`facts.riskGates.${id}.gates: unknown gate id (known: ${GATE_IDS.join(', ')})`);
    const route = facts.claude && facts.claude[g.lead];
    if (!isObj(route) || !route.model || !route.effort) fail(`facts.riskGates.${id}.lead "${g.lead}" is not a facts.claude route`);
    return {
      id,
      level: i + 1,
      isDefault: id === DEFAULT_RISK,
      profile: String(g.leadProfile),
      lead: `${route.model} @ ${route.effort}`,
      gates: g.gates.join(' '),
      label: c(`arch.risks.${id}`),
      leadText: c(`arch.leadByRisk.${id}`),
      gateCaption: c(`arch.gateCaption.${id}`),
      gateText: c(`routing.gateText.${id}`),
      cells: GATE_IDS.map((gid, ci) => ({ id: gid, on: g.gates.includes(gid), fam: GATE_FAMILY[gid], label: cols[ci] }))
    };
  });
  const def = {};
  GATE_IDS.forEach((gid) => { def[gid] = rg[DEFAULT_RISK].gates.includes(gid); });
  const gateCols = GATE_IDS.map((gid, ci) => ({ id: gid, fam: GATE_FAMILY[gid], label: cols[ci] }));

  /* Viz B: one curve per Claude role to the Codex item with the same role (rows are equal height). */
  const cl = c('providers.claude');
  const cx = c('providers.codex');
  if (!Array.isArray(cl) || !Array.isArray(cx)) fail('content providers.claude / providers.codex must be arrays');
  const rows = Math.max(cl.length, cx.length);
  const links = [];
  cl.forEach((item, i) => {
    const j = cx.findIndex((x) => x.role === item.role);
    if (j < 0) { console.warn(`WARN providers.claude.${i}: no Codex item with role "${item.role}" (no link drawn)`); return; }
    const y1 = 50 + 100 * i;
    const y2 = 50 + 100 * j;
    links.push({ role: item.role, d: `M0 ${y1} C55 ${y1} 45 ${y2} 100 ${y2}` });
  });
  return { risks, def, gateCols, vb: { h: rows * 100, links }, isKo: lang === 'ko' };
}

/* ---------- assets ---------- */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n') + '\n';
}
/* head.js carries three marked blocks: the EN-only language redirect, the KO-only font switch and the
   project-only forwarder of old overview fragments.
   koTarget: the EN page's KO twin, written over the "ko/" string after the @ko-target marker.
   forward: null on every page but the project pages (the block is dropped), else the ids to forward, written
   over the [] after the @old-ids marker. */
const KO_TARGET = '/* @ko-target */"ko/"';
const OLD_IDS = '/* @old-ids */[]';
function headScript(lang, koTarget, forward) {
  let js = read(path.join(REPO, 'src/js/head.js'));
  if (js.split(KO_TARGET).length !== 2) fail(`src/js/head.js: expected exactly one ${KO_TARGET} in the EN-only block`);
  if (js.split(OLD_IDS).length !== 2) fail(`src/js/head.js: expected exactly one ${OLD_IDS} in the project-only block`);
  js = js.replace(KO_TARGET, () => JSON.stringify(koTarget));
  js = js.replace(OLD_IDS, () => JSON.stringify(forward || []));
  const blocks = LANGS.map((l) => [`${l}-only`, lang === l]).concat([['project-only', forward !== null]]);
  for (const [b, keep] of blocks) {
    const re = new RegExp(`/\\* @${b} \\*/[\\s\\S]*?/\\* @end-${b} \\*/`);
    if (!re.test(js)) fail(`src/js/head.js: missing the /* @${b} */ ... /* @end-${b} */ block`);
    if (!keep) js = js.replace(re, '');
  }
  js = js.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  if (/<\/script/i.test(js)) fail('src/js/head.js must not contain "</script"');
  return js;
}

function siteUrl() {
  const u = process.env.SITE_URL === undefined || process.env.SITE_URL === '' ? PLACEHOLDER_URL : process.env.SITE_URL;
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?\/([A-Za-z0-9._~-]+\/)*$/.test(u)) fail(`SITE_URL must be an absolute http(s) URL ending in "/" (got ${JSON.stringify(u)})`);
  return u;
}

/* Every copy string in both files is validated (placeholders against facts.json, inline markup), whether or not
   a template renders it. _claims/_nonclaims hold ids and key patterns, not copy, but may still carry no placeholder. */
function validateCopy(content, files, copy) {
  for (const l of LANGS) {
    for (const [k, v] of leaves(content[l], '', [])) {
      if (typeof v !== 'string') continue;
      if (k.startsWith('_')) {
        if (/\{\{|\}\}/.test(v)) fail(`placeholder in ${files[l]} ${k}: ${JSON.stringify(v)}`);
      } else copy.rich(v, `${files[l]} ${k}`);
    }
  }
}

/* Per page and language: output path, hreflang suffixes, koTarget and the build variables, from the routes.
   KO pages sit one level deeper (ko/). Links between pages stay inside the page's language tree. */
function pageVars(pg, l, byId) {
  const depth = pg.route.split('/').filter(Boolean).length;
  const up = '../'.repeat(depth);
  const isEn = l === 'en';
  const rel = (id) => {
    const r = path.posix.relative(`/${pg.route}`, `/${byId[id].route}`);
    return r === '' ? './' : `${r}/`;
  };
  const other = isEn ? `${up}ko/${pg.route}` : `../${up}${pg.route}?lang=en`;
  return {
    out: `${isEn ? '' : 'ko/'}${pg.route}index.html`,
    href: { en: pg.route, ko: `ko/${pg.route}` },
    koTarget: `${up}ko/${pg.route}`,
    vars: {
      lang: l,
      root: isEn ? up : `../${up}`,
      otherLang: isEn ? 'ko' : 'en',
      otherHref: other,
      siteHref: rel('project'),
      orchHref: rel('overview'),
      homeHref: rel('overview'),
      workflowHref: rel('workflow'),
      guideHref: rel('guide'),
      docHref: rel('doc')
    }
  };
}

/* $nav: which page and which edition is current, for the shell (aria-current) */
function navView(id) {
  const inOrch = ORCH_PAGES.includes(id);
  const inDoc = DOC_PAGES.includes(id);
  return {
    isProject: id === 'project', isOverview: id === 'overview', isWorkflow: id === 'workflow', isGuide: id === 'guide', isDoc: id === 'doc',
    inOrch,
    orchCurrent: id === ORCH_PAGES[0] ? 'page' : inOrch ? 'true' : '',
    docCurrent: id === DOC_PAGES[0] ? 'page' : inDoc ? 'true' : ''
  };
}

/* every id="..." of a rendered page, in document order */
function htmlIds(html) {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
}

/* ---------- build ---------- */
function build(opts, outDir) {
  const SITE = siteUrl();
  const facts = readJson(opts.facts);
  const fact = makeFacts(facts);
  const copy = makeCopy(fact);

  const tokensCss = read(path.join(REPO, 'src/css/tokens.css'));
  const css = ['base.css', 'site.css', 'workflow.css'].map((f) => `/* ${f} */\n` + read(path.join(REPO, 'src/css', f))).join('\n');
  const siteCss = stripCssComments(css);
  const koCss = stripCssComments(read(path.join(REPO, 'src/css/ko-font.css')));
  const siteJs = ['kit.js', 'viz.js', 'loop.js'].map((f) => read(path.join(REPO, 'src/js', f))).join('\n');
  if (/SCDream/.test(siteCss)) fail('site.css must not contain "SCDream" (it belongs in ko-font.css only)');
  if (/SCDream/.test(tokensCss)) fail('tokens.css must not contain "SCDream" (it belongs in ko-font.css only)');
  if (/SCDream/.test(siteJs)) fail('site.js must not contain "SCDream"');
  if (!/SCDream/.test(koCss)) fail('ko-font.css does not declare the SCDream family');
  if (/\{\{/.test(tokensCss + siteCss + siteJs + koCss)) fail('leftover "{{" in CSS or JS');

  /* shared copy: one table per language, validated like page copy; every site.* key must be rendered by some
     page of that language */
  const siteCopy = {};
  for (const l of LANGS) {
    siteCopy[l] = readJson(path.join(opts.contentDir, `site.${l}.json`));
    if (!isObj(siteCopy[l].site)) fail(`content/site.${l}.json: expected a top-level "site" object`);
  }
  const siteDiffs = [];
  compareShape(siteCopy.en, siteCopy.ko, '', siteDiffs);
  if (siteDiffs.length) fail(['content/site.en.json and content/site.ko.json differ in shape:', ...siteDiffs.slice(0, 40)].join('\n  '));
  validateCopy(siteCopy, { en: 'site.en.json', ko: 'site.ko.json' }, copy);
  const siteUsed = { en: new Set(), ko: new Set() };

  const byId = Object.fromEntries(PAGES.map((pg) => [pg.id, pg]));
  const redirectTree = parseTemplate(REDIRECT_TEMPLATE, 'redirect page');
  const pageOut = {};
  const redirectOut = [];
  /* a page that forwards to another page's ids is rendered after it */
  for (const pg of [...PAGES.filter((p) => !p.forwardFrom), ...PAGES.filter((p) => p.forwardFrom)]) {
    const content = {};
    for (const l of LANGS) content[l] = readJson(path.join(opts.contentDir, pg.content[l]));
    const diffs = [];
    compareShape(content.en, content.ko, '', diffs);
    if (diffs.length) fail(`content/${pg.content.en} and content/${pg.content.ko} differ in shape:\n  ${diffs.slice(0, 40).join('\n  ')}`);
    for (const l of LANGS) if (Object.hasOwn(content[l], 'site')) fail(`${pg.content[l]}: the key "site" is reserved for the shared copy`);
    validateCopy(content, pg.content, copy);
    const name = path.basename(pg.template);
    const tree = parseTemplate(read(path.join(REPO, pg.template)), name);

    pageOut[pg.id] = {};
    for (const l of LANGS) {
      const isEn = l === 'en';
      const v = pageVars(pg, l, byId);
      const view = pg.view ? buildView(content[l], facts, l) : { isKo: l === 'ko' };
      view.nav = navView(pg.id);
      const renderPage = (forward) => {
        const used = new Set();
        const vars = { ...v.vars, hrefEn: escHtml(SITE + v.href.en), hrefKo: escHtml(SITE + v.href.ko), headScript: headScript(l, v.koTarget, forward) };
        if (pg.view) {
          ['arch.risks', 'arch.leadByRisk', 'arch.gateCaption', 'routing.gateText', 'gates.cols', 'providers.claude', 'providers.codex']
            .forEach((p) => leafPaths(getPath(content[l], p.split('.')).value, p, []).forEach((k) => used.add(k)));
        }
        const render = makeRenderer({ name, content: { ...content[l], site: siteCopy[l].site }, view, vars, copy, fact, used });
        return { html: render(tree.body, {}), used };
      };
      let { html, used } = renderPage(pg.forwardFrom ? [] : null);
      if (pg.forwardFrom) {
        /* old fragments: every id of the other page's rendered output (the same in both languages) that this page
           does not use itself */
        const own = new Set(htmlIds(html));
        const from = pageOut[pg.forwardFrom];
        if (!from) fail(`${pg.id}: forwardFrom ${pg.forwardFrom} is not a page rendered before it`);
        const fromIds = htmlIds(from[l].html);
        if (JSON.stringify([...new Set(htmlIds(from.en.html))].sort()) !== JSON.stringify([...new Set(htmlIds(from.ko.html))].sort())) {
          fail(`${pg.forwardFrom}: the EN and KO pages carry different ids, so the forward list of ${pg.id} would differ`);
        }
        ({ html, used } = renderPage([...new Set(fromIds)].filter((id) => !own.has(id))));
      }
      if (/\{\{|\}\}/.test(html)) {
        const i = html.search(/\{\{|\}\}/);
        fail(`leftover "{{" in ${v.out} near ${JSON.stringify(html.slice(Math.max(0, i - 40), i + 40))}`);
      }
      if (isEn && /SCDream/.test(html)) fail(`the EN page ${v.out} must not contain "SCDream"`);
      const siteCount = html.split(SITE).length - 1;
      if (siteCount !== 2) fail(`${v.out}: expected SITE_URL exactly twice (hreflang pair), found ${siteCount}`);
      if (pg.moved) {
        /* the redirect pages of this language, from this page's moved.* copy */
        for (const r of REDIRECTS.filter((x) => x.lang === l)) {
          if (!/^(\.\.\/)+[a-z0-9-]+(\/[a-z0-9-]+)*\/$/.test(r.target)) fail(`redirect ${r.out}: target ${JSON.stringify(r.target)} is not a relative directory URL`);
          const render = makeRenderer({ name: `redirect page ${r.out}`, content: content[l], view: {}, vars: { lang: l, target: r.target }, copy, fact, used });
          const rhtml = render(redirectTree.body, {});
          if (rhtml.includes(SITE)) fail(`${r.out}: a redirect page must not contain SITE_URL`);
          redirectOut.push([r.out, rhtml]);
        }
      }
      /* unused copy is an error, so a key the template never reads cannot carry an unchecked claim */
      for (const k of used) if (k.startsWith('site.')) siteUsed[l].add(k);
      const unused = leafPaths(content[l], '', []).filter((k) => !k.startsWith('_') && !pg.unusedOk.includes(k) && !used.has(k));
      if (unused.length) fail(`${pg.content[l]}: copy keys the template never uses: ${unused.join(', ')}`);
      pageOut[pg.id][l] = { out: v.out, html };
    }
  }
  for (const l of LANGS) {
    const unused = leafPaths(siteCopy[l].site, 'site', []).filter((k) => !siteUsed[l].has(k));
    if (unused.length) fail(`site.${l}.json: copy keys no page renders: ${unused.join(', ')}`);
  }
  const outputs = [];
  for (const pg of PAGES) for (const l of LANGS) outputs.push([pageOut[pg.id][l].out, pageOut[pg.id][l].html]);
  if (REDIRECTS.some((r) => !redirectOut.some(([o]) => o === r.out))) fail('a redirect page was not written (no page has moved: true)');
  outputs.push(...redirectOut);

  const w = (rel, data) => {
    const p = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  };
  for (const [rel, html] of outputs) w(rel, html);
  w('assets/css/tokens.css', tokensCss);
  w('assets/site.css', siteCss);
  w('assets/ko-font.css', koCss);
  w('assets/site.js', siteJs);
  for (const f of FONT_FILES) w(`fonts/ko/${f}`, fs.readFileSync(path.join(REPO, 'fonts/ko', f)));
  for (const f of fs.readdirSync(path.join(REPO, 'src/static'))) w(f, fs.readFileSync(path.join(REPO, 'src/static', f)));
  w('.nojekyll', '');
  w(MARKER, MARKER_TEXT);

  const report = [
    ...outputs, ['assets/css/tokens.css', tokensCss], ['assets/site.css', siteCss], ['assets/ko-font.css', koCss], ['assets/site.js', siteJs]
  ].map(([n, d]) => `  ${n.padEnd(32)} ${String(Buffer.byteLength(d)).padStart(7)} B  gz ${String(gz(Buffer.from(d))).padStart(6)} B`);
  return { report, site: SITE };
}

/* realpath of the nearest existing ancestor, plus the segments that do not exist yet */
function realish(p) {
  const rest = [];
  let cur = path.resolve(p);
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const up = path.dirname(cur);
      if (up === cur) throw e;
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}
const within = (child, dir) => child === dir || child.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/* Refuse any --out that could delete something that is not a previous build output.
   Runs before the build writes or deletes anything. */
function checkOut(out) {
  const real = realish(out);
  const repo = fs.realpathSync(REPO);
  const home = (() => { try { return fs.realpathSync(os.homedir()); } catch (e) { return path.resolve(os.homedir()); } })();
  const why =
    real === path.parse(real).root ? 'it is the filesystem root'
    : real === home ? 'it is the home directory'
    : within(repo, real) ? 'it is the repository or one of its ancestors'
    : within(real, path.join(repo, '.git')) ? 'it is inside .git'
    : SOURCE_DIRS.some((d) => within(real, path.join(repo, d))) ? `it is inside a source directory (${SOURCE_DIRS.join(', ')})`
    : null;
  if (why) fail(`refusing --out ${out}: ${why}`);
  let st = null;
  try { st = fs.lstatSync(out); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!st) return;
  if (st.isSymbolicLink()) fail(`refusing --out ${out}: it is a symbolic link`);
  if (!st.isDirectory()) fail(`refusing --out ${out}: it exists and is not a directory`);
  const entries = fs.readdirSync(out);
  if (!entries.length) return;
  let mark = null;
  try {
    const ms = fs.lstatSync(path.join(out, MARKER));
    if (ms.isFile()) mark = fs.readFileSync(path.join(out, MARKER), 'utf8');
  } catch (e) { /* no marker */ }
  if (mark !== MARKER_TEXT) fail(`refusing --out ${out}: it exists, is not empty and has no ${MARKER} marker, so it is not a previous build output (nothing was deleted; remove it yourself or choose another directory)`);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    checkOut(opts.out);
  } catch (e) { console.error(`build: ${e instanceof BuildError ? 'FAILED: ' : ''}${e.message}`); process.exit(1); }
  const out = opts.out;
  const parent = path.dirname(out);
  fs.mkdirSync(parent, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(parent, `.${path.basename(out)}.tmp-`));
  const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ } };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(1); });
  let res;
  try {
    res = build(opts, tmp);
  } catch (e) {
    cleanup();
    console.error(e instanceof BuildError ? `build: FAILED: ${e.message}` : e);
    process.exit(1);
  }
  let old = null;
  try {
    if (fs.existsSync(out)) {
      old = `${out}.old-${process.pid}`;
      fs.renameSync(out, old);
    }
    fs.renameSync(tmp, out);
  } catch (e) {
    cleanup();
    if (old && !fs.existsSync(out)) fs.renameSync(old, out);
    console.error(`build: FAILED: cannot replace ${out}: ${e.message}`);
    process.exit(1);
  }
  if (old) fs.rmSync(old, { recursive: true, force: true });
  console.log(`build: OK -> ${path.relative(process.cwd(), out) || out}  (SITE_URL ${res.site}${res.site === PLACEHOLDER_URL ? ', placeholder' : ''})`);
  console.log(res.report.join('\n'));
}

main();
