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

  if (isIos) {
    return isFirefox || /CriOS|EdgiOS|OPiOS/.test(ua)
      ? 'On iOS, tap the Share button, then "Add to Home Screen". (Only Safari can install it on iPhone/iPad.)'
      : 'Tap the Share button, then "Add to Home Screen".';
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
  if (isFirefox) return 'Firefox on desktop cannot install web apps. Open this page in Chrome or Edge to install it, or just bookmark it.';
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
  const TIER_MB = { essentials: 50, everything: 120, complete: 345 };
  const TIER_SIZES = {};
  TIER_ORDER.forEach((t) => { TIER_SIZES[t] = '~' + TIER_MB[t] + ' MB'; });

  const TIERS = {
    essentials: [
      './', './about', './patch', './manifest.json', './assets/css/analyser.css', './assets/css/fonts.css',
      './assets/js/core/app.js', './assets/js/core/formats.js', './assets/js/core/util.js', './assets/js/core/search.js',
      './assets/js/core/stats-page.js', './assets/js/core/history.js', './assets/js/core/file-sniff.js', './assets/js/core/forensics.js', './assets/js/core/overlays.js', './assets/js/core/patch-tldr.js', './assets/js/core/offline-tiers.js', './assets/js/core/format-overlay.js', './assets/js/core/classify.js',
      './assets/js/renderers/photo.js', './assets/js/renderers/audio.js', './assets/js/renderers/audio-analysis.js',
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
      './assets/js/renderers/gif-encode.js', './assets/js/renderers/webp-frames.js', './assets/js/renderers/media-reverse.js',
      // Editing-project / engine viewers + the video gyro-metadata helper, kept in
      // step with the service-worker SHELL so Essentials remains the whole app.
      './assets/js/core/video-sync.js', './assets/js/renderers/premiere.js', './assets/js/renderers/davinci.js',
      './assets/js/renderers/vegas.js', './assets/js/renderers/sony-rtmd.js', './assets/js/renderers/gcsv.js',
      './assets/js/renderers/unity.js', './assets/js/renderers/vssolution.js',
      './assets/js/lib/legacy-decompress.js', './assets/js/lib/lzma-loader.js', './assets/js/lib/nrbf.js', './assets/js/lib/occt-loader.js',
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
      './samples/3D model.obj', './samples/3D models.3mf', './samples/3D printer.gcode',
      './samples/After effects.aep', './samples/CNC mill.tap', './samples/Cave14.ogg',
      './samples/LUT file.cube', './samples/PCB design.kicad_pcb', './samples/archive.zip',
      './samples/audio.mp3', './samples/image.jpg', './samples/pdf file.pdf',
      './samples/spreadsheet.csv', './samples/video.mp4', './samples/webpage.html',
      './samples/Fraunces.ttf'
    ],
    // The "Complete" tier is OCR languages only: English ships in "Everything", and
    // every other language is pulled from the CDN (not hosted in the repo). They all
    // land in the offline cache, so "Complete" gives every language offline.
    complete: [
      'spa', 'fra', 'deu', 'ita', 'por', 'rus', 'chi_sim', 'jpn',
      'srp', 'srp_latn', 'hrv', 'ell', 'ara', 'chi_tra', 'kor', 'heb', 'tur',
      'ukr', 'pol', 'ron', 'hun', 'ces', 'slk', 'slv', 'bul', 'mkd', 'nld',
      'swe', 'nor', 'fin', 'dan'
    ].map(c => 'https://tessdata.projectnaptha.com/4.0.0/' + c + '.traineddata.gz')
  };

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

  // Probe the offline cache for the highest tier actually present, by checking a
  // sentinel file each tier adds last (downloads run in order, so the last file
  // being cached means the tier finished). Lets the "Cached" tag self-heal when
  // a tier was cached before this record existed, or localStorage was wiped.
  async function detectCachedTier() {
    try {
      const cache = await caches.open('analyser-offline');
      const has = async (url) => !!(url && await cache.match(new Request(url)));
      if (await has(TIERS.complete[TIERS.complete.length - 1])) return 'complete';
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
  }

  // Download (or, with force, re-download) every file in a tier into the
  // 'analyser-offline' cache, driving the button's progress bar. Records the
  // current app version on full success. On partial failure a user-initiated
  // download clears the record (so the button offers a retry), but the automatic
  // version-refresh (auto) leaves the existing cached record untouched - a flaky
  // network must not downgrade a tier the user already has fully cached.
  async function downloadTier(btn, { force = false, auto = false } = {}) {
    if (btn.classList.contains('is-active')) return false;
    const tier = btn.dataset.tier;
    const urls = tierUrls(tier);

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
      let ok = false;
      try {
        // force re-fetches even cached entries (used by the daily version
        // refresh); unchanged files come cheaply from the HTTP cache / 304.
        const exists = force ? null : await cache.match(new Request(url));
        if (exists) {
          ok = true;
        } else {
          const resp = await fetch(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' })
            .catch(() => fetch(url, { mode: 'no-cors' }));
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

    btn.classList.remove('is-active');
    setBar(1);
    const state = readOfflineState();
    if (failed > 0) {
      // Automatic version-refresh: a transient failure (a flaky network on the
      // post-update auto-reload) must NOT tear down a tier the user already has
      // cached. Keep the saved record and repaint the "Cached" badge at its stored
      // version - the existing files stay fully usable - and let the next load retry.
      if (auto) { refreshTierButtons(); return false; }
      // Leave the button enabled (no is-done) so the user can retry the rest,
      // and drop any stale "cached" record for this tier.
      sizeEl.textContent = 'Try again';
      // Name the files that failed so a single bad URL (offline asset, blocked CDN)
      // is identifiable rather than just a count. Show basenames, capped so a mass
      // failure doesn't flood the status line.
      const shortName = (u) => { try { return decodeURIComponent(u.split('?')[0].split('/').pop()) || u; } catch (_) { return u; } };
      const names = failedUrls.map(shortName);
      const shown = names.slice(0, 8).join(', ') + (names.length > 8 ? ', +' + (names.length - 8) + ' more' : '');
      setOfflineStatus(failed + ' of ' + urls.length + ' file' + (urls.length === 1 ? '' : 's') +
        ' failed to download (' + shown + '). You may be offline or a server was unreachable - try again to finish.');
      delete state[tier];
      writeOfflineState(state);
      return false;
    }
    sizeEl.textContent = 'Cached';
    state[tier] = COMMIT_COUNT;
    writeOfflineState(state);
    // Refresh ALL buttons: this one gets its badge, lower tiers grey out as "Included",
    // higher tiers switch to the "+N MB more" upgrade delta.
    refreshTierButtons();
    return true;
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

  document.querySelectorAll('.offline-btn').forEach(btn => {
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
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result.outcome === 'accepted') installBtn.textContent = 'Installed ✓';
        deferredPrompt = null;
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
  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.textContent = 'Installed ✓';
    deferredPrompt = null;
  });

  // ----- Clear storage (localStorage / sessionStorage / IndexedDB + the
  //        downloaded offline tiers; keeps the dark-mode preference and the
  //        Asteroids high score). Leaves the SW app-shell cache alone. -----
  const clearBtn = document.getElementById('offlineClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      clearBtn.textContent = 'Clearing…';
      // Preserve the kept keys, wipe localStorage + sessionStorage, restore them.
      const KEEP = ['anr-theme', 'anr-theme:ts', 'anr-asteroids-hi', 'anr-asteroids-bestwave'];
      const kept = {};
      for (const k of KEEP) { const v = localStorage.getItem(k); if (v !== null) kept[k] = v; }
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
      for (const k in kept) { try { localStorage.setItem(k, kept[k]); } catch (_) {} }
      // Drop any IndexedDB databases.
      try {
        if (indexedDB.databases) {
          const dbs = await indexedDB.databases();
          await Promise.all(dbs.map(d => d.name && new Promise(res => {
            const req = indexedDB.deleteDatabase(d.name);
            req.onsuccess = req.onerror = req.onblocked = () => res();
          })));
        }
      } catch (_) {}
      // Delete the downloaded offline tiers (their own Cache Storage bucket). The
      // SW app-shell cache is a separate bucket and stays. Without this the tier
      // files survive and detectCachedTier()
      // self-heals the "Cached" badge on the next load, so the clear looked inert.
      try { await caches.delete('analyser-offline'); } catch (_) {}
      // The 'anr-offline' record and the cached tier files are both gone now, so
      // repaint the tier buttons to un-cached.
      document.querySelectorAll('.offline-btn').forEach(b => {
        b.classList.remove('is-done', 'is-active', 'is-fading', 'is-included');
        const bar = b.querySelector('.offline-bar');
        if (bar) bar.hidden = true;
        const badge = b.querySelector('.offline-cached');
        if (badge) badge.hidden = true;
      });
      refreshTierButtons();
      offlineUserToggled = false;
      applyDefaultOfflineCollapse();
      renderHistoryPanel();   // history lived in localStorage - now wiped
      clearBtn.textContent = 'Storage cleared ✓';
      setTimeout(() => { clearBtn.textContent = 'Clear storage'; }, 3000);
    });
  }
}
