/* Analyser - libopenmpt loader and offline renderer.

   Tracker modules (MOD, XM, IT, S3M and ~60 relatives) are not sampled audio -
   they are a list of samples plus a pattern score telling a playback engine when
   to trigger them. Nothing decodes that but a tracker engine, so this wraps
   libopenmpt (the OpenMPT project's, compiled to WASM) and renders the song
   OFFLINE into PCM. That is deliberate: once it is a buffer, the whole existing
   audio stack - waveform, spectrogram, player, loudness, key and BPM - works on
   a .mod exactly as it does on a WAV, instead of needing a parallel player.

   The vendored file is chiptune3's `libopenmpt.worklet.js`, renamed. Despite the
   name it registers no AudioWorkletProcessor: it is a plain ES module exporting
   an Emscripten factory, so it runs on the main thread. MIT wrapper around the
   BSD-licensed libopenmpt; see assets/vendor/libopenmpt-LICENSE.txt.

   Loaded on demand and cached - it is ~1.5 MB, so it must never be part of the
   initial module graph. */
import { TRACKER_RENDER_MAX, TRACKER_SAMPLE_RATE } from '../core/limits.js';
let modPromise = null;
/** Load (once) and return the libopenmpt WASM module. */
export function loadOpenMpt() {
    if (!modPromise) {
        modPromise = import('/assets/vendor/libopenmpt.js')
            .then((m) => (m.default ? m.default() : m()))
            .catch((e) => { modPromise = null; throw e; });
    }
    return modPromise;
}
// Read one libopenmpt string and free it - the C API hands back an allocation
// the caller owns, so skipping the free leaks on every field of every file.
function mptString(mod, ptr) {
    if (!ptr)
        return '';
    const s = mod.UTF8ToString(ptr);
    mod._openmpt_free_string(ptr);
    return s;
}
function metadata(mod, m, key) {
    const kp = mod._malloc(key.length + 1);
    for (let i = 0; i < key.length; i++)
        mod.HEAPU8[kp + i] = key.charCodeAt(i);
    mod.HEAPU8[kp + key.length] = 0;
    const out = mptString(mod, mod._openmpt_module_get_metadata(m, kp));
    mod._free(kp);
    return out;
}
/** Decode a tracker module: read its metadata, then render the whole song to
    PCM. Returns null if libopenmpt cannot open the bytes as a module. */
export async function renderTracker(bytes) {
    const mod = await loadOpenMpt();
    const filePtr = mod._malloc(bytes.length);
    if (!filePtr)
        return null;
    mod.HEAPU8.set(bytes, filePtr);
    const m = mod._openmpt_module_create_from_memory(filePtr, bytes.length, 0, 0, 0);
    mod._free(filePtr);
    if (!m)
        return null;
    try {
        const info = {
            title: metadata(mod, m, 'title'),
            artist: metadata(mod, m, 'artist'),
            tracker: metadata(mod, m, 'tracker'),
            type: metadata(mod, m, 'type'),
            typeLong: metadata(mod, m, 'type_long'),
            message: metadata(mod, m, 'message'),
            durationSec: mod._openmpt_module_get_duration_seconds(m),
            channels: mod._openmpt_module_get_num_channels(m),
            patterns: mod._openmpt_module_get_num_patterns(m),
            orders: mod._openmpt_module_get_num_orders(m),
            instruments: [],
            samples: [],
        };
        // Sample and instrument names are where tracker authors traditionally left
        // greetings and credits, so they are worth surfacing rather than counting.
        const nInst = mod._openmpt_module_get_num_instruments(m);
        for (let i = 0; i < nInst && i < 256; i++) {
            info.instruments.push(mptString(mod, mod._openmpt_module_get_instrument_name(m, i)));
        }
        const nSamp = mod._openmpt_module_get_num_samples(m);
        for (let i = 0; i < nSamp && i < 256; i++) {
            info.samples.push(mptString(mod, mod._openmpt_module_get_sample_name(m, i)));
        }
        const rate = TRACKER_SAMPLE_RATE;
        const maxFrames = Math.floor(TRACKER_RENDER_MAX * rate);
        // Duration can be reported as 0 or infinite for a module that loops forever;
        // the cap is what actually bounds the render in that case.
        const want = info.durationSec > 0 && isFinite(info.durationSec)
            ? Math.min(maxFrames, Math.ceil(info.durationSec * rate) + rate)
            : maxFrames;
        const CHUNK = 4096;
        const lPtr = mod._malloc(CHUNK * 4);
        const rPtr = mod._malloc(CHUNK * 4);
        const left = new Float32Array(want);
        const right = new Float32Array(want);
        let written = 0;
        try {
            for (;;) {
                if (written >= want)
                    break;
                const n = mod._openmpt_module_read_float_stereo(m, rate, Math.min(CHUNK, want - written), lPtr, rPtr);
                if (n <= 0)
                    break; // song finished
                // HEAPF32 is re-created if the heap grows, so index it fresh each pass.
                const lo = lPtr >> 2, ro = rPtr >> 2;
                left.set(mod.HEAPF32.subarray(lo, lo + n), written);
                right.set(mod.HEAPF32.subarray(ro, ro + n), written);
                written += n;
            }
        }
        finally {
            mod._free(lPtr);
            mod._free(rPtr);
        }
        if (!written)
            return null;
        return {
            info,
            left: left.subarray(0, written),
            right: right.subarray(0, written),
            sampleRate: rate,
            truncated: written >= maxFrames,
        };
    }
    finally {
        mod._openmpt_module_destroy(m);
    }
}
//# sourceMappingURL=openmpt-loader.js.map