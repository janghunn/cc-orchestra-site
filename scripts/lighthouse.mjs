// Lighthouse (pinned devDependency, default mobile config) against the local static server.
// Usage: node scripts/lighthouse.mjs      Env: DIST (default dist), CHROME_PATH (default
// /usr/bin/google-chrome), LH_RUNS (runs per page, default 3; the median score per category counts).
// Thresholds per page (/, /ko/, /workflow/, /ko/workflow/): Performance >= 95, Accessibility = 100,
// Best Practices >= 95, SEO >= 95. Reports go to .lighthouse/<page>-<run>.json (git-ignored), one file per
// page and run. Prints "LIGHTHOUSE <path> PASS|FAIL ...".
// Exit 0 all PASS, 1 any FAIL, 77 environment unavailable (no Chrome, or no loopback socket).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, process.env.DIST || 'dist');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const RUNS = Math.max(1, Number(process.env.LH_RUNS || 3));
const OUT = path.join(ROOT, '.lighthouse');
const CLI = path.join(ROOT, 'node_modules/lighthouse/cli/index.js');
const MIN = { performance: 95, accessibility: 100, 'best-practices': 95, seo: 95 };
// [report-file slug, path below the server root]
const PAGES = [
  ['home-en', ''],
  ['home-ko', 'ko/'],
  ['workflow-en', 'workflow/'],
  ['workflow-ko', 'ko/workflow/'],
];

if (!fs.existsSync(CHROME)) {
  console.log(`LIGHTHOUSE SKIP no Chrome at ${CHROME}`);
  process.exit(77);
}
if (!fs.existsSync(CLI)) {
  console.log('LIGHTHOUSE FAIL lighthouse is not installed (run npm ci)');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

function run(url, file) {
  return new Promise((resolve) => {
    const args = [
      CLI,
      url,
      '--output=json',
      `--output-path=${file}`,
      '--only-categories=performance,accessibility,best-practices,seo',
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
      '--quiet',
    ];
    const p = spawn(process.execPath, args, { env: { ...process.env, CHROME_PATH: CHROME }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => resolve({ code: `launch failed: ${e.code || e.message}`, err: String(e.message || e) }));
    p.on('close', (code, signal) => resolve({ code: signal ? `killed by ${signal}` : code, err }));
  });
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

let server;
try {
  server = await startServer(DIST);
} catch (e) {
  if (/EPERM|EACCES|EADDRNOTAVAIL/.test(String(e.code || e.message))) {
    console.log(`LIGHTHOUSE SKIP cannot listen on loopback: ${e.code || e.message}`);
    process.exit(77);
  }
  throw e;
}
let failed = 0;
try {
  for (const [name, rel] of PAGES) {
    const url = server.url + rel;
    const scores = { performance: [], accessibility: [], 'best-practices': [], seo: [] };
    const notes = [];
    for (let i = 1; i <= RUNS; i++) {
      const file = path.join(OUT, `${name}-${i}.json`);
      fs.rmSync(file, { force: true });
      const { code, err } = await run(url, file);
      if (code !== 0 || !fs.existsSync(file)) {
        notes.push(`run ${i} exit ${code}: ${err.trim().split('\n').slice(-1)[0] || ''}`);
        continue;
      }
      const lhr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (lhr.requestedUrl !== url && lhr.finalDisplayedUrl !== url && lhr.mainDocumentUrl !== url) {
        notes.push(`run ${i} report is for another URL`);
        continue;
      }
      if (lhr.runtimeError) notes.push(`run ${i} runtimeError ${lhr.runtimeError.code}`);
      for (const k of Object.keys(scores)) scores[k].push(Math.round((lhr.categories[k]?.score ?? 0) * 100));
      if (i === RUNS || RUNS === 1) {
        const failing = Object.values(lhr.audits)
          .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'manual')
          .map((a) => `${a.id}=${a.score}`);
        if (failing.length) notes.push(`audits below 1 (last run): ${failing.slice(0, 12).join(', ')}`);
        const m = lhr.audits.metrics?.details?.items?.[0];
        if (m) notes.push(`LCP ${Math.round(m.largestContentfulPaint)} ms, CLS ${m.cumulativeLayoutShift?.toFixed(3)}, TBT ${Math.round(m.totalBlockingTime)} ms`);
      }
    }
    const med = {};
    let ok = scores.performance.length > 0;
    for (const [k, xs] of Object.entries(scores)) {
      med[k] = xs.length ? median(xs) : 0;
      if (med[k] < MIN[k]) ok = false;
    }
    if (!ok) failed++;
    console.log(
      `LIGHTHOUSE /${rel} ${ok ? 'PASS' : 'FAIL'} median of ${scores.performance.length} run(s): ` +
        `P ${med.performance} A ${med.accessibility} BP ${med['best-practices']} SEO ${med.seo} ` +
        `(runs P ${scores.performance.join('/')}, A ${scores.accessibility.join('/')}, BP ${scores['best-practices'].join('/')}, SEO ${scores.seo.join('/')})` +
        (notes.length ? `; ${notes.join('; ')}` : ''),
    );
  }
} finally {
  await server.close();
}
console.log(`lighthouse: ${failed ? 'FAIL' : 'PASS'} (thresholds P>=95 A=100 BP>=95 SEO>=95, mobile)`);
process.exit(failed ? 1 : 0);
