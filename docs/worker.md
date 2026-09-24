# Cloudflare Worker (stats API)

The only server-side code in an otherwise zero-backend tool: an anonymous
aggregate-stats API plus a small Asteroids-easter-egg leaderboard. For
engineers touching `/stats`, `/atari`, or the visitor/analysed-file counters.

## What it stores

`worker/index.js` (bound as `main` in `wrangler.jsonc`) backs a D1 database
(`worker/schema.sql`) with four tables:

- **`totals`** - two scalar counters, `files_total` and `visitors_total`.
- **`ext_stats`** - one row per extension ever dropped: `ext`, `supported`
  (0/1), running `count`. `supported` is decided **server-side** from
  `worker/supported-exts.js`, an allow-list of every catalog extension that
  `tools/stamp-counts.mjs` regenerates on every save. The client still sends
  a `supported` flag, but the Worker ignores it: trusting it let one POST put
  any string on the public `/stats` page. Unsupported rows are capped at
  `UNSUPPORTED_ROWS_MAX` (5000); past that, a new unsupported extension is
  counted under `(other)` instead of getting a row of its own.
- **`visitor_seen`** - `ip_hash -> last-counted-timestamp`, for visit dedup
  only (one counted visit per hashed IP per `VISIT_WINDOW`, 3 days). Rows
  older than the window are deleted (`pruneVisitors`, run in the background
  on a fraction of counted visits), so a hash is kept only while it can still
  dedup a visit.
- **`daily`** - one row per UTC calendar day (`files`, `visitors`), feeding
  the `/stats` trend graph. Self-migrating (`ensureDaily`, created lazily on
  first use) so an existing deploy starts recording with no manual step -
  there's no daily back-history before the table existed, only the running
  `totals` scalars.
- **`scores`** - the Asteroids leaderboard: `name` (5 chars `[A-Z0-9]`,
  validated + profanity-checked server-side), `score`, `ts`, `iphash`,
  `wave` (how far the run got), `cause` (the fatal blow: a file extension
  like `.pdf`, or `nuke`). One row per identity (`iphash`+`name`, unique
  index), keeping only each player's best score via an atomic upsert.

`run_worker_first` routes every request except `/assets/*` through the
Worker, which hands everything outside `/api/*` back to
`env.ASSETS.fetch(request)`, i.e. the static site. Two things happen on the
way: the legacy `lab.valjdakosta.com` host gets a 307 to the canonical host
(except `/api/*`, and `/sw.js`, which is answered with a small kill-switch
service worker - a browser rejects a redirected service-worker script, so a
PWA installed from the old host could otherwise never update; this one
clears its caches, unregisters and sends its windows to the canonical host),
and a `/formats/...` page that 404s gets a 301 to the same extension on the
other tier when that page exists. Promoting a format from identification to
full analysis moves it from `/formats/id/<ext>` to `/formats/<ext>`, and the
redirect keeps the old URL that search engines already indexed working.

Five endpoints, all under `/api/*`:

| Endpoint | Method | Does |
|---|---|---|
| `/api/visit` | POST | Counts one visit (deduped by hashed IP / 3-day window), returns live totals; rate-limited |
| `/api/analysed` | POST | Records one analysed file (`{ext}`); rate-limited 15/60s |
| `/api/stats` | GET | Returns totals, the per-extension tally, the top-100 scores, and the daily trend series |
| `/api/score` | POST | Submits one Asteroids run; validates name/score, rate-limited in its own bucket |
| `/api/leaderboard` | GET | Returns the current top-5 scores |

Every POST must carry `content-type: application/json` (the app always
sends it); anything else gets a 415. That makes a cross-site request a
non-simple one needing a CORS preflight, which the Worker never answers, so
another page can't inflate the counters with a `<form>` or a `text/plain`
fetch.

## Privacy preservation

- The browser sends only a lowercase extension string and an increment -
  **never the file's name, bytes, or contents**.
- Visits are deduplicated by `hashIp()`: `SHA-256("<IP_SALT secret>:<IP>")`.
  The raw IP is never stored; the salt (set once via `wrangler secret put
  IP_SALT`) makes the hash unreversible and unprecomputable without it.
  **`IP_SALT` is required**: without it every write endpoint fails closed
  (500) rather than hashing with a public fallback string. For `wrangler dev`,
  put it in `.dev.vars`.
- The salt does not rotate. `scores.iphash` is the leaderboard's identity
  (one entry per player and name), so a rotating salt would split every
  player into a new identity at each rotation. What bounds retention instead:
  `visitor_seen` rows are pruned after the 3-day window, and a score's hash
  lives exactly as long as the score. `/privacy` says both.
- `handleStats()` lists an extension by name only when it is in
  `SUPPORTED_EXTS` (top 500 by count), checked at **read** time - so rows
  written back when the client's flag was trusted can't leak, and a newly
  supported type lists straight away. Everything else is collapsed into a
  single `(unsupported)` bucket before the response is built. This matters
  because an unsupported extension is raw, attacker-controlled input - a
  hostile client could otherwise get an arbitrary string (e.g. a slur used as
  a fake extension) onto the public `/stats` page. The individual counts are
  still recorded privately in `ext_stats` for the operator to inspect via
  `wrangler d1 execute`.
- `cleanExt()` bounds what can even be written as a primary key: lowercase
  `a-z0-9` only, capped at 16 chars, collapsing to `'(none)'`/`'(other)'`
  otherwise - so a hostile client can't flood the table with junk rows.
- Asteroids names are forced to exactly 5 `[A-Z0-9]` chars and checked
  against a leet-folding profanity blocklist (`cleanName`/`isProfane`)
  before being stored or shown on a public leaderboard.
- `ANALYSED_LIMIT` (configured in `wrangler.jsonc`: 15 requests/60s per key)
  throttles `/api/visit`, `/api/analysed` and `/api/score`, each in its own
  bucket (the key is `<endpoint>:` + a hash of the IP, and of the **/64** for
  IPv6, since a v6 client can rotate freely inside its /64). A throttled
  `/api/analysed` still returns 200 (`{throttled: true}`), a throttled visit
  returns the totals with `counted: false`, and a throttled score is a 429.
- One hashed IP may hold at most `SCORE_NAMES_PER_IP` (10) leaderboard names;
  an existing name can always improve its score.
- Any internal failure returns a generic `{error: 'stats unavailable'}`
  (500) - implementation details are never leaked to the client.

## How `history.js` pings it

`web/assets/js/core/history.js` makes `recordAnalysed()` - the **only**
network call this otherwise fully-local tool makes. It posts a lowercase
extension + `supported` flag to `/api/analysed`; if the browser is offline
it skips the doomed request and queues the increment locally
(`enqueueAnalysed`) to send once connectivity returns. `recordVisit()`
similarly POSTs to `/api/visit` once per page load and caches the resolved
totals (`_visitTotals`) so repeat calls in the same session don't re-hit the
network. Both are separate from the module's localStorage-only "Recently
analysed" history panel, which stores file metadata (name, type, size) on
the visitor's own device and is never sent anywhere.

## How `stats.html` consumes it

`web/assets/js/core/stats-page.js`'s `setupStatsPage()` (called from
`boot()` - see [`pages.md`](pages.md)) fetches `/api/stats` and renders the total
files/visitors counters, the per-extension breakdown table (with a "Show
all" toggle past the visible cap), the trend chart from the `daily` series,
and the leaderboard from `scores`. Locally (`server.bat`), there is no
Worker or D1 - `serve.py` mocks `/api/stats` with a deterministic seeded
45-day series and canned extension/score data so the page still renders
during development (see [`tooling.md`](tooling.md)).
