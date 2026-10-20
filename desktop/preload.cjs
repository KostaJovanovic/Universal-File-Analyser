/* Analyser desktop - preload.
 *
 * The renderer runs with contextIsolation, sandbox and no node integration, so
 * this is the ONLY bridge between the page and the app shell. It exposes one
 * frozen object, `window.anrDesktop`, and nothing else. Everything the page can
 * reach through it is a message to the main process, never a Node handle: a
 * crafted file that finds an XSS in a renderer gets the surface it has on the
 * website, not the filesystem.
 *
 * CommonJS (.cjs) on purpose - preload scripts are not ES modules.
 *
 * Note on the static facts (version, platform, memoryGB): a SANDBOXED preload
 * cannot `require('node:os')`, so main passes them in through
 * webPreferences.additionalArguments as a single JSON blob. Reading them from
 * process.argv here means window.anrDesktop exists before any page script runs,
 * which matters because src/core/limits.ts reads memoryGB at module load.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

function bootInfo() {
  const PREFIX = '--anr-desktop=';
  for (const arg of process.argv) {
    if (arg.startsWith(PREFIX)) {
      // Percent-encoded in main so no bare quote reaches the command line.
      try { return JSON.parse(decodeURIComponent(arg.slice(PREFIX.length))); } catch (_) { /* fall through */ }
    }
  }
  return {};
}

const info = bootInfo();

/* This used to flag <html> with .anr-desktop, because the page drew the title
   bar itself and the CSS had to reserve room for it. The bar is its own web
   contents now (desktop/chrome/) and the app view starts below it, so the page
   has an ordinary full viewport again and there is nothing to reserve. Nothing
   in the site branches on the class any more - do not bring it back to hang new
   desktop styling on. */

/** Queue anything that arrives before the page has registered its handler.
 *  A file passed on the command line is sent as soon as the window loads, which
 *  can be before app.js has booted. */
let openHandler = null;
const pending = [];
ipcRenderer.on('anr:open', (_e, payload) => {
  if (openHandler) { try { openHandler(payload); } catch (_) {} }
  else pending.push(payload);
});

/* Native FFmpeg event fan-out. One IPC listener feeds every open session, keyed
   by the session id, so two concurrent jobs (the /compare page can start one per
   video) never see each other's log lines or progress. */
const ffListeners = new Map();          // session id -> (payload) => void
ipcRenderer.on('anr:ffmpeg-event', (_e, payload) => {
  const fn = payload && ffListeners.get(payload.id);
  if (fn) { try { fn(payload); } catch (_) {} }
});

/* Progress of native hashes (anr:hash), keyed by a per-call id. */
const hashListeners = new Map();        // call id -> (frac) => void
let hashSeq = 0;
ipcRenderer.on('anr:hash-progress', (_e, payload) => {
  const fn = payload && hashListeners.get(payload.id);
  if (fn) { try { fn(payload.frac); } catch (_) {} }
});

/* A different ffmpeg binary was put in charge (desktop/ffmpeg-setup.mjs). */
let ffChange = null;
ipcRenderer.on('anr:ffmpeg-changed', () => {
  if (ffChange) { try { ffChange(); } catch (_) {} }
});

contextBridge.exposeInMainWorld('anrDesktop', {
  version: String(info.version || ''),
  platform: String(info.platform || ''),
  arch: String(info.arch || ''),
  electron: String(info.electron || ''),
  chrome: String(info.chrome || ''),
  packaged: !!info.packaged,
  /** True when this is a portable copy: every stored byte lives beside the
   *  executable, and the host machine keeps nothing. */
  portable: !!info.portable,
  /* No dataDir: the full profile path names the Windows user, and nothing in
     the page needs it. Help > About (main.mjs) shows the folder and opens it. */
  /** Total physical RAM in GB, from os.totalmem() in main. Chromium clamps
   *  navigator.deviceMemory at 8 for fingerprinting reasons; this is the real
   *  number, and core/limits.ts uses it for the device tier. */
  memoryGB: Number(info.memoryGB) || 0,

  /** Register the "the shell wants this path opened" handler. Called once by
   *  core/app.ts boot(). Drains anything that arrived first. */
  onOpen(cb) {
    openHandler = typeof cb === 'function' ? cb : null;
    if (!openHandler) return;
    while (pending.length) {
      const p = pending.shift();
      try { openHandler(p); } catch (_) {}
    }
  },

  /* No window controls here on purpose. Minimise, maximise, close and the
     application menu belong to the title bar, which is a separate web contents
     with its own bridge (desktop/chrome/preload.cjs). Main checks the sender of
     each of those messages, so the site could not move the window even if a
     crafted file found an XSS in a renderer. */

  /** Name what the window is showing - the file just analysed, or '' back on a
   *  page. It goes to the title bar and to the window title, so the taskbar
   *  entry says the same thing. Text only: nothing here can act on the window.
   *  Called from core/app.ts behind the window.anrDesktop guard. */
  setSubject(text) {
    ipcRenderer.send('anr:subject', String(text || '').slice(0, 200));
  },

  /** Save the exported analysis report through a native save dialog.
   *  Resolves { ok, canceled?, path?, error? }. core/export-data.ts falls back
   *  to the browser download path when this rejects. */
  saveReport(name, html) {
    return ipcRenderer.invoke('anr:save-report', { name: String(name || ''), html: String(html || '') });
  },

  /** Check for a new version now - the footer's "Check for updates" button
   *  (core/offline-tiers.ts). The page only starts the check: updater.mjs in
   *  main shows every answer on the title bar's Update button. */
  checkUpdates() {
    return ipcRenderer.invoke('anr:check-updates');
  },

  /** A token naming a file the user dropped or picked, for the native work
   *  below; null for a File the page made itself, which has no path. The path
   *  stays here and in main - the page only ever holds the token. */
  fileToken(file) {
    let path = '';
    try { path = webUtils.getPathForFile(file); } catch (_) { path = ''; }
    if (!path) return Promise.resolve(null);
    return ipcRenderer.invoke('anr:file-token', { path, size: file.size, lastModified: file.lastModified });
  },

  /** Hash an opened file from disk in main (lib/hash-client.ts). Resolves
   *  { algo: hex }, or null when main cannot, and the page hashes it itself. */
  hash(token, algos, onProgress) {
    const id = ++hashSeq;
    if (typeof onProgress === 'function') hashListeners.set(id, onProgress);
    return ipcRenderer.invoke('anr:hash', { id, token: String(token || ''), algos: Array.isArray(algos) ? algos.map(String) : [] })
      .finally(() => { hashListeners.delete(id); });
  },

  /** Native FFmpeg, hardware-accelerated where the machine allows it.
   *  src/renderers/video.ts wraps these into an object with the same shape as an
   *  ffmpeg.wasm instance, so the ~40 existing call sites need no changes.
   *  `caps()` reports what the probe found, and video.ts falls back to the WASM
   *  build when no binary is installed. */
  ffmpeg: {
    caps: (opts) => ipcRenderer.invoke('anr:ffmpeg-caps', { quiet: !!(opts && opts.quiet) }),
    open: () => ipcRenderer.invoke('anr:ffmpeg-open'),
    write: (id, name, data, append) => ipcRenderer.invoke('anr:ffmpeg-write', { id, name, data, append }),
    read: (id, name) => ipcRenderer.invoke('anr:ffmpeg-read', { id, name }),
    del: (id, name) => ipcRenderer.invoke('anr:ffmpeg-delete', { id, name }),
    exec: (id, args, timeout) => ipcRenderer.invoke('anr:ffmpeg-exec', { id, args, timeout }),
    close: (id) => { ffListeners.delete(id); return ipcRenderer.invoke('anr:ffmpeg-close', { id }); },
    /** Let `name` stand for the opened file `token` names, read in place. */
    link: (id, name, token) => ipcRenderer.invoke('anr:ffmpeg-link', { id, name: String(name), token: String(token || '') }),
    /** Register the log/progress sink for one session. */
    listen: (id, cb) => { if (typeof cb === 'function') ffListeners.set(id, cb); else ffListeners.delete(id); },
    /** Register the "a binary was just downloaded or chosen" sink. video.ts
     *  uses it to let the native binary take over from a loaded WASM instance. */
    onChange: (cb) => { ffChange = typeof cb === 'function' ? cb : null; },
  },
});
