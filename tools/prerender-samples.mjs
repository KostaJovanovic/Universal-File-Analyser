/* Prerender the /samples gallery from the files in the samples/ directory.
   ============================================================================
   WHY: the samples page shows a clickable gallery of example files so a visitor
   can watch Analyser work without dropping their own file. The gallery is driven
   purely by the contents of samples/ - drop a file in, re-run this, and a card
   appears - so the page never needs hand-editing.

   HOW: scans samples/, derives each file's label + caption from the format
   catalog (the single source of truth in assets/js/core/formats.js), with an
   optional caption override in tools/sample-content.mjs. Native-decodable images
   get a real thumbnail; everything else gets an extension tile. It rewrites only
   the region between the SAMPLES markers in samples.html - everything else in
   that file is hand-authored.

   RUN: `node tools/prerender-samples.mjs` (save.bat runs it on every commit,
   before `git add`, so the gallery can never drift from the folder).
   ============================================================================ */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { esc, escAttr } from './prerender-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'samples.html');
const SAMPLES_DIR = join(ROOT, 'samples');

const START = '<!-- SAMPLES:START -->';
const END = '<!-- SAMPLES:END -->';

// pathToFileURL: a bare Windows path (C:\…) is not a valid ESM specifier.
const { catalogGrouped } = await import(
  pathToFileURL(join(ROOT, 'assets/js/core/formats.js')).href
);

// Optional caption overrides, keyed by filename. Tolerate the file being absent.
let SAMPLE_PAGES = {};
try {
  ({ SAMPLE_PAGES } = await import(pathToFileURL(join(ROOT, 'tools/sample-content.mjs')).href));
  SAMPLE_PAGES = SAMPLE_PAGES || {};
} catch (_) { SAMPLE_PAGES = {}; }

// Build a lookup: lowercase ext -> { label, desc, catKey, catLabel, catOrder }.
// catOrder keeps the gallery grouped in the same domain order as the catalog.
const groups = catalogGrouped();
const extInfo = new Map();
groups.forEach((g, order) => {
  for (const r of g.rows) {
    for (const tok of r.exts) {
      const k = tok.toLowerCase();
      if (!extInfo.has(k)) {
        extInfo.set(k, { label: r.label, desc: r.desc, catKey: g.key, catLabel: g.label, catOrder: order });
      }
    }
  }
});

const extOf = (name) => {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
};

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function chip(name, bytes) {
  const ext = extOf(name);
  const info = extInfo.get(ext) || { label: ext ? ext.toUpperCase() : 'File', desc: '', catKey: 'system', catLabel: 'System', catOrder: 999 };
  const caption = SAMPLE_PAGES[name] || info.desc || '';
  const href = '/samples/' + name.split('/').map(encodeURIComponent).join('/');
  // Everything (label, caption, size) lives in the tooltip - the chip itself just
  // shows the filename so the buttons stay small and flow with the page width.
  const title = `${info.label}${caption ? ' - ' + caption : ''} (${humanSize(bytes)})`;
  return `        <button type="button" class="sample-chip" data-sample="${escAttr(href)}" data-name="${escAttr(name)}" data-cat="${escAttr(info.catKey)}" title="${escAttr(title)}">${esc(name)}</button>`;
}

// Gather files (skip dotfiles and _-prefixed meta files, and any sub-directories).
let files = [];
if (existsSync(SAMPLES_DIR)) {
  files = readdirSync(SAMPLES_DIR)
    .filter((n) => n[0] !== '.' && n[0] !== '_')
    .filter((n) => {
      try { return statSync(join(SAMPLES_DIR, n)).isFile(); } catch (_) { return false; }
    });
}

let block;
if (files.length) {
  // Group the samples into the same domain categories the formats page uses
  // (Images, Audio, Video, 3D / CAD, ...), in the catalog's own order. Each group
  // becomes a titled section with its own row of chips.
  const groupsMap = new Map(); // catKey -> { key, label, order, names: [] }
  for (const name of files) {
    const info = extInfo.get(extOf(name)) || { catKey: 'system', catLabel: 'System', catOrder: 999 };
    let g = groupsMap.get(info.catKey);
    if (!g) { g = { key: info.catKey, label: info.catLabel, order: info.catOrder, names: [] }; groupsMap.set(info.catKey, g); }
    g.names.push(name);
  }
  const ordered = [...groupsMap.values()].sort((a, b) => a.order - b.order);
  block = ordered.map((g) => {
    const chips = g.names
      .sort((a, b) => a.localeCompare(b))
      .map((n) => chip(n, statSync(join(SAMPLES_DIR, n)).size))
      .join('\n');
    const n = g.names.length;
    return `        <div class="sample-group" data-cat="${escAttr(g.key)}">
          <h3 class="sample-group-label">${esc(g.label)}<span class="sample-group-count">${n} sample${n === 1 ? '' : 's'}</span></h3>
          <div class="sample-gallery">
${chips}
          </div>
        </div>`;
  }).join('\n');
} else {
  block = '        <p class="anr-hint">No samples yet. Drop files into the <code>samples/</code> folder and re-run <code>tools/prerender-samples.mjs</code> (or <code>save.bat</code>).</p>';
}

let html = readFileSync(PAGE, 'utf8');
const region = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!region.test(html)) {
  console.error(`prerender-samples: markers ${START} … ${END} not found in samples.html`);
  process.exit(1);
}
html = html.replace(region, `${START}\n${block}\n          ${END}`);
writeFileSync(PAGE, html);
console.log(`prerender-samples: ${files.length} sample(s) -> samples.html`);
