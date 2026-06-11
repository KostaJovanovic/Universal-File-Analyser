/* Shared helpers for the two prerender generators (prerender-formats.mjs and
   prerender-format-pages.mjs): HTML escaping and the full-vs-id landing-page
   routing. Kept in one place so the /formats hub and the per-extension pages can
   never disagree about where an extension's guide lives. Dev-only (tools/ is in
   .assetsignore); imported by node, never served. */

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

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
