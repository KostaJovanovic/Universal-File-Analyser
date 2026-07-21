/* Analyser - central resource limits & device tiering
   Single source of truth for every memory/size cap in the app: whole-file
   "too large" walls, mobile OOM guards, decompression-bomb ceilings, first-N-byte
   scan windows, the animation pixel budget, and assorted preview/enumeration
   caps. Before this module these lived as scattered magic numbers with no shared
   convention; centralising them keeps related formats consistent and makes the
   device-scaling policy legible in one place.

   Device policy: a single RAM-based tier (high/mid/low) drives everything that
   should scale with available memory. `navigator.deviceMemory` is browser-clamped
   to 8 (anti-fingerprinting) so 8/16/32 GB all read as 8 -> `high`; it is absent
   entirely on Safari/Firefox, which fall to `mid` (matching the historical
   `deviceMemory || 4` default). Phones are NOT handled by the tier: they stay
   gated by `isLowMemoryDevice()` (coarse pointer && tier !== 'high'), preserving
   the exact pre-existing mobile-guard behaviour. */

// Binary units (matches the dominant `N * 1024 * 1024` convention in the codebase).
const MB = 1024 * 1024;
const GB = 1024 * MB;

// ---- device tier (RAM-based, memoised) ----
// Falsy `|| 0` (not `=== undefined`) so any unreported/zero value lands in `mid`,
// identical to gcode's historical `navigator.deviceMemory || 4`.
let _tier;
export function deviceTier() {
  if (_tier) return _tier;
  const dm = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
  _tier = !dm ? 'mid' : dm >= 8 ? 'high' : dm >= 4 ? 'mid' : 'low';
  return _tier;
}

// Pick a value for the current device tier: byTier({ high, mid, low }).
export function byTier({ high, mid, low }) {
  return { high, mid, low }[deviceTier()];
}

// "Is this a memory-constrained phone/tablet where pulling a very large file
// fully into memory or a WASM heap risks an OOM tab crash?" Coarse pointer catches
// phones/tablets; a high-RAM tablet (tier 'high') is let through. This is the exact
// equivalent of the former util.js logic (coarse && !(deviceMemory >= 8)) - see the
// truth table in the refactor plan - and remains the gate for the mobile walls.
export function isLowMemoryDevice() {
  const coarse = !!(typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(pointer: coarse)').matches);
  return coarse && deviceTier() !== 'high';
}

// ---- hard walls: file declined outright (errorCard), never read ----
// Genuine "too large to open" walls only. Scaled by tier.
export const WALL_INDEX = byTier({ high: 2 * GB, mid: 1.5 * GB, low: 400 * MB }); // cheap index/browse: archives, disk images
export const WALL_PARSE = byTier({ high: 1 * GB, mid: 600 * MB, low: 250 * MB }); // full in-memory parse: g-code

// ---- mobile OOM guards (isLowMemoryDevice-gated) ----
// Unified DOWN to the minimum of the former set (comic 250 / djvu 200 / sqlite 300).
// Raising a mobile guard would re-introduce phone tab-crashes, so this only ever
// tightens. Flat (already only applied on low-memory devices).
export const MOBILE_WALL = 200 * MB;

// ---- non-wall device switches (their own category - NOT walls) ----
export const DECODE_FULL_MAX = 120 * MB;   // psd: decode every layer vs fall back to the embedded thumbnail. Never raise.
export const FFMPEG_MEMFS_MAX = 1.2 * GB;  // video: WASM MEMFS fallback copy ceiling (silent skip, not a decline)

// ---- decompression ceilings ----
// DO NOT TIER - these cap attacker-controlled expansion ratios (zip/xz/lzma bombs),
// not device capability. A zero-backend site has nowhere to stream output to, so the
// ceiling is the only defence. Tiering them up would walk a high-RAM machine further
// into a decompression bomb. Keep flat.
export const DECOMP_OUTPUT_MAX = 256 * MB;  // lzma/xz/legacy inflated output
export const DECOMP_DICT_MAX = 128 * MB;    // lzma dictionary window
export const DECOMP_ENTRY_MAX = 64 * MB;    // single inflated archive entry (davinci; premiere MAX_XML)

// ---- scan windows: only the first N bytes are read/scanned ----
export const SCAN_SMALL = 8 * MB;
export const SCAN_MED = 64 * MB;
export const SCAN_LARGE = 128 * MB;
export const SCAN_XL = 256 * MB;

// ---- animation ----
// Total decoded-RGBA budget for animated GIF/WebP. On the eager path it caps the
// frame count (floor(budget / (w*h))); on a lazy frame-source it is the retained
// decoded-frame cache-window size. Scaled by tier (120e6 = the historical default).
export const ANIM_PIXEL_BUDGET = byTier({ high: 240e6, mid: 120e6, low: 60e6 });

// ---- preview / enumeration / timeout caps ----
export const ROW_PREVIEW = 500;            // rows shown in a table preview
export const LIST_ENTRIES_MAX = 100000;    // max filesystem/archive entries enumerated
export const PREVIEW_EDGE = 1024;          // decoded-preview longest edge (px)
export const CONVERT_TIMEOUT_MS = 45000;   // per-file conversion timeout in a folder scan
