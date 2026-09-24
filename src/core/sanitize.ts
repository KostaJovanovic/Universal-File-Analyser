/* Analyser - shared HTML / URL sanitiser
   ============================================================================
   Several viewers show markup that came out of an untrusted dropped file - an
   email body (email.js), a saved web page inside an MHTML archive (textdoc.js),
   an EPUB chapter (epub.js), an SVG document (svg.js) and the SVG LibreDWG
   draws from a DWG (dwg.js, via svg.js). All of it is rendered
   INLINE, in the page's own origin, and the site ships no Content-Security-
   Policy (see web/_headers for why), so the sanitiser here is the only thing
   standing between a crafted file and script execution.

   This module is the single implementation. It used to be four near-copies that
   had drifted apart, and the weaker ones carried a bypass the strongest one had
   already fixed - see the note on urlScheme() below.

   Four guarantees the viewers rely on:
     - nothing executes: no <script>, no on* handlers, no scheme-based script
       URLs (javascript:, vbscript:, data:text/html);
     - nothing phones home: every attribute that would make the browser fetch a
       remote resource is stripped - including CSS url()/image-set() in style
       and in SVG presentation attributes - so previewing a file stays
       consistent with the app's "uploads nothing, requests nothing" promise;
     - nothing reaches the page: ids and names are prefixed (ID_PREFIX) so a
       document cannot clobber window/document globals the app reads (an
       `<div id="anrDesktop">` used to break boot after an SPA return), class
       and data-* attributes go so page CSS and app selectors cannot be
       borrowed, and position:fixed/sticky is removed so a preview cannot
       overlay the site;
     - the result is a DOM, never markup: callers insert the returned nodes.
       Serialising the sanitised tree and re-parsing it (as svg.js used to) is
       how a comment or CDATA section turns back into live elements.
   ============================================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** What sanitizeSvgDoc() removed, for the SVG viewer's Security card. */
export interface SanitizeReport {
  script: number; foreignObject: number; style: number; smil: number; html: number;
  handlers: number; jsLinks: number; extRefs: number; cssRefs: number;
}
interface CleanOpts { allowRemote: boolean; svg: boolean }

/* Every id / name in sanitised content gets this prefix, and every in-document
   reference to one (href="#x", url(#x), usemap, aria-labelledby, label for=,
   ...) is rewritten to match, so fragment links and SVG gradients keep working
   while no document id can ever equal one the app looks up. Exported for
   viewers that resolve a fragment themselves (epub.js). */
export const ID_PREFIX = 'anr-u-';

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
// rather than being reasoned about. The SVG viewer goes through this same list
// (sanitizeSvgDoc below) - there is no second copy any more.
//
// Names are matched on the lower-cased localName in ANY namespace: an XHTML-
// parsed EPUB chapter or an SVG can carry <SCRIPT> or an SVG-namespace <script>,
// and a CSS-selector list would miss the first (XML selectors are case-sensitive).
// <title> is dropped only outside SVG, where it is a harmless tooltip.
const DROP_ELEMENTS = new Set(['script', 'style', 'link', 'meta', 'iframe', 'frame', 'frameset', 'object',
  'embed', 'applet', 'noscript', 'base', 'title', 'template', 'portal', 'fencedframe', 'foreignobject',
  'animate', 'animatemotion', 'animatetransform', 'set', 'discard']);
const SMIL_ELEMENTS = new Set(['animate', 'animatemotion', 'animatetransform', 'set', 'discard']);

// Attributes that make the browser fetch something. Removed unless the caller
// opts into remote content (no viewer does today).
const NETWORK_ATTRS = new Set(['src', 'srcset', 'background', 'poster', 'lowsrc', 'dynsrc', 'ping', 'data',
  'imagesrcset', 'codebase', 'archive']);

// Attributes removed outright on every element. action/formaction would send a
// form typed into the preview anywhere the file likes (a phishing form rendered
// in the site's own origin); srcdoc is a whole document; popover/popovertarget
// put an element in the top layer, above the entire site; accesskey and
// autofocus hijack the keyboard and scroll position.
const DROP_ATTRS = new Set(['action', 'formaction', 'srcdoc', 'popover', 'popovertarget', 'popovertargetaction',
  'command', 'commandfor', 'interestfor', 'accesskey', 'autofocus', 'class', 'is', 'nonce']);

// Attributes whose value is a whitespace-separated list of element ids - these
// follow the ID_PREFIX rewrite so the relationships survive it.
const IDREF_ATTRS = new Set(['for', 'form', 'list', 'headers', 'itemref', 'aria-labelledby', 'aria-describedby',
  'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-flowto', 'aria-details', 'aria-errormessage']);

const SAFE_SCHEMES = /^(?:https?|mailto|tel)$/;

// Inline images an SVG legitimately embeds (<image href="data:image/png;base64,...">).
// Only on a NON-navigable element: they touch no network and render as an image,
// which never runs script, even for image/svg+xml.
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i;

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
export function urlScheme(value: string|null) {
  const cleaned = String(value == null ? '' : value).replace(/[\x00-\x20]+/g, '');
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  return m ? m[1].toLowerCase() : null;
}

/* True if `value` carries a scheme that is not on the allow-list. Relative and
   anchor URLs return false (safe). */
export function isUnsafeUrl(value: string, allowed = SAFE_SCHEMES) {
  const scheme = urlScheme(value);
  return scheme != null && !allowed.test(scheme);
}

/* A zeroed SanitizeReport, for callers that want the counts. */
export function emptySanitizeReport(): SanitizeReport {
  return { script: 0, foreignObject: 0, style: 0, smil: 0, html: 0, handlers: 0, jsLinks: 0, extRefs: 0, cssRefs: 0 };
}

/* True if a CSS value could fetch something. Used on style="" and on every
   attribute of an SVG element, since SVG presentation attributes (fill, stroke,
   filter, mask, clip-path, marker-*, cursor) are parsed as CSS too and
   fill="url(https://...)" is a tracking pixel.

   url() survives only as an in-document #fragment reference - how an SVG points
   at its own gradients and clip paths. Everything else that can name a resource
   goes: image-set()/-webkit-image-set(), src(), image(), @import, and the old
   script-capable -moz-binding / behavior / expression(). */
function cssUnsafe(value: string) {
  const s = value.replace(/\/\*[\s\S]*?\*\//g, '');
  // A CSS escape can spell any of those names (u\72l(, \69mage-set(), so a
  // keyword test means nothing once one appears alongside a function call.
  // Nothing a real document needs combines the two, so reject rather than
  // trying to unescape the way the CSS tokenizer would.
  if (s.indexOf('\\') >= 0 && s.indexOf('(') >= 0) return true;
  if (/@import|image-set\s*\(|\bsrc\s*\(|\bimage\s*\(|element\s*\(|expression\s*\(|-moz-binding|behavior\s*:/i.test(s)) return true;
  const re = /url\s*\(\s*(['"]?)\s*([^)'"\s]*)/gi;
  let m;
  while ((m = re.exec(s))) if (m[2].charAt(0) !== '#') return true;
  return false;
}

// url(#x) -> url(#anr-u-x), matching the ID_PREFIX rewrite of the ids themselves.
function prefixFragments(value: string) {
  return value.replace(/url\(\s*(['"]?)\s*#/gi, 'url($1#' + ID_PREFIX);
}

/* Inline style is kept for layout fidelity, but only when it cannot pull a
   remote resource or lift itself out of the preview. The position/z-index
   edits go through the element's own CSSOM, so they see the value the browser
   will actually apply, however it was spelled. */
function cleanStyle(elt: Element, attr: Attr, rep: SanitizeReport) {
  if (cssUnsafe(attr.value)) { elt.removeAttributeNode(attr); rep.cssRefs++; return; }
  const st = (elt as HTMLElement).style as CSSStyleDeclaration | undefined;
  // An element in an unknown namespace has no inline style to speak of.
  if (!st) { elt.removeAttributeNode(attr); return; }
  // position:fixed/sticky + inset:0 + a big z-index is an overlay over the whole
  // site, drawn in the site's own origin - the shape of a phishing page.
  if (/fixed|sticky/i.test(st.getPropertyValue('position'))) st.removeProperty('position');
  const z = parseInt(st.getPropertyValue('z-index'), 10);
  if (Math.abs(z) > 100) st.removeProperty('z-index');
  const v = elt.getAttribute('style');
  if (v && /url\s*\(/i.test(v)) elt.setAttribute('style', prefixFragments(v));
}

/* Clean one element's attributes in place.

   Attributes are classified by localName + namespaceURI, never by the
   qualified name: in an XML-parsed document (an EPUB chapter, an SVG) the
   prefix is whatever the file declares, so `xmlns:q="...xlink"` + `q:href=
   "javascript:..."` is a real xlink:href that a test on attr.name misses. */
function cleanAttrs(elt: Element, o: CleanOpts, rep: SanitizeReport) {
  const local = elt.localName.toLowerCase();
  const navigableEl = local === 'a' || local === 'area';
  const isSvg = elt.namespaceURI === SVG_NS;
  for (const attr of Array.from(elt.attributes)) {
    const ans = attr.namespaceURI;
    const name = attr.localName.toLowerCase();
    const val = attr.value;
    const drop = () => { elt.removeAttributeNode(attr); };

    // Namespace declarations are inert once parsed; xml:lang / xml:space are the
    // only xml: attributes worth keeping (xml:base would re-root relative URLs).
    if (ans === XMLNS_NS || (ans === null && name === 'xmlns')) continue;
    if (ans === XML_NS) { if (name !== 'lang' && name !== 'space') drop(); continue; }
    if (ans === XLINK_NS) { if (name !== 'href') { drop(); continue; } }
    // Any other namespace (inkscape:, sodipodi:, epub:, ...) and prefixed names
    // an HTML parse left in no namespace: nothing a preview needs.
    else if (ans !== null || name.indexOf(':') >= 0) { drop(); continue; }

    // Event handlers.
    if (name.startsWith('on')) { drop(); rep.handlers++; continue; }
    // data-* has no effect without script or a stylesheet, and the app's own
    // code selects on data- attributes.
    if (DROP_ATTRS.has(name) || name.startsWith('data-')) { drop(); continue; }

    if (name === 'id' || name === 'name') { if (val) attr.value = ID_PREFIX + val; continue; }
    if (IDREF_ATTRS.has(name)) { attr.value = val.split(/\s+/).filter(Boolean).map((t) => ID_PREFIX + t).join(' '); continue; }
    if (name === 'usemap') { if (val.charAt(0) === '#') attr.value = '#' + ID_PREFIX + val.slice(1); continue; }

    if (name === 'href') {
      const flat = val.replace(/[\x00-\x20]+/g, '');
      if (flat.charAt(0) === '#') { if (flat.length > 1) attr.value = '#' + ID_PREFIX + flat.slice(1); continue; }
      const scheme = urlScheme(val);
      if (!navigableEl) {
        // An href only stays navigable on something the user can actually follow.
        // On <use>/<image>/<feImage> the same attribute is a FETCH, so an https:
        // value there is a silent call home - allowed by the scheme allow-list
        // below, but exactly what NETWORK_ATTRS exists to prevent. The URL parser
        // treats a leading backslash as a slash, hence [\/\\].
        if (!o.allowRemote && (scheme === 'http' || scheme === 'https' || /^[\/\\]{2}/.test(flat))) {
          drop(); rep.extRefs++; continue;
        }
        if (scheme === 'data' && DATA_IMAGE.test(flat)) continue;
      }
      if (isUnsafeUrl(val)) { drop(); rep.jsLinks++; }
      continue;
    }

    if (NETWORK_ATTRS.has(name)) {
      if (!o.allowRemote || isUnsafeUrl(val)) { drop(); rep.extRefs++; }
      continue;
    }

    if (name === 'style') { cleanStyle(elt, attr, rep); continue; }

    // SVG presentation attributes are CSS - see cssUnsafe().
    if (isSvg && cssUnsafe(val)) { drop(); rep.cssRefs++; continue; }
    if (/url\s*\(/i.test(val)) attr.value = prefixFragments(val);
  }

  if (navigableEl) {
    // A link out of the preview opens in a new tab with the opener severed, so
    // following one never tears down the analysis and the previewed document can
    // never reach back into this page via window.opener. In-document #fragment
    // links stay in place.
    const href = elt.getAttribute('href') || elt.getAttributeNS(XLINK_NS, 'href') || '';
    const scheme = urlScheme(href);
    if (href && href.charAt(0) !== '#' && scheme !== 'mailto' && scheme !== 'tel') {
      elt.setAttribute('target', '_blank');
      elt.setAttribute('rel', 'noopener noreferrer');
    } else elt.removeAttribute('target');
  } else if (elt.hasAttribute('target')) elt.setAttribute('rel', 'noopener noreferrer');
}

/* Walk `root` (and, with includeRoot, root itself) removing everything unsafe.
   Explicit stack, children snapshotted before descent, so removals never
   disturb the iteration and a deep document cannot overflow the call stack. */
function cleanTree(root: Element, includeRoot: boolean, o: CleanOpts, rep: SanitizeReport) {
  const stack: Node[] = includeRoot ? [root] : Array.from(root.childNodes);
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType !== 1) {
      // Text is the only other node kept. Comments, processing instructions and
      // CDATA sections carry nothing a preview shows, and they are exactly what
      // turns back into live markup if anything ever serialises the tree and
      // re-parses it as HTML (`<!--><img src=x onerror=...>-->`).
      if (node.nodeType !== 3 && node.parentNode) node.parentNode.removeChild(node);
      continue;
    }
    const elt = node as Element;
    const local = elt.localName.toLowerCase();
    const ns = elt.namespaceURI;
    if (DROP_ELEMENTS.has(local) && !(local === 'title' && ns === SVG_NS)) {
      if (local === 'script') rep.script++;
      else if (local === 'foreignobject') rep.foreignObject++;
      else if (local === 'style') rep.style++;
      else if (SMIL_ELEMENTS.has(local)) rep.smil++;
      elt.remove();
      continue;
    }
    // An SVG preview keeps SVG elements only. An XHTML-namespace <iframe srcdoc>
    // or <p> smuggled into the SVG is HTML in the page once inserted; metadata in
    // editor namespaces (sodipodi, rdf) is merely irrelevant.
    if (o.svg && ns !== SVG_NS) {
      if (ns === HTML_NS || ns === MATHML_NS) rep.html++;
      elt.remove();
      continue;
    }
    cleanAttrs(elt, o, rep);
    for (const c of Array.from(elt.childNodes)) stack.push(c);
  }
}

/* Sanitise an already-parsed document IN PLACE and return the element whose
   children are the safe content. Callers normally want sanitizeHtml() below;
   this is the entry point for viewers that had to parse the markup themselves
   (epub.js parses as application/xhtml+xml first).

   The wrapper is marked data-anr-untrusted (navigate.js leaves clicks inside
   it alone) and gets `contain: layout`, which makes it the containing block
   for any absolutely or fixed positioned descendant, so nothing inside can be
   laid out over the rest of the site.

   opts.allowRemote - keep network-loading attributes (default false).
   opts.className   - class for the returned wrapper div. */
export function sanitizeDoc(doc: Document, opts: any = {}) {
  const { allowRemote = false, className = '' } = opts;
  const root = doc.body || doc.documentElement;
  const wrapper = document.createElement('div');
  if (className) wrapper.className = className;
  wrapper.setAttribute('data-anr-untrusted', '');
  wrapper.style.contain = 'layout';
  if (!root) return wrapper;

  // Cleaned while still inside the inert parsed document: adopting an
  // <img src onerror> into this page first would start its load (and fire the
  // handler) before any check ran.
  cleanTree(root, false, { allowRemote: !!allowRemote, svg: false }, emptySanitizeReport());

  for (const child of [...root.childNodes]) wrapper.appendChild(child);
  return wrapper;
}

/* Sanitise the <svg> of a parsed SVG document and return a clean COPY of it,
   imported into this page's document and ready to insert as a node - or null
   when there is no SVG root. The parsed document itself is left untouched, so
   the SVG viewer can still count what the file really contains.

   The same element and attribute rules as sanitizeDoc(), plus: only SVG-
   namespace elements survive, and the root <svg>'s own attributes are cleaned
   too (<svg onload=...>). Pass a report (emptySanitizeReport()) to learn what
   was removed. */
export function sanitizeSvgDoc(doc: Document, report?: SanitizeReport): SVGSVGElement | null {
  const de = doc.documentElement;
  const src = de && de.localName === 'svg' && de.namespaceURI === SVG_NS ? de : doc.getElementsByTagNameNS(SVG_NS, 'svg')[0];
  if (!src) return null;
  // Clone inside the (inert) parsed document, clean the clone, THEN import it.
  const work = src.cloneNode(true) as Element;
  cleanTree(work, true, { allowRemote: false, svg: true }, report || emptySanitizeReport());
  return document.importNode(work, true) as unknown as SVGSVGElement;
}

/* Parse an HTML string and return a wrapper div holding its sanitised content. */
export function sanitizeHtml(html: unknown, opts: any = {}) {
  const doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
  return sanitizeDoc(doc, opts);
}
