/* Prerender the token/animation sections of /test (test.html) - the internal
   UI style-guide sheet - straight from assets/css/analyser.css, so the sheet can
   never drift from the stylesheet for design tokens, type scale, timing or
   keyframe animations. Component demos further down test.html are hand-authored
   (markup can't be derived from CSS); only what IS derivable is generated here,
   between the TOKENS:START / TOKENS:END markers.

   The page is deployed but hidden: noindex, not in any sitemap, linked from
   nowhere. Reachable at /test.

   RUN: `node tools/prerender-testpage.mjs` (save.bat runs it on every commit,
   before `git add`). Re-runnable and idempotent. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { esc } from './prerender-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'assets', 'css', 'analyser.css'), 'utf8');

// ---- extract custom properties from a top-level rule -------------------------
// Grabs the body of the FIRST block whose selector line matches `selRe` exactly
// (top-level rules in analyser.css close with a `}` at column 0), then parses
// `--name: value;` pairs with comments stripped.
function varsOf(selRe) {
  const m = css.match(selRe);
  if (!m) return new Map();
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map();
  for (const decl of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set('--' + decl[1], decl[2].trim().replace(/\s+/g, ' '));
  }
  return out;
}
const light = varsOf(/^:root \{([\s\S]*?)^\}/m);
const dark = varsOf(/^:root\[data-theme="dark"\]\s*\{([\s\S]*?)^\}/m);
if (!light.size) { console.error('prerender-testpage: could not parse :root variables'); process.exit(1); }

// ---- classify the tokens ------------------------------------------------------
// A token is a colour if its value looks like one (hex / rgb / rgba); everything
// else lands in the group its prefix implies.
const isColour = (v) => /^(#[0-9a-fA-F]{3,8}|rgba?\()/.test(v);
const groups = { colour: [], type: [], dur: [], other: [] };
for (const [name, value] of light) {
  const d = dark.get(name);
  const row = { name, value, dark: d && d !== value ? d : null };
  if (isColour(value)) groups.colour.push(row);
  else if (/^--t-/.test(name) || /^--lh-/.test(name) || /^--ls-/.test(name)) groups.type.push(row);
  else if (/^--dur-/.test(name)) groups.dur.push(row);
  else groups.other.push(row);
}

// ---- keyframes -----------------------------------------------------------------
const keyframes = [...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);

// ---- render --------------------------------------------------------------------
// Emits the site's real page anatomy: an h2.section-head per topic, a
// p.section-lede under it, and the demo content inside an .about-block card -
// the same shape the about / patch / privacy pages use.
const H = [];

H.push('<h2 class="section-head" id="tokens">Colour tokens.</h2>');
H.push('<p class="section-lede">Every colour custom property on <code>:root</code>. The swatch is live (repaints with the theme toggle); the values are the raw light / dark definitions. Tokens without a dark value are theme-independent.</p>');
H.push('<div class="about-block"><div class="tst-swatches">');
for (const t of groups.colour) {
  H.push('<div class="tst-swatch">' +
    `<span class="tst-swatch-chip" style="background:var(${t.name})"></span>` +
    `<code class="tst-swatch-name">${esc(t.name)}</code>` +
    `<span class="tst-swatch-vals"><code>${esc(t.value)}</code>` +
    (t.dark ? `<code class="tst-swatch-dark">${esc(t.dark)}</code>` : '<span class="tst-swatch-fixed">fixed</span>') +
    '</span></div>');
}
H.push('</div></div>');

H.push('<h2 class="section-head" id="type">Type scale.</h2>');
H.push('<p class="section-lede">The --t-* sizes rendered live (they are clamp()-responsive - resize the window), plus the line-height and letter-spacing rhythm tokens.</p>');
H.push('<div class="about-block">');
for (const t of groups.type.filter((t) => /^--t-/.test(t.name))) {
  H.push('<div class="tst-type-row">' +
    `<code class="tst-type-name">${esc(t.name)}<br>${esc(t.value)}</code>` +
    `<span class="tst-type-sample" style="font-size:var(${t.name})">Analyse everything</span>` +
    '</div>');
}
H.push('<table class="tst-table"><thead><tr><th>Rhythm token</th><th>Value</th></tr></thead><tbody>');
for (const t of groups.type.filter((t) => !/^--t-/.test(t.name))) {
  H.push(`<tr><td><code>${esc(t.name)}</code></td><td><code>${esc(t.value)}</code></td></tr>`);
}
H.push('</tbody></table></div>');

H.push('<h2 class="section-head" id="timing">Timing &amp; layout tokens.</h2>');
H.push('<div class="about-block"><table class="tst-table"><thead><tr><th>Token</th><th>Value</th><th>Dark override</th></tr></thead><tbody>');
for (const t of [...groups.dur, ...groups.other]) {
  H.push(`<tr><td><code>${esc(t.name)}</code></td><td><code>${esc(t.value)}</code></td><td>${t.dark ? '<code>' + esc(t.dark) + '</code>' : '<span class="tst-swatch-fixed">-</span>'}</td></tr>`);
}
H.push('</tbody></table></div>');

H.push('<h2 class="section-head" id="animations">Keyframe animations.</h2>');
H.push('<p class="section-lede">Every @keyframes in analyser.css, looped on a neutral demo tile. In situ each animates its own element (grid backdrop, loader bar, nav flash, ping ring...); the tile only shows the raw motion curve.</p>');
H.push('<div class="about-block"><div class="tst-anim-grid">');
for (const k of keyframes) {
  H.push(`<div class="tst-anim"><span class="tst-anim-box" style="animation:${esc(k)} 1.8s linear infinite"></span><code>${esc(k)}</code></div>`);
}
H.push('</div></div>');

const generated = H.join('\n');

// ---- stamp into test.html -------------------------------------------------------
const START = '<!-- TOKENS:START - generated by tools/prerender-testpage.mjs from analyser.css; do not hand-edit between the markers -->';
const END = '<!-- TOKENS:END -->';
const RE = /<!--\s*TOKENS:START[\s\S]*?TOKENS:END\s*-->/;
const file = join(ROOT, 'test.html');
const html = readFileSync(file, 'utf8');
if (!RE.test(html)) { console.error('prerender-testpage: TOKENS markers not found in test.html'); process.exit(1); }
writeFileSync(file, html.replace(RE, () => `${START}\n${generated}\n${END}`));
console.log(`prerender-testpage: stamped ${groups.colour.length} colours, ${groups.type.length + groups.dur.length + groups.other.length} other tokens, ${keyframes.length} keyframes into test.html`);
