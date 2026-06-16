/* Analyser - Asteroids easter egg: world lifecycle + spawning.
   The central sim helpers shared across the gameplay modules: building asteroids and
   power-ups, applying pickups, the nuke, the per-wave roster, destroying an asteroid,
   losing a life, and the decorative flyers / nuke wreck drift. Pure functions over the
   shared state `g`. */

import {
  TAU, rand, pick, ARCHIVE_POOL, FILE_POOL, LINE, MONO, POWERUP_DEF, POWERUP_TYPES,
  WAVE_GRACE, MAX_POWERUPS, MAX_LIVES, SHIELD_DUR, POWERUP_LIFE, NUKE_TOTAL,
  SPAWN_INVULN, WRECK_FADE
} from './config.js';
import { g, immortal, saveHi } from './state.js';
import { fitFont, wrap } from './geometry.js';
import { isBossWave, spawnBoss, bossNodeVulnerable } from './boss.js';
import { makeUfo, dismissAmbientUfos, updateUfos } from './ufos.js';
import { addDrone } from './drones.js';
import { clearEndPanel } from './leaderboard.js';
import { clearMenus } from './menus.js';

export function makeAsteroid(x, y, size, label) {
  const S = g.S;
  const radius = (size === 3 ? 46 : size === 2 ? 30 : 19) * S;
  const n = 7 + size * 2 + ((Math.random() * 3) | 0);
  const verts = [];
  for (let i = 0; i < n; i++) verts.push({ a: (i / n) * TAU, r: rand(0.72, 1.12) });
  const base = size === 3 ? [26, 70] : size === 2 ? [48, 104] : [72, 150];
  const spd = rand(base[0], base[1]) * S;
  const dir = rand(0, TAU);
  const font = fitFont(label, radius);
  return {
    x, y, size, label, radius, verts,
    angleR: rand(0, TAU), spin: rand(-1.3, 1.3),
    vx: Math.cos(dir) * spd, vy: Math.sin(dir) * spd,
    font, fontStr: font + 'px ' + MONO, grace: 0
  };
}

export function spawnWave() {
  dismissAmbientUfos();   // last wave's ambient escort flies off now the board is clear
  g.wave++;
  if (isBossWave(g.wave)) { spawnBoss(); return; }   // boss wave: just the boss; advances when it dies
  const { cx, cy, HW, HH, S, ship, asteroids, powerups, ufos } = g;
  // Per-wave roster grows by one "unit" each wave (a big asteroid is worth 2 units, a
  // medium 1): units = wave + 2, laid out as full bigs plus a single medium on odd totals.
  const units = Math.min(20, g.wave + 2);
  const bigs = Math.floor(units / 2), mediums = units % 2;
  const safe = 150 * S;   // keep a clear ring around the ship so a fresh asteroid never spawns on top
  const spawnAt = (size) => {
    let x, y, tries = 0;
    do {
      x = cx + rand(-HW, HW) * 0.92; y = cy + rand(-HH, HH) * 0.92;
    } while (Math.hypot(x - ship.x, y - ship.y) < safe && ++tries < 30);
    const ast = makeAsteroid(x, y, size, pick(size === 3 ? ARCHIVE_POOL : FILE_POOL));
    ast.grace = WAVE_GRACE;   // no hitbox (stripey border) so a fresh wave can't ambush you
    asteroids.push(ast);
  };
  for (let i = 0; i < bigs; i++) spawnAt(3);
  for (let i = 0; i < mediums; i++) spawnAt(2);
  // One power-up per new wave, away from the ship - but none on the opening wave,
  // and never while the screen is already at the cap.
  if (g.wave > 1 && !g.puSpawnOff && powerups.length < MAX_POWERUPS) {
    let x, y, tries = 0;
    do {
      x = cx + rand(-HW, HW) * 0.85; y = cy + rand(-HH, HH) * 0.85;
    } while (Math.hypot(x - ship.x, y - ship.y) < 120 * S && ++tries < 20);
    powerups.push(makePowerup(x, y));
  }
  // Roaming UFOs, from wave 3.
  if (g.wave >= 3) {
    const ufoCap = Math.min(5, 1 + Math.floor(g.wave / 4));   // on-screen reward saucers, scales with waves
    let rewards = 0;
    if (g.wave === 3) rewards = 1;
    else if (Math.random() < 0.30) {
      rewards = 1;
      while (rewards < ufoCap && Math.random() < Math.min(0.6, g.wave * 0.05)) rewards++;
    }
    for (let k = 0; k < rewards; k++) {
      if (ufos.filter((u) => u.kind === 'reward').length >= ufoCap) break;   // cap on-screen reward saucers
      ufos.push(makeUfo('reward'));
      if (Math.random() < 0.25) ufos.push(makeUfo('ambient'));
    }
  }
}

// Pick a drop type, weighting each by base rarity / current heat, then heat the chosen
// type so it's unlikely to recur soon.
export function choosePowerupType() {
  const weights = POWERUP_TYPES.map((t) => {
    const base = t === 'nuke' ? 1 : 3;
    return Math.max(0.05, base / (1 + (g.dropHeat[t] || 0)));
  });
  let total = 0; for (const w of weights) total += w;
  let r = Math.random() * total, i = 0;
  while (i < weights.length - 1 && r > weights[i]) { r -= weights[i]; i++; }
  const type = POWERUP_TYPES[i];
  g.dropHeat[type] = (g.dropHeat[type] || 0) + 4;   // strong recency penalty on the chosen type
  return type;
}

export function makePowerup(x, y, forcedType) {
  const type = forcedType || choosePowerupType();
  const dir = rand(0, TAU), spd = rand(8, 22) * g.S;
  return {
    x, y, type, color: POWERUP_DEF[type].color, letter: POWERUP_DEF[type].letter,
    radius: 12 * g.S, life: POWERUP_LIFE, vx: Math.cos(dir) * spd, vy: Math.sin(dir) * spd
  };
}

export function applyPowerup(type) {
  if (type === 'health') {
    // Heal, or - if already at full HP - grant a temporary shield instead.
    if (g.lives < MAX_LIVES) g.lives++;
    else g.shield = SHIELD_DUR;
  } else if (type === 'nuke') {
    triggerNuke();
  } else if (type === 'drone') {
    addDrone();   // random weapon; tops up the squad timer and adds one (up to DRONE_MAX)
  } else { g.weapon = type; g.weaponTimer = POWERUP_DEF[type].dur; g.homingLeft = 0; }
}

// Detonate: wipe the board, advance a wave at a cost of one life, start the white flash.
export function triggerNuke() {
  if (!immortal()) g.lives--;   // sandbox invulnerability spares the bomb's life cost
  g.cause = 'nuke';   // if this was the last life, the bomb is the final blow
  g.asteroids.length = 0; g.bullets.length = 0; g.lasers.length = 0; g.ufos.length = 0; g.missiles.length = 0;
  // End any power-up the player was carrying - they come out of the blast clean.
  g.weapon = 'normal'; g.weaponTimer = 0; g.shield = 0; g.homingLeft = 0; g.drones.length = 0;
  g.lightningTarget = null; g.lightningEnd = null; g.lightningMid = null; g.lightningMidTimer = 0;
  g.ripples.length = 0; g.rippleTimer = 0;
  // A nuke chips the boss too, but can't finish it off mid-cinematic (each node floored at 1 hp).
  if (g.boss) for (const n of g.boss.nodes) { if (!n.dead && bossNodeVulnerable(g.boss, n)) n.hp = Math.max(1, n.hp - 4); }
  g.nuke = NUKE_TOTAL;
  g.overlay.style.cursor = 'none';   // hidden for the cinematic, restored on respawn
  // Spawn a wreck where the ship was, on a slow constant drift in a random direction.
  const a = rand(0, TAU), s = rand(22, 40) * g.S;
  g.wreck = {
    x: g.ship.x, y: g.ship.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
    angle: g.ship.angle, spin: (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.7), fade: 0
  };
}

export function resetShip(invuln) {
  const { ship, cx, cy } = g;
  ship.x = cx; ship.y = cy; ship.vx = 0; ship.vy = 0; ship.angle = -Math.PI / 2;
  ship.invuln = invuln; ship.dead = false;
}

export function restart() {
  g.asteroids.length = 0; g.bullets.length = 0; g.particles.length = 0; g.powerups.length = 0;
  g.lasers.length = 0; g.ufos.length = 0; g.missiles.length = 0; g.drones.length = 0;
  g.dropHeat = {}; g.boss = null;
  g.weapon = 'normal'; g.weaponTimer = 0; g.lightningTarget = null; g.shield = 0; g.homingLeft = 0;
  g.gunsOff = false; g.megaMsgT = 0; g.puSpawnOff = false; g.hideShip = false;
  g.lightningMid = null; g.lightningMidTimer = 0; g.ripples.length = 0; g.rippleTimer = 0;
  g.nuke = 0; g.wreck = null; g.overlay.style.cursor = '';
  clearEndPanel(); g.scoreDone = false;
  g.splash = false; g.menuOpen = false; clearMenus();   // leave the splash / pause overlays
  if (g.pauseBtn) { g.pauseBtn.style.display = ''; g.pauseBtn.textContent = '❚❚'; }
  g.mobileControls.forEach((elm) => { elm.style.display = ''; });   // controls back for play
  g.wave = (g.bossEverBeaten && g.startWavePref === 10) ? 9 : 0;   // unlocked Wave 10 start (spawnWave bumps it)
  g.score = 0; g.lives = 3; g.gameOver = false; g.newHigh = false; g.cause = null;
  g.sandboxUsed = g.sandbox;   // a fresh run is leaderboard-ineligible only if still in sandbox
  resetShip(SPAWN_INVULN);
  spawnWave();
}

// A short-lived burst of debris - line shards (lines:true) or dot sparks.
export function burst(x, y, color, opts) {
  const o = opts || {};
  const S = g.S;
  const count = o.count || 12, speed = (o.speed || 140) * S, life = o.life || 0.45, lines = !!o.lines;
  for (let i = 0; i < count; i++) {
    const ang = rand(0, TAU), sp = rand(speed * 0.25, speed);
    g.particles.push({
      x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: rand(life * 0.6, life), max: life, color,
      ang: rand(0, TAU), spin: rand(-9, 9), len: lines ? rand(5, 13) * S : 0
    });
  }
}

export function destroyAsteroid(ai) {
  const { asteroids, powerups, ACCENT } = g;
  const a = asteroids[ai];
  if (!g.sandbox) {
    g.score += a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
    if (g.score > g.highScore) { g.highScore = g.score; g.newHigh = true; saveHi(); }
  }
  burst(a.x, a.y, a.size === 3 ? ACCENT : LINE,
    { count: 5 + a.size * 3, speed: 60 + a.size * 38, life: 0.4 + a.size * 0.06 });
  // Power-up drop: 5% from a red (archive) asteroid, 1% from a white one - within the cap.
  if (!g.puSpawnOff && powerups.length < MAX_POWERUPS && Math.random() < (a.size === 3 ? 0.05 : 0.01)) powerups.push(makePowerup(a.x, a.y));
  asteroids.splice(ai, 1);
  if (a.size > 1) {
    for (let k = 0; k < 2; k++) asteroids.push(makeAsteroid(a.x, a.y, a.size - 1, pick(FILE_POOL)));
  }
  if (!asteroids.length && !g.boss) spawnWave();   // boss fights spawn their own asteroids - don't advance mid-fight
}

export function loseLife() {
  g.lives--;
  // Ship explosion: white line shards (the broken hull) plus accent sparks.
  burst(g.ship.x, g.ship.y, LINE, { count: 16, speed: 185, life: 0.85, lines: true });
  burst(g.ship.x, g.ship.y, g.ACCENT, { count: 12, speed: 130, life: 0.6 });
  g.ship.dead = true; g.deathTimer = 0.9;   // animate the wreck before respawning / game over
}

// Launch a squadron: a travel direction, a lateral chord offset, and 1-5 ships in a
// trailing wedge, spawned just outside the near rim and flying straight across.
export function spawnFlyers() {
  const { cx, cy, HW, HH, S, flyers } = g;
  const dir = rand(0, TAU);
  const c = Math.cos(dir), s = Math.sin(dir);
  const nx = -s, ny = c;                       // unit perpendicular to travel
  const n = 1 + ((Math.random() * 5) | 0);     // 1..5 ships
  const speed = rand(240, 430) * S;
  const gap = rand(22, 34) * S;
  const BR = Math.hypot(HW, HH);               // rectangle's circumscribed radius
  const off = rand(-1, 1) * Math.min(HW, HH) * 0.7;
  const startDist = BR + 70;
  const baseX = cx - c * startDist + nx * off;
  const baseY = cy - s * startDist + ny * off;
  const alpha = rand(0.1, 0.2);                // dim - clearly background
  for (let i = 0; i < n; i++) {
    const rank = (i + 1) >> 1;
    const sideSign = i === 0 ? 0 : (i % 2 ? 1 : -1);
    const fwd = -rank * gap, lat = sideSign * rank * gap * 0.8;
    flyers.push({
      x: baseX + c * fwd + nx * lat, y: baseY + s * fwd + ny * lat,
      vx: c * speed, vy: s * speed, angle: dir, alpha
    });
  }
}

// Drift the squadron across and retire it once it has cleared the far rim.
export function updateFlyers(dt) {
  const { cx, cy, HW, HH, flyers } = g;
  g.flyerTimer -= dt;
  if (g.flyerTimer <= 0 && flyers.length === 0) { spawnFlyers(); g.flyerTimer = rand(5, 12); }
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (Math.hypot(f.x - cx, f.y - cy) > Math.hypot(HW, HH) + 120) flyers.splice(i, 1);
  }
}

// Drift the nuke wreck at constant velocity (no drag), tumbling, until it has fully faded.
export function updateWreck(dt) {
  if (!g.wreck) return;
  const w = g.wreck;
  w.x += w.vx * dt; w.y += w.vy * dt; wrap(w);
  w.angle += w.spin * dt;
  // Stay fully visible through the cinematic; only start fading once the player respawned.
  if (g.nuke <= 0) {
    w.fade += dt;
    if (w.fade >= WRECK_FADE) g.wreck = null;
  }
}

// Keep the asteroids drifting (and spinning/wrapping) on the game-over screen, without
// the collision/firing logic. The UFOs keep flying their paths too.
export function driftAsteroids(dt) {
  for (const a of g.asteroids) {
    a.x += a.vx * dt; a.y += a.vy * dt; a.angleR += a.spin * dt; wrap(a);
  }
  updateUfos(dt);
}
