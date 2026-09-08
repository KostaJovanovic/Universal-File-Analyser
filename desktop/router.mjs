/* Analyser desktop - URL routing for the `analyser://` scheme.
 *
 * A one-to-one port of `serve.py`'s CleanURLHandler._route(), which itself
 * mirrors the production Cloudflare routing (html_handling =
 * "auto-trailing-slash", not_found_handling = "404-page"). serve.py is the
 * spec; keep the two in step.
 *
 * Differences from serve.py, both deliberate:
 *
 *  - serve.py answers `/about.html` with a 308 redirect to `/about`. In the
 *    app there is no SEO or canonical-URL reason to redirect, and a redirect
 *    on a custom scheme is extra machinery for nothing, so `/about.html` is
 *    served directly. Every in-app link uses the clean form anyway.
 *  - `/api/*` is not mocked here. It is proxied to the live site from the main
 *    process (see main.mjs), because `API_ORIGIN` in src/core/util.ts is ''
 *    (same origin) and the Worker sets no CORS headers.
 *
 * Pure module: no Electron imports, so it can be reasoned about (and unit
 * tested) on its own.
 */

import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

/** Content types we set ourselves rather than trusting the file: response.
 *
 *  `net.fetch()` on a file: URL fills Content-Type in from Chromium's own
 *  extension map, and for the two that matter here it gets them right:
 *  `.mjs` -> text/javascript and `.wasm` -> application/wasm (both have been
 *  in the net mime table for years). A module script with the wrong type is
 *  refused outright, and streaming WASM compilation falls back or fails, so
 *  neither is something to leave to chance across Electron versions - we set
 *  the type from this table whenever we know the extension, and fall back to
 *  whatever the file: response said when we do not. */
export const MIME = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  zip: 'application/zip',
  data: 'application/octet-stream',
  bin: 'application/octet-stream',
};

/** MIME for a file name, or '' when the extension is unknown. */
export function mimeFor(name) {
  const m = String(name || '').match(/\.([^./\\]+)$/);
  return (m && MIME[m[1].toLowerCase()]) || '';
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch (_) { return false; }
}

/**
 * Map a request pathname to what should be served.
 *
 * @param {string} rawPath  the URL pathname, still percent-encoded
 * @param {string} webDir   absolute path of the web/ document root
 * @returns {{proxy: true} | {file: string, notFound?: boolean}}
 */
export function route(rawPath, webDir) {
  // /api/* never touches disk - main.mjs forwards it to the live Worker.
  if (rawPath.startsWith('/api/')) return { proxy: true };

  // Decode percent-escapes before any filesystem check: a request for
  // "/samples/analyser%20plaque.obj" must match the on-disk file with a literal
  // space. Same reasoning as serve.py, which learnt it the hard way.
  let path;
  try { path = decodeURIComponent(rawPath); } catch (_) { path = rawPath; }

  const notFound = () => ({ file: join(webDir, '404.html'), notFound: true });

  if (path === '' || path === '/') return { file: join(webDir, 'index.html') };

  const rel = path.replace(/^\/+/, '');
  // Reject traversal before touching the disk. normalize() collapses ".." and
  // both slash flavours; anything that escapes web/ is a 404, not a read.
  const full = normalize(join(webDir, rel));
  if (full !== webDir && !full.startsWith(webDir + sep)) return notFound();

  if (isFile(full)) return { file: full };              // real asset, served as-is
  if (isFile(full + '.html')) return { file: full + '.html' };  // /about -> about.html
  return notFound();                                    // Cloudflare's 404-page
}

/** True when web/ looks like the real document root (used for a clear startup
 *  error rather than a blank window). */
export function looksLikeWebRoot(dir) {
  return existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'assets'));
}
