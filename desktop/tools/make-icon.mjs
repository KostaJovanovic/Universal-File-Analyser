/* Make desktop/build/icon.ico - the Windows icon, sharp at every size.
 *
 * electron-builder can make an .ico from icon.png (512 px) itself, but it only
 * scales that one picture down. The mark is thin black strokes, so at 16, 24,
 * 32 and 48 px every edge fell between two pixels, and the icon came out grey
 * and soft on the desktop and in Explorer. This draws the mark afresh at each
 * size instead: every stroke is rounded to whole pixels, and the right-hand
 * side mirrors the left, so the frame stays crisp and symmetric.
 *
 * The geometry is web/assets/img/favicon.svg's, in its 64-unit space:
 *   two bars at x = 6 and 58, 3.5 wide, square caps, y 5.11 to 58.89
 *   a frame 12.78..51.23 x 6.11..57.89, stroke 3.5
 *   a red dot at the centre, r 7.55, on a white square with r 5.97 corners
 * Change the SVG and this file together.
 *
 * sharp comes from mobile/node_modules (make-icons.mjs uses it there), so the
 * desktop takes no dependency for a file that changes only with the mark. The
 * .ico is tracked, like icon.png.
 *
 * Run: node desktop/tools/make-icon.mjs [preview-dir]
 *      (after `npm install` in mobile/; preview-dir gets one PNG per size)
 */

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, '..');
const ROOT = resolve(DESKTOP, '..');

let sharp;
try {
  sharp = createRequire(join(ROOT, 'mobile', 'package.json'))('sharp');
} catch (_) {
  console.error('make-icon: sharp was not found - run `npm install` in mobile/ first');
  process.exit(1);
}

// Every size Windows asks for: 16 to 48 for lists and small icons at 100-200 %
// scaling, 64 to 256 for the large and extra-large views.
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const INK = '#0a0a0a';
const RED = '#e60023';

function markSvg(n) {
  const s = n / 64;
  const w = Math.max(1, Math.round(3.5 * s));        // stroke width, whole pixels
  // Left and top edges, rounded. The square caps reach 1.75 units past each
  // end of a bar, and a stroke 1.75 outside its rectangle.
  const barX = Math.round(6 * s - w / 2);
  const barY = Math.round((5.11 - 1.75) * s);
  const frameX = Math.round((12.78 - 1.75) * s);
  const frameY = Math.round((6.11 - 1.75) * s);
  const rects = [
    [barX, barY, w, n - 2 * barY],                    // left bar
    [n - barX - w, barY, w, n - 2 * barY],            // right bar, mirrored
    [frameX, frameY, n - 2 * frameX, w],              // frame top
    [frameX, n - frameY - w, n - 2 * frameX, w],      // frame bottom
    [frameX, frameY, w, n - 2 * frameY],              // frame left
    [n - frameX - w, frameY, w, n - 2 * frameY],      // frame right
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}">`
    + `<rect width="${n}" height="${n}" rx="${(5.97 * s).toFixed(2)}" fill="#fff"/>`
    + `<g fill="${INK}" shape-rendering="crispEdges">`
    + rects.map(([x, y, rw, rh]) => `<rect x="${x}" y="${y}" width="${rw}" height="${rh}"/>`).join('')
    + `</g><circle cx="${n / 2}" cy="${n / 2}" r="${(7.55 * s).toFixed(2)}" fill="${RED}"/></svg>`;
}

const preview = process.argv[2] ? resolve(process.argv[2]) : null;
if (preview) mkdirSync(preview, { recursive: true });

const pngs = [];
for (const n of SIZES) {
  const png = await sharp(Buffer.from(markSvg(n)), { density: 72 }).resize(n, n).png().toBuffer();
  pngs.push(png);
  if (preview) writeFileSync(join(preview, `icon-${n}.png`), png);
}

// ICO: a 6-byte header, one 16-byte entry per image, then the images. Every
// image is stored as PNG, which Windows has read inside an .ico since Vista.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);             // reserved
header.writeUInt16LE(1, 2);             // 1 = icon
header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const entries = pngs.map((png, i) => {
  const n = SIZES[i];
  const e = Buffer.alloc(16);
  e.writeUInt8(n >= 256 ? 0 : n, 0);    // width, 0 means 256
  e.writeUInt8(n >= 256 ? 0 : n, 1);    // height
  e.writeUInt8(0, 2);                   // no palette
  e.writeUInt8(0, 3);                   // reserved
  e.writeUInt16LE(1, 4);                // colour planes
  e.writeUInt16LE(32, 6);               // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
const out = join(DESKTOP, 'build', 'icon.ico');
writeFileSync(out, Buffer.concat([header, ...entries, ...pngs]));
console.log(`make-icon: ${SIZES.join(', ')} px -> ${out}`);
