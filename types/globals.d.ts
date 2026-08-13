/* Analyser - ambient global declarations.

   Two unrelated groups live here:

   1. The `window._anr*` channel. app.js and the classic-script router
      (core/navigate.js) talk to each other through globals rather than imports,
      because navigate.js is loaded WITHOUT type="module" and so cannot import.
      A few renderers also park state here for the SPA restore path.

   2. UMD vendor globals. Roughly half of web/assets/vendor/ is loaded by
      injecting a <script> tag at runtime rather than by ES import, so the
      library lands on `window` with no static import to type it.

   Phase 1 posture: everything is `any`. These get real types in Phase 3 as each
   directory is tightened - see the migration plan. Do not add app code types
   here; those belong in src/core/types.ts. */

export {};

declare global {
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

    /* --- UMD vendor globals injected via <script> tag --- */
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
  }

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
    __syncPlay?: any;
    _anrEnsure?: any;
    _anrFx?: any;
    _anrFxLetters?: any;
    _anrFxMeasuredW?: any;
    _anrFxSplit?: any;
    _anrInfoBtn?: any;
    _anrLetterFx?: any;
    _anrLoading?: any;
    _anrSectionFx?: any;
    _anrWired?: any;
    _backClose?: any;
    _close?: any;
    _confirmBound?: any;
    _extNavWired?: any;
    _fmtRandWired?: any;
    _fmtWired?: any;
    _hide?: any;
    _i?: any;
    _next?: any;
    _prev?: any;
    _resetZoom?: any;
    _show?: any;
    _tldrBound?: any;
    _toggleZoom?: any;
    _trimHScroll?: any;
    _updatePanCursor?: any;
    _wired?: any;
    _zoom?: any;
    _zoomBtn?: any;
  }
}
