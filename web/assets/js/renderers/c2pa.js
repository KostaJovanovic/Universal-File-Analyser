/* Analyser - C2PA / Content Credentials reader
   Decodes the C2PA manifest embedded in an image (the "Content Credentials"
   provenance record) and lays out what it claims: the signing tool, the edit
   actions, ingredients (source images), any AI-generation markers, and the
   signing certificate's subject/issuer/validity.

   IMPORTANT: this DECODES, it does not VERIFY. The cryptographic signature is
   NOT checked against a trust list, so everything here is what the manifest
   *asserts* - which anyone can author or alter. It is provenance metadata, not
   proof of authenticity. The card says so plainly.

   Storage: C2PA lives in a JUMBF (ISO/IEC 19566-5) box tree. In JPEG it is
   fragmented across APP11 (FFEB) segments; in PNG it is a `caBX` chunk. The box
   payloads (claim, assertions, signature) are CBOR; the signature is a COSE_Sign1
   whose x5chain header carries the signer's DER certificate(s). */

import { el, row, wireInfoToggle } from '../core/util.js';
import { ascii, utf8 } from '../core/binutil.js';

// The 12-byte suffix shared by all C2PA/JUMBF box type UUIDs; the first 4 bytes
// are an ASCII tag ("c2pa", "c2ma", "c2as", "c2cl", "c2cs", "cbor", "json", ...).
const JUMBF_SUFFIX = [0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71];

// ---------- extraction: pull the JUMBF manifest-store bytes out of a file ----------

// JPEG: reassemble the C2PA JUMBF from its APP11 (FFEB) fragments. Each APP11
// payload is CI(2 "JP") + box-instance(2) + packet-seq(4) + a slice of the box.
// Fragments sharing a box-instance number concatenate in packet-seq order.
function extractFromJpeg(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  const frags = new Map(); // instance -> [{ seq, bytes }]
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xFF) break;
    let marker = b[i + 1];
    while (marker === 0xFF && i + 2 < b.length) { i++; marker = b[i + 1]; }
    if (marker === 0xD9 || marker === 0xDA) break;            // EOI / start of scan
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    const payload = i + 4, segEnd = i + 2 + len;
    if (segEnd > b.length) break;
    if (marker === 0xEB && len > 10 && b[payload] === 0x4A && b[payload + 1] === 0x50) { // APP11 "JP"
      const inst = (b[payload + 2] << 8) | b[payload + 3];
      const seq = (b[payload + 4] << 24 | b[payload + 5] << 16 | b[payload + 6] << 8 | b[payload + 7]) >>> 0;
      (frags.get(inst) || frags.set(inst, []).get(inst)).push({ seq, bytes: b.subarray(payload + 8, segEnd) });
    }
    i = segEnd;
  }
  if (!frags.size) return null;
  // Pick the instance whose reassembly is a c2pa/jumb box (usually the only one).
  for (const parts of frags.values()) {
    parts.sort((a, c) => a.seq - c.seq);
    let total = 0; for (const p of parts) total += p.bytes.length;
    const out = new Uint8Array(total);
    let o = 0; for (const p of parts) { out.set(p.bytes, o); o += p.bytes.length; }
    if (looksLikeJumbf(out)) return out;
  }
  return null;
}

// PNG: the `caBX` ancillary chunk holds the JUMBF store verbatim.
function extractFromPng(b) {
  if (b[0] !== 0x89 || b[1] !== 0x50) return null;
  let i = 8;
  while (i + 8 <= b.length) {
    const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) break;
    if (type === 'caBX') return b.subarray(i + 8, i + 8 + len);
    if (type === 'IEND') break;
    i = end;
  }
  return null;
}

function looksLikeJumbf(b) {
  // A JUMBF superbox: 4-byte LBox, then TBox 'jumb'.
  return b.length > 8 && ascii(b, 4, 4) === 'jumb';
}

function extractC2pa(b) {
  if (b[0] === 0xFF && b[1] === 0xD8) return extractFromJpeg(b);
  if (b[0] === 0x89 && b[1] === 0x50) return extractFromPng(b);
  if (looksLikeJumbf(b)) return b;      // a bare .c2pa manifest
  return null;
}

// ---------- JUMBF box tree ----------
// Parse a run of JUMBF boxes into nodes. A superbox (type 'jumb') carries a
// description box ('jumd') giving its UUID tag + label, then content boxes.
function parseBoxes(b, start, end) {
  const nodes = [];
  let p = start;
  while (p + 8 <= end) {
    let len = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0;
    const type = ascii(b, p + 4, 4);
    let content = p + 8;
    if (len === 1) { // 64-bit XLBox (we only trust the low 32 bits here)
      len = (b[p + 8] << 24 | b[p + 9] << 16 | b[p + 10] << 8 | b[p + 11]) >>> 0 || (end - p);
      content = p + 16;
    } else if (len === 0) {
      len = end - p;
    }
    const boxEnd = Math.min(p + len, end);
    if (boxEnd <= content) break;
    nodes.push(interpretBox(b, type, content, boxEnd));
    p = boxEnd;
  }
  return nodes;
}

function interpretBox(b, type, content, end) {
  if (type === 'jumb') {
    // First child is the description box 'jumd'.
    const kids = parseBoxes(b, content, end);
    const jumd = kids.find((k) => k.type === 'jumd');
    const rest = kids.filter((k) => k !== jumd);
    return { type: 'jumb', tag: jumd && jumd.tag, label: jumd && jumd.label, children: rest };
  }
  if (type === 'jumd') {
    // TypeUUID(16) Toggles(1) [Label\0 if toggle&2] ...
    const tag = ascii(b, content, 4);          // first 4 bytes of the type UUID
    const toggles = b[content + 16];
    let q = content + 17;
    let label = '';
    if (toggles & 0x02) { const s = content + 17; while (q < end && b[q] !== 0) q++; label = utf8(b.subarray(s, q)); q++; }
    return { type: 'jumd', tag, label };
  }
  // Data box (cbor/json/uuid/...): keep the raw payload for the caller to decode.
  return { type, data: b.subarray(content, end) };
}

// Depth-first search for the first content data box under a node.
function dataOf(node) {
  if (!node || !node.children) return null;
  return node.children.find((k) => k.type === 'cbor' || k.type === 'json') || null;
}

// ---------- minimal CBOR decoder ----------
function decodeCbor(b, offRef) {
  const st = offRef || { p: 0 };
  const read = () => {
    const ib = b[st.p++];
    const major = ib >> 5, minor = ib & 0x1f;
    let len = minor;
    if (minor === 24) len = b[st.p++];
    else if (minor === 25) { len = (b[st.p] << 8 | b[st.p + 1]); st.p += 2; }
    else if (minor === 26) { len = (b[st.p] * 0x1000000 + (b[st.p + 1] << 16 | b[st.p + 2] << 8 | b[st.p + 3])); st.p += 4; }
    else if (minor === 27) { // 64-bit: read as Number (fine for our field sizes)
      let v = 0; for (let k = 0; k < 8; k++) v = v * 256 + b[st.p++]; len = v;
    }
    switch (major) {
      case 0: return len;                       // uint
      case 1: return -1 - len;                  // negint
      case 2: { const s = b.subarray(st.p, st.p + len); st.p += len; return s; } // bytes
      case 3: { const s = utf8(b.subarray(st.p, st.p + len)); st.p += len; return s; } // text
      case 4: { const a = []; for (let k = 0; k < len; k++) a.push(read()); return a; } // array
      case 5: { const m = {}; for (let k = 0; k < len; k++) { const key = read(); m[key] = read(); } return m; } // map
      case 6: return read();                    // tag: return the tagged value
      case 7:
        if (minor === 20) return false;
        if (minor === 21) return true;
        if (minor === 22 || minor === 23) return null;
        return null;
    }
    return null;
  };
  try { return read(); } catch (_) { return null; }
}

// ---------- compact X.509 (self-contained; mirrors parsers-security.js) ----------
const DN = { '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '1.2.840.113549.1.9.1': 'E' };
function derRead(b, pos) {
  const id = b[pos]; let tag = id & 0x1f, p = pos + 1;
  if (tag === 0x1f) { tag = 0; let bb; do { bb = b[p++]; tag = (tag << 7) | (bb & 0x7f); } while (bb & 0x80); }
  let len = b[p++];
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[p++]; }
  return { cls: id >> 6, tag, content: p, end: p + len, len };
}
function* derKids(b, s, e) { let p = s; while (p < e) { const n = derRead(b, p); yield n; p = n.end; } }
function derOid(b, n) {
  const by = b.subarray(n.content, n.end); if (!by.length) return '';
  const parts = [Math.floor(by[0] / 40), by[0] % 40]; let v = 0;
  for (let i = 1; i < by.length; i++) { v = v * 128 + (by[i] & 0x7f); if (!(by[i] & 0x80)) { parts.push(v); v = 0; } }
  return parts.join('.');
}
function derName(b, node) {
  const parts = [];
  try {
    for (const rdn of derKids(b, node.content, node.end))
      for (const atv of derKids(b, rdn.content, rdn.end)) {
        const k = [...derKids(b, atv.content, atv.end)];
        if (k.length >= 2 && k[0].tag === 0x06) { const key = DN[derOid(b, k[0])]; if (key) parts.push(key + '=' + utf8(b.subarray(k[1].content, k[1].end))); }
      }
  } catch (_) {}
  return parts.join(', ');
}
function derTime(b, n) {
  try {
    const s = ascii(b, n.content, n.len); let year, rest;
    if (n.tag === 0x17) { const yy = +s.slice(0, 2); year = yy >= 50 ? 1900 + yy : 2000 + yy; rest = s.slice(2); }
    else if (n.tag === 0x18) { year = +s.slice(0, 4); rest = s.slice(4); }
    else return null;
    return new Date(Date.UTC(year, +rest.slice(0, 2) - 1, +rest.slice(2, 4), +rest.slice(4, 6) || 0, +rest.slice(6, 8) || 0, +rest.slice(8, 10) || 0));
  } catch (_) { return null; }
}
function x509Summary(der) {
  try {
    const cert = derRead(der, 0);
    const tbs = [...derKids(der, cert.content, cert.end)][0];
    const k = [...derKids(der, tbs.content, tbs.end)];
    const i = (k[0] && k[0].cls === 2 && k[0].tag === 0) ? 1 : 0;
    const val = [...derKids(der, k[i + 3].content, k[i + 3].end)];
    return { issuer: derName(der, k[i + 2]), subject: derName(der, k[i + 4]), notBefore: derTime(der, val[0]), notAfter: derTime(der, val[1]) };
  } catch (_) { return null; }
}

// ---------- interpret the manifest tree ----------
function findByTag(nodes, tag, label) {
  for (const n of nodes || []) {
    if (n.type === 'jumb' && (n.tag === tag || n.label === label)) return n;
  }
  return null;
}

// Extract signer certificate(s) from a COSE_Sign1 [protected, unprotected, payload, sig].
function certsFromCose(cose) {
  if (!Array.isArray(cose) || cose.length < 2) return [];
  const headers = [];
  if (cose[0] instanceof Uint8Array && cose[0].length) { const h = decodeCbor(cose[0]); if (h) headers.push(h); }
  if (cose[1] && typeof cose[1] === 'object') headers.push(cose[1]);
  for (const h of headers) {
    const x5 = h[33] != null ? h[33] : h['33'];        // x5chain header label = 33
    if (x5 instanceof Uint8Array) return [x5];
    if (Array.isArray(x5)) return x5.filter((c) => c instanceof Uint8Array);
  }
  return [];
}

function parseManifest(node) {
  const out = { label: node.label, actions: [], ingredients: [], assertions: [], ai: [] };
  const assertionStore = findByTag(node.children, 'c2as', 'c2pa.assertions');
  if (assertionStore) {
    for (const a of assertionStore.children || []) {
      if (a.type !== 'jumb') continue;
      const db = dataOf(a);
      const val = db ? (db.type === 'cbor' ? decodeCbor(db.data) : safeJson(db.data)) : null;
      out.assertions.push(a.label);
      if (a.label === 'c2pa.actions' && val && Array.isArray(val.actions)) {
        for (const act of val.actions) {
          out.actions.push({ action: act.action, agent: softwareAgentName(act.softwareAgent), src: act.digitalSourceType });
          if (/trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/i.test(act.digitalSourceType || ''))
            out.ai.push('Action "' + (act.action || '?') + '" declares AI source: ' + act.digitalSourceType);
        }
      } else if (/^c2pa\.ingredient/.test(a.label || '') && val) {
        out.ingredients.push({ title: val.title, format: val.format, relationship: val.relationship });
      } else if (/schema-org\.CreativeWork/i.test(a.label || '') && val) {
        out.creativeWork = val;
      } else if (/training-mining/i.test(a.label || '') && val) {
        out.trainingMining = val;
      }
    }
  }
  const claimBox = findByTag(node.children, 'c2cl', 'c2pa.claim') || findByTag(node.children, 'c2cl', 'c2pa.claim.v2');
  if (claimBox) {
    const db = dataOf(claimBox);
    const claim = db ? decodeCbor(db.data) : null;
    if (claim) {
      out.generator = claim.claim_generator || generatorInfo(claim.claim_generator_info);
      out.title = claim['dc:title'] || claim.title;
      out.format = claim['dc:format'] || claim.format;
      out.instanceId = claim.instanceID || claim['instanceID'];
      out.alg = claim.alg;
    }
  }
  const sigBox = findByTag(node.children, 'c2cs', 'c2pa.signature');
  if (sigBox) {
    const db = (sigBox.children || []).find((k) => k.type === 'cbor' || k.type === 'uuid');
    const cose = db ? decodeCbor(db.data) : null;
    const certs = certsFromCose(cose);
    if (certs.length) { out.signer = x509Summary(certs[0]); out.certCount = certs.length; }
  }
  return out;
}

function safeJson(bytes) { try { return JSON.parse(utf8(bytes)); } catch (_) { return null; } }
function softwareAgentName(sa) { return sa == null ? null : (typeof sa === 'string' ? sa : (sa.name || null)); }
function generatorInfo(info) {
  if (!info) return null;
  const first = Array.isArray(info) ? info[0] : info;
  if (!first) return null;
  return [first.name, first.version].filter(Boolean).join(' ');
}

// Parse the whole manifest store into a list of manifests.
export function parseC2paStore(storeBytes) {
  const top = parseBoxes(storeBytes, 0, storeBytes.length);
  const store = top.find((n) => n.type === 'jumb');
  if (!store) return null;
  const manifests = (store.children || []).filter((n) => n.type === 'jumb' && (n.tag === 'c2ma' || /^(urn:|contentauth)/i.test(n.label || '')))
    .map(parseManifest);
  return manifests.length ? manifests : null;
}

// Read a File and return decoded manifests, or null if there's no C2PA data.
export async function readC2pa(file) {
  const b = new Uint8Array(await file.arrayBuffer());
  const store = extractC2pa(b);
  if (!store) return null;
  try { return parseC2paStore(store); } catch (_) { return null; }
}

// ---------- card UI ----------
const C2PA_HELP = 'Content Credentials (C2PA) is a provenance record some cameras and editing/AI tools embed: who or what created the image and how it was edited, sealed with a digital signature. This panel DECODES that record but does not cryptographically verify the signature, so treat it as what the file claims about itself - useful context, not proof. The data is read entirely on your device.';

// `manifests` is optional: pass an already-parsed readC2pa() result to avoid
// re-reading and re-parsing the file (photo.js shares one read across this card
// and the AI-signals card). Omit it and the card reads the file itself.
export async function buildC2paCard(file, manifests) {
  if (manifests === undefined) {
    try { manifests = await readC2pa(file); } catch (_) { return null; }
  }
  if (!manifests || !manifests.length) return null;

  const card = el('div', { class: 'anr-card' });
  const head = el('div', { style: 'display:flex; align-items:center; gap:6px;' });
  head.appendChild(el('h3', { style: 'margin:0;' }, 'Content Credentials (C2PA)'));
  const infoBtn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
  const help = el('div', { class: 'anr-info-panel is-hidden', html: C2PA_HELP });
  wireInfoToggle(infoBtn, help);
  head.appendChild(infoBtn);
  card.appendChild(head);
  card.appendChild(help);
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:8px 0;' },
    'Present and decoded below. Not cryptographically verified - this is what the manifest asserts, which can be authored or altered, not proof the image is authentic.'));

  manifests.forEach((m, idx) => {
    if (manifests.length > 1) card.appendChild(el('div', { class: 'anr-readout-section' }, 'Manifest ' + (idx + 1)));

    const t = el('table', { class: 'anr-readout' });
    if (m.generator) t.appendChild(row('Created with', m.generator));
    if (m.title) t.appendChild(row('Title', m.title));
    if (m.format) t.appendChild(row('Format', m.format));
    if (m.alg) t.appendChild(row('Claim hash alg', m.alg));
    if (m.signer) {
      if (m.signer.subject) t.appendChild(row('Signed by', m.signer.subject));
      if (m.signer.issuer) t.appendChild(row('Certificate issuer', m.signer.issuer + (m.signer.subject === m.signer.issuer ? '  (self-signed)' : '')));
      const fmtD = (d) => d ? d.toISOString().replace('T', ' ').replace(/\..*$/, '') : null;
      if (m.signer.notBefore || m.signer.notAfter) t.appendChild(row('Certificate validity', (fmtD(m.signer.notBefore) || '?') + '  to  ' + (fmtD(m.signer.notAfter) || '?')));
    } else {
      t.appendChild(row('Signature', 'present (certificate could not be decoded)'));
    }
    card.appendChild(t);

    if (m.ai.length) {
      card.appendChild(el('div', { class: 'anr-readout-section' }, 'AI / generative markers'));
      for (const a of m.ai) card.appendChild(el('p', { style: 'color:var(--accent);font-weight:600;margin:4px 0;' }, a));
    }

    if (m.actions.length) {
      card.appendChild(el('div', { class: 'anr-readout-section' }, 'Edit actions'));
      const at = el('table', { class: 'anr-readout' });
      for (const a of m.actions) {
        const detail = [a.agent, a.src].filter(Boolean).join(' · ');
        at.appendChild(row(actionLabel(a.action), detail || '-'));
      }
      card.appendChild(at);
    }

    if (m.ingredients.length) {
      card.appendChild(el('div', { class: 'anr-readout-section' }, 'Ingredients (source assets)'));
      const it = el('table', { class: 'anr-readout' });
      for (const g of m.ingredients) it.appendChild(row(g.title || '(untitled)', [g.relationship, g.format].filter(Boolean).join(' · ') || '-'));
      card.appendChild(it);
    }

    if (m.assertions.length) {
      card.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:8px;' }, 'Assertions: ' + m.assertions.join(', ')));
    }
  });

  return card;
}

const ACTION_NAMES = {
  'c2pa.created': 'Created', 'c2pa.edited': 'Edited', 'c2pa.opened': 'Opened', 'c2pa.placed': 'Placed',
  'c2pa.cropped': 'Cropped', 'c2pa.resized': 'Resized', 'c2pa.colorAdjustments': 'Colour adjustments',
  'c2pa.drawing': 'Drawing', 'c2pa.filtered': 'Filtered', 'c2pa.converted': 'Converted', 'c2pa.published': 'Published',
};
function actionLabel(a) { return (ACTION_NAMES[a] || a || 'Action') + (ACTION_NAMES[a] ? '  (' + a + ')' : ''); }
