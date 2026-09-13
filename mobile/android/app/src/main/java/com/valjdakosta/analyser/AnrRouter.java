package com.valjdakosta.analyser;

import android.content.res.AssetManager;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * URL routing for the Android shell.
 *
 * A port of desktop/router.mjs, which is itself a port of serve.py's _route()
 * - and serve.py mirrors the production Cloudflare routing. serve.py is the
 * spec: change one and change all three.
 *
 * Why it exists: Capacitor's local server serves index.html for ANY path with no
 * extension, so /about would show the home page. (Capacitor does have a
 * RouteProcessor hook, but it is only ever called with the fixed string
 * "/index.html", never the requested path, so it cannot route.)
 *
 * The same two deliberate differences as the desktop:
 *  - /x.html is served directly, not 308-redirected to /x.
 *  - /api/* never reaches here: the bridge sends it through AnrShell.api().
 *
 * The staged file list (assets/anr-files.txt, written by stage-web.mjs) makes
 * "does this file exist" a set lookup rather than an AssetManager open per
 * request. Without it, it falls back to opening the asset.
 */
final class AnrRouter {

    static final class Route {
        /** Path under assets/public/, no leading slash. */
        final String asset;
        /** True for Cloudflare's 404-page behaviour: 404.html with status 404. */
        final boolean notFound;

        Route(String asset, boolean notFound) {
            this.asset = asset;
            this.notFound = notFound;
        }
    }

    static final Route NOT_FOUND = new Route("404.html", true);

    /** The Android Gradle plugin unpacks every .gz asset and drops the
     *  extension, so stage-web.mjs stores each .gz file with this suffix
     *  added, and route() maps a request for x.gz to x.gz.anr. This is the
     *  one difference from router.mjs that is not about routing: it only
     *  undoes a packaging step. Keep it in step with GZ_SUFFIX there. */
    static final String GZ_SUFFIX = ".anr";

    private final AssetManager assets;
    private final Set<String> files;

    AnrRouter(AssetManager assets) {
        this.assets = assets;
        this.files = loadListing(assets);
    }

    private static Set<String> loadListing(AssetManager assets) {
        try (
            BufferedReader r = new BufferedReader(new InputStreamReader(assets.open("anr-files.txt"), StandardCharsets.UTF_8))
        ) {
            Set<String> set = new HashSet<>(8192);
            String line;
            while ((line = r.readLine()) != null) {
                if (!line.isEmpty()) set.add(line);
            }
            return set;
        } catch (IOException e) {
            return null;
        }
    }

    private boolean exists(String rel) {
        if (files != null) return files.contains(rel);
        try (InputStream in = assets.open("public/" + rel)) {
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** @param path the request path, already percent-decoded (Uri.getPath()). */
    Route route(String path) {
        if (path == null || path.isEmpty() || path.equals("/")) return new Route("index.html", false);
        String rel = path.replaceFirst("^/+", "");
        if (rel.isEmpty()) return new Route("index.html", false);
        // Reject traversal before any lookup: anything that could climb out of
        // public/ is a 404, not a read.
        for (String seg : rel.split("/", -1)) {
            if (seg.equals("..") || seg.equals(".") || seg.contains("\\")) return NOT_FOUND;
        }
        // A .gz file is stored as <name>.gz.anr (stage-web.mjs says why).
        if (rel.endsWith(".gz") && exists(rel + GZ_SUFFIX)) return new Route(rel + GZ_SUFFIX, false);
        if (exists(rel)) return new Route(rel, false);               // real asset, served as-is
        if (exists(rel + ".html")) return new Route(rel + ".html", false);  // /about -> about.html
        return NOT_FOUND;
    }

    // Content types set from our own table, as router.mjs does, rather than left
    // to URLConnection's guess (it does not know .mjs). A module script with the
    // wrong type is refused outright, and streaming WASM compilation fails.
    private static final Map<String, String> MIME = new HashMap<>();

    static {
        String[][] table = {
            { "html", "text/html" }, { "htm", "text/html" },
            { "js", "text/javascript" }, { "mjs", "text/javascript" }, { "cjs", "text/javascript" },
            { "css", "text/css" }, { "json", "application/json" }, { "map", "application/json" },
            { "webmanifest", "application/manifest+json" }, { "txt", "text/plain" }, { "md", "text/plain" },
            { "xml", "application/xml" }, { "svg", "image/svg+xml" }, { "wasm", "application/wasm" },
            { "png", "image/png" }, { "jpg", "image/jpeg" }, { "jpeg", "image/jpeg" }, { "gif", "image/gif" },
            { "webp", "image/webp" }, { "avif", "image/avif" }, { "ico", "image/x-icon" }, { "bmp", "image/bmp" },
            { "woff", "font/woff" }, { "woff2", "font/woff2" }, { "ttf", "font/ttf" }, { "otf", "font/otf" },
            { "mp3", "audio/mpeg" }, { "wav", "audio/wav" }, { "ogg", "audio/ogg" }, { "flac", "audio/flac" },
            { "m4a", "audio/mp4" }, { "mp4", "video/mp4" }, { "webm", "video/webm" }, { "pdf", "application/pdf" },
            { "zip", "application/zip" }, { "data", "application/octet-stream" }, { "bin", "application/octet-stream" },
            { "gz", "application/gzip" },
        };
        for (String[] row : table) MIME.put(row[0], row[1]);
    }

    /** MIME type for a file name, or null when the extension is unknown. A
     *  stored x.gz.anr answers as the x.gz it stands for. */
    static String mime(String name) {
        if (name.endsWith(GZ_SUFFIX)) name = name.substring(0, name.length() - GZ_SUFFIX.length());
        int dot = name.lastIndexOf('.');
        int slash = name.lastIndexOf('/');
        if (dot < 0 || dot < slash) return null;
        return MIME.get(name.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    static boolean isText(String mime) {
        return mime != null && (mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("xml") || mime.equals("image/svg+xml"));
    }
}
