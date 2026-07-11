/* Analyser - native (Tauri) file drag-and-drop.

   WebView2 does not deliver OS file drops to the page's HTML5 `drop` event with
   usable File objects, so the web drop pipeline never sees the file in the shell.
   Instead we listen to Tauri's own drag-drop event (which yields absolute file
   paths), read the bytes through the read_file_bytes command (an efficient raw
   Response, not a JSON number array), rebuild a File object, and hand it to the
   very same entry point the web drop uses (window._anrHandleFile).

   Loaded only under the shell - app.js gates the import on window.__TAURI__. */

function core() { return (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core) || null; }

function basename(p) {
  const parts = String(p).split(/[\\/]+/);
  return parts[parts.length - 1] || String(p);
}

async function fileFromPath(path) {
  const buf = await core().invoke('read_file_bytes', { path }); // ArrayBuffer
  return new File([buf], basename(path));
}

let _inited = false;
export function initNativeDrop() {
  if (_inited) return;
  const ev = window.__TAURI__ && window.__TAURI__.event;
  if (!ev || typeof ev.listen !== 'function' || !core()) return;
  _inited = true;
  ev.listen('tauri://drag-drop', async (e) => {
    const paths = (e && e.payload && e.payload.paths) || [];
    if (!paths.length) return;
    try {
      // Analyse the first dropped file (the app is single-file; folders and
      // multi-file drops still go through the picker for now).
      const file = await fileFromPath(paths[0]);
      if (typeof window._anrHandleFile === 'function') await window._anrHandleFile(file);
    } catch (err) {
      console.warn('Native drop failed:', err);
    }
  });
}
