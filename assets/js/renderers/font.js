/* Analyser - font viewer (TTF / OTF / WOFF / WOFF2 / TTC)
   ============================================================================
   Two complementary engines, both fully in-browser:
   - The native FontFace API loads the real font bytes and renders a live
     specimen - sample text at several sizes - so the actual typeface is shown,
     including WOFF2 and variable fonts (axis sliders drive font-variation
     -settings live). This is the true rendering and needs no library.
   - opentype.js (vendored) parses the tables for naming/metadata, the glyph
     count, and draws a grid of individual glyph outlines. It handles TTF/OTF and
     WOFF 1.0; WOFF2/TTC fall back to the FontFace specimen alone. */

import { el, row, rowHelp, h3help, fmtBytes, sha256Row, errorCard, loadScript } from '../core/util.js';

const OPENTYPE_URL = 'assets/vendor/opentype/opentype.min.js';
let _faceSeq = 0;

async function loadOpentype() {
  if (!window.opentype) { try { await loadScript(OPENTYPE_URL); } catch (_) {} }
  return window.opentype || null;
}

const PANGRAM = 'The quick brown fox jumps over the lazy dog';
const SPECIMEN_SIZES = [48, 32, 24, 18, 14];

function fontName(font, key) {
  const v = font && font.names && font.names[key];
  if (!v) return '';
  return v.en || Object.values(v)[0] || '';
}

function specimenCard(family, axes) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Specimen'));

  // Variable-axis sliders, if any, drive font-variation-settings on the lines.
  const lines = el('div', { class: 'anr-font-specimen' });
  const applyAxes = () => {
    if (!axes.length) return;
    const setting = axes.map((a) => `"${a.tag}" ${a.input.value}`).join(', ');
    lines.style.fontVariationSettings = setting;
  };

  if (axes.length) {
    const axisBox = el('div', { class: 'anr-font-axes' });
    for (const a of axes) {
      const val = el('span', { class: 'anr-font-axis-val' }, String(a.def));
      const input = el('input', { type: 'range', min: String(a.min), max: String(a.max), value: String(a.def), step: String(Math.max(0.001, (a.max - a.min) / 200)) });
      a.input = input;
      input.addEventListener('input', () => { val.textContent = (Math.round(input.value * 100) / 100).toString(); applyAxes(); });
      const labelTxt = `${a.name} (${a.tag})`;
      axisBox.appendChild(el('label', { class: 'anr-font-axis' }, [
        el('span', { class: 'anr-font-axis-name' }, labelTxt),
        input,
        val,
      ]));
    }
    card.appendChild(axisBox);
  }

  for (const size of SPECIMEN_SIZES) {
    const line = el('div', { class: 'anr-font-line', style: `font-family:"${family}"; font-size:${size}px;` }, size >= 32 ? PANGRAM : PANGRAM + '  0123456789');
    lines.appendChild(line);
  }
  // Alphabet rows.
  lines.appendChild(el('div', { class: 'anr-font-line', style: `font-family:"${family}"; font-size:22px;` }, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  lines.appendChild(el('div', { class: 'anr-font-line', style: `font-family:"${family}"; font-size:22px;` }, 'abcdefghijklmnopqrstuvwxyz'));
  card.appendChild(lines);
  if (axes.length) applyAxes();
  return card;
}

function glyphGridCard(font) {
  const total = font.glyphs && font.glyphs.length ? font.glyphs.length : 0;
  if (!total) return null;
  const card = el('div', { class: 'anr-card' });
  const CAP = 500;
  const shown = Math.min(total, CAP);
  card.appendChild(el('h3', {}, `Glyphs (${total.toLocaleString()})`));
  if (total > CAP) card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px;' }, `Showing the first ${CAP} glyph outlines.`));
  const grid = el('div', { class: 'anr-font-glyphs' });
  const color = getComputedStyle(document.body).color || '#000';
  const CELL = 44, SIZE = 30, BASE = 32;
  for (let i = 0; i < shown; i++) {
    let glyph;
    try { glyph = font.glyphs.get(i); } catch (_) { continue; }
    if (!glyph) continue;
    const canvas = el('canvas', { width: CELL, height: CELL, class: 'anr-font-glyph', title: (glyph.name || ('glyph ' + i)) + (glyph.unicode != null ? ' · U+' + glyph.unicode.toString(16).toUpperCase().padStart(4, '0') : '') });
    try {
      const ctx = canvas.getContext('2d');
      const adv = glyph.advanceWidth ? (glyph.advanceWidth / font.unitsPerEm) * SIZE : SIZE * 0.5;
      const x = (CELL - adv) / 2;
      const path = glyph.getPath(x, BASE, SIZE);
      path.fill = color;
      path.draw(ctx);
    } catch (_) { /* unrenderable glyph - leave the cell blank */ }
    grid.appendChild(canvas);
  }
  card.appendChild(grid);
  return card;
}

export async function renderFont(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading font "${file.name}"…`));

  let buf;
  try { buf = await file.arrayBuffer(); }
  catch (e) { resultsEl.innerHTML = ''; resultsEl.appendChild(errorCard('Could not read this font file.')); return; }

  const ext = (file.name.split('.').pop() || '').toLowerCase();

  // Parse tables/metadata/glyphs with opentype.js (best-effort; WOFF2/TTC may fail).
  let font = null;
  const ot = await loadOpentype();
  if (ot) { try { font = ot.parse(buf.slice(0)); } catch (_) { font = null; } }

  // Load the real font for rendering via the native FontFace API.
  const family = 'AnalyserFont' + (++_faceSeq);
  let faceOk = false;
  try {
    const face = new FontFace(family, buf.slice(0));
    await face.load();
    document.fonts.add(face);
    faceOk = true;
  } catch (_) { faceOk = false; }

  resultsEl.innerHTML = '';

  // Variable axes (from opentype fvar table).
  let axes = [];
  if (font && font.tables && font.tables.fvar && Array.isArray(font.tables.fvar.axes)) {
    axes = font.tables.fvar.axes.map((a) => ({
      tag: a.tag,
      min: a.minValue, def: a.defaultValue, max: a.maxValue,
      name: (a.name && (a.name.en || Object.values(a.name)[0])) || a.tag,
    }));
  }

  // ---- Metadata ----
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Font', 'Renders the typeface live and reads its naming, metadata and glyph outlines.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  const FLAVOUR = { ttf: 'TrueType (TTF)', otf: 'OpenType (OTF)', woff: 'Web font (WOFF)', woff2: 'Web font (WOFF2)', ttc: 'TrueType collection (TTC)', otc: 'OpenType collection (OTC)' };
  tbl.appendChild(row('Format', FLAVOUR[ext] || (font && font.outlinesFormat === 'cff' ? 'OpenType (CFF)' : 'Font')));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  const family0 = fontName(font, 'fontFamily'); if (family0) tbl.appendChild(row('Family', family0));
  const sub = fontName(font, 'fontSubfamily'); if (sub) tbl.appendChild(row('Style', sub));
  const ver = fontName(font, 'version'); if (ver) tbl.appendChild(row('Version', ver.replace(/^Version\s*/i, '')));
  const designer = fontName(font, 'designer'); if (designer) tbl.appendChild(row('Designer', designer));
  const manuf = fontName(font, 'manufacturer'); if (manuf) tbl.appendChild(row('Foundry', manuf));
  const lic = fontName(font, 'license'); if (lic) tbl.appendChild(rowHelp('Licence', lic.length > 160 ? lic.slice(0, 160) + '…' : lic, 'The licence string embedded in the font name table.'));
  if (font && font.unitsPerEm) tbl.appendChild(row('Units per em', String(font.unitsPerEm)));
  if (font && font.glyphs && font.glyphs.length) tbl.appendChild(row('Glyphs', font.glyphs.length.toLocaleString()));
  if (axes.length) tbl.appendChild(rowHelp('Variable', axes.length + (axes.length === 1 ? ' axis' : ' axes') + ' - ' + axes.map((a) => a.tag).join(', '), 'A variable font carries multiple styles on continuous axes; the sliders in the specimen below interpolate them live.'));
  const copyright = fontName(font, 'copyright'); if (copyright) tbl.appendChild(rowHelp('Copyright', copyright.length > 160 ? copyright.slice(0, 160) + '…' : copyright, 'The copyright notice from the font name table.'));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- Live specimen ----
  if (faceOk) {
    resultsEl.appendChild(specimenCard(family, axes));
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, 'The browser could not load this font for live preview, so only its metadata and glyph outlines are shown.'));
  }

  // ---- Glyph grid ----
  if (font) {
    const gg = glyphGridCard(font);
    if (gg) resultsEl.appendChild(gg);
  } else if (ext === 'woff2' || ext === 'ttc' || ext === 'otc') {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, ext === 'woff2'
      ? 'Per-glyph outlines are not extracted from WOFF2 (Brotli-compressed) here - the live specimen above is the real rendering.'
      : 'Per-glyph outlines are shown for single fonts; this is a font collection, previewed as a whole above.'));
  }
}
