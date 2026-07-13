# Cloudflare Worker (stats API)

The only server-side code in an otherwise zero-backend tool: an anonymous
aggregate-stats API plus a small Asteroids-easter-egg leaderboard. For
engineers touching `/stats`, `/atari`, or the visitor/analysed-file counters.

## What it stores

`worker/index.js` (bound as `main` in `wrangler.jsonc`) backs a D1 database
(`worker/schema.sql`) with four tables:

- **`totals`** - two scalar counters, `files_total` and `visitors_total`.
- **`ext_stats`** - one row per extension ever dropped: `ext`, `supported`
  (0/1), running `count`. `supported` is **monotonic** (`MAX`, never reset to
  0) - once any client has classified an extension as supported it stays
  supported even if a stale cached client later reports it as unknown, and
  adding support for a previously-unsupported type flips its whole
  accumulated count out of the "unsupported" bucket permanently.
- **`visitor_seen`** - `ip_hash -> last-counted-timestamp`, for visit dedup
  only (one counted visit per hashed IP per `VISIT_WINDOW`, 3 days).
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

Five endpoints, all under `/api/*` (everything else is handed straight back
to `env.ASSETS.fetch(request)`, i.e. the static site, since a Worker +
static-assets deploy only invokes the Worker for paths with no matching
asset):

| Endpoint | Method | Does |
|---|---|---|
| `/api/visit` | POST | Counts one visit (deduped by hashed IP / 3-day window), returns live totals |
| `/api/analysed` | POST | Records one analysed file (`{ext, supported}`); rate-limited 15/60s per hashed IP |
| `/api/stats` | GET | Returns totals, the per-extension tally, the top-100 scores, and the daily trend series |
| `/api/score` | POST | Submits one Asteroids run; validates name/score, rate-limited like `/api/analysed` |
| `/api/leaderboard` | GET | Returns the current top-5 scores |

## Privacy preservation

- The browser sends only a lowercase extension string and an increment -
  **never the file's name, bytes, or contents**.
- Visits are deduplicated by `hashIp()`: `SHA-256("<IP_SALT secret>:<IP>")`.
  The raw IP is never stored; the salt (set once via `wrangler secret put
  IP_SALT`) makes the hash unreversible and unprecomputable without it.
- `handleStats()` only ever returns **supported** extensions individually
  (top 500 by count); every unsupported extension is collapsed server-side
  into a single `(unsupported)` bucket before the response is built. This
  matters because an unsupported extension is raw, attacker-controlled input
  - a hostile client could otherwise get an arbitrary string (e.g. a slur
  used as a fake extension) onto the public `/stats` page. The individual
  counts are still recorded privately in `ext_stats` for the operator to
  inspect via `wrangler d1 execute`.
- `cleanExt()` bounds what can even be written as a primary key: lowercase
  `a-z0-9` only, capped at 16 chars, collapsing to `'(none)'`/`'(other)'`
  otherwise - so a hostile client can't flood the table with junk rows.
- Asteroids names are forced to exactly 5 `[A-Z0-9]` chars and checked
  against a leet-folding profanity blocklist (`cleanName`/`isProfane`)
  before being stored or shown on a public leaderboard.
- `ANALYSED_LIMIT` (configured in `wrangler.jsonc`: 15 requests/60s per
  hashed IP) throttles both `/api/analysed` and `/api/score` so a scripted
  loop can't inflate the counters or flood the leaderboard; a throttled
  request still returns 200 (`{throttled: true}`) rather than erroring.
- Any internal failure returns a generic `{error: 'stats unavailable'}` (500)
  - implementation details are never leaked to the client.

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
`boot()` - see `docs/pages.md`) fetches `/api/stats` and renders the total
files/visitors counters, the per-extension breakdown table (with a "Show
all" toggle past the visible cap), the trend chart from the `daily` series,
and the leaderboard from `scores`. Locally (`server.bat`), there is no
Worker or D1 - `serve.py` mocks `/api/stats` with a deterministic seeded
45-day series and canned extension/score data so the page still renders
during development (see `docs/tooling.md`).
