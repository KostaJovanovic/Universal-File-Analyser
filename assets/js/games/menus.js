/* Analyser - Asteroids easter egg: splash / pause / settings menus.
   A translucent dim layer plus a single reused centred panel whose contents are swapped
   between the opening splash, the in-run pause overlay, and the settings view. Both
   freeze the sim and dim the field behind the panel. Also the small DOM builders (stat
   chips, full-width buttons, toggle switches) and the splash-screen decorative asteroids. */

import { rand, pick, ARCHIVE_POOL, FILE_POOL } from './config.js';
import { g, saveSettings } from './state.js';
import { layout } from './geometry.js';
import { restart, makeAsteroid } from './world.js';

// Drives the Settings menu rows. type 'toggle' (default) renders a switch; 'select'
// renders a segmented control over `options`. `apply` (optional) runs on change.
export const SETTING_DEFS = [
  { key: 'reduceFlash', t: 'Reduce flashing' },
  { key: 'bgDetail', t: 'Background detail', d: 'Starfield and drifting ship squadrons' },
  { key: 'showFps', t: 'Show FPS / bodies', d: 'Frame-rate and on-screen body counter' },
  { key: 'hideAsteroidText', t: 'Hide asteroid labels', d: 'Draw asteroids as plain outlines, no file-type text' },
  { key: 'renderScale', t: 'Render resolution', d: 'Lower it for smoother performance', type: 'select',
    options: [{ v: 0.5, label: '50%' }, { v: 0.75, label: '75%' }, { v: 1, label: '100%' }], apply: () => layout() }
];

// A translucent layer dimming the field behind a menu. pointer-events:none so the corner
// buttons underneath stay clickable; the centred panel sits above it (z 4).
function makeMenuDim() {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute; inset:0; background:rgba(0,0,0,0.55); z-index:3; pointer-events:none;';
  g.overlay.appendChild(d);
  return d;
}
export function clearMenus() {
  if (g.menuPanel) { g.menuPanel.remove(); g.menuPanel = null; }
  if (g.menuDim) { g.menuDim.remove(); g.menuDim = null; }
}
// Ensure the dim + the single reused panel exist, and return the (emptied) panel.
function menuShell() {
  if (!g.menuDim) g.menuDim = makeMenuDim();
  if (!g.menuPanel) { g.menuPanel = document.createElement('div'); g.menuPanel.className = 'anr-score-panel'; g.overlay.appendChild(g.menuPanel); }
  g.menuPanel.innerHTML = '';
  return g.menuPanel;
}

// ---- small DOM builders for the menus ----
function menuLine(cls, text) { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; }
function menuRule() { const d = document.createElement('div'); d.className = 'anr-menu-rule'; return d; }
function statChip(k, v, acc) {
  const c = document.createElement('div'); c.className = 'anr-menu-chip';
  const kk = document.createElement('span'); kk.className = 'k'; kk.textContent = k;
  const vv = document.createElement('span'); vv.className = 'v' + (acc ? ' acc' : ''); vv.textContent = v;
  c.append(kk, vv); return c;
}
function menuButton(icon, label, onClick, primary) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'anr-menu-btn' + (primary ? ' anr-menu-btn--primary' : '');
  const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = icon;
  const lb = document.createElement('span'); lb.textContent = label;
  b.append(ic, lb);
  b.addEventListener('click', onClick);
  return b;
}
function toggleRow(def) {
  const row = document.createElement('button');
  row.type = 'button'; row.className = 'anr-menu-toggle';
  row.setAttribute('role', 'switch');
  const lab = document.createElement('span'); lab.className = 'lab';
  lab.append(menuLine('t', def.t));
  if (def.d) lab.append(menuLine('d', def.d));
  const sw = document.createElement('span'); sw.className = 'anr-menu-sw' + (g.settings[def.key] ? ' on' : '');
  const sync = () => { sw.classList.toggle('on', !!g.settings[def.key]); row.setAttribute('aria-checked', String(!!g.settings[def.key])); };
  sync();
  row.append(lab, sw);
  row.addEventListener('click', () => { g.settings[def.key] = !g.settings[def.key]; sync(); saveSettings(); });
  return row;
}
// A multi-option setting: label on the left, a segmented control on the right.
function selectRow(def) {
  const row = document.createElement('div'); row.className = 'anr-menu-toggle'; row.style.cursor = 'default';
  const lab = document.createElement('span'); lab.className = 'lab';
  lab.append(menuLine('t', def.t));
  if (def.d) lab.append(menuLine('d', def.d));
  const seg = document.createElement('div'); seg.className = 'anr-menu-seg';
  const btns = [];
  const sync = () => btns.forEach((x) => x.b.classList.toggle('on', x.v === g.settings[def.key]));
  for (const opt of def.options) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = opt.label;
    b.addEventListener('click', () => { g.settings[def.key] = opt.v; sync(); saveSettings(); if (def.apply) def.apply(); });
    btns.push({ b, v: opt.v });
    seg.append(b);
  }
  sync();
  row.append(lab, seg);
  return row;
}

// A few solid, drifting asteroids purely as splash-screen eye candy. solo+grace 0 keeps
// them out of the wave-banner logic and gives them a normal outline.
export function spawnSplashDecor() {
  const { cx, cy, HW, HH, S } = g;
  for (const sz of [3, 3, 2, 2, 2, 1]) {
    let x, y, tries = 0;
    do { x = cx + rand(-HW, HW) * 0.85; y = cy + rand(-HH, HH) * 0.85; }
    while (Math.hypot(x - cx, y - cy) < 110 * S && ++tries < 20);
    const a = makeAsteroid(x, y, sz, sz === 3 ? pick(ARCHIVE_POOL) : pick(FILE_POOL));
    a.solo = true; a.grace = 0;
    g.asteroids.push(a);
  }
}

// ---- views (each fills the shared panel) ----
// Opening splash: title, controls hint, Play and Settings. The sim is frozen (the decor
// just drifts) until Play / Enter / Space starts a fresh run.
function renderSplash() {
  const p = menuShell();
  const title = menuLine('anr-score-go', 'ASTEROIDS'); title.style.fontSize = '30px';
  p.append(title, menuLine('anr-score-title', 'SUPPORTED FILE TYPES'));
  if (g.highScore > 0) p.append(menuLine('anr-score-sub', 'HIGH ' + String(g.highScore).padStart(5, '0')));
  p.append(menuLine('anr-score-msg', g.isTouch ? 'Steer with the stick, tap to fire' : '← → rotate · ↑ thrust · space fire · P pause'));
  p.append(menuRule());
  p.append(menuButton('▶', 'Play', startGame, true));
  p.append(menuButton('⚙', 'Settings', () => renderSettings(renderSplash)));
}
export function showSplash() {
  g.splash = true; g.menuOpen = false;
  if (g.pauseBtn) g.pauseBtn.style.display = 'none';
  g.mobileControls.forEach((elm) => { elm.style.display = 'none'; });
  spawnSplashDecor();
  renderSplash();
}
// Play / any-key from the splash: just begin a fresh, scored run.
export function startGame() { if (g.splash) restart(); }

// Pause root: stat chips + full-width Resume / Settings / Restart / Exit.
function renderPauseRoot() {
  const p = menuShell();
  p.append(menuLine('anr-score-title', 'PAUSED'));
  const chips = document.createElement('div'); chips.className = 'anr-menu-chips';
  chips.append(
    statChip('SCORE', String(g.score), true),
    statChip('WAVE', String(g.wave)),
    statChip('HIGH', String(g.highScore))
  );
  p.append(chips, menuRule());
  p.append(menuButton('▶', 'Resume', closePause, true));
  p.append(menuButton('⚙', 'Settings', () => renderSettings(renderPauseRoot)));
  p.append(menuButton('↻', 'Restart', restart));
  p.append(menuButton('✕', 'Exit', () => g.teardown()));
}
// Settings view: toggle rows + a Back button that returns to whichever view opened it.
function renderSettings(back) {
  const p = menuShell();
  p.append(menuLine('anr-score-title', 'SETTINGS'), menuRule());
  for (const def of SETTING_DEFS) p.append(def.type === 'select' ? selectRow(def) : toggleRow(def));
  p.append(menuRule());
  p.append(menuButton('←', 'Back', back));
}

export function openPause() {
  if (g.splash || g.gameOver || g.menuOpen) return;
  g.menuOpen = true;
  // Drop any held input so nothing sticks while paused.
  g.input.left = g.input.right = g.input.thrust = g.input.fire = false;
  g.joy.active = false; g.joy.mag = 0;
  if (g.pauseBtn) g.pauseBtn.textContent = '▶';
  renderPauseRoot();
}
export function closePause() {
  if (!g.menuOpen) return;
  g.menuOpen = false;
  if (g.pauseBtn) g.pauseBtn.textContent = '❚❚';
  clearMenus();
}
