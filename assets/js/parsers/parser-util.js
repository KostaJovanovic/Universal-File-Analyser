/* Analyser - shared helpers for the lazy parsers-<domain> chunks and the
   built-in proprietary.js dispatch.

   Parser contract (same for every chunk's PARSERS map and the built-in map):
     ParseFn = (ctx: { head: Uint8Array, file: File, ext: string })
                 => Rows | null | Promise<Rows | null>
   where Rows is a plain { label: value } object, optionally carrying
   `_`-prefixed payloads (_app, _help, _fileList, _readableText, _previewNode,
   _sections, _font). Return null (or a falsy value) to decline and fall through
   to generic handling. A parser should never need to throw - `safe()` turns a
   throw into a graceful decline so one bad parser can't reject the whole render. */

// Wrap a parser so a throw becomes null instead of rejecting renderProprietary.
// Applied uniformly to both the built-in PARSERS map and the lazy chunk maps, so
// a built-in parser throw is swallowed the same way a chunk parser throw already
// was. (undefined and null are treated identically by the renderer downstream.)
export function safe(fn) {
  return async (c) => { try { return await fn(c); } catch (_) { return null; } };
}
