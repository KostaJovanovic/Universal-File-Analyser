/* Shared helpers for the two prerender generators (prerender-formats.mjs and
   prerender-format-pages.mjs): HTML escaping and the full-vs-id landing-page
   routing. Kept in one place so the /formats hub and the per-extension pages can
   never disagree about where an extension's guide lives. Dev-only (tools/ is in
   .assetsignore); imported by node, never served. */

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

// The before-first-paint theme bootstrap script. Path-independent, so it is the
// single source for every page: stamp-head.mjs stamps it into the 6 hand-authored
// pages and prerender-format-pages.mjs emits it into every generated guide page.
// It must run last in <head> (after the stylesheet links) to avoid a flash, and
// before paint to apply the saved/preferred theme. Keep it byte-stable - it is a
// UX-sensitive snippet that used to be hand-copied across 8 places.
export const THEME_SCRIPT = `<script>try{var t=localStorage.getItem('anr-theme'),s=parseInt(localStorage.getItem('anr-theme:ts'),10);if(t&&(!s||Date.now()-s>604800000)){localStorage.removeItem('anr-theme');localStorage.removeItem('anr-theme:ts');t=null;}if(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark';if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>`;

// The set of extensions (lowercase) that live in at least one full-analysis row.
// Full pages win cross-depth collisions, so this set decides routing everywhere:
// an extension here lands at /formats/<ext>, otherwise at /formats/id/<ext>.
export function buildFullKeys(groups) {
  const fullKeys = new Set();
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.depth !== 'full') continue;
      for (const tok of r.exts) fullKeys.add(tok.toLowerCase());
    }
  }
  return fullKeys;
}

// Build the canonical landing-page path resolver for an extension token, given
// the full-key set from buildFullKeys().
export function makeHrefOf(fullKeys) {
  return (tok) => {
    const k = tok.toLowerCase();
    return fullKeys.has(k) ? `/formats/${k}` : `/formats/id/${k}`;
  };
}
