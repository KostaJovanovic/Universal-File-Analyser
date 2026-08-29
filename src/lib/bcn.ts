/* Analyser - BCn (S3TC / DXT / RGTC) block decoders.

   The block-compression families every GPU texture container wraps: BC1/BC2/BC3
   (DXT1/3/5) and BC4/BC5 (ATI1/ATI2, the single- and two-channel forms used for
   masks and normal maps). Pure computation over bytes - no DOM, no file reads -
   so the container parsers can each decode a surface without pulling in one
   another's lazy chunk.

   Lives here rather than in parsers-image.ts because more than one parser needs
   it: DDS (parsers-image.ts) and Valve VTF (parsers-gaming.ts) are separate
   lazily-loaded chunks, and a cross-chunk import would drag a whole 70 KB
   parser bundle in to reach one function.

   BC6H and BC7 are deliberately absent: both need a much larger mode/partition
   table than the four families here, and the containers that carry them say so
   in their header, so the callers report the format and skip the preview. */

/** The block-compression families decodeBcn() understands. */
export type BcKind = 'bc1' | 'bc2' | 'bc3' | 'bc4' | 'bc5';

// Decode the two RGB565 endpoints of a BC1 colour block into a 4-entry RGB
// palette and write the 16 texels into `dst` (RGBA) at the block origin.
// `writeAlpha` controls whether BC1's 1-bit punch-through alpha is honoured
// (true for standalone BC1; false when BC2/BC3 supply their own alpha).
function decodeColorBlock(b: Uint8Array, off: number, dst: Uint8ClampedArray, dstW: number, dstH: number, bx: number, by: number, writeAlpha: boolean, alphaOut: boolean | null) {
  const c0 = b[off] | (b[off + 1] << 8);
  const c1 = b[off + 2] | (b[off + 3] << 8);
  const bits = b[off + 4] | (b[off + 5] << 8) | (b[off + 6] << 16) | (b[off + 7] << 24);
  // Expand RGB565 -> RGB888.
  const r0 = ((c0 >> 11) & 31), g0 = ((c0 >> 5) & 63), b0 = (c0 & 31);
  const r1 = ((c1 >> 11) & 31), g1 = ((c1 >> 5) & 63), b1 = (c1 & 31);
  const R0 = (r0 << 3) | (r0 >> 2), G0 = (g0 << 2) | (g0 >> 4), B0 = (b0 << 3) | (b0 >> 2);
  const R1 = (r1 << 3) | (r1 >> 2), G1 = (g1 << 2) | (g1 >> 4), B1 = (b1 << 3) | (b1 >> 2);
  const pal = new Int32Array(4 * 4); // r,g,b,a per entry
  pal[0] = R0; pal[1] = G0; pal[2] = B0; pal[3] = 255;
  pal[4] = R1; pal[5] = G1; pal[6] = B1; pal[7] = 255;
  if (c0 > c1 || !writeAlpha) {     // 4-colour block (opaque)
    pal[8] = (2 * R0 + R1 + 1) / 3 | 0; pal[9] = (2 * G0 + G1 + 1) / 3 | 0; pal[10] = (2 * B0 + B1 + 1) / 3 | 0; pal[11] = 255;
    pal[12] = (R0 + 2 * R1 + 1) / 3 | 0; pal[13] = (G0 + 2 * G1 + 1) / 3 | 0; pal[14] = (B0 + 2 * B1 + 1) / 3 | 0; pal[15] = 255;
  } else {                          // 3-colour + transparent black
    pal[8] = (R0 + R1) >> 1; pal[9] = (G0 + G1) >> 1; pal[10] = (B0 + B1) >> 1; pal[11] = 255;
    pal[12] = 0; pal[13] = 0; pal[14] = 0; pal[15] = 0;
  }
  for (let py = 0; py < 4; py++) {
    const y = by + py; if (y >= dstH) continue;
    for (let px = 0; px < 4; px++) {
      const x = bx + px; if (x >= dstW) continue;
      const idx = (bits >> (2 * (py * 4 + px))) & 3;
      const d = (y * dstW + x) * 4;
      dst[d] = pal[idx * 4]; dst[d + 1] = pal[idx * 4 + 1]; dst[d + 2] = pal[idx * 4 + 2];
      if (writeAlpha) dst[d + 3] = pal[idx * 4 + 3];
      else if (alphaOut == null) dst[d + 3] = 255;
    }
  }
}

// Decode a single BC4-style alpha/grayscale block (8 bytes): two 8-bit
// endpoints + 16 × 3-bit indices. Calls `write(x,y,value)` for each texel.
function decodeAlphaBlock(b: Uint8Array, off: number, bx: number, by: number, dstW: number, dstH: number, write: (x: number, y: number, v: number) => void) {
  const a0 = b[off], a1 = b[off + 1];
  const a = new Int32Array(8);
  a[0] = a0; a[1] = a1;
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) a[i + 1] = (((7 - i) * a0 + i * a1) / 7) | 0;
  } else {
    for (let i = 1; i < 5; i++) a[i + 1] = (((5 - i) * a0 + i * a1) / 5) | 0;
    a[6] = 0; a[7] = 255;
  }
  // 48 bits of 3-bit indices, little-endian starting at byte off+2.
  let lo = b[off + 2] | (b[off + 3] << 8) | (b[off + 4] << 16);
  let hi = b[off + 5] | (b[off + 6] << 8) | (b[off + 7] << 16);
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const t = py * 4 + px;
      let idx;
      if (t < 8) { idx = (lo >> (3 * t)) & 7; }
      else { idx = (hi >> (3 * (t - 8))) & 7; }
      const x = bx + px, y = by + py;
      if (x < dstW && y < dstH) write(x, y, a[idx]);
    }
  }
}

/** Bytes one BCn surface of these dimensions occupies - what a caller needs to
    skip a mip level, or to check a payload is long enough before decoding. */
export function bcnSurfaceBytes(width: number, height: number, kind: BcKind) {
  const blockBytes = (kind === 'bc1' || kind === 'bc4') ? 8 : 16;
  return ((width + 3) >> 2) * ((height + 3) >> 2) * blockBytes;
}

// Decode a BCn-compressed surface (kind: bc1/bc2/bc3/bc4/bc5) into RGBA.
export function decodeBcn(b: Uint8Array, off: number, width: number, height: number, kind: string) {
  const px = width * height;
  if (px <= 0 || px > 64_000_000) return null;
  const dst = new Uint8ClampedArray(px * 4);
  const blocksX = (width + 3) >> 2;
  const blocksY = (height + 3) >> 2;
  const blockBytes = (kind === 'bc1' || kind === 'bc4') ? 8 : 16;
  const need = blocksX * blocksY * blockBytes;
  if (off + need > b.length) return null;

  let p = off;
  for (let byb = 0; byb < blocksY; byb++) {
    for (let bxb = 0; bxb < blocksX; bxb++) {
      const bx = bxb * 4, by = byb * 4;
      if (kind === 'bc1') {
        decodeColorBlock(b, p, dst, width, height, bx, by, true, null);
        p += 8;
      } else if (kind === 'bc2') {
        // 8 bytes explicit 4-bit alpha, then a BC1 colour block.
        for (let py = 0; py < 4; py++) {
          const aRow = b[p + py * 2] | (b[p + py * 2 + 1] << 8);
          for (let pxi = 0; pxi < 4; pxi++) {
            const x = bx + pxi, y = by + py;
            if (x < width && y < height) {
              const a4 = (aRow >> (4 * pxi)) & 0x0f;
              dst[(y * width + x) * 4 + 3] = (a4 << 4) | a4;
            }
          }
        }
        decodeColorBlock(b, p + 8, dst, width, height, bx, by, false, true);
        p += 16;
      } else if (kind === 'bc3') {
        // BC4-style interpolated alpha, then a BC1 colour block.
        decodeAlphaBlock(b, p, bx, by, width, height, (x, y, v) => { dst[(y * width + x) * 4 + 3] = v; });
        decodeColorBlock(b, p + 8, dst, width, height, bx, by, false, true);
        p += 16;
      } else if (kind === 'bc4') {
        // Single channel -> grayscale, opaque.
        decodeAlphaBlock(b, p, bx, by, width, height, (x, y, v) => {
          const d = (y * width + x) * 4; dst[d] = dst[d + 1] = dst[d + 2] = v; dst[d + 3] = 255;
        });
        p += 8;
      } else if (kind === 'bc5') {
        // Two channels (R then G); reconstruct B as a normal-map Z, opaque.
        decodeAlphaBlock(b, p, bx, by, width, height, (x, y, v) => { dst[(y * width + x) * 4] = v; });
        decodeAlphaBlock(b, p + 8, bx, by, width, height, (x, y, v) => {
          const d = (y * width + x) * 4;
          dst[d + 1] = v;
          // Reconstruct Z assuming a unit normal: nz = sqrt(1 - nx^2 - ny^2).
          const nx = dst[d] / 127.5 - 1, ny = v / 127.5 - 1;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          dst[d + 2] = Math.round((nz * 0.5 + 0.5) * 255);
          dst[d + 3] = 255;
        });
        p += 16;
      }
    }
  }
  return dst;
}
