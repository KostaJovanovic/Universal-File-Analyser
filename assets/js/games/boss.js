/* Analyser - Asteroids easter egg: boss waves.
   A single large passive boss (lethal on contact, never shoots). The first three are a
   fixed gauntlet - mothership on wave 5, serpent on wave 8, megastructure on wave 11 -
   then one every 7 waves after that, picked at random from a shuffle bag and slightly
   buffed each cycle. The three types: a mothership carrier, a corrupted megastructure
   with weak points guarding a ram-only core, and a segmented serpent. Every weapon can
   hurt it; killing it pays out score + power-ups + a heal, and the first boss beaten
   unlocks the optional start-wave picker. Each boss is a set of hittable "nodes". */

import {
  TAU, rand, pick, ARCHIVE_POOL, FILE_POOL, WAVE_GRACE, MAX_POWERUPS, MAX_LIVES,
  SHIELD_DUR, SPAWN_INVULN, NUKE_WHITE, NUKE_FADE, BOSS_COLOR, UFO_REWARD_COLOR,
  MONO, POWERUP_DEF, BOSS_UNLOCK_KEY
} from './config.js';
import { g, immortal, saveHi } from './state.js';
import { burst, makeAsteroid, makePowerup, spawnWave, resetShip, destroyAsteroid, loseLife } from './world.js';
import { makeUfo } from './ufos.js';

// Hoisted (restart() -> spawnWave() runs during init and must be able to call this).
// Scripted opener bosses on 5 / 8 / 11, then one every 7 waves (18, 25, ...).
export function isBossWave(w) { return w === 5 || w === 8 || w === 11 || (w > 11 && (w - 11) % 7 === 0); }

export function nextBossType() {
  if (!g.bossBag.length) {
    g.bossBag = ['mothership', 'megastructure', 'segmented'];
    for (let i = g.bossBag.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = g.bossBag[i]; g.bossBag[i] = g.bossBag[j]; g.bossBag[j] = t; }
  }
  return g.bossBag.pop();
}

// The first three encounters are a fixed gauntlet that introduces each type in turn;
// every boss wave past 10 is a random pick from the shuffle bag.
export function bossTypeForWave(w) {
  if (w === 5) return 'mothership';
  if (w === 8) return 'segmented';
  if (w === 11) return 'megastructure';
  return nextBossType();
}

// Encounters past wave 11 ramp up a little each cycle (every 7 waves): tougher nodes.
// 1.0 through the scripted gauntlet, then +18% per cycle (wave 18 = 1.18x), capped at 2x.
export function bossBuff(w) { return w > 11 ? Math.min(2, 1 + 0.18 * Math.floor((w - 11) / 7)) : 1; }

// Human-readable names for the HUD / health bar.
export const BOSS_NAMES = { mothership: 'MOTHERSHIP', segmented: 'SERPENT', megastructure: 'MEGA' };

// Re-pin the megastructure to the centre of its shorter edge, hanging just outside so
// only the inner arc peeks in. Called every frame so the boss stays glued through a resize.
export function megaAnchor(b) {
  const { cx, cy, HW, HH } = g;
  const hidden = b.r * 0.4 - b.r * 0.82;   // -0.42r: parked outside, inner arc peeks in by 0.4r
  const exposed = -b.r * 0.06;             // centre stays just outside - the core only peeks through
  const t = b.advance || 0;
  const e = 1 - Math.pow(1 - t, 4);        // very slow ease-out
  const inset = hidden + (exposed - hidden) * e;
  if (b.side === 'right') { b.x = cx + HW - inset; b.y = cy; }
  else { b.x = cx; b.y = cy - HH + inset; }
}

// Once the mega's core is exposed it runs a radar attack: expanding ping rings plus a beam
// that sweeps around the field, punching the player toward the far side when it passes over.
export function updateMegaRadar(b, dt) {
  const { cx, cy, S, ship, asteroids } = g;
  const idx = cx - b.x, idy = cy - b.y, il = Math.hypot(idx, idy) || 1;   // inward push direction
  const dirx = idx / il, diry = idy / il;
  b.sweepAng += dt * 1.6;
  b.pingCd -= dt;
  if (b.pingCd <= 0) { b.pingCd = 2.6; b.pings.push({ r: b.r * 0.2, life: 1.7, max: 1.7 }); }
  for (let i = b.pings.length - 1; i >= 0; i--) {
    const p = b.pings[i]; p.r += 520 * S * dt; p.life -= dt;
    if (p.life <= 0) b.pings.splice(i, 1);
  }
  // The beam shreds any asteroid it sweeps across.
  for (let ai = asteroids.length - 1; ai >= 0; ai--) {
    const a = asteroids[ai];
    if (a.grace > 0) continue;
    const ab = Math.atan2(a.y - b.y, a.x - b.x);
    if (Math.abs(Math.atan2(Math.sin(ab - b.sweepAng), Math.cos(ab - b.sweepAng))) < 0.16) destroyAsteroid(ai);
  }
  // ...and any power-up it crosses, except the battering ram it offers up (and never the player).
  for (let pi = g.powerups.length - 1; pi >= 0; pi--) {
    const pu = g.powerups[pi];
    if (pu.type === 'ram') continue;
    const pb = Math.atan2(pu.y - b.y, pu.x - b.x);
    if (Math.abs(Math.atan2(Math.sin(pb - b.sweepAng), Math.cos(pb - b.sweepAng))) < 0.16) {
      burst(pu.x, pu.y, pu.color, { count: 8, speed: 110, life: 0.4, lines: true });
      g.powerups.splice(pi, 1);
    }
  }
  b.sweepHitCd -= dt;
  if (!ship.dead && !g.gameOver && b.sweepHitCd <= 0) {
    const bearing = Math.atan2(ship.y - b.y, ship.x - b.x);
    const d = Math.atan2(Math.sin(bearing - b.sweepAng), Math.cos(bearing - b.sweepAng));
    if (Math.abs(d) < 0.20) {   // beam is over the ship
      b.sweepHitCd = 1.2;
      const first = !b.gunsKilled;
      if (first) {
        // The first sweep to catch the ship knocks out its systems.
        b.gunsKilled = true; g.gunsOff = true; g.megaMsgT = 30; g.puSpawnOff = true;
        for (const dr of g.drones) burst(dr.x, dr.y, POWERUP_DEF.drone.color, { count: 12, speed: 130, life: 0.5, lines: true });
        g.drones.length = 0; g.bullets.length = 0;
        for (let pi = g.powerups.length - 1; pi >= 0; pi--) if (g.powerups[pi].type !== 'ram') g.powerups.splice(pi, 1);   // wipe everything but the ram
      }
      const power = first ? 2 : 1;   // the first sweep hits twice as hard as the rest
      ship.vx += dirx * 780 * S * power; ship.vy += diry * 780 * S * power;   // shove toward the far wall
    }
  }
}
// The radar visuals (drawn in world space).
export function drawMegaRadar(b) {
  const ctx = g.ctx, { HW, HH } = g;
  ctx.save();
  ctx.translate(b.x, b.y);
  // No shadowBlur anywhere here: the pings expand to ~field radius and the sweep wedge/edge
  // span the whole field, so a glow on any of them is a multi-thousand-pixel software blur
  // per frame - the radar phase's main cost. Crisp magenta reads fine on the dark field.
  ctx.strokeStyle = UFO_REWARD_COLOR; ctx.lineWidth = 2;
  for (const p of b.pings) { ctx.globalAlpha = 0.55 * (p.life / p.max); ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.stroke(); }
  const reach = Math.hypot(HW, HH) * 2, a = b.sweepAng, wedge = 0.34;
  ctx.globalAlpha = 0.14; ctx.fillStyle = UFO_REWARD_COLOR;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, reach, a - wedge, a); ctx.closePath(); ctx.fill();   // trailing fade
  ctx.globalAlpha = 0.75;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * reach, Math.sin(a) * reach); ctx.stroke();   // leading edge
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Keep a single non-expiring battering-ram pickup parked at the centre while the core is
// exposed - unless the player already has the ram.
export function ensureRamPickup() {
  if (g.weapon === 'ram' || g.ship.dead) return;
  if (g.powerups.some((p) => p.type === 'ram')) return;
  const pu = makePowerup(g.cx, g.cy, 'ram');
  pu.vx = 0; pu.vy = 0; pu.life = Infinity;
  g.powerups.push(pu);
}

// Mega defeated: play a ~10s cinematic. Clear the stage, grant the rewards, then let
// updateMegaOutro escalate the explosions before the next wave starts.
export function startMegaOutro() {
  const { cx, cy, HW, HH, ship } = g;
  const b = g.boss;
  b.dying = true; b.outroT = 0; b.expCd = 0; b.ringCd = 0; b.outroRings = []; b.detonated = false;
  g.gunsOff = false; g.megaMsgT = 0; g.puSpawnOff = false; g.weapon = 'normal'; g.weaponTimer = 0;
  g.asteroids.length = 0; g.bullets.length = 0; g.lasers.length = 0; g.ufos.length = 0; g.missiles.length = 0;
  for (let i = g.powerups.length - 1; i >= 0; i--) if (g.powerups[i].life === Infinity) g.powerups.splice(i, 1);
  g.hideShip = true; ship.invuln = Math.max(ship.invuln, 12);   // ship vanishes into the blast; returns next wave
  burst(ship.x, ship.y, '#fff', { count: 18, speed: 170, life: 0.7, lines: true });
  if (!g.sandbox) { g.score += 1500; if (g.score > g.highScore) { g.highScore = g.score; g.newHigh = true; saveHi(); } }
  if (!g.bossEverBeaten) {
    g.bossEverBeaten = true;
    try { localStorage.setItem(BOSS_UNLOCK_KEY, '1'); } catch (_) {}
    if (g.startToggleBtn) g.startToggleBtn.style.display = '';
  }
  burst(b.x, b.y, '#fff', { count: 26, speed: 220, life: 0.9, lines: true });
}
export function updateMegaOutro(dt) {
  const { cx, cy, HW, HH, S } = g;
  const b = g.boss; b.outroT += dt; const t = b.outroT;
  const DET = 4;   // explosions build for DET seconds, then the detonation flash plays
  b.expCd -= dt;
  if (b.expCd <= 0 && t < DET) {   // escalating debris explosions across the arena
    b.expCd = Math.max(0.05, 0.4 - t * 0.06);
    const px = cx + rand(-HW, HW) * 0.95, py = cy + rand(-HH, HH) * 0.95;
    const col = Math.random() < 0.45 ? '#fff' : UFO_REWARD_COLOR;
    burst(px, py, col, { count: 8 + (t | 0) * 3, speed: 140 + t * 30, life: 0.7, lines: true });
  }
  b.ringCd -= dt;
  if (b.ringCd <= 0 && t < DET) { b.ringCd = 0.8; b.outroRings.push({ r: b.r * 0.2, life: 2, max: 2 }); }   // shockwaves
  for (let i = b.outroRings.length - 1; i >= 0; i--) {
    const r = b.outroRings[i]; r.r += 380 * S * dt; r.life -= dt;
    if (r.life <= 0) b.outroRings.splice(i, 1);
  }
  if (!b.detonated && t >= DET) {   // the blast
    b.detonated = true;
    for (let k = 0; k < 5; k++) burst(cx + rand(-HW, HW) * 0.4, cy + rand(-HH, HH) * 0.4, '#fff', { count: 24, speed: 240, life: 1, lines: true });
  }
  if (t >= DET + NUKE_WHITE + NUKE_FADE) finishMegaOutro();   // flash matches a nuke's length; never sooner than 10s
}
export function finishMegaOutro() {
  const { cx, cy, HW, HH } = g;
  g.boss = null;   // clearing the boss releases the white walls / wrap
  g.hideShip = false; resetShip(SPAWN_INVULN);   // ship returns fresh - no life lost
  if (g.lives < MAX_LIVES) g.lives++; else g.shield = Math.max(g.shield, SHIELD_DUR);
  for (let k = 0; k < 3; k++) g.powerups.push(makePowerup(cx + rand(-HW, HW) * 0.5, cy + rand(-HH, HH) * 0.5));
  spawnWave();
}
// The cinematic itself: shockwave rings, a building core glow, then a full detonation flash.
export function drawMegaOutro(b) {
  const ctx = g.ctx, { cx, cy, HW, HH } = g;
  ctx.save();
  // Crisp rings, no shadowBlur: they expand to field size, so a glow is a full-field software
  // blur per ring per frame. The radial-gradient core glow below already carries the bloom.
  ctx.strokeStyle = UFO_REWARD_COLOR; ctx.lineWidth = 2;
  for (const r of b.outroRings) { ctx.globalAlpha = 0.6 * (r.life / r.max); ctx.beginPath(); ctx.arc(b.x, b.y, r.r, 0, TAU); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const t = b.outroT, DET = 4;
  if (t < DET) {   // building core glow up to the detonation
    const gg = Math.min(1, t / DET), rad = b.r * (0.25 + gg * 1.5);
    const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,' + (0.3 + 0.6 * gg) + ')');
    grd.addColorStop(0.45, 'rgba(255,77,210,' + (0.25 * gg) + ')');
    grd.addColorStop(1, 'rgba(255,77,210,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(b.x, b.y, rad, 0, TAU); ctx.fill();
  }
  // Detonation flash: full white held for NUKE_WHITE, then fades over NUKE_FADE.
  let fa = 0;
  if (t >= DET) {
    const el = t - DET;
    if (el < NUKE_WHITE) fa = 1;
    else if (el < NUKE_WHITE + NUKE_FADE) fa = 1 - (el - NUKE_WHITE) / NUKE_FADE;
  }
  if (fa > 0) { ctx.globalAlpha = Math.min(1, fa); ctx.fillStyle = g.settings.reduceFlash ? '#000' : '#fff'; ctx.fillRect(cx - HW - 30, cy - HH - 30, 2 * HW + 60, 2 * HH + 60); ctx.globalAlpha = 1; }
  ctx.restore();
}
// Narrator text box pinned to the bottom of the field while the core is exposed.
export function drawMegaMessage() {
  const ctx = g.ctx, { cx, cy, HW, HH } = g;
  const msg = 'This is it! I promise everything will be alright. Emergency guns not responding. Grab the battering ram and ride straight into it - trust me!';
  ctx.save();
  ctx.font = '13px ' + MONO; ctx.textBaseline = 'alphabetic';
  const maxW = Math.min(2 * HW - 36, 440);
  const words = msg.split(' '); const lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  let widest = 0; for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
  const padX = 14, padY = 11, lh = 18;
  const boxW = widest + padX * 2, boxH = lines.length * lh + padY * 2;
  const bx = cx - boxW / 2, by = cy + HH - boxH - 14;
  ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2; ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 10;
  ctx.strokeRect(bx, by, boxW, boxH);
  ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, by + padY + lh * (i + 1) - 5);
  ctx.restore();
}

// One stray medium/large asteroid, dropped away from the ship with arrival grace (flagged
// solo so it never triggers the wave banner). Keeps boss fights lively.
export function spawnBossAsteroid() {
  const { cx, cy, HW, HH, S, ship } = g;
  // The mega drips asteroids fast; in its sealed arena they can't wrap away, so hold a soft
  // cap (re-arm still ticks, it just waits for room) to keep the field busy but survivable.
  if (g.boss && g.boss.type === 'megastructure' && g.asteroids.length >= 12) return;
  const size = Math.random() < 0.5 ? 3 : 2;
  let x, y, tries = 0;
  do { x = cx + rand(-HW, HW) * 0.92; y = cy + rand(-HH, HH) * 0.92; }
  while (Math.hypot(x - ship.x, y - ship.y) < 170 * S && ++tries < 30);
  const a = makeAsteroid(x, y, size, pick(size === 3 ? ARCHIVE_POOL : FILE_POOL));
  a.grace = WAVE_GRACE; a.solo = true;
  g.asteroids.push(a);
}
// A power-up somewhere around the arena (away from the ship), respecting the on-screen cap.
export function spawnBossPowerup() {
  const { cx, cy, HW, HH, S, ship } = g;
  if (g.puSpawnOff || g.powerups.length >= MAX_POWERUPS) return;
  let x, y, tries = 0;
  do { x = cx + rand(-HW, HW) * 0.85; y = cy + rand(-HH, HH) * 0.85; }
  while (Math.hypot(x - ship.x, y - ship.y) < 120 * S && ++tries < 20);
  g.powerups.push(makePowerup(x, y));
}

export function spawnBoss(forcedType) {
  const { cx, cy, HW, HH, R, S } = g;
  const type = forcedType || bossTypeForWave(g.wave);
  const buff = forcedType ? 1 : bossBuff(g.wave);   // scripted/debug spawns stay at base toughness
  const u = 100 * S;                       // "large" size unit
  const b = { type, x: cx, y: cy - HH * 0.45, angle: 0, vx: 0, vy: 0, spin: 0, t: 0, r: u, nodes: [], grace: WAVE_GRACE };
  // The megastructure traps you in a walled arena, so it pelts the field with asteroids far
  // faster; the serpent spawns them briskly too (it feeds on them - see serpentEat).
  b.astCd = type === 'megastructure' ? rand(4, 7) : type === 'segmented' ? rand(7, 13) : rand(12, 17);
  b.puCd = rand(7, 12);     // ...and the occasional power-up around the arena
  if (type === 'mothership') {
    // Single hit-anywhere core. A passive carrier launching small UFOs on a timer.
    const hp = Math.round(120 * buff);
    b.nodes.push({ ox: 0, oy: 0, r: u * 0.5, hp, maxhp: hp, kind: 'core', dead: false });
    b.y = cy - HH * 0.5;                              // hover in the upper portion of the field
    b.vx = (Math.random() < 0.5 ? -1 : 1) * 26 * S;   // side-to-side drift only (no spin)
    b.spawnCd = 1.5;                                  // first UFO launch shortly after it arrives
  } else if (type === 'megastructure') {
    // A colossus as wide as the field's shorter dimension, hanging just outside the shorter
    // edge so only its inner arc dips into play. Weak points stud its rim; clear them all.
    b.side = HW <= HH ? 'top' : 'right';
    b.r = R * 1.56; b.spin = 0.22; b.advance = 0;   // 1.2 x 1.3: the original +20%, then +30% more
    b.rimState = 'fighting'; b.finaleT = 0; b.rimGone = false;   // satellite-destruction finale, then the slide-in
    b.sweepAng = 0; b.pings = []; b.pingCd = 0.5; b.sweepHitCd = 0;   // radar attack once the core is exposed
    b.coreReady = false; b.gunsKilled = false; b.dying = false; b.stage2T = 0;   // ram-the-core endgame, then the cinematic outro
    megaAnchor(b);
    const ring = 10, rr = b.r * 0.82, whp = Math.round(12 * buff);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * TAU;
      b.nodes.push({ ox: Math.cos(a) * rr, oy: Math.sin(a) * rr, r: b.r * 0.085, hp: whp, maxhp: whp, kind: 'weak', dead: false });
    }
    b.nodes.push({ ox: 0, oy: 0, r: b.r * 0.22, hp: 1, maxhp: 1, kind: 'core', dead: false });   // sealed until the rim is cleared; one ram hit ends it
  } else {
    // Serpent: 30% larger than the base unit, tripled segment HP, length grows with the wave.
    const su = u * 1.3;
    b.r = su * 0.5; b.spacing = su * 0.44; b.headAngle = rand(0, TAU); b.steerT = 1; b.turn = 0; b.eatCd = 0;   // drive straight for 1s before the first turn
    const M = Math.min(25, 13 + Math.max(0, Math.floor((g.wave - 11) / 7)) * 2);
    const shp = Math.round(18 * buff);
    const hx = cx, hy = cy - HH * 0.4;
    for (let i = 0; i < M; i++) b.nodes.push({ ax: hx - i * b.spacing, ay: hy, r: su * 0.34, hp: i === 0 ? Infinity : shp, maxhp: i === 0 ? Infinity : shp, kind: i === 0 ? 'head' : 'segment', dead: false });
  }
  g.boss = b;
}

// World position of a node (offsets rotate with the boss; segments carry absolute coords).
// Returns a single reused scratch array: every caller destructures `[nx, ny]` immediately
// and none retain it, so this avoids allocating an array on every node/collision check
// (hundreds per frame in a serpent fight) with no behavioural change.
const _np = [0, 0];
export function bossNodePos(b, n) {
  if (b.type === 'segmented') { _np[0] = n.ax; _np[1] = n.ay; return _np; }
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  _np[0] = b.x + n.ox * c - n.oy * s; _np[1] = b.y + n.ox * s + n.oy * c;
  return _np;
}
// A node can be damaged unless dead - except the megastructure core, sealed until every
// weak point is destroyed.
export function bossNodeVulnerable(b, n) {
  if (n.dead || b.grace > 0) return false;   // no hitbox while it's still the arrival outline
  if (n.kind === 'head') return false;       // serpent head is invulnerable (but lethal to touch)
  if (n.kind === 'core' && b.type === 'megastructure') return b.nodes.every((x) => x.kind !== 'weak' || x.dead);   // core sealed until the rim is cleared
  return true;
}
export function bossDead(b) {
  if (b.type === 'mothership') return b.nodes[0].dead;
  if (b.type === 'segmented') return b.nodes.every((n) => n.kind === 'head' || n.dead);   // all body segments gone
  return b.nodes.some((n) => n.kind === 'core' && n.dead);   // megastructure: core destroyed
}
export function damageBossNode(b, n, dmg, hx, hy, byRam) {
  if (n.dead) return;
  if (b.type === 'megastructure' && n.kind === 'core' && !byRam) return;   // core destroyed only by the ram
  n.hp -= dmg;
  burst(hx, hy, BOSS_COLOR, { count: 3, speed: 70, life: 0.25 });
  if (n.hp <= 0) { n.dead = true; burst(hx, hy, BOSS_COLOR, { count: 10, speed: 120, life: 0.5, lines: true }); }
}
// Damage the first vulnerable node containing (x,y) within padR; true if it hit.
export function hitBossAt(x, y, padR, dmg) {
  const boss = g.boss;
  if (!boss) return false;
  for (const n of boss.nodes) {
    if (!bossNodeVulnerable(boss, n)) continue;
    if (boss.type === 'megastructure' && n.kind === 'core') continue;   // bullets pass through the core (ram-only)
    const [nx, ny] = bossNodePos(boss, n);
    const rr = n.r + padR;
    if ((x - nx) * (x - nx) + (y - ny) * (y - ny) < rr * rr) { damageBossNode(boss, n, dmg, nx, ny); return true; }
  }
  return false;
}

// Body chain follow: each segment trails the one ahead at fixed spacing via the shortest wrapped
// delta, so it feeds cleanly through the toroidal seam. Shared by the live serpent and its death curl.
function snakeFollow(b) {
  const { cx, cy, HW, HH } = g;
  const W = HW * 2, H2 = HH * 2;
  for (let i = 1; i < b.nodes.length; i++) {
    const p = b.nodes[i - 1], n = b.nodes[i];
    let dx = n.ax - p.ax, dy = n.ay - p.ay;
    if (dx > HW) dx -= W; else if (dx < -HW) dx += W;
    if (dy > HH) dy -= H2; else if (dy < -HH) dy += H2;
    const d = Math.hypot(dx, dy) || 1;
    let nx = p.ax + (dx / d) * b.spacing, ny = p.ay + (dy / d) * b.spacing;
    if (nx < cx - HW) nx += W; else if (nx > cx + HW) nx -= W;
    if (ny < cy - HH) ny += H2; else if (ny > cy + HH) ny -= H2;
    n.ax = nx; n.ay = ny;
  }
}

// Serpent boss: head drives forward at constant speed and can only pivot; the body chain
// follows via shortest-wrapped-delta so it feeds cleanly through the toroidal seam.
export function updateSnake(b, dt) {
  const { cx, cy, HW, HH, S } = g;
  const head = b.nodes[0];
  const W = HW * 2, H2 = HH * 2;
  // Once it drops to 50% HP the serpent turns hunter: it steers straight, at the usual turn-rate
  // cap, at the nearest asteroid (red = a segment + power-up, white = 3% heal). Otherwise it wanders.
  let hp = 0, max = 0;
  for (let i = 1; i < b.nodes.length; i++) { const n = b.nodes[i]; max += n.maxhp; if (!n.dead) hp += Math.max(0, n.hp); }
  let prey = null;
  if (max > 0 && hp <= max * 0.5) {
    let bd = Infinity;
    for (const a of g.asteroids) {
      if (a.grace > 0) continue;
      const dx = a.x - head.ax, dy = a.y - head.ay, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; prey = a; }
    }
  }
  if (prey) {
    const want = Math.atan2(prey.y - head.ay, prey.x - head.ax);
    const d = Math.atan2(Math.sin(want - b.headAngle), Math.cos(want - b.headAngle));
    const max = 2.0 * dt;
    b.headAngle += Math.max(-max, Math.min(max, d));
  } else {
    b.steerT -= dt;
    if (b.steerT <= 0) { b.turn = rand(-1, 1) * 2.0; b.steerT = rand(0.3, 0.9); }
    b.headAngle += (b.turn || 0) * dt;
  }
  b.prey = prey;   // null unless hunting; the render layer traces the path to it
  b.hpFrac = max > 0 ? hp / max : 1;   // read by the drip timer (more food when it's low)
  const spd = 210 * S * (max > 0 && hp <= max * 0.1 ? 1.5 : 1);   // frenzied 1.5x dash below 10% HP
  b.spd = spd;     // shared with the hunt-path overlay so its predicted curve matches
  let hx = head.ax + Math.cos(b.headAngle) * spd * dt, hy = head.ay + Math.sin(b.headAngle) * spd * dt;
  if (hx < cx - HW) hx += W; else if (hx > cx + HW) hx -= W;
  if (hy < cy - HH) hy += H2; else if (hy > cy + HH) hy -= H2;
  head.ax = hx; head.ay = hy;
  snakeFollow(b);
}

// The serpent feeds on what its head sweeps over: any asteroid is swallowed whole (removed, no
// split, no score). A RED (archive, size-3) rock regrows one lost segment and coughs up a power-up
// where it was eaten; a WHITE rock heals 3% of the serpent's full HP. Only the head feeds, and only
// once every SNAKE_EAT_CD seconds - after a meal it has to digest before it can swallow again.
const SNAKE_EAT_CD = 5;
export function serpentEat(b, dt) {
  if (b.eatCd > 0) { b.eatCd -= dt; return; }   // still digesting the last meal
  const head = b.nodes[0];
  for (let ai = g.asteroids.length - 1; ai >= 0; ai--) {
    const a = g.asteroids[ai];
    if (a.grace > 0) continue;   // no hitbox while it's still the arrival outline
    const dx = a.x - head.ax, dy = a.y - head.ay, rr = head.r + a.radius;
    if (dx * dx + dy * dy > rr * rr) continue;
    burst(a.x, a.y, BOSS_COLOR, { count: 8, speed: 110, life: 0.4, lines: true });
    g.asteroids.splice(ai, 1);
    if (a.size === 3) {
      const seg = b.nodes.find((n) => n.kind === 'segment' && n.dead);   // restore the first lost segment
      if (seg) { seg.dead = false; seg.hp = seg.maxhp; }
      if (g.powerups.length < MAX_POWERUPS) g.powerups.push(makePowerup(a.x, a.y));   // drop loot where it fed
    } else {
      let max = 0;
      for (const n of b.nodes) if (n.kind === 'segment') max += n.maxhp;
      let heal = max * 0.03;   // 3% of full HP, poured into its damaged living segments
      for (const n of b.nodes) {
        if (heal <= 0) break;
        if (n.kind !== 'segment' || n.dead || n.hp >= n.maxhp) continue;
        const add = Math.min(heal, n.maxhp - n.hp); n.hp += add; heal -= add;
      }
    }
    b.eatCd = SNAKE_EAT_CD;   // one bite, then a 5s digest before it can feed again
    break;
  }
}

// Serpent defeated: rather than vanishing on the spot, the head keeps cruising at its normal speed
// but holds its steering hard over at the usual max turn rate, carving a clean circle. The body
// chain follows, feeding the spine onto that ring - destroyed segments stay destroyed, never redrawn.
// Once the head has travelled the spine's full length (at least one full loop) the whole body lies
// on the circle, and it detonates - a scaled-up version of the player-death blast.
const SNAKE_TAIL = 1.4;
export function startSnakeOutro() {
  const { ship, S } = g;
  const b = g.boss;
  b.dying = true; b.dieT = 0; b.exploded = false; b.explodeT = 0; b.dieDist = 0; b.dieSpark = 0;
  b.turn = (b.turn < 0 ? -1 : 1) * 2.0;   // lock the steer hard over at the normal max turn rate
  const circ = TAU * (210 * S) / 2.0;     // circumference of one full revolution at that turn rate
  b.dieLen = Math.max(b.spacing * (b.nodes.length - 1), circ);   // circle until the whole spine is on the ring
  g.asteroids.length = 0; g.bullets.length = 0; g.lasers.length = 0; g.ufos.length = 0; g.missiles.length = 0;
  ship.invuln = Math.max(ship.invuln, 12);                  // safe through the whole cinematic
  if (!g.sandbox) { g.score += 1000; if (g.score > g.highScore) { g.highScore = g.score; g.newHigh = true; saveHi(); } }
  if (!g.bossEverBeaten) {
    g.bossEverBeaten = true;
    try { localStorage.setItem(BOSS_UNLOCK_KEY, '1'); } catch (_) {}
    if (g.startToggleBtn) g.startToggleBtn.style.display = '';
  }
}
export function updateSnakeOutro(dt) {
  const b = g.boss; b.dieT += dt;
  if (!b.exploded) {
    // Carve a circle at the normal cruising speed and turn rate; the spine (every node position)
    // trails onto that ring. No hunting, no segment regrowth, no shake.
    const { cx, cy, HW, HH, S } = g;
    const W = HW * 2, H2 = HH * 2;
    const head = b.nodes[0];
    const px = head.ax, py = head.ay;
    const spd = 210 * S;
    b.headAngle += b.turn * dt;
    let hx = head.ax + Math.cos(b.headAngle) * spd * dt, hy = head.ay + Math.sin(b.headAngle) * spd * dt;
    if (hx < cx - HW) hx += W; else if (hx > cx + HW) hx -= W;
    if (hy < cy - HH) hy += H2; else if (hy > cy + HH) hy -= H2;
    head.ax = hx; head.ay = hy;
    snakeFollow(b);
    let dx = head.ax - px, dy = head.ay - py;   // head travel this frame (unwrap the seam)
    if (dx > HW) dx -= W; else if (dx < -HW) dx += W;
    if (dy > HH) dy -= H2; else if (dy < -HH) dy += H2;
    b.dieDist += Math.hypot(dx, dy);
    b.dieSpark -= dt;
    if (b.dieSpark <= 0) { b.dieSpark = 0.07; burst(head.ax, head.ay, BOSS_COLOR, { count: 2, speed: 55, life: 0.4 }); }   // glowing trail as it coils
    if (b.dieDist >= b.dieLen) { snakeOutroExplode(b); b.explodeT = b.dieT; }   // whole spine now on the ring - detonate
  } else if (b.dieT >= b.explodeT + SNAKE_TAIL) {
    finishSnakeOutro();
  }
}
function snakeOutroExplode(b) {
  b.exploded = true;
  // Blow the whole coil apart along the ring: a white hull-shard burst at every node position,
  // then violet + accent at the head.
  for (const n of b.nodes) burst(n.ax, n.ay, '#fff', { count: 10, speed: 320, life: 1.2, lines: true });
  const head = b.nodes[0];
  burst(head.ax, head.ay, BOSS_COLOR, { count: 54, speed: 350, life: 1.4, lines: true });
  burst(head.ax, head.ay, g.ACCENT, { count: 40, speed: 260, life: 1.0 });
}
export function finishSnakeOutro() {
  const { cx, cy, HW, HH } = g;
  g.boss = null;
  for (let k = 0; k < 3; k++) g.powerups.push(makePowerup(cx + rand(-HW, HW) * 0.5, cy + rand(-HH, HH) * 0.5));
  if (g.lives < MAX_LIVES) g.lives++; else g.shield = Math.max(g.shield, SHIELD_DUR);
  spawnWave();
}

export function updateBoss(dt) {
  const boss = g.boss;
  if (!boss) return;
  if (boss.dying) {   // cinematic playing out - hold here
    if (boss.type === 'megastructure') updateMegaOutro(dt); else updateSnakeOutro(dt);
    return;
  }
  if (bossDead(boss)) {
    if (boss.type === 'megastructure') startMegaOutro();        // epic 10s+ send-off before the next wave
    else if (boss.type === 'segmented') startSnakeOutro();      // coil-up, violent shake, then a big blast
    else bossDefeated();
    return;
  }
  const { cx, cy, HW, HH, S, ship } = g;
  const b = boss; b.t += dt;
  if (b.grace > 0) b.grace = Math.max(0, b.grace - dt);   // arrival outline: inert until it expires
  const active = b.grace <= 0;
  if (b.type === 'mothership') {
    b.x += b.vx * dt;
    if (b.x < cx - HW + b.r) { b.x = cx - HW + b.r; b.vx = Math.abs(b.vx); }
    else if (b.x > cx + HW - b.r) { b.x = cx + HW - b.r; b.vx = -Math.abs(b.vx); }
    b.y = (cy - HH * 0.5) + Math.sin(b.t * 0.8) * HH * 0.05;
    // Carrier: launch small UFOs on a timer, capped at 6 of its own alive at once.
    if (active) b.spawnCd -= dt;
    if (active && b.spawnCd <= 0) {
      b.spawnCd = 2.2;
      if (g.ufos.filter((u) => u.fromBoss && !u.leaving).length < 6) {
        const u = makeUfo(Math.random() < 0.7 ? 'reward' : 'ambient');
        u.fromBoss = true; u.x = b.x; u.y = b.y;   // emerge from the carrier, then ease onto its path
        g.ufos.push(u);
      }
    }
  } else if (b.type === 'megastructure') {
    b.angle += b.spin * dt;   // slow rotation in place
    const rimCleared = b.nodes.every((n) => n.kind !== 'weak' || n.dead);
    if (b.rimState !== 'fighting') b.stage2T += dt;   // second-stage clock: the ram appears 5s after the rim falls
    if (b.rimState === 'fighting') {
      // First phase done (rim satellites cleared): the second stage begins. The ram itself
      // doesn't appear yet - it's parked 5s later (below), then kept topped up permanently.
      if (rimCleared) { b.rimState = 'finale'; b.finaleT = 0; }
    } else if (b.rimState === 'finale') {
      b.finaleT += dt;   // rings shake (drawn in drawBoss) for 0.85s, then blow apart
      if (b.finaleT >= 0.85) {
        const PTS = 20;
        for (let k = 0; k < PTS; k++) {
          const a = (k / PTS) * TAU;
          burst(b.x + Math.cos(a) * b.r, b.y + Math.sin(a) * b.r, UFO_REWARD_COLOR, { count: 5, speed: 175, life: 0.8, lines: true });
          if (k % 2 === 0) burst(b.x + Math.cos(a) * b.r * 0.58, b.y + Math.sin(a) * b.r * 0.58, UFO_REWARD_COLOR, { count: 4, speed: 150, life: 0.7, lines: true });
        }
        b.rimGone = true; b.rimState = 'sliding';
      }
    } else if (b.rimState === 'sliding') {
      b.advance = Math.min(1, b.advance + dt / 4);   // megaAnchor eases this out very slowly
      if (b.advance >= 1) {
        b.coreReady = true;
        updateMegaRadar(b, dt);   // core fully exposed: the radar is live (its first sweep cuts the guns)
      }
    }
    if (b.stage2T >= 5) ensureRamPickup();   // 5s into the second stage the ram appears and is kept parked permanently
    megaAnchor(b);            // re-pin to the shorter edge (resize-proof), advancing inward when sliding
  } else {
    updateSnake(b, dt);
    if (active) serpentEat(b, dt);   // head swallows asteroids it passes over, regrowing a lost segment
  }
  // Every boss fight keeps the arena busy: a stray asteroid on a timer + occasional power-ups.
  if (active) {
    b.astCd -= dt;
    if (b.astCd <= 0) {
      // Serpent feeds faster the more wounded it is: 7-13s normally, 5-8s once under 20% HP.
      b.astCd = b.type === 'megastructure' ? rand(4, 7)
        : b.type === 'segmented' ? (b.hpFrac <= 0.2 ? rand(5, 8) : rand(7, 13))
        : rand(12, 17);
      spawnBossAsteroid();
    }
    b.puCd -= dt;
    if (b.puCd <= 0) { b.puCd = rand(9, 14); spawnBossPowerup(); }
  }
  // Lethal-on-contact body; the battering ram smashes nodes head-on instead of dying.
  if (active && !ship.dead && !g.gameOver) {
    const ramming = g.weapon === 'ram';
    for (const n of b.nodes) {
      if (n.dead) continue;
      const [nx, ny] = bossNodePos(b, n);
      const dx = nx - ship.x, dy = ny - ship.y, rr = n.r + 11 * S;
      if (dx * dx + dy * dy >= rr * rr) continue;
      if (ramming) {
        if (g.ramHitCd <= 0 && bossNodeVulnerable(b, n) && ship.vx * dx + ship.vy * dy > 0) {
          damageBossNode(b, n, 2, nx, ny, true); g.ramHitCd = 0.2; ship.invuln = Math.max(ship.invuln, 0.2);
        }
        continue;
      }
      if (ship.invuln <= 0 && g.shield <= 0 && !immortal()) { g.cause = 'boss'; loseLife(); }
      break;
    }
  }
}

export function bossDefeated() {
  const { cx, cy, HW, HH } = g;
  const b = g.boss; g.boss = null;
  if (!g.sandbox) { g.score += 1000; if (g.score > g.highScore) { g.highScore = g.score; g.newHigh = true; saveHi(); } }
  for (const n of b.nodes) { const [nx, ny] = bossNodePos(b, n); burst(nx, ny, BOSS_COLOR, { count: 8, speed: 130, life: 0.6, lines: true }); }
  for (let k = 0; k < 3; k++) g.powerups.push(makePowerup(cx + rand(-HW, HW) * 0.5, cy + rand(-HH, HH) * 0.5));
  if (g.lives < MAX_LIVES) g.lives++; else g.shield = Math.max(g.shield, SHIELD_DUR);
  if (!g.bossEverBeaten) {
    g.bossEverBeaten = true;
    try { localStorage.setItem(BOSS_UNLOCK_KEY, '1'); } catch (_) {}
    if (g.startToggleBtn) g.startToggleBtn.style.display = '';
  }
  spawnWave();   // advance to the next (normal) wave
}

// Arrival preview: the boss's silhouette as a dimmed, marching-dashed outline.
export function drawBossOutline(b) {
  const ctx = g.ctx;
  ctx.save();
  ctx.strokeStyle = BOSS_COLOR; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.setLineDash([7, 6]); ctx.lineDashOffset = -g.clock * 36; ctx.globalAlpha = 0.5;
  if (b.type === 'segmented') {
    for (const n of b.nodes) { ctx.beginPath(); ctx.arc(n.ax, n.ay, n.r, 0, TAU); ctx.stroke(); }
  } else if (b.type === 'megastructure') {
    ctx.translate(b.x, b.y); ctx.rotate(b.angle);
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.stroke();
    for (const n of b.nodes) {
      if (n.kind === 'core') { ctx.beginPath(); ctx.arc(0, 0, n.r, 0, TAU); ctx.stroke(); }
      else ctx.strokeRect(n.ox - n.r, n.oy - n.r, n.r * 2, n.r * 2);
    }
  } else {   // mothership hull
    ctx.translate(b.x, b.y);
    const r = b.r;
    ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(-r * 0.55, -r * 0.32); ctx.lineTo(r * 0.55, -r * 0.32);
    ctx.lineTo(r, 0); ctx.lineTo(r * 0.55, r * 0.3); ctx.lineTo(-r * 0.55, r * 0.3); ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

// True if a circle (x,y,r) overlaps the visible field at all. The whole scene is already
// clipped to the field, so off-screen pixels are never painted - but gating a draw on this
// also skips the (wasted) shadow-blur / stroke work for elements that hang entirely outside,
// e.g. the megastructure's core, which sits off-field until the structure slides in.
function onField(x, y, r) {
  const { cx, cy, HW, HH } = g;
  return x + r >= cx - HW && x - r <= cx + HW && y + r >= cy - HH && y - r <= cy + HH;
}

// The megastructure shell (the two orbit rings + the ring of satellite weak points) rotates
// every frame and is drawn with a glow, so live it means several full-field-radius shadowBlur
// strokes per frame - the single biggest cost of the mega fight. Its *shape* only changes when
// a weak point dies or the finale begins, so bake it (glow and all) into a sprite in the boss's
// local frame and blit it rotated each frame; the blur then runs only on those rare changes.
function megaShellSprite(b) {
  const dpr = g.dpr;
  const finale = b.rimState === 'finale';
  let mask = '';
  for (const n of b.nodes) if (n.kind === 'weak') mask += n.dead ? '1' : '0';   // re-bake when a satellite dies
  const key = Math.round(b.r) + ':' + dpr + ':' + (finale ? 'F' : 'f') + ':' + mask;
  if (b._shellKey !== key) {
    const pad = 28, half = b.r + pad;                 // glow spill room; sprite is 2*half square, centred
    const cv = b._shellCv || (b._shellCv = document.createElement('canvas'));
    cv.width = cv.height = Math.ceil(2 * half * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, 2 * half, 2 * half);
    c.translate(half, half);                          // sprite centre = boss centre
    c.lineWidth = 2; c.lineJoin = 'round';
    c.shadowBlur = 10; c.shadowColor = UFO_REWARD_COLOR; c.strokeStyle = UFO_REWARD_COLOR;
    c.beginPath(); c.arc(0, 0, b.r, 0, TAU); c.stroke();                                  // outer orbit
    c.globalAlpha = 0.5; c.beginPath(); c.arc(0, 0, b.r * 0.58, 0, TAU); c.stroke(); c.globalAlpha = 1;   // inner orbit
    if (!finale) {
      c.fillStyle = UFO_REWARD_COLOR;
      for (const n of b.nodes) {
        if (n.kind !== 'weak') continue;
        c.globalAlpha = n.dead ? 0.12 : 0.5;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(n.ox, n.oy); c.stroke();   // spoke
        c.globalAlpha = n.dead ? 0.18 : 1;
        c.strokeRect(n.ox - n.r, n.oy - n.r, n.r * 2, n.r * 2);            // satellite box
        if (!n.dead) { c.globalAlpha = 0.3; c.fillRect(n.ox - n.r, n.oy - n.r, n.r * 2, n.r * 2); }
        c.globalAlpha = 1;
      }
    }
    b._shellKey = key; b._shellHalf = half;
  }
  return b._shellCv;
}

// Hunter overlay: while the serpent is chasing a red asteroid, trace the curved path its head will
// actually take (constant speed, turning toward the target at its cap - the same maths as
// updateSnake) as a marching dotted line, with a ring on the target. Pure intent telegraph.
function drawSerpentHunt(b) {
  const prey = b.prey;
  if (!prey || !g.asteroids.includes(prey)) return;   // nothing to hunt, or it was just eaten
  const ctx = g.ctx, S = g.S;
  const head = b.nodes[0];
  const spd = b.spd || 210 * S, step = 0.045, hit = head.r + prey.radius;
  let x = head.ax, y = head.ay, ang = b.headAngle;
  ctx.save();
  ctx.shadowBlur = 0; ctx.strokeStyle = BOSS_COLOR; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
  ctx.setLineDash([5, 7]); ctx.lineDashOffset = -g.clock * 40;
  ctx.beginPath(); ctx.moveTo(x, y);
  for (let i = 0; i < 100; i++) {
    const want = Math.atan2(prey.y - y, prey.x - x);
    const d = Math.atan2(Math.sin(want - ang), Math.cos(want - ang));
    const m = 2.0 * step;
    ang += Math.max(-m, Math.min(m, d));
    x += Math.cos(ang) * spd * step; y += Math.sin(ang) * spd * step;
    ctx.lineTo(x, y);
    const dx = prey.x - x, dy = prey.y - y;
    if (dx * dx + dy * dy < hit * hit) break;   // reached the target
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(prey.x, prey.y, prey.radius + 5 * S, 0, TAU); ctx.stroke();
  ctx.restore();
}

// The serpent's death cinematic: the coil tracing its circle until it detonates, after which only
// the particle blast remains. Drawn like the live serpent (seam-aware, across toroidal offsets so
// a circle straddling an edge never streaks), but destroyed segments are NOT redrawn as circles -
// only the surviving segments and the head show. The spine line still runs through every position.
function drawSnakeOutro(b) {
  if (b.exploded) return;   // nothing left but the burst (drawn as particles)
  const ctx = g.ctx, { cx, cy, HW, HH, S, MUTED } = g;
  const W = HW * 2, H2 = HH * 2, mg = b.r + 4 * S;
  let lx = false, rx = false, ty = false, by = false;
  for (const n of b.nodes) {
    if (n.ax < cx - HW + mg) lx = true; else if (n.ax > cx + HW - mg) rx = true;
    if (n.ay < cy - HH + mg) ty = true; else if (n.ay > cy + HH - mg) by = true;
  }
  const xs = [0]; if (lx) xs.push(W); if (rx) xs.push(-W);
  const ys = [0]; if (ty) ys.push(H2); if (by) ys.push(-H2);
  ctx.save();
  ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.strokeStyle = BOSS_COLOR; ctx.shadowColor = BOSS_COLOR; ctx.shadowBlur = 10;
  for (const ox of xs) for (const oy of ys) {
    ctx.save(); ctx.translate(ox, oy);
    for (let i = 1; i < b.nodes.length; i++) {   // spine line through every node position (shortest-wrapped, no streaks)
      const a = b.nodes[i - 1], n = b.nodes[i];
      let dx = n.ax - a.ax, dy = n.ay - a.ay;
      if (dx > HW) dx -= W; else if (dx < -HW) dx += W;
      if (dy > HH) dy -= H2; else if (dy < -HH) dy += H2;
      ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.lineTo(a.ax + dx, a.ay + dy); ctx.stroke();
    }
    for (const n of b.nodes) {
      if (n.dead) continue;   // destroyed segments stay gone - never recovered for the death animation
      ctx.strokeStyle = n.kind === 'head' ? MUTED : BOSS_COLOR;
      ctx.beginPath(); ctx.arc(n.ax, n.ay, n.r, 0, TAU); ctx.stroke();
      if (n.kind === 'head') { ctx.globalAlpha = 0.25; ctx.fillStyle = MUTED; ctx.fill(); ctx.globalAlpha = 1; }
    }
    ctx.restore();
  }
  ctx.restore();
}

export function drawBoss() {
  const boss = g.boss;
  if (!boss) return;
  const ctx = g.ctx, { cx, cy, HW, HH, S, MUTED } = g;
  const b = boss;
  if (b.dying) { if (b.type === 'megastructure') drawMegaOutro(b); else drawSnakeOutro(b); return; }   // only the cinematic
  if (b.grace > 0) { drawBossOutline(b); return; }
  ctx.save();
  ctx.strokeStyle = BOSS_COLOR; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.shadowColor = BOSS_COLOR; ctx.shadowBlur = 10;
  if (b.type === 'segmented') {
    const W = HW * 2, H2 = HH * 2, mg = b.r + 4 * S;
    drawSerpentHunt(b);   // dotted intent path to the asteroid it's chasing (under the body)
    let lx = false, rx = false, ty = false, by = false;
    for (const n of b.nodes) {
      if (n.ax < cx - HW + mg) lx = true; else if (n.ax > cx + HW - mg) rx = true;
      if (n.ay < cy - HH + mg) ty = true; else if (n.ay > cy + HH - mg) by = true;
    }
    const xs = [0]; if (lx) xs.push(W); if (rx) xs.push(-W);
    const ys = [0]; if (ty) ys.push(H2); if (by) ys.push(-H2);
    for (const ox of xs) for (const oy of ys) {
      ctx.save(); ctx.translate(ox, oy);
      ctx.globalAlpha = 0.4;
      for (let i = 1; i < b.nodes.length; i++) {
        const a = b.nodes[i - 1], n = b.nodes[i];
        let dx = n.ax - a.ax, dy = n.ay - a.ay;
        if (dx > HW) dx -= W; else if (dx < -HW) dx += W;
        if (dy > HH) dy -= H2; else if (dy < -HH) dy += H2;
        ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.lineTo(a.ax + dx, a.ay + dy); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const n of b.nodes) {
        if (n.dead) continue;
        ctx.strokeStyle = n.kind === 'head' ? MUTED : BOSS_COLOR;
        ctx.beginPath(); ctx.arc(n.ax, n.ay, n.r, 0, TAU); ctx.stroke();
        if (n.kind === 'head') { ctx.globalAlpha = 0.25; ctx.fillStyle = MUTED; ctx.fill(); ctx.globalAlpha = 1; }
      }
      ctx.restore();
    }
  } else if (b.type === 'megastructure') {
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
    if (!b.rimGone) {
      const finale = b.rimState === 'finale';
      const ft = finale ? Math.min(1, b.finaleT / 0.85) : 0;
      ctx.save();
      if (finale) {   // shake the whole shell: high frequency, low amplitude, ramping up
        const amp = (0.6 + 2.4 * ft) * S;
        ctx.translate(Math.sin(b.finaleT * 50) * amp, Math.cos(b.finaleT * 57) * amp);
      }
      // Blit the pre-baked shell sprite instead of re-stroking several full-field shadowBlur
      // circles each frame. shadowBlur must be off for the blit, or the bitmap gets its own
      // (expensive) shadow pass; the surrounding save/restore returns it to the boss default.
      const shell = megaShellSprite(b), half = b._shellHalf;
      ctx.shadowBlur = 0;
      ctx.drawImage(shell, -half, -half, 2 * half, 2 * half);
      ctx.restore();   // end shell layer (undo shake, restore shadowBlur)
      ctx.shadowColor = BOSS_COLOR; ctx.strokeStyle = BOSS_COLOR;
    }
    const mcore = b.nodes.find((n) => n.kind === 'core');
    if (mcore && !mcore.dead && onField(b.x, b.y, mcore.r)) {
      const exposed = bossNodeVulnerable(b, mcore);
      ctx.strokeStyle = exposed ? BOSS_COLOR : MUTED;
      ctx.beginPath(); ctx.arc(0, 0, mcore.r, 0, TAU); ctx.stroke();
      if (exposed) { ctx.globalAlpha = 0.32; ctx.fillStyle = BOSS_COLOR; ctx.beginPath(); ctx.arc(0, 0, mcore.r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = BOSS_COLOR;
    }
    ctx.restore();
    if (b.rimState === 'sliding') drawMegaRadar(b);   // radar sweep + pings (world space)
  } else {   // mothership - detailed carrier saucer
    const core = b.nodes[0], frac = Math.max(0, core.hp / core.maxhp);
    ctx.save(); ctx.translate(b.x, b.y);   // no rotation - it hovers level
    const r = b.r;
    ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(-r * 0.55, -r * 0.32); ctx.lineTo(r * 0.55, -r * 0.32);
    ctx.lineTo(r, 0); ctx.lineTo(r * 0.55, r * 0.3); ctx.lineTo(-r * 0.55, r * 0.3); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
    ctx.globalAlpha = 0.45;
    for (let i = -4; i <= 4; i++) { const x = i * r * 0.2; ctx.beginPath(); ctx.moveTo(x, -r * 0.06); ctx.lineTo(x, r * 0.06); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.32); ctx.quadraticCurveTo(0, -r * 0.85, r * 0.45, -r * 0.32); ctx.stroke();
    ctx.save(); ctx.fillStyle = UFO_REWARD_COLOR; ctx.shadowColor = UFO_REWARD_COLOR; ctx.shadowBlur = 8;
    const bay = 0.6 + 0.4 * Math.sin(b.t * 4);
    for (let i = -2; i <= 2; i++) { ctx.globalAlpha = bay; ctx.beginPath(); ctx.arc(i * r * 0.32, r * 0.18, 2.6 * S, 0, TAU); ctx.fill(); }
    ctx.restore();
    const pulse = 0.5 + 0.5 * Math.sin(b.t * 3);
    ctx.save();
    ctx.shadowColor = BOSS_COLOR; ctx.shadowBlur = 16 + pulse * 14;
    ctx.fillStyle = BOSS_COLOR; ctx.globalAlpha = 0.3 + pulse * 0.4;
    ctx.beginPath(); ctx.arc(0, -r * 0.05, r * 0.15 + pulse * r * 0.05, 0, TAU); ctx.fill();
    ctx.restore();
    const cracks = Math.round((1 - frac) * 5);
    if (cracks > 0) {
      ctx.globalAlpha = 0.65;
      for (let i = 0; i < cracks; i++) {
        const a = (i / 5) * TAU + 0.6;
        const x0 = Math.cos(a) * r * 0.22, y0 = Math.sin(a) * r * 0.1;
        const x1 = Math.cos(a) * r * 0.72, y1 = Math.sin(a) * r * 0.26;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo((x0 + x1) / 2 + r * 0.05, (y0 + y1) / 2); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  ctx.restore();
}

export function drawBossBar() {
  const boss = g.boss;
  if (!boss || boss.grace > 0 || boss.dying) return;   // hidden during the arrival outline and the death cinematic
  const ctx = g.ctx, { cx, cy, HW, HH } = g;
  let hp = 0, max = 0;
  for (const n of boss.nodes) { if (!isFinite(n.maxhp)) continue; hp += Math.max(0, n.hp); max += n.maxhp; }   // skip the invulnerable serpent head
  const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  // Sits a little below the top edge (clear of the scope frame). Sharp corners + a thin white
  // hairline echo the scope frame and the rest of the HUD - the site's look, not a glossy capsule.
  const w = 2 * HW * 0.5, h = 6, x = cx - w / 2, y = cy - HH + 40;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  // Boss name above the bar: mono caps in the boss colour with a soft glow (small text, cheap blur).
  ctx.font = '600 12px ' + MONO;
  ctx.shadowColor = BOSS_COLOR; ctx.shadowBlur = 8;
  ctx.fillStyle = BOSS_COLOR; ctx.fillText(BOSS_NAMES[boss.type] || 'BOSS', cx, y - 8);
  ctx.shadowBlur = 0;
  // Track: a flat, faint dark fill.
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x, y, w, h);
  // Fill: boss violet with a subtle top-down sheen. No bar-wide shadowBlur (it would be a per-frame
  // software blur across a near-field-width box).
  if (frac > 0) {
    const fw = w * frac;
    const grd = ctx.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, '#c78cff'); grd.addColorStop(1, BOSS_COLOR);
    ctx.fillStyle = grd; ctx.fillRect(x, y, fw, h);
  }
  // Faint segment notches every 10%, then a thin hairline frame (white, like the scope's inner line).
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 1; i < 10; i++) { const tx = x + (w * i) / 10; ctx.moveTo(tx, y); ctx.lineTo(tx, y + h); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
