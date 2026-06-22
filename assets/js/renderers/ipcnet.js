/* Analyser - IPC-D-356(A) netlist viewer (.ipc)
   ---------------------------------------------------------------------------
   A .ipc file is the bare-board fabrication / electrical-test netlist a PCB tool
   (KiCad, Altium, …) exports for the fab house. It is a fixed-column text format:
   "P" parameter lines (units, job), then one feature record per test point -
   record code, the net it belongs to, the component reference + pin, the feature
   geometry (drilled pad, SMD pad or via) and its X/Y location.

   We parse the records, summarise the board (nets, parts, pad/via mix), rebuild
   the net -> pin connectivity, and draw a fabrication map of every test point
   coloured by net. */

import { el, row, rowHelp, h3help, fmtBytes, integrityCard, errorCard } from '../core/util.js';

// IPC customary units are 0.0001 inch (0.1 mil). 1 unit = 0.00254 mm.
const U_TO_MM = 0.00254;
const U_TO_IN = 0.0001;

function parseIpc(text) {
  const lines = text.split(/\r?\n/);
  const params = {};
  const recs = [];
  let metric = false;

  for (const raw of lines) {
    if (!raw) continue;
    const line = raw.replace(/\s+$/, '');
    const c = line[0];
    if (c === 'C') continue;                       // comment
    if (c === 'P') {                               // parameter
      const m = /^P\s+(\S+)\s*(.*)$/.exec(line);
      if (m) {
        params[m[1].toUpperCase()] = m[2].trim();
        if (/UNITS/i.test(m[1]) && /\bM/i.test(m[2])) metric = true;
      }
      continue;
    }
    if (c === '9') continue;                        // 999 = end of file
    if (c !== '3') continue;                         // only 3xx feature records

    const code = line.slice(0, 3);
    const net = line.slice(3, 17).trim();
    const refRaw = line.slice(20, 26).trim();
    // Pin number: the "-N" token right after the ref-des field.
    const pinM = /-\s*(\w+)/.exec(line.slice(17, 32));
    const pin = pinM ? pinM[1] : '';
    const loc = /X([+-]\d+)Y([+-]\d+)/.exec(line);
    const x = loc ? parseInt(loc[1], 10) : null;
    const y = loc ? parseInt(loc[2], 10) : null;
    // Feature descriptor sits just before the X coordinate: "D0394PA00" (drilled),
    // "A01" (SMD access), "MD0157PA00" (mid/buried via drill).
    const desc = loc ? line.slice(17, loc.index) : line.slice(17);
    const drillM = /D(\d{3,5})/.exec(desc);
    let kind;
    if (refRaw === 'VIA' || /^M/.test(desc.trim())) kind = 'via';
    else if (drillM) kind = 'tht';
    else if (/A\d{2}/.test(desc)) kind = 'smd';
    else kind = 'other';
    const sideM = /S(\d)\s*$/.exec(line);
    recs.push({
      code, net, ref: refRaw, pin, x, y, kind,
      drill: drillM ? parseInt(drillM[1], 10) : null,
      side: sideM ? +sideM[1] : null,
      cont: code === '327' || code === '317' ? false : true,   // 367/377 = continuation/adjacency
    });
  }
  return { params, recs, metric };
}

// Stable per-net colour (hashed hue), with ground / no-connect pinned to neutrals.
function netColor(name) {
  const n = name.toUpperCase();
  if (n === '0' || n === 'GND' || n === 'GNDA' || /GROUND/.test(n)) return '#566';
  if (n === 'N/C' || n === 'NC' || n === '') return '#aab';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 42%)`;
}

function fabMap(recs) {
  const pts = recs.filter((r) => r.x != null && r.y != null);
  if (!pts.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const pad = Math.max(w, h) * 0.04;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'anr-ipc-svg');
  svg.setAttribute('viewBox', `${minX - pad} ${-(maxY + pad)} ${w + pad * 2} ${h + pad * 2}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const r = Math.max(w, h) / 220;
  for (const p of pts) {
    const col = netColor(p.net);
    let node;
    if (p.kind === 'via') {
      node = document.createElementNS(NS, 'circle');
      node.setAttribute('cx', p.x); node.setAttribute('cy', -p.y); node.setAttribute('r', r * 0.8);
      node.setAttribute('fill', 'none'); node.setAttribute('stroke', col); node.setAttribute('stroke-width', r * 0.5);
    } else {
      node = document.createElementNS(NS, 'rect');
      const s = r * 1.6;
      node.setAttribute('x', p.x - s / 2); node.setAttribute('y', -p.y - s / 2);
      node.setAttribute('width', s); node.setAttribute('height', s);
      node.setAttribute('fill', col); node.setAttribute('rx', s * 0.18);
    }
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${p.net || '(no net)'}  ${p.ref}${p.pin ? '-' + p.pin : ''}`;
    node.appendChild(title);
    svg.appendChild(node);
  }
  return svg;
}

export async function renderIpcNetlist(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let parsed = null;
  try {
    const text = await file.text();
    parsed = parseIpc(text);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    return;
  }
  if (!parsed.recs.length) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('This does not look like an IPC-D-356 netlist (no 3xx feature records found).'));
    return;
  }

  resultsEl.innerHTML = '';
  const { recs, params } = parsed;

  // --- aggregate ---
  const netMap = new Map();      // net -> [{ref,pin,kind}]
  const compMap = new Map();     // ref -> Set(pin)
  let vias = 0, tht = 0, smd = 0;
  for (const r of recs) {
    if (r.kind === 'via') vias++;
    else if (r.kind === 'tht') tht++;
    else if (r.kind === 'smd') smd++;
    if (r.ref && r.ref !== 'VIA') {
      if (!compMap.has(r.ref)) compMap.set(r.ref, new Set());
      if (r.pin) compMap.get(r.ref).add(r.pin);
    }
    const key = r.net || '(no net)';
    if (!netMap.has(key)) netMap.set(key, []);
    if (r.ref && r.ref !== 'VIA') netMap.get(key).push({ ref: r.ref, pin: r.pin });
  }
  const realNets = [...netMap.keys()].filter((n) => n !== '0' && n.toUpperCase() !== 'N/C' && n !== '(no net)');

  // extents
  const xs = recs.filter((r) => r.x != null);
  let extent = '';
  if (xs.length) {
    const minX = Math.min(...xs.map((r) => r.x)), maxX = Math.max(...xs.map((r) => r.x));
    const minY = Math.min(...xs.map((r) => r.y)), maxY = Math.max(...xs.map((r) => r.y));
    const wU = maxX - minX, hU = maxY - minY;
    extent = parsed.metric
      ? `${(wU / 1000).toFixed(1)} x ${(hU / 1000).toFixed(1)} mm`
      : `${(wU * U_TO_MM).toFixed(1)} x ${(hU * U_TO_MM).toFixed(1)} mm  (${(wU * U_TO_IN).toFixed(2)} x ${(hU * U_TO_IN).toFixed(2)} in)`;
  }

  // --- summary card ---
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('IPC-D-356A netlist (.ipc)',
    'A PCB fabrication / bare-board test netlist. Each record is a test point - the net it belongs to, the component pin or via, its pad geometry and X/Y position. '
    + 'Analyser rebuilds the net connectivity and maps every test point.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Format', 'IPC-D-356A netlist'));
  if (params.JOB) tbl.appendChild(row('Job', params.JOB));
  tbl.appendChild(rowHelp('Units', parsed.metric ? 'Metric (0.001 mm)' : 'Imperial (0.0001 in / 0.1 mil)', 'The coordinate units declared by the file\'s "P UNITS" record.'));
  tbl.appendChild(rowHelp('Nets', String(realNets.length), 'Distinct signal nets (excluding ground and no-connect).'));
  tbl.appendChild(row('Components', String(compMap.size)));
  tbl.appendChild(rowHelp('Test points', String(recs.length), 'Total feature records - every pad, pin and via the fab will probe.'));
  tbl.appendChild(row('Through-hole pads', String(tht)));
  tbl.appendChild(row('SMD pads', String(smd)));
  tbl.appendChild(row('Vias', String(vias)));
  if (extent) tbl.appendChild(rowHelp('Board extent', extent, 'Bounding box of all test points.'));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // --- fabrication map ---
  const map = fabMap(recs);
  if (map) {
    const mapCard = el('div', { class: 'anr-card' });
    mapCard.appendChild(el('h3', {}, 'Fabrication map'));
    mapCard.appendChild(el('p', { class: 'anr-hint' }, 'Every test point, coloured by net. Squares are pads, rings are vias. Hover a point for its net and reference.'));
    const host = el('div', { class: 'anr-ipc-maphost' }, [map]);
    mapCard.appendChild(host);
    resultsEl.appendChild(mapCard);
  }

  // --- nets table (signal nets, by pin count) ---
  const netCard = el('div', { class: 'anr-card' });
  netCard.appendChild(el('h3', {}, 'Nets'));
  const nt = el('table', { class: 'anr-readout anr-ipc-nets' });
  nt.appendChild(el('tr', {}, [el('th', {}, 'Net'), el('th', {}, 'Pins'), el('th', {}, 'Connections')]));
  const sortedNets = realNets
    .map((n) => ({ n, pins: netMap.get(n) }))
    .sort((a, b) => b.pins.length - a.pins.length || a.n.localeCompare(b.n));
  for (const { n, pins } of sortedNets) {
    const conns = pins.map((p) => p.ref + (p.pin ? '.' + p.pin : '')).join(', ');
    const sw = el('span', { class: 'anr-ipc-swatch', style: 'background:' + netColor(n) });
    nt.appendChild(el('tr', {}, [
      el('td', {}, [sw, document.createTextNode(' ' + n)]),
      el('td', {}, String(pins.length)),
      el('td', { class: 'anr-ipc-conns' }, conns),
    ]));
  }
  // Ground + no-connect summarised at the foot.
  const gnd = netMap.get('0'); const nc = netMap.get('N/C') || netMap.get('NC');
  if (gnd) nt.appendChild(el('tr', { class: 'anr-ipc-special' }, [el('td', {}, [el('span', { class: 'anr-ipc-swatch', style: 'background:' + netColor('0') }), document.createTextNode(' 0 / GND')]), el('td', {}, String(gnd.length)), el('td', { class: 'anr-hint' }, 'ground')]));
  if (nc) nt.appendChild(el('tr', { class: 'anr-ipc-special' }, [el('td', {}, 'N/C'), el('td', {}, String(nc.length)), el('td', { class: 'anr-hint' }, 'no-connect')]));
  netCard.appendChild(nt);
  resultsEl.appendChild(netCard);

  // --- components table ---
  const compCard = el('div', { class: 'anr-card' });
  compCard.appendChild(el('h3', {}, 'Components'));
  const ct = el('table', { class: 'anr-readout anr-ipc-comps' });
  ct.appendChild(el('tr', {}, [el('th', {}, 'Reference'), el('th', {}, 'Pins')]));
  const comps = [...compMap.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  for (const [ref, pinSet] of comps) ct.appendChild(el('tr', {}, [el('td', {}, ref), el('td', {}, String(pinSet.size))]));
  compCard.appendChild(ct);
  resultsEl.appendChild(compCard);

  resultsEl.appendChild(integrityCard(file));
}
