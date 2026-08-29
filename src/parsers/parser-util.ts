/* Analyser - shared helpers for the lazy parsers-<domain> chunks and the
   built-in proprietary.js dispatch.

   Parser contract (same for every chunk's PARSERS map and the built-in map):
     ParseFn = (ctx: { head: Uint8Array, file: File, ext: string })
                 => Rows | null | Promise<Rows | null>
   where Rows is a plain { label: value } object rendered as a readout table.
   Return null (or a falsy value) to decline and fall through to generic handling.
   A parser should never need to throw - `safe()` turns a throw into a graceful
   decline so one bad parser can't reject the whole render.

   THE `_`-PREFIXED PAYLOAD KEYS carry out-of-band content: renderProprietary
   pulls them out and strips them before printing the rest, so a typo in one
   becomes a printed field instead of a payload. They are typed in
   core/types.d.ts, which is what stops that silently happening:

     _sections      [{ title, node, open? }] collapsible blocks. Most used by far.
     _previewNode   a DOM Node shown as the preview (canvas, image, whole card).
                    Built synchronously; a parser that needs async work appends
                    into a placeholder it already returned.
     _app           override the catalog display name when the bytes prove a
                    more specific one
     _readableText  extracted plain text, for the reader view and search
     _help          { label: explanation } per-field help, merged over LABEL_HELP
     _fileList      archive/container member listing
     _font _rsrc _index _dir  format-specific payloads; see core/types.d.ts

   READ ONLY WHAT YOU NEED. `ctx.head` is the first 4096 bytes and is already in
   memory - free. If a structure's headers are in there, parse them and then read
   exactly the bytes they point at from `ctx.file`, rather than slurping megabytes
   to go looking. parseBlender in renderers/proprietary.ts is the worked example:
   block headers out of `head`, then one exact slice for the thumbnail's pixels.
   Any cap you need while doing that belongs in core/limits.ts, not inline here. */

import { el } from '../core/util.js';
import type { ParseCtx, ParseFn, Row } from '../core/types.js';

/** Cap on a decoded preview's longest edge, in px. */
export const MAX_EDGE = 1024;

// Build a <canvas> from an RGBA Uint8ClampedArray, scaling down so the longest
// edge is <= MAX_EDGE (nearest-neighbour, cheap). Returns the canvas node or null.
// Shared rather than per-chunk: several chunks decode raw pixels (Netpbm, TGA,
// QOI and DDS in parsers-image, Valve VTF in parsers-gaming) and every one of
// them wants the same checkerboard-backed, size-capped, captioned preview.
export function canvasFromRGBA(rgba: Uint8ClampedArray, w: number, h: number) {
  if (!w || !h || w < 1 || h < 1) return null;
  if (rgba.length < w * h * 4) return null;
  let dw = w, dh = h;
  const longest = Math.max(w, h);
  if (longest > MAX_EDGE) {
    const s = MAX_EDGE / longest;
    dw = Math.max(1, Math.round(w * s));
    dh = Math.max(1, Math.round(h * s));
  }
  try {
    if (dw === w && dh === h) {
      const c = el('canvas');
      c.width = w; c.height = h;
      c.style.maxWidth = '100%'; c.style.height = 'auto'; c.style.imageRendering = 'auto';
      const ctx = c.getContext('2d')!;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
      return wrapPreview(c, w, h);
    }
    // Render full-res to an offscreen canvas, then draw scaled into the visible one.
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
    const c = el('canvas');
    c.width = dw; c.height = dh;
    c.style.maxWidth = '100%'; c.style.height = 'auto';
    c.getContext('2d')!.drawImage(off, 0, 0, dw, dh);
    return wrapPreview(c, w, h);
  } catch (_) {
    return null;
  }
}

// Wrap a canvas with a checkerboard background (so transparency reads) + caption.
function wrapPreview(canvas: HTMLCanvasElement, w: number, h: number) {
  const wrap = el('div', { class: 'anr-img-preview', style: 'margin-top:12px;' });
  const board = el('div', {
    style: 'display:inline-block;background-image:linear-gradient(45deg,#bbb 25%,transparent 25%),linear-gradient(-45deg,#bbb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#bbb 75%),linear-gradient(-45deg,transparent 75%,#bbb 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;border:1px solid var(--anr-border,#3a3a3a);max-width:100%;',
  }, canvas);
  wrap.appendChild(board);
  wrap.appendChild(el('div', { style: 'font-size:11px;opacity:.6;margin-top:4px;' },
    'Decoded preview · ' + w + ' × ' + h + (Math.max(w, h) > MAX_EDGE ? ' (scaled)' : '')));
  return wrap;
}

// Wrap a parser so a throw becomes null instead of rejecting renderProprietary.
// Applied uniformly to both the built-in PARSERS map and the lazy chunk maps, so
// a built-in parser throw is swallowed the same way a chunk parser throw already
// was. (undefined and null are treated identically by the renderer downstream.)
export function safe(fn: ParseFn): (c: ParseCtx) => Promise<Row | null | undefined> {
  return async (c) => { try { return await fn(c); } catch (_) { return null; } };
}
