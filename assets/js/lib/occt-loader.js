/* Analyser - OpenCASCADE (occt-import-js) loader
   Lazy-loads the OpenCASCADE WASM kernel from a CDN the first time a STEP/IGES
   file is opened, then caches it (the service worker keeps it for offline use,
   like the ffmpeg core). occt-import-js tessellates B-rep CAD geometry (NURBS
   surfaces, solids) into triangle meshes the WebGL viewer can draw. */

import { loadScript } from '../core/util.js';

const OCCT_VERSION = '0.0.23';
const OCCT_BASE = `https://cdn.jsdelivr.net/npm/occt-import-js@${OCCT_VERSION}/dist/`;

let _occtPromise = null;

// Resolve to the initialised occt module (memoised). The UMD script defines a
// global `occtimportjs` factory; calling it (with locateFile pointing the loader
// at the CDN .wasm) returns a promise for the ready module.
export function loadOcct() {
  if (_occtPromise) return _occtPromise;
  _occtPromise = (async () => {
    await loadScript(OCCT_BASE + 'occt-import-js.js');
    const factory = (typeof self !== 'undefined' && self.occtimportjs) || window.occtimportjs;
    if (typeof factory !== 'function') throw new Error('occt-import-js failed to load');
    return factory({ locateFile: (path) => OCCT_BASE + path });
  })();
  // Don't cache a failed load - let the next open retry.
  _occtPromise.catch(() => { _occtPromise = null; });
  return _occtPromise;
}
