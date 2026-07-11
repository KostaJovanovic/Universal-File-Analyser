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

export function spawnBullet(angle, speed, life, sniper, pierce) {
  if (g.bullets.length >= MAX_BULLETS) return;
  const { ship, S } = g;
  const c = Math.cos(angle), s = Math.sin(angle);
  g.bullets.push({
    x: ship.x + c * 14 * S, y: ship.y + s * 14 * S,
    vx: c * speed + ship.vx, vy: s * speed + ship.vy, life, sniper: !!sniper,
    pierce: pierce | 0   // extra asteroids this round punches through before dying
  });
}
// Like spawnBullet but from an arbitrary origin (the drone), with no inherited ship velocity.
export function spawnBulletAt(x, y, angle, speed, life, sniper, pierce) {
  if (g.bullets.length >= MAX_BULLETS) return;
  const c = Math.cos(angle), s = Math.sin(angle);
  g.bullets.push({ x, y, vx: c * speed, vy: s * speed, life, sniper: !!sniper, pierce: pierce | 0 });
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
  const consider = (o) => {
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

export function spawnMissileFrom(x, y, angle) {
  if (g.missiles.length >= 64) return;
  const c = Math.cos(angle), s = Math.sin(angle);
  g.missiles.push({ x: x + c * 14 * g.S, y: y + s * 14 * g.S, angle, life: 3.5 });
}
export function spawnMissile(angle) { spawnMissileFrom(g.ship.x, g.ship.y, angle); }

// Nearest solid asteroid or reward UFO to a point, measured across the toroidal seam (ambient
// escorts skipped - a missile can't hurt them).
export function nearestSeekTarget(x, y) {
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

// Missiles travel slowly but turn toward their nearest target each frame, so they curve
// in; they detonate on the first thing they touch.
export function updateMissiles(dt) {
  const { cx, cy, HW, HH, S, missiles, asteroids, ufos, boss } = g;
  const spd = 300 * S, turn = 8 * dt;
  const homingColor = POWERUP_DEF.homing.color;
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.life -= dt;
    if (m.life <= 0) { burst(m.x, m.y, homingColor, { count: 6, speed: 80, life: 0.3 }); missiles.splice(i, 1); continue; }
    const tgt = nearestSeekTarget(m.x, m.y);
    if (tgt) {
      const [tdx, tdy] = wrapDelta(m.x, m.y, tgt.x, tgt.y);   // steer the short way round the seam
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
