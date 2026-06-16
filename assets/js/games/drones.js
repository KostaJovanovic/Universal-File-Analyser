/* Analyser - Asteroids easter egg: drone wingmen.
   Additive companions (separate from the weapon slot), stackable up to DRONE_MAX, that
   trail the ship in formation, fire their own randomly-rolled weapon at the nearest
   threat, smash what they touch, and can be killed (but share the player's sandbox
   invuln). */

import { DRONE_MAX, DRONE_SLOTS, DRONE_WEAPONS, POWERUP_DEF, rand, pick } from './config.js';
import { g, immortal } from './state.js';
import { burst, destroyAsteroid } from './world.js';
import { damageUfo } from './ufos.js';
import { wrapDelta } from './geometry.js';
import { spawnBulletAt, spawnMissileFrom, nearestSeekTarget } from './weapons.js';

export function makeDrone(forcedWeapon) {
  return { x: g.ship.x, y: g.ship.y, angle: g.ship.angle, hp: 3, timer: POWERUP_DEF.drone.dur, fireCd: rand(0, 0.5), weapon: forcedWeapon || pick(DRONE_WEAPONS) };
}

// Add a wingman with a specific weapon (sandbox), mirroring a pickup: tops up the squad
// timer and adds one if there's room.
export function addDrone(weapon) {
  g.drones.forEach((d) => { d.timer = POWERUP_DEF.drone.dur; });
  if (g.drones.length < DRONE_MAX) g.drones.push(makeDrone(weapon));
}

// Fire a wingman's own weapon toward ang; returns the cooldown until its next shot.
export function droneFire(d, ang) {
  const S = g.S;
  if (d.weapon === 'triple') {
    const sp = 20 * Math.PI / 180;
    spawnBulletAt(d.x, d.y, ang - sp, 540 * S, 0.9);
    spawnBulletAt(d.x, d.y, ang, 540 * S, 0.9);
    spawnBulletAt(d.x, d.y, ang + sp, 540 * S, 0.9);
    return 0.22;
  }
  if (d.weapon === 'machine') { spawnBulletAt(d.x, d.y, ang + rand(-3, 3) * Math.PI / 180, 1080 * S, 0.9); return 0.1; }
  if (d.weapon === 'sniper') { spawnBulletAt(d.x, d.y, ang, 1080 * S, Infinity, true, 1); return 0.5; }
  if (d.weapon === 'homing') { spawnMissileFrom(d.x, d.y, ang); return 0.5; }   // flat 2/sec
  spawnBulletAt(d.x, d.y, ang, 540 * S, 0.9); return 0.22;   // normal
}

export function droneHurt(d) {
  if (immortal()) return;   // sandbox invuln shields the drones along with the player
  d.hp--;
  burst(d.x, d.y, POWERUP_DEF.drone.color, { count: 5, speed: 90, life: 0.3 });
  if (d.hp <= 0) {
    burst(d.x, d.y, POWERUP_DEF.drone.color, { count: 12, speed: 130, life: 0.5, lines: true });
    d.dead = true;
  }
}

// Each drone trails its formation slot, fires at the nearest threat, and smashes what it
// touches. Removed at 0 hp or when its own timer runs out.
export function updateDrones(dt) {
  const { ship, S, drones, ufos, asteroids } = g;
  const ca = Math.cos(ship.angle), sa = Math.sin(ship.angle);
  const k = Math.min(1, dt * 6), dr = 12 * S;
  for (let di = drones.length - 1; di >= 0; di--) {
    const d = drones[di];
    if (!g.sbInfinite) { d.timer -= dt; if (d.timer <= 0) { drones.splice(di, 1); continue; } }
    const [ox, oy] = DRONE_SLOTS[di % DRONE_SLOTS.length];
    const slotX = ship.x + (ox * ca - oy * sa) * S, slotY = ship.y + (ox * sa + oy * ca) * S;
    d.x += (slotX - d.x) * k; d.y += (slotY - d.y) * k;
    // Fire the wingman's own weapon at the nearest threat. Homing reaches across the
    // field; the bullet weapons only engage inside ~the scope radius.
    d.fireCd -= dt;
    if (d.fireCd <= 0) {
      let fired = false;
      if (!ship.dead && !g.gameOver) {
        const tgt = nearestSeekTarget(d.x, d.y);
        if (tgt) {
          const [tdx, tdy] = wrapDelta(d.x, d.y, tgt.x, tgt.y);   // aim/range the short way round the seam
          if (d.weapon === 'homing' || Math.hypot(tdx, tdy) < 520 * S) {
            const ang = Math.atan2(tdy, tdx);
            d.angle = ang; d.fireCd = droneFire(d, ang); fired = true;
          }
        }
      }
      if (!fired) { d.angle = ship.angle; d.fireCd = 0.15; }
    }
    // Contact damage only when not invulnerable: with sandbox invuln on, wingmen have no
    // hitbox at all - everything passes through them (and they don't smash it either).
    if (!immortal()) {
      for (let ai = asteroids.length - 1; ai >= 0; ai--) {
        const a = asteroids[ai];
        if (a.grace > 0) continue;
        const dx = a.x - d.x, dy = a.y - d.y, rr = a.radius + dr;
        if (dx * dx + dy * dy < rr * rr) { destroyAsteroid(ai); droneHurt(d); break; }
      }
      if (!d.dead) {
        for (let ui = ufos.length - 1; ui >= 0; ui--) {
          const u = ufos[ui];
          if (u.appear < 1) continue;
          const dx = u.x - d.x, dy = u.y - d.y, rr = u.radius + dr;
          if (dx * dx + dy * dy < rr * rr) { if (u.kind === 'reward') damageUfo(ui, 1); droneHurt(d); break; }
        }
      }
      if (d.dead) drones.splice(di, 1);
    }
  }
}
