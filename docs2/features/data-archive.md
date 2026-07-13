# Data, tables, archives, folders and media metadata

Tabular data and the table workbench, IMU logs, structured data, git objects and
email, archives/folders with a treemap breakdown, comics, and the small media-
metadata formats (MIDI, subtitles, lyrics). Renderers: `csv.js`, `gcsv.js`,
`dataview.js`, `gitobject.js`, `email.js`, `archive.js`, `zip.js`, `folder.js`,
`treemap.js`, `folder-archive-shared.js`, `comic.js`, `midi.js`, `subtitles.js`,
`lrc.js`, plus `web/assets/js/lib/table-stats.js` and `tablekit.js`.

## Tabular data and the workbench

### CSV / TSV

**What it does.** Detects the delimiter, parses quoted fields, infers per-column
types, and reports column stats (numeric summaries, duplicate/ragged rows).

**How to reach it.** Drop a `.csv`/`.tsv` (`csv.js`, `kind: 'csv'`); also reached
when the content sniffer recognises consistent delimiters in an unknown file.

### Table workbench (`tablekit.js`)

**What it does.** A virtualised data workbench mounted below any CSV/XLSX/XLSB/ODS
file's preview: explore the data itself, not just view it.

**How to reach it.** Automatic below a spreadsheet or CSV analysis (`tablekit.js`,
using `table-stats.js`).

**How to use it.** A virtualised grid with **sort**, **Filter column**, search, and
column tools; a group-by summary; and a chart builder (**Chart type**, needs two
numeric columns). Export with **Export rows CSV**, **Export chart PNG** and **Export
stats JSON**. Click a cell to view its full value, or a row to select it.

### Gyroflow IMU logs (.gcsv)

**What it does.** Plots the gyroscope/accelerometer traces from a Gyroflow `.gcsv`
IMU log.

**How to reach it.** Drop a `.gcsv` (`gcsv.js`, `kind: 'gcsv'`). (Sony cameras' embedded
IMU track is handled in `docs2/features/video.md`.)

### Structured data (HAR / JSON5 / NFO)

**What it does.** Viewers for HAR captures, JSON5/JSONC/HJSON, and NFO text art.

**How to reach it.** `dataview.js` (`kind: 'har'`/`jsondata'`/`nfo'`); JSON shows a
collapsible **Value tree**.

### Git objects

**What it does.** Opens git loose objects and packfiles with no git binary - commits,
trees and blobs.

**How to reach it.** Content-sniffed (zlib/PACK) to `kind: 'git-object'`
(`gitobject.js`). A tree lists its entries; **Analyse blob content** opens a blob
through the normal pipeline.

### Email (.eml / .emlx / .mbox)

**What it does.** Renders an email message (or an mbox of them): headers, body and
attachments.

**How to reach it.** Drop a `.eml`/`.emlx`/`.mbox` (`email.js`).

## Archives and folders

### ZIP and browse-as-archive

**What it does.** Inspects a ZIP's contents without full extraction, and can browse
any file that is physically a zip/rar/7z/tar (APK, DOCX, JAR, …).

**How to reach it.** Drop a `.zip` (`archive.js`, `kind: 'zip'`, fflate). For a
non-media file that sniffs as a container, a **Browse as archive** view is appended
under its primary analysis (`renderArchiveEmbedded`; see `docs2/pipeline.md`).

**How to use it.** **Open contents** lists members; **Analyse** opens a member through
the real pipeline (a drill-down breadcrumb lets you go back); text members get inline
previews. RAR/7z/tar need libarchive; single-stream compressors are decompressed to
open the file inside.

### Dropped folders and the treemap

**What it does.** Recursively walks a dropped folder, shows a size breakdown, and lets
you click straight into any file to analyse it.

**How to reach it.** Drop a folder (`folder.js` via `webkitGetAsEntry`; the shared
breakdown/treemap in `folder-archive-shared.js` + `treemap.js`).

**How to use it.** Toggle between a tree and a squarified **treemap** where every file
is a leaf rectangle sized by bytes; a breadcrumb and search navigate it, **Analyse**
opens a file, **Copy path** copies its path. An **Openability check** scans which
files Analyser can open (using the same verdict the real drop path uses) and can
**Copy paths** of those that can't. Folder analyses are recorded to the local history
(metadata only).

### Comics (CBZ/CBR/CBT/CB7)

**What it does.** A comic reader over the archive's page images.

**How to reach it.** Drop a `.cbz`/`.cbr`/`.cbt`/`.cb7` (`comic.js`, `kind: 'comic'`);
page previews with **Next**/**Prev** and arrow-key paging.

## Media metadata formats

### MIDI

**What it does.** Parses a Standard MIDI File: header, tempo map, time/key signature,
track names.

**How to reach it.** Drop a `.mid`/`.midi` (`midi.js`, `kind: 'midi'`). MIDI is a
score, not decodable audio, so it is routed here rather than to the audio player.

### Subtitles

**What it does.** Parses SRT/WebVTT/ASS/SSA/MicroDVD/SubViewer cues into a timed list
with counts, timing and styling.

**How to reach it.** Drop a `.srt`/`.vtt`/`.ass`/`.ssa`/`.sub` (`subtitles.js`); shows
a styled cue preview.

### Lyrics (.lrc)

**What it does.** Parses timed lyrics - ID tags and timestamped lines.

**How to reach it.** Drop a `.lrc` (`lrc.js`, `kind: 'lrc'`).

## Geodata and project manifests

These two aren't assigned to a specific feature doc in the plan but are genuine
user-facing viewers, so they are covered here.

### Geodata (GPX / KML / GeoJSON)

**What it does.** Parses tracks/placemarks/features, computes counts, distance and
bounds, and plots them on a map rendered locally.

**How to reach it.** Drop a `.gpx`/`.kml`/`.geojson` (`geo.js`, `kind: 'geo'`, using
the vendored Leaflet).

**Notes / limits.** Needs Leaflet (Everything offline tier); the map tiles are the
one place the page fetches from a tile server when online.

### Visual Studio solutions

**What it does.** Reads a `.sln`/`.slnx` solution manifest - the projects it contains
and their build configurations.

**How to reach it.** Drop a `.sln`/`.slnx` (`vssolution.js`, `kind: 'vssolution'`).
