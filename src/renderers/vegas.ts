/* Analyser - Sony / MAGIX VEGAS Pro project (.veg / .vf) viewer
   ============================================================================
   A .veg is a Sonic Foundry "RIFF GUID" container - the magic is lowercase
   "riff" followed by a 16-byte form GUID (the trailing 00c04f8edb8a class IDs
   are classic Sonic Foundry COM GUIDs), then nested chunks keyed by GUID. The
   per-event/track layout is keyed by undocumented GUIDs, so a faithful timeline
   rebuild isn't reliable - but a great deal IS plainly recoverable:

     - the authoring app + version (an embedded AppData path: ...\Vegas Pro\11.0\)
     - the project summary block (author / title / company / copyright / contact),
       stored as a run of UTF-16LE strings
     - every media generator and video FX used, by its plugin id
       ({Svfx:com.sonycreativesoftware:titlesandtext}) and friendly name
     - the actual title/text content, stored as RTF we decode to plain text
     - the source media + template file paths

   So this viewer extracts and presents all of that rather than faking a timeline.
   Everything is read on-device; nothing is uploaded. */

import { el, row, rowHelp, h3help, fmtBytes, integrityCard, errorCard } from '../core/util.js';

const MAX_BYTES = 64 * 1024 * 1024;   // .veg projects are small; cap defensively

// Known Sony/MAGIX plugin ids -> friendly names (fallback derives from the id).
const FX_NAMES = {
  solidcolor: 'Solid Color', titlesandtext: 'Titles & Text', cookiecutter: 'Cookie Cutter',
  text: 'Legacy Text', credits: 'Credit Roll', colorcorrector: 'Colour Corrector',
  colorcorrectorsecondary: 'Secondary Colour Corrector', gaussianblur: 'Gaussian Blur',
  crop: 'Crop', pan: 'Pan/Crop', chromakeyer: 'Chroma Keyer', whitebalance: 'White Balance',
  brightnesscontrast: 'Brightness & Contrast', sharpen: 'Sharpen', lensflare: 'Lens Flare',
  glow: 'Glow', mask: 'Mask Generator', gradient: 'Gradient', checkerboard: 'Checkerboard',
  noisetexture: 'Noise Texture', testpattern: 'Test Pattern', timecode: 'Timecode',
};
const fxName = (id) => FX_NAMES[id] || id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());

// Pull every printable UTF-16LE run (the format stores text as little-endian
// UTF-16), keeping byte offsets so we can read the metadata block in file order.
function utf16Runs(buf, min) {
  const out = []; let cur = [], start = -1;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const lo = buf[i], hi = buf[i + 1];
    if (hi === 0 && ((lo >= 0x20 && lo < 0x7f) || lo === 0x09)) { if (!cur.length) start = i; cur.push(String.fromCharCode(lo)); }
    else { if (cur.length >= min) out.push({ off: start, s: cur.join('') }); cur = []; }
  }
  if (cur.length >= min) out.push({ off: start, s: cur.join('') });
  return out;
}

// Minimal RTF -> plain text: drop the header groups, turn \par into newlines,
// decode \'xx and \uN, strip remaining control words and braces.
function rtfToText(rtf) {
  let s = rtf.replace(/\\par[d]?\b/g, '\n').replace(/\\line\b/g, '\n');
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u(-?\d+)\s?\??/g, (m, n) => { const c = parseInt(n, 10); return c >= 0 ? String.fromCharCode(c) : ''; });
  s = s.replace(/\{\\\*[^{}]*\}/g, '');                 // ignore destinations (\*\... groups)
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '');             // strip control words
  s = s.replace(/[{}]/g, '');                           // strip group braces
  return s.replace(/\x00/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

function parseVegas(buf) {
  const u16 = utf16Runs(buf, 3);
  const all = u16.map((r) => r.s);

  // Authoring app + version from an embedded application-data path.
  let app = 'VEGAS Pro', version = '';
  for (const s of all) {
    let m = s.match(/(?:Sony|MAGIX|VEGAS)[\\/]+(?:Vegas Pro|VEGAS Pro)[\\/]+(\d+\.\d+)/i);
    if (m) { app = 'VEGAS Pro'; version = m[1]; break; }
    m = s.match(/Movie Studio[^\\/]*[\\/]+(\d+\.\d+)/i);
    if (m) { app = 'VEGAS Movie Studio'; version = m[1]; break; }
  }

  // Media generators / video FX, with instance counts. Plugin ids look like
  // {Svfx:com.sonycreativesoftware:titlesandtext}; "META:\Video Generator\{...}"
  // markers count how many instances are placed.
  const fx = new Map();   // id -> { count }
  const idRe = /\{Svfx:[^:}]*:([a-z0-9_]+)\}/i;
  for (const s of all) {
    const m = s.match(idRe);
    if (!m) continue;
    const id = m[1].toLowerCase();
    const isInstance = /^META:\\Video Generator/i.test(s);
    const cur = fx.get(id) || { count: 0, seen: false };
    if (isInstance) cur.count += 1;
    cur.seen = true;
    fx.set(id, cur);
  }
  const generators = [...fx.entries()].map(([id, v]) => ({ id, name: fxName(id), count: v.count })).sort((a, b) => b.count - a.count);

  // Title / text content stored as RTF. Require a \par (actual paragraph text) so
  // the bare font-table header ({\rtf1…\fonttbl…Verdana;}) isn't mistaken for text.
  const texts = [];
  const seenText = new Set();
  for (const s of all) {
    if (!/\\par/.test(s)) continue;
    const t = rtfToText(s);
    if (t && t.length <= 400 && !seenText.has(t)) { seenText.add(t); texts.push(t); }
  }

  // Project summary block: a contiguous run of human-readable UTF-16 strings
  // (author, title, company, copyright, contact). It's hard to find by shape alone
  // (FX parameter names form similar clusters), so anchor on a STRONG metadata
  // signal - an email, a copyright/rights line - then expand to the neighbouring
  // strings while they stay tightly packed (the block's runs sit ~40-60 bytes
  // apart; unrelated data is much further off).
  const summary = [];
  const strong = (s) => /@[\w.-]+\.\w{2,}|all rights reserved|©|\(c\)\s|copyright|\b(19|20)\d\d\b.{0,40}https?:/i.test(s);
  const anchor = u16.findIndex((r) => strong(r.s));
  if (anchor >= 0) {
    const block = [u16[anchor]];
    for (let i = anchor - 1; i >= 0 && u16[i + 1].off - u16[i].off <= 100; i--) block.unshift(u16[i]);
    for (let i = anchor + 1; i < u16.length && u16[i].off - u16[i - 1].off <= 100; i++) block.push(u16[i]);
    const seenS = new Set();
    for (const r of block) {
      const s = r.s.trim();
      if (!s || s.length < 3 || seenS.has(s) || /^(Preview|Master|Default|Video|Audio)$/i.test(s)) continue;
      seenS.add(s);
      let label = '';
      if (/@[\w.-]+\.\w{2,}/.test(s)) label = 'Contact';
      else if (/all rights reserved/i.test(s)) label = 'Rights';
      else if (/(©|\(c\)|copyright|\b(19|20)\d\d\b)/i.test(s)) label = 'Copyright';
      else if (/^https?:|\.(com|net|org|tv|io)\b/i.test(s) && !/\s/.test(s)) label = 'Website';
      summary.push({ label, value: s });
    }
  }

  // Referenced media + template paths.
  const paths = [...new Set(all.filter((s) => /^[A-Za-z]:[\\/]/.test(s) && s.length > 3))];

  return { app, version, generators, texts, summary, paths,
    genInstances: generators.reduce((n, g) => n + g.count, 0) };
}

export async function renderVegas(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let buf;
  try { buf = new Uint8Array(await file.slice(0, MAX_BYTES).arrayBuffer()); } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    return;
  }

  // Verify the Sonic Foundry "riff" magic; otherwise hand off to the identifier.
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'riff' && magic !== 'RIFF') {
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }

  const data = parseVegas(buf);
  resultsEl.innerHTML = '';

  const isVf = /\.vf$/i.test(file.name);

  // ---- Project identification ----
  const meta = el('div', { class: 'anr-card' });
  meta.appendChild(el('h3', {}, 'VEGAS Pro project'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', data.app + (data.app === 'VEGAS Pro' ? ' (Sony / MAGIX)' : '')));
  tbl.appendChild(rowHelp('Format', isVf ? 'VEGAS Movie Studio project (.vf)' : 'VEGAS Pro project (.veg)',
    'A Sonic Foundry project file wrapper (their "RIFF GUID" format) - identified by a lowercase "riff" tag at the start followed by a 16-byte unique id (a GUID) that names the file type. Analyser reads the text, plugin ids and other information stored inside.'));
  if (data.version) tbl.appendChild(rowHelp('Version', data.version,
    'Worked out from a settings-folder path saved inside the project (for example ...\\Vegas Pro\\11.0\\). It shows the version of VEGAS that wrote the file.'));
  tbl.appendChild(rowHelp('Media generators / FX', String(data.generators.length) + (data.genInstances ? ` (${data.genInstances} instances)` : ''), 'VEGAS plugins used in the project - "generators" that create their own imagery, such as titles and solid-colour backgrounds, plus video effects (FX) applied to clips.'));
  if (data.texts.length) tbl.appendChild(rowHelp('Text events', String(data.texts.length), 'In VEGAS an "event" is a clip placed on the timeline; a text event is a title or caption placed this way.'));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  meta.appendChild(tbl);
  resultsEl.appendChild(meta);

  // ---- Project summary (author / copyright / contact) ----
  if (data.summary.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Project summary'));
    const st = el('table', { class: 'anr-readout' });
    data.summary.forEach((m, i) => st.appendChild(row(m.label || (i === 0 ? 'Metadata' : ''), m.value)));
    card.appendChild(st);
    resultsEl.appendChild(card);
  }

  // ---- Media generators & effects ----
  if (data.generators.length) {
    const card = el('div', { class: 'anr-card' });
    const [gh, ghp] = h3help('Media generators & effects (' + data.generators.length + ')', 'The Sony/VEGAS plugins this project places - generators (titles, solid colour) and video FX.');
    card.appendChild(gh); card.appendChild(ghp);
    const ul = el('ul', { style: 'margin:0;padding-left:18px;font-size:13px;' });
    data.generators.forEach((g) => {
      const li = el('li', {}, g.name + (g.count > 1 ? `  ×${g.count}` : ''));
      li.appendChild(el('span', { class: 'anr-hint', style: 'margin-left:8px;font-size:11px;' }, g.id));
      ul.appendChild(li);
    });
    card.appendChild(ul);
    resultsEl.appendChild(card);
  }

  // ---- Title & text content ----
  if (data.texts.length) {
    const card = el('div', { class: 'anr-card' });
    const [th, thp] = h3help('Title & text content (' + data.texts.length + ')', 'Decoded from the RTF the Titles & Text generators store.');
    card.appendChild(th); card.appendChild(thp);
    const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:6px;' });
    data.texts.forEach((t) => wrap.appendChild(el('div', {
      style: 'border:1px solid var(--hairline);padding:6px 10px;font-size:14px;white-space:pre-wrap;word-break:break-word;',
    }, t)));
    card.appendChild(wrap);
    resultsEl.appendChild(card);
  }

  // ---- Referenced files ----
  if (data.paths.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Referenced files & paths (' + data.paths.length + ')'));
    const ul = el('ul', { style: 'margin:0;padding-left:18px;font-size:12px;opacity:.85;word-break:break-all;' });
    data.paths.slice(0, 200).forEach((p) => ul.appendChild(el('li', {}, p)));
    card.appendChild(ul);
    resultsEl.appendChild(card);
  }

  resultsEl.appendChild(integrityCard(file));
}
