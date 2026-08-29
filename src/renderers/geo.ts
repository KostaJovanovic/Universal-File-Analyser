/* Analyser - geospatial files (GPX / KML / GeoJSON)
   Parses tracks / placemarks / features, computes counts, distance, bounds and
   time span, and plots the geometry on a Leaflet/OpenStreetMap map (lazy-loaded,
   same as the photo GPS map). */

import { el, row, rowHelp, h3help, errorCard, fmtBytes, loadCss, loadScript } from '../core/util.js';
import { GEO_HEAT_POINTS, GEO_PACE_RUNS } from '../core/limits.js';

const LEAFLET_CSS = 'assets/vendor/leaflet/leaflet.css';
const LEAFLET_JS  = 'assets/vendor/leaflet/leaflet.js';

function haversine(a: any[], b: any[]) {                 // a,b = [lat, lon]
  const R = 6371000, toRad = (x: number) => x * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(m: number) {
  if (!m) return '-';
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}
function fmtDuration(sec: number) {
  if (!isFinite(sec) || sec <= 0) return '-';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h > 0 ? h + 'h ' + m + 'm' : (m > 0 ? m + 'm ' + s + 's' : s + 's');
}

// Walk all per-point track detail and derive distance-along, elevation profile
// samples, ascent/descent (noise-thresholded), moving time and sensor stats.
function trackStats(tracks: any[]) {
  const ELE_THRESHOLD = 2;   // metres: ignore ele deltas below this (GPS noise)
  const PAUSE_GAP = 60;      // seconds: gaps longer than this are "stopped" time
  let ascent = 0, descent = 0, refEle = null;
  let totalDist = 0, movingTime = 0, movingDist = 0, hasTime = false;
  const profile = [];        // { dist (m), ele }
  const hr = [], cad = [], temp = [];
  for (const pts of tracks) {
    let prev = null;
    for (const p of pts) {
      if (prev) {
        const d = haversine([prev.lat, prev.lon], [p.lat, p.lon]);
        totalDist += d;
        if (isFinite(prev.time) && isFinite(p.time)) {
          hasTime = true;
          const dt = (p.time - prev.time) / 1000;
          if (dt > 0 && dt <= PAUSE_GAP) { movingTime += dt; movingDist += d; }
        }
      }
      if (isFinite(p.ele)) {
        if (refEle == null) refEle = p.ele;
        const delta = p.ele - refEle;
        if (delta >= ELE_THRESHOLD) { ascent += delta; refEle = p.ele; }
        else if (delta <= -ELE_THRESHOLD) { descent += -delta; refEle = p.ele; }
        profile.push({ dist: totalDist, ele: p.ele });
      }
      if (isFinite(p.hr)) hr.push(p.hr);
      if (isFinite(p.cad)) cad.push(p.cad);
      if (isFinite(p.temp)) temp.push(p.temp);
      prev = p;
    }
  }
  // reduce, not Math.max(...spread): a long track has too many points to spread as args.
  const agg = (arr: any[]) => arr.length ? { avg: arr.reduce((a, b) => a + b, 0) / arr.length, max: arr.reduce((m: number, v: number) => (v > m ? v : m), -Infinity) } : null;
  return { ascent, descent, profile, hasTime, movingTime, movingDist, totalDist,
           hr: agg(hr), cad: agg(cad), temp: agg(temp) };
}

// Plain 2D-canvas line chart of elevation vs distance. No library.
function elevationProfileCanvas(profile: any[]) {
  const W = 640, H = 180, padL = 44, padR = 12, padT = 12, padB = 24;
  const cv = el('canvas', { class: 'anr-geo-elev', width: String(W), height: String(H) });
  cv.style.width = '100%'; cv.style.height = 'auto'; cv.style.maxWidth = W + 'px';
  const ctx = cv.getContext('2d')!;
  const eles = profile.map((p) => p.ele);
  let minE = eles.reduce((m: number, v: number) => (v < m ? v : m), Infinity), maxE = eles.reduce((m: number, v: number) => (v > m ? v : m), -Infinity);
  if (minE === maxE) { minE -= 1; maxE += 1; }
  const maxD = profile[profile.length - 1].dist || 1;
  const x = (d: number) => padL + (d / maxD) * (W - padL - padR);
  const y = (e: number) => padT + (1 - (e - minE) / (maxE - minE)) * (H - padT - padB);
  // axes
  ctx.strokeStyle = '#c9d2da'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
  // filled area under the line
  ctx.beginPath(); ctx.moveTo(x(profile[0].dist), y(profile[0].ele));
  for (const p of profile) ctx.lineTo(x(p.dist), y(p.ele));
  ctx.lineTo(x(profile[profile.length - 1].dist), H - padB); ctx.lineTo(x(profile[0].dist), H - padB);
  ctx.closePath(); ctx.fillStyle = 'rgba(68,95,116,0.15)'; ctx.fill();
  // line
  ctx.beginPath(); ctx.moveTo(x(profile[0].dist), y(profile[0].ele));
  for (const p of profile) ctx.lineTo(x(p.dist), y(p.ele));
  ctx.strokeStyle = '#445f74'; ctx.lineWidth = 1.5; ctx.stroke();
  // labels
  ctx.fillStyle = '#6b7682'; ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(maxE) + ' m', padL - 4, y(maxE));
  ctx.fillText(Math.round(minE) + ' m', padL - 4, y(minE));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('0', x(0), H - padB + 4);
  ctx.fillText(fmtDist(maxD), x(maxD), H - padB + 4);
  return cv;
}

/* ---- Map overlays: pace shading and revisit density ----

   Two extra ways to read the same track. Pace colours the line by how fast you
   were moving and pins the places you stopped; density answers "how often does
   this track come back to the same spot", which is what turns a year of commutes
   into a picture of where you actually go. Both are drawn from the points
   already parsed - nothing extra is read, and nothing leaves the device. */

const PACE_RAMP = [
  [ 58, 100, 168],   // slowest band
  [ 46, 156, 176],
  [ 78, 172, 104],
  [216, 162,  56],
  [198,  70,  56],   // fastest band
];
const STOP_SPEED = 1.2;    // km/h under which a point counts as stationary
const STOP_MIN   = 45;     // seconds a stationary run must last to be marked
const PACE_SMOOTH = 5;     // segments in the speed-smoothing window

interface PaceRun { pts: number[][]; band: number; }
interface PaceStop { lat: number; lon: number; sec: number; }
interface PaceData { runs: PaceRun[]; stops: PaceStop[]; bands: number[]; }

function rgba(c: number[], a: number) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
function rgb(c: number[]) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
function fmtSpeed(kmh: number) { return kmh >= 10 ? Math.round(kmh) + ' km/h' : kmh.toFixed(1) + ' km/h'; }

// Segment speeds -> five colour bands, with consecutive same-band segments merged
// into one polyline. The band edges are QUANTILES of this track's own speeds
// rather than fixed km/h thresholds, so the same five colours read correctly for
// a walk, a bike ride and a flight - any fixed scale collapses two of the three
// into one colour. Speeds are smoothed over a short window first: raw GPS speed
// is jittery enough that unsmoothed bands would change every few points and put
// thousands of separate paths on the map.
function paceData(tracks: any[][]): PaceData | null {
  const segs: { a: number[]; b: number[]; kmh: number }[] = [];
  const stops: PaceStop[] = [];
  for (const pts of tracks) {
    let stallSec = 0, stallAt: any = null;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (!isFinite(p.time) || !isFinite(q.time)) continue;
      const dt = (q.time - p.time) / 1000;
      if (dt <= 0) continue;
      const d = haversine([p.lat, p.lon], [q.lat, q.lon]);
      const kmh = (d / 1000) / (dt / 3600);
      segs.push({ a: [p.lat, p.lon], b: [q.lat, q.lon], kmh });
      // A stop is either standing still or a gap in the recording - both mean
      // "nothing happened here for a while", which is what you want pinned.
      if (kmh < STOP_SPEED || dt > 60) { stallSec += dt; if (!stallAt) stallAt = p; }
      else {
        if (stallSec >= STOP_MIN && stallAt) stops.push({ lat: stallAt.lat, lon: stallAt.lon, sec: stallSec });
        stallSec = 0; stallAt = null;
      }
    }
    if (stallSec >= STOP_MIN && stallAt) stops.push({ lat: stallAt.lat, lon: stallAt.lon, sec: stallSec });
  }
  if (segs.length < 4) return null;

  const smooth: number[] = [];
  const half = PACE_SMOOTH >> 1;
  for (let i = 0; i < segs.length; i++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(segs.length - 1, i + half); j++) { sum += segs[j].kmh; n++; }
    smooth.push(sum / n);
  }

  const sorted = smooth.slice().sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  const bands = [q(0.2), q(0.4), q(0.6), q(0.8)];

  const runs: PaceRun[] = [];
  let cur: PaceRun | null = null;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    let band = 0;
    for (const t of bands) if (smooth[i] > t) band++;
    const tail = cur ? cur.pts[cur.pts.length - 1] : null;
    if (cur && cur.band === band && tail![0] === s.a[0] && tail![1] === s.a[1]) cur.pts.push(s.b);
    else { cur = { pts: [s.a, s.b], band }; runs.push(cur); }
  }
  if (runs.length > GEO_PACE_RUNS) return null;
  return { runs, stops, bands };
}

// Every point the file holds, thinned to a fixed budget for the density grid.
function heatPoints(g: Geo) {
  const all: number[][] = [];
  for (const line of g.lines) for (const p of line) all.push(p);
  for (const m of g.markers) all.push([m.lat, m.lon]);
  if (all.length <= GEO_HEAT_POINTS) return all;
  const stride = Math.ceil(all.length / GEO_HEAT_POINTS);
  const out: number[][] = [];
  for (let i = 0; i < all.length; i += stride) out.push(all[i]);
  return out;
}

// Colour ramp for the density grid: cool and nearly transparent where the track
// passes once, warm and solid where it passes again and again.
function heatColour(t: number) {
  const seg = Math.min(PACE_RAMP.length - 2, Math.floor(t * (PACE_RAMP.length - 1)));
  const f = t * (PACE_RAMP.length - 1) - seg;
  const a = PACE_RAMP[seg], b = PACE_RAMP[seg + 1];
  const mix = [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * f));
  return rgba(mix, 0.22 + 0.62 * t);
}

// A revisit-density overlay on a plain canvas in the map's overlay pane.
// Leaflet.heat is not vendored and a blurred kernel would be the wrong answer
// anyway: the question here is "how many times", so points are binned into fixed
// screen-space cells and the count drives the colour. Binning is what keeps the
// cost tied to the canvas rather than to the length of the track.
function densityOverlay(map: any, pts: number[][]) {
  const CELL = 6;                          // screen pixels per density cell
  const canvas = el('canvas') as HTMLCanvasElement;
  canvas.className = 'anr-geo-heat';
  const ctx = canvas.getContext('2d')!;
  let on = false;

  const draw = () => {
    const size = map.getSize();
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.width = size.x; canvas.height = size.y;
    canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
    const cols = Math.ceil(size.x / CELL) + 1, rows = Math.ceil(size.y / CELL) + 1;
    const bins = new Uint32Array(cols * rows);
    let peak = 0;
    for (const p of pts) {
      const q = map.latLngToContainerPoint([p[0], p[1]]);
      if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
      const v = ++bins[((q.y / CELL) | 0) * cols + ((q.x / CELL) | 0)];
      if (v > peak) peak = v;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!peak) return;
    // Square root, not linear: one long rest stop can hold hundreds of points in
    // a single cell, and on a linear scale that flattens the whole rest of the
    // track to the bottom of the ramp.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = bins[r * cols + c];
        if (!v) continue;
        ctx.fillStyle = heatColour(Math.sqrt(v / peak));
        ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }
  };
  // Panning fires `move` continuously. Re-binding the canvas position each time
  // is cheap and keeps what is already drawn glued to the ground; the re-bin that
  // fills in the newly revealed edge waits for the gesture to end. A zoom rescales
  // the whole raster, so there the canvas hides until the new level settles.
  const reposition = () => L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
  const hide = () => { canvas.style.visibility = 'hidden'; };
  const settle = () => { canvas.style.visibility = ''; draw(); };

  return {
    add() {
      if (on) return;
      on = true;
      map.getPanes().overlayPane.appendChild(canvas);
      map.on('move', reposition);
      map.on('zoomstart', hide);
      map.on('moveend zoomend resize', settle);
      draw();
    },
    remove() {
      if (!on) return;
      on = false;
      map.off('move', reposition);
      map.off('zoomstart', hide);
      map.off('moveend zoomend resize', settle);
      canvas.remove();
    },
  };
}

interface Geo {
  lines: number[][][];
  markers: { lat: number; lon: number; name: string }[];
  pointCount: number;
  eleMin: number;
  eleMax: number;
  timeStart: number|null;
  timeEnd: number|null;
  counts: Record<string, number>;
  tracks: any[][];
  features: { name: string; props: any }[];
}

// Accumulates geometry into a common shape used for stats + the map.
// `tracks` keeps per-point detail (lat/lon/ele/time/hr/cad/temp) for the lines
// that carry it (GPX track segments / routes), used for the elevation profile,
// ascent/descent and moving-time stats. `features` holds GeoJSON properties.
function makeGeo(): Geo {
  return { lines: [], markers: [], pointCount: 0, eleMin: Infinity, eleMax: -Infinity,
           timeStart: null, timeEnd: null, counts: {}, tracks: [], features: [] };
}
function bump(g: Geo, type: string) { g.counts[type] = (g.counts[type] || 0) + 1; }
function ele(g: Geo, v: number) { if (isFinite(v)) { g.eleMin = Math.min(g.eleMin, v); g.eleMax = Math.max(g.eleMax, v); } }
function tstamp(g: Geo, t: string) { const ms = Date.parse(t); if (!isNaN(ms)) { g.timeStart = g.timeStart == null ? ms : Math.min(g.timeStart, ms); g.timeEnd = g.timeEnd == null ? ms : Math.max(g.timeEnd, ms); } }

function parseGpx(xml: Document) {
  const g = makeGeo();
  const num = (n: Element, a: string) => parseFloat(n.getAttribute(a)!);
  // Garmin TrackPointExtension fields live under <extensions> with namespaced
  // tags like <gpxtpx:hr>; match by local name so we don't depend on the prefix.
  const extVal = (pt: Element, local: string) => {
    const ext = pt.querySelector('extensions'); if (!ext) return NaN;
    for (const n of ext.querySelectorAll('*')) {
      const ln = (n.localName || n.tagName || '').toLowerCase();
      if (ln === local) { const v = parseFloat(n.textContent!); if (isFinite(v)) return v; }
    }
    return NaN;
  };
  const segPts = (nodes: NodeListOf<Element>) => {
    const line: number[][] = [];                 // [[lat,lon],...] for the map
    const detail: any[] = [];               // {lat,lon,ele,time,hr,cad,temp} for stats
    for (const pt of nodes) {
      const lat = num(pt, 'lat'), lon = num(pt, 'lon');
      if (!isFinite(lat) || !isFinite(lon)) continue;
      line.push([lat, lon]); g.pointCount++;
      const eNode = pt.querySelector('ele'); const eVal = eNode ? parseFloat(eNode.textContent!) : NaN;
      if (eNode) ele(g, eVal);
      const tNode = pt.querySelector('time'); const tMs = tNode ? Date.parse(tNode.textContent!) : NaN;
      if (tNode) tstamp(g, tNode.textContent!);
      detail.push({ lat, lon, ele: eVal, time: isNaN(tMs) ? NaN : tMs,
        hr: extVal(pt, 'hr'), cad: extVal(pt, 'cad'), temp: extVal(pt, 'atemp') });
    }
    if (detail.length) g.tracks.push(detail);
    return line;
  };
  xml.querySelectorAll('trkseg').forEach((seg) => { const l = segPts(seg.querySelectorAll('trkpt')); if (l.length) { g.lines.push(l); bump(g, 'track segments'); } });
  xml.querySelectorAll('rte').forEach((r) => { const l = segPts(r.querySelectorAll('rtept')); if (l.length) { g.lines.push(l); bump(g, 'routes'); } });
  xml.querySelectorAll('wpt').forEach((w) => {
    const lat = num(w, 'lat'), lon = num(w, 'lon');
    if (!isFinite(lat) || !isFinite(lon)) return;
    const nm = w.querySelector('name'); g.markers.push({ lat, lon, name: nm ? nm.textContent!.trim() : '' });
    g.pointCount++; bump(g, 'waypoints');
  });
  return g;
}

function parseCoords(text: string) {        // KML "lon,lat,alt lon,lat,alt" -> [[lat,lon],...]
  const out: number[][] = [];
  for (const tok of text.trim().split(/\s+/)) {
    const c = tok.split(',');
    const lon = parseFloat(c[0]), lat = parseFloat(c[1]);
    if (isFinite(lat) && isFinite(lon)) out.push([lat, lon]);
  }
  return out;
}
// Pull altitude values (3rd coordinate) out of a KML coordinate string, if any.
function coordAlts(text: string) {
  const out = [];
  for (const tok of text.trim().split(/\s+/)) {
    const c = tok.split(',');
    const alt = parseFloat(c[2]);
    if (isFinite(alt)) out.push(alt);
  }
  return out;
}
// KML <ExtendedData> -> { key: value } from either <Data name><value> or
// <SimpleData name> pairs. Returns null when there's nothing useful.
function parseExtendedData(pm: Element) {
  const ed = pm.querySelector('ExtendedData'); if (!ed) return null;
  const out: any = {};
  ed.querySelectorAll('Data').forEach((d) => {
    const k = d.getAttribute('name'); const v = d.querySelector('value');
    if (k && v) out[k] = v.textContent.trim();
  });
  ed.querySelectorAll('SimpleData').forEach((d) => {
    const k = d.getAttribute('name'); if (k) out[k] = d.textContent.trim();
  });
  return Object.keys(out).length ? out : null;
}
function parseKml(xml: Document) {
  const g = makeGeo();
  xml.querySelectorAll('Placemark').forEach((pm) => {
    const nameEl = pm.querySelector('name');
    const name = nameEl ? nameEl.textContent!.trim() : '';
    const extended = parseExtendedData(pm);
    if (extended) g.features.push({ name, props: extended });
    pm.querySelectorAll('coordinates').forEach((c) => coordAlts(c.textContent!).forEach((a) => ele(g, a)));
    pm.querySelectorAll('Point coordinates').forEach((c) => {
      const pts = parseCoords(c.textContent!);
      if (pts.length) { g.markers.push({ lat: pts[0][0], lon: pts[0][1], name }); g.pointCount++; bump(g, 'points'); }
    });
    pm.querySelectorAll('LineString coordinates').forEach((c) => {
      const pts = parseCoords(c.textContent!);
      if (pts.length) { g.lines.push(pts); g.pointCount += pts.length; bump(g, 'lines'); }
    });
    pm.querySelectorAll('Polygon coordinates').forEach((c) => {
      const pts = parseCoords(c.textContent!);
      if (pts.length) { g.lines.push(pts); g.pointCount += pts.length; bump(g, 'polygons'); }
    });
  });
  return g;
}

function parseGeoJson(text: string) {
  const g = makeGeo();
  const json = JSON.parse(text);
  const features = json.type === 'FeatureCollection' ? (json.features || [])
    : json.type === 'Feature' ? [json] : json.geometry ? [json] : [{ geometry: json }];
  const ll = (c: any[]) => [c[1], c[0]];        // GeoJSON is [lon, lat]
  // Best-effort display name from common property keys.
  const featName = (props: any) => {
    if (!props) return '';
    for (const k of ['name', 'Name', 'NAME', 'title', 'Title', 'id', 'ID']) {
      if (props[k] != null && props[k] !== '') return String(props[k]);
    }
    return '';
  };
  const walk = (geom: any, name: string) => {
    if (!geom) return;
    const c = geom.coordinates;
    switch (geom.type) {
      case 'Point': { const p = ll(c); g.markers.push({ lat: p[0], lon: p[1], name }); g.pointCount++; bump(g, 'points'); break; }
      case 'MultiPoint': c.forEach((p: any[]) => { const x = ll(p); g.markers.push({ lat: x[0], lon: x[1], name }); g.pointCount++; }); bump(g, 'points'); break;
      case 'LineString': { const line = c.map(ll); g.lines.push(line); g.pointCount += line.length; bump(g, 'lines'); break; }
      case 'MultiLineString': c.forEach((l: any[]) => { const line = l.map(ll); g.lines.push(line); g.pointCount += line.length; }); bump(g, 'lines'); break;
      case 'Polygon': c.forEach((ring: any[]) => { const line = ring.map(ll); g.lines.push(line); g.pointCount += line.length; }); bump(g, 'polygons'); break;
      case 'MultiPolygon': c.forEach((poly: any[]) => poly.forEach((ring: any[]) => { const line = ring.map(ll); g.lines.push(line); g.pointCount += line.length; })); bump(g, 'polygons'); break;
      case 'GeometryCollection': (geom.geometries || []).forEach((gg: any) => walk(gg, name)); break;
    }
  };
  features.forEach((f: any) => {
    const props = f && f.properties && typeof f.properties === 'object' ? f.properties : null;
    const name = featName(props);
    if (props) g.features.push({ name, props });
    walk(f.geometry, name);
  });
  return g;
}

export async function renderGeo(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  let text = '';
  try { text = await file.text(); }
  catch (e) { resultsEl.appendChild(errorCard('Could not read this file.')); return; }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let format, g;
  try {
    if (ext === 'geojson' || (/^\s*[{[]/.test(text) && ext !== 'gpx' && ext !== 'kml')) {
      format = 'GeoJSON'; g = parseGeoJson(text);
    } else {
      const xml = new DOMParser().parseFromString(text, 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('bad xml');
      if (ext === 'kml' || xml.querySelector('kml, Placemark')) { format = 'KML'; g = parseKml(xml); }
      else { format = 'GPX'; g = parseGpx(xml); }
    }
  } catch (e) {
    resultsEl.appendChild(errorCard('Could not parse this ' + (ext.toUpperCase() || 'geo') + ' file.'));
    return;
  }

  // Distance over all polylines.
  let distance = 0;
  for (const line of g.lines) for (let i = 1; i < line.length; i++) distance += haversine(line[i - 1], line[i]);

  // Bounds across everything.
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const see = (lat: number, lon: number) => { minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); };
  g.lines.forEach((l) => l.forEach((p: any[]) => see(p[0], p[1])));
  g.markers.forEach((m) => see(m.lat, m.lon));
  const hasGeo = isFinite(minLat);

  // ---- Info card ----
  const [h, help] = h3help(format + ' map data', 'Reads the shapes and coordinates in the file and draws them on an OpenStreetMap map. Distance is the real-world length along every line and track, measured across the curve of the Earth (the great-circle distance).');
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(h); infoCard.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Format', format));
  for (const [k, v] of Object.entries(g.counts)) tbl.appendChild(row(k.charAt(0).toUpperCase() + k.slice(1), String(v)));
  tbl.appendChild(row('Total points', g.pointCount.toLocaleString()));
  if (distance > 0) tbl.appendChild(row('Distance', fmtDist(distance)));
  if (isFinite(g.eleMin)) tbl.appendChild(row('Elevation', Math.round(g.eleMin) + ' – ' + Math.round(g.eleMax) + ' m'));
  if (g.timeStart != null) {
    tbl.appendChild(row('Start time', new Date(g.timeStart).toISOString().replace('T', ' ').slice(0, 19)));
    const span = (g.timeEnd! - g.timeStart) / 1000;
    if (span > 0) tbl.appendChild(row('Duration', span >= 3600 ? (span / 3600).toFixed(1) + ' h' : Math.round(span / 60) + ' min'));
  }

  // ---- Track stats (ascent/descent, moving time/pace, sensors) ----
  let ts = null;
  try {
    if (g.tracks && g.tracks.length) {
      ts = trackStats(g.tracks);
      if (ts.ascent >= 1 || ts.descent >= 1) {
        tbl.appendChild(rowHelp('Total ascent', Math.round(ts.ascent) + ' m',
          'How much you climbed in total - every uphill height gain along the route added together. Tiny changes under 2 m are ignored as GPS jitter.'));
        tbl.appendChild(row('Total descent', Math.round(ts.descent) + ' m'));
      }
      if (ts.hasTime && ts.movingTime > 0) {
        tbl.appendChild(rowHelp('Moving time', fmtDuration(ts.movingTime),
          'How long you were actually moving, with pauses left out - any gap longer than 60 seconds between recorded points counts as a stop.'));
        if (ts.movingDist > 0) {
          const speed = (ts.movingDist / 1000) / (ts.movingTime / 3600);   // km/h
          tbl.appendChild(row('Average speed', speed.toFixed(1) + ' km/h'));
          if (speed > 0) {
            const paceSec = (ts.movingTime / 60) / (ts.movingDist / 1000);   // min/km
            const pm = Math.floor(paceSec), psec = Math.round((paceSec - pm) * 60);
            tbl.appendChild(row('Average pace', pm + ':' + String(psec).padStart(2, '0') + ' /km'));
          }
        }
      }
      if (ts.hr) tbl.appendChild(row('Heart rate', Math.round(ts.hr.avg) + ' avg, ' + Math.round(ts.hr.max) + ' max bpm'));
      if (ts.cad) tbl.appendChild(row('Cadence', Math.round(ts.cad.avg) + ' avg, ' + Math.round(ts.cad.max) + ' max'));
      if (ts.temp) tbl.appendChild(row('Temperature', ts.temp.avg.toFixed(1) + ' avg, ' + ts.temp.max.toFixed(1) + ' max °C'));
    }
  } catch (e) { ts = null; }
  if (hasGeo) {
    tbl.appendChild(rowHelp('Bounds', minLat.toFixed(4) + ', ' + minLon.toFixed(4) + '  →  ' + maxLat.toFixed(4) + ', ' + maxLon.toFixed(4),
      'The smallest rectangle on the map that contains every point, given as its south-west corner → its north-east corner.'));
  }
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);
  const _renderAnchor = resultsEl.firstChild;

  // ---- Elevation profile card ----
  try {
    if (ts && ts.profile && ts.profile.length > 1) {
      const elevCard = el('div', { class: 'anr-card' });
      const [eh, ehelp] = h3help('Elevation profile', 'A graph of height (up the side) against how far you have travelled (along the bottom). The total climb and descent are in the summary above.');
      elevCard.appendChild(eh); elevCard.appendChild(ehelp);
      elevCard.appendChild(elevationProfileCanvas(ts.profile));
      resultsEl.insertBefore(elevCard, _renderAnchor);
    }
  } catch (e) { /* never let the chart break parsing/map */ }

  // ---- GeoJSON / KML properties card ----
  try {
    if (g.features && g.features.length) {
      const propCard = el('div', { class: 'anr-card' });
      const [ph, phelp] = h3help('Properties', 'The extra labels and values attached to each map feature in the file (stored as feature.properties in GeoJSON, or ExtendedData in KML). For just a few features, each is listed on its own; for many, Analyser shows the full set of label names and how often each is used.');
      propCard.appendChild(ph); propCard.appendChild(phelp);
      const ptbl = el('table', { class: 'anr-readout' });
      if (g.features.length <= 20) {
        // Name each feature; fall back to a compact key=value preview of props.
        g.features.forEach((f, i) => {
          const keys = Object.keys(f.props || {});
          const preview = keys.slice(0, 4).map((k) => k + '=' + String(f.props[k])).join(', ');
          ptbl.appendChild(row(f.name || ('Feature ' + (i + 1)), keys.length ? preview + (keys.length > 4 ? ' …' : '') : '-'));
        });
      } else {
        // Union of keys + count of features carrying each.
        const counts: Record<string, number> = {};
        g.features.forEach((f) => Object.keys(f.props || {}).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
        ptbl.appendChild(rowHelp('Features', g.features.length.toLocaleString(), 'In GeoJSON, a feature is one item on the map - a single shape (a point, line or area) together with the labels and values attached to it. This is how many the file holds.'));
        Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40)
          .forEach(([k, v]) => ptbl.appendChild(row(k, v.toLocaleString() + ' features')));
      }
      propCard.appendChild(ptbl);
      resultsEl.appendChild(propCard);
    }
  } catch (e) { /* properties are a bonus; ignore failures */ }

  if (!hasGeo) {
    resultsEl.appendChild(errorCard('No coordinates found to map.'));
    return;
  }

  // ---- Map ----
  // Which of the three views this file can support. Pace needs per-point
  // timestamps; density only becomes a picture once there are enough points for
  // one cell to be busier than another.
  let pace: PaceData|null = null;
  try { if (ts && ts.hasTime && g.tracks.length) pace = paceData(g.tracks); } catch (e) { pace = null; }
  const heat = g.pointCount >= 200 ? heatPoints(g) : null;

  const mapCard = el('div', { class: 'anr-card' });
  let mapHelp = 'The shapes and coordinates in the file drawn on an OpenStreetMap map. Tiles come from openstreetmap.org - the file itself is never sent anywhere.';
  if (pace) mapHelp += ' Pace colours the line by how fast you were moving, with the five colours split evenly across the range of speeds in this track rather than across fixed thresholds, and pins the places you stayed put.';
  if (heat) mapHelp += ' Density shades how often the track comes back to the same spot, so a route walked every day stands out from one walked once.';
  const [mh, mhelp] = h3help('Map', mapHelp);
  mapCard.appendChild(mh); mapCard.appendChild(mhelp);
  const modeStrip = el('div', { class: 'anr-geo-modes' });
  if (pace || heat) mapCard.appendChild(modeStrip);
  const mapEl = el('div', { class: 'anr-geo-map' });
  mapEl.appendChild(el('p', { class: 'anr-hint' }, 'Loading map…'));
  mapCard.appendChild(mapEl);
  const legend = el('div', { class: 'anr-geo-legend' });
  mapCard.appendChild(legend);
  resultsEl.insertBefore(mapCard, _renderAnchor);

  try { await loadCss(LEAFLET_CSS); await loadScript(LEAFLET_JS); }
  catch (e) { mapEl.innerHTML = ''; mapEl.appendChild(errorCard('Map library failed to load. Offline?')); return; }

  mapEl.innerHTML = '';
  const map = L.map(mapEl);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

  // The plain track, its pace-coloured twin and the stop pins each live in their
  // own layer group so switching view is an add/remove rather than a rebuild.
  const trackLayer = L.layerGroup();
  for (const line of g.lines) if (line.length > 1) L.polyline(line, { color: '#445f74', weight: 3 }).addTo(trackLayer);
  const paceLayer = L.layerGroup();
  const stopLayer = L.layerGroup();
  if (pace) {
    for (const r of pace.runs) L.polyline(r.pts, { color: rgb(PACE_RAMP[r.band]), weight: 4, opacity: 0.9 }).addTo(paceLayer);
    for (const s of pace.stops.slice(0, 400)) {
      L.circleMarker([s.lat, s.lon], {
        radius: Math.min(11, 4 + Math.sqrt(s.sec) / 3), color: '#1d232a', weight: 1.5,
        fillColor: '#f0f2f4', fillOpacity: 0.85,
      }).addTo(stopLayer).bindPopup(el('div', {}, 'Stopped for ' + fmtDuration(s.sec)));
    }
  }
  // A faint version of the track under the density grid, so an area the heat map
  // barely registers still shows you where the route went.
  const ghostLayer = L.layerGroup();
  if (heat) for (const line of g.lines) if (line.length > 1) L.polyline(line, { color: '#445f74', weight: 1, opacity: 0.35 }).addTo(ghostLayer);
  const density = heat ? densityOverlay(map, heat) : null;

  // Cap markers so a huge waypoint set doesn't lock up the page.
  // Pass a DOM node (not a string) to bindPopup: the string overload sets the
  // popup content via innerHTML, which would execute markup in an untrusted
  // KML/GPX/GeoJSON <name>.
  for (const m of g.markers.slice(0, 500)) L.marker([m.lat, m.lon]).addTo(map).bindPopup(el('div', {}, m.name || (m.lat.toFixed(5) + ', ' + m.lon.toFixed(5))));

  const swatch = (colour: string, label: string) => {
    const item = el('span', { class: 'anr-legend-item' });
    const sw = el('span', { class: 'anr-legend-swatch' });
    sw.style.background = colour;
    item.appendChild(sw); item.appendChild(document.createTextNode(label));
    return item;
  };
  const setMode = (mode: string) => {
    map.removeLayer(trackLayer); map.removeLayer(paceLayer); map.removeLayer(stopLayer); map.removeLayer(ghostLayer);
    if (density) density.remove();
    legend.innerHTML = '';
    if (mode === 'pace' && pace) {
      paceLayer.addTo(map); stopLayer.addTo(map);
      const edges = pace.bands;
      const labels = [
        'under ' + fmtSpeed(edges[0]),
        fmtSpeed(edges[0]) + ' - ' + fmtSpeed(edges[1]),
        fmtSpeed(edges[1]) + ' - ' + fmtSpeed(edges[2]),
        fmtSpeed(edges[2]) + ' - ' + fmtSpeed(edges[3]),
        'over ' + fmtSpeed(edges[3]),
      ];
      labels.forEach((lab, i) => legend.appendChild(swatch(rgb(PACE_RAMP[i]), lab)));
      if (pace.stops.length) legend.appendChild(swatch('#f0f2f4', pace.stops.length + (pace.stops.length === 1 ? ' stop' : ' stops')));
    } else if (mode === 'density' && density) {
      ghostLayer.addTo(map); density.add();
      const bar = el('span', { class: 'anr-geo-heatbar' });
      bar.style.background = 'linear-gradient(to right, ' + PACE_RAMP.map((c) => rgb(c)).join(', ') + ')';
      const item = el('span', { class: 'anr-legend-item' });
      item.appendChild(document.createTextNode('Passed once'));
      item.appendChild(bar);
      item.appendChild(document.createTextNode('Passed often'));
      legend.appendChild(item);
    } else {
      trackLayer.addTo(map);
    }
    for (const b of modeStrip.children) b.classList.toggle('is-active', (b as HTMLElement).dataset.mode === mode);
  };

  const addMode = (mode: string, label: string) => {
    const b = el('button', { class: 'anr-seg-btn', type: 'button' }, label) as HTMLButtonElement;
    b.dataset.mode = mode;
    b.addEventListener('click', () => setMode(mode));
    modeStrip.appendChild(b);
  };
  if (pace || heat) {
    addMode('track', 'Track');
    if (pace) addMode('pace', 'Pace');
    if (heat) addMode('density', 'Density');
  }
  setMode('track');

  map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [20, 20], maxZoom: 16 });
  setTimeout(() => map.invalidateSize(), 60);
}
