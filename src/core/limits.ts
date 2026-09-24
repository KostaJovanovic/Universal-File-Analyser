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
   the exact pre-existing mobile-guard behaviour. In the Electron desktop app
   `window.anrDesktop.memoryGB` carries the unclamped os.totalmem() figure and
   takes precedence; on the website that global does not exist. */

// Binary units (matches the dominant `N * 1024 * 1024` convention in the codebase).
const MB = 1024 * 1024;
const GB = 1024 * MB;

// ---- device tier (RAM-based, memoised) ----
// Falsy `|| 0` (not `=== undefined`) so any unreported/zero value lands in `mid`,
// identical to gcode's historical `navigator.deviceMemory || 4`.
let _tier: 'high' | 'mid' | 'low';
export function deviceTier() {
  if (_tier) return _tier;
  // Desktop app: the shell reports os.totalmem(), the real figure, so a 32 GB
  // workstation is not read as 8 GB. Same thresholds, better input - this stays
  // one change in one place, per THE RULE above.
  const desktopGB = (typeof window !== 'undefined' && window.anrDesktop && window.anrDesktop.memoryGB) || 0;
  const dm = desktopGB || (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
  _tier = !dm ? 'mid' : dm >= 8 ? 'high' : dm >= 4 ? 'mid' : 'low';
  return _tier;
}

// Pick a value for the current device tier: byTier({ high, mid, low }).
export function byTier<T>({ high, mid, low }: { high: T; mid: T; low: T }): T {
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

// ---- video (renderers/video.ts) ----
// Whole-file FFmpeg remux of a raw H.264/H.265 stream or an MPEG-TS/AVCHD file
// into MP4. The input AND the output MP4 both sit in the WASM heap (the 32-bit
// core caps out near 2 GB), so above this a raw stream switches to the segmented
// player and a TS file goes to the unplayable card. 1400 MB is the historical
// figure; a low-memory phone can't spare that, so it drops to the mobile wall.
export const FFMPEG_REMUX_MAX = isLowMemoryDevice() ? MOBILE_WALL : 1400 * MB;
// The automatic FFmpeg frame-rate probe (only for containers whose rate the JS
// walkers can't read - MediaRecorder WebMs and the like) copies just this much of
// the file's head into FFmpeg: the stream headers plus the 2 s it decodes.
export const FFMPEG_FPS_PROBE_HEAD = byTier({ high: 64 * MB, mid: 32 * MB, low: 16 * MB });
// PCM-audio companion (twos/lpcm/... clips the browser plays mute): reads the
// whole file automatically, and an FFmpeg copy of it on the fallback, so it is
// tiered and much lower on a phone. Was a flat 2 GB.
export const PCM_COMPANION_MAX = isLowMemoryDevice() ? MOBILE_WALL
  : byTier({ high: 1 * GB, mid: 600 * MB, low: 250 * MB });
// "Analyse audio" on a video: Web Audio / the PCM walker need the whole file in
// memory twice (decodeAudioData detaches its copy). Past this, FFmpeg extracts
// the track instead (itself bounded by FFMPEG_MEMFS_MAX).
export const VIDEO_AUDIO_DECODE_MAX = isLowMemoryDevice() ? MOBILE_WALL
  : byTier({ high: 1 * GB, mid: 600 * MB, low: 250 * MB });
// Samples one MP4 PCM track may decode into an AudioBuffer (4 bytes each as
// float32): 256M = 1 GB, about 45 min of 48 kHz stereo. Stops overlapping chunk
// offsets turning a small file into a multi-GB allocation.
export const PCM_DECODE_SAMPLES_MAX = byTier({ high: 256e6, mid: 128e6, low: 48e6 });
// Video Integrity card: SHA-256 runs automatically up to VIDEO_SHA_AUTO_MAX; up to
// VIDEO_SHA_BUTTON_MAX it sits behind a button; past that there is no card.
export const VIDEO_SHA_AUTO_MAX = 200 * MB;
export const VIDEO_SHA_BUTTON_MAX = 2 * GB;
// MP4 sample tables read by the GOP map, the telemetry tracks and Sony rtmd:
// the sample count is a u32 from the file (a fixed-size stsz can claim 4e9
// samples in 20 bytes), so it is bounded by the box, the file and this ceiling -
// 4M samples is 18 hours of 60 fps video. The per-second bitrate buckets stop at
// MP4_SECONDS_MAX (48 h), past which the tail folds into the last bucket.
export const MP4_SAMPLE_TABLE_MAX = 4_000_000;
export const MP4_SECONDS_MAX = 48 * 3600;

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

// Source text a structure parser reads whole (parsers-dev.ts's TypeScript pass,
// which walks the file character by character to strip comments and strings).
// Hand-written source is tens of KB; 4 MB is well past the largest module anyone
// writes and keeps that walk off a multi-GB file that merely carries a source
// extension. Past it the readout says so rather than quietly counting half.
export const SOURCE_SCAN_MAX = 4 * MB;
// Text documents textdoc.ts reads whole and lays out on page sheets (markup
// source, RTF, AbiWord, FictionBook). A novel-length FB2 is a few MB and the
// largest real RTF (embedded pictures, as hex) tens of MB; the pagination below
// builds DOM per page, so past this only the first part is read and shown.
export const TEXTDOC_READ_MAX = 32 * MB;

// c2pa: bytes read from EACH END of a container c2pa.js can't unpack structurally
// (MP4/MOV/HEIF/AVIF/WebP), when hunting the JUMBF manifest store by signature.
// Both ends, because the box is top-level and near ftyp/moov in practice but some
// writers append it. A manifest is ~10-100 KB, so this is already generous - it
// exists to stop a multi-GB video being read whole for a card that needs 6 KB.
export const C2PA_SCAN_EDGE = 8 * MB;
// Largest single embedded manifest store parsed (a signed C2PA store with a full
// cert chain runs a few hundred KB; past this it isn't a manifest).
export const C2PA_MANIFEST_MAX = 8 * MB;
// Inflated size of one compressed PNG text chunk (zTXt / iTXt). These are metadata
// - a generation prompt, an XMP packet, a comment - so a few KB is normal and even
// a bloated XMP stays far below this. It stops a tiny zTXt deflate-bombing the tab.
export const PNG_TEXT_INFLATE_MAX = 4 * MB;
// Head of a still read by photo's Container card (PNG/JPEG/GIF/WebP/BMP header
// walk plus any text/prompt chunks, which sit before the pixel data).
export const IMAGE_CONTAINER_PEEK = 4 * MB;

// ---- animation ----
// Total decoded-RGBA budget for animated GIF/WebP. On the eager path it caps the
// frame count (floor(budget / (w*h))); on a lazy frame-source it is the retained
// decoded-frame cache-window size. Scaled by tier (120e6 = the historical default).
export const ANIM_PIXEL_BUDGET = byTier({ high: 240e6, mid: 120e6, low: 60e6 });
// Largest GIF the photo view reads whole to build its frame-by-frame viewer.
export const GIF_FRAMES_FILE_MAX = 200 * MB;

// ---- layered pixel-art / paint files (aseprite.ts, xcf.ts) ----
// Aseprite: total decoded cel pixels held across every frame of a sprite. Cels are
// stored decoded (RGBA) so any frame can be composited on demand; a hostile file
// can declare thousands of 65535x65535 cels behind tiny zlib streams, so past this
// the remaining cels are skipped (and the viewer says so) rather than inflated.
export const ASE_CEL_PIXEL_BUDGET = byTier({ high: 120e6, mid: 60e6, low: 30e6 });
// GIMP XCF header sanity walls: the widest canvas / layer side, and the most layer
// pointers read, before the file is treated as corrupt. (Formerly literals in xcf.ts.)
export const XCF_EDGE_MAX = 30000;
export const XCF_LAYERS_MAX = 2000;
// XCF: total pixels decoded for one file - canvas + every layer + every applied mask,
// summed from the layer headers BEFORE anything is allocated. Each layer pixel is
// held as raw tile bytes and as RGBA until compositing (~9 bytes at the peak), so
// past this the layer stack is described rather than drawn.
export const XCF_PIXEL_BUDGET = byTier({ high: 200e6, mid: 100e6, low: 50e6 });

// ---- preview / enumeration / timeout caps ----
export const ROW_PREVIEW = 500;            // rows shown in a table preview
export const LIST_ENTRIES_MAX = 100000;    // max filesystem/archive entries enumerated
export const PREVIEW_EDGE = 1024;          // decoded-preview longest edge (px)
export const EMBEDDED_IMAGES_MAX = 24;     // pictures listed in an "embedded images" grid
// Photo OCR upscales the image until its short side reaches 2000 px, which on a
// long thin strip (a 40x8000 banner) would ask for a 2000x400000 canvas. The
// upscale stops at this pixel count and at CANVAS_EDGE_MAX on either side.
export const OCR_CANVAS_MAX_PX = byTier({ high: 40e6, mid: 24e6, low: 12e6 });
// Longest canvas side any browser reliably allocates (Chrome/Firefox 32767,
// Safari 16384 on iOS) - the lowest of them.
export const CANVAS_EDGE_MAX = 16384;
// The photo LSB bit-plane panel renders one full-size plane per channel. Past this
// pixel count the planes are computed on a downscaled copy instead, since a
// 100 MP photo would otherwise hold several 400 MB canvases and data URLs at once.
export const LSB_PLANE_MAX_PX = byTier({ high: 24e6, mid: 16e6, low: 8e6 });
// RAW demosaic (photo-convert.ts): the libraw output is painted to a canvas and
// re-encoded as JPEG. A full 60+ MP sensor canvas plus its ImageData is several
// hundred MB on top of libraw's own buffer and past a phone's canvas-area limit,
// so beyond this pixel count the frame is sampled down to fit. Scaled by tier.
export const RAW_DEMOSAIC_MAX_PX = byTier({ high: 64e6, mid: 36e6, low: 16e6 });
// SubIFD (0x014A) entries followed per IFD when hunting a RAW's embedded JPEGs.
// Real files carry 1-4; the count field is attacker-controlled up to 2^32-1.
export const RAW_SUBIFD_MAX = 16;
// JPEG 2000 decode (lib/openjpeg-loader.ts): total pixels decoded to RGBA. 2^28
// px (~268 Mpx) is Chromium's canvas-area limit - a bigger image would allocate
// a multi-GB RGBA buffer and draw blank anyway. Moved from the loader unchanged.
export const J2K_MAX_PX = 0x10000000;
// Animated WebP frame stepping (webp-frames.ts) reads the whole file into memory
// for ImageDecoder; above this the page keeps the native animated <img> instead.
// Moved from webp-frames.ts unchanged.
export const WEBP_ANIM_FILE_MAX = 200 * MB;
// PSD full decode via ag-psd (psd.ts): canvas pixels in the composite. ag-psd also
// builds a canvas per layer, so a small file with a huge declared canvas (the
// size is a header field, not the byte count) can still exhaust the tab - past
// this the viewer falls back to the embedded thumbnail like an oversized file.
export const PSD_DECODE_MAX_PX = byTier({ high: 100e6, mid: 60e6, low: 24e6 });
// Largest single preview carved out of a container that stores one (a DWG image
// section, a DOS EPS TIFF preview, a Blender TEST block). A real one is tens to
// hundreds of KB - this exists only to reject a corrupt or hostile length field
// before it becomes an allocation, so it is deliberately flat and generous.
export const PREVIEW_CARVE_MAX = 32 * MB;
export const CONVERT_TIMEOUT_MS = 45000;   // per-file conversion timeout in a folder scan

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
// Largest single video chunk (one MJPEG frame) either path will index. A real
// frame is kilobytes to a few MB even at 4K; the size is a u32 from idx1 or the
// chunk header, so without this one hostile entry read up to 4 GB at open.
export const AVI_FRAME_MAX = 32 * MB;

// Repairing an iOS CgBI PNG (lib/cgbi.js) reads the whole file, inflates it and
// builds an RGBA buffer, so it holds roughly 6x the file in memory at the peak.
// These are app icons and UI assets out of an .ipa - kilobytes, not megabytes -
// so a modest ceiling costs nothing real and stops a hostile "PNG" claiming a
// 20000x20000 canvas from being decoded on a phone.
export const CGBI_REPAIR_MAX = 64 * MB;
// Pixel ceiling for a CgBI decode (lib/cgbi.js): checked against the IHDR before
// anything is inflated or allocated. The historical in-file literal.
export const CGBI_MAX_PIXELS = 64_000_000;
// Headroom allowed past a PNG IDAT stream's exact expected inflated size
// ((width * bytesPerPixel + 1) * height) before the inflate is abandoned as a
// bomb. A well-formed stream inflates to exactly that; the slack only forgives an
// encoder that pads, and keeps a lying stream from growing without bound.
export const PNG_IDAT_SLACK = 64 * 1024;

// ---- still-image salvage decoders ----
// Longest edge the fault-tolerant JPEG decoder (renderers/jpeg-salvage.js) will
// accept from a SOF header - the historical in-file literal. Past it the header is
// treated as corrupt and the embedded thumbnail is tried instead.
export const SALVAGE_MAX_EDGE = 20000;
// Pixel ceiling for the JS salvage decoders - jpeg-salvage.js's full-resolution
// planes + RGBA output (~6 bytes a pixel) and photo-recover.js's partial PNG
// decode (RGBA + the inflated scanlines, ~8 bytes a pixel). Checked before either
// allocates, so a hostile header claiming 20000x20000 can't take the tab with it.
// Tiered, and lower again on a phone: 40 MP still covers a normal phone photo.
export const SALVAGE_MAX_PIXELS = isLowMemoryDevice() ? 40e6 : byTier({ high: 150e6, mid: 80e6, low: 40e6 });
// Longest edge of a carved-image gallery thumbnail (renderers/carve-gallery.js),
// in CSS pixels - matches the 200px cap in .anr-carve-thumb so a decoded carve is
// never scaled down again by the browser.
export const CARVE_THUMB_EDGE = 200;

// ---- GPU block-compressed textures ----
// Largest surface lib/bcn.js decodes to RGBA (4 bytes a pixel, so ~256 MB at the
// cap). The historical in-file literal; past it the caller skips the preview.
export const BCN_MAX_PIXELS = 64_000_000;

// ---- XMP sidecars ----
// Bytes of an .xmp sidecar read as text (renderers/xmp.js). A develop recipe is a
// few KB to a few hundred; this only stops a mislabelled huge file being read
// whole into a string and a DOM.
export const XMP_READ_MAX = 8 * MB;

// A tracker module is a score, not a recording: a 40 KB .it can be a
// twelve-minute song, and one written to loop has no end at all. Rendering is
// therefore bounded by OUTPUT seconds rather than input size. At 48 kHz stereo
// float this ceiling is ~110 MB of PCM, in line with what the audio renderer
// already holds for a long WAV; past it the render stops and the viewer says so.
// Tiered: the render holds several copies of that PCM at its peak (libopenmpt's
// planar output plus the AudioBuffer and the analysis passes), so a low-RAM
// device stops sooner.
export const TRACKER_RENDER_MAX = byTier({ high: 600, mid: 360, low: 180 }); // seconds of audio
export const TRACKER_SAMPLE_RATE = 48000;

// A large Terraria world is 8400x2400 tiles - 20 million pixels, ~80 MB of RGBA
// at one pixel per tile. The map is sampled down to this budget instead, which
// still resolves individual ore veins on a large world and keeps a phone in play.
export const TERRARIA_MAP_MAX_PX = 6_000_000;

// A GPS export can hold years of activity - a full Strava or Google Location
// History dump runs to millions of points. The density overlay bins into a
// screen-space grid, so its DRAW cost is bounded by the canvas rather than the
// track, but the binning pass still touches every point on every redraw. Past
// this ceiling the track is sampled at an even stride instead, which changes
// nothing visible: at the zoom levels a track is read at, consecutive points are
// already well under a pixel apart.
export const GEO_HEAT_POINTS = 400_000;
// The pace overlay draws one polyline per run of constant speed band. A noisy
// recording alternates bands every few points, so the run count is capped and
// the remainder falls back to a single track line rather than putting thousands
// of SVG paths on the map.
export const GEO_PACE_RUNS = 4000;

// An IFC is a graph of cross-referencing instances, so it has to be held whole -
// there is no way to follow a reference in a file you have only partly read. A
// large federated model runs to hundreds of megabytes of text; past this it is
// declined rather than allowed to exhaust the tab. The entity and triangle
// ceilings bound the two things that grow inside that: the instance map, and the
// geometry handed to WebGL.
export const IFC_MAX = 320 * MB;
export const IFC_ENTITY_MAX = 4_000_000;
export const IFC_TRI_MAX = 3_000_000;

// A structure file is parsed whole and turned into WebGL geometry, so the real
// cost is the atom count rather than the bytes. A cryo-EM structure or an MD
// trajectory frame set runs to hundreds of thousands of atoms; past the atom
// ceiling the viewer switches to the cartoon, which draws one ribbon per chain
// instead of a sphere and a cylinder per atom.
export const MOLECULE_MAX = 128 * MB;
export const MOLECULE_ATOM_MAX = 60_000;

// A model graph is read from the whole file, because protobuf gives no index -
// finding the GraphProto means walking past everything before it. Weight files
// (safetensors, GGUF, PyTorch) are exempt: those are read through their headers
// and never pulled into memory whole, which is why a 40 GB GGUF still opens.
export const ML_MODEL_MAX = 2 * GB;
// Drawing more boxes than this produces a picture nobody can read, and the
// tables below the diagram cover every node anyway.
export const ML_GRAPH_NODES = 400;
// Structural ceiling on the protobuf walk itself.
export const ML_NODE_MAX = 50_000;
// A GGUF's metadata block holds the tokenizer vocabulary, so it is megabytes
// rather than kilobytes, and it must be read in one piece to walk it.
export const GGUF_HEADER_MAX = byTier({ high: 64 * MB, mid: 32 * MB, low: 8 * MB });

// A DAW project holds no audio - it is an edit list - so a session that has run
// past a few tens of megabytes is not a session, and the whole file is read into
// memory (Ableton's is gzipped XML that expands severalfold). The clip ceiling
// bounds the DOM instead: each clip is an element on the arrangement.
export const DAW_PROJECT_MAX = 64 * MB;
export const DAW_CLIP_MAX = 20_000;

// A Sketch document's layer tree is JSON with no depth or breadth limit of its
// own - a design system file can hold hundreds of thousands of objects, and each
// one becomes a DOM row. The walk stops here and says so, rather than building a
// tree the browser cannot lay out.
export const SKETCH_LAYER_MAX = 50_000;

// DAW timeline sanity: a crafted project can state a tempo of 1e-300 or a clip
// at "1e309", either of which turns the arrangement length into Infinity and the
// ruler loop into a hang. Positions past DAW_POS_MAX (beats or seconds - ~115
// days either way) are dropped, a tempo outside the range is treated as unstated,
// and the ruler never draws more than DAW_RULER_MARKS_MAX marks.
export const DAW_POS_MAX = 1e7;
export const DAW_TEMPO_MIN = 1;
export const DAW_TEMPO_MAX = 1000;
export const DAW_RULER_MARKS_MAX = 200;

// DeepFilterNet3 denoise holds the whole recording at 48 kHz several times over
// (the resampled input, the padded copy, two overlap-add accumulators and the
// clean + noise stems - roughly 24 bytes per sample per channel), so an hour of
// stereo would need ~4 GB. Past this many seconds the denoise is declined before
// anything is resampled.
export const DFN_DURATION_MAX = byTier({ high: 20 * 60, mid: 10 * 60, low: 5 * 60 });

// Fuzzy hashing (ssdeep) reads the whole file into one array and may walk it more
// than once - it halves the block size and starts over when the first pass gives
// too short a signature. The work is cheap per byte, but it is a full read, so a
// file past this ceiling reports "too large" rather than stalling /compare.
export const FUZZY_HASH_MAX = 256 * MB;

// Packer detection measures each PE section's entropy. Entropy is a property of
// the byte distribution, so a sample settles to within a few hundredths of a bit
// of the whole-section figure - reading a 200 MB section in full to learn the
// same number would be the only expensive part of the analysis. The marker scan
// reads this much from each END of the file: a packer stub sits near the entry
// point at the front, and bundled runtimes leave their cookie in the overlay.
export const PE_SECTION_SAMPLE = 512 * 1024;
export const PE_PACKER_SCAN = 256 * 1024;

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

// ---- parser-chunk read budgets (src/parsers/*) ----
// The metadata parsers read a head of the file into memory and decode from it.
// Raster decoders need the whole first image, so they read more; text formats
// are parsed from a capped head and say so when the file runs past it.
export const PARSE_IMAGE_READ_MAX = 32 * MB;   // default raster read (TGA, PCX, Sun, SGI, ...)
export const PARSE_NETPBM_READ_MAX = 48 * MB;  // PBM/PGM/PPM/PAM: a raw 16-bit PPM is large
export const PARSE_TEXTURE_READ_MAX = 64 * MB; // DDS: header + the first mip of a large texture
export const PARSE_TEXT_MAX = 8 * MB;          // text-format parsers (feeds, INI, logs, geodata)
export const SCI_FRAME_MAX = 96 * MB;          // one DICOM / FITS frame decoded for preview
export const NIFTI_READ_MAX = 256 * MB;        // NIfTI volume read for the slice preview
export const NIFTI_SLICE_MAX = 64 * MB;        // one NIfTI axial slice decoded for preview
export const PARSE_JP2_READ_MAX = 96 * MB;     // JPEG 2000 handed whole to the OpenJPEG preview

// ---- graph-walk budgets for 3D / CAD / EDA files (work, not memory) ----
// IFC: steps across the spatial-tree build and the geometry walk (mapped items
// nest, and a representation shared by many parents fans out exponentially with
// no cycle for a visited check to catch). Past it the walk stops and draws what
// it has. Well past the node count of any real federated model.
export const IFC_WALK_MAX = 2_000_000;
// glTF: node instances drawn from the scene graph. Children may be shared, so a
// 40-deep chain of nodes each listing the next twice is 2^40 visits.
export const GLTF_VISIT_MAX = 200_000;
// OBJ/OFF/PLY: vertices in one polygon. A real n-gon has tens; a list length in
// the millions is a stream that has lost its place.
export const MESH_FACE_VERTS_MAX = 65_536;
// SPICE .raw: variables in one capture. Each is a separate array and the count
// is the record stride; a real netlist probes hundreds, a large one thousands.
export const SPICE_VARS_MAX = 65_536;
// NLE timelines (Resolve / Premiere / After Effects): grid lines drawn under
// the clips. A duration stated in the file sizes the ruler; past this many
// ticks the step widens instead.
export const TIMELINE_TICKS_MAX = 2000;

// ---- object-graph budgets for serialised formats (work + memory) ----
// .NET BinaryFormatter (lib/nrbf.js): values materialised across the WHOLE
// stream - objects, array slots and the null runs ObjectNullMultiple encodes
// in a few bytes (14 bytes can claim five million nulls). Per-array caps alone
// let a stream repeat that record into gigabytes.
export const NRBF_ELEMENT_MAX = 5_000_000;
// Nested "readable text" dumps of a decoded object graph (proprietary.js's
// prettyKV, used for NRBF and VDF): output characters and nesting depth. A
// graph that shares children (a DAG) or refers back to itself would otherwise
// print exponentially or forever.
export const READABLE_TEXT_MAX = 2 * MB;
export const READABLE_DEPTH_MAX = 64;
// Compound-file (CFBF/OLE2) directory tree depth (lib/cfbf.js). Real documents
// nest a handful of storages; the red-black sibling links give a crafted file a
// way to make the walk revisit the same children at every level.
export const CFBF_DEPTH_MAX = 32;
// JSON structure stats for an extensionless JSON file (renderers/unknown.js):
// nodes visited before the walk stops and reports a partial count.
export const JSON_STATS_NODES_MAX = 2_000_000;

// ---- spreadsheet / table / paged-document guards (work + DOM size) ----
// Excel's own grid: 1,048,576 rows x 16,384 columns (XFD1048576). A cell
// reference past it is not a real cell and is ignored, so one crafted
// <c r="XFD1048576"> cannot size the grid on its own.
export const EXCEL_ROWS_MAX = 1_048_576;
export const EXCEL_COLS_MAX = 16_384;
// Cells a sheet may bring into the table workbench (xlsx.js / xlsb.js). The
// grid is built as dense rows, so the extent is clamped to this many cells
// (and columns to SHEET_COLS_MAX) and the sheet says it was cut short.
export const SHEET_CELLS_MAX = 4_000_000;
export const SHEET_COLS_MAX = 2048;
// Columns the table workbench grid draws at once (renderers/tablekit.js): each
// rendered row is one cell per column. Hidden columns do not count.
export const TABLE_GRID_COLS_MAX = 256;
// Height of the table workbench's scroll spacer. Past it the scroll position
// maps proportionally onto the rows - browsers stop laying out an element
// somewhere around 17M px (Firefox) and the tail rows would be unreachable.
export const TABLE_SCROLL_PX_MAX = 8_000_000;
// Page sheets paginateFlow lays out for a flowing document (renderers/paged.js),
// and the lines paginateText turns into blocks before that.
export const PAGED_PAGES_MAX = 600;
export const PAGED_TEXT_LINES_MAX = 60_000;
// Children of one node the data tree viewer (renderers/dataview.js) renders per
// "show more" step - a one-million-entry array would otherwise be a million rows.
export const DATAVIEW_CHILD_BATCH = 500;
// ODF <text:s text:c="n">: spaces one element may expand to.
export const ODF_SPACE_RUN_MAX = 1000;
// Ghostscript (lib/ghostscript-loader.js): PostScript / EPS size accepted for a
// preview, and how long the interpreter may run once loaded before it is
// stopped. PostScript is a programming language - `{} loop` never ends.
export const GS_INPUT_MAX = 64 * MB;
export const GS_TIMEOUT_MS = 30_000;
