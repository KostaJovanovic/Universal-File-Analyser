package com.valjdakosta.analyser;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The byte channel, page -> native: window.anrBytes in the page.
 *
 * Capacitor's own bridge is JSON, so bytes would cross it as base64 - a third
 * larger with several copies alive at once, and a 500 MB video takes the WebView
 * down. This is a WebMessageListener instead, which takes ArrayBuffer messages
 * directly where the WebView supports WEB_MESSAGE_ARRAY_BUFFER, and base64
 * chunks of bounded size where it does not.
 *
 * Protocol (the page half is transfer() in mobile/bridge/anr-bridge.js):
 *   {"op":"begin","target":"ff","id":..,"name":..,"size":N}   into an ffmpeg session
 *   {"op":"begin","target":"stage","xfer":..,"size":N}        staged for AnrShell.save
 *   ArrayBuffer | {"op":"chunk","b64":..}                     repeated
 *   {"op":"end"} | {"op":"abort"}
 * EVERY message gets exactly one JSON ack, in order: {"ok":true} or
 * {"ok":false,"error":..}. The page waits for each ack before the next send, so
 * at most one chunk is in flight and memory stays bounded. The bridge also
 * queues transfers, so only one is ever open here.
 *
 * Limits: `size` is required, 0 to MAX_SIZE, and must fit the free space; a
 * chunk is at most MAX_CHUNK (MAX_TEXT as base64); staged saves are capped in
 * count and bytes, and one left unsaved for STALE_MS is deleted.
 *
 * Only the app origin (and the dev server) can post: AnrShell registers the
 * listener with those origin rules. Names are flattened by AnrFfmpeg.safeName
 * and stage ids must match XFER, so nothing the page sends becomes a path.
 */
final class AnrBytes implements WebViewCompat.WebMessageListener {

    static final Pattern XFER = Pattern.compile("^[A-Za-z0-9-]{1,64}$");
    private static final String OK = "{\"ok\":true}";

    /** The bridge sends 4 MiB chunks (CHUNK in anr-bridge.js). */
    private static final int MAX_CHUNK = 4 * 1024 * 1024;
    /** The same chunk as base64 inside {"op":"chunk","b64":..}, plus room for
     *  the JSON around it. Also bounds every other text message. */
    private static final int MAX_TEXT = (MAX_CHUNK / 3 + 1) * 4 + 1024;
    /** One transfer, whatever it is for. */
    private static final long MAX_SIZE = 8L * 1024 * 1024 * 1024;
    /** Left free on the cache volume after a transfer is counted in. */
    private static final long SPACE_MARGIN = 256L * 1024 * 1024;
    /** Staged saves: a page that stages and never saves must not fill the cache. */
    private static final int MAX_STAGED = 8;
    private static final long MAX_STAGED_BYTES = 4L * 1024 * 1024 * 1024;
    /** A staged file older than this was never saved (the picker is long gone). */
    private static final long STALE_MS = 30L * 60 * 1000;

    private final Context context;
    // One writer thread: messages must be applied in the order they arrived, and
    // disk writes must stay off the UI thread onPostMessage is called on.
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private OutputStream out;
    private File target;
    private long expected;
    private long written;

    AnrBytes(Context context) {
        this.context = context.getApplicationContext();
    }

    static File stageDir(Context context) {
        File dir = new File(context.getCacheDir(), "anr-stage");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    static File stagedFile(Context context, String xfer) {
        if (xfer == null || !XFER.matcher(xfer).matches()) return null;
        return new File(stageDir(context), xfer);
    }

    /** Leftovers from a run that died mid-save. */
    static void clearStage(Context context) {
        File[] old = stageDir(context).listFiles();
        if (old != null) for (File f : old) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    @Override
    public void onPostMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply) {
        if (!isMainFrame) return;
        final byte[] bytes;
        final String text;
        if (message.getType() == WebMessageCompat.TYPE_ARRAY_BUFFER) {
            bytes = message.getArrayBuffer();
            text = null;
        } else {
            bytes = null;
            text = message.getData();
        }
        io.execute(() -> {
            String ack;
            try {
                handle(text, bytes);
                ack = OK;
            } catch (Exception e) {
                reset(true);
                ack = error(e.getMessage());
            }
            final String result = ack;
            main.post(() -> reply.postMessage(result));
        });
    }

    private void handle(String text, byte[] bytes) throws IOException, JSONException {
        if (bytes != null) {
            if (bytes.length > MAX_CHUNK) throw new IOException("chunk too large");
            write(bytes);
            return;
        }
        if (text != null && text.length() > MAX_TEXT) throw new IOException("message too large");
        JSONObject m = new JSONObject(text == null ? "{}" : text);
        switch (m.optString("op")) {
            case "begin":
                reset(true);
                begin(m);
                return;
            case "chunk": {
                byte[] data = Base64.decode(m.getString("b64"), Base64.DEFAULT);
                if (data.length > MAX_CHUNK) throw new IOException("chunk too large");
                write(data);
                return;
            }
            case "end":
                if (out == null) throw new IOException("no transfer open");
                out.close();
                out = null;
                if (written != expected) {
                    reset(true);
                    throw new IOException("transfer was short: " + written + " of " + expected + " bytes");
                }
                target = null;
                return;
            case "abort":
                reset(true);
                return;
            default:
                throw new IOException("unknown message");
        }
    }

    private void begin(JSONObject m) throws IOException, JSONException {
        String kind = m.optString("target");
        // The size is required and bounded: every write is checked against it,
        // so it is what caps the file on disk.
        long size = m.has("size") ? m.optLong("size", -1) : -1;
        if (size < 0 || size > MAX_SIZE) throw new IOException("bad transfer size");
        File file;
        if ("ff".equals(kind)) {
            file = AnrFfmpeg.sessionFile(m.getString("id"), m.getString("name"));
        } else if ("stage".equals(kind)) {
            file = stagedFile(context, m.optString("xfer"));
            if (file != null) checkStage(file, size);
        } else {
            file = null;
        }
        if (file == null) throw new IOException("no such target");
        File dir = file.getParentFile();
        if (dir != null && size > dir.getUsableSpace() - SPACE_MARGIN) throw new IOException("not enough free space");
        expected = size;
        written = 0;
        target = file;
        out = new BufferedOutputStream(new FileOutputStream(file), 1 << 20);
    }

    /** Clear stale staged files, then refuse a new one past the count or byte
     *  limit. `file` itself does not count: a re-used id is overwritten. */
    private void checkStage(File file, long size) throws IOException {
        long now = System.currentTimeMillis();
        int count = 0;
        long bytes = 0;
        File[] staged = stageDir(context).listFiles();
        if (staged != null) for (File f : staged) {
            if (f.equals(file)) continue;
            if (now - f.lastModified() > STALE_MS) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                continue;
            }
            count++;
            bytes += f.length();
        }
        if (count >= MAX_STAGED) throw new IOException("too many files are waiting to be saved");
        if (bytes + size > MAX_STAGED_BYTES) throw new IOException("too much is waiting to be saved");
    }

    private void write(byte[] data) throws IOException {
        if (out == null) throw new IOException("no transfer open");
        if (written + data.length > expected) throw new IOException("more bytes than announced");
        out.write(data);
        written += data.length;
    }

    /** Close whatever is open. A partial file is never left to look finished. */
    private void reset(boolean deletePartial) {
        if (out != null) {
            try {
                out.close();
            } catch (IOException ignored) {}
            out = null;
            if (deletePartial && target != null) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
            }
        }
        target = null;
    }

    private static String error(String message) {
        try {
            return new JSONObject().put("ok", false).put("error", message == null ? "failed" : message).toString();
        } catch (JSONException e) {
            return "{\"ok\":false}";
        }
    }
}
