# Analyser catalog - data / consistency audit

Source of truth: `assets/js/core/formats.js`. Cross-referenced against
`assets/js/renderers/proprietary-formats.js` (FORMATS magic/parser table),
`assets/js/renderers/proprietary.js` (`isProprietaryExt`),
`assets/js/core/app.js` (`classifyFile()` / `ROUTES`), and
`tools/format-page-content.mjs` (`EXT_PAGES`).
`tools/dyk-extra.json` exists but is unrelated (no catalog data to cross-check).

Findings are derived programmatically (see `_analyze.mjs` in this folder) and
ranked by user-visible impact.

---

## HIGH impact

### H1. Catalog tokens that neither parse nor route - drop to "unknown" (formats.js)
Two catalog `exts` tokens have no `FORMATS` entry, no `classifyFile()` branch, and
are not in any `*_EXTS` set. `isProprietaryExt(ext)` is a bare `ext in FORMATS`
lookup (proprietary.js:4096-4098) with no aliasing, so a real file with these
extensions classifies as **unknown** even though the catalog advertises support
and the SEO generator emits a `/formats/id/<ext>` page for them:

- **`truehd`** - in `IDENTIFICATION_CORE` "Surround audio" row
  (formats.js:203, `exts: 'EC3 EAC3 TrueHD THD MLP Atmos'`). The parser key is
  **`thd`** (proprietary-formats has `thd`, `mlp`, `atmos`, `ec3`, `eac3` - but
  not `truehd`). A `.truehd` file is not identified.
- **`capnproto`** - in `IDENTIFICATION_EXTENDED` "Developer / data (more)" row
  (formats.js:172, token `CapnProto`). The parser key is **`capnp`**, not
  `capnproto`. A `.capnproto` file is not identified.

Both are the most "real" data bug in the audit: the catalog promises a format the
app can't actually classify. Fix by adding `truehd`/`capnproto` aliases to
`FORMATS`, or by changing the catalog tokens to the real extensions (THD is the
genuine Dolby TrueHD extension; `.capnproto` is rarely a real file extension).

### H2. Same-depth duplicate extensions - likely accidental (formats.js)
The "full wins / id loses" dedup only resolves a full-vs-id collision. When the
**same extension sits in two rows of the same depth**, both render, the count is
unaffected (deduped lower-cased), but `formatPageHref()` and the per-ext page
generator pick one arbitrarily and the about/overlay shows the ext under two
labels. Genuine duplicates found:

- **`aepx`** appears twice in `IDENTIFICATION_CORE`: "Adobe" row (formats.js:186)
  and "Video editing" row (formats.js:201). Same depth, two labels - duplicate.
- **`sql`**: "Databases" (IDENTIFICATION_CORE, formats.js:192) and
  "Developer / data" (IDENTIFICATION_EXTENDED, formats.js:157). Two id rows.
- **`shp`**: "GIS / mapping" (IDENTIFICATION_CORE, formats.js:193) and
  "Geospatial / GIS" (IDENTIFICATION_EXTENDED, formats.js:168). Two id rows.
- **`nsf`**: "Calendar / contacts" (IBM/Lotus Notes store, formats.js:160) and
  "Audio (more)" (NES Sound Format, formats.js:169). Two genuinely different
  formats colliding on one extension - the page generator will pick one, so one
  of the two meanings silently loses its landing page. Worth an explicit note.
- **`ts`**: "Video" (FULL_ANALYSIS, formats.js:120) and "Web / code"
  (FULL_ANALYSIS, formats.js:148). Both full - the EXT_PAGES copy for `ts`
  already documents this dual meaning, so this one is intentional/known, but it
  is still two full rows claiming the same token.

Impact: about/overlay list the same ext under two categories; per-format page
routing is ambiguous. `aepx`, `sql`, `shp` are pure redundancy; `nsf` is a true
meaning-collision.

---

## MEDIUM impact

### M1. Parseable formats missing from the catalog - invisible to users (proprietary-formats.js)
~85 keys exist in `FORMATS` (so they identify when dropped) but are **absent from
the formats.js catalog**, so they have no `/formats/<ext>` SEO page, do not appear
in the overlay/about "All supported file types" list, are not searchable, and do
not count toward `formatCount()`. Many are intentional aliases/plain types, but a
sizeable set are real, distinct formats a user could reasonably drop and would
expect to see listed:

- **Graphics / images**: `cdr` (CorelDRAW), `qxp` (QuarkXPress), `flif`,
  `jbig`, `jbig2`, `cgm`, `pict`/`pct`/`icb`/`vda` (Apple PICT / TGA family),
  `epsf`, `epsi`, `bie`, `j2c`, `x3dv`.
- **3D / CAD**: `prc` (3D PDF), `vdb` (OpenVDB), `cgr` (CATIA Graphics - note the
  catalog "CAD" row lists CATPART/CATPRODUCT but not CGR), `hipnc`.
- **Audio**: `shn` (Shorten), `sfark`, `mqa`, `mo3`, `umx`, `minipsf`, `psf2`,
  `mpp`/`mp+` (Musepack), `rtx`.
- **Documents**: `scrivx` (Scrivener index), `zabw` (gzip AbiWord), `abc`,
  `comask`, `sty`, `mmd`, `asciidoc`.
- **Game / emulator**: `aseprite`, `schematic`, `schem`, `litematic`,
  `mcpack`, `mcaddon`, `sc2replay`, `rgssad`, `rgss3a`, `rpa`, `pk4`, `tsj`.
- **Forensics / system**: `dmp`, `hive`, `e01`, `etl`, `pf`, `cap`, `ntar`,
  `known_hosts`, `authorized_keys`, `binwalk`.
- **Archives**: `txz`, `tzst` (catalog lists `tlz`/`tbz`/`tz` but not these).

The reverse direction is clean: **no orphan EXT_PAGES keys**, and **no
full-analysis ext is missing its EXT_PAGES copy** (the generator's WARN list is
empty), so per-format SEO copy is fully in sync with the catalog.

Note: a long tail of the absent keys are deliberately uncataloged duplicates or
plain types - `htm`, `txt`, `yml`, `mjs`, `rpp-bak`, `db3-wal`, `db3-shm`,
`sqlite3-wal`, `sqlite3-shm`, `cls`, `afl`, `arx`, `fls`, `fws`, `h2v`, `nmea0183`,
`ofs`, `sun`, `tp`, `dio`, `mo3` casings, etc. Those are not bugs; the list above
is the subset that looks like a genuine coverage gap.

### M2. CAT_OF map has orphan keys and the "(more)" labels rely on the fallback (formats.js)
`CAT_OF` (formats.js:237-282) maps catalog `label` -> category key. Two issues:

- **Orphan mappings** - two keys in `CAT_OF` are not any catalog row's label:
  `'Documents'` -> `documents` and `'eBooks'` -> `documents`. No row carries the
  label "Documents" or "eBooks" (the real labels are "Office docs", "Text &
  markup", "Kindle e-book", etc.), so these two entries are dead. Harmless but
  stale - they suggest a rename happened and the map wasn't pruned.
- **10 `(more)` labels are intentionally absent** and fall through the
  `CAT_OF[r.label] || 'system'` default (formats.js:293) to `'system'`:
  "Developer / data (more)", "Archives (more)", "3D / CAD (more)",
  "Disk images / firmware (more)", "Game assets (more)",
  "Documents / publishing (more)", "Email / contacts (more)",
  "Security / forensics (more)", "Science / engineering (more)",
  "GIS / mapping (more)".
  Their non-"(more)" base rows ARE mapped to the correct category
  (e.g. "Developer / data" -> `data`, "Archives (packages)" -> `archives`), so
  the "(more)" extension rows land in **System & disk** in the overlay/about
  grouping rather than alongside their siblings. The CLAUDE.md contract says
  "every catalog row label must appear here". Whether this is deliberate
  (dumping the long tail into System) or an oversight, it is the single biggest
  mis-categorisation: e.g. "Science / engineering (more)" formats (RData, ABF,
  EEG, FEA decks) show under System & disk, not 3D / CAD / engineering; "GIS /
  mapping (more)" shows under System, not Maps & GIS.

---

## LOW impact

### L1. Extension casing - consistent; mixed-case tokens are all legitimate brands
- **No cross-row casing conflict**: every extension that appears in more than one
  row uses the identical curated casing in each. Clean.
- All mixed-case tokens are camelCase brand names or product casing, matching the
  documented convention (camelCase preserved only for camelCase brands):
  `WebP`, `WebM`, `glTF`, `GeoJSON`, `TopoJSON`, `PMTiles`, `MBTiles`,
  `AppImage`, `KiCad_pcb`, `LaTeX`, `TeX`, `Textile`, `SQLite`, `SQLite3`,
  `SQLite-WAL`, `SQLite-SHM`, `LRcat`, `LRtemplate`, `EditorConfig`, `GraphQL`,
  `Gradle`, `Safetensors`, `TFState`, `CapnProto`, `MsgPack`, `Hjson`,
  `Procreate`, `Keynote`, `Numbers`, `Pages`, `Sketch`, `TrueHD`, `Atmos`,
  `KSplat`, `RData`, `RVData2`, `RXData`, and the Unity asset tokens
  `physicsMaterial2D`, `physicMaterial`, `overrideController`. Nothing here
  contradicts the convention. (Note `CapnProto`/`TrueHD` casing itself is fine -
  their *routing* gap is H1, not a casing issue.)

### L2. Classification sets vs routing - clean
- No extension is in two routing sets simultaneously.
- Every `HEIC_EXTS` and `RAW_EXTS` member is also in `PHOTO_EXTS` (so photo.js
  conversion subsets are all reachable through photo routing).
- No `*_EXTS` set member is shadowed by an earlier explicit `ext === '…'` branch
  in `classifyFile()`. The explicit branches for `mid`/`midi` (routed to `midi`
  before the `AUDIO_EXTS` check) and the OOXML/ODF families are intentional and
  do not conflict with set membership.

### L3. Label/desc vs category/depth - no contradictions found
Spot-check of rows whose category mapping might fight the label: all consistent.
The notable cross-category-by-design mappings are intentional and documented in
the `CAT_OF` comments - "After Effects", "Premiere Pro", "DaVinci Resolve",
"VEGAS Pro", "Gyro log" (all `video`), "Unity" (`games`), "Visual Studio
solution" (`data`), "Diagrams" (`threed`), "Text art" (`system`). No row's `desc`
describes a depth other than the one its array implies.

---

## Summary of counts
- High: 2 catalog tokens that don't route (`truehd`, `capnproto`); 5 same-depth
  duplicate extensions (`aepx`, `sql`, `shp`, `nsf`, `ts`).
- Medium: ~30-40 genuinely-uncataloged parseable formats (of ~85 FORMATS-only
  keys); 2 orphan `CAT_OF` keys; 10 `(more)` labels falling to the `system`
  default.
- Low: casing fully consistent; routing sets fully consistent; no label/desc
  contradictions. EXT_PAGES fully in sync (0 orphans, 0 missing full-analysis
  copy).
