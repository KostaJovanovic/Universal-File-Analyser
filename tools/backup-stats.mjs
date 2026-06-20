/* Download the live usage stats to local CSV files (read-only backup).
   ============================================================================
   WHY: the only copy of the counters lives in Cloudflare D1 (worker/index.js).
   This pulls a snapshot to stats-backup/*.csv so there's an off-database copy
   for safekeeping / analysis. It only READS (GET /api/stats) - it never deletes
   or changes anything in D1, and needs no wrangler auth.

   HOW: fetches <site>/api/stats and writes four CSVs:
     totals.csv      - files + visitors running totals
     extensions.csv  - per-extension tally (supported rows + the pooled
                       "(unsupported)" bucket, exactly as the API exposes them)
     scores.csv      - the Asteroids leaderboard
     daily.csv       - the per-day visitor/file series, MERGED by day into any
                       existing file so history beyond the API's 400-day window
                       (readDaily limit) is preserved across runs.

   RUN: `node tools/backup-stats.mjs [site]`  (save.bat offers it before a commit)
   Defaults to production; override with an arg or ANALYSER_SITE, e.g.
     node tools/backup-stats.mjs http://127.0.0.1:3000
   ============================================================================ */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'stats-backup');
const SITE = (process.argv[2] || process.env.ANALYSER_SITE || 'https://lab.valjdakosta.com').replace(/\/$/, '');

// RFC-4180-ish CSV: quote a cell only when it contains a comma, quote or newline.
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (header, rows) =>
  [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';

const res = await fetch(SITE + '/api/stats', { headers: { accept: 'application/json' } });
if (!res.ok) throw new Error('GET ' + SITE + '/api/stats -> ' + res.status);
const data = await res.json();
if (typeof data.files !== 'number') throw new Error('unexpected /api/stats payload');

mkdirSync(OUT, { recursive: true });

writeFileSync(join(OUT, 'totals.csv'), toCsv(['metric', 'value'], [
  ['files', data.files || 0],
  ['visitors', data.visitors || 0],
]));

const exts = Array.isArray(data.extensions) ? data.extensions : [];
writeFileSync(join(OUT, 'extensions.csv'),
  toCsv(['ext', 'supported', 'count'], exts.map((e) => [e.ext, e.supported ? 1 : 0, e.count])));

const scores = Array.isArray(data.scores) ? data.scores : [];
const isoDate = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '');
writeFileSync(join(OUT, 'scores.csv'),
  toCsv(['name', 'score', 'wave', 'cause', 'date'],
    scores.map((s) => [s.name, s.score, s.wave == null ? '' : s.wave, s.cause || '', isoDate(s.ts)])));

// Merge the daily series by day into any existing backup, so older days that
// have since aged out of the API's response are not lost on the next run.
const merged = new Map();
const dailyPath = join(OUT, 'daily.csv');
if (existsSync(dailyPath)) {
  for (const ln of readFileSync(dailyPath, 'utf8').split(/\r?\n/).slice(1)) {
    if (!ln.trim()) continue;
    const [day, files, visitors] = ln.split(',');
    if (day) merged.set(day, { files: Number(files) || 0, visitors: Number(visitors) || 0 });
  }
}
for (const d of (Array.isArray(data.daily) ? data.daily : [])) {
  if (d && d.day) merged.set(d.day, { files: Number(d.files) || 0, visitors: Number(d.visitors) || 0 });
}
const days = [...merged.keys()].sort();
writeFileSync(dailyPath, toCsv(['day', 'files', 'visitors'],
  days.map((day) => [day, merged.get(day).files, merged.get(day).visitors])));

console.log('Backed up stats from ' + SITE + ' to ' + OUT);
console.log('  totals.csv, extensions.csv (' + exts.length + '), scores.csv (' + scores.length + '), daily.csv (' + days.length + ' days)');
