/* Analyser - geospatial files (GPX / KML / GeoJSON)
   Parses tracks / placemarks / features, computes counts, distance, bounds and
   time span, and plots the geometry on a Leaflet/OpenStreetMap map (lazy-loaded,
   same as the photo GPS map). */

import { el, row, rowHelp, h3help, errorCard, fmtBytes, loadCss, loadScript } from './util.js';

const LEAFLET_CSS = 'assets/vendor/leaflet/leaflet.css';
const LEAFLET_JS  = 'assets/vendor/leaflet/leaflet.js';

function haversine(a, b) {                 // a,b = [lat, lon]
  const R = 6371000, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(m) {
  if (!m) return '—';
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}

// Accumulates geometry into a common shape used for stats + the map.
function makeGeo() {
  return { lines: [], markers: [], pointCount: 0, eleMin: Infinity, eleMax: -Infinity,
           timeStart: null, timeEnd: null, counts: {} };
}
function bump(g, type) { g.counts[type] = (g.counts[type] || 0) + 1; }
function ele(g, v) { if (isFinite(v)) { g.eleMin = Math.min(g.eleMin, v); g.eleMax = Math.max(g.eleMax, v); } }
function tstamp(g, t) { const ms = Date.parse(t); if (!isNaN(ms)) { g.timeStart = g.timeStart == null ? ms : Math.min(g.timeStart, ms); g.timeEnd = g.timeEnd == null ? ms : Math.max(g.timeEnd, ms); } }

function parseGpx(xml) {
  const g = makeGeo();
  const num = (n, a) => parseFloat(n.getAttribute(a));
  const segPts = (nodes) => {
    const line = [];
    for (const pt of nodes) {
      const lat = num(pt, 'lat'), lon = num(pt, 'lon');
      if (!isFinite(lat) || !isFinite(lon)) continue;
      line.push([lat, lon]); g.pointCount++;
      const e = pt.querySelector('ele'); if (e) ele(g, parseFloat(e.textContent));
      const t = pt.querySelector('time'); if (t) tstamp(g, t.textContent);
    }
    return line;
  };
  xml.querySelectorAll('trkseg').forEach((seg) => { const l = segPts(seg.querySelectorAll('trkpt')); if (l.length) { g.lines.push(l); bump(g, 'track segments'); } });
  xml.querySelectorAll('rte').forEach((r) => { const l = segPts(r.querySelectorAll('rtept')); if (l.length) { g.lines.push(l); bump(g, 'routes'); } });
  xml.querySelectorAll('wpt').forEach((w) => {
    const lat = num(w, 'lat'), lon = num(w, 'lon');
    if (!isFinite(lat) || !isFinite(lon)) return;
    const nm = w.querySelector('name'); g.markers.push({ lat, lon, name: nm ? nm.textContent.trim() : '' });
    g.pointCount++; bump(g, 'waypoints');
  });
  return g;
}

function parseCoords(text) {        // KML "lon,lat,alt lon,lat,alt" -> [[lat,lon],...]
  const out = [];
  for (const tok of text.trim().split(/\s+/)) {
    const c = tok.split(',');
    const lon = parseFloat(c[0]), lat = parseFloat(c[1]);
    if (isFinite(lat) && isFinite(lon)) out.push([lat, lon]);
  }
  return out;
}
function parseKml(xml) {
  const g = makeGeo();
  xml.querySelectorAll('Placemark').forEach((pm) => {
    const nameEl = pm.querySelector('name');
    const name = nameEl ? nameEl.textContent.trim() : '';
    pm.querySelectorAll('Point coordinates').forEach((c) => {
      const pts = parseCoords(c.textContent);
      if (pts.length) { g.markers.push({ lat: pts[0][0], lon: pts[0][1], name }); g.pointCount++; bump(g, 'points'); }
    });
    pm.querySelectorAll('LineString coordinates').forEach((c) => {
      const pts = parseCoords(c.textContent);
      if (pts.length) { g.lines.push(pts); g.pointCount += pts.length; bump(g, 'lines'); }
    });
    pm.querySelectorAll('Polygon coordinates').forEach((c) => {
      const pts = parseCoords(c.textContent);
      if (pts.length) { g.lines.push(pts); g.pointCount += pts.length; bump(g, 'polygons'); }
    });
  });
  return g;
}

function parseGeoJson(text) {
  const g = makeGeo();
  const json = JSON.parse(text);
  const features = json.type === 'FeatureCollection' ? (json.features || [])
    : json.type === 'Feature' ? [json] : json.geometry ? [json] : [{ geometry: json }];
  const ll = (c) => [c[1], c[0]];        // GeoJSON is [lon, lat]
  const walk = (geom) => {
    if (!geom) return;
    const c = geom.coordinates;
    switch (geom.type) {
      case 'Point': { const p = ll(c); g.markers.push({ lat: p[0], lon: p[1], name: '' }); g.pointCount++; bump(g, 'points'); break; }
      case 'MultiPoint': c.forEach((p) => { const x = ll(p); g.markers.push({ lat: x[0], lon: x[1], name: '' }); g.pointCount++; }); bump(g, 'points'); break;
      case 'LineString': { const line = c.map(ll); g.lines.push(line); g.pointCount += line.length; bump(g, 'lines'); break; }
      case 'MultiLineString': c.forEach((l) => { const line = l.map(ll); g.lines.push(line); g.pointCount += line.length; }); bump(g, 'lines'); break;
      case 'Polygon': c.forEach((ring) => { const line = ring.map(ll); g.lines.push(line); g.pointCount += line.length; }); bump(g, 'polygons'); break;
      case 'MultiPolygon': c.forEach((poly) => poly.forEach((ring) => { const line = ring.map(ll); g.lines.push(line); g.pointCount += line.length; })); bump(g, 'polygons'); break;
      case 'GeometryCollection': (geom.geometries || []).forEach(walk); break;
    }
  };
  features.forEach((f) => walk(f.geometry));
  return g;
}

export async function renderGeo(file, resultsEl) {
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
  const see = (lat, lon) => { minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); };
  g.lines.forEach((l) => l.forEach((p) => see(p[0], p[1])));
  g.markers.forEach((m) => see(m.lat, m.lon));
  const hasGeo = isFinite(minLat);

  // ---- Info card ----
  const [h, help] = h3help(format + ' map data', 'Parses the geometry and plots it on an OpenStreetMap map. Distance is the great-circle length along all lines/tracks.');
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
    const span = (g.timeEnd - g.timeStart) / 1000;
    if (span > 0) tbl.appendChild(row('Duration', span >= 3600 ? (span / 3600).toFixed(1) + ' h' : Math.round(span / 60) + ' min'));
  }
  if (hasGeo) {
    tbl.appendChild(rowHelp('Bounds', minLat.toFixed(4) + ', ' + minLon.toFixed(4) + '  →  ' + maxLat.toFixed(4) + ', ' + maxLon.toFixed(4),
      'Bounding box of all coordinates (SW corner → NE corner).'));
  }
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  if (!hasGeo) {
    resultsEl.appendChild(errorCard('No coordinates found to map.'));
    return;
  }

  // ---- Map ----
  const mapCard = el('div', { class: 'anr-card' });
  mapCard.appendChild(el('h3', {}, 'Map'));
  const mapEl = el('div', { class: 'anr-geo-map' });
  mapEl.appendChild(el('p', { class: 'anr-hint' }, 'Loading map…'));
  mapCard.appendChild(mapEl);
  resultsEl.appendChild(mapCard);

  try { await loadCss(LEAFLET_CSS); await loadScript(LEAFLET_JS); }
  catch (e) { mapEl.innerHTML = ''; mapEl.appendChild(errorCard('Map library failed to load. Offline?')); return; }

  mapEl.innerHTML = '';
  const map = L.map(mapEl);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  for (const line of g.lines) if (line.length > 1) L.polyline(line, { color: '#445f74', weight: 3 }).addTo(map);
  // Cap markers so a huge waypoint set doesn't lock up the page.
  for (const m of g.markers.slice(0, 500)) L.marker([m.lat, m.lon]).addTo(map).bindPopup(m.name || (m.lat.toFixed(5) + ', ' + m.lon.toFixed(5)));
  map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [20, 20], maxZoom: 16 });
  setTimeout(() => map.invalidateSize(), 60);
}
