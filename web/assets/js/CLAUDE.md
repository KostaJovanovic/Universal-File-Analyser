# web/assets/js - module inventory

The app JS. This file loads only when Claude works with files under
`web/assets/js/`; the repo-wide rules live in the root `CLAUDE.md`.

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
    photo.js · photo-convert.js · photo-recover.js · sonify.js · tiff.js · mpo.js · ico · embedded-images.js
      — photo analysis (EXIF, histogram, OCR), HEIC/RAW conversion, multi-image;
      photo-recover.js salvages broken/truncated/corrupt stills (repair a cut-off
      JPEG/PNG, rebuild a damaged JPEG header from a reference photo, carve
      embedded images out of a blob) - the stills twin of video-recover.js.
      sonify.js is the inverse of spectrogram.js (image → sound, oscillator-bank
      or Griffin-Lim) - not a top-level type but lazy-imported by photo.js's
      "Sonify" button, so it lives in renderers/ and ships in sw.js SHELL
    audio.js · audio-analysis.js · audio-codec.js · audio-player.js · spectrogram.js
      · media-reverse.js · audio-dsp.js/-client.js/-worker.js — audio playback,
      codec/loudness analysis, spectrogram; the audio-dsp trio runs the heavy
      forensic pass sequence off the main thread
    video.js · video-avi.js · video-recover.js · video-telemetry.js — video player +
      per-frame/stream analysis; video-recover.js salvages truncated/unfinalised
      MP4-MOV with no moov index (carves H.264/H.265 NALs from the mdat, borrows
      SPS/PPS in-band or from a reference clip, plays via the raw-stream segmented
      player); video-telemetry.js reads timed-metadata tracks (GoPro GPMF,
      Android/Google CAMM, container GPS) into a map + IMU timeline
    pdf.js · paged.js · djvu.js — PDF (pdf.js), paginated docs, DjVu scans
    docx.js · xlsx.js · xlsb.js · pptx.js · odf.js · legacy-office.js · textdoc.js
      · iwork.js · epub.js · mobi.js · mdb.js · notebook.js · markdown.js
      — office/document/e-book/notebook viewers
    svg.js · illustrator.js · psd.js · paint.js · diagram.js · lut.js · font.js
      — vector/raster design files, colour LUTs, font specimens
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
                    disk, osmisc) + parser-util.js shared helpers
  lib/            — shared binary + WASM loader helpers: plist · cfbf · nrbf ·
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
