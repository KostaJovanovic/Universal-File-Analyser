package com.valjdakosta.analyser;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

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
        a("-i", "input", "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", "output.wav"),
        a("-i", "adin", "-vn", "-c:a", "pcm_s16le", "-f", "wav", "adout.wav"),
        a("-i", "clip.webm", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4"),
        a("-i", "rev_in.mp4", "-vf", "reverse", "-af", "areverse", "-c:a", "aac", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", "rev_out.mp4"),
        a("-i", "rev_src"),
        a("-i", "rev_src", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-force_key_frames", "expr:gte(t,n_forced*2.5)", "-c:a", "aac", "-y", "rev_norm.mp4"),
        a("-i", "rev_norm.mp4", "-c", "copy", "-map", "0", "-f", "segment", "-segment_time", "0.5", "-reset_timestamps", "1", "rev_seg_%03d.mp4"),
        a("-f", "concat", "-safe", "0", "-i", "rev_list.txt", "-c", "copy", "-y", "rev_out.mp4"),
        a("-f", "concat", "-safe", "0", "-i", "rev_list.txt", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", "-y", "rev_out.mp4"),
        a("-skip_loop_filter", "all", "-i", "in.mov", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale=-2:2*trunc(min(720\\,ih)/2)", "-c:a", "aac", "-movflags", "+faststart", "-y", "out.mp4"),
        a("-fflags", "+genpts", "-f", "hevc", "-r", "29.97", "-i", "seg.h265", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "seg.mp4"),
        a("-fflags", "+genpts", "-f", "h264", "-i", "seg.h264", "-c", "copy", "-movflags", "+faststart", "seg.mp4"),
        a("-fflags", "+genpts", "-i", "in.ts", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", "out.mp4"),
        a("-i", "input", "-frames:v", "1", "-q:v", "3", "-y", "anr_frame.jpg"),
        a("-i", "probe", "-f", "null", "-t", "2", "-"),
        // The MediaCodec rewrite of the encode above - the native side sees this form.
        a("-i", "clip.webm", "-c:v", "h264_mediacodec", "-bitrate_mode", "vbr", "-b:v", "11314k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "clip.mp4")
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
        a("-i", "in.mp4", "-filter_complex_script", "graph.txt", "out.mp4")
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
    }
}
