/* Analyser - SPICE / LTspice raw waveform viewer (.raw)
   ---------------------------------------------------------------------------
   A .raw file is the binary (or ASCII) waveform dump written by a SPICE engine:
   KiCad's built-in ngspice simulator and LTspice both emit it. The header is a
   short block of "Key: value" lines (ASCII for ngspice, UTF-16LE for LTspice)
   listing the analysis type, the variables and the point count, followed by a
   "Binary:" or "Values:" marker and the raw sample data.

   We decode the header, read the sample matrix (handling LTspice's mixed
   double+float packing as well as ngspice's all-double layout, plus complex AC
   data), then either tabulate an operating point (one point) or plot the traces
   on an interactive, hoverable canvas.

   The .raw extension is shared with camera RAW photos, so app.js content-sniffs
   the header (sniffSpiceRaw) before routing a file here. */

import { el, row, rowHelp, h3help, fmtBytes, integrityCard, errorCard } from '../core/util.js';

// --- header signature: "Title:" then "Plotname:" / "Flags:", in ASCII or UTF-16LE.
export async function sniffSpiceRaw(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (!head.length) return false;
    const utf16 = head.length > 1 && head[1] === 0 && head[0] !== 0;
    const dec = new TextDecoder(utf16 ? 'utf-16le' : 'latin1');
    const s = dec.decode(head);
    return /^﻿?Title:/i.test(s) || /^﻿?\s*Title:/i.test(s);
  } catch (_) { return false; }
}

// --- SI-prefixed value formatting (volts, amps, seconds, hertz). ---
const SI = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];
function fmtSI(v, unit) {
  if (!isFinite(v)) return String(v);
  if (v === 0) return '0 ' + unit;
  const a = Math.abs(v);
  let pick = SI[SI.length - 1];
  for (const s of SI) { if (a >= s[0]) { pick = s; break; } }
  const scaled = v / pick[0];
  const txt = Math.abs(scaled) >= 100 ? scaled.toFixed(1)
    : Math.abs(scaled) >= 10 ? scaled.toFixed(2) : scaled.toFixed(3);
  return txt.replace(/\.?0+$/, '') + ' ' + pick[1] + unit;
}
const unitFor = (type) => /current/.test(type || '') ? 'A' : type === 'time' ? 's'
  : type === 'frequency' ? 'Hz' : type === 'voltage' ? 'V' : type === 'flux' ? 'Wb' : '';

// ---------------------------------------------------------------------------
// Parse the raw file into { meta, vars, nPoints, complex, x, data } where data
// is one Float64Array per variable (magnitude for complex).
// ---------------------------------------------------------------------------
function parseRaw(buf) {
  const utf16 = buf.length > 1 && buf[1] === 0 && buf[0] !== 0;
  // Decode the whole file as text to locate the header fields and the data
  // marker. For binary data the trailing bytes decode to junk, but we only read
  // up to the marker as text - the sample bytes are pulled raw from `buf`.
  const dec = new TextDecoder(utf16 ? 'utf-16le' : 'latin1');
  const text = dec.decode(buf);

  const get = (key) => {
    const m = new RegExp('^' + key + ':[ \\t]*(.*)$', 'im').exec(text);
    return m ? m[1].trim() : '';
  };
  const meta = {
    title: get('Title'), date: get('Date'), plotname: get('Plotname'),
    flags: get('Flags'), command: get('Command'), offset: get('Offset'),
  };
  const nVars = parseInt(get('No\\. Variables'), 10) || 0;
  const nPoints = parseInt(get('No\\. Points'), 10) || 0;
  const complex = /complex/i.test(meta.flags);
  if (!nVars || !nPoints) throw new Error('missing variable/point count');

  // Variable table: between "Variables:" and the data marker, one per line as
  // "<index>\t<name>\t<type>".
  const varsStart = text.search(/^Variables:/im);
  const markerRe = /^(Binary|Values):[^\n]*$/im;
  const mm = markerRe.exec(text);
  if (varsStart < 0 || !mm) throw new Error('no variables/data marker');
  const varsBlock = text.slice(text.indexOf('\n', varsStart) + 1, mm.index);
  const vars = [];
  for (const line of varsBlock.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[ \t]+/);
    if (parts.length >= 3) vars.push({ idx: +parts[0], name: parts[1], type: parts[2].toLowerCase() });
    else if (parts.length === 2) vars.push({ idx: +parts[0], name: parts[1], type: '' });
  }
  while (vars.length < nVars) vars.push({ idx: vars.length, name: 'v' + vars.length, type: '' });

  const isBinary = /^Binary:/i.test(mm[0]);
  // Char index just past the marker line's newline -> byte offset of the data.
  const dataCharStart = text.indexOf('\n', mm.index) + 1;

  const data = Array.from({ length: nVars }, () => new Float64Array(nPoints));

  if (isBinary) {
    const dataByteStart = utf16 ? dataCharStart * 2 : dataCharStart;
    const dv = new DataView(buf.buffer, buf.byteOffset + dataByteStart);
    const avail = buf.length - dataByteStart;
    const bpp = Math.floor(avail / nPoints);       // bytes per point
    let scheme;
    if (complex) {
      scheme = 'cplx-double';                       // nVars * 16 (re,im doubles)
    } else if (bpp === 8 + (nVars - 1) * 4) {
      scheme = 'lt-real';                            // LTspice: double + floats
    } else if (bpp >= nVars * 8) {
      scheme = 'real-double';                        // ngspice: all doubles
    } else {
      scheme = 'real-float';                         // all single floats
    }
    for (let p = 0; p < nPoints; p++) {
      let o;
      if (scheme === 'cplx-double') {
        o = p * nVars * 16;
        for (let v = 0; v < nVars; v++) {
          const re = dv.getFloat64(o + v * 16, true);
          const im = dv.getFloat64(o + v * 16 + 8, true);
          data[v][p] = (v === 0) ? re : Math.hypot(re, im);   // x is freq (real); others = magnitude
        }
      } else if (scheme === 'lt-real') {
        o = p * (8 + (nVars - 1) * 4);
        data[0][p] = dv.getFloat64(o, true);
        for (let v = 1; v < nVars; v++) data[v][p] = dv.getFloat32(o + 8 + (v - 1) * 4, true);
      } else if (scheme === 'real-float') {
        o = p * nVars * 4;
        for (let v = 0; v < nVars; v++) data[v][p] = dv.getFloat32(o + v * 4, true);
      } else {
        o = p * nVars * 8;
        for (let v = 0; v < nVars; v++) data[v][p] = dv.getFloat64(o + v * 8, true);
      }
    }
  } else {
    // ASCII "Values:" block - points as "<idx>\t<v0>" then nVars-1 indented
    // "<vN>" lines (complex values written as "re,im").
    const body = text.slice(dataCharStart);
    const toks = body.split('\n');
    let li = 0, p = 0;
    const readNum = (s) => {
      s = s.trim();
      if (!s) return NaN;
      if (complex) { const c = s.split(','); return Math.hypot(parseFloat(c[0]), parseFloat(c[1] || '0')); }
      return parseFloat(s);
    };
    while (p < nPoints && li < toks.length) {
      let line = toks[li++].trim();
      if (!line) continue;
      // First line of a point: "<index> <value>".
      const sp = line.split(/[ \t]+/);
      data[0][p] = complex ? readNum(sp.slice(1).join(' ')) : parseFloat(sp[1]);
      for (let v = 1; v < nVars; v++) {
        while (li < toks.length && !toks[li].trim()) li++;
        data[v][p] = readNum(toks[li++] || '');
      }
      p++;
    }
  }

  return { meta, vars, nVars, nPoints, complex, data, x: data[0] };
}

// ---------------------------------------------------------------------------
// Interactive multi-trace waveform plot (canvas).
// ---------------------------------------------------------------------------
const TRACE_COLORS = ['#d12f2f', '#1f6fd1', '#1f9f4f', '#c46a00', '#8a3fd1',
  '#0c9aa6', '#c4337f', '#5a7a1f', '#3f5fd1', '#a8551f'];

function buildPlot(parsed) {
  const { vars, nPoints, x } = parsed;
  const xType = (vars[0] && vars[0].type) || 'time';
  const xUnit = unitFor(xType);
  // Traces = every variable except the sweep axis (var 0).
  const traces = vars.slice(1).map((v, i) => ({
    name: v.name, type: v.type, unit: unitFor(v.type) || 'V',
    color: TRACE_COLORS[i % TRACE_COLORS.length], data: parsed.data[i + 1],
    on: v.type === 'voltage' || (v.type !== 'current' && i < 4),   // default: voltages (or first few)
  }));
  if (!traces.some((t) => t.on)) traces.forEach((t, i) => { t.on = i < 4; });

  const wrap = el('div', { class: 'anr-spice' });

  // Legend chips - click to toggle a trace.
  const legend = el('div', { class: 'anr-spice-legend' });
  const canvas = el('canvas', { class: 'anr-spice-canvas' });
  const readout = el('div', { class: 'anr-spice-readout', hidden: '' });
  const track = el('div', { class: 'anr-spice-track' }, [canvas, readout]);

  traces.forEach((t) => {
    const chip = el('button', {
      type: 'button',
      class: 'anr-spice-chip' + (t.on ? '' : ' is-off'),
      style: '--tc:' + t.color,
    }, [el('span', { class: 'anr-spice-swatch' }), document.createTextNode(t.name)]);
    chip.addEventListener('click', () => { t.on = !t.on; chip.classList.toggle('is-off', !t.on); draw(); });
    legend.appendChild(chip);
    t.chip = chip;
  });

  wrap.appendChild(legend);
  wrap.appendChild(track);
  wrap.appendChild(el('p', { class: 'anr-hint' },
    'X axis: ' + (xType || 'sweep') + (xUnit ? ' (' + xUnit + ')' : '') + '. Click a name to show/hide a trace; hover the plot to read off values.'));

  const PAD = { l: 64, r: 14, t: 12, b: 28 };
  let W = 0, H = 0, dpr = 1;
  let plot = null;   // { x0,x1,y0,y1, vis }

  function visibleRange() {
    const vis = traces.filter((t) => t.on);
    let y0 = Infinity, y1 = -Infinity;
    for (const t of vis) for (let i = 0; i < nPoints; i++) {
      const y = t.data[i];
      if (!isFinite(y)) continue;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!isFinite(y0)) { y0 = -1; y1 = 1; }
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
    return { vis, x0: x[0], x1: x[nPoints - 1], y0, y1 };
  }

  function draw() {
    const cssW = track.clientWidth || 700;
    const cssH = 300;
    dpr = window.devicePixelRatio || 1;
    W = cssW; H = cssH;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    plot = visibleRange();
    const { vis, x0, x1, y0, y1 } = plot;
    const px = (xv) => PAD.l + (x1 === x0 ? 0 : (xv - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    const py = (yv) => PAD.t + (1 - (yv - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);

    // Grid + axis ticks.
    ctx.strokeStyle = 'rgba(40,55,85,0.16)';
    ctx.fillStyle = 'rgba(40,55,85,0.85)';
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    const yTicks = niceTicks(y0, y1, 5);
    ctx.textAlign = 'right';
    for (const yv of yTicks) {
      const Y = py(yv);
      ctx.beginPath(); ctx.moveTo(PAD.l, Y); ctx.lineTo(W - PAD.r, Y); ctx.stroke();
      ctx.fillText(fmtSI(yv, ''), PAD.l - 6, Y);
    }
    const xTicks = niceTicks(x0, x1, 6);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const xv of xTicks) {
      const X = px(xv);
      ctx.beginPath(); ctx.moveTo(X, PAD.t); ctx.lineTo(X, H - PAD.b); ctx.stroke();
      ctx.fillText(fmtSI(xv, ''), X, H - PAD.b + 5);
    }
    ctx.strokeStyle = 'rgba(40,55,85,0.4)';
    ctx.strokeRect(PAD.l, PAD.t, W - PAD.l - PAD.r, H - PAD.t - PAD.b);

    // Traces - min/max envelope decimation per pixel column.
    const cols = Math.max(1, Math.round(W - PAD.l - PAD.r));
    for (const t of vis) {
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let started = false;
      for (let c = 0; c < cols; c++) {
        const i0 = Math.floor(c / cols * nPoints);
        const i1 = Math.max(i0 + 1, Math.floor((c + 1) / cols * nPoints));
        let mn = Infinity, mx = -Infinity;
        for (let i = i0; i < i1 && i < nPoints; i++) {
          const y = t.data[i];
          if (!isFinite(y)) continue;
          if (y < mn) mn = y; if (y > mx) mx = y;
        }
        if (mn === Infinity) continue;
        const X = PAD.l + c;
        if (!started) { ctx.moveTo(X, py(mx)); started = true; }
        ctx.lineTo(X, py(mx));
        if (mn !== mx) ctx.lineTo(X, py(mn));
      }
      ctx.stroke();
    }
  }

  // Hover readout.
  const guide = el('div', { class: 'anr-spice-guide', hidden: '' });
  track.appendChild(guide);
  function onMove(e) {
    if (!plot) return;
    const r = track.getBoundingClientRect();
    const mx = e.clientX - r.left;
    if (mx < PAD.l || mx > W - PAD.r) { hideHover(); return; }
    const frac = (mx - PAD.l) / (W - PAD.l - PAD.r);
    const i = Math.max(0, Math.min(nPoints - 1, Math.round(frac * (nPoints - 1))));
    const xv = x[i];
    const X = PAD.l + (plot.x1 === plot.x0 ? 0 : (xv - plot.x0) / (plot.x1 - plot.x0)) * (W - PAD.l - PAD.r);
    guide.hidden = false; guide.style.left = X + 'px';
    readout.hidden = false;
    readout.innerHTML = '';
    readout.appendChild(el('div', { class: 'anr-spice-ro-x' }, fmtSI(xv, xUnit)));
    for (const t of plot.vis) {
      readout.appendChild(el('div', { class: 'anr-spice-ro-row' }, [
        el('span', { class: 'anr-spice-swatch', style: '--tc:' + t.color }),
        el('span', { class: 'anr-spice-ro-name' }, t.name),
        el('span', { class: 'anr-spice-ro-val' }, fmtSI(t.data[i], t.unit)),
      ]));
    }
    // Keep the readout box from overflowing the right edge.
    readout.style.left = (mx > W * 0.6 ? mx - readout.offsetWidth - 12 : mx + 12) + 'px';
  }
  function hideHover() { guide.hidden = true; readout.hidden = true; }
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerleave', hideHover);

  // Initial + responsive draw.
  requestAnimationFrame(draw);
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => draw()); ro.observe(track); }

  return wrap;
}

// "Nice" axis ticks (1/2/5 x 10^n) across [lo, hi].
function niceTicks(lo, hi, target) {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(v);
  return out;
}

// ---------------------------------------------------------------------------
export async function renderSpiceRaw(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let parsed = null;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    parsed = parseRaw(buf);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not parse this SPICE .raw file: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';
  const m = parsed.meta;
  const isOp = parsed.nPoints <= 1 || /operating point/i.test(m.plotname);
  const tool = /ltspice/i.test(m.command) ? 'LTspice'
    : /ngspice/i.test(m.command) || /ngspice/i.test(m.title) ? 'ngspice' : 'SPICE';

  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('SPICE simulation (.raw)',
    'A SPICE waveform dump - the raw output of a circuit simulation (KiCad / ngspice or LTspice). '
    + 'Analyser decodes the header and sample data and ' + (isOp ? 'tabulates the operating point.' : 'plots the traces on an interactive timeline.'));
  card.appendChild(h); card.appendChild(help);

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', 'SPICE raw waveform (.raw)'));
  tbl.appendChild(row('Simulator', tool));
  if (m.plotname) tbl.appendChild(rowHelp('Analysis', m.plotname, 'The SPICE analysis that produced this data (transient, AC, DC sweep, operating point, …).'));
  if (m.title) tbl.appendChild(row('Title', m.title));
  if (m.date) tbl.appendChild(row('Date', m.date));
  if (m.flags) tbl.appendChild(rowHelp('Flags', m.flags, '"real" for time/DC data, "complex" for AC (each value is a real+imaginary pair).'));
  tbl.appendChild(rowHelp('Variables', String(parsed.nVars), 'Signals recorded - node voltages, branch currents and the sweep axis.'));
  tbl.appendChild(row('Data points', parsed.nPoints.toLocaleString()));
  if (!isOp && parsed.x && parsed.x.length > 1) {
    const xt = parsed.vars[0] && parsed.vars[0].type;
    const span = parsed.x[parsed.x.length - 1] - parsed.x[0];
    tbl.appendChild(row(xt === 'frequency' ? 'Frequency range' : xt === 'time' ? 'Duration' : 'Sweep span',
      fmtSI(parsed.x[0], unitFor(xt)) + ' → ' + fmtSI(parsed.x[parsed.x.length - 1], unitFor(xt))
      + (xt === 'time' ? '  (' + fmtSI(span, 's') + ')' : '')));
  }
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  if (isOp) {
    // Operating point - one value per variable, tabulated.
    const opCard = el('div', { class: 'anr-card' });
    opCard.appendChild(el('h3', {}, 'Operating point'));
    const t = el('table', { class: 'anr-readout anr-spice-op' });
    t.appendChild(el('tr', {}, [el('th', {}, 'Node / branch'), el('th', {}, 'Type'), el('th', {}, 'Value')]));
    parsed.vars.forEach((v, i) => {
      t.appendChild(el('tr', {}, [
        el('td', {}, v.name),
        el('td', { class: 'anr-hint' }, v.type || '-'),
        el('td', {}, fmtSI(parsed.data[i][0], unitFor(v.type))),
      ]));
    });
    opCard.appendChild(t);
    resultsEl.appendChild(opCard);
  } else {
    const plotCard = el('div', { class: 'anr-card' });
    plotCard.appendChild(el('h3', {}, 'Waveforms'));
    plotCard.appendChild(buildPlot(parsed));
    resultsEl.appendChild(plotCard);
  }

  resultsEl.appendChild(integrityCard(file));
}
