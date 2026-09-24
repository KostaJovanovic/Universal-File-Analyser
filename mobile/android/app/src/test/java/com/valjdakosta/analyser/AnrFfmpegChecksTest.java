package com.valjdakosta.analyser;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

/**
 * The Java port of the FFmpeg checks against the same vectors as
 * desktop/tools/check-ffmpeg-args.mjs. Every APP list must pass and every
 * ATTACK must be refused. Run: gradlew testDebugUnitTest (mobile/android).
 * When you add a vector there, add it here too.
 */
public class AnrFfmpegChecksTest {

    private static List<String> a(String... args) {
        return Arrays.asList(args);
    }

    private static final List<List<String>> APP = Arrays.asList(
        a("-i", "j1_input", "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", "j1_output.wav"),
        a("-i", "adin", "-vn", "-c:a", "pcm_s16le", "-f", "wav", "adout.wav"),
        a("-i", "clip.webm", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4"),
        a("-i", "j4_rev_in.mp4", "-vf", "reverse", "-af", "areverse", "-c:a", "aac", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", "j4_rev_out.mp4"),
        a("-i", "j5_rev_src"),
        a("-i", "j6_rev_src", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-force_key_frames", "expr:gte(t,n_forced*2.5)", "-c:a", "aac", "-y", "j6_rev_norm.mp4"),
        a("-i", "j7_rev_norm.mp4", "-c", "copy", "-map", "0", "-f", "segment", "-segment_time", "0.5", "-reset_timestamps", "1", "j7_rev_seg_%03d.mp4"),
        a("-f", "concat", "-safe", "0", "-i", "j8_rev_list.txt", "-c", "copy", "-y", "j8_rev_out.mp4"),
        a("-f", "concat", "-safe", "0", "-i", "j9_rev_list.txt", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", "-y", "j9_rev_out.mp4"),
        a("-skip_loop_filter", "all", "-i", "j10_in.mov", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale=-2:2*trunc(min(720\\,ih)/2)", "-c:a", "aac", "-movflags", "+faststart", "-y", "j10_out.mp4"),
        a("-fflags", "+genpts", "-f", "hevc", "-r", "29.97", "-i", "j11_seg.h265", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "j11_seg.mp4"),
        a("-fflags", "+genpts", "-f", "h264", "-i", "j12_seg.h264", "-c", "copy", "-movflags", "+faststart", "j12_seg.mp4"),
        a("-fflags", "+genpts", "-i", "j13_in.ts", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", "j13_out.mp4"),
        a("-i", "j14_input", "-frames:v", "1", "-q:v", "3", "-y", "j14_anr_frame.jpg"),
        a("-i", "j15_probe", "-f", "null", "-t", "2", "-"),
        a("-i", "j16_rev_src", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-force_key_frames", "expr:gte(t,n_forced*0.7291666666666666)", "-an", "-y", "j16_rev_norm.mp4"),
        a("-i", "j17_rev_norm.mp4", "-c", "copy", "-map", "0", "-f", "segment", "-segment_time", "0.7291666666666666", "-reset_timestamps", "1", "j17_rev_seg_%03d.mp4"),
        a("-i", "j18_rev_seg_000.mp4", "-vf", "reverse", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", "j18_rev_out_000.mp4"),
        a("-f", "concat", "-safe", "0", "-i", "j19_rev_list.txt", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", "j19_rev_out.mp4"),
        a("-skip_loop_filter", "all", "-i", "j20_conv_in", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-tune", "zerolatency", "-vf", "scale=-2:2*trunc(min(1080\\,ih)/2)", "-r", "30", "-an", "-movflags", "+faststart", "-y", "j20_conv_out.mp4"),
        a("-i", "j21_conv_in", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-y", "j21_conv_out.mp4"),
        a("-fflags", "+genpts", "-f", "hevc", "-i", "j22_in.h265", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "j22_out.mp4"),
        a("-fflags", "+genpts", "-i", "j23_in.ts", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "j23_out.mp4"),
        a("-i", "j24_anr_input", "-frames:v", "1", "-q:v", "3", "-y", "j24_anr_frame.jpg"),
        // The hardware rewrites and the openh264 fallback (from accelerate() and
        // softwareFallback() in ffmpeg-accel.mjs). On Android the bridge rewrites
        // in the page, so the native check only ever sees these forms. The
        // desktop script checks every family against every app shape.
        a("-hwaccel", "cuda", "-i", "clip.webm", "-c:v", "h264_nvenc", "-preset", "p2", "-rc", "vbr", "-cq", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4"),
        a("-f", "concat", "-safe", "0", "-hwaccel", "cuda", "-i", "j26_rev_list.txt", "-c:v", "h264_nvenc", "-preset", "p1", "-pix_fmt", "yuv420p", "-an", "-y", "j26_rev_out.mp4"),
        a("-i", "j27_rev_in.mp4", "-vf", "reverse", "-af", "areverse", "-c:a", "aac", "-c:v", "h264_nvenc", "-preset", "p1", "-pix_fmt", "yuv420p", "-y", "j27_rev_out.mp4"),
        a("-hwaccel", "qsv", "-i", "clip.webm", "-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4"),
        a("-f", "concat", "-safe", "0", "-hwaccel", "qsv", "-i", "j29_rev_list.txt", "-c:v", "h264_qsv", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", "-y", "j29_rev_out.mp4"),
        a("-hwaccel", "d3d11va", "-i", "clip.webm", "-c:v", "h264_amf", "-preset", "speed", "-rc", "cqp", "-qp_i", "20", "-qp_p", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4"),
        a("-i", "j31_rev_in.mp4", "-vf", "reverse", "-af", "areverse", "-c:a", "aac", "-c:v", "h264_amf", "-preset", "speed", "-pix_fmt", "yuv420p", "-y", "j31_rev_out.mp4"),
        a("-hwaccel", "videotoolbox", "-i", "clip.webm", "-c:v", "h264_videotoolbox", "-q:v", "60", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4"),
        a("-f", "concat", "-safe", "0", "-hwaccel", "videotoolbox", "-i", "j33_rev_list.txt", "-c:v", "h264_videotoolbox", "-pix_fmt", "yuv420p", "-an", "-y", "j33_rev_out.mp4"),
        a("-i", "clip.webm", "-c:v", "h264_mediacodec", "-bitrate_mode", "vbr", "-b:v", "11314k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4"),
        a("-f", "concat", "-safe", "0", "-i", "j35_rev_list.txt", "-c:v", "h264_mediacodec", "-bitrate_mode", "vbr", "-b:v", "8000k", "-pix_fmt", "yuv420p", "-an", "-y", "j35_rev_out.mp4"),
        a("-i", "j36_rev_in.mp4", "-vf", "reverse", "-af", "areverse", "-c:a", "aac", "-c:v", "h264_mediacodec", "-bitrate_mode", "vbr", "-b:v", "8000k", "-pix_fmt", "yuv420p", "-y", "j36_rev_out.mp4"),
        a("-i", "clip.webm", "-c:v", "libopenh264", "-b:v", "11314k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4"),
        a("-f", "concat", "-safe", "0", "-i", "j38_rev_list.txt", "-c:v", "libopenh264", "-b:v", "8000k", "-pix_fmt", "yuv420p", "-an", "-y", "j38_rev_out.mp4"),
        a("-i", "j39_rev_in.mp4", "-vf", "reverse", "-af", "areverse", "-c:a", "aac", "-c:v", "libopenh264", "-b:v", "8000k", "-pix_fmt", "yuv420p", "-y", "j39_rev_out.mp4")
    );

    private static final List<List<String>> ATTACKS = Arrays.asList(
        a("-i", "C:\\Users\\x\\secret.txt", "-f", "u8", "out.raw"),
        a("-i", "c:/Users/x/secret.txt", "out.raw"),
        a("-i", "D:secret.txt", "out.raw"),
        a("-i", "/etc/passwd", "out.raw"),
        a("-i", "/data/data/com.valjdakosta.analyser/shared_prefs/x.xml", "out.raw"),
        a("-i", "\\\\server\\share\\x", "out.raw"),
        a("-i", "\\Windows\\win.ini", "out.raw"),
        a("-i", "../../secret", "out.raw"),
        a("-i", "sub/../../secret", "out.raw"),
        a("-i", "http://example.com/x.mp4", "out.mp4"),
        a("-i", "HTTPS://example.com/x.mp4", "out.mp4"),
        a("-i", "file:secret", "out.mp4"),
        a("-i", "content://media/external/images/1", "out.mp4"),
        a("-i", "concat:a.ts|b.ts", "out.mp4"),
        a("-i", "subfile,,start,0,end,10,,:x", "out.mp4"),
        a("-i", "pipe:0", "out.mp4"),
        a("-i", "in.mp4", "-progress", "tcp://1.2.3.4:9", "out.mp4"),
        a("-f", "gdigrab", "-i", "desktop", "shot.mp4"),
        a("-f", "dshow", "-i", "video=Camera", "cam.mp4"),
        a("-f", "android_camera", "-i", "0", "cam.mp4"),
        a("-i", "in.mp4", "-vf", "movie=C\\:/secret.mp4", "out.mp4"),
        a("-i", "in.mp4", "-vf", "movie='/etc/passwd'", "out.mp4"),
        a("-i", "in.mp4", "-vf", "drawtext=textfile=/etc/passwd", "out.mp4"),
        a("-i", "in.mp4", "-vf", "frei0r=./evil.so", "out.mp4"),
        a("-i", "in.mp4", "-vf", "scale=2:2,ladspa@x=f=evil", "out.mp4"),
        a("-i", "in.mp4", "-vf", "sendcmd=f=cmds.txt", "out.mp4"),
        a("-i", "in.mp4", "-y", "C:/Windows/System32/evil.dll"),
        a("-i", "in.mp4", "-f", "tee", "[f=mp4]a.mp4|[f=mp4]/tmp/b.mp4"),
        a("-i", "in.mp4", "-/vf", "graph.txt", "out.mp4"),
        a("-i", "in.mp4", "-filter_complex_script", "graph.txt", "out.mp4"),
        // The allow-list layer: anything the app does not emit.
        a("-i", "in.mp4", "-foo", "1", "out.mp4"),
        a("-i", "in.mp4", "-filter_compl", "x", "out.mp4"),
        a("-i", "in.mp4", "-vf", "scale=2:2,movie=x.mp4", "out.mp4"),
        a("-dump_attachment:t", "", "-i", "in.mkv"),
        a("-dump_attachment", "x", "-i", "in.mkv"),
        a("-i", "in.mp4", "-attach", "font.ttf", "out.mp4"),
        a("-protocol_whitelist", "file,http", "-i", "in.m3u8", "out.mp4"),
        a("-i", "in.mp4", "-f", "hls", "out.m3u8"),
        a("-i", "in.mp4", "-f", "dash", "out.mpd"),
        a("-i", "in.mp4", "-f", "segment", "-segment_list", "list.txt", "seg_%03d.mp4"),
        a("-i", "in.mp4", "-f", "segment", "seg%d.ts"),
        a("-i", "in.mp4", "-f", "image2", "frame_%03d.jpg"),
        a("-i", "in.mp4", "out.m3u8"),
        a("-i", "in.mp4", "frame%03d.jpg"),
        a("-i", "in.mp4", "-y", "con.mp4"),
        a("-i", "nul", "out.mp4"),
        a("-i", "in.mp4:stream", "out.mp4"),
        a("-i", "in\u0001.mp4", "out.mp4"),
        a("-safe", "0", "-i", "in.mp4", "out.mp4"),
        a("-f", "lavfi", "-i", "color", "out.mp4"),
        a("-f", "wav", "-i", "in.wav", "out.mp4"),
        a("-i", "in.mp4", "-f", "concat", "out.mp4"),
        a("-i", "in.mp4", "-f", "wav", "-"),
        a("-i", "in.mp4", "-c:v", "libx264", "-x264-params", "a=b", "out.mp4"),
        a("-i", "in.mp4", "-c:v", "rawvideo", "out.mp4"),
        a("-i", "in.mp4", "-vf", "x /etc/passwd", "out.mp4"),
        a("-i", "in.mp4", "-segment_time", "1", "out.mp4"),
        // Java's $ matches before a final line break; JavaScript's does not.
        a("-i", "in.mp4", "-map", "0\n", "out.mp4"),
        a("-i", "input\n", "out.mp4")
    );

    @Test
    public void appArgumentListsPass() {
        for (List<String> args : APP) assertNull(args.toString(), AnrFfmpegChecks.checkArgs(args));
    }

    @Test
    public void attacksAreRefused() {
        for (List<String> args : ATTACKS) assertNotNull(args.toString(), AnrFfmpegChecks.checkArgs(args));
        assertNotNull(AnrFfmpegChecks.checkArgs(Arrays.asList("-i", 42)));
        assertNotNull(AnrFfmpegChecks.checkArgs(null));
    }

    @Test
    public void notAnArrayIsRefused() {
        // JavaScript's "not an array" vector: here a list of one non-option
        // string that is no bare output name, and a list holding a list.
        assertNotNull(AnrFfmpegChecks.checkArgs(Arrays.asList("not an array")));
        assertNotNull(AnrFfmpegChecks.checkArgs(Arrays.asList((Object) Arrays.asList("-i", "x"))));
    }

    @Test
    public void safeNames() {
        for (String n : new String[] { "input", "rev_seg_000.mp4", "conv_in", "anr_frame.jpg" }) {
            assertTrue(n, AnrFfmpegChecks.isSafeName(n));
        }
        for (String n : new String[] { "", "con", "NUL.txt", "com1.mp4", "a:b", "a\u0000b", ".hidden", "a/b", "café", "a\n" }) {
            assertFalse(n, AnrFfmpegChecks.isSafeName(n));
        }
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.ISO_8859_1);
    }

    private static String whole(String s, boolean isConcat) {
        return AnrFfmpegChecks.checkInputBytes(bytes(s), s.length(), isConcat);
    }

    @Test
    public void listInputBytes() {
        String ok = "file 'rev_out_001.mp4'\nfile 'rev_out_000.mp4'\n";
        assertNull(whole(ok, true));
        assertNull(AnrFfmpegChecks.checkInputBytes(bytes("\u0000\u0001binary video bytes"), 1L << 30, false));
        assertNotNull(AnrFfmpegChecks.checkInputBytes(bytes(ok), AnrFfmpegChecks.LIST_PEEK + 1, true));
        assertNotNull(whole("file 'a.mp4'\n\u0000", true));
        assertNotNull(AnrFfmpegChecks.checkInputBytes(bytes("#EXTM3U\n#EXTINF:10,\na.ts\n"), AnrFfmpegChecks.LIST_PEEK + 1, false));
        assertNotNull(whole("file 'cafÃ", true));
        assertNotNull(whole("ï»¿ffconcat version 1.0\noption safe 0\n", false));
        assertNull(whole("ï»¿ffconcat version 1.0\nfile 'a.mp4'\n", false));
    }

    @Test
    public void listInputs() {
        assertNull(AnrFfmpegChecks.checkInputText("file 'rev_out_001.mp4'\nfile 'rev_out_000.mp4'\n", true));
        assertNull(AnrFfmpegChecks.checkInputText("\u0000\u0001binary video bytes", false));
        assertNotNull(AnrFfmpegChecks.checkInputText("file '/etc/passwd'\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("file 'C:\\secret.mp4'\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("file '../x.mp4'\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("ffconcat version 1.0\nfile a.mp4\noption protocol_whitelist file\n", false));
        assertNotNull(AnrFfmpegChecks.checkInputText("#EXTM3U\n#EXTINF:10,\n/etc/passwd\n", false));
        assertNotNull(AnrFfmpegChecks.checkInputText("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"http://x/key\"\n#EXTINF:10,\na.ts\n", false));
        assertNotNull(AnrFfmpegChecks.checkInputText("v=0\no=- 0 0 IN IP4 127.0.0.1\n", false));
        // Parity and allow-list vectors, also in check-ffmpeg-args.mjs.
        assertNotNull(AnrFfmpegChecks.checkInputText("file 'x'/../../y.mp4\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("file 'a.mp4'\rfile '/etc/passwd'\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("file 'a.mp4'\u0000\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("file 'café.mp4'\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("file 'nul.mp4'\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("duration 5\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("FILE 'a.mp4'\n", true));
        assertNotNull(AnrFfmpegChecks.checkInputText("﻿ffconcat version 1.0\noption safe 0\n", false));
        assertNotNull(AnrFfmpegChecks.checkInputText("#EXTM3U\n /etc/passwd\n", false));
    }
}
