/* Analyser - Asteroids easter egg: roaming UFOs.
   Two kinds fly predictable closed paths mapped into the field rectangle (so the shape
   adapts to the arena / a resize): a teal reward saucer (destructible, drops a power-up)
   and a magenta ambient escort (indestructible, leaves once the wave is cleared). Both
   are lethal on contact and never shoot. */

import { TAU, rand, pick, UFO_PATTERNS, UFO_REWARD_COLOR, UFO_AMBIENT_COLOR } from './config.js';
import { g, immortal, saveHi } from './state.js';
import { burst, makePowerup, loseLife } from './world.js';

export function ufoPathPos(u) {
  const { cx, cy, HW, HH } = g;
  const kx = HW * 0.78, ky = HH * 0.78;   // path fills most of the rectangle
  let nx, ny;
  if (u.pattern === 'circle') {
    const a = u.rot + u.t * TAU;
    nx = Math.cos(a); ny = Math.sin(a);
  } else if (u.pattern === 'figure8') {
    const a = u.rot + u.t * TAU;
    nx = Math.sin(a); ny = Math.sin(2 * a) * 0.7;
  } else {
    // Equilateral triangle (3) or square (4): walk the perimeter between vertices.
    const n = u.pattern === 'triangle' ? 3 : 4;
    const f = (((u.t % 1) + 1) % 1) * n, i = Math.floor(f) % n, fr = f - Math.floor(f);
    const va = u.rot + (i / n) * TAU, vb = u.rot + (((i + 1) % n) / n) * TAU;
    const ax = Math.cos(va), ay = Math.sin(va), bx = Math.cos(vb), by = Math.sin(vb);
    nx = ax + (bx - ax) * fr; ny = ay + (by - ay) * fr;
  }
  return [cx + nx * kx, cy + ny * ky];
}

export function makeUfo(kind) {
  const u = {
    kind, pattern: pick(UFO_PATTERNS), rot: rand(0, TAU), t: Math.random(),
    period: rand(20, 34), radius: 16 * g.S, hp: kind === 'reward' ? 2 : Infinity,
    color: kind === 'reward' ? UFO_REWARD_COLOR : UFO_AMBIENT_COLOR,
    appear: 0, leaving: false, lvx: 0, lvy: 0, x: g.cx, y: g.cy
  };
  const [px, py] = ufoPathPos(u); u.x = px; u.y = py;   // start on the path, not the centre
  return u;
}

// The ambient escort "goes away after everything else was cleared": send any lingering
// ambient UFO out of the arena along the outward radial when a fresh wave begins.
export function dismissAmbientUfos() {
  const { cx, cy, S } = g;
  for (const u of g.ufos) {
    if (u.kind === 'ambient' && !u.leaving) {
      u.leaving = true;
      const a = Math.atan2(u.y - cy, u.x - cx) || rand(0, TAU);
      const sp = 170 * S;
      u.lvx = Math.cos(a) * sp; u.lvy = Math.sin(a) * sp;
    }
  }
}

// Damage a reward saucer (ambient ones are indestructible and ignore this). On death it
// pays out points and a guaranteed power-up drop.
export function damageUfo(ui, dmg) {
  const u = g.ufos[ui];
  if (!u || u.kind !== 'reward') return;
  u.hp -= dmg;
  burst(u.x, u.y, u.color, { count: 4, speed: 70, life: 0.3 });
  if (u.hp <= 0) {
    if (!g.sandbox) {
      g.score += 200;
      if (g.score > g.highScore) { g.highScore = g.score; g.newHigh = true; saveHi(); }
    }
    burst(u.x, u.y, u.color, { count: 16, speed: 150, life: 0.7, lines: true });
    burst(u.x, u.y, g.ACCENT, { count: 10, speed: 110, life: 0.5 });
    g.powerups.push(makePowerup(u.x, u.y));   // guaranteed reward drop
    g.ufos.splice(ui, 1);
  }
}

// Move every UFO (path-follow, or the outward exit run once leaving), fade it in, and
// check the lethal contact with the ship. No firing - UFOs never attack.
export function updateUfos(dt) {
  const { cx, cy, HW, HH, S, ship, ufos } = g;
  for (let i = ufos.length - 1; i >= 0; i--) {
    const u = ufos[i];
    if (u.appear < 1) u.appear = Math.min(1, u.appear + dt / 0.5);
    if (u.leaving) {
      u.x += u.lvx * dt; u.y += u.lvy * dt;
      if (u.x < cx - HW - 50 * S || u.x > cx + HW + 50 * S ||
          u.y < cy - HH - 50 * S || u.y > cy + HH + 50 * S) { ufos.splice(i, 1); continue; }
    } else {
      u.t += dt / u.period; if (u.t > 1) u.t -= 1;
      const [px, py] = ufoPathPos(u); u.x = px; u.y = py;
    }
    // Contact. With the ram up the ship is unharmed and instead damages a reward saucer it
    // charges head-on into; otherwise contact with either kind costs a life.
    if (!ship.dead && !g.gameOver && u.appear >= 1) {
      const dx = u.x - ship.x, dy = u.y - ship.y, rr = u.radius + 11 * S;
      if (dx * dx + dy * dy < rr * rr) {
        if (g.weapon === 'ram') {
          if (g.ramHitCd <= 0 && u.kind === 'reward' && ship.vx * dx + ship.vy * dy > 0) {
            damageUfo(i, 1);
            g.ramHitCd = 0.2; ship.invuln = Math.max(ship.invuln, 0.2);
          }
        } else if (ship.invuln <= 0 && g.shield <= 0 && !immortal()) {
          g.cause = 'ufo'; loseLife();
        }
      }
    }
  }
}
