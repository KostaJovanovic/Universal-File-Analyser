/* Analyser - network-indicator (OSINT) extraction.

   Pulls URLs, IP addresses, domains and email addresses out of a file's text and
   builds a card that lists them with one-click lookup links to public OSINT
   services. Nothing is ever sent automatically - the links only open a third-party
   service in a new tab when the user clicks one, so the no-upload promise holds.

   Dependency-light: only the DOM helper from util.js. */

import { el } from './util.js';

// File-ish "TLDs" that are almost always a filename, not a real domain, so a token
// like "bundle.min.js" or "logo.png" doesn't get reported as a domain indicator.
const FILE_TLDS = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'css', 'scss', 'html', 'htm', 'xml', 'svg',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'txt', 'md', 'rst',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sql', 'log', 'lock', 'map',
  'py', 'rb', 'go', 'rs', 'java', 'class', 'php', 'c', 'h', 'cpp', 'cc', 'hpp', 'sh', 'bat', 'ps1',
  'yml', 'yaml', 'ini', 'cfg', 'conf', 'toml', 'env', 'properties',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'wav', 'avi', 'mov', 'webm',
  'zip', 'gz', 'tar', 'bz2', 'xz', 'rar', '7z', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

// Extract indicators of compromise / interest from a block of text. Returns
// { urls, ips, domains, emails }, each a deduped, capped array (insertion order).
export function extractIndicators(text, opts = {}) {
  const cap = opts.cap || 300;
  const out = { urls: [], ips: [], domains: [], emails: [] };
  if (!text) return out;
  const seen = { urls: new Set(), ips: new Set(), domains: new Set(), emails: new Set() };
  const add = (k, v) => { if (v && !seen[k].has(v) && out[k].length < cap) { seen[k].add(v); out[k].push(v); } };

  // URLs first; strip them out so their host isn't re-counted as a bare domain.
  let work = text.replace(/\bhttps?:\/\/[^\s"'<>()[\]{}\\|^`]+/gi, (m) => {
    add('urls', m.replace(/[.,;:'")\]}>]+$/, ''));
    return ' ';
  });
  // Emails next, also removed before the domain pass.
  work = work.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/g, (m) => {
    add('emails', m);
    return ' ';
  });
  // IPv4 with octet validation.
  let mm;
  const ipRe = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
  while ((mm = ipRe.exec(work))) add('ips', mm[0]);
  // Bare domains (a dotted hostname ending in a 2+ char alpha TLD), skipping the
  // filename-shaped ones and anything that's actually an IP.
  const domRe = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24})\b/gi;
  while ((mm = domRe.exec(work))) {
    const dom = mm[0].toLowerCase();
    if (FILE_TLDS.has(mm[1].toLowerCase())) continue;
    if (/^\d+(?:\.\d+)+$/.test(dom)) continue;
    add('domains', dom);
  }
  return out;
}

// Public lookup links per indicator type. enc keeps query strings safe.
const enc = encodeURIComponent;
const LOOKUPS = {
  url: (v) => [['VirusTotal', 'https://www.virustotal.com/gui/search/' + enc(v)], ['urlscan', 'https://urlscan.io/search/#' + enc(v)]],
  ip: (v) => [['VirusTotal', 'https://www.virustotal.com/gui/ip-address/' + enc(v)], ['AbuseIPDB', 'https://www.abuseipdb.com/check/' + enc(v)], ['Shodan', 'https://www.shodan.io/host/' + enc(v)]],
  domain: (v) => [['VirusTotal', 'https://www.virustotal.com/gui/domain/' + enc(v)], ['urlscan', 'https://urlscan.io/domain/' + enc(v)]],
  email: () => [],
};

// Build a "Network indicators" card from extracted indicators, or null if none.
// Each value carries small lookup links; per-section list capped for sanity.
export function osintCard(ind, opts = {}) {
  const total = ind.urls.length + ind.ips.length + ind.domains.length + ind.emails.length;
  if (!total) return null;
  const limit = opts.limit || 100;
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Network indicators'));
  card.appendChild(el('p', { class: 'anr-hint' },
    'URLs, IPs, domains and email addresses found in this file’s text. The lookup links open a third-party OSINT service in a new tab - nothing is sent until you click one.'));

  const section = (title, items, kind) => {
    if (!items.length) return;
    card.appendChild(el('div', { class: 'anr-readout-section' }, title + ' (' + items.length + ')'));
    const list = el('div', { class: 'anr-osint-list' });
    for (const v of items.slice(0, limit)) {
      const r = el('div', { class: 'anr-osint-row' });
      r.appendChild(el('span', { class: 'anr-osint-val' }, v));
      for (const [label, href] of (LOOKUPS[kind] ? LOOKUPS[kind](v) : [])) {
        r.appendChild(el('a', { class: 'anr-osint-lk', href, target: '_blank', rel: 'noopener noreferrer nofollow' }, label));
      }
      list.appendChild(r);
    }
    card.appendChild(list);
    if (items.length > limit) card.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:4px;' }, 'Showing first ' + limit + ' of ' + items.length + '.'));
  };
  section('URLs', ind.urls, 'url');
  section('IP addresses', ind.ips, 'ip');
  section('Domains', ind.domains, 'domain');
  section('Email addresses', ind.emails, 'email');
  return card;
}

// Convenience: extract from text and return a ready card (or null). Guarded.
export function buildOsintCard(text, opts) {
  try { return osintCard(extractIndicators(text || '', opts), opts); } catch (_) { return null; }
}
