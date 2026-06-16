/* Analyser - Asteroids easter egg: input.
   Keyboard handlers (with the splash / pause / name-entry routing), the Konami + touch
   cheat-code trackers that reveal the sandbox, and the on-screen analogue joystick / fire
   button / rotate arrows. installInput() wires the window key listeners and the controls,
   returning the two key handlers so teardown can remove them. The orchestrator owns the
   fullscreen + sandbox callbacks (g.tryFullscreen, g.revealSandbox, g.teardown). */

import { KEY, KONAMI, TOUCH_COMBO } from './config.js';
import { g } from './state.js';
import { restart } from './world.js';
import { openPause, closePause, startGame } from './menus.js';

// Konami code entered while playing reveals + activates the sandbox.
function trackKonami(key) {
  const k = (key || '').toLowerCase();
  g.konamiPos = (k === KONAMI[g.konamiPos]) ? g.konamiPos + 1 : (k === KONAMI[0] ? 1 : 0);
  if (g.konamiPos === KONAMI.length) { g.konamiPos = 0; if (g.revealSandbox) g.revealSandbox(); }
}
// The touch combo (left,left,right,right,left,right,left,right,fire,fire) is the mobile equivalent.
function trackTouchCombo(tok) {
  g.comboPos = (tok === TOUCH_COMBO[g.comboPos]) ? g.comboPos + 1 : (tok === TOUCH_COMBO[0] ? 1 : 0);
  if (g.comboPos === TOUCH_COMBO.length) { g.comboPos = 0; if (g.revealSandbox) g.revealSandbox(); }
}

function onKeyDown(e) {
  const k = e.key;
  g.tryFullscreen();
  if (!e.repeat) trackKonami(k);
  if (k === 'Escape') { g.teardown(); return; }
  // Splash screen: Enter / Space (or any movement/fire key) drops straight into a run.
  if (g.splash) {
    if (k === 'Enter' || k === ' ' || KEY[k] || k === 'p' || k === 'P') { e.preventDefault(); startGame(); }
    return;
  }
  // Pause overlay owns the keyboard: P / Esc out, R restarts, everything else ignored.
  if (g.menuOpen) {
    if (k === 'p' || k === 'P') { e.preventDefault(); closePause(); }
    else if (k === 'r' || k === 'R') { e.preventDefault(); restart(); }
    return;
  }
  // While the name input owns the keyboard, let every other key reach it.
  if (g.nameEntry) return;
  if (k === 'r' || k === 'R') { e.preventDefault(); restart(); return; }   // restart the run anytime
  if (k === 'p' || k === 'P') { e.preventDefault(); openPause(); return; }  // pause anytime mid-run
  if (g.gameOver && (k === ' ' || k === 'Enter')) { e.preventDefault(); restart(); return; }
  const m = KEY[k];
  if (m === 'left') g.input.left = true;
  else if (m === 'right') g.input.right = true;
  else if (m === 'up') g.input.thrust = true;
  else if (k === ' ') g.input.fire = true;
  else return;
  e.preventDefault();
}
function onKeyUp(e) {
  const m = KEY[e.key];
  if (m === 'left') g.input.left = false;
  else if (m === 'right') g.input.right = false;
  else if (m === 'up') g.input.thrust = false;
  else if (e.key === ' ') g.input.fire = false;
}

// The analogue joystick works everywhere (mouse on desktop, touch on mobile): the ship
// turns toward where the stick points (capped to the keyboard rotate rate) and pushing
// past a deadzone thrusts. The fire button and rotate arrows are touch-only.
function buildControls() {
  const { overlay, input, joy, mobileControls } = g;
  const BORDER = g.BORDER, SURFACE = g.SURFACE;
  const coarseInput = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const JOY_R = 46;        // base radius (px); thumb travel clamped to this
  const DEADZONE = 0.28;   // fraction of full travel before thrust kicks in

  const base = document.createElement('div');
  base.style.cssText = 'position:absolute; bottom:' + (coarseInput ? 100 : 26) + 'px; left:24px; width:' + (JOY_R * 2) +
    'px; height:' + (JOY_R * 2) + 'px; border-radius:50%; border:1px solid ' + BORDER +
    '; background:rgba(26,26,26,0.55); z-index:2; touch-action:none;';
  const thumb = document.createElement('div');
  thumb.style.cssText = 'position:absolute; left:50%; top:50%; width:42px; height:42px; margin:-21px 0 0 -21px;' +
    'border-radius:50%; background:' + SURFACE + '; border:1px solid ' + BORDER + '; pointer-events:none;' +
    'transition:transform .05s linear;';
  base.appendChild(thumb);
  overlay.appendChild(base);
  mobileControls.push(base);

  let joyId = null;
  const setThumb = (dx, dy) => { thumb.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; };
  const onMove = (e) => {
    const r = base.getBoundingClientRect();
    const dx = e.clientX - (r.left + JOY_R), dy = e.clientY - (r.top + JOY_R);
    const ang = Math.atan2(dy, dx), cl = Math.min(Math.hypot(dx, dy), JOY_R);
    setThumb(Math.cos(ang) * cl, Math.sin(ang) * cl);
    joy.active = true; joy.angle = ang; joy.mag = cl / JOY_R;
    input.thrust = joy.mag > DEADZONE;
  };
  const onUp = () => { joyId = null; joy.active = false; joy.mag = 0; input.thrust = false; setThumb(0, 0); };
  base.addEventListener('pointerdown', (e) => { e.preventDefault(); joyId = e.pointerId; try { base.setPointerCapture(e.pointerId); } catch (_) {} onMove(e); });
  base.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) { e.preventDefault(); onMove(e); } });
  base.addEventListener('pointerup', (e) => { if (e.pointerId === joyId) { e.preventDefault(); onUp(); } });
  base.addEventListener('pointercancel', onUp);

  if (coarseInput) {
    const fire = document.createElement('button');
    fire.type = 'button'; fire.className = 'anr-game-btn'; fire.textContent = '●';
    fire.style.cssText = 'position:absolute; bottom:26px; right:24px; width:64px; height:64px; font-size:21px; z-index:2; touch-action:none;';
    const setFire = (v) => (e) => { e.preventDefault(); if (v) trackTouchCombo('fire'); if (g.gameOver && !g.nameEntry && v) { restart(); return; } input.fire = v; };
    fire.addEventListener('pointerdown', setFire(true));
    fire.addEventListener('pointerup', setFire(false));
    fire.addEventListener('pointercancel', setFire(false));
    fire.addEventListener('pointerleave', setFire(false));
    overlay.appendChild(fire);
    mobileControls.push(fire);

    // Left/right rotate arrows under the joystick - fine aiming when the stick is idle.
    const arrows = document.createElement('div');
    arrows.style.cssText = 'position:absolute; bottom:26px; left:24px; width:' + (JOY_R * 2) + 'px; display:flex; gap:6px; z-index:2;';
    const mkArrow = (label, prop) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'anr-game-btn'; b.textContent = label;
      b.style.cssText = 'flex:1; height:42px; font-size:18px; touch-action:none;';
      const set = (v) => (e) => { e.preventDefault(); if (v) trackTouchCombo(prop); input[prop] = v; };
      b.addEventListener('pointerdown', set(true));
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('pointerleave', set(false));
      arrows.appendChild(b);
    };
    mkArrow('◀', 'left'); mkArrow('▶', 'right');
    overlay.appendChild(arrows);
    mobileControls.push(arrows);
  }
}

// Wire the window key listeners + build the on-screen controls. Returns the key handlers
// so teardown can remove them.
export function installInput() {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  buildControls();
  return { onKeyDown, onKeyUp };
}
