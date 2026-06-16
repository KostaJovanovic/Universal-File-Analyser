/* Analyser - Asteroids easter egg: the shared mutable game state.
   The game is a hard singleton (the `active` guard in asteroids.js), so every
   module references this one object `g` rather than threading a context argument
   through hundreds of call sites. The orchestrator calls initState() at launch to
   (re)populate the per-run fields, then assigns the DOM refs / theme tokens /
   geometry it owns (g.ctx, g.overlay, g.ACCENT, g.cx, ...). Cross-cutting callbacks
   that live in the orchestrator (restart, teardown, layout) are also hung on `g`
   so leaf modules can call them without importing the orchestrator.

   Convention: entity arrays (asteroids, bullets, ...) are NEVER reassigned - they
   are cleared in place with `.length = 0` - so a captured reference stays valid and
   the hot loops can destructure them. Scalars that a function reassigns are always
   read/written through `g.`. */

import { SETTINGS_KEY, HI_KEY, BOSS_UNLOCK_KEY, STARTWAVE_KEY, BESTWAVE_KEY } from './config.js';

export const g = {};

// Sandbox invulnerability: spares the ship (and its drones) from every damage source.
export const immortal = () => g.sandbox && g.cheatInvuln;

// ---- persistent settings (Settings menu) ----
export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(g.settings)); } catch (_) {}
}
export function saveHi() {
  try { localStorage.setItem(HI_KEY, String(g.highScore)); } catch (_) {}
}
export function saveBestWave() {
  try { localStorage.setItem(BESTWAVE_KEY, String(g.bestWave)); } catch (_) {}
}

// Highest wave you may start a run on: half your best-ever wave (floored), at least 1.
export const maxStartWave = () => Math.max(1, (g.bestWave || 0) - 2);

// Populate every per-run field with its launch default and load persisted values.
// DOM refs, theme tokens and geometry (g.cx/HW/S/ctx/...) are assigned by the
// orchestrator after this runs.
export function initState() {
  // Persistent player settings; saved overrides merged in. Read live each frame.
  g.settings = { reduceFlash: false, bgDetail: true, showFps: true, hideAsteroidText: false, renderScale: 1 };
  try { Object.assign(g.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (_) {}

  // Persistent high score (survives the footer "Clear storage", which preserves this key).
  g.highScore = 0;
  try { g.highScore = parseInt(localStorage.getItem(HI_KEY) || '0', 10) || 0; } catch (_) {}
  g.newHigh = false;

  // Persistent boss-beaten unlock + remembered start-wave preference (1..maxStartWave).
  g.bossEverBeaten = false; g.startWavePref = 1; g.bestWave = 0;
  try { g.bossEverBeaten = localStorage.getItem(BOSS_UNLOCK_KEY) === '1'; } catch (_) {}
  try { g.bestWave = parseInt(localStorage.getItem(BESTWAVE_KEY) || '0', 10) || 0; } catch (_) {}
  try { g.startWavePref = Math.max(1, parseInt(localStorage.getItem(STARTWAVE_KEY) || '1', 10) || 1); } catch (_) {}

  // Entity collections (never reassigned - cleared with .length = 0).
  g.asteroids = []; g.bullets = []; g.particles = []; g.powerups = []; g.lasers = [];
  g.ufos = []; g.missiles = []; g.drones = []; g.ripples = []; g.flyers = [];
  g.stars = []; g.bossBag = []; g.leaderboard = []; g.mobileControls = [];
  g.boss = null; g.wreck = null;

  // Dynamic power-up rarity (heat per type, decays over time).
  g.dropHeat = {};

  // Run state.
  g.wave = 0; g.score = 0; g.lives = 3; g.gameOver = false; g.cause = null;
  g.weapon = 'normal'; g.weaponTimer = 0; g.lightningTarget = null; g.shield = 0;

  // Mega core endgame flags.
  g.gunsOff = false; g.megaMsgT = 0; g.puSpawnOff = false; g.hideShip = false;
  g.ramHitCd = 0;
  // Battering-ram dash: tapping fire lunges the ship forward + brief invuln, on a 1s cooldown.
  g.ramDashCd = 0; g.firePrev = false;

  // Homing burst bookkeeping.
  g.homingLeft = 0; g.homingIdx = 0; g.homingBase = 0; g.homingGap = 0; g.homingTrickle = 0;

  // Lightning / ultrasound transient state.
  g.lightningMid = null; g.lightningMidTimer = 0; g.lightningEnd = null; g.lightningAirAngle = null;
  g.rippleTimer = 0;

  // Nuke cinematic.
  g.nuke = 0; g.nukeTint = '';

  // Ship + input.
  g.ship = { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, invuln: 0, dead: false };
  g.fireCd = 0; g.deathTimer = 0; g.clock = 0;
  g.input = { left: false, right: false, thrust: false, fire: false };
  g.joy = { active: false, angle: 0, mag: 0 };

  // Background flyer cadence.
  g.flyerTimer = 1.5 + Math.random() * 2.5;

  // End panel / menu flow.
  g.scoreDone = false; g.endPanel = null; g.nameEntry = false;
  g.splash = true; g.menuOpen = false; g.menuPanel = null; g.menuDim = null;

  // Sandbox (dev test mode).
  g.sandbox = false; g.cheatInvuln = false; g.sandboxUsed = false;
  g.sbInfinite = false; g.sbInstant = false; g.sbAsteroidHold = null;

  // Loop bookkeeping.
  g.fps = 0;

  // Input combo trackers.
  g.konamiPos = 0; g.comboPos = 0;
}

// Weapon ranges / sizes scale with the field, so they read the LIVE scale g.S, not a
// value baked at launch - otherwise they go wrong the instant the field resizes.
export const lightningRange = () => 0.7 * 540 * 0.9 * g.S;   // 70% of a normal bullet's reach
export const laserWidth = () => 34 * g.S;                    // full beam width; the hitbox matches it
export const ultrasoundRadius = () => 0.25 * 540 * 0.9 * 1.1 * g.S;   // a quarter of a normal bullet's reach, +10%
