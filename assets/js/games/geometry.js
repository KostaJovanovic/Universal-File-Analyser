/* Analyser - Asteroids easter egg: field geometry + spatial helpers.
   The play field is a rectangle centred on (g.cx, g.cy) with half-extents g.HW/g.HH;
   g.S is the element scale that the whole scene (ships, asteroids, speeds) tracks. The
   toroidal wrap, the solid-wall bounces used during the mega fight, and the small
   ray/segment maths all live here. */

import { rand, MONO } from './config.js';
import { g } from './state.js';

// Measure on the live context but restore its font afterwards, so this never leaks the
// measuring font into the frame (makeAsteroid runs mid-update). Deliberately NOT a private
// offscreen canvas: an extra 2D canvas can trip Chrome's accelerated-canvas cap and demote
// the cached background/scope layers to software, which tanks their per-frame blits.
// The size is quantised to an integer px so the game reuses a small, stable set of font
// sizes - the old fractional sizes meant every asteroid split introduced a brand-new size
// string, making every on-screen label re-rasterise for one frame (the "pulse" on destroy).
export const fitFont = (label, radius) => {
  const ctx = g.ctx;
  const prevFont = ctx.font;
  let f = Math.max(9, radius * 0.6);
  ctx.font = f + 'px ' + MONO;
  const w = ctx.measureText(label).width;
  ctx.font = prevFont;
  const max = radius * 1.5;
  if (w > max) f = Math.max(7, f * max / w);
  return Math.round(f);
};

// The play field follows the viewport but is aspect-clamped between 9:16 (portrait)
// and 16:9 (landscape). Backing-store resolution is native (capped 2x) times the
// render-resolution setting. On a real resize the live scene is rescaled to the new
// scope so nothing jumps.
export function layout() {
  const oldS = g.S, oldCx = g.cx, oldCy = g.cy, oldHW = g.HW, oldHH = g.HH;
  const canvas = g.canvas;
  const baseDpr = Math.min(2, window.devicePixelRatio || 1);
  g.dpr = Math.max(0.5, baseDpr * (g.settings.renderScale || 1));
  const W = canvas.clientWidth || window.innerWidth, H = canvas.clientHeight || window.innerHeight;
  g.W = W; g.H = H;
  canvas.width = Math.round(W * g.dpr); canvas.height = Math.round(H * g.dpr);
  const coarse = g.isTouch;
  const cx = W / 2, cy = coarse ? H * 0.40 : H / 2;
  g.cx = cx; g.cy = cy;
  const padX = coarse ? 14 : 220;
  const padTop = 64;
  const padBottom = coarse ? 120 : 70;
  const maxHW = Math.max(60, W / 2 - padX);
  const maxHH = Math.max(60, Math.min(cy - padTop, H - padBottom - cy));
  const AR_MIN = 9 / 16, AR_MAX = 16 / 9;
  const availW = 2 * maxHW, availH = 2 * maxHH;
  const ar = Math.max(AR_MIN, Math.min(AR_MAX, availW / availH));
  let fw = availW, fh = fw / ar;
  if (fh > availH) { fh = availH; fw = fh * ar; }
  g.HW = fw / 2; g.HH = fh / 2;
  g.R = Math.min(g.HW, g.HH);
  // Element scale: the contents scale strictly linearly with the scope, so their size
  // relative to the field is constant at any zoom / window size.
  g.S = g.R / 470;
  if (oldHW > 0 && oldHH > 0 && (oldHW !== g.HW || oldHH !== g.HH || oldS !== g.S)) {
    rescaleScene(oldS, oldCx, oldCy, oldHW, oldHH);
  }
  // Starfield in field-normalised coords ([-1,1] on each axis), so it survives a resize.
  if (!g.stars.length) {
    for (let i = 0; i < 90; i++) g.stars.push({ x: rand(-1, 1), y: rand(-1, 1), b: rand(0.15, 0.6) });
  }
}

// Rescale every live object to the new scope after a resize/zoom: radii, speeds and
// line lengths scale with S; positions remap into the resized rectangle.
export function rescaleScene(oldS, oldCx, oldCy, oldHW, oldHH) {
  const { cx, cy, HW, HH, S, ship } = g;
  const sr = S / oldS;                       // size / speed ratio
  const fx = HW / oldHW, fy = HH / oldHH;    // per-axis position ratio
  const mapX = (x) => cx + (x - oldCx) * fx;
  const mapY = (y) => cy + (y - oldCy) * fy;
  const remap = (o) => {
    o.x = mapX(o.x); o.y = mapY(o.y);
    if (o.vx !== undefined) { o.vx *= sr; o.vy *= sr; }
    if (o.radius !== undefined) o.radius *= sr;
  };
  for (const a of g.asteroids) { remap(a); a.font = fitFont(a.label, a.radius); a.fontStr = a.font + 'px ' + MONO; }
  for (const u of g.ufos) { remap(u); if (u.leaving) { u.lvx *= sr; u.lvy *= sr; } }
  for (const b of g.bullets) remap(b);
  for (const p of g.powerups) remap(p);
  for (const p of g.particles) { remap(p); if (p.len) p.len *= sr; }
  for (const f of g.flyers) remap(f);
  if (g.wreck) remap(g.wreck);
  ship.x = mapX(ship.x); ship.y = mapY(ship.y); ship.vx *= sr; ship.vy *= sr;
  for (const lz of g.lasers) { lz.x1 = mapX(lz.x1); lz.y1 = mapY(lz.y1); lz.x2 = mapX(lz.x2); lz.y2 = mapY(lz.y2); }
  if (g.lightningMid) { g.lightningMid.ox *= sr; g.lightningMid.oy *= sr; }
}

// During the megastructure fight the toroidal wrap is switched off: the field edges
// become solid walls. The ship bounces off them and bullets are eaten on contact.
export function hardEdges() { return !!(g.boss && g.boss.type === 'megastructure'); }

// Toroidal wrap: each axis wraps independently (classic Asteroids "the screen is a torus").
export function wrap(o) {
  if (hardEdges()) return;   // mega fight: the walls are solid, nothing wraps
  const { cx, cy, HW, HH } = g;
  if (o.x < cx - HW) o.x += 2 * HW; else if (o.x > cx + HW) o.x -= 2 * HW;
  if (o.y < cy - HH) o.y += 2 * HH; else if (o.y > cy + HH) o.y -= 2 * HH;
}

export function edgeBounceShip() {
  const { cx, cy, HW, HH, S, ship } = g;
  const m = 11 * S, e = 0.6;   // ship half-extent, restitution
  if (ship.x < cx - HW + m) { ship.x = cx - HW + m; ship.vx = Math.abs(ship.vx) * e; }
  else if (ship.x > cx + HW - m) { ship.x = cx + HW - m; ship.vx = -Math.abs(ship.vx) * e; }
  if (ship.y < cy - HH + m) { ship.y = cy - HH + m; ship.vy = Math.abs(ship.vy) * e; }
  else if (ship.y > cy + HH - m) { ship.y = cy + HH - m; ship.vy = -Math.abs(ship.vy) * e; }
}

// Asteroids ping-pong off the solid walls (perfect reflection) during the mega fight.
export function edgeReflect(o) {
  const { cx, cy, HW, HH } = g;
  const r = o.radius || 0;
  if (o.x < cx - HW + r) { o.x = cx - HW + r; o.vx = Math.abs(o.vx); }
  else if (o.x > cx + HW - r) { o.x = cx + HW - r; o.vx = -Math.abs(o.vx); }
  if (o.y < cy - HH + r) { o.y = cy - HH + r; o.vy = Math.abs(o.vy); }
  else if (o.y > cy + HH - r) { o.y = cy + HH - r; o.vy = -Math.abs(o.vy); }
}

// Distance from the field border along a ray from (px,py) in unit dir (dx,dy).
export function rayToRim(px, py, dx, dy) {
  const { cx, cy, HW, HH } = g;
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (cx + HW - px) / dx);
  else if (dx < -1e-9) t = Math.min(t, (cx - HW - px) / dx);
  if (dy > 1e-9) t = Math.min(t, (cy + HH - py) / dy);
  else if (dy < -1e-9) t = Math.min(t, (cy - HH - py) / dy);
  return isFinite(t) ? t : 0;
}

// Shortest distance from point P to segment AB.
export function distToSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

// Toroidal render ghost: while an object (radius `extent`) straddles an edge, also
// paint a copy shifted by the full field width/height so the crossing is seamless.
export function withWrap(x, y, extent, paint) {
  const { cx, cy, HW, HH } = g;
  paint(x, y);
  const ox = (x - extent < cx - HW) ? 2 * HW : (x + extent > cx + HW) ? -2 * HW : 0;
  const oy = (y - extent < cy - HH) ? 2 * HH : (y + extent > cy + HH) ? -2 * HH : 0;
  if (ox) paint(x + ox, y);
  if (oy) paint(x, y + oy);
  if (ox && oy) paint(x + ox, y + oy);
}
