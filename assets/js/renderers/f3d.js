/* Analyser - Autodesk Fusion 360 reader (.f3d / .f3z)

   A Fusion 360 design is a ZIP whose members are Zstandard-compressed (ZIP
   method 93 - see zip.js). It carries no open geometry: the solid model lives in
   Autodesk's proprietary ShapeManager BREP blobs (Breps.BlobParts/*.smb) and an
   undocumented OGS display mesh, neither of which is reconstructable in the
   browser. What IS readable, and what we surface here, is:
     - Fusion's own rendered thumbnail  (.../Previews/*.png)  - shown as the model
     - the document descriptor          (Properties.dat, clean JSON: type/subtype)
     - the design manifest              (Manifest.dat, for the Fusion doc version)
     - a count of the solid bodies and embedded appearance assets
   so dropping a design shows the model and what it is, not an "unknown blob". */

import { el, row, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { openZip } from './zip.js';

// docstruct.type / .subtype come through as kebab-case tokens; map the common
// ones to a clean label and fall back to a prettified form for the rest.
const DOC_TYPES = {
  'part-design': 'Part design',
  'assembly-design': 'Assembly',
  'drawing-design': 'Drawing',
  'sheet-metal': 'Sheet metal part',
  'cam-design': 'Manufacture (CAM)',
};
const SUBTYPES = {
  'part-standard': 'Standard part',
  'part-sheetmetal': 'Sheet metal',
  'assembly-standard': 'Standard assembly',
};
function prettify(s) {
  return String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// Pull readable strings out of the binary Manifest.dat (a mix of ASCII and
// UTF-16LE runs). Used only for the human "document version" token (e.g.
// "3-2-0-0") and description - the authoritative fields come from Properties.dat.
function manifestStrings(bytes) {
  if (!bytes) return [];
  const out = [];
  // ASCII runs
  let cur = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x20 && b < 0x7f) { cur += String.fromCharCode(b); }
    else { if (cur.length >= 4) out.push(cur); cur = ''; }
  }
  if (cur.length >= 4) out.push(cur);
  // UTF-16LE runs (char, 0x00 pairs)
  cur = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const lo = bytes[i], hi = bytes[i + 1];
    if (hi === 0 && lo >= 0x20 && lo < 0x7f) { cur += String.fromCharCode(lo); }
    else { if (cur.length >= 4) out.push(cur); cur = ''; }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

// Suffix-match an entry name anywhere in the tree (depth-agnostic so the same
// logic reads both a flat .f3d and the nested layout inside an .f3z archive).
function findEntries(zip, re) {
  return zip.entries.filter((e) => re.test(e.name) && e.uncompSize > 0);
}

export async function renderF3d(file, resultsEl) {
  resultsEl.hidden = false;   // the results container starts hidden (clearResultsUI)
  let zip;
  try {
    zip = await openZip(file, 96 * 1024 * 1024);
  } catch (_) { zip = null; }
  if (!zip || !zip.entries.length) {
    resultsEl.appendChild(errorCard('This does not look like a readable Fusion 360 design (no ZIP package found).'));
    resultsEl.appendChild(integrityCard(file));
    return;
  }

  // ---- document descriptor (Properties.dat - authoritative JSON) ----
  let docType = '', subType = '', structVer = '';
  const propEntry = zip.entries.find((e) => /(^|\/)Properties\.dat$/.test(e.name));
  if (propEntry) {
    try {
      const txt = await zip.text(propEntry.name);
      const json = JSON.parse((txt || '').replace(/^[^{]*/, ''));   // skip a leading length byte if present
      const ds = json && json.docstruct;
      if (ds) { docType = ds.type || ''; subType = ds.subtype || ''; structVer = ds.version || ''; }
    } catch (_) { /* fall back to manifest / generic below */ }
  }

  // ---- Fusion document version (Manifest.dat - best-effort string scan) ----
  let docVer = '';
  const manEntry = zip.entries.find((e) => /(^|\/)Manifest\.dat$/.test(e.name));
  if (manEntry) {
    try {
      const strs = manifestStrings(await zip.bytes(manEntry.name));
      const v = strs.find((s) => /^\d+-\d+-\d+-\d+$/.test(s));   // e.g. "3-2-0-0"
      if (v) docVer = v.replace(/-/g, '.');
    } catch (_) { /* ignore */ }
  }

  // ---- counts ----
  const bodies = findEntries(zip, /Breps\.BlobParts\/.*\.smb$/i).length;
  const appearances = findEntries(zip, /\.protein$/i).length;
  const meshes = findEntries(zip, /Fusion_mesh_\d+$/i).length;

  // ---- identity / readout card ----
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Autodesk Fusion 360 design'));
  const t = el('table', { class: 'anr-readout' });
  t.appendChild(row('Software', 'Autodesk Fusion 360'));
  const typeLabel = DOC_TYPES[docType] || (docType ? prettify(docType) : 'Fusion design');
  t.appendChild(row('Document type', typeLabel));
  if (subType) t.appendChild(row('Subtype', SUBTYPES[subType] || prettify(subType)));
  if (docVer) t.appendChild(row('Fusion document version', docVer));
  if (structVer) t.appendChild(row('Document structure', 'v' + structVer));
  if (bodies) t.appendChild(row('Solid bodies', String(bodies)));
  if (appearances) t.appendChild(row('Appearance assets', String(appearances)));
  t.appendChild(row('File size', fmtBytes(file.size)));
  card.appendChild(t);
  resultsEl.appendChild(card);

  // ---- preview (Fusion's own rendered thumbnail) - pick the largest PNG ----
  const previews = findEntries(zip, /Previews\/[^/]*\.png$/i).sort((a, b) => b.uncompSize - a.uncompSize);
  if (previews.length) {
    try {
      const bytes = await zip.bytes(previews[0].name);
      if (bytes && bytes.length) {
        const pv = el('div', { class: 'anr-card' });
        pv.appendChild(el('h3', {}, 'Preview'));
        pv.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px;' },
          'The thumbnail Fusion 360 rendered and saved inside the file.'));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        const img = el('img', {
          src: url, alt: 'Fusion 360 model preview', loading: 'lazy',
          style: 'max-width:100%; height:auto; border:1px solid var(--rule); background:var(--surface);',
        });
        img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
        pv.appendChild(img);
        resultsEl.appendChild(pv);
      }
    } catch (_) { /* no preview - the readout still stands */ }
  }

  // ---- honest note on the geometry ----
  const note = el('div', { class: 'anr-card' });
  note.appendChild(el('h3', {}, 'About the geometry'));
  note.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' },
    'A Fusion 360 design stores its solid model as Autodesk ShapeManager BREP data'
    + (bodies ? ' (' + bodies + ' solid ' + (bodies === 1 ? 'body' : 'bodies') + ' here)' : '')
    + ' and an internal display mesh - both proprietary and undocumented, so the editable'
    + ' 3D model cannot be rebuilt in the browser. To open it as a viewable mesh, export it'
    + ' from Fusion 360 as STL, OBJ, STEP or 3MF and drop that here for the full 3D viewer.'));
  resultsEl.appendChild(note);

  resultsEl.appendChild(integrityCard(file));
}
