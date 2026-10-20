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
 *  1. Finds an ffmpeg binary (the user's choice or Analyser's own download, see
 *     ffmpeg-setup.mjs, then bundled, then PATH, then the usual install dirs).
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
import { appendFile, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// The encoder families, the argument rewrite and the safety checks live in a
// pure module, so the Android shell runs the same rules. See its header.
import { FAMILIES, LIST_PEEK, accelerate, checkArgs, checkInputBytes, inputsOf, isSafeName } from './ffmpeg-accel.mjs';
export { accelerate };

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
 * directories. main.mjs passes the file the user chose and the copy Analyser
 * downloaded (ffmpeg-setup.mjs), then the packaged location and - in a portable
 * build - the folder beside the .exe, so a USB copy can carry its own binary
 * rather than depending on the host machine.
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

/** Run the binary and resolve true when it exits 0 inside 20 s. */
function runsClean(bin, args) {
  return new Promise((resolve) => {
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

/** What a family's encoder needs around a probe encode: VAAPI names its device
 *  and uploads the frames; the others need nothing. */
function familyArgs(f, device) {
  return f.upload ? { pre: ['-vaapi_device', device], post: ['-vf', f.upload] } : { pre: [], post: [] };
}

/** True when the binary encodes a few frames with `encoder` without erroring.
 *  This is the only trustworthy test - see the probe note at the top. With
 *  `out`, the frames are kept as an MP4 there, for the decode test. */
function encoderWorks(bin, encoder, f, device, out) {
  const { pre, post } = familyArgs(f, device);
  return runsClean(bin, [
    '-hide_banner', '-loglevel', 'error', ...pre,
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=0.5:r=10',
    ...post, '-c:v', encoder, '-frames:v', '5',
    ...(out ? ['-y', out] : ['-f', 'null', '-']),
  ]);
}

/** True when the family's -hwaccel decodes the clip encoderWorks() kept. An
 *  encoder that works says nothing about the decoder: the device may not open
 *  for decoding, or the driver may lack the profile. ffmpeg quietly decodes in
 *  software when the GPU cannot take a stream, so a pass here means the device
 *  opens, not that every file will decode on it - runJob still retries. */
function decoderWorks(bin, f, device, clip) {
  const { pre } = familyArgs(f, device);
  return runsClean(bin, ['-hide_banner', '-loglevel', 'error', ...pre, '-hwaccel', f.hwaccel, '-i', clip, '-f', 'null', '-']);
}

// ---------------------------------------------------------------------------
// Capability probe
//
// FAMILIES (in ffmpeg-accel.mjs) is in preference order: NVENC first (fastest
// and most predictable), then Intel Quick Sync, AMD AMF, VAAPI, Apple
// VideoToolbox, and Android MediaCodec, which no desktop build lists.
// ---------------------------------------------------------------------------

/**
 * Work out which hardware encoders this machine can really use, and whether
 * each family's hardware DECODER works too (`decode`, which accelerate()
 * reads). VAAPI also records the render node that answered (`device`).
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
    // The encode is kept as a clip, so the decoder can be tested on it.
    const clip = join(tmpdir(), 'anr-ffmpeg-probe-' + process.pid + '-' + f.vendor + '.mp4');
    let device = null;
    let works = false;
    for (const d of (f.devices || [null])) {
      if (await encoderWorks(bin, f.h264, f, d, clip)) { device = d; works = true; break; }
    }
    if (!works) { await rm(clip, { force: true }).catch(() => {}); continue; }
    const decode = f.hwaccel ? await decoderWorks(bin, f, device, clip) : false;
    await rm(clip, { force: true }).catch(() => {});
    const hevc = f.hevc && encoders.indexOf(f.hevc) !== -1 ? await encoderWorks(bin, f.hevc, f, device) : false;
    const av1 = f.av1 && encoders.indexOf(f.av1) !== -1 ? await encoderWorks(bin, f.av1, f, device) : false;
    families.push({
      vendor: f.vendor, label: f.label, h264: f.h264, hevc: hevc ? f.hevc : null, av1: av1 ? f.av1 : null,
      hwaccel: f.hwaccel, decode, ...(device ? { device } : {}),
    });
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

/** Bump when the probe learns something new, so every cached record re-probes.
 *  2: the separate decode test and the VAAPI family. */
const PROBE_VERSION = 2;

function binKey(bin) {
  try {
    const st = statSync(bin);
    return createHash('sha256').update(PROBE_VERSION + ':' + bin + ':' + st.size + ':' + Math.round(st.mtimeMs)).digest('hex').slice(0, 16);
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

/** Forget the record, so the next capabilities() finds and probes again. Called
 *  when ffmpeg-setup.mjs puts a different binary in charge mid-run. */
export function resetCapabilities() {
  _caps = null;
  _capsPromise = null;
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

/** The session-folder path for a page-supplied name. Slashes are flattened as
 *  before, then the result must be a bare name by the checks' own rule
 *  (isSafeName): no colon (an NTFS stream, or a drive), no control character,
 *  no Windows device name (CON, NUL, COM1...). Anything else throws, which the
 *  page sees as a failed writeFile/readFile - as ffmpeg.wasm would report it. */
function safeName(name) {
  const flat = String(name || 'f').replace(/[\\/]+/g, '_').replace(/^\.+/, '_') || 'f';
  if (!isSafeName(flat)) throw new Error('not a valid ffmpeg file name');
  return flat;
}

export async function openSession(id, tmpRoot) {
  const dir = join(tmpRoot, 'anr-ffmpeg-' + id);
  await mkdir(dir, { recursive: true });
  sessions.set(id, { dir, procs: new Set(), links: new Map() });
  return dir;
}

/**
 * Let a bare session name stand for a file the user opened, so ffmpeg reads it
 * where it is instead of a copy streamed over in pieces. main.mjs resolves the
 * page's token to the path; the page never sees or sends a path.
 *
 * A link only ever stands in as an INPUT: runJob swaps it in for an -i value
 * after every check has passed on the bare name, and checkInputs peeks the real
 * file. An output of the same name still lands in the session folder, get()
 * never reads through a link, and del() only forgets it - the user's file is
 * never written or deleted.
 */
export function link(id, name, path) {
  sessionOf(id).links.set(safeName(name), path);
  return true;
}

function sessionOf(id) {
  const s = sessions.get(id);
  if (!s) throw new Error('no such ffmpeg session');
  return s;
}

/** `append` adds to the file instead of replacing it, so the page can stream a
 *  multi-GB input over in chunks rather than hold it in memory whole. */
export async function put(id, name, data, append) {
  const s = sessionOf(id);
  const n = safeName(name);
  s.links.delete(n);                               // a written file replaces a link
  await (append ? appendFile : writeFile)(join(s.dir, n), Buffer.from(data));
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
  const n = safeName(name);
  // A linked name is the user's own file: forget the link, touch nothing.
  if (s.links.delete(n)) return true;
  await rm(join(s.dir, n), { force: true });
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
// The safety check's file half
//
// checkArgs() sees only the argument strings. An input can ALSO be a list that
// names other files - the reverse in video.ts feeds `-f concat -safe 0` a list
// it wrote itself - so each small text input is read and checked too.
// ---------------------------------------------------------------------------

/* Only the first LIST_PEEK bytes of an input are read. Lists are tiny, a video
 * is binary and fails the text test on its first bytes, and a list larger than
 * the peek is refused by checkInputBytes rather than half-checked. The byte
 * rules live in ffmpeg-accel.mjs so the Android port decides identically. */
async function checkInputs(s, args) {
  for (const { name, format } of inputsOf(args)) {
    const n = safeName(name);
    const path = s.links.get(n) || join(s.dir, n);
    let st;
    try { st = await stat(path); } catch (_) { continue; }   // ffmpeg reports the missing file itself
    if (!st.isFile()) return 'the input ' + JSON.stringify(name) + ' is not a file';
    const fh = await open(path, 'r');
    let head;
    try {
      const buf = Buffer.alloc(Math.min(st.size, LIST_PEEK));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      head = buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
    const bad = checkInputBytes(head, st.size, format === 'concat');
    if (bad) return bad;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Running a job
// ---------------------------------------------------------------------------

/** The arguments with every linked -i value swapped for its real path. Runs on
 *  arguments that have already passed checkArgs as bare names, and only after.
 *  The `file:` prefix makes ffmpeg open it as a plain file whatever the path
 *  holds - a folder named `concat:x` is a path here, not a protocol. */
function withLinks(s, args) {
  if (!s.links.size) return args;
  return args.map((a, i) => {
    if (i === 0 || args[i - 1] !== '-i') return a;
    const p = s.links.get(a);
    return p ? 'file:' + p : a;
  });
}

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

  // The page chose these arguments, and the page is not trusted - see CHECKS
  // in ffmpeg-accel.mjs. Refuse before anything spawns. The code is 1, not -1:
  // video.ts reads -1 as "ffmpeg could not start" and throws the instance
  // away, while a non-zero exit is a clean failure it already handles.
  const refuse = (why) => {
    const log = '[analyser] refused to run ffmpeg: ' + why + '\n';
    if (onLog) onLog(log);
    return { ok: false, code: 1, accelerated: false, note: 'refused', log };
  };
  let refused;
  try { refused = checkArgs(rawArgs) || await checkInputs(s, rawArgs); }
  catch (err) { refused = String(err && err.message || err); }
  if (refused) return refuse(refused);

  // A retry adds -y: a failed attempt can leave a half-written output behind,
  // and without -y the next attempt would stop at "file exists".
  let attempts = 0;
  const attempt = (args, accelerated, note) => new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ['-hide_banner', '-nostdin', ...(attempts++ ? ['-y'] : []), ...withLinks(s, args)], { cwd: s.dir, windowsHide: true });
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

  // Up to three tries, cheapest first:
  //  1. hardware decode (and resize) + hardware encode,
  //  2. CPU decode + hardware encode, when step 1 used the GPU decoder - a file
  //     the GPU cannot decode should not cost the user a working encoder,
  //  3. exactly what the page asked for, in software. Always the last resort,
  //     so a hardware quirk can never lose the user a job.
  // Every rewrite is what actually spawns, so each is checked too. It only
  // ever swaps in names from FAMILIES, but a check that trusts its input's
  // provenance is not a check. A refused rewrite skips to the next step.
  const tries = [];
  const full = accelerate(rawArgs, accel);
  if (full.changed) {
    tries.push(full);
    // A decode-only job (no encoder) has no middle step: without the GPU
    // decoder it IS the software job.
    const encodeOnly = full.decoded ? accelerate(rawArgs, accel, { decode: false }) : null;
    if (encodeOnly && encodeOnly.changed) tries.push(encodeOnly);
  }
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i];
    const why = checkArgs(t.args);
    if (why) {
      if (onLog) onLog('[analyser] hardware rewrite refused (' + why + '), trying the next way\n');
      continue;
    }
    const hw = await attempt(t.args, true, t.note);
    if (hw.ok) return hw;
    // A driver refusing this resolution, a pixel format the encoder will not
    // take, a stream the GPU cannot decode, a busy GPU.
    if (onLog) {
      onLog(i + 1 < tries.length
        ? '\n[analyser] hardware decode failed, retrying with the hardware encoder only\n'
        : '\n[analyser] hardware ' + (t.args.includes('-c:v') || t.args.includes('-vcodec') ? 'encode' : 'decode') + ' failed, retrying in software\n');
    }
  }

  return attempt(rawArgs, false, tries.length ? 'software fallback' : '');
}
