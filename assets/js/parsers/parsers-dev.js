/* Analyser - lazy parser chunk: developer / data / serialization formats.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'dev'` is opened. Each entry in PARSERS is `({head, file, ext}) => rows`
   where `rows` is a plain object of label->value pairs (rendered as a readout),
   optionally carrying `_sections: [{title, node, open?}]` for collapsible blocks.
   Return null to fall back to the generic identification card. */

import { el, row, fmtBytes, preBlock } from '../core/util.js';
import { Reader, ascii, findBytes } from '../core/binutil.js';
import { parsePlist } from '../lib/plist.js';
import { openZip } from '../renderers/zip.js';

// ---------- small helpers ----------
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlToStr = (s) => new TextDecoder('utf-8').decode(b64urlToBytes(s));

// A simple two-column readout table from an array of [label, value] pairs.
function rowsTable(pairs) {
  const t = el('table', { class: 'anr-readout' });
  for (const [k, v] of pairs) t.appendChild(row(k, String(v)));
  return t;
}

// Unsigned LEB128 from a byte array at cursor {i}.
function uleb(b, cur) { let r = 0, sh = 0, x; do { x = b[cur.i++]; r += (x & 0x7f) * Math.pow(2, sh); sh += 7; } while (x & 0x80); return r; }

// ---------- JSON Web Token ----------
async function parseJwt(file) {
  const text = (await file.text()).trim();
  const parts = text.split('.');
  if (parts.length < 2) return null;
  let header, payload;
  try { header = JSON.parse(b64urlToStr(parts[0])); } catch (_) { return null; }
  try { payload = JSON.parse(b64urlToStr(parts[1])); } catch (_) { payload = null; }
  const out = { 'Token type': 'JSON Web Token' };
  if (header.alg) out['Algorithm'] = header.alg;
  if (header.typ) out['Header typ'] = header.typ;
  if (header.kid) out['Key ID (kid)'] = header.kid;
  out['Signature present'] = parts.length === 3 && parts[2].length ? 'yes' : 'no';
  const claims = [];
  if (payload) {
    const map = { iss: 'Issuer', sub: 'Subject', aud: 'Audience', jti: 'JWT ID', scope: 'Scope', name: 'Name', email: 'Email' };
    for (const [k, label] of Object.entries(map)) if (payload[k] != null) out[label] = Array.isArray(payload[k]) ? payload[k].join(', ') : String(payload[k]);
    for (const [k, label] of [['iat', 'Issued at'], ['nbf', 'Not before'], ['exp', 'Expires']]) {
      if (typeof payload[k] === 'number') out[label] = new Date(payload[k] * 1000).toLocaleString();
    }
    if (typeof payload.exp === 'number') out['Status'] = (payload.exp * 1000 < Date.now()) ? 'EXPIRED' : 'valid';
    for (const [k, v] of Object.entries(payload)) claims.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  }
  const warn = [];
  if (String(header.alg).toLowerCase() === 'none') warn.push('alg: none - token is unsigned (accept with caution)');
  if (out['Status'] === 'EXPIRED') warn.push('Token is expired');
  if (warn.length) out['⚠ Warning'] = warn.join('; ');
  const sections = [{ title: 'Header', node: preBlock(JSON.stringify(header, null, 2)) }];
  if (payload) sections.push({ title: 'Payload claims (' + claims.length + ')', node: preBlock(JSON.stringify(payload, null, 2)), open: true });
  out._sections = sections;
  return out;
}

// ---------- HTTP Archive (.har) ----------
async function parseHar(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { return null; }
  const log = j.log; if (!log) return null;
  const entries = log.entries || [];
  const out = { 'Format': 'HTTP Archive (HAR ' + (log.version || '?') + ')' };
  if (log.creator) out['Creator'] = (log.creator.name || '') + ' ' + (log.creator.version || '');
  out['Requests'] = entries.length;
  let bytes = 0, slow = 0, secrets = 0;
  const status = {}, types = {};
  for (const e of entries) {
    const r = e.response || {};
    bytes += (r.content && r.content.size) || 0;
    if ((e.time || 0) > 1000) slow++;
    const code = r.status || 0; status[code] = (status[code] || 0) + 1;
    const ct = ((r.content && r.content.mimeType) || '').split(';')[0]; if (ct) types[ct] = (types[ct] || 0) + 1;
    const hdrs = ((e.request && e.request.headers) || []).concat((r.headers) || []);
    if (hdrs.some((h) => /^(authorization|cookie|set-cookie)$/i.test(h.name || ''))) secrets++;
  }
  out['Total content size'] = fmtBytes(bytes);
  out['Slow requests (>1s)'] = slow;
  if (secrets) out['⚠ Auth/cookie headers'] = secrets + ' request(s) carry credentials';
  const topStatus = Object.entries(status).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ': ' + v).join('  ');
  const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' (' + v + ')').join('\n');
  out['Status codes'] = topStatus;
  out._sections = [{ title: 'Content types', node: preBlock(topTypes) }];
  return out;
}

// ---------- Jupyter Notebook ----------
async function parseIpynb(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { return null; }
  if (!Array.isArray(j.cells)) return null;
  const out = { 'Format': 'Jupyter Notebook' };
  out['nbformat'] = (j.nbformat || '?') + '.' + (j.nbformat_minor || 0);
  const ks = (j.metadata && j.metadata.kernelspec) || {};
  const li = (j.metadata && j.metadata.language_info) || {};
  if (ks.display_name || ks.name) out['Kernel'] = ks.display_name || ks.name;
  if (li.name) out['Language'] = li.name + (li.version ? ' ' + li.version : '');
  const counts = {}; let codeLines = 0, outputs = 0;
  for (const c of j.cells) {
    counts[c.cell_type] = (counts[c.cell_type] || 0) + 1;
    if (c.cell_type === 'code') {
      codeLines += (Array.isArray(c.source) ? c.source.length : String(c.source || '').split('\n').length);
      outputs += (c.outputs || []).length;
    }
  }
  out['Cells'] = j.cells.length + ' (' + Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', ') + ')';
  out['Code lines'] = codeLines;
  out['Outputs'] = outputs;
  return out;
}

// ---------- JSON Lines / NDJSON ----------
async function parseJsonl(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  let valid = 0; const keys = new Set();
  for (const l of lines.slice(0, 5000)) {
    try { const o = JSON.parse(l); valid++; if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) keys.add(k); } catch (_) {}
  }
  return {
    'Format': 'JSON Lines / NDJSON',
    'Records': lines.length,
    'Valid (first 5k)': valid,
    'Union keys': keys.size + (keys.size ? ': ' + Array.from(keys).slice(0, 20).join(', ') : ''),
  };
}

// ---------- Unified diff / patch ----------
async function parseDiff(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  const files = new Set(); let add = 0, del = 0;
  for (const l of lines) {
    if (l.startsWith('diff --git')) { const m = l.match(/ b\/(.+)$/); if (m) files.add(m[1]); }
    else if (l.startsWith('+++ ')) { const m = l.match(/\+\+\+ b?\/?(.+)$/); if (m && m[1] !== '/dev/null') files.add(m[1].trim()); }
    else if (l.startsWith('+') && !l.startsWith('+++')) add++;
    else if (l.startsWith('-') && !l.startsWith('---')) del++;
  }
  return {
    'Format': 'Unified diff / patch',
    'Files changed': files.size,
    'Additions': '+' + add,
    'Deletions': '-' + del,
    _sections: files.size ? [{ title: 'Files (' + files.size + ')', node: preBlock(Array.from(files).join('\n')) }] : null,
  };
}

// ---------- WebAssembly binary ----------
const WASM_SECTIONS = ['Custom', 'Type', 'Import', 'Function', 'Table', 'Memory', 'Global', 'Export', 'Start', 'Element', 'Code', 'Data', 'DataCount', 'Tag'];
async function parseWasm(file) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 262144)).arrayBuffer());
  if (!(b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d)) return null;
  const version = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
  const out = { 'Format': 'WebAssembly binary', 'Version': version };
  const cur = { i: 8 }; const secCounts = {}; const found = []; let producer = null;
  try {
    while (cur.i < b.length) {
      const id = b[cur.i++];
      const size = uleb(b, cur);
      const end = cur.i + size;
      const name = WASM_SECTIONS[id] || ('id ' + id);
      found.push(name);
      if (id === 2 || id === 3 || id === 7) {           // Import / Function / Export vectors
        const c2 = { i: cur.i }; const n = uleb(b, c2); secCounts[name] = n;
      }
      if (id === 0) {                                    // Custom section - grab its name
        const c2 = { i: cur.i }; const nlen = uleb(b, c2);
        const nm = ascii(b, c2.i, nlen);
        if (/producers|name/.test(nm)) producer = nm;
      }
      cur.i = end;
      if (found.length > 200) break;
    }
  } catch (_) {}
  if (secCounts['Import'] != null) out['Imports'] = secCounts['Import'];
  if (secCounts['Function'] != null) out['Functions'] = secCounts['Function'];
  if (secCounts['Export'] != null) out['Exports'] = secCounts['Export'];
  out['Sections'] = found.join(', ');
  if (producer) out['Custom section'] = producer;
  return out;
}

// ---------- Java .class ----------
const JDK = { 45: '1.1', 46: '1.2', 47: '1.3', 48: '1.4', 49: '5', 50: '6', 51: '7', 52: '8', 53: '9', 54: '10', 55: '11', 56: '12', 57: '13', 58: '14', 59: '15', 60: '16', 61: '17', 62: '18', 63: '19', 64: '20', 65: '21', 66: '22', 67: '23' };
function parseClass(head) {
  if (!(head[0] === 0xCA && head[1] === 0xFE && head[2] === 0xBA && head[3] === 0xBE)) return null;
  const r = new Reader(head); r.skip(4);
  const minor = r.u16(), major = r.u16();
  const cpCount = r.u16();
  return {
    'Format': 'Java class file',
    'Bytecode version': major + '.' + minor + (JDK[major] ? ' (Java ' + JDK[major] + ')' : ''),
    'Constant pool entries': cpCount - 1,
  };
}

// ---------- NumPy .npy ----------
async function parseNpy(file) {
  const b = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  if (!(b[0] === 0x93 && b[1] === 0x4e && b[2] === 0x55 && b[3] === 0x4d && b[4] === 0x50 && b[5] === 0x59)) return null;
  const major = b[6];
  const r = new Reader(b, true); r.seek(8);
  const hlen = major >= 2 ? r.u32() : r.u16();
  const header = new TextDecoder('latin1').decode(b.subarray(r.tell(), r.tell() + hlen));
  const dtype = (header.match(/'descr':\s*'([^']+)'/) || [])[1];
  const fortran = /'fortran_order':\s*True/.test(header);
  const shape = (header.match(/'shape':\s*\(([^)]*)\)/) || [])[1];
  const dims = shape ? shape.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return {
    'Format': 'NumPy array (.npy v' + major + ')',
    'Data type': dtype || '?',
    'Shape': '(' + dims.join(', ') + ')',
    'Elements': dims.reduce((a, d) => a * (parseInt(d, 10) || 1), 1).toLocaleString(),
    'Order': fortran ? 'Fortran (column-major)' : 'C (row-major)',
  };
}

// ---------- Safetensors ----------
async function parseSafetensors(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const r = new Reader(head, true);
  const n = Number(r.u64());
  if (n <= 0 || n > 100_000_000 || n + 8 > file.size) return null;
  let meta; try { meta = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(await file.slice(8, 8 + n).arrayBuffer()))); } catch (_) { return null; }
  const names = Object.keys(meta).filter((k) => k !== '__metadata__');
  const dtypes = {}; let params = 0;
  for (const k of names) {
    const t = meta[k]; if (!t || !t.shape) continue;
    dtypes[t.dtype] = (dtypes[t.dtype] || 0) + 1;
    params += (t.shape.length ? t.shape.reduce((a, b) => a * b, 1) : 0);
  }
  const out = {
    'Format': 'Safetensors',
    'Tensors': names.length,
    'Parameters': params.toLocaleString(),
    'Dtypes': Object.entries(dtypes).map(([k, v]) => k + ' (' + v + ')').join(', '),
  };
  if (meta.__metadata__) out._sections = [{ title: 'Metadata', node: preBlock(JSON.stringify(meta.__metadata__, null, 2)) }];
  return out;
}

// ---------- GGUF (llama.cpp) ----------
async function parseGguf(file) {
  const b = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (ascii(b, 0, 4) !== 'GGUF') return null;
  const r = new Reader(b, true); r.seek(4);
  const version = r.u32();
  const tensorCount = Number(r.u64());
  const kvCount = Number(r.u64());
  return {
    'Format': 'GGUF (GGML model, v' + version + ')',
    'Tensors': tensorCount.toLocaleString(),
    'Metadata entries': kvCount,
    'Note': 'llama.cpp / GGML quantised model container',
  };
}

// ---------- Source map ----------
async function parseSourceMap(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { return null; }
  if (j.version == null || !j.mappings) return null;
  return {
    'Format': 'Source map v' + j.version,
    'Target file': j.file || '-',
    'Original sources': (j.sources || []).length,
    'Names': (j.names || []).length,
    'Embedded source': j.sourcesContent ? 'yes (sourcesContent)' : 'no',
    'Source root': j.sourceRoot || '-',
  };
}

// ---------- SQL dump ----------
async function parseSql(file) {
  const LIMIT = 5_000_000;
  const text = await file.slice(0, Math.min(file.size, LIMIT)).text();
  const truncated = file.size > LIMIT;
  const creates = (text.match(/CREATE\s+TABLE/gi) || []).length;
  const inserts = (text.match(/INSERT\s+INTO/gi) || []).length;
  const views = (text.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW/gi) || []).length;
  const indexes = (text.match(/CREATE\s+(?:UNIQUE\s+)?INDEX/gi) || []).length;
  const triggers = (text.match(/CREATE\s+TRIGGER/gi) || []).length;
  const fks = (text.match(/FOREIGN\s+KEY|\bREFERENCES\s+/gi) || []).length;

  let dialect = 'Generic SQL';
  if (/ENGINE=|AUTO_INCREMENT|`/.test(text)) dialect = 'MySQL / MariaDB';
  else if (/SERIAL\b|pg_catalog|OWNER TO|::|^COPY\s+/im.test(text)) dialect = 'PostgreSQL';
  else if (/PRAGMA|sqlite_sequence|AUTOINCREMENT/.test(text)) dialect = 'SQLite';
  else if (/\bGO\s*$|nvarchar|\[dbo\]|IDENTITY\(/im.test(text)) dialect = 'SQL Server (T-SQL)';

  // Per-table schema: capture each CREATE TABLE name ( ... ) block, then split its
  // body on top-level commas and pull "<column> <type>" from each definition line
  // (skipping table-level constraints).
  const tables = [];
  const reTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"'\[]?([A-Za-z0-9_.]+)[`"'\]]?\s*\(([\s\S]*?)\)\s*(?:ENGINE|DEFAULT|;|WITHOUT|STRICT|AS\b)/gi;
  let m;
  while ((m = reTable.exec(text)) && tables.length < 300) {
    const name = m[1].replace(/^.*\./, '');
    let depth = 0, cur = '';
    const parts = [];
    for (const ch of m[2]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    const cols = parts
      .filter((c) => c && !/^(PRIMARY|FOREIGN|UNIQUE|KEY|CONSTRAINT|CHECK|INDEX)\b/i.test(c))
      .map((c) => {
        const mm = c.match(/^[`"'\[]?([A-Za-z0-9_]+)[`"'\]]?\s+([A-Za-z0-9_]+(?:\s*\([^)]*\))?)/);
        return mm ? mm[1] + '  ' + mm[2].replace(/\s+/g, '') : c.split(/\s+/).slice(0, 2).join('  ');
      });
    tables.push({ name, cols });
  }

  const out = {
    'Format': 'SQL dump' + (truncated ? ' (first 5 MB scanned)' : ''),
    'Dialect': dialect,
    'Tables (CREATE)': creates,
    'INSERT statements': inserts.toLocaleString(),
  };
  if (views) out['Views'] = views;
  if (indexes) out['Indexes'] = indexes;
  if (triggers) out['Triggers'] = triggers;
  if (fks) out['Foreign-key refs'] = fks;

  if (tables.length) {
    const node = el('div', {});
    for (const t of tables) {
      node.appendChild(el('div', { class: 'anr-readout-section' }, t.name + ' (' + t.cols.length + ' columns)'));
      node.appendChild(preBlock(t.cols.join('\n') || '(no columns parsed)'));
    }
    out._sections = [{ title: 'Schema - ' + tables.length + ' table' + (tables.length > 1 ? 's' : ''), node, open: true }];
  }
  return out;
}

// ---------- Visual Studio solution ----------
async function parseSln(file) {
  const text = await file.text();
  const ver = (text.match(/Format Version ([\d.]+)/) || [])[1];
  const projects = Array.from(text.matchAll(/^Project\("\{[^}]+\}"\)\s*=\s*"([^"]+)"/gm)).map((m) => m[1]);
  return {
    'Format': 'Visual Studio Solution',
    'Format version': ver || '?',
    'Projects': projects.length,
    _sections: projects.length ? [{ title: 'Projects', node: preBlock(projects.join('\n')) }] : null,
  };
}

// ---------- .NET project ----------
async function parseDotnetProj(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const sdk = doc.documentElement.getAttribute('Sdk');
  const tf = Array.from(doc.querySelectorAll('TargetFramework, TargetFrameworks')).map((n) => n.textContent).join(', ');
  const pkgs = Array.from(doc.querySelectorAll('PackageReference')).map((n) => (n.getAttribute('Include') || '') + (n.getAttribute('Version') ? ' ' + n.getAttribute('Version') : ''));
  const projRefs = doc.querySelectorAll('ProjectReference').length;
  const outType = (doc.querySelector('OutputType') || {}).textContent;
  const out = {
    'Format': '.NET project (MSBuild)',
    'SDK': sdk || '-',
    'Target framework': tf || '-',
    'Output type': outType || '-',
    'Package references': pkgs.length,
    'Project references': projRefs,
  };
  if (pkgs.length) out._sections = [{ title: 'NuGet packages', node: preBlock(pkgs.join('\n')) }];
  return out;
}

// ---------- Gradle build ----------
async function parseGradle(file) {
  const text = await file.text();
  const plugins = Array.from(text.matchAll(/(?:id\s*[('"]|apply plugin:\s*['"])([\w.-]+)/g)).map((m) => m[1]);
  const deps = (text.match(/^\s*(implementation|api|compile|testImplementation|runtimeOnly|classpath)\b/gm) || []).length;
  return {
    'Format': 'Gradle build script',
    'Plugins': plugins.length + (plugins.length ? ': ' + Array.from(new Set(plugins)).slice(0, 10).join(', ') : ''),
    'Dependency declarations': deps,
  };
}

// ---------- Terraform ----------
async function parseTerraform(file, ext) {
  const text = await file.text();
  if (ext === 'tfstate') {
    let j; try { j = JSON.parse(text); } catch (_) { return null; }
    const byType = {};
    for (const r of (j.resources || [])) byType[r.type] = (byType[r.type] || 0) + (r.instances ? r.instances.length : 1);
    return {
      'Format': 'Terraform state',
      'State version': j.version,
      'Terraform version': j.terraform_version || '-',
      'Serial': j.serial,
      'Resources': (j.resources || []).reduce((a, r) => a + (r.instances ? r.instances.length : 1), 0),
      'Lineage': j.lineage || '-',
    };
  }
  const count = (kw) => (text.match(new RegExp('^\\s*' + kw + '\\s', 'gm')) || []).length;
  return {
    'Format': 'Terraform config (HCL)',
    'resource blocks': count('resource'),
    'data blocks': count('data'),
    'module blocks': count('module'),
    'variable blocks': count('variable'),
    'output blocks': count('output'),
    'provider blocks': count('provider'),
  };
}

// ---------- EditorConfig ----------
async function parseEditorConfig(file) {
  const text = await file.text();
  const root = /^\s*root\s*=\s*true/im.test(text);
  const sections = Array.from(text.matchAll(/^\[(.+)\]/gm)).map((m) => m[1]);
  return {
    'Format': 'EditorConfig',
    'root': root ? 'true' : 'false',
    'Sections (globs)': sections.length,
    _sections: sections.length ? [{ title: 'Globs', node: preBlock(sections.join('\n')) }] : null,
  };
}

// ---------- Protobuf schema ----------
async function parseProto(file) {
  const text = await file.text();
  return {
    'Format': 'Protocol Buffers schema',
    'Syntax': (text.match(/syntax\s*=\s*"([^"]+)"/) || [])[1] || 'proto2',
    'Package': (text.match(/package\s+([\w.]+)/) || [])[1] || '-',
    'Messages': (text.match(/^\s*message\s+\w+/gm) || []).length,
    'Enums': (text.match(/^\s*enum\s+\w+/gm) || []).length,
    'Services': (text.match(/^\s*service\s+\w+/gm) || []).length,
    'RPC methods': (text.match(/^\s*rpc\s+\w+/gm) || []).length,
    'Imports': (text.match(/^\s*import\s+/gm) || []).length,
  };
}

// ---------- GraphQL SDL ----------
async function parseGraphql(file) {
  const text = await file.text();
  const cnt = (kw) => (text.match(new RegExp('^\\s*' + kw + '\\s+\\w+', 'gm')) || []).length;
  return {
    'Format': 'GraphQL schema (SDL)',
    'Types': cnt('type'),
    'Inputs': cnt('input'),
    'Enums': cnt('enum'),
    'Interfaces': cnt('interface'),
    'Scalars': cnt('scalar'),
    'Unions': cnt('union'),
  };
}

// ---------- SARIF ----------
async function parseSarif(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (_) { return null; }
  if (!j.runs) return null;
  const out = { 'Format': 'SARIF ' + (j.version || ''), 'Runs': j.runs.length };
  let results = 0; const tools = new Set(); const sev = {};
  for (const r of j.runs) {
    const td = r.tool && r.tool.driver; if (td) tools.add(td.name + (td.version ? ' ' + td.version : ''));
    for (const res of (r.results || [])) { results++; const s = res.level || 'none'; sev[s] = (sev[s] || 0) + 1; }
  }
  out['Tools'] = Array.from(tools).join(', ');
  out['Results'] = results;
  out['By level'] = Object.entries(sev).map(([k, v]) => k + ': ' + v).join('  ');
  return out;
}

// ---------- Python .pyc ----------
const PYC_MAGIC = { 3394: '3.7', 3413: '3.7', 3420: '3.8', 3425: '3.8', 3430: '3.9', 3439: '3.9', 3450: '3.10', 3495: '3.11', 3531: '3.12', 3571: '3.13' };
function parsePyc(head) {
  const r = new Reader(head, true);
  const magic = r.u16();
  if (head[2] !== 0x0d || head[3] !== 0x0a) return null;
  return {
    'Format': 'Python compiled bytecode',
    'Magic': magic,
    'Python version': PYC_MAGIC[magic] || 'unknown (magic ' + magic + ')',
  };
}

// ---------- Apple plist ----------
async function parsePlistRows(file) {
  const res = await parsePlist(file);
  if (!res) return null;
  const v = res.value;
  const out = { 'Format': 'Property List (' + res.format + ')' };
  const topKeys = (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v) : [];
  if (topKeys.length) out['Root keys'] = topKeys.length;
  for (const k of ['CFBundleIdentifier', 'CFBundleName', 'CFBundleShortVersionString', 'CFBundleVersion', 'PayloadType', 'URL']) {
    if (v && v[k] != null) out[k] = String(v[k]);
  }
  let json; try { json = JSON.stringify(v, (key, val) => (val instanceof Uint8Array ? '<' + val.length + ' bytes>' : val), 2); } catch (_) { json = null; }
  if (json) out._sections = [{ title: 'Contents', node: preBlock(json.length > 20000 ? json.slice(0, 20000) + '\n…' : json) }];
  return out;
}

// ---------- Dependency lockfiles ----------
async function parseLock(file, ext, name) {
  const LIMIT = 8_000_000;
  const text = await file.slice(0, Math.min(file.size, LIMIT)).text();
  const truncated = file.size > LIMIT;
  const fname = (name || '').toLowerCase();
  let ecosystem = 'Unknown', deps = null, lockVer = null;

  if (fname === 'package-lock.json' || (ext === 'json' && /"lockfileVersion"/.test(text))) {
    ecosystem = 'npm (package-lock.json)';
    let j; try { j = JSON.parse(text); } catch (_) { j = null; }
    if (j) {
      lockVer = j.lockfileVersion;
      if (j.packages) deps = Object.keys(j.packages).filter((k) => k).length;          // v2/v3: keys are paths, '' = root
      else if (j.dependencies) deps = Object.keys(j.dependencies).length;               // v1
    }
  } else if (fname === 'yarn.lock' || /^# THIS IS AN AUTOGENERATED FILE/m.test(text) || /^__metadata:/m.test(text)) {
    ecosystem = 'Yarn (yarn.lock)';
    const berry = /^__metadata:/m.test(text);
    lockVer = berry ? '2+ (Berry)' : '1 (Classic)';
    // Each top-level entry is a non-indented line ending in ':' that is not a comment.
    deps = (text.match(/^[^\s#].*:\s*$/gm) || []).length;
  } else if (fname === 'cargo.lock' || /^\[\[package\]\]/m.test(text)) {
    ecosystem = 'Cargo (Cargo.lock)';
    lockVer = (text.match(/^version\s*=\s*(\d+)/m) || [])[1] || null;                    // top-of-file format version
    deps = (text.match(/^\[\[package\]\]/gm) || []).length;
  } else if (fname === 'poetry.lock' || /^\[\[package\]\]/m.test(text)) {
    ecosystem = 'Poetry (poetry.lock)';
    deps = (text.match(/^\[\[package\]\]/gm) || []).length;
  } else if (fname === 'gemfile.lock' || /^GEM\b/m.test(text) || /^DEPENDENCIES\b/m.test(text)) {
    ecosystem = 'Bundler (Gemfile.lock)';
    // Specs are indented 4 spaces under GEM/specs; direct deps live under DEPENDENCIES.
    const direct = (text.match(/^ {2}\w[^\s].*$/gm) || []);
    deps = (text.match(/^ {4}\S+ \(/gm) || []).length || direct.length;
  } else if (fname === 'composer.lock' || (ext === 'json' && /"packages"/.test(text) && /"content-hash"/.test(text))) {
    ecosystem = 'Composer (composer.lock)';
    let j; try { j = JSON.parse(text); } catch (_) { j = null; }
    if (j) deps = (j.packages || []).length + (j['packages-dev'] || []).length;
  } else if (fname === 'pnpm-lock.yaml' || /^lockfileVersion:/m.test(text)) {
    ecosystem = 'pnpm (pnpm-lock.yaml)';
    lockVer = (text.match(/^lockfileVersion:\s*['"]?([\d.]+)/m) || [])[1] || null;
    deps = (text.match(/^ {2}\/[^:]+:/gm) || []).length || (text.match(/^ {2}\S.*:\s*$/gm) || []).length;
  } else if (fname === 'gopkg.lock' || /\[\[projects\]\]/m.test(text)) {
    ecosystem = 'Go dep (Gopkg.lock)';
    deps = (text.match(/^\[\[projects\]\]/gm) || []).length;
  } else if (fname === 'flake.lock' || (ext === 'json' && /"nodes"/.test(text) && /"narHash"/.test(text))) {
    ecosystem = 'Nix flake (flake.lock)';
    let j; try { j = JSON.parse(text); } catch (_) { j = null; }
    if (j && j.nodes) deps = Object.keys(j.nodes).length - 1;                            // minus the synthetic root node
  }

  const out = { 'Format': 'Dependency lockfile' + (truncated ? ' (first 8 MB scanned)' : '') };
  out['Ecosystem'] = ecosystem;
  if (lockVer != null) out['Lockfile version'] = String(lockVer);
  if (deps != null) out['Locked packages'] = deps.toLocaleString();
  const hasIntegrity = /integrity|sha512-|sha256:|narHash|checksum\s*=/.test(text);
  if (hasIntegrity) out['Integrity hashes'] = 'present';
  return out;
}

// ---------- JSON supersets (JSON5 / JSONC / Hjson) ----------
async function parseJsonSuperset(file, ext) {
  const text = await file.text();
  const labels = { json5: 'JSON5', jsonc: 'JSON with Comments (JSONC)', hjson: 'Hjson' };
  // Strip comments crudely so we can count keys without a full lenient parser.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const lineComments = (text.match(/(^|[^:])\/\/[^\n]*/gm) || []).length;
  const blockComments = (text.match(/\/\*[\s\S]*?\*\//g) || []).length;
  const trailingCommas = (text.match(/,\s*[}\]]/g) || []).length;
  // Approximate top-level key count: "key":  /  key:  (Hjson) before first nesting.
  const keys = (stripped.match(/(^|[,{]\s*)("?[A-Za-z_$][\w$-]*"?)\s*:/gm) || []).length;
  const out = {
    'Format': labels[ext] || 'JSON superset',
    'Size': fmtBytes(file.size),
    'Comments': (lineComments + blockComments) + (lineComments + blockComments ? ' (' + lineComments + ' line, ' + blockComments + ' block)' : ''),
    'Trailing commas': trailingCommas,
    'Keys (approx)': keys,
  };
  // Does it parse as strict JSON too? (JSONC/JSON5 often do.)
  let strict = false; try { JSON.parse(text); strict = true; } catch (_) {}
  out['Strict-JSON valid'] = strict ? 'yes' : 'no (uses superset features)';
  return out;
}

// ---------- MessagePack ----------
function mpTypeName(b) {
  if (b <= 0x7f) return 'positive fixint';
  if (b >= 0xe0) return 'negative fixint';
  if (b >= 0x80 && b <= 0x8f) return 'fixmap';
  if (b >= 0x90 && b <= 0x9f) return 'fixarray';
  if (b >= 0xa0 && b <= 0xbf) return 'fixstr';
  const m = {
    0xc0: 'nil', 0xc2: 'false', 0xc3: 'true', 0xc4: 'bin8', 0xc5: 'bin16', 0xc6: 'bin32',
    0xc7: 'ext8', 0xc8: 'ext16', 0xc9: 'ext32', 0xca: 'float32', 0xcb: 'float64',
    0xcc: 'uint8', 0xcd: 'uint16', 0xce: 'uint32', 0xcf: 'uint64', 0xd0: 'int8',
    0xd1: 'int16', 0xd2: 'int32', 0xd3: 'int64', 0xd9: 'str8', 0xda: 'str16', 0xdb: 'str32',
    0xdc: 'array16', 0xdd: 'array32', 0xde: 'map16', 0xdf: 'map32',
  };
  return m[b] || ('fixext/0x' + b.toString(16));
}
async function parseMsgpack(file) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  if (!b.length) return null;
  const r = new Reader(b);            // MessagePack is big-endian
  const counts = {};
  let n = 0;
  // Walk values depth-first, recording a type histogram. Stop after a budget.
  function val() {
    if (r.eof || n > 20000) return;
    n++;
    const c = r.u8();
    const name = mpTypeName(c);
    counts[name] = (counts[name] || 0) + 1;
    if (c <= 0x7f || c >= 0xe0) return;                                   // fixint
    if (c >= 0x80 && c <= 0x8f) { const len = c & 0x0f; for (let i = 0; i < len; i++) { val(); val(); } return; }
    if (c >= 0x90 && c <= 0x9f) { const len = c & 0x0f; for (let i = 0; i < len; i++) val(); return; }
    if (c >= 0xa0 && c <= 0xbf) { r.skip(c & 0x1f); return; }             // fixstr
    switch (c) {
      case 0xc0: case 0xc2: case 0xc3: return;
      case 0xcc: case 0xd0: r.skip(1); return;
      case 0xcd: case 0xd1: r.skip(2); return;
      case 0xca: case 0xce: case 0xd2: r.skip(4); return;
      case 0xcb: case 0xcf: case 0xd3: r.skip(8); return;
      case 0xc4: r.skip(r.u8()); return;
      case 0xc5: r.skip(r.u16()); return;
      case 0xc6: r.skip(r.u32()); return;
      case 0xd9: r.skip(r.u8()); return;
      case 0xda: r.skip(r.u16()); return;
      case 0xdb: r.skip(r.u32()); return;
      case 0xdc: { const len = r.u16(); for (let i = 0; i < len; i++) val(); return; }
      case 0xdd: { const len = r.u32(); for (let i = 0; i < len; i++) val(); return; }
      case 0xde: { const len = r.u16(); for (let i = 0; i < len; i++) { val(); val(); } return; }
      case 0xdf: { const len = r.u32(); for (let i = 0; i < len; i++) { val(); val(); } return; }
      case 0xd4: r.skip(2); return; case 0xd5: r.skip(3); return;
      case 0xd6: r.skip(5); return; case 0xd7: r.skip(9); return; case 0xd8: r.skip(17); return;
      case 0xc7: { const len = r.u8(); r.skip(1 + len); return; }
      case 0xc8: { const len = r.u16(); r.skip(1 + len); return; }
      case 0xc9: { const len = r.u32(); r.skip(1 + len); return; }
      default: return;
    }
  }
  try { val(); } catch (_) {}
  const top = mpTypeName(b[0]);
  const out = {
    'Format': 'MessagePack',
    'Top-level type': top,
    'Values walked': n.toLocaleString() + (n > 20000 ? '+ (budget reached)' : ''),
  };
  const hist = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')');
  if (hist.length) out._sections = [{ title: 'Type histogram', node: preBlock(hist.join('\n')) }];
  return out;
}

// ---------- CBOR ----------
async function parseCbor(file) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  if (!b.length) return null;
  const MAJOR = ['unsigned int', 'negative int', 'byte string', 'text string', 'array', 'map', 'tag', 'simple/float'];
  const r = new Reader(b);            // CBOR is big-endian
  const counts = {}; const tags = {}; let n = 0;
  function argLen(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return r.u8();
    if (ai === 25) return r.u16();
    if (ai === 26) return r.u32();
    if (ai === 27) return Number(r.u64());
    return -1;                        // 31 = indefinite
  }
  function val() {
    if (r.eof || n > 20000) return;
    n++;
    const ib = r.u8();
    const major = ib >> 5, ai = ib & 0x1f;
    counts[MAJOR[major]] = (counts[MAJOR[major]] || 0) + 1;
    if (major === 7) { if (ai === 24) r.skip(1); else if (ai === 25) r.skip(2); else if (ai === 26) r.skip(4); else if (ai === 27) r.skip(8); return; }
    const len = argLen(ai);
    if (major === 0 || major === 1) return;
    if (major === 2 || major === 3) { if (len >= 0) r.skip(len); else while (!r.eof && r.bytes[r.pos] !== 0xff) val(); if (len < 0) r.skip(1); return; }
    if (major === 4) { if (len >= 0) for (let i = 0; i < len; i++) val(); else { while (!r.eof && r.bytes[r.pos] !== 0xff) val(); r.skip(1); } return; }
    if (major === 5) { if (len >= 0) for (let i = 0; i < len; i++) { val(); val(); } else { while (!r.eof && r.bytes[r.pos] !== 0xff) { val(); val(); } r.skip(1); } return; }
    if (major === 6) { tags[len] = (tags[len] || 0) + 1; val(); return; }
  }
  try { val(); } catch (_) {}
  const ib0 = b[0];
  const isSelfDesc = ib0 === 0xd9 && b[1] === 0xd9 && b[2] === 0xf7;     // tag 55799 self-describe magic
  const out = {
    'Format': 'CBOR (Concise Binary Object Representation)',
    'Top-level major type': MAJOR[ib0 >> 5],
    'Items walked': n.toLocaleString() + (n > 20000 ? '+ (budget reached)' : ''),
  };
  if (isSelfDesc) out['Self-describe tag'] = 'present (0xd9d9f7)';
  const hist = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')');
  const tagList = Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([k, v]) => 'tag ' + k + ' (' + v + ')');
  const secs = [];
  if (hist.length) secs.push({ title: 'Major-type histogram', node: preBlock(hist.join('\n')) });
  if (tagList.length) secs.push({ title: 'Tags', node: preBlock(tagList.join('\n')) });
  if (secs.length) out._sections = secs;
  return out;
}

// ---------- BSON ----------
const BSON_TYPES = {
  0x01: 'double', 0x02: 'string', 0x03: 'document', 0x04: 'array', 0x05: 'binary',
  0x06: 'undefined', 0x07: 'ObjectId', 0x08: 'boolean', 0x09: 'UTC datetime', 0x0a: 'null',
  0x0b: 'regex', 0x0c: 'dbpointer', 0x0d: 'JavaScript', 0x0e: 'symbol', 0x0f: 'JS w/scope',
  0x10: 'int32', 0x11: 'timestamp', 0x12: 'int64', 0x13: 'decimal128', 0xff: 'min key', 0x7f: 'max key',
};
async function parseBson(file) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  if (b.length < 5) return null;
  const r = new Reader(b, true);      // BSON is little-endian
  const docLen = r.u32At(0);
  if (docLen < 5 || (docLen > file.size && docLen > b.length)) return null;
  r.seek(4);
  const types = {}; const keys = []; let n = 0;
  try {
    while (!r.eof && n < 5000) {
      const t = r.u8();
      if (t === 0x00) break;
      const name = r.cstr();
      types[BSON_TYPES[t] || ('0x' + t.toString(16))] = (types[BSON_TYPES[t] || ('0x' + t.toString(16))] || 0) + 1;
      if (keys.length < 60) keys.push(name + ' : ' + (BSON_TYPES[t] || '?'));
      n++;
      switch (t) {                                            // skip the value
        case 0x01: case 0x09: case 0x11: case 0x12: r.skip(8); break;
        case 0x10: r.skip(4); break;
        case 0x08: r.skip(1); break;
        case 0x07: r.skip(12); break;
        case 0x13: r.skip(16); break;
        case 0x0a: case 0x06: case 0xff: case 0x7f: break;
        case 0x02: case 0x0d: case 0x0e: { const sl = r.u32(); r.skip(sl); break; }
        case 0x03: case 0x04: case 0x0f: { const sl = r.u32At(r.pos); r.skip(sl); break; }
        case 0x05: { const sl = r.u32(); r.skip(1 + sl); break; }
        case 0x0b: { r.cstr(); r.cstr(); break; }
        default: n = 5000;                                    // unknown type, stop
      }
    }
  } catch (_) {}
  const out = {
    'Format': 'BSON (Binary JSON / MongoDB)',
    'Document length': fmtBytes(docLen),
    'Top-level elements': n,
    'Types': Object.entries(types).map(([k, v]) => k + ' (' + v + ')').join(', '),
  };
  if (keys.length) out._sections = [{ title: 'Elements', node: preBlock(keys.join('\n')) }];
  return out;
}

// ---------- Protobuf wire-format message (.pb / .desc) ----------
function pbWalk(b, start, end, depth, lines, stats) {
  const cur = { i: start };
  const WIRE = ['varint', '64-bit', 'len-delimited', 'start-group', 'end-group', '32-bit'];
  while (cur.i < end && stats.fields < 4000) {
    const tag = uleb(b, cur);
    if (tag === 0 && cur.i >= end) break;
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 0 || wire > 5) return false;                // not protobuf
    stats.fields++;
    let detail = '';
    if (wire === 0) { const v = uleb(b, cur); detail = '= ' + v; }
    else if (wire === 1) { cur.i += 8; detail = '(64-bit)'; }
    else if (wire === 5) { cur.i += 4; detail = '(32-bit)'; }
    else if (wire === 2) {
      const len = uleb(b, cur);
      const s = cur.i, e = cur.i + len;
      if (e > end) return false;
      // Heuristic: printable text vs nested message vs bytes.
      let printable = 0;
      for (let i = s; i < Math.min(e, s + 64); i++) { const c = b[i]; if (c === 9 || c === 10 || (c >= 32 && c < 127)) printable++; }
      const ratio = len ? printable / Math.min(len, 64) : 1;
      if (depth < 6 && len > 1 && ratio < 0.85) {
        // Try to recurse as a nested message.
        const before = stats.fields;
        if (lines.length < 400) lines.push('  '.repeat(depth) + 'field ' + field + ' { (nested ' + len + 'B)');
        const ok = pbWalk(b, s, e, depth + 1, lines, stats);
        if (lines.length < 400) lines.push('  '.repeat(depth) + '}');
        if (!ok) { stats.fields = before; detail = 'len=' + len + (ratio >= 0.5 ? ' "' + ascii(b, s, Math.min(len, 40)) + '"' : ' (bytes)'); cur.i = e; }
        else { cur.i = e; continue; }
      } else {
        detail = ratio >= 0.85 ? '"' + ascii(b, s, Math.min(len, 48)) + (len > 48 ? '…' : '') + '"' : 'len=' + len + ' (bytes)';
        cur.i = e;
      }
    }
    stats.wires[WIRE[wire]] = (stats.wires[WIRE[wire]] || 0) + 1;
    if (lines.length < 400 && wire !== 2) lines.push('  '.repeat(depth) + 'field ' + field + ' ' + WIRE[wire] + ' ' + detail);
    else if (lines.length < 400 && wire === 2 && detail) lines.push('  '.repeat(depth) + 'field ' + field + ' ' + detail);
  }
  return true;
}
async function parsePb(file, ext) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 131072)).arrayBuffer());
  if (!b.length) return null;
  const lines = []; const stats = { fields: 0, wires: {} };
  const ok = pbWalk(b, 0, b.length, 0, lines, stats);
  if (!ok || stats.fields === 0) return null;
  const out = {
    'Format': ext === 'desc' ? 'Protobuf FileDescriptorSet (.desc)' : 'Protobuf wire-format message',
    'Top-level fields': stats.fields.toLocaleString() + (stats.fields >= 4000 ? '+ (budget reached)' : ''),
    'Wire types': Object.entries(stats.wires).map(([k, v]) => k + ' (' + v + ')').join(', '),
    'Note': 'Decoded from the raw wire format - no .proto schema, so field names are unknown.',
  };
  // For a FileDescriptorSet, pull printable strings that look like .proto / type names.
  if (ext === 'desc') {
    const txt = ascii(b, 0, b.length);
    const protos = Array.from(new Set((txt.match(/[\w/.-]+\.proto/g) || []))).slice(0, 40);
    if (protos.length) out['.proto files'] = protos.length;
    out._sections = [];
    if (protos.length) out._sections.push({ title: 'Referenced .proto files', node: preBlock(protos.join('\n')) });
    out._sections.push({ title: 'Wire-format tree', node: preBlock(lines.join('\n')) });
  } else {
    out._sections = [{ title: 'Wire-format tree', node: preBlock(lines.join('\n')), open: true }];
  }
  return out;
}

// ---------- Python pickle ----------
const PICKLE_OPS = {
  0x80: 'PROTO', 0x2e: 'STOP', 0x28: 'MARK', 0x63: 'GLOBAL', 0x93: 'STACK_GLOBAL',
  0x71: 'BINPUT', 0x72: 'LONG_BINPUT', 0x94: 'MEMOIZE', 0x52: 'REDUCE', 0x62: 'BUILD',
  0x6f: 'OBJ', 0x69: 'INST', 0x4e: 'NONE', 0x88: 'NEWTRUE', 0x89: 'NEWFALSE',
};
async function parsePickle(file) {
  const b = new Uint8Array(await file.slice(0, Math.min(file.size, 262144)).arrayBuffer());
  if (!b.length) return null;
  let proto = 0;
  if (b[0] === 0x80) proto = b[1];                            // PROTO opcode carries the version
  else if (!(b[0] === 0x28 || b[0] === 0x63 || b[0] === 0x5d || b[0] === 0x7d || b[0] === 0x7b)) {
    // Doesn't look like a pickle opener (protocol 0/1 start with '(','c','] ','}','{').
    return null;
  }
  const opHist = {}; const globals = []; let scanned = 0;
  const cur = { i: 0 };
  // Light opcode scan: record opcode frequency and capture GLOBAL imports.
  try {
    while (cur.i < b.length && scanned < 50000) {
      const op = b[cur.i++]; scanned++;
      const nm = PICKLE_OPS[op] || ('op 0x' + op.toString(16));
      opHist[nm] = (opHist[nm] || 0) + 1;
      if (op === 0x63) {                                      // GLOBAL: 'module\nname\n'
        let s = ''; while (cur.i < b.length && b[cur.i] !== 0x0a) s += String.fromCharCode(b[cur.i++]);
        cur.i++;
        let nm2 = ''; while (cur.i < b.length && b[cur.i] !== 0x0a) nm2 += String.fromCharCode(b[cur.i++]);
        cur.i++;
        if (globals.length < 60) globals.push(s + '.' + nm2);
      } else if (op === 0x2e) break;                          // STOP
      else if (op === 0x80) cur.i++;                          // PROTO arg
      else if (op === 0x71 || op === 0x42) cur.i++;           // BINPUT / SHORT_BINBYTES-ish 1-byte arg
      // (other opcodes' args are skipped implicitly; this is a histogram, not a VM)
    }
  } catch (_) {}
  const out = {
    'Format': 'Python pickle',
    'Protocol version': proto || '0/1 (text)',
    'Opcodes scanned': scanned.toLocaleString(),
    '⚠ Security': 'Pickle can execute arbitrary code on load - never unpickle untrusted files. (Not executed here.)',
  };
  if (globals.length) out['GLOBAL imports'] = globals.length;
  const secs = [];
  if (globals.length) secs.push({ title: 'GLOBAL imports (module.name)', node: preBlock(Array.from(new Set(globals)).join('\n')), open: true });
  const hist = Object.entries(opHist).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => k + ' (' + v + ')');
  if (hist.length) secs.push({ title: 'Opcode histogram', node: preBlock(hist.join('\n')) });
  if (secs.length) out._sections = secs;
  return out;
}

// ---------- NumPy .npz (ZIP of .npy) ----------
async function parseNpz(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const members = zip.entries.filter((e) => /\.npy$/i.test(e.name));
  if (!members.length) return null;
  const lines = [];
  for (const e of members.slice(0, 200)) {
    let desc = '';
    try {
      const bytes = await zip.bytes(e.name);
      if (bytes && bytes[0] === 0x93 && ascii(bytes, 1, 5) === 'NUMPY') {
        const major = bytes[6];
        const r = new Reader(bytes, true); r.seek(8);
        const hlen = major >= 2 ? r.u32() : r.u16();
        const hdr = new TextDecoder('latin1').decode(bytes.subarray(r.tell(), r.tell() + hlen));
        const dtype = (hdr.match(/'descr':\s*'([^']+)'/) || [])[1] || '?';
        const shape = (hdr.match(/'shape':\s*\(([^)]*)\)/) || [])[1] || '';
        desc = dtype + ' (' + shape.replace(/\s+/g, '') + ')';
      }
    } catch (_) {}
    lines.push(e.name.replace(/\.npy$/i, '') + '  ' + desc);
  }
  return {
    'Format': 'NumPy zipped arrays (.npz)',
    'Arrays': members.length,
    _sections: [{ title: 'Arrays (name  dtype shape)', node: preBlock(lines.join('\n')), open: true }],
  };
}

// ---------- Java archive (.jar / .war / .ear) ----------
async function parseJavaArchive(file, ext) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  if (!zip.entries.length) return null;
  const classes = zip.entries.filter((e) => /\.class$/i.test(e.name));
  const out = {
    'Format': ({ jar: 'Java JAR', war: 'Java Web Archive (WAR)', ear: 'Java Enterprise Archive (EAR)' })[ext] || 'Java archive',
    'Entries': zip.entries.length,
    'Class files': classes.length,
  };
  // Top-level packages (first path segment of class files).
  const pkgs = new Set();
  for (const e of classes) { const seg = e.name.split('/').slice(0, 2).join('.'); if (seg) pkgs.add(seg.replace(/\.class$/i, '')); }
  if (pkgs.size) out['Top packages'] = pkgs.size;
  const manifest = await zip.text('META-INF/MANIFEST.MF');
  const secs = [];
  if (manifest) {
    const get = (k) => (manifest.match(new RegExp('^' + k + ':\\s*(.+)$', 'mi')) || [])[1];
    const main = get('Main-Class'); if (main) out['Main-Class'] = main.trim();
    const sbc = get('Start-Class'); if (sbc) out['Spring Boot Start-Class'] = sbc.trim();
    const jdk = get('Build-Jdk') || get('Build-Jdk-Spec'); if (jdk) out['Build-Jdk'] = jdk.trim();
    const ver = get('Implementation-Version') || get('Bundle-Version'); if (ver) out['Version'] = ver.trim();
    if (/Spring-Boot-Version/i.test(manifest)) out['Spring Boot'] = (get('Spring-Boot-Version') || 'yes').trim();
    secs.push({ title: 'MANIFEST.MF', node: preBlock(manifest.slice(0, 4000)) });
  }
  if (zip.entries.some((e) => /^META-INF\/.*\.(RSA|DSA|EC|SF)$/i.test(e.name))) out['Signed'] = 'yes (signature in META-INF)';
  if (pkgs.size) secs.unshift({ title: 'Top-level packages', node: preBlock(Array.from(pkgs).slice(0, 80).join('\n')) });
  if (secs.length) out._sections = secs;
  return out;
}

// ---------- Text IDL schemas: FlatBuffers / Thrift / Cap'n Proto / HCL ----------
async function parseFbs(file) {
  const text = await file.text();
  const cnt = (kw) => (text.match(new RegExp('^\\s*' + kw + '\\s+\\w+', 'gm')) || []).length;
  return {
    'Format': 'FlatBuffers schema (.fbs)',
    'Namespace': (text.match(/namespace\s+([\w.]+)/) || [])[1] || '-',
    'Tables': cnt('table'),
    'Structs': cnt('struct'),
    'Enums': cnt('enum'),
    'Unions': cnt('union'),
    'root_type': (text.match(/root_type\s+([\w.]+)/) || [])[1] || '-',
  };
}
async function parseThrift(file) {
  const text = await file.text();
  const cnt = (kw) => (text.match(new RegExp('^\\s*' + kw + '\\s+\\w+', 'gm')) || []).length;
  const services = Array.from(text.matchAll(/^\s*service\s+(\w+)/gm)).map((m) => m[1]);
  return {
    'Format': 'Apache Thrift IDL (.thrift)',
    'Namespaces': (text.match(/^\s*namespace\s+/gm) || []).length,
    'Structs': cnt('struct'),
    'Enums': cnt('enum'),
    'Exceptions': cnt('exception'),
    'Unions': cnt('union'),
    'Typedefs': cnt('typedef'),
    'Services': services.length + (services.length ? ': ' + services.join(', ') : ''),
    'Methods': (text.match(/^\s*\w[\w<>, .]*\s+\w+\s*\(/gm) || []).length,
  };
}
async function parseCapnp(file) {
  const text = await file.text();
  const cnt = (kw) => (text.match(new RegExp('^\\s*' + kw + '\\s+\\w+', 'gm')) || []).length;
  return {
    'Format': "Cap'n Proto schema (.capnp)",
    'File ID': (text.match(/@0x([0-9a-fA-F]+)\s*;/) || [])[1] ? '0x' + (text.match(/@0x([0-9a-fA-F]+)\s*;/) || [])[1] : '-',
    'Structs': cnt('struct'),
    'Enums': cnt('enum'),
    'Interfaces': cnt('interface'),
    'Consts': cnt('const'),
    'Annotations': cnt('annotation'),
  };
}
async function parseHcl(file) {
  const text = await file.text();
  // Generic HCL: count top-level blocks by their leading keyword.
  const blocks = {};
  for (const m of text.matchAll(/^\s*([a-zA-Z_]\w*)\s+(?:"[^"]*"\s*)*\{/gm)) blocks[m[1]] = (blocks[m[1]] || 0) + 1;
  const total = Object.values(blocks).reduce((a, b) => a + b, 0);
  let tool = 'Generic HCL';
  if (/\bresource\s+"|\bprovider\s+"|\bterraform\s*\{/.test(text)) tool = 'Terraform';
  else if (/\bjob\s+"|\btask\s+"|\bgroup\s+"/.test(text)) tool = 'Nomad';
  else if (/\bpath\s+"|\bsecret\s+"/.test(text)) tool = 'Vault / Consul';
  else if (/\bbuild\s*\{|\bsource\s+"/.test(text)) tool = 'Packer';
  const out = {
    'Format': 'HashiCorp HCL',
    'Tool (guess)': tool,
    'Total blocks': total,
    'Attributes (approx)': (text.match(/^\s*[a-zA-Z_]\w*\s*=/gm) || []).length,
  };
  const list = Object.entries(blocks).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')');
  if (list.length) out._sections = [{ title: 'Block types', node: preBlock(list.join('\n')) }];
  return out;
}

// ---------- MATLAB MAT-file ----------
async function parseMat(file) {
  const b = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  // v7.3 MAT-files are HDF5 (\x89HDF\r\n\x1a\n at offset 0 ... actually MATLAB writes a
  // 128-byte text header then HDF5). Detect by the text header mentioning HDF5.
  const headText = new TextDecoder('latin1').decode(b.subarray(0, 116)).replace(/\0+$/, '').trim();
  if (b[0] === 0x89 && b[1] === 0x48 && b[2] === 0x44 && b[3] === 0x46) {
    return { 'Format': 'MATLAB MAT-file v7.3 (HDF5)', 'Note': 'HDF5-based; variable list needs an HDF5 reader (not parsed here).' };
  }
  if (!/MATLAB/i.test(headText)) return null;
  const r = new Reader(b, true);
  r.seek(124);
  const verRaw = r.u16();
  const endian = r.ascii(2);                  // 'IM' (LE) or 'MI' (BE)
  const little = endian === 'IM';
  const out = {
    'Format': 'MATLAB MAT-file v5',
    'Header': headText,
    'Version flag': '0x' + verRaw.toString(16).padStart(4, '0'),
    'Byte order': little ? 'little-endian (IM)' : 'big-endian (MI)',
  };
  if (/HDF5/i.test(headText)) out['Format'] = 'MATLAB MAT-file v7.3 (HDF5)';
  return out;
}

// ---------- Redis RDB dump ----------
async function parseRdb(file) {
  const b = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  if (ascii(b, 0, 5) !== 'REDIS') return null;
  const ver = ascii(b, 5, 4);
  const out = {
    'Format': 'Redis RDB dump',
    'RDB version': ver,
  };
  // Scan early opcodes for aux fields (0xFA) and SELECTDB (0xFE).
  const aux = []; let dbs = 0;
  const cur = { i: 9 };
  function rstr() {                                          // length-prefixed string (subset of RDB encodings)
    if (cur.i >= b.length) return null;
    const first = b[cur.i++]; const type = (first & 0xc0) >> 6;
    let len;
    if (type === 0) len = first & 0x3f;
    else if (type === 1) { len = ((first & 0x3f) << 8) | b[cur.i++]; }
    else if (type === 2) { len = (b[cur.i] << 24) | (b[cur.i + 1] << 16) | (b[cur.i + 2] << 8) | b[cur.i + 3]; cur.i += 4; }
    else { cur.i += 1; return '(int-encoded)'; }             // special encoding, skip 1 byte approx
    const s = ascii(b, cur.i, Math.min(len, 64)); cur.i += len; return s;
  }
  try {
    let guard = 0;
    while (cur.i < b.length && guard++ < 50) {
      const op = b[cur.i];
      if (op === 0xfa) { cur.i++; const k = rstr(); const v = rstr(); if (k != null && aux.length < 20) aux.push(k + ' = ' + v); }
      else if (op === 0xfe) { cur.i++; dbs++; const num = b[cur.i] < 0xc0 ? (b[cur.i] & 0x3f) : 0; cur.i++; }
      else break;
    }
  } catch (_) {}
  if (aux.length) out['Aux fields'] = aux.length;
  if (aux.length) out._sections = [{ title: 'Aux metadata', node: preBlock(aux.join('\n')) }];
  return out;
}

// ---------- Apache Arrow / Feather IPC ----------
async function parseArrow(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  // Arrow IPC file: "ARROW1\0\0" at the start (and end). Feather v2 = same. Feather v1 = "FEA1".
  if (ascii(head, 0, 6) === 'ARROW1') {
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 6), file.size).arrayBuffer());
    const footerOk = ascii(tail, 0, 6) === 'ARROW1';
    return {
      'Format': 'Apache Arrow IPC file (Feather v2)',
      'Magic': 'ARROW1',
      'Footer magic': footerOk ? 'ARROW1 (valid)' : 'missing',
      'Note': 'Columnar IPC container; schema/record-batches are FlatBuffer-encoded (not decoded here).',
    };
  }
  if (ascii(head, 0, 4) === 'FEA1') {
    return { 'Format': 'Apache Arrow Feather v1', 'Magic': 'FEA1', 'Note': 'Legacy Feather format.' };
  }
  // Streaming format starts with a 0xFFFFFFFF continuation marker - identify loosely.
  if (head[0] === 0xff && head[1] === 0xff && head[2] === 0xff && head[3] === 0xff) {
    return { 'Format': 'Apache Arrow IPC stream', 'Note': 'Streaming IPC (no file magic); schema is FlatBuffer-encoded.' };
  }
  return null;
}

// ---------- Apache Parquet ----------
async function parseParquet(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 8), file.size).arrayBuffer());
  if (ascii(head, 0, 4) !== 'PAR1' && ascii(head, 0, 4) !== 'PARE') return null;
  const tailMagic = ascii(tail, 4, 4);
  const encrypted = ascii(head, 0, 4) === 'PARE' || tailMagic === 'PARE';
  // The 4 bytes before the trailing magic are the little-endian footer (metadata) length.
  const r = new Reader(tail, true);
  const footerLen = r.u32At(0);
  const out = {
    'Format': 'Apache Parquet' + (encrypted ? ' (encrypted)' : ''),
    'Head magic': ascii(head, 0, 4),
    'Tail magic': tailMagic + (tailMagic === 'PAR1' || tailMagic === 'PARE' ? ' (valid)' : ' (invalid)'),
    'Footer (Thrift metadata) size': fmtBytes(footerLen),
    'File size': fmtBytes(file.size),
    'Note': 'Columnar store; the Thrift footer holds the schema, row groups and column stats (not decoded here).',
  };
  return out;
}

// ---------- Apache ORC ----------
async function parseOrc(file) {
  // ORC ends with: ...PostScript, then 1 byte = PostScript length, then "ORC".
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 4), file.size).arrayBuffer());
  const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  const tailMagic = ascii(tail, tail.length - 3, 3);
  const headMagic = ascii(head, 0, 3);
  if (tailMagic !== 'ORC' && headMagic !== 'ORC') return null;
  const psLen = tail[tail.length - 4];
  return {
    'Format': 'Apache ORC (Optimised Row Columnar)',
    'Head magic': headMagic === 'ORC' ? 'ORC' : '(none)',
    'Tail magic': tailMagic === 'ORC' ? 'ORC (valid)' : '(missing)',
    'PostScript length': psLen + ' bytes',
    'File size': fmtBytes(file.size),
    'Note': 'Hive columnar format; the protobuf footer/PostScript holds schema, stripe and row counts (not decoded here).',
  };
}

// ---------- dispatch ----------
// PowerShell scripts (.ps1), modules (.psm1) and data files (.psd1). Pulls the
// comment-based help synopsis, #Requires directives, function/parameter counts,
// CmdletBinding and the Authenticode signature marker; .psd1 manifests surface a
// few well-known keys. The generic text path still shows the source below this.
async function parsePowerShell(file, ext) {
  const text = await file.text();
  const out = {};
  out['Format'] = ext === 'psm1' ? 'PowerShell module' : ext === 'psd1' ? 'PowerShell data file (manifest)' : 'PowerShell script';

  // #Requires directives.
  const requires = (text.match(/^\s*#Requires\b.*$/gim) || []).map((s) => s.replace(/^\s*#Requires\s+/i, '').trim());
  const psVer = (text.match(/#Requires\s+-Version\s+([\d.]+)/i) || [])[1];
  if (psVer) out['Min PowerShell'] = psVer;
  if (/#Requires\s+-RunAsAdministrator/i.test(text)) out['Elevation'] = 'Requires administrator';
  const reqModules = [...text.matchAll(/#Requires\s+-Modules\s+([^\r\n]+)/gi)].map((m) => m[1].trim());
  if (reqModules.length) out['Required modules'] = reqModules.join('; ');

  // Comment-based help synopsis (the first .SYNOPSIS block).
  const synMatch = text.match(/\.SYNOPSIS\s*\r?\n([\s\S]*?)(?:\r?\n\s*\.[A-Z]|#>|$)/i);
  if (synMatch) {
    const syn = synMatch[1].split(/\r?\n/).map((l) => l.replace(/^\s*#?\s?/, '').trim()).filter(Boolean).join(' ').trim();
    if (syn) out['Synopsis'] = syn.length > 200 ? syn.slice(0, 200) + '…' : syn;
  }

  // Functions, parameters, advanced-function marker.
  const funcs = [...text.matchAll(/^\s*function\s+([A-Za-z_][\w-]*)/gim)].map((m) => m[1]);
  if (funcs.length) out['Functions'] = String(funcs.length);
  const paramAttrs = (text.match(/\[Parameter[^\]]*\]/gi) || []).length;
  if (paramAttrs) out['Parameters'] = String(paramAttrs);
  if (/\[CmdletBinding\s*\(/i.test(text)) out['Advanced function'] = 'Yes (CmdletBinding)';
  if (/#\s*SIG\s*#\s*Begin signature block/i.test(text)) out['Digitally signed'] = 'Yes (Authenticode)';

  // .psd1 manifest well-known keys.
  if (ext === 'psd1') {
    const key = (k) => (text.match(new RegExp(k + "\\s*=\\s*'([^']+)'", 'i')) || [])[1];
    const mv = key('ModuleVersion'); if (mv) out['Module version'] = mv;
    const au = key('Author'); if (au) out['Author'] = au;
    const rm = key('RootModule') || key('ModuleToProcess'); if (rm) out['Root module'] = rm;
    const gd = key('GUID'); if (gd) out['GUID'] = gd;
  }

  if (funcs.length) {
    out._sections = [{ title: `Functions (${funcs.length})`, node: preBlock(funcs.join('\n')) }];
  }
  return out;
}

// Windows batch / command scripts (.bat / .cmd). Surfaces the leading comment,
// echo state, label (subroutine / goto target) count, variables set, the
// external tools it shells out to, and a few common constructs. The generic text
// path still shows the source below this.
async function parseBatch(file, ext) {
  const text = await file.text();
  const out = {};
  out['Format'] = ext === 'cmd' ? 'Windows command script' : 'Windows batch script';

  // First REM / :: comment line as a description.
  for (const l of text.replace(/\r/g, '').split('\n')) {
    const m = l.match(/^\s*(?:@?REM|::)\s+(\S.*)/i);
    if (m) { const d = m[1].trim(); out['Description'] = d.length > 160 ? d.slice(0, 160) + '…' : d; break; }
  }

  out['Echo'] = /^\s*@?echo\s+off\b/im.test(text) ? 'Off' : 'On';
  if (/^\s*setlocal\b/im.test(text)) out['Setlocal'] = 'Yes';

  const labels = [...text.matchAll(/^\s*:([A-Za-z0-9_.-]+)/gm)].map((m) => m[1]).filter((l) => l.toLowerCase() !== 'eof');
  if (labels.length) out['Labels'] = String(labels.length);
  const sets = (text.match(/^\s*set\s+["/]?\w/gim) || []).length;
  if (sets) out['Variables set'] = String(sets);
  if (/%ERRORLEVEL%|\berrorlevel\b/i.test(text)) out['Checks errorlevel'] = 'Yes';

  // External programs / interpreters it shells out to.
  const tools = [];
  for (const t of ['powershell', 'pwsh', 'cscript', 'wscript', 'python', 'node', 'npm', 'git', 'curl', 'robocopy', 'xcopy', 'reg', 'schtasks', 'wmic', 'msiexec', 'taskkill', 'tasklist', 'ssh', 'docker']) {
    if (new RegExp('\\b' + t + '\\b', 'i').test(text)) tools.push(t);
  }
  if (tools.length) out['Invokes'] = tools.join(', ');

  return out;
}

// ---------- ONNX model (.onnx) ----------
// ONNX models are protobuf-encoded ModelProto messages. Without the schema we
// scan the top-level fields we care about: ir_version (1, varint), producer_name
// (2, string), producer_version (3, string), domain (4), model_version (5),
// opset_import (8). Enough to identify the framework that exported the model.
const ONNX_IR = { 3: '1.1', 4: '1.5', 5: '1.6', 6: '1.7', 7: '1.9', 8: '1.11', 9: '1.13', 10: '1.15', 11: '1.17' };
async function parseOnnx(file) {
  const buf = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  let p = 0;
  const varint = () => { let shift = 0, v = 0n; while (p < buf.length) { const b = buf[p++]; v |= BigInt(b & 0x7f) << BigInt(shift); if (!(b & 0x80)) break; shift += 7; } return v; };
  const out = { 'Format': 'ONNX model (.onnx)', 'Type': 'Open Neural Network Exchange' };
  let opsets = 0;
  try {
    while (p < buf.length) {
      const key = Number(varint());
      const field = key >> 3, wire = key & 7;
      if (field === 0 || field > 20) break;
      if (wire === 0) {                       // varint
        const v = varint();
        if (field === 1) out['IR version'] = ONNX_IR[Number(v)] ? ONNX_IR[Number(v)] + ' (ir ' + v + ')' : 'ir ' + v;
        if (field === 5) out['Model version'] = String(v);
      } else if (wire === 2) {                // length-delimited
        const len = Number(varint());
        if (len < 0 || p + len > buf.length) { p += Math.max(0, len); if (field !== 2 && field !== 3 && field !== 4) continue; else break; }
        const slice = buf.subarray(p, p + len); p += len;
        if (field === 2) out['Exported by'] = ascii(slice, 0, slice.length);
        else if (field === 3) out['Producer version'] = ascii(slice, 0, slice.length);
        else if (field === 4 && slice.length) out['Domain'] = ascii(slice, 0, slice.length);
        else if (field === 8) opsets++;       // opset_import (count them)
      } else if (wire === 5) { p += 4; }
      else if (wire === 1) { p += 8; }
      else break;
    }
  } catch (_) {}
  if (opsets) out['Opset imports'] = opsets + (opsets >= 1 ? '+ (in header)' : '');
  out['Note'] = 'A trained neural-network graph in the framework-neutral ONNX format (PyTorch, TensorFlow, scikit-learn and others export to it). Protobuf-encoded; header scanned in-browser.';
  return out;
}

// ---------- Native module (.node) / dynamic library (.dylib) ----------
const MACHO_CPU = { 7: 'x86', 0x01000007: 'x86-64', 12: 'ARM', 0x0100000c: 'ARM64', 0x01000012: 'PowerPC64' };
async function parseNativeBinary(file, ext) {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const dv = new DataView(head.buffer);
  const be = dv.getUint32(0, false);
  const label = ext === 'dylib' ? 'macOS dynamic library (.dylib)' : 'Native add-on module (.node)';
  const out = { 'Format': label };
  if (be === 0xFEEDFACE || be === 0xFEEDFACF) {            // thin Mach-O (BE magic written LE)
    out['Container'] = 'Mach-O (' + (be === 0xFEEDFACF ? '64-bit' : '32-bit') + ')';
    const cpu = dv.getUint32(4, true);
    if (MACHO_CPU[cpu]) out['Architecture'] = MACHO_CPU[cpu];
    out['Platform'] = 'macOS';
  } else if (be === 0xCAFEBABE || be === 0xCAFEBABF) {     // fat / universal Mach-O
    out['Container'] = 'Mach-O universal (fat)';
    out['Architectures'] = dv.getUint32(4, false);
    out['Platform'] = 'macOS';
  } else if (head[0] === 0x4D && head[1] === 0x5A) {       // PE
    out['Container'] = 'PE / DLL';
    out['Platform'] = 'Windows';
  } else if (head[0] === 0x7F && head[1] === 0x45 && head[2] === 0x4C && head[3] === 0x46) {  // ELF
    out['Container'] = 'ELF';
    out['Platform'] = 'Linux';
  }
  out['Note'] = ext === 'node'
    ? 'A compiled native Node.js / Electron add-on - a platform-specific shared library loaded via require(). The container (Mach-O / PE / ELF) reveals the OS it was built for.'
    : 'A Mach-O shared library loaded by macOS apps at runtime (the Apple equivalent of a Windows .dll / Linux .so).';
  return out;
}

// ---------- LevelDB table (.ldb) ----------
async function parseLevelDb(file) {
  if (file.size < 8) return null;
  const foot = new Uint8Array(await file.slice(file.size - 8, file.size).arrayBuffer());
  // LevelDB/RocksDB table footer magic 0xdb4775248b80fb57 (stored little-endian).
  const ok = foot[0] === 0x57 && foot[1] === 0xfb && foot[2] === 0x80 && foot[3] === 0x8b &&
             foot[4] === 0x24 && foot[5] === 0x75 && foot[6] === 0x47 && foot[7] === 0xdb;
  if (!ok) return { 'Format': 'LevelDB table (.ldb)', 'Note': 'Expected LevelDB footer magic not found - this .ldb may be an Access lock file or a different store.' };
  return {
    'Format': 'LevelDB SSTable (.ldb)',
    'Footer magic': '0xdb4775248b80fb57',
    'Note': 'A sorted-string table from a LevelDB / RocksDB key-value store (used by Chrome, Electron, Discord, IndexedDB and many apps). Immutable on-disk segment; keys/values are block-compressed.',
  };
}

// ---------- Git packfile reverse index (.rev) ----------
async function parseGitRev(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (ascii(head, 0, 4) !== 'RIDX') return null;
  const dv = new DataView(head.buffer);
  const version = dv.getUint32(4, false);
  const hashId = dv.getUint32(8, false);
  return {
    'Format': 'Git pack reverse index (.rev)',
    'Version': version,
    'Hash function': hashId === 1 ? 'SHA-1' : hashId === 2 ? 'SHA-256' : 'id ' + hashId,
    'Note': 'Maps a pack\'s objects from pack-position order to index (SHA) order, so Git can answer "what is at offset N" quickly. Pairs with the .idx / .pack in .git/objects/pack.',
  };
}

// ---------- Microsoft / OMG IDL (.idl) ----------
// Interface Definition Language: COM/OLE type libraries (MIDL) and CORBA/OMG.
// Walk the declarations and surface interfaces, coclasses, the type library and
// the import list. The text itself is shown by the parse:'text' source preview.
async function parseIdl(file) {
  const text = (await file.text()).slice(0, 2_000_000);
  if (!/\b(interface|coclass|library|dispinterface|import|importlib|module|typedef)\b/.test(text)) return null;
  const names = (re) => [...text.matchAll(re)].map((m) => m[1]);
  const interfaces = names(/\b(?:interface|dispinterface)\s+([A-Za-z_]\w*)/g);
  const coclasses = names(/\bcoclass\s+([A-Za-z_]\w*)/g);
  const libs = names(/\blibrary\s+([A-Za-z_]\w*)/g);
  const imports = [...text.matchAll(/\bimport(?:lib)?\s*(?:\(\s*)?["']([^"']+)["']/g)].map((m) => m[1]);
  const uuids = (text.match(/\buuid\s*\(/gi) || []).length;
  const methods = (text.match(/\bHRESULT\b/g) || []).length;
  const ms = /import\s+["']oaidl|["']ocidl|\bdispinterface\b|\bcoclass\b/.test(text);
  const out = {
    'Format': ms ? 'Microsoft COM / OLE interface definition (MIDL .idl)' : 'Interface Definition Language (.idl)',
    'Interfaces': interfaces.length,
  };
  if (coclasses.length) out['Coclasses'] = coclasses.length;
  if (libs.length) out['Type library'] = [...new Set(libs)].join(', ');
  if (uuids) out['GUIDs declared'] = uuids;
  if (methods) out['HRESULT methods'] = methods;
  if (imports.length) out['Imports'] = [...new Set(imports)].slice(0, 12).join(', ');
  const secs = [];
  if (interfaces.length) secs.push({ title: 'Interfaces (' + interfaces.length + ')', node: preBlock([...new Set(interfaces)].slice(0, 200).join('\n')) });
  if (coclasses.length) secs.push({ title: 'Coclasses (' + coclasses.length + ')', node: preBlock([...new Set(coclasses)].join('\n')) });
  if (secs.length) out._sections = secs;
  return out;
}

// ---------- Classic ASP (.asp) ----------
// Active Server Pages: server-side code blocks (<% %>) plus the server language
// from the <%@ Language %> directive or <script runat=server>. Distinct from the
// .NET .aspx page already handled.
async function parseAsp(file) {
  const text = (await file.text()).slice(0, 2_000_000);
  const codeBlocks = (text.match(/<%[^@=]/g) || []).length;
  const exprBlocks = (text.match(/<%=/g) || []).length;
  const serverScripts = [...text.matchAll(/<script[^>]*runat\s*=\s*["']?server/gi)].length;
  const includes = [...text.matchAll(/<!--\s*#include\s+(?:file|virtual)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  if (!codeBlocks && !exprBlocks && !serverScripts && !includes.length && !/<%@/.test(text)) return null;
  const dir = text.match(/<%@\s*([^%]*?)%>/);
  let lang = dir && (dir[1].match(/Language\s*=\s*["']?([A-Za-z]+)/i) || [])[1];
  if (!lang) { const sl = text.match(/<script[^>]*language\s*=\s*["']?([A-Za-z]+)/i); if (sl) lang = sl[1]; }
  const out = {
    'Format': 'Classic ASP page (Active Server Pages)',
    'Server language': lang || 'VBScript (default)',
  };
  if (codeBlocks) out['Server code blocks'] = codeBlocks;
  if (exprBlocks) out['Inline expressions (<%=)'] = exprBlocks;
  if (serverScripts) out['Server <script> blocks'] = serverScripts;
  if (includes.length) out['Server-side includes'] = includes.length + ': ' + includes.slice(0, 8).join(', ');
  return out;
}

// ---------- pkg-config (.pc) ----------
// The metadata file pkg-config reads to emit compiler/linker flags for a library.
async function parsePkgConfig(file) {
  const text = (await file.text()).slice(0, 200_000);
  if (!/^\s*(Name|Description|Version|Cflags|Libs)\s*:/mi.test(text)) return null;
  const field = (k) => { const m = text.match(new RegExp('^\\s*' + k + '\\s*:\\s*(.+)$', 'mi')); return m ? m[1].trim() : null; };
  const vars = [...text.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*.+$/gm)].map((m) => m[1]);
  const out = { 'Format': 'pkg-config metadata (.pc)' };
  for (const k of ['Name', 'Description', 'Version', 'URL', 'Requires', 'Requires.private', 'Conflicts', 'Libs', 'Libs.private', 'Cflags']) {
    const v = field(k); if (v) out[k] = v;
  }
  if (vars.length) out['Variables'] = [...new Set(vars)].join(', ');
  return out;
}

// ---------- DraStic shader (.dsd) ----------
// The Nintendo DS emulator's GLSL ES shader bundle: <vertex> and <fragment>
// sections wrapping shader source. (Unrelated to DSD audio, which is .dsf/.dff.)
async function parseDsdShader(file) {
  const text = (await file.text()).slice(0, 500_000);
  const hasV = /<vertex>/i.test(text), hasF = /<fragment>/i.test(text);
  if (!hasV && !hasF) return null;
  const out = {
    'Format': 'DraStic shader (GLSL ES)',
    'Stages': [hasV && 'vertex', hasF && 'fragment'].filter(Boolean).join(' + '),
  };
  const defines = (text.match(/^\s*#define\b/gm) || []).length;
  const uniforms = (text.match(/\buniform\b/g) || []).length;
  const attribs = (text.match(/\battribute\b/g) || []).length;
  const varyings = (text.match(/\bvarying\b/g) || []).length;
  if (defines) out['#define directives'] = defines;
  if (uniforms) out['Uniforms'] = uniforms;
  if (attribs) out['Attributes'] = attribs;
  if (varyings) out['Varyings'] = varyings;
  return out;
}

// ---------- generic template (.template) ----------
// A text file with ${...} / @...@ placeholders meant to be substituted at build
// time (CMake configure, Meson, autotools, CI templates). Surfaces the engine
// (Meson recognised by its project() call) and the placeholders it expects.
async function parseTemplate(file) {
  const text = (await file.text()).slice(0, 500_000);
  const ph = [...new Set([...text.matchAll(/\$\{(\w+)\}|@(\w+)@/g)].map((m) => m[1] || m[2]))];
  const isMeson = /\bproject\s*\(/.test(text) && /\bmeson|get_compiler|dependency\b/.test(text);
  const isCMake = /@\w+@/.test(text) && /cmake/i.test(text);
  const out = {
    'Format': isMeson ? 'Meson build template' : isCMake ? 'CMake configure template' : 'Text template (placeholder substitution)',
  };
  if (ph.length) out['Placeholders'] = ph.length + ': ' + ph.slice(0, 16).join(', ');
  return out;
}

export const PARSERS = {
  idl: (c) => parseIdl(c.file),
  asp: (c) => parseAsp(c.file),
  pc: (c) => parsePkgConfig(c.file),
  dsd: (c) => parseDsdShader(c.file),
  template: (c) => parseTemplate(c.file),
  onnx: (c) => parseOnnx(c.file),
  node: (c) => parseNativeBinary(c.file, c.ext),
  dylib: (c) => parseNativeBinary(c.file, c.ext),
  ldb: (c) => parseLevelDb(c.file),
  rev: (c) => parseGitRev(c.file),
  ps1: (c) => parsePowerShell(c.file, c.ext),
  psm1: (c) => parsePowerShell(c.file, c.ext),
  psd1: (c) => parsePowerShell(c.file, c.ext),
  bat: (c) => parseBatch(c.file, c.ext),
  cmd: (c) => parseBatch(c.file, c.ext),
  jwt: (c) => parseJwt(c.file),
  har: (c) => parseHar(c.file),
  ipynb: (c) => parseIpynb(c.file),
  jsonl: (c) => parseJsonl(c.file),
  ndjson: (c) => parseJsonl(c.file),
  diff: (c) => parseDiff(c.file),
  patch: (c) => parseDiff(c.file),
  wasm: (c) => parseWasm(c.file),
  class: (c) => parseClass(c.head),
  npy: (c) => parseNpy(c.file),
  safetensors: (c) => parseSafetensors(c.file),
  gguf: (c) => parseGguf(c.file),
  map: (c) => parseSourceMap(c.file),
  sql: (c) => parseSql(c.file),
  dump: (c) => parseSql(c.file),
  lock: (c) => parseLock(c.file, c.ext, c.file && c.file.name),
  json5: (c) => parseJsonSuperset(c.file, c.ext),
  jsonc: (c) => parseJsonSuperset(c.file, c.ext),
  hjson: (c) => parseJsonSuperset(c.file, c.ext),
  msgpack: (c) => parseMsgpack(c.file),
  mpk: (c) => parseMsgpack(c.file),
  cbor: (c) => parseCbor(c.file),
  bson: (c) => parseBson(c.file),
  pb: (c) => parsePb(c.file, c.ext),
  desc: (c) => parsePb(c.file, c.ext),
  pkl: (c) => parsePickle(c.file),
  pickle: (c) => parsePickle(c.file),
  npz: (c) => parseNpz(c.file),
  jar: (c) => parseJavaArchive(c.file, c.ext),
  war: (c) => parseJavaArchive(c.file, c.ext),
  ear: (c) => parseJavaArchive(c.file, c.ext),
  fbs: (c) => parseFbs(c.file),
  thrift: (c) => parseThrift(c.file),
  capnp: (c) => parseCapnp(c.file),
  hcl: (c) => parseHcl(c.file),
  mat: (c) => parseMat(c.file),
  rdb: (c) => parseRdb(c.file),
  arrow: (c) => parseArrow(c.file),
  feather: (c) => parseArrow(c.file),
  parquet: (c) => parseParquet(c.file),
  orc: (c) => parseOrc(c.file),
  sln: (c) => parseSln(c.file),
  csproj: (c) => parseDotnetProj(c.file),
  vbproj: (c) => parseDotnetProj(c.file),
  fsproj: (c) => parseDotnetProj(c.file),
  vcxproj: (c) => parseDotnetProj(c.file),
  gradle: (c) => parseGradle(c.file),
  tf: (c) => parseTerraform(c.file, c.ext),
  tfstate: (c) => parseTerraform(c.file, c.ext),
  editorconfig: (c) => parseEditorConfig(c.file),
  proto: (c) => parseProto(c.file),
  graphql: (c) => parseGraphql(c.file),
  gql: (c) => parseGraphql(c.file),
  sarif: (c) => parseSarif(c.file),
  pyc: (c) => parsePyc(c.head),
  plist: (c) => parsePlistRows(c.file),
};
