# Design system

The site's visual language: a Swiss / International Typographic style - black on
white, hairline rules, sharp corners, mono type, a single red accent. All styles
live in `web/assets/css/analyser.css` (the `:root` token block sits at the very
top). This is a high-priority area: treat every new UI element as a design task and
match the closest existing component.

## The hard rule: no rounded corners

The site is deliberately sharp-cornered. `--radius: 0`, and `.anr-btn` sets
`border-radius: 0`. **Never add `border-radius` to a new element** - no pills, no
rounded chips, no rounded cards. (The only `border-radius` values in the stylesheet
are intrinsic shapes: status dots and range thumbs use `50%`/small radii because
they are dots and sliders, not surfaces.)

## Design tokens

Everything themeable is a CSS custom property on `:root`. Prefer these over
hardcoded values whenever an element sits on a themed surface.

**Colour**

| Token | Light value | Meaning |
|---|---|---|
| `--bg` | `#ffffff` | Page background. |
| `--fg` | `#0a0a0a` | Foreground text. |
| `--muted` | `#6b6b6b` | Secondary text. |
| `--hairline` | `#0a0a0a` | Hairline rule colour. |
| `--rule` | `#e6e6e6` | Slightly stronger divider. |
| `--surface` | `#f4f4f4` | Raised surface fill. |
| `--accent` | `#e60023` | The single red accent. |
| `--accent-fg` | `#ffffff` | Text on accent. |
| `--partial` | `#c47a0f` | The "Partial" depth tag colour. |

Composite border shorthands resolve the nested colour so they flip with the theme:
`--bd-hairline` (`1px solid var(--hairline)`) and `--bd-rule`. Use these instead of
re-writing the border literal - `--bd-hairline` is the single most-repeated value in
the file.

**On-dark chrome.** Media surfaces (spectrogram, waveform, fullscreen viewers) are
always dark in either theme, so they use a separate theme-independent set:
`--media-bg`, `--on-dark`, `--surface-on-dark`, `--hairline-on-dark`,
`--muted-on-dark`, `--border-on-dark`, etc. Overlays on media canvases use this
fixed dark-translucent treatment so they stay legible on any canvas in either theme
(see the G-code pause tag).

**Type.** Two families: `--font-sans` (Geist) and `--font-mono` (Geist Mono). A
fixed scale from `--t-mega` down to `--t-micro`, with `--t-h3`/`--t-body` at 16px,
`--t-small` 13px, `--t-tiny` 11px. Letter-spacing tokens `--ls-caps`/`--ls-micro`,
line-height tokens `--lh-tight`/`--lh-body`/`--lh-prose`.

**Timing.** Type sizes own the `--t-*` namespace, so animation durations use their
own `--dur-*` tokens: `--dur-fast` (0.12s), `--dur-snappy`, `--dur-base`,
`--dur-slow`. View transitions run at 0.2s ease.

**Layout / rhythm.** `--gap`, `--pad-x`/`--pad-y` (clamped), `--nav-offset` (60px;
scroll targets use it as `scroll-margin-top`), `--rule-band-h`, and elevation tokens
`--shadow-color`/`--shadow-popover`.

## Component idioms to reuse

- **Buttons: `.anr-btn`.** Mono-ish sans, hairline border, `border-radius: 0`,
  inverts on hover (`background: var(--fg); color: var(--bg)`). `.is-active` /
  `.is-recording` use the accent. This is the button for the whole site - reuse it
  rather than styling a new `<button>`.
- **Borders:** `var(--bd-hairline)` (or `var(--bd-rule)`).
- **Surfaces / cards:** the `.anr-card` / `.anr-readout` idiom for analysis output.
- **Range sliders:** `.anr-range` (square track and thumb, accent thumb).
- Reach for theme variables (`var(--bg)`, `var(--fg)`, `var(--muted)`,
  `var(--font-mono)`, `var(--t-small)`) over hardcoded values on any themed surface.

## Light and dark theming

Theme is driven by `:root[data-theme="dark"]`, which overrides the colour tokens
(`--bg: #0a0a0a`, `--fg: #e8e8e8`, `--muted: #888`, `--surface: #141414`, …) - so
any element built from the tokens flips automatically. A before-first-paint theme
bootstrap script in the `<head>` (single-sourced by `stamp-head.mjs` from
`THEME_SCRIPT` in `prerender-common.mjs`) sets `data-theme` before render to avoid a
flash; the in-page dark-mode toggle is wired per-navigation in `boot()`. Always
check a new element in **both themes** and at narrow widths before calling it done.

## The `/test` reference sheet

`/test` (`web/test.html`) is a deployed-but-unlisted (noindex, unlinked) style guide
showing every token, font, animation, button, control, chip, card, message, popup,
loader and viewer overlay, with an in-page theme toggle. Its token/animation
sections are **generated** from `analyser.css` by `tools/prerender-testpage.mjs`
(run by `save.bat`; markers `TOKENS:START`/`TOKENS:END` - never hand-edit between
them). The component demos below are hand-authored static markup using the real
classes. Per `CLAUDE.md`, when you add or change a shared UI element you should
add/update its demo there - but note this repo's local guidance (see the project
memory) is to leave `web/test.html` untouched, so confirm before editing it.
