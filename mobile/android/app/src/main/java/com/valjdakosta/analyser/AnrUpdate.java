package com.valjdakosta.analyser;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.IntentCompat;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
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
 * file in the release: the answer gives the tag (v9.9.0), and for the asset
 * named Analyser-android-<version>.apk its download URL, its size and the
 * SHA-256 digest GitHub computed for it.
 *
 * At most one check every six hours, at start-up. A newer tag does not
 * interrupt: it puts a green Update chip in the page header, where the website
 * has its Get App chip (core/popups.ts, via AnrShell's "update" event). The
 * offer is kept in the preferences, so the chip comes back on every start until
 * the update is installed or a later check finds none. A tap on the chip asks
 * once more (the size, and that Analyser closes), and "Update" downloads the
 * APK into the cache, checks its SHA-256, its package
 * name and that its versionCode is higher, and writes it into a
 * PackageInstaller session. On Android 12 and later the session asks for no
 * confirm screen (USER_ACTION_NOT_REQUIRED), which Android grants to an app
 * that updates itself: the update installs and Analyser closes. Where Android
 * still wants a yes - an older version, or a case it does not allow - the
 * session reports that, and InstallStatus opens the confirm screen. Android
 * itself refuses an APK signed with another key, so the signature check is
 * the platform's. Play Protect can still scan the new APK either way.
 *
 * The download must start at github.com and every redirect must stay on a
 * GitHub asset host (ASSET_HOSTS); it stops the moment it runs past the size
 * the release gives. The footer button checks at most once a minute.
 *
 * What a check sends: one HTTPS request to api.github.com. Nothing about any file.
 */
// Public, because Android creates the nested InstallStatus receiver by name.
public final class AnrUpdate {

    private static final String PREFS = "anr-update";
    private static final long EVERY_MS = 6L * 60 * 60 * 1000;
    /** The API answer carries the release notes and every asset. */
    private static final int FEED_MAX = 512 * 1024;
    /** The APK's name ends in the version (Analyser-android-9.9.0.apk), so it is
     *  found by the part before it. The unversioned name of 9.8 and earlier
     *  still matches. */
    private static final Pattern APK_NAME = Pattern.compile("^Analyser-android(-\\d+(\\.\\d+)*)?\\.apk$");
    private static final Pattern DIGEST = Pattern.compile("^sha256:([0-9a-f]{64})$");
    private static final ExecutorService NET = Executors.newSingleThreadExecutor();
    /** True while a check or a download runs, so two can never overlap. */
    private static final AtomicBoolean BUSY = new AtomicBoolean(false);
    /** The footer button, at most once a minute (checkNow). */
    private static final long MANUAL_EVERY_MS = 60L * 1000;
    private static long lastManual;
    /** The download starts at github.com, which redirects to its asset host.
     *  Every hop must stay on these. */
    private static final String DOWNLOAD_HOST = "github.com";
    private static final Set<String> ASSET_HOSTS = new HashSet<>(
        Arrays.asList("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
    );

    private interface Progress {
        void at(int permille);
    }

    /** Hears the version on offer: a newer one, or "" when there is none. */
    interface Listener {
        void offered(String version);
    }

    /** The newer release the last check found, and its APK asset. */
    private static volatile String offerVersion = "";
    private static volatile JSONObject offerApk;
    private static volatile Listener listener;

    private AnrUpdate() {}

    /** AnrShell passes the page's side here, and hears the current offer at once. */
    static void setListener(Listener l) {
        listener = l;
        if (l != null && !offerVersion.isEmpty()) l.offered(offerVersion);
    }

    /** The version on offer, or "" - for a page that asks after the event. */
    static String offeredVersion() {
        return offerVersion;
    }

    /** The page's Update chip was tapped: ask, then download and install. */
    static void offerPending(Activity activity) {
        JSONObject apk = offerApk;
        String version = offerVersion;
        if (apk == null || version.isEmpty()) return;
        activity.runOnUiThread(() -> offer(activity, version, apk));
    }

    private static void announce() {
        Listener l = listener;
        if (l != null) l.offered(offerVersion);
    }

    private static void setOffer(SharedPreferences prefs, String version, JSONObject apk) {
        offerVersion = version;
        offerApk = apk;
        prefs.edit().putString("offerVersion", version).putString("offerApk", apk.toString()).apply();
        announce();
    }

    private static void clearOffer(SharedPreferences prefs) {
        boolean had = !offerVersion.isEmpty();
        offerVersion = "";
        offerApk = null;
        prefs.edit().remove("offerVersion").remove("offerApk").apply();
        if (had) announce();
    }

    /** Between checks, show what the last one found - unless it is installed now. */
    private static void restoreOffer(Context app, SharedPreferences prefs) {
        String version = prefs.getString("offerVersion", "");
        String json = prefs.getString("offerApk", "");
        if (version == null || version.isEmpty() || json == null || json.isEmpty() || !newer(version, installedName(app))) {
            clearOffer(prefs);
            return;
        }
        try {
            offerVersion = version;
            offerApk = new JSONObject(json);
            announce();
        } catch (Exception e) {
            clearOffer(prefs);
        }
    }

    /** Called from MainActivity.onCreate. Returns at once: the work runs on NET. */
    static void maybeCheck(Activity activity) {
        check(activity, false);
    }

    /** The footer's "Check for updates" (AnrShell.checkUpdates): no six-hour
     *  wait, and it always answers - the update dialog, or a short message. */
    static void checkNow(Activity activity) {
        // The page can call this as often as it likes (an XSS included); GitHub
        // rate-limits unauthenticated API calls per address, so one a minute.
        long now = SystemClock.elapsedRealtime();
        synchronized (AnrUpdate.class) {
            if (lastManual != 0 && now - lastManual < MANUAL_EVERY_MS) {
                toast(activity, "Analyser checked for an update a moment ago. Try again in a minute.");
                return;
            }
            lastManual = now;
        }
        check(activity, true);
    }

    private static void check(Activity activity, boolean manual) {
        String feed = BuildConfig.UPDATE_FEED;
        if (feed == null || feed.isEmpty()) {
            if (manual) toast(activity, "Updates are off in this build of Analyser.");
            return;
        }
        if (!BUSY.compareAndSet(false, true)) {
            if (manual) toast(activity, "Analyser is already checking for an update.");
            return;
        }
        Context app = activity.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        NET.execute(() -> {
            try {
                // The installer copied the last update when it ran, so the file is spare now.
                deleteQuietly(apkFile(app));
                if (!manual && System.currentTimeMillis() - prefs.getLong("checked", 0) < EVERY_MS) {
                    restoreOffer(app, prefs);
                    return;
                }
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
                if (apk == null || !newer(version, installedName(app))) {
                    clearOffer(prefs);
                    if (manual) toast(activity, "Analyser is up to date.");
                    return;
                }
                // The chip in the page header. Only the footer's check, which
                // asked a question, gets the answer as a dialog too.
                setOffer(prefs, version, apk);
                if (manual) activity.runOnUiThread(() -> offer(activity, version, apk));
            } catch (Exception e) {
                // Offline, or GitHub did not answer. The next start tries again,
                // and meanwhile the chip shows what the last check found.
                restoreOffer(app, prefs);
                if (manual) toast(activity, "Analyser could not reach GitHub. Check the connection, then try again.");
            } finally {
                BUSY.set(false);
            }
        });
    }

    private static void toast(Activity activity, String text) {
        activity.runOnUiThread(() -> {
            if (!activity.isFinishing() && !activity.isDestroyed()) Toast.makeText(activity, text, Toast.LENGTH_LONG).show();
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

    private static JSONObject asset(JSONObject release, Pattern name) {
        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) return null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject a = assets.optJSONObject(i);
            if (a != null && name.matcher(a.optString("name")).matches()) return a;
        }
        return null;
    }

    private static void offer(Activity activity, String version, JSONObject apk) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        long size = apk.optLong("size", 0);
        String mb = size > 0 ? String.format(Locale.ROOT, " (%d MB)", Math.round(size / 1048576.0)) : "";
        new AlertDialog.Builder(activity)
            .setTitle("Analyser " + version.replaceFirst("\\.0$", "") + " is out")
            .setMessage("Download and install the update now" + mb + "? Analyser closes while it installs, and Android may ask you to confirm. Your settings and offline downloads stay.")
            .setPositiveButton("Update", (d, w) -> download(activity, apk))
            .setNegativeButton("Later", null)
            .show();
    }

    private static void download(Activity activity, JSONObject apk) {
        final String url = apk.optString("browser_download_url", "");
        final long size = apk.optLong("size", 0);
        Matcher digest = DIGEST.matcher(apk.optString("digest", ""));
        // No digest, no install: the hash is what ties the file to the release.
        // The URL must be a github.com release download, and the size is known,
        // so a download that runs past it stops there instead of filling the cache.
        if (!onHost(url, DOWNLOAD_HOST) || size <= 0 || !digest.matches() || !BUSY.compareAndSet(false, true)) return;
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
            String failed = null;
            try {
                save(url, size, file, sha, cancelled, (permille) -> activity.runOnUiThread(() -> bar.setProgress(permille)));
                verify(app, file);
            } catch (Exception e) {
                failed = "The update did not download. Analyser tries again later.";
            }
            if (failed == null && !cancelled.get()) {
                try {
                    install(app, file);
                } catch (Exception e) {
                    failed = "Android did not take the update. Analyser tries again later.";
                }
            }
            // The session holds its own copy once written, so the cached file is spare.
            deleteQuietly(file);
            BUSY.set(false);
            final String message = failed;
            activity.runOnUiThread(() -> {
                try {
                    dialog.dismiss();
                } catch (RuntimeException ignored) {
                    /* the activity went away while the download ran */
                }
                if (message == null || cancelled.get() || activity.isFinishing() || activity.isDestroyed()) return;
                Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
            });
        });
    }

    /** Stream the APK to `file`, hashing as it goes. Throws on a cancel, a bad
     *  hash, or more bytes than the release says the asset has. */
    private static void save(String url, long size, File file, String sha, AtomicBoolean cancelled, Progress progress) throws Exception {
        File dir = file.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("no cache folder");
        HttpURLConnection c = openDownload(url);
        try {
            long total = size;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                byte[] buf = new byte[1 << 16];
                long got = 0;
                int last = -1;
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (cancelled.get()) throw new IOException("cancelled");
                    if (got + n > size) throw new IOException("the download is larger than the release says");
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

    /** Write the verified APK into a PackageInstaller session and commit it.
     *  Runs on NET: the copy is tens of MB. Android reports the result to
     *  InstallStatus - see the header for which versions ask first. */
    private static void install(Context app, File file) throws IOException {
        PackageInstaller installer = app.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(app.getPackageName());
        params.setSize(file.length());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        int id = installer.createSession(params);
        try {
            try (PackageInstaller.Session session = installer.openSession(id)) {
                try (InputStream in = new FileInputStream(file); OutputStream out = session.openWrite("Analyser.apk", 0, file.length())) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                // Mutable on Android 12 and later: Android writes the status into it.
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent done = PendingIntent.getBroadcast(app, id, new Intent(app, InstallStatus.class), flags);
                session.commit(done.getIntentSender());
            }
        } catch (IOException | RuntimeException e) {
            installer.abandonSession(id);
            throw e;
        }
    }

    /**
     * Where Android reports on the install session. Declared in the manifest
     * and not exported, so only the PendingIntent above reaches it.
     *
     * STATUS_PENDING_USER_ACTION means Android wants a yes first. Its confirm
     * screen comes in EXTRA_INTENT, and the app is on screen at that moment
     * (the user just watched the download), so it may start it. On success
     * Android stops the app to replace it, so there is nothing to do.
     */
    public static final class InstallStatus extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent.class);
                if (confirm == null) return;
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirm);
                } catch (RuntimeException e) {
                    Toast.makeText(context, "Android could not open its installer.", Toast.LENGTH_LONG).show();
                }
            } else if (status != PackageInstaller.STATUS_SUCCESS && status != PackageInstaller.STATUS_FAILURE_ABORTED) {
                // ABORTED is the user saying no on the confirm screen: no message.
                Toast.makeText(context, "Android did not install the update. Analyser tries again later.", Toast.LENGTH_LONG).show();
            }
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

    /** The release download, following its redirects by hand so that EVERY hop
     *  is checked: https, and a GitHub host (ASSET_HOSTS). */
    private static HttpURLConnection openDownload(String url) throws IOException {
        String at = url;
        for (int hop = 0; hop < 5; hop++) {
            if (!onAssetHost(at)) throw new IOException("the download left GitHub");
            HttpURLConnection c = (HttpURLConnection) new URL(at).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("Cache-Control", "no-cache");
            c.setRequestProperty("User-Agent", "Analyser-Android");
            int status = c.getResponseCode();
            if (status == HttpURLConnection.HTTP_OK) return c;
            String next = c.getHeaderField("Location");
            c.disconnect();
            if (status < 300 || status > 399 || next == null) throw new IOException("HTTP " + status);
            at = new URL(new URL(at), next).toString();
        }
        throw new IOException("too many redirects");
    }

    private static boolean onHost(String url, String host) {
        try {
            URL u = new URL(url);
            return "https".equals(u.getProtocol()) && host.equalsIgnoreCase(u.getHost()) && (u.getPort() == -1 || u.getPort() == 443);
        } catch (IOException e) {
            return false;
        }
    }

    private static boolean onAssetHost(String url) {
        try {
            URL u = new URL(url);
            return "https".equals(u.getProtocol()) && ASSET_HOSTS.contains(u.getHost().toLowerCase(Locale.ROOT)) && (u.getPort() == -1 || u.getPort() == 443);
        } catch (IOException e) {
            return false;
        }
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
