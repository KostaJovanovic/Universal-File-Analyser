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
import { esc, escAttr, DEPTH_BADGE } from './prerender-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'samples.html');
const SAMPLES_DIR = join(ROOT, 'samples');

const START = '<!-- SAMPLES:START -->';
const END = '<!-- SAMPLES:END -->';

// pathToFileURL: a bare Windows path (C:\…) is not a valid ESM specifier.
const { catalogGrouped, EXT_VARIANTS } = await import(
  pathToFileURL(join(ROOT, 'assets/js/core/formats.js')).href
);

// Optional caption overrides, keyed by filename. Tolerate the file being absent.
let SAMPLE_PAGES = {};
try {
  ({ SAMPLE_PAGES } = await import(pathToFileURL(join(ROOT, 'tools/sample-content.mjs')).href));
  SAMPLE_PAGES = SAMPLE_PAGES || {};
} catch (_) { SAMPLE_PAGES = {}; }

// Per-extension "what is a .X file" blurbs - the same one/two-sentence copy the
// /formats/<ext> landing pages use. Keyed by lowercase ext; the hover popup
// prefers these over the catalog desc (which describes what Analyser does).
let EXT_PAGES = {};
try {
  ({ EXT_PAGES } = await import(pathToFileURL(join(ROOT, 'tools/format-page-content.mjs')).href));
  EXT_PAGES = EXT_PAGES || {};
} catch (_) { EXT_PAGES = {}; }

// Build a lookup: lowercase ext -> { label, desc, catKey, catLabel, catOrder }.
// catOrder keeps the gallery grouped in the same domain order as the catalog.
const groups = catalogGrouped();
const extInfo = new Map();
groups.forEach((g, order) => {
  for (const r of g.rows) {
    for (const tok of r.exts) {
      const k = tok.toLowerCase();
      if (!extInfo.has(k)) {
        extInfo.set(k, { label: r.label, desc: r.desc, depth: r.depth, catKey: g.key, catLabel: g.label, catOrder: order });
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
  const info = extInfo.get(ext) || { label: ext ? ext.toUpperCase() : 'File', desc: '', depth: 'id', catKey: 'system', catLabel: 'System', catOrder: 999 };
  const caption = SAMPLE_PAGES[name] || info.desc || '';
  const href = '/samples/' + name.split('/').map(encodeURIComponent).join('/');
  // The square chip shows the extension as a big tile (top three quarters) over
  // the filename (bottom quarter); the longer the extension the smaller it is
  // drawn, so it always fits. The hover popup (wired in app.js) reads the
  // label / ext / size / blurb from the data-* attributes below; aria-label keeps
  // the full name + type available to assistive tech.
  const size = humanSize(bytes);
  const aria = `${info.label} - ${name} (${size})`;
  // Popup blurb: prefer the per-extension "what is a .X file" line (one or two
  // sentences, /formats-page style). For ambiguous extensions (one ext, several
  // unrelated formats - e.g. .cube is a colour LUT OR a Gaussian grid) the single
  // EXT_PAGES blurb can name the wrong variant for this sample, so use the
  // EXT_VARIANTS summary (which names both) instead. Catalog caption's first
  // sentence is the last-ditch fallback.
  const variant = EXT_VARIANTS && EXT_VARIANTS[ext];
  const catSentence = caption ? (caption.match(/^.*?[.!?](?=\s|$)/) || [caption])[0].trim() : '';
  const shortDesc = variant
    ? (variant.summary || catSentence)
    : ((EXT_PAGES[ext] && EXT_PAGES[ext].blurb) || catSentence);
  const tile = '.' + (ext || 'file').toUpperCase();
  // Size by the extension length (ignore the leading dot) so the dot never tips
  // a short ext into a smaller tier.
  const len = (ext || 'file').length;
  const sizeMod = len >= 8 ? ' sample-thumb--xlong'
    : len >= 6 ? ' sample-thumb--long'
      : len >= 4 ? ' sample-thumb--mid' : '';
  // The visible label drops the extension (the thumbnail tile already shows it);
  // data-name keeps the full filename so the click handler loads the right file.
  const display = name.replace(/\.[^.]+$/, '') || name;
  // Depth tag in the thumbnail's top-right corner - only for the Partial and ID
  // tiers (matching the /formats list badge), to flag the samples that aren't read
  // in full. Full-analysis samples carry no tag, since that is the default.
  const dm = DEPTH_BADGE[info.depth];
  const depthTag = (dm && info.depth !== 'full')
    ? `<span class="sample-depth ${dm.cls}" title="${escAttr(dm.title)}">${dm.label}</span>`
    : '';
  return `        <button type="button" class="sample-chip" data-sample="${escAttr(href)}" data-name="${escAttr(name)}" data-cat="${escAttr(info.catKey)}" data-label="${escAttr(info.label)}" data-ext="${escAttr(tile)}" data-size="${escAttr(size)}" data-desc="${escAttr(shortDesc)}" aria-label="${escAttr(aria)}">${depthTag}<span class="sample-thumb${sizeMod}" aria-hidden="true">${esc(tile)}</span><span class="sample-name"><span>${esc(display)}</span></span></button>`;
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

// Sort order keyed on the catalog row label (not the broad category): the
// 'Photo'/'RAW photo' rows first, then 'Sound', then 'Video', then everything
// else; alphabetical (case-insensitive) by filename within each bucket.
const bucketOf = (name) => {
  const label = (extInfo.get(extOf(name)) || {}).label;
  if (label === 'Photo' || label === 'RAW photo') return 0;
  if (label === 'Sound') return 1;
  if (label === 'Video') return 2;
  return 3;
};

let block;
if (files.length) {
  // One flat gallery - no per-category grouping or headings. Within each bucket,
  // sort alphabetically by extension (filename as the tie-breaker).
  const chips = files
    .sort((a, b) => bucketOf(a) - bucketOf(b)
      || extOf(a).localeCompare(extOf(b))
      || a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((n) => chip(n, statSync(join(SAMPLES_DIR, n)).size))
    .join('\n');
  block = `        <div class="sample-gallery">
${chips}
        </div>`;
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
