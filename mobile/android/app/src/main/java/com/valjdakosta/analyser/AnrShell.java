package com.valjdakosta.analyser;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import androidx.core.content.IntentCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The shell's half of window.anrDesktop - everything but FFmpeg.
 *
 * load() runs inside Capacitor's Bridge constructor, BEFORE loadWebView(), so it
 * is the one place that can prepare the WebView before the first page:
 *  - install AnrWebViewClient (routing) for the page AND its service worker,
 *  - register the byte channel (AnrBytes) as window.anrBytes,
 *  - inject the bridge (mobile/bridge/anr-bridge.js, built by stage-web.mjs
 *    into assets/anr-bridge.js) at document start - the preload equivalent.
 *
 * Its plugin methods are callable by any script in the page, including one a
 * crafted file smuggled in through a renderer XSS. So each one takes only what
 * it needs and checks it: api() reaches one host and one path prefix, save()
 * writes only where the user picks in the system dialog, and nothing takes a
 * path.
 */
@CapacitorPlugin(name = "AnrShell")
public class AnrShell extends Plugin {

    private static final String SITE = "https://analyser.valjdakosta.com";
    private static final String SITE_HOST = "analyser.valjdakosta.com";
    private static final Pattern API_PATH = Pattern.compile("^/api/[A-Za-z0-9_./-]*(\\?[A-Za-z0-9_.~=&%+-]*)?$");
    private static final int API_BODY_MAX = 64 * 1024;
    private static final int API_REPLY_MAX = 1024 * 1024;
    private static final Pattern RGB = Pattern.compile("rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)");
    private static final Pattern MIME = Pattern.compile("^[a-z0-9.+-]+/[a-z0-9.+-]+$", Pattern.CASE_INSENSITIVE);

    private static final ExecutorService NET = Executors.newFixedThreadPool(2);
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        Context ctx = getContext();
        AnrBytes.clearStage(ctx);

        AnrWebViewClient client = new AnrWebViewClient(bridge, new AnrRouter(ctx.getAssets()), ctx);
        bridge.setWebViewClient(client);
        // sw.js fetches pages to precache them. Its requests skip the WebView
        // client, so they need the same routing or /about is cached as the home
        // page. capacitor.config.json turns Capacitor's own SW client off
        // (resolveServiceWorkerRequests), or loadWebView() would replace this.
        ServiceWorkerController.getInstance().setServiceWorkerClient(
            new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return client.intercept(request);
                }
            }
        );

        WebView webView = bridge.getWebView();
        Set<String> origins = new HashSet<>();
        origins.add(bridge.getScheme() + "://" + bridge.getHost());
        String serverUrl = bridge.getServerUrl();
        if (serverUrl != null) {
            Uri u = Uri.parse(serverUrl);
            origins.add(u.getScheme() + "://" + u.getAuthority());
        }
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.addWebMessageListener(webView, "anrBytes", origins, new AnrBytes(ctx));
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                String script = bridgeScript(ctx);
                if (script != null) WebViewCompat.addDocumentStartJavaScript(webView, script, origins);
            } else {
                Logger.warn(getLogTag(), "This WebView cannot run a document-start script, so the page runs as it does on the website.");
            }
        } catch (IllegalArgumentException e) {
            Logger.error(getLogTag(), "Could not attach the bridge", e);
        }
    }

    private String bridgeScript(Context ctx) {
        String src;
        try (InputStream in = ctx.getAssets().open("anr-bridge.js")) {
            src = readAll(in, Integer.MAX_VALUE);
        } catch (IOException e) {
            Logger.error(getLogTag(), "assets/anr-bridge.js is missing - run mobile/tools/stage-web.mjs", e);
            return null;
        }
        JSONObject boot = new JSONObject();
        try {
            boot.put("version", versionName(ctx));
            boot.put("packaged", (ctx.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0);
            boot.put("arrayBuffers", WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER));
            boot.put("arch", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "");
        } catch (JSONException ignored) {}
        return src.replace("/*ANR_BOOT*/{}", boot.toString());
    }

    private static String versionName(Context ctx) {
        try {
            String v = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
            return v == null ? "" : v;
        } catch (Exception e) {
            return "";
        }
    }

    // ---- "Open with" and "Share to Analyser" ---------------------------------

    private static final class Opened {

        final Uri uri;
        final String mime;

        Opened(Uri uri, String mime) {
            this.uri = uri;
            this.mime = mime;
        }
    }

    /** Token -> content URI. The page learns a token only from an open event,
     *  and only the last 32 stay valid. */
    private static final Map<String, Opened> OPENED = Collections.synchronizedMap(
        new LinkedHashMap<String, Opened>(16, 0.75f, false) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Opened> eldest) {
                return size() > 32;
            }
        }
    );

    /**
     * Turn a VIEW / SEND intent into the desktop's open payload and hand it to
     * the page. Retained until the page listens, since a cold start delivers the
     * intent before app.ts has booted. Returns true when the intent was a file.
     */
    boolean deliver(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (list != null && !list.isEmpty()) uri = list.get(0);   // the page opens one file at a time
        }
        // content:// only. A file:// URI names another app's private path, and
        // the platform itself stopped allowing those to cross apps in Android 7.
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) return false;

        ContentResolver cr = getContext().getContentResolver();
        String name = "file";
        long size = 0;
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int si = c.getColumnIndex(OpenableColumns.SIZE);
                if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni);
                if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
            }
        } catch (Exception ignored) {
            /* a provider that will not describe the file still streams it */
        }
        String mime = cr.getType(uri);
        if (mime == null) mime = intent.getType();
        if (mime == null) mime = "";

        String token = UUID.randomUUID().toString();
        OPENED.put(token, new Opened(uri, mime.isEmpty() ? "application/octet-stream" : mime));

        JSObject payload = new JSObject();
        payload.put("kind", "file");
        payload.put("name", name);
        payload.put("size", size);
        payload.put("mime", mime);
        payload.put("lastModified", System.currentTimeMillis());
        payload.put("url", "/__anr/open/" + token);
        notifyListeners("open", payload, true);
        return true;
    }

    /** GET /__anr/open/<token> - streams the content URI, no copy. */
    static WebResourceResponse serveOpened(Context ctx, String token) {
        Opened o = OPENED.get(token);
        if (o == null) return AnrWebViewClient.status(404);
        try {
            InputStream in = ctx.getContentResolver().openInputStream(o.uri);
            if (in == null) return AnrWebViewClient.status(404);
            return new WebResourceResponse(o.mime, null, 200, "OK", AnrWebViewClient.noStore(), in);
        } catch (Exception e) {
            return AnrWebViewClient.status(404);
        }
    }

    // ---- /api/* --------------------------------------------------------------

    /** The desktop proxies /api/* at its scheme handler. Android's
     *  shouldInterceptRequest never sees a request body, so the bridge sends the
     *  requests here instead. One host, one path prefix, GET and POST only - a
     *  general native HTTP client would let an XSS read any site without CORS. */
    @PluginMethod
    public void api(PluginCall call) {
        final String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        final String path = call.getString("path", "");
        final String body = call.getString("body", null);
        final String contentType = call.getString("contentType", "");
        final String accept = call.getString("accept", "");
        if (!("GET".equals(method) || "POST".equals(method)) || !API_PATH.matcher(path).matches() || path.contains("..")) {
            call.reject("refused");
            return;
        }
        if (body != null && body.length() > API_BODY_MAX) {
            call.reject("refused");
            return;
        }
        NET.execute(() -> {
            HttpURLConnection c = null;
            try {
                URL url = new URL(SITE + path);
                if (!SITE_HOST.equals(url.getHost()) || !"https".equals(url.getProtocol())) {
                    call.reject("refused");
                    return;
                }
                c = (HttpURLConnection) url.openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(15000);
                c.setReadTimeout(20000);
                c.setRequestMethod(method);
                c.setRequestProperty("User-Agent", WebSettings.getDefaultUserAgent(getContext()));
                if (headerOk(contentType)) c.setRequestProperty("Content-Type", contentType);
                if (headerOk(accept)) c.setRequestProperty("Accept", accept);
                if ("POST".equals(method) && body != null) {
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    c.setDoOutput(true);
                    c.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream o = c.getOutputStream()) {
                        o.write(bytes);
                    }
                }
                int status = c.getResponseCode();
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                String text = in == null ? "" : readAll(in, API_REPLY_MAX);
                JSObject r = new JSObject();
                r.put("status", status);
                r.put("contentType", c.getContentType() == null ? "" : c.getContentType());
                r.put("body", text);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("offline");
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    private static boolean headerOk(String v) {
        return v != null && !v.isEmpty() && v.length() < 200 && v.indexOf('\r') < 0 && v.indexOf('\n') < 0;
    }

    // ---- saving a file -------------------------------------------------------

    /** The bytes are already staged by the byte channel; this asks the user
     *  where to put them (Storage Access Framework) and copies them there. */
    @PluginMethod
    public void save(PluginCall call) {
        File staged = AnrBytes.stagedFile(getContext(), call.getString("xfer", ""));
        if (staged == null || !staged.isFile()) {
            call.reject("nothing staged");
            return;
        }
        String mime = call.getString("mime", "");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime != null && MIME.matcher(mime).matches() ? mime : "application/octet-stream")
            .putExtra(Intent.EXTRA_TITLE, displayName(call.getString("name", "download")));
        startActivityForResult(call, intent, "saveDone");
    }

    @ActivityCallback
    private void saveDone(PluginCall call, ActivityResult result) {
        if (call == null) return;
        final File staged = AnrBytes.stagedFile(getContext(), call.getString("xfer", ""));
        final Uri dest = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        if (dest == null || staged == null) {
            if (staged != null) {
                //noinspection ResultOfMethodCallIgnored
                staged.delete();
            }
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("canceled", true);
            call.resolve(r);
            return;
        }
        IO.execute(() -> {
            try (InputStream in = new FileInputStream(staged); OutputStream out = getContext().getContentResolver().openOutputStream(dest, "wt")) {
                if (out == null) throw new IOException("the destination refused the write");
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                JSObject r = new JSObject();
                r.put("ok", true);
                call.resolve(r);
            } catch (IOException e) {
                call.reject("save failed: " + e.getMessage());
            } finally {
                //noinspection ResultOfMethodCallIgnored
                staged.delete();
            }
        });
    }

    private static String displayName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_").trim();
        if (n.length() > 120) n = n.substring(n.length() - 120);
        return n.isEmpty() ? "download" : n;
    }

    // ---- share and the bar colour --------------------------------------------

    /** navigator.share for the Android WebView, which has none: text and a link
     *  through the system share sheet. */
    @PluginMethod
    public void share(PluginCall call) {
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        String url = call.getString("url", "");
        String body = text.isEmpty() ? url : (url.isEmpty() ? text : text + "\n" + url);
        if (body.isEmpty()) {
            call.reject("nothing to share");
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, body);
        if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        Intent chooser = Intent.createChooser(send, title.isEmpty() ? null : title);
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(chooser);
                call.resolve();
            } catch (Exception e) {
                call.reject("no app can share this");
            }
        });
    }

    /** The page's background colour, so the inset bands match the theme. */
    @PluginMethod
    public void bars(PluginCall call) {
        Matcher m = RGB.matcher(call.getString("color", ""));
        Activity activity = getActivity();
        if (m.find() && activity instanceof MainActivity) {
            int color = Color.rgb(channel(m.group(1)), channel(m.group(2)), channel(m.group(3)));
            ((MainActivity) activity).setBarColor(color);
        }
        call.resolve();
    }

    private static int channel(String s) {
        try {
            return Math.max(0, Math.min(255, Integer.parseInt(s)));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    // ---- updates -------------------------------------------------------------

    /** The footer's "Check for updates" button. AnrUpdate shows the answer
     *  itself - a dialog for a new version, a short message otherwise. */
    @PluginMethod
    public void checkUpdates(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) AnrUpdate.checkNow(activity);
        call.resolve();
    }

    // ---- helpers -------------------------------------------------------------

    static String readAll(InputStream in, int max) throws IOException {
        try (InputStream src = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = src.read(buf)) > 0) {
                if (out.size() + n > max) throw new IOException("reply too large");
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        }
    }
}
