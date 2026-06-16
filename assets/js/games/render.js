/* Analyser - Asteroids easter egg: all canvas drawing.
   The per-entity vector painters (ship, asteroids, UFOs, power-ups, bullets, the weapon
   effects, particles), the HUD / wave banner / weapon timer, the left-margin leaderboard
   and FPS readout, the nuke flash DOM layer, and render() which composes one frame. The
   boss visuals live in boss.js; this calls into them. */

import {
  LINE, MONO, POWERUP_DEF, TAU, SPAWN_INVULN, WAVE_GRACE, WRECK_FADE,
  NUKE_TOTAL, NUKE_WHITE, NUKE_FADE, BOSS_COLOR
} from './config.js';
import { g, ultrasoundRadius, laserWidth } from './state.js';
import { withWrap, hardEdges, rayToRim } from './geometry.js';
import { drawBoss, drawBossBar, drawMegaMessage, BOSS_NAMES } from './boss.js';

// Fixed HUD font strings, built once. Setting ctx.font from these avoids the per-frame
// string concatenation (and its garbage) that the HUD/leaderboard otherwise do ~15x a
// frame. Variable-size fonts (the wave banner, asteroid labels) are cached at their source.
const F10 = '10px ' + MONO, F11 = '11px ' + MONO, F12 = '12px ' + MONO,
  F13 = '13px ' + MONO, F14 = '14px ' + MONO, F15 = '15px ' + MONO,
  F18 = '18px ' + MONO, F34 = '34px ' + MONO;

// The glowing scope frame (outer accent border + glow + inner hairline) is static
// between layouts, yet a per-frame shadowBlur over a full-field rectangle is one of
// the most expensive ops the canvas can do (a software blur across the whole field,
// CPU-bound regardless of GPU). So bake it once into an offscreen canvas keyed by
// size/dpr/hard-edge state and just blit the bitmap each frame; it only re-renders on
// a resize or when the mega fight flips the frame to solid white.
function scopeFrameLayer() {
  const { dpr, HW, HH, ACCENT } = g;
  const hard = hardEdges();
  const pad = 44;                                  // room for the blur to spill past the rect
  const w = 2 * HW + pad * 2, h = 2 * HH + pad * 2;
  const key = Math.round(HW) + 'x' + Math.round(HH) + ':' + dpr + ':' + (hard ? 1 : 0);
  if (g._scopeKey !== key) {
    const cv = g._scopeCv || (g._scopeCv = document.createElement('canvas'));
    cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const fw = 2 * HW, fh = 2 * HH;
    c.save();
    c.shadowColor = hard ? '#fff' : ACCENT; c.shadowBlur = hard ? 26 : 18;
    c.strokeStyle = hard ? '#fff' : ACCENT; c.lineWidth = hard ? 3 : 2;
    c.strokeRect(pad, pad, fw, fh);
    c.restore();
    c.strokeStyle = hard ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)'; c.lineWidth = 1;
    c.strokeRect(pad + 5, pad + 5, fw - 10, fh - 10);
    g._scopeKey = key; g._scopePad = pad; g._scopeW = w; g._scopeH = h;
  }
  return g._scopeCv;
}

// A background flyer: the same hull as the player, dimmed and slightly smaller.
function drawFlyer(f) {
  const ctx = g.ctx, S = g.S;
  ctx.save();
  ctx.globalAlpha = f.alpha;
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle);
  ctx.scale(0.85 * S, 0.85 * S);
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.3; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9);
  ctx.closePath(); ctx.stroke();
  if (Math.random() > 0.35) {
    ctx.strokeStyle = '#ffb3bd';
    ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-16, 0); ctx.lineTo(-6, 4); ctx.stroke();
  }
  ctx.restore();
}

// A roaming UFO: a vector saucer in its kind's colour. No rotation - it stays level.
function drawUfo(u) {
  const ctx = g.ctx, S = g.S, clock = g.clock;
  const r = 16;   // base half-width; scaled by S below
  ctx.save();
  ctx.globalAlpha = u.appear;
  ctx.translate(u.x, u.y);
  ctx.scale(S, S);
  ctx.strokeStyle = u.color; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.shadowColor = u.color; ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(-r * 0.55, -r * 0.34);
  ctx.lineTo(r * 0.55, -r * 0.34);
  ctx.lineTo(r, 0);
  ctx.lineTo(r * 0.55, r * 0.30);
  ctx.lineTo(-r * 0.55, r * 0.30);
  ctx.closePath(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, -r * 0.34);
  ctx.quadraticCurveTo(0, -r * 0.95, r * 0.5, -r * 0.34);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = u.color;
  for (let i = -1; i <= 1; i++) {
    if ((Math.floor(clock * 4) + i) & 1) {
      ctx.beginPath(); ctx.arc(i * r * 0.42, r * 0.30, r * 0.1, 0, TAU); ctx.fill();
    }
  }
  // The ambient escort is indestructible - ring it with a pulsing shield bubble.
  if (u.kind === 'ambient') {
    ctx.globalAlpha = u.appear * (0.5 + 0.3 * Math.abs(Math.sin(clock * 3)));
    ctx.strokeStyle = u.color; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

function drawShipAt(x, y) {
  const ctx = g.ctx, { S, ship, input, ACCENT } = g, clock = g.clock;
  // Fade the ship in over the first 0.6s after a (re)spawn.
  const fade = Math.min(1, (SPAWN_INVULN - ship.invuln) / 0.6);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(S, S);   // scale the whole ship with the scope
  // Blue charge glow under the ship while firing with lightning equipped.
  if (g.weapon === 'lightning' && input.fire) {
    ctx.save();
    ctx.globalAlpha = fade * (0.4 + 0.2 * Math.abs(Math.sin(clock * 8)));
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 38);
    gr.addColorStop(0, 'rgba(59,91,219,0.8)');   // #3b5bdb, the lightning colour
    gr.addColorStop(1, 'rgba(59,91,219,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(0, 0, 38, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // Immunity is signalled by a pulsing circle around the ship.
  if (ship.invuln > 0) {
    ctx.globalAlpha = fade * (0.45 + 0.45 * Math.abs(Math.sin(clock * 6)));
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.stroke();
  }
  // Health-at-full shield: a steadier green bubble, blinking out in its final second.
  if (g.shield > 0 && !(g.shield < 1 && (Math.floor(g.shield * 8) & 1))) {
    ctx.globalAlpha = fade * (0.55 + 0.25 * Math.abs(Math.sin(clock * 3)));
    ctx.strokeStyle = POWERUP_DEF.health.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = fade;
  ctx.rotate(ship.angle);
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9);
  ctx.closePath(); ctx.stroke();
  if (g.weapon === 'ram') {
    // Two lines forming an arrow ahead of the nose - the battering-ram charge tip.
    const c = POWERUP_DEF.ram.color;
    ctx.save();
    ctx.globalAlpha = fade * (0.7 + 0.3 * Math.abs(Math.sin(clock * 9)));
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.shadowColor = c; ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(19, -8); ctx.lineTo(30, 0); ctx.lineTo(19, 8);
    ctx.stroke();
    ctx.restore();
  }
  if (input.thrust && (Math.random() > 0.35)) {
    ctx.strokeStyle = ACCENT;
    ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-16, 0); ctx.lineTo(-6, 4); ctx.stroke();
  }
  ctx.restore();
}
// The drifting wreck left by a nuke: a dimmed, tumbling hull.
function drawWreck() {
  if (!g.wreck) return;
  const ctx = g.ctx, S = g.S, MUTED = g.MUTED, wreck = g.wreck;
  const fade = g.nuke > 0 ? 1 : Math.max(0, 1 - wreck.fade / WRECK_FADE);
  if (fade <= 0) return;
  withWrap(wreck.x, wreck.y, 21 * S, (x, y) => {
    ctx.save();
    ctx.globalAlpha = 0.7 * fade;
    ctx.translate(x, y);
    ctx.scale(S, S);
    ctx.rotate(wreck.angle);
    ctx.strokeStyle = MUTED; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  });
}
function drawShip() {
  if (g.ship.dead || g.nuke > 0 || g.splash) return;
  withWrap(g.ship.x, g.ship.y, 21 * g.S, drawShipAt);
}

function drawAsteroidAt(a, x, y) {
  const ctx = g.ctx, ACCENT = g.ACCENT, clock = g.clock;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.strokeStyle = a.size === 3 ? ACCENT : LINE;
  // While in spawn-grace (no hitbox) the outline is stripey and dimmed, dashes marching.
  const grace = a.grace > 0;
  if (grace) { ctx.setLineDash([6, 5]); ctx.lineDashOffset = -clock * 36; ctx.globalAlpha = 0.5; }
  ctx.beginPath();
  for (let i = 0; i < a.verts.length; i++) {
    const v = a.verts[i], ang = a.angleR + v.a, r = a.radius * v.r;
    const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);
  // Label only once the asteroid is solid (has a hitbox); hidden during grace, or globally
  // when the player has turned asteroid labels off in Settings.
  if (!grace && !g.settings.hideAsteroidText) {
    ctx.fillStyle = a.size === 3 ? ACCENT : '#e6e6e6';
    ctx.font = a.fontStr;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(a.label, 0, 0);
  }
  ctx.restore();
}
function drawAsteroid(a) {
  withWrap(a.x, a.y, a.radius, (x, y) => drawAsteroidAt(a, x, y));
}

// Radiation trefoil as vector paths - three 60° blades around a central dot.
function drawTrefoil(s) {
  const ctx = g.ctx;
  const rOut = s * 0.92, rIn = s * 0.34, dot = s * 0.17, h = Math.PI / 6;
  for (let k = 0; k < 3; k++) {
    const c = Math.PI / 2 + k * (TAU / 3);
    ctx.beginPath();
    ctx.arc(0, 0, rOut, c - h, c + h);
    ctx.arc(0, 0, rIn, c + h, c - h, true);
    ctx.closePath(); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(0, 0, dot, 0, TAU); ctx.fill();
}

// Little drone dart (the same arrowhead the wingmen draw), pointing up and centred in the box.
function drawDroneIcon(s) {
  const ctx = g.ctx;
  const f = s * 0.11;   // wingman units -> box scale
  // The wingman outline rotated to point up and recentred on the origin.
  const pts = [[0, -7.5], [-6, 7.5], [0, 4.5], [6, 7.5]];
  ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * f, pts[0][1] * f);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * f, pts[i][1] * f);
  ctx.closePath(); ctx.stroke();
}

function drawPowerupAt(p, x, y) {
  if (p.life < 3 && (Math.floor(p.life * 8) & 1)) return;   // blink as it nears expiry
  const ctx = g.ctx, clock = g.clock;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 + 0.08 * Math.sin(clock * 5), 1 + 0.08 * Math.sin(clock * 5));   // gentle pulse
  const s = p.radius;
  ctx.strokeStyle = p.color; ctx.lineWidth = 1.6;
  ctx.strokeRect(-s, -s, s * 2, s * 2);
  ctx.fillStyle = p.color;
  if (p.type === 'nuke') {
    drawTrefoil(s);
  } else if (p.type === 'drone') {
    drawDroneIcon(s);
  } else {
    // Scale the glyph to the box (which tracks S) - a fixed px size overflows tiny boxes on
    // small screens and the letters end up overlapping their borders.
    ctx.font = '600 ' + Math.max(8, Math.round(s * 1.15)) + 'px ' + MONO;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.letter, 0, 1);
  }
  ctx.restore();
}
function drawPowerup(p) { withWrap(p.x, p.y, p.radius, (x, y) => drawPowerupAt(p, x, y)); }

// Append a jagged electric polyline from (ax,ay) to (bx,by) to `out` as flat x,y pairs,
// re-jittered each frame. Building points (rather than path ops) lets the same bolt be
// re-stroked at wrap offsets so its toroidal ghosts match instead of jittering apart.
function jaggedPts(ax, ay, bx, by, out) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const segs = Math.max(2, Math.round(len / 22));
  out.push(ax, ay);
  for (let i = 1; i < segs; i++) {
    const t = i / segs, j = (Math.random() - 0.5) * 12;
    out.push(ax + dx * t + nx * j, ay + dy * t + ny * j);
  }
  out.push(bx, by);
}

// Three anchors: the ship, a player-relative mid kink, and the bolt's end. When the end sits
// past a wrapping edge (a target across the seam) the bolt is re-stroked at the wrap offset so
// it continues in from the opposite edge; the field clip hides the off-field halves.
function drawLightning() {
  if (g.weapon !== 'lightning' || !g.lightningEnd || !g.lightningMid || g.ship.dead || g.gameOver || g.nuke > 0) return;
  const ctx = g.ctx, ship = g.ship, lightningMid = g.lightningMid, lightningEnd = g.lightningEnd;
  const { cx, cy, HW, HH } = g;
  const sx = ship.x + Math.cos(ship.angle) * 14, sy = ship.y + Math.sin(ship.angle) * 14;
  const ca = Math.cos(ship.angle), sa = Math.sin(ship.angle);
  const mx = ship.x + lightningMid.lx * ca - lightningMid.ly * sa;
  const my = ship.y + lightningMid.lx * sa + lightningMid.ly * ca;
  const pts = [];
  jaggedPts(sx, sy, mx, my, pts);
  jaggedPts(mx, my, lightningEnd.x, lightningEnd.y, pts);   // appends; the shared mid is harmlessly duplicated
  ctx.save();
  ctx.strokeStyle = POWERUP_DEF.lightning.color;
  ctx.shadowColor = POWERUP_DEF.lightning.color; ctx.shadowBlur = 10;
  ctx.lineWidth = 2; ctx.lineJoin = 'round';
  const strokeAt = (ox, oy) => {
    ctx.beginPath();
    ctx.moveTo(pts[0] + ox, pts[1] + oy);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + ox, pts[i + 1] + oy);
    ctx.stroke();
  };
  strokeAt(0, 0);
  // If the end ran off an edge, draw the bolt shifted so the tail re-enters from the far side.
  if (!hardEdges()) {
    let ox = 0, oy = 0;
    if (lightningEnd.x > cx + HW) ox = -2 * HW; else if (lightningEnd.x < cx - HW) ox = 2 * HW;
    if (lightningEnd.y > cy + HH) oy = -2 * HH; else if (lightningEnd.y < cy - HH) oy = 2 * HH;
    if (ox || oy) {
      strokeAt(ox, oy);
      if (ox && oy) { strokeAt(ox, 0); strokeAt(0, oy); }   // corner wrap: cover both single-axis images too
    }
  }
  ctx.restore();
}

// Ultrasound aura: a white border circle at the kill radius, plus light-blue ripples.
// The pulse reaches the same distance the kill check does, so it ghosts across the
// toroidal seam (withWrap) - except during the mega fight, where the walls are solid.
function drawUltrasound() {
  if (g.weapon !== 'ultrasound' || g.ship.dead || g.gameOver || g.nuke > 0) return;
  const ctx = g.ctx, ship = g.ship, S = g.S, R = ultrasoundRadius();
  const paint = (x, y) => {
    for (const rp of g.ripples) {
      ctx.globalAlpha = (1 - rp.p) * 0.6;
      ctx.strokeStyle = POWERUP_DEF.ultrasound.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6 * S + (R - 6 * S) * rp.p, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
  };
  if (hardEdges()) paint(ship.x, ship.y); else withWrap(ship.x, ship.y, R, paint);
}

function drawLasers() {
  const ctx = g.ctx, ACCENT = g.ACCENT;
  for (const lz of g.lasers) {
    const a = Math.max(0, lz.life / lz.max);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = POWERUP_DEF.laser.color;
    ctx.globalAlpha = a * 0.22;
    ctx.lineWidth = laserWidth();
    ctx.beginPath(); ctx.moveTo(lz.x1, lz.y1); ctx.lineTo(lz.x2, lz.y2); ctx.stroke();
    ctx.globalAlpha = a;
    ctx.shadowColor = ACCENT; ctx.shadowBlur = 14;
    ctx.lineWidth = 2 + 3 * a;
    ctx.beginPath(); ctx.moveTo(lz.x1, lz.y1); ctx.lineTo(lz.x2, lz.y2); ctx.stroke();
    ctx.restore();
  }
}

// Laser sight: a thin dashed line from the ship's nose to the rim along its heading.
function drawLaserSight() {
  if (g.weapon !== 'laser' || g.ship.dead || g.gameOver || g.nuke > 0) return;
  const ctx = g.ctx, ship = g.ship, S = g.S, clock = g.clock;
  const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
  const t = rayToRim(ship.x, ship.y, c, s);
  const ex = ship.x + c * t, ey = ship.y + s * t;
  ctx.save();
  ctx.strokeStyle = POWERUP_DEF.laser.color; ctx.fillStyle = POWERUP_DEF.laser.color;
  ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]); ctx.lineDashOffset = -clock * 30;
  ctx.beginPath();
  ctx.moveTo(ship.x + c * 14 * S, ship.y + s * 14 * S);
  ctx.lineTo(ex, ey); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.arc(ex, ey, 3 * S, 0, TAU); ctx.fill();
  ctx.restore();
}

// Homing missiles: a small dart pointing along its heading with a flickering exhaust.
function drawMissiles() {
  const ctx = g.ctx, S = g.S, ACCENT = g.ACCENT;
  for (const m of g.missiles) {
    withWrap(m.x, m.y, 6 * S, (x, y) => {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(m.angle); ctx.scale(S, S);
      if (Math.random() > 0.3) {   // exhaust flicker
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-9, 0); ctx.stroke();
      }
      ctx.fillStyle = POWERUP_DEF.homing.color;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
  }
}

// The drone wingmen: small gold darts trailing the ship, each pointing where it shoots.
function drawDrones() {
  if (!g.drones.length) return;
  const ctx = g.ctx, S = g.S;
  const c = POWERUP_DEF.drone.color;
  for (const d of g.drones) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);
    ctx.scale(S, S);
    ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.shadowColor = c; ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
}

function drawParticles() {
  const ctx = g.ctx;
  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    if (p.len) {
      // Endpoints computed directly from the angle - cheaper than a save/translate/rotate/restore per shard.
      const hx = Math.cos(p.ang) * p.len / 2, hy = Math.sin(p.ang) * p.len / 2;
      ctx.strokeStyle = p.color; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(p.x - hx, p.y - hy); ctx.lineTo(p.x + hx, p.y + hy); ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.3, p.y - 1.3, 2.6, 2.6);
    }
  }
  ctx.globalAlpha = 1;
}

// Batch every bullet of one tint into a single filled path, inlining the toroidal ghost
// copies so an edge-crossing round still shows on both sides. One fill per tint per frame.
function drawBulletSet(sniper, color) {
  const ctx = g.ctx, { cx, cy, HW, HH } = g;
  const r = (sniper ? 2.8 : 2.2) * g.S;
  let any = false;
  ctx.beginPath();
  for (const b of g.bullets) {
    if (!!b.sniper !== sniper) continue;
    any = true;
    const ox = (b.x - r < cx - HW) ? 2 * HW : (b.x + r > cx + HW) ? -2 * HW : 0;
    const oy = (b.y - r < cy - HH) ? 2 * HH : (b.y + r > cy + HH) ? -2 * HH : 0;
    ctx.moveTo(b.x + r, b.y); ctx.arc(b.x, b.y, r, 0, TAU);
    if (ox) { ctx.moveTo(b.x + ox + r, b.y); ctx.arc(b.x + ox, b.y, r, 0, TAU); }
    if (oy) { ctx.moveTo(b.x + r, b.y + oy); ctx.arc(b.x, b.y + oy, r, 0, TAU); }
    if (ox && oy) { ctx.moveTo(b.x + ox + r, b.y + oy); ctx.arc(b.x + ox, b.y + oy, r, 0, TAU); }
  }
  if (any) { ctx.fillStyle = color; ctx.fill(); }
}

function hud() {
  const ctx = g.ctx, { cx, cy, HW, HH, MUTED, ACCENT, ON_DARK } = g;
  ctx.textBaseline = 'alphabetic';
  const top = cy - HH - 14;   // baseline of the big figures, hugging the top edge
  // Score - top-left, with the persistent high score under it.
  ctx.textAlign = 'left';
  ctx.font = F12; ctx.fillStyle = MUTED; ctx.fillText('SCORE', cx - HW, top - 17);
  ctx.font = F18; ctx.fillStyle = ACCENT; ctx.fillText(String(g.score).padStart(5, '0'), cx - HW, top);
  ctx.font = F11; ctx.fillStyle = MUTED; ctx.fillText('HIGH ' + String(g.highScore).padStart(5, '0'), cx - HW, top + 15);
  // Wave - top-right (always the plain wave number; the boss's name shows in the centre banner).
  ctx.textAlign = 'right';
  ctx.font = F12; ctx.fillStyle = MUTED; ctx.fillText('WAVE', cx + HW, top - 17);
  ctx.font = F18; ctx.fillStyle = ON_DARK; ctx.fillText(String(g.wave), cx + HW, top);
  // Lives + controls below the field.
  ctx.textAlign = 'center';
  ctx.font = F15; ctx.fillStyle = LINE;
  ctx.fillText(g.lives > 0 ? '▲ '.repeat(g.lives).trim() : '—', cx, cy + HH + 24);
  // Keyboard controls + top title are desktop-only.
  if (!g.isTouch) {
    ctx.font = F12; ctx.fillStyle = MUTED;
    ctx.fillText('← → rotate · ↑ thrust · space fire · r reset · esc exit', cx, cy + HH + 44);
    ctx.font = F11; ctx.fillStyle = MUTED;
    ctx.fillText('ASTEROIDS · SUPPORTED FORMATS', cx, 24);
  }
  if (g.sandbox) {
    ctx.fillStyle = ACCENT; ctx.font = F10;
    ctx.fillText('SANDBOX' + (g.cheatInvuln ? ' · INVULN' : '') + ' · SCORE OFF', cx, 38);
  }
}

// Massive banner centred on screen while the new wave spawns in: the wave numeral, or - on a
// boss wave - the boss's name (in the boss colour) instead of the number.
function waveBanner(graceLeft) {
  const ctx = g.ctx, { W, H, cx, cy, HW } = g, clock = g.clock;
  const FADE = 0.6;
  const elapsed = WAVE_GRACE - graceLeft;
  const env = Math.max(0, Math.min(1, elapsed / FADE, graceLeft / FADE));
  const alpha = env * (0.5 + 0.1 * Math.sin(clock * 4));
  if (alpha <= 0) return;
  const isBoss = !!(g.boss && g.boss.grace > 0);
  const label = isBoss ? (BOSS_NAMES[g.boss.type] || 'BOSS') : String(g.wave);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = isBoss ? BOSS_COLOR : LINE;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Heavy and tall (~80% of the field), then shrunk to fit ~80% of the width so long boss names
  // (and double-digit waves) never run off the sides.
  let size = Math.round(Math.min(W, H) * 0.8);
  ctx.font = '900 ' + size + 'px ' + MONO;
  const maxW = Math.min(W, 2 * HW) * 0.8, tw = ctx.measureText(label).width;
  if (tw > maxW) { size = Math.max(18, Math.round(size * maxW / tw)); ctx.font = '900 ' + size + 'px ' + MONO; }
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

// Active weapon power-up + countdown, colour-coded, tracking just under the ship.
function drawWeaponTimer() {
  if (g.weapon === 'normal' || g.ship.dead || g.gameOver || g.nuke > 0) return;
  const ctx = g.ctx, ship = g.ship;
  const def = POWERUP_DEF[g.weapon];
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = def.color;
  ctx.font = F12;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(def.label + ' · ' + (g.sbInfinite ? '∞' : g.weaponTimer.toFixed(1) + 's'), ship.x, ship.y + 26);
  ctx.restore();
}

// Nuclear flash: drives the top-most DOM layer's opacity. "Reduce flashing" flips it black.
function nukeFlash() {
  let a = 0;
  if (g.nuke > 0) {
    const elapsed = NUKE_TOTAL - g.nuke;
    if (elapsed < NUKE_WHITE) a = 1;
    else if (elapsed < NUKE_WHITE + NUKE_FADE) a = 1 - (elapsed - NUKE_WHITE) / NUKE_FADE;
  }
  const bg = g.settings.reduceFlash ? '#000' : '#fff';
  if (bg !== g.nukeTint) { g.nukeEl.style.background = bg; g.nukeTint = bg; }
  const v = String(Math.max(0, a));
  if (g.nukeEl.style.opacity !== v) g.nukeEl.style.opacity = v;
}

function gameOverScreen() {
  const ctx = g.ctx, { cx, cy, ACCENT, MUTED, ON_DARK } = g;
  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT; ctx.font = F34; ctx.fillText('GAME OVER', cx, cy - 16);
  ctx.fillStyle = ON_DARK; ctx.font = F15;
  ctx.fillText('score ' + g.score + ' · wave ' + g.wave, cx, cy + 14);
  if (g.newHigh) { ctx.fillStyle = POWERUP_DEF.health.color; ctx.font = F14; ctx.fillText('★ NEW HIGH SCORE', cx, cy + 36); }
  else { ctx.fillStyle = MUTED; ctx.font = F13; ctx.fillText('high ' + g.highScore, cx, cy + 36); }
}

// The global top 5, drawn down the left margin. Hidden on narrow / mobile layouts.
function drawLeaderboard() {
  if (!g.leaderboard.length) return;
  const ctx = g.ctx, { cx, cy, HW, MUTED, ACCENT } = g;
  const margin = 24, colW = 150;
  if (cx - HW < colW + margin + 20) return;
  const x = margin;
  let y = cy - 58;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = F12; ctx.fillStyle = MUTED; ctx.fillText('HIGH SCORES', x, y);
  y += 22;
  ctx.font = F13;
  for (let i = 0; i < g.leaderboard.length; i++) {
    const s = g.leaderboard[i];
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED; ctx.fillText((i + 1) + '.', x, y);
    ctx.fillStyle = LINE; ctx.fillText(String(s.name), x + 22, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = ACCENT; ctx.fillText(Number(s.score).toLocaleString(), x + colW, y);
    y += 20;
  }
  ctx.textAlign = 'left';
}

// Optional debug readout (Settings -> Show FPS / bodies), bottom-left of the viewport.
function drawFps() {
  const ctx = g.ctx, { MUTED, H } = g;
  const parts = ['FPS ' + Math.round(g.fps)];
  const bodies = g.asteroids.length + g.ufos.length + (g.boss ? 1 : 0);
  if (bodies) parts.push('BODIES ' + bodies);
  if (g.bullets.length) parts.push('BULLETS ' + g.bullets.length);
  if (g.powerups.length) parts.push('POWERUPS ' + g.powerups.length);
  ctx.save();
  ctx.font = F11; ctx.fillStyle = MUTED;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(parts.join(' · '), 12, H - 12);
  ctx.restore();
}

export function render() {
  const ctx = g.ctx, { dpr, W, H, cx, cy, HW, HH, ACCENT, settings, boss } = g;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Screen shake during the mega's cinematic send-off (the serpent shakes its own corpse instead).
  if (boss && boss.dying && boss.type === 'megastructure') {
    const t = boss.outroT, amp = (t < 4 ? 1.5 + t * 1.5 : Math.max(0, 7.5 - (t - 4) * 1.3)) * g.S;
    if (amp > 0) ctx.translate((Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp);
  }

  ctx.save();
  ctx.beginPath(); ctx.rect(cx - HW, cy - HH, 2 * HW, 2 * HH); ctx.clip();
  // faint scope fill + starfield, drawn live on the main canvas (GPU-native). NOT baked to an
  // offscreen layer: a field-sized cached canvas blitted per frame only pays off when it
  // replaces something expensive (cf. the scope frame's blur), and every extra 2D canvas
  // risks tripping Chrome's accelerated-canvas cap and demoting all of them to software.
  ctx.fillStyle = 'rgba(255,255,255,0.015)'; ctx.fillRect(cx - HW, cy - HH, 2 * HW, 2 * HH);
  if (settings.bgDetail) {
    for (const s of g.stars) { ctx.globalAlpha = s.b; ctx.fillStyle = '#bbb'; ctx.fillRect(cx + s.x * HW, cy + s.y * HH, 1.4, 1.4); }
    ctx.globalAlpha = 1;
    for (const f of g.flyers) drawFlyer(f);   // background squadrons, behind the action
  }
  for (const u of g.ufos) drawUfo(u);
  drawBoss();
  for (const a of g.asteroids) drawAsteroid(a);
  for (const p of g.powerups) drawPowerup(p);
  // Bullets: sniper rounds are a touch larger and accent-tinted; others are dots. Batched
  // into one path per tint (with toroidal ghosts inlined) - a single fill beats a fillStyle
  // change plus up to four arc/fill calls per bullet.
  drawBulletSet(false, LINE);
  drawBulletSet(true, ACCENT);
  drawMissiles();
  drawUltrasound();
  drawLaserSight();
  drawLasers();
  drawLightning();
  drawParticles();
  drawWreck();
  drawDrones();
  if (!g.gameOver && !g.hideShip) drawShip();
  ctx.restore();

  // scope frame with a soft accent glow - solid white during the mega fight. Pre-baked
  // into an offscreen layer (see scopeFrameLayer) so the costly blur runs once per layout,
  // not every frame; here it's a single cheap bitmap blit (shaken with the scene above).
  const cv = scopeFrameLayer();
  ctx.drawImage(cv, cx - HW - g._scopePad, cy - HH - g._scopePad, g._scopeW, g._scopeH);

  if (!g.gameOver && !g.splash) {
    let graceLeft = g.asteroids.reduce((m, a) => (a.solo ? m : Math.max(m, a.grace)), 0);   // solo asteroids don't flash the wave number
    if (boss && boss.grace > 0) graceLeft = Math.max(graceLeft, boss.grace);   // boss waves get the banner too
    if (graceLeft > 0) waveBanner(graceLeft);
  }
  drawWeaponTimer();
  if (!g.splash) hud();
  drawBossBar();
  if (g.megaMsgT > 0 && boss && !boss.dying) drawMegaMessage();
  drawLeaderboard();
  if (settings.showFps) drawFps();
  nukeFlash();
  // The end-of-game DOM card carries the headline + board now; the canvas version is a fallback.
  if (g.gameOver && !g.endPanel) gameOverScreen();
}
