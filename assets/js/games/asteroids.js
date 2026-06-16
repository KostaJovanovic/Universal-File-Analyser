/* Analyser - Asteroids easter egg (orchestrator / launcher).
   Hidden behind the Konami code (see the boot._once block in app.js). A vector Asteroids
   clone played inside a rectangular "scope": the field is a torus, so anything crossing an
   edge re-enters at the opposite edge. Thematic twist - every asteroid is a supported file
   type; the big ones are archive/container formats and shatter into the file types they
   might contain.

   This module owns only the launch path: the full-screen overlay + canvas + corner buttons,
   the theme tokens, the fullscreen request, the dev sandbox panel, the start-wave toggle,
   the requestAnimationFrame loop, and teardown. All game logic lives in sibling modules that
   share the mutable state singleton `g` (state.js). Lazy-imported, so none of this loads
   until the code is entered. */

import {
  rand, pick, ARCHIVE_POOL, FILE_POOL, WAVE_GRACE, POWERUP_TYPES, POWERUP_DEF, MONO, STARTWAVE_KEY
} from './config.js';
import { gameCss } from './style.js';
import { g, initState } from './state.js';
import { layout } from './geometry.js';
import { restart, spawnWave, makeAsteroid, makePowerup, applyPowerup, driftAsteroids, updateFlyers, updateWreck } from './world.js';
import { addDrone } from './drones.js';
import { makeUfo } from './ufos.js';
import { spawnBoss } from './boss.js';
import { showSplash, openPause, closePause } from './menus.js';
import { loadLeaderboard, clearEndPanel } from './leaderboard.js';
import { installInput } from './input.js';
import { update } from './update.js';
import { render } from './render.js';

let active = false;   // singleton guard - the Konami code can't stack instances

export function launchAsteroids() {
  if (active) return;
  active = true;

  initState();   // (re)populate every per-run field with its launch default + persisted values

  // Theme: pull the site's own tokens so the easter egg matches Analyser - the dark-control
  // palette the fullscreen spectrogram uses, sharp corners, and --accent for the vectors.
  const root = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => (root.getPropertyValue(name) || fallback).trim();
  g.ACCENT = cssVar('--accent', '#e60023');
  g.ACCENT_FG = cssVar('--accent-fg', '#ffffff');
  g.MEDIA_BG = cssVar('--media-bg', '#0a0a0a');
  g.SURFACE = cssVar('--surface-on-dark', '#1a1a1a');
  g.ON_DARK = cssVar('--on-dark', '#ffffff');
  g.BORDER = cssVar('--border-on-dark-ctl', '#444');
  g.MUTED = cssVar('--muted-on-dark', '#999');

  // ---- DOM scaffold ----
  g.prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const overlay = document.createElement('div');
  g.overlay = overlay;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Asteroids');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:2147483600; background:' + g.MEDIA_BG + '; ' +
    'touch-action:none; user-select:none; -webkit-user-select:none;';

  const style = document.createElement('style');
  style.textContent = gameCss({
    ACCENT: g.ACCENT, ACCENT_FG: g.ACCENT_FG, MEDIA_BG: g.MEDIA_BG,
    SURFACE: g.SURFACE, ON_DARK: g.ON_DARK, BORDER: g.BORDER, MUTED: g.MUTED
  });
  overlay.appendChild(style);

  const canvas = document.createElement('canvas');
  g.canvas = canvas;
  canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block;';
  overlay.appendChild(canvas);

  // Nuclear flash as a DOM layer (not a canvas fill) so it sits above EVERYTHING - controls,
  // close button, end panel. Its opacity is driven per frame by nukeFlash(); pointer-events
  // none so it never traps input.
  const nukeEl = document.createElement('div');
  g.nukeEl = nukeEl;
  nukeEl.style.cssText = 'position:absolute; inset:0; background:#fff; opacity:0; pointer-events:none; z-index:2147483647;';
  overlay.appendChild(nukeEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'anr-game-btn';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close game');
  closeBtn.style.cssText = 'position:absolute; top:14px; right:16px; z-index:2; width:36px; height:36px; font-size:15px;';
  closeBtn.addEventListener('click', teardown);
  overlay.appendChild(closeBtn);

  // Dev-only hard reload: clears the cache so code edits actually show up. Hidden in
  // production - only on localhost, a private LAN IP (phone testing), or the :3000 dev server.
  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname) || location.port === '3000';
  g.isDev = isDev;
  if (isDev) {
    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'anr-game-btn';
    reloadBtn.textContent = '⟳';
    reloadBtn.title = 'Clear cache and reload (dev)';
    reloadBtn.setAttribute('aria-label', 'Clear cache and reload');
    reloadBtn.style.cssText = 'position:absolute; top:14px; right:60px; z-index:2; width:36px; height:36px; font-size:16px;';
    reloadBtn.addEventListener('click', async () => {
      reloadBtn.disabled = true;
      // Mirror a manual "clear cache + hard reload": unregister the PWA service worker and
      // delete every Cache Storage bucket, then reload so all modules refetch from the server.
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (_) {}
      location.reload();
    });
    overlay.appendChild(reloadBtn);
  }

  // Touch device: drives the on-screen controls and hides the keyboard-only HUD hints.
  g.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  // Pause toggle (top-left). Shown only during an active run; mirrors the P key and the
  // pause menu's Resume button.
  const pauseBtn = document.createElement('button');
  g.pauseBtn = pauseBtn;
  pauseBtn.type = 'button';
  pauseBtn.className = 'anr-game-btn';
  pauseBtn.textContent = '❚❚';
  pauseBtn.title = 'Pause (P)';
  pauseBtn.setAttribute('aria-label', 'Pause');
  pauseBtn.style.cssText = 'position:absolute; top:14px; left:14px; z-index:2; width:36px; height:36px; font-size:13px; display:none;';
  pauseBtn.addEventListener('click', () => { if (g.splash || g.gameOver) return; if (g.menuOpen) closePause(); else openPause(); });
  overlay.appendChild(pauseBtn);

  document.body.appendChild(overlay);

  // Go fullscreen straight away so the game owns the whole screen. The async dynamic import
  // may have spent the user gesture, so the request can be rejected; retry on first tap/key.
  let fsDone = false;
  function tryFullscreen() {
    if (fsDone) return;
    if (document.fullscreenElement) { fsDone = true; return; }
    const req = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
    if (!req) { fsDone = true; return; }   // unsupported (e.g. iOS Safari) - drop it quietly
    try {
      const p = req.call(overlay);
      if (p && p.then) p.then(() => { fsDone = true; }).catch(() => {});
      else fsDone = true;
    } catch (_) {}
  }
  g.tryFullscreen = tryFullscreen;
  g.teardown = teardown;
  tryFullscreen();
  overlay.addEventListener('pointerdown', tryFullscreen);   // first touch retries if needed

  g.ctx = canvas.getContext('2d');
  layout();
  loadLeaderboard();   // fetch the top 5 for the left-margin board (fire and forget)

  // ---- Sandbox (test mode) ----
  // A panel to spawn anything in the game and toggle invulnerability, with scoring frozen
  // while it's on. The SB button shows automatically on dev hosts; everywhere else it stays
  // hidden until the in-game Konami code reveals it (g.revealSandbox).
  buildSandbox();
  buildStartToggle();

  // ---- Input ----
  const keyHandlers = installInput();

  function onResize() { layout(); }
  window.addEventListener('resize', onResize);
  // Entering/leaving fullscreen and the mobile address bar showing/hiding both change the
  // usable size without a window 'resize'; re-layout on those too.
  document.addEventListener('fullscreenchange', onResize);
  document.addEventListener('webkitfullscreenchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  function onVis() { paused = document.hidden; if (!paused) last = performance.now(); }
  document.addEventListener('visibilitychange', onVis);

  // Open on the splash screen now that every control exists (so it can hide them and the
  // pause button until the player presses Play).
  showSplash();

  // ---- Loop ----
  let raf = 0, last = performance.now(), paused = false;
  function frame(t) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    if (paused) { last = t; return; }
    let dt = (t - last) / 1000; last = t;
    if (dt > 0.05) dt = 0.05;
    if (dt > 0) g.fps = g.fps ? g.fps * 0.92 + (1 / dt) * 0.08 : 1 / dt;   // smoothed, for the FPS readout
    if (g.settings.bgDetail) updateFlyers(dt);   // ambient background - keeps drifting even on game over
    else if (g.flyers.length) g.flyers.length = 0; // detail off: drop any squadrons mid-flight
    updateWreck(dt);                // nuke wreck - drifts on past the cinematic, then fades
    if (g.splash) driftAsteroids(dt); // splash decor drifts; no real play yet
    else if (g.menuOpen) { /* paused: freeze the sim, render the held frame */ }
    else if (!g.gameOver) update(dt);
    else driftAsteroids(dt);        // keep the field drifting under the game-over screen
    render();
  }
  raf = requestAnimationFrame(frame);

  // ---- Sandbox builder ----
  function buildSandbox() {
    const { BORDER, ON_DARK, MUTED, SURFACE } = g;
    const sbSpawnPowerup = (type) => {
      let x, y, tries = 0;
      do { x = g.cx + rand(-g.HW, g.HW) * 0.8; y = g.cy + rand(-g.HH, g.HH) * 0.8; }
      while (Math.hypot(x - g.ship.x, y - g.ship.y) < 80 * g.S && ++tries < 20);
      g.powerups.push(makePowerup(x, y, type));
    };
    const sbSpawnAsteroid = () => {
      const size = 1 + ((Math.random() * 3) | 0);   // 1..3
      const label = size === 3 ? pick(ARCHIVE_POOL) : pick(FILE_POOL);
      let x, y, tries = 0;
      do { x = g.cx + rand(-g.HW, g.HW) * 0.9; y = g.cy + rand(-g.HH, g.HH) * 0.9; }
      while (Math.hypot(x - g.ship.x, y - g.ship.y) < 120 * g.S && ++tries < 20);
      const a = makeAsteroid(x, y, size, label);
      a.grace = WAVE_GRACE; a.solo = true;   // solo: keep the spawn-grace but don't flash the wave number
      g.asteroids.push(a);
    };

    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute; top:60px; right:16px; z-index:3; width:188px; display:none; ' +
      'flex-direction:column; gap:7px; padding:12px; background:rgba(10,10,10,0.92); border:1px solid ' + BORDER +
      '; font-family:' + MONO + '; color:' + ON_DARK + '; max-height:calc(100vh - 84px); overflow:auto;';
    const head = (t) => {
      const h = document.createElement('div');
      h.textContent = t;
      h.style.cssText = 'font-size:10px; letter-spacing:.18em; color:' + MUTED + '; margin-top:4px;';
      return h;
    };
    const mkBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'anr-game-btn';
      b.textContent = label;
      b.style.cssText = 'padding:6px 4px; font-size:11px;';
      b.addEventListener('click', (e) => { e.preventDefault(); onClick(b); b.blur(); });
      return b;
    };
    const gridOf = (btns) => {
      const grd = document.createElement('div');
      grd.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:6px;';
      btns.forEach((b) => grd.appendChild(b));
      return grd;
    };

    const invBtn = mkBtn('INVULN: OFF', () => {
      g.cheatInvuln = !g.cheatInvuln;
      invBtn.textContent = 'INVULN: ' + (g.cheatInvuln ? 'ON' : 'OFF');
      invBtn.classList.toggle('on', g.cheatInvuln);
    });
    invBtn.style.cssText = 'padding:8px 4px; font-size:11px;';

    const infBtn = mkBtn('INFINITE: OFF', () => {
      g.sbInfinite = !g.sbInfinite;
      infBtn.textContent = 'INFINITE: ' + (g.sbInfinite ? 'ON' : 'OFF');
      infBtn.classList.toggle('on', g.sbInfinite);
    });
    const instBtn = mkBtn('INSTANT: OFF', () => {
      g.sbInstant = !g.sbInstant;
      instBtn.textContent = 'INSTANT: ' + (g.sbInstant ? 'ON' : 'OFF');
      instBtn.classList.toggle('on', g.sbInstant);
    });

    // Header row: title + a close button that just hides the panel (sandbox stays ON).
    const panelHead = document.createElement('div');
    panelHead.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';
    const panelTitle = document.createElement('div');
    panelTitle.textContent = 'SANDBOX';
    panelTitle.style.cssText = 'font-size:10px; letter-spacing:.18em; color:' + MUTED + ';';
    const panelClose = document.createElement('button');
    panelClose.type = 'button'; panelClose.className = 'anr-game-btn'; panelClose.textContent = '✕';
    panelClose.setAttribute('aria-label', 'Close sandbox menu (stay in sandbox)');
    panelClose.style.cssText = 'width:26px; height:26px; font-size:12px; flex:none;';
    panelClose.addEventListener('click', (e) => { e.preventDefault(); panel.style.display = 'none'; });
    panelHead.appendChild(panelTitle); panelHead.appendChild(panelClose);
    panel.appendChild(panelHead);
    panel.appendChild(invBtn);
    panel.appendChild(head('POWER-UPS'));
    panel.appendChild(gridOf([infBtn, instBtn]));
    panel.appendChild(gridOf(POWERUP_TYPES.map((t) =>
      mkBtn(POWERUP_DEF[t].label, () => { if (g.sbInstant) applyPowerup(t); else sbSpawnPowerup(t); }))));
    // Wingmen: one button per weapon, spawning a drone with exactly that loadout.
    panel.appendChild(head('WINGMEN'));
    panel.appendChild(gridOf([
      mkBtn('Normal', () => addDrone('normal')),
      mkBtn('Machine', () => addDrone('machine')),
      mkBtn('Sniper', () => addDrone('sniper')),
      mkBtn('Triple', () => addDrone('triple')),
      mkBtn('Homing', () => addDrone('homing')),
      mkBtn('Kill all', () => { g.drones.length = 0; })
    ]));
    panel.appendChild(head('ENEMIES'));
    panel.appendChild(gridOf([
      mkBtn('Reward UFO', () => g.ufos.push(makeUfo('reward'))),
      mkBtn('Ambient UFO', () => g.ufos.push(makeUfo('ambient')))
    ]));
    panel.appendChild(head('BOSSES'));
    panel.appendChild(gridOf([
      mkBtn('Mothership', () => { g.boss = null; spawnBoss('mothership'); }),
      mkBtn('Mega', () => { g.boss = null; spawnBoss('megastructure'); }),
      mkBtn('Serpent', () => { g.boss = null; spawnBoss('segmented'); })
    ]));
    panel.appendChild(head('FIELD'));
    // Asteroid: tap spawns one; keep holding and after 1s it streams at 35/sec until released.
    const astStop = () => { if (g.sbAsteroidHold) { clearTimeout(g.sbAsteroidHold); clearInterval(g.sbAsteroidHold); g.sbAsteroidHold = null; } };
    const astBtn = mkBtn('Asteroid', () => {});   // spawning is driven by the hold handlers below
    astBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); astStop(); sbSpawnAsteroid();
      g.sbAsteroidHold = setTimeout(() => { g.sbAsteroidHold = setInterval(sbSpawnAsteroid, 1000 / 35); }, 1000);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => astBtn.addEventListener(ev, astStop));
    panel.appendChild(gridOf([
      astBtn,
      mkBtn('Clear', () => { astStop(); g.asteroids.length = 0; g.bullets.length = 0; g.ufos.length = 0; g.powerups.length = 0; g.particles.length = 0; g.lasers.length = 0; g.missiles.length = 0; g.boss = null; })
    ]));

    panel.appendChild(head('WAVE'));
    const waveInput = document.createElement('input');
    waveInput.type = 'number'; waveInput.min = '1'; waveInput.value = '5';
    waveInput.setAttribute('aria-label', 'Wave number');
    waveInput.style.cssText = 'width:100%; padding:6px 8px; font-family:' + MONO + '; font-size:12px; box-sizing:border-box; ' +
      'background:' + SURFACE + '; color:' + ON_DARK + '; border:1px solid ' + BORDER + '; border-radius:0; outline:none;';
    panel.appendChild(waveInput);
    panel.appendChild(mkBtn('Go to wave', () => {
      const n = Math.max(1, parseInt(waveInput.value, 10) || 1);
      g.asteroids.length = 0; g.bullets.length = 0; g.ufos.length = 0; g.powerups.length = 0; g.particles.length = 0; g.lasers.length = 0; g.missiles.length = 0; g.boss = null;
      g.wave = n - 1; spawnWave();   // spawnWave bumps to n and spawns that wave's content
    }));
    overlay.appendChild(panel);

    const sbToggle = document.createElement('button');
    sbToggle.type = 'button'; sbToggle.className = 'anr-game-btn';
    sbToggle.textContent = 'SB'; sbToggle.title = 'Sandbox mode';
    sbToggle.setAttribute('aria-label', 'Toggle sandbox mode');
    sbToggle.style.cssText = 'position:absolute; top:14px; right:104px; z-index:2; height:36px; padding:0 11px; font-size:13px;' +
      (isDev ? '' : ' display:none;');   // hidden off-dev until the Konami code reveals it
    sbToggle.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      if (!g.sandbox) {
        g.sandbox = true; g.sandboxUsed = true;
        sbToggle.classList.add('on'); panel.style.display = 'flex';
      } else if (!open) {
        panel.style.display = 'flex';   // reopen without changing sandbox state
      } else {
        g.sandbox = false; sbToggle.classList.remove('on'); panel.style.display = 'none';
        restart();   // leaving sandbox starts a clean, scored game
      }
    });
    overlay.appendChild(sbToggle);

    // The in-game Konami code unlocks the sandbox: reveal the SB button and switch it on.
    g.revealSandbox = () => {
      sbToggle.style.display = '';
      if (!g.sandbox) sbToggle.click();
    };
  }

  // ---- Start-wave toggle (unlock-gated) ----
  // Once any boss has been beaten, a small remembered toggle to begin runs at wave 10
  // instead of 1. Hidden until unlocked; applies next run.
  function buildStartToggle() {
    const startToggleBtn = document.createElement('button');
    g.startToggleBtn = startToggleBtn;
    startToggleBtn.type = 'button'; startToggleBtn.className = 'anr-game-btn';
    startToggleBtn.title = 'Start wave (applies on your next run)';
    startToggleBtn.style.cssText = 'position:absolute; top:56px; left:14px; z-index:2; height:30px; padding:0 10px; font-size:11px;' +
      (g.bossEverBeaten ? '' : ' display:none;');   // below the pause button (top-left)
    const syncStartBtn = () => { startToggleBtn.textContent = 'START W' + g.startWavePref; startToggleBtn.classList.toggle('on', g.startWavePref === 10); };
    syncStartBtn();
    startToggleBtn.addEventListener('click', () => {
      g.startWavePref = g.startWavePref === 10 ? 1 : 10;
      try { localStorage.setItem(STARTWAVE_KEY, String(g.startWavePref)); } catch (_) {}
      syncStartBtn();
    });
    overlay.appendChild(startToggleBtn);
  }

  // ---- Teardown ----
  function teardown() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    if (keyHandlers) {
      window.removeEventListener('keydown', keyHandlers.onKeyDown, true);
      window.removeEventListener('keyup', keyHandlers.onKeyUp, true);
    }
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onResize);
    document.removeEventListener('webkitfullscreenchange', onResize);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVis);
    if (g.sbAsteroidHold) { clearTimeout(g.sbAsteroidHold); clearInterval(g.sbAsteroidHold); g.sbAsteroidHold = null; }
    // Drop out of fullscreen if we put ourselves there.
    try {
      if (document.fullscreenElement) { const r = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (r && r.catch) r.catch(() => {}); }
    } catch (_) {}
    clearEndPanel();
    overlay.remove();
    document.body.style.overflow = g.prevOverflow;
  }
}
