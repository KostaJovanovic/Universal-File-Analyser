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

import { accelerate, checkArgs, checkInputText, FAMILIES, softwareFallback } from '../ffmpeg-accel.mjs';

// Argument shapes copied from src/ (renderers/video.ts, audio.ts, gcode.ts).
const APP = [
  ['-i', 'input', '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', 'output.wav'],
  ['-i', 'adin', '-vn', '-c:a', 'pcm_s16le', '-f', 'wav', 'adout.wav'],
  ['-i', 'clip.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'clip.mp4'],
  ['-i', 'rev_in.mp4', '-vf', 'reverse', '-af', 'areverse', '-c:a', 'aac', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', 'rev_out.mp4'],
  ['-i', 'rev_src'],
  ['-i', 'rev_src', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*2.5)', '-c:a', 'aac', '-y', 'rev_norm.mp4'],
  ['-i', 'rev_norm.mp4', '-c', 'copy', '-map', '0', '-f', 'segment', '-segment_time', '0.5', '-reset_timestamps', '1', 'rev_seg_%03d.mp4'],
  ['-f', 'concat', '-safe', '0', '-i', 'rev_list.txt', '-c', 'copy', '-y', 'rev_out.mp4'],
  ['-f', 'concat', '-safe', '0', '-i', 'rev_list.txt', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-y', 'rev_out.mp4'],
  ['-skip_loop_filter', 'all', '-i', 'in.mov', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:2*trunc(min(720\\,ih)/2)', '-c:a', 'aac', '-movflags', '+faststart', '-y', 'out.mp4'],
  ['-fflags', '+genpts', '-f', 'hevc', '-r', '29.97', '-i', 'seg.h265', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'seg.mp4'],
  ['-fflags', '+genpts', '-f', 'h264', '-i', 'seg.h264', '-c', 'copy', '-movflags', '+faststart', 'seg.mp4'],
  ['-fflags', '+genpts', '-i', 'in.ts', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', 'out.mp4'],
  ['-i', 'input', '-frames:v', '1', '-q:v', '3', '-y', 'anr_frame.jpg'],
  ['-i', 'probe', '-f', 'null', '-t', '2', '-'],
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

const mc = FAMILIES.find((f) => f.vendor === 'mediacodec');
const accel = { vendor: mc.vendor, h264: mc.h264, hevc: mc.hevc, av1: null };
console.log('mediacodec, gcode clip:  ' + accelerate(APP[2], accel).args.join(' '));
console.log('mediacodec, reverse:     ' + accelerate(APP[3], accel).args.join(' '));
console.log('openh264 fallback:       ' + softwareFallback(APP[2], ['libopenh264', 'aac']).join(' '));
if (softwareFallback(APP[2], null) !== APP[2]) fail('softwareFallback(null) changed the arguments');
if (softwareFallback(APP[2], ['libx264']) !== APP[2]) fail('softwareFallback changed a job the build can run');

console.log(failures ? `\n${failures} failure(s)` : `\nok - ${APP.length} app shapes pass, ${ATTACKS.length} attacks and ${LISTS_BAD.length} bad lists refused`);
process.exit(failures ? 1 : 0);
