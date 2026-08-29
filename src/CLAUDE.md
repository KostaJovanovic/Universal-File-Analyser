# src - module inventory

The app source. This file loads only when Claude works with files under `src/`;
the repo-wide rules live in the root `CLAUDE.md`.

**These are TypeScript sources.** `tsc` compiles them 1:1 into
`web/assets/js/**/*.js`, which is generated output - never edit it, and never
add a module there. The tree shape and every filename below are unchanged apart
from the extension (`core/app.ts` -> `web/assets/js/core/app.js`), so the paths
in `sw.js`'s `SHELL`, `core/offline-tiers.ts` and `check-shell.mjs` still refer
to the emitted `.js`. Import specifiers are written with a **`.js`** extension in
source (`import { el } from '../core/util.js'`) - TypeScript resolves that to the
`.ts` file and emits the specifier verbatim, which is what keeps the module graph
and the offline manifest intact. Keep writing them that way.

**The tree compiles clean** - zero errors under both configs, with **`strict`
on** (`strictNullChecks` + `noImplicitAny` included). A new error is a real one,
so fix it rather than letting a pile start again - and fix it with an
annotation, an `as` cast, a `!` assertion or a new `interface`, never a runtime
guard. Type syntax erases, so the emitted JS must stay byte-identical; that is
the only regression net here. Also: never put a `type`/`interface` between a doc
comment and the declaration it documents, or the comment disappears from the
emit. Full rules in the root `CLAUDE.md`.

Shared types live in `core/types.d.ts` - `Kind`, `Route`/`RouteTable`,
`Renderer`, `Row` (the parser row bag, including the `_sections`/`_previewNode`
payload keys) and the worker message protocols. It's a `.d.ts` on purpose: it
emits no `.js`, so it needs no `sw.js` `SHELL` entry and adds no runtime weight.
Import from it with `import type { Row } from '../core/types.js'`.

One module per top-level type: `classify.js` maps a dropped file to a kind,
`ROUTES` in `core/app.js` maps that kind to a renderer here.

```
js/
  core/
    app.js        — entry point: ROUTES table, resolveKind()/handleFile
                    analysis pipeline, boot(). COMMIT_COUNT lives here.
    classify.js   — classifyFile(file): name/extension/MIME → a ROUTES kind
                    (no byte sniffing). Exposed as window._anrClassify.
    file-sniff.js — content-based sniffing: what a file ACTUALLY is from its
                    leading bytes; drives handleFile reroutes and the folder scan
    forensics.js  — forensic integrity cards (signature mismatch, trailing data)
                    built on the file-sniff.js result
    limits.js     — single source of truth for every size/memory cap: device
                    tiering, "too large" walls, mobile OOM guards, decompression-
                    bomb ceilings, first-N-byte read budgets
    formats.js    — central format catalog (sets + display tables + catalogGrouped())
    format-overlay.js — renders the catalog into the help overlay / about / hub,
                    stamps [data-fmt-count], wires the format search + deep-links
    search.js     — metadata search
    navigate.js   — SPA router (View Transitions API)
    effects.js    — page atmosphere/glow/transition effects
    overlays.js   — transient chrome shared by the drop pipeline (confirm modal,
                    drop loader bar, type-suggestion nudge, link-leave confirm)
    popups.js     — modal, suggestion + share-nudge popups
    osint.js      — network-indicator (OSINT) extraction: pulls URLs/IPs/domains/
                    emails from a file's text into a card of click-to-open lookup
                    links (nothing sent automatically — the no-upload promise holds)
    history.js    — anonymous analysed-count stats ping (the only network call)
                    + on-device "Recently analysed" localStorage history (metadata only)
    offline-tiers.js — "Download for offline use" footer: cumulative cache tiers,
                    PWA install prompt, clear-storage button
    stats-page.js — the /stats page (totals, per-ext table, leaderboard, trend chart)
    patch-tldr.js — the /patch "tl;dr" release-group digest toggle
    docs.js       — client behaviour for the generated /docs pages (theme
                    toggle, sidebar filter, footer contact). The docs pages
                    don't load app.js, so this stands in for it there.
    export-data.js — "export analysis data" (JSON/hash) builder
    video-sync.js — shared video↔analysis scrubbing/sync helpers
    util.js       — shared DOM helpers (el, fileExt, …) and formatters
    binutil.js    — shared binary toolkit (cursor reader, decoders, magic)
    sanitize.js   — THE HTML/URL sanitiser. Any viewer that renders markup from
                    an untrusted file inline (email.js, textdoc.js's MHTML,
                    epub.js chapters, svg.js) must go through this - the site
                    ships no CSP, so it is the only thing stopping a crafted
                    file executing script in the page's own origin. Never
                    hand-roll a second copy: there used to be four, they drifted,
                    and three carried a javascript:-scheme bypass
  renderers/      — one module per top-level type (classifyFile() routes to these
                    via ROUTES in app.js). Inventory by domain:
    photo.js · photo-convert.js · photo-recover.js · sonify.js · tiff.js · mpo.js · ico.js · embedded-images.js
      — photo analysis (EXIF, histogram, OCR), HEIC/RAW conversion, multi-image;
      photo-recover.js salvages broken/truncated/corrupt stills (repair a cut-off
      JPEG/PNG, rebuild a damaged JPEG header from a reference photo, carve
      embedded images out of a blob) - the stills twin of video-recover.js.
      sonify.js is the inverse of spectrogram.js (image → sound, oscillator-bank
      or Griffin-Lim) - not a top-level type but lazy-imported by photo.js's
      "Sonify" button, so it lives in renderers/ and ships in sw.js SHELL.
      embedded-images.js is the shared grid for "this file contains pictures",
      and it is no longer only an image-format thing: dwg.js (AutoCAD saved
      preview), model3d.js (3MF package thumbnails, slicer plate renders,
      textures), proprietary.js (.blend TEST-block thumbnail),
      parsers-email.js (vCard PHOTO/LOGO) and parsers-image.js (EPS stored
      preview) all feed it too. Its rgbaToPngBlob() export is there for the
      previews stored as bare pixels rather than as an encoded image
    tracker.js — MOD/XM/IT/S3M and ~60 relatives. A module is a SCORE (samples +
      pattern grid), not recorded audio, so lib/openmpt-loader.js renders it to
      PCM with libopenmpt offline and hands the buffer to renderAudio() - the
      whole Sound section then works unchanged. The tracker card above it carries
      what a WAV has no equivalent of: tracker, channels, patterns, song message
      and the sample/instrument name lists
    audio.js · audio-analysis.js · audio-codec.js · audio-player.js · spectrogram.js
      · media-reverse.js · audio-dsp.js/-client.js/-worker.js — audio playback,
      codec/loudness analysis, spectrogram; the audio-dsp trio runs the heavy
      forensic pass sequence off the main thread
    video.js · video-avi.js · video-bitstream.js · video-recover.js · video-telemetry.js
      — video player + per-frame/stream analysis; video-avi.js parses the RIFF
      container browsers can't play and has two paths behind one interface -
      whole-file below AVI_EXTRACT_MAX, and above it an indexed/streamed one
      (openAviData) that reads each MJPEG frame off disk on demand, so a
      multi-GB AVI opens instead of being declined; video-bitstream.js is the DOM-free
      metadata layer below the container: H.264/H.265 SPS parsing (profile, tier,
      level, geometry, bit depth, chroma, VUI colour + frame rate), the avcC/hvcC
      config records MP4 and Matroska both wrap an SPS in, and the Matroska/WebM
      EBML track walk - it returns the same { video, audio, durationSec } shape for
      every container so video.js has one readout path;
      video-recover.js salvages truncated/unfinalised
      MP4-MOV with no moov index (carves H.264/H.265 NALs from the mdat, borrows
      SPS/PPS in-band or from a reference clip, plays via the raw-stream segmented
      player); video-telemetry.js reads timed-metadata tracks (GoPro GPMF,
      Android/Google CAMM, container GPS) into a map + IMU timeline
    pdf.js · paged.js · djvu.js — PDF (pdf.js), paginated docs, DjVu scans
    docx.js · xlsx.js · xlsb.js · pptx.js · odf.js · legacy-office.js · textdoc.js
      · iwork.js · epub.js · mobi.js · mdb.js · notebook.js · markdown.js
      — office/document/e-book/notebook viewers
    svg.js · illustrator.js · psd.js · paint.js · aseprite.js · xcf.js ·
      sketch.js · diagram.js · lut.js · font.js
      — vector/raster design files, colour LUTs, font specimens.
      aseprite.js decodes .aseprite/.ase pixel art: every frame is COMPOSITED
      from the layer stack (frames store only changed cels, and a cel may link
      back to an earlier frame), then played at each frame's own duration.
      `.ase` collides with Adobe Swatch Exchange, so VARIANT_REROUTE +
      detectVariant send a palette file to proprietary.js on its magic instead.
      xcf.js is the same shape for GIMP, and is the one viewer here that MUST
      composite: an XCF contains no flattened image, only layers, so the picture
      is built by decoding each layer's 64x64 tiles (raw / RLE / zlib) and
      blending them with mask, opacity and blend mode. 8-bit precision only;
      16/32-bit files are described rather than drawn. Pointers are 32-bit
      below XCF v11 and 64-bit from v11 - the easiest thing to get wrong.
      sketch.js reads .sketch, which is a ZIP of JSON and therefore fully
      readable: pages/<uuid>.json holds each page's layer tree, every object
      carrying a `_class` and a `frame`. Beyond the tree it pulls out the two
      things a design review needs - symbolMaster/symbolInstance counts (which
      components the design actually rests on) and every string in the document.
      Figma's .fig is NOT here on purpose: it is a Kiwi message whose schema
      ships inside the file and changes per Figma version, so parsers-image.js
      reads out the container and stops rather than guessing
    stl.js · model3d.js · gcode.js · unity.js — 3D viewers + G-code toolpath + Unity assets
    dwg.js · model3d.js · solidworks.js · f3d.js — CAD (DWG 2D drawing; STEP/IGES/BREP
      via OpenCASCADE; SolidWorks .sldprt/.sldasm/.slddrw - OLE2 preview+metadata
      for older files, identify-only for modern encrypted ones; f3d.js reads
      Autodesk Fusion 360 .f3d/.f3z packages - a Zstd ZIP whose BREP geometry is
      proprietary, so it reports the manifest/contents rather than rendering)
    altium.js · kicad.js · spice.js · ipcnet.js · eda-viewer.js — EDA/electronics
      (PCB projects, SPICE netlists, IPC netlists); eda-viewer.js is the shared
      pan/zoom/fit/layer-toggle SVG viewer used by both board renderers
    aftereffects.js · premiere.js · davinci.js · vegas.js · sony-rtmd.js · timeline.js
      — NLE/VFX project files (AE/Premiere/Resolve/VEGAS) + EDL/FCPXML/OTIO timelines
    daw.js        — DAW sessions with a readable arrangement: Ableton Live
                    (.als/.alp - gunzip, then LiveSet XML) and Reaper
                    (.rpp/.rpp-bak - nested plain text). Live times clips in
                    BEATS, Reaper in seconds, so the tempo is what makes an
                    Ableton timeline a real clock; with no tempo the ruler says
                    "in beats" rather than guessing. Arrangement clips only for
                    Live - session-view clips have no timeline position, so
                    placing them on one would be an invention. FL Studio's .flp
                    stays on parseFlp() in proprietary.js: its clip positions
                    live in data events whose layout varies by FL version
    midi.js · subtitles.js · lrc.js — MIDI score, SRT/VTT/ASS subs, LRC lyrics
    csv.js · gcsv.js · tablekit.js · dataview.js · gitobject.js · email.js —
      tabular/IMU/data/git/email; tablekit.js is the table workbench (virtualised
      grid, stats bar, group-by, charts) mounted below any CSV/XLSX/XLSB/ODS analysis
    diskimage.js · diskimage-fat.js — raw disk-image browser: mounts a FAT12/16/32
      image as a browsable tree + treemap (click a file to analyse it).
      diskimage-fat.js is the DOM-free FAT/MBR parser half
    gif-encode.js · gif-frames.js · webp-frames.js — animated-image frame tooling
    lottie.js — Lottie/Bodymovin JSON vector animation player (also dotLottie
      .lottie ZIPs and Telegram .tgs gzip stickers), via the vendored lottie-web
    archive.js · zip.js · folder.js · treemap.js · folder-archive-shared.js · comic.js
      — archive/folder browsing + treemap breakdown + comic (CBZ/CBR) reader
    vssolution.js · geo.js — VS solution manifests, GPX/KML/GeoJSON maps
    terraria.js   — Terraria .wld worlds: header readout + a map drawn one pixel
                    per tile from the RLE tile stream. Only the header fields up
                    to maxTilesX are parsed - the rest is skipped by seeking to
                    the tile SECTION POINTER, which is what makes this tractable
                    across versions. `.wld` is also the Esri world file, so
                    VARIANT_REROUTE routes on the 'relogic' magic
    photo-forensics.js · video-forensics.js · audio-forensics.js · timeline-forensic.js
      · c2pa.js · ai-signals.js · xmp.js · scrub.js — cross-cutting forensic
      modules, mostly UI-free computation the type renderers mount as cards:
      pixel/JPEG tamper detectors, ISOBMFF structure parsers, DSP over decoded
      samples, an all-file-types timestamp timeline, the C2PA/Content-Credentials
      manifest reader, AI-generation indicators (signals, never a verdict), the
      .xmp develop-sidecar reader, and lossless metadata scrubbing by container
      surgery (no re-encode)
    jpeg-salvage.js · carve-gallery.js — shared recovery internals: a
      fault-tolerant baseline JPEG decoder that renders what it can from a broken
      entropy scan, and the gallery grid for images carved out of raw bytes.
      Used by photo-recover.js, video-recover.js, archive/disk browsing
    compare.js    — the /compare side-by-side view (see "The /compare page")
    unknown.js    — hex dump and basic identification (the 'unknown' fallback)
    proprietary.js — 200+ format identification by magic bytes (lazy chunk dispatch);
                    proprietary-formats.js holds the large FORMATS reference table
  parsers/        — parsers-<domain>.js, lazy metadata parser chunks dispatched
                    by proprietary.js (audio, video, image, raw, docs, dev,
                    archive, gaming, threed, geodata, sci, security, email,
                    disk, osmisc) + parser-util.js shared helpers. Chunks are
                    loaded independently, so anything two of them need lives
                    OUTSIDE both: parser-util.js holds canvasFromRGBA (the
                    checkerboard-backed, size-capped decoded preview every
                    pixel-decoding parser returns as _previewNode), and
                    lib/bcn.js holds the block decoder below.
  lib/            — shared binary + WASM loader helpers: bcn (BC1-BC5 / DXT
                    block decoding for DDS in parsers-image.js and Valve VTF +
                    KTX/KTX2 in parsers-gaming.js) · cgbi (Apple's CgBI PNG -
                    raw-deflate IDATs, BGRA, premultiplied alpha - which NO
                    browser decodes; photo.js repairs one to a real PNG at the
                    top of renderPhoto, so every .ipa icon works) ·
                    pe-packer (PE packer / protector / toolchain identification
                    behind proprietary.js's .exe path. Two halves that answer
                    different questions: a signature table that NAMES things
                    (UPX, VMProtect, Themida, PyInstaller, Go, Rust) and
                    heuristics that MEASURE - chiefly per-section entropy,
                    sampled through limits.js's PE_SECTION_SAMPLE rather than
                    read whole. Packing is what installers and commercial
                    software do as often as malware, so the readout lists
                    evidence and draws no conclusion) ·
                    ssdeep (context-triggered piecewise hashing, from scratch -
                    the published spamsum algorithm, so the strings interoperate
                    with real ssdeep. Answers "how much of these two files is the
                    same" where SHA-256 only answers "are they identical";
                    /compare is the only consumer) ·
                    openmpt-loader (libopenmpt WASM, ~1.5 MB, Everything
                    tier - the vendored file is chiptune3's
                    libopenmpt.worklet.js, which despite the name registers no
                    AudioWorkletProcessor and runs fine on the main thread) ·
                    plist · cfbf · nrbf ·
                    sqlite · legacy-decompress · *-loader (libarchive, xz, lzma,
                    occt, ghostscript, openjpeg) · table-stats.js (DOM-free
                    column typing + numeric stats shared by csv.js and
                    renderers/tablekit.js).
                    Also two on-device model subsystems, same shape
                    (client / model / worker + DSP): MDX-Net vocal separation
                    (mdx-*.js) behind audio.js's isolate panel and the
                    spectrogram vocal/instrumental blend, and DeepFilterNet3
                    denoise (dfn-*.js) behind audio.js's Clean/Noise panel.
  games/          — Asteroids easter-egg game (loaded by atari.html only)
```
