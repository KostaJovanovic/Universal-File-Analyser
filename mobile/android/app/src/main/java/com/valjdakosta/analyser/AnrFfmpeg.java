package com.valjdakosta.analyser;

import android.os.Build;
import android.webkit.WebResourceResponse;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native FFmpeg for the Android shell - the twin of desktop/ffmpeg-native.mjs.
 *
 * WHY: ffmpeg.wasm is software-only and single-threaded. A real ffmpeg binary
 * is many times faster even in software, and on a phone it can reach the
 * chipset's own encoder through MediaCodec.
 *
 * THE BINARY ships as jniLibs/arm64-v8a/libanrffmpeg.so - an EXECUTABLE with a
 * library's name. Since targetSdk 29 an app may not execute anything it wrote
 * itself, and the native library folder is the one place the system extracts
 * runnable files to (build.gradle sets useLegacyPackaging so it is extracted).
 * mobile/ffmpeg/ builds it; stage-web.mjs copies it in. With no binary, caps()
 * says so and src/renderers/video.ts uses ffmpeg.wasm exactly as the website.
 *
 * A CHILD PROCESS, not a JNI call. This is a forensic tool that opens hostile
 * files on purpose: a file that crashes libavcodec kills only the child, and the
 * page shows an error card instead of the app vanishing. It also gives Cancel a
 * real kill, lets /compare run two jobs at once, and matches runJob() on the
 * desktop line for line.
 *
 * WHAT STAYS IN THE PAGE: the hardware rewrite and the software retry run in
 * the bridge, from desktop/ffmpeg-accel.mjs - they are not a security boundary.
 * WHAT STAYS HERE: AnrFfmpegChecks, on every exec, because an XSS in a renderer
 * can call this plugin directly with any arguments it likes.
 *
 * Bytes never cross Capacitor's JSON bridge: writes arrive through AnrBytes,
 * and reads are GET /__anr/ff/<session>/<name>, served by serve() below.
 */
@CapacitorPlugin(name = "AnrFfmpeg")
public class AnrFfmpeg extends Plugin {

    private static final String BINARY = "libanrffmpeg.so";
    private static final int LOG_KEEP = 131072;
    private static final int LIST_PEEK = 1024 * 1024;
    private static final Pattern DURATION = Pattern.compile("Duration:\\s*(\\d+):(\\d\\d):(\\d\\d(?:\\.\\d+)?)");
    private static final Pattern TIME = Pattern.compile("time=\\s*(\\d+):(\\d\\d):(\\d\\d(?:\\.\\d+)?)");
    private static final Pattern ENCODER_LINE = Pattern.compile("^\\s*[VAS][A-Z.]{5}\\s+(\\S+)");

    static final class Session {

        final File dir;
        final Set<Process> procs = Collections.newSetFromMap(new ConcurrentHashMap<>());

        Session(File dir) {
            this.dir = dir;
        }
    }

    private static final Map<String, Session> SESSIONS = new ConcurrentHashMap<>();
    private static final ExecutorService JOBS = Executors.newCachedThreadPool();
    private static final ScheduledExecutorService TIMERS = Executors.newSingleThreadScheduledExecutor();

    private JSObject caps;

    @Override
    public void load() {
        // Session folders from a run that was killed mid-job.
        File[] old = getContext().getCacheDir().listFiles((d, n) -> n.startsWith("anr-ffmpeg-"));
        if (old != null) for (File f : old) deleteTree(f);
    }

    private File binary() {
        return new File(getContext().getApplicationInfo().nativeLibraryDir, BINARY);
    }

    // ---- the virtual file system --------------------------------------------

    /** Names are flattened so nothing the page sends can escape its session -
     *  the same rule as safeName() in ffmpeg-native.mjs. */
    static String safeName(String name) {
        String n = String.valueOf(name == null ? "f" : name).replaceAll("[\\\\/]+", "_").replaceFirst("^\\.+", "_");
        return n.isEmpty() ? "f" : n;
    }

    static File sessionFile(String id, String name) {
        Session s = id == null ? null : SESSIONS.get(id);
        return s == null ? null : new File(s.dir, safeName(name));
    }

    /** GET /__anr/ff/<session>/<name> - a finished output, streamed from disk. */
    static WebResourceResponse serve(String id, String name) {
        File f = sessionFile(id, name);
        if (f == null || !f.isFile()) return AnrWebViewClient.status(404);
        try {
            Map<String, String> headers = AnrWebViewClient.noStore();
            headers.put("Content-Length", String.valueOf(f.length()));
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, new FileInputStream(f));
        } catch (IOException e) {
            return AnrWebViewClient.status(404);
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        String id = UUID.randomUUID().toString();
        File dir = new File(getContext().getCacheDir(), "anr-ffmpeg-" + id);
        if (!dir.mkdirs() && !dir.isDirectory()) {
            call.reject("could not create a session folder");
            return;
        }
        SESSIONS.put(id, new Session(dir));
        JSObject r = new JSObject();
        r.put("id", id);
        call.resolve(r);
    }

    @PluginMethod
    public void del(PluginCall call) {
        File f = sessionFile(call.getString("id", ""), call.getString("name", ""));
        if (f == null) {
            call.reject("no such ffmpeg session");
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        Session s = SESSIONS.remove(call.getString("id", ""));
        if (s != null) {
            for (Process p : s.procs) p.destroy();
            JOBS.execute(() -> deleteTree(s.dir));
        }
        call.resolve();
    }

    /** The user swiped the app away (AnrJobService.onTaskRemoved): the page
     *  that waits for these results is gone, so end every job now. */
    static void stopAll() {
        for (Session s : SESSIONS.values()) {
            for (Process p : s.procs) p.destroy();
        }
    }

    // ---- capabilities --------------------------------------------------------

    @PluginMethod
    public void caps(PluginCall call) {
        JOBS.execute(() -> call.resolve(capabilities()));
    }

    /** Probed once, cached on disk. The key includes the OS build, because an
     *  OS update replaces the codec drivers the probe measured. */
    private synchronized JSObject capabilities() {
        if (caps != null) return caps;
        File bin = binary();
        if (!bin.isFile()) {
            caps = unavailable("not installed");
            return caps;
        }
        String key = bin.length() + ":" + bin.lastModified() + ":" + Build.FINGERPRINT;
        File cache = new File(getContext().getFilesDir(), "ffmpeg-caps.json");
        try {
            JSONObject c = new JSONObject(readText(cache, 1 << 20));
            if (key.equals(c.optString("key"))) {
                caps = JSObject.fromJSONObject(c.getJSONObject("caps"));
                return caps;
            }
        } catch (Exception ignored) {
            /* no usable cache - probe below */
        }
        caps = probe(bin);
        try (OutputStream o = new FileOutputStream(cache)) {
            o.write(new JSONObject().put("key", key).put("caps", caps).toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            /* a lost cache costs one re-probe */
        }
        return caps;
    }

    private static JSObject unavailable(String label) {
        JSObject r = new JSObject();
        r.put("available", false);
        r.put("path", JSONObject.NULL);
        r.put("version", "");
        r.put("families", new JSArray());
        r.put("accel", JSONObject.NULL);
        r.put("vendor", JSONObject.NULL);
        r.put("label", label);
        return r;
    }

    /**
     * Which encoders really work. Presence in `-encoders` proves nothing - the
     * desktop learnt that from a build listing Intel and AMD encoders on an
     * NVIDIA machine - and MediaCodec differs per chipset, so each candidate
     * encodes a throwaway frame and only a clean exit counts.
     */
    private JSObject probe(File bin) {
        String listing = capture(bin, Arrays.asList("-hide_banner", "-encoders"), 15000);
        if (listing == null) return unavailable("does not run on this phone");
        String version = capture(bin, Arrays.asList("-hide_banner", "-version"), 10000);
        List<String> encoders = new ArrayList<>();
        for (String line : listing.split("\\r?\\n")) {
            Matcher m = ENCODER_LINE.matcher(line);
            if (m.find() && !m.group(1).equals("=")) encoders.add(m.group(1));
        }

        JSArray families = new JSArray();
        JSObject best = null;
        if (encoders.contains("h264_mediacodec") && encoderWorks(bin, "h264_mediacodec")) {
            JSObject f = new JSObject();
            f.put("vendor", "mediacodec");
            f.put("label", "Android MediaCodec");
            f.put("h264", "h264_mediacodec");
            f.put("hevc", encoders.contains("hevc_mediacodec") && encoderWorks(bin, "hevc_mediacodec") ? "hevc_mediacodec" : JSONObject.NULL);
            f.put("av1", encoders.contains("av1_mediacodec") && encoderWorks(bin, "av1_mediacodec") ? "av1_mediacodec" : JSONObject.NULL);
            f.put("hwaccel", JSONObject.NULL);
            families.put(f);
            best = f;
        }

        JSArray names = new JSArray();
        for (String e : encoders) names.put(e);
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("path", bin.getAbsolutePath());
        r.put("version", version == null ? "" : version.split("\\r?\\n", 2)[0]);
        r.put("families", families);
        r.put("accel", best == null ? JSONObject.NULL : best);
        r.put("vendor", best == null ? JSONObject.NULL : "mediacodec");
        r.put("label", best == null ? "software only" : "Android MediaCodec");
        // softwareFallback() in the bridge reads this: a build without libx264
        // retries with the encoder it does have.
        r.put("encoders", names);
        return r;
    }

    private boolean encoderWorks(File bin, String encoder) {
        List<String> args = Arrays.asList(
            "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=black:s=320x240:d=0.1:r=10",
            "-pix_fmt", "yuv420p", "-c:v", encoder, "-frames:v", "3", "-f", "null", "-"
        );
        try {
            Process p = start(bin, args, getContext().getCacheDir(), true);
            drain(p.getInputStream());
            return waitFor(p, 20000) == 0;
        } catch (IOException e) {
            return false;
        }
    }

    // ---- running a job -------------------------------------------------------

    @PluginMethod
    public void exec(PluginCall call) {
        final String id = call.getString("id", "");
        final Session s = SESSIONS.get(id);
        if (s == null) {
            call.reject("no such ffmpeg session");
            return;
        }
        List<Object> raw;
        try {
            JSArray a = call.getArray("args");
            raw = a == null ? null : a.toList();
        } catch (JSONException e) {
            raw = null;
        }
        final List<Object> rawArgs = raw;
        final int timeout = call.getInt("timeout", 0);

        JOBS.execute(() -> {
            // The page chose these arguments, and the page is not trusted - see
            // AnrFfmpegChecks. Refuse before anything spawns. Code 1, not -1:
            // video.ts reads -1 as "ffmpeg could not start" and throws the
            // instance away, while a non-zero exit is a clean failure.
            String refused = AnrFfmpegChecks.checkArgs(rawArgs);
            List<String> args = new ArrayList<>();
            if (refused == null) {
                for (Object o : rawArgs) args.add((String) o);
                refused = checkInputs(s.dir, args);
            }
            if (refused != null) {
                String log = "[analyser] refused to run ffmpeg: " + refused + "\n";
                emitLog(id, log);
                JSObject r = result(false, 1, log);
                r.put("refused", true);
                call.resolve(r);
                return;
            }
            File bin = binary();
            if (!bin.isFile()) {
                call.resolve(result(false, -1, "no ffmpeg binary"));
                return;
            }
            call.resolve(run(id, s, bin, args, timeout));
        });
    }

    /** A list input (a concat list, a playlist) can name files the arguments
     *  never did - the reverse in video.ts feeds `-f concat -safe 0` its own. */
    private static String checkInputs(File dir, List<String> args) {
        for (AnrFfmpegChecks.Input in : AnrFfmpegChecks.inputsOf(args)) {
            File f = new File(dir, safeName(in.name));
            if (!f.isFile()) continue;   // ffmpeg reports the missing file itself
            byte[] head;
            try (InputStream s = new FileInputStream(f)) {
                head = readBytes(s, (int) Math.min(f.length(), LIST_PEEK));
            } catch (IOException e) {
                continue;
            }
            boolean binary = false;
            for (int i = 0; i < Math.min(head.length, 4096); i++) {
                if (head[i] == 0) {
                    binary = true;
                    break;
                }
            }
            if (binary) continue;
            String bad = AnrFfmpegChecks.checkInputText(new String(head, StandardCharsets.UTF_8), "concat".equals(in.format));
            if (bad != null) return bad;
        }
        return null;
    }

    private JSObject run(String id, Session s, File bin, List<String> args, int timeout) {
        List<String> full = new ArrayList<>(Arrays.asList("-hide_banner", "-nostdin"));
        full.addAll(args);
        final Process p;
        try {
            p = start(bin, full, s.dir, false);
        } catch (IOException e) {
            return result(false, -1, String.valueOf(e.getMessage()));
        }
        s.procs.add(p);
        // Keeps the app, and so this child, alive if the user switches away.
        final String job = UUID.randomUUID().toString();
        AnrJobService.begin(getContext(), job);
        AnrJobService.askForNotifications(getActivity());
        try {
            return runProcess(id, job, s, p, timeout);
        } finally {
            AnrJobService.end(job);
        }
    }

    private JSObject runProcess(String id, String job, Session s, Process p, int timeout) {
        drain(p.getInputStream());

        final boolean[] timedOut = { false };
        ScheduledFuture<?> timer = timeout > 0
            ? TIMERS.schedule(() -> {
                timedOut[0] = true;
                p.destroy();
            }, timeout, TimeUnit.MILLISECONDS)
            : null;

        StringBuilder log = new StringBuilder();
        double duration = -1;
        long lastProgress = 0;
        try (Reader r = new InputStreamReader(p.getErrorStream(), StandardCharsets.UTF_8)) {
            char[] buf = new char[8192];
            int n;
            while ((n = r.read(buf)) > 0) {
                String chunk = new String(buf, 0, n);
                log.append(chunk);
                // Bounded: a long job writes megabytes of stderr.
                if (log.length() > 2 * LOG_KEEP) log.delete(0, log.length() - LOG_KEEP);
                emitLog(id, chunk);
                if (duration < 0) {
                    Matcher m = DURATION.matcher(chunk);
                    if (m.find()) duration = clock(m);
                }
                if (duration > 0) {
                    Matcher m = TIME.matcher(chunk);
                    double t = -1;
                    while (m.find()) t = clock(m);
                    long now = System.currentTimeMillis();
                    if (t >= 0 && now - lastProgress > 200) {
                        lastProgress = now;
                        double fraction = Math.max(0, Math.min(1, t / duration));
                        emitProgress(id, fraction);
                        AnrJobService.progress(job, fraction);
                    }
                }
            }
        } catch (IOException ignored) {
            /* the process ended or was killed */
        }
        int code = waitFor(p, 0);
        if (timer != null) timer.cancel(false);
        s.procs.remove(p);
        return result(code == 0 && !timedOut[0], code, log.toString());
    }

    private static Process start(File bin, List<String> args, File cwd, boolean mergeErr) throws IOException {
        List<String> cmd = new ArrayList<>();
        cmd.add(bin.getAbsolutePath());
        cmd.addAll(args);
        ProcessBuilder pb = new ProcessBuilder(cmd).directory(cwd).redirectErrorStream(mergeErr);
        // Any shared library the build needs (libc++_shared.so) sits beside it.
        pb.environment().put("LD_LIBRARY_PATH", bin.getParent());
        Process p = pb.start();
        try {
            p.getOutputStream().close();   // -nostdin, and nothing is ever written
        } catch (IOException ignored) {}
        return p;
    }

    /** Resolve the exit code, or -1. A positive timeout kills a hung probe. */
    private static int waitFor(Process p, long timeoutMs) {
        ScheduledFuture<?> kill = timeoutMs > 0 ? TIMERS.schedule(p::destroy, timeoutMs, TimeUnit.MILLISECONDS) : null;
        try {
            return p.waitFor();
        } catch (InterruptedException e) {
            p.destroy();
            Thread.currentThread().interrupt();
            return -1;
        } finally {
            if (kill != null) kill.cancel(false);
        }
    }

    /** Nothing reads stdout, but an unread pipe can stall the child. */
    private static void drain(InputStream in) {
        JOBS.execute(() -> {
            try (InputStream s = in) {
                byte[] buf = new byte[8192];
                //noinspection StatementWithEmptyBody
                while (s.read(buf) > 0) {}
            } catch (IOException ignored) {}
        });
    }

    /** Run to completion and return everything it printed, or null if it
     *  could not start (wrong ABI, a missing library). */
    private String capture(File bin, List<String> args, long timeoutMs) {
        try {
            Process p = start(bin, args, getContext().getCacheDir(), true);
            ScheduledFuture<?> kill = TIMERS.schedule(p::destroy, timeoutMs, TimeUnit.MILLISECONDS);
            String text;
            try {
                text = new String(readBytes(p.getInputStream(), 8 * 1024 * 1024), StandardCharsets.UTF_8);
            } finally {
                kill.cancel(false);
            }
            int code = waitFor(p, 1000);
            return code == 0 || !text.isEmpty() ? text : null;
        } catch (IOException e) {
            return null;
        }
    }

    // ---- events and results ----------------------------------------------------

    private void emitLog(String id, String message) {
        JSObject d = new JSObject();
        d.put("id", id);
        d.put("type", "log");
        d.put("message", message);
        notifyListeners("ffmpeg", d);
    }

    private void emitProgress(String id, double progress) {
        JSObject d = new JSObject();
        d.put("id", id);
        d.put("type", "progress");
        d.put("progress", progress);
        notifyListeners("ffmpeg", d);
    }

    private static JSObject result(boolean ok, int code, String log) {
        JSObject r = new JSObject();
        r.put("ok", ok);
        r.put("code", code);
        r.put("log", log.length() > LOG_KEEP ? log.substring(log.length() - LOG_KEEP) : log);
        return r;
    }

    private static double clock(Matcher m) {
        return Integer.parseInt(m.group(1)) * 3600 + Integer.parseInt(m.group(2)) * 60 + Double.parseDouble(m.group(3));
    }

    // ---- files -----------------------------------------------------------------

    private static byte[] readBytes(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while (out.size() < max && (n = in.read(buf, 0, Math.min(buf.length, max - out.size()))) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String readText(File f, int max) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            return new String(readBytes(in, max), StandardCharsets.UTF_8);
        }
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
