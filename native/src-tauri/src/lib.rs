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
        use tauri::Emitter;
        use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
        if let Some(update) = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
        {
            // Stream real download progress to the frontend so it can show a
            // progress bar. on_chunk is a Fn, so the running total lives in an
            // atomic; each chunk emits (bytesSoFar, contentLengthOrNull) and the
            // finish callback flips the UI to the brief "installing" phase.
            let downloaded = Arc::new(AtomicU64::new(0));
            let progress_app = app.clone();
            let progress_acc = downloaded.clone();
            let finish_app = app.clone();
            update
                .download_and_install(
                    move |chunk, total| {
                        let done = progress_acc.fetch_add(chunk as u64, Ordering::Relaxed) + chunk as u64;
                        let _ = progress_app.emit("update://progress", (done, total));
                    },
                    move || {
                        let _ = finish_app.emit("update://finished", ());
                    },
                )
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

// Read a file off disk and return its raw bytes to the frontend. Used by the
// native drag-drop path: WebView2 delivers OS file drops as paths (not File
// objects), so the JS reads them back through here and rebuilds File objects for
// the normal analysis pipeline. Returns an efficient raw byte Response (an
// ArrayBuffer on the JS side) - not a JSON number array - so large files (audio,
// video, disk images) don't balloon crossing the IPC bridge.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
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
        .invoke_handler(tauri::generate_handler![check_for_update, install_update, read_file_bytes])
        .run(tauri::generate_context!())
        .expect("error while running the Analyser shell");
}
