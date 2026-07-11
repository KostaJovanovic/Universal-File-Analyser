/* Analyser - content-based file-type sniffing.
   Detect what a file ACTUALLY is from its leading bytes, independent of its
   name. Shared by the drop path (app.js handleFile) and the folder
   analysability scan (folder.js via window._anrResolveContent / _anrReadableText),
   so the scan's verdict can never drift from what actually opens. */

import { fileExt } from './util.js';
import { sniffGitObject } from '../renderers/gitobject.js';

// ---------- true file-type sniffing ----------
// Detect what a file ACTUALLY is from its leading bytes, independent of its name,
// so a file with no extension (or an extension that lies) can still be analysed
// correctly. Returns { kind, ext, label } where kind is a ROUTES key and ext
// drives the proprietary/comic renderers, or null if nothing is recognised.
export async function sniffFileType(file) {
  let b;
  try { b = new Uint8Array(await file.slice(0, 264).arrayBuffer()); } catch (_) { return null; }
  if (!b.length) return null;
  const a = (s, n) => { let r = ''; for (let i = s; i < s + n && i < b.length; i++) r += String.fromCharCode(b[i]); return r; };
  const m = (sig, off = 0) => { for (let i = 0; i < sig.length; i++) if (b[off + i] !== sig[i]) return false; return true; };

  if (a(0, 5) === '%PDF-') return { kind: 'pdf', ext: 'pdf', label: 'PDF document' };
  if (m([0x89, 0x50, 0x4E, 0x47])) return { kind: 'photo', ext: 'png', label: 'PNG image' };
  if (m([0xFF, 0xD8, 0xFF])) return { kind: 'photo', ext: 'jpg', label: 'JPEG image' };
  if (a(0, 3) === 'GIF') return { kind: 'photo', ext: 'gif', label: 'GIF image' };
  if (m([0x42, 0x4D]) && b.length > 14) return { kind: 'photo', ext: 'bmp', label: 'BMP image' };
  if (m([0x49, 0x49, 0x2A, 0x00]) || m([0x4D, 0x4D, 0x00, 0x2A])) return { kind: 'photo', ext: 'tiff', label: 'TIFF image' };
  if (m([0x38, 0x42, 0x50, 0x53])) return { kind: 'proprietary', ext: 'psd', label: 'Photoshop PSD' };
  if (a(0, 4) === 'RIFF') {
    const f = a(8, 4);
    if (f === 'WEBP') return { kind: 'photo', ext: 'webp', label: 'WebP image' };
    if (f === 'WAVE') return { kind: 'audio', ext: 'wav', label: 'WAV audio' };
    if (f === 'AVI ') return { kind: 'video', ext: 'avi', label: 'AVI video' };
  }
  if (a(4, 4) === 'ftyp') {
    const brand = a(8, 4);
    if (/heic|heix|hevc|mif1|heif/i.test(brand)) return { kind: 'photo', ext: 'heic', label: 'HEIC image' };
    if (/avif/i.test(brand)) return { kind: 'photo', ext: 'avif', label: 'AVIF image' };
    if (/m4a|m4b/i.test(brand)) return { kind: 'audio', ext: 'm4a', label: 'M4A audio' };
    if (/3gp|3g2/i.test(brand)) return { kind: 'video', ext: '3gp', label: '3GP video' };
    return { kind: 'video', ext: 'mp4', label: 'MP4 video' };
  }
  if (m([0x1A, 0x45, 0xDF, 0xA3])) return { kind: 'video', ext: 'mkv', label: 'Matroska / WebM video' };
  if (a(0, 4) === 'OggS') return { kind: 'audio', ext: 'ogg', label: 'Ogg audio' };
  if (a(0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return { kind: 'audio', ext: 'mp3', label: 'MP3 audio' };
  if (a(0, 4) === 'fLaC') return { kind: 'audio', ext: 'flac', label: 'FLAC audio' };
  if (m([0x50, 0x4B, 0x03, 0x04]) || m([0x50, 0x4B, 0x05, 0x06])) return { kind: 'zip', ext: 'zip', label: 'ZIP archive' };
  if (a(0, 4) === 'Rar!') return { kind: 'proprietary', ext: 'rar', label: 'RAR archive' };
  if (m([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])) return { kind: 'proprietary', ext: '7z', label: '7-Zip archive' };
  // ar container: Unix ar (.a) and Microsoft COFF libraries (.lib) share "!<arch>\n".
  if (m([0x21, 0x3C, 0x61, 0x72, 0x63, 0x68, 0x3E, 0x0A])) return { kind: 'proprietary', ext: 'a', label: 'ar archive / library' };
  if (a(0, 6) === 'SQLite') return { kind: 'proprietary', ext: 'sqlite', label: 'SQLite database' };
  if (m([0x1F, 0x8B])) return { kind: 'proprietary', ext: 'gz', label: 'GZip archive' };
  if (m([0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00])) return { kind: 'proprietary', ext: 'xz', label: 'XZ archive' };
  if (m([0x28, 0xB5, 0x2F, 0xFD])) return { kind: 'proprietary', ext: 'zst', label: 'Zstandard archive' };
  if (m([0x42, 0x5A, 0x68]) && b[3] >= 0x31 && b[3] <= 0x39) return { kind: 'proprietary', ext: 'bz2', label: 'bzip2 archive' };
  if (m([0x04, 0x22, 0x4D, 0x18])) return { kind: 'proprietary', ext: 'lz4', label: 'LZ4 archive' };
  if (m([0x1F, 0x9D])) return { kind: 'proprietary', ext: 'z', label: 'compress (.Z) archive' };
  if (m([0x7F, 0x45, 0x4C, 0x46])) return { kind: 'proprietary', ext: 'elf', label: 'ELF executable' };
  if (m([0x4D, 0x5A])) return { kind: 'proprietary', ext: 'exe', label: 'Windows executable' };
  if (m([0xC5, 0xD0, 0xD3, 0xC7]) || a(0, 4) === '%!PS') return { kind: 'proprietary', ext: 'eps', label: 'PostScript / EPS' };
  if (b.length >= 132 && a(128, 4) === 'DICM') return { kind: 'proprietary', ext: 'dcm', label: 'DICOM medical image' };
  if (a(257, 5) === 'ustar') return { kind: 'proprietary', ext: 'tar', label: 'TAR archive' };
  // Legacy .lzma (LZMA alone) has no fixed magic - key off the default properties
  // byte 0x5D plus a sane dictionary size in the 13-byte header. Last among the
  // archive sniffs so stronger magics win first.
  if (b.length >= 13 && b[0] === 0x5D) {
    const dict = b[1] + b[2] * 256 + b[3] * 65536 + b[4] * 16777216;
    if (dict >= 0x1000 && dict <= 0x40000000) return { kind: 'proprietary', ext: 'lzma', label: 'LZMA archive' };
  }
  const start = a(0, Math.min(b.length, 220)).trimStart();
  if (start.startsWith('<svg') || (start.includes('<svg') && start.includes('xmlns'))) return { kind: 'svg', ext: 'svg', label: 'SVG image' };
  return null;
}

// Resolve a file's true type from its CONTENT - the niche text/game magics first,
// then the broad sniffFileType() magic table, then git objects and the CSV
// heuristic. The SINGLE source of truth shared by the drop path (handleFile) and
// the folder analysability scan (folder.js via window._anrResolveContent), so the
// scan's verdict can never drift from what actually opens. Returns
// { kind, sniffedExt }; kind is a ROUTES key, or 'unknown' when nothing matched
// (the caller then keeps the file's extension-based kind, e.g. 'extensionless').
export async function resolveByContent(file) {
  let kind = 'unknown';
  let sniffedExt = null;
  try {
    const head = new Uint8Array(await file.slice(0, 128).arrayBuffer());
    const a = (s, l) => Array.from(head.slice(s, s + l)).map((c) => String.fromCharCode(c)).join('');
    const lowerExt = fileExt(file.name);
    const lowerName = (file.name || '').toLowerCase().replace(/^.*[\\/]/, '');
    if (a(0, 4) === '%PDF') kind = 'pdf';
    else if (head[0] === 0x50 && head[1] === 0x4B) kind = 'zip';
    else if (a(0, 12) === 'IDEA - MAKER' || a(0, 14) === 'IEDA - PROFILE') { kind = 'proprietary'; sniffedExt = 'idea'; }
    else if (head[0] === 0x78 && head[1] === 0x56 && head[2] === 0x34 && head[3] === 0x12 &&
             head[12] === 0x44 && head[13] === 0x4A && head[14] === 0x49) { kind = 'proprietary'; sniffedExt = 'djifw'; }
    else if (lowerExt === 'bin' && head[0] === 0x01 && head[1] === 0x58 && head[2] === 0x23 && head[3] === 0x11) { kind = 'proprietary'; sniffedExt = 'oodledict'; }
    else if (lowerExt === 'bin' && head[0] === 0x42 && head[1] === 0x89 && head[2] === 0xE3 && head[3] === 0x0D) { kind = 'proprietary'; sniffedExt = 'addrcatalog'; }
    else if (lowerExt === 'dat' && head[0] === 0xAF && head[1] === 0x1B && head[2] === 0xB1 && head[3] === 0xFA) { kind = 'proprietary'; sniffedExt = 'il2cppmeta'; }
    else if (lowerExt === 'cff' && (lowerName === 'citation.cff' || /^[﻿#\s]*(cff-version|#|abstract|authors|title)\b/i.test(a(0, 48)))) { kind = 'proprietary'; sniffedExt = 'citationcff'; }
    else if (lowerExt === 'pth' && !head.slice(0, 64).includes(0)) { kind = 'proprietary'; sniffedExt = 'pythonpath'; }
    else if (lowerExt === 'manifest' && a(0, 19) === 'ManifestFileVersion') { kind = 'proprietary'; sniffedExt = 'unitymanifest'; }
    else if (lowerExt === 'cache' && file.size >= 16 && (await file.slice(file.size - 8, file.size - 4).text().catch(() => '')) === 'RDHS') { kind = 'proprietary'; sniffedExt = 'redshadercache'; }
    else if ((lowerExt === 'dat' || lowerName === 'unins000.dat') && a(0, 24) === 'Inno Setup Uninstall Log') { kind = 'proprietary'; sniffedExt = 'innouninstall'; }
    else if (lowerExt === 'res' && !head.slice(0, 64).includes(0) && /^[﻿\s]*(["/]|[A-Za-z_])/.test(a(0, 64)) && /[{}]/.test(await file.slice(0, 2048).text().catch(() => ''))) { kind = 'proprietary'; sniffedExt = 'valveres'; }
    else if (a(0, 14) === 'ANDROID BACKUP') { kind = 'proprietary'; sniffedExt = 'ab'; }
    else {
      const headStr = a(0, Math.min(head.length, 128));
      if (headStr.trimStart().startsWith('<svg') || (headStr.includes('<svg') && headStr.includes('xmlns'))) kind = 'svg';
      else if (/^\s*(<!doctype html|<html[\s>])/i.test(headStr)) { kind = 'proprietary'; sniffedExt = 'html'; }
    }
    // Broad magic table (images, audio, video, archives, PSD, ELF/EXE, DICOM, ...):
    // routes a PNG saved as ".icon" or with no extension to the photo viewer, etc.
    if (kind === 'unknown') {
      const s = await sniffFileType(file);
      if (s && s.kind) { kind = s.kind; if (s.kind === 'proprietary' || s.kind === 'comic') sniffedExt = s.ext; }
    }
    // Git loose objects / packfiles (zlib or PACK) - content-only, no extension.
    if (kind === 'unknown') { const git = await sniffGitObject(file); if (git) kind = 'git-object'; }
    // CSV / TSV heuristic: consistent comma/tab counts across the first lines.
    if (kind === 'unknown') {
      const peekText = await file.slice(0, 2048).text().catch(() => '');
      const lines = peekText.split('\n').filter((l) => l.trim()).slice(0, 10);
      if (lines.length >= 2) {
        const commas = lines.map((l) => (l.match(/,/g) || []).length);
        const tabs = lines.map((l) => (l.match(/\t/g) || []).length);
        const avgCommas = commas.reduce((s, n) => s + n, 0) / commas.length;
        const avgTabs = tabs.reduce((s, n) => s + n, 0) / tabs.length;
        const commaConsistent = avgCommas >= 1 && commas.every((c) => Math.abs(c - avgCommas) <= 1);
        const tabConsistent = avgTabs >= 1 && tabs.every((c) => Math.abs(c - avgTabs) <= 1);
        if (commaConsistent || tabConsistent) kind = 'csv';
      }
    }
  } catch (_) {}
  return { kind, sniffedExt };
}

// Whether a file would render as readable text rather than a raw hex dump - the
// same rule the unknown/extensionless viewer uses (renderUnknown): a UTF-16 BOM,
// or >85% printable bytes in the head. Used by the folder scan so an extensionless
// LICENSE / README / Makefile passes while a binary that only opens as hex is
// flagged. Shared via window._anrReadableText.
export async function isReadableText(file) {
  try {
    const b = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (!b.length) return true;   // empty file opens (nothing to show), not a hex dump
    if (b.length >= 2 && ((b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF))) return true;
    let printable = 0;
    for (const c of b) if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7E)) printable++;
    return printable / b.length > 0.85;
  } catch (_) { return false; }
}
