/* Analyser - Asteroids easter egg: the player's guns + homing missiles.
   Bullet spawning, the piercing laser beam, lightning auto-aim target selection, the
   per-weapon fire cadence, and the slow homing missiles that curve into the nearest
   asteroid / reward UFO. The timed-weapon update logic itself lives in update.js; this
   module is the firing + projectile mechanics. */

import { MAX_BULLETS, LIGHTNING_HALF, POWERUP_DEF, rand } from './config.js';
import { g, lightningRange, laserWidth } from './state.js';
import { rayToRim, distToSeg, hardEdges, wrap, wrapDelta } from './geometry.js';
import { burst, destroyAsteroid } from './world.js';
import { damageUfo } from './ufos.js';
import { bossNodeVulnerable, bossNodePos, damageBossNode } from './boss.js';

/** A round in flight, from the ship or a drone. `pierce` counts the extra
 *  asteroids it punches through before dying (sniper rounds only). */
export interface Bullet {
  x: number; y: number; vx: number; vy: number;
  life: number; sniper: boolean; pierce: number;
  [k: string]: any;
}

/** One frame of the laser beam flash - a segment that fades over `max` seconds. */
export interface Laser {
  x1: number; y1: number; x2: number; y2: number; life: number; max: number;
  [k: string]: any;
}

/** A homing missile. `target` is whatever it has claimed (an asteroid, a reward
 *  UFO or a boss node - see the retarget pass below), or null while unassigned. */
export interface Missile {
  x: number; y: number; angle: number; life: number;
  target: any; avoidBoss: boolean;
  [k: string]: any;
}

export function spawnBullet(angle: number, speed: number, life: number, sniper: boolean, pierce?: number|undefined) {
  if (g.bullets.length >= MAX_BULLETS) return;
  const { ship, S } = g;
  const c = Math.cos(angle), s = Math.sin(angle);
  g.bullets.push({
    x: ship.x + c * 14 * S, y: ship.y + s * 14 * S,
    vx: c * speed + ship.vx, vy: s * speed + ship.vy, life, sniper: !!sniper,
    pierce: pierce! | 0   // extra asteroids this round punches through before dying (omitted -> 0)
  });
}
// Like spawnBullet but from an arbitrary origin (the drone), with no inherited ship velocity.
export function spawnBulletAt(x: number, y: number, angle: number, speed: number, life: number, sniper?: boolean|undefined, pierce?: number|undefined) {
  if (g.bullets.length >= MAX_BULLETS) return;
  const c = Math.cos(angle), s = Math.sin(angle);
  g.bullets.push({ x, y, vx: c * speed, vy: s * speed, life, sniper: !!sniper, pierce: pierce! | 0 });
}

export function fireLaser() {
  const { ship, boss } = g;
  const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
  const t = rayToRim(ship.x, ship.y, c, s);
  const ex = ship.x + c * t, ey = ship.y + s * t;
  g.lasers.push({ x1: ship.x, y1: ship.y, x2: ex, y2: ey, life: 0.14, max: 0.14 });
  // Piercing: destroy every solid asteroid whose centre lies on the beam.
  for (let ai = g.asteroids.length - 1; ai >= 0; ai--) {
    const a = g.asteroids[ai];
    if (a.grace > 0) continue;
    if (distToSeg(a.x, a.y, ship.x, ship.y, ex, ey) < a.radius + laserWidth() / 2) destroyAsteroid(ai);
  }
  // The beam also rakes reward UFOs along its length (2 damage - it's the heavy gun).
  for (let ui = g.ufos.length - 1; ui >= 0; ui--) {
    const u = g.ufos[ui];
    if (u.kind !== 'reward' || u.appear < 1) continue;
    if (distToSeg(u.x, u.y, ship.x, ship.y, ex, ey) < u.radius + laserWidth() / 2) damageUfo(ui, 2);
  }
  if (boss) for (const n of boss.nodes) {
    if (!bossNodeVulnerable(boss, n)) continue;
    const [nx, ny] = bossNodePos(boss, n);
    if (distToSeg(nx, ny, ship.x, ship.y, ex, ey) < n.r + laserWidth() / 2) damageBossNode(boss, n, 2, nx, ny);
  }
}

// Lightning auto-aim: the nearest solid asteroid within the 35° front cone and range, or null.
// Distance + bearing are measured across the toroidal seam, so a target just over a wrapping
// edge is fair game (the bolt is drawn wrapping round to it).
export function findLightningTarget() {
  const { ship, boss } = g;
  let best = null, bestD = Infinity;
  // `_bossNode` rides along on the boss-node candidates so the winner can be
  // traced back to the node it came from; every other caller passes a bare entity.
  const consider = (o: { x: number; y: number; _bossNode?: any }) => {
    const [dx, dy] = wrapDelta(ship.x, ship.y, o.x, o.y);
    const dist = Math.hypot(dx, dy);
    if (dist > lightningRange() || dist >= bestD) return;
    let d = Math.atan2(dy, dx) - ship.angle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > LIGHTNING_HALF) return;
    best = o; bestD = dist;
  };
  for (const a of g.asteroids) { if (a.grace > 0) continue; consider(a); }
  for (const u of g.ufos) { if (u.kind === 'reward' && u.appear >= 1) consider(u); }
  if (boss) for (const n of boss.nodes) {
    if (!bossNodeVulnerable(boss, n)) continue;
    const [nx, ny] = bossNodePos(boss, n);
    consider({ x: nx, y: ny, _bossNode: n });
  }
  return best;
}

// Fire the current weapon and set the cooldown to its cadence.
export function fireWeapon() {
  const { ship, S } = g;
  if (g.weapon === 'ram') return;                                               // contact weapon - no shot
  if (g.weapon === 'laser') { fireLaser(); g.fireCd = 0.18 / 0.25; return; }     // 25% of normal rate
  if (g.weapon === 'machine') {
    spawnBullet(ship.angle + rand(-3, 3) * Math.PI / 180, 1080 * S, 0.9, false);   // ±3° jitter
    g.fireCd = 0.08; return;
  }
  if (g.weapon === 'triple') {
    const spread = 20 * Math.PI / 180;
    spawnBullet(ship.angle - spread, 540 * S, 0.9, false);
    spawnBullet(ship.angle, 540 * S, 0.9, false);
    spawnBullet(ship.angle + spread, 540 * S, 0.9, false);
    g.fireCd = 0.18; return;
  }
  if (g.weapon === 'sniper') { spawnBullet(ship.angle, 1080 * S, Infinity, true, 1); g.fireCd = 0.4; return; }   // punches through one into a second
  spawnBullet(ship.angle, 540 * S, 0.9, false); g.fireCd = 0.18;                 // normal
}

// Every fourth missile off the rail is flagged boss-averse: during a boss fight it steers
// at anything but the boss while another target is on the field, so the swarm never pours
// itself entirely into the boss and ignores the rocks around the ship.
let missileSeq = 0;
export function spawnMissileFrom(x: number, y: number, angle: number) {
  if (g.missiles.length >= 64) return;
  const c = Math.cos(angle), s = Math.sin(angle);
  const avoidBoss = (missileSeq++ % 4) === 3;
  g.missiles.push({ x: x + c * 14 * g.S, y: y + s * 14 * g.S, angle, life: 3.5, target: null, avoidBoss });
}
export function spawnMissile(angle: number) { spawnMissileFrom(g.ship.x, g.ship.y, angle); }

// Nearest solid asteroid or reward UFO to a point, measured across the toroidal seam (ambient
// escorts skipped - a missile can't hurt them).
export function nearestSeekTarget(x: number, y: number) {
  const { boss } = g;
  let best = null, bestD = Infinity;
  for (const a of g.asteroids) {
    if (a.grace > 0) continue;
    const [dx, dy] = wrapDelta(x, y, a.x, a.y);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = a; }
  }
  for (const u of g.ufos) {
    if (u.kind !== 'reward' || u.appear < 1) continue;
    const [dx, dy] = wrapDelta(x, y, u.x, u.y);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = u; }
  }
  if (boss) for (const n of boss.nodes) {
    if (!bossNodeVulnerable(boss, n)) continue;
    if (boss.type === 'megastructure' && n.kind === 'core') continue;   // core is ram-only
    const [nx, ny] = bossNodePos(boss, n);
    const [dx, dy] = wrapDelta(x, y, nx, ny);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
  }
  return best;
}

// --- Homing missile target assignment ----------------------------------------
// A missile claims one target and keeps it until that target is eliminated. Each
// frame the free (unclaimed) missiles are handed out greedily - closest pairs claim
// first - and every target is filled to death before any doubling up: an asteroid
// needs one missile, a reward UFO or boss node needs its remaining HP. Only once all
// targets are saturated do surplus missiles double up (nearest), so a big burst is
// never wasted and never dogpiles a single rock it could have spread across.

// Is this claimed target still a valid thing to fly at?
// `t` is deliberately untyped: a claimed target is whichever of three unrelated
// entities (asteroid / reward UFO / boss node) the missile locked on to, and this
// identifies which by membership rather than by shape.
function targetAlive(t: any) {
  if (!t) return false;
  if (g.asteroids.includes(t)) return t.grace <= 0;
  if (g.ufos.includes(t)) return t.kind === 'reward' && t.appear >= 1 && t.hp > 0;
  const boss = g.boss;
  if (boss && boss.nodes.includes(t)) return bossNodeVulnerable(boss, t) && !(boss.type === 'megastructure' && t.kind === 'core');
  return false;
}

// Current position of a target (boss nodes ride the boss body, so recompute).
function targetPos(t: any) {
  const boss = g.boss;
  if (boss && boss.nodes.includes(t)) return bossNodePos(boss, t);
  return [t.x, t.y];
}

/** One entry in the per-frame target roster: the entity, how many missiles it
 *  still wants filled to death, where it is, and whether it belongs to the boss. */
interface SeekSlot { obj: any; need: number; x: number; y: number; boss: boolean }

// Every valid target with the missile count it wants (fill-to-death) and its position.
function collectTargets(): SeekSlot[] {
  const out: SeekSlot[] = [];
  for (const a of g.asteroids) { if (a.grace > 0) continue; out.push({ obj: a, need: 1, x: a.x, y: a.y, boss: false }); }
  for (const u of g.ufos) { if (u.kind !== 'reward' || u.appear < 1 || u.hp <= 0) continue; out.push({ obj: u, need: Math.max(1, Math.ceil(u.hp)), x: u.x, y: u.y, boss: false }); }
  const boss = g.boss;
  if (boss) for (const n of boss.nodes) {
    if (!bossNodeVulnerable(boss, n)) continue;
    if (boss.type === 'megastructure' && n.kind === 'core') continue;   // core is ram-only
    const [nx, ny] = bossNodePos(boss, n);
    out.push({ obj: n, need: Math.max(1, Math.ceil(n.hp)), x: nx, y: ny, boss: true });
  }
  return out;
}

// Release missiles whose target died, then assign the freed ones greedily.
function retargetMissiles() {
  const { missiles } = g;
  if (!missiles.length) return;
  for (const m of missiles) if (m.target && !targetAlive(m.target)) m.target = null;
  const free = missiles.filter((m: Missile) => !m.target);
  if (!free.length) return;
  const targets = collectTargets();
  if (!targets.length) return;   // nothing to lock onto - free missiles keep their heading
  // A boss-averse missile ignores the boss whenever a non-boss target is on the field.
  const nonBossExists = targets.some((t) => !t.boss);
  const eligible = (m: Missile, t: SeekSlot) => !(m.avoidBoss && t.boss && nonBossExists);
  // Remaining capacity per target = its need minus the missiles already committed to it.
  const cap = new Map();
  for (const t of targets) cap.set(t.obj, t.need);
  for (const m of missiles) if (m.target && cap.has(m.target)) cap.set(m.target, cap.get(m.target) - 1);
  // Greedy fill: sort every (free missile, eligible target-with-capacity) pair by distance, closest claims first.
  const pairs = [];
  for (const m of free) for (const t of targets) {
    if (cap.get(t.obj) <= 0 || !eligible(m, t)) continue;
    const [dx, dy] = wrapDelta(m.x, m.y, t.x, t.y);
    pairs.push({ m, obj: t.obj, d: dx * dx + dy * dy });
  }
  pairs.sort((p, q) => p.d - q.d);
  for (const p of pairs) {
    if (p.m.target || cap.get(p.obj) <= 0) continue;
    p.m.target = p.obj; cap.set(p.obj, cap.get(p.obj) - 1);
  }
  // Overflow: every eligible target is saturated but missiles remain - they double up on the nearest.
  for (const m of free) {
    if (m.target) continue;
    let best = null, bd = Infinity;
    for (const t of targets) { if (!eligible(m, t)) continue; const [dx, dy] = wrapDelta(m.x, m.y, t.x, t.y); const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = t.obj; } }
    m.target = best;
  }
}

// Missiles travel slowly but turn toward their claimed target each frame, so they curve
// in; they detonate on the first thing they touch.
export function updateMissiles(dt: number) {
  const { cx, cy, HW, HH, S, missiles, asteroids, ufos, boss } = g;
  const spd = 300 * S, turn = 8 * dt;
  const homingColor = POWERUP_DEF.homing.color;
  retargetMissiles();
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.life -= dt;
    if (m.life <= 0) { burst(m.x, m.y, homingColor, { count: 6, speed: 80, life: 0.3 }); missiles.splice(i, 1); continue; }
    if (m.target && targetAlive(m.target)) {
      const [tx, ty] = targetPos(m.target);
      const [tdx, tdy] = wrapDelta(m.x, m.y, tx, ty);   // steer the short way round the seam
      let d = Math.atan2(tdy, tdx) - m.angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      m.angle += Math.max(-turn, Math.min(turn, d));
    }
    m.x += Math.cos(m.angle) * spd * dt; m.y += Math.sin(m.angle) * spd * dt;
    if (hardEdges()) {
      if (m.x < cx - HW || m.x > cx + HW || m.y < cy - HH || m.y > cy + HH) {
        burst(m.x, m.y, homingColor, { count: 6, speed: 80, life: 0.3 }); missiles.splice(i, 1); continue;
      }
    } else wrap(m);
    let hit = false;
    for (let ai = asteroids.length - 1; ai >= 0; ai--) {
      const a = asteroids[ai];
      if (a.grace > 0) continue;
      const dx = a.x - m.x, dy = a.y - m.y, rr = a.radius + 4 * S;
      if (dx * dx + dy * dy < rr * rr) { destroyAsteroid(ai); hit = true; break; }
    }
    if (!hit) {
      for (let ui = ufos.length - 1; ui >= 0; ui--) {
        const u = ufos[ui];
        if (u.kind !== 'reward' || u.appear < 1) continue;
        const dx = u.x - m.x, dy = u.y - m.y, rr = u.radius + 4 * S;
        if (dx * dx + dy * dy < rr * rr) { damageUfo(ui, 1); hit = true; break; }
      }
    }
    if (!hit && boss) {
      for (const n of boss.nodes) {
        if (!bossNodeVulnerable(boss, n)) continue;
        const [nx, ny] = bossNodePos(boss, n);
        const dx = nx - m.x, dy = ny - m.y, rr = n.r + 4 * S;
        if (dx * dx + dy * dy < rr * rr) { damageBossNode(boss, n, 1, nx, ny); hit = true; break; }
      }
    }
    if (hit) { burst(m.x, m.y, homingColor, { count: 8, speed: 110, life: 0.35 }); missiles.splice(i, 1); }
  }
}
