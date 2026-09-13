package com.valjdakosta.analyser;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Updates for the APK on GitHub (.github/workflows/release.yml).
 *
 * Only a build with an update feed checks: BuildConfig.UPDATE_FEED, which the
 * release workflow sets with -PanrUpdateFeed. A mobile.bat build has none and
 * never checks. A Google Play build must have none either, and must also drop
 * REQUEST_INSTALL_PACKAGES from the manifest: Play forbids an app that updates
 * itself.
 *
 * The feed is GitHub's API answer for the latest release. There is no update
 * file in the release: the answer gives the tag (v9.2.0), and for the asset
 * named Analyser-android.apk its download URL, its size and the SHA-256 digest
 * GitHub computed for it.
 *
 * At most one check every six hours, at start-up. A newer tag asks the user.
 * "Update" downloads the APK into the cache, checks its SHA-256, its package
 * name and that its versionCode is higher, and hands it to the system
 * installer, which asks again. Android itself refuses an APK signed with
 * another key, so the signature check is the platform's.
 *
 * What a check sends: one HTTPS request to api.github.com. Nothing about any file.
 */
final class AnrUpdate {

    private static final String PREFS = "anr-update";
    private static final long EVERY_MS = 6L * 60 * 60 * 1000;
    /** The API answer carries the release notes and every asset. */
    private static final int FEED_MAX = 512 * 1024;
    private static final String APK_NAME = "Analyser-android.apk";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final Pattern DIGEST = Pattern.compile("^sha256:([0-9a-f]{64})$");
    private static final ExecutorService NET = Executors.newSingleThreadExecutor();
    /** True while a check or a download runs, so two can never overlap. */
    private static final AtomicBoolean BUSY = new AtomicBoolean(false);

    private interface Progress {
        void at(int permille);
    }

    private AnrUpdate() {}

    /** Called from MainActivity.onCreate. Returns at once: the work runs on NET. */
    static void maybeCheck(Activity activity) {
        String feed = BuildConfig.UPDATE_FEED;
        if (feed == null || feed.isEmpty() || !BUSY.compareAndSet(false, true)) return;
        Context app = activity.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        NET.execute(() -> {
            try {
                // The installer copied the last update when it ran, so the file is spare now.
                deleteQuietly(apkFile(app));
                if (System.currentTimeMillis() - prefs.getLong("checked", 0) < EVERY_MS) return;
                HttpURLConnection c = open(feed, "application/vnd.github+json");
                JSONObject release;
                try {
                    release = new JSONObject(AnrShell.readAll(c.getInputStream(), FEED_MAX));
                } finally {
                    c.disconnect();
                }
                prefs.edit().putLong("checked", System.currentTimeMillis()).apply();
                String version = release.optString("tag_name", "").replaceFirst("^v", "");
                JSONObject apk = asset(release, APK_NAME);
                if (apk == null || !newer(version, installedName(app))) return;
                activity.runOnUiThread(() -> offer(activity, version, apk));
            } catch (Exception e) {
                // Offline, or GitHub did not answer. The next start tries again.
            } finally {
                BUSY.set(false);
            }
        });
    }

    /** True when version `a` is newer than `b`, compared number by number:
     *  "9.10.0" is newer than "9.9", and "9.1.0" is the same as "9.1". */
    static boolean newer(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? number(x[i]) : 0;
            int q = i < y.length ? number(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private static int number(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static JSONObject asset(JSONObject release, String name) {
        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) return null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject a = assets.optJSONObject(i);
            if (a != null && name.equals(a.optString("name"))) return a;
        }
        return null;
    }

    private static void offer(Activity activity, String version, JSONObject apk) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        long size = apk.optLong("size", 0);
        String mb = size > 0 ? String.format(Locale.ROOT, " (%d MB)", Math.round(size / 1048576.0)) : "";
        new AlertDialog.Builder(activity)
            .setTitle("Analyser " + version.replaceFirst("\\.0$", "") + " is out")
            .setMessage("Download the update now" + mb + "? Android asks you to confirm the install. Your settings and offline downloads stay.")
            .setPositiveButton("Update", (d, w) -> download(activity, apk))
            .setNegativeButton("Later", null)
            .show();
    }

    private static void download(Activity activity, JSONObject apk) {
        final String url = apk.optString("browser_download_url", "");
        Matcher digest = DIGEST.matcher(apk.optString("digest", ""));
        // No digest, no install: the hash is what ties the file to the release.
        if (!url.startsWith("https://") || !digest.matches() || !BUSY.compareAndSet(false, true)) return;
        final String sha = digest.group(1);

        ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(1000);
        int pad = Math.round(24 * activity.getResources().getDisplayMetrics().density);
        FrameLayout box = new FrameLayout(activity);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(bar);
        AtomicBoolean cancelled = new AtomicBoolean(false);
        AlertDialog dialog = new AlertDialog.Builder(activity)
            .setTitle("Downloading the update")
            .setView(box)
            .setCancelable(false)
            .setNegativeButton("Cancel", (d, w) -> cancelled.set(true))
            .show();

        Context app = activity.getApplicationContext();
        NET.execute(() -> {
            File file = apkFile(app);
            boolean ok = false;
            try {
                save(url, file, sha, cancelled, (permille) -> activity.runOnUiThread(() -> bar.setProgress(permille)));
                verify(app, file);
                ok = true;
            } catch (Exception e) {
                deleteQuietly(file);
            } finally {
                BUSY.set(false);
            }
            final boolean done = ok;
            activity.runOnUiThread(() -> {
                try {
                    dialog.dismiss();
                } catch (RuntimeException ignored) {
                    /* the activity went away while the download ran */
                }
                if (cancelled.get() || activity.isFinishing() || activity.isDestroyed()) return;
                if (done) install(activity, file);
                else Toast.makeText(activity, "The update did not download. Analyser tries again later.", Toast.LENGTH_LONG).show();
            });
        });
    }

    /** Stream the APK to `file`, hashing as it goes. Throws on a cancel or a bad hash. */
    private static void save(String url, File file, String sha, AtomicBoolean cancelled, Progress progress) throws Exception {
        File dir = file.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("no cache folder");
        HttpURLConnection c = open(url, null);
        try {
            long total = c.getContentLengthLong();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                byte[] buf = new byte[1 << 16];
                long got = 0;
                int last = -1;
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (cancelled.get()) throw new IOException("cancelled");
                    out.write(buf, 0, n);
                    digest.update(buf, 0, n);
                    got += n;
                    int permille = total > 0 ? (int) Math.min(1000, got * 1000 / total) : 0;
                    if (permille != last) {
                        last = permille;
                        progress.at(permille);
                    }
                }
            }
            if (!hex(digest.digest()).equals(sha)) throw new IOException("the download does not match its checksum");
        } finally {
            c.disconnect();
        }
    }

    /** The file must be Analyser, and newer than the copy that is installed. */
    private static void verify(Context app, File file) throws IOException {
        PackageInfo p = app.getPackageManager().getPackageArchiveInfo(file.getPath(), 0);
        if (p == null || !app.getPackageName().equals(p.packageName)) throw new IOException("not an Analyser package");
        if (versionCode(p) <= installedCode(app)) throw new IOException("not newer than the installed copy");
    }

    private static void install(Activity activity, File file) {
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_MIME).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activity.startActivity(intent);
        } catch (RuntimeException e) {
            Toast.makeText(activity, "Android could not open its installer.", Toast.LENGTH_LONG).show();
        }
    }

    /** `accept` is set for the API only: the download URL wants no special type. */
    private static HttpURLConnection open(String url, String accept) throws IOException {
        URL u = new URL(url);
        if (!"https".equals(u.getProtocol())) throw new IOException("not https");
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        // github.com answers a release download with a redirect to its asset host.
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Cache-Control", "no-cache");
        c.setRequestProperty("User-Agent", "Analyser-Android");
        if (accept != null) c.setRequestProperty("Accept", accept);
        int status = c.getResponseCode();
        if (status != HttpURLConnection.HTTP_OK) {
            c.disconnect();
            throw new IOException("HTTP " + status);
        }
        return c;
    }

    private static String installedName(Context app) {
        try {
            String v = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
            return v == null ? "" : v;
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }

    private static long installedCode(Context app) {
        try {
            return versionCode(app.getPackageManager().getPackageInfo(app.getPackageName(), 0));
        } catch (PackageManager.NameNotFoundException e) {
            return Long.MAX_VALUE; // our own package always exists; never install on a surprise
        }
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo p) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? p.getLongVersionCode() : p.versionCode;
    }

    private static File apkFile(Context app) {
        return new File(new File(app.getCacheDir(), "update"), "Analyser.apk");
    }

    private static String hex(byte[] bytes) {
        StringBuilder s = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) s.append(String.format(Locale.ROOT, "%02x", b));
        return s.toString();
    }

    private static void deleteQuietly(File f) {
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
