/* Analyser - animated WebP frame decoder
   A browser plays an animated WebP in an <img>, but won't let you step through it
   frame by frame. Unlike GIF (which we LZW-decode by hand), WebP frames are VP8 /
   VP8L bitstreams - far too heavy to decode in JS - so we lean on the browser's
   own ImageDecoder (WebCodecs): it returns one fully-composited VideoFrame per
   animation frame, honouring disposal, blending and frame offsets. We draw each to
   a canvas and read it back as RGBA, producing the same per-frame snapshot shape
   the GIF decoder does so photo.js can build an identical transport. Returns null
   (and the page falls back to the native animated <img>) when the WebP isn't
   animated or ImageDecoder is unavailable (older Safari). No DOM helpers imported. */

// Read the WebP container header just far enough to tell whether it animates and
// to pick up the loop count + alpha flag. Returns { animated, loop, hasAlpha } or
// null if the bytes aren't a WebP. (Frame timings come from the decoder itself.)
function peekWebpAnim(bytes) {
  const ascii = (o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[o + i]); return s; };
  if (bytes.length < 21 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return null;
  if (ascii(12, 4) !== 'VP8X') return { animated: false, loop: null, hasAlpha: false };
  const flags = bytes[20];
  const animated = (flags & 0x02) !== 0;
  const hasAlpha = (flags & 0x10) !== 0;
  let loop = null;
  if (animated) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 12;
    while (pos + 8 <= bytes.length) {
      const cc = ascii(pos, 4);
      const sz = dv.getUint32(pos + 4, true);
      if (cc === 'ANIM') { loop = dv.getUint16(pos + 8 + 4, true); break; }
      pos += 8 + sz + (sz & 1);
    }
  }
  return { animated, loop, hasAlpha };
}

// Decode every frame of an animated WebP into composited RGBA snapshots, mirroring
// decodeGifFrames(): returns { width, height, frames:[{ data:Uint8ClampedArray,
// delay /*ms*/ }], delaysMs, loop, anyTransparency, truncated } or null. `maxPixels`
// caps total decoded pixels (width*height*frames); frames past it are dropped
// (truncated=true). Async - it awaits the browser's ImageDecoder.
export async function decodeWebpFrames(file, maxPixels = 120e6) {
  if (typeof window === 'undefined' || typeof window.ImageDecoder === 'undefined') return null;
  if (file.size > 200 * 1024 * 1024) return null;

  const buf = await file.arrayBuffer();
  const head = peekWebpAnim(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)));
  if (!head || !head.animated) return null;

  let dec;
  try {
    dec = new window.ImageDecoder({ data: buf, type: 'image/webp' });
    await dec.tracks.ready;
  } catch (_) { try { dec && dec.close(); } catch (_) {} return null; }

  const track = dec.tracks.selectedTrack;
  if (!track || !track.animated || track.frameCount < 2) { try { dec.close(); } catch (_) {} return null; }

  // repetitionCount: Infinity means loop forever - fold to 0 to match the GIF
  // viewer's "0 = infinite" convention. Header ANIM loop is the fallback.
  let loop = head.loop;
  if (track.repetitionCount === Infinity) loop = 0;
  else if (typeof track.repetitionCount === 'number') loop = track.repetitionCount;

  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const frames = [];
  const delaysMs = [];
  let width = 0, height = 0, truncated = false, maxFrames = Infinity;

  try {
    for (let i = 0; i < track.frameCount; i++) {
      let image;
      try { ({ image } = await dec.decode({ frameIndex: i, completeFramesOnly: true })); }
      catch (_) { break; }                                  // ran past the decodable frames
      const fw = image.displayWidth || image.codedWidth;
      const fh = image.displayHeight || image.codedHeight;
      if (!width) {
        width = fw; height = fh;
        cv.width = width; cv.height = height;
        if (width * height > 0) maxFrames = Math.max(1, Math.floor(maxPixels / (width * height)));
      }
      if (frames.length >= maxFrames) { truncated = true; image.close(); break; }
      ctx.clearRect(0, 0, width, height);
      try { ctx.drawImage(image, 0, 0); }
      catch (_) { image.close(); break; }
      // VideoFrame.duration is microseconds and may be null on a malformed frame.
      const durMs = (image.duration != null && image.duration > 0) ? image.duration / 1000 : 100;
      image.close();
      frames.push({ data: ctx.getImageData(0, 0, width, height).data, delay: durMs });
      delaysMs.push(durMs);
    }
  } finally { try { dec.close(); } catch (_) {} }

  if (frames.length < 2) return null;
  return { width, height, frames, delaysMs, loop, anyTransparency: head.hasAlpha, truncated };
}
