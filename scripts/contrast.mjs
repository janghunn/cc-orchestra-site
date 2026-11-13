// WCAG 2.x contrast over the theme tokens, light and dark.
// Reads the light block (":root") and the dark block (':root[data-theme="dark"]') of src/css/tokens.css
// (plus any custom properties the other src/css files define in the same two selectors), then checks:
//  - the Paper & Lamp kit's text/UI token pairs (BASE below), and
//  - every pair found in src/css/*.css: a rule that sets `color: <token>` is paired with its own
//    background if it sets one, else with each page surface (bg, surface).
// Text needs 4.5:1; large text and UI indicators (focus ring, control borders) need 3:1.
// Translucent colours and color-mix() are composited over the pair's background.
// Exit 0 = all PASS, 1 = a FAIL or no tokens. Usage: node scripts/contrast.mjs [--tokens FILE] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ti = args.indexOf('--tokens');
const TOKENS = ti >= 0 ? path.resolve(args[ti + 1]) : path.join(ROOT, 'src/css/tokens.css');
const QUIET = args.includes('--quiet');
const CSS_DIR = path.dirname(TOKENS);

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// flat rule list: {sel, body, media}
function rules(css) {
  const out = [];
  const src = stripComments(css);
  let i = 0;
  const stack = [];
  let start = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      stack.push({ sel: src.slice(start, i).trim(), at: i + 1 });
      start = i + 1;
    } else if (ch === '}') {
      const top = stack.pop();
      if (!top) continue;
      const body = src.slice(top.at, i);
      if (!body.includes('{')) {
        const media = stack.map((s) => s.sel).filter((s) => s.startsWith('@')).join(' ');
        out.push({ sel: top.sel, body, media });
      }
      start = i + 1;
    } else if (ch === ';' && stack.length === 0) {
      start = i + 1;
    }
  }
  return out;
}

function decls(body) {
  const m = new Map();
  for (const part of body.split(';')) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    m.set(part.slice(0, k).trim().toLowerCase(), part.slice(k + 1).trim());
  }
  return m;
}

const LIGHT_SEL = /^:root$/;
const DARK_SEL = /^:root\[data-theme=["']?dark["']?\]$/;

function collectTokens(files) {
  const light = new Map();
  const dark = new Map();
  const mediaDark = new Map();
  for (const f of files) {
    for (const r of rules(fs.readFileSync(f, 'utf8'))) {
      const sels = r.sel.split(',').map((s) => s.trim());
      for (const [k, v] of decls(r.body)) {
        if (!k.startsWith('--')) continue;
        const name = k.slice(2);
        if (!r.media && sels.some((s) => LIGHT_SEL.test(s))) light.set(name, v);
        if (!r.media && sels.some((s) => DARK_SEL.test(s))) dark.set(name, v);
        if (/prefers-color-scheme:\s*dark/.test(r.media) && sels.some((s) => /^:root:not\(\[data-theme\]\)$/.test(s))) mediaDark.set(name, v);
      }
    }
  }
  return { light, dark, mediaDark };
}

// ---- colour maths ---------------------------------------------------------------------------------
function parseHex(h) {
  let s = h.slice(1);
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return null;
  const n = (i) => parseInt(s.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) / 255 : 1 };
}
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const mix = (c1, c2, p) => ({
  r: c1.r * p + c2.r * (1 - p),
  g: c1.g * p + c2.g * (1 - p),
  b: c1.b * p + c2.b * (1 - p),
  a: c1.a * p + c2.a * (1 - p),
});
// returns {r,g,b,a} or null (unresolvable)
function resolve(expr, theme, depth = 0) {
  if (expr == null || depth > 20) return null;
  let e = expr.trim().replace(/\s*!important$/, '');
  if (/^#[0-9a-f]+$/i.test(e)) return parseHex(e);
  if (/^transparent$/i.test(e)) return { r: 0, g: 0, b: 0, a: 0 };
  if (/^(white|#fff)$/i.test(e)) return { r: 255, g: 255, b: 255, a: 1 };
  if (/^black$/i.test(e)) return { r: 0, g: 0, b: 0, a: 1 };
  let m = /^var\(\s*--([a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i.exec(e);
  if (m) {
    const v = theme.get(m[1]);
    return v != null ? resolve(v, theme, depth + 1) : m[2] ? resolve(m[2], theme, depth + 1) : null;
  }
  m = /^rgba?\((.+)\)$/i.exec(e);
  if (m) {
    const parts = m[1].includes(',') ? m[1].split(',') : m[1].replace('/', ' ').split(/\s+/);
    const p = parts.map((x) => x.trim()).filter(Boolean);
    if (p.length < 3) return null;
    const num = (x) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x));
    const a = p[3] == null ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    return { r: num(p[0]), g: num(p[1]), b: num(p[2]), a };
  }
  m = /^color-mix\(\s*in\s+srgb\s*,(.+)\)$/i.exec(e);
  if (m) {
    const [a, b] = splitTop(m[1]);
    if (!a || !b) return null;
    const pa = /\s([0-9.]+)%$/.exec(a);
    const pb = /\s([0-9.]+)%$/.exec(b);
    const ca = resolve(a.replace(/\s[0-9.]+%$/, ''), theme, depth + 1);
    const cb = resolve(b.replace(/\s[0-9.]+%$/, ''), theme, depth + 1);
    if (!ca || !cb) return null;
    let p1 = pa ? parseFloat(pa[1]) / 100 : null;
    const p2 = pb ? parseFloat(pb[1]) / 100 : null;
    if (p1 == null) p1 = p2 == null ? 0.5 : 1 - p2;
    return mix(ca, cb, p1);
  }
  return null;
}
const over = (fg, bg) => (fg.a >= 1 ? fg : mix({ ...fg, a: 1 }, bg, fg.a));
function lum({ r, g, b }) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fgExpr, bgExpr, theme) {
  const page = resolve('var(--bg)', theme) || { r: 255, g: 255, b: 255, a: 1 };
  let bg = resolve(bgExpr, theme);
  let fg = resolve(fgExpr, theme);
  if (!bg || !fg) return null;
  bg = over(bg, over(page, { r: 255, g: 255, b: 255, a: 1 }));
  fg = over(fg, bg);
  const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// ---- pairs --------------------------------------------------------------------------------------
const T = 4.5;
const U = 3;
const v = (n) => `var(--${n})`;
const BASE = [];
for (const s of ['bg', 'surface']) {
  for (const f of ['ink', 'muted', 'accent', 'accent-strong', 'compare-text', 'warn-text']) BASE.push([`${f} on ${s}`, v(f), v(s), T, 'text']);
  BASE.push([`focus ring vs ${s}`, v('focus'), v(s), U, 'ui']);
  BASE.push([`control border vs ${s}`, v('control'), v(s), U, 'ui']);
  BASE.push([`accent mark vs ${s}`, v('accent'), v(s), U, 'ui']);
  BASE.push([`compare-text mark vs ${s}`, v('compare-text'), v(s), U, 'ui']);
}
for (const f of ['ink', 'muted']) BASE.push([`${f} on code-bg`, v(f), v('code-bg'), T, 'text']);
for (const b of ['accent-tint', 'accent-soft', 'compare-tint', 'warn-fill']) BASE.push([`ink on ${b}`, v('ink'), v(b), T, 'text']);
for (const f of ['accent-strong', 'accent']) BASE.push([`${f} on accent-tint`, v(f), v('accent-tint'), T, 'text']);
BASE.push(['compare-text on compare-tint', v('compare-text'), v('compare-tint'), T, 'text']);
BASE.push(['on-accent on accent', v('on-accent'), v('accent'), T, 'text']);
BASE.push(['on-accent on accent-strong (primary hover)', v('on-accent'), v('accent-strong'), T, 'text']);
BASE.push(['on-band on band', v('on-band'), v('band'), T, 'text']);
BASE.push(['warn-text on warn-fill', v('warn-text'), v('warn-fill'), T, 'text']);
BASE.push(['surface on ink (selected control)', v('surface'), v('ink'), T, 'text']);
BASE.push(['on-media on media-bg', v('on-media'), v('media-bg'), T, 'text']);

// custom properties set on components (not :root), e.g. a per-family colour: name -> Set of values
function localVars(files) {
  const m = new Map();
  for (const f of files) {
    for (const r of rules(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'))) {
      if (/^:root/.test(r.sel)) continue;
      for (const [k, val] of decls(r.body)) {
        if (!k.startsWith('--')) continue;
        if (!m.has(k.slice(2))) m.set(k.slice(2), new Set());
        m.get(k.slice(2)).add(val);
      }
    }
  }
  return m;
}
// expand var(--x) of a component-scoped property into each value it is given
function expand(expr, locals) {
  const m = /var\(\s*--([a-z0-9-]+)\s*\)/i.exec(expr);
  if (!m || !locals.has(m[1])) return [[expr, '']];
  return [...locals.get(m[1])].map((v) => [expr.replace(m[0], v), ` [--${m[1]}: ${v}]`]);
}

function sitePairs() {
  const out = [];
  if (!fs.existsSync(CSS_DIR)) return out;
  const files = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css') && path.join(CSS_DIR, f) !== TOKENS);
  const locals = localVars(files);
  for (const f of files) {
    for (const r of rules(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'))) {
      if (r.sel.startsWith('@') || /prefers-color-scheme/.test(r.media) || /^:root/.test(r.sel)) continue;
      const d = decls(r.body);
      const fg = d.get('color');
      if (!fg || !/var\(--|#|rgb|color-mix/.test(fg) || /currentcolor|inherit/i.test(fg)) continue;
      const bgRaw = d.get('background-color') ?? d.get('background');
      const bg = bgRaw && !/gradient|url\(|none|inherit/i.test(bgRaw) ? bgRaw : null;
      const sel = r.sel.replace(/\s+/g, ' ').slice(0, 60);
      for (const [fgx, note] of expand(fg, locals)) {
        if (bg) for (const [bgx, n2] of expand(bg, locals)) out.push([`${f}: ${sel}${note}${n2}`, fgx, bgx, T, 'text']);
        else for (const s of ['bg', 'surface']) out.push([`${f}: ${sel}${note} (on ${s})`, fgx, v(s), T, 'text']);
      }
    }
  }
  return out;
}

if (!fs.existsSync(TOKENS)) {
  console.log(`contrast: FAIL (tokens file not found: ${path.relative(ROOT, TOKENS)})`);
  process.exit(1);
}
const cssFiles = [TOKENS, ...(fs.existsSync(CSS_DIR) ? fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css')).map((f) => path.join(CSS_DIR, f)) : [])];
const { light, dark, mediaDark } = collectTokens([...new Set(cssFiles)]);
let failures = 0;
let unresolved = 0;
let checked = 0;
if (light.size === 0 || dark.size === 0) {
  console.log(`contrast: FAIL (light tokens ${light.size}, dark tokens ${dark.size})`);
  process.exit(1);
}
const lines = [];
for (const [name, val] of dark) {
  if (mediaDark.size && mediaDark.has(name) && mediaDark.get(name).replace(/\s+/g, '') !== val.replace(/\s+/g, '')) {
    lines.push(`FAIL dark media-query copy differs from [data-theme=dark] for --${name}`);
    failures++;
  }
}
const pairs = [...BASE, ...sitePairs()];
const seen = new Set();
lines.push('theme | pair | ratio | min | result');
for (const [label, fg, bg, min, kind] of pairs) {
  for (const [tname, theme] of [['light', light], ['dark', new Map([...light, ...dark])]]) {
    const key = `${tname}|${fg}|${bg}|${min}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = ratio(fg, bg, theme);
    if (r == null) {
      unresolved++;
      lines.push(`${tname} | ${label} [${kind}] | n/a | ${min}:1 | UNRESOLVED`);
      continue;
    }
    checked++;
    const ok = r + 1e-9 >= min;
    if (!ok) failures++;
    lines.push(`${tname} | ${label} [${kind}] | ${r.toFixed(2)}:1 | ${min}:1 | ${ok ? 'PASS' : 'FAIL'}`);
  }
}
if (!QUIET) console.log(lines.join('\n'));
else for (const l of lines) if (/FAIL|UNRESOLVED/.test(l)) console.log(l);
console.log(`contrast: ${failures ? 'FAIL' : 'PASS'} (${checked} pair checks, ${failures} below minimum, ${unresolved} unresolved)`);
process.exit(failures ? 1 : 0);
