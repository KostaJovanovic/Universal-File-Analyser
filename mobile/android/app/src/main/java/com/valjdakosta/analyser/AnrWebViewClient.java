package com.valjdakosta.analyser;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
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
 *
 * Capacitor's /_capacitor_file_/ and /_capacitor_content_/ routes let the page
 * read any file or content:// URI the app can reach. Nothing in this app uses
 * them (the bridge never calls convertFileSrc), and a crafted file that finds
 * an XSS in a renderer should not get a file reader, so they answer 404.
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

        // Live-reload development: the page comes from serve.py on the LAN, which
        // routes everything itself. Only the shell's own routes are ours there.
        String serverUrl = bridge.getServerUrl();
        if (serverUrl != null && url.toString().startsWith(serverUrl)) {
            if (path.startsWith("/__anr/")) return serveAnr(url);
            return bridge.getLocalServer().shouldInterceptRequest(request);
        }

        boolean appOrigin = bridge.getScheme().equalsIgnoreCase(url.getScheme()) && bridge.getHost().equalsIgnoreCase(url.getHost());
        if (!appOrigin) return bridge.getLocalServer().shouldInterceptRequest(request);

        if (path.startsWith("/__anr/")) return serveAnr(url);
        if (path.startsWith("/_capacitor_")) return status(404);
        if (path.startsWith("/api/")) return json(503, "{\"error\":\"offline\"}");

        AnrRouter.Route route = router.route(path);
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
