package com.valjdakosta.analyser;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Every request the page (and its service worker) makes to the app origin.
 *
 * Installed by AnrShell.load(), before Capacitor's loadWebView() runs, so it
 * sees the very first navigation. AnrShell also routes the SERVICE WORKER's
 * requests through intercept(): sw.js fetches pages to precache them, and
 * without this it would cache the home page under /about.
 *
 *   /__anr/ff/<session>/<name>   a finished ffmpeg output (AnrFfmpeg.serve)
 *   /__anr/open/<token>          a file another app opened in us (AnrShell)
 *   /_capacitor_*                refused - see below
 *   /api/*                       503: the bridge sends these natively, and
 *                                nothing else should ask
 *   everything else              AnrRouter picks the asset, Capacitor serves it
 *                                (an extensionless one is read here - rawAsset)
 *
 * The app host is decided by host alone (http://app and https://app alike).
 *
 * Capacitor's /_capacitor_file_/ and /_capacitor_content_/ routes let the page
 * read any file or content:// URI the app can reach. Nothing in this app uses
 * them (the bridge never calls convertFileSrc), and a crafted file that finds
 * an XSS in a renderer should not get a file reader, so they answer 404 - on
 * any scheme and host, checked before anything else.
 *
 * shouldOverrideUrlLoading keeps navigations on the app origin, and opens
 * http/https/mailto elsewhere only from a tap.
 */
final class AnrWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;
    private final AnrRouter router;
    private final Context context;

    AnrWebViewClient(Bridge bridge, AnrRouter router, Context context) {
        super(bridge);
        this.bridge = bridge;
        this.router = router;
        this.context = context.getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return intercept(request);
    }

    WebResourceResponse intercept(WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath() == null ? "/" : url.getPath();

        // Capacitor's file readers, refused FIRST and for any scheme and host:
        // its local server answers them for http:// as well as https://, and on
        // the live-reload host too.
        if (path.startsWith(Bridge.CAPACITOR_FILE_START) || path.startsWith(Bridge.CAPACITOR_CONTENT_START)) return status(404);

        // Live-reload development: the page comes from serve.py on the LAN, which
        // routes everything itself. Only the shell's own routes are ours there.
        // The origin must match exactly - a prefix match would also take
        // :30001 for :3000, or 192.168.1.50 for 192.168.1.5.
        if (isDevServer(url)) {
            if (path.startsWith("/__anr/")) return serveAnr(url);
            return bridge.getLocalServer().shouldInterceptRequest(request);
        }

        // The app host, whatever the scheme: Capacitor serves http://app as
        // well as https://app, so both get the same routing and refusals.
        boolean appHost = bridge.getHost().equalsIgnoreCase(url.getHost());
        if (!appHost) return bridge.getLocalServer().shouldInterceptRequest(request);

        if (path.startsWith("/__anr/")) return serveAnr(url);
        if (path.startsWith("/_capacitor_")) return status(404);
        if (path.startsWith("/api/")) return json(503, "{\"error\":\"offline\"}");

        AnrRouter.Route route = router.route(path);
        // Capacitor's server (html5mode) answers index.html for ANY path whose
        // last segment has no dot, so a real extensionless file - a vendor
        // LICENSE - is read from the assets here instead.
        String last = route.asset.substring(route.asset.lastIndexOf('/') + 1);
        if (!last.contains(".")) return rawAsset(route.asset, route.notFound);
        Uri routed = url.buildUpon().path("/" + route.asset).build();
        WebResourceResponse res = bridge.getLocalServer().shouldInterceptRequest(new Routed(request, routed));
        if (res == null) return null;
        String mime = AnrRouter.mime(route.asset);
        if (mime != null) {
            res.setMimeType(mime);
            if (AnrRouter.isText(mime) || mime.equals("text/javascript")) res.setEncoding("utf-8");
        }
        if (route.notFound) res.setStatusCodeAndReasonPhrase(404, "Not Found");
        return res;
    }

    /** An extensionless asset, straight from assets/public/, as plain text. */
    private WebResourceResponse rawAsset(String asset, boolean notFound) {
        try {
            InputStream in = context.getAssets().open("public/" + asset);
            Map<String, String> headers = new HashMap<>();
            headers.put("X-Content-Type-Options", "nosniff");
            int code = notFound ? 404 : 200;
            return new WebResourceResponse("text/plain", "utf-8", code, reason(code), headers, in);
        } catch (IOException e) {
            return status(404);
        }
    }

    // ---- origins -------------------------------------------------------------

    /** True when `url` is the live-reload server's origin: scheme, host and
     *  port all equal, with the scheme's default port filled in. */
    private boolean isDevServer(Uri url) {
        String serverUrl = bridge.getServerUrl();
        return serverUrl != null && sameOrigin(Uri.parse(serverUrl), url);
    }

    static boolean sameOrigin(Uri a, Uri b) {
        if (a.getScheme() == null || b.getScheme() == null || a.getHost() == null || b.getHost() == null) return false;
        return a.getScheme().equalsIgnoreCase(b.getScheme()) && a.getHost().equalsIgnoreCase(b.getHost()) && port(a) == port(b);
    }

    private static int port(Uri u) {
        int p = u.getPort();
        if (p >= 0) return p;
        String s = u.getScheme().toLowerCase(Locale.ROOT);
        return s.equals("https") ? 443 : s.equals("http") ? 80 : -1;
    }

    // ---- navigation ------------------------------------------------------------

    /**
     * Where a navigation may go. Capacitor's own version hands anything off the
     * app origin to Bridge.launchIntent, which fires ACTION_VIEW for any scheme
     * (intent:, market:, tel:) with no user gesture, and a SecurityException
     * from the target crashes the app. Here:
     *  - the app origin (and the dev server) load in the WebView,
     *  - about:, blob: and data: stay in the WebView as well - they are the
     *    page's own content (iframes, srcdoc), not somewhere else,
     *  - http, https and mailto open in another app, but only from a tap,
     *  - everything else is blocked.
     */
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
        String path = url.getPath();
        if (path != null && path.startsWith(Bridge.CAPACITOR_HTTP_INTERCEPTOR_START)) return true;
        if (isDevServer(url)) return false;
        if (scheme.equalsIgnoreCase(bridge.getScheme()) && bridge.getHost().equalsIgnoreCase(url.getHost())) return false;
        if (scheme.equals("about") || scheme.equals("blob") || scheme.equals("data")) return false;
        if ((scheme.equals("http") || scheme.equals("https") || scheme.equals("mailto")) && request.hasGesture()) {
            try {
                Intent open = new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE);
                Activity activity = bridge.getActivity();
                if (activity != null) {
                    activity.startActivity(open);
                } else {
                    context.startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                }
            } catch (RuntimeException ignored) {
                /* no app for it, or the target refused: the link does nothing */
            }
        }
        return true;
    }

    private WebResourceResponse serveAnr(Uri url) {
        List<String> segs = url.getPathSegments();   // decoded: [__anr, ff, id, name]
        if (segs.size() == 4 && "ff".equals(segs.get(1))) return AnrFfmpeg.serve(segs.get(2), segs.get(3));
        if (segs.size() == 3 && "open".equals(segs.get(1))) return AnrShell.serveOpened(context, segs.get(2));
        return status(404);
    }

    // ---- small responses -----------------------------------------------------

    static Map<String, String> noStore() {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        return h;
    }

    static WebResourceResponse status(int code) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason(code), noStore(), new ByteArrayInputStream(new byte[0]));
    }

    static WebResourceResponse json(int code, String body) {
        return new WebResourceResponse(
            "application/json",
            "utf-8",
            code,
            reason(code),
            noStore(),
            new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8))
        );
    }

    static String reason(int code) {
        switch (code) {
            case 200:
                return "OK";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            case 503:
                return "Service Unavailable";
            default:
                return "Error";
        }
    }

    /** The original request with a different URL, handed to Capacitor's server. */
    private static final class Routed implements WebResourceRequest {

        private final WebResourceRequest base;
        private final Uri url;

        Routed(WebResourceRequest base, Uri url) {
            this.base = base;
            this.url = url;
        }

        @Override
        public Uri getUrl() {
            return url;
        }

        @Override
        public boolean isForMainFrame() {
            return base.isForMainFrame();
        }

        @Override
        public boolean isRedirect() {
            return base.isRedirect();
        }

        @Override
        public boolean hasGesture() {
            return base.hasGesture();
        }

        @Override
        public String getMethod() {
            return base.getMethod();
        }

        @Override
        public Map<String, String> getRequestHeaders() {
            Map<String, String> h = base.getRequestHeaders();
            return h != null ? h : new HashMap<>();
        }
    }
}
