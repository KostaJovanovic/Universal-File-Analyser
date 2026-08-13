/* Analyser - header & section letter-hover effects.
   The "letters thin toward the cursor" effect on the site title/byline (with an
   intro sweep) and on each section heading. Split out of app.js; boot() calls
   setupHeaderFx()/setupSectionFx() per navigation. Dependency-free (DOM only). */
// Clear view (the low-vision accessibility mode) turns all decorative motion
// off. Checked at each activation point - not once at bind time - so flipping
// the chip mid-session stops (or restores) the effects immediately, with no
// unbind/rebind bookkeeping. The split letter spans render identically to
// plain text, so leaving them in place while gated is invisible.
const a11yOn = () => document.documentElement.getAttribute('data-a11y') === 'on';
// Splits an element's text into per-letter inline-block <span>s, each carrying a
// base font-weight, so a proximity effect can vary letters independently. Bakes
// letter-spacing as an em ratio (survives browser zoom on vw-sized type). Each
// word's letters are grouped in a nowrap wrapper so the inline-block letters can
// only break at the spaces between words, never mid-word; the spaces themselves
// are real break opportunities. Returns an array of { el, base } for every letter
// span. Shared by the header sweep/hover effect and the per-section hover effect.
function splitText(container, baseWeight) {
    // Bake letter-spacing as an em ratio of the font size, not the computed px.
    // The title font-size is vw-based, so browser zoom rescales it; a fixed px
    // spacing would not follow, leaving the gaps between the inline-block letters
    // drifting on zoom. em tracks each span's font-size, so the spacing scales
    // together with the letters.
    const cs = getComputedStyle(container);
    const lsPx = parseFloat(cs.letterSpacing);
    const fsPx = parseFloat(cs.fontSize);
    const spacing = (isNaN(lsPx) || !fsPx) ? 'normal' : (lsPx / fsPx) + 'em';
    const spans = [];
    let word = null; // current per-word wrapper; null between words
    function makeSpan(ch, parent) {
        if (ch === ' ') {
            // Space ends the word and is the sole wrap point. A plain text space (not a
            // fixed-width inline-block) is used so it collapses at line ends like normal
            // whitespace - an inline-block space stays as a visible box when the heading
            // wraps, throwing a stray gap onto the wrapped line. The per-word nowrap
            // wrappers still keep words from splitting mid-letter, and a single space is
            // a consistent enough width for the header sweep to glide across.
            word = null;
            parent.appendChild(document.createTextNode(' '));
            return;
        }
        if (!word) {
            word = document.createElement('span');
            word.style.display = 'inline-block';
            word.style.whiteSpace = 'nowrap';
            parent.appendChild(word);
        }
        const s = document.createElement('span');
        s.textContent = ch;
        s.style.display = 'inline-block';
        s.style.fontWeight = baseWeight;
        s.style.letterSpacing = spacing;
        word.appendChild(s);
        spans.push({ el: s, base: baseWeight });
    }
    const nodes = [...container.childNodes];
    container.textContent = '';
    for (const node of nodes) {
        word = null; // never carry a word across a child-element boundary (e.g. the byline <a>)
        if (node.nodeType === 3) {
            for (const ch of node.textContent)
                makeSpan(ch, container);
        }
        else {
            const text = node.textContent;
            node.textContent = '';
            container.appendChild(node);
            for (const ch of text)
                makeSpan(ch, node);
        }
        word = null;
    }
    return spans;
}
// Splits the given targets ({ el, weight }) into per-letter spans, freezing each
// element's box during the split so emptying its text (splitText clears
// textContent) can't reflow the surrounding layout mid-split. Returns the flat
// { el, base } letter list for the proximity controller.
function splitFrozen(targets) {
    for (const t of targets) {
        t.el.style.width = t.el.offsetWidth + 'px';
        t.el.style.height = t.el.offsetHeight + 'px';
    }
    const letters = [];
    for (const t of targets)
        letters.push(...splitText(t.el, t.weight));
    for (const t of targets) {
        t.el.style.width = '';
        t.el.style.height = '';
    }
    return letters;
}
// The site title's "letters thin toward the cursor" controller: an intro "sweep"
// (a virtual cursor gliding across `mark`) plus real mouse hover, run together by
// one RAF loop - per letter we take whichever pulls it lighter (the smaller t), so
// hovering during the sweep no longer cancels it. Shared by the header title and
// the 404 numeral. Guarded per element via mark._anrFx.
//   opts.radiusHover / radiusTouch - proximity falloff in px (default 120 / 80);
//     large type needs a wider radius or the effect never reaches past one glyph.
//   opts.sweepDelay  - ms before the intro sweep starts (default 800).
//   opts.sweepDuration - ms for the intro sweep to cross the mark (default 3500);
//     a short numeral wants a quicker pass or it reads as a slow lingering glow.
//   opts.ivHolder    - object holding the touch re-sweep interval (._iv) so a
//     rebind on a swapped-in element can clear the previous one.
// Mouse-enter snaps straight into fixed-speed cursor tracking (no ramp); the 0.4s
// exit settle still eases the letters back to base.
function bindSweepFx(mark, letters, opts = {}) {
    if (mark._anrFx)
        return;
    mark._anrFx = true;
    const ivHolder = opts.ivHolder;
    if (ivHolder && ivHolder._iv)
        clearInterval(ivHolder._iv);
    const RADIUS_HOVER = opts.radiusHover || 120;
    const RADIUS_TOUCH = opts.radiusTouch || 80;
    const SWEEP_DELAY = opts.sweepDelay != null ? opts.sweepDelay : 800;
    const SWEEP_DURATION = opts.sweepDuration || 3500;
    let mx = -9999, my = -9999, inside = false;
    let sweep = null; // { t0, duration, sx, ex, cy, vx, radius } | null
    let raf = 0, running = false, fxT = 0;
    // Read every letter's centre in one pass, then write every weight. Reading a
    // rect immediately after writing a fontWeight forces a synchronous
    // style+layout flush, so interleaving the two cost one full-document layout
    // per letter per frame - and each of those scales with however much analysis
    // is on the page, which is what made hovering a heading lock up after a big
    // file. lockWidths() already batches this way.
    const cxs = [], cys = [];
    function readCentres() {
        for (let i = 0; i < letters.length; i++) {
            const r = letters[i].el.getBoundingClientRect();
            cxs[i] = r.left + r.width / 2;
            cys[i] = r.top + r.height / 2;
        }
    }
    function letterWeight(l, cx, cy) {
        let t = 1;
        if (inside)
            t = Math.min(t, Math.hypot(mx - cx, my - cy) / RADIUS_HOVER);
        if (sweep)
            t = Math.min(t, Math.hypot(sweep.vx - cx, sweep.cy - cy) / sweep.radius);
        t = Math.min(1, t);
        return Math.round(l.base * t + 300 * (1 - t));
    }
    function frame(ts) {
        if (sweep) {
            if (sweep.t0 == null)
                sweep.t0 = ts;
            const p = Math.min(1, (ts - sweep.t0) / sweep.duration);
            const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            sweep.vx = sweep.sx + e * (sweep.ex - sweep.sx);
            if (p >= 1)
                sweep = null;
        }
        if (inside || sweep) {
            readCentres();
            for (let i = 0; i < letters.length; i++) {
                letters[i].el.style.fontWeight = letterWeight(letters[i], cxs[i], cys[i]);
            }
            raf = requestAnimationFrame(frame);
        }
        else {
            // Don't overwrite to base here - leave the letters at their last hover
            // weight so settle() can ease them back over 0.4s instead of snapping.
            running = false;
            settle();
        }
    }
    function ensureRunning() { if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
    } }
    function settle() {
        clearTimeout(fxT);
        for (const l of letters) {
            l.el.style.transition = 'font-weight 0.4s ease';
            l.el.style.fontWeight = l.base;
        }
        fxT = setTimeout(() => { for (const l of letters)
            l.el.style.transition = ''; }, 500);
    }
    function startSweep(radius) {
        if (a11yOn())
            return;
        const rect = mark.getBoundingClientRect();
        sweep = { t0: null, duration: SWEEP_DURATION, sx: rect.left - radius, ex: rect.right + radius,
            cy: rect.top + rect.height / 2, vx: rect.left - radius, radius };
        ensureRunning();
    }
    if (window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
        const activateHover = () => {
            if (a11yOn())
                return;
            if (!inside) {
                inside = true;
                // No enter ramp: clear any lingering settle transition so cursor tracking
                // starts instantly at a fixed speed (the exit settle still applies).
                clearTimeout(fxT);
                for (const l of letters)
                    l.el.style.transition = '';
            }
            ensureRunning();
        };
        mark.addEventListener('mouseenter', activateHover);
        // Also activate on mousemove: mousemove only fires while the pointer is over
        // the mark, so this catches the case where the cursor was already inside when
        // the page loaded (or during the intro sweep), when mouseenter never fires and
        // hover would otherwise stay dead until you leave and re-enter.
        mark.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; activateHover(); });
        mark.addEventListener('mouseleave', () => { inside = false; }); // settles once the sweep also ends
        setTimeout(() => startSweep(RADIUS_HOVER), SWEEP_DELAY);
    }
    else if (window.matchMedia('(pointer: coarse)').matches) {
        setTimeout(() => startSweep(RADIUS_TOUCH), SWEEP_DELAY);
        if (ivHolder)
            ivHolder._iv = setInterval(() => startSweep(RADIUS_TOUCH), 8000);
    }
}
// Header letter-proximity / sweep effect. Re-runs per navigation because
// navigate.js swaps .site-mark (so the title text changes between pages); the
// guard on the element keeps it from binding twice to the same header.
export function setupHeaderFx() {
    const mark = document.querySelector('.site-mark');
    const title = document.querySelector('.site-title');
    const byline = document.querySelector('.site-byline');
    if (!mark || !title || !byline || mark._anrFx)
        return;
    const letters = splitFrozen([{ el: title, weight: 600 }, { el: byline, weight: 700 }]);
    bindSweepFx(mark, letters, { ivHolder: setupHeaderFx });
}
// Section-heading hover effect. Reuses the header's "letters thin toward the
// cursor" feel on each section's number / kicker / heading - but hover-only,
// with NO intro sweep (no "wave"). Desktop fine-pointer only. Re-runs per
// navigation; the per-section guard keeps it from binding twice. Each section is
// independent, so hovering section 01 never disturbs section 02.
export function setupSectionFx() {
    if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches)
        return;
    const RADIUS = 120;
    document.querySelectorAll('.section').forEach(section => {
        // Heads not yet split. The .stats-total-num figures start as a "-" placeholder
        // and are filled after a fetch, so skip them until the real number lands - the
        // /stats render calls this again then, and the fresh letters join this same
        // (persistent) array, so the proximity closures below animate them with no
        // re-binding.
        const fresh = [...section.querySelectorAll('.section-num, .section-kicker, .section-head, .stats-total-num')]
            .filter(el => !el._anrFxSplit &&
            !(el.classList.contains('stats-total-num') && el.textContent.trim() === '-'));
        if (!fresh.length)
            return;
        const letters = section._anrFxLetters || (section._anrFxLetters = []);
        fresh.forEach(el => {
            el._anrFxSplit = true;
            const base = parseInt(getComputedStyle(el).fontWeight, 10) || 400;
            letters.push(...splitText(el, base));
        });
        // New letters joined the effect - force a width re-measure on the next hover.
        section._anrFxMeasuredW = -1;
        if (section._anrSectionFx)
            return; // listeners already bound on a prior call
        section._anrSectionFx = true;
        // Freeze layout during hover. Changing a letter's weight changes its glyph
        // advance, which would otherwise reflow the heading as the cursor moves. Lock
        // each LETTER (not each word) to its base-weight width - measured once on first
        // hover via the sub-pixel rect (offsetWidth's integer rounding was enough to let
        // a word slip onto another line), the widest state since the effect only
        // lightens. The glyph then thins inside its own fixed box, so neither letters,
        // words, nor lines ever move, and no slack piles up at a word's end as a stray
        // gap. Released on settle so the heading stays freely responsive when idle.
        // Re-measure whenever the window width changed since the last measurement -
        // the heading font-size is responsive, so widths baked at one window size would
        // be stale (and, locked per-letter, make glyph boxes overlap) after a resize.
        // A hover after a resize finds the letters at rest at base weight, so measuring
        // then is safe.
        const lockWidths = () => {
            if (section._anrFxMeasuredW !== window.innerWidth) {
                for (const l of letters)
                    l.w = l.el.getBoundingClientRect().width;
                section._anrFxMeasuredW = window.innerWidth;
            }
            for (const l of letters)
                l.el.style.width = l.w + 'px';
        };
        const unlockWidths = () => { for (const l of letters)
            l.el.style.width = ''; };
        let mx = -9999, my = -9999, inside = false, raf = 0, running = false, fxT = 0;
        // Read all centres, then write all weights - see the note on readCentres()
        // in the section-heading effect above. Interleaved, this forced one
        // full-document layout per letter per frame.
        const cxs = [], cys = [];
        const readCentres = () => {
            for (let i = 0; i < letters.length; i++) {
                const r = letters[i].el.getBoundingClientRect();
                cxs[i] = r.left + r.width / 2;
                cys[i] = r.top + r.height / 2;
            }
        };
        const weight = (l, cx, cy) => {
            const t = inside ? Math.min(1, Math.hypot(mx - cx, my - cy) / RADIUS) : 1;
            return Math.round(l.base * t + 300 * (1 - t));
        };
        const settle = () => {
            clearTimeout(fxT);
            for (const l of letters) {
                l.el.style.transition = 'font-weight 0.4s ease';
                l.el.style.fontWeight = l.base;
            }
            // Release the width locks only after letters have eased back to base weight,
            // so removing them can't itself cause a reflow.
            fxT = setTimeout(() => { for (const l of letters)
                l.el.style.transition = ''; unlockWidths(); }, 500);
        };
        const frame = () => {
            if (inside) {
                readCentres();
                for (let i = 0; i < letters.length; i++) {
                    letters[i].el.style.fontWeight = weight(letters[i], cxs[i], cys[i]);
                }
                raf = requestAnimationFrame(frame);
            }
            else {
                // Leave letters at their last hover weight so settle() can ease them
                // back over 0.4s rather than snapping straight to base.
                running = false;
                settle();
            }
        };
        section.addEventListener('mouseenter', () => {
            if (a11yOn())
                return;
            lockWidths(); // measure/apply base widths before any weight change
            inside = true;
            // Ease the letters in on entry, then drop the transition so tracking is instant.
            clearTimeout(fxT);
            for (const l of letters)
                l.el.style.transition = 'font-weight 0.18s ease';
            fxT = setTimeout(() => { for (const l of letters)
                l.el.style.transition = ''; }, 200);
            if (!running) {
                running = true;
                raf = requestAnimationFrame(frame);
            }
        });
        section.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
        section.addEventListener('mouseleave', () => { inside = false; });
    });
}
// Footer heading hover effect. The same per-letter "thin toward the cursor" feel
// as the section headings, applied to the footer's "Everything runs in your
// browser." mark. Desktop fine-pointer only; re-runs per navigation (the footer
// is swapped each time) and guards on the mark so it binds once per element.
export function setupFooterFx() {
    if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches)
        return;
    const mark = document.querySelector('.footer-mark');
    if (mark)
        bindLetterFx(mark);
}
// 404 page: the big "404" numeral answers the cursor like the "Analyser" header
// title - the same intro sweep + hover controller (bindSweepFx). The radius is
// kept just above one digit's width so the thinning falls off across its
// neighbours (a proximity gradient) rather than lightening all three at once, and
// the sweep is quicker so it reads as a pass across a short numeral, not a glow.
export function setupNotFoundFx() {
    const code = document.querySelector('.notfound-code');
    if (!code || code._anrFx)
        return;
    const letters = splitFrozen([{ el: code, weight: 600 }]);
    bindSweepFx(code, letters, { ivHolder: setupNotFoundFx, radiusHover: 160, radiusTouch: 130, sweepDuration: 1800 });
}
// Per-letter "thin toward the cursor" hover on the catalog group headers
// (.fmt-section-label) - the supported-formats popup, the about page list and the
// /formats hub all share this class - so they answer the cursor exactly like the
// site title and the footer mark. Each label is bound independently (like the
// footer mark) and guarded per element, so repeated boots / overlay opens never
// double-bind. The "N formats" note is lifted out before the split so it keeps its
// own lighter weight and muted colour, then put back after the letters.
export function setupFmtHeaderFx(root = document) {
    if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches)
        return;
    root.querySelectorAll('.fmt-section-label').forEach((label) => {
        if (label._anrLetterFx)
            return;
        const note = label.querySelector('.fmt-section-note');
        if (note)
            note.remove();
        bindLetterFx(label);
        if (note)
            label.appendChild(note);
    });
}
// Bind the per-letter proximity hover to a single element. Splits its text into
// letters and tracks the cursor, thinning glyphs toward it. Guarded per element.
function bindLetterFx(mark) {
    if (!mark || mark._anrLetterFx)
        return;
    mark._anrLetterFx = true;
    const RADIUS = 120;
    const base = parseInt(getComputedStyle(mark).fontWeight, 10) || 400;
    const letters = splitText(mark, base);
    let measuredW = -1;
    // Same reflow guard as the section effect: lock each letter to its base-weight
    // width (re-measured on a resize) so thinning a glyph never reflows the line.
    const lockWidths = () => {
        if (measuredW !== window.innerWidth) {
            for (const l of letters)
                l.w = l.el.getBoundingClientRect().width;
            measuredW = window.innerWidth;
        }
        for (const l of letters)
            l.el.style.width = l.w + 'px';
    };
    const unlockWidths = () => { for (const l of letters)
        l.el.style.width = ''; };
    let mx = -9999, my = -9999, inside = false, raf = 0, running = false, fxT = 0;
    // Read all centres, then write all weights - see the note on readCentres() in
    // the section-heading effect above.
    const cxs = [], cys = [];
    const readCentres = () => {
        for (let i = 0; i < letters.length; i++) {
            const r = letters[i].el.getBoundingClientRect();
            cxs[i] = r.left + r.width / 2;
            cys[i] = r.top + r.height / 2;
        }
    };
    const weight = (l, cx, cy) => {
        const t = inside ? Math.min(1, Math.hypot(mx - cx, my - cy) / RADIUS) : 1;
        return Math.round(l.base * t + 300 * (1 - t));
    };
    const settle = () => {
        clearTimeout(fxT);
        for (const l of letters) {
            l.el.style.transition = 'font-weight 0.4s ease';
            l.el.style.fontWeight = l.base;
        }
        fxT = setTimeout(() => { for (const l of letters)
            l.el.style.transition = ''; unlockWidths(); }, 500);
    };
    const frame = () => {
        if (inside) {
            readCentres();
            for (let i = 0; i < letters.length; i++) {
                letters[i].el.style.fontWeight = weight(letters[i], cxs[i], cys[i]);
            }
            raf = requestAnimationFrame(frame);
        }
        else {
            running = false;
            settle();
        }
    };
    mark.addEventListener('mouseenter', () => {
        if (a11yOn())
            return;
        lockWidths();
        inside = true;
        clearTimeout(fxT);
        for (const l of letters)
            l.el.style.transition = 'font-weight 0.18s ease';
        fxT = setTimeout(() => { for (const l of letters)
            l.el.style.transition = ''; }, 200);
        if (!running) {
            running = true;
            raf = requestAnimationFrame(frame);
        }
    });
    mark.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
    mark.addEventListener('mouseleave', () => { inside = false; });
}
//# sourceMappingURL=effects.js.map