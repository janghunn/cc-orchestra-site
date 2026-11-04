// Claim coverage check for content/en.json, content/ko.json and content/claims.md.
// - every leaf string key of both content files is covered by _claims or _nonclaims
//   (pattern = exact key (covers its subtree), "prefix.*" (below prefix), "*.leaf" (that name in any section));
// - both files have the same leaf keys, array lengths and the same _claims / _nonclaims;
// - every id used in _claims exists in claims.md, and every claims.md id is used;
// - every claims.md source cell is "framing", a URL, "observation: <text>" (the whole cell, not split),
//   or "; "-separated path:line[-line]@<sourceSha>.
// Optional: CLAIMS_SOURCE_REPO=<git checkout of the source repo> also checks that each cited file
// exists at <sourceSha> and the cited lines are within it.
// Exit 0 = PASS, 1 = FAIL. Usage: node scripts/check-claims.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (m) => errors.push(m);
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const en = readJson('content/en.json');
const ko = readJson('content/ko.json');
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

const enLeaves = leaves(en);
const koLeaves = leaves(ko);
for (const k of enLeaves.keys()) if (!koLeaves.has(k)) fail(`key only in en.json: ${k}`);
for (const k of koLeaves.keys()) if (!enLeaves.has(k)) fail(`key only in ko.json: ${k}`);
for (const [k, v] of [...enLeaves, ...koLeaves]) {
  if (typeof v !== 'string') fail(`leaf is not a string: ${k} (${typeof v})`);
}
if (JSON.stringify(en._claims) !== JSON.stringify(ko._claims)) fail('_claims differ between en.json and ko.json');
if (JSON.stringify(en._nonclaims) !== JSON.stringify(ko._nonclaims)) fail('_nonclaims differ between en.json and ko.json');

const claims = en._claims || {};
const nonclaims = en._nonclaims || [];
if (!claims || typeof claims !== 'object' || Array.isArray(claims)) fail('_claims must be an object');
if (!Array.isArray(nonclaims)) fail('_nonclaims must be an array');
for (const p of [...Object.keys(claims), ...nonclaims]) if (!validPattern(p)) fail(`bad key pattern: ${p}`);

const allKeys = new Set([...enLeaves.keys(), ...koLeaves.keys()]);
let covered = 0;
for (const k of allKeys) {
  const c = Object.keys(claims).some((p) => matches(p, k));
  const n = nonclaims.some((p) => matches(p, k));
  if (!c && !n) fail(`leaf key in neither _claims nor _nonclaims: ${k}`);
  else covered++;
}
for (const p of [...Object.keys(claims), ...nonclaims]) {
  if (![...allKeys].some((k) => matches(p, k))) fail(`pattern matches no key: ${p}`);
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
for (const [p, ids] of Object.entries(claims)) {
  if (!Array.isArray(ids) || ids.length === 0) fail(`_claims["${p}"] must be a non-empty id array`);
  for (const id of ids || []) {
    used.add(id);
    if (!rows.has(id)) fail(`_claims["${p}"] uses id ${id}, which is not in claims.md`);
  }
}
for (const id of rows.keys()) if (!used.has(id)) fail(`claims.md id ${id} is not used in _claims`);

const CITE = new RegExp(`^([A-Za-z0-9_./-]+):([0-9]+)(?:-([0-9]+))?@${SHA}$`);
const repo = process.env.CLAIMS_SOURCE_REPO;
const lineCount = new Map();
function linesAt(file) {
  if (!lineCount.has(file)) {
    try {
      const body = execFileSync('git', ['-C', repo, 'show', `${SHA}:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
      lineCount.set(file, body.split('\n').length - (body.endsWith('\n') ? 1 : 0));
    } catch {
      lineCount.set(file, -1);
    }
  }
  return lineCount.get(file);
}
let cites = 0;
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
    const m = CITE.exec(tok);
    if (!m) {
      if (!/^https?:\/\/\S+$/.test(tok)) fail(`claims.md ${id}: source "${tok}" is not path:line[-line]@${SHA}, framing, observation: or a URL`);
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
  `check-claims: PASS (${allKeys.size} leaf keys covered, ${rows.size} claims, ${cites} citations, ${observations} observation(s)` +
    `${repo ? ', line ranges checked against the source repo' : ', line ranges not checked: CLAIMS_SOURCE_REPO unset'})`,
);
