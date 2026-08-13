/* Analyser - Unity asset viewer (.unity .prefab .asset .controller .anim .mat
   .physicsMaterial2D .physicMaterial .meta and friends)
   ============================================================================
   Unity serialises almost everything as a small dialect of YAML: a
     %YAML 1.1
     %TAG !u! tag:unity3d.com,2011:
   preamble, then one document per object, each headed by
     --- !u!<classID> &<fileID>
   whose first key is the class name (GameObject, Transform, MonoBehaviour,
   SpriteRenderer, AnimationClip, …). A .meta file is the odd one out - a single
   plain-YAML importer record (fileFormatVersion / guid / <Importer> settings).

   We don't need a full YAML parser for a useful read-out: we split on the
   document headers, take the class name from each, and pull the handful of fields
   that matter per type (names, friction, sample rate, importer + GUID, …). For a
   scene or prefab that means a component histogram and the list of named
   GameObjects - effectively a lightweight scene inspector. Everything is read
   on-device; nothing is uploaded. */

import { SCAN_MED } from '../core/limits.js';
import { el, row, rowHelp, fmtBytes, integrityCard, errorCard } from '../core/util.js';

const MAX_BYTES = SCAN_MED;
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// Split a Unity-YAML text into its object documents.
function splitDocs(text) {
  const re = /^--- !u!(\d+) &(\d+)(?: stripped)?[^\n]*$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text))) heads.push({ classId: +m[1], fileId: m[2], at: m.index, end: re.lastIndex });
  const docs = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const body = text.slice(h.end, i + 1 < heads.length ? heads[i + 1].at : text.length);
    const className = (body.match(/^\s*([A-Za-z_][\w]*):/m) || [])[1] || 'Object';
    docs.push({ classId: h.classId, fileId: h.fileId, className, body });
  }
  return docs;
}

// First `key: value` in a block (value trimmed, quotes/comments left as-is).
const field = (body, key) => { const m = body.match(new RegExp('^\\s*' + key + ':\\s*(.*)$', 'm')); return m ? m[1].trim() : ''; };

function parseUnity(text, ext: string, name) {
  // .meta: a single importer record, not a multi-doc object stream.
  if (ext === 'meta' || (/^fileFormatVersion:/m.test(text) && !/^--- !u!/m.test(text))) {
    const importer = (text.match(/^([A-Za-z]\w*Importer):/m) || [])[1] || (text.match(/^\s{0,2}([A-Za-z]\w+):\s*$/m) || [])[1] || '';
    return {
      kind: 'meta',
      guid: field(text, 'guid'),
      fileFormatVersion: field(text, 'fileFormatVersion'),
      importer,
      timeCreated: field(text, 'timeCreated'),
      licenseType: field(text, 'licenseType'),
      isFolder: /^folderAsset:\s*yes/m.test(text),
      raw: text,
    };
  }

  const docs = splitDocs(text);
  // Histogram of object classes.
  const counts: Record<string, number> = {};
  for (const d of docs) counts[d.className] = (counts[d.className] || 0) + 1;
  const histogram = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, count: v }));

  // Named GameObjects (a scene/prefab inspector); fall back to any m_Name.
  const gameObjects = [];
  const named = [];
  for (const d of docs) {
    const nm = field(d.body, 'm_Name').replace(/^['"]|['"]$/g, '');
    if (d.className === 'GameObject') { if (nm) gameObjects.push(nm); }
    else if (nm) named.push({ className: d.className, name: nm });
  }

  // The "primary" object: for single-asset files (.anim, .controller, .asset,
  // material) it's the first/most meaningful doc - pull type-specific fields.
  const primary = docs[0] || null;
  const detail = primary ? typeDetail(primary, docs) : [];

  // Determine a human label for the whole file.
  const sceneLike = ext === 'unity' || ext === 'prefab' || gameObjects.length > 1;
  const label = ext === 'unity' ? 'Scene' : ext === 'prefab' ? 'Prefab'
    : primary ? primary.className : 'Unity asset';

  return { kind: 'asset', ext, label, sceneLike, docs, histogram, gameObjects, named, detail, primaryClass: primary && primary.className };
}

// Pull the interesting fields for well-known asset classes.
function typeDetail(primary, docs) {
  const b = primary.body, out = [];
  const add = (k, v) => { if (v !== '' && v != null) out.push([k, v]); };
  const nm = field(b, 'm_Name').replace(/^['"]|['"]$/g, '');
  if (nm) add('Name', nm);

  switch (primary.className) {
    case 'AnimationClip':
      add('Sample rate', field(b, 'm_SampleRate') + ' fps');
      add('Legacy', field(b, 'm_Legacy') === '1' ? 'yes' : 'no');
      add('Position curves', (b.match(/m_PositionCurves:\s*\n((?:\s+- .*\n)*)/) ? 'present' : '0'));
      add('Sprite (PPtr) curves', ((b.match(/- curve:/g) || []).length || 0) || (/m_PPtrCurves:\s*\[\]/.test(b) ? 0 : ''));
      add('Events', (b.match(/m_Events:\s*\n((?:\s+- .*\n)*)/) ? 'present' : '0'));
      break;
    case 'AnimatorController': {
      const layers = [...b.matchAll(/-\s*serializedVersion:[^\n]*\n\s*m_Name:\s*(.+)/g)].map((m) => m[1].trim());
      add('Layers', layers.length ? layers.join(', ') : field(b, 'm_AnimatorLayers') === '[]' ? '0' : '');
      add('Parameters', /m_AnimatorParameters:\s*\[\]/.test(b) ? '0' : 'present');
      add('States', String(docs.filter((d) => d.className === 'AnimatorState').length));
      add('State machines', String(docs.filter((d) => d.className === 'AnimatorStateMachine').length));
      break;
    }
    case 'PhysicsMaterial2D':
      add('Friction', field(b, 'friction'));
      add('Bounciness', field(b, 'bounciness'));
      break;
    case 'PhysicMaterial':
      add('Dynamic friction', field(b, 'dynamicFriction'));
      add('Static friction', field(b, 'staticFriction'));
      add('Bounciness', field(b, 'bounciness'));
      break;
    case 'AudioManager':
      add('Volume', field(b, 'm_Volume'));
      add('Sample rate', field(b, 'm_SampleRate'));
      add('DSP buffer', field(b, 'm_DSPBufferSize'));
      add('Virtual voices', field(b, 'm_VirtualVoiceCount'));
      add('Real voices', field(b, 'm_RealVoiceCount'));
      break;
    case 'Material':
      add('Shader', (b.match(/m_Shader:\s*\{fileID:\s*(\d+)(?:,\s*guid:\s*([0-9a-f]+))?/) || [])[2] || field(b, 'm_Shader'));
      break;
    case 'MonoBehaviour':
      add('Script GUID', (b.match(/m_Script:\s*\{fileID:\s*-?\d+,\s*guid:\s*([0-9a-f]+)/) || [])[1] || '');
      break;
    default:
      break;
  }
  return out;
}

export async function renderUnity(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let text;
  try { text = await file.slice(0, MAX_BYTES).text(); } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    return;
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  // Not Unity YAML we recognise - hand off to the generic identifier.
  if (!/^%YAML|^--- !u!|^fileFormatVersion:/m.test(text)) {
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }

  const data = parseUnity(text, ext, file.name);
  resultsEl.innerHTML = '';

  // ===== .meta importer record =====
  if (data.kind === 'meta') {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Unity asset metadata (.meta)'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('Application', 'Unity (game engine)'));
    tbl.appendChild(rowHelp('Format', 'Unity .meta importer record',
      'A companion file Unity keeps beside every asset (image, model, sound) in a game project. It stores a fixed ID Unity uses to track that asset, plus its import settings, written as plain-text YAML.'));
    if (data.guid) tbl.appendChild(rowHelp('Asset GUID', data.guid, 'A fixed 32-character ID Unity uses to refer to this asset throughout the project. It stays the same even if the file is renamed or moved.'));
    if (data.importer) tbl.appendChild(rowHelp('Importer', data.importer.replace(/([a-z])([A-Z])/g, '$1 $2'),
      'The part of Unity that processes this asset when it is brought into the project - for example a texture importer for an image, or a model importer for a 3D model.'));
    if (data.isFolder) tbl.appendChild(row('Folder asset', 'yes'));
    if (data.timeCreated && data.timeCreated !== '0') {
      const t = Number(data.timeCreated);
      tbl.appendChild(row('Created', isFinite(t) && t > 1e8 ? new Date(t * 1000).toLocaleString() : data.timeCreated));
    }
    if (data.licenseType) tbl.appendChild(row('License', data.licenseType));
    if (data.fileFormatVersion) tbl.appendChild(row('Format version', data.fileFormatVersion));
    tbl.appendChild(row('Size', fmtBytes(file.size)));
    card.appendChild(tbl);
    resultsEl.appendChild(card);

    const pre = el('pre', { class: 'anr-pre', style: 'max-height:360px;overflow:auto;font-size:12px;white-space:pre-wrap;' }, data.raw.slice(0, 20000));
    const raw = el('div', { class: 'anr-card' }, [el('h3', {}, 'Import settings (raw)'), pre]);
    resultsEl.appendChild(raw);
    resultsEl.appendChild(integrityCard(file));
    return;
  }

  // ===== object-stream asset (scene / prefab / controller / anim / …) =====
  const meta = el('div', { class: 'anr-card' });
  meta.appendChild(el('h3', {}, 'Unity ' + data.label.toLowerCase()));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'Unity (game engine)'));
  tbl.appendChild(rowHelp('Format', unityFormatName(data.ext, data.label),
    'Unity saves this asset as plain text in its own flavour of the YAML format - one section per object, each labelled with the kind of object it is (!u!<classID>). Analyser separates those sections and reads the important fields.'));
  if (data.sceneLike) {
    tbl.appendChild(rowHelp('GameObjects', String(data.gameObjects.length), 'The individual objects in the scene or prefab. Each one bundles together components that give it behaviour - its position (Transform), how it looks (renderers), how it collides (colliders) and any scripts.'));
    tbl.appendChild(row('Total objects', String(data.docs.length)));
  } else {
    tbl.appendChild(row('Objects', String(data.docs.length)));
  }
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  meta.appendChild(tbl);
  resultsEl.appendChild(meta);

  // Type-specific detail (anim sample rate, material friction, …).
  if (data.detail.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, (data.primaryClass || 'Asset').replace(/([a-z])([A-Z])/g, '$1 $2')));
    const dt = el('table', { class: 'anr-readout' });
    const DETAIL_HELP = {
      'DSP buffer': 'The size of the audio buffer Unity’s sound engine works in. A larger buffer plays back more steadily but adds a little delay before a sound is heard; a smaller one responds faster but works the device harder.',
      'Virtual voices': 'The most sounds Unity keeps track of at once, including quiet or distant ones it is not actually playing out loud.',
      'Real voices': 'The most sounds Unity plays out loud at the same time. If more than this are triggered, the quietest or least important ones are dropped.',
      'Sprite (PPtr) curves': 'Animation tracks that swap one whole image (sprite) for another over time, rather than moving or scaling the object - used for frame-by-frame 2D animation.',
      'Shader': 'The shader this material uses - the small program that decides how the surface is drawn, including how it responds to light and colour. Shown as Unity’s internal reference to it.',
      'Script GUID': 'The fixed ID of the code file (script) attached to this object. It links the object to its behaviour without naming the file directly, so the link survives renames.',
    };
    data.detail.forEach(([k, v]) => dt.appendChild(DETAIL_HELP[k] ? rowHelp(k, String(v), DETAIL_HELP[k]) : row(k, String(v))));
    card.appendChild(dt);
    resultsEl.appendChild(card);
  }

  // Component / class histogram (the scene's makeup).
  if (data.histogram.length > 1) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Object types (' + data.histogram.length + ')'));
    const max = data.histogram[0].count;
    const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:3px;' });
    for (const h of data.histogram) {
      const rowEl = el('div', { style: 'display:flex;align-items:center;gap:8px;font-size:12px;' });
      rowEl.appendChild(el('span', { style: 'flex:0 0 180px;' }, h.name.replace(/([a-z])([A-Z])/g, '$1 $2')));
      const bar = el('div', { style: `flex:0 0 ${Math.max(2, Math.round(h.count / max * 200))}px;height:12px;background:var(--accent,#3b82c4);opacity:.7;` });
      rowEl.appendChild(bar);
      rowEl.appendChild(el('span', { style: 'opacity:.7;font-variant-numeric:tabular-nums;' }, String(h.count)));
      wrap.appendChild(rowEl);
    }
    card.appendChild(wrap);
    resultsEl.appendChild(card);
  }

  // Named GameObjects (scene inspector) or named sub-objects.
  if (data.gameObjects.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'GameObjects (' + data.gameObjects.length + ')'));
    const ul = el('ul', { style: 'margin:0;padding-left:18px;font-size:13px;column-width:200px;' });
    [...new Set(data.gameObjects)].slice(0, 400).forEach((n) => ul.appendChild(el('li', {}, n)));
    if (data.gameObjects.length > 400) ul.appendChild(el('li', { class: 'anr-hint' }, '… and more'));
    card.appendChild(ul);
    resultsEl.appendChild(card);
  } else if (data.named.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Named objects (' + data.named.length + ')'));
    const ul = el('ul', { style: 'margin:0;padding-left:18px;font-size:13px;' });
    data.named.slice(0, 200).forEach((o) => {
      const li = el('li', {}, o.name);
      li.appendChild(el('span', { class: 'anr-hint', style: 'margin-left:8px;font-size:11px;' }, o.className));
      ul.appendChild(li);
    });
    card.appendChild(ul);
    resultsEl.appendChild(card);
  }

  resultsEl.appendChild(integrityCard(file));
}

function unityFormatName(ext: string, label) {
  const map = {
    unity: 'Unity scene (.unity)', prefab: 'Unity prefab (.prefab)', asset: 'Unity asset (.asset)',
    controller: 'Unity Animator Controller (.controller)', anim: 'Unity animation clip (.anim)',
    mat: 'Unity material (.mat)', physicsmaterial2d: 'Unity 2D physics material (.physicsMaterial2D)',
    physicmaterial: 'Unity physics material (.physicMaterial)', overridecontroller: 'Unity Animator Override Controller',
    spriteatlas: 'Unity sprite atlas (.spriteatlas)', cubemap: 'Unity cubemap (.cubemap)',
    lighting: 'Unity lighting settings', renderTexture: 'Unity render texture',
  };
  return map[ext] || ('Unity ' + label.toLowerCase());
}
