// Analyser - stats Worker.
//
// This is the ONLY server-side code in an otherwise zero-backend tool. It exists
// purely to keep two anonymous aggregate counts that a static site cannot:
//   - how many files have been analysed (with a per-extension tally), and
//   - how many people have visited.
//
// It never sees your files. The browser sends only a lowercase extension string
// ("jpg") and an increment - never the file's name, bytes or contents. Visits
// are deduplicated by a SALTED HASH of the IP, so the raw IP is never stored or
// derivable. See /privacy for the plain-language version.
//
// Bindings (configured in wrangler.jsonc):
//   DB             - D1 database (schema in worker/schema.sql)
//   ASSETS         - the static site; used for every non-/api request
//   ANALYSED_LIMIT - rate-limit binding: 15 requests / 60s per key; the key is
//                    endpoint + hashed IP (IPv6: the /64), so /api/visit,
//                    /api/analysed and /api/score each get their own bucket
//   IP_SALT        - secret salt for the IP hash (set with `wrangler secret put`).
//                    REQUIRED: without it every write endpoint fails closed.
//
// Retention: visitor_seen rows (salted hash + last-counted time) are deleted once
// older than VISIT_WINDOW. scores.iphash is kept for as long as the score is on
// the board - it is what keeps one entry per player and name.
//
// Routing: wrangler.jsonc sets run_worker_first for everything except /assets/*,
// so this handler sees every page request (including ones that match a static
// file) and hands the non-/api ones back to the assets system via env.ASSETS.
// That is what makes the legacy-host redirect below possible - without it,
// lab.valjdakosta.com/about would be served straight from the asset store and
// never reach this code.

// Generated from the formats catalog by tools/stamp-counts.mjs on every save.
// The ONLY source of the `supported` decision - the client's flag is ignored.
import { SUPPORTED_EXTS } from './supported-exts.js';

const VISIT_WINDOW = 3 * 24 * 60 * 60; // seconds - one counted visit per IP / 3 days

// Most distinct UNSUPPORTED extension rows ext_stats may hold. Supported rows are
// bounded by the catalog; unsupported ones are raw client strings, so past this
// many a new one is counted under '(other)' instead of getting its own row.
const UNSUPPORTED_ROWS_MAX = 5000;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// SHA-256 of "salt:ip" as hex. Salting means the stored value can't be reversed
// to an IP even if the table leaked, and can't be precomputed without the secret.
async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(salt + ':' + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fail closed: without the secret the "salted" hash would be salted with a string
// that is public in this repo, i.e. reversible by brute force over the IPv4 space.
// Throwing lands in the fetch handler's catch -> a generic 500, nothing stored.
// (For `wrangler dev`, put IP_SALT in .dev.vars.)
function ipSalt(env) {
  if (!env.IP_SALT) throw new Error('IP_SALT secret is not set');
  return env.IP_SALT;
}

async function clientIpHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  return hashIp(ip, ipSalt(env));
}

// Rate-limit key. IPv6 clients usually hold a whole /64 and can rotate through it
// freely, so an IPv6 address is keyed on its first four hextets (the /64); IPv4
// keeps the full address. `scope` gives each endpoint its own bucket, so a folder
// of 15 analysed files doesn't use up the leaderboard submit.
async function rateKey(request, env, scope) {
  let ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (ip.includes(':')) {
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const full = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
    ip = full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64';
  }
  return scope + ':' + await hashIp(ip, ipSalt(env));
}

// Returns true when the request may proceed. With no binding (wrangler dev
// without it) nothing is limited.
async function withinLimit(request, env, scope) {
  if (!env.ANALYSED_LIMIT) return true;
  const { success } = await env.ANALYSED_LIMIT.limit({ key: await rateKey(request, env, scope) });
  return success;
}

// Every POST the site makes is a fetch() with `content-type: application/json`.
// Requiring it turns a cross-site request into a non-simple one that needs a CORS
// preflight - which this Worker never answers - so another page can't inflate the
// counters with a plain <form> or a text/plain fetch.
function isJsonPost(request) {
  return (request.headers.get('content-type') || '').toLowerCase().startsWith('application/json');
}

// Keep the ext table clean and bounded: lowercase a-z0-9 only, <= 16 chars.
// A file with no extension counts as '(none)'; anything longer/odd collapses to
// '(other)' so a hostile client can't flood the table with junk primary keys.
function cleanExt(raw) {
  const e = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!e) return '(none)';
  return e.length <= 16 ? e : '(other)';
}

// May this ext_stats key be shown by name on /stats? A catalog extension, or the
// server-made '(none)' bucket (files with no extension - often a PDF or ZIP the
// content sniffer identified). Never a raw client string that isn't in the catalog.
function isListed(ext) {
  return ext === '(none)' || SUPPORTED_EXTS.has(ext);
}

// --- Asteroids leaderboard ---
const SCORE_MAX = 100000000;   // sanity cap so a tampered client can't post nonsense
const SCORE_NAMES_PER_IP = 10; // distinct leaderboard names one hashed IP may hold

// Leet-fold digits/symbols to letters so "5h1t" still reads as "shit" for the
// profanity check. Names are A-Z0-9 only, so this just maps the digit lookalikes.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };
// Clearly offensive terms / slurs. Kept to ones unlikely to be a substring of an
// innocent 5-letter name (so "ass"/"hell"/"damn" are deliberately NOT here).
const BLOCKLIST = [
  'fuck', 'shit', 'cunt', 'cock', 'dick', 'pussy', 'slut', 'whore', 'bitch',
  'nigg', 'niga', 'nigr', 'fagg', 'spic', 'kike', 'gook', 'chink', 'coon',
  'dyke', 'twat', 'wank', 'rape', 'retar',
];

// Normalise to exactly five [A-Z0-9] (uppercased), or null if it can't be. Only
// English Latin letters and digits survive; anything else is stripped, then the
// result must be exactly 5 characters.
function cleanName(raw) {
  const up = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return up.length === 5 ? up : null;
}
function isProfane(name) {
  const norm = name.toLowerCase().replace(/[0-9]/g, (c) => LEET[c] || c);
  return BLOCKLIST.some((w) => norm.includes(w));
}

async function topScores(env, limit = 5) {
  try {
    // ts (achieved date), wave and cause (the fatal file / nuke) are shown on the
    // /stats board. Fall back to the bare columns if the DB predates them, so the
    // board still renders before the migration runs.
    const rows = await env.DB.prepare(
      'SELECT name, score, ts, wave, cause FROM scores ORDER BY score DESC, ts ASC LIMIT ?',
    ).bind(limit).all();
    return (rows.results || []).map((r) => ({ name: r.name, score: r.score, ts: r.ts, wave: r.wave, cause: r.cause }));
  } catch (_) {
    try {
      const rows = await env.DB.prepare(
        'SELECT name, score, ts FROM scores ORDER BY score DESC, ts ASC LIMIT ?',
      ).bind(limit).all();
      return (rows.results || []).map((r) => ({ name: r.name, score: r.score, ts: r.ts }));
    } catch (_) {
      return [];   // table may not exist yet (pre-migration) - don't break /api/stats
    }
  }
}

// Lazily add the wave/cause columns to an existing scores table (idempotent;
// "duplicate column" errors are swallowed). Lets a new deploy self-migrate
// without a manual `wrangler d1 execute` step.
//
// Memoised per isolate, exactly like ensureDaily above: the work here is two
// ALTER TABLEs, a whole-table dedup DELETE and a CREATE INDEX, and it is a
// one-time migration - running it on every single score submit spent four D1
// statements re-proving a fact that cannot change back.
let _scoreColumnsReady = false;
async function ensureScoreColumns(env) {
  if (_scoreColumnsReady) return;
  for (const col of ['wave INTEGER', 'cause TEXT']) {
    try { await env.DB.prepare('ALTER TABLE scores ADD COLUMN ' + col).run(); } catch (_) { /* already present */ }
  }
  // One row per identity (iphash + name). Dedup any legacy duplicates (keep the
  // most recent, which the old "store only your best" logic made the best), then
  // enforce it with a unique index so a score submit can be a single atomic upsert
  // instead of a racy select-then-delete-insert. Best-effort: if it can't be
  // created, handleScore falls back to the previous non-atomic path.
  try {
    await env.DB.prepare(
      'DELETE FROM scores WHERE iphash IS NOT NULL AND id NOT IN '
      + '(SELECT MAX(id) FROM scores WHERE iphash IS NOT NULL GROUP BY iphash, name)',
    ).run();
    await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_identity ON scores(iphash, name)').run();
    // Latch only once the index is actually there. If it could not be created,
    // handleScore is running on the non-atomic fallback path, so the next submit
    // should try the migration again rather than assume it is done.
    _scoreColumnsReady = true;
  } catch (_) { /* index optional - retry on the next submit */ }
}

// Normalise the "final blow" tag: a file extension like '.pdf' or the literal
// 'nuke'. Lowercased, restricted to a small safe charset, length-capped. Returns
// null when empty/unusable (an older or skipped client just omits it).
function cleanCause(raw) {
  const c = String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z0-9.+_-]/g, '').slice(0, 24);
  return c || null;
}

async function readTotals(env) {
  const rows = await env.DB.prepare('SELECT key, val FROM totals').all();
  const out = { files: 0, visitors: 0 };
  for (const r of rows.results || []) {
    if (r.key === 'files_total') out.files = r.val;
    else if (r.key === 'visitors_total') out.visitors = r.val;
  }
  return out;
}

const BUMP_FILES = "INSERT INTO totals (key, val) VALUES ('files_total', 1) "
  + 'ON CONFLICT(key) DO UPDATE SET val = val + 1';
const BUMP_VISITORS = "INSERT INTO totals (key, val) VALUES ('visitors_total', 1) "
  + 'ON CONFLICT(key) DO UPDATE SET val = val + 1';

// --- Per-day trend buckets (one row per UTC day) ---
// Upserts that add to today's row. Kept separate from the running totals so the
// /stats page can draw a per-day / cumulative graph; see worker/schema.sql.
const BUMP_DAY_VISITOR = 'INSERT INTO daily (day, files, visitors) VALUES (?, 0, 1) '
  + 'ON CONFLICT(day) DO UPDATE SET visitors = visitors + 1';
const BUMP_DAY_FILE = 'INSERT INTO daily (day, files, visitors) VALUES (?, 1, 0) '
  + 'ON CONFLICT(day) DO UPDATE SET files = files + 1';

// UTC calendar day ('YYYY-MM-DD') for a unix-ms timestamp.
function dayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

// Lazily create the daily table (idempotent; cached per isolate so it runs at
// most once). Lets an existing deploy start recording without a manual
// `wrangler d1 execute`. Callers wrap it in try/catch so a failure here can
// never block the core count.
let _dailyReady = false;
async function ensureDaily(env) {
  if (_dailyReady) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, '
    + 'files INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0)',
  ).run();
  _dailyReady = true;
}

// The per-day series, oldest first. Bounded so the payload can't grow without
// limit; the graph shows roughly the last year. Returns [] before the first
// daily row exists (older worker / fresh table) so /api/stats never breaks.
async function readDaily(env, limit = 400) {
  try {
    const rows = await env.DB.prepare(
      'SELECT day, files, visitors FROM daily ORDER BY day DESC LIMIT ?',
    ).bind(limit).all();
    return (rows.results || [])
      .map((r) => ({ day: r.day, files: r.files, visitors: r.visitors }))
      .reverse();
  } catch (_) {
    return [];
  }
}

// Delete dedup rows older than the visit window. Past VISIT_WINDOW a row changes
// nothing (the next visit from that hash counts either way, via the upsert's
// WHERE), so keeping it would only retain a salted IP hash for no purpose. Run
// off the response path on a fraction of counted visits - often enough that no
// row outlives the window by more than a short while.
async function pruneVisitors(env, now) {
  try {
    await env.DB.prepare('DELETE FROM visitor_seen WHERE last < ?').bind(now - VISIT_WINDOW).run();
  } catch (_) { /* best-effort housekeeping */ }
}

// POST /api/visit - count this visitor at most once per IP / 3 days, then return
// the live totals so the homepage badge can paint. Body is ignored.
async function handleVisit(request, env, ctx) {
  // Over the limit: still paint the badge, just don't touch visitor_seen.
  if (!(await withinLimit(request, env, 'visit'))) {
    return json({ ...(await readTotals(env)), counted: false });
  }
  const ipHash = await clientIpHash(request, env);
  const now = Math.floor(Date.now() / 1000);

  // Atomic "new-or-expired visitor?" test. A separate SELECT-then-decide let two
  // concurrent first-time requests for one IP both read "no row" and both bump the
  // total. Instead do the state transition in a single upsert: insert the row, or
  // update `last` only when the visit window has elapsed. SQLite reports one
  // changed row exactly when a fresh insert or a window-elapsed update happened,
  // so meta.changes is the definitive "count this visit" signal - and because the
  // write is serialised, only the first of two racers sees changes === 1.
  const upd = await env.DB.prepare(
    'INSERT INTO visitor_seen (ip_hash, last) VALUES (?1, ?2) '
    + 'ON CONFLICT(ip_hash) DO UPDATE SET last = ?2 WHERE ?2 - visitor_seen.last >= ?3',
  ).bind(ipHash, now, VISIT_WINDOW).run();
  const counted = !!(upd.meta && upd.meta.changes === 1);
  if (counted) {
    await env.DB.prepare(BUMP_VISITORS).run();
    // Add to today's per-day bucket. Best-effort and isolated from the core
    // count above so a daily-table hiccup never costs us the visit.
    try {
      await ensureDaily(env);
      await env.DB.prepare(BUMP_DAY_VISITOR).bind(dayKey(now * 1000)).run();
    } catch (_) { /* daily series is non-critical */ }
    if (Math.random() < 0.05) {
      if (ctx && ctx.waitUntil) ctx.waitUntil(pruneVisitors(env, now));
      else await pruneVisitors(env, now);
    }
  }

  return json({ ...(await readTotals(env)), counted });
}

// POST /api/analysed {ext} - record one analysed file. Rate-limited to 15/min per
// IP (/64 on IPv6) so a script loop can't inflate the counter; over the limit the
// request is accepted (200) but not recorded.
async function handleAnalysed(request, env) {
  if (!(await withinLimit(request, env, 'analysed'))) return json({ throttled: true });

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const ext = cleanExt(body.ext);

  // `supported` is decided HERE, from the catalog allow-list - never from the
  // client's `supported` field (still sent by the app, now ignored). Trusting it
  // let a single hand-made POST mark any string as supported and so publish it on
  // /stats. The stored flag simply follows the current catalog: a type that gains
  // support flips to 1 on its next drop, and handleStats filters through the same
  // set at read time, so the public list is right even before that.
  const supported = isListed(ext) ? 1 : 0;

  // Supported rows are bounded by the catalog. Unsupported ones are raw client
  // strings: an existing row just counts up, a NEW one is only created while there
  // are fewer than UNSUPPORTED_ROWS_MAX of them - past that the file is counted
  // under '(other)' instead, so the table can't be grown without limit.
  const upsert = supported
    ? env.DB.prepare(
      'INSERT INTO ext_stats (ext, supported, count) VALUES (?1, 1, 1) '
      + 'ON CONFLICT(ext) DO UPDATE SET count = count + 1, supported = 1',
    ).bind(ext)
    : env.DB.prepare(
      'INSERT INTO ext_stats (ext, supported, count) SELECT ?1, 0, 1 '
      + 'WHERE EXISTS (SELECT 1 FROM ext_stats WHERE ext = ?1) '
      + 'OR (SELECT COUNT(*) FROM ext_stats WHERE supported = 0) < ?2 '
      + 'ON CONFLICT(ext) DO UPDATE SET count = count + 1, supported = 0',
    ).bind(ext, UNSUPPORTED_ROWS_MAX);
  const [res] = await env.DB.batch([upsert, env.DB.prepare(BUMP_FILES)]);
  if (!supported && !(res && res.meta && res.meta.changes)) {
    await env.DB.prepare(
      "INSERT INTO ext_stats (ext, supported, count) VALUES ('(other)', 0, 1) "
      + 'ON CONFLICT(ext) DO UPDATE SET count = count + 1',
    ).run();
  }
  // Add to today's per-day bucket (best-effort; never blocks the file count).
  try {
    await ensureDaily(env);
    await env.DB.prepare(BUMP_DAY_FILE).bind(dayKey(Date.now())).run();
  } catch (_) { /* daily series is non-critical */ }

  return json({ ok: true });
}

// GET /api/stats - totals, the per-extension tally (highest first), the per-day
// trend series and the leaderboard (top 100 - the /stats board lists far more
// than the 5 /api/leaderboard returns for the in-game panel).
// Supported extensions are listed individually (top 500 by count). Every
// UNSUPPORTED extension is collapsed into a single "(unsupported)" bucket and
// only its aggregate count is returned: an unsupported ext is the raw,
// user-supplied file extension, so a hostile client could drop a file named
// ".<slur>" purely to get that string onto the public stats page. Folding them
// here means those raw names never leave the server. They are still recorded
// individually in ext_stats, so the operator can inspect the wish-list privately
// (e.g. `wrangler d1 execute DB --command
//   "SELECT ext, count FROM ext_stats WHERE supported = 0 ORDER BY count DESC"`).
//
// Whether a row is listed by name is decided by SUPPORTED_EXTS at read time, not
// by the stored flag: rows written before the server-side decision may carry a
// client-set supported = 1 for an arbitrary string, and a newly supported type
// should list individually straight away, without waiting to be re-dropped.
async function handleStats(env) {
  const rows = await env.DB.prepare('SELECT ext, count FROM ext_stats').all();
  const extensions = [];
  let unsupported = 0;
  for (const r of rows.results || []) {
    if (isListed(r.ext)) extensions.push({ ext: r.ext, supported: true, count: r.count });
    else unsupported += Number(r.count) || 0;
  }
  extensions.sort((a, b) => (b.count - a.count) || (a.ext < b.ext ? -1 : 1));
  extensions.length = Math.min(extensions.length, 500);
  if (unsupported > 0) extensions.push({ ext: '(unsupported)', supported: false, count: unsupported });
  extensions.sort((a, b) => (b.count - a.count) || (a.ext < b.ext ? -1 : 1));
  return json({
    ...(await readTotals(env)),
    extensions,
    scores: await topScores(env, 100),
    daily: await readDaily(env),
  });
}

// POST /api/score {name, score} - submit one Asteroids run to the leaderboard.
// Validates the name (5x [A-Z0-9], not profane) and the score (positive, capped),
// inserts it, and returns the new top 5. Rate-limited in its own bucket (same
// 15/60s binding as /api/analysed, separate key) so a script can't flood the board
// and a burst of analysed files can't block a genuine submit.
async function handleScore(request, env) {
  const ipHash = await clientIpHash(request, env);
  if (!(await withinLimit(request, env, 'score'))) {
    return json({ ok: false, error: 'Too many submissions, try again shortly.' }, 429);
  }
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const name = cleanName(body.name);
  const score = Math.floor(Number(body.score));
  if (!name) return json({ ok: false, error: 'Name must be 5 letters or numbers.' }, 400);
  if (isProfane(name)) return json({ ok: false, error: 'Please choose a different name.' }, 400);
  if (!Number.isFinite(score) || score <= 0 || score > SCORE_MAX) {
    return json({ ok: false, error: 'Invalid score.' }, 400);
  }
  // Run metadata, clamped/sanitised (a tampered or old client can't break the row).
  const waveN = Math.floor(Number(body.wave));
  const wave = Number.isFinite(waveN) && waveN >= 0 && waveN <= 100000 ? waveN : null;
  const cause = cleanCause(body.cause);
  await ensureScoreColumns(env);
  // At most SCORE_NAMES_PER_IP names per identity: an existing name can always
  // improve its score, but a new one is refused past the cap, so one address
  // can't fill the table (or the board) by cycling through names.
  const known = await env.DB.prepare('SELECT 1 FROM scores WHERE iphash = ? AND name = ? LIMIT 1')
    .bind(ipHash, name).first();
  if (!known) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE iphash = ?').bind(ipHash).first();
    if (n && Number(n.n) >= SCORE_NAMES_PER_IP) {
      return json({ ok: false, error: 'Too many names from this connection - reuse one of yours.' }, 429);
    }
  }
  const ts = Math.floor(Date.now() / 1000);
  // One entry per identity (hashed IP + chosen name), and only the player's best.
  // Atomic upsert: insert, or on identity conflict overwrite ONLY when the new
  // score beats the stored one. A single statement, so two concurrent submits for
  // the same identity can't both slip a row in (the previous select-then-write
  // could). NOTE: the board is deliberately casual - scores are client-submitted
  // and not verified server-side; the rate limit just stops flooding.
  try {
    await env.DB.prepare(
      'INSERT INTO scores (name, score, ts, iphash, wave, cause) VALUES (?1, ?2, ?3, ?4, ?5, ?6) '
      + 'ON CONFLICT(iphash, name) DO UPDATE SET score = excluded.score, ts = excluded.ts, '
      + 'wave = excluded.wave, cause = excluded.cause WHERE excluded.score > scores.score',
    ).bind(name, score, ts, ipHash, wave, cause).run();
  } catch (_) {
    // No unique index yet (migration not applied) - fall back to the older
    // non-atomic best-only replace so scoring still works.
    const prev = await env.DB
      .prepare('SELECT score FROM scores WHERE iphash = ? AND name = ? ORDER BY score DESC LIMIT 1')
      .bind(ipHash, name).first();
    if (!prev || score > Number(prev.score)) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM scores WHERE iphash = ? AND name = ?').bind(ipHash, name),
        env.DB.prepare('INSERT INTO scores (name, score, ts, iphash, wave, cause) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(name, score, ts, ipHash, wave, cause),
      ]);
    }
  }
  return json({ ok: true, top: await topScores(env) });
}

// GET /api/leaderboard - the current top 5 Asteroids scores.
async function handleLeaderboard(env) {
  return json({ top: await topScores(env) });
}

// The legacy host. Everything on it (except /api/*, see below) is redirected to
// the canonical host, path and query preserved.
const LEGACY_HOST = 'lab.valjdakosta.com';
const CANONICAL_HOST = 'analyser.valjdakosta.com';

// A format page lives at /formats/<ext> (full analysis) or /formats/id/<ext>
// (identification only), so promoting a format from id to full moves its URL and
// the old one - still in Google's index from an earlier sitemap - 404s. When a
// format URL misses, try the same extension on the other tier and 301 there if it
// exists. Runs only after a 404, so a normal page request pays nothing, and it
// needs no list of moved formats: every past and future promotion (or demotion)
// is covered by what is actually deployed.
const FORMAT_PAGE = /^\/formats\/(id\/)?([^/]+?)(?:\.html)?\/?$/;

async function movedFormatPage(env, url) {
  const m = url.pathname.match(FORMAT_PAGE);
  if (!m) return null;
  const moved = new URL(url);
  moved.pathname = (m[1] ? '/formats/' : '/formats/id/') + m[2];
  const probe = await env.ASSETS.fetch(new Request(moved.toString(), { method: 'HEAD' }));
  return probe.status === 200 ? Response.redirect(moved.toString(), 301) : null;
}

// Served as /sw.js on the LEGACY host instead of a redirect. A browser refuses a
// redirected service-worker script, so a PWA installed from lab.valjdakosta.com
// could never update - it kept serving its old precache forever. This worker
// replaces it on the next update check: it takes over at once, drops every cache
// the old one filled, unregisters itself and sends each open window to the same
// path on the canonical host.
const LEGACY_SW_KILL_SWITCH = `// Analyser moved to https://analyser.valjdakosta.com/ - this retires the old install.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch (_) {}
    try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch (_) {}
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
    try { await self.registration.unregister(); } catch (_) {}
    for (const c of wins) {
      try {
        const u = new URL(c.url);
        u.protocol = 'https:';
        u.hostname = 'analyser.valjdakosta.com';
        u.port = '';
        await c.navigate(u.href);
      } catch (_) {}
    }
  })());
});
`;

// A bare error page when the asset system itself throws, instead of Cloudflare's
// raw 1101 "Worker threw exception" page.
function assetFailure() {
  return new Response('Analyser is temporarily unavailable. Please try again in a moment.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '30' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Legacy-host redirect. 307 (temporary, method-preserving) rather than 301/308
    // on purpose: browsers cache a permanent redirect indefinitely, so it can't be
    // undone if the old host ever has to serve something again.
    //
    // /api/* is deliberately NOT redirected. Visitors who installed the PWA from
    // the old host still run a service worker on that origin and post their counts
    // to lab.../api/*; a cross-origin redirect would fail CORS and silently lose
    // those stats, so the API keeps answering on both hosts.
    //
    // Neither is sw.js: a redirected service-worker script is rejected by the
    // browser, which would pin an old install on its stale cache for good. It
    // gets the kill-switch worker above instead.
    if (url.hostname === LEGACY_HOST && !path.startsWith('/api/')) {
      if (path.endsWith('/sw.js')) {
        return new Response(LEGACY_SW_KILL_SWITCH, {
          headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 307);
    }

    // Everything that isn't an API call is a page/asset (or an SPA deep link) -
    // hand it straight back to the assets system, which applies the same
    // clean-URL + single-page-application fallback as a Worker-less deploy.
    if (!path.startsWith('/api/')) {
      let res;
      try {
        res = await env.ASSETS.fetch(request);
      } catch (_) {
        return assetFailure();
      }
      if (res.status === 404 && path.startsWith('/formats/')) {
        try {
          return (await movedFormatPage(env, url)) || res;
        } catch (_) {
          return res;   // the probe failed - the genuine 404 is still the right answer
        }
      }
      return res;
    }

    // Every POST the app makes sends JSON; anything else is a cross-site simple
    // request (form / text/plain) trying to inflate the counters.
    if (request.method === 'POST' && !isJsonPost(request)) {
      return json({ error: 'unsupported media type' }, 415);
    }

    try {
      if (path === '/api/visit' && request.method === 'POST') return await handleVisit(request, env, ctx);
      if (path === '/api/analysed' && request.method === 'POST') return await handleAnalysed(request, env);
      if (path === '/api/stats' && request.method === 'GET') return await handleStats(env);
      if (path === '/api/score' && request.method === 'POST') return await handleScore(request, env);
      if (path === '/api/leaderboard' && request.method === 'GET') return await handleLeaderboard(env);
    } catch (_) {
      // Never leak internals; the client treats any non-OK as "stats unavailable".
      return json({ error: 'stats unavailable' }, 500);
    }
    return json({ error: 'not found' }, 404);
  },
};
