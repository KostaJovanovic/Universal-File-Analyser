# The stats Worker

The only server-side code in an otherwise zero-backend tool: a small Cloudflare
Worker (`worker/index.js`, schema in `worker/schema.sql`) that keeps two anonymous
aggregate counts a static site cannot - how many files have been analysed (with a
per-extension tally) and how many people have visited - plus the Asteroids
leaderboard. It never sees your files. This doc covers what it stores, how privacy
is preserved, and how the client (`history.js`) and `/stats` page consume it.

## What reaches the Worker

With a Worker + static assets, any request that matches a static file is served
directly by Cloudflare and never reaches the Worker. The `fetch` handler only sees
`/api/*`; everything else it hands straight to `env.ASSETS.fetch(request)`, which
applies the same clean-URL + SPA fallback as a Worker-less deploy. So the Worker is
purely the `/api/*` surface.

Bindings (from `wrangler.jsonc`): `DB` (D1 database), `ASSETS` (the static site),
`ANALYSED_LIMIT` (rate-limit: 15 writes/60s keyed by hashed IP), and `IP_SALT` (a
secret salt for the IP hash).

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/analysed` | POST | Record one analysed file: `{ ext, supported }`. Rate-limited (15/min per hashed IP); over the limit it returns 200 but records nothing. |
| `/api/visit` | POST | Count this visitor at most once per IP per 3 days (`VISIT_WINDOW`); returns live totals. Body ignored. |
| `/api/stats` | GET | Totals + per-extension tally (top 500 supported, highest first) + leaderboard + the per-day trend series. |
| `/api/score` | POST | Submit one Asteroids run `{ name, score, wave, cause }` to the leaderboard; returns the new top 5. |
| `/api/leaderboard` | GET | The current top 5 Asteroids scores. |

The browser sends only a **lowercase extension string** ("jpg") and an increment on
`/api/analysed` - never the file's name, bytes or contents.

## What it stores (`schema.sql`)

- **`totals`** - two scalar counters: `files_total` and `visitors_total`.
- **`ext_stats`** - one row per extension ever dropped: `ext`, `supported` (1 =
  Analyser recognises the type), `count`.
- **`visitor_seen`** - visit dedup only: a salted IP hash -> last-counted unix
  second. No raw IPs.
- **`daily`** - one row per UTC day (`files`, `visitors`) for the `/stats` trend
  graph. Self-migrated by `ensureDaily()`, so the series begins the day that code
  shipped (no back-history).
- **`scores`** - the Asteroids leaderboard: `name` (5 chars `[A-Z0-9]`,
  profanity-checked), `score`, `ts`, hashed `iphash`, `wave`, `cause`.

## How privacy is preserved

- **No file data, ever.** Only an extension string and an increment cross the wire.
- **Salted IP hash for dedup.** Visits are deduplicated by `SHA-256("salt:ip")`
  (`hashIp`), so the raw IP is never stored or derivable, and can't be precomputed
  without the secret `IP_SALT`.
- **Extension sanitising (`cleanExt`).** Recorded extensions are folded to
  lowercase `a-z0-9`, capped at 16 chars; empty -> `(none)`, over-long/odd ->
  `(other)`, so a hostile client can't flood the table with junk primary keys.
- **Unsupported extensions are hidden on output.** `/api/stats` lists supported
  extensions individually but collapses **every** unsupported extension into a
  single `(unsupported)` bucket returning only the aggregate. An unsupported ext is
  a raw user-supplied string, so a client could drop a file named `.<slur>` purely
  to get that string onto the public page - folding them means those raw names
  never leave the server (the operator can still inspect the private wish-list via
  `wrangler d1 execute`).
- **`supported` is monotonic (`MAX`).** Once any client classifies a type as
  supported it stays supported. So when a previously-unknown type gains a viewer,
  its accumulated count leaves the `(unsupported)` dogpile and lists individually -
  and a stale cached client can't flip it back.
- **Abuse resistance.** Rate limiting on writes; a score cap (`SCORE_MAX`); atomic
  upserts so concurrent racers can't double-count a visit or slip duplicate scores.
  Errors return a generic "stats unavailable" and never leak internals.

## How the client consumes it

- **The ping (`web/assets/js/core/history.js`).** `recordAnalysed(ext, supported)`
  is the only network call the otherwise fully-local app makes; it POSTs to
  `/api/analysed`. When the API is unreachable (offline, or a local `server.bat`
  with no Worker) the event is queued in `localStorage` and retried later.
  `recordVisit()` POSTs `/api/visit` once. The "Recently analysed" panel is a
  separate `localStorage` snapshot of file *metadata only* (name/size/type/kind) -
  it never leaves the device.
- **The `/stats` page (`stats-page.js`).** `setupStatsPage()` GETs `/api/stats` and
  renders the totals, the per-extension table, the leaderboard and the trend chart.
  The service worker never caches `/api/*`, so the page always reads live data and
  fails cleanly when offline.

See `/privacy` (`web/privacy.html`) for the plain-language version and the repo
`wrangler.jsonc` SETUP block for the one-time D1 provisioning steps.
