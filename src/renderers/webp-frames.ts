/* Analyser - animated WebP frame decoder (lazy)
   A browser plays an animated WebP in an <img>, but won't let you step through it
   frame by frame. Unlike GIF (which we LZW-decode by hand), WebP frames are VP8 /
   VP8L bitstreams - far too heavy to decode in JS - so we lean on the browser's
   own ImageDecoder (WebCodecs), which is random-access: dec.decode({frameIndex}).

   We read the canvas size, loop count, alpha flag and per-frame durations straight
   from the RIFF container (the ANMF chunks) without decoding any pixels, then hand
   back a lazy SOURCE that keeps the ImageDecoder open and composites a frame only
   when get(idx) asks for it - caching a budget's worth of decoded RGBA in an LRU.
   This retains O(cache-window) memory instead of every frame at once, so a long
   animation plays in full. Returns null (page falls back to the native animated
   <img>) when the WebP isn't animated or ImageDecoder is unavailable (older Safari).
   No DOM helpers imported. */

// Parse the WebP RIFF container far enough to describe the animation without
// decoding pixels. Returns { animated, loop, hasAlpha, width, height,
// durationsMs:number[] } or null if the bytes aren't a WebP. Frame durations and
// the canvas size come from VP8X + ANMF chunk headers.
function parseWebpAnim(bytes: Uint8Array) {
  const ascii = (o: number, n: number) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[o + i]); return s; };
  const u24 = (o: number) => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
  if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return null;
  if (ascii(12, 4) !== 'VP8X') return { animated: false };
  const flags = bytes[20];
  const animated = (flags & 0x02) !== 0;
  const hasAlpha = (flags & 0x10) !== 0;
  // VP8X payload (starts at 20): flags(1) reserved(3) canvasWidth-1(3) canvasHeight-1(3).
  const width = u24(24) + 1;
  const height = u24(27) + 1;
  let loop = null;
  const durationsMs = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const cc = ascii(pos, 4);
    const sz = dv.getUint32(pos + 4, true);
    if (cc === 'ANIM') loop = dv.getUint16(pos + 8 + 4, true);
    else if (cc === 'ANMF') {
      // ANMF payload: x(3) y(3) width(3) height(3) duration(3) ... -> duration at +12.
      const dur = u24(pos + 8 + 12);
      durationsMs.push(dur > 0 ? dur : 100);
    }
    pos += 8 + sz + (sz & 1);
  }
  return { animated, loop, hasAlpha, width, height, durationsMs };
}

// Open an animated WebP as a lazy frame SOURCE mirroring decodeGifFrames():
//   { width, height, count, loop, anyTransparency, delaysMs:number[]/*ms*/,
//     get(idx) -> Promise<Uint8ClampedArray /*RGBA*/>, close() }
// or null. `budget` is the retained decoded-pixel cache window; the LRU keeps at
// most floor(budget/(w*h)) frames. Async - it awaits the browser's ImageDecoder.
export async function decodeWebpFrames(file: File, budget = 120e6) {
  if (typeof window === 'undefined' || typeof window.ImageDecoder === 'undefined') return null;
  if (file.size > 200 * 1024 * 1024) return null;

  const buf = await file.arrayBuffer();
  const info = parseWebpAnim(new Uint8Array(buf, 0, Math.min(buf.byteLength, 1 << 20)));
  if (!info || !info.animated || !info.width || !info.height) return null;

  let dec;
  try {
    dec = new window.ImageDecoder({ data: buf, type: 'image/webp' });
    await dec.tracks.ready;
  } catch (_) { try { dec && dec.close(); } catch (_) {} return null; }

  const track = dec.tracks.selectedTrack;
  if (!track || !track.animated || track.frameCount < 2) { try { dec.close(); } catch (_) {} return null; }

  const count = track.frameCount;
  // Per-frame delays from the container; pad/truncate to the decoder's frame count.
  const delaysMs = [];
  for (let i = 0; i < count; i++) delaysMs.push(info.durationsMs[i] || 100);

  // repetitionCount: Infinity means loop forever - fold to 0 to match the GIF
  // viewer's "0 = infinite" convention. Header ANIM loop is the fallback.
  let loop = info.loop;
  if (track.repetitionCount === Infinity) loop = 0;
  else if (typeof track.repetitionCount === 'number') loop = track.repetitionCount;

  const width = info.width, height = info.height;
  const px = width * height;
  const L = Math.max(8, Math.floor(budget / px));
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const lru = new Map<number, Uint8ClampedArray>();
  let closed = false;

  const get = async (idx: number) => {
    idx = Math.max(0, Math.min(count - 1, idx | 0));
    if (lru.has(idx)) { const d = lru.get(idx)!; lru.delete(idx); lru.set(idx, d); return d; }
    let data: Uint8ClampedArray;
    if (closed) return new Uint8ClampedArray(px * 4);
    try {
      const { image } = await dec.decode({ frameIndex: idx, completeFramesOnly: true });
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      image.close();
      data = ctx.getImageData(0, 0, width, height).data;
    } catch (_) { data = new Uint8ClampedArray(px * 4); }    // blank on a malformed frame
    lru.set(idx, data);
    if (lru.size > L) lru.delete(lru.keys().next().value!);
    return data;
  };

  return {
    width, height, count, loop, anyTransparency: info.hasAlpha, delaysMs, get,
    close() { closed = true; try { dec.close(); } catch (_) {} lru.clear(); },
  };
}
