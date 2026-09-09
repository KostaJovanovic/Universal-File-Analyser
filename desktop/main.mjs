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

import { app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, net, protocol, screen, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { looksLikeWebRoot, mimeFor, route } from './router.mjs';
import { buildMenu, menuModel, runMenuItem } from './menu.mjs';
import * as ffnative from './ffmpeg-native.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/* The canonical host. Every absolute URL in the repo points here, and /api/*
   is forwarded to it. */
const SITE = 'https://analyser.valjdakosta.com';

/* macOS keeps its native frame so the traffic lights survive; every other
   platform is frameless and draws the whole title bar itself. */
const isMac = process.platform === 'darwin';

/* ---------------------------------------------------------------------------
 * Two web contents, not one - and this is the important structural decision in
 * the file.
 *
 * The title bar used to be drawn by the app's own page, at the top of its own
 * viewport. That works until something else in the page asks to sit at the top
 * of the window: `position: fixed`, `100vh` and window.innerHeight all still
 * counted the strip the bar covers, because a page has no way to learn that
 * part of its viewport is chrome. Every full-window overlay then needed its own
 * hand-written offset, and the one that got missed put the image lightbox's
 * close button inside the title bar.
 *
 * So the bar and the app are separate web contents now:
 *
 *   - the WINDOW's own contents is the title bar page (desktop/chrome/), and
 *   - the app runs in a WebContentsView parked below it.
 *
 * The app's viewport therefore starts under the bar for real. Nothing in the
 * page can reach the bar, no offsets exist to forget, and the native scrollbar
 * begins in the right place - which is why the app-drawn scrollbar this used to
 * need is gone entirely.
 *
 * That the bar is the WINDOW's contents rather than the other way round is also
 * deliberate: on Windows the OS drag hit-test is computed from the window's own
 * web contents, so `-webkit-app-region: drag` has to live there or the bar
 * stops moving the window.
 * ------------------------------------------------------------------------- */

/* The bar's height in CSS pixels. Only a starting value: the bar page measures
   itself from --anr-tb-h in analyser.css and reports the real number through
   anr:chrome-height, so the token stays the single source of truth. */
const TB_H_DEFAULT = 34;

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

/* Where the title bar page lives. It is served from desktop/chrome/, NOT from
   web/ - it is not part of the website and must never appear on it - but it is
   served on the app's own origin so it can link the site's stylesheet and read
   the same localStorage theme the app wrote.
   The prefix is handled before router.mjs is consulted, so that file stays a
   pure port of serve.py rather than gaining a third deliberate difference.
   Nothing under web/ may ever use this path. */
const CHROME_PATH = '/__chrome/';
const CHROME_DIR = join(HERE, 'chrome');
/* An allow-list, not a path join: the page is three files and this handler must
   not become a way to read anything else beside it. */
const CHROME_FILES = new Set(['titlebar.html', 'titlebar.js', 'panel.html', 'panel.js', 'accel.js']);

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
/** The view the SITE runs in. Everything that talks to the page talks to this,
 *  not to mainWindow.webContents - that one is the title bar. */
let appView = null;
/** Shorthand for the app's web contents, or null before the window exists. */
const appContents = () => (appView && !appView.webContents.isDestroyed() ? appView.webContents : null);
let tbHeight = TB_H_DEFAULT;
/** Set by createWindow. The title bar's IPC lives at module scope so `activate`
 *  re-creating the window cannot stack a second set of listeners. */
let chromeHooks = null;

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
    // The window draws its own title bar (chrome/titlebar.js, which IS this
    // window's web contents), so the OS one is removed entirely. On macOS
    // `frame: false` would take the traffic lights with it, so there the frame
    // stays and only the bar is hidden - our own buttons hide themselves on
    // darwin and the CSS leaves a gap for the native ones. `autoHideMenuBar`
    // matters on Windows/Linux: the native menu bar is unreachable without a
    // frame, and the bar draws the menus itself from menu.mjs's tree instead.
    frame: isMac,
    titleBarStyle: isMac ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 11 } : undefined,
    autoHideMenuBar: true,
    // Dev only: build/ is not inside the asar, and a packaged window takes its
    // icon from the executable that electron-builder stamped.
    icon: app.isPackaged ? undefined : join(HERE, 'build', 'icon.png'),
    // The window's own page is the TITLE BAR (see the note at the top of this
    // file). It gets its own small preload: nothing in chrome/ has any business
    // reaching the file dialogs, ffmpeg or the open-by-path bridge.
    webPreferences: {
      preload: join(HERE, 'chrome', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  // The site. A child view rather than the window's own contents, so its
  // viewport genuinely starts below the bar.
  const view = new WebContentsView({
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
  win.contentView.addChildView(view);
  appView = view;

  /* Full screen is tracked from the events, NOT read back from the window.
     Electron on Windows emits enter-full-screen and leave-full-screen BEFORE
     win.isFullScreen() starts returning the new value, so a listener that asks
     the window inside one of those handlers gets the state it had a moment ago.
     layout() only got away with that because the resize that follows re-runs it
     with the truth; the bar is told once and has no second event to correct it,
     so it latched "full screen" while windowed, hid itself, and left the window
     with no way to be moved, minimised or closed. Registered FIRST, so every
     listener below reads the new value. */
  let fullScreen = win.isFullScreen();
  win.on('enter-full-screen', () => { fullScreen = true; });
  win.on('leave-full-screen', () => { fullScreen = false; });

  /* Put the app view under the bar, and give it the whole window in full
     screen, where there is no bar to clear. Runs on every geometry change:
     a child view has no layout of its own, so nothing else moves it. */
  const layout = () => {
    if (win.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    const top = fullScreen ? 0 : tbHeight;
    view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  };
  win.on('resize', layout);
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  layout();

  /* An open menu panel is a separate window pinned to a point on this one, so
     it cannot follow a window that moves or resizes. Native menus close on the
     same events. */
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'minimize']) {
    win.on(ev, () => closePanel());
  }

  if (st.maximized) win.maximize();
  // Wait for the SITE to paint, not the bar: the bar is ready almost at once,
  // and showing then would flash an empty window for as long as the app takes.
  view.webContents.once('did-finish-load', () => {
    layout();
    win.show();
    /* Build the menu panel's window now, hidden and empty. It has two
       stylesheets and the fonts to load, and on a cold start that takes longer
       than the gap between clicking File and expecting to see it - so the first
       menu opened at the size the window was created at. Warmed up here, every
       open is the same speed. */
    ensurePanelWindow();
  });

  let saveTimer = null;
  const queueSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeState(win), 400);
  };
  win.on('resize', queueSave);
  win.on('move', queueSave);
  win.on('close', () => writeState(win));
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  /* The title bar draws its own maximise/restore glyph and recedes when the
     window loses focus, so it has to hear about every state change - including
     the ones it did not cause (Win+Up, Snap, a double-click on the drag region,
     exiting full screen). */
  const pushState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('anr:win-state', {
      maximized: win.isMaximized(),
      fullScreen,   // the tracked flag - see why above layout()
      // An open menu panel is a window of its own and takes the focus, which
      // would otherwise make the bar recede exactly while it is being used.
      focused: win.isFocused() || panelFocused(),
    });
  };
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur']) {
    win.on(ev, pushState);
  }

  /* The bar names the section the app is on and lights its own back/forward
     arrows, and it cannot read either from the app any more - separate contents,
     and deliberately so. `did-navigate-in-page` is the one that matters most:
     the site is an SPA (core/navigate.ts), so most moves never fire a real
     navigation. There is no browser chrome in a frameless window, so those two
     arrows are the only way back short of the keyboard. */
  const pushNav = () => {
    if (win.isDestroyed() || view.webContents.isDestroyed()) return;
    const h = view.webContents.navigationHistory;
    let path = '/';
    try { path = new URL(view.webContents.getURL()).pathname; } catch (_) { /* about:blank */ }
    win.webContents.send('anr:chrome-nav', {
      path,
      canBack: h.canGoBack(),
      canForward: h.canGoForward(),
    });
  };
  view.webContents.on('did-navigate', pushNav);
  view.webContents.on('did-navigate-in-page', pushNav);

  // Handed to the module-level IPC below. The bar comes up before the app does,
  // so it asks for everything once it is ready rather than racing it.
  chromeHooks = { pushState, pushNav, layout };

  win.loadURL(ORIGIN + CHROME_PATH + 'titlebar.html');
  view.webContents.loadURL(ORIGIN + '/');
  // A load that never finishes must not leave an invisible window behind.
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 4000);
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
  const wc = appContents();
  if (!info || !wc) return;
  wc.send('anr:open', { kind: 'file', ...info });
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
  const wc = appContents();
  if (!wc) return;
  wc.send('anr:open', walkFolder(path));
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
    const wc = appContents();
    if (wc) wc.loadURL(ORIGIN + path);
  },
  external(url) {
    shell.openExternal(url).catch(() => {});
  },
  /* Window and page commands. These were Electron menu ROLES, which the drawn
     menu cannot use - a role only means something inside a real Menu - so each
     one is spelled out against the app's view. Zoom moves in the same steps
     Chromium's own does. */
  view(what) {
    const wc = appContents();
    if (!wc || !mainWindow) return;
    if (what === 'reload') wc.reload();
    else if (what === 'back') wc.navigationHistory.goBack();
    else if (what === 'forward') wc.navigationHistory.goForward();
    else if (what === 'zoomIn') wc.setZoomLevel(Math.min(9, wc.getZoomLevel() + 0.5));
    else if (what === 'zoomOut') wc.setZoomLevel(Math.max(-8, wc.getZoomLevel() - 0.5));
    else if (what === 'zoomReset') wc.setZoomLevel(0);
    else if (what === 'devTools') wc.toggleDevTools();
    else if (what === 'fullScreen') mainWindow.setFullScreen(!mainWindow.isFullScreen());
    else if (what === 'close') mainWindow.close();
    else if (what === 'quit') app.quit();
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
// The title bar (desktop/chrome/).
//
// The window is frameless everywhere except macOS, so minimise / maximise /
// close have no native affordance left and arrive here instead. `menu` pops the
// application menu under the bar's MENU button: with no frame there is no menu
// bar to drop it from, and Menu.getApplicationMenu() still holds the one
// buildMenu() made, so the accelerators and the entries stay in one place.
//
// Every one of these checks the sender is the BAR's contents, not the app's -
// the site is a separate web contents and has no business moving the window.
// ---------------------------------------------------------------------------
const fromChrome = (e) => !!mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents;

ipcMain.handle('anr:win', (e, action) => {
  if (!fromChrome(e)) return null;
  const w = mainWindow;
  if (action === 'minimize') w.minimize();
  else if (action === 'maximize') { w.isMaximized() ? w.unmaximize() : w.maximize(); }
  else if (action === 'close') w.close();
  return { maximized: w.isMaximized(), fullScreen: w.isFullScreen(), focused: w.isFocused() };
});

/* The menu, as data. The bar draws it itself - see menu.mjs for why the tree has
   one definition and two consumers. */
ipcMain.handle('anr:menu-model', (e) => (fromChrome(e) ? menuModel(actions) : []));

/* A click in the drawn menu. The id is checked against the tree rather than
   trusted, because it arrives from a renderer. */
ipcMain.handle('anr:menu-run', (e, id) => (fromChrome(e) ? runMenuItem(actions, String(id || '')) : false));

/* ---------------------------------------------------------------------------
 * The menu panels, each in its own small window.
 *
 * They cannot be drawn in the bar's page. The bar IS the window's own web
 * contents and the site is a CHILD view, and a child view always composites
 * ABOVE the contents it was added to - so a panel dropped below the bar lands
 * underneath the site and is invisible. Nothing in CSS can reach across that:
 * the DOM has no idea another native view is on top of it, which is why the
 * panel measured as perfectly on-screen while showing nothing at all.
 *
 * The other way round is worse. Moving the bar into a child view would let the
 * panel draw, but on Windows the OS computes the drag hit-test from the
 * window's own web contents, so -webkit-app-region would stop moving the
 * window - see the note at the top of this file.
 *
 * So the panel gets a window. One window, reused: it is repositioned and
 * refilled as the user slides along the menu bar, rather than made and
 * destroyed four times.
 * ------------------------------------------------------------------------- */
let panelWin = null;
let panelMenuId = '';
/* Clicking an open menu's own title must CLOSE it. The click blurs the panel
   window first, which closes it, and the title's click handler then arrives at
   an already-closed menu and would open it straight back up. So a re-open of
   the menu that just closed is ignored for a moment. */
let panelClosedId = '';
let panelClosedAt = 0;

const fromPanel = (e) => !!panelWin && !panelWin.isDestroyed() && e.sender === panelWin.webContents;
const panelFocused = () => !!panelWin && !panelWin.isDestroyed() && panelWin.isFocused();

function closePanel() {
  if (panelMenuId) { panelClosedId = panelMenuId; panelClosedAt = Date.now(); }
  panelMenuId = '';
  if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) panelWin.hide();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('anr:menu-closed');
}

function ensurePanelWindow() {
  if (panelWin && !panelWin.isDestroyed()) return panelWin;
  panelWin = new BrowserWindow({
    parent: mainWindow,     // keeps it above the window it belongs to
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    width: 220,
    height: 100,
    webPreferences: {
      preload: join(HERE, 'chrome', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  // Clicking anywhere else - the bar, the page, another app - dismisses it,
  // which is the whole of "click outside to close" in one line.
  panelWin.on('blur', () => { closePanel(); if (chromeHooks) chromeHooks.pushState(); });
  panelWin.on('closed', () => { panelWin = null; panelMenuId = ''; });
  panelWin.loadURL(ORIGIN + CHROME_PATH + 'panel.html');
  return panelWin;
}

/* The bar asks for a menu, giving the title's position in ITS OWN client
   coordinates. Main turns that into screen coordinates, because only main knows
   where the window is. */
ipcMain.on('anr:menu-open', (e, req) => {
  if (!fromChrome(e) || !mainWindow || mainWindow.isDestroyed()) return;
  const id = String((req && req.id) || '');
  const model = menuModel(actions);
  const menu = model.find((m) => m.id === id);
  if (!menu) return;
  if (id === panelClosedId && Date.now() - panelClosedAt < 250) { panelClosedId = ''; return; }
  panelMenuId = id;
  const win = ensurePanelWindow();
  const at = { x: Math.round(Number(req.x) || 0), y: Math.round(Number(req.y) || 0) };
  const send = () => win.webContents.send('anr:panel-menu', { menu, at });
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send); else send();
});

ipcMain.on('anr:menu-close', (e) => { if (fromChrome(e)) closePanel(); });

/* The panel has laid itself out and reports the size it needs. Only now is it
   positioned and shown, so it never flashes at the wrong size or place. */
ipcMain.on('anr:panel-size', (e, size) => {
  if (!fromPanel(e) || !panelMenuId || !mainWindow || mainWindow.isDestroyed()) return;
  const w = Math.max(80, Math.ceil(Number(size && size.w) || 0));
  const h = Math.max(24, Math.ceil(Number(size && size.h) || 0));
  const at = size && size.at ? size.at : { x: 0, y: 0 };
  const c = mainWindow.getContentBounds();
  const area = screen.getDisplayMatching(c).workArea;
  // Clamped to the display, so a menu near the right or bottom edge stays whole
  // rather than being cut off - a panel window is not bounded by its parent.
  const x = Math.min(Math.max(area.x, c.x + at.x), area.x + area.width - w);
  const y = Math.min(Math.max(area.y, c.y + at.y), area.y + area.height - h);
  panelWin.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
  if (!panelWin.isVisible()) panelWin.show();
  if (chromeHooks) chromeHooks.pushState();
});

ipcMain.on('anr:panel-run', (e, id) => {
  if (!fromPanel(e)) return;
  closePanel();
  runMenuItem(actions, String(id || ''));
});

ipcMain.on('anr:panel-close', (e) => { if (fromPanel(e)) closePanel(); });

/* The bar reports its own height, measured from --anr-tb-h in analyser.css, so
   that token stays the single source of truth for it and main never carries a
   second copy of the number. Arrives once on load and again on a zoom or DPI
   change. */
ipcMain.on('anr:chrome-height', (e, px) => {
  if (!fromChrome(e)) return;
  const h = Math.max(0, Math.round(Number(px) || 0));
  if (!h || h === tbHeight) return;
  tbHeight = h;
  if (chromeHooks) chromeHooks.layout();
});

/* The bar is up. It asks rather than being told, because it finishes loading
   before the app does and would otherwise be sent a state it then overwrote. */
ipcMain.on('anr:chrome-ready', (e) => {
  if (!fromChrome(e) || !chromeHooks) return;
  chromeHooks.pushState();
  chromeHooks.pushNav();
});

/* Back and forward, from the bar's own arrows. */
ipcMain.on('anr:chrome-nav', (e, dir) => {
  if (!fromChrome(e)) return;
  actions.view(dir === 'forward' ? 'forward' : 'back');
});

/* What the window is currently showing, named. The app sends the file it just
   analysed (core/app.ts, behind the window.anrDesktop guard) and an empty string
   when it goes back to a page - a title bar that names the open file is the main
   thing this one has over the section label alone. It also becomes the window
   title, so the taskbar entry says the same. */
ipcMain.on('anr:subject', (e, text) => {
  if (e.sender !== appContents() || !mainWindow || mainWindow.isDestroyed()) return;
  const subject = String(text || '').slice(0, 200);
  mainWindow.setTitle(subject ? subject + ' - Analyser' : 'Analyser');
  mainWindow.webContents.send('anr:chrome-subject', subject);
});

// ---------------------------------------------------------------------------
// Save the exported report through a native dialog (IPC from preload).
// ---------------------------------------------------------------------------
ipcMain.handle('anr:save-report', async (e, { name, html }) => {
  // Only the app's own view may ask.
  if (e.sender !== appContents()) return { ok: false, error: 'denied' };
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

/** Every ffmpeg IPC call must come from the app's own view. */
function fromMainWindow(e) {
  return e.sender === appContents();
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
    const wc = appContents();
    if (wc) wc.send('anr:ffmpeg-event', payload);
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

      // The title bar page. Read rather than streamed: it is three small files,
      // and readFileSync sees inside the asar, which spares this the question of
      // whether the network stack does.
      if (url.pathname.startsWith(CHROME_PATH)) {
        const name = url.pathname.slice(CHROME_PATH.length);
        if (!CHROME_FILES.has(name)) return new Response('', { status: 404 });
        try {
          return new Response(readFileSync(join(CHROME_DIR, name)), {
            headers: { 'content-type': mimeFor(name) || 'text/plain', 'cache-control': 'no-cache' },
          });
        } catch (_) {
          return new Response('', { status: 404 });
        }
      }

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
    // Both views share the default session, so one handler covers the pair.
    const sess = appContents().session;
    sess.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'fullscreen'
        || permission === 'clipboard-read'
        || permission === 'clipboard-sanitized-write');
    });

    appContents().once('did-finish-load', () => {
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
