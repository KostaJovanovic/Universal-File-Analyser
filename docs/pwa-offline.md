# PWA and offline support

How Analyser installs as an offline-capable app: the service worker's
precached shell, the cache-versioning scheme, the three cumulative
"download for offline use" tiers, and the install flow. See also
`docs/architecture.md`'s PWA/service-worker summary for the request-handling
logic.

## Service worker SHELL precache

`web/sw.js` defines `SHELL`, a hand-maintained array of every core JS
module, CSS file, image and top-level clean-URL page (`./`, `./about`,
`./patch`, `./formats`, `./stats`, `./privacy`, `./samples`, `./compare`)
that makes up the minimum installable app. On `install`, each entry is
cached independently via `Promise.allSettled` (not `cache.addAll`'s
all-or-nothing) so one transient miss can't fail the whole install; a
missing entry is logged and can still be picked up later by the fetch
handler. Cloudflare Turnstile's script is separately best-effort-precached
with a `no-cors` fetch since it's cross-origin and would otherwise fail
`addAll`. Local dev (`server.bat` on localhost/LAN, detected via `DEV`)
skips all of this and installs as a pure network pass-through, so edits show
up on a single refresh.

`SHELL` only covers the "Essentials"-equivalent core - it is a separate list
from the offline-tiers manifests below, but the two must be kept in step
manually (`offline-tiers.js`'s top comment notes this explicitly: keep
`TIERS.essentials` in step with `SHELL` when adding a new core/renderer/
parser module).

## VERSION cache epoch

`const VERSION = 'analyser-v' + COMMIT_COUNT` names the cache. Every commit
bumps `COMMIT_COUNT` (via `save.bat`, see `docs/tooling.md`), so every deploy
gets a fresh cache name. On `activate`, any cache not in `KEEP_CACHES`
(`[VERSION, 'analyser-offline', 'analyser-mdx']`) is deleted - so the
previous version's shell is dropped, but the user's chosen offline-tier
downloads (`analyser-offline`) and the cached vocal-separation model
(`analyser-mdx`) survive across deploys untouched. Requests are served
cache-first: the current `VERSION` cache is checked explicitly first (not a
bare `caches.match()`, which would search every cache in creation order and
could return a stale copy of an app module from the persistent
`analyser-offline` tier); only a genuine miss falls back to the other
surviving caches, then the network. `/api/*` requests are never cached, so
`/stats` always sees live data (or fails cleanly offline).

## Offline tiers

`web/assets/js/core/offline-tiers.js` implements the "Download for offline
use" footer section shared across pages: cumulative tier manifests, per-tier
download/progress/"Cached" badge logic, the collapsible section, the PWA
install button, and clear-storage. `setupOfflineTiers(COMMIT_COUNT,
RELEASE_COMMITS, analyserVersion)` is called once from `boot()`; it queries
its own DOM by id/class, so it's a no-op on any page missing the offline
markup (all main pages carry it via the shared footer partial - see the
`shared-partials` skill).

Three cumulative tiers (`TIER_ORDER = ['essentials', 'everything',
'complete']`), each including everything in the tier below it:

| Tier | Size | Contents |
|---|---|---|
| **Essentials** | ~50 MB | The whole app - open, inspect and analyse any file, fully offline |
| **Everything** | ~120 MB | Text in images/PDFs (OCR), photo-location maps, QR scanning, HEIC photos, archives, EPS/PostScript, CAD drawings, the sample gallery |
| **Complete** | ~345 MB + the MDX model size | Opens a popup for optional extras on top of Everything: OCR in 30+ languages, and on-device AI vocal separation (either or both) |

`TIER_MB` is the single source of truth for the sizes shown on every button
and in the footer's help panel; `complete`'s size additionally includes
`MDX_TIER_MB` from `../lib/mdx-model.js` (see `docs/parsers-and-libs.md`).
Downloaded tiers are cached under the persistent `analyser-offline` cache
name (surviving service-worker version bumps, per above) and refreshed in
place - not wiped - when a new version's files change.

## Manifest / install flow

`web/manifest.json` declares the PWA: name/short_name, `start_url`/`scope`
of `./`, `display: standalone`, and three icon sizes (192/512, plus a
maskable 512 variant). `stamp-counts.mjs` (see `docs/tooling.md`) stamps the
supported-format count into the manifest's description at commit time.

The install button in the offline-tiers footer listens for the browser's
native `beforeinstallprompt` event (captured once, globally, guarded by
`setupOfflineTiers._winWired` so it isn't re-registered on every SPA
navigation) and shows the native install UI when available. On platforms
that never fire that event (iOS, Safari, Firefox desktop), `installHint()`
sniffs the user agent and shows a platform-specific manual instruction
instead (e.g. "tap Share, then Add to Home Screen" on iOS; a note that
Firefox desktop can't install web apps at all). Below 16.4, iOS also ignores
`manifest.json` entirely - `index.html`'s `apple-mobile-web-app-*` meta tags
and `apple-touch-icon` link exist specifically to drive Add to Home Screen
on those older versions.
