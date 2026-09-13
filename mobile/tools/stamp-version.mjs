/* Stamp the Android app's version from the site's own version number.
 *
 * The desktop twin is desktop/tools/stamp-version.mjs, and both apply the same
 * walk as analyserVersion() in src/core/app.ts (see the version-numbering
 * skill). Keep all three identical.
 *
 * Android wants two numbers:
 *   versionName  what the user sees - "9.0", the same label as the footer
 *   versionCode  an integer that must only ever grow, or Android refuses the
 *                update. COMMIT_COUNT is exactly that.
 *
 * Writes both into android/app/build.gradle, and major.minor.0 into
 * mobile/package.json. Run standalone: node mobile/tools/stamp-version.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(HERE, '..');
const ROOT = resolve(MOBILE, '..');

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
const name = `${major}.${minor}`;

const pkgPath = join(MOBILE, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version !== `${name}.0`) {
  pkg.version = `${name}.0`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

const gradlePath = join(MOBILE, 'android', 'app', 'build.gradle');
if (existsSync(gradlePath)) {
  const g = readFileSync(gradlePath, 'utf8');
  const next = g
    .replace(/versionCode\s+\d+/, `versionCode ${count}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${name}"`);
  if (next !== g) writeFileSync(gradlePath, next);
}
console.log(`stamp-version: ${name} (versionCode ${count})`);
