/* Analyser - FFmpeg argument rules, shared by the native shells.
 *
 * Pure module: no Node, Electron or DOM imports, the same way router.mjs is
 * split from main.mjs. Two consumers:
 *
 *  - desktop/ffmpeg-native.mjs imports it in the Electron main process.
 *  - mobile/tools/stage-web.mjs copies it into the Android app, where the
 *    bridge (mobile/bridge/anr-bridge.js) runs accelerate() and
 *    softwareFallback() before it calls the native plugin. One copy of the
 *    rewrite rules, for every shell.
 *
 * It holds two kinds of rule, and they sit on different sides of a trust line:
 *
 *  1. REWRITES - accelerate() and softwareFallback() move a software encode
 *     onto whatever this machine can actually run. A wrong rewrite costs speed
 *     or a retry, never safety, so the page side may run them.
 *  2. CHECKS - checkArgs() and checkInputText() refuse anything that reaches
 *     outside the session folder. These ARE a security boundary. The page
 *     chooses the arguments, and a crafted file that finds an XSS in a
 *     renderer controls the page. Unchecked, that page could make ffmpeg read
 *     any file the user can read (`-i C:\...`), write anywhere (`-y /...`),
 *     grab the screen or the camera (`-f gdigrab`, `-f dshow`), open the
 *     network, or load a native library (`frei0r`). So the checks must run on
 *     the TRUSTED side of the bridge: Electron's main process here, and the
 *     native plugin on Android (AnrFfmpegChecks.java is the Java port, tested
 *     against the same vectors by AnrFfmpegChecksTest.java). A copy
 *     in the page would protect nothing. Keep the two ports in step.
 *
 * None of today's call sites trips a check: desktop/tools/check-ffmpeg-args.mjs
 * runs every argument list in src/ through them, plus the attacks they exist
 * to stop. Run it after any change here. A refused job resolves like
 * a clean ffmpeg failure, so video.ts falls back exactly as it would for a
 * file ffmpeg could not handle.
 */

// ---------------------------------------------------------------------------
// Hardware encoder families
//
// Preference order: NVENC first (fastest and most predictable), then Intel
// Quick Sync, AMD AMF, Apple VideoToolbox, and Android MediaCodec. A desktop
// build never lists the MediaCodec encoders, so the desktop probe skips that
// family, and an Android build lists none of the others.
// ---------------------------------------------------------------------------

/** x264's CRF scale mapped onto a VBR bitrate, for encoders with no reliable
 *  constant-quality mode. CRF 23 (x264's default) is 8 Mbit/s, and every 6
 *  steps halves or doubles it - x264's own rule of thumb for how CRF scales.
 *  Generous for 720p and right for 1080p. Measure on real phones before you
 *  tune it. */
export function crfToBitrate(crf) {
  const c = Number.isFinite(crf) ? crf : 23;
  return Math.max(500, Math.round(8000 * Math.pow(2, (23 - c) / 6))) + 'k';
}

export const FAMILIES = [
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
  {
    vendor: 'mediacodec', label: 'Android MediaCodec',
    h264: 'h264_mediacodec', hevc: 'hevc_mediacodec', av1: 'av1_mediacodec',
    // Decode stays in software. -hwaccel mediacodec hands back GPU surfaces,
    // which every CPU filter in video.ts would have to download again.
    hwaccel: null,
    preset: null,                                  // MediaCodec takes no preset
    // Constant-quality is an optional MediaCodec feature and many chipsets
    // lack it, so CRF becomes a VBR bitrate instead.
    quality: (crf) => ['-bitrate_mode', 'vbr', '-b:v', crfToBitrate(crf)],
    // The encoder's own default is 200 kbit/s, which is unwatchable. Unlike the
    // desktop families, a job that names no CRF still needs a bitrate here.
    defaultQuality: true,
  },
];

// ---------------------------------------------------------------------------
// Argument rewriting: software encoder -> this machine's hardware encoder
//
// Conservative on purpose. This is forensics software, so a wrong transcode is
// worse than a slow one. The rewrite only fires on a plain software video
// encode, never touches a stream copy, and the caller retries in software if
// the hardware attempt fails (see runJob in ffmpeg-native.mjs, and the bridge
// on Android).
// ---------------------------------------------------------------------------

export const SW_VIDEO = { libx264: 'h264', libopenh264: 'h264', libx265: 'hevc', 'libsvt-hevc': 'hevc', libaom: 'av1', 'libaom-av1': 'av1', 'libsvtav1': 'av1' };

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
  } else if (family.defaultQuality && !out.includes('-b:v')) {
    // Straight after the codec, so it binds to the same output.
    out.splice(idxC + 2, 0, ...family.quality(23));
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

/** Options only libx264 understands. libopenh264 refuses a job that names them. */
const X264_ONLY = new Set(['-preset', '-tune', '-crf', '-x264-params', '-x264opts', '-profile:v', '-level', '-level:v']);

/**
 * The arguments to retry with after a hardware attempt fails.
 *
 * The desktop retries the ORIGINAL arguments, and they name libx264. A mobile
 * build ships without libx264 (it is GPL - see research/CAPACITOR-PLAN.md), so
 * there the retry has to name the software encoder the build does have.
 *
 * @param {string[]} args      the arguments the page sent
 * @param {string[]|null} encoders  encoder names this build has; null = unknown,
 *                              which leaves the arguments as they are
 * @returns {string[]}
 */
export function softwareFallback(args, encoders) {
  if (!Array.isArray(encoders)) return args;
  const idxC = args.findIndex((a) => a === '-c:v' || a === '-vcodec');
  if (idxC === -1 || idxC + 1 >= args.length) return args;
  const sw = args[idxC + 1];
  if (encoders.includes(sw) || SW_VIDEO[sw] !== 'h264') return args;
  if (!encoders.includes('libopenh264')) return args;

  const idxQ = args.indexOf('-crf');
  const crf = idxQ !== -1 ? parseInt(args[idxQ + 1], 10) : 23;
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (X264_ONLY.has(args[i]) && i + 1 < args.length) { i++; continue; }
    out.push(i === idxC + 1 ? 'libopenh264' : args[i]);
  }
  if (!out.includes('-b:v')) {
    const at = out.findIndex((a) => a === '-c:v' || a === '-vcodec');
    out.splice(at + 2, 0, '-b:v', crfToBitrate(crf));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks: nothing may reach outside the session folder
//
// The page only ever means bare names inside the session folder ('input',
// 'rev_seg_%03d.mp4', 'out.mp4'). So anything that looks like a way out is
// refused: an absolute or drive path, a parent-directory step, a URL or an
// ffmpeg protocol, a capture device, a filter that loads a library, or an
// option that reads more arguments from a file this check never saw.
// ---------------------------------------------------------------------------

const MAX_ARGS = 512;
const MAX_ARG_LEN = 16384;

/** Where a path or URL can start inside one argument: at its start, or after
 *  the characters that separate values in ffmpeg's option and filter syntax. */
const D = '(?:^|[\\s=|,;\'"\\[\\]])';

/** ffmpeg's URL protocols (`ffmpeg -protocols`, plus the ones other builds
 *  add). Before a colon - escaped or not, since the filter parser unescapes
 *  `\:` - or, for subfile, a comma, each opens something outside the folder. */
const PROTOCOLS = [
  'android_content', 'async', 'bluray', 'cache', 'concat', 'concatf', 'content', 'crypto', 'data',
  'dtls', 'fd', 'ffrtmpcrypt', 'ffrtmphttp', 'file', 'ftp', 'gopher', 'gophers', 'hls', 'http',
  'httpproxy', 'https', 'icecast', 'ipfs', 'ipns', 'librist', 'librtmp', 'librtmpe', 'librtmps',
  'librtmpt', 'librtmpte', 'libsmbclient', 'libsrt', 'libssh', 'libzmq', 'md5', 'mmsh', 'mmst',
  'pipe', 'prompeg', 'rist', 'rtmp', 'rtmpe', 'rtmps', 'rtmpt', 'rtmpte', 'rtmpts', 'rtp', 'rtsp',
  'rtsps', 'sctp', 'sftp', 'smb', 'srt', 'srtp', 'subfile', 'tcp', 'tee', 'tls', 'udp', 'udplite',
  'unix', 'zmq',
];

const RE = [
  // Any URL at all: scheme://
  [new RegExp(D + '[a-z][a-z0-9+.-]*\\\\?:(?:\\\\?[\\\\/]){2}', 'i'), 'a URL'],
  [new RegExp(D + '(?:' + PROTOCOLS.join('|') + ')(?:\\\\?:|,)', 'i'), 'an ffmpeg protocol'],
  // C:\ and C:/ - also after a colon, as in movie=x:filename=C\:/...
  [new RegExp('(?:^|[\\s=|,;\'"\\[\\]:])[a-z]\\\\?:[\\\\/]', 'i'), 'a drive path'],
  // C:file - relative to that drive's own current folder, not the session's.
  [new RegExp('(?:^|[\\s=|\'"])[a-z]\\\\?:(?![\\\\/:])\\S', 'i'), 'a drive-relative path'],
  // /abs, \abs and \\server\share. A lone backslash must be followed by a path
  // character, so ffmpeg's own escapes (\, and \:) never match.
  [new RegExp(D + '(?:\\/|\\\\{1,2}(?=[a-z0-9_$.~-]))', 'i'), 'an absolute path'],
  [new RegExp('(?:^|[\\s=|,;\'"\\[\\]\\\\/:])\\.\\.(?=$|[\\s\\\\/|,;\'"\\[\\]:])'), 'a parent-folder step'],
  // Filters that load a native library or open a socket. Instance names may
  // carry an @label, hence the lookahead.
  [new RegExp('(?:^|[\\s,;\'"\\[\\]])(?:frei0r|frei0r_src|ladspa|lv2|a?zmq|a?sendcmd)(?=$|[=@,;\\s\'"\\[\\]])', 'i'), 'a filter that loads code or opens a socket'],
];

/** Input and output devices. Any of these after -f captures the screen, a
 *  camera or a microphone, or plays to real hardware. */
const DEVICES = new Set([
  'alsa', 'android_camera', 'audiotoolbox', 'avfoundation', 'bktr', 'caca', 'decklink', 'dshow',
  'dv1394', 'fbdev', 'gdigrab', 'iec61883', 'jack', 'kmsgrab', 'libcdio', 'libdc1394', 'openal',
  'opengl', 'oss', 'pulse', 'sdl', 'sdl2', 'sndio', 'v4l2', 'video4linux2', 'vfwcap', 'x11grab',
  'xcbgrab', 'xv',
]);

/** Options that read further arguments or filter text from a file, which this
 *  check would never see. `-/opt file` is FFmpeg 7's general form of it. */
const FILE_OPTIONS = new Set(['-filter_script', '-filter_complex_script']);

/** One value: the first problem found in it, or null. */
export function valueProblem(s) {
  for (const [re, what] of RE) if (re.test(s)) return what;
  return null;
}

/**
 * @param {unknown} args  what the page sent
 * @returns {string|null} why the job is refused, or null when it may run
 */
export function checkArgs(args) {
  if (!Array.isArray(args) || args.length > MAX_ARGS) return 'not a valid argument list';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string' || a.length > MAX_ARG_LEN) return 'not a valid argument list';
    if (a.startsWith('-/') || FILE_OPTIONS.has(a)) return a + ' reads options from a file';
    if (a === '-f' && i + 1 < args.length && DEVICES.has(String(args[i + 1]).toLowerCase())) {
      return '-f ' + args[i + 1] + ' is a capture or playback device';
    }
    const bad = valueProblem(a);
    if (bad) return JSON.stringify(a) + ' contains ' + bad;
  }
  return null;
}

/** Every input with the -f that applies to it (the last -f since the previous
 *  -i), so the caller can look inside the ones that are text lists. */
export function inputsOf(args) {
  const out = [];
  let fmt = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-f' && i + 1 < args.length) { fmt = args[i + 1]; i++; }
    else if (args[i] === '-i' && i + 1 < args.length) { out.push({ name: args[i + 1], format: fmt }); fmt = null; i++; }
  }
  return out;
}

/** The start of a text file that names OTHER files or addresses: an HLS
 *  playlist, a concat list, a DASH or SMIL manifest, an SDP description. */
const LIST_HEAD = /^\uFEFF?\s*(?:#EXTM3U|ffconcat\b|file\s|<\?xml|<MPD|<smil|v=0|\[playlist\])/i;

/** A name the concat list may point at: a bare file in the session folder. */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * Look inside one input that may be a list of other inputs. The arguments can
 * be clean while the list they point at names /etc/passwd or a URL - which is
 * exactly what `-f concat -safe 0` (used by the reverse in video.ts) would
 * otherwise follow.
 *
 * @param {string} text        the start of the input file, as text
 * @param {boolean} isConcat   true when -f concat applies to this input
 * @returns {string|null} why the job is refused, or null
 */
export function checkInputText(text, isConcat) {
  if (!isConcat && !LIST_HEAD.test(text)) return null;
  if (/^\uFEFF?\s*v=0/.test(text)) return 'an SDP description opens network sockets';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') && !/URI=/i.test(line)) continue;
    if (/^option\b/i.test(line)) return 'the concat list sets demuxer options';
    const m = /^file\s+(?:'((?:[^'\\]|\\.)*)'|(\S+))/i.exec(line);
    if (m) {
      const name = m[1] !== undefined ? m[1] : m[2];
      if (!SAFE_NAME.test(name)) return 'the concat list names ' + JSON.stringify(name);
      continue;
    }
    const bad = valueProblem(line);
    if (bad) return 'a list input contains ' + bad;
  }
  return null;
}
