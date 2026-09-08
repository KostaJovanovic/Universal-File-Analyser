/* Stamp the desktop package version from the site's own version number.
 *
 * The UI keeps showing analyserVersion() exactly as it does on the website, so
 * the two must agree. This reads COMMIT_COUNT and RELEASE_COMMITS out of
 * src/core/app.ts and applies the same formula (see the version-numbering
 * skill), then writes `major.minor.0` into desktop/package.json.
 *
 * Why `.0` on the end: npm/electron-builder want semver, and the site's number
 * has only two parts. The third is always 0 and carries no meaning.
 *
 * A pre-1.0 site version (0.NN) would produce "0.NN" - not valid semver with a
 * leading zero-padded minor - so that case is normalised too.
 *
 * Run standalone: node desktop/tools/stamp-version.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, '..');
const ROOT = resolve(DESKTOP, '..');

const src = readFileSync(join(ROOT, 'src', 'core', 'app.ts'), 'utf8');

const countM = src.match(/const\s+COMMIT_COUNT\s*=\s*(\d+)/);
const relM = src.match(/const\s+RELEASE_COMMITS\s*=\s*\[([^\]]*)\]/);
if (!countM || !relM) {
  console.error('stamp-version: could not read COMMIT_COUNT / RELEASE_COMMITS from src/core/app.ts');
  process.exit(1);
}

const count = Number(countM[1]);
const releases = relM[1].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));

// Same walk as analyserVersion() in src/core/app.ts. Keep them identical.
let major = 0, base = 0;
for (const r of releases) {
  if (count >= r) { major += 1; base = r; } else break;
}
const minor = major === 0 ? count : count - base;

const version = `${major}.${minor}.0`;

const pkgPath = join(DESKTOP, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version === version) {
  console.log(`stamp-version: already ${version} (commit ${count})`);
} else {
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`stamp-version: ${version} (commit ${count})`);
}
