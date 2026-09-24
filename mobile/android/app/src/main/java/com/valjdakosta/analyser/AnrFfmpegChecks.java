package com.valjdakosta.analyser;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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
 * Two layers, as there: a deny-list over every argument, then an allow-list of
 * exactly the options, formats, values and file names the app emits (including
 * the MediaCodec rewrite and the openh264 fallback the bridge makes). Any other
 * option is refused. checkInputBytes() is the list-file half; AnrFfmpeg calls it
 * on the first LIST_PEEK bytes of every input.
 *
 * Pure Java with no Android imports, so AnrFfmpegChecksTest runs it on the JVM
 * against the same vectors as desktop/tools/check-ffmpeg-args.mjs.
 */
final class AnrFfmpegChecks {

    private AnrFfmpegChecks() {}

    static final int MAX_ARGS = 512;
    static final int MAX_ARG_LEN = 16384;

    /* Every pattern is ASCII-only, as in ffmpeg-accel.mjs: no \s, \S, \b, . or $
     * and no CASE_INSENSITIVE, because Android's regex engine is ICU, whose
     * meanings for those are Unicode-aware and differ from both OpenJDK's and
     * JavaScript's. Case folding is asciiLower() instead. */

    /** ASCII whitespace, spelled out. */
    private static final String WS = "\\t\\n\\x0B\\f\\r ";

    /** Lower-cases A-Z only. */
    static String asciiLower(String s) {
        char[] c = s.toCharArray();
        for (int i = 0; i < c.length; i++) {
            if (c[i] >= 'A' && c[i] <= 'Z') c[i] = (char) (c[i] + 32);
        }
        return new String(c);
    }

    /** Where a path or URL can start inside one argument. */
    private static final String D = "(?:^|[" + WS + "=|,;'\"\\[\\]])";

    private static final String[] PROTOCOLS = {
        "android_content", "async", "bluray", "cache", "concat", "concatf", "content", "crypto", "data",
        "dtls", "fd", "ffrtmpcrypt", "ffrtmphttp", "file", "ftp", "gopher", "gophers", "hls", "http",
        "httpproxy", "https", "icecast", "ipfs", "ipns", "librist", "librtmp", "librtmpe", "librtmps",
        "librtmpt", "librtmpte", "libsmbclient", "libsrt", "libssh", "libzmq", "md5", "mmsh", "mmst",
        "pipe", "prompeg", "rist", "rtmp", "rtmpe", "rtmps", "rtmpt", "rtmpte", "rtmpts", "rtp", "rtsp",
        "rtsps", "sctp", "sftp", "smb", "srt", "srtp", "subfile", "tcp", "tee", "tls", "udp", "udplite",
        "unix", "zmq",
    };

    /* Each runs on asciiLower(value). (?![^X]) is "end of text, or a character
     * from X" - Java's $ also matches before a final line break. */
    private static final Pattern[] RE = {
        Pattern.compile(D + "[a-z][a-z0-9+.-]*\\\\?:(?:\\\\?[\\\\/]){2}"),
        Pattern.compile(D + "(?:" + String.join("|", PROTOCOLS) + ")(?:\\\\?:|,)"),
        Pattern.compile("(?:^|[" + WS + "=|,;'\"\\[\\]:])[a-z]\\\\?:[\\\\/]"),
        Pattern.compile("(?:^|[" + WS + "=|'\"])[a-z]\\\\?:(?![\\\\/:])[^" + WS + "]"),
        Pattern.compile(D + "(?:/|\\\\{1,2}(?=[a-z0-9_$.~-]))"),
        Pattern.compile("(?:^|[" + WS + "=|,;'\"\\[\\]\\\\/:])\\.\\.(?![^" + WS + "\\\\/|,;'\"\\[\\]:])"),
        Pattern.compile(
            "(?:^|[" + WS + ",;'\"\\[\\]])(?:frei0r|frei0r_src|ladspa|lv2|a?zmq|a?sendcmd)(?![^=@,;" + WS + "'\"\\[\\]])"
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

    private static final Map<String, String> NAMED_REFUSALS = new HashMap<>();

    static {
        NAMED_REFUSALS.put("-dump_attachment", "writes attachments to files");
        NAMED_REFUSALS.put("-attach", "reads a file into the output");
        NAMED_REFUSALS.put("-protocol_whitelist", "widens the protocols ffmpeg may open");
        NAMED_REFUSALS.put("-protocol_blacklist", "changes the protocols ffmpeg may open");
    }

    private static final Set<String> EXTRA_FILE_MUXERS = new HashSet<>(
        Arrays.asList(
            "hls", "dash", "tee", "stream_segment", "ssegment", "image2", "fifo", "webm_chunk",
            "webm_dash_manifest", "smoothstreaming", "hds"
        )
    );

    static String valueProblem(String s) {
        String low = asciiLower(s);
        for (int i = 0; i < RE.length; i++) {
            if (RE[i].matcher(low).find()) return WHAT[i];
        }
        return null;
    }

    // ---- The allow-list (see ffmpeg-accel.mjs for why each entry exists) ----

    private static final String NUM = "^[0-9]{1,10}(?:\\.[0-9]{1,20})?$";
    private static final String VCODEC = "^(?:copy|libx264|libopenh264|(?:h264|hevc|av1)_(?:nvenc|qsv|amf|videotoolbox|mediacodec))$";
    private static final String ACODEC = "^(?:copy|aac|pcm_s16le)$";

    /** Option -> value pattern; a null value is a flag. -i and -f are special. */
    private static final Map<String, Pattern> OPTIONS = new HashMap<>();
    private static final Set<String> FLAGS = new HashSet<>(Arrays.asList("-y", "-vn", "-an"));

    private static void opt(String name, String re) {
        OPTIONS.put(name, Pattern.compile(re));
    }

    static {
        opt("-i", "");
        opt("-f", "");
        opt("-fflags", "^\\+genpts$");
        opt("-skip_loop_filter", "^all$");
        opt("-hwaccel", "^(?:cuda|qsv|d3d11va|videotoolbox)$");
        opt("-safe", "^0$");
        opt("-c", "^copy$");
        opt("-c:v", VCODEC);
        opt("-vcodec", VCODEC);
        opt("-c:a", ACODEC);
        opt("-acodec", ACODEC);
        for (String n : new String[] { "-r", "-ar", "-ac", "-t", "-frames:v", "-q:v", "-crf", "-cq", "-global_quality", "-qp_i", "-qp_p", "-segment_time" }) {
            opt(n, NUM);
        }
        opt("-preset", "^(?:ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow|p[1-7]|speed|balanced|quality)$");
        opt("-tune", "^zerolatency$");
        opt("-pix_fmt", "^yuv420p$");
        opt("-movflags", "^\\+faststart$");
        opt("-vf", "^(?:reverse|scale=-2:2\\*trunc\\(min\\([0-9]{1,5}\\\\,ih\\)/2\\))$");
        opt("-af", "^areverse$");
        opt("-force_key_frames", "^expr:gte\\(t,n_forced\\*[0-9]{1,10}(?:\\.[0-9]{1,20})?\\)$");
        opt("-map", "^0$");
        opt("-reset_timestamps", "^1$");
        opt("-rc", "^(?:vbr|cqp)$");
        opt("-bitrate_mode", "^vbr$");
        opt("-b:v", "^[0-9]{1,9}k$");
    }

    private static final Set<String> INPUT_FORMATS = new HashSet<>(Arrays.asList("h264", "hevc", "concat"));
    private static final Set<String> OUTPUT_FORMATS = new HashSet<>(Arrays.asList("wav", "null", "segment"));

    private static final Pattern NAME = Pattern.compile("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$");
    private static final Pattern OUTPUT_NAME = Pattern.compile("^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}\\.(?:mp4|wav|jpg)$");
    private static final Pattern SEGMENT_NAME = Pattern.compile("^[A-Za-z0-9_]{0,63}_%0[1-9]d\\.mp4$");
    private static final Pattern RESERVED = Pattern.compile("^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?![^.])");

    /** True for a bare file name the session folder may hold. AnrFfmpeg.safeName
     *  should refuse anything this refuses. */
    static boolean isSafeName(String name) {
        return name != null && NAME.matcher(name).matches() && !RESERVED.matcher(asciiLower(name)).find();
    }

    /** @return why the job is refused, or null when it may run. */
    static String checkArgs(List<?> args) {
        if (args == null || args.size() > MAX_ARGS) return "not a valid argument list";
        // Layer 1: the deny-list, over every argument.
        for (int i = 0; i < args.size(); i++) {
            Object o = args.get(i);
            if (!(o instanceof String)) return "not a valid argument list";
            String a = (String) o;
            if (a.length() > MAX_ARG_LEN) return "not a valid argument list";
            if (a.startsWith("-/") || FILE_OPTIONS.contains(a)) return a + " reads options from a file";
            if (a.equals("-f") && i + 1 < args.size() && DEVICES.contains(asciiLower(String.valueOf(args.get(i + 1))))) {
                return "-f " + args.get(i + 1) + " is a capture or playback device";
            }
            String bad = valueProblem(a);
            if (bad != null) return "\"" + a + "\" contains " + bad;
        }
        // Layer 2: the allow-list. fmt is the -f waiting for its -i or output.
        String fmt = null;
        for (int i = 0; i < args.size(); i++) {
            String a = (String) args.get(i);
            if (a.startsWith("-") && !a.equals("-")) {
                if (NAMED_REFUSALS.containsKey(a)) return a + " " + NAMED_REFUSALS.get(a);
                if (FLAGS.contains(a)) continue;
                Pattern re = OPTIONS.get(a);
                if (re == null) return a + " is not an option the app uses";
                if (i + 1 >= args.size()) return a + " has no value";
                String v = (String) args.get(++i);
                if (a.equals("-f")) {
                    if (EXTRA_FILE_MUXERS.contains(asciiLower(v))) return "-f " + v + " writes extra files";
                    if (!INPUT_FORMATS.contains(v) && !OUTPUT_FORMATS.contains(v)) return "-f " + v + " is not a format the app uses";
                    fmt = v;
                } else if (a.equals("-i")) {
                    if (fmt != null && !INPUT_FORMATS.contains(fmt)) return "-f " + fmt + " is not an input format the app uses";
                    if (!isSafeName(v)) return "the input \"" + v + "\" is not a bare file name";
                    fmt = null;
                } else {
                    if (a.equals("-safe") && !"concat".equals(fmt)) return "-safe only goes with -f concat";
                    if ((a.equals("-segment_time") || a.equals("-reset_timestamps")) && !"segment".equals(fmt)) {
                        return a + " only goes with -f segment";
                    }
                    if (!re.matcher(v).matches()) return a + " \"" + v + "\" is not a value the app uses";
                }
            } else {
                if (fmt != null && !OUTPUT_FORMATS.contains(fmt)) return "-f " + fmt + " is not an output format the app uses";
                if ("segment".equals(fmt)) {
                    if (!SEGMENT_NAME.matcher(a).matches()) return "the segment output \"" + a + "\" is not the reverse's shape";
                } else if (a.equals("-")) {
                    if (!"null".equals(fmt)) return "only -f null may write to \"-\"";
                } else if (!OUTPUT_NAME.matcher(a).matches() || RESERVED.matcher(asciiLower(a)).find()) {
                    return "the output \"" + a + "\" is not a bare file name the app writes";
                }
                fmt = null;
            }
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

    /** A BOM as decoded text, or as its three UTF-8 bytes read one per char. */
    private static final String BOM = "(?:\\uFEFF|\\xEF\\xBB\\xBF)?";

    /** Tested against asciiLower(text). Package-private so AnrFfmpeg can reuse
     *  it - but checkInputBytes() already does the whole peek decision. */
    static final Pattern LIST_HEAD = Pattern.compile(
        "^" + BOM + "[" + WS + "]*(?:#extm3u|ffconcat(?![a-z0-9_])|file[" + WS + "]|<\\?xml|<mpd|<smil|v=0|\\[playlist\\])"
    );
    private static final Pattern CONCAT_HEAD = Pattern.compile("^" + BOM + "[" + WS + "]*ffconcat(?![a-z0-9_])");
    private static final Pattern SDP_HEAD = Pattern.compile("^" + BOM + "[" + WS + "]*v=0");
    private static final Pattern BOM_AT_START = Pattern.compile("^" + BOM);
    private static final Pattern NOT_LIST_TEXT = Pattern.compile("[^\\t\\n\\r\\x20-\\x7E]");
    private static final Pattern LONE_CR = Pattern.compile("\\r(?!\\n)");
    /** The whole line must match - see CONCAT_FILE in ffmpeg-accel.mjs. */
    private static final Pattern CONCAT_FILE = Pattern.compile("^file[ \\t]+(?:'([^'\\\\]*)'|([^'\\\\ \\t]+))$");

    /** Only this much of an input is read; a larger list is refused. */
    static final int LIST_PEEK = 1024 * 1024;

    /** Spaces and tabs off both ends - not String.trim(), which strips every
     *  control character and so differs from JavaScript's trim(). */
    private static String trimAscii(String s) {
        int a = 0, b = s.length();
        while (a < b && (s.charAt(a) == ' ' || s.charAt(a) == '\t')) a++;
        while (b > a && (s.charAt(b - 1) == ' ' || s.charAt(b - 1) == '\t')) b--;
        return s.substring(a, b);
    }

    /** Look inside one input that may be a list of other inputs. */
    static String checkInputText(String text, boolean isConcat) {
        String low = asciiLower(text);
        boolean concat = isConcat || CONCAT_HEAD.matcher(low).find();
        if (!concat && !LIST_HEAD.matcher(low).find()) return null;
        if (SDP_HEAD.matcher(low).find()) return "an SDP description opens network sockets";
        String body = BOM_AT_START.matcher(text).replaceFirst("");
        if (NOT_LIST_TEXT.matcher(body).find()) return "a list input holds control or non-ASCII characters";
        if (LONE_CR.matcher(body).find()) return "a list input holds a lone carriage return";
        for (String raw : body.split("\\r?\\n")) {
            String line = trimAscii(raw);
            if (line.isEmpty()) continue;
            if (concat) {
                if (line.startsWith("#") || line.equals("ffconcat version 1.0")) continue;
                Matcher m = CONCAT_FILE.matcher(line);
                if (!m.matches()) return "the concat list line \"" + line + "\" is not one the app writes";
                String name = m.group(1) != null ? m.group(1) : m.group(2);
                if (!isSafeName(name)) return "the concat list names \"" + name + "\"";
                continue;
            }
            if (line.startsWith("#") && !asciiLower(line).contains("uri=")) continue;
            String bad = valueProblem(line);
            if (bad != null) return "a list input contains " + bad;
        }
        return null;
    }

    /**
     * The file half of the check, on raw bytes - the port of checkInputBytes in
     * ffmpeg-accel.mjs. The caller reads the first min(size, LIST_PEEK) bytes
     * and passes them with the file's full size. Bytes are read as Latin-1,
     * never decoded as UTF-8, so a cut or broken sequence is judged the same
     * way on both sides (any byte above 0x7E is refused in a list).
     */
    static String checkInputBytes(byte[] head, long totalSize, boolean isConcat) {
        int n = head.length;
        int nul = -1;
        for (int i = 0; i < n; i++) {
            if (head[i] == 0) {
                nul = i;
                break;
            }
        }
        if (!isConcat && nul != -1 && nul < 4096) return null;   // binary - not a list
        boolean truncated = totalSize > n;
        if (isConcat && truncated) return "the concat list is larger than " + LIST_PEEK + " bytes";
        if (isConcat && nul != -1) return "the concat list holds a NUL byte";
        String text = new String(head, 0, n, StandardCharsets.ISO_8859_1);
        if (!isConcat && truncated && LIST_HEAD.matcher(asciiLower(text)).find()) {
            return "a list input is larger than " + LIST_PEEK + " bytes";
        }
        return checkInputText(text, isConcat);
    }
}
