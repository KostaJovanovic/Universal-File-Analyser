package com.valjdakosta.analyser;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The FFmpeg safety checks - the Java port of the CHECKS half of
 * desktop/ffmpeg-accel.mjs. Keep the two in step; the header of that file says
 * why they exist.
 *
 * In short: the page chooses ffmpeg's arguments, and a crafted file that finds
 * an XSS in a renderer controls the page. Unchecked, it could make ffmpeg read
 * or write anywhere the app can, open the network, or open the camera. The
 * bridge in the page cannot be trusted with this - an XSS can call the plugin
 * directly - so AnrFfmpeg runs these on every exec, whatever the bridge sent.
 *
 * Pure Java with no Android imports, so AnrFfmpegChecksTest runs it on the JVM
 * against the same vectors as desktop/tools/check-ffmpeg-args.mjs.
 */
final class AnrFfmpegChecks {

    private AnrFfmpegChecks() {}

    static final int MAX_ARGS = 512;
    static final int MAX_ARG_LEN = 16384;

    /** Where a path or URL can start inside one argument. */
    private static final String D = "(?:^|[\\s=|,;'\"\\[\\]])";

    private static final String[] PROTOCOLS = {
        "android_content", "async", "bluray", "cache", "concat", "concatf", "content", "crypto", "data",
        "dtls", "fd", "ffrtmpcrypt", "ffrtmphttp", "file", "ftp", "gopher", "gophers", "hls", "http",
        "httpproxy", "https", "icecast", "ipfs", "ipns", "librist", "librtmp", "librtmpe", "librtmps",
        "librtmpt", "librtmpte", "libsmbclient", "libsrt", "libssh", "libzmq", "md5", "mmsh", "mmst",
        "pipe", "prompeg", "rist", "rtmp", "rtmpe", "rtmps", "rtmpt", "rtmpte", "rtmpts", "rtp", "rtsp",
        "rtsps", "sctp", "sftp", "smb", "srt", "srtp", "subfile", "tcp", "tee", "tls", "udp", "udplite",
        "unix", "zmq",
    };

    private static final Pattern[] RE = {
        Pattern.compile(D + "[a-z][a-z0-9+.-]*\\\\?:(?:\\\\?[\\\\/]){2}", Pattern.CASE_INSENSITIVE),
        Pattern.compile(D + "(?:" + String.join("|", PROTOCOLS) + ")(?:\\\\?:|,)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:^|[\\s=|,;'\"\\[\\]:])[a-z]\\\\?:[\\\\/]", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:^|[\\s=|'\"])[a-z]\\\\?:(?![\\\\/:])\\S", Pattern.CASE_INSENSITIVE),
        Pattern.compile(D + "(?:/|\\\\{1,2}(?=[a-z0-9_$.~-]))", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:^|[\\s=|,;'\"\\[\\]\\\\/:])\\.\\.(?=$|[\\s\\\\/|,;'\"\\[\\]:])"),
        Pattern.compile(
            "(?:^|[\\s,;'\"\\[\\]])(?:frei0r|frei0r_src|ladspa|lv2|a?zmq|a?sendcmd)(?=$|[=@,;\\s'\"\\[\\]])",
            Pattern.CASE_INSENSITIVE
        ),
    };

    private static final String[] WHAT = {
        "a URL",
        "an ffmpeg protocol",
        "a drive path",
        "a drive-relative path",
        "an absolute path",
        "a parent-folder step",
        "a filter that loads code or opens a socket",
    };

    private static final Set<String> DEVICES = new HashSet<>(
        Arrays.asList(
            "alsa", "android_camera", "audiotoolbox", "avfoundation", "bktr", "caca", "decklink", "dshow",
            "dv1394", "fbdev", "gdigrab", "iec61883", "jack", "kmsgrab", "libcdio", "libdc1394", "openal",
            "opengl", "oss", "pulse", "sdl", "sdl2", "sndio", "v4l2", "video4linux2", "vfwcap", "x11grab",
            "xcbgrab", "xv"
        )
    );

    private static final Set<String> FILE_OPTIONS = new HashSet<>(Arrays.asList("-filter_script", "-filter_complex_script"));

    static String valueProblem(String s) {
        for (int i = 0; i < RE.length; i++) {
            if (RE[i].matcher(s).find()) return WHAT[i];
        }
        return null;
    }

    /** @return why the job is refused, or null when it may run. */
    static String checkArgs(List<?> args) {
        if (args == null || args.size() > MAX_ARGS) return "not a valid argument list";
        for (int i = 0; i < args.size(); i++) {
            Object o = args.get(i);
            if (!(o instanceof String)) return "not a valid argument list";
            String a = (String) o;
            if (a.length() > MAX_ARG_LEN) return "not a valid argument list";
            if (a.startsWith("-/") || FILE_OPTIONS.contains(a)) return a + " reads options from a file";
            if (a.equals("-f") && i + 1 < args.size() && DEVICES.contains(String.valueOf(args.get(i + 1)).toLowerCase(Locale.ROOT))) {
                return "-f " + args.get(i + 1) + " is a capture or playback device";
            }
            String bad = valueProblem(a);
            if (bad != null) return "\"" + a + "\" contains " + bad;
        }
        return null;
    }

    static final class Input {

        final String name;
        final String format;

        Input(String name, String format) {
            this.name = name;
            this.format = format;
        }
    }

    /** Every input with the -f that applies to it. */
    static List<Input> inputsOf(List<String> args) {
        List<Input> out = new ArrayList<>();
        String fmt = null;
        for (int i = 0; i < args.size(); i++) {
            String a = args.get(i);
            if (a.equals("-f") && i + 1 < args.size()) {
                fmt = args.get(++i);
            } else if (a.equals("-i") && i + 1 < args.size()) {
                out.add(new Input(args.get(++i), fmt));
                fmt = null;
            }
        }
        return out;
    }

    private static final Pattern LIST_HEAD = Pattern.compile(
        "^\\uFEFF?\\s*(?:#EXTM3U|ffconcat\\b|file\\s|<\\?xml|<MPD|<smil|v=0|\\[playlist\\])",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern SDP = Pattern.compile("^\\uFEFF?\\s*v=0");
    private static final Pattern FILE_LINE = Pattern.compile("^file\\s+(?:'((?:[^'\\\\]|\\\\.)*)'|(\\S+))", Pattern.CASE_INSENSITIVE);
    private static final Pattern OPTION_LINE = Pattern.compile("^option\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern URI_ATTR = Pattern.compile("URI=", Pattern.CASE_INSENSITIVE);
    private static final Pattern SAFE_NAME = Pattern.compile("^[A-Za-z0-9_][A-Za-z0-9_.-]*$");

    /** Look inside one input that may be a list of other inputs. */
    static String checkInputText(String text, boolean isConcat) {
        if (!isConcat && !LIST_HEAD.matcher(text).find()) return null;
        if (SDP.matcher(text).find()) return "an SDP description opens network sockets";
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty() || (line.startsWith("#") && !URI_ATTR.matcher(line).find())) continue;
            if (OPTION_LINE.matcher(line).find()) return "the concat list sets demuxer options";
            Matcher m = FILE_LINE.matcher(line);
            if (m.find()) {
                String name = m.group(1) != null ? m.group(1) : m.group(2);
                if (!SAFE_NAME.matcher(name).matches()) return "the concat list names \"" + name + "\"";
                continue;
            }
            String bad = valueProblem(line);
            if (bad != null) return "a list input contains " + bad;
        }
        return null;
    }
}
