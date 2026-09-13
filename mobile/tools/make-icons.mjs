/* Make the Android launcher icons and splash screens from the site mark.
 *
 * The source is web/assets/img/favicon.svg, the vector mark, because the
 * largest PNG of it is 512 px. Two changes on the way:
 *
 *  - Its white background square is dropped. That square has rounded corners,
 *    and the site has none (see "Site aesthetics" in the root CLAUDE.md). The
 *    launcher masks the icon to its own shape anyway, and the background comes
 *    from a flat colour below.
 *  - The dark variant draws the strokes white, because the mark's #0a0a0a
 *    strokes would vanish on the dark theme's #0a0a0a background.
 *
 * It writes mobile/assets/logo.png and logo-dark.png (tracked: they are inputs,
 * like desktop/build/icon.png), then runs @capacitor/assets, which writes the
 * mipmaps and splash drawables into android/app/src/main/res/.
 *
 * Run: npm run icons   (from mobile/). Rerun it when the mark changes.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(HERE, '..');
const ROOT = resolve(MOBILE, '..');
const OUT = join(MOBILE, 'assets');

// The site's own theme backgrounds (--bg in analyser.css, light and dark).
const BG_LIGHT = '#ffffff';
const BG_DARK = '#0a0a0a';
const SIZE = 1024;

const svg = readFileSync(join(ROOT, 'web', 'assets', 'img', 'favicon.svg'), 'utf8');
const markOnly = svg.replace(/<rect class="st0"[^>]*\/>\s*/, '');
if (markOnly === svg) {
  console.error('make-icons: the favicon.svg background <rect class="st0"> was not found - check the file');
  process.exit(1);
}
const markDark = markOnly.replace(/stroke:\s*#0a0a0a/i, 'stroke: #ffffff');

mkdirSync(OUT, { recursive: true });
async function render(source, file) {
  // density scales the 64-unit viewBox straight to SIZE, so nothing is upscaled.
  await sharp(Buffer.from(source), { density: (72 * SIZE) / 64 })
    .resize(SIZE, SIZE)
    .png()
    .toFile(join(OUT, file));
  console.log('make-icons: ' + file);
}
await render(markOnly, 'logo.png');
await render(markDark, 'logo-dark.png');

const cli = join(MOBILE, 'node_modules', '@capacitor', 'assets', 'bin', 'capacitor-assets');
execFileSync(process.execPath, [
  cli, 'generate', '--android',
  '--iconBackgroundColor', BG_LIGHT,
  '--iconBackgroundColorDark', BG_DARK,
  '--splashBackgroundColor', BG_LIGHT,
  '--splashBackgroundColorDark', BG_DARK,
], { cwd: MOBILE, stdio: 'inherit' });
