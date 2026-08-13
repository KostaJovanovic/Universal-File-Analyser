/* Analyser - build freshness gate.

   tsc emits even when it reports type errors, so its exit code cannot tell
   "the build is stale" from "the build is fine but 40 renderers still have
   un-narrowed `any`s". During the TypeScript migration that distinction is the
   difference between a commit that ships correct code and one that blocks all
   work for weeks.

   So save.bat gates on THIS instead: every .ts under src/ must have a
   corresponding .js under web/assets/js/ that is no older than it. That catches
   the failure that actually matters - source edited, output not rebuilt, skew
   committed - regardless of how many type errors are outstanding.

   Exits 1 on any missing or stale output. */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'web', 'assets', 'js');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

if (!existsSync(SRC)) {
  console.log('[check-build] no src/ - nothing to verify.');
  process.exit(0);
}

const missing = [];
const stale = [];
const sources = walk(SRC);

for (const ts of sources) {
  const rel = relative(SRC, ts).split(sep).join('/');
  const js = join(OUT, rel.replace(/\.ts$/, '.js'));
  if (!existsSync(js)) { missing.push(rel); continue; }
  // 2s slack: some filesystems round mtimes, and tsc writes output within the
  // same second as an edit on a fast incremental build.
  if (statSync(ts).mtimeMs > statSync(js).mtimeMs + 2000) stale.push(rel);
}

if (missing.length || stale.length) {
  console.error(`[check-build] FAIL - ${sources.length} sources checked`);
  for (const m of missing) console.error(`    no output:  ${m}`);
  for (const s of stale) console.error(`    stale:      ${s}`);
  console.error('[check-build] run: npx tsc -p tsconfig.json && npx tsc -p tsconfig.worker.json');
  process.exit(1);
}

console.log(`[check-build] OK - ${sources.length} sources, all output present and fresh.`);
