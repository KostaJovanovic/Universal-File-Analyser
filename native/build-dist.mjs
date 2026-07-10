// build-dist.mjs - assemble ../dist for the Tauri native shell.
//
// Analyser has no framework build (editing a file is the dev loop), but Tauri's
// `frontendDist` wants one clean folder. This lives in native/ and reads the
// website source from the parent (the repo root), copying it into native/dist/,
// excluding dev-only dirs and files, then vendors the handful of big WASM
// subsystems the web build streams from a CDN so the native app is fully offline
// and strict-CSP-clean. It is wired as `beforeBuildCommand` in
// native/src-tauri/tauri.conf.json, so `tauri build` runs it automatically;
// `tauri dev` does not need it (it loads the live serve.py dev server via devUrl).
//
// The exclude list mirrors .assetsignore (the Cloudflare deploy's source of truth)
// plus a few native-only exclusions:
//   * sw.js            - the service worker is disabled in the shell (navigate.js
//                        also no-ops registration); shipping it would only add a
//                        stale-cache layer that fights the native updater.
//   * robots/sitemaps/ - crawler-only; meaningless in an offline app.
//     llms.txt
//   * node_modules, src-tauri, dist, tools, worker, research, ... - not runtime.
//
// Vendored WASM (see VENDOR below): ffmpeg core, onnxruntime-web + the Kim Vocal 2
// model, and the OpenCASCADE kernel. The web build streams these from jsDelivr /
// HuggingFace only because they exceed Cloudflare's 25 MiB per-asset cap; the
// native bundle has no cap, so we download them once (cached under .native-cache/)
// and the renderers pick the local copy when running under the Tauri asset
// protocol (see the NATIVE_SHELL checks in video.js / mdx-model.js / occt-loader.js).
//
// Run manually (from native/):  node build-dist.mjs            (copy + vendor)
//                               node build-dist.mjs --no-vendor (copy only, fast)

import { readdirSync, rmSync, mkdirSync, cpSync, statSync, existsSync, createWriteStream, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const NATIVE_DIR = dirname(fileURLToPath(import.meta.url)); // .../native (this folder)
const ROOT = join(NATIVE_DIR, '..');                        // repo root = the website source
const DIST = join(NATIVE_DIR, 'dist');                      // native/dist (Tauri frontendDist)
const CACHE = join(NATIVE_DIR, '.native-cache');            // gitignored; survives dist wipes
const NO_VENDOR = process.argv.includes('--no-vendor');

// Top-level directories never shipped to the native app.
const EXCLUDE_DIRS = new Set([
  '.git', '.github', '.claude', '.wrangler',
  'native',                                       // the Tauri shell itself (this folder)
  'node_modules', 'dist', 'src-tauri', '.native-cache',
  'tools', 'worker', 'research', 'research2', 'stats-backup', 'minimal',
]);

// Top-level files never shipped to the native app.
const EXCLUDE_FILES = new Set([
  '.assetsignore', '.gitattributes', '.gitignore', '.editorconfig',
  'CLAUDE.md', 'README.md', 'DOCS_PLAN.md', 'LICENSE', 'nul',
  'package.json', 'package-lock.json',
  'serve.py', 'wrangler.jsonc',
  'sw.js',                                         // service worker disabled in the shell
  'robots.txt', 'sitemap.xml', 'sitemap-formats.xml', 'llms.txt', // crawler-only
]);

// The CDN subsystems to bundle. dir -> the local folder under dist/assets/vendor/;
// files -> { localName: sourceUrl }. Keep the URLs/versions in lockstep with the
// constants in the renderers (video.js FFMPEG_CORE_BASE, mdx-model.js ORT_VERSION
// + MDX_MODEL.url, occt-loader.js OCCT_VERSION).
const FF = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist';
const OCCT = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist';
const VENDOR = [
  { dir: 'ffmpeg-core', files: {
    'ffmpeg-core.js':   `${FF}/ffmpeg-core.js`,
    'ffmpeg-core.wasm': `${FF}/ffmpeg-core.wasm`,
  } },
  { dir: 'onnxruntime', files: {
    'ort.webgpu.min.mjs':                `${ORT}/ort.webgpu.min.mjs`,
    'ort-wasm-simd-threaded.jsep.mjs':   `${ORT}/ort-wasm-simd-threaded.jsep.mjs`,
    'ort-wasm-simd-threaded.jsep.wasm':  `${ORT}/ort-wasm-simd-threaded.jsep.wasm`,
  } },
  { dir: 'occt', files: {
    'occt-import-js.js':   `${OCCT}/occt-import-js.js`,
    'occt-import-js.wasm': `${OCCT}/occt-import-js.wasm`,
  } },
  { dir: 'models', files: {
    // Both vocal-separation model tiers (see MDX_MODELS in mdx-model.js): the
    // Standard default plus the smaller Lite model, so either works offline.
    'Kim_Vocal_2.onnx':      'https://huggingface.co/seanghay/uvr_models/resolve/main/Kim_Vocal_2.onnx',
    'UVR_MDXNET_1_9703.onnx': 'https://huggingface.co/seanghay/uvr_models/resolve/main/UVR_MDXNET_1_9703.onnx',
  } },
];

function shouldSkip(name) {
  return EXCLUDE_DIRS.has(name) || EXCLUDE_FILES.has(name) || name.endsWith('.bat');
}

function mb(bytes) { return (bytes / (1024 * 1024)).toFixed(1) + ' MB'; }

// Count files + bytes for the summary line, so a mis-scoped copy is obvious.
function tally(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return { files: 1, bytes: st.size };
  let files = 0, bytes = 0;
  for (const name of readdirSync(path)) {
    const t = tally(join(path, name));
    files += t.files; bytes += t.bytes;
  }
  return { files, bytes };
}

// Download url -> dest, streamed to disk. These assets are version-pinned and
// immutable, so a present cache file is a hit - no size check (the CDN serves
// brotli, so a HEAD Content-Length would be the compressed length and never match
// the decompressed bytes on disk). The download goes to a .tmp and is atomically
// renamed on success, so the cache only ever holds complete files - a partial
// download can't masquerade as a valid cache entry.
async function fetchToCache(url, dest) {
  if (existsSync(dest)) return { bytes: statSync(dest).size, cached: true };
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
  return { bytes: statSync(dest).size, cached: false };
}

async function vendorWasm() {
  console.log('build-dist: vendoring CDN WASM into the bundle (cached in .native-cache/) ...');
  let total = 0, failures = 0;
  for (const group of VENDOR) {
    for (const [name, url] of Object.entries(group.files)) {
      const cachePath = join(CACHE, group.dir, name);
      const distPath = join(DIST, 'assets', 'vendor', group.dir, name);
      try {
        const r = await fetchToCache(url, cachePath);
        mkdirSync(dirname(distPath), { recursive: true });
        cpSync(cachePath, distPath);
        total += r.bytes;
        console.log(`  ${r.cached ? 'cache' : 'fetch'}  ${group.dir}/${name}  (${mb(r.bytes)})`);
      } catch (e) {
        failures++;
        console.warn(`  WARN   ${group.dir}/${name} - ${e.message}`);
      }
    }
  }
  console.log(`build-dist: vendored ${mb(total)} of WASM${failures ? ` (${failures} file(s) failed - those features will need the network)` : ''}`);
  return failures;
}

console.log('build-dist: assembling dist/ ...');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

let copied = 0;
for (const name of readdirSync(ROOT)) {
  if (shouldSkip(name)) continue;
  cpSync(join(ROOT, name), join(DIST, name), { recursive: true });
  copied++;
}
const t = tally(DIST);
console.log(`build-dist: copied ${copied} top-level entries -> ${t.files} files, ${mb(t.bytes)}`);

if (NO_VENDOR) {
  console.log('build-dist: --no-vendor set, skipping WASM vendoring (features that need it will fall back to the CDN at runtime).');
} else {
  await vendorWasm();
  const total = tally(DIST);
  console.log(`build-dist: done -> ${total.files} files, ${mb(total.bytes)} in dist/`);
}
