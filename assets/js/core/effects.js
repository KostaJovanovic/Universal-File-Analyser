/* Analyser - header & section letter-hover effects.
   The "letters thin toward the cursor" effect on the site title/byline (with an
   intro sweep) and on each section heading. Split out of app.js; boot() calls
   setupHeaderFx()/setupSectionFx() per navigation. Dependency-free (DOM only). */

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
  let word = null;  // current per-word wrapper; null between words
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
    word = null;  // never carry a word across a child-element boundary (e.g. the byline <a>)
    if (node.nodeType === 3) {
      for (const ch of node.textContent) makeSpan(ch, container);
    } else {
      const text = node.textContent;
      node.textContent = '';
      container.appendChild(node);
      for (const ch of text) makeSpan(ch, node);
    }
    word = null;
  }
  return spans;
}

// Header letter-proximity / sweep effect. Re-runs per navigation because
// navigate.js swaps .site-mark (so the title text changes between pages); the
// guard on the element keeps it from binding twice to the same header.
export function setupHeaderFx() {
  const mark = document.querySelector('.site-mark');
  const title = document.querySelector('.site-title');
  const byline = document.querySelector('.site-byline');
  if (!mark || !title || !byline || mark._anrFx) return;
  mark._anrFx = true;
  if (setupHeaderFx._iv) clearInterval(setupHeaderFx._iv);

    // letters are split via the shared module-level splitText() defined above.
    function initLetters() {
      title.style.width = title.offsetWidth + 'px';
      title.style.height = title.offsetHeight + 'px';
      byline.style.width = byline.offsetWidth + 'px';
      byline.style.height = byline.offsetHeight + 'px';
      const letters = [
        ...splitText(title, 600),
        ...splitText(byline, 700)
      ];
      title.style.width = '';
      title.style.height = '';
      byline.style.width = '';
      byline.style.height = '';
      return letters;
    }

    // Unified proximity controller. A single RAF loop drives both the intro
    // "sweep" (a virtual cursor gliding across the header) and the real mouse
    // hover. They run together: per letter we take whichever pulls it lighter
    // (the smaller t), so hovering during the sweep no longer cancels it.
    const RADIUS_HOVER = 120, RADIUS_TOUCH = 80;
    const letters = initLetters();
    let mx = -9999, my = -9999, inside = false;
    let sweep = null;                 // { t0, duration, sx, ex, cy, vx, radius } | null
    let raf = 0, running = false, fxT = 0;

    function letterWeight(l) {
      const r = l.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let t = 1;
      if (inside) t = Math.min(t, Math.hypot(mx - cx, my - cy) / RADIUS_HOVER);
      if (sweep)  t = Math.min(t, Math.hypot(sweep.vx - cx, sweep.cy - cy) / sweep.radius);
      t = Math.min(1, t);
      return Math.round(l.base * t + 300 * (1 - t));
    }
    function frame(ts) {
      if (sweep) {
        if (sweep.t0 == null) sweep.t0 = ts;
        const p = Math.min(1, (ts - sweep.t0) / sweep.duration);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        sweep.vx = sweep.sx + e * (sweep.ex - sweep.sx);
        if (p >= 1) sweep = null;
      }
      if (inside || sweep) {
        for (const l of letters) l.el.style.fontWeight = letterWeight(l);
        raf = requestAnimationFrame(frame);
      } else {
        // Don't overwrite to base here - leave the letters at their last hover
        // weight so settle() can ease them back over 0.4s instead of snapping.
        running = false;
        settle();
      }
    }
    function ensureRunning() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function settle() {
      clearTimeout(fxT);
      for (const l of letters) { l.el.style.transition = 'font-weight 0.4s ease'; l.el.style.fontWeight = l.base; }
      fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; }, 500);
    }
    function startSweep(radius) {
      const rect = mark.getBoundingClientRect();
      sweep = { t0: null, duration: 3500, sx: rect.left - radius, ex: rect.right + radius,
                cy: rect.top + rect.height / 2, vx: rect.left - radius, radius };
      ensureRunning();
    }

    if (window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
      const activateHover = () => {
        if (!inside) {
          inside = true;
          // Ease the letters into their hover weight on entry, then drop the
          // transition so subsequent cursor tracking stays instant (no lag).
          clearTimeout(fxT);
          for (const l of letters) l.el.style.transition = 'font-weight 0.18s ease';
          fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; }, 200);
        }
        ensureRunning();
      };
      mark.addEventListener('mouseenter', activateHover);
      // Also activate on mousemove: mousemove only fires while the pointer is over
      // the header, so this catches the case where the cursor was already inside
      // when the page loaded (or during the intro sweep), when mouseenter never
      // fires and hover would otherwise stay dead until you leave and re-enter.
      mark.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; activateHover(); });
      mark.addEventListener('mouseleave', () => { inside = false; });  // settles once the sweep also ends
      setTimeout(() => startSweep(RADIUS_HOVER), 800);
    } else if (window.matchMedia('(pointer: coarse)').matches) {
      setTimeout(() => startSweep(RADIUS_TOUCH), 800);
      setupHeaderFx._iv = setInterval(() => startSweep(RADIUS_TOUCH), 8000);
    }
}

// Section-heading hover effect. Reuses the header's "letters thin toward the
// cursor" feel on each section's number / kicker / heading - but hover-only,
// with NO intro sweep (no "wave"). Desktop fine-pointer only. Re-runs per
// navigation; the per-section guard keeps it from binding twice. Each section is
// independent, so hovering section 01 never disturbs section 02.
export function setupSectionFx() {
  if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
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
    if (!fresh.length) return;

    const letters = section._anrFxLetters || (section._anrFxLetters = []);
    fresh.forEach(el => {
      el._anrFxSplit = true;
      const base = parseInt(getComputedStyle(el).fontWeight, 10) || 400;
      letters.push(...splitText(el, base));
    });
    // New letters joined the effect - force a width re-measure on the next hover.
    section._anrFxMeasuredW = -1;

    if (section._anrSectionFx) return;   // listeners already bound on a prior call
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
        for (const l of letters) l.w = l.el.getBoundingClientRect().width;
        section._anrFxMeasuredW = window.innerWidth;
      }
      for (const l of letters) l.el.style.width = l.w + 'px';
    };
    const unlockWidths = () => { for (const l of letters) l.el.style.width = ''; };

    let mx = -9999, my = -9999, inside = false, raf = 0, running = false, fxT = 0;
    const weight = (l) => {
      const r = l.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const t = inside ? Math.min(1, Math.hypot(mx - cx, my - cy) / RADIUS) : 1;
      return Math.round(l.base * t + 300 * (1 - t));
    };
    const settle = () => {
      clearTimeout(fxT);
      for (const l of letters) { l.el.style.transition = 'font-weight 0.4s ease'; l.el.style.fontWeight = l.base; }
      // Release the width locks only after letters have eased back to base weight,
      // so removing them can't itself cause a reflow.
      fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; unlockWidths(); }, 500);
    };
    const frame = () => {
      if (inside) {
        for (const l of letters) l.el.style.fontWeight = weight(l);
        raf = requestAnimationFrame(frame);
      } else {
        // Leave letters at their last hover weight so settle() can ease them
        // back over 0.4s rather than snapping straight to base.
        running = false;
        settle();
      }
    };
    section.addEventListener('mouseenter', () => {
      lockWidths();                 // measure/apply base widths before any weight change
      inside = true;
      // Ease the letters in on entry, then drop the transition so tracking is instant.
      clearTimeout(fxT);
      for (const l of letters) l.el.style.transition = 'font-weight 0.18s ease';
      fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; }, 200);
      if (!running) { running = true; raf = requestAnimationFrame(frame); }
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
  if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  const mark = document.querySelector('.footer-mark');
  if (mark) bindLetterFx(mark);
}

// Per-letter "thin toward the cursor" hover on the catalog group headers
// (.fmt-section-label) - the supported-formats popup, the about page list and the
// /formats hub all share this class - so they answer the cursor exactly like the
// site title and the footer mark. Each label is bound independently (like the
// footer mark) and guarded per element, so repeated boots / overlay opens never
// double-bind. The "N formats" note is lifted out before the split so it keeps its
// own lighter weight and muted colour, then put back after the letters.
export function setupFmtHeaderFx(root = document) {
  if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  root.querySelectorAll('.fmt-section-label').forEach((label) => {
    if (label._anrLetterFx) return;
    const note = label.querySelector('.fmt-section-note');
    if (note) note.remove();
    bindLetterFx(label);
    if (note) label.appendChild(note);
  });
}

// Bind the per-letter proximity hover to a single element. Splits its text into
// letters and tracks the cursor, thinning glyphs toward it. Guarded per element.
function bindLetterFx(mark) {
  if (!mark || mark._anrLetterFx) return;
  mark._anrLetterFx = true;

  const RADIUS = 120;
  const base = parseInt(getComputedStyle(mark).fontWeight, 10) || 400;
  const letters = splitText(mark, base);
  let measuredW = -1;

  // Same reflow guard as the section effect: lock each letter to its base-weight
  // width (re-measured on a resize) so thinning a glyph never reflows the line.
  const lockWidths = () => {
    if (measuredW !== window.innerWidth) {
      for (const l of letters) l.w = l.el.getBoundingClientRect().width;
      measuredW = window.innerWidth;
    }
    for (const l of letters) l.el.style.width = l.w + 'px';
  };
  const unlockWidths = () => { for (const l of letters) l.el.style.width = ''; };

  let mx = -9999, my = -9999, inside = false, raf = 0, running = false, fxT = 0;
  const weight = (l) => {
    const r = l.el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const t = inside ? Math.min(1, Math.hypot(mx - cx, my - cy) / RADIUS) : 1;
    return Math.round(l.base * t + 300 * (1 - t));
  };
  const settle = () => {
    clearTimeout(fxT);
    for (const l of letters) { l.el.style.transition = 'font-weight 0.4s ease'; l.el.style.fontWeight = l.base; }
    fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; unlockWidths(); }, 500);
  };
  const frame = () => {
    if (inside) {
      for (const l of letters) l.el.style.fontWeight = weight(l);
      raf = requestAnimationFrame(frame);
    } else {
      running = false;
      settle();
    }
  };
  mark.addEventListener('mouseenter', () => {
    lockWidths();
    inside = true;
    clearTimeout(fxT);
    for (const l of letters) l.el.style.transition = 'font-weight 0.18s ease';
    fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; }, 200);
    if (!running) { running = true; raf = requestAnimationFrame(frame); }
  });
  mark.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
  mark.addEventListener('mouseleave', () => { inside = false; });
}
