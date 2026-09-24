/* Run the FFmpeg safety checks in ../ffmpeg-accel.mjs against every argument
 * list the app sends today, and against the attacks they exist to stop.
 *
 * The checks are a security boundary with no test pipeline behind them, so
 * this is the net: every APP line must pass and every ATTACK line must be
 * refused. Run it after any change to the checks, or after adding an ffmpeg
 * call to src/ (add its argument shape to APP below first):
 *
 *   node desktop/tools/check-ffmpeg-args.mjs
 *
 * It also prints the MediaCodec rewrite and the openh264 fallback for the
 * common encode, so a change to those shows up here too.
 */

import { accelerate, checkArgs, checkInputBytes, checkInputText, FAMILIES, isSafeName, LIST_PEEK, softwareFallback } from '../ffmpeg-accel.mjs';

// Argument shapes copied from src/ (renderers/video.ts, audio.ts, gcode.ts).
// video.ts gives every job's files a prefix of its own (ffJobPrefix, 'j<n>_').
const APP = [
  ['-i', 'j1_input', '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', 'j1_output.wav'],
  ['-i', 'adin', '-vn', '-c:a', 'pcm_s16le', '-f', 'wav', 'adout.wav'],
  ['-i', 'clip.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'clip.mp4'],
  ['-i', 'j4_rev_in.mp4', '-vf', 'reverse', '-af', 'areverse', '-c:a', 'aac', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', 'j4_rev_out.mp4'],
  ['-i', 'j5_rev_src'],
  ['-i', 'j6_rev_src', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*2.5)', '-c:a', 'aac', '-y', 'j6_rev_norm.mp4'],
  ['-i', 'j7_rev_norm.mp4', '-c', 'copy', '-map', '0', '-f', 'segment', '-segment_time', '0.5', '-reset_timestamps', '1', 'j7_rev_seg_%03d.mp4'],
  ['-f', 'concat', '-safe', '0', '-i', 'j8_rev_list.txt', '-c', 'copy', '-y', 'j8_rev_out.mp4'],
  ['-f', 'concat', '-safe', '0', '-i', 'j9_rev_list.txt', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-y', 'j9_rev_out.mp4'],
  ['-skip_loop_filter', 'all', '-i', 'j10_in.mov', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:2*trunc(min(720\\,ih)/2)', '-c:a', 'aac', '-movflags', '+faststart', '-y', 'j10_out.mp4'],
  ['-fflags', '+genpts', '-f', 'hevc', '-r', '29.97', '-i', 'j11_seg.h265', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'j11_seg.mp4'],
  ['-fflags', '+genpts', '-f', 'h264', '-i', 'j12_seg.h264', '-c', 'copy', '-movflags', '+faststart', 'j12_seg.mp4'],
  ['-fflags', '+genpts', '-i', 'j13_in.ts', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', 'j13_out.mp4'],
  ['-i', 'j14_input', '-frames:v', '1', '-q:v', '3', '-y', 'j14_anr_frame.jpg'],
  ['-i', 'j15_probe', '-f', 'null', '-t', '2', '-'],
  // The same calls with the values the code can actually produce: SEG is
  // String() of a float, the turbo preset adds -tune, maxFps adds -r.
  ['-i', 'j16_rev_src', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*0.7291666666666666)', '-an', '-y', 'j16_rev_norm.mp4'],
  ['-i', 'j17_rev_norm.mp4', '-c', 'copy', '-map', '0', '-f', 'segment', '-segment_time', '0.7291666666666666', '-reset_timestamps', '1', 'j17_rev_seg_%03d.mp4'],
  ['-i', 'j18_rev_seg_000.mp4', '-vf', 'reverse', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', 'j18_rev_out_000.mp4'],
  ['-f', 'concat', '-safe', '0', '-i', 'j19_rev_list.txt', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', 'j19_rev_out.mp4'],
  ['-skip_loop_filter', 'all', '-i', 'j20_conv_in', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-tune', 'zerolatency', '-vf', 'scale=-2:2*trunc(min(1080\\,ih)/2)', '-r', '30', '-an', '-movflags', '+faststart', '-y', 'j20_conv_out.mp4'],
  ['-i', 'j21_conv_in', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', 'j21_conv_out.mp4'],
  ['-fflags', '+genpts', '-f', 'hevc', '-i', 'j22_in.h265', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'j22_out.mp4'],
  ['-fflags', '+genpts', '-i', 'j23_in.ts', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', 'j23_out.mp4'],
  ['-i', 'j24_anr_input', '-frames:v', '1', '-q:v', '3', '-y', 'j24_anr_frame.jpg'],
];

const ATTACKS = [
  ['-i', 'C:\\Users\\x\\secret.txt', '-f', 'u8', 'out.raw'],
  ['-i', 'c:/Users/x/secret.txt', 'out.raw'],
  ['-i', 'D:secret.txt', 'out.raw'],
  ['-i', '/etc/passwd', 'out.raw'],
  ['-i', '\\\\server\\share\\x', 'out.raw'],
  ['-i', '\\Windows\\win.ini', 'out.raw'],
  ['-i', '../../secret', 'out.raw'],
  ['-i', 'sub/../../secret', 'out.raw'],
  ['-i', 'http://example.com/x.mp4', 'out.mp4'],
  ['-i', 'HTTPS://example.com/x.mp4', 'out.mp4'],
  ['-i', 'file:secret', 'out.mp4'],
  ['-i', 'concat:a.ts|b.ts', 'out.mp4'],
  ['-i', 'subfile,,start,0,end,10,,:x', 'out.mp4'],
  ['-i', 'pipe:0', 'out.mp4'],
  ['-i', 'in.mp4', '-progress', 'tcp://1.2.3.4:9', 'out.mp4'],
  ['-f', 'gdigrab', '-i', 'desktop', 'shot.mp4'],
  ['-f', 'dshow', '-i', 'video=Camera', 'cam.mp4'],
  ['-f', 'android_camera', '-i', '0', 'cam.mp4'],
  ['-i', 'in.mp4', '-vf', 'movie=C\\:/secret.mp4', 'out.mp4'],
  ['-i', 'in.mp4', '-vf', "movie='/etc/passwd'", 'out.mp4'],
  ['-i', 'in.mp4', '-vf', 'drawtext=textfile=/etc/passwd', 'out.mp4'],
  ['-i', 'in.mp4', '-vf', 'frei0r=./evil.so', 'out.mp4'],
  ['-i', 'in.mp4', '-vf', 'scale=2:2,ladspa@x=f=evil', 'out.mp4'],
  ['-i', 'in.mp4', '-vf', 'sendcmd=f=cmds.txt', 'out.mp4'],
  ['-i', 'in.mp4', '-y', 'C:/Windows/System32/evil.dll'],
  ['-i', 'in.mp4', '-f', 'tee', '[f=mp4]a.mp4|[f=mp4]/tmp/b.mp4'],
  ['-i', 'in.mp4', '-/vf', 'graph.txt', 'out.mp4'],
  ['-i', 'in.mp4', '-filter_complex_script', 'graph.txt', 'out.mp4'],
  ['-i', '/data/data/com.valjdakosta.analyser/shared_prefs/x.xml', 'out.raw'],
  ['-i', 'content://media/external/images/1', 'out.mp4'],
  // The allow-list layer: anything the app does not emit.
  ['-i', 'in.mp4', '-foo', '1', 'out.mp4'],
  ['-i', 'in.mp4', '-filter_compl', 'x', 'out.mp4'],
  ['-i', 'in.mp4', '-vf', 'scale=2:2,movie=x.mp4', 'out.mp4'],
  ['-dump_attachment:t', '', '-i', 'in.mkv'],
  ['-dump_attachment', 'x', '-i', 'in.mkv'],
  ['-i', 'in.mp4', '-attach', 'font.ttf', 'out.mp4'],
  ['-protocol_whitelist', 'file,http', '-i', 'in.m3u8', 'out.mp4'],
  ['-i', 'in.mp4', '-f', 'hls', 'out.m3u8'],
  ['-i', 'in.mp4', '-f', 'dash', 'out.mpd'],
  ['-i', 'in.mp4', '-f', 'segment', '-segment_list', 'list.txt', 'seg_%03d.mp4'],
  ['-i', 'in.mp4', '-f', 'segment', 'seg%d.ts'],
  ['-i', 'in.mp4', '-f', 'image2', 'frame_%03d.jpg'],
  ['-i', 'in.mp4', 'out.m3u8'],
  ['-i', 'in.mp4', 'frame%03d.jpg'],
  ['-i', 'in.mp4', '-y', 'con.mp4'],
  ['-i', 'nul', 'out.mp4'],
  ['-i', 'in.mp4:stream', 'out.mp4'],
  ['-i', 'in\u0001.mp4', 'out.mp4'],
  ['-safe', '0', '-i', 'in.mp4', 'out.mp4'],
  ['-f', 'lavfi', '-i', 'color', 'out.mp4'],
  ['-f', 'wav', '-i', 'in.wav', 'out.mp4'],
  ['-i', 'in.mp4', '-f', 'concat', 'out.mp4'],
  ['-i', 'in.mp4', '-f', 'wav', '-'],
  ['-i', 'in.mp4', '-c:v', 'libx264', '-x264-params', 'a=b', 'out.mp4'],
  ['-i', 'in.mp4', '-c:v', 'rawvideo', 'out.mp4'],
  ['-i', 'in.mp4', '-vf', 'x\u00a0/etc/passwd', 'out.mp4'],
  ['-i', 'in.mp4', '-segment_time', '1', 'out.mp4'],
  // Java's $ matches before a final line break; JavaScript's does not.
  ['-i', 'in.mp4', '-map', '0\n', 'out.mp4'],
  ['-i', 'input\n', 'out.mp4'],
  ['not an array'],
  'not an array',
  ['-i', 42],
];

const LIST_OK = "file 'rev_out_001.mp4'\nfile 'rev_out_000.mp4'\n";
const LISTS_BAD = [
  ["file '/etc/passwd'\n", true],
  ["file 'C:\\secret.mp4'\n", true],
  ["file '../x.mp4'\n", true],
  ["ffconcat version 1.0\nfile a.mp4\noption protocol_whitelist file\n", false],
  ['#EXTM3U\n#EXTINF:10,\n/etc/passwd\n', false],
  ['#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="http://x/key"\n#EXTINF:10,\na.ts\n', false],
  ['v=0\no=- 0 0 IN IP4 127.0.0.1\n', false],
  // Parity and allow-list vectors, also in AnrFfmpegChecksTest.java.
  ["file 'x'/../../y.mp4\n", true],
  ["file 'a.mp4'\rfile '/etc/passwd'\n", true],
  ["file 'a.mp4'\u0000\n", true],
  ["file 'caf\u00e9.mp4'\n", true],
  ["file 'nul.mp4'\n", true],
  ["duration 5\n", true],
  ["FILE 'a.mp4'\n", true],
  ['\uFEFFffconcat version 1.0\noption safe 0\n', false],
  ['#EXTM3U\n\u2028/etc/passwd\n', false],
];

let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL  ' + msg); };

for (const a of APP) {
  const why = checkArgs(a);
  if (why) fail('app args refused: ' + why + '\n      ' + JSON.stringify(a));
}
for (const a of ATTACKS) {
  const why = checkArgs(a);
  if (!why) fail('attack allowed: ' + JSON.stringify(a));
}
if (checkInputText(LIST_OK, true)) fail('the reverse concat list is refused: ' + checkInputText(LIST_OK, true));
if (checkInputText('\u0000\u0001binary video bytes', false)) fail('a binary input is refused');
for (const [text, isConcat] of LISTS_BAD) {
  if (!checkInputText(text, isConcat)) fail('list allowed: ' + JSON.stringify(text));
}

// The byte half (checkInputBytes), which both shells call on the first
// LIST_PEEK bytes of every input. Same vectors in AnrFfmpegChecksTest.java.
const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const okBytes = bytes(LIST_OK);
if (checkInputBytes(okBytes, okBytes.length, true)) fail('the reverse concat list is refused as bytes: ' + checkInputBytes(okBytes, okBytes.length, true));
if (checkInputBytes(bytes('\u0000\u0001binary video bytes'), 1 << 30, false)) fail('a large binary input is refused');
if (!checkInputBytes(okBytes, LIST_PEEK + 1, true)) fail('a concat list larger than the peek is allowed');
const whole = (s, isConcat) => checkInputBytes(bytes(s), s.length, isConcat);
if (!whole("file 'a.mp4'\n\u0000", true)) fail('a concat list with a NUL is allowed');
if (!checkInputBytes(bytes('#EXTM3U\n#EXTINF:10,\na.ts\n'), LIST_PEEK + 1, false)) fail('a playlist larger than the peek is allowed');
if (!whole("file 'cafÃ", true)) fail('a cut UTF-8 sequence is allowed');
if (!whole("ï»¿ffconcat version 1.0\noption safe 0\n", false)) fail('a BOM-led ffconcat list with an option is allowed');
if (whole("ï»¿ffconcat version 1.0\nfile 'a.mp4'\n", false)) fail('a BOM-led clean ffconcat list is refused');

// Names the session folder may hold (safeName in both shells).
for (const n of ['input', 'rev_seg_000.mp4', 'conv_in', 'anr_frame.jpg']) if (!isSafeName(n)) fail('safe name refused: ' + n);
for (const n of ['', 'con', 'NUL.txt', 'com1.mp4', 'a:b', 'a\u0000b', '.hidden', 'a/b', 'café', 'a\n']) if (isSafeName(n)) fail('unsafe name allowed: ' + JSON.stringify(n));

// Every hardware rewrite and the openh264 fallback of every app shape must
// pass too - the rewritten list is what spawns, and on Android the native
// check only ever sees the rewritten form.
let rewrites = 0;
for (const f of FAMILIES) {
  const accel = { vendor: f.vendor, h264: f.h264, hevc: f.hevc, av1: f.av1 };
  for (const a of APP) {
    const r = accelerate(a, accel);
    if (!r.changed) continue;
    rewrites++;
    const why = checkArgs(r.args);
    if (why) fail(f.vendor + ' rewrite refused: ' + why + '\n      ' + JSON.stringify(r.args));
  }
}
for (const a of APP) {
  const fb = softwareFallback(a, ['libopenh264', 'aac']);
  if (fb === a) continue;
  rewrites++;
  const why = checkArgs(fb);
  if (why) fail('openh264 fallback refused: ' + why + '\n      ' + JSON.stringify(fb));
}

for (const f of FAMILIES) {
  const accel = { vendor: f.vendor, h264: f.h264, hevc: f.hevc, av1: null };
  console.log((f.vendor + ', gcode clip:').padEnd(26) + accelerate(APP[2], accel).args.join(' '));
}
const mc = FAMILIES.find((f) => f.vendor === 'mediacodec');
const accel = { vendor: mc.vendor, h264: mc.h264, hevc: mc.hevc, av1: null };
console.log('mediacodec, reverse:      ' + accelerate(APP[3], accel).args.join(' '));
console.log('openh264 fallback:        ' + softwareFallback(APP[2], ['libopenh264', 'aac']).join(' '));
if (softwareFallback(APP[2], null) !== APP[2]) fail('softwareFallback(null) changed the arguments');
if (softwareFallback(APP[2], ['libx264']) !== APP[2]) fail('softwareFallback changed a job the build can run');

console.log(failures ? `\n${failures} failure(s)` : `\nok - ${APP.length} app shapes and ${rewrites} rewrites pass, ${ATTACKS.length} attacks and ${LISTS_BAD.length} bad lists refused`);
process.exit(failures ? 1 : 0);
