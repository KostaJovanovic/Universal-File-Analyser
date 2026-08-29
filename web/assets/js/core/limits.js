/* Analyser - central resource limits & device tiering
   Single source of truth for every memory/size cap in the app: whole-file
   "too large" walls, mobile OOM guards, decompression-bomb ceilings, first-N-byte
   scan windows, the animation pixel budget, and assorted preview/enumeration
   caps. Before this module these lived as scattered magic numbers with no shared
   convention; centralising them keeps related formats consistent and makes the
   device-scaling policy legible in one place.

   THE RULE: do not hardcode a size, memory or enumeration threshold in a parser
   or a renderer. Add it here with a comment saying what it protects, then import
   it. A number that lives at its use site is invisible to the next person tuning
   the format next to it, and that is exactly how the scattered magic numbers this
   module replaced came about.

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
    if (_tier)
        return _tier;
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
export const DECODE_FULL_MAX = 120 * MB; // psd: decode every layer vs fall back to the embedded thumbnail. Never raise.
export const FFMPEG_MEMFS_MAX = 1.2 * GB; // video: WASM MEMFS fallback copy ceiling (silent skip, not a decline)
// ---- decompression ceilings ----
// DO NOT TIER - these cap attacker-controlled expansion ratios (zip/xz/lzma bombs),
// not device capability. A zero-backend site has nowhere to stream output to, so the
// ceiling is the only defence. Tiering them up would walk a high-RAM machine further
// into a decompression bomb. Keep flat.
export const DECOMP_OUTPUT_MAX = 256 * MB; // lzma/xz/legacy inflated output
export const DECOMP_DICT_MAX = 128 * MB; // lzma dictionary window
export const DECOMP_ENTRY_MAX = 64 * MB; // single inflated archive entry (davinci; premiere MAX_XML)
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
export const ROW_PREVIEW = 500; // rows shown in a table preview
export const LIST_ENTRIES_MAX = 100000; // max filesystem/archive entries enumerated
export const PREVIEW_EDGE = 1024; // decoded-preview longest edge (px)
export const EMBEDDED_IMAGES_MAX = 24; // pictures listed in an "embedded images" grid
// Largest single preview carved out of a container that stores one (a DWG image
// section, a DOS EPS TIFF preview, a Blender TEST block). A real one is tens to
// hundreds of KB - this exists only to reject a corrupt or hostile length field
// before it becomes an allocation, so it is deliberately flat and generous.
export const PREVIEW_CARVE_MAX = 32 * MB;
export const CONVERT_TIMEOUT_MS = 45000; // per-file conversion timeout in a folder scan
// ---- whole-file hashing ----
// Above this size the Integrity card is skipped entirely: producing it streams the
// WHOLE file through crypto.subtle for the SHA-256, which on a multi-hundred-MB
// file costs more than the fingerprint is worth mid-analysis. Every renderer that
// appends an integrity card gates on this - it was the same literal copy-pasted
// into 17 call sites before it moved here. Sits just below HASH_JS_MAX, which caps
// the *extra* JS-only rows inside a card that is already being built.
export const HASH_FILE_MAX = 500 * MB;
// ---- full in-memory reads ----
// extractAviData() pulls an entire AVI into an ArrayBuffer to carve its MJPEG
// frames and PCM audio, so it stops there. Above this size openAviData() does NOT
// decline the file: it switches to the streamed path, indexing the movi chunk
// table (offsets and sizes only) and reading each JPEG frame off disk on demand -
// the same trade gif-frames.js makes when it composites a large GIF lazily rather
// than materialising every frame. Deliberately flat, NOT tiered: this is the
// historical eager ceiling, and dropping it to WALL_PARSE's low tier would stop
// low-memory devices opening AVIs they handle fine today.
export const AVI_EXTRACT_MAX = 500 * MB;
// Streamed path only. Total PCM bytes worth pulling off disk and holding as a
// decoded AudioBuffer: past this the sound is skipped (the frames still play, and
// the viewer says so) rather than trading a multi-hundred-MB allocation - the one
// thing the streamed path exists to avoid - for a soundtrack.
export const AVI_AUDIO_PCM_MAX = 150 * MB;
// Streamed path only. Sliding window for the chunk-header walk and the audio
// gather - the most of the file resident at once while indexing.
export const AVI_STREAM_WINDOW = 8 * MB;
// Streamed path only. Ceiling on indexed movi chunks (12 bytes each across the
// offset/size typed arrays, so ~12 MB at the cap, and already hours of MJPEG).
// Past it the tail is left unindexed rather than letting the index grow unbounded.
export const AVI_INDEX_MAX = 1_000_000;
// Streamed path only. Retained decoded-frame cache: the LRU of JPEG frames read
// back off disk, so scrubbing backwards doesn't re-read every step. The streamed
// counterpart of ANIM_PIXEL_BUDGET (compressed bytes here, not RGBA pixels).
export const AVI_FRAME_CACHE = byTier({ high: 96 * MB, mid: 64 * MB, low: 32 * MB });
// Repairing an iOS CgBI PNG (lib/cgbi.js) reads the whole file, inflates it and
// builds an RGBA buffer, so it holds roughly 6x the file in memory at the peak.
// These are app icons and UI assets out of an .ipa - kilobytes, not megabytes -
// so a modest ceiling costs nothing real and stops a hostile "PNG" claiming a
// 20000x20000 canvas from being decoded on a phone.
export const CGBI_REPAIR_MAX = 64 * MB;
// ---- compute-cost guards (bound main-thread work, not memory) ----
// Above this size the pure-JS MD5 / CRC-32 in extraHashRows() are skipped: they
// walk the file byte-by-byte (no crypto.subtle equivalent exists) and would freeze
// the tab for several seconds on a multi-hundred-MB file. The SHA-1/SHA-512 rows,
// which run natively, still compute. Normal files are far below this, so day-to-day
// behaviour is unchanged; only the rare very large file loses the two JS-only rows.
export const HASH_JS_MAX = 512 * MB;
// Node-count ceiling for inline SVG sanitisation. Above this an untrusted SVG is
// declined for preview rather than walked attribute-by-attribute (an O(nodes) scan
// with regexes that freezes on a 100k+ element file, e.g. a DWG-derived drawing).
// Purely a responsiveness guard - it never weakens sanitisation; an oversized SVG
// simply is not inlined.
export const SVG_MAX_NODES = 150000;
//# sourceMappingURL=limits.js.map