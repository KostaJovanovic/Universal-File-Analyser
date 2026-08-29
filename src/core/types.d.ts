/* Analyser - shared type vocabulary.

   The contracts the codebase already relies on informally, written down. This is
   a .d.ts on purpose: it holds types only, so tsc emits no .js for it, which
   means no entry in sw.js's SHELL and no runtime weight. Import it with a .js
   specifier like any other module - `import type { Row } from './types.js'`.

   Runtime values (unions built from a real array, guards) do NOT belong here;
   put those in a normal .ts module and add it to SHELL. */

/* ------------------------------------------------------------------ kinds -- */

/** Every kind `resolveKind()` can return - i.e. every key of ROUTES in app.js.
    Kept in the same order as the table so the two are easy to diff by eye. */
export type Kind =
  | 'photo' | 'audio' | 'video'
  | 'docx' | 'xlsx' | 'xlsb' | 'epub' | 'pptx'
  | 'odt' | 'ods' | 'odp' | 'odg'
  | 'doc' | 'xls' | 'ppt'
  | 'rtf' | 'abw' | 'fb2' | 'hwpx' | 'mhtml' | 'markup'
  | 'notebook' | 'har' | 'jsondata' | 'nfo'
  | 'eml' | 'mbox'
  | 'drawio' | 'dxf' | 'dwg' | 'altium' | 'kicad' | 'spice' | 'ipcnet'
  | 'aep' | 'premiere' | 'davinci' | 'vegas' | 'daw' | 'unity' | 'vssolution'
  | 'lut' | 'xmp' | 'gcsv' | 'iwork'
  | 'stl' | 'model3d' | 'f3d' | 'solidworks' | 'gcode' | 'molecule'
  | 'timeline' | 'lrc' | 'midi' | 'subtitles'
  | 'geo' | 'markdown' | 'comic' | 'paint' | 'psd' | 'aseprite' | 'xcf' | 'sketch' | 'tracker' | 'terraria' | 'ai' | 'font'
  | 'djvu' | 'mdb' | 'mobi' | 'pdf'
  | 'zip' | 'diskimage' | 'svg' | 'lottie' | 'csv' | 'mlmodel'
  | 'proprietary' | 'plaintext' | 'git-object'
  | 'unknown' | 'extensionless';

/** The page sections a renderer can target. Only the three media kinds set
    `results`; everything else falls through to #unknownResults. */
export type ResultsSection = 'photo' | 'audio' | 'video';

/* -------------------------------------------------------------- renderers -- */

/** Options bag some renderers take as a third argument. */
export interface RenderOpts {
  /** photo.js: a sidecar .xmp found alongside the image. */
  sidecarXmp?: File | null;
  /** unknown.js: frame the file as an expected extensionless file, not "unrecognised". */
  extensionless?: boolean;
  [k: string]: unknown;
}

/** The de-facto renderer contract.

   The third parameter is genuinely polymorphic and this is NOT an accident to
   be typed away: app.js dispatches a *string* to renderProprietary/renderComic
   (an extension override) and an *object* to renderPhoto, from the same table -
   see the `route.render(...)` branch in app.js. Modelling it honestly as a union
   is what makes a wrong call site visible.

   The return type is deliberately `unknown`, not `void`. Renderers are widely
   written as `return renderProprietary(file, resultsEl)` (aftereffects, davinci,
   illustrator, iwork, lut, paint, premiere, unity, vegas, vssolution, xmp, ...)
   and renderProprietary itself ends in `return true`. The dispatcher never reads
   any of it - it only does `Promise.resolve(renderPromise).catch(...)` - so the
   honest contract is "returns something awaitable whose value is ignored".
   Typing it as `void` would flag a dozen correct call sites as errors. */
export type Renderer = (
  file: File,
  resultsEl: HTMLElement,
  arg?: string | RenderOpts,
) => Promise<unknown> | unknown;

/** One ROUTES entry. Only photo/audio/video use anything beyond `render`. */
export interface Route {
  /** Written as a METHOD, not a `render: Renderer` property, and that is
      deliberate under `strictFunctionTypes`. Method parameters are checked
      bivariantly, property-position function types contravariantly - so as a
      property, `renderProprietary(file, el, extOverride?: string)` would be
      rejected for not also accepting a `RenderOpts`. It never receives one:
      app.js pairs the string form with proprietary/comic and the object form
      with photo, in separate branches. The pairing is a dispatcher invariant the
      type system cannot see, and the method form is how TypeScript spells
      "checked bivariantly on purpose" rather than papering over it with `any`. */
  render(file: File, resultsEl: HTMLElement, arg?: string | RenderOpts): Promise<unknown> | unknown;
  /** Which results container to draw into; omitted means #unknownResults. */
  results?: ResultsSection;
  /** Nav anchors to light up, e.g. ['#video', '#audio', '#photo']. */
  nav?: string[];
  /** Which sections count as "analysed" for the stats ping. */
  analysed?: string[];
}

/** The ROUTES table. Exported as a type because the whole table is passed by
    value into renderers/compare.js, so its shape is part of a module boundary,
    not an app.js internal. Lookup is `ROUTES[kind] || ROUTES.unknown`, so every
    kind is present. */
export type RouteTable = Record<Kind, Route>;

/* ------------------------------------------------------------ parser rows -- */

/** A collapsible extra section a parser can attach to its result. */
export interface RowSection {
  title: string;
  node: Node;
  /** Start expanded. Defaults to collapsed. */
  open?: boolean;
}

/** What a parser hands back.

   Physically it is a bag of display strings (field name -> rendered value), but
   a handful of underscore-prefixed keys carry out-of-band payloads that the
   renderer pulls out and strips before printing the rest. That convention is
   load-bearing across ~290 sites; naming the keys here is what stops a typo
   silently becoming a printed field. */
export interface Row {
  /** Extra collapsible sections (by far the most used payload key). */
  _sections?: RowSection[];
  /** A prebuilt DOM node to show as the preview. */
  _previewNode?: Node;
  /** Originating application, when a parser can identify it. */
  _app?: string;
  /** Extracted plain text, for the reader view / search. */
  _readableText?: string;
  /** Detected library/toolchain that produced the file. */
  _lib?: string;
  /** Per-field help text: label -> explanation, merged over LABEL_HELP for
      this parser's rows. (A few parsers pass a single string instead.) */
  _help?: Record<string, string> | string;
  /** Embedded font details. */
  _font?: any;
  /** Classic Mac resource-fork details. */
  _rsrc?: any;
  /** PE section table (lib/pe-packer.js `PeSection[]`), stripped before printing. */
  _peSections?: any;
  /** PE header facts the packer analysis needs (lib/pe-packer.js `PeMeta`). */
  _peMeta?: any;
  /** Archive/container member listing. */
  _fileList?: any;
  /** Index/TOC payload. */
  _index?: any;
  /** Directory payload. */
  _dir?: any;
  /** Every other key is a display field: label -> already-formatted value.
     `any`, not `unknown`: a parser routinely stashes a working value under a
     label and reads it back a few lines later, and making all ~290 of those
     sites cast would buy nothing - the renderer stringifies whatever it finds. */
  [field: string]: any;
}

/** What every parser in a `parsers-<domain>` chunk is handed.

   The contract is spelled out at the top of `parsers/parser-util.ts`; naming it
   here is what lets `safe()` give the ~950 `wrap((c) => ...)` call sites their
   `c` type contextually, without an annotation at any of them. */
export interface ParseCtx {
  /** The first N bytes of the file, already read (see `limits.js` for N). */
  head: Uint8Array;
  file: File;
  /** Lower-case extension, no dot. */
  ext: string;
}

/** A parser. Returning null (or anything falsy) declines the file and falls
    through to generic handling. */
export type ParseFn = (c: ParseCtx) => Row | null | undefined | Promise<Row | null | undefined>;

/** A writable buffer of real numbers. The DSP helpers (`lib/dfn-dsp.js`,
    `lib/mdx-stft.js`) are handed a Float32Array by one caller and a Float64Array
    by another, and only ever index into them - so this names that rather than
    forcing one precision on every call site. */
export type FloatBuf = Float32Array | Float64Array | number[];

/* --------------------------------------------------------- worker protocol -- */

/** Messages the DSP/ML clients post to their workers. Both halves of each
    client/worker pair should import these so the `msg.type` checks in the
    workers are checked against the senders rather than trusted. */
export type WorkerRequest =
  | { type: 'prepare'; [k: string]: unknown }
  | { type: 'separate'; [k: string]: unknown }
  | { type: 'process'; [k: string]: unknown };

/** Messages the workers post back. */
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; value: number }
  | { type: 'result'; [k: string]: unknown }
  | { type: 'error'; error: string };
