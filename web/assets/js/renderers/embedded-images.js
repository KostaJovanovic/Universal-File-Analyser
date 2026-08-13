/* Analyser - shared "Embedded images" card.
   Several still-image formats pack more than one picture into a single file (an
   icon's size ladder, an MPO stereo pair, a multi-page TIFF), but the browser only
   ever paints one. The per-format extractors (ico.js, the MPF/TIFF helpers) each
   produce a list of items and hand them here to be laid out identically: every
   image on a transparency checkerboard, largest/first in order, with its size,
   format and byte count, and a per-image download. Pure DOM; no decoding here. */
import { el, fmtBytes, h3help } from '../core/util.js';
// How each EXIF orientation value reads in plain words, for the caption under a
// thumbnail we had to turn round. 1 (already upright) is deliberately absent.
const ORIENT_LABEL = {
    2: 'mirrored', 3: 'rotated 180°', 4: 'flipped vertically',
    5: 'mirrored and rotated 90°', 6: 'rotated 90°',
    7: 'mirrored and rotated 270°', 8: 'rotated 270°',
};
// Repaint an extracted image with its EXIF orientation applied.
//
// An embedded thumbnail or RAW preview is a BARE JPEG - the bytes carved out of
// the parent file carry no metadata of their own. The rotation the camera
// recorded lives in the IFD that points at those bytes, so a browser shows the
// stream exactly as stored: sideways for anything shot in portrait, even while
// the main photo above it sits upright (the browser rotates that one from its
// own EXIF). Re-draw through a canvas so the two agree.
//
// The download is left alone on purpose: it stays byte-identical to what was
// carved out of the source, which is the point of extracting it. Does nothing
// for orientation 1, and silently gives up rather than showing a broken image.
function orientImage(imgEl, orientation, signal) {
    const o = Number(orientation) || 1;
    if (o < 2 || o > 8)
        return;
    imgEl.addEventListener('load', () => {
        const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
        if (!w || !h)
            return;
        try {
            const swap = o >= 5; // 5-8 are the quarter turns
            const cv = document.createElement('canvas');
            cv.width = swap ? h : w;
            cv.height = swap ? w : h;
            const cx = cv.getContext('2d');
            switch (o) {
                case 2:
                    cx.transform(-1, 0, 0, 1, w, 0);
                    break;
                case 3:
                    cx.transform(-1, 0, 0, -1, w, h);
                    break;
                case 4:
                    cx.transform(1, 0, 0, -1, 0, h);
                    break;
                case 5:
                    cx.transform(0, 1, 1, 0, 0, 0);
                    break;
                case 6:
                    cx.transform(0, 1, -1, 0, h, 0);
                    break;
                case 7:
                    cx.transform(0, -1, -1, 0, h, w);
                    break;
                case 8:
                    cx.transform(0, -1, 1, 0, 0, w);
                    break;
            }
            cx.drawImage(imgEl, 0, 0, w, h);
            cv.toBlob((b) => {
                if (!b)
                    return;
                const u = URL.createObjectURL(b);
                if (signal)
                    signal.addEventListener('abort', () => { try {
                        URL.revokeObjectURL(u);
                    }
                    catch (_) { } });
                imgEl.src = u;
            }, 'image/png');
        }
        catch (_) { /* leave it as stored */ }
    }, { once: true }); // fires on the original bytes only, not on the repaint
}
// items: [{
//   width?, height?,        // shown if known; otherwise filled from the loaded <img>
//   label,                  // format/tech label, e.g. 'PNG', '32-bit BMP', 'JPEG'
//   bytes?,                 // source byte size for the hint line
//   viewBlob,               // a Blob the browser CAN render (img src)
//   downloadBlob?,          // ready-to-save Blob; if absent the rendered <img> is
//                           // rasterised to PNG on demand
//   downloadName,           // file name for the download
// }]
// resultsEl + sourceFile (optional): when given, each image also gets an "Analyse"
// button that re-runs the full photo analysis on that extracted picture, rendered
// into resultsEl (the same container this card lives in - the drill-in replaces the
// list view, matching the carve/salvage "Analyse" buttons).
// `help` (optional): concise explanation folded behind a [?] on the heading, so
// callers can keep the always-visible `hint` short (or drop it entirely).
export function buildEmbeddedImagesCard({ title, hint, help, items, signal, resultsEl, sourceFile }) {
    const card = el('div', { class: 'anr-card' });
    if (help) {
        const [h, panel] = h3help(title || 'Embedded images', help);
        card.appendChild(h);
        card.appendChild(panel);
    }
    else {
        card.appendChild(el('h3', {}, title || 'Embedded images'));
    }
    if (hint)
        card.appendChild(el('p', { class: 'anr-hint' }, hint));
    const grid = el('div', {
        style: 'display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:14px; margin-top:6px;',
    });
    for (const it of items) {
        const url = URL.createObjectURL(it.viewBlob);
        if (signal)
            signal.addEventListener('abort', () => { try {
                URL.revokeObjectURL(url);
            }
            catch (_) { } });
        const imgEl = el('img', {
            src: url, alt: (it.width && it.height) ? it.width + '×' + it.height : (it.label || 'image'), loading: 'lazy',
            style: 'image-rendering:pixelated; max-width:100%; max-height:160px; display:block; margin:0 auto;',
        });
        orientImage(imgEl, it.orientation, signal);
        const stage = el('div', {
            style: 'display:flex; align-items:center; justify-content:center; min-height:110px; padding:8px; border:1px solid var(--hairline); ' +
                'background:repeating-conic-gradient(#7a7a7a 0% 25%, #9a9a9a 0% 50%) 50% / 16px 16px;',
        }, [imgEl]);
        const dimEl = el('div', { style: 'font-weight:600;' }, (it.width && it.height) ? it.width + ' × ' + it.height + ' px' : 'image');
        // Fill the dimension line from the decoded image when the extractor didn't
        // know it up front (e.g. MPO entries we didn't parse a SOF from).
        if (!(it.width && it.height)) {
            imgEl.addEventListener('load', () => {
                if (imgEl.naturalWidth)
                    dimEl.textContent = imgEl.naturalWidth + ' × ' + imgEl.naturalHeight + ' px';
            }, { once: true });
        }
        const dl = el('a', {
            class: 'anr-btn', download: it.downloadName || 'image.png',
            style: 'display:inline-block; text-decoration:none; margin-top:8px; font-size:12px; padding:4px 8px;',
        }, 'Download');
        if (it.downloadBlob) {
            dl.href = URL.createObjectURL(it.downloadBlob);
            if (signal)
                signal.addEventListener('abort', () => { try {
                    URL.revokeObjectURL(dl.href);
                }
                catch (_) { } });
        }
        else {
            // Rasterise the rendered image to PNG on first click (covers entries whose
            // native bytes aren't directly saveable, e.g. BMP-in-ICO).
            dl.href = '#';
            dl.addEventListener('click', (ev) => {
                if (dl.dataset.ready)
                    return;
                ev.preventDefault();
                try {
                    const cv = document.createElement('canvas');
                    cv.width = imgEl.naturalWidth || it.width || 0;
                    cv.height = imgEl.naturalHeight || it.height || 0;
                    if (!cv.width || !cv.height)
                        return;
                    cv.getContext('2d').drawImage(imgEl, 0, 0, cv.width, cv.height);
                    cv.toBlob((b) => {
                        if (!b)
                            return;
                        dl.href = URL.createObjectURL(b);
                        dl.dataset.ready = '1';
                        if (signal)
                            signal.addEventListener('abort', () => { try {
                                URL.revokeObjectURL(dl.href);
                            }
                            catch (_) { } });
                        dl.click();
                    }, 'image/png');
                }
                catch (_) { /* tainted/failed - leave the link inert */ }
            });
        }
        // The dimensions stay as STORED, even when the picture above them has been
        // turned round - that pairing is the finding, so the caption spells it out.
        const turned = ORIENT_LABEL[Number(it.orientation) || 1];
        const metaBits = [
            dimEl,
            el('div', { class: 'anr-hint' }, (it.label || '') + (it.bytes ? (it.label ? ' · ' : '') + fmtBytes(it.bytes) : '')),
        ];
        if (turned)
            metaBits.push(el('div', { class: 'anr-hint' }, 'stored ' + turned + ', shown upright'));
        const meta = el('div', { style: 'font-size:12px; line-height:1.5; margin-top:6px; text-align:center;' }, metaBits);
        const actions = el('div', { style: 'display:flex; justify-content:center; gap:6px;' });
        // Full photo analysis on this extracted image (only when the caller wired a
        // render target). Prefer the native downloadBlob; fall back to the viewBlob.
        if (resultsEl) {
            const an = el('button', {
                type: 'button', class: 'anr-btn',
                style: 'margin-top:8px; font-size:12px; padding:4px 8px;',
            }, 'Analyse');
            an.addEventListener('click', async () => {
                const src = it.downloadBlob || it.viewBlob;
                if (!src)
                    return;
                const name = it.downloadName || 'image.png';
                const f = new File([src], name, { type: src.type || 'image/png' });
                const dims = (it.width && it.height) ? ' (' + it.width + ' × ' + it.height + ')' : '';
                const note = 'Extracted from ' + ((sourceFile && sourceFile.name) || 'this file') + dims + '.';
                const { renderPhoto } = await import('./photo.js');
                renderPhoto(f, resultsEl, { sourceNote: note });
            });
            actions.appendChild(an);
        }
        actions.appendChild(dl);
        grid.appendChild(el('div', {}, [stage, meta, actions]));
    }
    card.appendChild(grid);
    return card;
}
//# sourceMappingURL=embedded-images.js.map