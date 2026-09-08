/* Analyser desktop - native FFmpeg with hardware acceleration.
 *
 * WHY THIS EXISTS
 *
 * The web app runs @ffmpeg/core, a single-threaded WebAssembly build. WASM has
 * no route to a GPU's encoder blocks, so a transcode that NVENC finishes in
 * 0.6 s takes ffmpeg.wasm about 30 s. Wrapping the site in Electron changed
 * nothing about that on its own - this module is the part that does.
 *
 * WHAT IT DOES
 *
 *  1. Finds an ffmpeg binary (bundled, then PATH, then the usual install dirs).
 *  2. PROBES which hardware encoders actually work, by running each one on a
 *     throwaway frame. Presence in `ffmpeg -encoders` proves nothing: an
 *     NVIDIA-only machine still lists h264_qsv and h264_amf, and both fail at
 *     runtime. Only a real encode is evidence.
 *  3. Runs jobs as child processes, streaming stderr back for log + progress.
 *
 * The probe is cached in userData, keyed by the binary's path, size and mtime,
 * so only the first launch after an ffmpeg change pays for it.
 *
 * The renderer never sees any of this. src/renderers/video.ts wraps these IPC
 * calls in an object shaped exactly like the ffmpeg.wasm instance, so every
 * existing call site works unchanged.
 */

import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

// ---------------------------------------------------------------------------
// Locating the binary
// ---------------------------------------------------------------------------

const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

/** Directories worth checking beyond PATH. Covers the common installers on each
 *  platform, so a user who has ffmpeg but not on PATH still gets the fast path. */
function extraDirs() {
  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE || '';
    return [
      join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links'),
      'C:\\ffmpeg\\bin',
      'C:\\Program Files\\ffmpeg\\bin',
      join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin'),
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') {
    return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];
  }
  return ['/usr/bin', '/usr/local/bin', '/snap/bin'];
}

/**
 * Find an ffmpeg binary.
 *
 * Preferred paths are tried first, then PATH, then the usual install
 * directories. main.mjs passes the packaged location and - in a portable build
 * - the folder beside the .exe, so a USB copy can carry its own binary rather
 * than depending on the host machine.
 *
 * @param {string|string[]|null} bundled preferred absolute path(s)
 * @returns {string|null}
 */
export function findFfmpeg(bundled) {
  const seen = [];
  for (const p of (Array.isArray(bundled) ? bundled : [bundled])) {
    if (p) seen.push(p);
  }
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (dir) seen.push(join(dir, EXE));
  }
  for (const dir of extraDirs()) seen.push(join(dir, EXE));
  for (const p of seen) {
    try { if (existsSync(p) && statSync(p).isFile()) return p; } catch (_) { /* keep looking */ }
  }
  return null;
}

/** Run the binary and resolve its combined output, or null if it fails. */
function runCapture(bin, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => resolve(err && !stdout && !stderr ? null : String(stdout || '') + String(stderr || '')));
  });
}

/** True when the binary encodes one frame with `encoder` without erroring.
 *  This is the only trustworthy test - see the probe note at the top. */
function encoderWorks(bin, encoder, extraArgs = []) {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=0.1:r=10',
      ...extraArgs, '-c:v', encoder, '-frames:v', '3', '-f', 'null', '-',
    ];
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    let child;
    try { child = spawn(bin, args, { windowsHide: true }); } catch (_) { return finish(false); }
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} finish(false); }, 20000);
    child.on('error', () => { clearTimeout(timer); finish(false); });
    child.on('close', (code) => { clearTimeout(timer); finish(code === 0); });
    // Nothing reads these, but an unconsumed pipe can stall the child on Windows.
    if (child.stderr) child.stderr.resume();
    if (child.stdout) child.stdout.resume();
  });
}

// ---------------------------------------------------------------------------
// Capability probe
//
// Families in preference order. NVENC first (fastest and most predictable),
// then Intel Quick Sync, then AMD AMF, then Apple VideoToolbox.
// ---------------------------------------------------------------------------

const FAMILIES = [
  {
    vendor: 'nvidia', label: 'NVIDIA NVENC',
    h264: 'h264_nvenc', hevc: 'hevc_nvenc', av1: 'av1_nvenc',
    hwaccel: 'cuda',
    // x264's named presets map onto NVENC's p1..p7 speed/quality ladder.
    preset: { ultrafast: 'p1', superfast: 'p1', veryfast: 'p2', faster: 'p3', fast: 'p4', medium: 'p4', slow: 'p5', slower: 'p6', veryslow: 'p7' },
    quality: (crf) => ['-rc', 'vbr', '-cq', String(crf)],
  },
  {
    vendor: 'intel', label: 'Intel Quick Sync',
    h264: 'h264_qsv', hevc: 'hevc_qsv', av1: 'av1_qsv',
    hwaccel: 'qsv',
    preset: { ultrafast: 'veryfast', superfast: 'veryfast', veryfast: 'veryfast', faster: 'faster', fast: 'fast', medium: 'medium', slow: 'slow', slower: 'slower', veryslow: 'veryslow' },
    quality: (crf) => ['-global_quality', String(crf)],
  },
  {
    vendor: 'amd', label: 'AMD AMF',
    h264: 'h264_amf', hevc: 'hevc_amf', av1: 'av1_amf',
    hwaccel: 'd3d11va',
    preset: { ultrafast: 'speed', superfast: 'speed', veryfast: 'speed', faster: 'speed', fast: 'balanced', medium: 'balanced', slow: 'quality', slower: 'quality', veryslow: 'quality' },
    quality: (crf) => ['-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf)],
  },
  {
    vendor: 'apple', label: 'Apple VideoToolbox',
    h264: 'h264_videotoolbox', hevc: 'hevc_videotoolbox', av1: null,
    hwaccel: 'videotoolbox',
    preset: null,                                  // VideoToolbox takes no preset
    quality: (crf) => ['-q:v', String(Math.max(1, Math.min(100, 100 - crf * 2)))],
  },
];

/**
 * Work out which hardware encoders this machine can really use.
 * @returns {Promise<object>} capability record (also the shape sent to the page)
 */
export async function probe(bin) {
  const version = await runCapture(bin, ['-hide_banner', '-version'], 10000);
  const encoders = (await runCapture(bin, ['-hide_banner', '-encoders'], 15000)) || '';

  const families = [];
  for (const f of FAMILIES) {
    // Skip a family the build does not even contain - saves a pointless spawn.
    if (!f.h264 || encoders.indexOf(f.h264) === -1) continue;
    // The real test. An NVIDIA-only box lists h264_qsv and h264_amf and fails
    // both here, which is exactly the case that makes listing untrustworthy.
    if (!(await encoderWorks(bin, f.h264))) continue;
    const hevc = f.hevc && encoders.indexOf(f.hevc) !== -1 ? await encoderWorks(bin, f.hevc) : false;
    const av1 = f.av1 && encoders.indexOf(f.av1) !== -1 ? await encoderWorks(bin, f.av1) : false;
    families.push({ vendor: f.vendor, label: f.label, h264: f.h264, hevc: hevc ? f.hevc : null, av1: av1 ? f.av1 : null, hwaccel: f.hwaccel });
  }

  const best = families[0] || null;
  return {
    available: true,
    path: bin,
    version: (version || '').split('\n')[0] || '',
    // Every working family, best first. The page shows the winner; the rest are
    // there so a user can see what else the machine offers.
    families,
    accel: best,
    vendor: best ? best.vendor : null,
    label: best ? best.label : 'software only',
  };
}

// ---------------------------------------------------------------------------
// Cached probe. Keyed by the binary's identity so a replaced ffmpeg re-probes.
// ---------------------------------------------------------------------------

function binKey(bin) {
  try {
    const st = statSync(bin);
    return createHash('sha256').update(bin + ':' + st.size + ':' + Math.round(st.mtimeMs)).digest('hex').slice(0, 16);
  } catch (_) { return 'unknown'; }
}

const UNAVAILABLE = { available: false, path: null, version: '', families: [], accel: null, vendor: null, label: 'not installed' };

let _caps = null;
let _capsPromise = null;

/**
 * Capability record for this machine, probed once and cached on disk.
 * @param {string} cacheDir  app.getPath('userData')
 * @param {string|string[]|null} bundled  preferred binary path(s), if any
 */
export function capabilities(cacheDir, bundled) {
  if (_caps) return Promise.resolve(_caps);
  if (_capsPromise) return _capsPromise;

  _capsPromise = (async () => {
    const bin = findFfmpeg(bundled);
    if (!bin) { _caps = UNAVAILABLE; return _caps; }

    const cacheFile = join(cacheDir, 'ffmpeg-caps.json');
    const key = binKey(bin);
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (cached && cached.key === key && cached.caps) { _caps = cached.caps; return _caps; }
    } catch (_) { /* no usable cache - probe below */ }

    _caps = await probe(bin);
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ key, caps: _caps }));
    } catch (_) { /* a lost cache only costs one re-probe */ }
    return _caps;
  })();

  return _capsPromise;
}

// ---------------------------------------------------------------------------
// The virtual filesystem
//
// ffmpeg.wasm gives the page a little in-memory FS addressed by bare names
// ('input', 'out.mp4'). Native ffmpeg wants real paths, so each session gets a
// temp directory and every name maps into it. Names are flattened so nothing
// the page sends can escape - it only ever passes bare names anyway.
// ---------------------------------------------------------------------------

const sessions = new Map();

function safeName(name) {
  return String(name || 'f').replace(/[\\/]+/g, '_').replace(/^\.+/, '_') || 'f';
}

export async function openSession(id, tmpRoot) {
  const dir = join(tmpRoot, 'anr-ffmpeg-' + id);
  await mkdir(dir, { recursive: true });
  sessions.set(id, { dir, procs: new Set() });
  return dir;
}

function sessionOf(id) {
  const s = sessions.get(id);
  if (!s) throw new Error('no such ffmpeg session');
  return s;
}

export async function put(id, name, data) {
  const s = sessionOf(id);
  await writeFile(join(s.dir, safeName(name)), Buffer.from(data));
  return true;
}

export async function get(id, name) {
  const s = sessionOf(id);
  const buf = await readFile(join(s.dir, safeName(name)));
  // Return the underlying bytes; main.mjs hands them to the renderer as a
  // Uint8Array, matching what ffmpeg.wasm's readFile resolves to.
  return buf;
}

export async function del(id, name) {
  const s = sessionOf(id);
  await rm(join(s.dir, safeName(name)), { force: true });
  return true;
}

export async function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  for (const p of s.procs) { try { p.kill(); } catch (_) {} }
  sessions.delete(id);
  try { await rm(s.dir, { recursive: true, force: true }); } catch (_) { /* temp dir, leave it */ }
}

// ---------------------------------------------------------------------------
// Argument rewriting: software encoder -> this machine's hardware encoder
//
// Conservative on purpose. This is forensics software, so a wrong transcode is
// worse than a slow one. The rewrite only fires on a plain software video
// encode, never touches a stream copy, and the caller retries the ORIGINAL
// arguments if the hardware attempt fails (see runJob's fallback).
// ---------------------------------------------------------------------------

const SW_VIDEO = { libx264: 'h264', libopenh264: 'h264', libx265: 'hevc', 'libsvt-hevc': 'hevc', libaom: 'av1', 'libaom-av1': 'av1', 'libsvtav1': 'av1' };

/** Names of filters that must run on CPU frames, so decode acceleration would
 *  force a download and usually costs more than it saves. */
const FILTER_FLAGS = new Set(['-vf', '-filter:v', '-filter_complex', '-lavfi']);

/**
 * @param {string[]} args   the arguments the page sent (ffmpeg.wasm flavour)
 * @param {object|null} accel  the chosen family from the probe
 * @returns {{args: string[], changed: boolean, note: string}}
 */
export function accelerate(args, accel) {
  if (!accel) return { args, changed: false, note: '' };

  const out = args.slice();
  const idxC = out.findIndex((a) => a === '-c:v' || a === '-vcodec');
  if (idxC === -1 || idxC + 1 >= out.length) return { args, changed: false, note: '' };

  const sw = out[idxC + 1];
  const codec = SW_VIDEO[sw];
  if (!codec) return { args, changed: false, note: '' };   // 'copy', or already hardware

  const target = codec === 'h264' ? accel.h264 : codec === 'hevc' ? accel.hevc : accel.av1;
  if (!target) return { args, changed: false, note: '' };  // this family cannot do that codec

  const family = FAMILIES.find((f) => f.vendor === accel.vendor);
  if (!family) return { args, changed: false, note: '' };

  out[idxC + 1] = target;

  // Preset: x264 names are meaningless to NVENC/QSV/AMF, so translate or drop.
  const idxP = out.findIndex((a) => a === '-preset');
  if (idxP !== -1 && idxP + 1 < out.length) {
    const mapped = family.preset ? family.preset[out[idxP + 1]] : null;
    if (mapped) out[idxP + 1] = mapped;
    else out.splice(idxP, 2);                      // unmappable - let the encoder default
  }

  // Quality: -crf is an x264/x265 concept. Each family spells it differently.
  const idxQ = out.findIndex((a) => a === '-crf');
  if (idxQ !== -1 && idxQ + 1 < out.length) {
    const crf = parseInt(out[idxQ + 1], 10);
    out.splice(idxQ, 2, ...(Number.isFinite(crf) ? family.quality(crf) : []));
  }

  // Decode acceleration, only when no filter graph needs CPU frames. Placed
  // before the first -i, which is where ffmpeg requires input options.
  const hasFilter = out.some((a) => FILTER_FLAGS.has(a));
  let note = family.label + ' ' + target;
  const idxI = out.indexOf('-i');
  if (!hasFilter && family.hwaccel && idxI !== -1 && out.indexOf('-hwaccel') === -1) {
    out.splice(idxI, 0, '-hwaccel', family.hwaccel);
    note += ' (+' + family.hwaccel + ' decode)';
  }

  return { args: out, changed: true, note };
}

// ---------------------------------------------------------------------------
// Running a job
// ---------------------------------------------------------------------------

/** ffmpeg writes progress to stderr as `time=00:00:12.34`. Turning that into a
 *  0..1 fraction needs the duration, which appears once as `Duration: ...`. */
function parseClock(s) {
  const m = /(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(s);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
}

/**
 * Run one ffmpeg job.
 *
 * @param {string} id        session id
 * @param {string[]} rawArgs arguments as the page sent them
 * @param {object} opts      { bin, accel, timeout, onLog, onProgress }
 * @returns {Promise<{ok: boolean, code: number, accelerated: boolean, note: string, log: string}>}
 */
export async function runJob(id, rawArgs, opts) {
  const { bin, accel, timeout = 0, onLog, onProgress } = opts;
  const s = sessionOf(id);

  const attempt = (args, accelerated, note) => new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ['-hide_banner', '-nostdin', ...args], { cwd: s.dir, windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, code: -1, accelerated, note, log: String(err && err.message || err) });
    }
    s.procs.add(child);

    let log = '';
    let duration = null;
    let killedByTimeout = false;
    const timer = timeout > 0 ? setTimeout(() => { killedByTimeout = true; try { child.kill(); } catch (_) {} }, timeout) : null;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      log += chunk;
      // Keep the buffer bounded; a long job can emit megabytes of stderr.
      if (log.length > 262144) log = log.slice(-131072);
      if (onLog) onLog(chunk);
      if (duration === null) {
        const d = /Duration:\s*(\d+:\d\d:\d\d(?:\.\d+)?)/.exec(chunk);
        if (d) duration = parseClock(d[1]);
      }
      if (onProgress && duration) {
        const t = /time=\s*(\d+:\d\d:\d\d(?:\.\d+)?)/.exec(chunk);
        const secs = t ? parseClock(t[1]) : null;
        if (secs !== null) onProgress(Math.max(0, Math.min(1, secs / duration)));
      }
    });
    if (child.stdout) child.stdout.resume();

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      s.procs.delete(child);
      resolve({ ok: false, code: -1, accelerated, note, log: log + String(err && err.message || err) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      s.procs.delete(child);
      resolve({ ok: code === 0 && !killedByTimeout, code: code === null ? -1 : code, accelerated, note, log });
    });
  });

  const { args, changed, note } = accelerate(rawArgs, accel);

  if (changed) {
    const hw = await attempt(args, true, note);
    if (hw.ok) return hw;
    // The hardware path failed: a driver refusing this resolution, a pixel
    // format the encoder will not take, a busy GPU. Fall back to exactly what
    // the page asked for, so a hardware quirk can never lose the user a job.
    if (onLog) onLog('\n[analyser] hardware encode failed, retrying in software\n');
    const sw = await attempt(rawArgs, false, 'software fallback');
    return sw;
  }

  return attempt(rawArgs, false, '');
}
