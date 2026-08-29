/* Analyser - AVI (RIFF) container parsing
   Browsers can't play most AVI files (typically Motion-JPEG video + PCM audio),
   so we parse the container ourselves: read the header for dimensions/codec/
   audio format, pull the raw MJPEG frames and PCM audio out of the `movi` list,
   and re-wrap the PCM as a WAV the browser *can* play. Used by video.js when the
   normal <video> path fails on an AVI. No DOM or cross-module dependencies.

   Two paths, same interface. Up to AVI_EXTRACT_MAX the file is read whole
   (extractAviData, unchanged). Above it openAviData() indexes the movi chunk
   table instead - offsets and sizes only, from idx1 when the file has one, else
   a windowed header walk - and hands back a lazy frame SOURCE whose get(idx)
   reads that one JPEG off disk. Same shape gif-frames.js returns, and for the
   same reason: a 2 GB AVI can be stepped through without ever holding more than
   a window and a bounded frame cache in memory. */
import { roundFps } from '../core/util.js';
import { AVI_EXTRACT_MAX, AVI_AUDIO_PCM_MAX, AVI_STREAM_WINDOW, AVI_INDEX_MAX, AVI_FRAME_CACHE } from '../core/limits.js';
// Shared, lazily-created AudioContext used only as a createBuffer factory. A
// fresh one per file would exhaust iOS Safari's ~4-context cap across a session.
let _aviAudioCtx = null;
function aviAudioCtx() {
    if (!_aviAudioCtx)
        _aviAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _aviAudioCtx;
}
// Read just the AVI header chunks (avih/strh/strf) from the first 8 KB. Returns
// { width, height, fps, duration, totalFrames, codec, audioCodec, audioFormat }
// or null if the file isn't an AVI / has no video stream.
export async function parseAviHeader(file) {
    const size = Math.min(file.size, 8192);
    const buf = await file.slice(0, size).arrayBuffer();
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'AVI ')
        return null;
    const info = {};
    let lastStreamType = null;
    let pos = 12;
    while (pos + 8 < size) {
        const ckId = tag(pos);
        const ckSize = view.getUint32(pos + 4, true);
        if (ckId === 'avih' && pos + 8 + 56 <= size) {
            const d = pos + 8;
            info.microSecPerFrame = view.getUint32(d, true);
            info.totalFrames = view.getUint32(d + 16, true);
            info.width = view.getUint32(d + 32, true);
            info.height = view.getUint32(d + 36, true);
            if (info.microSecPerFrame > 0) {
                info.fps = roundFps(1000000 / info.microSecPerFrame);
                info.duration = info.totalFrames * info.microSecPerFrame / 1000000;
            }
        }
        if (ckId === 'strh' && pos + 8 + 56 <= size) {
            const d = pos + 8;
            const fccType = tag(d);
            const fccHandler = tag(d + 4);
            lastStreamType = fccType;
            if (fccType === 'vids')
                info.codec = fccHandler.trim() || undefined;
            if (fccType === 'auds')
                info.audioCodec = fccHandler.trim() || undefined;
        }
        if (ckId === 'strf' && lastStreamType === 'auds' && pos + 8 + 16 <= size) {
            const d = pos + 8;
            info.audioFormat = {
                formatTag: view.getUint16(d, true),
                channels: view.getUint16(d + 2, true),
                sampleRate: view.getUint32(d + 4, true),
                avgBytesPerSec: view.getUint32(d + 8, true),
                blockAlign: view.getUint16(d + 12, true),
                bitsPerSample: view.getUint16(d + 14, true)
            };
        }
        if (ckId === 'LIST') {
            pos += 12;
            continue;
        }
        pos += 8 + ckSize + (ckSize & 1);
    }
    return info.width ? info : null;
}
// Walk the `movi` list and collect the payloads: MJPEG frames (00dc/00db, each a
// standalone JPEG) and PCM audio (01wb). When the audio is uncompressed PCM
// (formatTag 1), decode it into an AudioBuffer. Returns { videoFrames, audioBuffer? }
// or null. Capped at 500 MB since it reads the whole file into memory.
export async function extractAviData(file, aviInfo) {
    if (file.size > AVI_EXTRACT_MAX)
        return null;
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const tag = (o) => (o + 4 <= buf.byteLength)
        ? String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]) : '';
    let moviStart = -1, moviEnd = -1, pos = 12;
    while (pos + 12 < buf.byteLength) {
        const ckId = tag(pos);
        const ckSize = view.getUint32(pos + 4, true);
        if (ckSize === 0 || pos + ckSize > buf.byteLength + 8)
            break;
        if (ckId === 'LIST' && tag(pos + 8) === 'movi') {
            moviStart = pos + 12;
            moviEnd = Math.min(pos + 8 + ckSize, buf.byteLength);
            break;
        }
        if (ckId === 'LIST') {
            pos += 12;
            continue;
        }
        pos += 8 + ckSize + (ckSize & 1);
    }
    if (moviStart < 0)
        return null;
    const audioChunks = [], videoFrames = [];
    pos = moviStart;
    while (pos + 8 <= moviEnd) {
        const ckId = tag(pos);
        const ckSize = view.getUint32(pos + 4, true);
        const dataStart = pos + 8;
        if (dataStart + ckSize > buf.byteLength || ckSize === 0)
            break;
        if ((ckId === '00dc' || ckId === '00db') && ckSize > 2)
            videoFrames.push(buf.slice(dataStart, dataStart + ckSize));
        if (ckId === '01wb' && ckSize > 0)
            audioChunks.push(new Uint8Array(buf, dataStart, ckSize));
        if (ckId === 'LIST') {
            pos += 12;
            continue;
        }
        pos += 8 + ckSize + (ckSize & 1);
    }
    // audioBuffer is attached below only when the AVI carried a decodable stream.
    const result = { videoFrames };
    const fmt = aviInfo && aviInfo.audioFormat;
    if (audioChunks.length && fmt && fmt.formatTag === 1 && fmt.bitsPerSample) {
        const totalSize = audioChunks.reduce((s, c) => s + c.length, 0);
        const pcm = new Uint8Array(totalSize);
        let off = 0;
        for (const c of audioChunks) {
            pcm.set(c, off);
            off += c.length;
        }
        const audioBuf = pcmToAudioBuffer(pcm, fmt);
        if (audioBuf)
            result.audioBuffer = audioBuf;
    }
    return result;
}
// Interleaved uncompressed PCM (8- or 16-bit, as described by the AVI's strf
// audio format) -> AudioBuffer. Shared by both paths: the eager one concatenates
// the 01wb chunks in memory, the streamed one gathers them window by window.
function pcmToAudioBuffer(pcm, fmt) {
    const totalSize = pcm.length;
    const bytesPerSample = fmt.bitsPerSample / 8;
    const frameSize = bytesPerSample * fmt.channels;
    if (!frameSize)
        return null;
    const totalFrames = Math.floor(totalSize / frameSize);
    if (totalFrames <= 0)
        return null;
    const sr = (fmt.sampleRate >= 3000 && fmt.sampleRate <= 384000) ? fmt.sampleRate : 44100;
    const audioBuf = aviAudioCtx().createBuffer(fmt.channels, totalFrames, sr);
    const pcmView = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let ch = 0; ch < fmt.channels; ch++) {
        const chData = audioBuf.getChannelData(ch);
        for (let i = 0; i < totalFrames; i++) {
            const bytePos = i * frameSize + ch * bytesPerSample;
            if (bytePos + bytesPerSample > totalSize)
                break;
            if (bytesPerSample === 2)
                chData[i] = pcmView.getInt16(bytePos, true) / 0x8000;
            else if (bytesPerSample === 1)
                chData[i] = (pcmView.getUint8(bytePos) - 128) / 128;
        }
    }
    return audioBuf;
}
// ---------------------------------------------------------------------------
// Streamed path - for AVIs too big to hold in memory (over AVI_EXTRACT_MAX).
// Nothing here ever holds more than one AVI_STREAM_WINDOW-sized window plus the
// chunk index, so a multi-GB file costs about what a small one does.
// ---------------------------------------------------------------------------
const str4 = (u8, o) => (o + 4 <= u8.length)
    ? String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]) : '';
async function readBytes(file, start, end) {
    const from = Math.max(0, Math.min(start, file.size));
    const to = Math.max(from, Math.min(end, file.size));
    return new Uint8Array(await file.slice(from, to).arrayBuffer());
}
const viewOf = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
// An hour of MJPEG indexes to ~100k entries, which as {off,size} objects would
// cost more than a window of the file does; here it is 12 bytes each.
function chunkList() {
    let off = new Float64Array(4096);
    let size = new Uint32Array(4096);
    let n = 0, bytes = 0;
    return {
        get n() { return n; },
        get bytes() { return bytes; },
        offAt: (i) => off[i],
        sizeAt: (i) => size[i],
        push(o, s) {
            if (n >= off.length) {
                const o2 = new Float64Array(off.length * 2);
                o2.set(off);
                off = o2;
                const s2 = new Uint32Array(size.length * 2);
                s2.set(size);
                size = s2;
            }
            off[n] = o;
            size[n] = s;
            n++;
            bytes += s;
        },
    };
}
// Top-level RIFF segments. A file over 4 GB is OpenDML: one 'RIFF....AVI ' header
// followed by further 'RIFF....AVIX' segments, each with its own movi list, so
// indexing only the first would silently stop at the 4 GB mark.
async function riffSegments(file) {
    const segs = [];
    let pos = 0;
    while (pos + 12 <= file.size && segs.length < 64) {
        const head = await readBytes(file, pos, pos + 12);
        if (head.length < 12 || str4(head, 0) !== 'RIFF')
            break;
        const type = str4(head, 8);
        if (type !== 'AVI ' && type !== 'AVIX')
            break;
        const size = viewOf(head).getUint32(4, true);
        // A truncated or 4 GB-wrapped segment writes a size that overruns the file;
        // clamping to the real end keeps the walk terminating.
        const end = size ? Math.min(pos + 8 + size, file.size) : file.size;
        if (end <= pos + 12)
            break;
        segs.push({ start: pos + 12, end });
        pos = end + (end & 1);
    }
    return segs;
}
// The movi list (and the idx1 index, when the muxer wrote one) inside one segment.
async function segmentLists(file, seg) {
    const out = { movi: null, idx1: null };
    let pos = seg.start;
    while (pos + 8 <= seg.end) {
        const head = await readBytes(file, pos, pos + 12);
        if (head.length < 8)
            break;
        const id = str4(head, 0);
        const size = viewOf(head).getUint32(4, true);
        if (id === 'LIST' && head.length >= 12) {
            if (str4(head, 8) === 'movi' && !out.movi) {
                const end = Math.min(pos + 8 + (size || (seg.end - pos - 8)), seg.end);
                out.movi = { fourcc: pos + 8, start: pos + 12, end };
            }
        }
        else if (id === 'idx1' && !out.idx1 && size) {
            out.idx1 = { start: pos + 8, end: Math.min(pos + 8 + size, seg.end) };
        }
        if (!size)
            break;
        pos += 8 + size + (size & 1);
    }
    return out;
}
// Build the index from idx1 - a couple of windowed reads at the end of the file
// instead of a walk over the whole movi list. Returns false (having pushed
// nothing) if the offsets don't resolve, so the caller can fall back to the scan.
async function indexFromIdx1(file, idx1, movi, video, audio) {
    const first = await readBytes(file, idx1.start, idx1.start + 16);
    if (first.length < 16)
        return false;
    const ckid = str4(first, 0);
    const entryOff = viewOf(first).getUint32(8, true);
    // dwChunkOffset is classically relative to the 'movi' FOURCC, but muxers in the
    // wild write an absolute file offset instead, and some point at the payload
    // rather than the chunk header. Probe the bytes actually on disk and take the
    // base that matches rather than trusting the spec.
    let base = null, skipHeader = 8;
    for (const cand of [movi.fourcc, 0]) {
        const hdr = await readBytes(file, cand + entryOff, cand + entryOff + 4);
        if (str4(hdr, 0) === ckid) {
            base = cand;
            skipHeader = 8;
            break;
        }
        const pay = await readBytes(file, cand + entryOff - 8, cand + entryOff - 4);
        if (str4(pay, 0) === ckid) {
            base = cand;
            skipHeader = 0;
            break;
        }
    }
    if (base === null)
        return false;
    let pos = idx1.start;
    while (pos + 16 <= idx1.end && video.n < AVI_INDEX_MAX) {
        const win = await readBytes(file, pos, Math.min(pos + AVI_STREAM_WINDOW, idx1.end));
        if (win.length < 16)
            break;
        const dv = viewOf(win);
        const usable = win.length - (win.length % 16);
        for (let o = 0; o + 16 <= usable && video.n < AVI_INDEX_MAX; o += 16) {
            const id = str4(win, o);
            const size = dv.getUint32(o + 12, true);
            if (!size)
                continue;
            const off = base + dv.getUint32(o + 8, true) + skipHeader;
            if (off + size > file.size)
                continue;
            if (id === '00dc' || id === '00db')
                video.push(off, size);
            else if (id === '01wb')
                audio.push(off, size);
        }
        pos += usable;
    }
    return video.n > 0;
}
// No usable idx1: walk the movi chunk headers directly. Payloads are skipped by
// jumping the read position, so this passes over the file in windows and keeps
// only the 8-byte headers it lands on.
async function indexByScan(file, movi, video, audio, onProgress) {
    let pos = movi.start, winStart = 0, win = null;
    const span = Math.max(1, movi.end - movi.start);
    let lastPing = movi.start;
    const have = async (n) => {
        if (win && pos >= winStart && pos + n <= winStart + win.length)
            return true;
        winStart = pos;
        win = await readBytes(file, pos, Math.min(pos + AVI_STREAM_WINDOW, movi.end));
        return win.length >= n;
    };
    while (pos + 8 <= movi.end && video.n < AVI_INDEX_MAX) {
        if (!(await have(8)))
            break;
        const w = win;
        const o = pos - winStart;
        const id = str4(w, o);
        const size = viewOf(w).getUint32(o + 4, true);
        if (id === 'LIST') {
            pos += 12;
            continue;
        } // 'rec ' grouping list
        if (!size || pos + 8 + size > movi.end + 8)
            break; // corrupt / truncated tail
        if (id === '00dc' || id === '00db')
            video.push(pos + 8, size);
        else if (id === '01wb')
            audio.push(pos + 8, size);
        pos += 8 + size + (size & 1);
        if (onProgress && pos - lastPing > 64 * 1024 * 1024) {
            lastPing = pos;
            onProgress(Math.min(1, (pos - movi.start) / span));
        }
    }
}
// Copy the indexed 01wb payloads into one PCM buffer. The audio chunks are
// interleaved with the video across the whole file, so this reads forward in
// windows and takes only what falls inside each - one sequential pass, not
// thousands of tiny reads.
async function gatherPcm(file, audio, maxBytes) {
    const total = Math.min(audio.bytes, maxBytes);
    const pcm = new Uint8Array(total);
    let written = 0, i = 0;
    while (i < audio.n && written < total) {
        const winStart = audio.offAt(i);
        const win = await readBytes(file, winStart, winStart + AVI_STREAM_WINDOW);
        if (!win.length)
            break;
        let advanced = false;
        while (i < audio.n && written < total) {
            const off = audio.offAt(i), size = audio.sizeAt(i);
            if (off < winStart || off + size > winStart + win.length)
                break;
            const take = Math.min(size, total - written);
            pcm.set(win.subarray(off - winStart, off - winStart + take), written);
            written += take;
            i++;
            advanced = true;
        }
        if (!advanced) {
            // One chunk larger than the window (or an out-of-order index): read it alone.
            const off = audio.offAt(i), size = audio.sizeAt(i);
            const take = Math.min(size, total - written);
            const solo = await readBytes(file, off, off + take);
            if (!solo.length)
                break;
            pcm.set(solo, written);
            written += solo.length;
            i++;
        }
    }
    return written === total ? pcm : pcm.subarray(0, written);
}
// Lazy frame source over the index: get(idx) reads that one JPEG off disk, with a
// byte-bounded LRU so scrubbing backwards doesn't re-read every step.
function lazyFrameSource(file, video) {
    const cache = new Map(); // insertion order = LRU
    let cached = 0;
    const clamp = (i) => Math.max(0, Math.min(video.n - 1, i | 0));
    return {
        count: video.n,
        streamed: true,
        async get(i) {
            i = clamp(i);
            if (cache.has(i)) {
                const b = cache.get(i);
                cache.delete(i);
                cache.set(i, b);
                return b;
            }
            const buf = await file.slice(video.offAt(i), video.offAt(i) + video.sizeAt(i)).arrayBuffer();
            cache.set(i, buf);
            cached += buf.byteLength;
            while (cached > AVI_FRAME_CACHE && cache.size > 1) {
                const oldest = cache.keys().next().value;
                cached -= cache.get(oldest).byteLength;
                cache.delete(oldest);
            }
            return buf;
        },
        close() { cache.clear(); cached = 0; },
    };
}
// The eager path's frames wrapped in the same interface, so the viewer has one
// code path whichever way the file was opened.
function arrayFrameSource(frames) {
    const clamp = (i) => Math.max(0, Math.min(frames.length - 1, i | 0));
    return {
        count: frames.length,
        streamed: false,
        get: (i) => Promise.resolve(frames[clamp(i)]),
        close() { },
    };
}
// Open an AVI's picture and sound for the viewer: whole-file below
// AVI_EXTRACT_MAX, streamed above it. Returns null when there is nothing to show.
// `onProgress(frac)` is called while indexing a streamed file - the only slow
// part, and only for a file with no idx1 to read the index straight out of.
export async function openAviData(file, aviInfo, onProgress) {
    if (file.size <= AVI_EXTRACT_MAX) {
        let eager = null;
        try {
            eager = await extractAviData(file, aviInfo);
        }
        catch (_) {
            eager = null;
        }
        if (!eager)
            return null;
        return {
            source: arrayFrameSource(eager.videoFrames),
            audioBuffer: eager.audioBuffer || null,
            streamed: false, audioSkipped: false, audioBytes: 0, indexTruncated: false,
        };
    }
    const video = chunkList(), audio = chunkList();
    const segs = await riffSegments(file);
    for (const seg of segs) {
        if (video.n >= AVI_INDEX_MAX)
            break;
        const { movi, idx1 } = await segmentLists(file, seg);
        if (!movi)
            continue;
        let indexed = false;
        if (idx1) {
            try {
                indexed = await indexFromIdx1(file, idx1, movi, video, audio);
            }
            catch (_) {
                indexed = false;
            }
        }
        if (!indexed)
            await indexByScan(file, movi, video, audio, onProgress);
    }
    if (!video.n)
        return null;
    // Sound is the one part that still has to be resident - an AudioBuffer cannot be
    // paged off disk. Past AVI_AUDIO_PCM_MAX it is skipped rather than undoing the
    // point of streaming the frames; the viewer says so on screen.
    const fmt = aviInfo && aviInfo.audioFormat;
    let audioBuffer = null, audioSkipped = false;
    if (audio.n && fmt && fmt.formatTag === 1 && fmt.bitsPerSample) {
        if (audio.bytes <= AVI_AUDIO_PCM_MAX) {
            try {
                const pcm = await gatherPcm(file, audio, AVI_AUDIO_PCM_MAX);
                audioBuffer = pcmToAudioBuffer(pcm, fmt);
            }
            catch (_) {
                audioBuffer = null;
            }
        }
        else {
            audioSkipped = true;
        }
    }
    return {
        source: lazyFrameSource(file, video),
        audioBuffer, streamed: true, audioSkipped,
        audioBytes: audio.bytes,
        indexTruncated: video.n >= AVI_INDEX_MAX,
    };
}
// Encode an AudioBuffer as a 16-bit PCM WAV Blob (interleaved), so the extracted
// AVI audio can be handed to a normal <audio> element.
export function encodeWav(audioBuf) {
    const ch = audioBuf.numberOfChannels, sr = audioBuf.sampleRate, len = audioBuf.length;
    const block = ch * 2, dataSize = len * block;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    let o = 0;
    const ws = (s) => { for (let i = 0; i < s.length; i++)
        v.setUint8(o++, s.charCodeAt(i)); };
    ws('RIFF');
    v.setUint32(o, 36 + dataSize, true);
    o += 4;
    ws('WAVEfmt ');
    v.setUint32(o, 16, true);
    o += 4;
    v.setUint16(o, 1, true);
    o += 2;
    v.setUint16(o, ch, true);
    o += 2;
    v.setUint32(o, sr, true);
    o += 4;
    v.setUint32(o, sr * block, true);
    o += 4;
    v.setUint16(o, block, true);
    o += 2;
    v.setUint16(o, 16, true);
    o += 2;
    ws('data');
    v.setUint32(o, dataSize, true);
    o += 4;
    const chData = [];
    for (let c = 0; c < ch; c++)
        chData.push(audioBuf.getChannelData(c));
    for (let i = 0; i < len; i++) {
        for (let c = 0; c < ch; c++) {
            let s = Math.max(-1, Math.min(1, chData[c][i]));
            v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            o += 2;
        }
    }
    return new Blob([buf], { type: 'audio/wav' });
}
//# sourceMappingURL=video-avi.js.map