/* Analyser - AI-generation signals
   Surfaces indicators that an image was produced or edited by a generative-AI
   tool, WITHOUT passing a verdict. Metadata can be absent, forged or stripped,
   so a "clean" image proves nothing and a match is a signal, not a judgement -
   the card lists the raw evidence and lets the reader decide.

   Sources scanned (all on-device):
     - EXIF / XMP fields (via the already-parsed exifr object) for generator
       tool names and the standard IPTC "Digital Source Type" AI marker
     - the raw XMP packet in the bytes (in case exifr didn't surface a field)
     - PNG text chunks (tEXt/zTXt/iTXt) - where Stable Diffusion / AUTOMATIC1111,
       ComfyUI, InvokeAI and NovelAI stash their generation parameters
     - JPEG UserComment / EXIF description carrying SD parameter blocks
     - a cross-reference to any C2PA Content Credentials AI markers

   Deliberately overlaps with the C2PA card only to *corroborate*; the provenance
   detail itself lives there. */

import { el, row, rowHelp, wireInfoToggle } from '../core/util.js';
import { ascii, utf8, findBytes, inflate } from '../core/binutil.js';
import { readC2pa } from './c2pa.js';

// Generator tool names. Word-ish boundaries keep "dalle" out of unrelated words.
const AI_TOOLS = /(stable\s?diffusion|automatic1111|comfyui|invoke\s?ai|fooocus|midjourney|dall[\s.·-]?e\b|adobe\s?firefly|\bfirefly\b|novel\s?ai|craiyon|stability\s?ai|dreamstudio|dream\s?studio|leonardo\.?ai|playground\s?ai|nightcafe|starryai|\bwombo\b|imagen\b|ideogram|recraft|\bkrea\b|flux\.1|\bsdxl\b|bing\s?image\s?creator|deep\s?dream|disco\s?diffusion|kandinsky|latent\s?diffusion|gigapixel\s?ai)/i;
// The IPTC/C2PA standard "this is AI" markers (also appear as a cv.iptc.org URL).
const DIGITAL_SOURCE_AI = /(trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia|compositeSyntheticMedia|syntheticMedia)/i;
// Stable-Diffusion-style parameter block fingerprints.
const SD_PARAMS = /(^|\n)\s*Steps:\s*\d+|Negative prompt:|Sampler:\s*\S|CFG scale:\s*[\d.]|Model hash:|Denoising strength:/i;

// Local per-row help for the jargon labels (kept off the shared LABEL_HELP map).
const DST_HELP = 'A standard metadata tag that records how an image was made. A value like ‘trainedAlgorithmicMedia’ is the agreed marker for fully AI-generated content.';
const CC_AI_HELP = 'Content Credentials (C2PA) is a signed "made by / edited by" history some AI and editing tools attach to a file. Here it names an AI tool or AI source; the full record is in the C2PA card above.';

// Fields that legitimately mention a tool as normal usage (avoid over-flagging a
// plain camera "Software" note); we still scan them but flag only on AI matches.
function pushUnique(list, sig) {
  if (!list.some((s) => s.label === sig.label && s.detail === sig.detail)) list.push(sig);
}

function sdSummary(text) {
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const parts = [];
  const map = [
    ['Steps', /Steps:\s*(\d+)/i], ['Sampler', /Sampler:\s*([^,\n]+)/i], ['CFG', /CFG scale:\s*([\d.]+)/i],
    ['Seed', /Seed:\s*(\d+)/i], ['Size', /Size:\s*(\d+x\d+)/i], ['Model', /Model:\s*([^,\n]+)/i], ['Model hash', /Model hash:\s*(\w+)/i],
  ];
  for (const [label, re] of map) { const v = grab(re); if (v) parts.push(label + ' ' + v); }
  // The prompt is whatever precedes "Negative prompt:" / the parameter line.
  const promptEnd = text.search(/\n?\s*(Negative prompt:|Steps:)/i);
  let prompt = (promptEnd > 0 ? text.slice(0, promptEnd) : '').trim();
  if (prompt.length > 240) prompt = prompt.slice(0, 240) + '…';
  return { params: parts.join(', '), prompt };
}

// ---------- PNG text chunks ----------
async function pngTextChunks(b) {
  if (b[0] !== 0x89 || b[1] !== 0x50) return [];
  const out = [];
  let i = 8;
  while (i + 8 <= b.length) {
    const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const type = ascii(b, i + 4, 4);
    const ds = i + 8, de = ds + len;
    if (de > b.length) break;
    try {
      const s = b.subarray(ds, de);
      if (type === 'tEXt') {
        const z = s.indexOf(0);
        out.push({ keyword: utf8(s.subarray(0, z)), text: utf8(s.subarray(z + 1)) });
      } else if (type === 'zTXt') {
        const z = s.indexOf(0);
        let data = s.subarray(z + 2);            // skip keyword\0 + 1 compression-method byte
        data = (await inflate(data, 'deflate')) || new Uint8Array();
        out.push({ keyword: utf8(s.subarray(0, z)), text: utf8(data) });
      } else if (type === 'iTXt') {
        const z = s.indexOf(0);
        const compFlag = s[z + 1];
        const langEnd = s.indexOf(0, z + 3);
        const transEnd = s.indexOf(0, langEnd + 1);
        let data = s.subarray(transEnd + 1);
        if (compFlag === 1) data = (await inflate(data, 'deflate')) || new Uint8Array();
        out.push({ keyword: utf8(s.subarray(0, z)), text: utf8(data) });
      }
    } catch (_) { /* skip a malformed chunk */ }
    if (type === 'IEND') break;
    i = de + 4;                                   // + 4-byte CRC
  }
  return out;
}

// ---------- raw XMP packet from the bytes ----------
function extractXmp(b) {
  const open = findBytes(b, [0x3C, 0x78, 0x3A, 0x78, 0x6D, 0x70, 0x6D, 0x65, 0x74, 0x61]); // "<x:xmpmeta"
  if (open < 0) return null;
  const closeSig = [0x3C, 0x2F, 0x78, 0x3A, 0x78, 0x6D, 0x70, 0x6D, 0x65, 0x74, 0x61, 0x3E]; // "</x:xmpmeta>"
  const close = findBytes(b, closeSig, open);
  return utf8(b.subarray(open, close < 0 ? Math.min(b.length, open + 65536) : close + closeSig.length));
}

// ---------- collect all signals ----------
export async function collectAiSignals(file, exif, preManifests) {
  const b = new Uint8Array(await file.arrayBuffer());
  const signals = [];

  // 1) EXIF / XMP fields the parser already surfaced.
  if (exif) {
    for (const [k, v] of Object.entries(exif)) {
      if (typeof v !== 'string' || !v) continue;
      if (DIGITAL_SOURCE_AI.test(v)) pushUnique(signals, { label: 'Digital Source Type (' + k + ')', detail: v + '  - a standard "AI-generated" marker', strong: true, help: DST_HELP });
      else if (SD_PARAMS.test(v)) { const sd = sdSummary(v); pushUnique(signals, { label: 'Generation parameters (' + k + ')', detail: sd.params || v.slice(0, 200), prompt: sd.prompt, strong: true }); }
      else if (AI_TOOLS.test(v)) pushUnique(signals, { label: 'Generator tool in metadata (' + k + ')', detail: v, strong: true });
    }
  }

  // 2) Raw XMP packet (covers fields exifr may not expose, e.g. GenAI extensions).
  const xmp = extractXmp(b);
  if (xmp) {
    if (DIGITAL_SOURCE_AI.test(xmp)) pushUnique(signals, { label: 'Digital Source Type (XMP)', detail: (xmp.match(DIGITAL_SOURCE_AI) || [])[0] + '  - a standard "AI-generated" marker', strong: true, help: DST_HELP });
    const tool = xmp.match(AI_TOOLS);
    if (tool) pushUnique(signals, { label: 'Generator tool named in XMP', detail: tool[0], strong: true });
  }

  // 3) PNG text chunks (Stable Diffusion / ComfyUI / InvokeAI / NovelAI).
  if (b[0] === 0x89 && b[1] === 0x50) {
    for (const c of await pngTextChunks(b)) {
      const kw = c.keyword || '';
      const text = c.text || '';
      if (/^parameters$/i.test(kw) && SD_PARAMS.test(text)) {
        const sd = sdSummary(text);
        pushUnique(signals, { label: 'Stable Diffusion / AUTOMATIC1111 parameters (PNG "parameters")', detail: sd.params || 'present', prompt: sd.prompt, strong: true });
      } else if (/^(prompt|workflow)$/i.test(kw) && /class_type|nodes|"inputs"/.test(text)) {
        pushUnique(signals, { label: 'ComfyUI workflow embedded (PNG "' + kw + '")', detail: 'a ComfyUI node graph is stored in the file', strong: true });
      } else if (/^sd-metadata$/i.test(kw)) {
        pushUnique(signals, { label: 'InvokeAI metadata (PNG "sd-metadata")', detail: 'present', strong: true });
      } else if (SD_PARAMS.test(text)) {
        const sd = sdSummary(text);
        pushUnique(signals, { label: 'Generation parameters (PNG "' + kw + '")', detail: sd.params || 'present', prompt: sd.prompt, strong: true });
      } else if (AI_TOOLS.test(text) || AI_TOOLS.test(kw)) {
        pushUnique(signals, { label: 'Generator tool in PNG "' + kw + '"', detail: (text.match(AI_TOOLS) || [text])[0], strong: true });
      }
    }
  }

  // 4) Cross-reference C2PA Content Credentials (corroboration only).
  try {
    const manifests = preManifests !== undefined ? preManifests : await readC2pa(file);
    for (const m of manifests || []) {
      if (m.ai && m.ai.length) pushUnique(signals, { label: 'Content Credentials declare an AI source', detail: 'see the C2PA card above', strong: true, c2pa: true, help: CC_AI_HELP });
      else if (m.generator && AI_TOOLS.test(m.generator)) pushUnique(signals, { label: 'Content Credentials generator is an AI tool', detail: m.generator, strong: true, c2pa: true, help: CC_AI_HELP });
    }
  } catch (_) { /* no C2PA - fine */ }

  return signals;
}

// ---------- card ----------
const AI_HELP = 'Clues in the file that are often left by AI image generators - the name of an AI tool in the metadata, the standard IPTC "AI-generated" marker, or the settings blocks that tools like Stable Diffusion save inside the image. These are hints, not a verdict: metadata can be removed (so a genuine AI image might show nothing here) or added by hand (so a match is not proof either). Everything is read on your device.';

export async function buildAiSignalsCard(file, exif, manifests) {
  let signals;
  try { signals = await collectAiSignals(file, exif, manifests); } catch (_) { return null; }
  if (!signals || !signals.length) return null;

  const card = el('div', { class: 'anr-card' });
  const head = el('div', { style: 'display:flex; align-items:center; gap:6px;' });
  head.appendChild(el('h3', { style: 'margin:0;' }, 'AI-generation signals'));
  const infoBtn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
  const help = el('div', { class: 'anr-info-panel is-hidden', html: AI_HELP });
  wireInfoToggle(infoBtn, help);
  head.appendChild(infoBtn);
  card.appendChild(head);
  card.appendChild(help);

  const tbl = el('table', { class: 'anr-readout' });
  for (const s of signals) tbl.appendChild(s.help ? rowHelp(s.label, s.detail, s.help) : row(s.label, s.detail));
  card.appendChild(tbl);

  // Show any extracted prompt(s) - forensically the most interesting content.
  for (const s of signals) {
    if (!s.prompt) continue;
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Prompt'));
    card.appendChild(el('p', { class: 'anr-hint', style: 'white-space:pre-wrap; margin:4px 0;' }, s.prompt));
  }

  return card;
}
