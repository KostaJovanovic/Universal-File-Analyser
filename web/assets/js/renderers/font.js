/* Analyser - font viewer (TTF / OTF / WOFF / WOFF2 / TTC)
   ============================================================================
   Two complementary engines, both fully in-browser:
   - The native FontFace API loads the real font bytes and renders a live
     specimen - sample text at several sizes - so the actual typeface is shown,
     including WOFF2 and variable fonts (axis sliders drive font-variation
     -settings live). This is the true rendering and needs no library.
   - opentype.js (vendored) parses the tables for naming/metadata, the glyph
     count, and draws a grid of individual glyph outlines. It handles TTF/OTF and
     WOFF 1.0; WOFF2 falls back to the FontFace specimen alone.
   - Collections (.ttc/.otc) are unpacked here into their standalone member fonts
     (each member's sfnt table directory + tables rebuilt into its own buffer), so
     both the live specimen and the glyph outlines work per font, with a picker to
     switch between them. */

import { el, row, rowHelp, h3help, fmtBytes, sha256Row, errorCard, loadScript } from '../core/util.js';

const OPENTYPE_URL = 'assets/vendor/opentype/opentype.min.js';
let _faceSeq = 0;
// FontFaces added to document.fonts are global and outlive resultsEl.innerHTML=''
// - each analysed font (and every collection-member switch) would otherwise
// accumulate one more live face forever. Track them and drop the previous
// render's set when a new font is analysed.
const _addedFaces = new Set();
function clearAddedFaces() {
  for (const f of _addedFaces) { try { document.fonts.delete(f); } catch (_) {} }
  _addedFaces.clear();
}

async function loadOpentype() {
  if (!window.opentype) { try { await loadScript(OPENTYPE_URL); } catch (_) {} }
  return window.opentype || null;
}

const PANGRAM = 'The quick brown fox jumps over the lazy dog';
const SPECIMEN_SIZES = [48, 32, 24, 18, 14];

// Per-script sample text ("pangrams"), shown only for the scripts a font actually
// covers - detected by probing its cmap, so a Japanese or Arabic font gets its own
// specimen instead of a row of .notdef boxes. `probe` chars must all be present.
const SCRIPT_SAMPLES = [
  { key: 'latin', label: 'Latin', probe: 'Aa', text: PANGRAM },
  { key: 'japanese', label: 'Japanese', probe: 'あ', text: 'あいうえお アイウエオ 日本語の見本' },
  { key: 'korean', label: 'Korean', probe: '가', text: '다람쥐 헌 쳇바퀴에 타고파' },
  { key: 'han', label: 'Chinese', probe: '永', text: '中文大小 上下山水 日月天地人' },
  { key: 'cyrillic', label: 'Cyrillic', probe: 'Дж', text: 'Съешь же ещё этих мягких французских булок' },
  { key: 'greek', label: 'Greek', probe: 'Ωλ', text: 'Ξεσκεπάζω την ψυχοφθόρα βδελυγμία' },
  { key: 'thai', label: 'Thai', probe: 'ก', text: 'เป็นมนุษย์สุดประเสริฐเลิศคุณค่า' },
  { key: 'devanagari', label: 'Devanagari', probe: 'अ', text: 'ऋषियों को सताने वाले राक्षसों का राजा' },
  { key: 'arabic', label: 'Arabic', probe: 'ب', text: 'نص حكيم له سر قاطع وذو شأن عظيم', rtl: true },
  { key: 'hebrew', label: 'Hebrew', probe: 'א', text: 'דג סקרן שט בים מאוכזב ולפתע מצא חברה', rtl: true },
];

// Which scripts can this font display? Returns the matching SCRIPT_SAMPLES in
// priority order (Latin first when present, so it keeps the classic ramp). Han is
// dropped when kana/Hangul are present - the Japanese/Korean sample covers it.
function detectSamples(font) {
  if (!font || typeof font.charToGlyphIndex !== 'function') return [SCRIPT_SAMPLES[0]];
  const has = (probe) => { for (const ch of probe) { let i = 0; try { i = font.charToGlyphIndex(ch); } catch (_) { i = 0; } if (!i) return false; } return true; };
  const flags = {};
  for (const s of SCRIPT_SAMPLES) flags[s.key] = has(s.probe);
  const out = SCRIPT_SAMPLES.filter((s) => flags[s.key] && !(s.key === 'han' && (flags.japanese || flags.korean)));
  return out.length ? out : [SCRIPT_SAMPLES[0]];
}

function fontName(font, key) {
  const v = font && font.names && font.names[key];
  if (!v) return '';
  return v.en || Object.values(v)[0] || '';
}

function specimenCard(family, axes, font) {
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

    // ---- Oscillation. Each axis can auto-sweep min -> max -> min on a raised
    // cosine; one shared requestAnimationFrame loop drives whichever axes are
    // "playing". It is user-initiated (a play button) so it runs even in Clear
    // view, and self-stops when the card leaves the DOM (collection member
    // switch, SPA navigation) via the isConnected guard - no manual teardown.
    const PLAY = '▶', PAUSE = '❚❚';   // filled triangle / double bar
    const playing = new Set();
    let rafId = 0;
    const PERIOD = 4200;   // ms for one full min -> max -> min sweep

    // Referenced by syncButtons below, so it must exist before the first call.
    const playAllBtn = el('button', { type: 'button', class: 'anr-btn anr-font-playall' });

    const syncButtons = () => {
      for (const a of axes) {
        const on = playing.has(a);
        a.playBtn.textContent = on ? PAUSE : PLAY;
        a.playBtn.classList.toggle('is-playing', on);
        a.playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      const allOn = playing.size === axes.length;
      playAllBtn.textContent = allOn ? PAUSE + '  Pause all' : PLAY + '  Play all';
      playAllBtn.classList.toggle('is-playing', playing.size > 0);
    };

    // Start (or restart) an axis from wherever its slider currently sits, so
    // pressing play resumes from the current value instead of snapping to
    // wherever the global sweep phase happens to be. Solve the raised cosine for
    // the phase matching the current value (acos gives the rising branch, so it
    // heads towards max first - or, if already at max, eases back down). The
    // resulting per-axis offset also de-syncs axes that start at different values.
    const startAxis = (a, now) => {
      const span = a.max - a.min;
      const k = span ? (parseFloat(a.input.value) - a.min) / span : 0;
      const phase0 = Math.acos(1 - 2 * Math.min(1, Math.max(0, k)));   // [0, π]
      a._off = phase0 / (Math.PI * 2) - now / PERIOD;                  // offset in cycles
      playing.add(a);
    };

    const frame = (now) => {
      rafId = 0;
      if (!axisBox.isConnected) { playing.clear(); return; }   // detached - stop for good
      for (const a of playing) {
        const phase = ((now / PERIOD) + a._off) * Math.PI * 2;
        const k = 0.5 - 0.5 * Math.cos(phase);                 // eased 0..1
        const v = a.min + (a.max - a.min) * k;
        a.input.value = String(v);
        a.val.textContent = (Math.round(v * 100) / 100).toString();
      }
      applyAxes();
      if (playing.size) rafId = requestAnimationFrame(frame);
    };
    const kick = () => { if (!rafId && playing.size) rafId = requestAnimationFrame(frame); };
    const toggle = (a) => { if (playing.has(a)) playing.delete(a); else startAxis(a, performance.now()); syncButtons(); kick(); };

    playAllBtn.addEventListener('click', () => {
      if (playing.size === axes.length) { playing.clear(); }
      else { const now = performance.now(); for (const a of axes) if (!playing.has(a)) startAxis(a, now); }
      syncButtons(); kick();
    });
    axisBox.appendChild(el('div', { class: 'anr-font-axes-head' }, [
      el('span', { class: 'anr-font-axes-title' }, 'Variable axes'),
      playAllBtn,
    ]));

    axes.forEach((a) => {
      const val = el('span', { class: 'anr-font-axis-val' }, String(a.def));
      const input = el('input', { type: 'range', class: 'anr-range', min: String(a.min), max: String(a.max), value: String(a.def), step: String(Math.max(0.001, (a.max - a.min) / 200)) });
      const playBtn = el('button', { type: 'button', class: 'anr-player-play anr-font-axis-play', 'aria-label': `Animate ${a.name} (${a.tag})` }, PLAY);
      a.input = input; a.val = val; a.playBtn = playBtn;
      input.addEventListener('input', () => {
        // A manual drag takes the wheel - stop that axis animating.
        if (playing.has(a)) { playing.delete(a); syncButtons(); }
        val.textContent = (Math.round(input.value * 100) / 100).toString();
        applyAxes();
      });
      playBtn.addEventListener('click', () => toggle(a));
      axisBox.appendChild(el('div', { class: 'anr-font-axis' }, [
        el('span', { class: 'anr-font-axis-name' }, `${a.name} (${a.tag})`),
        input,
        val,
        playBtn,
      ]));
    });

    syncButtons();
    card.appendChild(axisBox);
  }

  // Pick the best script for the size ramp - Latin if the font has it, else the
  // first script it does cover (so a Japanese-only font ramps in Japanese).
  const scripts = detectSamples(font);
  const primary = scripts[0];
  const dirOf = (s) => (s.rtl ? 'direction:rtl;' : '');
  for (const size of SPECIMEN_SIZES) {
    const txt = primary.key === 'latin' && size < 32 ? primary.text + '  0123456789' : primary.text;
    lines.appendChild(el('div', { class: 'anr-font-line', style: `font-family:"${family}"; font-size:${size}px;${dirOf(primary)}` }, txt));
  }
  if (primary.key === 'latin') {
    lines.appendChild(el('div', { class: 'anr-font-line', style: `font-family:"${family}"; font-size:22px;` }, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
    lines.appendChild(el('div', { class: 'anr-font-line', style: `font-family:"${family}"; font-size:22px;` }, 'abcdefghijklmnopqrstuvwxyz'));
  }
  card.appendChild(lines);

  // Every other script the font covers, one labelled pangram each.
  const others = scripts.slice(1);
  if (others.length) {
    card.appendChild(el('div', { class: 'anr-readout-section', style: 'margin-top:14px' }, 'Other scripts in this font'));
    const block = el('div', { class: 'anr-font-scripts' });
    for (const s of others) {
      block.appendChild(el('div', { class: 'anr-font-script-row' }, [
        el('span', { class: 'anr-font-script-label' }, s.label),
        el('div', { class: 'anr-font-line', style: `font-family:"${family}"; font-size:26px;${dirOf(s)}` }, s.text),
      ]));
    }
    card.appendChild(block);
  }
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

// Variable axes (from an opentype font's fvar table).
function axesOf(font) {
  if (!(font && font.tables && font.tables.fvar && Array.isArray(font.tables.fvar.axes))) return [];
  return font.tables.fvar.axes.map((a) => ({
    tag: a.tag, min: a.minValue, def: a.defaultValue, max: a.maxValue,
    name: (a.name && (a.name.en || Object.values(a.name)[0])) || a.tag,
  }));
}

// ---- TrueType/OpenType Collection (.ttc/.otc) ---------------------------------
// A collection is a "ttcf" header listing byte offsets to each member font's
// sfnt table directory, with the actual table data (often shared - glyf, loca)
// pooled in the file. opentype.js and FontFace both expect a SINGLE font, so we
// rebuild each member into a standalone sfnt: copy its table directory and the
// tables it points at into a fresh, self-contained buffer.
function extractSfnt(buf, offset) {
  try {
    const dv = new DataView(buf);
    const numTables = dv.getUint16(offset + 4);
    if (!numTables || numTables > 400) return null;
    const recs = [];
    for (let i = 0; i < numTables; i++) {
      const r = offset + 12 + i * 16;
      recs.push({ tag: dv.getUint32(r), checksum: dv.getUint32(r + 4), off: dv.getUint32(r + 8), len: dv.getUint32(r + 12) });
    }
    const align = (n) => (n + 3) & ~3;
    let p = 12 + numTables * 16;
    for (const r of recs) { r.newOff = p; p = align(p + r.len); }
    const out = new Uint8Array(p), odv = new DataView(out.buffer), src = new Uint8Array(buf);
    odv.setUint32(0, dv.getUint32(offset));       // sfntVersion
    odv.setUint16(4, numTables);
    odv.setUint16(6, dv.getUint16(offset + 6));   // searchRange
    odv.setUint16(8, dv.getUint16(offset + 8));   // entrySelector
    odv.setUint16(10, dv.getUint16(offset + 10)); // rangeShift
    recs.forEach((r, i) => {
      const rec = 12 + i * 16;
      odv.setUint32(rec, r.tag); odv.setUint32(rec + 4, r.checksum);
      odv.setUint32(rec + 8, r.newOff); odv.setUint32(rec + 12, r.len);
      if (r.off + r.len <= src.length) out.set(src.subarray(r.off, r.off + r.len), r.newOff);
    });
    return out;
  } catch (_) { return null; }
}
function extractCollection(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.getUint32(0) !== 0x74746366) return null;   // 'ttcf'
    const numFonts = dv.getUint32(8);
    if (!numFonts || numFonts > 500) return null;
    const out = [];
    for (let i = 0; i < numFonts; i++) { const f = extractSfnt(buf, dv.getUint32(12 + i * 4)); if (f) out.push(f); }
    return out.length ? out : null;
  } catch (_) { return null; }
}

// Per-font metadata table (the naming/version/glyph rows for one font).
function fontMetaCard(font, axes) {
  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Font', 'Reads the typeface naming, metadata and outlines; the live specimen above is the real rendering.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  const fam = fontName(font, 'fontFamily'); if (fam) tbl.appendChild(row('Family', fam));
  const sub = fontName(font, 'fontSubfamily'); if (sub) tbl.appendChild(row('Style', sub));
  const ver = fontName(font, 'version'); if (ver) tbl.appendChild(row('Version', ver.replace(/^Version\s*/i, '')));
  const designer = fontName(font, 'designer'); if (designer) tbl.appendChild(row('Designer', designer));
  const manuf = fontName(font, 'manufacturer'); if (manuf) tbl.appendChild(row('Foundry', manuf));
  const lic = fontName(font, 'license'); if (lic) tbl.appendChild(rowHelp('Licence', lic.length > 160 ? lic.slice(0, 160) + '…' : lic, 'The licence string embedded in the font name table.'));
  if (font && font.outlinesFormat) tbl.appendChild(row('Outlines', font.outlinesFormat === 'cff' ? 'PostScript (CFF)' : 'TrueType (glyf)'));
  if (font && font.unitsPerEm) tbl.appendChild(row('Units per em', String(font.unitsPerEm)));
  if (font && font.glyphs && font.glyphs.length) tbl.appendChild(row('Glyphs', font.glyphs.length.toLocaleString()));
  if (axes.length) tbl.appendChild(rowHelp('Variable', axes.length + (axes.length === 1 ? ' axis' : ' axes') + ' - ' + axes.map((a) => a.tag).join(', '), 'A variable font carries multiple styles on continuous axes; the sliders in the specimen above interpolate them live.'));
  const copyright = fontName(font, 'copyright'); if (copyright) tbl.appendChild(rowHelp('Copyright', copyright.length > 160 ? copyright.slice(0, 160) + '…' : copyright, 'The copyright notice from the font name table.'));
  if (!tbl.children.length) tbl.appendChild(row('Naming', 'not available'));
  card.appendChild(tbl);
  return card;
}

export async function renderFont(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  clearAddedFaces();   // drop the previous font's live FontFaces before loading this one
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading font "${file.name}"…`));

  let buf;
  try { buf = await file.arrayBuffer(); }
  catch (e) { resultsEl.innerHTML = ''; resultsEl.appendChild(errorCard('Could not read this font file.')); return; }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const ot = await loadOpentype();

  // A collection? Split it into standalone member fonts; otherwise one entry.
  const members = extractCollection(buf);
  const entries = [];
  if (members) {
    members.forEach((bytes, i) => {
      let f = null; if (ot) { try { f = ot.parse(bytes.buffer.slice(0)); } catch (_) { f = null; } }
      const nm = (f && (fontName(f, 'fontFamily') ? (fontName(f, 'fontFamily') + (fontName(f, 'fontSubfamily') && fontName(f, 'fontSubfamily') !== 'Regular' ? ' ' + fontName(f, 'fontSubfamily') : '')) : '')) || ('Font ' + (i + 1));
      entries.push({ bytes, font: f, label: (i + 1) + '.  ' + nm });
    });
  }
  if (!entries.length) {
    let f = null; if (ot) { try { f = ot.parse(buf.slice(0)); } catch (_) { f = null; } }
    entries.push({ bytes: new Uint8Array(buf), font: f, label: '' });
  }

  resultsEl.innerHTML = '';

  // ---- Live specimen (pinned above the file details so the real rendering leads) ----
  const specimenWrap = el('div', {});
  resultsEl.appendChild(specimenWrap);

  // ---- File-level card ----
  const isColl = !!members;
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, isColl ? 'Font collection' : 'Font file'));
  const tbl = el('table', { class: 'anr-readout' });
  const FLAVOUR = { ttf: 'TrueType (TTF)', otf: 'OpenType (OTF)', woff: 'Web font (WOFF)', woff2: 'Web font (WOFF2)', ttc: 'TrueType collection (TTC)', otc: 'OpenType collection (OTC)' };
  let fmtLabel = FLAVOUR[ext] || (entries[0].font && entries[0].font.outlinesFormat === 'cff' ? 'OpenType (CFF)' : 'Font');
  if (isColl) fmtLabel += ' - ' + entries.length + (entries.length === 1 ? ' font' : ' fonts');
  tbl.appendChild(rowHelp('Format', fmtLabel, isColl ? 'A font collection (TTC/OTC) packs several related fonts in one file, sharing common glyph data. Each member is unpacked and previewed individually below.' : 'The on-disk font format.'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(sha256Row(file));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- Sub-font picker (collections only) ----
  const subWrap = el('div', {});
  let current = 0;
  if (entries.length > 1) {
    const pick = el('div', { class: 'anr-card' });
    pick.appendChild(el('h3', {}, 'Fonts in this collection (' + entries.length + ')'));
    const sel = el('select', { class: 'anr-btn anr-select', style: 'max-width:100%;' },
      entries.map((e, i) => el('option', { value: String(i) }, e.label)));
    sel.addEventListener('change', () => { current = +sel.value; renderMember(); });
    pick.appendChild(sel);
    resultsEl.appendChild(pick);
  }
  resultsEl.appendChild(subWrap);

  async function renderMember() {
    subWrap.innerHTML = '';
    specimenWrap.innerHTML = '';
    const e = entries[current];
    const axes = axesOf(e.font);

    subWrap.appendChild(fontMetaCard(e.font, axes));

    // Live specimen via FontFace, from the standalone (member) bytes. Rendered
    // into specimenWrap (pinned above the file card), not subWrap.
    const family = 'AnalyserFont' + (++_faceSeq);
    let faceOk = false;
    try {
      const face = new FontFace(family, e.bytes.slice().buffer);
      await face.load();
      document.fonts.add(face);
      _addedFaces.add(face);
      faceOk = true;
    } catch (_) { faceOk = false; }
    if (faceOk) specimenWrap.appendChild(specimenCard(family, axes, e.font));
    else specimenWrap.appendChild(el('div', { class: 'anr-info' }, 'The browser could not load this font for live preview, so only its metadata and glyph outlines are shown.'));

    // Glyph grid via opentype.js.
    if (e.font) {
      const gg = glyphGridCard(e.font);
      if (gg) subWrap.appendChild(gg);
    } else {
      subWrap.appendChild(el('div', { class: 'anr-info' }, ext === 'woff2'
        ? 'Per-glyph outlines are not extracted from WOFF2 (Brotli-compressed) here - the live specimen above is the real rendering.'
        : 'Glyph outlines could not be parsed for this font.'));
    }
  }
  await renderMember();
}
