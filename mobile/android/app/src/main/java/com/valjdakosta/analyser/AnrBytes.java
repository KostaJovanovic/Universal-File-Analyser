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
 * Only the app origin (and the dev server) can post: AnrShell registers the
 * listener with those origin rules. Names are flattened by AnrFfmpeg.safeName
 * and stage ids must match XFER, so nothing the page sends becomes a path.
 */
final class AnrBytes implements WebViewCompat.WebMessageListener {

    static final Pattern XFER = Pattern.compile("^[A-Za-z0-9-]{1,64}$");
    private static final String OK = "{\"ok\":true}";

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
            write(bytes);
            return;
        }
        JSONObject m = new JSONObject(text == null ? "{}" : text);
        switch (m.optString("op")) {
            case "begin":
                reset(true);
                begin(m);
                return;
            case "chunk":
                write(Base64.decode(m.getString("b64"), Base64.DEFAULT));
                return;
            case "end":
                if (out == null) throw new IOException("no transfer open");
                out.close();
                out = null;
                if (expected >= 0 && written != expected) {
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
        File file;
        if ("ff".equals(kind)) {
            file = AnrFfmpeg.sessionFile(m.getString("id"), m.getString("name"));
        } else if ("stage".equals(kind)) {
            file = stagedFile(context, m.optString("xfer"));
        } else {
            file = null;
        }
        if (file == null) throw new IOException("no such target");
        expected = m.optLong("size", -1);
        written = 0;
        target = file;
        out = new BufferedOutputStream(new FileOutputStream(file), 1 << 20);
    }

    private void write(byte[] data) throws IOException {
        if (out == null) throw new IOException("no transfer open");
        if (expected >= 0 && written + data.length > expected) throw new IOException("more bytes than announced");
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
