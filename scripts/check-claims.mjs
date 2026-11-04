// Claim coverage check for the content sets and content/claims.md.
// Content sets (each an EN + KO pair): content/{en,ko}.json (home) and content/workflow.{en,ko}.json (workflow).
// Per set:
// - every leaf string key of both content files is covered by _claims or _nonclaims
//   (pattern = exact key (covers its subtree), "prefix.*" (below prefix), "*.leaf" (that name in any section));
// - both files have the same leaf keys, array lengths and the same _claims / _nonclaims;
// - every pattern matches some key of that set; every id used in _claims exists in claims.md.
// Across sets: every claims.md id is used by some set.
// Every claims.md source cell is "framing", a URL, "observation: <text>" (the whole cell, not split),
// or "; "-separated tokens, each one of
//   path:line[-line]@<sourceSha>                     a file of the cc-orchestra repository at facts.sourceSha
//   ws:<alias>/<path>:line[-line]@<YYYY-MM-DD>       a file inside a research workspace, read on that date
// Optional: CLAIMS_SOURCE_REPO=<git checkout of the source repo> also checks that each cited file
// exists at <sourceSha> and the cited lines are within it.
// Optional: CLAIMS_WORKSPACE_ROOTS=<TSV file, "alias<TAB>dir" per line, # comments> also checks every
// ws: citation: unknown alias, missing file or a range past the end of the file fails. Alias "site" is
// this repository and is always checked; without the variable the other aliases are checked for format only.
// Exit 0 = PASS, 1 = FAIL. Usage: node scripts/check-claims.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (m) => errors.push(m);
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const SETS = [
  { name: 'home', en: 'content/en.json', ko: 'content/ko.json' },
  { name: 'workflow', en: 'content/workflow.en.json', ko: 'content/workflow.ko.json' },
];
const facts = readJson('facts.json');
const SHA = facts.sourceSha;
if (!/^[0-9a-f]{7,40}$/.test(String(SHA))) fail(`facts.json sourceSha is not a commit id: ${SHA}`);

// leaf keys, arrays indexed with ".N"
function leaves(obj, prefix = '', out = new Map()) {
  if (Array.isArray(obj)) obj.forEach((v, i) => leaves(v, `${prefix}.${i}`, out));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (!prefix && (k === '_claims' || k === '_nonclaims')) continue;
      leaves(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else out.set(prefix, obj);
  return out;
}

function matches(pattern, key) {
  if (pattern.startsWith('*.')) {
    const leaf = pattern.slice(2);
    const segs = key.split('.');
    return segs.slice(1).includes(leaf);
  }
  if (pattern.endsWith('.*')) return key.startsWith(pattern.slice(0, -1));
  return key === pattern || key.startsWith(pattern + '.');
}

function validPattern(p) {
  if (p.startsWith('*.')) return /^\*\.[A-Za-z0-9_]+$/.test(p);
  return /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*(\.\*)?$/.test(p);
}

// claims.md table
const md = fs.readFileSync(path.join(ROOT, 'content/claims.md'), 'utf8');
const rows = new Map();
for (const line of md.split('\n')) {
  if (!/^\|\s*[A-Z][0-9]{2,}\s*\|/.test(line)) continue;
  const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
  const id = cells[0];
  if (rows.has(id)) fail(`duplicate claims.md id: ${id}`);
  if (cells.length < 3) fail(`claims.md row ${id}: expected at least 3 cells`);
  rows.set(id, { text: cells[1] || '', source: cells[2] || '' });
}
if (rows.size === 0) fail('claims.md has no claim rows');

const used = new Set();
const perSet = [];
let totalKeys = 0;
for (const set of SETS) {
  const missing = [set.en, set.ko].filter((p) => !fs.existsSync(path.join(ROOT, p)));
  if (missing.length) {
    fail(`${set.name}: content file(s) missing: ${missing.join(', ')}`);
    continue;
  }
  const en = readJson(set.en);
  const ko = readJson(set.ko);
  const enLeaves = leaves(en);
  const koLeaves = leaves(ko);
  for (const k of enLeaves.keys()) if (!koLeaves.has(k)) fail(`key only in ${set.en}: ${k}`);
  for (const k of koLeaves.keys()) if (!enLeaves.has(k)) fail(`key only in ${set.ko}: ${k}`);
  for (const [k, v] of [...enLeaves, ...koLeaves]) {
    if (typeof v !== 'string') fail(`${set.name}: leaf is not a string: ${k} (${typeof v})`);
  }
  if (JSON.stringify(en._claims) !== JSON.stringify(ko._claims)) fail(`_claims differ between ${set.en} and ${set.ko}`);
  if (JSON.stringify(en._nonclaims) !== JSON.stringify(ko._nonclaims)) fail(`_nonclaims differ between ${set.en} and ${set.ko}`);

  const claims = en._claims || {};
  const nonclaims = en._nonclaims || [];
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) fail(`${set.name}: _claims must be an object`);
  if (!Array.isArray(nonclaims)) fail(`${set.name}: _nonclaims must be an array`);
  for (const p of [...Object.keys(claims), ...nonclaims]) if (!validPattern(p)) fail(`${set.name}: bad key pattern: ${p}`);

  const allKeys = new Set([...enLeaves.keys(), ...koLeaves.keys()]);
  for (const k of allKeys) {
    const c = Object.keys(claims).some((p) => matches(p, k));
    const n = nonclaims.some((p) => matches(p, k));
    if (!c && !n) fail(`${set.name}: leaf key in neither _claims nor _nonclaims: ${k}`);
  }
  for (const p of [...Object.keys(claims), ...nonclaims]) {
    if (![...allKeys].some((k) => matches(p, k))) fail(`${set.name}: pattern matches no key: ${p}`);
  }
  for (const [p, ids] of Object.entries(claims)) {
    if (!Array.isArray(ids) || ids.length === 0) fail(`${set.name}: _claims["${p}"] must be a non-empty id array`);
    for (const id of ids || []) {
      used.add(id);
      if (!rows.has(id)) fail(`${set.name}: _claims["${p}"] uses id ${id}, which is not in claims.md`);
    }
  }
  totalKeys += allKeys.size;
  perSet.push(`${set.name} ${allKeys.size}`);
}
for (const id of rows.keys()) if (!used.has(id)) fail(`claims.md id ${id} is not used in _claims of any content set`);

// cc-orchestra citations
const CITE = new RegExp(`^([A-Za-z0-9_./-]+):([0-9]+)(?:-([0-9]+))?@${SHA}$`);
const repo = process.env.CLAIMS_SOURCE_REPO;
const lineCount = new Map();
const countLines = (body) => body.split('\n').length - (body.endsWith('\n') ? 1 : 0);
function linesAt(file) {
  if (!lineCount.has(file)) {
    try {
      const body = execFileSync('git', ['-C', repo, 'show', `${SHA}:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
      lineCount.set(file, countLines(body));
    } catch {
      lineCount.set(file, -1);
    }
  }
  return lineCount.get(file);
}

// workspace citations
const WS = /^ws:([A-Za-z][A-Za-z0-9]*)\/([A-Za-z0-9_./-]+):([0-9]+)(?:-([0-9]+))?@([0-9]{4}-[0-9]{2}-[0-9]{2})$/;
const rootsFile = process.env.CLAIMS_WORKSPACE_ROOTS;
const wsRoots = new Map(); // alias -> absolute dir
if (rootsFile) {
  let text = null;
  try {
    text = fs.readFileSync(rootsFile, 'utf8');
  } catch (e) {
    fail(`CLAIMS_WORKSPACE_ROOTS file cannot be read (${e.code || e.message})`);
  }
  for (const [i, raw] of (text ?? '').split('\n').entries()) {
    const l = raw.replace(/\r$/, '');
    if (!l.trim() || l.trimStart().startsWith('#')) continue;
    const parts = l.split('\t');
    const alias = parts[0];
    const dir = parts.slice(1).join('\t');
    if (parts.length < 2 || !/^[A-Za-z][A-Za-z0-9]*$/.test(alias) || !dir) {
      fail(`CLAIMS_WORKSPACE_ROOTS line ${i + 1}: expected "alias<TAB>dir"`);
      continue;
    }
    if (alias === 'site') fail(`CLAIMS_WORKSPACE_ROOTS line ${i + 1}: alias "site" is reserved for this repository`);
    else if (wsRoots.has(alias)) fail(`CLAIMS_WORKSPACE_ROOTS line ${i + 1}: duplicate alias ${alias}`);
    else wsRoots.set(alias, path.resolve(path.dirname(rootsFile), dir));
  }
  if (text !== null && wsRoots.size === 0) fail('CLAIMS_WORKSPACE_ROOTS file lists no alias');
}
const wsLines = new Map();
function wsLinesAt(dir, file) {
  const abs = path.resolve(dir, file);
  if (!wsLines.has(abs)) {
    try {
      wsLines.set(abs, fs.statSync(abs).isFile() ? countLines(fs.readFileSync(abs, 'utf8')) : -1);
    } catch {
      wsLines.set(abs, -1);
    }
  }
  return wsLines.get(abs);
}
const validDate = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

let cites = 0;
let wsCites = 0;
let wsChecked = 0;
let observations = 0;
for (const [id, { text, source }] of rows) {
  if (!text) fail(`claims.md ${id}: empty claim text`);
  const s = source.replace(/`/g, '').trim();
  if (s === 'framing' || /^https?:\/\/\S+$/.test(s)) continue;
  // "observation: <text>" is one source (a dated first-hand observation, no repository path); not split
  if (/^observation:/.test(s)) {
    if (!/^observation:\s*\S.{9,}/.test(s)) fail(`claims.md ${id}: observation source needs a description`);
    observations++;
    continue;
  }
  if (!s) {
    fail(`claims.md ${id}: empty source`);
    continue;
  }
  for (const tok of s.split(/\s*;\s*/)) {
    const w = WS.exec(tok);
    if (w) {
      wsCites++;
      const [, alias, file, a, b, date] = w;
      const from = Number(a);
      const to = b ? Number(b) : from;
      if (from < 1 || to < from) fail(`claims.md ${id}: bad line range in ${tok}`);
      if (file.startsWith('/') || file.split('/').includes('..')) fail(`claims.md ${id}: workspace path must be relative without "..": ${tok}`);
      if (!validDate(date)) fail(`claims.md ${id}: bad date in ${tok}`);
      const dir = alias === 'site' ? ROOT : rootsFile ? wsRoots.get(alias) : undefined;
      if (alias !== 'site' && !rootsFile) continue;
      if (!dir) {
        fail(`claims.md ${id}: unknown workspace alias "${alias}" in ${tok}`);
        continue;
      }
      wsChecked++;
      const n = wsLinesAt(dir, file);
      if (n < 0) fail(`claims.md ${id}: ${tok}: file does not exist in workspace ${alias}`);
      else if (to > n) fail(`claims.md ${id}: ${tok} is past the end of the file (${n} lines)`);
      continue;
    }
    const m = CITE.exec(tok);
    if (!m) {
      if (!/^https?:\/\/\S+$/.test(tok)) fail(`claims.md ${id}: source "${tok}" is not path:line[-line]@${SHA}, ws:<alias>/<path>:line[-line]@<YYYY-MM-DD>, framing, observation: or a URL`);
      continue;
    }
    cites++;
    const [, file, a, b] = m;
    const from = Number(a);
    const to = b ? Number(b) : from;
    if (from < 1 || to < from) fail(`claims.md ${id}: bad line range in ${tok}`);
    if (repo) {
      const n = linesAt(file);
      if (n < 0) fail(`claims.md ${id}: ${file} does not exist at ${SHA}`);
      else if (to > n) fail(`claims.md ${id}: ${tok} is past the end of ${file} (${n} lines)`);
    }
  }
}

if (errors.length) {
  for (const e of errors) console.log(`  - ${e}`);
  console.log(`check-claims: FAIL (${errors.length} problem(s))`);
  process.exit(1);
}
console.log(
  `check-claims: PASS (${totalKeys} leaf keys covered, ${rows.size} claims, ${cites} citations, ${wsCites} workspace citation(s), ${observations} observation(s); ` +
    `content sets: ${perSet.join(', ')}; ` +
    `${repo ? 'line ranges checked against the source repo' : 'line ranges not checked: CLAIMS_SOURCE_REPO unset'}; ` +
    `${rootsFile ? `workspace ranges checked (${wsChecked} of ${wsCites}, ${wsRoots.size} alias(es) + site)` : `workspace ranges not checked: CLAIMS_WORKSPACE_ROOTS unset (format only; ${wsChecked} site citation(s) checked)`})`,
);
