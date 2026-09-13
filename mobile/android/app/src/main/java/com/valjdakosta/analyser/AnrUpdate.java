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
 * The feed is latest-android.json on the latest release:
 *   { "version": "9.1", "versionCode": 306,
 *     "url": ".../Analyser-android.apk", "size": 123, "sha256": "..." }
 *
 * At most one check every six hours, at start-up. A higher versionCode asks the
 * user. "Update" downloads the APK into the cache, checks its SHA-256, its
 * package name and its version, and hands it to the system installer, which
 * asks again. Android itself refuses an APK signed with another key, so the
 * signature check is the platform's.
 *
 * What a check sends: one HTTPS request to github.com. Nothing about any file.
 */
final class AnrUpdate {

    private static final String PREFS = "anr-update";
    private static final long EVERY_MS = 6L * 60 * 60 * 1000;
    private static final int FEED_MAX = 16 * 1024;
    private static final String APK_MIME = "application/vnd.android.package-archive";
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
                HttpURLConnection c = open(feed);
                JSONObject info;
                try {
                    info = new JSONObject(AnrShell.readAll(c.getInputStream(), FEED_MAX));
                } finally {
                    c.disconnect();
                }
                prefs.edit().putLong("checked", System.currentTimeMillis()).apply();
                if (info.optLong("versionCode", 0) <= installedCode(app)) return;
                activity.runOnUiThread(() -> offer(activity, info));
            } catch (Exception e) {
                // Offline, or GitHub did not answer. The next start tries again.
            } finally {
                BUSY.set(false);
            }
        });
    }

    private static void offer(Activity activity, JSONObject info) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        String version = info.optString("version", "");
        long size = info.optLong("size", 0);
        String mb = size > 0 ? String.format(Locale.ROOT, " (%d MB)", Math.round(size / 1048576.0)) : "";
        new AlertDialog.Builder(activity)
            .setTitle("Analyser " + version + " is out")
            .setMessage("Download the update now" + mb + "? Android asks you to confirm the install. Your settings and offline downloads stay.")
            .setPositiveButton("Update", (d, w) -> download(activity, info))
            .setNegativeButton("Later", null)
            .show();
    }

    private static void download(Activity activity, JSONObject info) {
        final String url = info.optString("url", "");
        final String sha = info.optString("sha256", "").toLowerCase(Locale.ROOT);
        final long code = info.optLong("versionCode", 0);
        if (!url.startsWith("https://") || !sha.matches("[0-9a-f]{64}") || !BUSY.compareAndSet(false, true)) return;

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
            File apk = apkFile(app);
            boolean ok = false;
            try {
                save(url, apk, sha, cancelled, (permille) -> activity.runOnUiThread(() -> bar.setProgress(permille)));
                verify(app, apk, code);
                ok = true;
            } catch (Exception e) {
                deleteQuietly(apk);
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
                if (done) install(activity, apk);
                else Toast.makeText(activity, "The update did not download. Analyser tries again later.", Toast.LENGTH_LONG).show();
            });
        });
    }

    /** Stream the APK to `apk`, hashing as it goes. Throws on a cancel or a bad hash. */
    private static void save(String url, File apk, String sha, AtomicBoolean cancelled, Progress progress) throws Exception {
        File dir = apk.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("no cache folder");
        HttpURLConnection c = open(url);
        try {
            long total = c.getContentLengthLong();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
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

    /** The file must be Analyser, at exactly the version the feed named, and newer. */
    private static void verify(Context app, File apk, long code) throws IOException {
        PackageInfo p = app.getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
        if (p == null || !app.getPackageName().equals(p.packageName)) throw new IOException("not an Analyser package");
        long got = versionCode(p);
        if (got != code || got <= installedCode(app)) throw new IOException("unexpected version " + got);
    }

    private static void install(Activity activity, File apk) {
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_MIME).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activity.startActivity(intent);
        } catch (RuntimeException e) {
            Toast.makeText(activity, "Android could not open its installer.", Toast.LENGTH_LONG).show();
        }
    }

    private static HttpURLConnection open(String url) throws IOException {
        URL u = new URL(url);
        if (!"https".equals(u.getProtocol())) throw new IOException("not https");
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        // github.com answers a release download with a redirect to its asset host.
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Cache-Control", "no-cache");
        int status = c.getResponseCode();
        if (status != HttpURLConnection.HTTP_OK) {
            c.disconnect();
            throw new IOException("HTTP " + status);
        }
        return c;
    }

    private static long installedCode(Context app) {
        try {
            return versionCode(app.getPackageManager().getPackageInfo(app.getPackageName(), 0));
        } catch (PackageManager.NameNotFoundException e) {
            return Long.MAX_VALUE; // our own package always exists; never offer on a surprise
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
