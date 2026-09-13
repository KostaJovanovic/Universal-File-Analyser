package com.valjdakosta.analyser;

import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.ColorUtils;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

/**
 * The one activity. On top of Capacitor's BridgeActivity it does three things:
 *
 *  - registers the two plugins (AnrShell, AnrFfmpeg),
 *  - owns the status-bar and gesture-bar insets, NATIVELY: the WebView's parent
 *    is padded, so the page gets an ordinary viewport and analyser.css needs no
 *    shell offsets. That is the desktop title bar's lesson (desktop/README.md,
 *    "Window chrome"): a CSS offset for the shell means the split is wrong.
 *    capacitor.config.json sets SystemBars.insetsHandling to 'disable' so
 *    Capacitor's own CSS-variable handling stays out of the way;
 *  - hands "Open with" / "Share to" intents and the back button to the page,
 *  - starts the update check (AnrUpdate), which only a release build runs.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate(): the bridge is built there, and a plugin
        // registered afterwards is never loaded.
        registerPlugin(AnrShell.class);
        registerPlugin(AnrFfmpeg.class);
        super.onCreate(savedInstanceState);
        setUpInsets();
        applyFullscreen(getResources().getConfiguration());
        setUpBack();
        // Returns at once. Does nothing unless the build has an update feed.
        AnrUpdate.maybeCheck(this);
    }

    /** Also runs for the launch intent: BridgeActivity.load() calls it once. */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        AnrShell shell = shell();
        // Swap the handled intent out, so a later restore does not open it twice.
        if (shell != null && shell.deliver(intent)) setIntent(new Intent(Intent.ACTION_MAIN));
    }

    private AnrShell shell() {
        if (bridge == null) return null;
        PluginHandle handle = bridge.getPlugin("AnrShell");
        return handle == null ? null : (AnrShell) handle.getInstance();
    }

    // ---- insets and the bar colour -----------------------------------------

    private void setUpInsets() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= 28) {
            // Draw beside the camera in landscape too, so the strip that keeps
            // text clear of it takes the page colour, not the system's black.
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT < 35) {
            // Android 15+ draws transparent bars itself; older versions need telling.
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
        }
        // Follow the system theme until the page reports its own background.
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        setBarColor(night ? Color.BLACK : Color.WHITE);

        View decor = window.getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            int bars = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets sys = insets.getInsets(bars);
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
            v.setPadding(sys.left, sys.top, sys.right, keyboard ? Math.max(ime.bottom, sys.bottom) : sys.bottom);
            // Not WindowInsetsCompat.CONSUMED: Capacitor's SystemBars notes that
            // it breaks the WebView's own inset recalculation (Chromium 461332423).
            return new WindowInsetsCompat.Builder(insets).setInsets(bars, Insets.NONE).build();
        });
    }

    /** The manifest handles orientation changes itself (configChanges), so the
     *  activity lives on and this is where a turn of the phone lands. */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyFullscreen(newConfig);
    }

    /** Coming back from another app can bring the bars back. */
    @Override
    public void onResume() {
        super.onResume();
        applyFullscreen(getResources().getConfiguration());
    }

    /** Landscape is true fullscreen: the status bar and the gesture bar hide,
     *  and a swipe in from the edge shows them for a moment. Portrait keeps
     *  them, in the page colour. Hidden bars report zero insets, so the padding
     *  above shrinks to the camera cutout alone - text never sits under the
     *  camera, and the page fills the rest of the screen. */
    private void applyFullscreen(Configuration config) {
        Window window = getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (config.orientation == Configuration.ORIENTATION_LANDSCAPE) {
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    /** The padded bands show the decor view's background, so it takes the
     *  page's own background colour (reported by the bridge on every theme
     *  change), and the bar icons flip to stay readable on it. */
    void setBarColor(int color) {
        runOnUiThread(() -> {
            Window window = getWindow();
            View decor = window.getDecorView();
            decor.setBackgroundColor(color);
            boolean light = ColorUtils.calculateLuminance(color) > 0.5;
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
            controller.setAppearanceLightStatusBars(light);
            controller.setAppearanceLightNavigationBars(light);
        });
    }

    // ---- the back button -----------------------------------------------------

    /** The page decides first (window.__anrBack in the bridge): one drill-down
     *  level, then page history. Only when it has nothing left does the app go
     *  to the background - not finish, so the analysis is still there. */
    private void setUpBack() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge == null || bridge.getWebView() == null) {
                    moveTaskToBack(true);
                    return;
                }
                bridge.getWebView().evaluateJavascript(
                    "(function(){try{return window.__anrBack?window.__anrBack():'exit'}catch(e){return 'exit'}})()",
                    (value) -> {
                        if (value == null || !value.contains("handled")) moveTaskToBack(true);
                    }
                );
            }
        });
    }
}
