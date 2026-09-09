/* Analyser desktop - the title bar's own script.
 *
 * Runs in the WINDOW's web contents, which holds nothing but the bar. The site
 * is a separate WebContentsView below it and shares no scope with this, so
 * everything here arrives through window.anrChrome (desktop/chrome/preload.cjs).
 *
 * This was core/desktop-chrome.ts in the app source until the bar moved out of
 * the page. It is plain JS now rather than TypeScript, because it is no longer
 * part of the compiled src/ tree, is not in sw.js's SHELL and is never fetched
 * by a browser.
 *
 * The markup is static and authored here - no file-derived string reaches it,
 * so it needs nothing from the site's sanitiser.
 *
 * Styles: the DESKTOP WINDOW CHROME block at the end of assets/css/analyser.css,
 * which this page links whole.
 */

const chrome = window.anrChrome;

/** The label shown next to the wordmark. Prefixes matter for the two generated
 *  trees, where /formats/png and /docs/faq are still Formats and Docs. */
const SECTIONS = [
  ['/formats', 'Formats'],
  ['/docs', 'Docs'],
  ['/patch', 'Changelog'],
  ['/about', 'About'],
  ['/stats', 'Statistics'],
  ['/samples', 'Samples'],
  ['/compare', 'Compare'],
  ['/privacy', 'Privacy'],
  ['/test', 'Style guide'],
  ['/atari', 'Asteroids'],
];

/** The bar cannot read the app's location - separate contents - so main sends
 *  the path on every navigation, including the SPA ones. */
function sectionLabel(pathname) {
  const p = String(pathname || '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/index') return 'Home';
  for (const [prefix, label] of SECTIONS) {
    if (p === prefix || p.startsWith(prefix + '/')) return label;
  }
  return p.split('/').filter(Boolean).pop() || 'Home';
}

/* Window-control glyphs.
 *
 * On Windows these are the SYSTEM ones - the Segoe Fluent Icons (Windows 11) /
 * Segoe MDL2 Assets (Windows 10) codepoints every native title bar draws, so
 * the controls are pixel-identical to the ones next to them on the taskbar and
 * are correctly weighted at every DPI. Hand-drawing them is what produced a
 * lopsided close cross: a 1px diagonal under shape-rendering: crispEdges gets
 * snapped one way at one end and the other way at the other.
 *
 * Elsewhere those fonts do not exist, so a small SVG set stands in. Its
 * axis-aligned strokes sit on half-pixels to stay crisp, and the cross is left
 * on the default shape-rendering - the snapping is exactly what broke it. */
const WIN_GLYPH = {
  // Escapes, not the literal characters. These are private-use codepoints, so
  // typed in they render as blanks and the table reads as blanks -
  // which is what made the previous copy of it unsafe to edit.
  back: '\uE72B',      // Back
  forward: '\uE72A',   // Forward
  min: '\uE921',       // ChromeMinimize
  max: '\uE922',       // ChromeMaximize
  restore: '\uE923',   // ChromeRestore
  close: '\uE8BB',     // ChromeClose
};

const SVG_GLYPH = {
  back: '<path d="M7.5 1.5 3 6l4.5 4.5"/>',
  forward: '<path d="M4.5 1.5 9 6l-4.5 4.5"/>',
  min: '<path d="M1 6.5h10"/>',
  max: '<rect x="1.5" y="1.5" width="9" height="9"/>',
  restore: '<path d="M3.5 3.5v-2h7v7h-2"/><rect x="1.5" y="3.5" width="7" height="7"/>',
  close: '<path d="M2 2 10 10M10 2 2 10"/>',
};

// Only Windows ships the Segoe icon fonts the system glyphs live in.
const useFont = chrome && chrome.platform === 'win32';

/** One glyph as markup. `extraClass` is what lets the CSS swap maximise for
 *  restore without rebuilding the button. */
function icon(name, extraClass) {
  const cls = 'anr-tb-ico' + (extraClass ? ' ' + extraClass : '');
  if (useFont) return `<span class="${cls} anr-tb-ico--font" aria-hidden="true">${WIN_GLYPH[name]}</span>`;
  return `<svg class="${cls}" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"`
    + ` fill="none" stroke="currentColor" stroke-width="1">${SVG_GLYPH[name]}</svg>`;
}

function button(cls, label, inner) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'anr-tb-btn ' + cls;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = inner;
  return b;
}

/** Mirror the window state onto <html> so the CSS can react to all of it: the
 *  maximise glyph, and the recessed unfocused bar. */
function applyState(s) {
  const c = document.documentElement.classList;
  c.toggle('anr-win-max', !!(s && s.maximized));
  c.toggle('anr-win-full', !!(s && s.fullScreen));
  c.toggle('anr-win-focused', !!(s && s.focused));
}

/* ---------------------------------------------------------------------------
 * The menus.
 *
 * Drawn here rather than popped from Electron, so they are the site's type,
 * hairlines and square corners instead of the OS's. The tree itself still has
 * one definition, in desktop/menu.mjs - it arrives as plain data and a click
 * goes back as an id, so nothing about what an entry DOES lives in this file.
 *
 * Behaves like a real menu bar: click to open, then moving across the other
 * titles switches between them without a second click, Escape or any click
 * outside closes, and the arrow keys walk the entries.
 * ------------------------------------------------------------------------- */

const isMacUI = chrome && chrome.platform === 'darwin';

/* The panel itself is NOT drawn here - it is a window of its own, filled by
   panel.js. It has to be: the site is a child view composited above this page,
   so a panel dropped below the bar is covered by it and invisible. The bar
   keeps the titles and the open/close state; main owns the panel. Full note
   above ensurePanelWindow() in desktop/main.mjs. */
let openMenu = null;          // the .anr-tb-menu whose panel is showing
let menuBarEl = null;

/* `anr-menu-open` on <html> turns the whole bar into a no-drag region while a
   menu is down. Without it the menu cannot be dismissed by clicking the bar:
   the OS claims a mousedown on a drag region before the page ever sees it, so
   the pointerdown handler below never runs and the click starts a window drag
   instead. Native menu bars give up dragging the same way while a menu is up. */
function markClosed() {
  if (openMenu) openMenu.classList.remove('is-open');
  openMenu = null;
  document.documentElement.classList.remove('anr-menu-open');
}

function closeMenu() {
  if (!openMenu) return;
  markClosed();
  chrome.closeMenu();
}

function showMenu(entry) {
  if (openMenu === entry) return;
  if (openMenu) openMenu.classList.remove('is-open');
  entry.classList.add('is-open');
  openMenu = entry;
  document.documentElement.classList.add('anr-menu-open');
  /* The title's own box, in this page's client coordinates. Main turns it into
     a screen position - only main knows where the window is. */
  const b = entry.getBoundingClientRect();
  chrome.openMenu(entry.menuId, Math.round(b.left), Math.round(b.bottom));
}

/** One top-level menu: just its title button now. */
function buildMenuEntry(menu) {
  const wrap = document.createElement('div');
  wrap.className = 'anr-tb-menu';
  wrap.menuId = menu.id;

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'anr-tb-btn anr-tb-menu-title';
  title.textContent = menu.label;
  title.setAttribute('aria-haspopup', 'true');
  wrap.appendChild(title);

  title.addEventListener('click', () => {
    if (openMenu === wrap) closeMenu(); else showMenu(wrap);
  });
  // Once one menu is open, sliding across the others switches between them -
  // the behaviour every menu bar has, and the thing that makes one usable.
  wrap.addEventListener('mouseenter', () => { if (openMenu && openMenu !== wrap) showMenu(wrap); });
  return wrap;
}

function buildMenuBar(model) {
  const bar = document.createElement('div');
  bar.className = 'anr-tb-menubar';
  for (const menu of model) bar.appendChild(buildMenuEntry(menu));
  return bar;
}

/* A click anywhere on the bar that is not the open menu's own title closes it.
   Clicks outside this window are handled by main, which closes the panel when
   its window loses focus. */
document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}, true);
document.addEventListener('keydown', (e) => {
  if (openMenu && e.key === 'Escape') closeMenu();
});

/* ------------------------------------------------------------------------- */

function build() {
  if (!chrome) return;
  const root = document.documentElement;
  if (isMacUI) root.classList.add('anr-desktop--mac');

  const bar = document.createElement('div');
  bar.id = 'anrTitlebar';
  bar.className = 'anr-titlebar';

  const brand = document.createElement('div');
  brand.className = 'anr-tb-brand';
  brand.textContent = 'Analyser';

  menuBarEl = document.createElement('div');
  menuBarEl.className = 'anr-tb-menubar';

  /* Back and forward. A frameless window has no browser chrome, so without
     these the only way back is Alt+Left or the Go menu. Disabled rather than
     hidden when there is nowhere to go, so the bar does not reflow as you
     move around. */
  const navGroup = document.createElement('div');
  navGroup.className = 'anr-tb-nav';
  const backBtn = button('anr-tb-back', 'Back', icon('back'));
  const fwdBtn = button('anr-tb-fwd', 'Forward', icon('forward'));
  backBtn.addEventListener('click', () => chrome.back());
  fwdBtn.addEventListener('click', () => chrome.forward());
  navGroup.append(backBtn, fwdBtn);

  /* What the window is showing: the section, and the analysed file's name when
     there is one. The file is the useful half - it is the only place the app
     names what you are looking at once you have scrolled away from the top. */
  const sub = document.createElement('div');
  sub.className = 'anr-tb-sub';
  const subSection = document.createElement('span');
  subSection.className = 'anr-tb-section';
  const subFile = document.createElement('span');
  subFile.className = 'anr-tb-file';
  subFile.hidden = true;
  sub.append(subSection, subFile);

  const space = document.createElement('div');
  space.className = 'anr-tb-space';

  const ctl = document.createElement('div');
  ctl.className = 'anr-tb-ctl';
  const minBtn = button('anr-tb-min', 'Minimise', icon('min'));
  const maxBtn = button('anr-tb-max', 'Maximise',
    icon('max', 'anr-tb-ico-max') + icon('restore', 'anr-tb-ico-restore'));
  const closeBtn = button('anr-tb-close', 'Close', icon('close'));
  minBtn.addEventListener('click', () => { chrome.minimize(); });
  maxBtn.addEventListener('click', () => { chrome.toggleMaximize(); });
  closeBtn.addEventListener('click', () => { chrome.close(); });
  ctl.append(minBtn, maxBtn, closeBtn);

  bar.append(brand, menuBarEl, navGroup, sub, space, ctl);
  document.body.appendChild(bar);

  // Double-clicking the bar's own surface maximises, the way a real title bar
  // does. The OS handles this for a drag region only when it draws the frame.
  bar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.anr-tb-btn, .anr-tb-panel')) return;
    chrome.toggleMaximize();
  });

  chrome.menuModel().then((model) => {
    menuBarEl.replaceWith(buildMenuBar(model || []));
  }).catch(() => { /* no menus is survivable: every entry has an accelerator */ });

  chrome.onState(applyState);
  // The panel is a window of its own, so the bar cannot see it dismissed by a
  // click elsewhere, by Escape, or by the window moving. Main says so.
  chrome.onMenuClosed(markClosed);
  chrome.onNav((n) => {
    subSection.textContent = sectionLabel(n && n.path);
    backBtn.disabled = !(n && n.canBack);
    fwdBtn.disabled = !(n && n.canForward);
  });
  chrome.onSubject((name) => {
    subFile.textContent = name || '';
    subFile.hidden = !name;
  });

  /* Tell main how tall the bar actually is, so --anr-tb-h in analyser.css stays
     the only place the number is written. Re-measured on resize because a zoom
     or a DPI change moves it. */
  const report = () => chrome.height(bar.getBoundingClientRect().height);
  report();
  window.addEventListener('resize', report);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(report).catch(() => {});

  // The bar loads before the app does, so it asks for the window state and the
  // current location rather than waiting to be told and painting a blank label.
  chrome.ready();
}

/* The theme lives in localStorage, which the bar shares with the app because
   they are the same origin - so a theme change in the app raises a storage
   event here and the bar follows it. No IPC, and no desktop-only branch in the
   site's own theme code. */
function applyTheme() {
  try {
    const t = localStorage.getItem('anr-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    if (localStorage.getItem('anr-a11y') === 'on') document.documentElement.setAttribute('data-a11y', 'on');
    else document.documentElement.removeAttribute('data-a11y');
  } catch (_) { /* a bar in the wrong theme is not worth throwing over */ }
}
window.addEventListener('storage', (e) => {
  if (!e.key || e.key === 'anr-theme' || e.key === 'anr-a11y') applyTheme();
});

build();
