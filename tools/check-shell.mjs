/* Verify the offline manifests cover every app module.
   ============================================================================
   WHY: the app is an offline-first PWA, so a module that is never precached
   simply does not exist offline. Two hand-maintained lists have to stay in step
   with the module tree:

     - SHELL in web/sw.js                  (the service worker's precache)
     - TIERS.essentials in offline-tiers.js (the user's explicit download)

   Nothing enforced that. renderers/eda-viewer.js - the pan/zoom viewer that
   altium.js and kicad.js both STATICALLY import - was missing from both lists
   while altium.js and kicad.js were in them, so opening a PCB project offline
   loaded the renderer, hit the un-cached import, and died. Online it worked
   perfectly, which is exactly why it survived so long.

   This script is the check that would have caught it. Two passes:

     1. every .js under web/assets/js is precached (bar the documented exempts);
     2. no precached module imports a module that ISN'T precached - the
        eda-viewer failure mode, and the one that stays invisible in dev.

   Run standalone with `node tools/check-shell.mjs`. save.bat runs it on every
   commit and warns; it never blocks a commit, matching the other generators.
   ============================================================================ */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const JS_DIR = join(WEB, 'assets', 'js');

/* Modules deliberately outside the offline manifests. */
const EXEMPT = new Map([
  // The generated /docs pages don't load app.js - they load this instead, and
  // they are not in sw.js SHELL by design (see "The docs site" in CLAUDE.md).
  ['assets/js/core/docs.js', 'docs pages are deliberately not precached'],
]);

const posix = (p) => p.split('\\').join('/');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/* Pull the quoted './assets/js/...' entries out of a source file. Both manifests
   are plain array literals, so a scan for the paths themselves is enough and
   avoids importing browser-only modules into Node. */
function manifestPaths(file) {
  const src = readFileSync(file, 'utf8');
  const found = new Set();
  for (const m of src.matchAll(/['"]\.?\/?(assets\/js\/[A-Za-z0-9/_.-]+\.js)['"]/g)) found.add(m[1]);
  return found;
}

/* Literal import specifiers in a module: `import ... from '<x>'`, bare
   `import '<x>'`, and `import('<x>')`. Computed specifiers are skipped - they
   can't be resolved statically, and the manifests list those targets by hand. */
function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const specs = new Set();
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) specs.add(m[1]);

  const out = [];
  for (const spec of specs) {
    if (!spec.startsWith('.')) continue; // bare/CDN specifiers aren't ours
    const abs = resolve(dirname(file), spec);
    out.push({ spec, rel: posix(relative(WEB, abs)) });
  }
  return out;
}

const modules = walk(JS_DIR).map((f) => ({ abs: f, rel: posix(relative(WEB, f)) }));
const shell = manifestPaths(join(WEB, 'sw.js'));
const tiers = manifestPaths(join(JS_DIR, 'core', 'offline-tiers.js'));

const problems = [];

// ---- Pass 1: everything on disk is precached ----
for (const { rel } of modules) {
  if (EXEMPT.has(rel) || shell.has(rel)) continue;
  problems.push(`not in sw.js SHELL: ${rel}`);
}

// ---- Pass 2: no precached module imports an un-precached one ----
const onDisk = new Set(modules.map((m) => m.rel));
for (const { abs, rel } of modules) {
  if (!shell.has(rel)) continue;
  for (const { spec, rel: dep } of importsOf(abs)) {
    if (!onDisk.has(dep)) { problems.push(`broken import: ${rel} -> ${spec} (no such file)`); continue; }
    if (!shell.has(dep)) problems.push(`offline gap: ${rel} imports ${dep}, which is NOT precached`);
  }
}

// ---- Advisory: SHELL entries the Essentials tier doesn't mirror ----
const tierGaps = [...shell].filter((p) => !tiers.has(p) && !EXEMPT.has(p));

if (problems.length) {
  console.error(`[check-shell] ${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
} else {
  console.log(`[check-shell] OK - ${modules.length} modules, ${shell.size} precached, no offline gaps.`);
}
if (tierGaps.length) {
  console.log(`[check-shell] note: ${tierGaps.length} precached file(s) not in the Essentials tier (fine if intentional):`);
  for (const p of tierGaps.slice(0, 12)) console.log('    ' + p);
  if (tierGaps.length > 12) console.log(`    ... and ${tierGaps.length - 12} more`);
}

process.exit(problems.length ? 1 : 0);
