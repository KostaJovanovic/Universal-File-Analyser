/* Analyser - git object viewer
   Opens git repository objects with no server and no git binary:
   - loose objects (.git/objects/ab/cdef...): zlib-compressed
     "<type> <size>\0<payload>", inflated here with the browser's
     DecompressionStream (no library), then parsed by type - commit/tag text,
     tree entry listing, or a blob handed back to the main analyser.
   - pack files (.pack) and pack indexes (.idx): header + object count.
   Detection is by content (loose objects are extensionless) - see
   sniffGitObject, called from handleFile()'s magic-byte sniff. */

import { el, row, fmtBytes } from '../core/util.js';

const TYPES = new Set(['blob', 'tree', 'commit', 'tag']);

function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function hasInflate() { return typeof DecompressionStream !== 'undefined'; }

// Inflate a whole zlib blob to bytes.
async function inflateAll(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Inflate at most maxOut decompressed bytes, then stop - so peeking a huge blob's
// header doesn't decompress the whole thing. A truncated input tail is ignored.
async function inflatePrefix(blob, maxOut) {
  const reader = blob.stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = []; let total = 0;
  try {
    while (total < maxOut) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); total += value.length;
    }
  } catch (_) { /* truncated tail when the compressed input is cut short - fine */ }
  try { await reader.cancel(); } catch (_) {}
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// 'loose' | 'pack' | 'idx' | null. Cheap: magic bytes for pack/idx, and for loose
// objects a zlib-header check followed by inflating the first few bytes and
// matching the "<type> <size>\0" signature (the only reliable test, since loose
// objects have no extension and the zlib header byte is generic).
export async function sniffGitObject(file) {
  if (!file || file.size < 4) return null;
  let head;
  try { head = new Uint8Array(await file.slice(0, 4).arrayBuffer()); } catch (_) { return null; }
  if (head[0] === 0x50 && head[1] === 0x41 && head[2] === 0x43 && head[3] === 0x4B) return 'pack';   // "PACK"
  if (head[0] === 0xFF && head[1] === 0x74 && head[2] === 0x4F && head[3] === 0x63) return 'idx';    // \377tOc
  if (hasInflate() && (head[0] & 0x0f) === 8 && ((((head[0] << 8) | head[1]) % 31) === 0)) {         // zlib stream
    try {
      const dec = await inflatePrefix(file.slice(0, 1024), 40);
      const s = String.fromCharCode.apply(null, dec.subarray(0, Math.min(dec.length, 40)));
      const sp = s.indexOf(' '), nul = s.indexOf('\0');
      if (sp > 0 && nul > sp && TYPES.has(s.slice(0, sp)) && /^\d+$/.test(s.slice(sp + 1, nul))) return 'loose';
    } catch (_) {}
  }
  return null;
}

async function sha1Hex(bytes) {
  try {
    if (!self.crypto || !crypto.subtle) return null;
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)));
  } catch (_) { return null; }
}

function card(title, rowEls) {
  const c = el('div', { class: 'anr-card' });
  c.appendChild(el('h3', {}, title));
  const t = el('table', { class: 'anr-readout' });
  for (const r of rowEls) t.appendChild(r);
  c.appendChild(t);
  return c;
}

function noteCard(text) {
  const c = el('div', { class: 'anr-card' });
  c.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' }, text));
  return c;
}

function block(text) {
  return el('pre', { class: 'anr-git-block' }, text);
}

// tree = repeated "<mode> <name>\0<20-byte SHA1>" with no separators.
function parseTree(content) {
  const entries = [];
  let i = 0;
  while (i < content.length && entries.length < 100000) {
    let sp = i;
    while (sp < content.length && content[sp] !== 0x20) sp++;
    if (sp >= content.length) break;
    let nul = sp + 1;
    while (nul < content.length && content[nul] !== 0x00) nul++;
    if (nul + 21 > content.length) break;
    const mode = String.fromCharCode.apply(null, content.subarray(i, sp));
    const name = new TextDecoder().decode(content.subarray(sp + 1, nul));
    const sha = toHex(content.subarray(nul + 1, nul + 21));
    const type = mode === '40000' ? 'tree' : mode === '160000' ? 'submodule' : mode === '120000' ? 'symlink' : 'blob';
    entries.push({ mode, name, sha, type });
    i = nul + 21;
  }
  return entries;
}

function renderTextObject(content, type, resultsEl) {
  const text = new TextDecoder().decode(content);
  const blank = text.indexOf('\n\n');
  const headPart = blank >= 0 ? text.slice(0, blank) : text;
  const message = blank >= 0 ? text.slice(blank + 2) : '';

  const fc = el('div', { class: 'anr-card' });
  fc.appendChild(el('h3', {}, type === 'commit' ? 'Commit' : 'Tag'));
  const t = el('table', { class: 'anr-readout' });
  for (const line of headPart.split('\n')) {
    const i = line.indexOf(' ');
    if (i <= 0) continue;
    t.appendChild(row(line.slice(0, i), line.slice(i + 1)));
  }
  fc.appendChild(t);
  resultsEl.appendChild(fc);

  if (message.trim()) {
    const mc = el('div', { class: 'anr-card' });
    mc.appendChild(el('h3', {}, 'Message'));
    mc.appendChild(block(message.replace(/\n+$/, '')));
    resultsEl.appendChild(mc);
  }
}

function renderTreeObject(content, resultsEl) {
  const entries = parseTree(content);
  const c = el('div', { class: 'anr-card' });
  c.appendChild(el('h3', {}, 'Tree (' + entries.length + ' ' + (entries.length === 1 ? 'entry' : 'entries') + ')'));
  const t = el('table', { class: 'anr-readout' });
  for (const e of entries) {
    t.appendChild(row(e.name, e.type + '  ·  ' + e.mode + '  ·  ' + e.sha));
  }
  c.appendChild(t);
  resultsEl.appendChild(c);
}

function renderBlobObject(file, content, resultsEl) {
  const c = el('div', { class: 'anr-card' });
  c.appendChild(el('h3', {}, 'Blob'));

  // Textual preview when the content is overwhelmingly printable.
  const sample = content.subarray(0, 4096);
  let ctrl = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b === 127) ctrl++;
  }
  const textual = sample.length > 0 && ctrl / sample.length < 0.1;
  if (textual) {
    const text = new TextDecoder().decode(content.subarray(0, 8192));
    c.appendChild(block(text + (content.length > 8192 ? '\n…' : '')));
  } else {
    c.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 10px;' },
      'Binary blob - analyse it to detect the real format and inspect the contents.'));
  }

  // Re-dispatch the blob's bytes through the main analyser. The name has no
  // extension (git doesn't store one in the blob), so handleFile() sniffs the
  // real type from magic bytes. A Back-bar entry returns here.
  const btn = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse blob content');
  btn.addEventListener('click', () => {
    const inner = new File([content], file.name || 'blob');
    if (window._anrPushNav) {
      window._anrPushNav('git blob', () => { resultsEl.hidden = false; renderGitObject(file, resultsEl); });
    }
    if (window._anrHandleFile) window._anrHandleFile(inner, { nested: true });
  });
  c.appendChild(btn);
  resultsEl.appendChild(c);
}

async function renderPackOrIdx(file, resultsEl, kind) {
  if (kind === 'pack') {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const dv = new DataView(head.buffer);
    const version = dv.getUint32(4, false);
    const count = dv.getUint32(8, false);
    resultsEl.appendChild(card('Git packfile', [
      row('Format', 'Git pack (.pack)'),
      row('Version', String(version)),
      row('Objects', count.toLocaleString()),
      row('Size', fmtBytes(file.size)),
    ]));
    resultsEl.appendChild(noteCard('A packfile stores many objects delta-compressed against one another. Analyser reads the header (version and object count); resolving the individual objects needs the matching .idx index.'));
    return;
  }
  // idx v2: \377tOc, version (uint32 BE) = 2, then a 256-entry fanout table of
  // uint32 BE - the last entry is the total object count.
  const buf = new Uint8Array(await file.slice(0, 8 + 256 * 4).arrayBuffer());
  const dv = new DataView(buf.buffer);
  const version = dv.getUint32(4, false);
  let count = 0;
  if (version === 2 && buf.length >= 8 + 256 * 4) count = dv.getUint32(8 + 255 * 4, false);
  resultsEl.appendChild(card('Git pack index', [
    row('Format', 'Git pack index (.idx)'),
    row('Version', String(version)),
    row('Objects', count ? count.toLocaleString() : '-'),
    row('Size', fmtBytes(file.size)),
  ]));
}

export async function renderGitObject(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  const kind = await sniffGitObject(file);

  if (kind === 'pack' || kind === 'idx') { await renderPackOrIdx(file, resultsEl, kind); return; }
  if (kind !== 'loose') {
    resultsEl.appendChild(card('Git object', [row('Status', 'Not a recognisable git object')]));
    return;
  }

  let data;
  try { data = await inflateAll(file); }
  catch (_) {
    resultsEl.appendChild(card('Git object', [row('Status', 'Could not inflate (corrupt, truncated, or not a git object)')]));
    return;
  }

  let nul = 0; while (nul < data.length && data[nul] !== 0x00) nul++;
  const header = String.fromCharCode.apply(null, data.subarray(0, Math.min(nul, 64)));
  const sp = header.indexOf(' ');
  const type = sp > 0 ? header.slice(0, sp) : '';
  const size = sp > 0 ? (parseInt(header.slice(sp + 1), 10) || 0) : 0;
  const content = data.subarray(nul + 1);
  const sha = await sha1Hex(data);

  const rows = [
    row('Object type', type || '(unknown)'),
    row('Content size', fmtBytes(content.length) + (content.length === size ? '' : '  (header declares ' + size + ')')),
  ];
  if (sha) {
    rows.push(row('SHA-1', sha));
    const fn = (file.name || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    if (fn.length === 38 && sha.slice(2) === fn) rows.push(row('Filename match', 'Yes - the filename is this object hash'));
  }
  resultsEl.appendChild(card('Git ' + (type || 'object'), rows));

  if (type === 'commit' || type === 'tag') renderTextObject(content, type, resultsEl);
  else if (type === 'tree') renderTreeObject(content, resultsEl);
  else renderBlobObject(file, content, resultsEl);
}
