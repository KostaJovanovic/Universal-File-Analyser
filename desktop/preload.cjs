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
const { contextBridge, ipcRenderer } = require('electron');

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

/* Flag the document for the custom title bar HERE rather than in the module
   that builds it. The CSS reserves the bar's height with `html.anr-desktop body
   { padding-top }`, and this preload runs before any page script, so the page
   lays out with the room already made - core/desktop-chrome.ts adding the class
   later would shift the whole page down on every load. */
try {
  const root = document.documentElement;
  root.classList.add('anr-desktop');
  if (process.platform === 'darwin') root.classList.add('anr-desktop--mac');
} catch (_) { /* no document yet is not worth failing the preload over */ }

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

/* Window state for the custom title bar. Kept in a local so a page that mounts
   its bar after a maximise still paints the right glyph, and so an SPA swap
   (which replaces the handler) never misses the current state. */
let winState = { maximized: false, fullScreen: false, focused: true };
let winStateHandler = null;
ipcRenderer.on('anr:win-state', (_e, s) => {
  winState = s || winState;
  if (winStateHandler) { try { winStateHandler(winState); } catch (_) {} }
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
  /** Where this copy stores its data (offline cache, history, window state). */
  dataDir: String(info.dataDir || ''),
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

  /** Window controls for the app-drawn title bar (src/core/desktop-chrome.ts).
   *  The window is frameless off macOS, so these are the only way to minimise,
   *  maximise or close it, and `menu` is the only way to reach the application
   *  menu. Every call is checked in main against our own window. */
  win: {
    minimize: () => ipcRenderer.invoke('anr:win', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('anr:win', 'maximize'),
    close: () => ipcRenderer.invoke('anr:win', 'close'),
    /** Last state pushed by main - synchronous, so the bar paints correctly on
     *  its very first frame instead of flickering through a round trip. */
    state: () => ({ ...winState }),
    /** Pop the application menu at a point in page coordinates. */
    menu: (x, y) => ipcRenderer.invoke('anr:win-menu', { x: Number(x) || 0, y: Number(y) || 0 }),
    /** Register the state-change sink. One handler; a second replaces the
     *  first, which is what an SPA swap wants. */
    onStateChange(cb) { winStateHandler = typeof cb === 'function' ? cb : null; },
  },

  /** Save the exported analysis report through a native save dialog.
   *  Resolves { ok, canceled?, path?, error? }. core/export-data.ts falls back
   *  to the browser download path when this rejects. */
  saveReport(name, html) {
    return ipcRenderer.invoke('anr:save-report', { name: String(name || ''), html: String(html || '') });
  },

  /** Native FFmpeg, hardware-accelerated where the machine allows it.
   *  src/renderers/video.ts wraps these into an object with the same shape as an
   *  ffmpeg.wasm instance, so the ~40 existing call sites need no changes.
   *  `caps()` reports what the probe found, and video.ts falls back to the WASM
   *  build when no binary is installed. */
  ffmpeg: {
    caps: () => ipcRenderer.invoke('anr:ffmpeg-caps'),
    open: () => ipcRenderer.invoke('anr:ffmpeg-open'),
    write: (id, name, data) => ipcRenderer.invoke('anr:ffmpeg-write', { id, name, data }),
    read: (id, name) => ipcRenderer.invoke('anr:ffmpeg-read', { id, name }),
    del: (id, name) => ipcRenderer.invoke('anr:ffmpeg-delete', { id, name }),
    exec: (id, args, timeout) => ipcRenderer.invoke('anr:ffmpeg-exec', { id, args, timeout }),
    close: (id) => { ffListeners.delete(id); return ipcRenderer.invoke('anr:ffmpeg-close', { id }); },
    /** Register the log/progress sink for one session. */
    listen: (id, cb) => { if (typeof cb === 'function') ffListeners.set(id, cb); else ffListeners.delete(id); },
  },
});
