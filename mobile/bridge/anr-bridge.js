/* Analyser Android shell - the bridge.
 *
 * The desktop's preload.cjs, for Capacitor. AnrShell.java injects it at
 * DOCUMENT START (WebViewCompat.addDocumentStartJavaScript), main frame only,
 * for the https://app origin only - so window.anrDesktop exists before any page
 * script runs, exactly as the preload guarantees on the desktop. That matters:
 * src/core/limits.ts reads it at module load, and an "Open with" intent can
 * arrive before app.ts has booted.
 *
 * stage-web.mjs wraps this file in an IIFE after inlining
 * desktop/ffmpeg-accel.mjs as `AnrAccel`, so the encoder rewrite rules are the
 * desktop's own, and nothing here leaks into the page's global scope except
 * what is assigned to window on purpose.
 *
 * WHAT IT PUBLISHES
 *
 * window.anrDesktop, with the SAME shape as desktop/preload.cjs. Every guard in
 * src/ is written against that shape, and each one is also right on a phone
 * (research/CAPACITOR-PLAN.md, decision 2), so src/ needs no mobile branch.
 * Two fields are new: `shell: 'capacitor'` and `platform: 'android'`, for a
 * future branch that really is desktop-only.
 *
 * `memoryGB` is 0 ON PURPOSE. limits.ts lets a 'high' device tier lift every
 * mobile out-of-memory wall, and a phone's real RAM would read as 'high' while
 * its WebView gets a fraction of it. With 0, limits.ts falls back to
 * navigator.deviceMemory - exactly what the website sees on the same phone.
 *
 * WHAT IT FIXES IN THE WEBVIEW (the shell's job, not src/'s)
 *
 *  - /api/* goes out through the AnrShell plugin. The desktop proxies it at
 *    the scheme handler, but Android's shouldInterceptRequest never sees a
 *    request body, so the POSTs could not be forwarded that way.
 *  - <a download> on a blob: or data: URL does nothing in a WebView. Those
 *    clicks become a native save instead, with no change to the ~45 sites.
 *  - navigator.share is missing from the Android WebView. The share sheet
 *    stands in for the text-and-link form the share nudges use.
 *  - The hardware back button, and the status-bar colour, which follows the
 *    site's theme so the native inset band never clashes with the page.
 *
 * THE TRUST LINE
 *
 * This file runs in the page, and a crafted file that finds an XSS in a
 * renderer runs there too. So nothing here is a security check: the FFmpeg
 * argument checks, the /api host lock and every name sanitiser live in the
 * native plugins, which an XSS can call directly anyway.
 */

// Replaced by AnrShell.java before injection: { version, packaged, arrayBuffers }.
const BOOT = /*ANR_BOOT*/{};

function cap() {
  const c = window.Capacitor;
  if (!c || typeof c.nativePromise !== 'function') throw new Error('the Capacitor bridge is not ready');
  return c;
}
const call = (plugin, method, options) => cap().nativePromise(plugin, method, options || {});

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// ---------------------------------------------------------------------------
// Bytes, page -> native
//
// Capacitor's own bridge is JSON, so bytes would cross it as base64: a third
// larger, with several copies alive at once - a 500 MB video would take the
// WebView down. AnrShell.java instead registers a WebMessageListener named
// `anrBytes`, which takes ArrayBuffer messages directly (androidx.webkit's
// WEB_MESSAGE_ARRAY_BUFFER). A WebView too old for that gets base64 chunks on
// the same channel, bounded to CHUNK at a time.
//
// The protocol is a begin message, the chunks, and an end message. Native
// answers EVERY message with one JSON ack, in order, so each send() waits for
// the one before it: at most one CHUNK is ever in flight. Transfers are queued
// so two can never interleave their chunks.
//
// The other direction needs none of this: native serves a finished file at
// /__anr/ff/<session>/<name> and the page simply fetches it.
// ---------------------------------------------------------------------------

const CHUNK = 4 * 1024 * 1024;
const acks = [];
let queue = Promise.resolve();

function channel() {
  const ch = window.anrBytes;
  if (!ch) throw new Error('the byte channel is missing');
  if (!ch._anrWired) {
    ch._anrWired = true;
    ch.addEventListener('message', (e) => {
      const w = acks.shift();
      if (!w) return;
      let m = {};
      try { m = JSON.parse(e.data); } catch (_) { /* treated as a failure below */ }
      if (m.ok) w.resolve(m); else w.reject(new Error(m.error || 'transfer failed'));
    });
  }
  return ch;
}

function send(msg) {
  return new Promise((resolve, reject) => {
    acks.push({ resolve, reject });
    try { channel().postMessage(msg); } catch (e) { acks.pop(); reject(e); }
  });
}

function toBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Anything ffmpeg.wasm's writeFile accepts, as bytes or a Blob. */
function asBytes(data) {
  if (data instanceof Blob || data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new TextEncoder().encode(String(data == null ? '' : data));
}

/** Stream `data` to native. `meta` names the target; native sanitises it. */
function transfer(meta, data) {
  const run = async () => {
    const size = data instanceof Blob ? data.size : data.byteLength;
    await send(JSON.stringify(Object.assign({ op: 'begin', size }, meta)));
    try {
      for (let off = 0; off < size; off += CHUNK) {
        const end = Math.min(size, off + CHUNK);
        const part = data instanceof Blob
          ? new Uint8Array(await data.slice(off, end).arrayBuffer())
          : data.subarray(off, end);
        if (BOOT.arrayBuffers) {
          // postMessage takes an ArrayBuffer, not a view: copy only when the
          // view does not already cover its whole buffer.
          const whole = part.byteOffset === 0 && part.byteLength === part.buffer.byteLength;
          await send(whole ? part.buffer : part.slice().buffer);
        } else {
          await send(JSON.stringify({ op: 'chunk', b64: toBase64(part) }));
        }
      }
      return await send(JSON.stringify({ op: 'end' }));
    } catch (e) {
      try { await send(JSON.stringify({ op: 'abort' })); } catch (_) { /* native resets on the next begin */ }
      throw e;
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

/** Hand a file to the system's "save to" picker. Resolves { ok, canceled? }. */
async function saveBlob(name, blob, mime) {
  const xfer = rid();
  await transfer({ target: 'stage', xfer }, blob);
  return call('AnrShell', 'save', {
    xfer,
    name: String(name || 'download'),
    mime: String(mime || blob.type || 'application/octet-stream'),
  });
}

// ---------------------------------------------------------------------------
// Native FFmpeg - the same bridge shape as desktop/preload.cjs, so the shim in
// src/renderers/video.ts wraps it into an ffmpeg.wasm-shaped object unchanged.
//
// The hardware rewrite and the software retry run HERE, from the desktop's own
// rules (AnrAccel). They are not a security boundary, so the page may run
// them. The checks that are - which files and devices ffmpeg may touch - run
// in AnrFfmpeg.java on every exec, whatever this code sent.
// ---------------------------------------------------------------------------

let capsPromise = null;
const ffCaps = () => (capsPromise = capsPromise || call('AnrFfmpeg', 'caps').catch(() => ({ available: false })));

const ffListeners = new Map();       // session id -> (payload) => void
let ffWired = false;
function wireFfmpegEvents() {
  if (ffWired) return;
  ffWired = true;
  cap().addListener('AnrFfmpeg', 'ffmpeg', (p) => {
    const fn = p && ffListeners.get(p.id);
    if (fn) { try { fn(p); } catch (_) {} }
  });
}
const ffEmit = (id, message) => {
  const fn = ffListeners.get(id);
  if (fn) { try { fn({ id, type: 'log', message }); } catch (_) {} }
};

const ffmpeg = {
  caps: () => ffCaps(),
  open: async () => {
    wireFfmpegEvents();
    const r = await call('AnrFfmpeg', 'open');
    return (r && r.id) || null;
  },
  write: (id, name, data) => transfer({ target: 'ff', id: String(id), name: String(name) }, asBytes(data)).then(() => true),
  read: async (id, name) => {
    const res = await fetch('/__anr/ff/' + encodeURIComponent(String(id)) + '/' + encodeURIComponent(String(name)), { cache: 'no-store' });
    if (!res.ok) throw new Error('no such file: ' + name);
    return new Uint8Array(await res.arrayBuffer());
  },
  del: (id, name) => call('AnrFfmpeg', 'del', { id: String(id), name: String(name) }).then(() => true, () => false),
  exec: async (id, args, timeout) => {
    const c = await ffCaps();
    const list = (Array.isArray(args) ? args : []).map(String);
    const t = Number(timeout) || 0;
    const hw = AnrAccel.accelerate(list, c.accel || null);
    if (hw.changed) {
      const r = await call('AnrFfmpeg', 'exec', { id, args: hw.args, timeout: t });
      if (r && (r.ok || r.refused)) return Object.assign(r, { accelerated: !!r.ok, note: hw.note });
      // A chipset refusing a resolution or a pixel format is ordinary. Retry in
      // software, so a hardware quirk never costs the user the job.
      ffEmit(id, '\n[analyser] hardware encode failed, retrying in software\n');
    }
    return call('AnrFfmpeg', 'exec', { id, args: AnrAccel.softwareFallback(list, c.encoders || null), timeout: t });
  },
  close: (id) => {
    ffListeners.delete(id);
    return call('AnrFfmpeg', 'close', { id: String(id) }).then(() => true, () => false);
  },
  listen: (id, cb) => { if (typeof cb === 'function') ffListeners.set(id, cb); else ffListeners.delete(id); },
};

// ---------------------------------------------------------------------------
// "Open with" and "Share to Analyser"
//
// MainActivity turns the intent into { kind: 'file', name, size, mime,
// lastModified, url } - the desktop's payload - where url is /__anr/open/<token>
// and streams the content:// URI. app.ts hands it to desktopFile(), which
// fetches it into a File. AnrShell retains the event until a listener exists,
// and this queue covers the gap before app.ts registers its handler.
// ---------------------------------------------------------------------------

let openHandler = null;
const pendingOpen = [];
let openWired = false;
function wireOpen() {
  if (openWired) return;
  openWired = true;
  cap().addListener('AnrShell', 'open', (p) => {
    if (openHandler) { try { openHandler(p); } catch (_) {} } else pendingOpen.push(p);
  });
}

// ---------------------------------------------------------------------------
// window.anrDesktop
// ---------------------------------------------------------------------------

const chromeVersion = (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || '';

const api = Object.freeze({
  shell: 'capacitor',
  platform: 'android',
  version: String(BOOT.version || ''),
  arch: String(BOOT.arch || ''),
  electron: '',
  chrome: chromeVersion,
  packaged: !!BOOT.packaged,
  portable: false,
  memoryGB: 0,                        // on purpose - see the header

  onOpen(cb) {
    openHandler = typeof cb === 'function' ? cb : null;
    try { wireOpen(); } catch (_) { /* Capacitor not up yet: the next onOpen wires it */ }
    if (!openHandler) return;
    while (pendingOpen.length) {
      const p = pendingOpen.shift();
      try { openHandler(p); } catch (_) {}
    }
  },

  /** A phone has no title bar to name the file in. */
  setSubject() {},

  /** Never rejects. Resolves { ok: true }, { ok: false, canceled: true } or
   *  { ok: false, error } - a failed save must not send export-data.ts to its
   *  window.open('') fallback, which a single-WebView shell cannot show. */
  saveReport(name, html) {
    return saveBlob(String(name || 'analysis') + '.html', new Blob([String(html || '')], { type: 'text/html' }), 'text/html')
      .then(
        (r) => (r && typeof r === 'object' ? r : { ok: false, error: 'the save did not answer' }),
        (e) => ({ ok: false, error: String((e && e.message) || e || 'the save failed') }),
      );
  },

  /** The footer's "Check for updates" button (core/offline-tiers.ts).
   *  AnrUpdate.java checks at once and shows the answer natively. */
  checkUpdates: () => call('AnrShell', 'checkUpdates'),

  ffmpeg: Object.freeze(ffmpeg),
});

Object.defineProperty(window, 'anrDesktop', { value: api, writable: false, configurable: false, enumerable: false });

// ---------------------------------------------------------------------------
// /api/* through the native side (see the header for why not the WebView).
// Only same-origin /api/ requests are diverted; everything else is untouched.
// AnrShell.java refuses any path outside /api/ and any other host.
// ---------------------------------------------------------------------------

const pageFetch = window.fetch;
const NULL_BODY = new Set([101, 204, 205, 304]);

async function apiFetch(url, input, init) {
  const req = input instanceof Request ? input : null;
  const method = String(init.method || (req && req.method) || 'GET').toUpperCase();
  const headers = new Headers(init.headers || (req ? req.headers : undefined));
  let body = init.body !== undefined ? init.body
    : (req && method !== 'GET' && method !== 'HEAD' ? await req.text() : null);
  if (body != null && typeof body !== 'string') body = await new Response(body).text();
  try {
    const r = await call('AnrShell', 'api', {
      method,
      path: url.pathname + url.search,
      contentType: headers.get('content-type') || '',
      accept: headers.get('accept') || '',
      body: body == null ? null : body,
    });
    const status = Math.min(599, Math.max(200, Number(r.status) || 200));
    return new Response(NULL_BODY.has(status) ? null : String(r.body || ''), {
      status,
      headers: { 'content-type': r.contentType || 'application/json' },
    });
  } catch (_) {
    // Offline. The app already treats a failed /api call as "not counted yet"
    // and queues the ping, so the desktop's clean 503 is all it needs.
    return new Response('{"error":"offline"}', { status: 503, headers: { 'content-type': 'application/json' } });
  }
}

window.fetch = function (input, init) {
  let url;
  try { url = new URL(input instanceof Request ? input.url : String(input), location.href); }
  catch (_) { return pageFetch.apply(this, arguments); }
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return pageFetch.apply(this, arguments);
  return apiFetch(url, input, init || {});
};

// ---------------------------------------------------------------------------
// Downloads: <a download> on a blob: or data: URL -> the native save picker.
//
// Two ways in. A link in the document is caught by a capture-phase click
// listener. util.ts's downloadBlob() appends its link first, but other sites
// click a DETACHED anchor, whose click event never reaches the document - so
// HTMLAnchorElement.prototype.click is wrapped for those. The blob is fetched
// at once, inside the click, because the page revokes the URL a second later.
// ---------------------------------------------------------------------------

function isSaveLink(a) {
  return !!a && typeof a.hasAttribute === 'function' && a.hasAttribute('download') && /^(blob|data):/i.test(a.href || '');
}
function saveFromLink(a) {
  const name = a.getAttribute('download') || 'download';
  pageFetch(a.href).then((r) => r.blob()).then((blob) => saveBlob(name, blob)).catch(() => {});
}
document.addEventListener('click', (e) => {
  const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
  if (!isSaveLink(a)) return;
  e.preventDefault();
  saveFromLink(a);
}, true);
const anchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (!this.isConnected && isSaveLink(this)) { saveFromLink(this); return; }
  return anchorClick.call(this);
};

// ---------------------------------------------------------------------------
// navigator.share - missing from the Android WebView. Text and links only: the
// share nudges in popups.ts test canShare({ files }) before they offer a file,
// and this answers false for that, so they fall back as they do today.
// ---------------------------------------------------------------------------

if (!navigator.share) {
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: (data) => {
      const d = data || {};
      if (d.files && d.files.length) return Promise.reject(new DOMException('Sharing files is not supported here', 'NotAllowedError'));
      return call('AnrShell', 'share', { title: String(d.title || ''), text: String(d.text || ''), url: String(d.url || '') }).then(() => undefined);
    },
  });
  Object.defineProperty(navigator, 'canShare', {
    configurable: true,
    value: (data) => !(data && data.files && data.files.length),
  });
}

// ---------------------------------------------------------------------------
// The hardware back button. MainActivity asks this first:
//   'handled' - the page went back one step
//   'exit'    - nothing left to go back to; the activity leaves
// One drill-down level first (the page's own Back bar), then page history.
// ---------------------------------------------------------------------------

Object.defineProperty(window, '__anrBack', {
  value: () => {
    const bar = document.getElementById('anrBackBar');
    if (bar && !bar.hidden) { bar.click(); return 'handled'; }
    if (location.pathname !== '/' && history.length > 1) { history.back(); return 'handled'; }
    return 'exit';
  },
});

// ---------------------------------------------------------------------------
// The status and navigation bar bands take the page's own background, so they
// follow the light/dark toggle instead of sitting there in a fixed colour.
// ---------------------------------------------------------------------------

let lastBars = '';
function pageBackground() {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
  }
  return '';
}
function reportBars() {
  const c = pageBackground();
  if (!c || c === lastBars) return;
  lastBars = c;
  call('AnrShell', 'bars', { color: c }).catch(() => { lastBars = ''; });
}
document.addEventListener('DOMContentLoaded', () => {
  reportBars();
  const mo = new MutationObserver(reportBars);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
});
window.addEventListener('anr:navigate', () => setTimeout(reportBars, 0));
