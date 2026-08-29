/* Analyser - machine-learning models.

   Four different questions, four different files, one renderer:

   - **ONNX** and frozen **TensorFlow** graphs are computation graphs. Neither
     stores an edge list: a node follows another because one of its inputs is one
     of the other's outputs, so the graph is recovered by matching tensor names.
     Once you have the edges you can rank the nodes by longest path from an input
     and draw the thing, which is what the diagram below does.
   - **safetensors** and **GGUF** are weight files, not graphs. The question there
     is what tensors are in it, at what precision, and how many parameters that
     comes to - which for a quantised GGUF is also the answer to "will this run
     on my machine".
   - **PyTorch .pt/.pth** is a ZIP around a Python pickle. A pickle is a program,
     not a document: unpickling one runs whatever it says to, which is why
     loading an untrusted checkpoint is a genuine security problem. Nothing here
     is executed. The opcodes are read as bytes, the module.name pairs the file
     would import are listed, and anything outside the set a tensor file has a
     reason to touch is flagged.
   - **Keras** carries its architecture as JSON - inside the ZIP for a .keras,
     as an HDF5 attribute for a legacy .h5 - so the layer list reads directly. */

import { el, row, rowHelp, h3help, errorCard, fmtBytes, preBlock } from '../core/util.js';
import { openZip } from './zip.js';
import { parseOnnxModel, parseTfGraphDef, type OnnxNode, type OnnxTensor } from '../lib/onnx.js';
import { ML_MODEL_MAX, ML_GRAPH_NODES, ML_NODE_MAX, GGUF_HEADER_MAX } from '../core/limits.js';

const fmtParams = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + ' B' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' K' : String(n);
const shapeText = (dims: (number|string)[]) => dims.length ? dims.join(' x ') : 'scalar';

/* ---- the graph diagram ----

   A layered drawing. Each node's column is one more than the deepest of the
   nodes producing its inputs (longest path, not shortest - that is what keeps a
   skip connection from pulling a late node back to the front and crossing every
   edge in between). Nodes at the same depth stack vertically. No crossing
   minimisation: it would reorder rows, and for a model graph the order the file
   lists nodes in is itself meaningful. */
function buildGraphDiagram(nodes: OnnxNode[]) {
  const producer = new Map<string, number>();
  nodes.forEach((n) => n.outputs.forEach((o) => { if (o && !producer.has(o)) producer.set(o, n.index); }));

  const depth = new Int32Array(nodes.length).fill(-1);
  // Iterative longest-path with an explicit stack: a deep sequential model
  // (hundreds of layers) would blow the call stack in the recursive form, and
  // the visiting set is also what stops a cyclic or malformed graph looping.
  const visiting = new Uint8Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    if (depth[i] >= 0) continue;
    const stack = [i];
    while (stack.length) {
      const cur = stack[stack.length - 1];
      if (depth[cur] >= 0) { stack.pop(); continue; }
      let waiting = false, d = 0;
      for (const inp of nodes[cur].inputs) {
        const p = producer.get(inp);
        if (p == null || p === cur) continue;
        if (depth[p] >= 0) { d = Math.max(d, depth[p] + 1); continue; }
        if (visiting[p]) continue;              // cycle - treat as already placed
        visiting[p] = 1;
        stack.push(p);
        waiting = true;
      }
      if (waiting) continue;
      depth[cur] = d;
      visiting[cur] = 0;
      stack.pop();
    }
  }

  const cols: number[][] = [];
  nodes.forEach((n, i) => {
    const d = Math.max(0, depth[i]);
    (cols[d] = cols[d] || []).push(i);
  });

  const BOX_W = 132, BOX_H = 26, COL = 176, ROW = 34, PAD = 12;
  const height = PAD * 2 + Math.max(1, ...cols.map((c) => c.length)) * ROW;
  const width = PAD * 2 + cols.length * COL;
  const pos: { x: number; y: number }[] = [];
  cols.forEach((col, d) => col.forEach((i, k) => { pos[i] = { x: PAD + d * COL, y: PAD + k * ROW }; }));

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('class', 'anr-mlgraph-svg');

  const edges = document.createElementNS(NS, 'g');
  edges.setAttribute('class', 'anr-mlgraph-edges');
  for (const n of nodes) {
    const to = pos[n.index];
    if (!to) continue;
    for (const inp of n.inputs) {
      const p = producer.get(inp);
      if (p == null || p === n.index || !pos[p]) continue;
      const from = pos[p];
      const x1 = from.x + BOX_W, y1 = from.y + BOX_H / 2;
      const x2 = to.x, y2 = to.y + BOX_H / 2;
      const path = document.createElementNS(NS, 'path');
      const mx = (x1 + x2) / 2;
      path.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2);
      edges.appendChild(path);
    }
  }
  svg.appendChild(edges);

  for (const n of nodes) {
    const p = pos[n.index];
    if (!p) continue;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'anr-mlgraph-node');
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(p.x)); rect.setAttribute('y', String(p.y));
    rect.setAttribute('width', String(BOX_W)); rect.setAttribute('height', String(BOX_H));
    g.appendChild(rect);
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', String(p.x + BOX_W / 2));
    text.setAttribute('y', String(p.y + BOX_H / 2 + 4));
    text.textContent = n.op.length > 16 ? n.op.slice(0, 15) + '…' : n.op;
    g.appendChild(text);
    const title = document.createElementNS(NS, 'title');
    title.textContent = n.op + (n.name ? ' - ' + n.name : '') + (n.attrs.length ? '\n' + n.attrs.join(', ') : '');
    g.appendChild(title);
    svg.appendChild(g);
  }
  const wrap = el('div', { class: 'anr-mlgraph' });
  wrap.appendChild(svg);
  return { wrap, depth: cols.length };
}

function opHistogram(nodes: OnnxNode[]) {
  const counts: Record<string, number> = {};
  for (const n of nodes) counts[n.op] = (counts[n.op] || 0) + 1;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  const t = el('table', { class: 'anr-readout' });
  t.appendChild(el('tr', {}, [el('th', {}, 'Operation'), el('th', {}, 'Count'), el('th', {}, '')]));
  for (const [op, n] of rows.slice(0, 60)) {
    const bar = el('span', { class: 'anr-ent-bar' });
    const fill = el('i', {});
    fill.style.width = Math.max(2, (n / max) * 100) + '%';
    bar.appendChild(fill);
    t.appendChild(el('tr', {}, [el('td', {}, op), el('td', {}, n.toLocaleString()), el('td', {}, [bar])]));
  }
  return { table: t, distinct: rows.length };
}

function tensorTable(tensors: OnnxTensor[], limit = 500) {
  const t = el('table', { class: 'anr-readout' });
  t.appendChild(el('tr', {}, [el('th', {}, 'Tensor'), el('th', {}, 'Type'), el('th', {}, 'Shape'), el('th', {}, 'Parameters')]));
  for (const x of tensors.slice(0, limit)) {
    t.appendChild(el('tr', {}, [
      el('td', {}, x.name || '(unnamed)'),
      el('td', {}, x.dtype || '-'),
      el('td', {}, shapeText(x.dims)),
      el('td', {}, x.params ? x.params.toLocaleString() : '-'),
    ]));
  }
  return t;
}

/* ---- ONNX / TensorFlow ---- */

async function renderGraphModel(file: File, resultsEl: HTMLElement) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Both are protobuf with no self-describing header, so the only way to tell
  // them apart is to try. ONNX first: its ModelProto has scalar fields at the
  // top that a GraphDef does not, so a mis-read fails rather than half-succeeds.
  const model = parseOnnxModel(bytes, ML_NODE_MAX);
  const tf = model && model.graph ? null : parseTfGraphDef(bytes, ML_NODE_MAX);
  const nodes: OnnxNode[] = model && model.graph ? model.graph.nodes : (tf ? tf.nodes : []);
  if (!nodes.length && !model) {
    resultsEl.appendChild(errorCard('Could not read this as an ONNX model or a TensorFlow graph.'));
    return;
  }
  const framework = model && model.graph ? 'ONNX' : 'TensorFlow GraphDef';

  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help(framework === 'ONNX' ? 'ONNX model' : 'TensorFlow graph',
    'A trained model is a computation graph: a list of operations, each taking named tensors in and producing named tensors out. The connections are not stored anywhere - they are recovered by matching those names - and everything below is read from the file in your browser. The weights themselves are not loaded.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Format', framework));
  if (model) {
    if (model.irVersion != null) tbl.appendChild(rowHelp('IR version', String(model.irVersion),
      'The version of the ONNX intermediate representation, which decides what a runtime needs to support to load this at all.'));
    if (model.producer) tbl.appendChild(row('Exported by', model.producer + (model.producerVersion ? ' ' + model.producerVersion : '')));
    if (model.domain) tbl.appendChild(row('Domain', model.domain));
    if (model.modelVersion) tbl.appendChild(row('Model version', model.modelVersion));
    if (model.opsets.length) tbl.appendChild(rowHelp('Opset', model.opsets.map((o) => o.domain + ' v' + o.version).join(', '),
      'The operator-set version the model was written against. A runtime older than this will not have every operation the graph uses.'));
  }
  tbl.appendChild(row('Nodes', nodes.length.toLocaleString()));
  const inits = model && model.graph ? model.graph.initializers : [];
  const totalParams = inits.reduce((s, t) => s + t.params, 0);
  if (inits.length) {
    tbl.appendChild(row('Weight tensors', inits.length.toLocaleString()));
    if (totalParams) tbl.appendChild(rowHelp('Parameters', fmtParams(totalParams) + ' (' + totalParams.toLocaleString() + ')',
      'Every learned number in the model, added up across its weight tensors. This is the figure people mean by a "7B" model.'));
  }
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // Inputs / outputs
  if (model && model.graph && (model.graph.inputs.length || model.graph.outputs.length)) {
    const c = el('div', { class: 'anr-card' });
    const [ih, ihelp] = h3help('Inputs and outputs',
      'What the model expects and what it returns, with the shape of each. A dimension shown as a name rather than a number is dynamic - "batch_size" means the model will take any number of items at once.');
    c.appendChild(ih); c.appendChild(ihelp);
    if (model.graph.inputs.length) {
      c.appendChild(el('div', { class: 'anr-readout-section' }, 'Inputs'));
      c.appendChild(tensorTable(model.graph.inputs, 60));
    }
    if (model.graph.outputs.length) {
      c.appendChild(el('div', { class: 'anr-readout-section' }, 'Outputs'));
      c.appendChild(tensorTable(model.graph.outputs, 60));
    }
    resultsEl.appendChild(c);
  }

  // Diagram
  {
    const c = el('div', { class: 'anr-card' });
    const [gh, ghelp] = h3help('Graph',
      'The computation drawn out, left to right. Each box is one operation and each line an output feeding the next input. A node sits one column further right than the deepest thing it depends on, so parallel branches appear side by side and merge where they rejoin. Hover a box for its full name and settings.');
    c.appendChild(gh); c.appendChild(ghelp);
    if (nodes.length > ML_GRAPH_NODES) {
      c.appendChild(el('p', { class: 'anr-hint' },
        'This graph has ' + nodes.length.toLocaleString() + ' nodes - too many to draw legibly, so the first ' + ML_GRAPH_NODES.toLocaleString() + ' are shown. The tables below cover all of them.'));
    }
    const diagram = buildGraphDiagram(nodes.slice(0, ML_GRAPH_NODES));
    c.appendChild(diagram.wrap);
    c.appendChild(el('p', { class: 'anr-hint' }, diagram.depth + ' layers deep at its longest path.'));
    resultsEl.appendChild(c);
  }

  // Op histogram
  {
    const hist = opHistogram(nodes);
    const c = el('div', { class: 'anr-card' });
    const [oh, ohelp] = h3help('Operations (' + hist.distinct + ' kinds)',
      'What the model is actually made of. The mix is a fingerprint of the architecture: Conv everywhere is a vision model, MatMul and Softmax in a repeating block is a transformer, and a wall of Gemm is a plain fully-connected network.');
    c.appendChild(oh); c.appendChild(ohelp);
    c.appendChild(hist.table);
    resultsEl.appendChild(c);
  }

  // Weights
  if (inits.length) {
    const c = el('div', { class: 'anr-card' });
    const [wh, whelp] = h3help('Weights (' + inits.length.toLocaleString() + ')',
      'The learned tensors baked into the file, with the shape and parameter count of each. Sorted largest first, so the layers carrying the model\'s size come to the top.');
    c.appendChild(wh); c.appendChild(whelp);
    c.appendChild(tensorTable(inits.slice().sort((a, b) => b.params - a.params)));
    if (inits.length > 500) c.appendChild(el('p', { class: 'anr-hint' }, 'Showing the 500 largest of ' + inits.length.toLocaleString() + '.'));
    resultsEl.appendChild(c);
  }

  // Node list
  {
    const c = el('div', { class: 'anr-card' });
    c.appendChild(el('h3', {}, 'Nodes (' + nodes.length.toLocaleString() + ')'));
    const t = el('table', { class: 'anr-readout' });
    t.appendChild(el('tr', {}, [el('th', {}, '#'), el('th', {}, 'Op'), el('th', {}, 'Name'), el('th', {}, 'In'), el('th', {}, 'Out'), el('th', {}, 'Settings')]));
    for (const n of nodes.slice(0, 1000)) {
      t.appendChild(el('tr', {}, [
        el('td', {}, String(n.index)),
        el('td', {}, n.op),
        el('td', {}, n.name || '-'),
        el('td', {}, String(n.inputs.length)),
        el('td', {}, String(n.outputs.length)),
        el('td', {}, n.attrs.slice(0, 4).join(', ') || '-'),
      ]));
    }
    c.appendChild(el('div', { class: 'anr-table-wrap' }, [t]));
    if (nodes.length > 1000) c.appendChild(el('p', { class: 'anr-hint' }, 'Showing the first 1,000.'));
    resultsEl.appendChild(c);
  }

  if (model && model.metadata.length) {
    const c = el('div', { class: 'anr-card' });
    c.appendChild(el('h3', {}, 'Metadata'));
    const t = el('table', { class: 'anr-readout' });
    for (const [k, v] of model.metadata) t.appendChild(row(k, v.length > 300 ? v.slice(0, 300) + '…' : v));
    c.appendChild(t);
    resultsEl.appendChild(c);
  }
  if (model && model.docString) {
    const c = el('div', { class: 'anr-card' });
    c.appendChild(el('h3', {}, 'Description'));
    c.appendChild(preBlock(model.docString.slice(0, 4000)));
    resultsEl.appendChild(c);
  }
}

/* ---- safetensors ---- */

// safetensors: an 8-byte little-endian header length, then that many bytes of
// JSON naming every tensor with its dtype, shape and byte range. The format
// exists precisely so that reading this much does not mean trusting the rest.
async function renderSafetensors(file: File, resultsEl: HTMLElement) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const n = Number(new DataView(head.buffer).getBigUint64(0, true));
  if (!n || n > 200_000_000 || n + 8 > file.size) { resultsEl.appendChild(errorCard('This is not a valid safetensors file.')); return; }
  let meta: any;
  try { meta = JSON.parse(new TextDecoder().decode(new Uint8Array(await file.slice(8, 8 + n).arrayBuffer()))); }
  catch (_) { resultsEl.appendChild(errorCard('The safetensors header is not readable JSON.')); return; }

  const tensors: OnnxTensor[] = [];
  const dtypes: Record<string, number> = {};
  const groups: Record<string, { n: number; params: number }> = {};
  let params = 0;
  for (const [name, t] of Object.entries<any>(meta)) {
    if (name === '__metadata__' || !t || !t.shape) continue;
    const dims: number[] = t.shape;
    const p = dims.length ? dims.reduce((a, b) => a * b, 1) : 1;
    params += p;
    dtypes[t.dtype] = (dtypes[t.dtype] || 0) + 1;
    tensors.push({ name, dtype: String(t.dtype).toLowerCase(), dims, params: p });
    // Group by the prefix before the last two dotted parts - for a transformer
    // that is one entry per block rather than eight per block.
    const parts = name.split('.');
    const key = parts.length > 2 ? parts.slice(0, parts.length - 2).join('.') : name;
    const g = groups[key] || (groups[key] = { n: 0, params: 0 });
    g.n++; g.params += p;
  }

  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Safetensors weights',
    'A weight file, not a model: it holds the learned numbers but nothing about how they are wired together. The format was designed as a safe replacement for pickled PyTorch checkpoints - the header is plain JSON with a length in front of it, so what is in the file can be read without running anything from it.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Tensors', tensors.length.toLocaleString()));
  tbl.appendChild(rowHelp('Parameters', fmtParams(params) + ' (' + params.toLocaleString() + ')',
    'Every learned number in the file. This is the figure a model name like "7B" refers to.'));
  tbl.appendChild(row('Precision', Object.entries(dtypes).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')').join(', ')));
  if (params) tbl.appendChild(rowHelp('Bytes per parameter', (file.size / params).toFixed(2),
    'File size divided by parameter count - which is effectively the precision the weights are stored at: about 4 for float32, 2 for float16 or bfloat16, 1 for 8-bit.'));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  if (meta.__metadata__) {
    const c = el('div', { class: 'anr-card' });
    c.appendChild(el('h3', {}, 'Metadata'));
    const t = el('table', { class: 'anr-readout' });
    for (const [k, v] of Object.entries<any>(meta.__metadata__)) t.appendChild(row(k, String(v).slice(0, 400)));
    c.appendChild(t);
    resultsEl.appendChild(c);
  }

  const groupRows = Object.entries(groups).sort((a, b) => b[1].params - a[1].params);
  if (groupRows.length > 1 && groupRows.length < tensors.length) {
    const c = el('div', { class: 'anr-card' });
    const [gh, ghelp] = h3help('By block (' + groupRows.length + ')',
      'Tensor names in a trained model are paths - "model.layers.12.self_attn.q_proj.weight" - so grouping by the path above the last two parts collapses a repeated transformer block into one row and shows where the parameters actually sit.');
    c.appendChild(gh); c.appendChild(ghelp);
    const t = el('table', { class: 'anr-readout' });
    t.appendChild(el('tr', {}, [el('th', {}, 'Block'), el('th', {}, 'Tensors'), el('th', {}, 'Parameters')]));
    for (const [k, g] of groupRows.slice(0, 300)) {
      t.appendChild(el('tr', {}, [el('td', {}, k), el('td', {}, String(g.n)), el('td', {}, fmtParams(g.params))]));
    }
    c.appendChild(el('div', { class: 'anr-table-wrap' }, [t]));
    resultsEl.appendChild(c);
  }

  const c = el('div', { class: 'anr-card' });
  c.appendChild(el('h3', {}, 'Tensors (' + tensors.length.toLocaleString() + ')'));
  c.appendChild(el('div', { class: 'anr-table-wrap' }, [tensorTable(tensors.slice().sort((a, b) => b.params - a.params))]));
  if (tensors.length > 500) c.appendChild(el('p', { class: 'anr-hint' }, 'Showing the 500 largest of ' + tensors.length.toLocaleString() + '.'));
  resultsEl.appendChild(c);
}

/* ---- GGUF ---- */

const GGML_TYPE: Record<number, string> = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 6: 'Q5_0', 7: 'Q5_1', 8: 'Q8_0', 9: 'Q8_1',
  10: 'Q2_K', 11: 'Q3_K', 12: 'Q4_K', 13: 'Q5_K', 14: 'Q6_K', 15: 'Q8_K',
  16: 'IQ2_XXS', 17: 'IQ2_XS', 18: 'IQ3_XXS', 19: 'IQ1_S', 20: 'IQ4_NL', 21: 'IQ3_S',
  22: 'IQ2_S', 23: 'IQ4_XS', 24: 'I8', 25: 'I16', 26: 'I32', 27: 'I64', 28: 'F64',
  29: 'IQ1_M', 30: 'BF16',
};

async function renderGguf(file: File, resultsEl: HTMLElement) {
  const cap = Math.min(file.size, GGUF_HEADER_MAX);
  const buf = new Uint8Array(await file.slice(0, cap).arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 4;
  const version = dv.getUint32(p, true); p += 4;
  if (version < 2) {
    resultsEl.appendChild(errorCard('This is a GGUF v' + version + ' file. Only v2 and later are read - v1 used 32-bit lengths throughout and is long superseded.'));
    return;
  }
  const u64 = () => { const v = Number(dv.getBigUint64(p, true)); p += 8; return v; };
  const tensorCount = u64();
  const kvCount = u64();

  const str = () => { const n = u64(); const s = new TextDecoder().decode(buf.subarray(p, p + n)); p += n; return s; };
  // GGUF value types 0-12. Arrays (9) carry an element type and a count; a
  // tokenizer vocabulary is one of these and runs to hundreds of thousands of
  // strings, so an array is summarised rather than materialised.
  const readValue = (type: number): string => {
    switch (type) {
      case 0: return String(buf[p++]);
      case 1: return String(dv.getInt8(p++));
      case 2: { const v = dv.getUint16(p, true); p += 2; return String(v); }
      case 3: { const v = dv.getInt16(p, true); p += 2; return String(v); }
      case 4: { const v = dv.getUint32(p, true); p += 4; return String(v); }
      case 5: { const v = dv.getInt32(p, true); p += 4; return String(v); }
      case 6: { const v = dv.getFloat32(p, true); p += 4; return String(Math.round(v * 1e6) / 1e6); }
      case 7: return buf[p++] ? 'true' : 'false';
      case 8: return str();
      case 9: {
        const elem = dv.getUint32(p, true); p += 4;
        const n = u64();
        const preview: string[] = [];
        for (let i = 0; i < n; i++) {
          const v = readValue(elem);
          if (preview.length < 6) preview.push(v);
        }
        return n.toLocaleString() + ' items' + (preview.length ? ' [' + preview.join(', ').slice(0, 120) + (n > preview.length ? ', …' : '') + ']' : '');
      }
      case 10: return u64().toLocaleString();
      case 11: { const v = Number(dv.getBigInt64(p, true)); p += 8; return String(v); }
      case 12: { const v = dv.getFloat64(p, true); p += 8; return String(v); }
      default: return '?';
    }
  };

  const kv: [string, string][] = [];
  let readOk = true;
  try {
    for (let i = 0; i < kvCount; i++) {
      if (p + 12 > buf.length) { readOk = false; break; }
      const key = str();
      const type = dv.getUint32(p, true); p += 4;
      kv.push([key, readValue(type)]);
    }
  } catch (_) { readOk = false; }

  const tensors: OnnxTensor[] = [];
  let params = 0;
  if (readOk) {
    try {
      for (let i = 0; i < tensorCount; i++) {
        if (p + 24 > buf.length) { readOk = false; break; }
        const name = str();
        const nd = dv.getUint32(p, true); p += 4;
        const dims: number[] = [];
        for (let d = 0; d < nd; d++) dims.push(u64());
        const type = dv.getUint32(p, true); p += 4;
        p += 8;                                   // data offset
        const n = dims.length ? dims.reduce((a, b) => a * b, 1) : 0;
        params += n;
        tensors.push({ name, dtype: GGML_TYPE[type] || ('type ' + type), dims, params: n });
      }
    } catch (_) { readOk = false; }
  }

  const find = (k: string) => { const e = kv.find(([key]) => key === k || key.endsWith('.' + k)); return e ? e[1] : null; };
  const arch = find('general.architecture') || find('architecture');

  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('GGUF model',
    'The container llama.cpp uses for quantised models: a self-describing header of key/value metadata followed by the tensors. Everything a runtime needs to load the model - the architecture, the context length, the tokenizer, the chat template - is in that header rather than in a separate config file, which is what makes a GGUF a single portable file.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Format', 'GGUF v' + version));
  if (arch) tbl.appendChild(row('Architecture', arch));
  const nameKv = find('general.name');
  if (nameKv) tbl.appendChild(row('Model name', nameKv));
  const ctx = arch ? find(arch + '.context_length') : null;
  if (ctx) tbl.appendChild(rowHelp('Context length', Number(ctx).toLocaleString() + ' tokens',
    'How much text the model can attend to at once - the longest prompt plus reply it can hold in mind.'));
  const layers = arch ? find(arch + '.block_count') : null;
  if (layers) tbl.appendChild(row('Layers', layers));
  const embd = arch ? find(arch + '.embedding_length') : null;
  if (embd) tbl.appendChild(row('Embedding size', embd));
  tbl.appendChild(row('Tensors', tensorCount.toLocaleString()));
  tbl.appendChild(row('Metadata entries', kvCount.toLocaleString()));
  if (params) {
    tbl.appendChild(rowHelp('Parameters', fmtParams(params) + ' (' + params.toLocaleString() + ')',
      'Every learned number in the model, added up across its tensors.'));
    tbl.appendChild(rowHelp('Bits per parameter', ((file.size * 8) / params).toFixed(2),
      'File size divided by parameter count. It is the practical measure of how hard the model has been quantised: 16 is unquantised half precision, and a Q4 model lands near 4.5 once its metadata is counted.'));
  }
  const quants: Record<string, number> = {};
  for (const t of tensors) quants[t.dtype] = (quants[t.dtype] || 0) + 1;
  if (Object.keys(quants).length) {
    tbl.appendChild(rowHelp('Quantisation', Object.entries(quants).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')').join(', '),
      'The formats the individual tensors are stored in. A mixed list is normal and deliberate: llama.cpp keeps the layers that matter most at higher precision.'));
  }
  card.appendChild(tbl);
  resultsEl.appendChild(card);
  if (!readOk) {
    resultsEl.appendChild(el('p', { class: 'anr-hint' },
      'The header runs past the first ' + fmtBytes(cap) + ' of the file, so the listings below are partial. The counts above come from the file\'s own header and are complete.'));
  }

  if (kv.length) {
    const c = el('div', { class: 'anr-card' });
    const [mh, mhelp] = h3help('Metadata (' + kv.length + ')',
      'Everything the model declares about itself. The tokenizer entries are the large ones - a vocabulary is a list of every token the model knows, so it is summarised by size rather than printed.');
    c.appendChild(mh); c.appendChild(mhelp);
    const t = el('table', { class: 'anr-readout' });
    for (const [k, v] of kv) t.appendChild(row(k, v.length > 400 ? v.slice(0, 400) + '…' : v));
    c.appendChild(el('div', { class: 'anr-table-wrap' }, [t]));
    resultsEl.appendChild(c);
  }

  if (tensors.length) {
    const c = el('div', { class: 'anr-card' });
    c.appendChild(el('h3', {}, 'Tensors (' + tensors.length.toLocaleString() + ')'));
    c.appendChild(el('div', { class: 'anr-table-wrap' }, [tensorTable(tensors.slice().sort((a, b) => b.params - a.params))]));
    resultsEl.appendChild(c);
  }
}

/* ---- PyTorch checkpoints ---- */

// Modules a tensor file has any business importing. Everything else is listed as
// a finding: a pickle can name any callable at all, and unpickling calls it.
const PICKLE_SAFE = /^(torch|collections|numpy|_codecs|__builtin__|builtins|torch\._utils|torch\.storage|torch\.nn|argparse|omegaconf|pytorch_lightning|fractions|typing)\b/;
const PICKLE_DANGEROUS = /^(os|posix|nt|subprocess|sys|shutil|socket|pty|commands|webbrowser|importlib|runpy|pickle|builtins\.(eval|exec|compile|__import__|getattr))\b/;

// Read GLOBAL opcodes out of a pickle stream WITHOUT unpickling it. Two spellings
// exist: the old `c module\nname\n`, and protocol 4's STACK_GLOBAL, which pushes
// the two strings first and then names them with a single 0x93 byte.
function pickleGlobals(buf: Uint8Array) {
  const found = new Set<string>();
  const dec = new TextDecoder('latin1');
  const text = dec.decode(buf);
  for (const m of text.matchAll(/c([A-Za-z_][\w.]{0,80})\n([A-Za-z_][\w.]{0,80})\n/g)) found.add(m[1] + '.' + m[2]);
  // STACK_GLOBAL: SHORT_BINUNICODE module, SHORT_BINUNICODE name, 0x93.
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] !== 0x93) continue;
    const strs: string[] = [];
    let p = i;
    for (let k = 0; k < 2 && p > 2; k++) {
      // Walk back over one SHORT_BINUNICODE (0x8c, length byte, bytes).
      let found2 = false;
      for (let back = 2; back <= 82 && p - back >= 0; back++) {
        const q = p - back;
        if (buf[q] === 0x8c && buf[q + 1] === back - 2 && q + 2 + buf[q + 1] === p) {
          strs.unshift(dec.decode(buf.subarray(q + 2, p)));
          p = q; found2 = true; break;
        }
      }
      if (!found2) break;
    }
    if (strs.length === 2) found.add(strs[0] + '.' + strs[1]);
  }
  return [...found].sort();
}

async function renderPyTorch(file: File, resultsEl: HTMLElement) {
  let zip;
  try { zip = await openZip(file); } catch (_) { zip = null; }

  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('PyTorch checkpoint',
    'A .pt or .pth is a ZIP holding a Python pickle plus the raw tensor storages it refers to. A pickle is not a document - it is a small program describing how to rebuild an object, and loading one runs whatever it says to. Nothing here is executed: the opcodes are read as bytes.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));

  if (!zip || !zip.entries.length) {
    tbl.appendChild(row('Container', 'Raw pickle (pre-1.6 PyTorch, not a ZIP)'));
    card.appendChild(tbl);
    resultsEl.appendChild(card);
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).arrayBuffer());
    appendPickleFindings(resultsEl, pickleGlobals(bytes));
    return;
  }

  const dataEntries = zip.entries.filter((e: any) => /\/data\/\d+$/.test(e.name) || /^data\/\d+$/.test(e.name));
  const pkl = zip.entries.find((e: any) => /data\.pkl$/.test(e.name));
  const versionText = zip.has('version') ? (await zip.text('version')) : null;
  tbl.appendChild(row('Container', 'ZIP (PyTorch 1.6+ format)'));
  if (versionText) tbl.appendChild(row('Serialisation version', versionText.trim()));
  tbl.appendChild(rowHelp('Tensor storages', dataEntries.length.toLocaleString(),
    'The raw blocks of numbers. The pickle beside them says which tensor each block is, what shape it has and what dtype to read it as.'));
  const storageBytes = dataEntries.reduce((s: number, e: any) => s + (e.size || e.uncompressedSize || 0), 0);
  if (storageBytes) tbl.appendChild(row('Weight data', fmtBytes(storageBytes)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  if (pkl) {
    const bytes = await zip.bytes(pkl.name);
    if (bytes) {
      const globals = pickleGlobals(bytes);
      appendPickleFindings(resultsEl, globals);
      // Tensor keys are ordinary strings in the pickle - the keys of the
      // state_dict - so they read out without interpreting the opcodes.
      const text = new TextDecoder('latin1').decode(bytes);
      const keys = [...new Set([...text.matchAll(/[\x8c][\x01-\x50]([A-Za-z_][\w.]{2,78})/g)].map((m) => m[1]))]
        .filter((k) => /\./.test(k) && !/^torch\.|^collections\.|^numpy\./.test(k));
      if (keys.length) {
        const c = el('div', { class: 'anr-card' });
        const [kh, khelp] = h3help('Tensor names (' + keys.length + ')',
          'The keys of the checkpoint\'s state dictionary - the names the model gives its own weights. They are plain strings in the pickle, so they read out without interpreting any of it.');
        c.appendChild(kh); c.appendChild(khelp);
        c.appendChild(preBlock(keys.slice(0, 800).join('\n')));
        resultsEl.appendChild(c);
      }
    }
  }
}

function appendPickleFindings(resultsEl: HTMLElement, globals: string[]) {
  const risky = globals.filter((g) => PICKLE_DANGEROUS.test(g));
  const unusual = globals.filter((g) => !PICKLE_SAFE.test(g) && !PICKLE_DANGEROUS.test(g));
  const c = el('div', { class: 'anr-card' });
  const [h, help] = h3help('What this pickle would import',
    'Unpickling calls whatever the file names. That is the whole of the risk: a checkpoint downloaded from anywhere can name os.system as easily as torch.FloatStorage, and torch.load will call it. These are the module.function pairs found in the opcodes, read as bytes and never run.');
  c.appendChild(h); c.appendChild(help);
  if (risky.length) {
    c.appendChild(el('div', { class: 'anr-pack-signal' },
      'This file names ' + risky.join(', ') + '. A file of numbers has no reason to reach for these, and unpickling it would call them. Treat it as untrusted code, not as data.'));
  }
  if (unusual.length) {
    c.appendChild(el('div', { class: 'anr-pack-signal' },
      'Outside the usual set: ' + unusual.slice(0, 24).join(', ') + (unusual.length > 24 ? ' and ' + (unusual.length - 24) + ' more' : '') +
      '. Not necessarily wrong - a checkpoint often names the classes of the library that trained it - but worth knowing they are there.'));
  }
  if (!risky.length && !unusual.length) {
    c.appendChild(el('p', { class: 'anr-hint' }, globals.length
      ? 'Everything it names is from torch, numpy or the standard collections - what an ordinary checkpoint looks like.'
      : 'No import opcodes found.'));
  }
  if (globals.length) c.appendChild(preBlock(globals.join('\n')));
  resultsEl.appendChild(c);
}

/* ---- Keras ---- */

async function renderKeras(file: File, resultsEl: HTMLElement, ext: string) {
  let config: any = null, meta: any = null, source = '';
  if (ext === 'keras') {
    const zip = await openZip(file);
    try { config = JSON.parse((await zip.text('config.json')) || 'null'); } catch (_) {}
    try { meta = JSON.parse((await zip.text('metadata.json')) || 'null'); } catch (_) {}
    source = 'config.json inside the package';
  } else {
    // Legacy .h5: the architecture is a JSON string in an HDF5 root attribute.
    // Parsing HDF5 to reach it would be a large job for one value that is stored
    // verbatim, so the JSON is located in the bytes and balanced-brace matched.
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, 16 * 1024 * 1024)).arrayBuffer());
    const text = new TextDecoder('latin1').decode(head);
    const at = text.indexOf('{"class_name"');
    if (at >= 0) {
      let depth = 0, endIndex = -1;
      for (let i = at; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (!depth) { endIndex = i + 1; break; } }
      }
      if (endIndex > 0) { try { config = JSON.parse(text.slice(at, endIndex)); } catch (_) {} }
    }
    source = 'the model_config attribute in the HDF5 header';
  }

  const card = el('div', { class: 'anr-card' });
  const [h, help] = h3help('Keras model',
    'Keras stores the architecture as JSON and the weights beside it, so the shape of the network reads out directly - read here from ' + source + '.');
  card.appendChild(h); card.appendChild(help);
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(row('Format', ext === 'keras' ? 'Keras v3 package (.keras)' : 'Keras / HDF5 (.h5)'));
  if (meta && meta.keras_version) tbl.appendChild(row('Keras version', meta.keras_version));
  if (meta && meta.date_saved) tbl.appendChild(row('Saved', meta.date_saved));
  if (config && config.class_name) tbl.appendChild(row('Model type', config.class_name));
  const layers: any[] = (config && config.config && config.config.layers) || [];
  if (layers.length) tbl.appendChild(row('Layers', String(layers.length)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  if (!config) {
    // An .h5 is a general-purpose HDF5 container - Keras is only its commonest
    // use. Say which of the two this is rather than reporting a Keras model
    // with nothing in it.
    const sig = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isHdf5 = sig[0] === 0x89 && sig[1] === 0x48 && sig[2] === 0x44 && sig[3] === 0x46;
    resultsEl.appendChild(el('div', { class: 'anr-card' }, [
      el('p', { class: 'anr-hint' }, isHdf5
        ? 'This is an HDF5 file with no Keras architecture in it. That is either a weights-only save (save_weights writes the numbers but not the model definition) or an ordinary scientific HDF5 dataset, which is a general-purpose container this does not open - only the Keras architecture attribute is read out of one.'
        : 'No architecture JSON found, and the file does not begin with the HDF5 signature either.'),
    ]));
    return;
  }

  if (layers.length) {
    const c = el('div', { class: 'anr-card' });
    const [lh, lhelp] = h3help('Layers (' + layers.length + ')',
      'The network as Keras describes it, in order. Each row is one layer with the settings that define its shape - units, filters, kernel size, activation.');
    c.appendChild(lh); c.appendChild(lhelp);
    const t = el('table', { class: 'anr-readout' });
    t.appendChild(el('tr', {}, [el('th', {}, '#'), el('th', {}, 'Type'), el('th', {}, 'Name'), el('th', {}, 'Settings')]));
    layers.forEach((l, i) => {
      const cfg = l.config || {};
      const bits = ['units', 'filters', 'kernel_size', 'pool_size', 'rate', 'activation', 'strides']
        .filter((k) => cfg[k] != null)
        .map((k) => k + '=' + (Array.isArray(cfg[k]) ? cfg[k].join('x') : cfg[k]));
      t.appendChild(el('tr', {}, [
        el('td', {}, String(i)),
        el('td', {}, l.class_name || '-'),
        el('td', {}, cfg.name || '-'),
        el('td', {}, bits.join(', ') || '-'),
      ]));
    });
    c.appendChild(el('div', { class: 'anr-table-wrap' }, [t]));
    resultsEl.appendChild(c);
  }
}

/* ---- dispatch ---- */

export async function renderMlModel(file: File, resultsEl: HTMLElement) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  try {
    if (ext === 'safetensors') return await renderSafetensors(file, resultsEl);
    if (ext === 'gguf' || ext === 'ggml' || ext === 'ggjt') return await renderGguf(file, resultsEl);
    if (ext === 'pt' || ext === 'pth' || ext === 'ckpt') return await renderPyTorch(file, resultsEl);
    if (ext === 'keras' || ext === 'h5' || ext === 'hdf5') return await renderKeras(file, resultsEl, ext);
    if (file.size > ML_MODEL_MAX) {
      resultsEl.appendChild(errorCard('This model is larger than ' + fmtBytes(ML_MODEL_MAX) + '. The graph is read from the whole file, so it is not opened at that size.'));
      return;
    }
    return await renderGraphModel(file, resultsEl);
  } catch (e) {
    resultsEl.appendChild(errorCard('Could not read this model file.' + (e && (e as Error).message ? ' ' + (e as Error).message : '')));
  }
}
