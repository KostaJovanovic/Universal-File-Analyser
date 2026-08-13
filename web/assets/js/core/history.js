/* Analyser - anonymous usage counters + the on-device "Recently analysed"
   history. recordAnalysed() is the only network call this otherwise fully-local
   tool makes (a lowercase extension string + an increment to the stats Worker;
   details on /privacy). The history is a localStorage snapshot of file metadata
   only - never the bytes. Extracted from app.js as a pure move; the exports are
   called from boot() and handleFile(). */
import { el, fmtBytes, row, API_ORIGIN } from './util.js';
// ---------- anonymous usage counters ----------
// The only network calls this otherwise fully-local tool ever makes. They send
// NOTHING about your file's contents or name - just the lowercase extension
// string ("jpg") and an increment - to the stats Worker (worker/index.js). Every
// call is best-effort and swallowed, so a failure never touches analysis.
// Details on /privacy.
//
// Offline-durable: if a ping can't be delivered (offline, blocked, throttled, or
// a local `server.bat` with no real API) the event is queued in localStorage and
// re-sent the next time we're online - so a file analysed on a plane still gets
// counted once connectivity returns. The queue holds only { ext, supported } -
// the same two fields the live ping sends, never bytes or filenames.
// Always same-origin (see API_ORIGIN in util.js). This is the only place a
// file's extension leaves the device.
const ANALYSED_EP = API_ORIGIN + '/api/analysed';
const ANALYTICS_QUEUE_KEY = 'anr-analytics-queue';
const ANALYTICS_QUEUE_MAX = 500; // ~15 KB cap; oldest dropped past this
function readAnalyticsQueue() {
    try {
        const a = JSON.parse(localStorage.getItem(ANALYTICS_QUEUE_KEY) || '[]');
        return Array.isArray(a) ? a : [];
    }
    catch (_) {
        return [];
    }
}
function writeAnalyticsQueue(list) {
    try {
        // Keep the most recent items if we somehow overflow the cap.
        localStorage.setItem(ANALYTICS_QUEUE_KEY, JSON.stringify(list.slice(-ANALYTICS_QUEUE_MAX)));
    }
    catch (_) { /* storage full / disabled - analytics is best-effort */ }
}
function enqueueAnalysed(ext, supported) {
    const q = readAnalyticsQueue();
    q.push({ ext: ext || '', supported: !!supported });
    writeAnalyticsQueue(q);
}
// POST one event. Resolves true only if the server actually recorded it (2xx and
// not rate-limited); false means "try again later" (offline, blocked, throttled).
function postAnalysed(ext, supported) {
    return fetch(ANALYSED_EP, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ext: ext || '', supported: !!supported }),
        keepalive: true,
    }).then((resp) => {
        if (!resp || !resp.ok)
            return false;
        return resp.json().then((d) => !(d && d.throttled)).catch(() => true);
    }).catch(() => false);
}
// Drain the backlog oldest-first. Stops at the first item the server won't accept
// (offline / throttled) and leaves the rest queued for the next attempt, so we
// never hammer a rate-limited or unreachable endpoint. Re-reads the queue each
// pass so events enqueued mid-flush aren't lost.
let _flushingAnalytics = false;
export function flushAnalyticsQueue() {
    if (_flushingAnalytics)
        return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
        return;
    if (!readAnalyticsQueue().length)
        return;
    _flushingAnalytics = true;
    (async () => {
        try {
            for (;;) {
                const cur = readAnalyticsQueue();
                if (!cur.length)
                    break;
                const ok = await postAnalysed(cur[0].ext, cur[0].supported);
                if (!ok)
                    break; // retry the rest next time
                const after = readAnalyticsQueue();
                after.shift();
                writeAnalyticsQueue(after);
            }
        }
        finally {
            _flushingAnalytics = false;
        }
    })();
}
export function recordAnalysed(ext, supported) {
    try {
        // Offline: skip the doomed request and bank it straight away.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            enqueueAnalysed(ext, supported);
            return;
        }
        postAnalysed(ext, supported).then((ok) => {
            if (ok)
                flushAnalyticsQueue(); // delivered - opportunistically drain backlog
            else
                enqueueAnalysed(ext, supported);
        });
    }
    catch (_) {
        enqueueAnalysed(ext, supported);
    }
}
// Re-send anything banked while offline: as soon as connectivity returns, and
// once shortly after load (deferred so it never competes with first paint).
// Module-level so it binds exactly once - ES modules are singletons across SPA
// navigations, so this doesn't need the boot() _once guard.
if (typeof window !== 'undefined') {
    window.addEventListener('online', flushAnalyticsQueue);
    setTimeout(() => { try {
        flushAnalyticsQueue();
    }
    catch (_) { } }, 0);
}
// ---------- analysis history (on-device, metadata only) ----------
// A small "Recently analysed" list persisted in localStorage: name/size/type/
// time only - never the file bytes, so it can't re-open files and nothing leaves
// the device. Capped to the last 20 entries and pruned after a week.
const HISTORY_KEY = 'anr-history';
const HISTORY_MAX = 20;
const HISTORY_TTL = 7 * 24 * 60 * 60 * 1000;
function readHistory() {
    let arr;
    try {
        arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    }
    catch (_) {
        return [];
    }
    if (!Array.isArray(arr))
        return [];
    const cutoff = Date.now() - HISTORY_TTL;
    return arr.filter((e) => e && typeof e.when === 'number' && e.when >= cutoff);
}
export function recordHistory(entry) {
    try {
        const list = readHistory().filter((e) => !(e.name === entry.name && e.size === entry.size));
        list.unshift(entry);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    }
    catch (_) { /* storage full / disabled - history is best-effort */ }
}
// Folders bypass handleFile (they render via renderFolder), so record them here.
// `files` is the walkItems() array of { path, file }; the folder name is the
// first path segment and the size is the sum of every file inside.
export function recordFolderHistory(files) {
    try {
        const list = Array.isArray(files) ? files : [];
        if (!list.length)
            return;
        const name = (list[0].path || '').split('/')[0] || 'Folder';
        let size = 0;
        for (const f of list)
            size += (f.file && f.file.size) || 0;
        recordHistory({ name, size, ext: '', kind: 'folder', count: list.length, when: Date.now() });
        renderHistoryPanel();
    }
    catch (_) { /* best-effort */ }
}
function relTime(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60)
        return 'just now';
    const m = s / 60;
    if (m < 60)
        return Math.floor(m) + ' min ago';
    const h = m / 60;
    if (h < 24)
        return Math.floor(h) + ' h ago';
    const d = h / 24;
    if (d < 7)
        return Math.floor(d) === 1 ? 'yesterday' : Math.floor(d) + ' days ago';
    return new Date(ms).toLocaleDateString();
}
// Repaint the "Recently analysed" panel (no-op off the main page). Each entry is a
// <details> showing the stored metadata snapshot when opened.
export function renderHistoryPanel() {
    const section = document.getElementById('recentHistory');
    const listEl = document.getElementById('recentList');
    if (!section || !listEl)
        return;
    const list = readHistory();
    if (!list.length) {
        section.hidden = true;
        listEl.innerHTML = '';
        return;
    }
    section.hidden = false;
    listEl.innerHTML = '';
    for (const e of list) {
        const det = el('details', { class: 'recent-item' });
        const typeLabel = e.kind === 'folder'
            ? 'Folder' + (e.count != null ? ' · ' + e.count.toLocaleString() + ' files' : '')
            : (e.ext ? '.' + e.ext : (e.kind || 'file'));
        const sum = el('summary', { class: 'recent-summary' }, [
            el('span', { class: 'recent-summary-main' }, [
                el('span', { class: 'recent-name' }, e.name || '(unnamed)'),
                el('span', { class: 'recent-meta' }, typeLabel + ' · ' + fmtBytes(e.size || 0)),
            ]),
            el('span', { class: 'recent-when' }, relTime(e.when)),
        ]);
        det.appendChild(sum);
        const body = el('table', { class: 'recent-detail' });
        if (e.kind === 'folder') {
            body.appendChild(row('Type', 'Folder'));
            if (e.count != null)
                body.appendChild(row('Files', e.count.toLocaleString()));
        }
        else {
            body.appendChild(row('Type', (e.ext ? '.' + e.ext + '  ' : '') + (e.kind || 'unknown')));
        }
        body.appendChild(row('Size', fmtBytes(e.size || 0) + '   (' + (e.size || 0).toLocaleString() + ' bytes)'));
        body.appendChild(row('Analysed', new Date(e.when).toLocaleString()));
        det.appendChild(body);
        listEl.appendChild(el('li', {}, det));
    }
}
// Count one visit and return the live totals for the homepage badge. Cached in a
// module variable so it pings the network at most once per page load - SPA
// navigations reuse the cached totals (the server also dedupes to one counted
// visit per IP / 3 days, so a stray repeat ping is harmless either way).
let _visitTotals = null;
export async function recordVisit() {
    if (_visitTotals)
        return _visitTotals;
    try {
        const resp = await fetch(API_ORIGIN + '/api/visit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });
        const data = await resp.json();
        if (data && typeof data.visitors === 'number')
            _visitTotals = data;
        return _visitTotals;
    }
    catch (_) {
        return null;
    }
}
// Wipe the on-device history (the "Clear" button on the Recently analysed panel).
export function clearHistory() {
    try {
        localStorage.removeItem(HISTORY_KEY);
    }
    catch (_) { }
}
//# sourceMappingURL=history.js.map