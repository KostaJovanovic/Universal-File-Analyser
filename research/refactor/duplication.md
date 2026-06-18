# Refactor plan — cross-module duplication

Scope: behaviour-preserving de-duplication of logic copy-pasted across renderers.
No build step, no framework, **no tests** — so every proposal below is a pure
"lift identical/near-identical code into a shared helper, callers import it"
move, verified manually via `server.bat`. No format-specific behaviour changes.

All paths absolute under `C:/Users/Kosta/Projekti/file analyser/`.

---

## TL;DR ranking (value vs risk vs payoff)

| # | Duplicated logic | Proposed home | Payoff | Risk | Rank |
|---|---|---|---|---|---|
| 1 | NLE timeline card shell + zoom/pan/SVG lane+label builders + TC formatters + colour palette (premiere/davinci/aftereffects) | `renderers/timeline-shared.js` (new) | ~300-400 lines | Low-Med | **A (do first)** |
| 2 | `parseXml` + `parsererror` check + `esc` + `kids/kid/txt` + NS helpers + `relId` + regex `grab` (12+ files) | `lib/xml.js` (new) | 8 `parseXml`, 4 `esc`, 2 verbatim helper trios | Low | **A** |
| 3 | `downloadBlob` / styled download `<a>` (≥10 sites) and `copyText` clipboard fallback (3 full + 5 partial) | `core/util.js` (or new `core/ui.js`) | ≥10 + 8 sites | Very low | **A (easiest)** |
| 4 | `canvasFromImage` scale-to-fit + 2D ctx + drawImage (40+ sites); contact-sheet grid (×4) | `core/util.js` / `core/ui.js` | 40+ sites | Med (per-call caps) | **B** |
| 5 | ZIP central-directory walk + raw-deflate (archive.js, davinci.js) vs shared `zip.js` local-header walk | extend `renderers/zip.js` | 2 reimpls | Med | **B** |
| 6 | Renderer-local `ascii()` + ad-hoc `DataView` magic sniffing instead of `binutil` `Reader`/`matchMagic`/`ascii` | adopt `core/binutil.js` | 1 verbatim `ascii` + many sites | Med-High | **C (selective)** |
| 7 | "Analyse this image" hop button + embedded-preview card (paint/iwork/psd/mobi/pptx/svg…) | `core/ui.js` | ~quartet+ | Low | **B** |
| 8 | Native `requestFullscreen` toggle (audio ×3 internal, stl) | small `toggleFullscreen` util | minor | Very low | **C** |

---

## 1. NLE timeline rendering — `renderers/timeline-shared.js` (NEW)  [Rank A]

Five renderers draw NLE timelines, in **three architectural families**:

- **Family A — interchange** (`timeline.js`): EDL/FCPXML/OTIO → CSS/`<div>`
  timeline, static, times in **seconds**.
- **Family B — native projects** (`premiere.js`, `davinci.js`,
  `aftereffects.js`): proprietary file → **interactive SVG** timeline with a
  frozen label column + zoom/pan scroller. **These three are near-clones.**
- **Family C — outlier** (`vegas.js`): does **not** draw a timeline (VEGAS GUID
  layout undocumented); extracts text/FX/paths only. **Excluded from sharing.**

### The big win — the whole card shell + zoom/pan engine (~210 lines, 3×)

`buildSequenceTimeline` (premiere.js:230-306), `buildTimelineCard`
(davinci.js:261-332) and `buildCompTimeline` (aftereffects.js:177-253) are
~90% identical clones:

- zoom `pct` span — premiere:243 / davinci:274 / aep:190 (identical inline styles)
- `zbtn` button factory — premiere:244 / davinci:275 / aep:191 (identical)
- zoom button row — premiere:245-249 / davinci:276-280 / aep:192-196 (identical)
- labels|scroller flex layout — premiere:252-256 / davinci:282-286 / aep:199-203
- `basePps`/`ppsNow` — premiere:258-259 / davinci:288-289 / aep:205-206
- `render()` — premiere:260-265 / davinci:290-295 / aep:207-212
- `setZoom()` — premiere:266-275 / davinci:296-305 / aep:213-222 (**byte-identical** bar a local var name)
- wheel handler — premiere:280-282 / davinci:310-312 / aep:227-229 (**byte-identical**)
- drag-to-pan — premiere:285-295 / davinci:314-324 / aep:232-242 (**byte-identical**)
- ResizeObserver fit — premiere:298-303 / davinci:326-329 / aep:245-250

Per-format variation is only: which label/lane SVG to call, `MAX_ZOOM`
(80/200/60), the meta-line string, and px-per-**second** vs px-per-**frame**.
The byte-identical wheel/drag/ResizeObserver block is the cleanest first extract.

### SVG label column + lane/bars builders

- Label column: `trackLabelsSvg` premiere.js:189-199 ↔ davinci.js:217-227 are
  **char-for-char identical** except clip-count text and `LABEL_W` (150 vs 132).
  `aepLabelsSvg` aftereffects.js:137-146 is structurally the same scaffold but
  drops the swatch and adds a 3D marker — **intentionally divergent**, but the
  `viewBox`/striped-row scaffold is shareable via callbacks.
- Lanes: `trackLanesSvg` premiere.js:202-226 ↔ aftereffects.js:149-173 are ~85%
  identical (same units, **identical `STEPS` array** premiere:209 / aep:156,
  identical striped-rows loop premiere:206-208 / davinci:234-236 / aep:153-155,
  identical clip-label slice premiere:222 / davinci:255 / aep:170). davinci.js:229-259
  is ~70% — frames not seconds (`(frame-startFrame)*ppf`), an intentional model
  difference. Unify via a `project(value)→x` callback + `tooltipOf`/`colorOf`.

### Colour palette (copied by value, in 2-3 places each)

`#3b82c4` (video), `#3ba776` (audio), `#7f8896` (data) appear in premiere
`COLOR` (186), davinci `COLOR` (214), aep inline ternary (167), **and again
hardcoded in each Legend HTML** (premiere:364-366 / davinci:420-422 /
aep:318-320). Collapse to one `TL_COLORS` const referenced everywhere.
Divergent members `gen:#9b6cc4` (davinci) and `comp:#8a6fd6` (aep) stay as
format-specific extras. `timeline.js` defers colour to CSS — leave it out.

### Timecode / fps formatters

- `fmtTime` premiere.js:182 ↔ aftereffects.js:131 — **byte-identical**.
- `fmtTick` premiere.js:183 ↔ aftereffects.js:134 — **byte-identical**.
- `fmtFps` davinci.js:211 = the inline ternary in premiere.js:238 and aep:185.
- SMPTE TC: `secToTc` timeline.js:28-35 and `tc(frame,fps)` davinci.js:201-210
  compute the same output from different units — one helper, two entry points
  (`secToTc` / `framesToTc`).
- Tick step-selection (`niceStep`/`STEPS`) duplicated 4× — timeline.js:177-182,
  premiere:209-215, davinci:238-245, aep:156-162. Same algorithm, two output
  media (span vs SVG line+text).

### Proposed `renderers/timeline-shared.js` surface

- Constants: `TL_COLORS`, default `LH`/`TOP`, `GRID_STEPS_SEC`.
- Formatters: `secToTc`, `framesToTc`, `fmtTime`, `fmtTick`, `fmtFps` — usable by
  all five files incl. timeline.js.
- `trackLabelsSvg(rows, {H, LABEL_W, labelOf, colorOf, rightText})`
- `trackLanesSvg(rows, {H, trackW, project, colorOf, tooltipOf, steps})`
- `buildTimelineCard({rows, dur, labelW, maxZoom, metaLine, labelsSvg, lanesSvg, fitUnit})`
  — absorbs the whole shell + zoom/pan/drag/resize engine.
- Optional `legendCard(items)`, `sourcesListCard(title, paths, limit)`.

### Stays put (intentional divergence)
- All parsers (`parseEdl/parseFcpxml/parsePremiere/parseTimeline/parseAep`…).
- `timeline.js`'s CSS/`<div>` renderer (184-220) — different medium; it should
  consume the shared formatters + `TL_COLORS` but keep its own DOM builder.
- `vegas.js` — no timeline; leave entirely out.
- Per-format clip/track field shapes and track-ordering rules.

**Payoff ~300-400 lines.** Risk Low-Med (must preserve byte-exact zoom/pan;
verify against real `.prproj`/`.drp`/`.aep` samples).

---

## 2. XML parsing/sanitising — `lib/xml.js` (NEW)  [Rank A]

There is **no shared XML helper** in `core/` or `lib/` today (confirmed:
util.js has no DOMParser; binutil.js only does inflate; `lib/plist.js` has its
own private `parseXmlPlist`). Every XML-touching renderer rolls its own.

### `parseXml` + `parsererror` detection — reimplemented in 8+ files

Two accidental stylistic variants (`querySelector('parsererror')` vs
`getElementsByTagName('parsererror').length`):

| File | Loc | Note |
|---|---|---|
| davinci.js | 50-54 | + unique `::`→`__` pre-sanitise (see below) |
| premiere.js | 66-70 | intentionally **throws** unless `PremiereData,Project` present |
| diagram.js | 22 | near-identical null-on-error |
| odf.js | 61-64 | near-identical |
| svg.js | 84-87 | `image/svg+xml`, keeps doc (tolerant) |
| xlsx.js | 24-26 | **no parsererror guard** (latent bug, not intent) |
| pptx.js | 47-49 | **no parsererror guard** |
| docx.js | 188-194 + 212/298/334/353/381 | 6+ raw `new DOMParser()` calls |
| epub.js | 8-10, 200-201, 326-327 | XHTML-with-`text/html`-fallback |
| textdoc.js | 34-37 | near-identical |
| geo.js | 262-263 | inline, **throws** |
| timeline.js | 125-126 | (FCPXML) null-on-error |
| lib/plist.js | 14-16 | private `parseXmlPlist` |

diagram/odf/textdoc/epub/plist are the canonical near-identical helper;
premiere/geo intentionally throw → support a `strict`/`onError` option.

### `esc` (escape `&<>"`) — verbatim 4×

davinci.js:35 ↔ premiere.js:33 ↔ aftereffects.js:30 are **byte-identical**;
diagram.js:21 is the same semantics (chained `.replace`). → `escapeXml`.

### Direct-child / text / attr DOM helpers

- `kids`/`kid`/`txt` trio — davinci.js:39-42 ↔ premiere.js:37-40 **verbatim**.
- NS-aware family (same purpose, keyed by namespace+localName): odf.js:32-59
  (`attrNS`/`isEl`/`childEls`/`elsNS`/`firstNS`) and docx.js:13-26
  (`wFirst`/`wChildren`/`wAttr`) are **structurally identical**, differing only
  in how the namespace is supplied (parameterised vs hard-coded `W`).
- `relId` fallback `getAttribute('r:id') || getAttributeNS(RELS_NS,'id')` appears
  **verbatim** in xlsx.js:99, pptx.js:93/212/229, docx.js:36.

### XML-to-readout extraction

- DOM grab `getElementsByTagName(tag)[0].textContent` — xlsx.js:155 (`get`),
  pptx.js:120 (`get`), odf.js:258-275 (`dc`/`mt`): near-identical → `elemText`.
- Regex grab (avoids DOMParser) — docx.js redefines the same `grab` closure **4×**
  (242, 263, 401, 415); aftereffects.js:121 same idea for XMP → `regexGrab`.

### The one genuinely novel snippet — davinci's `::` fix

davinci.js:44-54 rewrites C++-style `::` in tag names to `__` so DOMParser will
accept Resolve's XML at all. **Unique.** → expose as **opt-in**
`sanitizeTagSeparators(xml)`; davinci calls `parseXml(sanitizeTagSeparators(xml))`.

### Proposed `lib/xml.js` surface
`parseXml(text,{strict})`, `parseXhtml(text)` (epub fallback),
`sanitizeTagSeparators`, `escapeXml`, `childEls`/`firstChildEl`/`childText`,
`elemText`, NS-aware `attrNS`/`isEl`/`childElsNS`/`elsNS`/`firstNS`, `relId`,
`RELATIONSHIPS_NS`, `regexGrab`, optional `serialize(node)`.

### Stays put (intentional divergence)
- vegas.js (UTF-16 scrape), aftereffects RIFX/XMP regex, model3d.js (3MF default
  namespace defeats CSS selectors — comment at model3d.js:59) **avoid DOMParser
  on purpose** — do not route them through the shared parser.
- svg.js's **security** sanitiser `sanitizeSvg` (15-48) is a different concern
  from well-formedness; keep it in svg.js (or export as `sanitizeSvgDom`), don't
  conflate under one `sanitize` name.
- Two error contracts (null vs throw) must both be supported.

Risk Low — pure helpers, callers keep their own predicates via options.

---

## 3. Download + clipboard helpers — `core/util.js` (or new `core/ui.js`)  [Rank A, easiest]

**Already shared (do NOT recreate):** `attachZoomPan`, `asciiBar`,
`integrityCard`, `openOverlayBack`, `buildFileTree` (util.js) — these are used
correctly by most lightboxes. Gaps:

### `downloadBlob` — `URL.createObjectURL`→`<a download>`→click→revoke, ≥10 sites

Variant A (programmatic): audio.js:454-461, audio.js:1223-1228,
sony-rtmd.js:312-317, video.js:155-159 / 2069-2073 / 2776-2777 / 3317,
photo.js:2069-2073 / 2158-2162 / 2554, pdf.js:777-783 / 927-929, comic.js:108.
Bodies are near-identical; only the filename, mime, and revoke delay
(500/1000/2000/10000ms, chosen ad hoc) vary.
Variant B (styled `<a class="anr-btn" download>`): embedded-images.js:52-58,
media-reverse.js:45-51, video.js:172-178, photo.js:2455-2458.
→ `downloadBlob(filename, blob)` (single revoke policy) +
`downloadButton(label, {blob|href, filename, signal?})`.
**Intentional divergence:** embedded-images.js ties revoke to an `AbortSignal`
(only one) and has a tainted-canvas fallback; video's WAV row reuses the
existing player URL. Keep those.

### `copyText` — clipboard with `execCommand` fallback, 3 full + 5 partial

Full fallback reimplemented in util.js:505-518 (inline in `buildFileTree`),
treemap.js:478-483 (near-clone), popups.js:381-397 (`copyText`, but **private**
to `showShareModal` — the most robust version). Clipboard-only (would benefit):
paged.js:305/336, pdf.js:496, photo.js:2734, svg.js:248.
→ export `copyText(text):Promise<boolean>` (lift popups.js's version) +
optional `wireCopyButton(btn, text, {idle, done})` for the "Copied!→reset"
flash reimplemented at popups.js:398-402, photo.js:2734, svg.js:248, treemap.

Risk very low (small, dependency-free DOM utils). Best first PR.

---

## 4. Canvas/image boilerplate — `canvasFromImage`  [Rank B]

"create canvas, size to scaled image, get 2d ctx, drawImage" appears 40+ times:
photo.js:1006-1018 / 1147-1155 / 1166-1169 / 1348-1356 / 1405-1413 / 1963-1966 /
2087-2094, svg.js:187-195, embedded-images.js:67-71, pdf.js:41-46 / 707-710,
proprietary.js:558-561 / 709-712, psd.js:143, video.js:127-128 / 1027-1030 /
3065-3069 / 3099-3101. Each computes `scale = min/max(LIMIT/dim)`, rounds, makes
the canvas, draws. Only the cap constant (2000 OCR/peaking, 1024 svg, 1:1) and
`imageSmoothing*` (photo OCR only) vary.
→ `canvasFromImage(img, {maxDim, smoothing}) → {canvas, ctx, w, h}`.
Contact-sheet grid (`pad + c*(tw+pad)` tiling) duplicated 4×: photo.js:2087-2099,
video.js:2359-2368 / 2794-2806 / 3290-3307 → `buildContactSheet(images, {cols,tw,th,pad})`.
**Stays put:** gif-frames/webp-frames/photo-GIF use `putImageData(new ImageData)`
on raw pixel buffers — can't use a `drawImage` helper.
Risk Med — must thread the per-call cap constants through faithfully.

---

## 5. ZIP central-directory reading — extend `renderers/zip.js`  [Rank B]

Most OOXML/iWork/ODF/comic/paint/textdoc/proprietary renderers **already** use
the shared `zip.js` (`openZip`/`readZipEntries`/`inflateToBytes`). Two outliers
re-implement ZIP reading with a **different strategy** (central-directory walk
for random access, vs zip.js's sequential local-header walk):

- **archive.js:26-83** `parseZipEntries` — full EOCD scan (0x06054b50) +
  central-dir walk (0x02014b50) with CRC, DOS date, **Zip64 extra-field
  detection** (the richest reader). Used for the archive breakdown.
- **davinci.js:66-106** `readZip` + `readEntryText` — EOCD + central-dir walk
  keeping `lho` for random-access per-entry inflate via `deflate-raw`. Needed
  because Resolve `.drp` bundles can be large and entries are read by name.

zip.js's `readZipEntries` (8-33) deliberately walks **local** headers from the
front and bails on data-descriptor entries (bit 3) — fine for small front-loaded
OOXML, wrong for large/streamed archives, which is exactly why davinci/archive
roll their own central-dir version.
→ Add a central-directory reader to `zip.js` (e.g. `readCentralDir(file)` →
entries with `lho`, plus a random-access `inflateEntry(file, entry)` using
`deflate-raw`). davinci.js and archive.js then call it; archive.js keeps its
Zip64/CRC/DOS-date decoration on top. The raw-deflate dance is itself duplicated:
zip.js:38-54 (manual reader loop) vs davinci.js:104-105 / diagram.js via
`binutil.inflate('deflate-raw')` — standardise on `binutil.inflate`.
**Stays put:** zip.js's local-header walk (a legitimately different, cheaper
path for small front-loaded archives) — keep both readers, just share the
central-dir one.
Risk Med (ZIP edge cases: Zip64, data descriptors, encrypted entries).

---

## 6. Magic sniffing / Reader cursor — adopt `core/binutil.js`  [Rank C, selective]

The lazy **parser chunks** (`parsers-*.js`) already consistently import and use
`Reader`/`matchMagic`/`ascii`/`startsWithAscii` from binutil.js — that side is
clean. The **renderers** mostly bypass it: 352 raw `DataView`/`getUint*`/
`String.fromCharCode` occurrences across 31 renderer files (heaviest: video.js
65, photo.js 38, audio-codec.js 33, davinci.js 17, archive.js 19).

- **Verbatim duplicate:** proprietary.js:18-25 defines its own `ascii(buf,start,len)`
  that is **byte-identical** to binutil.js:105-113 (`ascii`). proprietary.js
  already imports `findBytes,utf16,utf8` from binutil (line 7) — just add `ascii`
  and delete the local copy. **Trivial, do this.**
- The ad-hoc `view.getUint32(0)` magic checks scattered through proprietary.js
  (95, 863, 1088…) and the binary renderers (psd/tiff/ico/mpo/audio-codec) could
  use `matchMagic`/`Reader`, but these are deep, format-specific, well-tested-by-
  hand parsers with no test net — **mechanical Reader migration is high-risk for
  low payoff**. Recommend only: (a) the proprietary.js `ascii` dedupe, and (b)
  using `Reader` opportunistically in *new* renderers, not a sweep of existing
  ones.

Risk Med-High for a broad sweep; the single `ascii` dedupe is risk-free.

---

## 7. "Analyse this file" hop button + embedded-preview card — `core/ui.js`  [Rank B]

The hop mechanism `window._anrHandleFile(new File(...), {nested:true})` /
`renderPhoto(file, …, {sourceNote})` is centralised (used 33× across 14 files),
but the **button + preview card around it is hand-built each time**:
paint.js:43-53, iwork.js, psd.js, mobi.js, pptx.js:237, svg.js:201,
embedded-images.js, photo.js:2060-2064 / video.js (frame "Analyse"). The
paint/iwork/psd/mobi "preview image card + Analyse-this-image button" blocks are
essentially identical.
→ `analyseHopButton(label, fileFactory)` and/or
`embeddedPreviewCard({bytes, ext, heading, alt})`. Risk Low.

---

## 8. Fullscreen toggle — small `toggleFullscreen` util  [Rank C]

Native `requestFullscreen()`/`fullscreenchange` toggle is duplicated **within**
audio.js 3× (`isFs`/`exitFs` at 509-510, 781, 1716) and again in stl.js:330-335.
Distinct from the in-page lightbox (real Fullscreen API) — **intentionally not**
the `openOverlayBack` path. A tiny `toggleFullscreen(el)` would de-dupe
audio↔stl and audio's internal triplicate. Minor payoff.

Also note pdf.js:715-718 hand-rolls a `position:fixed;inset:0` backdrop instead
of reusing the shared lightbox CSS classes (its main viewer does use
`openOverlayBack`); photo.js:195-266 builds its own OCR-language modal rather
than going through `openOverlayBack`. Both are small, fold-onto-shared-pattern
candidates.

---

## Suggested sequencing

1. **#3 download/copy helpers** — smallest, byte-identical, touches everything → safest warm-up.
2. **#2 `lib/xml.js`** — broad, low-risk, high count.
3. **#1 `timeline-shared.js`** — biggest single line win; verify against real NLE samples.
4. **#6a** proprietary.js `ascii` dedupe (trivial), **#7**, **#8** — quick follow-ups.
5. **#4 canvas** and **#5 ZIP central-dir** — more care (per-call caps; ZIP edge cases).

Per CLAUDE.md: any new `core/ui.js` or `lib/xml.js` must be added to the `SHELL`
array in `sw.js` for offline caching. No tests exist — verify each via
`server.bat` against representative sample files before relying on it.
