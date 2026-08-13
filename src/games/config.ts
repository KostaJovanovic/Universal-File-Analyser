/* Analyser - Asteroids easter egg: stateless constants and catalogue.
   Pure data only (no game state, no DOM): gameplay tuning numbers, the file-type
   asteroid pools, the power-up catalogue, literal colours, and the input maps.
   Everything here is shared verbatim across the game modules - the live mutable
   state lives in state.js (`g`). */

import { PHOTO_EXTS, AUDIO_EXTS, VIDEO_EXTS, CSV_EXTS, SVG_EXTS, DOC_EXTS, ARCHIVE_EXTS } from '../core/formats.js';

export const TAU = Math.PI * 2;
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0];

// Big asteroids = things that contain other files. ARCHIVE_EXTS plus the
// zip-based document/container formats, which fits the "shatters into its
// contents" conceit nicely.
export const ARCHIVE_POOL = [...new Set([
  ...ARCHIVE_EXTS,
  '3mf', 'pptx', 'docx', 'xlsx', 'epub', 'cbz', 'cbr', 'jar', 'apk',
  'odt', 'ods', 'odp', 'vsix', 'nupkg', 'crx', 'iso'
])].map((s) => '.' + s);

// Smaller asteroids = the contained files: any supported leaf format that isn't
// itself an archive.
export const FILE_POOL = [...new Set([
  ...PHOTO_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS, ...CSV_EXTS, ...SVG_EXTS, ...DOC_EXTS
])].filter((e) => !ARCHIVE_EXTS.has(e) && !/^(zip|tgz|gz|tar|rar|7z|xz|bz2|zst)$/.test(e))
  .map((s) => '.' + s);

// ---- Literal colours / fonts (the runtime theme tokens pulled from CSS live on `g`) ----
export const LINE = '#f2f2f2';   // vector stroke - a touch softer than pure white
export const UFO_REWARD_COLOR = '#ff4dd2';    // magenta - the destructible reward saucer
export const UFO_AMBIENT_COLOR = '#56d4dd';   // teal - the indestructible roaming escort
export const BOSS_COLOR = '#a64dff';          // corrupted violet - boss vectors, distinct from all else
export const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

// ---- Gameplay tuning ----
export const SPAWN_INVULN = 3;     // seconds of immunity after a (re)spawn
export const WAVE_GRACE = 3;       // seconds a fresh wave's asteroids have no hitbox
export const MAX_LIVES = 3;
export const MAX_BULLETS = 20;
export const POWERUP_LIFE = 14;    // seconds a dropped power-up lingers before expiring
export const MAX_POWERUPS = 5;     // never spawn a new power-up while this many are on screen
export const LIGHTNING_HALF = 17.5 * Math.PI / 180;   // half of the 35° auto-aim cone
export const SHIELD_DUR = 7;       // health pickup at full HP grants a 7s shield instead
export const ULTRASOUND_TICK = 0.35;                 // AoE damage / ripple cadence
export const RIPPLE_DUR = 1.4;                        // seconds a ripple takes to reach the rim
// Nuclear bomb cinematic phases: instant full-white, hold, fade, then a beat of
// empty scope before the player respawns into the next wave.
export const NUKE_WHITE = 3;                          // full-white hold
export const NUKE_FADE = 3;                           // white fades back to normal over this
export const NUKE_GAP = 1;                            // empty-scope beat before respawn
export const NUKE_TOTAL = NUKE_WHITE + NUKE_FADE + NUKE_GAP;
export const WRECK_FADE = 3;                          // wreck fade duration, once it begins (on respawn)

/** One entry in the power-up catalogue below. `dur` is absent on the instants
 *  (health, singularity, nuke), which fire once on pickup rather than running a
 *  timer - so it is optional here and the timed weapons assert it. */
export interface PowerupDef { color: string; letter: string; label: string; dur?: number }

// Power-up catalogue. Each is colour-coded; picked up by flying over it. Weapon
// power-ups are timed and mutually exclusive (a new one replaces the current);
// health is instant. Letters keep them readable at small size.
// Typed as a keyed record (not the literal) because the drop picker, the sandbox
// panel and the HUD all look entries up by a runtime string.
export const POWERUP_DEF: Record<string, PowerupDef> = {
  health: { color: '#3fb950', letter: '+', label: 'HEALTH' },
  machine: { color: '#e3b341', letter: 'M', label: 'MACHINE GUN', dur: 10 },
  triple: { color: '#ff7b72', letter: 'T', label: 'TRIPLE SHOT', dur: 12 },
  sniper: { color: '#bc8cff', letter: 'S', label: 'SNIPER', dur: 12 },
  laser: { color: '#58a6ff', letter: 'L', label: 'LASER', dur: 10 },
  lightning: { color: '#3b5bdb', letter: 'Z', label: 'LIGHTNING', dur: 10 },
  ultrasound: { color: '#7fd3ff', letter: 'U', label: 'SHOCKWAVE', dur: 8 },
  // Battering ram: no projectile - lifts the speed cap, draws an arrow tip, and turns
  // head-on collisions into damage against asteroids/UFOs while the ship rides through
  // unharmed.
  ram: { color: '#ff7a1a', letter: 'R', label: 'BATTERING RAM', dur: 10 },
  // Homing missiles: a timed weapon firing bursts of slow rockets that radiate out
  // all around the ship, then curve into the nearest asteroid / reward UFO.
  homing: { color: '#2ee6a6', letter: 'H', label: 'HOMING MISSILES', dur: 12 },
  // Drone wingman: an additive companion (does NOT take the weapon slot) that trails in
  // formation, mirrors your gun at the nearest threat, smashes what it touches, and can
  // be destroyed.
  drone: { color: '#ffd166', letter: 'D', label: 'DRONE WINGMAN', dur: 20 },
  // Time Warp: a buff (not the weapon slot) that freezes every asteroid, UFO and boss in
  // place while the ship, its shots and its drones keep moving - full bullet-time stasis.
  timewarp: { color: '#c9d1ff', letter: 'W', label: 'TIME WARP', dur: 6 },
  // Singularity: instant. Drops a drifting black hole that drags asteroids and reward UFOs
  // into its core and crushes them (and chips a boss); tugs the ship but never harms it.
  singularity: { color: '#8957e5', letter: '◉', label: 'SINGULARITY' },
  // Nuclear bomb: instant, double-edged. Wipes the board and advances a wave but
  // costs a life. No `dur` - it fires once on pickup (see applyPowerup/triggerNuke).
  nuke: { color: '#ffd60a', letter: '☢', label: 'NUCLEAR' }
};
// Time Warp freezes enemies/asteroids to this fraction of real time while it is up (0 = full stop).
export const TIMEWARP_SCALE = 0;
// Singularity black-hole tuning (radii/speeds are raw units, scaled by g.S at use).
export const SING_DUR = 10;        // black-hole lifetime
export const SING_DRIFT = 16;      // how fast the hole wanders across the field
export const SING_REACH = 300;     // pull influence radius
export const SING_PULL = 430;      // inward pull at the rim, ramping up toward the core
export const SING_CORE = 24;       // anything reaching this radius is crushed
export const SING_SHIP_PULL = 150; // gentle tug on the ship in range (never crushes it)
export const SING_BOSS_DPS = 5;    // chip rate on boss nodes in range (floored at 1 hp, like the nuke)
export const POWERUP_TYPES = Object.keys(POWERUP_DEF);

// ---- Drone wingmen ----
export const DRONE_MAX = 4;
// Formation slots in the ship frame (raw units, scaled by S at use): two close behind,
// two further out, so a full stack of four fans out around the tail.
export const DRONE_SLOTS = [[-26, 16], [-26, -16], [-46, 30], [-46, -30]];
// Each wingman rolls one of these on pickup and keeps it for its lifetime.
export const DRONE_WEAPONS = ['normal', 'machine', 'sniper', 'triple', 'homing'];

// ---- Roaming UFOs ----
export const UFO_PATTERNS = ['circle', 'triangle', 'square', 'figure8'];

// ---- Input maps + cheat codes ----
// Directional map: each key names the direction it steers (default "steer & glide"
// controls). Legacy controls reinterpret these in update.js - left/right rotate, up
// thrusts, down unused - but the key->direction mapping is the same either way.
export const KEY: Record<string, string> = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down'
};
export const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
export const TOUCH_COMBO = ['left', 'left', 'right', 'right', 'left', 'right', 'left', 'right', 'fire', 'fire'];

// ---- localStorage keys ----
export const SETTINGS_KEY = 'anr-asteroids-settings';
export const HI_KEY = 'anr-asteroids-hi';
export const BOSS_UNLOCK_KEY = 'anr-asteroids-bossbeat';
export const STARTWAVE_KEY = 'anr-asteroids-startwave';
export const BESTWAVE_KEY = 'anr-asteroids-bestwave';   // highest wave ever reached; caps the start-wave picker
export const LAYOUT_HINT_KEY = 'anr-asteroids-layouthint';   // dismissed the "your keyboard can't type WASD - use arrows" nudge
// Leaderboard local memory is kept under non-anr keys so app.js's anrSweep
// (which refreshes anr-* timestamps and would defeat a TTL) doesn't touch them.
export const NAME_KEY = 'asteroids-name';
export const SUBMIT_KEY = 'asteroids-submits';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_MS = 60 * 1000;   // minimum gap between submissions: one per minute
export const MAX_PER_DAY = 15;     // submissions allowed per device per day
