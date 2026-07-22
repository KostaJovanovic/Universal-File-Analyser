/* Analyser - compare two files (side by side)
   ============================================================================
   Runs each file through its normal analyser, then merges the two results into a
   single view: shared field labels down the left, file A's values and file B's
   values in adjacent columns (Field | A | B). Metadata readout tables merge cell
   by cell; anything that isn't a readout (image previews, video players, hex
   dumps, histograms) falls back to a side-by-side A | B split within its card.

   How the merge stays faithful: each file is rendered into an off-screen staging
   container, then the real cells are MOVED (not cloned) into the merged table -
   so rich content, tooltips and deferred async (e.g. the SHA-256 that fills in
   its cell after hashing) all keep working. The renderers' fixed-section targets
   (#photoPreview, #photoResults, #audioResults, #videoPreview) and player-sync are
   neutralised by invoking media renderers with { inline: true }.

   Everything runs on-device; nothing is uploaded. renderCompare is handed
   { classify, routes } from app.js so it reuses the real classifyFile()/ROUTES. */

import { el, fmtBytes, sha256Hex, extraHashRows, crc32Hex, errorCard } from '../core/util.js';

// Renderers that need { inline: true } to keep their output inside the panel.
const MEDIA = new Set(['photo', 'audio', 'video']);

function stripText(a, b, typeA, typeB, sha) {
  const shaLabel = sha === 'pending' ? 'SHA-256 checking…'
    : sha === 'match' ? 'SHA-256 match (identical files)'
    : sha === 'differ' ? 'SHA-256 differ'
    : 'SHA-256 unavailable';
  return 'Size ' + fmtBytes(a.size) + ' / ' + fmtBytes(b.size)
    + '  ·  Type ' + typeA + ' / ' + typeB
    + '  ·  ' + shaLabel;
}

const headingText = (card) => {
  const h = card && (card.querySelector(':scope > h3') || card.querySelector('h3'));
  return h ? h.textContent.trim() : '';
};
const valTd = (tr) => tr && tr.querySelector('td');
const dashTd = () => el('td', { class: 'anr-cmp-absent' }, '-');
const textOf = (td) => (td ? td.textContent.replace(/\s+/g, ' ').trim() : null);

// Build one merged row. `aTd`/`bTd` are the real value cells (moved in) or null
// when that side has no such field; a missing side shows a dash and the row is
// always a difference. Rows are tagged .is-diff when the two values differ, so
// the "Show differences" toggle can fade the matching ones.
function mergeRow(th, aTd, bTd) {
  const aMissing = aTd == null, bMissing = bTd == null;
  const differ = aMissing || bMissing || textOf(aTd) !== textOf(bTd);
  const row = el('tr', differ ? { class: 'is-diff' } : {});
  row.appendChild(th);
  row.appendChild(aMissing ? dashTd() : aTd);
  row.appendChild(bMissing ? dashTd() : bTd);
  return row;
}

// Merge two .anr-readout tables into one Field | A | B table by moving the real
// label and value cells across. Rows align by label text; a field present on
// only one side shows a dash opposite. Non-labelled rows (e.g. the "show more
// hashes" control) are dropped from the merged view.
function mergeReadout(tA, tB) {
  const out = el('table', { class: 'anr-readout anr-cmp' });
  const bByLabel = new Map();
  if (tB) for (const tr of tB.rows) { const th = tr.querySelector('th'); if (th) bByLabel.set(th.textContent.trim(), tr); }
  const used = new Set();
  if (tA) for (const tr of tA.rows) {
    const th = tr.querySelector('th'); if (!th) continue;
    const label = th.textContent.trim();
    const bRow = bByLabel.get(label); if (bRow) used.add(label);
    out.appendChild(mergeRow(th, valTd(tr), bRow ? valTd(bRow) : null));
  }
  if (tB) for (const tr of tB.rows) {
    const th = tr.querySelector('th'); if (!th) continue;
    if (used.has(th.textContent.trim())) continue;
    out.appendChild(mergeRow(th, null, valTd(tr)));   // B-only field
  }
  return out;
}

function splitCols(aNodes, bNodes) {
  const col = (tag, nodes) => el('div', { class: 'anr-cmp-col' }, [el('div', { class: 'anr-cmp-col-tag' }, tag), ...nodes]);
  // A leading empty gutter matches the merged table's Field column, so the A|B
  // divide lands at the SAME x-position (63%) as it does in the readout tables -
  // the split no longer breaks at 50% while the tables break at 63%.
  return el('div', { class: 'anr-cmp-split' }, [el('div', { class: 'anr-cmp-gutter' }), col('A', aNodes), col('B', bNodes)]);
}

// The card's header node: a direct-child <h3>, or the direct child that WRAPS the
// h3 (some cards, e.g. the timestamp timeline, put the title and its [?] button in
// a flex row div rather than the plain h3help pattern). We MOVE the whole header so
// its [?] button stays beside the title at the card top - out of the overflow-
// scrolling split columns below, where its popup would be clipped ("stuck behind a
// scroll").
function headerNodeOf(card) {
  if (!card) return null;
  for (const n of card.children) {
    if (n.tagName === 'H3') return n;
    if (n.querySelector && n.querySelector('h3')) return n;
  }
  return null;
}
// Direct children of a card in document order, skipping the header node (moved
// separately) and any h3 [?] help panel (a sibling; wireInfoToggle pulls it back
// under its button on demand via a closure, so it needs no home in the merge).
function bodyNodes(card, header) {
  if (!card) return [];
  return [...card.children].filter((n) =>
    n !== header && !(n.classList && n.classList.contains('anr-info-panel')));
}
const nodeKind = (n) =>
  (n.matches && n.matches('table.anr-readout')) ? 'table'
    : (n.classList && n.classList.contains('anr-readout-section')) ? 'section'
      : 'rest';
const hasCanvas = (card) => !!(card && card.querySelector && card.querySelector('canvas'));

// "Show differences" fades matching readout rows via .is-diff, but the fuller media
// sections put a lot of content (forensics, edit history, container structure) in
// side-by-side A | B splits that carry no per-row diff tag - so the toggle used to
// do nothing to them. Tag each split whose two columns are textually identical with
// .anr-cmp-split-same so the toggle can fade it too. Visual splits (previews,
// players, spectrograms, waveforms - canvas/img/media) are left lit: two images or
// sounds can't be judged equal from their text. Re-run on each activation because
// some split content fills in asynchronously.
function tagSplitSameness(root) {
  const colText = (col) => [...col.children]
    .filter((c) => !(c.classList && c.classList.contains('anr-cmp-col-tag')))
    .map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim()).join('');
  for (const split of root.querySelectorAll('.anr-cmp-split')) {
    split.classList.remove('anr-cmp-split-same');
    if (split.querySelector('canvas, img, audio, video, svg')) continue;
    const cols = [...split.children].filter((c) => c.classList && c.classList.contains('anr-cmp-col'));
    if (cols.length >= 2 && colText(cols[0]) === colText(cols[1])) split.classList.add('anr-cmp-split-same');
  }
}

// Merge one matched card pair. Visualisation panels (spectrogram, waveform,
// histograms - anything with a <canvas>) are shown as two whole panels side by
// side: their stats fill in asynchronously and the canvas is the point, so
// cell-merging them only scrambles them. Every other card is walked in document
// ORDER - each readout table becomes Field | A | B in place, and the section
// sub-headings (Camera & lens, Exposure, ...) stay with the table they head
// instead of being flattened off to the side.
function mergeCard(cardA, cardB) {
  const card = el('div', { class: 'anr-card' });
  const headA = headerNodeOf(cardA), headB = headerNodeOf(cardB);
  const head = headA || headB;               // MOVE the whole header (title + wired [?])
  if (head) card.appendChild(head);

  if (hasCanvas(cardA) || hasCanvas(cardB)) {
    card.appendChild(splitCols(bodyNodes(cardA, headA), bodyNodes(cardB, headB)));
    return card;
  }

  const A = bodyNodes(cardA, headA), B = bodyNodes(cardB, headB);
  let i = 0, j = 0, restA = [], restB = [];
  const flushRest = () => {
    if (restA.length || restB.length) card.appendChild(splitCols(restA, restB));
    restA = []; restB = [];
  };
  while (i < A.length || j < B.length) {
    const a = A[i], b = B[j];
    const ka = a ? nodeKind(a) : null, kb = b ? nodeKind(b) : null;
    if (ka === 'table' && kb === 'table') { flushRest(); card.appendChild(mergeReadout(a, b)); i++; j++; }
    else if (ka === 'section' && kb === 'section') { flushRest(); card.appendChild(a); i++; j++; }
    else if (ka === 'table') { flushRest(); card.appendChild(mergeReadout(a, null)); i++; }
    else if (kb === 'table') { flushRest(); card.appendChild(mergeReadout(null, b)); j++; }
    else if (ka === 'section') { flushRest(); card.appendChild(a); i++; }
    else if (kb === 'section') { flushRest(); card.appendChild(b); j++; }
    else { if (a) { restA.push(a); i++; } if (b) { restB.push(b); j++; } }
  }
  flushRest();
  return card;
}

const isCard = (n) => n && n.classList && n.classList.contains('anr-card');
const ctaOf = (n) => (n && n.querySelector ? n.querySelector('.anr-btn--cta') : null);
// A video renderer's interactive sub-slot: a wrapper holding a prompt card with a
// call-to-action (Analyse audio / Analyse frame). These get ONE central button.
const isInteractiveSub = (n) => n && n.classList && n.classList.contains('anr-cmp-subslot') && !!ctaOf(n);
const subHeading = (sub) => { const h = sub && sub.querySelector('h3'); return h ? h.textContent.trim() : ''; };

// One shared button that runs BOTH files' analysis: it clicks each file's own
// (hidden) prompt button, which renders that file's result into its own container
// - the two containers sit side by side below the button.
function mergeInteractive(aSub, bSub) {
  const card = el('div', { class: 'anr-card' });
  const heading = subHeading(aSub) || subHeading(bSub);
  if (heading) card.appendChild(el('h3', {}, heading));
  const src = aSub || bSub;
  const descEl = src.querySelector('.anr-info, .anr-hint, p');
  if (descEl) card.appendChild(el('p', { class: 'anr-info' }, descEl.textContent));

  const aBtn = ctaOf(aSub), bBtn = ctaOf(bSub);
  // Hide each file's own prompt card; the central button drives them.
  [aSub, bSub].forEach((s) => { const p = s && s.querySelector('.anr-card'); if (p) p.style.display = 'none'; });
  const label = ((aBtn || bBtn).textContent || 'Analyse').trim();
  const central = el('button', { type: 'button', class: 'anr-btn anr-btn--cta' }, label + ' (both files)');
  central.addEventListener('click', () => {
    if (aBtn) aBtn.click();
    if (bBtn) bBtn.click();
    central.remove();
  });
  card.appendChild(el('div', { class: 'anr-btn-row' }, [central]));
  card.appendChild(splitCols(aSub ? [aSub] : [], bSub ? [bSub] : []));
  return card;
}

// Merge two lists of blocks into one view. Content cards pair by heading (so the
// same section - Integrity, EXIF, Player - lines up); a card on only one side is
// still shown with the other file's column dashed, so two DIFFERENT types show
// every field from both. Interactive prompts (Analyse audio / frame) collapse to a
// single central button. Everything else (previews, players, hex, histograms) is
// collected from BOTH files into one side-by-side A | B split, moved whole.
// A non-card wrapper that itself holds cards (a video's sub-analysis slot, the
// browse-as-archive tree's container). We recurse INTO these so their inner cards
// merge Field | A | B too, instead of the whole wrapper dropping to a 50/50 split.
const isContainer = (n) => n && n.nodeType === 1 && !isCard(n) && !isInteractiveSub(n)
  && typeof n.querySelector === 'function' && !!n.querySelector('.anr-card');

function mergePanels(aBlocks, bBlocks, mount) {
  const partition = (nodes) => {
    const inter = [], cards = [], containers = [], rest = [];
    for (const n of nodes) {
      if (isInteractiveSub(n)) inter.push(n);
      else if (isCard(n)) cards.push(n);
      else if (isContainer(n)) containers.push(n);
      else rest.push(n);
    }
    return { inter, cards, containers, rest };
  };
  const A = partition(aBlocks);
  const B = partition(bBlocks);

  // 1. Content cards, paired by heading.
  const byHeading = new Map();
  for (const c of B.cards) { const h = headingText(c); if (!byHeading.has(h)) byHeading.set(h, []); byHeading.get(h).push(c); }
  const usedB = new Set();
  for (const a of A.cards) {
    const list = byHeading.get(headingText(a));
    let m = null;
    if (list) for (const c of list) if (!usedB.has(c)) { m = c; break; }
    if (m) usedB.add(m);
    mount.appendChild(mergeCard(a, m));
  }
  for (const b of B.cards) if (!usedB.has(b)) mount.appendChild(mergeCard(null, b));

  // 2. Interactive prompts -> one central button each, paired by heading.
  const subByHeading = new Map();
  for (const s of B.inter) { const h = subHeading(s); if (!subByHeading.has(h)) subByHeading.set(h, []); subByHeading.get(h).push(s); }
  const usedS = new Set();
  for (const a of A.inter) {
    const list = subByHeading.get(subHeading(a));
    let m = null;
    if (list) for (const s of list) if (!usedS.has(s)) { m = s; break; }
    if (m) usedS.add(m);
    mount.appendChild(mergeInteractive(a, m));
  }
  for (const s of B.inter) if (!usedS.has(s)) mount.appendChild(mergeInteractive(null, s));

  // 3. Containers (browse-as-archive tree, video sub-analysis): recurse so their
  //    inner cards merge Field | A | B too. Paired by document order (there is
  //    normally exactly one on each side within a given bucket).
  const nc = Math.max(A.containers.length, B.containers.length);
  for (let i = 0; i < nc; i++) {
    const ca = A.containers[i] || null;
    const cb = B.containers[i] || null;
    const wrap = el('div', { class: 'anr-cmp-subgroup' });
    mergePanels(ca ? [...ca.children] : [], cb ? [...cb.children] : [], wrap);
    mount.appendChild(wrap);
  }

  // 4. Everything else (previews, players, hex, file trees) side by side.
  if (A.rest.length || B.rest.length) mount.appendChild(splitCols(A.rest, B.rest));
}

// The full hash set (CRC-32 / MD5 / SHA-1 / SHA-512) normally hides behind a "show
// more" button that the merge can't carry across. Compute it for both files and
// append the rows straight into whichever merged table holds the SHA-256 row - the
// Integrity card for most formats, but e.g. a proprietary format's main metadata
// table otherwise (an APK has no separate Integrity card).
// Over the 50 MB limit the single-file page uses, the cryptographic hashes (MD5/
// SHA-1/SHA-512, each a full-file digest) stay deferred like SHA-256 itself - but
// CRC-32 is a single cheap streaming pass, so it is always computed automatically,
// even for large files.
const HASH_AUTO_LIMIT = 50 * 1024 * 1024;
const CRC_DESC = 'CRC-32 is a fast, non-cryptographic checksum - the same one ZIP, PNG and gzip embed, and what SFV checksum files store. It reliably catches accidental corruption, but unlike the hashes below it is not collision-resistant, so it is not proof against deliberate tampering.';
async function crc32Of(file) { return crc32Hex(new Uint8Array(await file.arrayBuffer())); }
async function appendHashExtras(mergedRoot, fileA, fileB, shaMatch) {
  let table = null, shaRow = null;
  for (const t of mergedRoot.querySelectorAll('table.anr-readout.anr-cmp')) {
    for (const tr of t.rows) {
      const th = tr.querySelector('th');
      if (th && /^sha-?256\b/i.test(th.textContent.trim())) { table = t; shaRow = tr; break; }
    }
    if (table) break;
  }
  if (!table) return;
  // The SHA-256 row is built during the merge, but its A/B value cells fill in
  // asynchronously - so its .is-diff tag was decided from possibly-empty cells and
  // can be wrong (identical files mis-tagged as differing, or vice versa). Override
  // it with the authoritative comparison once it resolves, so "Show differences"
  // fades a matching SHA-256 row and keeps a genuinely differing one lit.
  if (shaRow && shaMatch) {
    shaMatch.then((m) => {
      if (m === 'match') shaRow.classList.remove('is-diff');
      else if (m === 'differ') shaRow.classList.add('is-diff');
    });
  }
  const heavyOk = fileA.size <= HASH_AUTO_LIMIT && fileB.size <= HASH_AUTO_LIMIT;
  try {
    let ra, rb;
    if (heavyOk) {
      [ra, rb] = await Promise.all([extraHashRows(fileA), extraHashRows(fileB)]);
    } else {
      // At least one file is over the limit: CRC-32 only.
      const [ca, cb] = await Promise.all([crc32Of(fileA), crc32Of(fileB)]);
      ra = [['CRC-32', ca, CRC_DESC]]; rb = [['CRC-32', cb]];
    }
    const bMap = new Map(rb.map(([label, hex]) => [label, hex]));
    for (const [label, hex] of ra) {
      const bHex = bMap.has(label) ? bMap.get(label) : null;
      const differ = bHex == null || hex !== bHex;
      const row = el('tr', differ ? { class: 'is-diff' } : {});
      row.appendChild(el('th', {}, label));
      row.appendChild(el('td', {}, hex));
      row.appendChild(bHex == null ? dashTd() : el('td', {}, bHex));
      table.appendChild(row);
    }
  } catch (_) { /* leave the SHA-256 row as-is */ }
}

// Which layout section a file's blocks belong to, mirroring the normal page.
const mainKeyOf = (kind) => (kind === 'photo' ? 'photo' : kind === 'audio' ? 'sound' : kind === 'video' ? 'video' : 'file');
const SECTION_TITLE = { photo: 'Photo', sound: 'Sound', video: 'Video', file: 'File' };

// Sort a staging tree's blocks into section buckets. A file's own cards go to its
// main section; a video's extracted-audio sub-slot goes to Sound and its grabbed
// frame to Photo (tagged by video.js), exactly like the normal single-file page.
function bucketize(staging, mainKey) {
  const buckets = { photo: [], sound: [], video: [], file: [] };
  for (const n of staging.children) {
    let key = mainKey;
    if (n.classList) {
      if (n.classList.contains('anr-cmp-sub-audio')) key = 'sound';
      else if (n.classList.contains('anr-cmp-sub-photo')) key = 'photo';
    }
    buckets[key].push(n);
  }
  return buckets;
}

// A titled section wrapper (numbered kicker like the normal page). Returns the
// element and the inner body the merge writes into.
function buildSection(num, title) {
  const head = el('div', { class: 'anr-cmp-section-head' }, [
    num ? el('span', { class: 'section-num' }, num) : null,
    el('span', { class: 'section-kicker' }, title),
  ].filter(Boolean));
  const body = el('div', { class: 'anr-cmp-section-body' });
  return { el: el('section', { class: 'anr-cmp-section' }, [head, body]), body };
}

export async function renderCompare(fileA, fileB, resultsEl, deps = {}) {
  const classify = deps.classify || (() => 'unknown');
  const routes = deps.routes || {};

  resultsEl.innerHTML = '';
  resultsEl.classList.remove('anr-diff-only');

  // Resolve each file's true kind ONCE (classify may be async - it sniffs the
  // bytes to route a PDF/ZIP/image the same way the normal analyser does). Reused
  // for the type strip, the renderer routing, and the section bucketing below.
  const [kindA, kindB] = await Promise.all([
    Promise.resolve(classify(fileA)),
    Promise.resolve(classify(fileB)),
  ]);

  // Identity strip (finalised once the hashes resolve, independent of the renders).
  const strip = el('div', { class: 'anr-info anr-cmp-strip' }, stripText(fileA, fileB, kindA, kindB, 'pending'));
  resultsEl.appendChild(strip);

  // "Show differences": fade everything A and B share, so only what differs stays
  // lit - matching readout rows (tagged .is-diff at merge time) AND matching
  // side-by-side split blocks (the forensics/details content in the fuller media
  // sections), which is re-evaluated on each activation so async-filled content
  // (hashes, late panels) is judged fairly. See .anr-diff-only in analyser.css.
  const diffBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show differences');
  diffBtn.addEventListener('click', () => {
    const on = !resultsEl.classList.contains('anr-diff-only');
    if (on) tagSplitSameness(resultsEl);
    resultsEl.classList.toggle('anr-diff-only', on);
    diffBtn.classList.toggle('is-active', on);
    diffBtn.textContent = on ? 'Show everything' : 'Show differences';
  });
  // Sticky control bar, laid out on the same Field | A | B grid as the readouts so
  // each file's name sits directly above its own analysis column and stays there
  // while the long comparison scrolls. The "Show differences" toggle takes the
  // field-label column on the left.
  resultsEl.appendChild(el('div', { class: 'anr-cmp-controls' }, [
    el('div', { class: 'anr-cmp-controls-btn' }, [diffBtn]),
    el('div', { class: 'anr-cmp-fname anr-cmp-fname-a', title: fileA.name }, 'A - ' + fileA.name),
    el('div', { class: 'anr-cmp-fname anr-cmp-fname-b', title: fileB.name }, 'B - ' + fileB.name),
  ]));
  // The authoritative full-file SHA-256 comparison, shared by the identity strip
  // AND the Integrity SHA-256 row re-tag in appendHashExtras: that row's value
  // cells fill in asynchronously, so its merge-time diff check can race (one side
  // hashed, the other still pending) and mis-tag two identical files as differing.
  const shaMatch = Promise.all([sha256Hex(fileA), sha256Hex(fileB)]).then(
    ([ha, hb]) => (ha && hb ? (ha === hb ? 'match' : 'differ') : 'error'),
    () => 'error'
  );
  shaMatch.then((sha) => {
    strip.textContent = stripText(fileA, fileB, kindA, kindB, sha);
    strip.classList.toggle('anr-cmp-same', sha === 'match');
  });

  // Render each file into its own off-screen staging container (laid out, so
  // canvases/players work), then merge into the visible view.
  const stagingA = el('div', { class: 'anr-results anr-cmp-staging' });
  const stagingB = el('div', { class: 'anr-results anr-cmp-staging' });
  resultsEl.appendChild(stagingA);
  resultsEl.appendChild(stagingB);

  async function renderInto(file, staging, kind) {
    const route = routes[kind] || routes.unknown;
    if (!route || typeof route.render !== 'function') {
      staging.appendChild(errorCard('No analyser is available for this file type.'));
      return;
    }
    // Photo/video metadata (EXIF/IPTC/XMP/GPS) comes from the global exifr, which
    // the normal pipeline loads before rendering. Without this, exifr is undefined
    // and every metadata-derived card (Metadata, AI detection, GPS) silently drops.
    if ((kind === 'photo' || kind === 'video') && typeof deps.ensureExifr === 'function') {
      try { await deps.ensureExifr(); } catch (_) {}
    }
    // Media renderers get { inline: true } (isolated DOM targets) plus
    // { compare: true }, which tells them this is a full analysis panel - not a
    // trimmed extracted-sub-image render (cover art / a video frame) - so they emit
    // the same forensics, telemetry, animated-frame and structure cards the normal
    // single-file page does. A PDF gets a single-page preview up front (the full
    // page set is a lot to show twice).
    let opts;
    if (MEDIA.has(kind)) opts = { inline: true, compare: true };
    else if (kind === 'pdf') opts = { previewPages: 1 };
    try { await Promise.resolve(route.render(file, staging, opts)); }
    catch (e) { staging.appendChild(errorCard('Could not analyse ' + file.name + ': ' + (e && e.message ? e.message : e))); }
    // The same forensic + browse-as-archive extras the normal single-file pipeline
    // appends around the core renderer (e.g. an APK's full file tree), so compare
    // matches its depth. Best-effort; never blocks the merge on a failure.
    if (typeof deps.renderExtras === 'function') {
      try { await deps.renderExtras(file, staging, kind); } catch (_) {}
    }
  }

  // Sequentially: keeps the video render context (see video.js) correct, and the
  // media renderers' abort controllers isolated so neither cancels the other.
  // Suppress the single-file "Limited readout" suggest popup for the duration -
  // an unrecognised file here shouldn't nudge as if it were a normal analysis.
  const prevSuppress = window._anrSuppressSuggest;
  window._anrSuppressSuggest = true;
  try {
    await renderInto(fileA, stagingA, kindA);
    await renderInto(fileB, stagingB, kindB);
  } finally {
    window._anrSuppressSuggest = prevSuppress;
  }

  // The A/B filenames live in the sticky control bar above (so they stay pinned
  // over their columns as the comparison scrolls) - no separate in-flow legend.
  const merged = el('div', { class: 'anr-cmp-merged' });

  // Sort both files' blocks into the normal page's sections, then merge each
  // section on its own. Display order puts each file's main type first, then the
  // remaining media sections, then the generic File bucket.
  const bucketsA = bucketize(stagingA, mainKeyOf(kindA));
  const bucketsB = bucketize(stagingB, mainKeyOf(kindB));
  const order = [];
  const add = (k) => { if (!order.includes(k) && (bucketsA[k].length || bucketsB[k].length)) order.push(k); };
  add(mainKeyOf(kindA));
  add(mainKeyOf(kindB));
  ['photo', 'sound', 'video', 'file'].forEach(add);

  let num = 0;
  for (const key of order) {
    if (key === 'file') {                       // generic bucket - no section chrome, like the normal page
      mergePanels(bucketsA.file, bucketsB.file, merged);
      continue;
    }
    num += 1;
    const section = buildSection(String(num).padStart(2, '0'), SECTION_TITLE[key]);
    mergePanels(bucketsA[key], bucketsB[key], section.body);
    merged.appendChild(section.el);
  }
  // Integrity above all else: pull the merged Integrity card to the very top,
  // whichever section it landed in - the file's fingerprint is the first thing to
  // check when comparing two files.
  const integ = [...merged.querySelectorAll('.anr-card')].find((c) => headingText(c) === 'Integrity');
  if (integ) merged.insertBefore(integ, merged.firstChild);

  resultsEl.appendChild(merged);

  // Staging nodes we needed have been moved into `merged`; drop the shells.
  stagingA.remove();
  stagingB.remove();

  // Fill in the full hash set (CRC-32/MD5/SHA-1/SHA-512) for the Integrity card,
  // and authoritatively re-tag the deferred SHA-256 row now the real result is known.
  appendHashExtras(merged, fileA, fileB, shaMatch);
}
