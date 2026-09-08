/* Analyser - ambient global declarations.

   Three unrelated groups live here:

   1. The `window._anr*` channel. app.js and the classic-script router
      (core/navigate.js) talk to each other through globals rather than imports,
      because navigate.js is loaded WITHOUT type="module" and so cannot import.
      A few renderers also park state here for the SPA restore path.

   2. `window.anrDesktop`, present only inside the Electron desktop shell
      (desktop/preload.cjs). Optional by design: its absence is what keeps the
      website's behaviour byte-for-byte unchanged.

   3. UMD vendor globals. Roughly half of web/assets/vendor/ is loaded by
      injecting a <script> tag at runtime rather than by ES import, so the
      library lands on `window` with no static import to type it.

   Most of these are still `any`, and that is now a deliberate resting state
   rather than a migration to-do: the vendor globals are untyped third-party
   builds, and the `_anr*` channel is a loose message bus by design. Typing a
   vendor library properly means a hand-written stub in types/vendor/, which is
   worth doing per-library when someone touches it, not as a sweep.

   Two rules for this file. Only underscore-prefixed **app** expandos belong on
   the `Element` interface below - a real DOM property that fails to type
   (`hidden`, `style`, `naturalWidth`) means the value needs narrowing at the
   call site, not a widened global. And app-code types belong in
   src/core/types.d.ts, not here. */

export {};

declare global {
  /** The bridge the Electron desktop shell exposes on `window.anrDesktop`
      (desktop/preload.cjs). It does not exist in a browser, so `anrDesktop?:`
      below is what makes every desktop-only branch opt-in. The renderer never
      sees Node - each method here is a message to the main process. */
  interface AnrDesktop {
    /** Desktop package version (major.minor.0, stamped from COMMIT_COUNT). */
    version: string;
    platform: string;
    arch: string;
    electron: string;
    chrome: string;
    packaged: boolean;
    /** True in a portable copy: everything stored sits beside the executable,
        so the host machine keeps nothing. */
    portable: boolean;
    /** Where this copy keeps its data (offline cache, history, window state). */
    dataDir: string;
    /** Real total RAM in GB from os.totalmem(), which navigator.deviceMemory
        clamps at 8. Read by core/limits.ts for the device tier. */
    memoryGB: number;
    /** Register the "open this path" handler (core/app.ts boot()). */
    onOpen(cb: (payload: any) => void): void;
    /** Save the export report through a native dialog. */
    saveReport(name: string, html: string): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
    /** Native, hardware-accelerated FFmpeg (desktop/ffmpeg-native.mjs).
        src/renderers/video.ts wraps this into an ffmpeg.wasm-shaped object, so
        the existing call sites are untouched. Absent when no binary is found,
        and then the WASM build runs as before. */
    ffmpeg?: AnrFfmpegBridge;
  }

  /** What the probe found on this machine. `accel` is the family that actually
      encoded a test frame, not merely one the build lists - an NVIDIA-only box
      still advertises the Intel and AMD encoders and fails both. */
  interface AnrFfmpegCaps {
    available: boolean;
    path?: string | null;
    version?: string;
    families?: { vendor: string; label: string; h264: string; hevc: string | null; av1: string | null; hwaccel: string }[];
    accel?: { vendor: string; label: string; h264: string; hevc: string | null; av1: string | null; hwaccel: string } | null;
    vendor?: string | null;
    label?: string;
    error?: string;
  }

  interface AnrFfmpegBridge {
    caps(): Promise<AnrFfmpegCaps>;
    /** Open a job session (its own temp directory). Returns the session id. */
    open(): Promise<string | null>;
    write(id: string, name: string, data: Uint8Array): Promise<boolean>;
    read(id: string, name: string): Promise<Uint8Array>;
    del(id: string, name: string): Promise<boolean>;
    /** Resolves once ffmpeg has run, whatever its exit code. */
    exec(id: string, args: string[], timeout?: number): Promise<{ ok: boolean; code: number; accelerated?: boolean; note?: string; log?: string }>;
    close(id: string): Promise<boolean>;
    /** Register the log/progress sink for one session. */
    listen(id: string, cb: ((p: any) => void) | null): void;
  }

  interface Window {
    /* --- app-internal cross-module channel (see core/app.js, core/navigate.js) --- */
    _anrAsteroidsActive?: any;
    _anrClassify?: any;
    _anrHandleFile?: any;
    _anrHomeMain?: any;
    _anrHomeRestored?: any;
    _anrLastAnalysis?: any;
    _anrLastFile?: any;
    _anrLoader?: any;
    _anrMediaStoppers?: any;
    _anrPendingFile?: any;
    _anrPendingFolder?: any;
    _anrPushNav?: any;
    _anrReadableText?: any;
    _anrResetNav?: any;
    _anrResolveContent?: any;
    _anrRestore?: any;
    _anrSuggest?: any;
    _anrSuppressSuggest?: any;

    /* --- the Electron desktop shell (desktop/preload.cjs) ---
       Present ONLY in the desktop app, and absent on the website - so every
       use of it is a guarded opt-in and the site behaves exactly as before.
       See desktop/README.md and docs/desktop.md. */
    anrDesktop?: AnrDesktop;

    /* --- UMD vendor globals injected via <script> tag --- */
    $3Dmol?: any;        // vendor/3dmol/3Dmol-min.js
    DjVu?: any;          // vendor/djvu/djvu.js
    LZMA?: any;          // vendor/lzma/lzma-decode.js  (via lib/lzma-loader.js)
    MDBReader?: any;     // vendor/mdb/mdb.js
    Tesseract?: any;     // vendor/tesseract/tesseract.min.js
    XLSX?: any;          // vendor/sheetjs/xlsx.full.min.js
    agPsd?: any;         // vendor/ag-psd/bundle.js
    bodymovin?: any;     // vendor/lottie/lottie.min.js (alias of lottie)
    exifr?: any;         // vendor/exifr.umd.js
    fzstd?: any;         // vendor/fzstd.js
    heic2any?: any;      // vendor/heic2any.min.js
    initSqlJs?: any;     // vendor/sqljs/sql-wasm.js
    jsQR?: any;          // vendor/jsQR.js
    lottie?: any;        // vendor/lottie/lottie.min.js
    occtimportjs?: any;  // CDN occt-import-js (via lib/occt-loader.js)
    opentype?: any;      // vendor/opentype/opentype.min.js
    turnstile?: any;     // Cloudflare Turnstile widget (stats page)
    xzwasm?: any;        // vendor/xzwasm/xzwasm.min.js (via lib/xz-loader.js)
    Buffer?: any;        // shimmed by a couple of vendor bundles

    /* --- vendor-prefixed DOM APIs that lib.dom does not declare ---
       Real browser APIs, just legacy-WebKit ones: every use here is a fallback
       guarded by `window.AudioContext || window.webkitAudioContext`. Unlike the
       Element block below, these are genuinely absent from the DOM lib rather
       than a symptom of an under-narrowed query result. */
    webkitAudioContext?: typeof AudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  }

  interface Document {
    /* Safari's pre-standard fullscreen exit, called behind a capability check. */
    webkitExitFullscreen?: () => void;
  }

  interface Navigator {
    /* Chromium-only device-memory hint, read by core/limits.js for tiering. */
    deviceMemory?: number;
    /* iOS Safari's "launched from the home screen" flag (PWA detection). */
    standalone?: boolean;
    /* Keyboard Lock / getLayoutMap - Chromium only. */
    keyboard?: any;
  }

  /* UMD vendor globals used bare (not via window.): Leaflet's L in the geo
     renderer and exifr in the photo path both load from a plain <script> tag. */
  var L: any;
  var exifr: any;

  /* lib/openjpeg-loader.js attaches the WASM module to globalThis, not window. */
  var OpenJPEGWASM: any;

  /* App state parked directly on DOM nodes.

     These are all app-owned expandos - "have I already wired a listener to this
     node", cached close/show/hide handlers, zoom controls kept next to the
     element they drive. Declared on Element so both Element and HTMLElement
     query results see them.

     NOTE: only underscore-prefixed app properties belong here. Real DOM
     properties that fail to resolve (hidden, offsetWidth, pause, naturalWidth,
     value, src, ...) are NOT declared here on purpose - they fail because
     querySelector() returns Element rather than the specific element type, and
     the honest fix is to narrow at the call site. Declaring them here would
     silence a real class of error and lie about the DOM. */
  interface Element {
    _advLazyRan?: any;
    _aggregateRects?: any;
    _anim?: any;
    _anrAudioNode?: any;
    _anrCt?: any;
    _anrEnsure?: any;
    _anrFx?: any;
    _anrFxLetters?: any;
    _anrFxMeasuredW?: any;
    _anrFxSplit?: any;
    _anrInfoBtn?: any;
    _anrLetterFx?: any;
    _anrLightboxClose?: any;
    _anrLoading?: any;
    _anrResumeSpin?: any;
    _anrSectionFx?: any;
    _anrSnapshot?: any;
    _anrTransport?: any;
    _anrWired?: any;
    _backClose?: any;
    _bar?: any;
    _busy?: any;
    _carve?: any;
    _carveFile?: any;
    _carveFmt?: any;
    _close?: any;
    _cmpWired?: any;
    _collapsedRects?: any;
    _confirmBound?: any;
    _corrupt?: any;
    _cta?: any;
    _elaStats?: any;
    _extNavWired?: any;
    _fileRects?: any;
    _fmtRandWired?: any;
    _fmtWired?: any;
    _gate?: any;
    _headerRects?: any;
    _hide?: any;
    _hideT?: any;
    _hierarchy?: any;
    _i?: any;
    _input?: any;
    _key?: any;
    _label?: any;
    _next?: any;
    _onKey?: any;
    _orig?: any;
    _pitch?: any;
    _prev?: any;
    _realFrac?: any;
    _resetZoom?: any;
    _roTimer?: any;
    _salvageUrl?: any;
    _show?: any;
    __syncPause?: any;
    __syncPlay?: any;
    __syncSeek?: any;
    _text?: any;
    _thumb?: any;
    _tldrBound?: any;
    _toggleZoom?: any;
    _totals?: any;
    _trimHScroll?: any;
    _updatePanCursor?: any;
    _value?: any;
    _viewNode?: any;
    _wired?: any;
    _yaw?: any;
    _zoom?: any;
    _zoomBtn?: any;
  }
}
