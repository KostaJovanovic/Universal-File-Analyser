/* Analyser - table-analysis workbench
   Mounted below a CSV/XLSX/XLSB/ODS file's existing analysis: a virtualised
   grid (sort/filter/search/hide/reorder), a stats bar + group-by, a chart
   builder (pickers + drag-to-select) covering line/bar/scatter/histogram/
   pie/area/box/heatmap on one hand-drawn canvas, auto-suggested charts, and
   PNG/JSON/CSV export. No chart library - see drawChart(). */

import { el, row, showCellPopup, downloadBlob, h3help, wireInfoToggle } from '../core/util.js';
import { SAMPLE_CAP, inferColumnTypes, toNumber, columnValues, describe, percentile, pearson, groupBy, parseDateValue, looksMonthFirst } from '../lib/table-stats.js';

const ROW_H = 28;
const OVERSCAN = 5;
const MAX_POINTS = 4000;
const PALETTE = ['#e0533a', '#3b82c4', '#3ba776', '#c47a0f', '#8859c4', '#c43b8e', '#4a4a4a', '#2ea7a1'];
const CHART_TYPES = ['line', 'bar', 'scatter', 'histogram', 'pie', 'area', 'box', 'heatmap'];

function fmtAxisNum(n) {
  if (!isFinite(n)) return '-';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return Number(n.toFixed(2)).toString();
}
function fmtNumFull(n) { return isFinite(n) ? Number(n.toFixed(4)).toString() : '-'; }
function truncateLbl(s, n = 10) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function fmtRange(a, b) { return fmtAxisNum(a) + '–' + fmtAxisNum(b); }
function csvQuote(v) { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

// The [?] help panel content: a plain-language tour of every workbench tool.
// Rendered through h3help()/.anr-info-panel - one entry per line (each an
// .anr-tk-help-item block), with the inline <strong> term shown as the panel's
// uppercase label, matching every other [?] on the site.
const WORKBENCH_HELP_HTML =
  '<div class="anr-tk-help-item">Everything here runs in your browser - nothing is uploaded. The grid is a live, filterable view of your data, and the tools below summarise and chart whatever you select.</div>' +
  '<div class="anr-tk-help-item"><strong>Scroll:</strong> to stay fast, only the rows currently on screen are drawn - scroll down to load the rest, and click any cell to read its full value.</div>' +
  '<div class="anr-tk-help-item"><strong>Sort:</strong> click a column header to sort by it - ascending, then descending, then back to the original order.</div>' +
  '<div class="anr-tk-help-item"><strong>Select a column:</strong> clicking a header also highlights the whole column and shows its stats below (text columns report distinct counts and their most common values).</div>' +
  '<div class="anr-tk-help-item"><strong>Select a row:</strong> click a row number in the left gutter to highlight that whole row.</div>' +
  '<div class="anr-tk-help-item"><strong>Select a block:</strong> drag across cells to select a rectangle - any numeric selection is summarised in the stats bar.</div>' +
  '<div class="anr-tk-help-item"><strong>Filter:</strong> the gear on each header filters that column (a min/max range for numbers, or a "contains" match for text), and the search box filters across every column at once.</div>' +
  '<div class="anr-tk-help-item"><strong>Columns:</strong> the Columns menu shows or hides individual columns.</div>' +
  '<div class="anr-tk-help-item"><strong>Split column:</strong> some files cram several values into one column, kept apart by a marker such as a comma - this breaks a chosen column into real separate columns at that marker (found automatically by default) and splits its heading too, with Undo split to put it back.</div>' +
  '<div class="anr-tk-help-item"><strong>Stats bar:</strong> for the current selection it reports count, sum, average, median, min, max and standard deviation.</div>' +
  '<div class="anr-tk-help-item"><strong>Summarise (For each ... show the ...):</strong> pick a column to group on and a calculation - count, sum, average, minimum, maximum or median - of a number column, and the rows roll up into per-group totals live as you choose. Count needs no number column, so its picker greys out.</div>' +
  '<div class="anr-tk-help-item"><strong>Charts:</strong> choose a chart type and its fields and the chart redraws instantly; suggested charts appear as quick buttons, hovering a bar, point or slice shows its exact value, and Plot selected range charts whatever you have selected in the grid.</div>' +
  '<div class="anr-tk-help-item"><strong>Export:</strong> save the chart as a PNG, the current stats as JSON, or the filtered/sorted rows as CSV.</div>';

// Focused help for the "For each ..." per-group summary, shown from its own [?].
const GROUPBY_HELP_HTML =
  '<div class="anr-tk-help-item">This builds a <strong>summary table</strong>: it takes every row, sorts them into buckets by the first column you pick, and shows one line per bucket.</div>' +
  '<div class="anr-tk-help-item"><strong>Worked example.</strong> Say each row is a sale with a Region and a Revenue. Choosing "For each Region show the average of Revenue" turns many rows -</div>' +
  '<div class="anr-tk-help-item" style="white-space:pre;">North  18,204\nSouth   9,873\nNorth  12,100\nEast   14,410\nSouth  11,200</div>' +
  '<div class="anr-tk-help-item">- into one line per Region, each holding the average Revenue of that region\'s rows:</div>' +
  '<div class="anr-tk-help-item" style="white-space:pre;">North  15,152\nSouth  10,536\nEast   14,410</div>' +
  '<div class="anr-tk-help-item"><strong>The calculation</strong> can be count (how many rows land in each bucket), sum (their total), average, minimum, maximum or median. Count needs no number column, so its picker greys out.</div>' +
  '<div class="anr-tk-help-item"><strong>Want one figure for a whole column instead of per bucket?</strong> Set this to N/A, then click that column\'s header - the stats bar below the grid shows its total, average, median and so on.</div>';

function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
  return {
    fg: v('--fg', '#0a0a0a'), muted: v('--muted', '#6b6b6b'), bg: v('--bg', '#fff'),
    accent: v('--accent', '#e60023'), hair: v('--hairline', '#e6e6e6'),
    fontMono: v('--font-mono', 'monospace'),
  };
}

function heatColor(t, valid) {
  if (!valid) return '#88888833';
  t = Math.max(0, Math.min(1, t));
  const r = t > 0.5 ? 255 : Math.round(255 * (t / 0.5));
  const b = t < 0.5 ? 255 : Math.round(255 * ((1 - t) / 0.5));
  const g = Math.round(255 * (1 - Math.abs(t - 0.5) * 2));
  return `rgb(${r},${g},${b})`;
}

// Decimate long series (line/scatter/area) to MAX_POINTS by stride, keeping
// xLabels/xValues aligned. Bar/histogram/pie/box/heatmap are already
// aggregate-sized so they pass through untouched.
function decimateSpec(spec) {
  const n = (spec.xLabels || []).length;
  if (n <= MAX_POINTS || !['line', 'scatter', 'area'].includes(spec.type)) return spec;
  const stride = Math.ceil(n / MAX_POINTS);
  const xLabels = [], xValues = spec.xValues ? [] : undefined;
  for (let i = 0; i < n; i += stride) { xLabels.push(spec.xLabels[i]); if (xValues) xValues.push(spec.xValues[i]); }
  const series = spec.series.map((s) => {
    const data = [];
    for (let i = 0; i < n; i += stride) data.push(s.data[i]);
    return { name: s.name, data };
  });
  const note = (spec.meta && spec.meta.sampledNote ? spec.meta.sampledNote + ' · ' : '') + 'decimated to ' + xLabels.length + ' of ' + n + ' points';
  return { ...spec, xLabels, xValues, series, meta: { ...spec.meta, sampledNote: note } };
}

function computeXAt(spec, plotX, plotW) {
  const n = spec.xLabels.length;
  if (spec.xValues && spec.xValues.length === n) {
    const xs = spec.xValues.filter(isFinite);
    if (xs.length) {
      let xMin = Math.min(...xs), xMax = Math.max(...xs);
      if (xMin === xMax) xMax = xMin + 1;
      return (i) => plotX + ((spec.xValues[i] - xMin) / (xMax - xMin)) * plotW;
    }
  }
  return (i) => plotX + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
}

function drawXY(ctx, spec, W, H, top, th, hits) {
  const xTitle = spec.meta && spec.meta.xTitle, yTitle = spec.meta && spec.meta.yTitle;
  const PAD_L = yTitle ? 72 : 54, PAD_R = 16;
  const series = spec.series || [];
  const n = (spec.xLabels || []).length;
  const stacked = !!(spec.meta && spec.meta.stacked) && (spec.type === 'bar' || spec.type === 'area');
  let yMin = 0, yMax = 1;
  if (stacked) {
    const sums = new Array(n).fill(0);
    for (const s of series) for (let i = 0; i < n; i++) sums[i] += isFinite(s.data[i]) ? s.data[i] : 0;
    yMax = Math.max(0, ...sums); yMin = Math.min(0, ...sums);
  } else {
    const all = [];
    for (const s of series) for (const v of s.data) if (isFinite(v)) all.push(v);
    if (all.length) { yMin = Math.min(0, ...all); yMax = Math.max(...all); }
  }
  if (yMin === yMax) yMax = yMin + 1;

  const plotX = PAD_L, plotY = top + 8, plotW = W - PAD_L - PAD_R;
  // Decide the x-axis label layout before reserving bottom space: work out
  // which labels to show, and rotate them diagonally when horizontal text
  // would overlap into an unreadable mush (the usual case for categorical
  // bar/box labels). PAD_B then grows to fit the rotated text.
  ctx.font = '11px ' + th.fontMono;
  const maxLabels = Math.max(2, Math.floor(plotW / 44));
  const stepLbl = Math.max(1, Math.ceil(n / maxLabels));
  const shownIdx = [];
  for (let i = 0; i < n; i += stepLbl) shownIdx.push(i);
  const slot = plotW / Math.max(1, shownIdx.length);
  const rawLbl = (i) => String(spec.xLabels[i] == null ? '' : spec.xLabels[i]);
  const widestHoriz = shownIdx.reduce((m, i) => Math.max(m, ctx.measureText(truncateLbl(rawLbl(i))).width), 0);
  const rotateX = widestHoriz > slot - 6;
  let PAD_B = 34;
  if (rotateX) {
    const widestRot = shownIdx.reduce((m, i) => Math.max(m, ctx.measureText(truncateLbl(rawLbl(i), 16)).width), 0);
    PAD_B = Math.min(84, Math.max(40, Math.round(widestRot * 0.72) + 16));
  }
  if (xTitle) PAD_B += 18; // room for the x-axis title beneath the tick labels
  const plotH = H - plotY - PAD_B;
  ctx.strokeStyle = th.hair; ctx.fillStyle = th.muted; ctx.textAlign = 'right'; ctx.font = '11px ' + th.fontMono;
  for (let i = 0; i <= 4; i++) {
    const y = plotY + plotH - (i / 4) * plotH;
    const val = yMin + (i / 4) * (yMax - yMin);
    ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillText(fmtAxisNum(val), plotX - 6, y);
  }
  ctx.strokeStyle = th.fg;
  ctx.beginPath(); ctx.moveTo(plotX, plotY + plotH); ctx.lineTo(plotX + plotW, plotY + plotH); ctx.stroke();

  const xAt = computeXAt(spec, plotX, plotW);
  ctx.fillStyle = th.muted; ctx.font = '11px ' + th.fontMono;
  if (rotateX) {
    for (const i of shownIdx) {
      ctx.save();
      ctx.translate(xAt(i), plotY + plotH + 8);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(truncateLbl(rawLbl(i), 16), 0, 0);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
  } else {
    ctx.textAlign = 'center';
    for (const i of shownIdx) ctx.fillText(truncateLbl(rawLbl(i)), xAt(i), plotY + plotH + 14);
  }

  const yOf = (v) => plotY + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  if (spec.type === 'bar' || spec.type === 'histogram') {
    const groupW = plotW / Math.max(1, n);
    const gap = spec.type === 'histogram' ? 1 : Math.max(2, groupW * 0.15);
    if (stacked || series.length === 1) {
      const bw = groupW - gap;
      for (let i = 0; i < n; i++) {
        let base = 0;
        series.forEach((s, si) => {
          const v = isFinite(s.data[i]) ? s.data[i] : 0;
          const y0 = yOf(base), y1 = yOf(base + v);
          const color = PALETTE[si % PALETTE.length];
          ctx.fillStyle = color;
          const bx = plotX + i * groupW + gap / 2, by = Math.min(y0, y1), bh = Math.abs(y1 - y0);
          ctx.fillRect(bx, by, bw, bh);
          if (hits) hits.push({ type: 'rect', x: bx, y: by, w: bw, h: bh, color, tip: [String(spec.xLabels[i]), (series.length > 1 ? s.name + ' = ' : '') + fmtNumFull(v)] });
          base += v;
        });
      }
    } else {
      const bw = (groupW - gap) / series.length;
      series.forEach((s, si) => {
        for (let i = 0; i < n; i++) {
          const v = isFinite(s.data[i]) ? s.data[i] : 0;
          const y0 = yOf(0), y1 = yOf(v);
          const color = PALETTE[si % PALETTE.length];
          ctx.fillStyle = color;
          const bx = plotX + i * groupW + gap / 2 + si * bw, by = Math.min(y0, y1), bwm = Math.max(1, bw - 1), bh = Math.abs(y1 - y0);
          ctx.fillRect(bx, by, bwm, bh);
          if (hits) hits.push({ type: 'rect', x: bx, y: by, w: bwm, h: bh, color, tip: [String(spec.xLabels[i]), s.name + ' = ' + fmtNumFull(v)] });
        }
      });
    }
  } else if (spec.type === 'line' || spec.type === 'area') {
    series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length];
      if (spec.type === 'area') {
        ctx.beginPath();
        let started = false, lastI = -1;
        for (let i = 0; i < n; i++) {
          const v = s.data[i]; if (!isFinite(v)) continue;
          const x = xAt(i), y = yOf(v);
          if (!started) { ctx.moveTo(x, yOf(0)); ctx.lineTo(x, y); started = true; } else ctx.lineTo(x, y);
          lastI = i;
        }
        if (started) { ctx.lineTo(xAt(lastI), yOf(0)); ctx.closePath(); ctx.fillStyle = color + '33'; ctx.fill(); }
      }
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const v = s.data[i];
        if (!isFinite(v)) { started = false; continue; }
        const x = xAt(i), y = yOf(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        if (hits) hits.push({ type: 'circle', cx: x, cy: y, r: 3, fill: true, color, tip: [String(spec.xLabels[i]), (series.length > 1 ? s.name + ' = ' : '') + fmtNumFull(v)] });
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    });
  } else if (spec.type === 'scatter') {
    series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length];
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const v = s.data[i]; if (!isFinite(v)) continue;
        const x = xAt(i), y = yOf(v);
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        if (hits) hits.push({ type: 'circle', cx: x, cy: y, r: 2.5, fill: true, color, tip: [String(spec.xLabels[i]), (series.length > 1 ? s.name + ' = ' : '') + fmtNumFull(v)] });
      }
    });
  }

  // Axis titles - drawn in the foreground colour (ticks are muted) so the axes
  // read clearly. X title centred beneath the tick labels; Y title rotated up
  // the left edge.
  ctx.fillStyle = th.fg; ctx.font = '600 11px ' + th.fontMono;
  if (xTitle) { ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(truncateLbl(xTitle, 40), plotX + plotW / 2, H - 5); }
  if (yTitle) {
    ctx.save();
    ctx.translate(13, plotY + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(truncateLbl(yTitle, 30), 0, 0);
    ctx.restore();
  }

  if (series.length > 1) {
    let lx = plotX; const ly = Math.max(4, top - 2);
    ctx.textAlign = 'left'; ctx.font = '10px ' + th.fontMono;
    series.forEach((s, si) => {
      ctx.fillStyle = PALETTE[si % PALETTE.length];
      ctx.fillRect(lx, ly - 4, 8, 8);
      ctx.fillStyle = th.muted;
      ctx.fillText(s.name, lx + 12, ly);
      lx += 12 + ctx.measureText(s.name).width + 14;
    });
  }
}

function drawBox(ctx, spec, W, H, top, th, hits) {
  const boxes = (spec.meta && spec.meta.box) || [];
  const yTitle = spec.meta && spec.meta.yTitle;
  const PAD_L = yTitle ? 72 : 54, PAD_R = 16;
  const plotX = PAD_L, plotY = top + 8, plotW = W - PAD_L - PAD_R;
  // Reserve bottom space for rotated category labels when horizontal ones
  // would overlap (see drawXY for the same treatment).
  ctx.font = '11px ' + th.fontMono;
  const boxSlot = plotW / Math.max(1, boxes.length);
  const widestBoxLbl = boxes.reduce((m, b) => Math.max(m, ctx.measureText(truncateLbl(b.label)).width), 0);
  const rotateX = widestBoxLbl > boxSlot - 6;
  let PAD_B = 34;
  if (rotateX) {
    const widestRot = boxes.reduce((m, b) => Math.max(m, ctx.measureText(truncateLbl(b.label, 16)).width), 0);
    PAD_B = Math.min(84, Math.max(40, Math.round(widestRot * 0.72) + 16));
  }
  const plotH = H - plotY - PAD_B;
  const all = [];
  boxes.forEach((b) => { all.push(b.min, b.max); (b.outliers || []).forEach((v) => all.push(v)); });
  let yMin = Math.min(0, ...all), yMax = Math.max(1, ...all);
  if (yMin === yMax) yMax = yMin + 1;
  const yOf = (v) => plotY + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  ctx.strokeStyle = th.hair; ctx.fillStyle = th.muted; ctx.textAlign = 'right'; ctx.font = '11px ' + th.fontMono;
  for (let i = 0; i <= 4; i++) {
    const val = yMin + (i / 4) * (yMax - yMin), y = yOf(val);
    ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke();
    ctx.fillText(fmtAxisNum(val), plotX - 6, y);
  }
  ctx.strokeStyle = th.fg;
  ctx.beginPath(); ctx.moveTo(plotX, plotY + plotH); ctx.lineTo(plotX + plotW, plotY + plotH); ctx.stroke();

  const n = boxes.length, slot = plotW / Math.max(1, n), bw = Math.min(40, slot * 0.5);
  ctx.textAlign = 'center';
  boxes.forEach((b, i) => {
    const cx = plotX + slot * (i + 0.5);
    ctx.strokeStyle = PALETTE[i % PALETTE.length]; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, yOf(b.min)); ctx.lineTo(cx, yOf(b.q1));
    ctx.moveTo(cx, yOf(b.q3)); ctx.lineTo(cx, yOf(b.max));
    ctx.moveTo(cx - bw / 4, yOf(b.min)); ctx.lineTo(cx + bw / 4, yOf(b.min));
    ctx.moveTo(cx - bw / 4, yOf(b.max)); ctx.lineTo(cx + bw / 4, yOf(b.max));
    ctx.stroke();
    ctx.fillStyle = PALETTE[i % PALETTE.length] + '33';
    ctx.fillRect(cx - bw / 2, yOf(b.q3), bw, yOf(b.q1) - yOf(b.q3));
    ctx.strokeRect(cx - bw / 2, yOf(b.q3), bw, yOf(b.q1) - yOf(b.q3));
    ctx.beginPath(); ctx.moveTo(cx - bw / 2, yOf(b.median)); ctx.lineTo(cx + bw / 2, yOf(b.median)); ctx.stroke();
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    (b.outliers || []).forEach((v) => { ctx.beginPath(); ctx.arc(cx, yOf(v), 2, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = th.muted;
    if (rotateX) {
      ctx.save();
      ctx.translate(cx, plotY + plotH + 8);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(truncateLbl(b.label, 16), 0, 0);
      ctx.restore();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    } else {
      ctx.fillText(truncateLbl(b.label), cx, plotY + plotH + 14);
    }
    if (hits) hits.push({
      type: 'rect', x: cx - bw / 2, y: yOf(b.max), w: bw, h: yOf(b.min) - yOf(b.max), color: PALETTE[i % PALETTE.length],
      tip: [String(b.label), 'max ' + fmtNumFull(b.max), 'Q3 ' + fmtNumFull(b.q3), 'median ' + fmtNumFull(b.median), 'Q1 ' + fmtNumFull(b.q1), 'min ' + fmtNumFull(b.min), (b.outliers || []).length + ' outlier' + ((b.outliers || []).length === 1 ? '' : 's')],
    });
  });
  if (yTitle) {
    ctx.fillStyle = th.fg; ctx.font = '600 11px ' + th.fontMono;
    ctx.save();
    ctx.translate(13, plotY + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(truncateLbl(yTitle, 30), 0, 0);
    ctx.restore();
  }
}

function drawHeatmap(ctx, spec, W, H, top, th, hits) {
  const hm = spec.meta.heatmap;
  const labels = hm.labels, matrix = hm.matrix, n = labels.length;
  if (!n) return;
  const padL = Math.min(120, 40 + Math.max(...labels.map((l) => l.length)) * 5.5);
  const plotX = padL, plotY = top + 8;
  const size = Math.max(8, Math.min((W - padL - 60) / n, (H - plotY - padL) / n));
  ctx.font = '10px ' + th.fontMono;
  ctx.textAlign = 'right'; ctx.fillStyle = th.muted;
  for (let r = 0; r < n; r++) ctx.fillText(truncateLbl(labels[r], 16), plotX - 6, plotY + r * size + size / 2);
  for (let c = 0; c < n; c++) {
    ctx.save();
    ctx.translate(plotX + c * size + size / 2, plotY + n * size + 6);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = 'right';
    ctx.fillText(truncateLbl(labels[c], 16), 0, 0);
    ctx.restore();
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = matrix[r][c];
      const valid = isFinite(v);
      ctx.fillStyle = heatColor(valid ? (v + 1) / 2 : 0.5, valid);
      ctx.fillRect(plotX + c * size, plotY + r * size, size - 1, size - 1);
      if (hits) hits.push({ type: 'rect', x: plotX + c * size, y: plotY + r * size, w: size - 1, h: size - 1, color: th.fg, tip: [truncateLbl(labels[r], 24) + ' × ' + truncateLbl(labels[c], 24), 'r = ' + (valid ? v.toFixed(3) : 'n/a')] });
      if (size > 22) {
        ctx.fillStyle = valid && Math.abs(v) > 0.4 ? '#fff' : '#000';
        ctx.textAlign = 'center'; ctx.font = '9px ' + th.fontMono;
        ctx.fillText(valid ? v.toFixed(2) : '-', plotX + c * size + size / 2, plotY + r * size + size / 2 + 3);
      }
    }
  }
  const lx = plotX + n * size + 16, ly = plotY, lh = Math.min(n * size, 120);
  if (lx < W - 20 && lh > 10) {
    for (let i = 0; i < lh; i++) { ctx.fillStyle = heatColor(1 - i / lh, true); ctx.fillRect(lx, ly + i, 14, 1); }
    ctx.strokeStyle = th.hair; ctx.strokeRect(lx, ly, 14, lh);
    ctx.fillStyle = th.muted; ctx.textAlign = 'left'; ctx.font = '9px ' + th.fontMono;
    ctx.fillText('+1', lx + 18, ly + 4);
    ctx.fillText('-1', lx + 18, ly + lh - 4);
  }
}

function drawPie(ctx, spec, W, H, top, th, hits) {
  const labels = spec.xLabels || [], data = (spec.series[0] && spec.series[0].data) || [];
  const total = data.reduce((s, v) => s + (isFinite(v) ? v : 0), 0) || 1;
  const cx = W * 0.34, cy = top + (H - top) / 2, r = Math.max(20, Math.min(cx - 20, (H - top) / 2 - 20, 110));
  let a0 = -Math.PI / 2;
  const donut = !!(spec.meta && spec.meta.donut);
  data.forEach((v, i) => {
    const frac = (isFinite(v) ? v : 0) / total;
    const a1 = a0 + frac * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
    ctx.fillStyle = PALETTE[i % PALETTE.length]; ctx.fill();
    if (hits && frac > 0) hits.push({ type: 'wedge', cx, cy, r, rInner: donut ? r * 0.55 : 0, a0, a1, color: PALETTE[i % PALETTE.length], tip: [String(labels[i]), fmtNumFull(isFinite(v) ? v : 0) + ' (' + Math.round(frac * 100) + '%)'] });
    a0 = a1;
  });
  if (donut) { ctx.fillStyle = th.bg; ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fill(); }
  let ly = top + 10;
  ctx.textAlign = 'left'; ctx.font = '10px ' + th.fontMono;
  const lx = cx + r + 24;
  labels.forEach((lb, i) => {
    if (ly > H - 14 || lx > W - 40) return;
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.fillRect(lx, ly - 4, 8, 8);
    ctx.fillStyle = th.muted;
    const pct = Math.round(((isFinite(data[i]) ? data[i] : 0) / total) * 100);
    ctx.fillText(truncateLbl(lb, 16) + ' (' + pct + '%)', lx + 12, ly);
    ly += 15;
  });
}

// Single hand-drawn canvas function for every chart type. Theme-aware (reads
// CSS custom properties each draw), DPR-scaled, decimates long line/scatter/
// area series to MAX_POINTS.
function drawChart(canvas, spec) {
  if (!spec) return;
  spec = decimateSpec(spec);
  const th = theme();
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(240, rect.width || 240), H = Math.max(160, rect.height || 320);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  let top = 8;
  if (spec.title) {
    ctx.fillStyle = th.fg; ctx.font = '600 12px ' + th.fontMono; ctx.textAlign = 'left';
    ctx.fillText(spec.title, 8, top + 8);
    top += 22;
  }

  const hits = [];
  if (spec.type === 'pie') drawPie(ctx, spec, W, H, top, th, hits);
  else if (spec.type === 'box') drawBox(ctx, spec, W, H, top, th, hits);
  else if (spec.type === 'heatmap') drawHeatmap(ctx, spec, W, H, top, th, hits);
  else drawXY(ctx, spec, W, H, top, th, hits);

  const note = spec.meta && spec.meta.sampledNote;
  if (note) { ctx.fillStyle = th.muted; ctx.textAlign = 'right'; ctx.font = '10px ' + th.fontMono; ctx.fillText(note, W - 8, H - 6); }
  return hits;
}

// Find the topmost hit region under a point (CSS px, same coords the chart was
// drawn in). Circles/wedges get a few px of slack so small marks stay grabbable.
function hitTest(hits, mx, my) {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (h.type === 'rect') {
      if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) return h;
    } else if (h.type === 'circle') {
      const dx = mx - h.cx, dy = my - h.cy, rr = (h.r + 3);
      if (dx * dx + dy * dy <= rr * rr) return h;
    } else if (h.type === 'wedge') {
      const dx = mx - h.cx, dy = my - h.cy, dist = Math.hypot(dx, dy);
      if (dist <= h.r && dist >= (h.rInner || 0)) {
        let a = Math.atan2(dy, dx);
        while (a < h.a0) a += Math.PI * 2;
        if (a <= h.a1) return h;
      }
    }
  }
  return null;
}

// Outline the hovered element in the foreground colour (a filled dot for line/
// scatter points so the mark is obvious).
function drawHitHighlight(ctx, hit, th) {
  ctx.save();
  ctx.lineWidth = 2; ctx.strokeStyle = th.fg;
  if (hit.type === 'rect') {
    ctx.strokeRect(hit.x + 1, hit.y + 1, Math.max(1, hit.w - 2), Math.max(1, hit.h - 2));
  } else if (hit.type === 'circle') {
    if (hit.fill) { ctx.fillStyle = hit.color || th.fg; ctx.beginPath(); ctx.arc(hit.cx, hit.cy, (hit.r || 3) + 0.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.arc(hit.cx, hit.cy, (hit.r || 3) + 3, 0, Math.PI * 2); ctx.stroke();
  } else if (hit.type === 'wedge') {
    ctx.beginPath(); ctx.moveTo(hit.cx, hit.cy); ctx.arc(hit.cx, hit.cy, hit.r, hit.a0, hit.a1); ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

// Dark-translucent tooltip near the cursor (fixed dark treatment so it stays
// legible over any chart colour in either theme - the site's canvas-overlay
// idiom). Flips to stay inside the canvas.
function drawTooltip(ctx, lines, mx, my, W, H, th) {
  ctx.save();
  ctx.font = '11px ' + th.fontMono; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const padX = 8, padY = 6, lh = 14;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
  const thh = lines.length * lh + padY * 2;
  let x = mx + 14, y = my + 14;
  if (x + tw > W) x = mx - tw - 14;
  if (y + thh > H) y = my - thh - 14;
  if (x < 2) x = 2; if (y < 2) y = 2;
  ctx.fillStyle = 'rgba(18, 18, 18, 0.92)';
  ctx.fillRect(x, y, tw, thh);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, tw, thh);
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? '#fff' : 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(l, x + padX, y + padY + lh / 2 + i * lh);
  });
  ctx.restore();
}

// host: a fresh <div> the caller appends below its existing cards.
// model: { headers: string[], rows: string[][], totalRows: number } - cells are
// raw strings; tablekit infers types via inferColumnTypes.
export function mountTableKit(host, model, opts: any = {}) {
  const rows = model.rows || [];
  const colCount = (model.headers || []).length || (rows[0] ? rows[0].length : 0);
  const headers = Array.from({ length: colCount }, (_, i) => (model.headers && model.headers[i]) || ('Col ' + (i + 1)));
  const initialSample = rows.length > SAMPLE_CAP ? rows.slice(0, SAMPLE_CAP) : rows;
  const colTypes = inferColumnTypes(initialSample, colCount);

  const view = {
    rowIndex: rows.map((_, i) => i),
    colOrder: headers.map((_, i) => i),
    hidden: new Set(),
    sort: { col: -1, dir: 0 },
    globalSearch: '',
    colFilters: {},
  };
  let activeTarget = null;
  let currentSpec = null;
  let lastGroupByResult = null;
  let activeChartType = 'line';
  let stackedOn = false;
  // Ambiguous D/M/Y dates (31/12/2024, 31.12.2024, ...) read day-first by
  // default, matching the site's conventions - this toggle switches every
  // date column's sort order and chart axis to the US month-first reading
  // instead. Unambiguous formats (2024-12-31, 2011.06) are unaffected. Seeded
  // from looksMonthFirst() so a file that PROVES itself month-first (a value
  // like 8/25/2024, where 25 can only be a day) opens already reading it
  // correctly, rather than making every American file click the toggle first.
  let monthFirst = looksMonthFirst(initialSample, colCount, colTypes);
  let lastHits = [];
  let hoverHit = null;
  let disposers = [];
  const onDispose = (fn) => disposers.push(fn);
  const visCols = () => view.colOrder.filter((c) => !view.hidden.has(c));

  function sampleViewRows() {
    const capped = view.rowIndex.length > SAMPLE_CAP ? view.rowIndex.slice(0, SAMPLE_CAP) : view.rowIndex;
    return { indices: capped, sampled: capped.length < view.rowIndex.length };
  }
  function sampleRowsArr() { return sampleViewRows().indices.map((i) => rows[i]); }
  function sampleNote() { const { sampled } = sampleViewRows(); return sampled ? 'sampled ' + SAMPLE_CAP.toLocaleString() + ' of ' + view.rowIndex.length.toLocaleString() : ''; }
  function baseFileName() { return (opts.sheetName || 'table').replace(/[^\w.-]+/g, '_') || 'table'; }

  const card = el('div', { class: 'anr-card anr-tk-card' });
  const [titleH3, helpPanel] = h3help('Workbench' + (opts.sheetName ? ' – ' + opts.sheetName : ''), WORKBENCH_HELP_HTML);
  card.appendChild(titleH3);
  card.appendChild(helpPanel);

  // ---------------- toolbar ----------------
  const searchInput = el('input', { type: 'search', placeholder: 'Search all columns…', class: 'anr-tk-search' });
  const statusEl = el('span', { class: 'anr-tk-status anr-hint' });
  const colsDetails = el('details', { class: 'anr-tk-colsmenu' });
  colsDetails.appendChild(el('summary', { class: 'anr-btn anr-btn-sm' }, 'Columns'));
  const colsList = el('div', { class: 'anr-tk-colslist' });
  colsDetails.appendChild(colsList);

  // "Split column" menu - some files stash several fields as delimited text in
  // one column (e.g. a spreadsheet with "id code value" pasted into column A).
  // This breaks a chosen column into real columns on a delimiter.
  const splitColSel = el('select', { class: 'anr-btn anr-select' });
  const splitDelimSel = el('select', { class: 'anr-btn anr-select' }, [
    el('option', { value: 'auto' }, 'Auto-detect'),
    el('option', { value: 'ws' }, 'Whitespace'),
    el('option', { value: 'comma' }, 'Comma'),
    el('option', { value: 'semi' }, 'Semicolon'),
    el('option', { value: 'tab' }, 'Tab'),
    el('option', { value: 'pipe' }, 'Pipe'),
  ]);
  const splitBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Split');
  const resetSplitBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', hidden: true }, 'Undo split');
  const splitHint = el('p', { class: 'anr-hint', style: 'margin:6px 0 0;' });
  const splitDetails = el('details', { class: 'anr-tk-colsmenu anr-tk-splitmenu' });
  splitDetails.appendChild(el('summary', { class: 'anr-btn anr-btn-sm' }, 'Split column'));
  splitDetails.appendChild(el('div', { class: 'anr-tk-colslist anr-tk-splitbody' }, [
    el('div', { class: 'anr-tk-splitrow' }, [el('span', { class: 'anr-hint' }, 'Column'), splitColSel]),
    el('div', { class: 'anr-tk-splitrow' }, [el('span', { class: 'anr-hint' }, 'Delimiter'), splitDelimSel]),
    el('div', { class: 'anr-btn-row' }, [splitBtn, resetSplitBtn]),
    splitHint,
  ]));

  // Ambiguous D/M/Y dates (31/12/2024, 31.12.2024, ...) read day-first by
  // default; this flips affected columns to the US month-first reading
  // instead. Starts already reflecting monthFirst's auto-detected value (see
  // looksMonthFirst above) - only shown once a date column actually exists
  // (see updateDateFmtBtn, called from reinferAndReset and just below).
  const dateFmtBtn = el('button', {
    type: 'button', class: 'anr-btn anr-btn-sm' + (monthFirst ? ' is-active' : ''), hidden: true,
    title: 'Ambiguous dates such as 31/12/2024 are read day first by default - switch to the US month-first reading',
  }, monthFirst ? 'Dates: M/D/Y (US)' : 'Dates: D/M/Y');
  dateFmtBtn.addEventListener('click', () => {
    monthFirst = !monthFirst;
    dateFmtBtn.textContent = monthFirst ? 'Dates: M/D/Y (US)' : 'Dates: D/M/Y';
    dateFmtBtn.classList.toggle('is-active', monthFirst);
    applyView();
  });
  function updateDateFmtBtn() { dateFmtBtn.hidden = !colTypes.includes('date'); }
  updateDateFmtBtn();

  const toolbar = el('div', { class: 'anr-tk-toolbar' }, [searchInput, colsDetails, splitDetails, dateFmtBtn, statusEl]);
  card.appendChild(toolbar);

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { view.globalSearch = searchInput.value; applyView(); }, 200);
  });
  onDispose(() => clearTimeout(searchTimer));

  function renderColsList() {
    colsList.innerHTML = '';
    view.colOrder.forEach((c, pos) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !view.hidden.has(c);
      cb.addEventListener('change', () => {
        if (cb.checked) view.hidden.delete(c); else view.hidden.add(c);
        structuralRefresh(); refreshPickers(); refreshGroupByOptions();
      });
      const upBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, '↑');
      const downBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, '↓');
      upBtn.disabled = pos === 0;
      downBtn.disabled = pos === view.colOrder.length - 1;
      upBtn.addEventListener('click', () => {
        if (pos > 0) { const t = view.colOrder[pos - 1]; view.colOrder[pos - 1] = view.colOrder[pos]; view.colOrder[pos] = t; renderColsList(); structuralRefresh(); refreshPickers(); refreshGroupByOptions(); }
      });
      downBtn.addEventListener('click', () => {
        if (pos < view.colOrder.length - 1) { const t = view.colOrder[pos + 1]; view.colOrder[pos + 1] = view.colOrder[pos]; view.colOrder[pos] = t; renderColsList(); structuralRefresh(); refreshPickers(); refreshGroupByOptions(); }
      });
      colsList.appendChild(el('div', { class: 'anr-tk-colrow' }, [cb, el('span', {}, headers[c]), upBtn, downBtn]));
    });
  }
  renderColsList();

  // ---------------- split column into several ----------------
  const DELIMS = {
    ws: { re: /\s+/, label: 'whitespace' },
    comma: { re: /\s*,\s*/, label: 'comma' },
    semi: { re: /\s*;\s*/, label: 'semicolon' },
    tab: { re: /\t/, label: 'tab' },
    pipe: { re: /\s*\|\s*/, label: 'pipe' },
  };
  let splitBackup = null; // { headers, rows } snapshot taken before the first split

  // Guess the delimiter of a column: whichever candidate splits the most cells
  // into a consistent field count > 1 (mode count × how often it recurs).
  function detectDelimiter(colIdx) {
    const vals = [];
    for (let i = 0; i < rows.length && vals.length < 200; i++) { const v = rows[i][colIdx]; if (v && v.trim()) vals.push(v.trim()); }
    let best = null;
    for (const id in DELIMS) {
      const counts = vals.map((v) => v.split(DELIMS[id].re).length);
      const freq: any = {};
      counts.forEach((n) => { if (n > 1) freq[n] = (freq[n] || 0) + 1; });
      let mode = 0, modeFreq = 0;
      for (const k in freq) if (freq[k] > modeFreq) { modeFreq = freq[k]; mode = +k; }
      const score = modeFreq * mode;
      if (score && (!best || score > best.score)) best = { id, ...DELIMS[id], score };
    }
    return best;
  }

  // Recompute types and reset the view after the column shape changes, then
  // rebuild every dependent piece (grid, columns menu, pickers, stats, charts).
  function reinferAndReset() {
    const sample = rows.length > SAMPLE_CAP ? rows.slice(0, SAMPLE_CAP) : rows;
    const t = inferColumnTypes(sample, headers.length);
    colTypes.length = 0; t.forEach((x) => colTypes.push(x));
    updateDateFmtBtn();
    view.colOrder = headers.map((_, i) => i);
    view.hidden = new Set();
    view.sort = { col: -1, dir: 0 };
    view.colFilters = {};
    activeTarget = null;
    renderColsList();
    refreshGroupByOptions();
    computeRowIndex();
    if (gridApi) { gridApi.renderHeader(); gridApi.renderBody(); }
    buildSuggestions();
    refreshPickers();
    updateStatsBar();
  }

  // Split visible column `colIdx` on `delimChoice` ('auto' detects). Returns
  // { added, label } or null when no delimiter is present.
  function applySplit(colIdx, delimChoice) {
    const cand = delimChoice === 'auto' ? detectDelimiter(colIdx) : DELIMS[delimChoice];
    if (!cand) return null;
    const re = cand.re;
    const cut = (v) => (v == null ? '' : String(v)).trim().split(re);
    let maxParts = 1;
    for (let i = 0; i < rows.length; i++) { const p = cut(rows[i][colIdx]).length; if (p > maxParts) maxParts = p; }
    maxParts = Math.min(maxParts, 50);
    if (maxParts < 2) return null;
    if (!splitBackup) splitBackup = { headers: headers.slice(), rows: rows.map((r) => r.slice()) };
    // Header names: split the header cell on the same delimiter and use each
    // part; number off the original name for any part the header didn't cover.
    const hp = cut(headers[colIdx]);
    const newHeaders = [];
    for (let k = 0; k < maxParts; k++) newHeaders.push(hp[k] != null && hp[k] !== '' ? hp[k] : headers[colIdx] + ' ' + (k + 1));
    const rebuiltHeaders = headers.slice(0, colIdx).concat(newHeaders, headers.slice(colIdx + 1));
    for (let i = 0; i < rows.length; i++) {
      const parts = cut(rows[i][colIdx]);
      const filled = [];
      for (let k = 0; k < maxParts; k++) filled.push(parts[k] != null ? parts[k] : '');
      rows[i] = rows[i].slice(0, colIdx).concat(filled, rows[i].slice(colIdx + 1));
    }
    headers.length = 0; rebuiltHeaders.forEach((h) => headers.push(h));
    reinferAndReset();
    return { added: maxParts, label: cand.label };
  }

  function resetSplit() {
    if (!splitBackup) return;
    headers.length = 0; splitBackup.headers.forEach((h) => headers.push(h));
    rows.length = 0; splitBackup.rows.forEach((r) => rows.push(r.slice()));
    splitBackup = null;
    reinferAndReset();
  }

  function populateSplitCols() {
    splitColSel.innerHTML = '';
    visCols().forEach((c) => splitColSel.appendChild(el('option', { value: String(c) }, headers[c])));
  }
  splitDetails.addEventListener('toggle', () => { if (splitDetails.open) populateSplitCols(); });
  splitBtn.addEventListener('click', () => {
    const c = splitColSel.value === '' ? -1 : +splitColSel.value;
    if (c < 0) return;
    const res = applySplit(c, splitDelimSel.value);
    if (res) { splitHint.textContent = 'Split into ' + res.added + ' columns on ' + res.label + '.'; resetSplitBtn.hidden = false; populateSplitCols(); }
    else splitHint.textContent = 'No repeating delimiter found in that column.';
  });
  resetSplitBtn.addEventListener('click', () => {
    resetSplit();
    resetSplitBtn.hidden = true;
    splitHint.textContent = 'Restored the original columns.';
    populateSplitCols();
  });

  // grid, stats, group-by, chart builder, export and suggestions are built in
  // the following section (state closures shared via the outer function scope).
  function buildGrid() {
    // One scrolling container (scrollWrap) holding one table. The header is a
    // normal <thead> pinned with position:sticky; top:0 and the row-number
    // column with position:sticky; left:0 - both work reliably because nothing
    // above them has a transform (a transform on an ancestor establishes a new
    // containing block and is what made the header "drift down" in an earlier
    // version). The virtualised window is reserved with leading/trailing spacer
    // <tr>s, not a translateY.
    //
    // Column widths: table-layout:fixed + an explicit <colgroup> gives stable
    // per-column widths, and we set an explicit pixel width on the table equal
    // to the sum of those columns. That explicit width is essential - with
    // table-layout:fixed and an auto width the browser shrinks the table to the
    // container and distributes the colgroup widths as ratios, so it never
    // overflows and horizontal scroll never engages. Because header and body
    // are the same table they can never desync (no scrollbar-offset gap).
    const COL_W = 150;
    const ROWNUM_W = 48;
    const scrollWrap = el('div', { class: 'anr-tk-scroll' });
    const colgroup = el('colgroup');
    const thead = el('thead');
    const tbody = el('tbody');
    const table = el('table', { class: 'anr-tk-table' }, [colgroup, thead, tbody]);
    scrollWrap.appendChild(table);

    function renderColgroup() {
      const n = visCols().length;
      colgroup.innerHTML = '';
      colgroup.appendChild(el('col', { style: `width:${ROWNUM_W}px` }));
      for (let i = 0; i < n; i++) colgroup.appendChild(el('col', { style: `width:${COL_W}px` }));
      table.style.width = (ROWNUM_W + COL_W * n) + 'px';
    }

    let scrollRaf = null;
    const onScroll = () => { if (scrollRaf) return; scrollRaf = requestAnimationFrame(() => { scrollRaf = null; renderBody(); }); };
    scrollWrap.addEventListener('scroll', onScroll);
    onDispose(() => scrollWrap.removeEventListener('scroll', onScroll));

    const ro = new ResizeObserver(() => renderBody());
    ro.observe(scrollWrap);
    onDispose(() => ro.disconnect());

    function onHeaderClick(c) {
      if (view.sort.col !== c) { view.sort.col = c; view.sort.dir = 1; }
      else if (view.sort.dir === 1) view.sort.dir = -1;
      else { view.sort.col = -1; view.sort.dir = 0; }
      // Select the whole column vertically, then re-render (applyView re-renders
      // the body, which re-applies the highlight from selRect).
      const cp = visCols().indexOf(c);
      selRect = { r0: 0, r1: Math.max(0, view.rowIndex.length - 1), c0: cp, c1: cp };
      activeTarget = { kind: 'col', col: c };
      showChartSelBtn(false);
      applyView();
    }

    function buildFilterPopover(c) {
      const type = colTypes[c];
      const pop = el('div', { class: 'anr-tk-filterpop is-hidden' });
      let input1, input2 = null;
      if (type === 'number') {
        input1 = el('input', { type: 'number', placeholder: 'Min', class: 'anr-tk-filterinput' });
        input2 = el('input', { type: 'number', placeholder: 'Max', class: 'anr-tk-filterinput' });
        pop.appendChild(input1); pop.appendChild(input2);
      } else {
        input1 = el('input', { type: 'text', placeholder: 'Contains…', class: 'anr-tk-filterinput' });
        pop.appendChild(input1);
      }
      const applyBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Apply');
      const clearBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Clear');
      pop.appendChild(el('div', { class: 'anr-btn-row' }, [applyBtn, clearBtn]));
      applyBtn.addEventListener('click', () => {
        if (type === 'number') {
          const min = input1.value === '' ? null : parseFloat(input1.value);
          const max = input2.value === '' ? null : parseFloat(input2.value);
          if (min == null && max == null) delete view.colFilters[c]; else view.colFilters[c] = { min, max };
        } else if (!input1.value) delete view.colFilters[c]; else view.colFilters[c] = { text: input1.value };
        pop.classList.add('is-hidden');
        applyView();
      });
      clearBtn.addEventListener('click', () => {
        input1.value = ''; if (input2) input2.value = '';
        delete view.colFilters[c]; pop.classList.add('is-hidden'); applyView();
      });
      return pop;
    }

    function renderHeader() {
      renderColgroup();
      thead.innerHTML = '';
      const htr = el('tr');
      htr.appendChild(el('th', { class: 'anr-tk-corner anr-tk-sticky-col anr-tk-sticky-row' }, '#'));
      for (const c of visCols()) {
        const th = el('th', { class: 'anr-tk-th anr-tk-sticky-row' + (view.colFilters[c] ? ' has-filter' : '') });
        const label = el('span', { class: 'anr-tk-thlabel' }, headers[c] + (view.sort.col === c ? (view.sort.dir === 1 ? ' ▲' : ' ▼') : ''));
        label.addEventListener('click', () => onHeaderClick(c));
        th.appendChild(label);
        const filterBtn = el('button', { type: 'button', class: 'anr-tk-filterbtn', title: 'Filter column' }, '⚙');
        const pop = buildFilterPopover(c);
        filterBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.anr-tk-filterpop').forEach((p) => { if (p !== pop) p.classList.add('is-hidden'); });
          pop.classList.toggle('is-hidden');
        });
        th.appendChild(filterBtn); th.appendChild(pop);
        htr.appendChild(th);
      }
      thead.appendChild(htr);
    }

    let dragging = false, dragStart = null, dragCur = null, justDragged = false;
    // The current selection rectangle, in view-position (r) / visible-column
    // position (c) coordinates. Set by dragging, by a column-header click (whole
    // column) or a row-number click (whole row); consumed by the highlighter.
    let selRect = null;
    function cellFromEvent(e) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const td = target && target.closest && target.closest('td.anr-tk-cell');
      if (!td || !tbody.contains(td)) return null;
      return { r: +td.dataset.r, c: +td.dataset.c };
    }
    function currentSelectionRect() {
      if (!dragStart || !dragCur) return null;
      return { r0: Math.min(dragStart.r, dragCur.r), r1: Math.max(dragStart.r, dragCur.r), c0: Math.min(dragStart.c, dragCur.c), c1: Math.max(dragStart.c, dragCur.c) };
    }
    function applySelectionHighlight() {
      tbody.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
      thead.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
      const rect = selRect;
      if (!rect) return;
      tbody.querySelectorAll('td.anr-tk-cell').forEach((td) => {
        const r = +td.dataset.r, c = +td.dataset.c;
        if (r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1) td.classList.add('is-selected');
      });
      tbody.querySelectorAll('th.anr-tk-rownum').forEach((th) => {
        const r = +th.dataset.r;
        if (r >= rect.r0 && r <= rect.r1) th.classList.add('is-selected');
      });
      thead.querySelectorAll('th.anr-tk-th').forEach((th, cp) => {
        if (cp >= rect.c0 && cp <= rect.c1) th.classList.add('is-selected');
      });
    }
    // Whole-row selection from a row-number click (a plottable range).
    function selectRow(rp) {
      const cn = visCols().length;
      selRect = { r0: rp, r1: rp, c0: 0, c1: Math.max(0, cn - 1) };
      activeTarget = { kind: 'range', r0: rp, r1: rp, c0: 0, c1: cn - 1 };
      applySelectionHighlight();
      updateStatsBar();
      showChartSelBtn(true);
    }
    function onWinMove(e) { if (!dragging) return; const cell = cellFromEvent(e); if (cell) { dragCur = cell; selRect = currentSelectionRect(); applySelectionHighlight(); activeTarget = { kind: 'range', ...selRect }; updateStatsBar(); } }
    function onWinUp() {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      if (dragStart && dragCur && (dragStart.r !== dragCur.r || dragStart.c !== dragCur.c)) justDragged = true;
      const rect = currentSelectionRect();
      selRect = rect;
      if (rect) { activeTarget = { kind: 'range', ...rect }; updateStatsBar(); showChartSelBtn(true); }
    }
    function onPointerDown(e) {
      // Touch: don't hijack the gesture for drag-select - preventDefault would
      // block scrolling the grid. Taps (cell/header/row-number) still fire as
      // clicks, so touch users keep every selection except click-drag ranges.
      if (e.pointerType === 'touch') return;
      const cell = cellFromEvent(e);
      if (!cell) return;
      // Stop the browser's native text-selection drag - without this, dragging
      // across cells highlights their text instead of (or as well as) building
      // our own range selection, and the stray selection can turn a drag into
      // a spurious click that pops the cell-value modal.
      e.preventDefault();
      dragging = true; dragStart = cell; dragCur = cell; justDragged = false;
      selRect = currentSelectionRect();
      applySelectionHighlight();
      window.addEventListener('pointermove', onWinMove);
      window.addEventListener('pointerup', onWinUp);
    }
    tbody.addEventListener('pointerdown', onPointerDown);
    onDispose(() => {
      tbody.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
    });

    function renderBody() {
      // Read scrollTop BEFORE clearing the body. Emptying <tbody> first
      // collapses the content to ~zero height, so the browser clamps scrollTop
      // back to 0; reading it afterwards then always yields 0 and pins the view
      // at the top - which is why vertical scrolling appeared completely dead.
      const total = view.rowIndex.length;
      const scrollTop = scrollWrap.scrollTop;
      const viewH = scrollWrap.clientHeight || 410;
      tbody.innerHTML = '';
      const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
      const count = Math.ceil(viewH / ROW_H) + OVERSCAN * 2;
      const last = Math.min(total, first + count);
      const cols = visCols();
      const colSpan = cols.length + 1;
      const frag = document.createDocumentFragment();
      // Leading/trailing spacer rows reserve the scrolled-past height so the
      // scrollbar reflects the full row count, without moving the table itself
      // (a transform would break the sticky header - see the comment above).
      if (first > 0) {
        frag.appendChild(el('tr', { class: 'anr-tk-spacerrow' }, [
          el('td', { colspan: String(colSpan), style: `height:${first * ROW_H}px;` }),
        ]));
      }
      for (let i = first; i < last; i++) {
        const origIdx = view.rowIndex[i];
        const r = rows[origIdx];
        const tr = el('tr');
        const rownumTh = el('th', { class: 'anr-tk-rownum anr-tk-sticky-col', title: 'Click to select this row' }, String(origIdx + 1));
        rownumTh.dataset.r = String(i);
        rownumTh.addEventListener('click', () => selectRow(i));
        tr.appendChild(rownumTh);
        cols.forEach((c, cp) => {
          const val = r[c] || '';
          const disp = val.length > 200 ? val.slice(0, 200) + '…' : val;
          const td = el('td', { class: 'anr-tk-cell anr-cell-click', title: 'Click to view the full value' }, disp);
          td.dataset.r = String(i); td.dataset.c = String(cp);
          td.addEventListener('click', () => { if (justDragged) { justDragged = false; return; } showCellPopup(val, headers[c]); });
          tr.appendChild(td);
        });
        frag.appendChild(tr);
      }
      if (last < total) {
        frag.appendChild(el('tr', { class: 'anr-tk-spacerrow' }, [
          el('td', { colspan: String(colSpan), style: `height:${(total - last) * ROW_H}px;` }),
        ]));
      }
      tbody.appendChild(frag);
      statusEl.textContent = `Showing ${total.toLocaleString()} of ${rows.length.toLocaleString()} rows`;
      applySelectionHighlight();
    }

    return { el: scrollWrap, renderHeader, renderBody };
  }

  let chartSelBtn = null;
  function showChartSelBtn(show) { if (chartSelBtn) chartSelBtn.hidden = !show; }

  const statsBarEl = el('div', { class: 'anr-tk-statsbar' });
  function buildStatsBar() {
    statsBarEl.appendChild(el('span', { class: 'anr-hint' }, 'Click a column header or drag a cell range to see stats.'));
    return statsBarEl;
  }
  function statLine(label, text) { return el('div', { class: 'anr-tk-statline' }, [el('strong', {}, label + ': '), text]); }
  function updateStatsBar() {
    statsBarEl.innerHTML = '';
    if (!activeTarget) { statsBarEl.appendChild(el('span', { class: 'anr-hint' }, 'Click a column header or drag a cell range to see stats.')); return; }
    if (activeTarget.kind === 'col') {
      const col = activeTarget.col, type = colTypes[col];
      const sample = sampleRowsArr();
      const vals = columnValues(sample, col, type);
      if (type === 'number') {
        const d = describe(vals);
        statsBarEl.appendChild(statLine(headers[col], `n=${d.count} · sum=${fmtAxisNum(d.sum)} · avg=${fmtAxisNum(d.mean)} · median=${fmtAxisNum(d.median)} · min=${fmtAxisNum(d.min)} · max=${fmtAxisNum(d.max)} · stddev=${fmtAxisNum(d.stddev)} · distinct=${d.distinct}`));
      } else {
        const freq = new Map();
        for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
        const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${truncateLbl(v, 24)} (${n})`).join(', ');
        statsBarEl.appendChild(statLine(headers[col], `n=${vals.length} · distinct=${freq.size} · top: ${top || '-'}`));
      }
    } else if (activeTarget.kind === 'range') {
      const { r0, r1, c0, c1 } = activeTarget;
      const cols = visCols();
      const vals = [];
      for (let rp = r0; rp <= r1 && rp < view.rowIndex.length; rp++) {
        const r = rows[view.rowIndex[rp]];
        for (let cp = c0; cp <= c1 && cp < cols.length; cp++) { const n = toNumber(r[cols[cp]]); if (!isNaN(n)) vals.push(n); }
      }
      const d = describe(vals);
      statsBarEl.appendChild(statLine('Selection', `${r1 - r0 + 1} rows × ${c1 - c0 + 1} cols · n=${d.count} · sum=${fmtAxisNum(d.sum)} · avg=${fmtAxisNum(d.mean)} · median=${fmtAxisNum(d.median)} · min=${fmtAxisNum(d.min)} · max=${fmtAxisNum(d.max)} · stddev=${fmtAxisNum(d.stddev)}`));
    }
  }

  // Full-word aggregation labels (the select values stay the short keys the
  // groupBy() helper expects). "count" needs no value column.
  const AGG_LABELS = [['count', 'count'], ['sum', 'sum'], ['avg', 'average'], ['min', 'minimum'], ['max', 'maximum'], ['median', 'median']];
  const gbKeySelect = el('select', { class: 'anr-btn anr-select' });
  const gbAggSelect = el('select', { class: 'anr-btn anr-select' }, AGG_LABELS.map(([v, l]) => el('option', { value: v }, l)));
  const gbValSelect = el('select', { class: 'anr-btn anr-select' });
  const gbOfLabel = el('span', { class: 'anr-hint' }, ' of ');
  const gbResult = el('div', { class: 'anr-tk-gbresult' });
  let runGroupBy = () => {};
  function refreshGroupByOptions() {
    const cols = visCols();
    // Leading "N/A" turns the summary off (its blank value is the off switch).
    gbKeySelect.innerHTML = ''; gbKeySelect.appendChild(el('option', { value: '' }, 'N/A'));
    cols.forEach((c) => gbKeySelect.appendChild(el('option', { value: String(c) }, headers[c])));
    gbValSelect.innerHTML = ''; cols.filter((c) => colTypes[c] === 'number').forEach((c) => gbValSelect.appendChild(el('option', { value: String(c) }, headers[c])));
    runGroupBy();
  }
  function buildGroupBy() {
    // "count" ignores the value column, so grey it out (kept in place so the
    // sentence doesn't reflow).
    function syncValEnabled() {
      const isCount = gbAggSelect.value === 'count';
      gbValSelect.disabled = isCount;
      gbOfLabel.classList.toggle('is-dim', isCount);
    }
    // Live: recompute on any change, no button.
    runGroupBy = function () {
      syncValEnabled();
      gbResult.innerHTML = '';
      if (gbKeySelect.value === '') return; // "N/A" - summary off
      const keyCol = +gbKeySelect.value, agg = gbAggSelect.value;
      const valCol = gbValSelect.value === '' ? -1 : +gbValSelect.value;
      if (isNaN(keyCol)) return;
      if (agg !== 'count' && valCol < 0) {
        gbResult.appendChild(el('p', { class: 'anr-hint' }, 'This table has no number column to ' + AGG_LABELS.find(([v]) => v === agg)[1] + '. Pick "count", or add a numeric column.'));
        return;
      }
      const sample = sampleRowsArr();
      const result = groupBy(sample, keyCol, agg === 'count' ? keyCol : valCol, agg);
      lastGroupByResult = { keyCol, valCol, agg, result };
      const aggLabel = AGG_LABELS.find(([v]) => v === agg)[1];
      const valName = agg === 'count' ? 'rows' : headers[valCol];
      const thead = el('thead', {}, el('tr', {}, [el('th', {}, headers[keyCol]), el('th', {}, aggLabel + ' of ' + valName)]));
      const tbody = el('tbody');
      result.forEach(([k, v]) => tbody.appendChild(row(k, isFinite(v) ? fmtNumFull(v) : '-')));
      const tbl = el('table', { class: 'anr-readout anr-tk-gbtable' }, [thead, tbody]);
      // Scrollable frame so a long list of groups does not push the page down.
      gbResult.appendChild(el('div', { class: 'anr-tk-gbscroll' }, tbl));
      gbResult.appendChild(el('p', { class: 'anr-hint', style: 'margin:6px 0 0;' }, result.length.toLocaleString() + ' group' + (result.length === 1 ? '' : 's')));
      const plotBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Plot as bar');
      plotBtn.addEventListener('click', () => {
        loadSpecIntoBuilder({ type: 'bar', xLabels: result.map((r) => r[0]), series: [{ name: aggLabel + ' of ' + valName, data: result.map((r) => r[1]) }], meta: { xTitle: headers[keyCol], yTitle: aggLabel + ' of ' + valName } });
      });
      gbResult.appendChild(plotBtn);
    };
    gbKeySelect.addEventListener('change', runGroupBy);
    gbAggSelect.addEventListener('change', runGroupBy);
    gbValSelect.addEventListener('change', runGroupBy);
    const gbHelpBtn = el('button', { type: 'button', class: 'anr-info-btn', title: 'How this works' }, '[?]');
    const gbHelpPanel = el('div', { class: 'anr-info-panel is-hidden', html: GROUPBY_HELP_HTML });
    wireInfoToggle(gbHelpBtn, gbHelpPanel);
    return el('div', { class: 'anr-tk-gbrow' }, [
      el('span', { class: 'anr-hint' }, 'For each '), gbKeySelect,
      el('span', { class: 'anr-hint' }, ' show the '), gbAggSelect,
      gbOfLabel, gbValSelect,
      gbHelpBtn, gbHelpPanel,
      gbResult,
    ]);
  }

  const xList = el('div', { class: 'anr-tk-ylist anr-tk-xlist' });
  const xRadioName = 'anr-tk-xaxis-' + Math.random().toString(36).slice(2, 8); // unique per instance
  const yList = el('div', { class: 'anr-tk-ylist' });
  const typeRow = el('div', { class: 'anr-btn-row anr-tk-typerow' });
  const stackedToggle = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Stacked: off');
  const binsInput = el('input', { type: 'number', min: '5', max: '40', placeholder: 'auto', class: 'anr-tk-filterinput anr-tk-bins' });
  const dataFields = el('div', { class: 'anr-tk-datafields' });
  const chartCanvas = el('canvas', { class: 'anr-tk-canvas' });
  const chartHost = el('div', { class: 'anr-tk-charthost' }, chartCanvas);
  const captionEl = el('div', { class: 'anr-tk-chart-caption anr-hint' });
  const suggBody = el('div', { class: 'anr-btn-row' });
  const suggRow = el('div', { class: 'anr-tk-suggrow', hidden: true }, [
    el('span', { class: 'anr-tk-fieldlabel' }, 'Suggested'), suggBody,
  ]);
  let chartBuilt = false;

  // A labelled control: a caption over its input, so each picker says what it
  // drives without a legend.
  const field = (label, ctrl) => el('div', { class: 'anr-tk-field' }, [
    el('span', { class: 'anr-tk-fieldlabel' }, label), ctrl,
  ]);

  // Only the pickers the current chart type actually consumes are shown, so
  // the controls in front of you always match the chart - no dead inputs.
  function renderFields() {
    const t = activeChartType;
    dataFields.innerHTML = '';
    if (t === 'heatmap') { dataFields.appendChild(el('span', { class: 'anr-hint' }, 'Correlates every numeric column - nothing to pick.')); return; }
    if (t === 'histogram') { dataFields.appendChild(field('Column', yList)); dataFields.appendChild(field('Bins', binsInput)); return; }
    if (t === 'box') { dataFields.appendChild(field('Columns', yList)); return; }
    if (t === 'pie') { dataFields.appendChild(field('Category', xList)); dataFields.appendChild(field('Value', yList)); return; }
    if (t === 'bar') { dataFields.appendChild(field('Category', xList)); dataFields.appendChild(field('Y axis', yList)); dataFields.appendChild(field('Options', stackedToggle)); return; }
    if (t === 'area') { dataFields.appendChild(field('X axis', xList)); dataFields.appendChild(field('Y axis', yList)); dataFields.appendChild(field('Options', stackedToggle)); return; }
    dataFields.appendChild(field('X axis', xList)); dataFields.appendChild(field('Y axis', yList)); // line, scatter
  }

  function setActiveType() {
    typeRow.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.type === activeChartType));
  }

  // Draw a spec and cache its hit regions for hover. Every path that renders
  // the chart goes through here so hover always matches what's on screen.
  function renderChart(spec) {
    lastHits = drawChart(chartCanvas, spec) || [];
    hoverHit = null;
  }

  // Live redraw: every control change lands here, so there is no separate
  // "build" step to remember. An empty/invalid pick shows a plain hint rather
  // than a blank canvas.
  function redraw() {
    if (!chartBuilt) return;
    const spec = buildSpecFromPickers();
    currentSpec = spec;
    if (spec) { renderChart(spec); captionEl.textContent = spec.meta && spec.meta.sampledNote ? '(' + spec.meta.sampledNote + ')' : ''; return; }
    lastHits = [];
    const ctx = chartCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
    captionEl.textContent = activeChartType === 'heatmap' ? 'Needs at least two numeric columns.' : 'Tick at least one value column to chart.';
  }

  // Draw a ready-made spec (from a suggestion or group-by "Plot as bar") and
  // sync the type buttons/fields to match it.
  function loadSpecIntoBuilder(spec) {
    currentSpec = spec;
    activeChartType = spec.type;
    setActiveType();
    renderFields();
    renderChart(spec);
    captionEl.textContent = spec.meta && spec.meta.sampledNote ? '(' + spec.meta.sampledNote + ')' : '';
    chartHost.scrollIntoView({ block: 'nearest' });
  }

  // Hover: highlight the element under the cursor and float a tooltip. The base
  // chart is re-drawn each move (cheap for these small charts) but lastHits is
  // left untouched, so the cached hit's geometry stays valid to draw over.
  function onChartMove(e) {
    if (!currentSpec || !lastHits.length) { chartCanvas.style.cursor = 'default'; return; }
    const r = chartCanvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = hitTest(lastHits, mx, my);
    chartCanvas.style.cursor = hit ? 'pointer' : 'default';
    if (!hit && !hoverHit) return;
    hoverHit = hit;
    drawChart(chartCanvas, currentSpec);
    if (hit) {
      const ctx = chartCanvas.getContext('2d'), th = theme();
      drawHitHighlight(ctx, hit, th);
      drawTooltip(ctx, hit.tip, mx, my, r.width, r.height, th);
    }
  }
  function onChartLeave() {
    chartCanvas.style.cursor = 'default';
    if (hoverHit && currentSpec) { hoverHit = null; drawChart(chartCanvas, currentSpec); }
  }

  function buildChartBuilder() {
    CHART_TYPES.forEach((t) => {
      const btn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', title: 'Draw a ' + t + ' chart' }, t[0].toUpperCase() + t.slice(1));
      btn.dataset.type = t;
      btn.addEventListener('click', () => { activeChartType = t; setActiveType(); renderFields(); redraw(); });
      typeRow.appendChild(btn);
    });
    stackedToggle.addEventListener('click', () => {
      stackedOn = !stackedOn;
      stackedToggle.textContent = 'Stacked: ' + (stackedOn ? 'on' : 'off');
      stackedToggle.classList.toggle('is-active', stackedOn);
      redraw();
    });
    xList.addEventListener('change', redraw);
    yList.addEventListener('change', redraw);
    binsInput.addEventListener('input', redraw);

    chartSelBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', hidden: true }, 'Plot selected range');
    chartSelBtn.addEventListener('click', () => { const spec = buildSpecFromSelection(); if (spec) loadSpecIntoBuilder(spec); });

    const chartRO = new ResizeObserver(() => { if (currentSpec) renderChart(currentSpec); });
    chartRO.observe(chartHost);
    onDispose(() => chartRO.disconnect());

    chartCanvas.addEventListener('pointermove', onChartMove);
    chartCanvas.addEventListener('pointerleave', onChartLeave);
    onDispose(() => {
      chartCanvas.removeEventListener('pointermove', onChartMove);
      chartCanvas.removeEventListener('pointerleave', onChartLeave);
    });

    chartBuilt = true;
    return el('div', { class: 'anr-tk-chart' }, [
      suggRow,
      el('div', { class: 'anr-tk-chart-controls' }, [
        field('Chart type', typeRow),
        dataFields,
      ]),
      chartHost,
      el('div', { class: 'anr-tk-chart-foot' }, [captionEl, chartSelBtn]),
    ]);
  }

  function refreshPickers() {
    const cols = visCols();
    xList.innerHTML = '';
    cols.forEach((c) => {
      const rb = el('input', { type: 'radio', name: xRadioName }); rb.dataset.col = String(c);
      xList.appendChild(el('label', { class: 'anr-tk-ycheck' }, [rb, ' ' + headers[c]]));
    });
    yList.innerHTML = '';
    cols.filter((c) => colTypes[c] === 'number').forEach((c) => {
      const cb = el('input', { type: 'checkbox' }); cb.dataset.col = String(c);
      yList.appendChild(el('label', { class: 'anr-tk-ycheck' }, [cb, ' ' + headers[c]]));
    });
    const dateCol = cols.find((c) => colTypes[c] === 'date');
    const textCol = cols.find((c) => colTypes[c] === 'text');
    const xDefault = dateCol != null ? dateCol : (textCol != null ? textCol : cols[0]);
    if (xDefault != null) { const rb = xList.querySelector(`input[data-col="${xDefault}"]`); if (rb) rb.checked = true; }
    const firstNum = cols.find((c) => colTypes[c] === 'number');
    if (firstNum != null) { const cb = yList.querySelector(`input[data-col="${firstNum}"]`); if (cb) cb.checked = true; }
    const defType = xDefault != null && colTypes[xDefault] === 'text' ? 'bar' : 'line';
    activeChartType = defType;
    setActiveType();
    renderFields();
    redraw();
  }

  // ---- Shared spec builders (used by both the pickers and the suggestions) ----
  // An ordered XY spec: points are sorted by the X column (numbers/dates
  // numerically, text alphabetically) and, for numbers/dates, positioned by
  // real value - so the X axis genuinely drives the plot.
  function xySpec(type, xCol, yCols, extraMeta) {
    const sample = sampleRowsArr();
    const xType = colTypes[xCol];
    const xIsNumeric = xType === 'number' || xType === 'date';
    const xKey = (r) => {
      const raw = r[xCol];
      if (xType === 'number') { const n = toNumber(raw); return isNaN(n) ? null : n; }
      if (xType === 'date') { const t = parseDateValue(raw, monthFirst); return isNaN(t) ? null : t; }
      return raw == null ? '' : String(raw);
    };
    const ordered = sample.slice().sort((a, b) => {
      const ka = xKey(a), kb = xKey(b);
      if (ka == null && kb == null) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      return typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb;
    });
    const xLabels = ordered.map((r) => r[xCol]);
    const xValues = xIsNumeric ? ordered.map((r) => xKey(r)) : undefined;
    const series = yCols.map((c) => ({ name: headers[c], data: ordered.map((r) => toNumber(r[c])) }));
    return { type, xLabels, xValues, series, meta: Object.assign({ sampledNote: sampleNote() }, extraMeta || {}) };
  }

  function histogramSpec(col, binsWanted?) {
    const vals = columnValues(sampleRowsArr(), col, 'number');
    if (!vals.length) return null;
    const min = Math.min(...vals), max = Math.max(...vals);
    let bins = binsWanted;
    if (!bins || bins < 5 || bins > 40) bins = Math.min(40, Math.max(5, Math.ceil(Math.sqrt(vals.length))));
    const width = (max - min) / bins || 1;
    const counts = new Array(bins).fill(0);
    vals.forEach((v) => { let idx = Math.floor((v - min) / width); if (idx >= bins) idx = bins - 1; if (idx < 0) idx = 0; counts[idx]++; });
    const xLabels = counts.map((_, i) => fmtRange(min + i * width, min + (i + 1) * width));
    return { type: 'histogram', xLabels, series: [{ name: headers[col], data: counts }], meta: { xTitle: headers[col], yTitle: 'Count', sampledNote: sampleNote() } };
  }

  function boxSpec(colsArr) {
    const sample = sampleRowsArr();
    const boxes = colsArr.map((c) => {
      const vals = columnValues(sample, c, 'number').slice().sort((a, b) => a - b);
      if (!vals.length) return null;
      const q1 = percentile(vals, 0.25), q3 = percentile(vals, 0.75), iqr = q3 - q1;
      const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
      const inliers = vals.filter((v) => v >= lo && v <= hi);
      const outliers = vals.filter((v) => v < lo || v > hi);
      return { label: headers[c], min: inliers.length ? inliers[0] : vals[0], max: inliers.length ? inliers[inliers.length - 1] : vals[vals.length - 1], q1, median: percentile(vals, 0.5), q3, outliers };
    }).filter(Boolean);
    if (!boxes.length) return null;
    return { type: 'box', xLabels: boxes.map((b) => b.label), series: [], meta: { box: boxes, yTitle: 'Value', sampledNote: sampleNote() } };
  }

  function buildSpecFromPickers() {
    const type = activeChartType;
    const xRadio = xList.querySelector('input[type=radio]:checked');
    const xCol = xRadio ? +xRadio.dataset.col : -1;
    const yCols = [...yList.querySelectorAll('input[type=checkbox]:checked')].map((cb) => +cb.dataset.col);
    const sample = sampleRowsArr();
    if (type === 'heatmap') {
      const numCols = headers.map((_, i) => i).filter((i) => colTypes[i] === 'number');
      if (numCols.length < 2) return null;
      const paired = numCols.map((c) => sample.map((r) => toNumber(r[c])));
      const matrix = numCols.map((_, i) => numCols.map((_, j) => (i === j ? 1 : pearson(paired[i], paired[j]))));
      return { type: 'heatmap', xLabels: numCols.map((c) => headers[c]), series: [], meta: { heatmap: { labels: numCols.map((c) => headers[c]), matrix }, sampledNote: sampleNote() } };
    }
    if (type === 'pie') {
      if (!yCols.length || xCol < 0) return null;
      const grouped = groupBy(sample, xCol, yCols[0], 'sum');
      return { type: 'pie', xLabels: grouped.map((g) => g[0]), series: [{ name: headers[yCols[0]], data: grouped.map((g) => g[1]) }], meta: { sampledNote: sampleNote() } };
    }
    if (type === 'box') {
      if (!yCols.length) return null;
      return boxSpec(yCols);
    }
    if (type === 'histogram') {
      if (!yCols.length) return null;
      return histogramSpec(yCols[0], parseInt(binsInput.value, 10));
    }
    // line, bar, scatter, area
    if (!yCols.length || xCol < 0) return null;
    const yTitle = yCols.length === 1 ? headers[yCols[0]] : 'Value';
    return xySpec(type, xCol, yCols, { stacked: stackedOn, xTitle: headers[xCol], yTitle });
  }

  function buildSpecFromSelection() {
    if (!activeTarget || activeTarget.kind !== 'range') return null;
    const { r0, r1, c0, c1 } = activeTarget;
    const cols = visCols();
    const rowsSel = [];
    for (let rp = r0; rp <= r1 && rp < view.rowIndex.length; rp++) rowsSel.push(rows[view.rowIndex[rp]]);
    const colsSel = [];
    for (let cp = c0; cp <= c1 && cp < cols.length; cp++) colsSel.push(cols[cp]);
    if (!rowsSel.length || !colsSel.length) return null;
    const firstRow = rowsSel[0];
    const topRowNonNumeric = colsSel.some((c) => isNaN(toNumber(firstRow[c])));
    const firstColVals = rowsSel.map((r) => r[colsSel[0]]);
    const leftColNonNumeric = firstColVals.some((v) => isNaN(toNumber(v)));
    let seriesNames = colsSel.map((c) => headers[c]);
    let startRow = 0, startCol = 0;
    if (topRowNonNumeric) { seriesNames = colsSel.map((c) => firstRow[c]); startRow = 1; }
    const dataRows = rowsSel.slice(startRow);
    let xLabels;
    if (leftColNonNumeric) { xLabels = dataRows.map((r) => r[colsSel[0]]); startCol = 1; }
    else xLabels = dataRows.map((_, i) => String(i + 1));
    const series = [];
    for (let ci = startCol; ci < colsSel.length; ci++) series.push({ name: seriesNames[ci] || headers[colsSel[ci]], data: dataRows.map((r) => toNumber(r[colsSel[ci]])) });
    if (!series.length) return null;
    const xTitle = leftColNonNumeric ? headers[colsSel[0]] : 'Row';
    const yTitle = series.length === 1 ? series[0].name : 'Value';
    return { type: 'line', xLabels, series, meta: { xTitle, yTitle } };
  }

  function buildExportRow() {
    const pngBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Export chart PNG');
    const jsonBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Export stats JSON');
    const csvBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Export rows CSV');
    pngBtn.addEventListener('click', () => {
      if (!currentSpec) return;
      chartCanvas.toBlob((blob) => { if (blob) downloadBlob(baseFileName() + '-' + currentSpec.type + '.png', blob); }, 'image/png');
    });
    jsonBtn.addEventListener('click', () => {
      const doc = {
        stats: statsBarEl.textContent.trim(),
        groupBy: lastGroupByResult ? { key: headers[lastGroupByResult.keyCol], value: lastGroupByResult.valCol >= 0 ? headers[lastGroupByResult.valCol] : null, agg: lastGroupByResult.agg, result: lastGroupByResult.result } : null,
        chart: currentSpec || null,
      };
      downloadBlob(baseFileName() + '-stats.json', new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    });
    csvBtn.addEventListener('click', () => {
      const cols = visCols();
      const lines = [cols.map((c) => csvQuote(headers[c])).join(',')];
      for (const idx of view.rowIndex) { const r = rows[idx]; lines.push(cols.map((c) => csvQuote(r[c] || '')).join(',')); }
      downloadBlob(baseFileName() + '-rows.csv', new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
    });
    return el('div', { class: 'anr-btn-row' }, [pngBtn, jsonBtn, csvBtn]);
  }

  // Suggested charts: generate a broad set of candidate charts from the column
  // shapes, score each by how informative it is likely to be (time series and
  // strong correlations rank highest), then show the best few - most useful
  // first. Every candidate reuses the same spec builders as the manual pickers.
  function buildSuggestions() {
    const SHOW = 6;
    const sample = sampleRowsArr();
    const cols = headers.map((_, i) => i);
    const dateCols = cols.filter((c) => colTypes[c] === 'date');
    const numCols = cols.filter((c) => colTypes[c] === 'number');
    const textCols = cols.filter((c) => colTypes[c] === 'text');

    const distinctOf = (c) => new Set(columnValues(sample, c, colTypes[c])).size;
    // Numeric columns, richest (most spread) first - so we favour columns that
    // actually vary over near-constant ones.
    const desc = new Map(numCols.map((c) => [c, describe(columnValues(sample, c, 'number'))]));
    const numBySpread = numCols.slice().sort((a, b) => (desc.get(b).stddev || 0) - (desc.get(a).stddev || 0));
    // Text columns worth grouping on: repeated values, but not unique-per-row.
    const catCols = textCols.filter((c) => { const k = distinctOf(c); return k >= 2 && k <= 30; }).sort((a, b) => distinctOf(a) - distinctOf(b));

    const cand = [];
    const add = (score, label, build) => cand.push({ score, label, build });

    // Time series: a numeric column over a date column (up to two numerics).
    if (dateCols.length && numCols.length) {
      const dc = dateCols[0];
      numBySpread.slice(0, 2).forEach((yc, i) => {
        add(100 - i, 'Line: ' + headers[yc] + ' over ' + headers[dc], () => xySpec('line', dc, [yc], { xTitle: headers[dc], yTitle: headers[yc] }));
      });
    }

    // Average of a number per category.
    if (catCols.length && numCols.length) {
      catCols.filter((c) => distinctOf(c) <= 20).slice(0, 2).forEach((cc, i) => {
        const yc = numBySpread[0];
        add(85 - i, 'Bar: average ' + headers[yc] + ' by ' + headers[cc], () => { const g = groupBy(sample, cc, yc, 'avg'); return { type: 'bar', xLabels: g.map((x) => x[0]), series: [{ name: 'average ' + headers[yc], data: g.map((x) => x[1]) }], meta: { xTitle: headers[cc], yTitle: 'average ' + headers[yc], sampledNote: sampleNote() } }; });
      });
    }

    // Row counts per category (needs no numeric column).
    if (catCols.length) {
      const cc = catCols[0];
      add(65, 'Bar: count of rows by ' + headers[cc], () => { const g = groupBy(sample, cc, cc, 'count'); return { type: 'bar', xLabels: g.map((x) => x[0]), series: [{ name: 'count', data: g.map((x) => x[1]) }], meta: { xTitle: headers[cc], yTitle: 'count of rows', sampledNote: sampleNote() } }; });
    }

    // Strongest numeric relationships - scatter, ranked by |correlation|.
    if (numCols.length >= 2) {
      const pool = numBySpread.slice(0, 6);
      const arrs = new Map(pool.map((c) => [c, sample.map((r) => toNumber(r[c]))]));
      const pairs = [];
      for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
        const r = pearson(arrs.get(pool[i]), arrs.get(pool[j]));
        if (isFinite(r)) pairs.push({ a: pool[i], b: pool[j], r });
      }
      pairs.sort((p, q) => Math.abs(q.r) - Math.abs(p.r));
      pairs.filter((p) => Math.abs(p.r) >= 0.3).slice(0, 2).forEach((p) => {
        add(52 + Math.abs(p.r) * 45, 'Scatter: ' + headers[p.b] + ' vs ' + headers[p.a] + ' (r=' + p.r.toFixed(2) + ')', () => xySpec('scatter', p.a, [p.b], { xTitle: headers[p.a], yTitle: headers[p.b] }));
      });
    }

    // Correlation heatmap across all numeric columns.
    if (numCols.length >= 3) {
      add(60, 'Correlation heatmap (' + numCols.length + ' numeric columns)', () => { const paired = numCols.map((c) => sample.map((r) => toNumber(r[c]))); const matrix = numCols.map((_, i) => numCols.map((_, j) => (i === j ? 1 : pearson(paired[i], paired[j])))); return { type: 'heatmap', xLabels: numCols.map((c) => headers[c]), series: [], meta: { heatmap: { labels: numCols.map((c) => headers[c]), matrix }, sampledNote: sampleNote() } }; });
    }

    // Distribution of the most spread-out numeric columns.
    numBySpread.filter((c) => desc.get(c).distinct > 5).slice(0, 2).forEach((c, i) => {
      add(46 - i, 'Histogram: ' + headers[c], () => histogramSpec(c));
    });

    // Compare spreads across numeric columns.
    if (numCols.length >= 2) {
      const bcols = numBySpread.slice(0, 8);
      add(40, 'Box plot: spread of ' + bcols.length + ' numeric columns', () => boxSpec(bcols));
    }

    // Share of a total across a small category.
    const pieCat = catCols.find((c) => distinctOf(c) <= 6);
    if (pieCat != null && numCols.length) {
      const yc = numBySpread[0];
      add(44, 'Pie: ' + headers[yc] + ' share by ' + headers[pieCat], () => { const g = groupBy(sample, pieCat, yc, 'sum'); return { type: 'pie', xLabels: g.map((x) => x[0]), series: [{ name: headers[yc], data: g.map((x) => x[1]) }], meta: { sampledNote: sampleNote() } }; });
    }

    cand.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const shown = [];
    for (const s of cand) { if (seen.has(s.label)) continue; seen.add(s.label); shown.push(s); if (shown.length >= SHOW) break; }

    suggBody.innerHTML = '';
    shown.forEach((s) => {
      const btn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, s.label);
      btn.addEventListener('click', () => { const spec = s.build(); if (spec) loadSpecIntoBuilder(spec); });
      suggBody.appendChild(btn);
    });
    suggRow.hidden = shown.length === 0;
  }

  let gridApi = null;
  function applyView() { computeRowIndex(); structuralRefresh(); updateStatsBar(); redraw(); }
  function structuralRefresh() { if (gridApi) { gridApi.renderHeader(); gridApi.renderBody(); } }
  function computeRowIndex() {
    const idx = [];
    const search = view.globalSearch.trim().toLowerCase();
    const filters = Object.entries(view.colFilters);
    const cols = visCols();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let ok = true;
      for (const [colStr, f] of filters) {
        const c = +colStr;
        const raw = r[c] || '';
        if (f.text != null) { if (!raw.toLowerCase().includes(f.text.toLowerCase())) { ok = false; break; } }
        else if (f.min != null || f.max != null) {
          const n = toNumber(raw);
          if (isNaN(n)) { ok = false; break; }
          if (f.min != null && n < f.min) { ok = false; break; }
          if (f.max != null && n > f.max) { ok = false; break; }
        }
      }
      if (ok && search) {
        let hit = false;
        for (const c of cols) { if ((r[c] || '').toLowerCase().includes(search)) { hit = true; break; } }
        if (!hit) ok = false;
      }
      if (ok) idx.push(i);
    }
    if (view.sort.dir !== 0 && view.sort.col >= 0) {
      const c = view.sort.col, type = colTypes[c], dir = view.sort.dir;
      const key = (i) => {
        const raw = (rows[i][c] || '').trim();
        if (raw === '') return null;
        if (type === 'number') { const n = toNumber(raw); return isNaN(n) ? null : n; }
        if (type === 'date') { const t = parseDateValue(raw, monthFirst); return isNaN(t) ? null : t; }
        return raw;
      };
      idx.sort((a, b) => {
        const ka = key(a), kb = key(b);
        if (ka == null && kb == null) return 0;
        if (ka == null) return 1;
        if (kb == null) return -1;
        return typeof ka === 'string' ? dir * ka.localeCompare(kb) : dir * (ka - kb);
      });
    }
    view.rowIndex = idx;
  }

  function finishMount() {
    const grid = buildGrid();
    gridApi = { renderHeader: grid.renderHeader, renderBody: grid.renderBody };
    card.appendChild(grid.el);
    card.appendChild(buildStatsBar());
    card.appendChild(buildChartBuilder());
    card.appendChild(buildGroupBy()); // the "For each ..." summary sits under the chart
    card.appendChild(buildExportRow());

    refreshGroupByOptions();
    computeRowIndex();
    gridApi.renderHeader();
    gridApi.renderBody();
    buildSuggestions();
    refreshPickers();

    host.appendChild(card);

    return {
      destroy() {
        disposers.forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } });
        disposers = [];
        host.innerHTML = '';
      },
    };
  }

  return finishMount();
}
