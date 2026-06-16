/* Analyser - Asteroids easter egg: the per-frame simulation step.
   Advances particles / projectiles / power-ups, runs the ship's controls and the active
   weapon, moves the roaming entities (UFOs, missiles, drones, boss), and resolves every
   collision. The nuke cinematic is handled at the top (play frozen). Reads constant-
   within-a-frame refs via a destructure; written scalars (and the boss, which a sub-call
   can clear mid-frame) go through `g.`. */

import { RIPPLE_DUR, ULTRASOUND_TICK, SPAWN_INVULN, LIGHTNING_HALF, TAU, rand } from './config.js';
import { g, immortal, ultrasoundRadius, lightningRange } from './state.js';
import { hardEdges, wrap, edgeBounceShip, edgeReflect, rayToRim } from './geometry.js';
import { resetShip, spawnWave, destroyAsteroid, loseLife, applyPowerup, burst } from './world.js';
import { fireWeapon, findLightningTarget, spawnMissile, updateMissiles } from './weapons.js';
import { updateUfos, damageUfo } from './ufos.js';
import { updateDrones } from './drones.js';
import { updateBoss, hitBossAt, damageBossNode, bossNodeVulnerable, bossNodePos } from './boss.js';
import { endGame } from './leaderboard.js';

export function update(dt) {
  const { cx, cy, HW, HH, S, ship, input, joy, asteroids, bullets, particles, powerups, lasers, ufos, missiles, ripples } = g;

  // Nuclear cinematic: freeze play, keep the scope empty, then respawn or end.
  if (g.nuke > 0) {
    g.nuke -= dt;
    asteroids.length = 0; bullets.length = 0; lasers.length = 0; powerups.length = 0; particles.length = 0; ufos.length = 0; missiles.length = 0;
    g.lightningTarget = null;
    if (g.nuke <= 0) {
      g.nuke = 0;
      g.overlay.style.cursor = '';   // cursor back once the cinematic ends
      if (g.lives <= 0) endGame();
      else { resetShip(SPAWN_INVULN); if (!g.boss) spawnWave(); }   // a surviving boss keeps the wave going
    }
    return;
  }
  g.clock += dt;

  // Debris particles: drift, slow, spin, fade.
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    const f = Math.exp(-1.6 * dt); p.vx *= f; p.vy *= f;
    p.ang += p.spin * dt; p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // Laser beam flashes fade out fast.
  for (let i = lasers.length - 1; i >= 0; i--) { lasers[i].life -= dt; if (lasers[i].life <= 0) lasers.splice(i, 1); }

  // Ultrasound ripples expand outward to the rim, then vanish.
  for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].p += dt / RIPPLE_DUR; if (ripples[i].p >= 1) ripples.splice(i, 1); }

  // Timed weapon power-ups revert to the normal cannon when they run out.
  if (g.weaponTimer > 0 && !g.sbInfinite && !g.gunsOff) { g.weaponTimer -= dt; if (g.weaponTimer <= 0) { g.weapon = 'normal'; g.weaponTimer = 0; g.homingLeft = 0; } }
  if (g.shield > 0 && !g.sbInfinite) g.shield -= dt;
  if (g.ramHitCd > 0) g.ramHitCd -= dt;
  if (g.megaMsgT > 0) g.megaMsgT -= dt;   // narrator box counts down
  // Decay power-up drop heat so recently-dropped types gradually become likely again.
  for (const t in g.dropHeat) g.dropHeat[t] *= Math.exp(-0.06 * dt);

  // Power-ups drift, wrap, expire, and are collected by flying over them.
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.x += p.vx * dt; p.y += p.vy * dt; wrap(p); p.life -= dt;
    if (p.life <= 0) { powerups.splice(i, 1); continue; }
    if (!ship.dead && !g.gameOver) {
      const dx = p.x - ship.x, dy = p.y - ship.y, rr = p.radius + 11 * S;
      if (dx * dx + dy * dy < rr * rr) {
        applyPowerup(p.type);
        burst(p.x, p.y, p.color, { count: 10, speed: 95, life: 0.4 });
        powerups.splice(i, 1);
      }
    }
  }

  if (ship.dead) {
    // Hold on the wreck, then respawn (with immunity) or end the game.
    g.lightningTarget = null;
    g.deathTimer -= dt;
    if (g.deathTimer <= 0) { if (g.lives <= 0) endGame(); else resetShip(SPAWN_INVULN); }
  } else if (g.hideShip) {
    // Ship hidden during the mega's death cinematic - frozen, uncontrollable, no firing.
    ship.vx = 0; ship.vy = 0; g.lightningTarget = null;
  } else {
    if (joy.active) {
      // Turn toward the stick, but no faster than the keyboard's rotate rate.
      let d = joy.angle - ship.angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));   // shortest signed delta
      const max = 4.6 * dt;
      ship.angle += Math.max(-max, Math.min(max, d));
    } else {
      if (input.left) ship.angle -= 4.6 * dt;
      if (input.right) ship.angle += 4.6 * dt;
    }
    const ramming = g.weapon === 'ram';
    // The battering ram accelerates much harder, lifts the speed cap, and runs higher drag.
    const accel = ramming ? 900 : 270;
    if (input.thrust) { ship.vx += Math.cos(ship.angle) * accel * S * dt; ship.vy += Math.sin(ship.angle) * accel * S * dt; }
    const drag = Math.exp(-(ramming ? 1.2 : 0.55) * dt);
    ship.vx *= drag; ship.vy *= drag;
    const sp = Math.hypot(ship.vx, ship.vy), MAX = 430 * S;
    if (sp > MAX && !ramming) { ship.vx = ship.vx / sp * MAX; ship.vy = ship.vy / sp * MAX; }
    ship.x += ship.vx * dt; ship.y += ship.vy * dt;
    if (hardEdges()) edgeBounceShip(); else wrap(ship);
    if (ship.invuln > 0) ship.invuln -= dt;
    g.fireCd -= dt;
    if (g.gunsOff) {
      g.lightningTarget = null;   // emergency guns offline - nothing fires
    } else if (g.weapon === 'lightning') {
      // Only active while fire is held: lock the closest target in the cone and tick it at
      // the normal gun's cadence. Releasing fire drops the lock and the bolt entirely.
      if (input.fire) {
        g.lightningTarget = findLightningTarget();
        g.lightningMidTimer -= dt;
        const reroll = g.lightningMidTimer <= 0;
        if (reroll || g.lightningAirAngle === null) g.lightningAirAngle = rand(-LIGHTNING_HALF, LIGHTNING_HALF);
        // The bolt's far end: a locked target, or a random point on the range arc.
        if (g.lightningTarget) {
          g.lightningEnd = { x: g.lightningTarget.x, y: g.lightningTarget.y };
        } else {
          const ang = ship.angle + g.lightningAirAngle;
          const c = Math.cos(ang), s = Math.sin(ang);
          const reach = Math.min(lightningRange(), rayToRim(ship.x, ship.y, c, s));
          g.lightningEnd = { x: ship.x + c * reach, y: ship.y + s * reach };
        }
        // Re-roll the mid kink, stored in the ship's rotating frame so it tracks heading.
        if (g.lightningEnd && (reroll || !g.lightningMid)) {
          const dx = g.lightningEnd.x - ship.x, dy = g.lightningEnd.y - ship.y;
          const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
          const t = rand(0.3, 0.7), j = rand(-1, 1) * len * 0.18;
          const mox = dx * t + nx * j, moy = dy * t + ny * j;   // world-space offset from the ship
          const ca = Math.cos(ship.angle), sa = Math.sin(ship.angle);
          g.lightningMid = { lx: mox * ca + moy * sa, ly: -mox * sa + moy * ca };   // -> ship-local frame
        }
        if (reroll) g.lightningMidTimer = 0.1;
        if (g.lightningTarget && g.fireCd <= 0) {
          const ai = asteroids.indexOf(g.lightningTarget);
          if (ai >= 0) destroyAsteroid(ai);
          else if (g.lightningTarget._bossNode) { if (g.boss) damageBossNode(g.boss, g.lightningTarget._bossNode, 1, g.lightningTarget.x, g.lightningTarget.y); }
          else { const ui = ufos.indexOf(g.lightningTarget); if (ui >= 0) damageUfo(ui, 1); }
          g.fireCd = 0.18;
        }
      } else {
        g.lightningTarget = null; g.lightningEnd = null;   // not firing: no lock, no bolt
      }
    } else if (g.weapon === 'ultrasound') {
      // Auto AoE: a sonar pulse destroying everything within the radius every tick.
      g.lightningTarget = null;
      g.rippleTimer -= dt;
      if (g.rippleTimer <= 0) { ripples.push({ p: 0 }); g.rippleTimer = ULTRASOUND_TICK; }
      if (g.fireCd <= 0) {
        for (let ai = asteroids.length - 1; ai >= 0; ai--) {
          const a = asteroids[ai];
          if (a.grace > 0) continue;
          const dx = a.x - ship.x, dy = a.y - ship.y, rr = ultrasoundRadius() + a.radius;
          if (dx * dx + dy * dy < rr * rr) destroyAsteroid(ai);
        }
        for (let ui = ufos.length - 1; ui >= 0; ui--) {
          const u = ufos[ui];
          if (u.kind !== 'reward' || u.appear < 1) continue;
          const dx = u.x - ship.x, dy = u.y - ship.y, rr = ultrasoundRadius() + u.radius;
          if (dx * dx + dy * dy < rr * rr) damageUfo(ui, 1);
        }
        if (g.boss) for (const n of g.boss.nodes) {
          if (!bossNodeVulnerable(g.boss, n)) continue;
          const [nx, ny] = bossNodePos(g.boss, n);
          const dx = nx - ship.x, dy = ny - ship.y, rr = ultrasoundRadius() + n.r;
          if (dx * dx + dy * dy < rr * rr) damageBossNode(g.boss, n, 1, nx, ny);
        }
        g.fireCd = ULTRASOUND_TICK;
      }
    } else if (g.weapon === 'homing') {
      g.lightningTarget = null;
      if (g.homingLeft > 0) {
        // Mid-burst: release the ring one missile at a time in quick succession.
        g.homingGap -= dt;
        while (g.homingLeft > 0 && g.homingGap <= 0) {
          spawnMissile(g.homingBase + (g.homingIdx / 12) * TAU);
          g.homingIdx++; g.homingLeft--; g.homingGap += 0.07;
        }
        if (g.homingLeft === 0) { g.fireCd = 3; g.homingTrickle = 1; }   // start the 3s cooldown
      } else if (g.fireCd > 0) {
        // During the cooldown, trickle a single forward missile once a second.
        g.homingTrickle -= dt;
        if (g.homingTrickle <= 0) { if (input.fire) spawnMissile(ship.angle); g.homingTrickle += 1; }
      } else if (input.fire) {
        g.homingBase = ship.angle; g.homingIdx = 0; g.homingLeft = 12; g.homingGap = 0;   // begin a burst
      }
    } else {
      g.lightningTarget = null;
      if (input.fire && g.fireCd <= 0) fireWeapon();
    }
  }

  const hard = hardEdges();
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (hard) {
      if (b.x < cx - HW || b.x > cx + HW || b.y < cy - HH || b.y > cy + HH) { bullets.splice(i, 1); continue; }
    } else wrap(b);
    if (b.life <= 0) bullets.splice(i, 1);
  }

  for (const a of asteroids) {
    a.x += a.vx * dt; a.y += a.vy * dt; a.angleR += a.spin * dt;
    if (hard) edgeReflect(a); else wrap(a);   // ping-pong off the solid walls during the mega fight
    if (a.grace > 0) a.grace -= dt;   // count down the spawn-grace (no hitbox)
  }

  // Bullet -> asteroid. Asteroids still in spawn-grace have no hitbox.
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (let ai = asteroids.length - 1; ai >= 0; ai--) {
      const a = asteroids[ai];
      if (a.grace > 0) continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      if (dx * dx + dy * dy < a.radius * a.radius) {
        destroyAsteroid(ai);
        if (b.pierce > 0) { b.pierce--; break; }   // survive the hit, one less pierce left
        bullets.splice(bi, 1); break;
      }
    }
  }

  // Bullet -> reward UFO (ambient escorts are indestructible, so bullets pass them).
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (let ui = ufos.length - 1; ui >= 0; ui--) {
      const u = ufos[ui];
      if (u.kind !== 'reward' || u.appear < 1) continue;
      const dx = u.x - b.x, dy = u.y - b.y;
      if (dx * dx + dy * dy < u.radius * u.radius) {
        damageUfo(ui, 1);
        if (b.pierce > 0) { b.pierce--; break; }
        bullets.splice(bi, 1); break;
      }
    }
  }

  // Bullet -> boss node (covers the drone's shots too, since they're normal bullets).
  if (g.boss) for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    if (hitBossAt(b.x, b.y, 2 * S, 1)) {
      if (b.pierce > 0) { b.pierce--; continue; }
      bullets.splice(bi, 1);
    }
  }

  updateUfos(dt);       // move/fade the roaming UFOs and check their lethal contact
  updateMissiles(dt);   // home + detonate any homing missiles in flight
  updateDrones(dt);     // move/fire the drone wingmen and check their contacts
  updateBoss(dt);       // move the boss, check its lethal contact, handle its death

  // Asteroid -> ship. With the ram up the ship is unharmed and smashes head-on hits;
  // otherwise a hit costs a life (skipped while dead, immune, shielded, or in grace).
  if (!ship.dead && !g.gameOver) {
    const ramming = g.weapon === 'ram';
    for (let ai = asteroids.length - 1; ai >= 0; ai--) {
      const a = asteroids[ai];
      if (a.grace > 0) continue;
      const dx = a.x - ship.x, dy = a.y - ship.y, rr = a.radius + 11 * S;
      if (dx * dx + dy * dy >= rr * rr) continue;
      if (ramming) {
        // Each ram hit punches one target, then briefly can't hit again (ship invulnerable).
        if (g.ramHitCd <= 0 && ship.vx * dx + ship.vy * dy > 0) {
          destroyAsteroid(ai);
          g.ramHitCd = 0.2; ship.invuln = Math.max(ship.invuln, 0.2);
          break;
        }
        continue;   // ram never harms the ship; can't hit while on cooldown
      }
      if (ship.invuln <= 0 && g.shield <= 0 && !immortal()) { g.cause = a.label; loseLife(); }
      break;
    }
  }
}
