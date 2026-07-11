#!/usr/bin/env node
/* Compute the native app's release version from the website's versioning source
   of truth (COMMIT_COUNT / RELEASE_COMMITS in assets/js/core/app.js), so desktop
   releases carry the SAME version the site shows.

   The site renders major"."zero-padded-position - e.g. "6.0", "6.01", "6.10".
   Tauri/Cargo need a strict semver MAJOR.MINOR.PATCH with no leading zeros, so
   the site's "6.10" can't be used verbatim. We map it to `major.position.0`, so
   "6.0" -> 6.0.0, "6.10" -> 6.10.0: the position sits in the MINOR slot so it
   reads like the site (only a trailing ".0" is added to satisfy semver), and it
   stays monotonically increasing across every push and every release-era bump -
   which is exactly what the in-app auto-updater's "is this newer?" check relies
   on (6.11.0 > 6.0.10, so apps on the old scheme still see the next build).

   Prints the semver to stdout (no trailing newline), so CI can capture it with
   `echo "version=$(node tools/native-version.mjs)" >> "$GITHUB_OUTPUT"`. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'web', 'assets/js/core/app.js'), 'utf8');

const countM = src.match(/const\s+COMMIT_COUNT\s*=\s*(\d+)/);
const relM = src.match(/const\s+RELEASE_COMMITS\s*=\s*\[([^\]]*)\]/);
if (!countM || !relM) {
  console.error('native-version: could not find COMMIT_COUNT / RELEASE_COMMITS in assets/js/core/app.js');
  process.exit(1);
}

const n = parseInt(countM[1], 10);
const releases = relM[1]
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((x) => Number.isFinite(x));

// Mirror analyserVersion() in app.js: walk the release eras to find the current
// major and the era's base commit; the position within the era becomes the patch.
let major = 0, base = 0;
for (const r of releases) { if (n >= r) { major += 1; base = r; } else break; }
const position = major === 0 ? n : n - base;   // pre-1.0: position is the raw commit count

process.stdout.write(`${major}.${position}.0`);
