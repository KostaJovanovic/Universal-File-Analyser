# Design system

The visual language behind Analyser's Swiss/International Typographic
Style: theme tokens, the sharp-corners rule, shared component idioms, and
the `/test` reference sheet. For anyone styling a new UI element - read this
alongside the "Site aesthetics" section of the repo root `CLAUDE.md`, which
is the authoritative source of the rules themselves; this doc maps them to
where they live in `analyser.css`.

## Token system

All tokens are CSS custom properties on `:root` in
`web/assets/css/analyser.css`:

- **Colour**: `--bg`, `--fg`, `--muted`, `--hairline`, `--rule`, `--surface`,
  `--accent` (`#e60023`, the red accent), `--accent-fg`, `--partial`
  (yellowish-orange, the "Partial" support-depth tag). Composite border
  shorthands `--bd-hairline` (`1px solid var(--hairline)`) and `--bd-rule`
  (over the slightly-stronger `--rule` colour) are the most-repeated literal
  in the file - both flip automatically with the theme since they resolve
  the underlying colour var.
- **Always-dark media chrome**: `--media-bg`, `--on-dark`,
  `--surface-on-dark`, `--hairline-on-dark`, `--hairline-strong`,
  `--border-on-dark-ctl`, `--muted-on-dark`, `--border-on-dark`,
  `--border-on-dark-strong`, plus `--white-a40`/`--white-a80` alpha tints.
  These live on always-dark surfaces (spectrogram, waveform, fullscreen
  overlays) and deliberately do **not** get a `[data-theme="dark"]`
  override, since they're already dark regardless of site theme.
- **Type**: `--font-sans` (Geist), `--font-mono` (Geist Mono), a fluid scale
  from `--t-micro` (10px) through `--t-mega` (`clamp(64px, 13vw, 200px)`).
- **Rhythm/timing**: `--gap`, `--pad-x`/`--pad-y` (fluid), `--lh-tight`/
  `--lh-body`/`--lh-prose`, `--ls-caps`/`--ls-micro` (letter-spacing), and a
  `--dur-*` namespace (`--dur-fast` 0.12s through `--dur-slow` 0.3s) kept
  separate from the `--t-*` (type-size) namespace to avoid collision.
  `--radius: 0` is the sharp-corners token (see below).
- **Elevation**: `--shadow-color`/`--shadow-popover`.

Theme switching sets `data-theme="dark"` on `<html>` (bootstrapped
before-first-paint by the inline script in each page's `HEAD:START`/
`HEAD:END` block - see `docs/architecture.md` and the `shared-partials`
skill) and overrides the light-mode colour tokens; component CSS should
reference the tokens rather than hardcoded colours so it Just Works in both
themes.

## Sharp-corners rule

CLAUDE.md states this as a hard rule: no rounded corners anywhere,
`.anr-btn` sets `border-radius: 0` explicitly (`analyser.css:1210`), and new
elements should follow suit. In the actual stylesheet this holds almost
everywhere - buttons, controls, cards, chips - but a handful of specific,
narrow exceptions exist beyond the documented "overlays on media canvases"
case (view-cube 3D navigation edges/corners at `analyser.css:2003-2004`,
colour-LUT swatch/frame previews, and a DaVinci Resolve colour-grade "node
chip" pill at `analyser.css:2033`). These read as deliberate, localised
choices for specific widget shapes (a cube, a colour swatch, a pill tag)
rather than a departure from the rule for ordinary UI - when adding a new
element, default to `border-radius: 0` per CLAUDE.md unless it's this same
kind of special-purpose shape.

## Theme variables and idioms

- **`.anr-btn`** (`analyser.css:1200`) - the standard button: `--bd-hairline`
  border, `--bg`/`--fg` colours, hover-inverts to `--fg` background. Used
  throughout renderers for every action button (record, live spectrogram,
  play/pause transports, download, export, ...).
- **`--bd-hairline`/`--bd-rule`** - the standard border treatment for cards,
  dividers and section rules.
- **`var(--muted)`** for secondary/help text, **`var(--font-mono)`** for
  numeric/code readouts, **`var(--t-small)`** for compact UI chrome (badges,
  hints).
- Cards, tables, and readouts generally live inside `.anr-results` /
  `row()`/`rowHelp()`-built structures from `core/util.js`, styled once in
  `analyser.css` rather than per-renderer.

## Light/dark theming and narrow widths

New UI should be checked in both themes and at narrow widths before it's
considered done (per CLAUDE.md). Dark-theme overrides are scoped selectors
like `:root[data-theme="dark"] <selector>` layered after the light-mode
default, rather than a parallel dark stylesheet - so a new component
typically only needs an override rule if it hardcodes a colour instead of
using the token vars.

## The `/test` reference sheet

CLAUDE.md documents `web/test.html` (served at `/test`) as a
deployed-but-unlisted (noindex, unlinked) style-guide page: every token,
font, animation, button, control, chip, card, message, popup, loader and
viewer overlay the site uses, with an in-page theme toggle. Its token and
animation sections are meant to be generated from `analyser.css` by
`tools/prerender-testpage.mjs` (run by `save.bat`, between `TOKENS:START`/
`TOKENS:END` markers - never hand-edited); the component demos are
hand-authored static markup using the real classes, and CLAUDE.md's stated
policy is to add/update a demo there whenever a shared UI element changes.

**As of this writing, `web/test.html` does not exist in the working tree**
(confirmed: no file at that path) - so its current contents/coverage
couldn't be verified from source for this doc. Per project memory, this
page has been deliberately left untouched/out of scope for recent work
(the user asked to "ignore the test page completely"), which likely
explains the gap between CLAUDE.md's description and the file's absence.
Treat CLAUDE.md's description of `/test` as the intended design, not a
verified current state.
