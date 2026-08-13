/* Analyser - forensic audio DSP Web Worker (module worker).

   Drains the pass queue in audio-dsp.js off the main thread and posts each
   result back the moment it lands, so audio.js can fill its pending rows one
   by one while the page stays fully interactive. Nothing here touches the DOM
   or Web Audio - the whole chain (audio-dsp.js, audio-analysis.js,
   audio-forensics.js and the fft it borrows from spectrogram.js) is pure
   arrays-in / numbers-out.

   Messages in : { type: 'run', jobId, channels, sampleRate, needBpm }
   Messages out: { type: 'pass', jobId, name, value }  (one per pass, in order)
                 { type: 'done', jobId }
                 { type: 'error', jobId, message }

   jobId is echoed on every reply because the client keeps ONE worker alive for
   the page - the compare view analyses two files at once, and without the id
   each job would consume the other's results. */
import { audioDspPasses } from './audio-dsp.js';
self.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || m.type !== 'run')
        return;
    const { jobId, channels, sampleRate, needBpm } = m;
    try {
        // No onTick in the worker: the passes run straight through (blocking this thread
        // is the point). audioDspPasses is an async generator, so drain it with for-await.
        for await (const [name, value] of audioDspPasses({ channels, sampleRate, needBpm })) {
            self.postMessage({ type: 'pass', jobId, name, value });
        }
        self.postMessage({ type: 'done', jobId });
    }
    catch (err) {
        // Individual passes catch their own failures, so reaching here means
        // something structural went wrong (bad input, out of memory). Report it and
        // let the client fall back to the inline path.
        self.postMessage({ type: 'error', jobId, message: (err && err.message) || String(err) });
    }
});
//# sourceMappingURL=audio-dsp-worker.js.map