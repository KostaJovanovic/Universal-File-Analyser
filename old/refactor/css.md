# CSS refactor assessment — `assets/css/analyser.css` (+ `fonts.css`)

Scope: `analyser.css` (6029 lines) and `fonts.css` (99 lines). Constraint: behaviour-preserving, **no build step**, single-stylesheet world (vanilla `<link>`).

**Headline:** this is a *well-tended* stylesheet, not an accreted mess. It has a real design-token layer (`:root`, lines 13–87), ~40 clearly captioned `/* ---------- SECTION ---------- */` blocks, generous explanatory comments, and 1181 `var(--…)` usages. `fonts.css` is clean (10 ordered `@font-face`, nothing to do). So the wins here are *consolidation and hygiene*, not restructuring. Ranked below by value-vs-risk.

---

## Tier 1 — High value, low risk

### 1.1 Tokenise the `1px solid var(--hairline)` border (111 occurrences)
`1px solid var(--hairline)` is written out **111 times** (and `1px solid <something>` 184 times total). This is the single most repeated literal in the file.
- **Proposal:** add `--bd-hairline: 1px solid var(--hairline);` (and a `--bd-rule: 1px solid var(--rule);`) to `:root`, then `border: var(--bd-hairline);`. Token already-resolved composites are valid and behaviour-identical.
- **Caveat:** only collapse the *full-shorthand* cases. Rules that set `border-color`/`border-bottom` separately, or use a non-hairline colour, stay as-is. Do it with review, not blind find-replace (the `1px solid` count includes `var(--rule)`, `#333`, on-dark borders, etc.).
- **Value:** large readability win, one place to retune the hairline. **Risk:** low (pure substitution).

### 1.2 Dark-mode overrides that hardcode `#333` / `#555` / `#e8e8e8` (~22 rules, lines ~2824–2880, 1167, 1082)
The dark theme is *mostly* correct: one `:root[data-theme="dark"]` block (4228–4240) remaps the palette tokens (`--hairline:#333`, `--surface:#141414`, `--fg:#e8e8e8`, plus a `--hairline-strong:#555` analogue). But ~22 scattered per-component dark rules then **hardcode those same literals** instead of using the tokens:
- `#333` appears **11×**, `#555` **4×**, `#e8e8e8` **5×** — almost all inside `:root[data-theme="dark"] …` selectors (e.g. 2824–2832 offline buttons, 2869–2880 footer, 4879 region).
- `#333` == dark `--hairline`; `#555` == `--hairline-strong`; `#e8e8e8` == dark `--fg`.
- **Two-step proposal:**
  1. Replace the literals with `var(--hairline)` / `var(--hairline-strong)` / `var(--fg)` (behaviour-identical, since in that scope the tokens already hold those values).
  2. **Better:** for the many overrides whose *only* job is to swap a light hairline for a dark one, make the **base** rule use `var(--hairline)` and **delete the dark override entirely** — the token already flips in the dark `:root`. e.g. `.offline-section { border-top-color: var(--hairline); }` makes line 2824 redundant. Spot-check each: some overrides also change `background`, those stay.
- **Value:** removes a whole class of "why is dark mode out of sync" bugs and shrinks the file. **Risk:** low for step 1, low-medium for step 2 (delete only after confirming the base rule's light value is also `--hairline`).

### 1.3 Genuinely orphaned selectors — 19 confirmed dead (0 references anywhere)
Spot-checked all 683 CSS class names against every `.html`/`.js` (excluding `vendor/`, **including** generated `formats/` pages and JS dynamic-class construction). After filtering false positives, these have **zero** references and are safe to delete:

```
about-ext  about-exts  about-fmt-desc  about-readout  anr-card-empty
anr-coverart  anr-defs  anr-dropdown-list  anr-dropdown-trigger  anr-fs-btn
anr-hash-out  anr-spec-play  anr-status-name  anr-timecode-input  anr-transport
is-downloaded  site-about-link  stats-ext-tag  anr-preview-meta  anr-pick-link
anr-extfilter-label
```
(Plus `endOfContent` / `markedContent` — these are **PDF.js vendor** classes, intentional, leave them.)

- **IMPORTANT false-positive caveat (do NOT delete these):** several classes look dead by a naive grep but are **built dynamically in JS** and are live:
  - `anr-json-string/number/boolean/null` ← `'anr-json-' + t` in `renderers/dataview.js:44`
  - `anr-md-h3/h4/h5/h6` ← built in `renderers/markdown.js`
  - `anr-page--sheet/slide` ← `'anr-page--' + variant` in `renderers/paged.js:33`
  - `didyouknow`, `dyk-list`, `fact-approx`, `format-crumb-badge`, `format-cta*` ← used in `formats/` generated pages.
- **Value:** modest size cut + removes traps. **Risk:** low, but verify each deletion individually (string-concat usage can hide in `.js`); recommend deleting in one reviewable commit.

---

## Tier 2 — Medium value, low-to-medium risk

### 2.1 Consolidate / token-ise the remaining repeated colour literals
83 raw hex literals total. Beyond the dark-override set (1.2), repeated non-token colours worth promoting to `:root`:
- `#2a2a2a` (2×, e.g. 1167 `.anr-tl-clip.is-audio` dark) — same family as surfaces.
- `#383838` (2×), `#141414` (3×, == `--surface` dark) — `#141414` should be `var(--surface)`.
- Diagram/JSON accent triples used twice each: `#5b9fd6` / `#e89a2e` (2× each, scene/diagram), `#1a8a3a` / `#b07d00` (2× each). These are *semantic* status/syntax colours — give them named tokens (`--syntax-num`, `--diag-accent`, …) so they're documented and themeable.
- **rgba audit:** `rgba(255,255,255,0.5)` (10×) and `rgba(255,255,255,0.15)` (8×) already **have** tokens (`--border-on-dark-strong`, `--border-on-dark`) per the `:root` comment at 50–57 — but many call sites still inline the literal. Sweep those to the existing tokens. Also `--white-a40`/`--white-a80` exist (56–57) yet `rgba(255,255,255,0.4/0.8)` still appear inline. Low-risk find-replace of values that already have a named token.
- **Value:** medium. **Risk:** low (literals→existing/new tokens are pixel-identical).

### 2.2 Rename / split the mislabelled "UTILITY / REFACTOR CLASSES" section (4664–5217, ~550 lines)
Despite the heading, this block is **not** utilities — it's full component CSS (file-tree `.anr-tree*`, treemap `.anr-treemap*`, view-controls, ext-filter chips). Only the first two lines (`.is-hidden`, `.anr-pre-scroll*`) are genuine utilities.
- **Proposal:** rename the heading to something honest (e.g. `FILE TREE / TREEMAP`), and move the 3 actual utility one-liners up to a small dedicated "UTILITIES" block near the top (after `:root`). No selector changes, just relocation + a truthful comment.
- **Value:** navigability. **Risk:** very low (cut/paste of self-contained rules; watch source-order only for the `:has(+ …)` pair at 4926, keep them adjacent).

### 2.3 Decide on media-query strategy (29 `@media` blocks, scattered)
29 media queries are interleaved per-component throughout the file (446, 651, 822, 1356, 1776, 2033, … 5808). That's the standard "co-locate the responsive rule with its component" pattern and is *fine* — but the breakpoints are inconsistent: `480/540/560/600/700/900/420/1441px` all appear, with a comment at 451 noting `@media` can't read custom properties. The repeated `700px` (≈9×) is clearly the canonical phone breakpoint.
- **Proposal (low-touch):** leave queries co-located (moving them risks specificity/order bugs — see the explicit ordering warning at 2649), but **standardise the breakpoint values** to a documented set (e.g. 480 / 700 / 900 / 1440) and add a comment block listing them as the canon. Don't introduce a build step or `@custom-media`.
- **Value:** medium (kills magic-number drift across breakpoints). **Risk:** medium — changing a breakpoint *value* is a behaviour change at the margins; only collapse near-duplicates (e.g. 540 vs 560) after eyeballing each.

---

## Tier 3 — Lower value / higher risk / optional

### 3.1 Overall ordering & the multi-file question
Current order is roughly: tokens → view-transitions → grid → header → nav → sections → dropzone → buttons → results/cards → media viewers (preview/histogram/palette/spectrogram/player) → info/tip → loaders → about/footer → patch → quickdrop → overlays → lightbox → dark mode → dropdown → mobile polish → late-added one-offs (markdown, visitor badge, jupyter, email, HAR, JSON tree, NFO, diagram at 5335–5896). The tail (5335→end) is **append-on-add** accretion — new format renderers tacked on the end. That's acceptable given they're self-contained, but a single pass to group them under a `/* ===== RENDERER-SPECIFIC ===== */` banner would aid navigation.
- **Multi-file (`<link>`) trade-off:** *Not recommended.* Splitting into e.g. `tokens.css`, `layout.css`, `components.css`, `renderers.css`, `dark.css` is cleaner to read but:
  - adds N extra HTTP requests on a zero-backend static site (no bundler to concatenate) — a real first-paint cost, and every page would need N `<link>`s kept in sync;
  - the SW `SHELL` precache list (`sw.js`) and the offline story would need each file added;
  - **dark mode and `:has()` rules depend on source order** (explicit warnings at 2649 and 451) — splitting files makes cross-file cascade ordering fragile and invisible.
  - **Verdict:** keep it **one file**. Improve *intra-file* sectioning instead (banners + a short table-of-contents comment at the top mapping section → line). That captures 90% of the readability benefit at zero risk.

### 3.2 `:has()` selectors — 16 uses, mostly fine, 2 worth a glance
The 16 `:has()` selectors are generally legitimate and not deeply nested:
- The `body:not(:has(.site-nav))` trio (206, 219, 220) and `:has(.about-page)` nav rules (413, 536, 4359, 4369, 4373) are page-shape detectors — reasonable, but they encode page identity structurally. **Lower-risk alternative:** add a body class (e.g. `class="page-about"` / `page-no-nav"`) in the HTML and select on that, dropping the `:has()`. Only worth it if these prove a perf or comprehension problem — currently they're not fragile, just clever.
- `.anr-view-controls:has(+ .anr-treemap-extfilter)` (4926) is an *adjacent-sibling* `:has()` controlling which element owns a separator border. It's correct but order-fragile; keep the two rules adjacent and commented (they already are).
- `.anr-control:has(input[type="range"])` (5267–5269) — fine.
- **Verdict:** no urgent simplification. If touched at all, prefer the body-class approach for the `:has(.about-page)` / `:not(:has(.site-nav))` family. **Risk:** medium (requires coordinated HTML edits across pages) for **low** value — defer.

### 3.3 `!important` (8 uses) — already minimal
Only 8 `!important` declarations, each commented with justification (e.g. card collapse at 1214, `.is-hidden` at 4665). Nothing to do; this is healthy.

---

## Quick-win execution order (recommended)
1. **1.3** delete the 19 confirmed-dead selectors (one reviewable commit, verify each).
2. **1.2 step 1** + **2.1 rgba sweep**: swap hardcoded `#333/#555/#e8e8e8` and the already-tokened `rgba(255,255,255,…)` literals to their existing tokens.
3. **1.1** introduce `--bd-hairline` and collapse the full-shorthand `1px solid var(--hairline)` cases.
4. **1.2 step 2** delete now-redundant dark overrides (base rule already uses the flipping token).
5. **2.2** rename the mislabelled section + lift the 3 real utilities; **3.1** add a top-of-file ToC comment.
6. Defer **2.3** (breakpoint values) and **3.2** (`:has()`→body-class) — behaviour-touching, lower payoff.

All Tier 1 + most Tier 2 are pixel-for-pixel behaviour-preserving and require no build step.
