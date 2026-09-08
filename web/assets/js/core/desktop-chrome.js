/* Analyser - the desktop window's own title bar.
 *
 * The Electron shell runs frameless off macOS (desktop/main.mjs), so this draws
 * the whole thing: identity, the current section, the application-menu button
 * and the minimise / maximise / close controls. It is the one module in src/
 * that exists only for the desktop, because the alternative was a title bar
 * duplicated across core/app.ts and core/docs.ts - the two entry points the
 * desktop can land on. Everything else desktop-specific stays a guarded branch
 * in the module that owns the behaviour (see src/CLAUDE.md).
 *
 * Nothing here runs in a browser: both callers wrap the import in
 * `if (window.anrDesktop)`, so the website never even fetches the file.
 *
 * The markup is static and authored here - no file-derived string reaches it,
 * so it needs nothing from core/sanitize.js.
 *
 * Styles: the DESKTOP TITLE BAR block at the end of assets/css/analyser.css,
 * all of it scoped under `html.anr-desktop`.
 */
/** The label shown next to the wordmark. Prefixes matter for the two generated
 *  trees, where /formats/png and /docs/faq are still Formats and Docs. */
const SECTIONS = [
    ['/formats', 'Formats'],
    ['/docs', 'Docs'],
    ['/patch', 'Changelog'],
    ['/about', 'About'],
    ['/stats', 'Statistics'],
    ['/samples', 'Samples'],
    ['/compare', 'Compare'],
    ['/privacy', 'Privacy'],
    ['/test', 'Style guide'],
    ['/atari', 'Asteroids'],
];
function sectionLabel() {
    const p = location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    if (p === '/' || p === '/index')
        return 'Home';
    for (const [prefix, label] of SECTIONS) {
        if (p === prefix || p.startsWith(prefix + '/'))
            return label;
    }
    return p.split('/').filter(Boolean).pop() || 'Home';
}
/* Window-control glyphs.
 *
 * On Windows these are the SYSTEM ones - the Segoe Fluent Icons (Windows 11) /
 * Segoe MDL2 Assets (Windows 10) codepoints every native title bar draws, so
 * the controls are pixel-identical to the ones next to them on the taskbar and
 * are correctly weighted at every DPI. Hand-drawing them is what produced a
 * lopsided close cross: a 1px diagonal under shape-rendering: crispEdges gets
 * snapped one way at one end and the other way at the other.
 *
 * Elsewhere those fonts do not exist, so a small SVG set stands in. Its
 * axis-aligned strokes sit on half-pixels to stay crisp, and the cross is left
 * on the default shape-rendering - the snapping is exactly what broke it. */
const WIN_GLYPH = {
    // Each value is ONE private-use character, so these read as empty strings in
    // most editors. The codepoint is on the line - check it before retyping one.
    menu: '', // U+E700  GlobalNavButton
    min: '', // U+E921  ChromeMinimize
    max: '', // U+E922  ChromeMaximize
    restore: '', // U+E923  ChromeRestore
    close: '', // U+E8BB  ChromeClose
};
const SVG_GLYPH = {
    menu: '<path d="M1 2.5h10M1 6h10M1 9.5h10"/>',
    min: '<path d="M1 6.5h10"/>',
    max: '<rect x="1.5" y="1.5" width="9" height="9"/>',
    restore: '<path d="M3.5 3.5v-2h7v7h-2"/><rect x="1.5" y="3.5" width="7" height="7"/>',
    close: '<path d="M2 2 10 10M10 2 2 10"/>',
};
/** One glyph as markup. `extraClass` is what lets the CSS swap maximise for
 *  restore without rebuilding the button. */
function icon(name, useFont, extraClass = '') {
    const cls = 'anr-tb-ico' + (extraClass ? ' ' + extraClass : '');
    if (useFont)
        return `<span class="${cls} anr-tb-ico--font" aria-hidden="true">${WIN_GLYPH[name]}</span>`;
    return `<svg class="${cls}" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"`
        + ` fill="none" stroke="currentColor" stroke-width="1">${SVG_GLYPH[name]}</svg>`;
}
function button(cls, label, inner) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'anr-tb-btn ' + cls;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = inner;
    return b;
}
/** Mirror the window state onto <html> so the CSS can react to all of it: the
 *  maximise glyph, the recessed unfocused bar, and hiding the bar outright in
 *  full screen. */
function applyState(s) {
    const c = document.documentElement.classList;
    c.toggle('anr-win-max', !!s.maximized);
    c.toggle('anr-win-full', !!s.fullScreen);
    c.toggle('anr-win-focused', !!s.focused);
}
/**
 * Build the title bar and put it at the top of the document. Safe to call on
 * every boot: an SPA swap replaces the page's body content, so the guard below
 * re-mounts rather than stacking a second bar.
 */
export function mountDesktopChrome() {
    const desk = window.anrDesktop;
    if (!desk || !desk.win || !document.body)
        return;
    const root = document.documentElement;
    root.classList.add('anr-desktop');
    if (desk.platform === 'darwin')
        root.classList.add('anr-desktop--mac');
    // Only Windows ships the Segoe icon fonts the system glyphs live in.
    const useFont = desk.platform === 'win32';
    // By ID, not by class. /test demonstrates .anr-titlebar and .anr-scrollbar as
    // static markup, and a class selector would find a DEMO first and then hoist
    // it out of its section on the next boot.
    const existing = document.getElementById('anrTitlebar');
    if (existing) {
        // Survived the swap. Only the section label can have gone stale.
        const sub = existing.querySelector('.anr-tb-sub');
        if (sub)
            sub.textContent = sectionLabel();
        if (existing !== document.body.firstElementChild)
            document.body.prepend(existing);
        mountScrollbar();
        return;
    }
    const bar = document.createElement('div');
    bar.id = 'anrTitlebar';
    bar.className = 'anr-titlebar';
    const menuBtn = button('anr-tb-menu', 'Application menu', icon('menu', useFont) + '<span>Menu</span>');
    // Popped from the button's bottom-left corner, so it hangs off the bar the
    // way a menu bar's would. Page coordinates - main converts for page zoom.
    menuBtn.addEventListener('click', () => {
        const r = menuBtn.getBoundingClientRect();
        desk.win.menu(Math.round(r.left), Math.round(r.bottom));
    });
    const brand = document.createElement('div');
    brand.className = 'anr-tb-brand';
    brand.innerHTML = '<span class="anr-tb-mark"></span><span>Analyser</span>';
    const sub = document.createElement('div');
    sub.className = 'anr-tb-sub';
    sub.textContent = sectionLabel();
    const space = document.createElement('div');
    space.className = 'anr-tb-space';
    const ctl = document.createElement('div');
    ctl.className = 'anr-tb-ctl';
    const minBtn = button('anr-tb-min', 'Minimise', icon('min', useFont));
    const maxBtn = button('anr-tb-max', 'Maximise', icon('max', useFont, 'anr-tb-ico-max') + icon('restore', useFont, 'anr-tb-ico-restore'));
    const closeBtn = button('anr-tb-close', 'Close', icon('close', useFont));
    minBtn.addEventListener('click', () => { desk.win.minimize(); });
    maxBtn.addEventListener('click', () => { desk.win.toggleMaximize(); });
    closeBtn.addEventListener('click', () => { desk.win.close(); });
    ctl.append(minBtn, maxBtn, closeBtn);
    bar.append(menuBtn, brand, sub, space, ctl);
    document.body.prepend(bar);
    mountScrollbar();
    desk.win.onStateChange(applyState);
    applyState(desk.win.state());
}
/* ---------------------------------------------------------------------------
 * The page scrollbar
 *
 * The native one is the full height of the VIEWPORT, and nothing in CSS can
 * shorten it, so it runs up behind the title bar and cuts the bar's line at the
 * right-hand end. The only fix that keeps `window` as the scrolling element -
 * and therefore keeps window.scrollY, every scroll listener and all 22
 * scrollIntoView calls behaving exactly as they do on the website - is to hide
 * the native bar and draw one, starting below the title bar.
 *
 * This is the same trick the spectrogram already uses (.anr-spec-sb), and it
 * covers the ROOT scroller only: inner panes keep the ::-webkit-scrollbar
 * styling from analyser.css, which is drawn to match.
 * ------------------------------------------------------------------------- */
/** Shortest thumb worth dragging, whatever the page height. */
const THUMB_MIN = 28;
function mountScrollbar() {
    if (document.getElementById('anrScrollbar'))
        return; // by ID - see mountDesktopChrome
    const rail = document.createElement('div');
    rail.id = 'anrScrollbar';
    rail.className = 'anr-scrollbar';
    const thumb = document.createElement('div');
    thumb.className = 'anr-scrollbar-thumb';
    rail.appendChild(thumb);
    document.body.appendChild(rail);
    let railH = 0, thumbH = 0, range = 0;
    const measure = () => {
        const doc = document.documentElement;
        // The scrollport is the whole viewport - the title bar overlays it and body
        // reserves the room with padding, so innerHeight is the right divisor.
        const view = window.innerHeight;
        range = Math.max(0, doc.scrollHeight - view);
        railH = rail.clientHeight;
        if (range < 1 || railH < 1) {
            rail.classList.add('is-idle');
            return;
        }
        rail.classList.remove('is-idle');
        thumbH = Math.max(THUMB_MIN, Math.round(railH * (view / doc.scrollHeight)));
        thumb.style.height = thumbH + 'px';
    };
    const draw = () => {
        if (range < 1)
            return;
        const t = Math.min(1, Math.max(0, window.scrollY / range));
        thumb.style.transform = 'translateY(' + Math.round((railH - thumbH) * t) + 'px)';
    };
    // One rAF per frame at most: scroll fires far faster than the compositor.
    let queued = false;
    const schedule = (remeasure) => {
        if (remeasure)
            measure();
        if (queued)
            return;
        queued = true;
        requestAnimationFrame(() => { queued = false; draw(); });
    };
    window.addEventListener('scroll', () => schedule(false), { passive: true });
    window.addEventListener('resize', () => schedule(true), { passive: true });
    // Analysis results are injected long after load, and a renderer can grow the
    // page by tens of screens, so the content height has to be watched, not read
    // once. Observing body rather than documentElement: html's box does not
    // change when body's content does.
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => schedule(true)).observe(document.body);
    }
    /* Drag. Pointer capture rather than document-level listeners, so a fast drag
       that leaves the rail keeps tracking and releases cleanly. */
    let grabOffset = 0;
    thumb.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || range < 1)
            return;
        e.preventDefault();
        grabOffset = e.clientY - thumb.getBoundingClientRect().top;
        thumb.setPointerCapture(e.pointerId);
        rail.classList.add('is-dragging');
    });
    thumb.addEventListener('pointermove', (e) => {
        if (!thumb.hasPointerCapture(e.pointerId) || range < 1)
            return;
        const top = e.clientY - rail.getBoundingClientRect().top - grabOffset;
        const span = railH - thumbH;
        window.scrollTo(0, span > 0 ? (Math.min(span, Math.max(0, top)) / span) * range : 0);
    });
    const endDrag = (e) => {
        if (thumb.hasPointerCapture(e.pointerId))
            thumb.releasePointerCapture(e.pointerId);
        rail.classList.remove('is-dragging');
    };
    thumb.addEventListener('pointerup', endDrag);
    thumb.addEventListener('pointercancel', endDrag);
    /* Clicking the track jumps a screen towards the click, the way a native
       scrollbar does - not to the click position, which would be a surprise on a
       long page. */
    rail.addEventListener('pointerdown', (e) => {
        if (e.target !== rail || range < 1)
            return;
        const above = e.clientY < thumb.getBoundingClientRect().top;
        window.scrollBy({ top: (above ? -1 : 1) * window.innerHeight * 0.9, behavior: 'smooth' });
    });
    schedule(true);
}
//# sourceMappingURL=desktop-chrome.js.map