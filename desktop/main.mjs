/* Analyser desktop - main process.
 *
 * Wraps the same `web/` tree Cloudflare serves, with no fork of the app code.
 * Nothing in the analysis pipeline changes: the page runs on a real origin
 * (`analyser://app`, or `analyser://localhost` in dev), so ES modules, module
 * workers, import.meta.url, history.pushState, the Cache API and the service
 * worker all behave exactly as they do on the website.
 *
 * Routing is `router.mjs`, a one-to-one port of serve.py. /api/* is proxied to
 * the live site from here, where CORS does not apply.
 *
 * See README.md in this folder for how to run and build.
 */

import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { looksLikeWebRoot, mimeFor, route } from './router.mjs';
import { buildMenu } from './menu.mjs';
import * as ffnative from './ffmpeg-native.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/* The canonical host. Every absolute URL in the repo points here, and /api/*
   is forwarded to it. */
const SITE = 'https://analyser.valjdakosta.com';

/* macOS keeps its native frame so the traffic lights survive; every other
   platform is frameless and draws the whole title bar itself. */
const isMac = process.platform === 'darwin';

/* Dev serves from ../web, the packaged build from resources/web (the assets go
   in as extraResources rather than into the asar - see electron-builder.yml). */
const WEB_DIR = app.isPackaged
  ? resolve(process.resourcesPath, 'web')
  : resolve(HERE, '..', 'web');

/* Host, not cosmetics: sw.js treats hostname 'localhost' as dev and becomes a
   pass-through, and app.ts / asteroids.ts show their dev-only reset buttons on
   that host. 'app' when packaged gives the production behaviour. Zero app-code
   change for either. */
const HOST = app.isPackaged ? 'app' : 'localhost';
const ORIGIN = 'analyser://' + HOST;

/* Cap the "open a folder" walk at the same number the in-page folder walk uses
   (FOLDER_ENTRY_CAP in src/renderers/folder.ts). Keep the two in step. */
const FOLDER_ENTRY_CAP = 100000;

// ---------------------------------------------------------------------------
// Portable mode
//
// A portable build must leave the host machine alone. By default Electron puts
// userData in %APPDATA%, which for this app means the offline cache, the
// "Recently analysed" history, the theme choice and the window position all get
// written to somebody else's PC and left there - the opposite of what a tool
// whose whole promise is "nothing leaves your machine" should do from a USB
// stick.
//
// So when we are running portably, userData moves to `Analyser-data` beside the
// executable and everything travels with it. Two ways to be portable:
//
//   1. electron-builder's `portable` target sets PORTABLE_EXECUTABLE_DIR to the
//      directory the .exe was launched from. (The app itself is unpacked to a
//      temp folder on each run, so process.resourcesPath is NOT that place -
//      this variable is the only way to find the real one.)
//   2. A copied win-unpacked/ folder becomes portable when a marker file named
//      `portable.txt` sits next to the executable. That covers "unzip it onto
//      the stick" without needing the self-extracting build at all.
//
// This must run before the single-instance lock and before anything reads a
// path, which is why it sits up here rather than in whenReady. It also means a
// portable copy and an installed copy get separate locks, so they can run at the
// same time instead of one silently focusing the other.
// ---------------------------------------------------------------------------
function portableRoot() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) {
    try {
      const dir = dirname(app.getPath('exe'));
      if (existsSync(join(dir, 'portable.txt'))) return dir;
    } catch (_) { /* fall through to installed mode */ }
  }
  return null;
}

const PORTABLE_DIR = portableRoot();
/** Where portable data lives, or null when installed normally. */
let PORTABLE_DATA = null;
if (PORTABLE_DIR) {
  try {
    PORTABLE_DATA = join(PORTABLE_DIR, 'Analyser-data');
    mkdirSync(PORTABLE_DATA, { recursive: true });
    app.setPath('userData', PORTABLE_DATA);
    // Chromium's own cache/GPU-shader dirs sit under sessionData, which defaults
    // to userData. Pin it explicitly so a future Electron cannot split them.
    try { app.setPath('sessionData', PORTABLE_DATA); } catch (_) { /* older Electron */ }
  } catch (_) {
    // A read-only stick, or a folder we cannot write. Fall back to the normal
    // location rather than failing to start - the app still works, it just is
    // not portable, and the About line below says so.
    PORTABLE_DATA = null;
  }
}

// ---------------------------------------------------------------------------
// Scheme privileges. Must be registered before app is ready.
//
//   standard            - a real origin, so localStorage / IndexedDB / workers work
//   secure              - a secure context (WASM, crypto.subtle, service worker)
//   supportFetchAPI     - fetch() and the Cache API
//   corsEnabled         - normal CORS rules rather than blanket denial
//   stream              - streamed responses (large WASM and media)
//   allowServiceWorkers - sw.js registers, so the offline tiers keep working
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'analyser',
    privileges: {
      standard: true, secure: true, supportFetchAPI: true,
      corsEnabled: true, stream: true, allowServiceWorkers: true,
    },
  },
  {
    // Files the user opened by path. A separate scheme so nothing under the
    // app origin can be confused with it, and so it can never be navigated to.
    // corsEnabled is load-bearing: the page fetches these from analyser://,
    // which is a cross-origin request, and Chromium refuses a CORS request to
    // any scheme not on its CORS-enabled list - no response header can fix that.
    scheme: 'anr-open',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// ---------------------------------------------------------------------------
// Approved-path table for anr-open://<token>
//
// A token is the ONLY way the renderer can name a file on disk. It is minted
// here, for a path the user chose in a dialog or passed on the command line,
// and never derived from anything the page says.
// ---------------------------------------------------------------------------
const approved = new Map();

// Tokens minted by the most recent folder open. A folder walk approves up to
// FOLDER_ENTRY_CAP files at once, and the page only ever holds one folder
// listing, so the previous folder's tokens are dead the moment a new one is
// sent - drop them then, or the table grows by a hundred thousand entries per
// open for the life of the process. Single-file tokens are few and stay.
let folderTokens = [];

function approve(path, tokens) {
  let size = 0, mtime = Date.now();
  try { const st = statSync(path); size = st.size; mtime = st.mtimeMs; } catch (_) { return null; }
  const token = randomUUID();
  const name = path.split(/[\\/]/).pop() || 'file';
  approved.set(token, { path, name, size, mtime });
  if (tokens) tokens.push(token);
  return { url: 'anr-open://' + token + '/', name, size, lastModified: Math.round(mtime), mime: mimeFor(name) };
}

function releaseFolderTokens() {
  for (const t of folderTokens) approved.delete(t);
  folderTokens = [];
}

// ---------------------------------------------------------------------------
// Window state (size + position), persisted in userData.
// ---------------------------------------------------------------------------
const STATE_FILE = () => join(app.getPath('userData'), 'window-state.json');

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE(), 'utf8')); } catch (_) { return {}; }
}

function writeState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.isMaximized() || win.isMinimized() ? win.getNormalBounds() : win.getBounds();
    mkdirSync(dirname(STATE_FILE()), { recursive: true });
    writeFileSync(STATE_FILE(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch (_) { /* a lost window position is not worth an error */ }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let mainWindow = null;

function createWindow() {
  const st = readState();
  const bootInfo = {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    packaged: app.isPackaged,
    // Chromium clamps navigator.deviceMemory at 8. This is the real figure,
    // and src/core/limits.ts uses it for the device tier.
    memoryGB: Math.round(totalmem() / (1024 * 1024 * 1024)),
    // True when everything this app stores sits beside the executable rather
    // than in the host's %APPDATA%. Worth surfacing: the point of the portable
    // build is that it leaves the machine as it found it.
    portable: !!PORTABLE_DATA,
    dataDir: app.getPath('userData'),
  };

  const win = new BrowserWindow({
    width: st.width || 1280,
    height: st.height || 860,
    x: Number.isInteger(st.x) ? st.x : undefined,
    y: Number.isInteger(st.y) ? st.y : undefined,
    // The site's narrow layout stops making sense below this.
    minWidth: 360,
    minHeight: 480,
    backgroundColor: '#0a0a0a',
    show: false,
    title: 'Analyser',
    // The window draws its own title bar (src/core/desktop-chrome.ts), so the
    // OS one is removed entirely. On macOS `frame: false` would take the
    // traffic lights with it, so there the frame stays and only the bar is
    // hidden - our own buttons hide themselves on darwin and the CSS leaves a
    // gap for the native ones. `autoHideMenuBar` matters on Windows/Linux: the
    // native menu bar is unreachable without a frame, so the MENU button in
    // the custom bar pops the same menu up instead (see anr:win-menu).
    frame: isMac,
    titleBarStyle: isMac ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 11 } : undefined,
    autoHideMenuBar: true,
    // Dev only: build/ is not inside the asar, and a packaged window takes its
    // icon from the executable that electron-builder stamped.
    icon: app.isPackaged ? undefined : join(HERE, 'build', 'icon.png'),
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      // The sandboxed preload cannot require('node:os'), so the static facts
      // travel as one argument it reads out of process.argv. Percent-encoded,
      // not raw JSON: additionalArguments go through the renderer's command
      // line, and bare double quotes do not survive Windows argument quoting.
      additionalArguments: ['--anr-desktop=' + encodeURIComponent(JSON.stringify(bootInfo))],
    },
  });

  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  let saveTimer = null;
  const queueSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeState(win), 400);
  };
  win.on('resize', queueSave);
  win.on('move', queueSave);
  win.on('close', () => writeState(win));
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  /* The custom title bar draws its own maximise/restore glyph and inset, so it
     has to hear about every state change - including the ones it did not cause
     (Win+Up, Snap, a double-click on the drag region, exiting full screen). */
  const pushState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('anr:win-state', {
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
      focused: win.isFocused(),
    });
  };
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur']) {
    win.on(ev, pushState);
  }

  win.loadURL(ORIGIN + '/');
  return win;
}

/* Everything that leaves the app leaves it in the system browser, and nothing
   else opens at all. The one allowed child window is about:blank from our own
   origin: src/core/export-data.ts opens one and writes the print report into
   it. In the desktop the report normally goes through a save dialog instead
   (see anr:save-report), so this is the fallback path. */
function hardenWebContents(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) || /^mailto:/i.test(url)) {
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    }
    if (url === 'about:blank' || url === '') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900, height: 900, backgroundColor: '#ffffff',
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      };
    }
    return { action: 'deny' };
  });

  wc.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN + '/') || url === ORIGIN) return;   // in-app link
    e.preventDefault();
    if (/^https?:/i.test(url) || /^mailto:/i.test(url)) shell.openExternal(url).catch(() => {});
  });

  wc.on('will-attach-webview', (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// Opening files by path
// ---------------------------------------------------------------------------

/** Send one approved file to the page. The renderer fetches the anr-open URL,
 *  wraps the blob in a File and hands it to window._anrHandleFile. */
function sendFile(path) {
  const info = approve(path);
  if (!info || !mainWindow) return;
  mainWindow.webContents.send('anr:open', { kind: 'file', ...info });
}

/** Breadth-first walk, mirroring walkTree() in src/renderers/folder.ts: the
 *  same entry cap, the same `<root>/<sub>/<name>` path shape, and the same
 *  "truncated" flag so the page can say the listing is partial. */
function walkFolder(root) {
  const rootName = root.split(/[\\/]/).filter(Boolean).pop() || 'folder';
  const entries = [];
  let level = [{ dir: root, rel: rootName + '/' }];
  let truncated = false;
  releaseFolderTokens();
  const tokens = folderTokens;

  while (level.length && entries.length < FOLDER_ENTRY_CAP) {
    const next = [];
    for (const d of level) {
      let children = [];
      try { children = readdirSync(d.dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const c of children) {
        if (c.isSymbolicLink()) continue;              // never follow links out of the tree
        const full = join(d.dir, c.name);
        if (c.isDirectory()) { next.push({ dir: full, rel: d.rel + c.name + '/' }); continue; }
        if (!c.isFile()) continue;
        if (entries.length >= FOLDER_ENTRY_CAP) { truncated = true; break; }
        const info = approve(full, tokens);
        if (info) entries.push({ path: d.rel + c.name, ...info });
      }
      if (truncated) break;
    }
    if (truncated) break;
    level = next;
  }
  if (level.length && entries.length >= FOLDER_ENTRY_CAP) truncated = true;
  return { kind: 'folder', name: rootName, truncated, entries };
}

function sendFolder(path) {
  if (!mainWindow) return;
  mainWindow.webContents.send('anr:open', walkFolder(path));
}

/** Route a path from the command line, a second instance or macOS open-file.
 *  `cwd` is the directory a relative path is relative to: this process's own
 *  for the first launch, the SECOND instance's for a path handed over by one -
 *  its shell was somewhere else, and resolving against ours would stat the
 *  wrong file or none. */
function openPath(path, cwd) {
  if (!path || !mainWindow) return;
  path = resolve(cwd || process.cwd(), path);
  let st;
  try { st = statSync(path); } catch (_) { return; }
  if (st.isDirectory()) sendFolder(path);
  else if (st.isFile()) sendFile(path);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/** Paths passed on the command line. Electron's own switches all start with a
 *  dash, and argv[0] is the executable; in dev, argv[1] is the app directory. */
function pathsFromArgv(argv) {
  const skip = app.isPackaged ? 1 : 2;
  return argv.slice(skip).filter((a) => a && !a.startsWith('-'));
}

// Menu actions -> here.
const actions = {
  openFile() {
    const picked = dialog.showOpenDialogSync(mainWindow, {
      title: 'Open a file to analyse',
      properties: ['openFile'],
    });
    if (picked && picked[0]) sendFile(picked[0]);
  },
  openFolder() {
    const picked = dialog.showOpenDialogSync(mainWindow, {
      title: 'Open a folder to analyse',
      properties: ['openDirectory'],
    });
    if (picked && picked[0]) sendFolder(picked[0]);
  },
  go(path) {
    if (mainWindow) mainWindow.loadURL(ORIGIN + path);
  },
  external(url) {
    shell.openExternal(url).catch(() => {});
  },
  /* "Where my data is stored". The whole promise of the portable build is that
     it leaves the host machine as it found it, so make that checkable rather
     than something the user has to take on trust. */
  showData() {
    const dir = app.getPath('userData');
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Analyser',
      message: PORTABLE_DATA ? 'Portable copy' : 'Installed copy',
      detail: (PORTABLE_DATA
        ? 'Everything this copy stores sits beside the program, so the computer you are using keeps nothing. That covers the offline downloads, the recently-analysed list, the theme and the window position.\n\nFiles you analyse are never stored at all.\n\n'
        : 'This copy keeps its settings and offline downloads in your user profile.\n\nFiles you analyse are never stored.\n\n') + dir,
      buttons: ['Close', 'Open the folder'],
      defaultId: 0,
      cancelId: 0,
    }).then((r) => { if (r.response === 1) shell.openPath(dir); }).catch(() => {});
  },
};

// ---------------------------------------------------------------------------
// Window controls for the custom title bar (src/core/desktop-chrome.ts).
//
// The window is frameless everywhere except macOS, so minimise / maximise /
// close have no native affordance left and arrive here instead. `menu` pops the
// application menu under the bar's MENU button: with no frame there is no menu
// bar to drop it from, and Menu.getApplicationMenu() still holds the one
// buildMenu() made, so the accelerators and the entries stay in one place.
// ---------------------------------------------------------------------------
ipcMain.handle('anr:win', (e, action) => {
  if (!mainWindow || e.sender !== mainWindow.webContents) return null;
  const w = mainWindow;
  if (action === 'minimize') w.minimize();
  else if (action === 'maximize') { w.isMaximized() ? w.unmaximize() : w.maximize(); }
  else if (action === 'close') w.close();
  return { maximized: w.isMaximized(), fullScreen: w.isFullScreen(), focused: w.isFocused() };
});

ipcMain.handle('anr:win-menu', (e, { x, y }) => {
  if (!mainWindow || e.sender !== mainWindow.webContents) return false;
  const menu = Menu.getApplicationMenu();
  if (!menu) return false;
  // CSS pixels from the page; popup() wants window coordinates, and the two
  // differ the moment someone zooms the page (Ctrl+= is in the View menu).
  const z = mainWindow.webContents.getZoomFactor() || 1;
  menu.popup({ window: mainWindow, x: Math.round(x * z), y: Math.round(y * z) });
  return true;
});

// ---------------------------------------------------------------------------
// Save the exported report through a native dialog (IPC from preload).
// ---------------------------------------------------------------------------
ipcMain.handle('anr:save-report', async (e, { name, html }) => {
  // Only the app's own window may ask.
  if (!mainWindow || e.sender !== mainWindow.webContents) return { ok: false, error: 'denied' };
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save the analysis report',
    defaultPath: (name || 'analysis') + '.html',
    filters: [{ name: 'HTML report', extensions: ['html'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    writeFileSync(res.filePath, html, 'utf8');
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---------------------------------------------------------------------------
// Native FFmpeg with hardware acceleration (see ffmpeg-native.mjs).
//
// The page drives this through an object shaped exactly like the ffmpeg.wasm
// instance (built in src/renderers/video.ts), so every existing call site works
// unchanged and the WASM build stays as the fallback when no binary is found.
//
// A shipped binary would live in resources/ffmpeg/; none is bundled yet, so
// BUNDLED_FFMPEG resolves to a path that simply does not exist and the finder
// moves on to PATH.
// ---------------------------------------------------------------------------
const FF_EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const BUNDLED_FFMPEG = [
  // Shipped inside the package (nothing there yet - see electron-builder.yml).
  app.isPackaged ? join(process.resourcesPath, 'ffmpeg', FF_EXE) : null,
  // Portable: drop an ffmpeg binary beside the .exe (or in an `ffmpeg` folder
  // next to it) and the stick carries its own hardware video path, instead of
  // depending on whatever the host machine happens to have on PATH.
  PORTABLE_DIR ? join(PORTABLE_DIR, FF_EXE) : null,
  PORTABLE_DIR ? join(PORTABLE_DIR, 'ffmpeg', FF_EXE) : null,
  PORTABLE_DIR ? join(PORTABLE_DIR, 'ffmpeg', 'bin', FF_EXE) : null,
].filter(Boolean);

/** Every ffmpeg IPC call must come from our own window. */
function fromMainWindow(e) {
  return !!mainWindow && e.sender === mainWindow.webContents;
}

ipcMain.handle('anr:ffmpeg-caps', async (e) => {
  if (!fromMainWindow(e)) return { available: false };
  try { return await ffnative.capabilities(app.getPath('userData'), BUNDLED_FFMPEG); }
  catch (err) { return { available: false, error: String((err && err.message) || err) }; }
});

ipcMain.handle('anr:ffmpeg-open', async (e) => {
  if (!fromMainWindow(e)) return null;
  const id = randomUUID();
  await ffnative.openSession(id, app.getPath('temp'));
  return id;
});

ipcMain.handle('anr:ffmpeg-write', async (e, { id, name, data }) => {
  if (!fromMainWindow(e)) return false;
  return ffnative.put(id, name, data);
});

ipcMain.handle('anr:ffmpeg-read', async (e, { id, name }) => {
  if (!fromMainWindow(e)) return null;
  const buf = await ffnative.get(id, name);
  // Hand back the exact bytes. The preload wraps this in a Uint8Array so the
  // page sees what ffmpeg.wasm's readFile would have resolved to.
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});

ipcMain.handle('anr:ffmpeg-delete', async (e, { id, name }) => {
  if (!fromMainWindow(e)) return false;
  try { return await ffnative.del(id, name); } catch (_) { return false; }
});

ipcMain.handle('anr:ffmpeg-exec', async (e, { id, args, timeout }) => {
  if (!fromMainWindow(e)) return { ok: false, code: -1 };
  const caps = await ffnative.capabilities(app.getPath('userData'), BUNDLED_FFMPEG);
  if (!caps.available) return { ok: false, code: -1, log: 'no ffmpeg binary' };
  const post = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('anr:ffmpeg-event', payload);
  };
  try {
    return await ffnative.runJob(id, args, {
      bin: caps.path,
      accel: caps.accel,
      timeout: timeout || 0,
      onLog: (message) => post({ id, type: 'log', message }),
      onProgress: (progress) => post({ id, type: 'progress', progress }),
    });
  } catch (err) {
    return { ok: false, code: -1, log: String((err && err.message) || err) };
  }
});

ipcMain.handle('anr:ffmpeg-close', async (e, { id }) => {
  if (!fromMainWindow(e)) return false;
  await ffnative.closeSession(id);
  return true;
});

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, workingDirectory) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    for (const p of pathsFromArgv(argv)) openPath(p, workingDirectory);
  });

  // Windows taskbar / jump list identity. Must be set before any window opens.
  app.setAppUserModelId('com.valjdakosta.analyser');

  // Every window, the main one and the export report's about:blank child alike.
  app.on('web-contents-created', (_e, wc) => hardenWebContents(wc));

  // macOS "Open with" and dock drops. Queued until the window exists.
  const queuedOpen = [];
  app.on('open-file', (e, path) => {
    e.preventDefault();
    if (mainWindow) openPath(path); else queuedOpen.push(path);
  });

  app.whenReady().then(() => {
    if (!looksLikeWebRoot(WEB_DIR)) {
      dialog.showErrorBox('Analyser',
        'The web assets are missing.\n\nExpected to find index.html in:\n' + WEB_DIR);
      app.quit();
      return;
    }

    // ---- analyser://  - the site itself, plus the /api/* proxy -------------
    protocol.handle('analyser', async (req) => {
      const url = new URL(req.url);
      const r = route(url.pathname, WEB_DIR);

      if (r.proxy) {
        // API_ORIGIN in src/core/util.ts is '' (same origin), and the Worker
        // sets no CORS headers - so a renderer fetch straight to the site would
        // fail. Forwarding from here sidesteps CORS entirely and leaves
        // util.ts, history.ts, stats-page.ts, leaderboard.ts and the Worker
        // untouched.
        try {
          return await net.fetch(SITE + url.pathname + url.search, {
            method: req.method,
            headers: req.headers,
            body: req.body,
            duplex: 'half',
          });
        } catch (_) {
          // Offline: the app already treats a failed /api/* call as "not
          // counted" and queues the ping, so a clean error is enough.
          return new Response('{"error":"offline"}', {
            status: 503, headers: { 'content-type': 'application/json' },
          });
        }
      }

      let res;
      try {
        res = await net.fetch(pathToFileURL(r.file).href, { headers: req.headers });
      } catch (_) {
        // The file vanished between the stat and the read. Never let the
        // handler reject - Electron turns that into a bare network error.
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      const headers = new Headers(res.headers);
      // Set the type from our own table when we know the extension (see MIME in
      // router.mjs for why this is not left to Chromium's file: mime map).
      const mime = mimeFor(r.file);
      if (mime) headers.set('content-type', mime);
      // Nothing here is versioned by filename, and the service worker owns
      // cache busting through its VERSION epoch - so never let the network
      // stack hold a copy of its own.
      headers.set('cache-control', 'no-cache');
      return new Response(res.body, {
        status: r.notFound ? 404 : res.status,
        statusText: res.statusText,
        headers,
      });
    });

    // ---- anr-open://<token>  - one file the user chose, by token -----------
    protocol.handle('anr-open', async (req) => {
      const token = new URL(req.url).hostname;
      const entry = approved.get(token);
      if (!entry) return new Response('', { status: 404 });
      try {
        const res = await net.fetch(pathToFileURL(entry.path).href);
        const headers = new Headers();
        headers.set('content-type', mimeFor(entry.name) || 'application/octet-stream');
        // The page origin is analyser://, this is anr-open:// - a cross-origin
        // fetch, so it needs the header even for a scheme only we can mint.
        headers.set('access-control-allow-origin', '*');
        headers.set('cache-control', 'no-store');
        return new Response(res.body, { status: res.status, headers });
      } catch (_) {
        return new Response('', { status: 404 });
      }
    });

    Menu.setApplicationMenu(buildMenu(actions));
    mainWindow = createWindow();

    // Only allow what the app actually uses. Everything else - notifications,
    // geolocation, media capture, MIDI, USB, HID, serial - is denied outright.
    const sess = mainWindow.webContents.session;
    sess.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'fullscreen'
        || permission === 'clipboard-read'
        || permission === 'clipboard-sanitized-write');
    });

    mainWindow.webContents.once('did-finish-load', () => {
      for (const p of pathsFromArgv(process.argv)) openPath(p);
      while (queuedOpen.length) openPath(queuedOpen.shift());
    });

    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
