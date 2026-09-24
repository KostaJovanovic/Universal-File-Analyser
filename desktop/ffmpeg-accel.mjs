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
 *  2. CHECKS - checkArgs() and checkInputBytes() refuse anything that reaches
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
// 'rev_seg_%03d.mp4', 'out.mp4'). Two layers, both of which must pass:
//
//  1. A DENY-LIST that looks inside every argument for a way out: an absolute
//     or drive path, a parent-directory step, a URL or an ffmpeg protocol, a
//     capture device, a filter that loads a library, or an option that reads
//     more arguments from a file this check never saw.
//  2. An ALLOW-LIST of exactly the options, formats, filters and file names the
//     app emits (see desktop/tools/check-ffmpeg-args.mjs, which holds every
//     shape from src/, plus the hardware rewrites and the openh264 fallback).
//     Anything else - an unknown option, a muxer that writes extra files, a
//     name with a path in it - is refused. ffmpeg has hundreds of options and
//     a deny-list cannot model them all; this layer does not have to.
//
// Every pattern is ASCII-only on purpose, and so is the Java port
// (AnrFfmpegChecks.java): no \s, \S, \b, . or $ and no case-insensitive flag,
// because JavaScript, OpenJDK and Android's ICU regex engine each give those
// different Unicode meanings. Case folding is asciiLower() instead. When you add
// an option here, add it there and to both test suites.
// ---------------------------------------------------------------------------

const MAX_ARGS = 512;
const MAX_ARG_LEN = 16384;

/** ASCII whitespace, spelled out - the characters `\s` means in OpenJDK. */
const WS = '\\t\\n\\x0B\\f\\r ';

/** Lower-cases A-Z only, so the patterns below never meet Unicode case rules. */
export function asciiLower(s) {
  return String(s).replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** Where a path or URL can start inside one argument: at its start, or after
 *  the characters that separate values in ffmpeg's option and filter syntax. */
const D = '(?:^|[' + WS + '=|,;\'"\\[\\]])';

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

/* Each runs on asciiLower(value), so none needs the `i` flag. `(?![^X])` is
 * "end of text, or a character from X" - written that way because `$` also
 * matches before a final line break in Java. */
const RE = [
  // Any URL at all: scheme://
  [new RegExp(D + '[a-z][a-z0-9+.-]*\\\\?:(?:\\\\?[\\\\/]){2}'), 'a URL'],
  [new RegExp(D + '(?:' + PROTOCOLS.join('|') + ')(?:\\\\?:|,)'), 'an ffmpeg protocol'],
  // C:\ and C:/ - also after a colon, as in movie=x:filename=C\:/...
  [new RegExp('(?:^|[' + WS + '=|,;\'"\\[\\]:])[a-z]\\\\?:[\\\\/]'), 'a drive path'],
  // C:file - relative to that drive's own current folder, not the session's.
  [new RegExp('(?:^|[' + WS + '=|\'"])[a-z]\\\\?:(?![\\\\/:])[^' + WS + ']'), 'a drive-relative path'],
  // /abs, \abs and \\server\share. A lone backslash must be followed by a path
  // character, so ffmpeg's own escapes (\, and \:) never match.
  [new RegExp(D + '(?:\\/|\\\\{1,2}(?=[a-z0-9_$.~-]))'), 'an absolute path'],
  [new RegExp('(?:^|[' + WS + '=|,;\'"\\[\\]\\\\/:])\\.\\.(?![^' + WS + '\\\\/|,;\'"\\[\\]:])'), 'a parent-folder step'],
  // Filters that load a native library or open a socket. Instance names may
  // carry an @label, hence the lookahead.
  [new RegExp('(?:^|[' + WS + ',;\'"\\[\\]])(?:frei0r|frei0r_src|ladspa|lv2|a?zmq|a?sendcmd)(?![^=@,;' + WS + '\'"\\[\\]])'), 'a filter that loads code or opens a socket'],
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

/** Options that write or open files the checks never see, or widen what ffmpeg
 *  may open. Refused by name so the log says why; the allow-list below would
 *  refuse them anyway. */
const NAMED_REFUSALS = new Map([
  ['-dump_attachment', 'writes attachments to files'],
  ['-attach', 'reads a file into the output'],
  ['-protocol_whitelist', 'widens the protocols ffmpeg may open'],
  ['-protocol_blacklist', 'changes the protocols ffmpeg may open'],
]);

/** Muxers that write files beyond the one output named. `segment` is allowed
 *  in exactly the shape the reverse uses (see SEGMENT_NAME). */
const EXTRA_FILE_MUXERS = new Set(['hls', 'dash', 'tee', 'stream_segment', 'ssegment', 'image2', 'fifo', 'webm_chunk', 'webm_dash_manifest', 'smoothstreaming', 'hds']);

/** One value: the first problem found in it, or null. */
export function valueProblem(s) {
  const low = asciiLower(s);
  for (const [re, what] of RE) if (re.test(low)) return what;
  return null;
}

// ---- The allow-list ------------------------------------------------------

/** A plain number, as the app writes them (String(0.7291666666666666) too). */
const NUM = '^[0-9]{1,10}(?:\\.[0-9]{1,20})?$';

/**
 * Every option the app emits, with the pattern its value must match, or null
 * for a flag that takes no value. Includes what accelerate() and
 * softwareFallback() write: -hwaccel, the NVENC/QSV/AMF/VideoToolbox/MediaCodec
 * quality options and their presets, and the encoders themselves. `-i`, `-f`,
 * `-safe` and the segment options are handled specially in checkArgs().
 */
const OPTIONS = new Map([
  ['-i', ''], ['-f', ''],
  ['-y', null], ['-vn', null], ['-an', null],
  ['-fflags', '^\\+genpts$'],
  ['-skip_loop_filter', '^all$'],
  ['-hwaccel', '^(?:cuda|qsv|d3d11va|videotoolbox)$'],
  ['-safe', '^0$'],
  ['-c', '^copy$'],
  ['-c:v', '^(?:copy|libx264|libopenh264|(?:h264|hevc|av1)_(?:nvenc|qsv|amf|videotoolbox|mediacodec))$'],
  ['-vcodec', '^(?:copy|libx264|libopenh264|(?:h264|hevc|av1)_(?:nvenc|qsv|amf|videotoolbox|mediacodec))$'],
  ['-c:a', '^(?:copy|aac|pcm_s16le)$'],
  ['-acodec', '^(?:copy|aac|pcm_s16le)$'],
  ['-r', NUM], ['-ar', NUM], ['-ac', NUM], ['-t', NUM],
  ['-frames:v', NUM], ['-q:v', NUM], ['-crf', NUM],
  ['-cq', NUM], ['-global_quality', NUM], ['-qp_i', NUM], ['-qp_p', NUM],
  ['-preset', '^(?:ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow|p[1-7]|speed|balanced|quality)$'],
  ['-tune', '^zerolatency$'],
  ['-pix_fmt', '^yuv420p$'],
  ['-movflags', '^\\+faststart$'],
  ['-vf', '^(?:reverse|scale=-2:2\\*trunc\\(min\\([0-9]{1,5}\\\\,ih\\)/2\\))$'],
  ['-af', '^areverse$'],
  ['-force_key_frames', '^expr:gte\\(t,n_forced\\*[0-9]{1,10}(?:\\.[0-9]{1,20})?\\)$'],
  ['-map', '^0$'],
  ['-segment_time', NUM],
  ['-reset_timestamps', '^1$'],
  ['-rc', '^(?:vbr|cqp)$'],
  ['-bitrate_mode', '^vbr$'],
  ['-b:v', '^[0-9]{1,9}k$'],
]);
const OPTION_RE = new Map([...OPTIONS].map(([k, v]) => [k, v === null ? null : new RegExp(v)]));

/** -f before an -i, and -f before an output. */
const INPUT_FORMATS = new Set(['h264', 'hevc', 'concat']);
const OUTPUT_FORMATS = new Set(['wav', 'null', 'segment']);

/** A file in the session folder: no path, no drive, no `..`, no `%` pattern. */
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
/** An output: one file, with an extension whose muxer writes only that file. */
const OUTPUT_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}\.(?:mp4|wav|jpg)$/;
/** The only numbered output: the reverse's `rev_seg_%03d.mp4`. The `_` before
 *  the number keeps a name like `com%01d` from expanding into a device name. */
const SEGMENT_NAME = /^[A-Za-z0-9_]{0,63}_%0[1-9]d\.mp4$/;
/** Windows device names. They are devices with any extension, in any folder. */
const RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?![^.])/;

/** True for a bare file name the session folder may hold. The native shells
 *  map every page-supplied name through this too (safeName). */
export function isSafeName(name) {
  return typeof name === 'string' && NAME.test(name) && !RESERVED.test(asciiLower(name));
}

/**
 * @param {unknown} args  what the page sent - or what accelerate() made of it
 * @returns {string|null} why the job is refused, or null when it may run
 */
export function checkArgs(args) {
  if (!Array.isArray(args) || args.length > MAX_ARGS) return 'not a valid argument list';
  // Layer 1: the deny-list, over every argument.
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string' || a.length > MAX_ARG_LEN) return 'not a valid argument list';
    if (a.startsWith('-/') || FILE_OPTIONS.has(a)) return a + ' reads options from a file';
    if (a === '-f' && i + 1 < args.length && DEVICES.has(asciiLower(args[i + 1]))) {
      return '-f ' + args[i + 1] + ' is a capture or playback device';
    }
    const bad = valueProblem(a);
    if (bad) return JSON.stringify(a) + ' contains ' + bad;
  }
  // Layer 2: the allow-list. `fmt` is the -f waiting for its -i or output.
  let fmt = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-') && a !== '-') {
      if (NAMED_REFUSALS.has(a)) return a + ' ' + NAMED_REFUSALS.get(a);
      if (!OPTION_RE.has(a)) return a + ' is not an option the app uses';
      const re = OPTION_RE.get(a);
      if (re === null) continue;                       // a flag
      if (i + 1 >= args.length) return a + ' has no value';
      const v = args[++i];
      if (a === '-f') {
        if (EXTRA_FILE_MUXERS.has(asciiLower(v))) return '-f ' + v + ' writes extra files';
        if (!INPUT_FORMATS.has(v) && !OUTPUT_FORMATS.has(v)) return '-f ' + v + ' is not a format the app uses';
        fmt = v;
      } else if (a === '-i') {
        if (fmt !== null && !INPUT_FORMATS.has(fmt)) return '-f ' + fmt + ' is not an input format the app uses';
        if (!isSafeName(v)) return 'the input ' + JSON.stringify(v) + ' is not a bare file name';
        fmt = null;
      } else {
        if (a === '-safe' && fmt !== 'concat') return '-safe only goes with -f concat';
        if ((a === '-segment_time' || a === '-reset_timestamps') && fmt !== 'segment') return a + ' only goes with -f segment';
        if (!re.test(v)) return a + ' ' + JSON.stringify(v) + ' is not a value the app uses';
      }
    } else {
      if (fmt !== null && !OUTPUT_FORMATS.has(fmt)) return '-f ' + fmt + ' is not an output format the app uses';
      if (fmt === 'segment') {
        if (!SEGMENT_NAME.test(a)) return 'the segment output ' + JSON.stringify(a) + ' is not the reverse\'s shape';
      } else if (a === '-') {
        if (fmt !== 'null') return 'only -f null may write to "-"';
      } else if (!OUTPUT_NAME.test(a) || RESERVED.test(asciiLower(a))) {
        return 'the output ' + JSON.stringify(a) + ' is not a bare file name the app writes';
      }
      fmt = null;
    }
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

/** A byte-order mark: U+FEFF as decoded text, or its three UTF-8 bytes read
 *  one byte per character (which is how checkInputBytes reads a file). */
const BOM = '(?:\\uFEFF|\\xEF\\xBB\\xBF)?';

/** The start of a text file that names OTHER files or addresses: an HLS
 *  playlist, a concat list, a DASH or SMIL manifest, an SDP description.
 *  Tested against asciiLower(text). */
const LIST_HEAD = new RegExp('^' + BOM + '[' + WS + ']*(?:#extm3u|ffconcat(?![a-z0-9_])|file[' + WS + ']|<\\?xml|<mpd|<smil|v=0|\\[playlist\\])');
const CONCAT_HEAD = new RegExp('^' + BOM + '[' + WS + ']*ffconcat(?![a-z0-9_])');
const SDP_HEAD = new RegExp('^' + BOM + '[' + WS + ']*v=0');
const BOM_AT_START = new RegExp('^' + BOM);

/** The one line shape the reverse writes: `file 'name'` (or unquoted). The
 *  whole line must match - ffmpeg joins quoted and unquoted pieces into one
 *  name, so `file 'x'/../../y` must not pass on its first piece. */
const CONCAT_FILE = /^file[ \t]+(?:'([^'\\]*)'|([^'\\ \t]+))$/;

/** Only this much of an input is read to look for a list. A list larger than
 *  this is refused rather than half-checked. */
export const LIST_PEEK = 1024 * 1024;

/** Strip spaces and tabs from both ends - the same set in both ports, unlike
 *  String.trim(), which means different things in JavaScript and Java. */
function trimAscii(s) {
  let a = 0, b = s.length;
  while (a < b && (s[a] === ' ' || s[a] === '\t')) a++;
  while (b > a && (s[b - 1] === ' ' || s[b - 1] === '\t')) b--;
  return s.slice(a, b);
}

/**
 * Look inside one input that may be a list of other inputs. The arguments can
 * be clean while the list they point at names /etc/passwd or a URL - which is
 * exactly what `-f concat -safe 0` (used by the reverse in video.ts) would
 * otherwise follow.
 *
 * A concat list is held to the allow-list too: blank lines, comments,
 * `ffconcat version 1.0` and plain `file` lines naming a bare session file,
 * nothing else. Any list must be printable ASCII (plus tab and line breaks),
 * which also refuses a NUL, a lone carriage return and undecodable bytes -
 * each of which ffmpeg and this check could read differently.
 *
 * @param {string} text        the start of the input file, as text
 * @param {boolean} isConcat   true when -f concat applies to this input
 * @returns {string|null} why the job is refused, or null
 */
export function checkInputText(text, isConcat) {
  text = String(text);
  const low = asciiLower(text);
  const concat = isConcat || CONCAT_HEAD.test(low);
  if (!concat && !LIST_HEAD.test(low)) return null;
  if (SDP_HEAD.test(low)) return 'an SDP description opens network sockets';
  const body = text.replace(BOM_AT_START, '');
  if (/[^\t\n\r\x20-\x7E]/.test(body)) return 'a list input holds control or non-ASCII characters';
  if (/\r(?!\n)/.test(body)) return 'a list input holds a lone carriage return';
  for (const raw of body.split(/\r?\n/)) {
    const line = trimAscii(raw);
    if (!line) continue;
    if (concat) {
      if (line.startsWith('#') || line === 'ffconcat version 1.0') continue;
      const m = CONCAT_FILE.exec(line);
      if (!m) return 'the concat list line ' + JSON.stringify(line) + ' is not one the app writes';
      const name = m[1] !== undefined ? m[1] : m[2];
      if (!isSafeName(name)) return 'the concat list names ' + JSON.stringify(name);
      continue;
    }
    if (line.startsWith('#') && asciiLower(line).indexOf('uri=') === -1) continue;
    const bad = valueProblem(line);
    if (bad) return 'a list input contains ' + bad;
  }
  return null;
}

/**
 * The file half of the check, on raw bytes, so both shells decide the same
 * way: the caller reads the first min(size, LIST_PEEK) bytes and passes them
 * with the file's full size.
 *
 * Bytes are read one per character (Latin-1), never decoded as UTF-8: decoders
 * disagree on a cut or broken sequence, and any byte above 0x7E is refused in
 * a list anyway. A concat input must fit the peek and hold no NUL. Any other
 * input with a NUL in its first 4 KB is binary - a video, not a list - and a
 * list larger than the peek is refused rather than half-checked.
 *
 * @param {Uint8Array} head      the first bytes of the input
 * @param {number} totalSize     the input's size on disk
 * @param {boolean} isConcat     true when -f concat applies to this input
 * @returns {string|null} why the job is refused, or null
 */
export function checkInputBytes(head, totalSize, isConcat) {
  const n = head.length;
  let nul = -1;
  for (let i = 0; i < n; i++) if (head[i] === 0) { nul = i; break; }
  if (!isConcat && nul !== -1 && nul < 4096) return null;
  const truncated = totalSize > n;
  if (isConcat && truncated) return 'the concat list is larger than ' + LIST_PEEK + ' bytes';
  if (isConcat && nul !== -1) return 'the concat list holds a NUL byte';
  let text = '';
  for (let i = 0; i < n; i += 8192) text += String.fromCharCode.apply(null, Array.from(head.subarray(i, Math.min(n, i + 8192))));
  if (!isConcat && truncated && LIST_HEAD.test(asciiLower(text))) {
    return 'a list input is larger than ' + LIST_PEEK + ' bytes';
  }
  return checkInputText(text, isConcat);
}
