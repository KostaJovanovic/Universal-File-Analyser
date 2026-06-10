/* Stamp the live format count (and sitemap lastmod) into the STATIC, crawler-only
   surfaces that can't run JS.
   ============================================================================
   WHY: the in-app "{n}+ formats" affordances are filled at runtime from
   formatCount() (see the data-fmt-count pass in app.js), but the SEO copy a
   crawler actually reads - the meta/OG/Twitter descriptions, the WebApplication
   JSON-LD featureList, the static feature-spec text, the PWA manifest - is plain
   text with no JS. Hand-maintained "200+ / 740+" numbers drifted apart from the
   real catalog size. This bakes the single source of truth (formatCount()) into
   all of them so the numbers can never disagree again.

   It also stamps the main sitemap.xml <lastmod> dates to the build date, so the
   three hand-listed URLs don't advertise a frozen 2026-06-07.

   The genuinely-narrower "200+ proprietary formats identified by magic bytes"
   claim (llms.txt / README) is a different, smaller metric and is left alone.

   RUN: `node tools/stamp-counts.mjs` (save.bat runs it on every commit, before
   `git add`, so the static numbers track the catalog automatically).
   ============================================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const { formatCount } = await import(
  pathToFileURL(join(ROOT, 'assets/js/core/formats.js')).href
);
const n = formatCount();

// today, YYYY-MM-DD (local). A regular node script, so new Date() is fine here.
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// One file, a list of [regex, replacement] passes. Each replacement uses the live
// count. Patterns are written so re-running is idempotent (they match whatever
// number is currently there).
const JOBS = [
  ['index.html', [
    [/\d+\+ file types/g, `${n}+ file types`],
    [/\d+\+ file formats/g, `${n}+ file formats`],
    [/(>)\d+\+ formats(<)/g, `$1${n}+ formats$2`],
  ]],
  ['patch.html', [
    [/\d+\+ file formats/g, `${n}+ file formats`],
  ]],
  ['manifest.json', [
    [/\d+\+ file types/g, `${n}+ file types`],
  ]],
  ['sitemap.xml', [
    [/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g, `<lastmod>${today}</lastmod>`],
  ]],
];

let changed = 0;
for (const [rel, passes] of JOBS) {
  const file = join(ROOT, rel);
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch (e) {
    console.warn(`stamp-counts: skipped ${rel} (${e.message})`);
    continue;
  }
  let out = src;
  for (const [re, to] of passes) out = out.replace(re, to);
  if (out !== src) {
    writeFileSync(file, out);
    changed++;
    console.log(`stamp-counts: updated ${rel}`);
  }
}

console.log(`stamp-counts: format count = ${n}, lastmod = ${today}, files changed = ${changed}`);
