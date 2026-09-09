/* Analyser desktop - the title bar's preload.
 *
 * Deliberately NOT the app's preload (../preload.cjs). The bar is a separate web
 * contents with a separate job: move, minimise, maximise and close the window,
 * and pop the application menu. It has no business reaching the file dialogs,
 * the open-by-path bridge, the report saver or ffmpeg, so it cannot - the two
 * bridges expose disjoint surfaces, and main checks the sender of every message
 * against the contents it is supposed to come from.
 *
 * CommonJS (.cjs) on purpose - preload scripts are not ES modules.
 */
const { contextBridge, ipcRenderer } = require('electron');

/* Kept in a local so the bar paints the right maximise glyph on its very first
   frame, rather than flickering through a round trip. */
let winState = { maximized: false, fullScreen: false, focused: true };
let stateHandler = null;
ipcRenderer.on('anr:win-state', (_e, s) => {
  winState = s || winState;
  if (stateHandler) { try { stateHandler(winState); } catch (_) {} }
});

/* Where the app is: the path, for the section name, and whether its history can
   go back or forward, for the bar's arrows. It cannot read either from the app -
   separate contents - so main forwards them on every navigation, SPA moves
   included. */
let navHandler = null;
let lastNav = { path: '/', canBack: false, canForward: false };
ipcRenderer.on('anr:chrome-nav', (_e, n) => {
  lastNav = n || lastNav;
  if (navHandler) { try { navHandler(lastNav); } catch (_) {} }
});

/* The panel is a window of its own, so the bar cannot see it close. Main says
   so, and the bar clears the highlight on the title that opened it. */
let menuClosedHandler = null;
ipcRenderer.on('anr:menu-closed', () => {
  if (menuClosedHandler) { try { menuClosedHandler(); } catch (_) {} }
});

/* What the window is showing, named - the analysed file, when there is one. */
let subjectHandler = null;
let lastSubject = '';
ipcRenderer.on('anr:chrome-subject', (_e, s) => {
  lastSubject = String(s || '');
  if (subjectHandler) { try { subjectHandler(lastSubject); } catch (_) {} }
});

contextBridge.exposeInMainWorld('anrChrome', {
  /** Which glyph set to draw: only Windows ships the Segoe icon fonts. */
  platform: String(process.platform || ''),

  minimize: () => ipcRenderer.invoke('anr:win', 'minimize'),
  toggleMaximize: () => ipcRenderer.invoke('anr:win', 'maximize'),
  close: () => ipcRenderer.invoke('anr:win', 'close'),

  /** The menu as plain data, so the bar can draw it in the site's own type
   *  rather than popping the OS one. See desktop/menu.mjs. */
  menuModel: () => ipcRenderer.invoke('anr:menu-model'),
  /** Run a drawn-menu entry by id. Main checks the id against the real tree. */
  menuRun: (id) => ipcRenderer.invoke('anr:menu-run', String(id || '')),

  /** Move the APP's history. The window has no browser chrome, so the bar's
   *  arrows are the only pointer route back. */
  back: () => ipcRenderer.send('anr:chrome-nav', 'back'),
  forward: () => ipcRenderer.send('anr:chrome-nav', 'forward'),

  /** Register the window-state sink, and replay what is already known. */
  onState(cb) {
    stateHandler = typeof cb === 'function' ? cb : null;
    if (stateHandler) { try { stateHandler(winState); } catch (_) {} }
  },
  /** Register the location sink (path + history availability), and replay. */
  onNav(cb) {
    navHandler = typeof cb === 'function' ? cb : null;
    if (navHandler) { try { navHandler(lastNav); } catch (_) {} }
  },
  /** Register the sink for the name of whatever is open, and replay. */
  onSubject(cb) {
    subjectHandler = typeof cb === 'function' ? cb : null;
    if (subjectHandler) { try { subjectHandler(lastSubject); } catch (_) {} }
  },

  /** Report the bar's measured height, so --anr-tb-h in analyser.css stays the
   *  one place it is written and main never holds a second copy of the number. */
  height: (px) => ipcRenderer.send('anr:chrome-height', Number(px) || 0),
  /** Ask for the window state and the current path. The bar finishes loading
   *  before the app does, so it pulls rather than waiting to be pushed. */
  ready: () => ipcRenderer.send('anr:chrome-ready'),

  /** Drop a menu, giving the title's box in the BAR's own client coordinates.
   *  Only main knows where the window is, so only main can turn that into the
   *  screen position the panel window needs. */
  openMenu: (id, x, y) => ipcRenderer.send('anr:menu-open', { id: String(id || ''), x: Number(x) || 0, y: Number(y) || 0 }),
  closeMenu: () => ipcRenderer.send('anr:menu-close'),
  /** Main says the panel went away - by a click elsewhere, Escape, or the
   *  window moving - so the bar can un-highlight the title. */
  onMenuClosed(cb) {
    menuClosedHandler = typeof cb === 'function' ? cb : null;
  },
});

/* ---------------------------------------------------------------------------
 * The panel window's own bridge.
 *
 * Same file, disjoint surface: panel.html gets anrPanel and nothing else, and
 * main checks the sender of every one of these against the panel's contents.
 * ------------------------------------------------------------------------- */
let menuHandler = null;
ipcRenderer.on('anr:panel-menu', (_e, payload) => {
  if (menuHandler) { try { menuHandler(payload); } catch (_) {} }
});

contextBridge.exposeInMainWorld('anrPanel', {
  platform: String(process.platform || ''),
  /** Receive the menu to draw: { menu, at }. `at` travels back with the size
   *  report, so main never has to remember where it was going to put it. */
  onMenu(cb) { menuHandler = typeof cb === 'function' ? cb : null; },
  /** The size this menu needs. Main positions and shows the window only once
   *  this arrives, so the panel never appears at the wrong size. */
  size: (w, h, at) => ipcRenderer.send('anr:panel-size', { w: Number(w) || 0, h: Number(h) || 0, at }),
  /** Run an entry by id. Main checks it against the real tree. */
  run: (id) => ipcRenderer.send('anr:panel-run', String(id || '')),
  close: () => ipcRenderer.send('anr:panel-close'),
});
