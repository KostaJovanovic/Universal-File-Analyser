# Data and archives

CSV/tabular data and the shared table workbench, IMU logs, structured-data
viewers (HAR/JSON supersets/NFO), git objects, email, archives, folders,
treemap visualisation, comics, MIDI, subtitles, and lyrics. Source:
`csv.js`, `gcsv.js`, `dataview.js`, `gitobject.js`, `email.js`, `archive.js`,
`zip.js`, `folder.js`, `treemap.js`, `folder-archive-shared.js`, `comic.js`,
`midi.js`, `subtitles.js`, `lrc.js`, `tablekit.js`,
`web/assets/js/lib/table-stats.js`, `vssolution.js`.

### CSV/TSV preview

**What it does.** Detects the delimiter, parses quoted fields, infers
per-column types, reports numeric statistics, and previews the first 100
rows.

**How to reach it.** Drop a `.csv`/`.tsv` (or any file that content-sniffs
as delimiter-consistent text - see [`pipeline.md`](../pipeline.md)). Built in `csv.js`.

**How to use it.** The preview automatically mounts the full `tablekit.js`
workbench below it (see "Table analysis workbench" below) for interactive
sorting/filtering/charting. A file that looks like a Gyroflow IMU log is
detected and handed to `gcsv.js`'s gyro-specific view instead.

### Table analysis workbench

**What it does.** A full data-analysis toolkit mounted below any
CSV/XLSX/XLSB/ODS table: a virtualised grid (only visible rows are drawn),
column sort/filter/search/hide/reorder/split, a stats bar, group-by
summaries, and a chart builder covering line/bar/scatter/histogram/pie/
area/box/heatmap on one hand-drawn canvas (no chart library) with
auto-suggested charts and PNG/JSON/CSV export.

**How to reach it.** Automatic wherever a table renders - `csv.js`,
`xlsx.js`, `xlsb.js`, `odf.js` (ODS) all lazily mount it. Built in
`tablekit.js`.

**How to use it.**

- **Grid**: click a column header to sort (ascending, then descending, then
  back to original order) and select the whole column (shows its stats
  below - text columns report distinct counts and most-common values);
  click a row number to select that row; drag across cells to select a
  rectangle (summarised live in the stats bar).
- **Columns** menu shows/hides individual columns.
- **Split column**: pick a column and delimiter (auto-detected by default)
  to break one packed column into several real columns, splitting its
  header name too; **Undo split** reverts. Column **Up/Down** buttons
  reorder columns.
- **Filter**: the gear on each header opens a filter popup (**Apply**/
  **Clear**) - a min/max range for numbers, a "contains" match for text; the
  search box filters across every column at once.
- **Stats bar**: for the current selection, reports count/sum/average/
  median/min/max/standard deviation.
- **Summarise ("For each ... show the ...")**: pick a group-by column, a
  target number column, and an aggregate (count/sum/average/min/max/
  median - count needs no number column) via the **group-by key/aggregate/
  value selects**; rows roll up into per-group totals live. **Plot as bar**
  charts the result directly.
- **Charts**: **chart-type buttons** pick the type; fields update the
  drawing instantly; hovering a bar/point/slice shows its exact value;
  **suggested chart buttons** are one-click presets; **Plot selected range**
  charts whatever's currently selected in the grid; **Stacked: on/off**
  toggles stacked mode.
- **Export**: **Export chart PNG**, **Export stats JSON**, **Export rows
  CSV** (respects current filter/sort).

Chart and plotting controls (the chart-type buttons are a segmented toggle):

```demo
btn active: Bar
btn: Line
btn: Scatter
btn: Histogram
btn: Pie
```

```demo
btn: Plot as bar
btn: Plot selected range
```

**Stacked** is an on/off toggle:

```demo
btn active: Stacked: on
```

Each column filter popup, and the workbench exports:

```demo
btn: Apply
btn: Clear
```

```demo
btn: Export chart PNG
btn: Export stats JSON
btn: Export rows CSV
```

**Notes / limits.** Rows are capped (`SAMPLE_CAP` in `table-stats.js`) and
chart points decimated (`MAX_POINTS` in `tablekit.js`) to keep the canvas
responsive on large datasets.

### Table statistics helpers (shared)

**What it does.** Pure, DOM-free math shared by `csv.js` and
`tablekit.js`: column type inference, numeric description (mean/median/
stddev/percentiles), Pearson correlation, and grouping.

**Notes / limits.** No controls of its own - a shared library
(`web/assets/js/lib/table-stats.js`). Parses ambiguous D/M-vs-M/D dates
**day-first**, matching the site's European/British convention, rather than
`Date.parse`'s US month-first fallback.

### Gyroflow IMU log viewer (.gcsv)

**What it does.** Parses Gyroflow's generic IMU-log interchange format (the
same format Analyser exports from a Sony video's gyro track, see
[`eda-nle.md`](eda-nle.md)'s Sony rtmd entry): a header of key,value lines
(scale factors converting raw columns to real units - time to seconds,
gyro to rad/s shown as deg/s, accel to g) followed by a column-header line
and samples, plotted via the same gyro/accel timeline viewer `sony-rtmd.js`
uses.

**How to reach it.** Drop a `.gcsv`. Built in `gcsv.js`.

**Notes / limits.** Capped at 64MB text read; the trace is decimated to
4000 points to keep the canvas responsive.

### Structured-data and text-art viewers (HAR / JSON supersets / NFO)

**What it does.** Three lightweight viewers sharing only a "show what
people actually care about" goal: **HAR** (`.har`, an HTTP Archive JSON
capture) rendered as a request table (method, status, type, size, time,
URL) with a summary; **JSON supersets** (`.json5`/`.jsonc`/`.hjson`) shown
as selectable source, and, when they parse after comment/trailing-comma
stripping, as an expandable collapsible value tree; **NFO** (`.nfo`,
scene-release ASCII art) decoded from CP437 (its native code page) and
shown in a monospace block.

**How to reach it.** Drop a `.har`/`.json5`/`.jsonc`/`.hjson`/`.nfo`. Built
in `dataview.js`.

**How to use it.** JSON tree nodes are `<details>` elements - click to
expand/collapse; children are lazily built only on first expand.

### Git object viewer

**What it does.** Opens git repository objects with no server and no git
binary: loose objects (`.git/objects/ab/cdef...`, zlib-compressed `<type>
<size>\0<payload>`) inflated via the browser's native
`DecompressionStream` (no library) and parsed by type (commit/tag text,
tree entry listing, or a blob handed to the main analyser); pack files
(`.pack`) and pack indexes (`.idx`) read for header + object count.

**How to reach it.** Drop a loose git object (detected by content -
`sniffGitObject()`, called from the drop pipeline's magic-byte sniff, since
loose objects are extensionless) or a `.pack`/`.idx` file. Built in
`gitobject.js`.

**How to use it.** For a blob object, click **Analyse blob content** to
re-run the git blob's sniffed content through the full analyser.

```demo
btn: Analyse blob content
```

### Email message viewer (.eml/.emlx/.mbox)

**What it does.** Parses RFC 822/MIME messages: headers (unfolding
continuation lines, decoding RFC 2047 encoded words), walks the MIME tree
for a displayable body (preferring `text/html` sanitised, else
`text/plain`), and lists attachments. Sender authentication (SPF/DKIM/
DMARC) is surfaced from the `Authentication-Results` header.

**How to reach it.** Drop a `.eml`/`.emlx` (Apple Mail, which prefixes a
byte-count line and appends a plist trailer) or `.mbox` (concatenates many
messages, each starting with a `From ` separator line). Built in
`email.js`.

**How to use it.** For an `.mbox` with multiple messages, click **Show more
messages** to reveal additional ones.

```demo
btn: Show more messages
```

**Notes / limits.** No network fetches and no scripts ever run - the HTML
body is sanitised the same way the MHTML viewer sanitises saved web pages.

### Archive inspection (ZIP and beyond)

**What it does.** Inspects ZIP archives by reading the central directory
(no full extraction needed for listing), with treemap/breakdown/tree views
shared with the folder viewer. Also handles RAR/7z (via lazy libarchive
WASM), and raw single-stream compression (gzip, XZ, LZ4, legacy `.Z`,
LZMA) via dedicated decompressors.

**How to reach it.** Drop a `.zip`/`.rar`/`.7z`/`.gz`/`.xz`/`.lz4`/`.Z`/
`.lzma` or other recognised archive extension. Built in `archive.js`,
sharing `folder-archive-shared.js` for the treemap/breakdown/tree UI.

**How to use it.** **Verify entry CRCs (N files)** recomputes each entry's
CRC-32 and compares it to the value stored in the archive (integrity
check). For a single-file-compressed archive (e.g. a bare `.gz`), **Analyse
`<inner file>`** opens the decompressed inner file in the full analyser.
The shared **Filter by type** control (from `folder-archive-shared.js`)
opens a popup of per-extension chips to narrow the treemap.

```demo
btn: Verify entry CRCs (12 files)
btn: Filter by type
```

**Notes / limits.** ZIP parsing (`zip.js`) prefers a central-directory read
with ranged fetches per entry (order-independent, never loads the whole
file), falling back to a sequential local-header walk for truncated/
headerless archives - see [`renderers.md`](../renderers.md).

### Folder overview

**What it does.** Recursively walks a dropped folder (via
`webkitGetAsEntry`) and renders a treemap + summary, sharing the same
breakdown/view-toggle UI as the archive viewer.

**How to reach it.** Drop a folder onto the page. Built in `folder.js`.

**How to use it.** **Copy paths (N formats)** copies one sample file path
per unrecognised format found in the folder, useful for reporting a gap;
**Show folder analysis** reveals the full analysis panel; **Check which
files open (N)** scans every file in the folder and flags any that can't
actually be opened (a file only counts as "can't open" if its sole viewer
path fails outright - unreadable bytes, a HEIC that won't convert, or a
RAW with no usable preview or working decode; everything else - metadata,
a hex dump, or a "browser can't preview this" banner - counts as openable).

```demo
btn: Copy paths (3 formats)
btn: Show folder analysis
btn: Check which files open (128)
```

**Notes / limits.** The openability scan has a 45-second timeout per file
so one stuck file can't hang the whole scan.

### Treemap visualisation

**What it does.** A nested, squarified treemap (WizTree-style): every file
in every subfolder rendered at once, leaf rectangles sized by byte size and
coloured by category, nested inside folder frames, canvas-based with hover
tooltips.

**How to reach it.** Shared component powering both `folder.js`'s and
`archive.js`'s size-breakdown views. Built in `treemap.js`.

**How to use it.** Click a tile to zoom into that folder, or open a file's
action menu (**Cancel**/**Copy**/**Analyse**); the **breadcrumb** ("All
files" / folder buttons) navigates back up the zoom stack; a tile
representing many small files opens an aggregated popup list with a
**close (×)** button, a **filter-by-name** search box, and a **row click**
per file to analyse it directly.

```demo
btn: Analyse
btn: Copy
btn: Cancel
```

### Comic book archive viewer (CBZ/CBR/CBT/CB7)

**What it does.** Mirrors the PDF viewer's UX: a metadata card, a
page-thumbnail grid, and a click-to-open lightbox reader with prev/next
(and arrow-key) navigation. Pages are image files inside the archive,
extracted on demand so a 200-page comic doesn't build hundreds of object
URLs up front.

**How to reach it.** Drop a `.cbz` (a ZIP), `.cbt` (a TAR, walked by a
minimal built-in reader), or `.cbr`/`.cb7` (via the lazy libarchive
unrar/7z WASM loader). Built in `comic.js`.

**How to use it.** Click **Read (N pages)** to open the page reader/
lightbox starting from page 1.

```demo
btn: Read (48 pages)
```

### MIDI (Standard MIDI File)

**What it does.** A hand-written SMF parser: header, tempo map, time/key
signature, track names, General MIDI instruments (program changes), note
counts, and duration.

**How to reach it.** Drop a `.mid`/`.midi`. Built in `midi.js`.

**Notes / limits.** No playback - MIDI is a score, not sampled audio, and
browsers can't decode it directly. No interactive controls, a readout only.

### Subtitle files (SRT/WebVTT/ASS/SSA/MicroDVD/SubViewer)

**What it does.** Parses cues into a timed list and reports counts,
timing, and styling info.

**How to reach it.** Drop a `.srt`/`.vtt`/`.ass`/`.ssa`/`.sub`. Built in
`subtitles.js`.

**Notes / limits.** The `.sub` extension is overloaded - it carries text
(MicroDVD frame-based or SubViewer time-based) as well as the unrelated
binary VobSub bitmap subtitle format, so the module sniffs which one a
given `.sub` actually is before parsing. No interactive controls, a
readout only.

### LRC timed lyrics

**What it does.** Parses `.lrc` timed-lyric files: ID tags like
`[ar:Artist]` and timestamped lines like `[00:12.34]text`, including
multiple timestamps per line and enhanced word-level `<00:12.34>` tags.

**How to reach it.** Drop a `.lrc`. Built in `lrc.js`.

**Notes / limits.** No interactive controls, a readout of metadata and
timed lines.

### Visual Studio solution manifest (.sln/.slnx)

**What it does.** Parses the project list and build configurations out of
a Visual Studio solution: classic `.sln` (a line-based text manifest -
format-version line, `# Visual Studio <year>` comment, one `Project(...) =
"Name", "Path", "{GUID}"` line per project, and `Global`/`GlobalSection`
blocks) or the newer XML `.slnx` (a terser `<Solution>` tree of
`<Project Path="...">`/`<Folder>`/`<Configurations>`), both resolved to
the same readable summary. Well-known project-type GUIDs (and, for
`.slnx`, project file extensions) are mapped to a friendly language/kind
label (C#, C++, Python, Node.js, etc.).

**How to reach it.** Drop a `.sln`/`.slnx`. Built in `vssolution.js`.

**Notes / limits.** No interactive controls, a readout only. Common
alongside Unity/MonoDevelop projects (`Assembly-CSharp`).
