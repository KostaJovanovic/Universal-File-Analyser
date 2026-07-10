// Analyser - native shell (Tauri 2).
//
// Intentionally near-empty. The entire application is the existing web frontend
// (HTML/CSS/ES-module JS + lazy WASM) served from ../dist - the same source that
// deploys to the website. We are not rewriting anything in Rust to ship v1; the
// spike proved the WASM stack runs under the OS webview.
//
// The only Rust logic here is the auto-updater bridge: two commands the frontend
// (assets/js/core/native-update.js) calls to check GitHub Releases and, once the
// user confirms, download + install + relaunch. Everything else - clean-URL
// navigation, disabling the service worker - is handled JS-side, gated on
// window.__TAURI__. Native superpowers come later (research/NATIVE-APP-PLAN.md 7/7b).

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

// Check GitHub Releases for a newer version. Returns Some(info) when one exists,
// None when already current. Desktop-only: the updater plugin has no mobile build.
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let update = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?;
        Ok(update.map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() }))
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(None)
    }
}

// Download + install the pending update, then relaunch. The frontend calls this
// only after the user confirms in the update prompt.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_updater::UpdaterExt;
        if let Some(update) = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
        {
            update
                .download_and_install(|_chunk, _total| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            app.restart();
        }
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .invoke_handler(tauri::generate_handler![check_for_update, install_update])
        .run(tauri::generate_context!())
        .expect("error while running the Analyser shell");
}
