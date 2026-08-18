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

import type { ParseCtx, ParseFn, Row } from '../core/types.js';

// Wrap a parser so a throw becomes null instead of rejecting renderProprietary.
// Applied uniformly to both the built-in PARSERS map and the lazy chunk maps, so
// a built-in parser throw is swallowed the same way a chunk parser throw already
// was. (undefined and null are treated identically by the renderer downstream.)
export function safe(fn: ParseFn): (c: ParseCtx) => Promise<Row | null | undefined> {
  return async (c) => { try { return await fn(c); } catch (_) { return null; } };
}
