/* Analyser - the /stats page: the two totals, the per-extension table, the
   Asteroids leaderboard card, and the per-day visitors/files trend chart.
   Extracted from app.js as a pure move; setupStatsPage() is called once from
   boot() and is a no-op on every page but /stats. */

import { el, API_ORIGIN } from './util.js';
import { setupSectionFx } from './effects.js';
import { hasFormatPage, formatPageHref } from './formats.js';

// Local getElementById shorthand (mirrors app.js).
function $(id) { return document.getElementById(id); }

// ---------- /stats page ----------
// Populates the stats page from GET /api/stats: the two totals, plus a
// per-extension table that opens at the top 10 and expands to the full list. A
// no-op anywhere #statsRoot is absent (every page but /stats), and it degrades
// to a friendly message offline or against the mock-less local dev server.
export async function setupStatsPage() {
  if (!$('statsRoot')) return;
  const statusEl = $('statsStatus');
  const body = $('statsExtBody');
  const toggle = $('statsExtToggle');
  const TOP = 10;

  let data = null;
  try {
    const resp = await fetch(API_ORIGIN + '/api/stats', { headers: { accept: 'application/json' } });
    if (!resp.ok) throw new Error('bad status');
    data = await resp.json();
  } catch (_) { data = null; }

  if (!data || typeof data.files !== 'number') {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = 'Live stats are not available right now - you may be offline, or previewing locally. Try again later.';
    }
    if (body) {
      body.innerHTML = '';
      body.appendChild(el('tr', {}, el('td', { class: 'stats-empty', colspan: '4' }, 'Unavailable')));
    }
    if (toggle) toggle.hidden = true;
    return;
  }
  if (statusEl) statusEl.hidden = true;

  const fEl = $('statsFiles'); if (fEl) fEl.textContent = data.files.toLocaleString();
  const vEl = $('statsVisitors'); if (vEl) vEl.textContent = data.visitors.toLocaleString();
  // The totals are now real numbers (not the "-" placeholder), so let them join
  // the section's per-letter hover effect, like the header.
  setupSectionFx();

  // Per-day trend graph (visitors + files) under the totals. Only present once
  // the worker has started recording daily buckets; degrades to hidden otherwise.
  renderStatsTrends(Array.isArray(data.daily) ? data.daily : [], { visitors: data.visitors, files: data.files });

  // Asteroids easter-egg leaderboard card (top 5). Shown only when there are
  // scores; rendered before the ext early-returns so it appears even with no exts.
  const scoreCard = $('statsScores');
  const scoreList = $('statsScoresList');
  const scoreToggle = $('statsScoresToggle');
  if (scoreCard && scoreList) {
    const scores = Array.isArray(data.scores) ? data.scores : [];
    // The card stays hidden entirely until at least one score exists.
    if (!scores.length) {
      scoreCard.hidden = true;
    } else {
      scoreCard.hidden = false;
      // Same toggle behaviour as the extensions table: open at the top 5, reveal
      // ten more per click, "Show last N" at the tail, then the button hides.
      const SCORES_TOP = 5;
      const SCORES_STEP = 10;
      // Clicking the reigning #1 score launches the Asteroids easter egg - a
      // "think you can beat it?" invitation on the highest high score.
      const launchGame = () => { import('../games/asteroids.js').then((m) => m.launchAsteroids()).catch(() => {}); };
      // The "final blow" tag: a file extension ('.pdf') or the literal 'nuke'.
      const causeText = (c) => !c ? '' : (c === 'nuke' ? 'nuclear bomb' : c);
      const scoreRow = (s, i) => {
        const top = i === 0;
        const num = el('span', { class: 'stats-score-num' + (top ? ' stats-score-num--play' : '') }, Number(s.score).toLocaleString());
        // Only the reigning #1 score number launches Asteroids.
        if (top) {
          num.title = 'Play Asteroids - think you can beat it?';
          num.setAttribute('role', 'button');
          num.tabIndex = 0;
          num.addEventListener('click', launchGame);
          num.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launchGame(); } });
        }
        const children = [el('span', { class: 'stats-score-name' }, String(s.name))];
        // Inline next to the name: date, then wave survived, then the killing file / nuke.
        const run = [];
        if (s.ts) { const d = new Date(s.ts * 1000); if (!isNaN(d.getTime())) run.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })); }
        const waveN = Number(s.wave);
        if (Number.isFinite(waveN) && waveN > 0) run.push('W' + waveN);
        if (s.cause) run.push(causeText(s.cause));
        if (run.length) children.push(el('span', { class: 'stats-score-run' }, run.join('  ·  ')));
        children.push(num);
        return el('li', { class: 'stats-score-row' }, children);
      };
      let scoresShown = SCORES_TOP;
      const renderScores = () => {
        scoreList.innerHTML = '';
        scores.slice(0, scoresShown).forEach((s, i) => scoreList.appendChild(scoreRow(s, i)));
        if (!scoreToggle) return;
        const remaining = scores.length - scoresShown;
        if (remaining <= 0) { scoreToggle.hidden = true; return; }
        scoreToggle.hidden = false;
        scoreToggle.textContent = remaining >= SCORES_STEP ? 'Show next ten' : ('Show last ' + remaining);
      };
      renderScores();
      if (scoreToggle && !scoreToggle._wired) {
        scoreToggle._wired = true;
        scoreToggle.addEventListener('click', () => {
          scoresShown = Math.min(scoresShown + SCORES_STEP, scores.length);
          renderScores();
        });
      }
    }
  }

  const rawExts = Array.isArray(data.extensions) ? data.extensions : [];
  if (!body) return;
  if (!rawExts.length) {
    body.innerHTML = '';
    body.appendChild(el('tr', {}, el('td', { class: 'stats-empty', colspan: '4' }, 'No files analysed yet.')));
    if (toggle) toggle.hidden = true;
    return;
  }
  // Fold every unsupported entry into one "(unsupported)" bucket on the client too,
  // not only in the Worker. A worker old enough to still send individual unsupported
  // rows would otherwise render as several identical "Unsupported types" rows; this
  // guarantees exactly one, whichever Worker version is live.
  const exts = [];
  let unsupportedTotal = 0;
  for (const e of rawExts) {
    if (e.supported) exts.push(e);
    else unsupportedTotal += e.count;
  }
  if (unsupportedTotal > 0) exts.push({ ext: '(unsupported)', supported: false, count: unsupportedTotal });
  exts.sort((a, b) => (b.count - a.count) || (a.ext < b.ext ? -1 : 1));
  // Percentages are each extension's share of all analysed files (the real total,
  // not just the rows shown), so they read as a true share even when the list is
  // truncated to the top entries.
  const total = data.files || rawExts.reduce((s, e) => s + e.count, 0) || 1;

  const row = (e, i) => {
    // Supported extensions link to their own /formats/<ext> guide page (the same
    // full-wins routing the generator used, so the link can't 404); ones not in the
    // catalog stay plain text. The server pools every unsupported extension into one
    // "(unsupported)" bucket and never sends their raw (user-supplied, possibly
    // abusive) names, so it's shown as a single quiet "Unsupported types" category.
    let extCell;
    if (!e.supported) {
      extCell = [el('span', { class: 'stats-ext-name stats-ext-name--group' }, 'Unsupported types')];
    } else if (hasFormatPage(e.ext)) {
      extCell = [el('a', { class: 'stats-ext-name stats-ext-link', href: formatPageHref(e.ext) }, '.' + e.ext)];
    } else {
      extCell = [el('span', { class: 'stats-ext-name' }, '.' + e.ext)];
    }
    const pct = (e.count / total) * 100;
    const pctStr = pct >= 0.1 ? pct.toFixed(1) + '%' : '<0.1%';
    return el('tr', {}, [
      el('td', { class: 'stats-rank' }, String(i + 1)),
      el('td', { class: 'stats-ext' }, extCell),
      el('td', { class: 'stats-count' }, el('span', { class: 'stats-count-num' }, e.count.toLocaleString())),
      el('td', { class: 'stats-share' }, pctStr),
    ]);
  };

  // The toggle reveals ten more rows per click (not all at once): "Show next ten"
  // while at least ten remain, "Show last N" when fewer than ten are left, then it
  // hides once everything is shown.
  let shown = TOP;
  const render = () => {
    body.innerHTML = '';
    exts.slice(0, shown).forEach((e, i) => body.appendChild(row(e, i)));
    if (!toggle) return;
    const remaining = exts.length - shown;
    if (remaining <= 0) { toggle.hidden = true; return; }
    toggle.hidden = false;
    toggle.textContent = remaining >= TOP ? 'Show next ten' : ('Show last ' + remaining);
  };
  render();
  if (toggle && !toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener('click', () => { shown = Math.min(shown + TOP, exts.length); render(); });
  }
}

// ---------- /stats trend graph ----------

// "Nice" upper bound at or above v from the {1,2,2.5,5,10}*10^n ladder, so axis
// ticks land on readable numbers.
function niceCeil(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * p;
}

const _SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, kids?) {
  const n = document.createElementNS(_SVGNS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return n;
}

const _fmtDay = (s, opts?) => {
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short' });
};

// The two series the chart can show. `key` matches data-series in the legend.
const _TREND_SERIES = ['visitors', 'files'];
// Module-scoped so it survives an SPA navigation that swaps <main> (and with it
// #statsTrendsChart). Storing the dedup handle on the chart element instead
// would orphan the old window 'resize' listener, since the new element carries
// no reference to it. See renderStatsTrends().
let _trendResizeHandler = null;

// Per-mode {visitors, files} arrays: each day's count, or the running total.
// In cumulative mode `baseline` seeds the running total with the all-time count
// that existed before the first tracked day, so the line continues from the real
// figure instead of restarting at zero.
function trendSeries(daily, mode, baseline) {
  const cumulative = mode === 'cumulative';
  const out = { visitors: [], files: [] };
  let cv = cumulative && baseline ? (Number(baseline.visitors) || 0) : 0;
  let cf = cumulative && baseline ? (Number(baseline.files) || 0) : 0;
  for (const d of daily) {
    cv += Number(d.visitors) || 0; cf += Number(d.files) || 0;
    out.visitors.push(cumulative ? cv : Number(d.visitors) || 0);
    out.files.push(cumulative ? cf : Number(d.files) || 0);
  }
  return out;
}

// Show the trend card and wire the per-day / cumulative toggle plus the
// clickable legend (each series can be hidden). Hidden entirely until the worker
// has at least one day of buckets (older worker -> daily: []).
function renderStatsTrends(daily, totals) {
  const card = $('statsTrends');
  if (!card) return;
  const chartEl = $('statsTrendsChart');
  const noteEl = $('statsTrendsNote');
  const modesEl = $('statsTrendsModes');
  const legendEl = $('statsTrendsLegend');
  const rows = (Array.isArray(daily) ? daily : []).filter((d) => d && typeof d.day === 'string');
  if (!rows.length) { card.hidden = true; return; }
  card.hidden = false;

  // Cumulative starts from the count already banked before the first tracked day
  // (all-time total minus the days we have buckets for), not from zero.
  let sumV = 0; let sumF = 0;
  for (const d of rows) { sumV += Number(d.visitors) || 0; sumF += Number(d.files) || 0; }
  const baseline = {
    visitors: Math.max(0, (Number(totals && totals.visitors) || 0) - sumV),
    files: Math.max(0, (Number(totals && totals.files) || 0) - sumF),
  };

  let mode = 'cumulative';
  const visible = { visitors: true, files: true };
  let layout = trendLayout();
  let chart = buildTrendChart(chartEl, rows, baseline, layout);   // builds the SVG once; we only tween attributes after
  let drawnMax = null;   // y-scale currently rendered, tweened for a smooth resize
  let raf = 0;
  let modeSeq = 0;       // guards against overlapping mode cross-fades

  // Highest visible value for the current mode (>= 1) - the target y-scale.
  const targetMax = () => {
    const s = trendSeries(rows, mode, baseline);
    let m = 1;
    for (const k of _TREND_SERIES) if (visible[k]) m = Math.max(m, ...s[k]);
    return m;
  };

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Tween the y-scale from its current value to `to`, updating attributes each
  // frame (no DOM rebuild, so it stays smooth), then run `done`. Hiding the
  // larger series grows the smaller one to fill the chart.
  const animateTo = (to, done?) => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (drawnMax == null || reduceMotion || Math.abs(to - drawnMax) < 0.5) {
      drawnMax = to; chart.apply(mode, drawnMax, visible); if (done) done();
      return;
    }
    const from = drawnMax; const dur = 480; let start = 0;
    const tick = (ts) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;   // easeInOutCubic
      drawnMax = from + (to - from) * e;
      chart.apply(mode, drawnMax, visible);
      if (t < 1) { raf = requestAnimationFrame(tick); } else { raf = 0; drawnMax = to; chart.apply(mode, drawnMax, visible); if (done) done(); }
    };
    raf = requestAnimationFrame(tick);
  };

  drawnMax = targetMax();
  chart.apply(mode, drawnMax, visible);

  if (noteEl) {
    const first = _fmtDay(rows[0].day, { day: 'numeric', month: 'short', year: 'numeric' });
    noteEl.textContent = rows.length > 1
      ? 'Per-day counts since ' + first + '. Earlier days were only kept as running totals, so they are not broken out here.'
      : 'Per-day counts began ' + first + '. The trend builds up from here - check back over the next few days.';
  }

  if (modesEl && !modesEl._wired) {
    modesEl._wired = true;
    modesEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.stats-trends-mode');
      if (!btn) return;
      const next = btn.dataset.mode === 'cumulative' ? 'cumulative' : 'daily';
      if (next === mode) return;
      mode = next;
      modesEl.querySelectorAll('.stats-trends-mode').forEach((b) => b.classList.toggle('is-on', b === btn));
      // Per-day and cumulative are different curves at very different scales, so
      // cross-fade the whole plot rather than morph it: fade out, snap to the new
      // mode + scale while invisible, fade back in.
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (reduceMotion) { drawnMax = targetMax(); chart.apply(mode, drawnMax, visible); return; }
      const seq = ++modeSeq;
      chart.fade(0, () => {
        if (seq !== modeSeq) return;   // a newer switch superseded this one
        drawnMax = targetMax();
        chart.apply(mode, drawnMax, visible);
        chart.fade(1);
      });
    });
  }

  if (legendEl && !legendEl._wired) {
    legendEl._wired = true;
    legendEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.stats-trends-key');
      if (!btn) return;
      const key = btn.dataset.series;
      const turningOn = !visible[key];
      // Never let the user hide the last visible series (chart would go empty).
      if (!turningOn && _TREND_SERIES.filter((k) => visible[k]).length <= 1) return;
      visible[key] = turningOn;
      btn.classList.toggle('is-off', !turningOn);
      btn.setAttribute('aria-pressed', String(turningOn));
      if (turningOn) {
        // Keep the line invisible while the axis resizes to make room for it, then
        // fade it in once the resize has settled.
        chart.setShown(key, false);
        animateTo(targetMax(), () => chart.setShown(key, true));
      } else {
        chart.setShown(key, false);   // fade out now, in step with the resize
        animateTo(targetMax());
      }
    });
  }

  // The viewBox geometry is chosen for the current width, so rebuild the SVG when
  // the viewport crosses the narrow/wide breakpoint (e.g. a phone rotates) - cheap
  // and rare. Same-category resizes need nothing: the SVG already scales fluidly.
  // Replace any handler from a previous render so SPA re-navigation can't stack them.
  if (_trendResizeHandler) window.removeEventListener('resize', _trendResizeHandler);
  let resizeRaf = 0;
  const onResize = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      const next = trendLayout();
      if (next.narrow === layout.narrow) return;
      layout = next;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      chart = buildTrendChart(chartEl, rows, baseline, layout);
      drawnMax = targetMax();
      chart.apply(mode, drawnMax, visible);
      for (const k of _TREND_SERIES) chart.setShown(k, visible[k]);
    });
  };
  _trendResizeHandler = onResize;
  window.addEventListener('resize', onResize);
}

// Geometry for the trend chart, picked from the viewport width. The SVG renders
// at width:100% height:auto, so its viewBox units map to roughly this many screen
// pixels: a 720-wide box on a 360px phone halves everything (11px axis text -> 5px
// mush, plot only ~120px tall). On narrow screens we use a near-1:1-width, taller
// box so axis text stays legible and the plot is tall enough to read.
function trendLayout() {
  const narrow = (window.innerWidth || 800) <= 700;
  return narrow
    ? { narrow: true,  W: 360, H: 300, padL: 38, padR: 12, padT: 14, padB: 32, dotCap: 40 }
    : { narrow: false, W: 720, H: 240, padL: 46, padR: 14, padT: 16, padB: 30, dotCap: 60 };
}

// Build the trend chart's SVG once and return a controller. apply() only mutates
// existing nodes' attributes (cheap, so animation is smooth); setShown() fades a
// series via CSS opacity; a transparent overlay drives a custom hover tooltip
// that snaps to the nearest day. `layout` comes from trendLayout(); the chart is
// rebuilt (not resized) when the viewport crosses the narrow/wide breakpoint.
function buildTrendChart(chartEl, daily, baseline, layout) {
  if (!chartEl) return { apply() {}, setShown() {}, fade() {} };
  const n = daily.length;
  const L = layout || trendLayout();
  const W = L.W; const H = L.H;
  const padL = L.padL; const padR = L.padR; const padT = L.padT; const padB = L.padB;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const TICKS = 4;
  const xFor = (i) => (n > 1 ? padL + (i / (n - 1)) * plotW : padL + plotW / 2);
  const fmtY = (v) => (v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M'
    : v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : String(v));

  const svg = svgEl('svg', { class: 'stats-trend-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img' });

  const gridLines = []; const yLabels = [];
  for (let k = 0; k <= TICKS; k++) {
    const line = svgEl('line', { class: 'stats-trend-grid', x1: padL, x2: W - padR, y1: 0, y2: 0 });
    const text = svgEl('text', { class: 'stats-trend-axis stats-trend-axis--y', x: padL - 8, y: 0 }, '');
    gridLines.push(line); yLabels.push(text);
    svg.appendChild(line); svg.appendChild(text);
  }

  // Crosshair guide at the hovered day (hidden until hover).
  const crosshair = svgEl('line', { class: 'stats-trend-cross', x1: 0, x2: 0, y1: padT, y2: padT + plotH });
  crosshair.style.opacity = '0';
  svg.appendChild(crosshair);

  // Files under visitors so the accent line/area reads on top.
  const gFiles = svgEl('g', { class: 'stats-trend-series stats-trend-series--files' });
  const gVis = svgEl('g', { class: 'stats-trend-series stats-trend-series--visitors' });
  const fLine = svgEl('path', { class: 'stats-trend-line stats-trend-line--files' });
  gFiles.appendChild(fLine);
  const vArea = svgEl('path', { class: 'stats-trend-area' });
  const vLine = svgEl('path', { class: 'stats-trend-line stats-trend-line--visitors' });
  gVis.appendChild(vArea); gVis.appendChild(vLine);

  const fDots = []; const vDots = [];
  if (n <= L.dotCap) {
    for (let i = 0; i < n; i++) {
      const fd = svgEl('circle', { class: 'stats-trend-dot stats-trend-dot--files', cx: xFor(i).toFixed(1), cy: 0, r: 2.4 });
      gFiles.appendChild(fd); fDots.push(fd);
      const vd = svgEl('circle', { class: 'stats-trend-dot stats-trend-dot--visitors', cx: xFor(i).toFixed(1), cy: 0, r: 2.4 });
      gVis.appendChild(vd); vDots.push(vd);
    }
  }
  svg.appendChild(gFiles); svg.appendChild(gVis);

  // Enlarged focus markers on the hovered day.
  const fFocus = svgEl('circle', { class: 'stats-trend-focus stats-trend-focus--files', cx: 0, cy: 0, r: 3.6 });
  const vFocus = svgEl('circle', { class: 'stats-trend-focus stats-trend-focus--visitors', cx: 0, cy: 0, r: 3.6 });
  fFocus.style.opacity = '0'; vFocus.style.opacity = '0';
  svg.appendChild(fFocus); svg.appendChild(vFocus);

  // X-axis labels: first and last day (plus the middle when there's room).
  const xLabels = n > 1 ? [0, n - 1] : [0];
  if (n >= 6) xLabels.splice(1, 0, Math.floor((n - 1) / 2));
  for (const i of xLabels) {
    const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
    svg.appendChild(svgEl('text', { class: 'stats-trend-axis', x: xFor(i).toFixed(1), y: H - 10, 'text-anchor': anchor }, _fmtDay(daily[i].day)));
  }

  // Transparent overlay on top to capture pointer moves across the whole plot.
  const hit = svgEl('rect', { class: 'stats-trend-hit', x: padL, y: padT, width: plotW, height: plotH });
  svg.appendChild(hit);

  chartEl.innerHTML = '';
  chartEl.appendChild(svg);

  // Floating HTML tooltip (positioned relative to the chart container).
  const tip = el('div', { class: 'stats-trend-tip' });
  tip.hidden = true;
  chartEl.appendChild(tip);

  const linePath = (s, yFor) => s.map((val, i) => (i ? 'L' : 'M') + xFor(i).toFixed(1) + ' ' + yFor(val).toFixed(1)).join(' ');
  const areaPath = (s, yFor) => linePath(s, yFor) + ' L ' + xFor(n - 1).toFixed(1) + ' ' + yFor(0).toFixed(1)
    + ' L ' + xFor(0).toFixed(1) + ' ' + yFor(0).toFixed(1) + ' Z';

  const state = { mode: 'daily', niceMax: 1, visible: { visitors: true, files: true }, series: trendSeries(daily, 'daily', baseline) };
  const yFor = (val) => padT + plotH - (val / state.niceMax) * plotH;

  let hoverI = -1;
  const hideHover = () => {
    hoverI = -1;
    tip.hidden = true;
    crosshair.style.opacity = '0';
    fFocus.style.opacity = '0';
    vFocus.style.opacity = '0';
  };
  const onMove = (e) => {
    if (!state.series || !n) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const vx = (e.clientX - rect.left) * (W / rect.width);   // client px -> viewBox units (uniform scale)
    let i = n > 1 ? Math.round((vx - padL) / plotW * (n - 1)) : 0;
    i = Math.max(0, Math.min(n - 1, i));
    hoverI = i;
    const px = xFor(i);
    crosshair.setAttribute('x1', px.toFixed(1));
    crosshair.setAttribute('x2', px.toFixed(1));
    crosshair.style.opacity = '1';
    if (state.visible.visitors) { vFocus.setAttribute('cx', px.toFixed(1)); vFocus.setAttribute('cy', yFor(state.series.visitors[i]).toFixed(1)); vFocus.style.opacity = '1'; } else vFocus.style.opacity = '0';
    if (state.visible.files) { fFocus.setAttribute('cx', px.toFixed(1)); fFocus.setAttribute('cy', yFor(state.series.files[i]).toFixed(1)); fFocus.style.opacity = '1'; } else fFocus.style.opacity = '0';

    const tipRow = (key, label) => el('div', { class: 'stats-trend-tip-row' }, [
      el('span', { class: 'stats-trend-tip-swatch stats-trend-tip-swatch--' + key }),
      label, el('strong', {}, state.series[key][i].toLocaleString()),
    ]);
    const kids = [el('div', { class: 'stats-trend-tip-date' }, _fmtDay(daily[i].day, { day: 'numeric', month: 'short', year: 'numeric' }))];
    if (state.visible.visitors) kids.push(tipRow('visitors', 'Visitors'));
    if (state.visible.files) kids.push(tipRow('files', 'Files'));
    tip.innerHTML = '';
    kids.forEach((k) => tip.appendChild(k));
    tip.hidden = false;

    // Place centred above the cursor; flip below if it would clip the top.
    const crect = chartEl.getBoundingClientRect();
    const tw = tip.offsetWidth; const th = tip.offsetHeight;
    let left = e.clientX - crect.left;
    left = Math.max(tw / 2 + 2, Math.min(crect.width - tw / 2 - 2, left));
    let top = e.clientY - crect.top - th - 12;
    if (top < 0) top = e.clientY - crect.top + 18;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };
  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerenter', onMove);
  // A tap places the readout at the nearest day. On touch it then stays put after
  // the finger lifts (there is no hover to keep it alive), so the line and numbers
  // remain readable; a mouse still clears the readout when the pointer leaves.
  hit.addEventListener('pointerdown', onMove);
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hideHover(); });

  return {
    // Lay out everything for `mode` at y-scale `scaleMax` (raw; nice-rounded here).
    apply(mode, scaleMax, visible) {
      const step = Math.max(1, Math.ceil(niceCeil(Math.max(1, scaleMax) / TICKS)));
      state.niceMax = step * TICKS;
      state.mode = mode;
      if (visible) state.visible = visible;
      const s = trendSeries(daily, mode, baseline);
      state.series = s;
      for (let k = 0; k <= TICKS; k++) {
        const val = step * k; const y = yFor(val);
        gridLines[k].setAttribute('y1', y.toFixed(1)); gridLines[k].setAttribute('y2', y.toFixed(1));
        yLabels[k].setAttribute('y', (y + 3.5).toFixed(1)); yLabels[k].textContent = fmtY(val);
      }
      if (n > 1) {
        vArea.setAttribute('d', areaPath(s.visitors, yFor));
        vLine.setAttribute('d', linePath(s.visitors, yFor));
        fLine.setAttribute('d', linePath(s.files, yFor));
      }
      for (let i = 0; i < fDots.length; i++) {
        fDots[i].setAttribute('cy', yFor(s.files[i]).toFixed(1));
        vDots[i].setAttribute('cy', yFor(s.visitors[i]).toFixed(1));
      }
      if (hoverI >= 0) {   // keep the focus markers glued to the line as it rescales
        if (state.visible.visitors) vFocus.setAttribute('cy', yFor(s.visitors[hoverI]).toFixed(1));
        if (state.visible.files) fFocus.setAttribute('cy', yFor(s.files[hoverI]).toFixed(1));
      }
      const shown = _TREND_SERIES.filter((k) => state.visible[k]).join(' and ') || 'no series';
      svg.setAttribute('aria-label', (mode === 'cumulative' ? 'Cumulative' : 'Per-day') + ' ' + shown
        + ' from ' + _fmtDay(daily[0].day) + ' to ' + _fmtDay(daily[n - 1].day) + '.');
    },
    setShown(key, on) {
      const g = key === 'visitors' ? gVis : gFiles;
      g.style.opacity = on ? '1' : '0';
      g.style.pointerEvents = on ? '' : 'none';
      if (!on && (key === 'visitors' ? vFocus : fFocus)) (key === 'visitors' ? vFocus : fFocus).style.opacity = '0';
    },
    // Fade the whole plot (CSS transition on the svg); `done` fires after it.
    fade(to, done?) {
      if (to < 1) hideHover();   // don't leave a tooltip floating over a faded chart
      svg.style.opacity = String(to);
      if (done) setTimeout(done, 200);   // matches --dur-base on .stats-trend-svg
    },
  };
}
