// Build web/assets/vendor/nanoprc/ (nanoPRC + tools/nanoprc/anr_prc.c, as
// WebAssembly). Not part of the save.bat chain: run it by hand when nanoPRC or
// the glue changes, and commit the output with it.
//
//   node tools/nanoprc/build.mjs [path/to/nanoPRC] [path/to/emsdk]
//
// Defaults: research/prc/ref/nanoPRC (a checkout WITH submodules - zlib comes
// from its thirdparty/) and research/prc/emsdk (an emsdk with `latest`
// installed and activated; nothing outside that folder is needed).
//
// The source list is nanoPRC's own PRC_CORE_SOURCES from its CMakeLists.txt.
// The writer half is compiled in with it because prc_api.c references it; it
// costs size, not behaviour, since the glue only reads.
//
// nanoPRC is AGPL-3.0, so the output folder gets its licence, its third-party
// notices and SOURCE.txt naming the exact upstream commit the binary was built
// from. The glue's own source is this folder.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATCHES } from './patches.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
// --exact: also switch on nanoPRC's exact-geometry (B-rep) tessellator, which
// upstream ships disabled (ENABLE_EXACT_GEOM_TESS 0 in include/prc_api.h). The
// switch is a plain #define with no #ifndef guard, so it is flipped in a copy of
// the header placed ahead of the real one on the include path.
// --out <dir>: write somewhere other than web/assets/vendor/nanoprc (trials).
// --glue <file.c>: compile another glue in place of anr_prc.c (diagnostics;
// with --out, so the shipped build is never replaced by one).
const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); if (i === -1) return null; argv.splice(i, 1); return true; };
const opt = (f) => { const i = argv.indexOf(f); if (i === -1) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const EXACT = !!flag('--exact');
const OUT = resolve(opt('--out') || join(ROOT, 'web', 'assets', 'vendor', 'nanoprc'));
const GLUE = resolve(opt('--glue') || join(HERE, 'anr_prc.c'));
const NANO = resolve(argv[0] || join(ROOT, 'research', 'prc', 'ref', 'nanoPRC'));
const EMSDK = resolve(argv[1] || join(ROOT, 'research', 'prc', 'emsdk'));
const GEN = join(ROOT, 'research', 'prc', 'build-gen');

const emcc = [join(EMSDK, 'upstream', 'emscripten', 'emcc.exe'), join(EMSDK, 'upstream', 'emscripten', 'emcc')]
  .find((p) => existsSync(p));
if (!emcc) throw new Error('emcc not found under ' + EMSDK + ' - install and activate emsdk there first');
if (!existsSync(join(NANO, 'thirdparty', 'zlib', 'inflate.c'))) throw new Error('nanoPRC checkout without submodules: ' + NANO);

const git = (...a) => execFileSync('git', ['-C', NANO, ...a], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
let describe = 'v0.1.0';
try { describe = git('describe', '--tags', '--always', '--match', 'v[0-9]*') || describe; } catch (_) { /* no tags */ }
const version = describe.replace(/^v/, '');

mkdirSync(GEN, { recursive: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(GEN, 'prc_version.h'),
  `#ifndef PRC_VERSION_H\n#define PRC_VERSION_H\n#define PRC_VERSION "${version}"\n#define PRC_GIT_DESCRIBE "${describe}"\n#endif\n`);
const apiH = readFileSync(join(NANO, 'include', 'prc_api.h'), 'utf8');
if (!/#define ENABLE_EXACT_GEOM_TESS [01]\b/.test(apiH)) throw new Error('ENABLE_EXACT_GEOM_TESS switch not found in prc_api.h');
writeFileSync(join(GEN, 'prc_api.h'), apiH.replace(/#define ENABLE_EXACT_GEOM_TESS [01]\b/, '#define ENABLE_EXACT_GEOM_TESS ' + (EXACT ? 1 : 0)));

// Read the source list out of CMakeLists.txt so it follows upstream.
const cmake = readFileSync(join(NANO, 'CMakeLists.txt'), 'utf8');
const block = cmake.match(/set\(PRC_CORE_SOURCES([\s\S]*?)\)/);
if (!block) throw new Error('PRC_CORE_SOURCES not found in nanoPRC CMakeLists.txt');
// Patched files (tools/nanoprc/patches.mjs) are compiled from a copy in GEN;
// their own #include "..." lines still resolve, through -I src below.
const patched = new Map();
for (const p of PATCHES) {
  const src = patched.get(p.file) ?? readFileSync(join(NANO, p.file), 'utf8');
  const hits = src.split(p.find).length - 1;
  if (hits !== 1) throw new Error(`patch for ${p.file} matched ${hits} times (expected 1): ${p.why}`);
  patched.set(p.file, src.replace(p.find, p.replace));
}
for (const [file, text] of patched) writeFileSync(join(GEN, file.replace(/[\\/]/g, '__')), text);
const core = [...block[1].matchAll(/"([^"]+\.c)"/g)].map((m) =>
  patched.has(m[1]) ? join(GEN, m[1].replace(/[\\/]/g, '__')) : join(NANO, m[1]));
const zlib = ['adler32', 'compress', 'crc32', 'deflate', 'inffast', 'inflate', 'inftrees', 'trees', 'uncompr', 'zutil']
  .map((n) => join(NANO, 'thirdparty', 'zlib', n + '.c'));

const args = [
  ...core, ...zlib, GLUE,
  // GEN first: its prc_api.h (the exact-geometry switch set) shadows include/'s.
  '-I' + GEN, '-I' + join(NANO, 'include'), '-I' + join(NANO, 'src'), '-I' + join(NANO, 'thirdparty', 'zlib'),
  '-std=gnu99', '-O3', '-w',
  '-DPRC_LITTLE_ENDIAN', `-DPRC_VERSION_STRING="${version}"`,
  '-DPRC_DEBUG_MEMORY=0', '-DPRC_ENABLE_UNZIPPED_FUZZ=0', '-DPRC_ENABLE_DIAG_ENV=0',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sEXPORT_NAME=createNanoPrc',
  // node only so the harnesses in research/prc/tools/ can run the very same build.
  '-sENVIRONMENT=web,worker,node',
  '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=32MB', '-sMAXIMUM_MEMORY=2GB', '-sSTACK_SIZE=4MB',
  // A failed allocation returns NULL to nanoPRC (which checks) instead of aborting.
  '-sABORTING_MALLOC=0',
  '-sFORCE_FILESYSTEM=1', '-sEXIT_RUNTIME=0',
  '-sEXPORTED_FUNCTIONS=_anr_prc_mesh', '-sEXPORTED_RUNTIME_METHODS=FS,ccall',
  '-o', join(OUT, 'nanoprc.mjs'),
];

console.log(`Building nanoPRC ${describe} (${commit.slice(0, 12)}): ${core.length} library + ${zlib.length} zlib sources, exact geometry ${EXACT ? 'ON' : 'off'} -> ${OUT}`);
execFileSync(emcc, args, { stdio: 'inherit' });

copyFileSync(join(NANO, 'LICENSE'), join(OUT, 'LICENSE'));
copyFileSync(join(NANO, 'THIRD_PARTY_NOTICES.md'), join(OUT, 'THIRD_PARTY_NOTICES.md'));
if (existsSync(join(NANO, 'thirdparty', 'PDFium_LICENSE.txt'))) copyFileSync(join(NANO, 'thirdparty', 'PDFium_LICENSE.txt'), join(OUT, 'PDFium_LICENSE.txt'));
writeFileSync(join(OUT, 'SOURCE.txt'), [
  'nanoPRC, compiled to WebAssembly for Analyser\'s 3D PDF viewer.',
  '',
  'Licence: GNU Affero General Public License v3.0 (LICENSE in this folder).',
  'Copyright (C) 2023-2026 CascadiaVoxel LLC.',
  '',
  'Corresponding source:',
  '  nanoPRC  https://github.com/mvrhel/nanoPRC',
  `           commit ${commit} (${describe}), with its zlib submodule`,
  '  glue     tools/nanoprc/anr_prc.c in this repository',
  '  build    tools/nanoprc/build.mjs in this repository',
  '',
].join('\n'));

for (const f of ['nanoprc.mjs', 'nanoprc.wasm']) console.log(f.padEnd(14), (statSync(join(OUT, f)).size / 1024).toFixed(0) + ' KB');
