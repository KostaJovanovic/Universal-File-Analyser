/* Prerender the standalone /formats page to STATIC HTML.
   ============================================================================
   WHY: about.html's in-app format list and the overlay are built client-side
   (renderAboutFormats / renderFmtOverlay), so crawlers that don't run JS see
   nothing - and that list is the whole long-tail SEO play ("how to open a .X
   file"). This script bakes the catalog into formats.html as real markup, so
   the content (and the #fmt-… / #ext-… deep-link anchors) exist without JS.

   HOW: reads the DOM-free catalogGrouped() from the single source of truth
   (assets/js/core/formats.js) and emits the SAME markup fmtItem() produces, so
   the existing global .fmt-item / .fmt-section-label CSS styles it unchanged.
   It rewrites only the region between the FORMATS markers in formats.html and
   stamps the exact format count between the FMTCOUNT markers - everything else
   in that file is hand-authored.

   RUN: `node tools/prerender-formats.mjs` (save.bat runs it on every commit,
   before `git add`, so the static page can never drift from the catalog).
   ============================================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { esc, escAttr, buildFullKeys, makeHrefOf } from './prerender-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'formats.html');
const SITE = 'https://lab.valjdakosta.com';

// pathToFileURL: a bare Windows path (C:\…) is not a valid ESM specifier.
const { catalogGrouped, formatCount } = await import(
  pathToFileURL(join(ROOT, 'assets/js/core/formats.js')).href
);

// Which extensions live in at least one full-analysis row. Their landing pages
// sit at /formats/<ext>; identification-only extensions sit at
// /formats/id/<ext> (same routing as tools/prerender-format-pages.mjs, which
// generates the pages - an ext in both a full and an id row gets the full page).
const fullKeys = buildFullKeys(catalogGrouped());
const guideHref = makeHrefOf(fullKeys);

// One <details class="fmt-item"> - byte-for-byte the shape fmtItem() builds in
// formats.js, so the shared CSS renders it identically to the in-app overlay.
function item(r, catKey) {
  const isFull = r.depth === 'full';
  const badgeCls = isFull ? 'is-full' : 'is-id';
  const badgeTitle = isFull
    ? 'Opens in a viewer with deep metadata'
    : 'Identified + header metadata';
  const exts = r.exts
    .map((t) => `<span class="fmt-item-ext" id="ext-${escAttr(t.toLowerCase())}">${esc(t)}</span>`)
    .join(' ');
  // Every extension has a landing page; link them from inside the description so
  // the hub feeds the pages internal links. (Links go in the body, not the
  // <summary>, to avoid interactive content in a toggle.)
  const guides = `\n          <p class="fmt-item-guides">Per-format guides: ${r.exts.map((t) => `<a href="${escAttr(guideHref(t))}">.${esc(t)}</a>`).join(' &middot; ')}</p>`;
  return `        <details class="fmt-item" id="fmt-${escAttr(r.slug)}" data-tags="${escAttr(r.tags)}" data-cat="${escAttr(catKey)}">
          <summary class="fmt-item-summary">
            <div class="fmt-item-head">
              <span class="fmt-item-label">${esc(r.label)}</span>
              <span class="fmt-item-exts">${exts}</span>
            </div>
            <span class="fmt-item-badge ${badgeCls}" title="${escAttr(badgeTitle)}">${isFull ? 'Full' : 'ID'}</span>
          </summary>
          <div class="fmt-item-desc">${esc(r.desc)}</div>${guides}
        </details>`;
}

function group(g) {
  const items = g.rows.map((r) => item(r, g.key)).join('\n');
  return `      <p class="fmt-section-label" data-cat-head="${escAttr(g.key)}">${esc(g.label)}<span class="fmt-section-note">${g.count} formats</span></p>
      <div class="fmt-list" data-cat-list="${escAttr(g.key)}">
${items}
      </div>`;
}

const groups = catalogGrouped();
const count = formatCount();
const block = groups.map(group).join('\n\n');

let html = readFileSync(PAGE, 'utf8');

const START = '<!-- FORMATS:START -->';
const END = '<!-- FORMATS:END -->';
const region = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!region.test(html)) {
  console.error(`prerender-formats: markers ${START} … ${END} not found in formats.html`);
  process.exit(1);
}
html = html.replace(region, `${START}\n${block}\n      ${END}`);

// Stamp the exact format count wherever it is fenced for repeatable replacement.
html = html.replace(
  /<!--FMTCOUNT-->[\s\S]*?<!--\/FMTCOUNT-->/g,
  `<!--FMTCOUNT-->${count}<!--/FMTCOUNT-->`
);

// CollectionPage + ItemList structured data: marks /formats as a catalogue of
// file-type guides and enumerates the categories. Kept to one ListItem per
// category (not per format) so the JSON-LD stays light. Stamped between the
// ITEMLIST markers in the hand-authored <head>.
const itemList = {
  '@context': 'https://schema.org', '@type': 'CollectionPage',
  name: 'Supported file types - Analyser',
  url: `${SITE}/formats`,
  description: `Every file type Analyser can open and inspect online in your browser - ${count} formats across ${groups.length} categories, free and with nothing uploaded.`,
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: groups.length,
    itemListElement: groups.map((g, i) => ({
      '@type': 'ListItem', position: i + 1, name: `${g.label} (${g.count} formats)`,
    })),
  },
};
html = html.replace(
  /<!--ITEMLIST:START-->[\s\S]*?<!--\/ITEMLIST-->/,
  `<!--ITEMLIST:START-->${JSON.stringify(itemList)}<!--/ITEMLIST-->`
);

writeFileSync(PAGE, html);
const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
console.log(`prerender-formats: ${count} formats, ${totalRows} rows across ${groups.length} categories -> formats.html`);
