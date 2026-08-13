/* Analyser - the forensic DSP pass sequence, as one ordered generator.

   These nine passes are the heavy part of an audio analysis: six of them sweep
   the whole decoded file, and back to back they take the main thread away for
   seconds - long enough that hovering stops repainting and scrolling tears.
   So they normally run in a worker (audio-dsp-worker.js, driven from
   audio-dsp-client.js) and audio.js fills each pending row as its result
   arrives.

   The order matters twice over: `spec` feeds `key`, and each pending row's
   progress bar is scaled by the index of the pass that produces it (see
   pendingRow in audio.js). Keeping the sequence here, rather than in the
   worker, means the inline fallback audio.js uses when a worker isn't
   available runs exactly the same passes in exactly the same order - the two
   paths cannot drift apart.

   Every pass is individually try/caught: one failure yields null for that row
   (audio.js drops or dashes it) and the rest still run. */

import { computeCentroid, detectPitch, detectBPM } from './audio-analysis.js';
import {
  longAverageSpectrum, detectKey, loudnessR128, truePeakDb, signalHealth, detectDtmf
} from './audio-forensics.js';

// Channel-merged signal, byte-for-byte identical to getMono() in audio.js -
// same accumulate-then-scale order, so the numbers below match the ones the
// main thread computed for Peak/RMS/Total samples. Rebuilt here rather than
// copied across the worker boundary: it is one cheap linear pass, and sending
// it would add another full copy of the audio to the transfer.
function mergeMono(channels: Float32Array[]) {
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (let c = 0; c < channels.length; c++) {
    const data = channels[c];
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

// A throttled cooperative yield. The heavy passes call `await tick()` inside their
// hot loops; it only actually hands the thread back once ~24 ms of work has accrued,
// so the added wall-time stays small while the page keeps painting. When no onTick is
// given - the worker path, where blocking the worker thread is fine - it's null and
// the passes run straight through. Exported so the passes share exactly one throttle.
export function makeTick(onTick?: (() => void | Promise<void>) | null) {
  if (typeof onTick !== 'function') return null;
  let t = performance.now();
  return async () => {
    if (performance.now() - t >= 24) { await onTick(); t = performance.now(); }
  };
}

/**
 * Run the forensic passes in order, yielding [name, value] as each lands.
 * Async generator: each heavy pass takes a shared `tick` and awaits it inside its
 * loops, so on the inline (main-thread) path the page stays responsive DURING a
 * pass, not just between passes. In the worker, onTick is omitted, tick is null, and
 * every pass runs straight through - the worker thread has nothing else waiting.
 *
 * @param {{ channels: Float32Array[], mono?: Float32Array, sampleRate: number, needBpm: boolean, onTick?: () => Promise<void> }} input
 *   needBpm is false when the file already declares a tempo in its tags, which
 *   skips a whole-file STFT - the tag wins over an estimate either way.
 *   mono is optional: the inline caller already holds the merged signal and
 *   passes it straight in, so only the worker (which is sent the channels
 *   alone) pays to rebuild it. onTick, when given, is the main-thread yield.
 */
// The worker passes neither `mono` (it derives one) nor `onTick` (nothing to
// yield to on a dedicated thread), so both are optional.
export async function* audioDspPasses({ channels, mono, sampleRate, needBpm, onTick }: {
  channels: Float32Array[]; sampleRate: number; needBpm?: boolean;
  mono?: Float32Array | null; onTick?: (() => void | Promise<void>) | null;
}) {
  const tick = makeTick(onTick);
  if (!mono) mono = mergeMono(channels);

  let spec = null;
  try { spec = await longAverageSpectrum(mono, sampleRate, { tick }); } catch (_) {}
  yield ['spec', spec];

  let health = null;
  try { health = await signalHealth(channels, tick); } catch (_) {}
  yield ['health', health];

  let key = null;
  try { if (spec) key = detectKey(spec); } catch (_) {}
  yield ['key', key];

  let r128 = null;
  try { r128 = await loudnessR128(mono, sampleRate, tick); } catch (_) {}
  yield ['r128', r128];

  let tpDb = null;
  try { tpDb = await truePeakDb(channels, sampleRate, tick); } catch (_) {}
  yield ['truePeak', tpDb];

  let dtmf = null;
  try { dtmf = await detectDtmf(mono, sampleRate, tick); } catch (_) {}
  yield ['dtmf', dtmf];

  let centroid = null;
  try { centroid = await computeCentroid(mono, sampleRate, tick); } catch (_) {}
  yield ['centroid', centroid];

  // Cheap - a single window from the middle of the file, not a whole-file sweep.
  let pitch = null;
  try { pitch = detectPitch(mono, sampleRate); } catch (_) {}
  yield ['pitch', pitch];

  let bpm = null;
  if (needBpm) { try { bpm = await detectBPM(mono, sampleRate, tick); } catch (_) {} }
  yield ['bpm', bpm];
}
