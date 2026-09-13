package com.valjdakosta.analyser;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Keeps ffmpeg jobs alive while Analyser is in the background.
 *
 * WHY: a job is a child process of the app (AnrFfmpeg). Once the user switches
 * away, Android may kill a background app at any moment to free memory, and
 * the job dies with it. Android 12 and later also kill a background app's
 * child processes that use a lot of CPU, which a transcode always does. A
 * running foreground service lifts the whole app to foreground importance, so
 * neither happens. The price is a notification, which is where the progress
 * goes.
 *
 * LIFETIME: AnrFfmpeg.run() calls begin() when a job starts and end() when it
 * exits. The service starts with the first job and stops GRACE_MS after the
 * last one. The grace matters: a chain of jobs (the bridge's software retry
 * after a hardware refusal, a two-pass encode) starts its next job from
 * JavaScript, maybe with the app in the background, and Android 12+ refuses to
 * START a foreground service from the background. Kept running across the gap,
 * the service never has to start again.
 *
 * SHORT JOBS: Android 12+ holds back a foreground service's notification for
 * its first ten seconds, so a thumbnail or a quick probe never shows one. Older
 * versions show it at once, so there the service waits START_DELAY_MS first.
 * Those versions also allow a start from the background, so a job the user
 * leaves in that time is still covered.
 *
 * All state lives on the main thread: begin(), progress() and end() post to it.
 */
public final class AnrJobService extends Service {

    private static final String CHANNEL = "jobs";
    private static final int NOTIFICATION_ID = 0x414e;   // also the permission request code
    private static final long GRACE_MS = 10000;
    private static final long START_DELAY_MS = 3000;
    // Android drops a notification that updates more than a few times a second.
    private static final long UPDATE_MS = 1000;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    /** Job key -> progress from 0 to 1, or -1 while the length is unknown. */
    private static final Map<String, Double> JOBS = new LinkedHashMap<>();
    private static final Runnable STOP = AnrJobService::stopIfIdle;
    private static AnrJobService running;
    private static boolean starting;
    private static long lastUpdate;

    // ---- called by AnrFfmpeg ---------------------------------------------------

    static void begin(Context context, String key) {
        Context app = context.getApplicationContext();
        MAIN.post(() -> {
            JOBS.put(key, -1d);
            MAIN.removeCallbacks(STOP);
            if (running != null) {
                running.update(true);
                return;
            }
            if (starting) return;
            starting = true;
            MAIN.postDelayed(() -> start(app), Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? 0 : START_DELAY_MS);
        });
    }

    static void progress(String key, double value) {
        MAIN.post(() -> {
            if (!JOBS.containsKey(key)) return;
            JOBS.put(key, value);
            if (running != null) running.update(false);
        });
    }

    static void end(String key) {
        MAIN.post(() -> {
            JOBS.remove(key);
            if (JOBS.isEmpty()) MAIN.postDelayed(STOP, GRACE_MS);
            if (running != null) running.update(true);
        });
    }

    /** Asks once, at the first job, for the permission Android 13+ needs to
     *  SHOW the notification. The service runs either way. Without it, the job
     *  appears only in the list of active apps at the bottom of the quick
     *  settings panel. */
    static void askForNotifications(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || activity == null) return;
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences prefs = activity.getSharedPreferences("anr-jobs", MODE_PRIVATE);
        if (prefs.getBoolean("asked", false)) return;
        prefs.edit().putBoolean("asked", true).apply();
        activity.runOnUiThread(() ->
            ActivityCompat.requestPermissions(activity, new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_ID)
        );
    }

    private static void start(Context app) {
        if (JOBS.isEmpty() || running != null) {
            starting = false;
            return;
        }
        try {
            ContextCompat.startForegroundService(app, new Intent(app, AnrJobService.class));
        } catch (RuntimeException e) {
            // Android 12+ refuses from the background. The job still runs, only
            // without the protection, exactly as before this service existed.
            starting = false;
        }
    }

    private static void stopIfIdle() {
        AnrJobService s = running;
        if (!JOBS.isEmpty() || s == null) return;
        ServiceCompat.stopForeground(s, ServiceCompat.STOP_FOREGROUND_REMOVE);
        s.stopSelf();
    }

    // ---- the service -------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        starting = false;
        NotificationManagerCompat.from(this).createNotificationChannel(
            new NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
                .setName("Background work")
                .setDescription("Shows the progress of a conversion while Analyser is in the background.")
                .setShowBadge(false)
                .build()
        );
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // mediaProcessing is the type Android 15 made for transcoding. Android 10
        // to 14 do not know it, and dataSync is the closest they have. Older
        // versions have no types at all.
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING;
        else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, build(), type);
        } catch (RuntimeException e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // Every job may have ended while the start was on its way.
        if (JOBS.isEmpty()) {
            MAIN.removeCallbacks(STOP);
            MAIN.post(STOP);
        }
        // Not sticky: after the process dies there is no job left to protect.
        return START_NOT_STICKY;
    }

    /** Android 15+ allows this type six hours a day. At the limit, stop at
     *  once, or Android treats the app as not responding. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /** The user swiped Analyser away. The page that waits for the results is
     *  gone with it, so the jobs have nobody to finish for. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        AnrFfmpeg.stopAll();
        JOBS.clear();
        stopIfIdle();
    }

    @Override
    public void onDestroy() {
        MAIN.removeCallbacks(STOP);
        if (running == this) running = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---- the notification --------------------------------------------------------

    private void update(boolean force) {
        long now = SystemClock.uptimeMillis();
        if (!force && now - lastUpdate < UPDATE_MS) return;
        lastUpdate = now;
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return;
        NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, build());
    }

    private Notification build() {
        int count = JOBS.size();
        boolean known = count > 0;
        double sum = 0;
        for (double p : JOBS.values()) {
            if (p < 0) known = false;
            else sum += p;
        }
        int percent = known ? (int) Math.round(sum / count * 100) : 0;
        String text;
        if (count == 0) text = "Finishing";
        else if (!known) text = count == 1 ? "Working in the background" : count + " jobs, working in the background";
        else text = count == 1 ? percent + "% done" : count + " jobs, " + percent + "% done";

        // A tap brings the app back, as the launcher icon does.
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent open = launch == null
            ? null
            : PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_analyser)
            .setColor(0xFFE60023)
            .setContentTitle("Analyser is working on a file")
            .setContentText(text)
            .setProgress(100, percent, !known)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }
}
