/* Analyser - main-thread client for the forensic audio DSP worker.

   Hands the decoded channel data to audio-dsp-worker.js and relays each pass
   result to onPass() as it arrives, so audio.js can fill its pending rows one
   at a time without ever running a whole-file sweep on the main thread.

   The worker is created lazily and kept alive between analyses (it holds no
   state, so a second file starts instantly).

   Rejects rather than throwing at the caller: audio.js treats ANY rejection
   other than an abort as "run the passes inline instead", so a browser without
   module workers, a blocked worker script, or a file too large to copy all
   degrade to the old behaviour rather than losing the readout. */

// Ceiling on the PCM copy handed to the worker. 256 MB covers roughly twelve
// minutes of 44.1 kHz stereo, so ordinary music and voice notes offload; a
// feature-length recording stays on the inline path rather than putting a
// second copy of a gigabyte-scale buffer in memory.
const MAX_DSP_TRANSFER_BYTES = 256 * 1024 * 1024;

let worker: Worker|null = null;
function getWorker() {
  if (!worker) worker = new Worker(new URL('./audio-dsp-worker.js', import.meta.url), { type: 'module' });
  return worker;
}
// Monotonic id so replies from the shared worker can be matched to their
// request - the compare view analyses two files at once, and without this each
// would consume the other's pass results.
let _jobSeq = 0;

/**
 * True when this audio is small enough to copy across to the worker. The copy
 * is unavoidable: getChannelData() returns live views into the AudioBuffer, so
 * transferring them would detach the buffer and silence playback and the
 * waveform. That means ~2x the PCM resident (main thread + worker) for the
 * length of the analysis, which is fine for a song and reckless for a
 * multi-hour recording - hence the ceiling.
 */
export function canOffloadDsp(audioBuffer: AudioBuffer) {
  const bytes = audioBuffer.numberOfChannels * audioBuffer.length * 4;
  return bytes <= MAX_DSP_TRANSFER_BYTES;
}

/**
 * Run the forensic DSP passes in the worker.
 * @param {AudioBuffer} audioBuffer
 * @param {{ needBpm: boolean, signal?: AbortSignal, onPass: (name: string, value: any) => void }} opts
 * @returns {Promise<void>} resolves when every pass has landed
 */
export function runAudioDsp(audioBuffer: AudioBuffer, { needBpm, signal, onPass }: { needBpm: boolean; signal?: AbortSignal; onPass: (name: string, value: any) => void }) {
  return new Promise<void>((resolve, reject) => {
    let w: Worker;
    try { w = getWorker(); } catch (e) { reject(e); return; }
    const jobId = ++_jobSeq;

    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.jobId !== jobId) return;   // a reply belonging to another job
      if (m.type === 'pass') { try { onPass(m.name, m.value); } catch (_) {} }
      else if (m.type === 'done') { cleanup(); resolve(); }
      else if (m.type === 'error') { cleanup(); reject(new Error(m.message || 'audio DSP failed')); }
    };
    // Fires when the worker script itself fails to load or parse (offline with a
    // stale precache, a CSP block). Tear it down so the next analysis retries
    // cleanly instead of reusing a dead worker.
    const onErr = () => {
      cleanup();
      try { if (worker) { worker.terminate(); worker = null; } } catch (_) {}
      reject(new Error('audio DSP worker failed to start'));
    };
    const onAbort = () => {
      cleanup();
      // Kill the worker so an in-flight sweep actually stops - it holds a full
      // copy of the audio, which we want released now, not at the end of a pass.
      try { if (worker) { worker.terminate(); worker = null; } } catch (_) {}
      reject(new DOMException('audio DSP aborted', 'AbortError'));
    };
    function cleanup() {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort);
    }
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);

    // Copy each channel, then transfer the copies - the main thread releases its
    // half at postMessage, so only one extra PCM copy is ever resident.
    let channels;
    try {
      channels = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c).slice());
    } catch (e) { cleanup(); reject(e); return; }
    w.postMessage(
      { type: 'run', jobId, channels, sampleRate: audioBuffer.sampleRate, needBpm },
      channels.map((c) => c.buffer)
    );
  });
}
