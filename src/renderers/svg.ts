/* Analyser - SVG inspector
   Renders an SVG at actual size, then reports stats, element counts,
   colour palette, and text content. */

import { el, row, rowHelp, fmtBytes, errorCard, integrityCard } from '../core/util.js';
import { SVG_MAX_NODES } from '../core/limits.js';
import { urlScheme } from '../core/sanitize.js';
import { renderPhoto } from './photo.js';

// Scan a parsed SVG document for active/unsafe content, strip it, and return
// { findings, safe } where `safe` is sanitised serialised markup for the
// preview (null if there's no <svg> root). The preview injects markup via
// innerHTML, so an untrusted SVG could otherwise run inline event handlers,
// embed arbitrary HTML through <foreignObject>, or phone home through external
// references. We remove <script>/<foreignObject>, on* handlers, javascript:
// links, and external/remote refs before anything is rendered.
function sanitizeSvg(doc) {
  const findings = [];
  const root = doc.querySelector('svg');
  if (!root) return { findings, safe: null };

  // The attribute walk below is O(nodes) with per-attribute regexes. A
  // pathologically large SVG (e.g. a DWG-derived drawing with 100k+ elements)
  // would freeze the tab, so decline to inline it rather than sanitising every
  // node. This never weakens sanitisation - an oversized SVG is simply not
  // rendered (safe:null), the same fail-closed path as a missing <svg> root.
  if (doc.querySelectorAll('*').length > SVG_MAX_NODES) {
    return { findings, safe: null, tooComplex: true };
  }

  const scripts = doc.querySelectorAll('script');
  if (scripts.length) findings.push(scripts.length + ' <script> element' + (scripts.length > 1 ? 's' : ''));
  scripts.forEach((n) => n.remove());

  const fo = doc.querySelectorAll('foreignObject');
  if (fo.length) findings.push(fo.length + ' <foreignObject> (embedded HTML)');
  fo.forEach((n) => n.remove());

  // Inline <style> is NOT scoped to the SVG when injected inline - its rules
  // apply document-wide (CSS injection / UI-redress) and can pull remote fonts
  // and images via url()/@import. SMIL animation (<animate>/<set>/...) can also
  // rewrite an href to javascript: at runtime, bypassing the static-attribute
  // scan below. Remove both element classes outright.
  const styles = doc.querySelectorAll('style');
  if (styles.length) findings.push(styles.length + ' <style> element' + (styles.length > 1 ? 's' : '') + ' (document-wide CSS)');
  styles.forEach((n) => n.remove());

  const smil = doc.querySelectorAll('animate, animateTransform, animateMotion, set');
  if (smil.length) findings.push(smil.length + ' SMIL animation element' + (smil.length > 1 ? 's' : ''));
  smil.forEach((n) => n.remove());

  let handlers = 0, jsLinks = 0, extRefs = 0, cssRefs = 0;
  for (const node of doc.querySelectorAll('*')) {
    for (const attr of Array.from<any>(node.attributes)) {
      const name = attr.name.toLowerCase();
      const val = (attr.value || '').trim();
      if (name.startsWith('on')) { node.removeAttribute(attr.name); handlers++; continue; }
      if (name === 'href' || name === 'src' || name.endsWith(':href')) {
        // Normalise the way the browser's URL parser does before deciding - see
        // urlScheme() in core/sanitize.js for why a plain /^javascript:/ test is
        // not enough (`java&#9;script:` slips straight past it).
        const flat = val.replace(/[\x00-\x20]+/g, '');
        const scheme = urlScheme(val);
        // Remote reference: absolute or protocol-relative http(s), or an inline
        // HTML document. Stripped so a rendered SVG can never call home.
        if (scheme === 'http' || scheme === 'https' || /^\/\//.test(flat) || /^data:text\/html/i.test(flat)) {
          node.removeAttribute(attr.name); extRefs++;
        }
        // No scheme at all is a relative path or #fragment (both fine), and
        // data:/mailto:/tel: are the schemes SVG legitimately uses (base64
        // images, contact links). Anything else that carries a scheme can
        // execute - javascript:, vbscript:, blob:, filesystem: - so it goes.
        else if (scheme && !/^(?:data|mailto|tel)$/.test(scheme)) {
          node.removeAttribute(attr.name); jsLinks++;
        }
      }
      // Any attribute (style="", fill="url(...)", filter="url(...)", …) that
      // references a remote resource via CSS url() or @import - strip it.
      else if (/(?:url\s*\(|@import)/i.test(val) && /(?:url\s*\(\s*['"]?\s*(?:https?:)?\/\/|@import\s+['"]?\s*(?:https?:)?\/\/)/i.test(val)) {
        node.removeAttribute(attr.name); cssRefs++;
      }
    }
  }
  if (handlers) findings.push(handlers + ' inline event handler' + (handlers > 1 ? 's' : '') + ' (on*)');
  if (jsLinks) findings.push(jsLinks + ' script-capable link' + (jsLinks > 1 ? 's' : '') + ' (javascript:, vbscript:, ...)');
  if (extRefs) findings.push(extRefs + ' external/remote reference' + (extRefs > 1 ? 's' : ''));
  if (cssRefs) findings.push(cssRefs + ' remote CSS url() reference' + (cssRefs > 1 ? 's' : ''));

  let safe;
  try { safe = new XMLSerializer().serializeToString(root); }
  catch (_) { safe = null; }
  return { findings, safe };
}

// Sanitise a raw SVG markup string and return safe serialised markup (or null
// if there's no <svg> root / it won't parse). Shared entry point for other
// renderers that inject parser-produced SVG (e.g. dwg.js) so they get the same
// element/attribute allow-list as the SVG viewer instead of a bespoke regex.
export function sanitizeSvgMarkup(markup) {
  try {
    const doc = new DOMParser().parseFromString(String(markup || ''), 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    const { safe } = sanitizeSvg(doc);
    return safe;
  } catch (_) { return null; }
}

// Which program exported this SVG - read from the generator comment or version
// attribute the exporter writes. Illustrator stamps "<!-- Generator: Adobe
// Illustrator ... -->", Inkscape sets inkscape:version, Sketch/Figma leave their
// own markers. Pure text matching so it works even when the XML won't parse.
function detectSvgCreator(text) {
  let m = text.match(/<!--\s*Generator:\s*([^]*?)\s*-->/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim().slice(0, 120);
  m = text.match(/inkscape:version="([^"\s(]+)/i);
  if (m) return 'Inkscape ' + m[1];
  if (/>\s*Created with Sketch[.\s]*</i.test(text)) return 'Sketch';
  if (/xmlns:figma=|figma\.com/i.test(text)) return 'Figma';
  if (/\bvectornator\b|linearity\s+curve/i.test(text)) return 'Vectornator / Linearity Curve';
  m = text.match(/<dc:creator>\s*(?:<[^>]*>\s*)*([^<]+)/i);
  if (m && m[1].trim()) return m[1].trim().slice(0, 120);
  return '';
}

export async function renderSvg(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Inspecting SVG "${file.name}"…`));

  let svgText;
  try {
    svgText = await file.text();
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read SVG: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';

  // Parse first so we can sanitise BEFORE rendering (see sanitizeSvg above).
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const parseErr = doc.querySelector('parsererror');
  const svgRoot = doc.querySelector('svg');
  const { findings, safe, tooComplex } = sanitizeSvg(doc);

  // --- Preview card: render the (sanitised) SVG, capped so it doesn't dominate ---
  const previewCard = el('div', { class: 'anr-card' });
  previewCard.appendChild(el('h3', {}, 'SVG preview'));
  if (safe) {
    const svgContainer = el('div', { class: 'anr-svg-preview', html: safe });
    svgContainer.style.maxHeight = '400px';
    svgContainer.style.overflow = 'auto';
    previewCard.appendChild(svgContainer);
  } else {
    previewCard.appendChild(el('p', { class: 'anr-hint' },
      tooComplex
        ? 'This SVG has too many elements to render safely here, so the preview is skipped. The statistics below still apply.'
        : 'Could not safely render this SVG (invalid XML).'));
  }
  resultsEl.appendChild(previewCard);

  // --- Security card: list anything stripped from the preview ---
  if (findings.length) {
    const secCard = el('div', { class: 'anr-card' });
    secCard.appendChild(el('h3', {}, 'Security'));
    secCard.appendChild(el('p', { class: 'anr-hint anr-svg-error' }, 'Potentially unsafe content was found and removed from the preview:'));
    const ul = el('ul', { class: 'anr-svg-warnings' });
    for (const f of findings) ul.appendChild(el('li', {}, f));
    secCard.appendChild(ul);
    resultsEl.appendChild(secCard);
  }

  // --- Stats card ---
  const statsCard = el('div', { class: 'anr-card' });
  statsCard.appendChild(el('h3', {}, 'SVG statistics'));

  if (parseErr) {
    statsCard.appendChild(el('p', { class: 'anr-hint anr-svg-error' }, 'SVG parse error - stats may be incomplete'));
  }
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'SVG Vector Image'));
  const svgCreator = detectSvgCreator(svgText);
  if (svgCreator) tbl.appendChild(rowHelp('Created with', svgCreator,
    'The program that made this SVG, taken from a note the exporting software left in the file (for example Adobe Illustrator, Inkscape, Sketch or Figma).'));
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));

  if (svgRoot) {
    const viewBox = svgRoot.getAttribute('viewBox');
    const width = svgRoot.getAttribute('width');
    const height = svgRoot.getAttribute('height');
    tbl.appendChild(rowHelp('viewBox', viewBox || '-', 'The drawing area of the SVG, written as "min-x min-y width height". Because SVG is drawn from maths rather than fixed dots, this lets the image be shown at any size and stay crisp, never blocky.'));
    tbl.appendChild(row('Width', width || '-'));
    tbl.appendChild(row('Height', height || '-'));
  }

  // Count elements by type
  const elementTypes = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
    'polygon', 'text', 'tspan', 'g', 'use', 'defs', 'clipPath', 'mask',
    'linearGradient', 'radialGradient', 'pattern', 'image', 'filter'];
  const counts: Record<string, number> = {};
  for (const tag of elementTypes) {
    const els = doc.getElementsByTagName(tag);
    if (els.length > 0) counts[tag] = els.length;
  }
  // Count all nodes
  const allElements = doc.getElementsByTagName('*');
  tbl.appendChild(rowHelp('Total elements', String(allElements.length), 'How many individual building blocks the SVG contains in total - every shape, line, group and other tag added up.'));

  statsCard.appendChild(tbl);

  // Element breakdown
  if (Object.keys(counts).length > 0) {
    statsCard.appendChild(el('div', { class: 'anr-readout-section' }, 'Element counts'));
    const countTbl = el('table', { class: 'anr-readout' });
    for (const [tag, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      countTbl.appendChild(row('<' + tag + '>', String(count)));
    }
    statsCard.appendChild(countTbl);
  }

  resultsEl.appendChild(statsCard);

  // --- Rasterise to PNG and analyse like a photo ---
  const rasterCard = el('div', { class: 'anr-card' });
  rasterCard.appendChild(el('h3', {}, 'Image analysis'));
  const rasterHint = el('p', { class: 'anr-hint', style: 'margin: 0 0 10px; font-size: 12px;' },
    'Render this SVG to a PNG and run the full photo analysis - histogram, palette, OCR and more.');
  rasterCard.appendChild(rasterHint);
  const rasterBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse as image');
  const rasterTarget = el('div', { class: 'anr-results' });
  rasterBtn.addEventListener('click', () => {
    rasterBtn.disabled = true;
    rasterBtn.textContent = 'Rendering…';
    let w = 0, h = 0;
    if (svgRoot) {
      const vb = (svgRoot.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      w = parseFloat(svgRoot.getAttribute('width')) || (vb.length === 4 ? vb[2] : 0);
      h = parseFloat(svgRoot.getAttribute('height')) || (vb.length === 4 ? vb[3] : 0);
    }
    // Scale up so small icons still produce a usable raster, cap the long edge.
    const longest = Math.max(w, h) || 512;
    const scale = Math.min(4, Math.max(1, 1024 / longest));
    const cw = Math.max(1, Math.round((w || 512) * scale));
    const ch = Math.max(1, Math.round((h || 512) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const blob = new Blob([safe || svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) { rasterBtn.textContent = 'Could not rasterise'; return; }
        const pngFile = new File([pngBlob], file.name.replace(/\.svg$/i, '') + '.png', { type: 'image/png' });
        rasterTarget.hidden = false;
        renderPhoto(pngFile, rasterTarget);
        rasterBtn.textContent = 'Re-analyse';
        rasterBtn.disabled = false;
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rasterBtn.textContent = 'Could not rasterise';
      rasterBtn.disabled = false;
    };
    img.src = url;
  });
  rasterCard.appendChild(el('div', { class: 'anr-btn-row' }, [rasterBtn]));
  rasterCard.appendChild(rasterTarget);
  resultsEl.appendChild(rasterCard);

  // --- Color palette card ---
  const colors = new Set<string>();
  for (const node of allElements) {
    const fill = node.getAttribute('fill');
    const stroke = node.getAttribute('stroke');
    const style = node.getAttribute('style') || '';
    if (fill && fill !== 'none' && fill !== 'inherit' && !fill.startsWith('url')) colors.add(fill);
    if (stroke && stroke !== 'none' && stroke !== 'inherit' && !stroke.startsWith('url')) colors.add(stroke);
    // Extract from inline style
    const fillMatch = style.match(/fill\s*:\s*([^;]+)/);
    const strokeMatch = style.match(/stroke\s*:\s*([^;]+)/);
    if (fillMatch) {
      const v = fillMatch[1].trim();
      if (v !== 'none' && v !== 'inherit' && !v.startsWith('url')) colors.add(v);
    }
    if (strokeMatch) {
      const v = strokeMatch[1].trim();
      if (v !== 'none' && v !== 'inherit' && !v.startsWith('url')) colors.add(v);
    }
  }

  if (colors.size > 0) {
    const colorCard = el('div', { class: 'anr-card' });
    colorCard.appendChild(el('h3', {}, 'Color palette'));
    const swatchWrap = el('div', { class: 'anr-svg-palette' });
    for (const c of colors) {
      const label = el('div', { class: 'anr-svg-swatch-label' }, c);
      const swatch = el('div', {
        class: 'anr-svg-swatch',
        title: c + ' - click to copy',
        onclick: () => {
          navigator.clipboard.writeText(c).then(() => {
            label.textContent = 'copied';
            setTimeout(() => { label.textContent = c; }, 800);
          });
        }
      });
      swatch.style.background = c;
      const item = el('div', { class: 'anr-svg-swatch-item' }, [swatch, label]);
      swatchWrap.appendChild(item);
    }
    colorCard.appendChild(swatchWrap);
    resultsEl.appendChild(colorCard);
  }

  // --- Text content card ---
  const textElements = doc.querySelectorAll('text, tspan');
  if (textElements.length > 0) {
    const textCard = el('div', { class: 'anr-card' });
    textCard.appendChild(el('h3', {}, 'Text content'));
    const textSet = new Set();
    for (const t of textElements) {
      const txt = t.textContent.trim();
      if (txt) textSet.add(txt);
    }
    if (textSet.size > 0) {
      const textPre = el('pre', { class: 'anr-ocr-text anr-pre-scroll-sm' }, Array.from(textSet).join('\n'));
      textCard.appendChild(textPre);
    } else {
      textCard.appendChild(el('p', { class: 'anr-hint' }, 'No text content found'));
    }
    resultsEl.appendChild(textCard);
  }

  resultsEl.appendChild(integrityCard(file));
}
