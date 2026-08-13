/* Analyser - shared HTML / URL sanitiser
   ============================================================================
   Several viewers show markup that came out of an untrusted dropped file - an
   email body (email.js), a saved web page inside an MHTML archive (textdoc.js),
   an EPUB chapter (epub.js), an SVG document (svg.js). All of it is rendered
   INLINE, in the page's own origin, and the site ships no Content-Security-
   Policy (see web/_headers for why), so the sanitiser here is the only thing
   standing between a crafted file and script execution.

   This module is the single implementation. It used to be four near-copies that
   had drifted apart, and the weaker ones carried a bypass the strongest one had
   already fixed - see the note on urlScheme() below.

   Two guarantees the viewers rely on:
     - nothing executes: no <script>, no on* handlers, no scheme-based script
       URLs (javascript:, vbscript:, data:text/html);
     - nothing phones home: every attribute that would make the browser fetch a
       remote resource is stripped, so previewing a file stays consistent with
       the app's "uploads nothing, requests nothing" promise.
   ============================================================================ */
// Elements removed outright. <style> goes because an inline stylesheet is NOT
// scoped to the fragment - its rules apply document-wide (CSS injection / UI
// redress) and can pull remote fonts and images via url()/@import. <base> and
// <meta> go because either can redirect or re-target the whole page.
//
// The SMIL group at the end is the one that is easy to miss: the attribute scan
// below is STATIC, so it can only judge the values a document carries at sanitise
// time. <animate attributeName="href" to="javascript:..."> carries no URL in any
// attribute the scan inspects - it installs one AFTER insertion, at which point
// clicking the parent <a> executes it. So the animation elements go outright
// rather than being reasoned about. (svg.js:sanitizeSvg strips exactly the same
// set for exactly this reason; if you change one, change both.)
const DROP_ELEMENTS = 'script, style, link, meta, iframe, frame, frameset, object, embed, applet, noscript, base, title,'
    + ' animate, animateMotion, animateTransform, set';
// Attributes that make the browser fetch something. Removed unless the caller
// opts into remote content (no viewer does today).
const NETWORK_ATTRS = new Set(['src', 'srcset', 'background', 'poster', 'lowsrc', 'ping', 'data', 'imagesrcset']);
// Attributes holding a URL that stays navigable, so they get a scheme check
// rather than outright removal.
const URL_ATTRS = new Set(['href', 'xlink:href', 'action', 'formaction']);
const SAFE_SCHEMES = /^(?:https?|mailto|tel)$/;
/* Return the lower-cased URL scheme of `value`, or null if it has none
   (relative paths and #anchors have none, and are always safe).

   The leading strip is the important part. The browser's URL parser removes
   ASCII whitespace and control characters from a scheme before acting on it, so
   `java&#9;script:alert(1)` - which the HTML parser hands us as the literal
   string "java\tscript:alert(1)" - IS executed on click, while the obvious
   /^\s*javascript:/i test misses it (the tab sits at index 4, not the start).
   Normalising the same way the browser does, then allow-listing the result, is
   what closes that hole. Allow-list, never deny-list: data:, blob:, vbscript:,
   filesystem: and friends are all script or exfiltration vectors. */
export function urlScheme(value) {
    const cleaned = String(value == null ? '' : value).replace(/[\x00-\x20]+/g, '');
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
    return m ? m[1].toLowerCase() : null;
}
/* True if `value` carries a scheme that is not on the allow-list. Relative and
   anchor URLs return false (safe). Exported for svg.js, which does its own
   element-level walk but needs the same scheme decision. */
export function isUnsafeUrl(value, allowed = SAFE_SCHEMES) {
    const scheme = urlScheme(value);
    return scheme != null && !allowed.test(scheme);
}
/* Sanitise an already-parsed document IN PLACE and return the element whose
   children are the safe content. Callers normally want sanitizeHtml() below;
   this is the entry point for viewers that had to parse the markup themselves
   (epub.js parses as application/xhtml+xml first).

   opts.allowRemote - keep network-loading attributes (default false).
   opts.className   - class for the returned wrapper div. */
export function sanitizeDoc(doc, opts = {}) {
    const { allowRemote = false, className = '' } = opts;
    const root = doc.body || doc.documentElement;
    const wrapper = document.createElement('div');
    if (className)
        wrapper.className = className;
    if (!root)
        return wrapper;
    root.querySelectorAll(DROP_ELEMENTS).forEach((n) => n.remove());
    for (const node of root.querySelectorAll('*')) {
        for (const attr of [...node.attributes]) {
            const name = attr.name.toLowerCase();
            const val = attr.value;
            // Event handlers. Covers on* in every namespace.
            if (name.startsWith('on')) {
                node.removeAttribute(attr.name);
                continue;
            }
            if (URL_ATTRS.has(name)) {
                // An href only stays navigable on something the user can actually follow.
                // On <use>/<image> and friends the same attribute is a FETCH, so an
                // https: value there is a silent call home - allowed by the scheme
                // allow-list below, but exactly what NETWORK_ATTRS exists to prevent.
                // Judge those by whether the value would hit the network at all, which
                // leaves relative paths and #fragment refs (how an SVG points at its own
                // <defs>) working untouched.
                const navigable = name === 'action' || name === 'formaction'
                    || node.localName === 'a' || node.localName === 'area';
                if (!navigable && !allowRemote) {
                    const scheme = urlScheme(val);
                    const protocolRelative = /^\/\//.test(String(val).replace(/[\x00-\x20]+/g, ''));
                    if (scheme === 'http' || scheme === 'https' || protocolRelative) {
                        node.removeAttribute(attr.name);
                        continue;
                    }
                }
                if (isUnsafeUrl(val))
                    node.removeAttribute(attr.name);
                continue;
            }
            if (NETWORK_ATTRS.has(name)) {
                if (!allowRemote)
                    node.removeAttribute(attr.name);
                else if (isUnsafeUrl(val))
                    node.removeAttribute(attr.name);
                continue;
            }
            // Inline style is kept for layout fidelity, but only when it cannot pull a
            // remote resource. url() also covers the CSS-only script vectors (-moz-
            // binding, behavior) since those need a URL to point at.
            if (name === 'style' && /url\s*\(|@import/i.test(val))
                node.removeAttribute(attr.name);
        }
        // A surviving link that opens a new context gets the opener severed, so the
        // previewed document can never reach back into this page via window.opener.
        if (node.hasAttribute('target'))
            node.setAttribute('rel', 'noopener noreferrer');
    }
    for (const child of [...root.childNodes])
        wrapper.appendChild(child);
    return wrapper;
}
/* Parse an HTML string and return a wrapper div holding its sanitised content. */
export function sanitizeHtml(html, opts = {}) {
    const doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
    return sanitizeDoc(doc, opts);
}
//# sourceMappingURL=sanitize.js.map