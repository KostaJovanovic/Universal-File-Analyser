/* Analyser - lazy parser chunk: security / crypto / keys / certs / auth / forensics.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'security'` is opened. Each entry in PARSERS is `({head, file, ext}) => rows`
   where `rows` is a plain object of label->value pairs (rendered as a readout),
   optionally carrying `_sections: [{title, node, open?}]` for collapsible blocks
   or `_previewNode`. Return null to fall back to the generic identification card.

   Dependency-free: PEM/CMS/text parsing is done by hand; SHA-256 fingerprints use
   the platform crypto.subtle. p12/pfx, kdbx, evtx, pf, hive, dmp, e01, etl are
   identification-only because they need real ASN.1 / proprietary binary walkers. */

import { el, row, fmtBytes, preBlock, fmtDate } from '../core/util.js';
import { Reader, ascii, findBytes, latin1, utf8, fmtGuid, filetimeToDate } from '../core/binutil.js';
import { parsePlist } from '../lib/plist.js';
import { openZip, inflateToText } from '../renderers/zip.js';

// ---------- small helpers ----------

// Base64 (standard alphabet) -> Uint8Array, tolerant of whitespace.
function b64ToBytes(s) {
  s = s.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// SHA-256 of bytes -> base64 (OpenSSH fingerprint style, no padding). async.
async function sha256b64(bytes) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return 'SHA256:' + bytesToB64(new Uint8Array(buf)).replace(/=+$/, '');
  } catch (_) { return null; }
}

// Read the whole file as text (capped) - most security formats here are small.
async function readText(file, cap = 2_000_000) {
  return await file.slice(0, Math.min(file.size, cap)).text();
}

// ---------- PEM keys: .key / .pub / .p8 ----------
const PEM_RE = /-----BEGIN ([A-Z0-9 ]+?)-----/;

function pemKind(banner) {
  const b = banner.toUpperCase();
  if (b.includes('OPENSSH PRIVATE')) return { type: 'OpenSSH', scheme: 'OpenSSH', priv: true };
  if (b.includes('RSA PRIVATE')) return { type: 'RSA', scheme: 'PKCS#1', priv: true };
  if (b.includes('EC PRIVATE')) return { type: 'EC', scheme: 'SEC1', priv: true };
  if (b.includes('DSA PRIVATE')) return { type: 'DSA', scheme: 'PKCS#1', priv: true };
  if (b.includes('ENCRYPTED PRIVATE')) return { type: 'PKCS#8 (encrypted)', scheme: 'PKCS#8', priv: true };
  if (b.includes('PRIVATE')) return { type: 'PKCS#8', scheme: 'PKCS#8', priv: true };
  if (b.includes('RSA PUBLIC')) return { type: 'RSA', scheme: 'PKCS#1', priv: false };
  if (b.includes('PUBLIC')) return { type: 'public key', scheme: 'SubjectPublicKeyInfo', priv: false };
  return { type: banner, scheme: '-', priv: /PRIVATE/.test(b) };
}

// OpenSSH single-line public key: "ssh-rsa AAAA... comment"
async function parseOpenSshPub(text) {
  const m = text.trim().match(/^((?:ssh|ecdsa|sk)-[\w@.-]+)\s+([A-Za-z0-9+/=]+)(?:\s+(.*))?$/);
  if (!m) return null;
  const algo = m[1], blob = m[2], comment = (m[3] || '').trim();
  const out = {
    'Format': 'OpenSSH public key',
    'Key type': algo,
  };
  if (comment) out['Comment'] = comment;
  try {
    const raw = b64ToBytes(blob);
    out['Blob size'] = fmtBytes(raw.length);
    const fp = await sha256b64(raw);
    if (fp) out['Fingerprint'] = fp;
  } catch (_) {}
  return out;
}

async function parsePemKey(file, ext) {
  const text = await readText(file, 200_000);

  // .pub may be an OpenSSH one-liner rather than PEM.
  if (!PEM_RE.test(text)) {
    if (ext === 'pub') return await parseOpenSshPub(text);
    return null;
  }
  const banner = text.match(PEM_RE)[1].trim();
  const kind = pemKind(banner);
  const out = {
    'Format': 'PEM ' + banner.toLowerCase(),
    'Key type': kind.type,
    'Encoding': kind.scheme,
  };

  // Encrypted legacy PEM (Proc-Type / DEK-Info) - PKCS#1 with header cipher.
  const dek = text.match(/DEK-Info:\s*([A-Z0-9-]+)/i);
  const procEnc = /Proc-Type:\s*\d+,\s*ENCRYPTED/i.test(text);
  if (procEnc || dek) {
    out['Encrypted'] = 'yes';
    if (dek) out['Cipher'] = dek[1];
  } else if (/ENCRYPTED PRIVATE/i.test(banner)) {
    out['Encrypted'] = 'yes (PKCS#8 PBES)';
  } else {
    out['Encrypted'] = 'no';
  }

  // OpenSSH PEM container can hold its own cipher line in the binary body; flag it.
  if (kind.scheme === 'OpenSSH' && out['Encrypted'] === 'no') {
    try {
      const body = b64ToBytes(text.replace(/-----[^-]+-----/g, ''));
      const txt = latin1(body.subarray(0, 200));
      const cm = txt.match(/(aes\d{3}-[a-z0-9-]+|3des-cbc|chacha20-poly1305@openssh\.com)/);
      if (cm) { out['Encrypted'] = 'yes'; out['Cipher'] = cm[1]; }
    } catch (_) {}
  }

  // Count PEM objects (a .key may bundle several).
  const objs = (text.match(/-----BEGIN /g) || []).length;
  if (objs > 1) out['PEM objects'] = objs;

  if (kind.priv) out['⚠ Warning'] = 'Contains a PRIVATE key - keep secret, do not share';
  return out;
}

// ---------- .p8 (PKCS#8) ----------
async function parseP8(file) {
  const text = await readText(file, 200_000);
  const m = text.match(PEM_RE);
  if (!m) return null;
  const banner = m[1].trim();
  const encrypted = /ENCRYPTED/i.test(banner);
  const out = {
    'Format': 'PKCS#8 key (' + banner.toLowerCase() + ')',
    'Encoding': 'PKCS#8',
    'Encrypted': encrypted ? 'yes (PBES2)' : 'no',
    'Note': 'Often an Apple service key (APNs / MusicKit / DeviceCheck) or generic private key',
  };
  if (/PRIVATE/i.test(banner)) out['⚠ Warning'] = 'Contains a PRIVATE key - keep secret';
  return out;
}

// ---------- PEM identify-only: .csr / .crl / .p7b / .p7c ----------
async function parsePemIdentify(file, label, banners, note) {
  const text = await readText(file, 500_000);
  const m = text.match(PEM_RE);
  if (!m) return null;
  const banner = m[1].trim().toUpperCase();
  if (!banners.some((b) => banner.includes(b))) return null;
  const out = { 'Format': label, 'PEM banner': m[1].trim() };
  if (note) out['Note'] = note;

  // Best-effort: pull a CN out of the printable ASN.1 body for CSR/CRL.
  try {
    const body = b64ToBytes(text.replace(/-----[^-]+-----/g, ''));
    const printable = ascii(body);
    const cn = printable.match(/([A-Za-z0-9.*\- ]{2,})\.(com|net|org|io|dev|co|gov|edu|local)/);
    if (cn) out['Subject hint'] = cn[0];
    out['DER size'] = fmtBytes(body.length);
  } catch (_) {}
  return out;
}

// ---------- .ppk (PuTTY) ----------
async function parsePpk(file) {
  const text = await readText(file, 500_000);
  const m = text.match(/^PuTTY-User-Key-File-(\d+):\s*(.+)$/m);
  if (!m) return null;
  const out = {
    'Format': 'PuTTY private key (.ppk)',
    'Format version': m[1],
    'Algorithm': m[2].trim(),
  };
  const enc = text.match(/^Encryption:\s*(.+)$/m);
  if (enc) out['Encryption'] = enc[1].trim();
  const comment = text.match(/^Comment:\s*(.+)$/m);
  if (comment) out['Comment'] = comment[1].trim();
  const pubLines = text.match(/^Public-Lines:\s*(\d+)$/m);
  if (pubLines) out['Public-key lines'] = pubLines[1];
  out['Encrypted'] = (enc && !/^none$/i.test(enc[1].trim())) ? 'yes' : 'no';
  out['⚠ Warning'] = 'Contains a PRIVATE key - keep secret';
  return out;
}

// ---------- .ovpn (OpenVPN) ----------
async function parseOvpn(file) {
  const text = await readText(file, 1_000_000);
  if (!/^\s*(client|remote|dev\s+tun|dev\s+tap|tls-auth|proto)\b/m.test(text)) return null;
  const out = { 'Format': 'OpenVPN profile (.ovpn)' };
  const remotes = Array.from(text.matchAll(/^\s*remote\s+(\S+)(?:\s+(\d+))?(?:\s+(\S+))?/gm))
    .map((m) => m[1] + (m[2] ? ':' + m[2] : '') + (m[3] ? '/' + m[3] : ''));
  if (remotes.length) out['Remote endpoints'] = remotes.length;
  const proto = (text.match(/^\s*proto\s+(\S+)/m) || [])[1];
  if (proto) out['Protocol'] = proto;
  const dev = (text.match(/^\s*dev\s+(\S+)/m) || [])[1];
  if (dev) out['Device'] = dev;
  const cipher = (text.match(/^\s*(?:data-ciphers|cipher)\s+(.+)$/m) || [])[1];
  if (cipher) out['Cipher'] = cipher.trim();
  const auth = (text.match(/^\s*auth\s+(\S+)/m) || [])[1];
  if (auth) out['Auth digest'] = auth;
  if (/^\s*(comp-lzo|compress)\b/m.test(text)) out['Compression'] = 'enabled';
  const inline = [];
  for (const tag of ['cert', 'key', 'ca', 'tls-auth', 'tls-crypt']) {
    if (new RegExp('<' + tag + '>', 'i').test(text)) inline.push(tag);
  }
  if (inline.length) out['Inline blocks'] = inline.join(', ');
  if (inline.includes('key') || inline.includes('tls-auth') || inline.includes('tls-crypt')) {
    out['⚠ Warning'] = 'Embeds private key / TLS secret material - keep confidential';
  }
  if (remotes.length) out._sections = [{ title: 'Remotes (' + remotes.length + ')', node: preBlock(remotes.join('\n')) }];
  return out;
}

// ---------- WireGuard: .wg / .conf ----------
async function parseWireguard(file, ext) {
  const text = await readText(file, 200_000);
  const hasIface = /^\s*\[Interface\]/im.test(text);
  const hasKeys = /^\s*(PrivateKey|PublicKey)\s*=/im.test(text);
  // .conf could be anything; only claim it when it really looks like WireGuard.
  if (ext === 'conf' && !(hasIface && hasKeys)) return null;
  if (!hasIface) return null;
  const peers = (text.match(/^\s*\[Peer\]/gim) || []).length;
  const out = {
    'Format': 'WireGuard configuration',
    'Peers': peers,
  };
  const listen = (text.match(/^\s*ListenPort\s*=\s*(\d+)/im) || [])[1];
  if (listen) out['ListenPort'] = listen;
  const dns = (text.match(/^\s*DNS\s*=\s*(.+)$/im) || [])[1];
  if (dns) out['DNS'] = dns.trim();
  const endpoints = Array.from(text.matchAll(/^\s*Endpoint\s*=\s*(.+)$/gim)).map((m) => m[1].trim());
  if (endpoints.length) out['Endpoints'] = endpoints.join(', ');
  const allowed = Array.from(text.matchAll(/^\s*AllowedIPs\s*=\s*(.+)$/gim)).map((m) => m[1].trim());
  if (allowed.length) out['AllowedIPs'] = allowed.join('; ');
  if (/^\s*PrivateKey\s*=/im.test(text)) out['⚠ Warning'] = 'Contains a PrivateKey - keep secret';
  return out;
}

// ---------- Java KeyStore: .jks / .keystore / .jceks ----------
function parseJks(head) {
  if (head.length < 8) return null;
  const r = new Reader(head);          // big-endian
  const magic = r.u32();
  let type;
  if (magic === 0xFEEDFEED) type = 'JKS';
  else if (magic === 0xCECECECE) type = 'JCEKS';
  else return null;
  const version = r.u32();
  const out = {
    'Format': 'Java KeyStore',
    'Keystore type': type,
    'Version': version,
  };
  if (head.length >= 12) {
    const count = r.u32();
    if (count >= 0 && count < 1_000_000) out['Aliases (entries)'] = count;
  }
  out['Note'] = 'Password-protected store of keys/certificates (Oracle JKS / JCEKS)';
  return out;
}

// ---------- known_hosts / authorized_keys ----------
async function parseSshKeyDb(file, ext) {
  const text = await readText(file, 1_000_000);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return null;
  const algos = {};
  let hashed = 0, certs = 0;
  for (const l of lines) {
    if (l.includes('|1|')) hashed++;
    const m = l.match(/((?:ssh|ecdsa|sk)-[\w@.-]+)/);
    if (m) algos[m[1]] = (algos[m[1]] || 0) + 1;
    if (/-cert-v01@openssh\.com/.test(l)) certs++;
  }
  const out = {
    'Format': ext === 'authorized_keys' ? 'OpenSSH authorized_keys' : 'OpenSSH known_hosts',
    'Entries': lines.length,
    'Key algorithms': Object.entries(algos).map(([k, v]) => k + ' (' + v + ')').join(', ') || '-',
  };
  if (hashed) out['Hashed host names'] = hashed + ' entr' + (hashed === 1 ? 'y' : 'ies');
  if (certs) out['Certificates'] = certs;
  return out;
}

// ---------- .mobileconfig (Apple config profile) ----------
async function parseMobileconfig(file) {
  const res = await parsePlist(file);
  if (!res || !res.value || typeof res.value !== 'object') return null;
  const v = res.value;
  const out = { 'Format': 'Apple Configuration Profile (.mobileconfig)' };
  if (v.PayloadDisplayName) out['Name'] = String(v.PayloadDisplayName);
  if (v.PayloadOrganization) out['Organization'] = String(v.PayloadOrganization);
  if (v.PayloadIdentifier) out['Identifier'] = String(v.PayloadIdentifier);
  if (v.PayloadUUID) out['UUID'] = String(v.PayloadUUID);
  const payloads = Array.isArray(v.PayloadContent) ? v.PayloadContent : [];
  out['Payloads'] = payloads.length;
  const types = payloads.map((p) => (p && p.PayloadType) || '?');
  if (types.length) out['Payload types'] = Array.from(new Set(types)).join(', ');
  // A signed .mobileconfig is CMS-wrapped (not raw plist) - parsePlist would have
  // failed, so reaching here means unsigned XML/binary.
  out['Signed'] = res.format === 'binary' ? '(binary plist)' : 'no (plain plist)';
  if (types.length) out._sections = [{ title: 'Payload types', node: preBlock(types.join('\n')) }];
  return out;
}

// ---------- .mobileprovision (CMS-wrapped plist) ----------
async function parseMobileprovision(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 4_000_000)).arrayBuffer());
  const txt = latin1(buf);
  const start = txt.indexOf('<?xml');
  const end = txt.indexOf('</plist>');
  if (start < 0 || end < 0) return null;
  const xml = txt.slice(start, end + 8);
  const res = await parsePlist(new TextEncoder().encode(xml));
  if (!res || !res.value) return null;
  const v = res.value;
  const out = { 'Format': 'Apple Provisioning Profile (.mobileprovision)' };
  if (v.Name) out['Name'] = String(v.Name);
  if (v.AppIDName) out['App ID name'] = String(v.AppIDName);
  if (v.TeamName) out['Team name'] = String(v.TeamName);
  if (Array.isArray(v.TeamIdentifier)) out['Team ID'] = v.TeamIdentifier.join(', ');
  if (v.CreationDate) out['Created'] = fmtDate(v.CreationDate);
  if (v.ExpirationDate) {
    const d = v.ExpirationDate instanceof Date ? v.ExpirationDate : new Date(v.ExpirationDate);
    out['Expires'] = fmtDate(d);
    if (d instanceof Date && !isNaN(d)) out['Status'] = d < new Date() ? 'EXPIRED' : 'valid';
  }
  if (v.ProvisionsAllDevices) out['Provisions all devices'] = 'yes';
  if (Array.isArray(v.ProvisionedDevices)) out['Provisioned UDIDs'] = v.ProvisionedDevices.length;
  const ent = v.Entitlements;
  if (ent && typeof ent === 'object') {
    if (ent['application-identifier']) out['Application identifier'] = String(ent['application-identifier']);
    if (ent['get-task-allow'] != null) out['get-task-allow'] = String(ent['get-task-allow']);
    if (ent['aps-environment']) out['APS environment'] = String(ent['aps-environment']);
  }
  return out;
}

// ---------- .reg (Windows registry export) ----------
async function parseReg(file) {
  const text = await readText(file, 2_000_000);
  if (!/^\s*(Windows Registry Editor Version|REGEDIT4)/m.test(text)) return null;
  const verLine = (text.match(/^\s*(Windows Registry Editor Version [\d.]+|REGEDIT4)/m) || [])[1];
  const keys = Array.from(text.matchAll(/^\s*\[(-?)(HKEY[^\]]+)\]/gm));
  const values = (text.match(/^\s*(?:"[^"]*"|@)\s*=/gm) || []).length;
  const types = {};
  for (const m of text.matchAll(/=\s*(dword|qword|hex(?:\([0-9a-fA-F]+\))?|"[^"]*")/g)) {
    let t = m[1];
    if (t.startsWith('"')) t = 'string';
    else if (t.startsWith('hex')) t = 'hex/binary';
    types[t] = (types[t] || 0) + 1;
  }
  const out = {
    'Format': 'Windows Registry export',
    'Version': verLine || '-',
    'Keys': keys.length,
    'Values': values,
  };
  const deletions = keys.filter((m) => m[1] === '-').length;
  if (deletions) out['Key deletions'] = deletions;
  if (Object.keys(types).length) out['Value types'] = Object.entries(types).map(([k, v]) => k + ': ' + v).join('  ');
  const autorun = keys.filter((m) => /\\(Run|RunOnce|RunServices|Winlogon|Userinit|Shell)\b/i.test(m[2]));
  if (autorun.length) out['⚠ Autorun / persistence keys'] = autorun.length + ' (Run/RunOnce/Winlogon/...)';
  const keyList = keys.map((m) => (m[1] === '-' ? '[DEL] ' : '') + m[2]);
  if (keyList.length) out._sections = [{ title: 'Keys (' + keyList.length + ')', node: preBlock(keyList.slice(0, 500).join('\n')) }];
  return out;
}

// ---------- pcap / pcapng (basic header) ----------
const PCAP_LINKTYPES = { 0: 'NULL', 1: 'Ethernet', 6: 'Token Ring', 105: '802.11', 113: 'Linux SLL', 127: '802.11 radiotap', 228: 'IPv4', 229: 'IPv6', 276: 'Linux SLL2' };
function parsePcap(head) {
  if (head.length < 24) return null;
  const r0 = new Reader(head);
  const be = r0.u32At(0);
  let little, nano = false;
  if (be === 0xA1B2C3D4) { little = false; }
  else if (be === 0xD4C3B2A1) { little = true; }
  else if (be === 0xA1B23C4D) { little = false; nano = true; }
  else if (be === 0x4D3CB2A1) { little = true; nano = true; }
  else return null;
  const r = new Reader(head, little);
  r.seek(4);
  const major = r.u16(), minor = r.u16();
  r.skip(8);                 // reserved / thiszone + sigfigs
  const snaplen = r.u32();
  const linkRaw = r.u32();
  const link = linkRaw & 0xFFFF;
  return {
    'Format': 'libpcap capture (.pcap)',
    'Byte order': little ? 'little-endian' : 'big-endian',
    'Timestamp resolution': nano ? 'nanosecond' : 'microsecond',
    'Version': major + '.' + minor,
    'Snap length': snaplen,
    'Link-layer type': (PCAP_LINKTYPES[link] || 'type ' + link) + ' (' + link + ')',
  };
}
function parsePcapng(head) {
  if (head.length < 32) return null;
  // Section Header Block: type 0x0A0D0D0A, then byte-order magic 0x1A2B3C4D.
  const r0 = new Reader(head);
  if (r0.u32At(0) !== 0x0A0D0D0A) return null;
  const bom = r0.u32At(8);
  let little;
  if (bom === 0x1A2B3C4D) little = false;
  else if (bom === 0x4D3C2B1A) little = true;
  else return null;
  const r = new Reader(head, little);
  r.seek(12);
  const major = r.u16(), minor = r.u16();
  return {
    'Format': 'PCAP Next Generation (.pcapng)',
    'Byte order': little ? 'little-endian' : 'big-endian',
    'Version': major + '.' + minor,
    'Note': 'Block-structured capture (sections, interfaces, packets, comments)',
  };
}

// ---------- PKCS#12 / PFX (.p12 / .pfx) - inline ASN.1 DER walker ----------
//
// PKCS#12 PFX is DER-encoded. We can't decrypt the contents (they're PBE/MAC
// protected), but the ASN.1 *envelope* is plaintext: version, the authSafe
// ContentInfo, macData (algorithm + iterations), and - by scanning OIDs across
// the whole DER blob - the SafeBag types (certBag / keyBag / shrouded keyBag)
// and the PBE/encryption algorithm. That's enough to surface useful facts.

// Minimal DER reader. Parses tag/length/value (definite length only). Returns a
// node { cls, constructed, tag, hdrLen, len, start, end, content } where
// [content, end) is the value range within `b`. Throws on malformed input.
function derRead(b, pos) {
  if (pos >= b.length) throw new Error('der: eof');
  const id = b[pos];
  const cls = id >> 6;                 // 0=universal 1=app 2=context 3=private
  const constructed = (id & 0x20) !== 0;
  let tag = id & 0x1f;
  let p = pos + 1;
  if (tag === 0x1f) {                  // high-tag-number form (multi-byte)
    tag = 0;
    let bb;
    do { if (p >= b.length) throw new Error('der: tag'); bb = b[p++]; tag = (tag << 7) | (bb & 0x7f); } while (bb & 0x80);
  }
  if (p >= b.length) throw new Error('der: len');
  let len = b[p++];
  if (len & 0x80) {                    // long form
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('der: indefinite/oversized length');
    len = 0;
    for (let i = 0; i < n; i++) { if (p >= b.length) throw new Error('der: len'); len = (len * 256) + b[p++]; }
  }
  const content = p;
  const end = content + len;
  if (end > b.length) throw new Error('der: truncated');
  return { cls, constructed, tag, hdrLen: content - pos, len, start: pos, content, end };
}

// Iterate the immediate children of a constructed node's value range.
function* derChildren(b, start, end) {
  let p = start;
  while (p < end) {
    const n = derRead(b, p);
    yield n;
    p = n.end;
  }
}

// Decode an OID node's bytes into dotted-decimal string.
function derOid(b, n) {
  const bytes = b.subarray(n.content, n.end);
  if (!bytes.length) return '';
  const parts = [];
  const first = bytes[0];
  parts.push(Math.floor(first / 40), first % 40);
  let val = 0, started = false;
  for (let i = 1; i < bytes.length; i++) {
    val = (val * 128) + (bytes[i] & 0x7f);
    started = true;
    if (!(bytes[i] & 0x80)) { parts.push(val); val = 0; started = false; }
  }
  if (started) parts.push(val);        // tolerate truncation
  return parts.join('.');
}

// Decode a (small) INTEGER node to a JS number; returns null if too large.
function derInt(b, n) {
  if (n.len === 0 || n.len > 6) return null;
  let v = 0;
  for (let i = n.content; i < n.end; i++) v = (v * 256) + b[i];
  return v;
}

const PKCS12_OIDS = {
  // SafeBag bag types (1.2.840.113549.1.12.10.1.x)
  '1.2.840.113549.1.12.10.1.1': 'keyBag',
  '1.2.840.113549.1.12.10.1.2': 'pkcs8ShroudedKeyBag',
  '1.2.840.113549.1.12.10.1.3': 'certBag',
  '1.2.840.113549.1.12.10.1.4': 'crlBag',
  '1.2.840.113549.1.12.10.1.5': 'secretBag',
  '1.2.840.113549.1.12.10.1.6': 'safeContentsBag',
};
const ENC_OIDS = {
  '1.2.840.113549.1.12.1.1': 'pbeWithSHA1And128BitRC4',
  '1.2.840.113549.1.12.1.2': 'pbeWithSHA1And40BitRC4',
  '1.2.840.113549.1.12.1.3': 'pbeWithSHA1And3-KeyTripleDES-CBC',
  '1.2.840.113549.1.12.1.4': 'pbeWithSHA1And2-KeyTripleDES-CBC',
  '1.2.840.113549.1.12.1.5': 'pbeWithSHA1And128BitRC2-CBC',
  '1.2.840.113549.1.12.1.6': 'pbeWithSHA1And40BitRC2-CBC',
  '1.2.840.113549.1.5.13': 'PBES2',
  '1.2.840.113549.1.5.12': 'PBKDF2',
  '2.16.840.1.101.3.4.1.2': 'AES-128-CBC',
  '2.16.840.1.101.3.4.1.22': 'AES-192-CBC',
  '2.16.840.1.101.3.4.1.42': 'AES-256-CBC',
  '1.2.840.113549.3.7': '3DES-CBC',
};
const DIGEST_OIDS = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
  '2.16.840.1.101.3.4.2.4': 'SHA-224',
};
const PKCS7_DATA = '1.2.840.113549.1.7.1';
const PKCS7_ENCRYPTED_DATA = '1.2.840.113549.1.7.6';

async function parseP12(file) {
  // Read the whole file (these bundles are small); the MAC lives at the end so a
  // 4 KB head isn't enough. Cap generously.
  let b;
  try {
    b = new Uint8Array(await file.slice(0, Math.min(file.size, 8_000_000)).arrayBuffer());
  } catch (_) { return p12Fallback(); }

  try {
    // PFX ::= SEQUENCE { version INTEGER, authSafe ContentInfo, macData OPTIONAL }
    const pfx = derRead(b, 0);
    if (pfx.tag !== 0x10 || !pfx.constructed) throw new Error('not a SEQUENCE');
    const top = [...derChildren(b, pfx.content, pfx.end)];
    if (top.length < 2) throw new Error('short PFX');

    const out = { 'Format': 'PKCS#12 / PFX bundle' };

    const version = derInt(b, top[0]);
    if (version != null) out['PFX version'] = 'v' + version;

    // authSafe: ContentInfo ::= SEQUENCE { contentType OID, content [0] EXPLICIT }
    const authSafe = top[1];
    let authType = '';
    try {
      const ci = [...derChildren(b, authSafe.content, authSafe.end)];
      if (ci.length && ci[0].tag === 0x06) authType = derOid(b, ci[0]);
    } catch (_) {}
    out['AuthSafe content'] = authType === PKCS7_DATA ? 'data (unencrypted SafeContents)'
      : authType === PKCS7_ENCRYPTED_DATA ? 'encryptedData' : (authType || 'unknown');

    // macData ::= SEQUENCE { mac DigestInfo, macSalt, iterations INTEGER DEFAULT 1 }
    if (top.length >= 3 && top[2].tag === 0x10 && top[2].constructed) {
      try {
        const mac = [...derChildren(b, top[2].content, top[2].end)];
        // mac[0] = DigestInfo SEQUENCE { digestAlgorithm AlgorithmIdentifier, digest }
        let digestName = '';
        if (mac.length && mac[0].constructed) {
          const di = [...derChildren(b, mac[0].content, mac[0].end)];
          if (di.length && di[0].constructed) {
            const alg = [...derChildren(b, di[0].content, di[0].end)];
            if (alg.length && alg[0].tag === 0x06) {
              const oid = derOid(b, alg[0]);
              digestName = DIGEST_OIDS[oid] || oid;
            }
          }
        }
        // iterations: the last INTEGER child (after mac + macSalt OCTET STRING)
        let iterations = null;
        for (let i = mac.length - 1; i >= 1; i--) {
          if (mac[i].tag === 0x02) { iterations = derInt(b, mac[i]); break; }
        }
        if (iterations == null) iterations = 1;   // ASN.1 DEFAULT 1
        out['MAC'] = (digestName || 'unknown') + ', ' + iterations + ' iteration' + (iterations === 1 ? '' : 's');
      } catch (_) {}
    } else {
      out['MAC'] = 'none (unsigned integrity)';
    }

    // Scan every OID across the whole DER blob to count bag types & find the PBE
    // scheme. The contents are encrypted, but bag-type and algorithm OIDs sit in
    // the plaintext ASN.1 structure surrounding each encrypted blob.
    const bagCounts = {};
    const encAlgos = [];
    walkOids(b, 0, pfx.end, (oid) => {
      const bag = PKCS12_OIDS[oid];
      if (bag) bagCounts[bag] = (bagCounts[bag] || 0) + 1;
      if (ENC_OIDS[oid] && !encAlgos.includes(ENC_OIDS[oid])) encAlgos.push(ENC_OIDS[oid]);
    }, 0);

    const certs = bagCounts['certBag'] || 0;
    out['Certificates'] = certs;
    const hasKey = (bagCounts['keyBag'] || 0) + (bagCounts['pkcs8ShroudedKeyBag'] || 0) > 0;
    out['Contains private key'] = hasKey ? 'yes' : 'no';
    const shrouded = (bagCounts['pkcs8ShroudedKeyBag'] || 0) > 0;
    if (shrouded) out['Private key bag'] = 'pkcs8ShroudedKeyBag (encrypted)';
    else if (bagCounts['keyBag']) out['Private key bag'] = 'keyBag (unencrypted PKCS#8)';

    if (encAlgos.length) out['Encryption'] = encAlgos.join(', ');

    // If we found no recognisable bags or encryption (e.g. an unusual layout we
    // couldn't see into), still report the structure we did parse.
    if (!certs && !hasKey && !encAlgos.length) {
      out['Note'] = 'PBE/MAC-protected - bag contents are encrypted and could not be enumerated.';
    }
    if (shrouded || authType === PKCS7_ENCRYPTED_DATA || hasKey) {
      out['⚠ Warning'] = 'Password-protected - holds a private key; keep secret';
    }
    return out;
  } catch (_) {
    return p12Fallback();
  }
}

// Walk the DER tree under [start,end) and invoke cb(oidString) for every OID
// (tag 0x06) found, recursing into constructed nodes. PKCS#12 wraps each
// SafeContents inside a primitive OCTET STRING (PKCS#7 `data`), so we also try
// to descend into OCTET STRINGs whose bytes themselves start a DER SEQUENCE -
// that's where the certBag / keyBag OIDs live. Bounded & try/catch-safe.
function walkOids(b, start, end, cb, depth) {
  if (depth > 40) return;              // recursion guard
  let p = start;
  while (p < end) {
    let n;
    try { n = derRead(b, p); } catch (_) { return; }
    if (n.end <= n.start) return;      // guard against zero-progress
    if (n.cls === 0 && n.tag === 0x06) {
      try { cb(derOid(b, n)); } catch (_) {}
    }
    if (n.constructed) {
      try { walkOids(b, n.content, n.end, cb, depth + 1); } catch (_) {}
    } else if (n.cls === 0 && (n.tag === 0x04 || n.tag === 0x03) && n.len > 1) {
      // OCTET STRING (0x04) or BIT STRING (0x03) that plausibly wraps inner DER.
      let inner = n.content;
      if (n.tag === 0x03) inner += 1;  // BIT STRING leading "unused bits" octet
      try {
        const first = b[inner];        // 0x30 = SEQUENCE, 0x31 = SET
        if (first === 0x30 || first === 0x31) walkOids(b, inner, n.end, cb, depth + 1);
      } catch (_) {}
    }
    p = n.end;
  }
}

// Fallback to the original identification-only rows when ASN.1 parsing fails.
function p12Fallback() {
  return {
    'Format': 'PKCS#12 / PFX bundle',
    'Note': 'Encrypted key + certificate bundle (PBE/MAC protected). ASN.1 envelope could not be decoded - identification only. Holds a PRIVATE key; password-protected.',
    '⚠ Warning': 'Password-protected - holds a private key; keep secret',
  };
}

// ---------- legacy Windows Event Log: .evt ----------
// Pre-Vista binary log. File header: 0x30 size, "LfLe" magic at offset 4, then
// version words, first/last record numbers, file size and a flags field.
function parseEvt(head) {
  if (head.length < 48) return null;
  const r = new Reader(head, true);          // little-endian
  const hdrLen = r.u32();
  if (hdrLen !== 0x30) return null;
  if (ascii(head.subarray(4, 8)) !== 'LfLe') return null;
  r.seek(8);
  const major = r.u32();
  const minor = r.u32();
  const firstOff = r.u32();
  const nextOff = r.u32();
  const oldest = r.u32();
  const current = r.u32();
  const maxSize = r.u32();
  const flags = r.u32();
  const out = {
    'Format': 'Windows Event Log (legacy .evt)',
    'Signature': 'LfLe',
    'Format version': major + '.' + minor,
    'Oldest record number': oldest,
    'Current record number': current,
  };
  const count = current - oldest;
  if (count >= 0) out['Records (approx)'] = count;
  if (maxSize) out['Configured max size'] = fmtBytes(maxSize);
  out['First record offset'] = '0x' + firstOff.toString(16);
  out['Next record offset'] = '0x' + nextOff.toString(16);
  const fl = [];
  if (flags & 0x01) fl.push('dirty');
  if (flags & 0x02) fl.push('wrapped');
  if (flags & 0x04) fl.push('logfull-written');
  if (flags & 0x08) fl.push('archive-set');
  if (fl.length) out['Flags'] = fl.join(', ');
  out['Note'] = 'Pre-Vista (XP / 2003) binary event log; per-record event IDs, sources and timestamps need the full ELF_LOGFILE record walker - identification only.';
  return out;
}

// ---------- YARA rules: .yar / .yara ----------
async function parseYara(file) {
  const text = await readText(file, 2_000_000);
  // Must look like YARA: a `rule Name {` block (optionally global/private).
  const ruleRe = /^\s*(?:global\s+|private\s+)*rule\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  const rules = Array.from(text.matchAll(ruleRe));
  if (!rules.length) return null;
  const names = rules.map((m) => m[1]);
  const imports = Array.from(new Set(Array.from(text.matchAll(/^\s*import\s+"([^"]+)"/gm)).map((m) => m[1])));
  const includes = (text.match(/^\s*include\s+"/gm) || []).length;
  const strings = (text.match(/^\s*\$[A-Za-z0-9_]*\s*=/gm) || []).length;
  const conditions = (text.match(/^\s*condition\s*:/gm) || []).length;
  const metaAuthors = Array.from(new Set(Array.from(text.matchAll(/^\s*author\s*=\s*"([^"]*)"/gm)).map((m) => m[1]).filter(Boolean)));
  const out = {
    'Format': 'YARA rules',
    'Rules': names.length,
    'String definitions': strings,
    'Condition blocks': conditions,
  };
  if (imports.length) out['Imports'] = imports.join(', ');
  if (includes) out['Includes'] = includes;
  if (metaAuthors.length) out['Authors'] = metaAuthors.slice(0, 10).join(', ');
  out._sections = [{ title: 'Rule names (' + names.length + ')', node: preBlock(names.slice(0, 500).join('\n')) }];
  return out;
}

// ---------- Snort / Suricata IDS rules: .rules ----------
async function parseRules(file) {
  const text = await readText(file, 4_000_000);
  const lines = text.split(/\r?\n/);
  const actionRe = /^\s*(alert|drop|reject|pass|log|sdrop|rejectsrc|rejectdst|rejectboth)\s+(\w+)\b/;
  const rules = [];
  let disabled = 0;
  for (let line of lines) {
    let l = line.trim();
    if (!l) continue;
    let off = false;
    if (l.startsWith('#')) { l = l.replace(/^#+\s*/, ''); off = true; }
    const m = l.match(actionRe);
    if (!m) continue;
    if (!/\bsid\s*:/.test(l)) continue;       // a real IDS rule carries a sid
    if (off) disabled++;
    rules.push({ action: m[1], proto: m[2], line: l });
  }
  if (!rules.length) return null;
  const actions = {};
  const protos = {};
  const classtypes = {};
  for (const r of rules) {
    actions[r.action] = (actions[r.action] || 0) + 1;
    protos[r.proto] = (protos[r.proto] || 0) + 1;
    const ct = (r.line.match(/classtype\s*:\s*([^;]+);/) || [])[1];
    if (ct) classtypes[ct.trim()] = (classtypes[ct.trim()] || 0) + 1;
  }
  const fmtTally = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')').join(', ');
  const out = {
    'Format': 'Snort / Suricata IDS rules',
    'Rules': rules.length,
    'By action': fmtTally(actions),
    'By protocol': fmtTally(protos),
  };
  if (disabled) out['Disabled (commented)'] = disabled;
  if (Object.keys(classtypes).length) out['Top classtypes'] = fmtTally(classtypes).split(', ').slice(0, 8).join(', ');
  const msgs = rules.map((r) => {
    const msg = (r.line.match(/msg\s*:\s*"([^"]*)"/) || [])[1] || '(no msg)';
    const sid = (r.line.match(/sid\s*:\s*(\d+)/) || [])[1] || '?';
    return 'sid:' + sid + '  ' + r.action + '  ' + msg;
  });
  out._sections = [{ title: 'Rule messages (' + msgs.length + ')', node: preBlock(msgs.slice(0, 500).join('\n')) }];
  return out;
}

// ---------- STIX threat intel: .stix (JSON) ----------
async function parseStix(file) {
  const text = await readText(file, 8_000_000);
  let j;
  try { j = JSON.parse(text); } catch (_) { return null; }
  // STIX 2.x: a bundle { type:"bundle", objects:[...] } or a single SDO/SCO.
  let objects;
  if (j && j.type === 'bundle' && Array.isArray(j.objects)) objects = j.objects;
  else if (Array.isArray(j)) objects = j;
  else if (j && typeof j.type === 'string') objects = [j];
  else return null;
  // Confirm it smells like STIX (objects carry a `type` and most a stix id).
  const looksStix = objects.some((o) => o && typeof o.type === 'string' && (/^[a-z0-9-]+--/.test(o.id || '') || j.spec_version));
  if (!looksStix && !(j && j.spec_version)) return null;
  const out = { 'Format': 'STIX threat intelligence' };
  if (j.spec_version) out['Spec version'] = String(j.spec_version);
  else out['Spec version'] = '2.0 (inferred)';
  out['Objects'] = objects.length;
  const byType = {};
  for (const o of objects) { const t = (o && o.type) || '?'; byType[t] = (byType[t] || 0) + 1; }
  out['Object types'] = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')').join(', ');
  const indicators = objects.filter((o) => o && o.type === 'indicator');
  if (indicators.length) out['Indicators'] = indicators.length;
  const actors = objects.filter((o) => o && o.type === 'threat-actor').map((o) => o.name).filter(Boolean);
  if (actors.length) out['Threat actors'] = Array.from(new Set(actors)).slice(0, 10).join(', ');
  const labels = Array.from(new Set(objects.flatMap((o) => (o && Array.isArray(o.labels)) ? o.labels : []))).slice(0, 15);
  if (labels.length) out['Labels'] = labels.join(', ');
  const patterns = indicators.map((o) => o.pattern).filter(Boolean);
  if (patterns.length) out._sections = [{ title: 'Indicator patterns (' + patterns.length + ')', node: preBlock(patterns.slice(0, 200).join('\n')) }];
  return out;
}

// ---------- OpenIOC: .ioc (XML) ----------
async function parseIoc(file) {
  const text = await readText(file, 4_000_000);
  if (!/<ioc\b/i.test(text)) return null;
  const out = { 'Format': 'OpenIOC indicator (Mandiant)' };
  const id = (text.match(/<ioc\b[^>]*\bid\s*=\s*"([^"]+)"/i) || [])[1];
  if (id) out['IOC id'] = id;
  const grab = (tag) => (text.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i')) || [])[1];
  const name = grab('short_description') || grab('description');
  if (name) out['Description'] = name.trim().replace(/\s+/g, ' ').slice(0, 200);
  const author = grab('authored_by');
  if (author) out['Author'] = author.trim();
  const authored = grab('authored_date');
  if (authored) out['Authored'] = authored.trim();
  // Indicator leaf terms: <IndicatorItem ...><Context document="FileItem" search="..."/>
  const contexts = {};
  for (const m of text.matchAll(/<Context\b[^>]*\bdocument\s*=\s*"([^"]+)"/gi)) {
    contexts[m[1]] = (contexts[m[1]] || 0) + 1;
  }
  const items = (text.match(/<IndicatorItem\b/gi) || []).length;
  if (items) out['Indicator items'] = items;
  const logic = (text.match(/<Indicator\b[^>]*\boperator\s*=\s*"([^"]+)"/i) || [])[1];
  if (logic) out['Top operator'] = logic.toUpperCase();
  if (Object.keys(contexts).length) {
    out['Indicator contexts'] = Object.entries(contexts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')').join(', ');
  }
  const searches = Array.from(new Set(Array.from(text.matchAll(/<Context\b[^>]*\bsearch\s*=\s*"([^"]+)"/gi)).map((m) => m[1])));
  if (searches.length) out._sections = [{ title: 'Searched terms (' + searches.length + ')', node: preBlock(searches.slice(0, 300).join('\n')) }];
  return out;
}

// ---------- Fiddler session archive: .saz (ZIP) ----------
async function parseSaz(file) {
  let z;
  try { z = await openZip(file, 64 * 1024 * 1024); } catch (_) { return null; }
  const names = z.names();
  if (!names.length) return null;
  // Sessions live under raw/<n>_c.txt (client request) and _s.txt (server reply).
  const requests = z.match(/raw\/\d+_c\.txt$/i);
  if (!requests.length && !z.has('_index.htm')) return null;
  const out = { 'Format': 'Fiddler session archive (.saz)' };
  out['Sessions'] = requests.length || z.match(/raw\/\d+_/i).length;
  const methods = {};
  const statuses = {};
  const hosts = new Set();
  // Sample up to 400 request files to tally method + host.
  for (const e of requests.slice(0, 400)) {
    const t = await inflateToText(z.buf, e);
    if (!t) continue;
    const m = t.match(/^([A-Z]+)\s+(\S+)/);
    if (m) {
      methods[m[1]] = (methods[m[1]] || 0) + 1;
      try { hosts.add(new URL(m[2], 'http://x/').host || (t.match(/^Host:\s*(\S+)/im) || [])[1]); } catch (_) {}
    }
    const h = (t.match(/^Host:\s*(\S+)/im) || [])[1];
    if (h) hosts.add(h);
  }
  for (const e of z.match(/raw\/\d+_s\.txt$/i).slice(0, 400)) {
    const t = await inflateToText(z.buf, e);
    if (!t) continue;
    const m = t.match(/^HTTP\/[\d.]+\s+(\d{3})/);
    if (m) statuses[m[1]] = (statuses[m[1]] || 0) + 1;
  }
  const fmtTally = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')').join(', ');
  if (Object.keys(methods).length) out['Methods'] = fmtTally(methods);
  if (Object.keys(statuses).length) out['Status codes'] = fmtTally(statuses);
  const hostList = Array.from(hosts).filter(Boolean).sort();
  if (hostList.length) {
    out['Hosts'] = hostList.length;
    out._sections = [{ title: 'Hosts (' + hostList.length + ')', node: preBlock(hostList.slice(0, 300).join('\n')) }];
  }
  out['Note'] = 'Captured HTTP(S) sessions; bodies are stored in the archive but not decrypted here.';
  return out;
}

// ---------- 1Password export: .1pux (ZIP) ----------
async function parse1pux(file) {
  let z;
  try { z = await openZip(file, 64 * 1024 * 1024); } catch (_) { return null; }
  if (!z.has('export.data') && !z.has('export.attributes')) return null;
  const out = { 'Format': '1Password 8 export (.1pux)' };
  const attrText = await z.text('export.attributes');
  if (attrText) {
    try {
      const a = JSON.parse(attrText);
      if (a.version != null) out['Export version'] = String(a.version);
      if (a.description) out['Description'] = String(a.description);
      if (a.createdAt != null) {
        const d = new Date(Number(a.createdAt) * (Number(a.createdAt) > 1e12 ? 1 : 1000));
        if (!isNaN(d)) out['Created'] = fmtDate(d);
      }
    } catch (_) {}
  }
  const dataText = await z.text('export.data');
  if (dataText) {
    try {
      const d = JSON.parse(dataText);
      const accounts = Array.isArray(d.accounts) ? d.accounts : [];
      out['Accounts'] = accounts.length;
      let vaults = 0, items = 0;
      const acctNames = [];
      for (const acc of accounts) {
        if (acc.attrs && acc.attrs.name) acctNames.push(acc.attrs.name);
        const vs = Array.isArray(acc.vaults) ? acc.vaults : [];
        vaults += vs.length;
        for (const v of vs) items += Array.isArray(v.items) ? v.items.length : 0;
      }
      out['Vaults'] = vaults;
      out['Items'] = items;
      if (acctNames.length) out['Account names'] = acctNames.slice(0, 10).join(', ');
    } catch (_) {}
  }
  const attachments = z.match(/^files\//i).length;
  if (attachments) out['Attachment files'] = attachments;
  out['⚠ Warning'] = 'Plaintext export - contains decrypted passwords and secrets; handle with extreme care';
  return out;
}

// ---------- 1Password OPVault: .opvault (bundle / folder upload) ----------
async function parseOpvault(file, ext, name) {
  // .opvault is normally a directory bundle; if one inner file is opened we can
  // still recognise its profile.js / band JSON, but most often this is the
  // package itself which a browser delivers as an opaque blob - identify only.
  const fname = (name || file.name || '').toLowerCase();
  const out = {
    'Format': '1Password OPVault',
    'Note': 'AgileBits OPVault is a directory bundle (default/profile.js + band_*.js + AES-GCM-encrypted item bands). Item contents are encrypted with a key derived from the master password (PBKDF2) and cannot be read here - identification only.',
  };
  if (/profile\.js$/.test(fname)) out['Component'] = 'profile.js (vault profile / KDF parameters)';
  else if (/band_.*\.js$/.test(fname)) out['Component'] = 'band file (encrypted item batch)';
  else if (/\.opvault$/.test(fname)) out['Component'] = 'vault bundle';
  out['⚠ Warning'] = 'Encrypted password vault - keep confidential';
  return out;
}

// ---------- Apple Keychain: .keychain (binary "kych") ----------
function parseKeychain(head) {
  if (head.length < 4) return null;
  // SQLite keychain (keychain-db) starts "SQLite format 3"; classic keychain
  // begins with the Apple CSSM DL "kych" magic.
  if (ascii(head.subarray(0, 4)) === 'kych') {
    const r = new Reader(head);            // big-endian
    r.seek(4);
    const version = head.length >= 8 ? r.u32() : null;
    const out = {
      'Format': 'Apple Keychain (classic)',
      'Signature': 'kych',
    };
    if (version != null) out['Version'] = version;
    out['Note'] = 'Encrypted Apple CSSM credential store (passwords, keys, certificates). Records are protected by the keychain password - identification only.';
    out['⚠ Warning'] = 'Encrypted credential store - keep confidential';
    return out;
  }
  if (ascii(head.subarray(0, 15)) === 'SQLite format 3') {
    return {
      'Format': 'Apple Keychain (SQLite keychain-db)',
      'Container': 'SQLite 3 database',
      'Note': 'Modern macOS/iOS keychain database; credential blobs are encrypted (keybag/Secure Enclave protected) - identification only.',
      '⚠ Warning': 'Encrypted credential store - keep confidential',
    };
  }
  return null;
}

// ---------- AFF forensic image: .aff (legacy AFFLIB) ----------
function parseAff(head) {
  if (head.length < 4) return null;
  // Legacy AFF (AFFLIB) segmented format begins with the "AFF" / "AFF10" banner.
  const sig = ascii(head.subarray(0, 5));
  if (!sig.startsWith('AFF')) return null;
  return {
    'Format': 'AFF forensic image (legacy AFFLIB)',
    'Signature': sig.replace(/[^\x20-\x7e].*$/, '').trim() || 'AFF',
    'Note': 'Advanced Forensic Format acquisition image (segmented: pages + metadata + hashes). Segment directory walking is not implemented - identification only.',
  };
}

// ---------- AFF4 forensic image: .aff4 (ZIP + RDF-Turtle) ----------
async function parseAff4(file) {
  let z;
  try { z = await openZip(file, 64 * 1024 * 1024); } catch (_) { return null; }
  // AFF4 is a ZIP carrying an RDF "information.turtle" graph and a container.description.
  const hasTurtle = z.match(/information\.turtle$/i).length > 0;
  const hasDesc = z.has('container.description');
  if (!hasTurtle && !hasDesc) return null;
  const out = { 'Format': 'AFF4 forensic image' };
  if (hasDesc) {
    const desc = await z.text('container.description');
    if (desc) out['Container URN'] = desc.trim().split(/\r?\n/)[0].slice(0, 120);
  }
  const turtleEntry = z.match(/information\.turtle$/i)[0];
  if (turtleEntry) {
    const ttl = await inflateToText(z.buf, turtleEntry);
    if (ttl) {
      const tool = (ttl.match(/aff4:Tool>?\s*"([^"]+)"/i) || ttl.match(/tool[^"]*"([^"]+)"/i) || [])[1];
      if (tool) out['Acquisition tool'] = tool;
      const size = (ttl.match(/aff4:size\b[^>]*>?\s*"?(\d+)/i) || [])[1];
      if (size) out['Image size'] = fmtBytes(Number(size));
      const imageStreams = (ttl.match(/aff4:ImageStream|aff4:Image\b/gi) || []).length;
      if (imageStreams) out['Image streams'] = imageStreams;
      const hashes = Array.from(new Set(Array.from(ttl.matchAll(/aff4:(SHA1|SHA256|SHA512|MD5|Blake2b)\b/gi)).map((m) => m[1].toUpperCase())));
      if (hashes.length) out['Hash algorithms'] = hashes.join(', ');
    }
  }
  out['Container'] = 'ZIP64 (AFF4 standard)';
  out['Note'] = 'Disk image bytes are stored as compressed/encrypted streams; raw acquisition data is not extracted here.';
  return out;
}

// ---------- OpenPGP: .pgp / .gpg / .sig / .asc ----------
const PGP_PUBKEY_ALGOS = { 1: 'RSA', 2: 'RSA (encrypt-only)', 3: 'RSA (sign-only)', 16: 'Elgamal', 17: 'DSA', 18: 'ECDH', 19: 'ECDSA', 22: 'EdDSA', 23: 'X25519', 25: 'X448', 27: 'Ed25519', 28: 'Ed448' };
const PGP_TAGS = {
  1: 'Public-Key Encrypted Session Key', 2: 'Signature', 3: 'Symmetric-Key Encrypted Session Key',
  4: 'One-Pass Signature', 5: 'Secret Key', 6: 'Public Key', 7: 'Secret Subkey',
  8: 'Compressed Data', 9: 'Symmetrically Encrypted Data', 10: 'Marker', 11: 'Literal Data',
  12: 'Trust', 13: 'User ID', 14: 'Public Subkey', 17: 'User Attribute',
  18: 'Sym. Encrypted Integrity Protected Data', 19: 'Modification Detection Code', 20: 'AEAD Encrypted Data',
};

// Walk OpenPGP packets (RFC 4880 old + new format headers) over a byte range.
// Returns { tags:{tag:count}, info:{} } or null if the stream is not OpenPGP.
function pgpWalk(b, limit) {
  const tags = {};
  const info = {};
  let p = 0;
  let packets = 0;
  const end = Math.min(b.length, limit);
  while (p < end) {
    const c = b[p];
    if (!(c & 0x80)) break;                  // not a valid packet tag octet
    let tag, len, headerLen;
    if (c & 0x40) {                          // new-format packet
      tag = c & 0x3f;
      const l0 = b[p + 1];
      if (l0 == null) break;
      if (l0 < 192) { len = l0; headerLen = 2; }
      else if (l0 < 224) { len = ((l0 - 192) << 8) + b[p + 2] + 192; headerLen = 3; }
      else if (l0 === 255) { len = (b[p + 2] << 24) | (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]; headerLen = 6; }
      else { break; }                        // partial body lengths - stop
    } else {                                 // old-format packet
      tag = (c >> 2) & 0x0f;
      const lt = c & 0x03;
      if (lt === 0) { len = b[p + 1]; headerLen = 2; }
      else if (lt === 1) { len = (b[p + 1] << 8) | b[p + 2]; headerLen = 3; }
      else if (lt === 2) { len = (b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]; headerLen = 5; }
      else { break; }                        // indeterminate length - stop
    }
    if (len < 0 || headerLen == null) break;
    const body = p + headerLen;
    tags[tag] = (tags[tag] || 0) + 1;
    packets++;
    // Pull a few useful fields out of common packet bodies.
    if ((tag === 6 || tag === 14 || tag === 5 || tag === 7) && !info.keyAlgo && b[body] === 4) {
      // v4 key packet: 1 version + 4 creation time + 1 algo
      const created = (b[body + 1] << 24) | (b[body + 2] << 16) | (b[body + 3] << 8) | b[body + 4];
      const algo = b[body + 5];
      if (PGP_PUBKEY_ALGOS[algo]) info.keyAlgo = PGP_PUBKEY_ALGOS[algo];
      if (created > 0) { const d = new Date(created * 1000); if (!isNaN(d)) info.created = d; }
    }
    if (tag === 13 && !info.userId) {         // User ID packet body is UTF-8 text
      try { info.userId = utf8(b.subarray(body, body + Math.min(len, 200))); } catch (_) {}
    }
    p = body + len;
    if (packets > 5000) break;
  }
  return packets ? { tags, info } : null;
}

async function parsePgp(file, ext) {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 1_000_000)).arrayBuffer());
  const txt = latin1(head);
  const out = {};
  let walked = null;
  let armored = false;

  const armorMatch = txt.match(/-----BEGIN PGP ([A-Z ]+)-----/);
  if (armorMatch) {
    armored = true;
    out['Armor type'] = 'PGP ' + armorMatch[1].trim();
    // Dearmor: strip headers, blank lines and the CRC24 (the "=XXXX" line).
    const body = txt.slice(txt.indexOf(armorMatch[0]) + armorMatch[0].length);
    const b64 = body.split(/-----END/)[0]
      .replace(/^[A-Za-z][\w-]*:.*$/gm, '')   // armor headers (Version:, Comment:)
      .replace(/^=.{4}\s*$/gm, '')            // CRC line
      .replace(/\s+/g, '');
    try { walked = pgpWalk(b64ToBytes(b64), 1_000_000); } catch (_) {}
  } else if (head[0] & 0x80) {
    walked = pgpWalk(head, head.length);
  }
  if (!armored && !walked) return null;       // not OpenPGP

  out['Format'] = 'OpenPGP ' + (
    ext === 'sig' ? 'signature' :
    armorMatch && /PUBLIC KEY/.test(armorMatch[1]) ? 'public key' :
    armorMatch && /PRIVATE KEY/.test(armorMatch[1]) ? 'private key' :
    armorMatch && /SIGNATURE/.test(armorMatch[1]) ? 'signature' :
    armorMatch && /MESSAGE/.test(armorMatch[1]) ? 'message' :
    'data');
  out['Encoding'] = armored ? 'ASCII-armored' : 'binary';

  if (walked) {
    const names = Object.entries(walked.tags)
      .map(([t, n]) => (PGP_TAGS[t] || ('tag ' + t)) + ' (' + n + ')');
    out['Packets'] = names.join(', ');
    if (walked.info.keyAlgo) out['Key algorithm'] = walked.info.keyAlgo;
    if (walked.info.created) out['Key created'] = fmtDate(walked.info.created);
    if (walked.info.userId) out['User ID'] = walked.info.userId.replace(/[^\x20-\x7e].*$/, '').trim();
    if (walked.tags[5] || walked.tags[7]) {
      out['⚠ Warning'] = 'Contains a SECRET key - keep confidential';
    }
  } else {
    out['Note'] = 'OpenPGP container recognised from the armor header; packet body not decoded.';
  }
  return out;
}

// ---------- partial: KeePass 1.x: .kdb (mirror of kdbx) ----------
function parseKdb(head) {
  if (head.length < 12) return null;
  const r = new Reader(head, true);          // little-endian
  const sig1 = r.u32();
  const sig2 = r.u32();
  if (sig1 !== 0x9AA2D903) return null;
  const out = { 'Format': 'KeePass 1.x database (.kdb)' };
  // KDB (KeePass 1) second signature is 0xB54BFB65; KDBX share the first sig.
  if (sig2 === 0xB54BFB65) out['Variant'] = 'KeePass 1.x (KDB)';
  else out['Variant'] = 'KeePass (signature 2 = 0x' + sig2.toString(16).toUpperCase() + ')';
  const flags = r.u32();
  const enc = [];
  if (flags & 0x02) enc.push('AES (Rijndael)');
  if (flags & 0x08) enc.push('Twofish');
  if (enc.length) out['Cipher'] = enc.join(' / ');
  out['Note'] = 'Encrypted password database (AES-256 / Twofish, SHA-256 key transform). Entries are not decryptable without the master key - identification only.';
  out['⚠ Warning'] = 'Encrypted credential store - keep confidential';
  return out;
}

// ---------- partial: Microsoft private key: .pvk ----------
function parsePvk(head) {
  if (head.length < 24) return null;
  const r = new Reader(head, true);          // little-endian
  const magic = r.u32();
  if (magic !== 0x1EF1B5B0) return null;
  const reserved = r.u32();
  const keyType = r.u32();
  const encrypted = r.u32();
  const saltLen = r.u32();
  const keyLen = r.u32();
  const out = {
    'Format': 'Microsoft private key (.pvk)',
    'Signature': '0x1EF1B5B0',
    'Key type': keyType === 1 ? 'AT_KEYEXCHANGE' : keyType === 2 ? 'AT_SIGNATURE' : 'type ' + keyType,
    'Encrypted': encrypted ? 'yes (RC2/RC4 password-derived)' : 'no',
  };
  if (saltLen) out['Salt length'] = saltLen + ' bytes';
  if (keyLen) out['Key blob length'] = fmtBytes(keyLen);
  out['Note'] = 'Authenticode / IIS private key (PUBLICKEYSTRUC blob). Used with .spc to build a .pfx. RSA parameters need the MS PRIVATEKEYBLOB walker - partial parse.';
  out['⚠ Warning'] = 'Contains a PRIVATE key - keep secret';
  return out;
}

// ---------- identification-only (rare AND hard) ----------
function idOnly(format, note) {
  return () => ({ 'Format': format, 'Note': note });
}

// ---------- dispatch ----------
export const PARSERS = {
  // PEM keys
  key: (c) => parsePemKey(c.file, c.ext),
  pub: (c) => parsePemKey(c.file, c.ext),
  p8:  (c) => parseP8(c.file),

  // PEM certificate-adjacent (identify + note)
  csr: (c) => parsePemIdentify(c.file, 'PKCS#10 Certificate Signing Request (.csr)', ['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST'], 'Subject DN, requested SANs and public key are in the DER body (full ASN.1 decode not performed)'),
  crl: (c) => parsePemIdentify(c.file, 'X.509 Certificate Revocation List (.crl)', ['X509 CRL', 'CRL'], 'Issuer, update times and revoked serials are in the DER body (full ASN.1 decode not performed)'),
  p7b: (c) => parsePemIdentify(c.file, 'PKCS#7 certificate bundle (.p7b)', ['PKCS7', 'CERTIFICATE'], 'CMS SignedData carrying certificate chain (no private keys)'),
  p7c: (c) => parsePemIdentify(c.file, 'PKCS#7 certificate bundle (.p7c)', ['PKCS7', 'CERTIFICATE'], 'CMS SignedData carrying certificate chain (no private keys)'),

  // PuTTY
  ppk: (c) => parsePpk(c.file),

  // VPN
  ovpn: (c) => parseOvpn(c.file),
  wg:   (c) => parseWireguard(c.file, c.ext),
  conf: (c) => parseWireguard(c.file, c.ext),

  // Java KeyStore
  jks:      (c) => parseJks(c.head),
  keystore: (c) => parseJks(c.head),
  jceks:    (c) => parseJks(c.head),

  // OpenSSH key databases (extension-less, handled if ext matches)
  known_hosts:     (c) => parseSshKeyDb(c.file, c.ext),
  authorized_keys: (c) => parseSshKeyDb(c.file, c.ext),

  // Apple
  mobileconfig:    (c) => parseMobileconfig(c.file),
  mobileprovision: (c) => parseMobileprovision(c.file),

  // Windows registry export
  reg: (c) => parseReg(c.file),

  // Network captures (basic header parse)
  pcap:   (c) => parsePcap(c.head),
  cap:    (c) => parsePcap(c.head),
  pcapng: (c) => parsePcapng(c.head),
  ntar:   (c) => parsePcapng(c.head),

  // PKCS#12 / PFX - inline ASN.1 DER walker reads the (plaintext) envelope.
  p12: (c) => parseP12(c.file),
  pfx: (c) => parseP12(c.file),

  // OpenPGP (binary packets or ASCII armor)
  pgp: (c) => parsePgp(c.file, c.ext),
  gpg: (c) => parsePgp(c.file, c.ext),
  sig: (c) => parsePgp(c.file, c.ext),

  // Legacy Windows Event Log
  evt: (c) => parseEvt(c.head),

  // Detection / threat-intel rule sets
  yar:   (c) => parseYara(c.file),
  yara:  (c) => parseYara(c.file),
  rules: (c) => parseRules(c.file),
  stix:  (c) => parseStix(c.file),
  ioc:   (c) => parseIoc(c.file),

  // HTTP debug + password manager exports
  saz:     (c) => parseSaz(c.file),
  '1pux':  (c) => parse1pux(c.file),
  opvault: (c) => parseOpvault(c.file, c.ext, c.file && c.file.name),

  // Apple Keychain
  keychain: (c) => parseKeychain(c.head),

  // Forensic disk images
  aff:  (c) => parseAff(c.head),
  aff4: (c) => parseAff4(c.file),

  // Partial parses
  kdb: (c) => parseKdb(c.head),
  pvk: (c) => parsePvk(c.head),

  // Identification-only: rare AND hard (need ASN.1 / proprietary binary walkers)
  kdbx: idOnly('KeePass database (KDBX)', 'Encrypted password database (AES/ChaCha20, AES-KDF or Argon2). Contents are not decryptable without the master key - identification only.'),
  evtx: idOnly('Windows Event Log (EVTX)', 'ElfFile chunked binary event log. Identification only - requires the EVTX binary-XML chunk walker.'),
  pf:   idOnly('Windows Prefetch (.pf)', 'SCCA execution trace (often MAM-compressed on Win10+). Identification only - requires the prefetch decompressor/parser.'),
  hive: idOnly('Windows Registry hive', 'regf binary registry hive. Identification only - requires the hive cell walker.'),
  dmp:  idOnly('Crash / memory dump (.dmp)', 'Minidump (MDMP) or full memory dump. Identification only - requires the dump stream-directory parser.'),
  e01:  idOnly('EnCase forensic image (E01/EWF)', 'Expert Witness Format acquisition image. Identification only - requires the EWF section parser.'),
  etl:  idOnly('Event Trace Log (.etl)', 'Windows ETW trace buffers (WMI_BUFFER). Identification only - requires the ETW buffer parser.'),
};
