# PWA and offline

How Analyser installs and runs fully offline: the service worker's shell precache
and version-epoched cache, the three cumulative "Download for offline use" tiers,
the manifest, and the install flow. Sources: `web/sw.js`,
`web/assets/js/core/offline-tiers.js`, `web/manifest.json`.

## The service worker (`web/sw.js`)

`sw.js` precaches an explicit `SHELL` array under a version-epoched cache name,
`VERSION = 'analyser-vNNN'` (the `NNN` is bumped by `save.bat` on every commit,
mirroring `COMMIT_COUNT` in `app.js`). The `SHELL` is the whole app: every HTML
route (`/`, `/about`, `/patch`, `/formats`, `/stats`, `/privacy`, `/samples`,
`/compare`), all core JS, every renderer, every parser chunk and lib loader, the
Asteroids game modules, the icons, and `exifr`.

**Serve strategy: cache-first.** A cache hit is returned with no background
revalidation - the cache is version-epoched, so a cached entry is always the
current build's. Only a miss touches the network, and the fresh response is stored
under the current version. Cross-origin Turnstile is best-effort precached with a
no-cors fetch.

Key robustness and correctness details:

- **Independent precache.** Install uses `Promise.allSettled` + `cache.add` per
  entry, not `cache.addAll`, so one transient miss (a file mid-regeneration, a sync
  lock) no longer rejects the whole install and leaves the SW dead.
- **Dev pass-through.** On `localhost`, `127.0.0.1`, `0.0.0.0` or a LAN IP the SW
  caches nothing and never intercepts, so a single refresh shows the latest edits.
- **`/api/*` is never cached** - the stats endpoints stay live (and fail cleanly
  offline, which `/stats` handles).
- **Explicit VERSION-cache lookup first.** The fetch handler checks
  `caches.open(VERSION).match(req)` before a bare `caches.match()`. This matters
  because the persistent `analyser-offline` tier can hold app URLs from an older
  build; a bare match could pin opted-in offline users on a stale `app.js`. Only a
  VERSION miss falls back to the other surviving caches.

**Caches kept on activate (`KEEP_CACHES`):** `VERSION` (dropped and rebuilt each
release), plus two that survive version bumps - `analyser-offline` (the user's
explicitly downloaded offline tiers) and `analyser-mdx` (the day-cached AI vocal-
separation model). Everything else is deleted on activate.

## The offline tiers (`offline-tiers.js`)

The footer's "Download for offline use" section (`setupOfflineTiers()`, called once
from `boot()`; a no-op on pages without the markup) offers three **cumulative**
tiers - each includes every lower tier's files. Sizes are totals from the single
source `TIER_MB`:

| Tier | Approx size | Adds |
|---|---|---|
| **Essentials** | ~50 MB | The whole app: every HTML route, all core/renderer/parser/lib JS, the game, the fonts, icons, exifr, and the heavier always-there engines (ImageMagick, LibRaw, FFmpeg). Kept in step with `sw.js` `SHELL`. |
| **Everything** | ~120 MB | OCR (Tesseract + English data), maps (Leaflet), QR (jsQR), HEIC (heic2any), PDF (pdf.js), archives (fflate, libarchive, xz), JPEG 2000 (OpenJPEG), the format-specific viewer libs (ag-psd, SheetJS, opentype, DjVu, foliate, mdb), OpenCASCADE (STEP/IGES), Ghostscript (PostScript), LibreDWG (DWG), the muxers, and the `/samples` gallery files. |
| **Complete** | ~345 MB + the MDX model | OCR in 30+ languages plus the on-device AI vocal-separation model. Split internally into optional feature packs downloadable individually from the Complete popup. |

Downloaded tier files go into the persistent `analyser-offline` cache (survives
version bumps). Each tier button shows download progress and a "Cached" badge;
`refreshTierButtons()` computes the "+N MB more" upgrade deltas. A version-aware
re-download refreshes tier files in place after a deploy (the `activate` cleanup
deliberately does not wipe `analyser-offline`). A "clear storage" button empties it.

> Maintenance note: `TIERS.essentials` is the offline manifest of app modules and
> must be kept in step with `sw.js` `SHELL` whenever a core/renderer/parser module
> is added - both are hand-maintained lists.

## The manifest (`web/manifest.json`)

A standard PWA manifest: `name` "Analyser - Local File & Metadata Viewer",
`short_name` "Analyser", `start_url`/`scope` `./`, `display: standalone`, white
theme/background, and 192/512 icons (including a maskable 512). The description's
format count is stamped by `tools/stamp-counts.mjs` (see `docs2/tooling.md`).

## The install flow

`offline-tiers.js` wires a PWA install button off `beforeinstallprompt` where
available. When the native prompt is not available (iOS/Safari, Firefox, or a
browser that has not fired the event), it shows a platform-specific `installHint()`
- e.g. iOS "tap Share, then Add to Home Screen", desktop Chrome/Edge address-bar
install icon, or a note that desktop Firefox cannot install web apps. Once
installed and with a tier downloaded, the app runs fully offline: the SHELL is
cache-first and the downloaded tier supplies the heavy engines.
