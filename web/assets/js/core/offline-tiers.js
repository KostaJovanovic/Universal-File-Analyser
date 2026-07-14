/* Analyser - offline download tiers, PWA install prompt and clear-storage.
   The whole 'Download for offline use' footer section: the cumulative tier
   manifests (Essentials/Everything/Complete), per-tier download + progress +
   'Cached' badge logic, the collapsible section, the beforeinstallprompt-based
   install button, and the clear-storage button. setupOfflineTiers() is called
   once from boot(); it queries its own DOM by id/class, so it is a no-op on
   pages without the offline markup. COMMIT_COUNT / RELEASE_COMMITS / analyserVersion
   are passed in (COMMIT_COUNT is bumped in app.js by save.bat, so it must live there).

   NOTE: TIERS.essentials below is the offline manifest of app modules - keep it in
   step with sw.js SHELL when adding a new core/renderer/parser module. */

import { el } from './util.js';
import { renderHistoryPanel } from './history.js';
import { MDX_OFFLINE_URLS, MDX_TIER_MB } from '../lib/mdx-model.js';

// Browser/platform-specific "how to install" hint, shown on the install button
// when the native install prompt is not available (iOS, Safari, Firefox, or a
// browser that has not fired beforeinstallprompt yet). Sniffs the user agent for
// the common cases and falls back to a generic line. British spelling, no
// em-dashes, to match the site's user-facing copy.
function installHint() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports a desktop Safari UA, so also treat a touch-capable Mac as iOS.
  const isIos = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  // Order matters: Edge / Opera / Samsung user agents all also contain "Chrome".
  const isEdge = /Edg\//.test(ua);
  const isOpera = /OPR\//.test(ua) || /\bOPT\//.test(ua);
  const isSamsung = /SamsungBrowser/.test(ua);
  const isFirefox = /Firefox\//.test(ua) || /FxiOS/.test(ua);
  const isChrome = /Chrome\//.test(ua) && !isEdge && !isOpera && !isSamsung;
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
  const isWindows = /Windows/.test(ua);

  if (isIos) {
    // Since iOS 16.4, third-party browsers (Chrome, Edge, Firefox, Opera) can
    // also add a site to the Home Screen from the Share sheet - it is no longer
    // Safari-only - so the same instruction works everywhere.
    return 'Tap the Share button, then "Add to Home Screen".';
  }
  if (isAndroid) {
    if (isFirefox) return 'Open the menu (⋮), then "Install", or "Add to Home screen".';
    if (isSamsung) return 'Open the menu (≡), then "Add page to", then "Home screen".';
    return 'Open the menu (⋮), then "Install app", or "Add to Home screen".';
  }
  // Desktop.
  if (isEdge) return 'Click the app icon at the right of the address bar, or open the menu (…), then Apps, then "Install this site as an app".';
  if (isChrome) return 'Click the install icon at the right of the address bar, or open the menu (⋮), then "Cast, save and share", then "Install page as app".';
  if (isOpera) return 'Look for the install icon in the address bar, or open the menu, then "Install".';
  if (isSafari) return 'From the menu bar choose File, then "Add to Dock". (Needs Safari 17 or newer on macOS Sonoma.)';
  // Firefox's "Add to Taskbar" web-app feature is Windows-only for now (macOS and
  // Linux are planned but not shipped), so only point Windows users at the icon.
  if (isFirefox) return isWindows
    ? 'Click the "Add to Taskbar" icon at the right of the address bar to add it to your taskbar.'
    : 'Firefox on macOS and Linux cannot install web apps yet. Open this page in Chrome or Edge to install it, or just bookmark it.';
  return 'Open your browser menu and look for "Install app" or "Add to Home Screen".';
}

export function setupOfflineTiers(COMMIT_COUNT, RELEASE_COMMITS, analyserVersion) {
  // ----- Offline download buttons -----
  const TESS_DATA = 'assets/vendor/tesseract';
  const TESS_WORKER = 'assets/vendor/tesseract/worker.min.js';

  // Canonical per-tier download sizes - the SINGLE source of truth. Tiers are
  // cumulative (each includes every lower tier's files), so TIER_MB are totals in MB.
  // TIER_SIZES (the labels stamped onto the buttons + help-panel legend on every page,
  // and used by the post-clear reset) derive from it, and the "+N MB more" upgrade
  // deltas in refreshTierButtons() use the numbers directly. One place to edit.
  const TIER_ORDER = ['essentials', 'everything', 'complete'];
  const TIER_MB = { essentials: 50, everything: 120, complete: 345 + MDX_TIER_MB };
  const TIER_SIZES = {};
  TIER_ORDER.forEach((t) => { TIER_SIZES[t] = '~' + TIER_MB[t] + ' MB'; });

  const TIERS = {
    essentials: [
      './', './about', './patch', './compare', './manifest.json', './assets/css/analyser.css', './assets/css/fonts.css',
      './assets/js/core/app.js', './assets/js/core/formats.js', './assets/js/core/util.js', './assets/js/core/search.js',
      './assets/js/core/stats-page.js', './assets/js/core/history.js', './assets/js/core/file-sniff.js', './assets/js/core/forensics.js', './assets/js/core/overlays.js', './assets/js/core/patch-tldr.js', './assets/js/core/offline-tiers.js', './assets/js/core/format-overlay.js', './assets/js/core/classify.js',
      './assets/js/renderers/photo.js', './assets/js/renderers/scrub.js', './assets/js/renderers/c2pa.js', './assets/js/renderers/ai-signals.js', './assets/js/renderers/timeline-forensic.js', './assets/js/renderers/audio.js', './assets/js/renderers/audio-analysis.js',
      './assets/js/renderers/audio-codec.js', './assets/js/renderers/video.js', './assets/js/renderers/spectrogram.js',
      './assets/js/renderers/pdf.js', './assets/js/renderers/archive.js', './assets/js/renderers/svg.js',
      './assets/js/renderers/csv.js', './assets/js/renderers/unknown.js', './assets/js/renderers/proprietary.js',
      './assets/js/renderers/folder.js', './assets/js/renderers/folder-archive-shared.js',
      './assets/js/renderers/treemap.js', './assets/js/core/navigate.js',
      './assets/js/renderers/photo-convert.js', './assets/js/renderers/gif-frames.js', './assets/js/renderers/audio-player.js', './assets/js/renderers/video-avi.js',
      // The asteroids easter-egg game and its modules - the whole set the
      // service-worker SHELL precaches, so Essentials really is the whole app.
      './assets/js/games/asteroids.js', './assets/js/games/config.js', './assets/js/games/style.js',
      './assets/js/games/state.js', './assets/js/games/geometry.js', './assets/js/games/world.js',
      './assets/js/games/ufos.js', './assets/js/games/drones.js', './assets/js/games/weapons.js',
      './assets/js/games/boss.js', './assets/js/games/leaderboard.js', './assets/js/games/menus.js',
      './assets/js/games/render.js', './assets/js/games/update.js', './assets/js/games/input.js',
      './assets/js/renderers/docx.js', './assets/js/renderers/xlsx.js', './assets/js/renderers/epub.js',
      './assets/js/renderers/pptx.js', './assets/js/renderers/stl.js', './assets/js/renderers/zip.js',
      './assets/js/renderers/lrc.js', './assets/js/renderers/midi.js', './assets/js/renderers/subtitles.js',
      './assets/js/renderers/geo.js', './assets/js/renderers/markdown.js', './assets/js/renderers/comic.js',
      './assets/js/core/binutil.js', './assets/js/lib/plist.js', './assets/js/lib/cfbf.js', './assets/js/lib/sqlite.js', './assets/js/lib/libarchive-loader.js', './assets/js/lib/openjpeg-loader.js', './assets/js/lib/xz-loader.js', './assets/js/lib/ghostscript-loader.js', './assets/js/parsers/parsers-dev.js',
      './assets/js/parsers/parsers-archive.js', './assets/js/parsers/parsers-email.js',
      './assets/js/parsers/parsers-security.js', './assets/js/parsers/parsers-gaming.js',
      './assets/js/parsers/parsers-disk.js', './assets/js/parsers/parsers-sci.js', './assets/js/parsers/parsers-osmisc.js',
      './assets/js/parsers/parsers-image.js', './assets/js/parsers/parsers-threed.js', './assets/js/parsers/parsers-geodata.js',
      './assets/js/parsers/parsers-audio.js', './assets/js/parsers/parsers-video.js', './assets/js/parsers/parsers-docs.js',
      './assets/js/parsers/parsers-raw.js', './assets/js/parsers/parser-util.js',
      // Format viewers + helpers kept in step with the service-worker SHELL so the
      // "Essentials" download really is the whole app (each is small JS; the heavy
      // viewer libraries they may pull in live in the Everything/Complete tiers).
      './assets/js/renderers/aftereffects.js', './assets/js/renderers/psd.js', './assets/js/renderers/paint.js',
      './assets/js/renderers/illustrator.js', './assets/js/renderers/font.js', './assets/js/renderers/djvu.js',
      './assets/js/renderers/mdb.js', './assets/js/renderers/mobi.js', './assets/js/renderers/dwg.js',
      './assets/js/renderers/xlsb.js', './assets/js/renderers/model3d.js', './assets/js/renderers/odf.js',
      './assets/js/renderers/legacy-office.js', './assets/js/renderers/textdoc.js', './assets/js/renderers/notebook.js',
      './assets/js/renderers/email.js', './assets/js/renderers/dataview.js', './assets/js/renderers/diagram.js',
      './assets/js/renderers/iwork.js', './assets/js/renderers/timeline.js', './assets/js/renderers/gitobject.js',
      './assets/js/renderers/paged.js', './assets/js/renderers/proprietary-formats.js', './assets/js/renderers/tiff.js',
      './assets/js/renderers/mpo.js', './assets/js/renderers/ico.js', './assets/js/renderers/embedded-images.js',
      './assets/js/renderers/gif-encode.js', './assets/js/renderers/webp-frames.js', './assets/js/renderers/media-reverse.js', './assets/js/renderers/compare.js',
      // Editing-project / engine viewers + the video gyro-metadata helper, kept in
      // step with the service-worker SHELL so Essentials remains the whole app.
      './assets/js/core/video-sync.js', './assets/js/renderers/premiere.js', './assets/js/renderers/davinci.js',
      './assets/js/renderers/vegas.js', './assets/js/renderers/sony-rtmd.js', './assets/js/renderers/gcsv.js',
      './assets/js/renderers/unity.js', './assets/js/renderers/vssolution.js',
      './assets/js/lib/legacy-decompress.js', './assets/js/lib/lzma-loader.js', './assets/js/lib/nrbf.js', './assets/js/lib/occt-loader.js',
      // AI vocal-separation modules (same-origin app code; the heavy ONNX runtime
      // + model URLs they pull live in the Complete tier below).
      './assets/js/lib/mdx-model.js', './assets/js/lib/mdx-stft.js', './assets/js/lib/mdx-separate.js',
      './assets/js/lib/mdx-client.js', './assets/js/lib/mdx-worker.js',
      './assets/js/core/effects.js', './assets/js/core/popups.js', './assets/js/core/export-data.js',
      './assets/img/favicon.svg', './assets/img/icon.png', './assets/img/icon-192.png', './assets/img/icon-512.png',
      './assets/vendor/exifr.umd.js',
      './assets/fonts/geist-latin.woff2', './assets/fonts/geist-latin-ext.woff2',
      './assets/fonts/geist-cyrillic.woff2', './assets/fonts/geist-cyrillic-ext.woff2',
      './assets/fonts/geist-vietnamese.woff2',
      './assets/fonts/geist-mono-latin.woff2', './assets/fonts/geist-mono-latin-ext.woff2',
      './assets/fonts/geist-mono-cyrillic.woff2', './assets/fonts/geist-mono-cyrillic-ext.woff2',
      './assets/fonts/geist-mono-symbols.woff2', './assets/fonts/geist-mono-vietnamese.woff2',
      './assets/vendor/imagemagick/index.mjs',
      './assets/vendor/imagemagick/magick.wasm',
      './assets/vendor/libraw/index.js',
      './assets/vendor/libraw/worker.js',
      './assets/vendor/libraw/libraw.js',
      './assets/vendor/libraw/libraw.wasm',
      './assets/vendor/ffmpeg/ffmpeg.js',
      './assets/vendor/ffmpeg/index.js',
      './assets/vendor/ffmpeg/classes.js',
      './assets/vendor/ffmpeg/const.js',
      './assets/vendor/ffmpeg/errors.js',
      './assets/vendor/ffmpeg/types.js',
      './assets/vendor/ffmpeg/utils.js',
      './assets/vendor/ffmpeg/worker.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
      './assets/vendor/ffmpeg/ffmpeg-util.js'
    ],
    everything: [
      './assets/vendor/jsQR.js',
      './assets/vendor/tesseract/tesseract.min.js',
      TESS_WORKER,
      TESS_DATA + '/eng.traineddata.gz',
      TESS_DATA + '/tesseract-core-simd-lstm.wasm.js',
      TESS_DATA + '/tesseract-core-simd-lstm.wasm',
      TESS_DATA + '/tesseract-core-lstm.wasm.js',
      TESS_DATA + '/tesseract-core-lstm.wasm',
      './assets/vendor/leaflet/leaflet.css',
      './assets/vendor/leaflet/leaflet.js',
      './assets/vendor/leaflet/images/marker-icon.png',
      './assets/vendor/leaflet/images/marker-icon-2x.png',
      './assets/vendor/leaflet/images/marker-shadow.png',
      './assets/vendor/leaflet/images/layers.png',
      './assets/vendor/leaflet/images/layers-2x.png',
      './assets/vendor/heic2any.min.js',
      './assets/vendor/pdfjs/pdf.min.mjs',
      './assets/vendor/pdfjs/pdf.worker.min.mjs',
      './assets/vendor/fflate.js',
      './assets/vendor/lottie/lottie.min.js',
      './assets/vendor/sqljs/sql-wasm.js',
      './assets/vendor/sqljs/sql-wasm.wasm',
      './assets/vendor/fzstd.js',
      './assets/vendor/libarchive/la-archive.js',
      './assets/vendor/libarchive/worker-bundle.js',
      './assets/vendor/libarchive/wasm-gen/libarchive.wasm',
      './assets/vendor/openjpeg/openjpegwasm.js',
      './assets/vendor/openjpeg/openjpegwasm.wasm',
      './assets/vendor/xzwasm/xzwasm.min.js',
      // Format-specific viewer libraries (lazy-loaded on demand when their file
      // type is opened): Photoshop (ag-psd), Excel binary (SheetJS), fonts
      // (opentype.js), DjVu, Kindle/MOBI (foliate-js) and Access (mdb-reader).
      './assets/vendor/ag-psd/bundle.js',
      './assets/vendor/sheetjs/xlsx.full.min.js',
      './assets/vendor/opentype/opentype.min.js',
      './assets/vendor/djvu/djvu.js',
      './assets/vendor/foliate/mobi.js',
      './assets/vendor/mdb/mdb.js',
      // OpenCASCADE (occt-import-js) for STEP/IGES/BREP CAD - CDN-hosted, like the
      // ffmpeg core; keep the version in sync with OCCT_VERSION in occt-loader.js.
      'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js',
      'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.wasm',
      // Ghostscript (~16 MB) for EPS/PostScript rendering.
      './assets/vendor/ghostscript/gs.mjs',
      './assets/vendor/ghostscript/browser.js',
      './assets/vendor/ghostscript/gs.js',
      './assets/vendor/ghostscript/gs.wasm',
      // LibreDWG (WebAssembly) for AutoCAD DWG/DWT drawings - ~6 MB.
      './assets/vendor/libredwg/dist/libredwg-web.js',
      './assets/vendor/libredwg/wasm/libredwg-web.js',
      './assets/vendor/libredwg/wasm/libredwg-web.wasm',
      // Small on-demand pieces with no other offline guarantee: the LZMA decode
      // core (lazy-loaded by lzma-loader.js), the MP4/WebM muxers behind the G-code
      // viewer's clip export (lazy-imported by gcode.js), the LUT preview sample
      // image (fetched at runtime by lut.js) and the PNG favicon fallback.
      './assets/vendor/lzma/lzma-decode.js',
      './assets/vendor/mp4-muxer.min.mjs',
      './assets/vendor/webm-muxer.min.mjs',
      './assets/img/LUT_TEST.jpg',
      './assets/img/favicon.png',
      // Pages and app modules that previously had no tier entry (most sit in the
      // sw.js SHELL, whose cache is dropped on every version bump; /atari was in
      // neither, so the Konami-code easter egg used to 404 offline). Listing them
      // here gives them the permanent analyser-offline cache too.
      './formats', './stats', './privacy', './samples', './atari',
      './assets/js/core/osint.js', './assets/js/renderers/lottie.js',
      './assets/js/renderers/photo-recover.js', './assets/js/renderers/video-recover.js',
      './assets/js/renderers/sonify.js', './assets/js/renderers/altium.js',
      './assets/js/renderers/kicad.js', './assets/js/renderers/spice.js',
      './assets/js/renderers/ipcnet.js', './assets/js/renderers/lut.js',
      './assets/js/renderers/f3d.js', './assets/js/renderers/solidworks.js',
      './assets/js/renderers/gcode.js',
      // The /samples gallery files (~18 MB) so the demo gallery works fully
      // offline. Keep this list in step with the samples/ directory.
      './samples/3D-model.obj', './samples/3D-models.3mf', './samples/3D-printer.gcode',
      './samples/After-effects.aep', './samples/CNC-mill.tap', './samples/Cave14.ogg',
      './samples/LUT-file.cube', './samples/PCB-design.kicad_pcb', './samples/archive.zip',
      './samples/audio.mp3', './samples/image.jpg', './samples/pdf_file.pdf',
      './samples/spreadsheet.csv', './samples/video.mp4', './samples/webpage.html',
      './samples/Fraunces.ttf'
    ],
    // The "Complete" tier is split into optional feature packs (FEATURES below),
    // each downloadable on its own from the Complete popup and added on top of the
    // Everything download. The tier itself stays the union of every pack, still
    // used for cumulative-cache detection and the daily version auto-refresh.
    complete: []
  };
  // OCR language packs (English ships in "Everything"; the rest stream from the
  // CDN, not the repo) and the AI vocal-separation runtime + model - the two
  // optional packs the Complete popup offers, each added on top of Everything.
  const LANG_CODES = [
    'spa', 'fra', 'deu', 'ita', 'por', 'rus', 'chi_sim', 'jpn',
    'srp', 'srp_latn', 'hrv', 'ell', 'ara', 'chi_tra', 'kor', 'heb', 'tur',
    'ukr', 'pol', 'ron', 'hun', 'ces', 'slk', 'slv', 'bul', 'mkd', 'nld',
    'swe', 'nor', 'fin', 'dan',
  ];
  const LANG_URLS = LANG_CODES.map(c => 'https://tessdata.projectnaptha.com/4.0.0/' + c + '.traineddata.gz');
  const FEATURE_ORDER = ['languages', 'ai'];
  const FEATURES = {
    languages: { label: 'Languages', desc: 'Read text (OCR) in 30+ languages, not just English.', mb: TIER_MB.complete - TIER_MB.everything - MDX_TIER_MB, urls: LANG_URLS },
    ai: { label: 'AI vocal separation', desc: 'Split a song into separate vocal and instrumental stems, on your device.', mb: MDX_TIER_MB, urls: MDX_OFFLINE_URLS },
  };
  TIERS.complete = LANG_URLS.concat(MDX_OFFLINE_URLS);
  // Built lazily the first time the Complete popup opens.
  let featPopup = null;
  const featButtons = {};

  // Shared note under the download buttons (created on first use), used to report
  // any files that failed to download. Pass '' to clear it.
  function setOfflineStatus(msg) {
    const options = document.querySelector('.offline-options');
    if (!options) return;
    let status = document.getElementById('offlineStatus');
    if (!msg) { if (status) { status.hidden = true; status.textContent = ''; } return; }
    if (!status) {
      status = document.createElement('p');
      status.id = 'offlineStatus';
      status.className = 'offline-status';
      status.setAttribute('role', 'status');
      options.insertAdjacentElement('afterend', status);
    }
    status.textContent = msg;
    status.hidden = false;
  }

  // Persisted record of which tiers are fully cached and at what app version, so
  // the "Cached" tag can be restored on load and a tier refreshed when the app
  // updates. localStorage 'anr-offline' = { <tier>: <COMMIT_COUNT cached at>, ... }.
  function readOfflineState() {
    try { return JSON.parse(localStorage.getItem('anr-offline') || '{}') || {}; }
    catch (_) { return {}; }
  }
  function writeOfflineState(state) {
    try { localStorage.setItem('anr-offline', JSON.stringify(state)); } catch (_) {}
  }
  // Which optional Complete-popup packs (languages / ai) are cached, at what app
  // version. Separate from the tier record so a pack can be held on its own.
  function readFeatState() {
    try { return JSON.parse(localStorage.getItem('anr-offline-feat') || '{}') || {}; }
    catch (_) { return {}; }
  }
  function writeFeatState(state) {
    try { localStorage.setItem('anr-offline-feat', JSON.stringify(state)); } catch (_) {}
  }

  // Probe the offline cache for the highest tier actually present, by checking a
  // sentinel file each tier adds last (downloads run in order, so the last file
  // being cached means the tier finished). Lets the "Cached" tag self-heal when
  // a tier was cached before this record existed, or localStorage was wiped.
  async function detectCachedTier() {
    try {
      const cache = await caches.open('analyser-offline');
      const has = async (url) => !!(url && await cache.match(new Request(url)));
      // Complete's sentinel is the AI model, which "Clear storage" can deliberately
      // spare on its own; require an Everything-tier file too, so a lone kept model
      // is not misread as a full Complete cache.
      if (await has(TIERS.complete[TIERS.complete.length - 1])
          && await has(TIERS.everything[TIERS.everything.length - 1])) return 'complete';
      if (await has(TIERS.everything[TIERS.everything.length - 1])) return 'everything';
      if (await has(TIERS.essentials[TIERS.essentials.length - 1])) return 'essentials';
    } catch (_) {}
    return null;
  }

  // The "✓ Cached" badge pinned to the bottom of a button (created lazily so the
  // HTML stays untouched across all three pages that share this markup).
  function cachedBadge(btn) {
    let badge = btn.querySelector('.offline-cached');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'offline-cached';
      badge.hidden = true;
      btn.appendChild(badge);
    }
    return badge;
  }
  function markCached(btn, version) {
    const badge = cachedBadge(btn);
    // Parts are separate spans so the responsive trimming is pure CSS: on mobile
    // the checkmark and the · separator are hidden (a - is shown instead), so the
    // badge reads just "Cached - v2.0". Desktop keeps "✓ Cached · v2.0".
    const ver = 'v' + analyserVersion(version, RELEASE_COMMITS);
    badge.textContent = '';
    badge.appendChild(el('span', { class: 'offline-cached-check' }, '✓'));
    badge.appendChild(el('span', {}, 'Cached'));
    badge.appendChild(el('span', { class: 'offline-cached-dot' }, '·'));
    badge.appendChild(el('span', { class: 'offline-cached-dash' }, '-'));
    badge.appendChild(el('span', {}, ver));
    badge.hidden = false;
    btn.classList.add('is-done', 'is-fading');
  }

  function tierUrls(tier) {
    const urls = [...TIERS.essentials];
    if (tier === 'everything' || tier === 'complete') urls.push(...TIERS.everything);
    if (tier === 'complete') urls.push(...TIERS.complete);
    return urls;
  }

  // Reflect the current offline state across all three tier buttons at once:
  //  - the highest cached tier keeps its "Cached" badge,
  //  - every LOWER tier it already covers is greyed out and marked "Included"
  //    (downloading a tier caches all lower tiers' files too, so you already have them),
  //  - every HIGHER tier shows how much MORE storage upgrading to it costs ("+~N MB"),
  //    relative to what's cached, instead of its full size.
  // Buttons mid-download (is-active) are left to their own live progress UI.
  function refreshTierButtons() {
    const state = readOfflineState();
    let cachedIdx = -1;
    TIER_ORDER.forEach((t, i) => { if (state[t] != null) cachedIdx = Math.max(cachedIdx, i); });
    const cachedMb = cachedIdx >= 0 ? TIER_MB[TIER_ORDER[cachedIdx]] : 0;

    document.querySelectorAll('.offline-btn').forEach((btn) => {
      if (btn.classList.contains('is-active')) return;
      const tier = btn.dataset.tier;
      const idx = TIER_ORDER.indexOf(tier);
      const sizeEl = btn.querySelector('.offline-size');
      if (idx < 0) return;

      if (idx === cachedIdx) {
        // The highest cached tier: full "Cached" badge, shown normally (not greyed).
        btn.classList.remove('is-included');
        if (sizeEl) sizeEl.textContent = 'Cached';
        markCached(btn, state[tier] != null ? state[tier] : COMMIT_COUNT);
      } else if (idx < cachedIdx) {
        // Already covered by a higher cached tier: grey it out, not clickable.
        cachedBadge(btn).hidden = true;
        btn.classList.add('is-done', 'is-included');
        btn.classList.remove('is-fading');
        if (sizeEl) sizeEl.textContent = 'Included';
      } else {
        // Not cached yet: clickable, and show the incremental upgrade cost only.
        cachedBadge(btn).hidden = true;
        btn.classList.remove('is-done', 'is-fading', 'is-included');
        if (sizeEl) sizeEl.textContent = cachedIdx >= 0 ? '+~' + (TIER_MB[tier] - cachedMb) + ' MB' : TIER_SIZES[tier];
      }
    });
    refreshCompleteButton();
  }

  // Live AbortControllers for in-progress tier downloads, so "Clear storage" can
  // stop them before wiping the cache they are writing into - otherwise a running
  // download keeps repopulating the just-cleared cache and records the tier as
  // cached again, making the clear look inert.
  const activeDownloads = new Set();

  // Download (or, with force, re-download) every file in a tier into the
  // 'analyser-offline' cache, driving the button's progress bar. Records the
  // current app version on full success. On partial failure a user-initiated
  // download clears the record (so the button offers a retry), but the automatic
  // version-refresh (auto) leaves the existing cached record untouched - a flaky
  // network must not downgrade a tier the user already has fully cached.
  // Core cache loop shared by tier and feature-pack downloads: fetch every URL
  // into the 'analyser-offline' cache, driving the button's progress bar. Returns
  // the outcome so the caller records the right state (a tier vs a pack) itself.
  async function runCacheLoop(btn, urls, force) {
    const abort = new AbortController();
    activeDownloads.add(abort);

    btn.classList.add('is-active');
    btn.classList.remove('is-done', 'is-fading');
    const bar = btn.querySelector('.offline-bar');
    const sizeEl = btn.querySelector('.offline-size');
    cachedBadge(btn).hidden = true;
    bar.hidden = false;

    function setBar(frac) {
      const ch = parseFloat(getComputedStyle(bar).fontSize) * 0.6 || 8;
      // Fit to the bar's own content width - it already excludes the button's
      // padding, so this adapts to the resized (narrower) mobile buttons
      // instead of assuming desktop padding. Reserve 2 chars for the [ ].
      const barW = bar.clientWidth || btn.clientWidth;
      const total = Math.max(4, Math.floor(barW / ch) - 2);
      const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
      bar.innerHTML = '[<span class="offline-bar-fill">' +
        '/'.repeat(filled) + '</span>' +
        ' '.repeat(total - filled) + ']';
    }
    setBar(0);

    const cache = await caches.open('analyser-offline');
    setOfflineStatus('');   // a fresh attempt clears any previous failure note
    let done = 0, failed = 0;
    const failedUrls = [];
    for (const url of urls) {
      if (abort.signal.aborted) break;   // Clear storage cancelled us mid-run
      let ok = false;
      try {
        // force re-fetches even cached entries (used by the daily version
        // refresh); unchanged files come cheaply from the HTTP cache / 304.
        const exists = force ? null : await cache.match(new Request(url));
        if (exists) {
          ok = true;
        } else {
          const resp = await fetch(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin', signal: abort.signal })
            .catch(() => fetch(url, { mode: 'no-cors', signal: abort.signal }));
          // Opaque (cross-origin no-cors) responses report ok=false but are
          // still cacheable; only a same-origin non-ok counts as a real failure.
          if (resp && (resp.type === 'opaque' || resp.ok)) {
            await cache.put(url, resp);
            ok = true;
          }
        }
      } catch (_) {}
      if (!ok) { failed++; failedUrls.push(url); }
      done++;
      setBar(done / urls.length);
      sizeEl.textContent = done + ' / ' + urls.length;
    }

    activeDownloads.delete(abort);
    btn.classList.remove('is-active');
    return { aborted: abort.signal.aborted, failed, failedUrls, total: urls.length, setBar, sizeEl };
  }

  // Name the files that failed so a single bad URL (offline asset, blocked CDN) is
  // identifiable rather than just a count. Basenames, capped so a mass failure
  // doesn't flood the status line. Leaves the button enabled for a retry.
  function reportDownloadFailure(r) {
    r.sizeEl.textContent = 'Try again';
    const shortName = (u) => { try { return decodeURIComponent(u.split('?')[0].split('/').pop()) || u; } catch (_) { return u; } };
    const names = r.failedUrls.map(shortName);
    const shown = names.slice(0, 8).join(', ') + (names.length > 8 ? ', +' + (names.length - 8) + ' more' : '');
    setOfflineStatus(r.failed + ' of ' + r.total + ' file' + (r.total === 1 ? '' : 's') +
      ' failed to download (' + shown + '). You may be offline or a server was unreachable - try again to finish.');
  }

  // Download (or, with force, re-download) a cumulative tier into the offline cache.
  async function downloadTier(btn, { force = false, auto = false } = {}) {
    if (btn.classList.contains('is-active')) return false;
    const tier = btn.dataset.tier;
    const r = await runCacheLoop(btn, tierUrls(tier), force);
    if (r.aborted) return false;   // Clear storage cancelled us: it resets the UI itself
    r.setBar(1);
    const state = readOfflineState();
    if (r.failed > 0) {
      // Automatic version-refresh must NOT tear down a tier the user already has
      // fully cached over a transient network failure - keep the record and retry
      // next load. A user-initiated attempt drops the record so it offers a retry.
      if (auto) { refreshTierButtons(); return false; }
      reportDownloadFailure(r);
      delete state[tier];
      writeOfflineState(state);
      return false;
    }
    r.sizeEl.textContent = 'Cached';
    state[tier] = COMMIT_COUNT;
    writeOfflineState(state);
    // Refresh ALL buttons: this one gets its badge, lower tiers grey out as "Included",
    // higher tiers switch to the "+N MB more" upgrade delta.
    refreshTierButtons();
    return true;
  }

  // Download one optional feature pack (Languages / AI) from the Complete popup,
  // on top of the Everything base (already-cached base files come free from the
  // loop's cache.match). Completing both packs crowns the "Complete" tier.
  async function downloadFeature(btn, key) {
    if (btn.classList.contains('is-active')) return false;
    const feat = FEATURES[key];
    if (!feat) return false;
    const r = await runCacheLoop(btn, tierUrls('everything').concat(feat.urls), false);
    if (r.aborted) return false;
    r.setBar(1);
    if (r.failed > 0) { reportDownloadFailure(r); return false; }
    r.sizeEl.textContent = 'Cached';
    // The Everything base is cached now too - record it, this pack, and the whole
    // Complete tier once both packs are in.
    const state = readOfflineState();
    state.essentials = COMMIT_COUNT;
    state.everything = COMMIT_COUNT;
    const feats = readFeatState();
    feats[key] = COMMIT_COUNT;
    writeFeatState(feats);
    if (FEATURE_ORDER.every(k => feats[k] != null)) state.complete = COMMIT_COUNT;
    writeOfflineState(state);
    refreshTierButtons();
    refreshFeatureButtons();
    return true;
  }

  // Paint each feature button in the popup from the saved pack state.
  function refreshFeatureButtons() {
    const feats = readFeatState();
    FEATURE_ORDER.forEach((key) => {
      const btn = featButtons[key];
      if (!btn || btn.classList.contains('is-active')) return;
      const sizeEl = btn.querySelector('.offline-size');
      const bar = btn.querySelector('.offline-bar');
      if (feats[key] != null) {
        if (sizeEl) sizeEl.textContent = 'Cached';
        markCached(btn, feats[key]);
      } else {
        cachedBadge(btn).hidden = true;
        btn.classList.remove('is-done', 'is-fading', 'is-included');
        if (bar) bar.hidden = true;
        if (sizeEl) sizeEl.textContent = '~' + FEATURES[key].mb + ' MB';
      }
    });
  }

  // The Complete button opens the feature popup rather than downloading directly.
  // refreshTierButtons paints it as a tier (Cached / +N MB); when only one of the
  // two packs is cached, show the pack count so the partial state reads at a glance.
  function refreshCompleteButton() {
    const btn = document.querySelector('.offline-options .offline-btn[data-tier="complete"]');
    if (!btn || btn.classList.contains('is-active')) return;
    const state = readOfflineState();
    if (state.complete != null) return;   // fully cached: keep the "Cached" badge
    const feats = readFeatState();
    const have = FEATURE_ORDER.filter(k => feats[k] != null).length;
    if (!have) return;                     // nothing yet: keep the size / upgrade label
    const sizeEl = btn.querySelector('.offline-size');
    if (sizeEl) sizeEl.textContent = have + ' of ' + FEATURE_ORDER.length + ' packs';
    btn.classList.remove('is-done', 'is-fading', 'is-included');
    cachedBadge(btn).hidden = true;
  }

  // The Complete popup: two optional packs on top of Everything, each a real
  // offline-btn (progress + Cached badge). Built once, on first open. Reuses the
  // .anr-modal overlay pattern (Escape / backdrop close, one at a time).
  function closeFeaturePopup() {
    if (!featPopup) return;
    featPopup.classList.remove('is-open');
    document.removeEventListener('keydown', featPopup._onKey);
    // The overlay is reused (not rebuilt), so after the fade take it out of layout
    // entirely - display:none has no hitbox on any browser, unlike a transparent
    // fixed box which can keep swallowing taps (seen on Samsung Internet).
    clearTimeout(featPopup._hideT);
    featPopup._hideT = setTimeout(() => { featPopup.style.display = 'none'; }, 220);
  }
  function buildFeaturePopup() {
    if (featPopup) return;
    const closeBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-cancel' }, 'Close');
    const list = el('div', { class: 'offline-feat-list' });
    FEATURE_ORDER.forEach((key) => {
      const f = FEATURES[key];
      const btn = el('button', { type: 'button', class: 'offline-btn offline-feat-btn', 'data-feature': key }, [
        el('span', { class: 'offline-tier' }, f.label),
        el('span', { class: 'offline-desc' }, f.desc),
        el('span', { class: 'offline-size' }, '~' + f.mb + ' MB'),
        el('div', { class: 'offline-bar', hidden: true }, el('div', { class: 'offline-bar-fill' })),
      ]);
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-active') || btn.classList.contains('is-done')) return;
        downloadFeature(btn, key);
      });
      featButtons[key] = btn;
      list.appendChild(btn);
    });
    const card = el('div', { class: 'anr-modal-card offline-feat-card' }, [
      el('p', { class: 'anr-modal-kicker' }, 'Complete'),
      el('p', { class: 'anr-modal-title' }, 'Extra downloads'),
      el('p', { class: 'offline-feat-note' }, 'Optional packs, added on top of the Everything download. Pick what you need - each one works fully offline once cached.'),
      list,
      el('div', { class: 'anr-modal-actions' }, [closeBtn]),
    ]);
    featPopup = el('div', { class: 'anr-modal offline-feat-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Extra downloads' }, card);
    document.body.appendChild(featPopup);
    featPopup._onKey = (e) => { if (e.key === 'Escape') closeFeaturePopup(); };
    closeBtn.addEventListener('click', closeFeaturePopup);
    featPopup.addEventListener('click', (e) => { if (e.target === featPopup) closeFeaturePopup(); });
  }
  function openFeaturePopup() {
    buildFeaturePopup();
    refreshFeatureButtons();
    clearTimeout(featPopup._hideT);
    featPopup.style.display = '';   // undo the closed display:none before fading in
    document.removeEventListener('keydown', featPopup._onKey);
    document.addEventListener('keydown', featPopup._onKey);
    requestAnimationFrame(() => featPopup.classList.add('is-open'));
  }

  // The help-panel legend always shows the absolute per-tier totals (it describes the
  // tiers, not the live upgrade state). Stamped from the canonical map so every page
  // agrees and any stale figure baked into the markup is overridden.
  document.querySelectorAll('.offline-help-panel > div').forEach(d => {
    const tier = (d.querySelector('strong')?.textContent || '').trim().toLowerCase();
    const s = d.querySelector('span');
    if (s && TIER_SIZES[tier]) s.textContent = TIER_SIZES[tier];
  });
  // Button labels are dynamic (greyed "Included" for covered tiers, "+N MB more" deltas
  // for upgrades), so let refreshTierButtons own them - it reads the saved state.
  refreshTierButtons();

  document.querySelectorAll('.offline-options .offline-btn').forEach(btn => {
    // The Complete tier opens the feature-pack popup instead of downloading directly.
    if (btn.dataset.tier === 'complete') {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-active')) return;
        openFeaturePopup();
      });
      return;
    }
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-active') || btn.classList.contains('is-done')) return;
      downloadTier(btn, { force: false });
    });
  });

  // ----- Collapsible "Download for offline use" -----
  // The section's heading is a toggle. Default state on load: expanded when
  // nothing is cached yet (first-time visitors get the options in front of them),
  // collapsed once any tier is downloaded (return visits stay tidy). A manual
  // toggle wins for the rest of the session and isn't overridden by the async
  // self-heal below; clearing storage resets that so it re-opens.
  const offlineSection = document.getElementById('offlineSection');
  const offlineToggle = document.getElementById('offlineToggle');
  let offlineUserToggled = false;
  function setOfflineOpen(open) {
    if (!offlineSection || !offlineToggle) return;
    offlineSection.classList.toggle('is-open', open);
    offlineToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function applyDefaultOfflineCollapse() {
    if (offlineUserToggled) return;
    setOfflineOpen(Object.keys(readOfflineState()).length === 0);
  }
  if (offlineToggle) {
    offlineToggle.addEventListener('click', () => {
      offlineUserToggled = true;
      setOfflineOpen(offlineToggle.getAttribute('aria-expanded') !== 'true');
    });
  }
  applyDefaultOfflineCollapse();

  // On every load: restore the persisted "Cached" badges, then re-check the app
  // version - refreshing in place any cached tier whose files were stored under
  // an older version (i.e. the app updated since they were downloaded). Files
  // that did not change come cheaply from the HTTP cache, so the refresh is light.
  (async () => {
    let state = readOfflineState();
    const buttons = {};
    document.querySelectorAll('.offline-btn').forEach(b => { buttons[b.dataset.tier] = b; });

    // Self-heal: if nothing is recorded (a tier cached before this record
    // existed, or localStorage was wiped) but files are actually in the offline
    // cache, backfill the record for the highest tier present so the tag shows.
    if (!Object.keys(state).length) {
      const detected = await detectCachedTier();
      if (detected) { state[detected] = COMMIT_COUNT; writeOfflineState(state); }
    }

    // A self-healed tier means something IS cached after all - re-apply the
    // default collapse so the section starts closed (unless the user toggled it).
    applyDefaultOfflineCollapse();

    // Paint the restored / self-healed state (badges, greying, upgrade deltas).
    refreshTierButtons();
    for (const tier of Object.keys(state)) {
      if (state[tier] !== COMMIT_COUNT && buttons[tier]) {
        await downloadTier(buttons[tier], { force: true, auto: true });
      }
    }
    refreshTierButtons();
  })();

  // ----- PWA install prompt -----
  const installBtn = document.getElementById('offlineInstall');
  // The beforeinstallprompt/appinstalled listeners are window-level, but
  // setupOfflineTiers() re-runs on every SPA navigation - so wire them once (they
  // resolve the current button by id at fire time) instead of stacking a new pair
  // per navigation. deferredPrompt is stashed on the function object so the click
  // handler below and a later navigation's handler share the same captured event.
  if (!setupOfflineTiers._winWired) {
    setupOfflineTiers._winWired = true;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      setupOfflineTiers._deferredPrompt = e;
    });
    window.addEventListener('appinstalled', () => {
      const b = document.getElementById('offlineInstall');
      if (b) b.textContent = 'Installed ✓';
      setupOfflineTiers._deferredPrompt = null;
    });
  }
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      const deferredPrompt = setupOfflineTiers._deferredPrompt;
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result.outcome === 'accepted') installBtn.textContent = 'Installed ✓';
        setupOfflineTiers._deferredPrompt = null;
        return;
      }
      installBtn.textContent = installHint();
      // Expand full width (mobile only, via CSS) so the long message fits, like
      // an opened Dependencies. Clear + Dependencies split the row below it.
      installBtn.classList.add('is-expanded');
      setTimeout(() => {
        installBtn.textContent = 'Install as app';
        installBtn.classList.remove('is-expanded');
      }, 5000);
    });
  }

  // ----- Clear data (analysis history + session/local state and IndexedDB).
  //        Deliberately spares everything the user has downloaded for offline use,
  //        on every platform: the preloaded/bundled app content (native builds ship
  //        the whole Everything tier as static files) AND any optional Complete
  //        packs (AI model, extra OCR languages) they fetched. The 'analyser-offline'
  //        Cache Storage bucket and its download records are left untouched, so
  //        nothing ever has to be re-downloaded; the SW app-shell cache stays too.
  //        Keeps the dark-mode preference and the Asteroids high score. -----
  const clearBtn = document.getElementById('offlineClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      clearBtn.textContent = 'Clearing…';
      // Preserve the kept keys, wipe localStorage + sessionStorage, restore them.
      // The offline download records ('anr-offline' / 'anr-offline-feat') are kept
      // alongside the theme + game scores, so the "Cached" badges stay accurate
      // against the offline cache we deliberately leave in place.
      const KEEP = ['anr-theme', 'anr-theme:ts', 'anr-asteroids-hi', 'anr-asteroids-bestwave', 'anr-offline', 'anr-offline-feat'];
      const kept = {};
      for (const k of KEEP) { const v = localStorage.getItem(k); if (v !== null) kept[k] = v; }
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
      for (const k in kept) { try { localStorage.setItem(k, kept[k]); } catch (_) {} }
      // Drop any IndexedDB databases (analysis-side state). Never the downloaded
      // assets - those live in the 'analyser-offline' Cache Storage bucket, which
      // we do not touch.
      try {
        if (indexedDB.databases) {
          const dbs = await indexedDB.databases();
          await Promise.all(dbs.map(d => d.name && new Promise(res => {
            const req = indexedDB.deleteDatabase(d.name);
            req.onsuccess = req.onerror = req.onblocked = () => res();
          })));
        }
      } catch (_) {}
      // Downloads and their records survived, so the tier/pack badges just repaint
      // as they were.
      refreshTierButtons();
      refreshFeatureButtons();
      renderHistoryPanel();   // history lived in localStorage - now wiped
      clearBtn.textContent = 'Data cleared ✓';
      setTimeout(() => { clearBtn.textContent = 'Clear storage'; }, 3000);
    });
  }
}
