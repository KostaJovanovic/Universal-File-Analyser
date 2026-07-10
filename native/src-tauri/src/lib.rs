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

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

// Paths the OS has dropped onto our window and that the frontend is therefore
// allowed to read back through read_file_bytes. Populated ONLY by the trusted
// drag-drop window event below - never by anything the webview says - and each
// grant is consumed on first read. This is what stops a frontend script (e.g. via
// an XSS in some renderer) from reading arbitrary local files by path: it can only
// read a file the user physically dropped onto the app.
#[derive(Default)]
struct DropAllowlist(Mutex<HashSet<PathBuf>>);

// Safety ceiling for a single read. The app streams whole files into memory (audio,
// video, disk images), so this is generous - it only rejects the absurd.
const MAX_READ_BYTES: u64 = 8 * 1024 * 1024 * 1024;

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
//
// Authorisation: the requested path is canonicalised and must be present in the
// DropAllowlist (a path the OS dropped onto our window). The grant is consumed on
// use, so each drop authorises exactly one read of that file. A path the frontend
// invents - or a symlink resolving outside the dropped set - is rejected. This
// keeps a renderer-injection bug from turning into local-file disclosure.
#[tauri::command]
fn read_file_bytes(
    path: String,
    allow: tauri::State<'_, DropAllowlist>,
) -> Result<tauri::ipc::Response, String> {
    // Canonicalise (resolves symlinks + relative segments) so the check can't be
    // fooled by an alternate spelling of an allowed path, and so a dropped symlink
    // is compared as its real target.
    let requested = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    {
        let mut set = allow.0.lock().map_err(|_| "allowlist lock poisoned".to_string())?;
        if !set.remove(&requested) {
            return Err("path not authorised".into());
        }
    }
    let meta = std::fs::metadata(&requested).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a regular file".into());
    }
    if meta.len() > MAX_READ_BYTES {
        return Err("file too large".into());
    }
    std::fs::read(&requested)
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
        .manage(DropAllowlist::default())
        // Trusted source of authorised paths: the OS drag-drop onto our window.
        // Each new drop supersedes the previous grants (the app analyses one file
        // at a time), so the allowlist only ever holds the current drop's paths.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if let Some(state) = window.try_state::<DropAllowlist>() {
                    if let Ok(mut set) = state.0.lock() {
                        set.clear();
                        for p in paths {
                            if let Ok(canon) = std::fs::canonicalize(p) {
                                set.insert(canon);
                            }
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![check_for_update, install_update, read_file_bytes])
        .run(tauri::generate_context!())
        .expect("error while running the Analyser shell");
}
