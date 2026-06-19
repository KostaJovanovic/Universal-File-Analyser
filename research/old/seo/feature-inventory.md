# Analyser - Complete Feature / Capability Inventory (SEO research note)

A research note for marketing / about-page copy. Catalogues everything Analyser
can DO, with concrete feature names (these are the SEO keywords) and the source
file backing each non-obvious claim. Analyser is a zero-backend, browser-only
forensic file workbench: vanilla ES-module JS, no upload, no install, on-device
WASM. Catalog source of truth: `assets/js/core/formats.js`.

Format count is computed live from the catalog (`formatCount()`); the static
surfaces currently read ~1017-1061 depending on which page (stamped by
`tools/stamp-counts.mjs`). Treat "1000+ formats" as the safe headline number.

---

## 1. Headline capabilities (the big differentiators)

| Capability | Supporting fact / source |
|---|---|
| **100% on-device / private** - nothing is uploaded, ever | All analysis runs via the File API in the browser; "No upload, no analytics, no servers in the loop" (`index.html` footer). Status pill literally reads "Local-only". |
| **No install, no account, free** | Static site; `WebApplication` JSON-LD marks `isAccessibleForFree: true`, price 0 (`index.html`). |
| **Offline PWA** - installable, works with no internet | Service worker precaches the app shell; "Install as app" / "Add to home screen" (`index.html`, `about.html` "Works without internet"). |
| **Tiered offline downloads** | Three pre-cache tiers: **Essentials ~50 MB** (whole app, open any file offline), **Everything ~78 MB** (adds OCR, PDF, GPS maps, QR, HEIC, archives, OpenCASCADE CAD), **Complete ~325 MB** (adds 30+ OCR languages + EPS/PostScript via Ghostscript) (`index.html`). |
| **Lazy-loaded WASM** - light initial load | Heavy engines fetched only when needed: FFmpeg (~31 MB), ImageMagick/magick-wasm (~15 MB), Ghostscript (~16 MB), OpenCASCADE/occt (~9 MB), LibreDWG (~7 MB), Tesseract, OpenJPEG, libarchive (`index.html` dependency list). |
| **1000+ file formats** in one tool | `formatCount()` over `FULL_ANALYSIS` + `IDENTIFICATION` in `formats.js`. |
| **Two analysis depths** | "Full" = opens in a viewer with deep metadata; "ID" = identified + header metadata. Per-row badge derived from which catalog array the row lives in (`formats.js`, `fmtItem()`). |
| **Forensic / metadata extraction angle** | SHA-256 file hashing, magic-byte identification, AI-generation marker detection, EXIF/GPS, zip-bomb + path-traversal detection - positioned as a "forensic workbench". |
| **No ads, no telemetry** | Stated throughout meta description and about page. British spelling, em-dash-free house style. |

---

## 2. Per-category capability breakdown

### Photos & images
Source: `photo.js`, `photo-convert.js`, `embedded-images.js`, `mpo.js`, `ico.js`,
`tiff.js`, `gif-frames.js`, `webp-frames.js`, `gif-encode.js`, `parsers-image.js`.

- **EXIF / IPTC / XMP / ICC** metadata parse (via exifr), camera make/model, lens, exposure, ISO, aperture, shutter, focal length.
- **GPS coordinates plotted on an interactive Leaflet + OpenStreetMap map** (lazy-loaded only when the photo has GPS).
- **RGB colour histogram** with luminance backdrop; **dominant colour palette extraction** (colour quantisation).
- **On-device OCR** (text-in-image) via Tesseract.js with a **30+ language picker** (English offline, others CDN-cached).
- **QR code detection** (jsQR).
- **AI-generation marker detection** - C2PA Content Credentials + keyword scanning.
- **Perceptual hash (pHash)** via DCT on a downsampled image; **sharpness score** (Laplacian variance); focus-region variance map; shadows/midtones/highlights distribution; **SHA-256** of the file.
- **Embedded-image extraction**: every size in an **ICO**, both halves of an **MPO** stereo 3D pair, every page of a multi-page **TIFF**, with per-image download.
- **Format conversion in-browser**: **HEIC/HEIF -> JPEG** (heic2any); **camera RAW -> PNG** via ImageMagick WASM demosaic / libraw Bayer reconstruction, with embedded-JPEG-preview fallback.
- **Animated frame decoding**: GIF (LZW decoder, disposal methods, interlace, loop count, per-frame delay), animated WebP (WebCodecs ImageDecoder). Can **re-encode to animated GIF** (median-cut quantiser).
- **Computational-photo wrapper detection**: Apple Live Photo, Google/Samsung Motion Photo, Ultra HDR gain maps; opens **THM** camera movie-thumbnail files.
- **Extra still formats decoded in pure JS**: TGA/Truevision Targa, **QOI**, Netpbm (PPM/PGM/PBM), PCX, farbfeld, WBMP, XBM/XPM, Sun Raster, SGI. **Header metadata** for Radiance HDR, **DDS** game textures, **OpenEXR**, **JPEG 2000** (OpenJPEG WASM), JPEG XR, EPS/PostScript, WMF/EMF metafiles, Apple ICNS, CUR/ANI cursors, MNG, Lottie.

### RAW photo (camera sensor files)
Source: `formats.js` (RAW row), `photo-convert.js`, `parsers-raw.js`.

- Opens **Sony ARW, Canon CR2/CR3/CRW, Nikon NEF/NRW, Fujifilm X-Trans RAF, Sigma Foveon X3F, Olympus ORF, Panasonic RW2, Pentax PEF, Adobe DNG** and the long tail (3FR, IIQ, MRW, RWL, GPR, FFF, MEF, MOS, KDC, DCR, DCS, ERF, SRF).
- Full EXIF + lens data, **true sensor resolution**, GPS, histograms.
- **Recovers Sony & Nikon shutter actuation / shutter count**.
- **Develops the RAW** (decodes the sensor to a full-res image) or extracts the embedded preview when a true demosaic is unavailable.
- **RAW edit sidecars**: Apple Photos AAE, RawTherapee PP3, Capture One COS, DxO PhotoLab DOP, Nikon NX Studio NKSC - reads the applied-edit recipe.
- **Cinema / rare RAW (identification)**: REDCODE R3D, Blackmagic BRAW, Canon Cinema RAW Light CRM, ARRIRAW ARI, Phantom CINE, FLIR thermal FPF.

### Audio
Source: `audio.js`, `audio-analysis.js`, `audio-codec.js`, `audio-player.js`,
`spectrogram.js`, `media-reverse.js`, `parsers-audio.js`.

- **Waveform** (min/max per-pixel downsample) with clipping detection.
- **FFT spectrogram** - hand-written radix-2 Cooley-Tukey FFT; standard STFT or **reassigned spectrogram** (time-frequency sharpening); log/linear frequency axis; **adjustable FFT size + window** (Hann/Hamming/Blackman/rect); colourmap choice (viridis/magma/inferno/grayscale/phosphor); zoom; fullscreen; **save as PNG**.
- **Live spectrogram from the microphone** and **record-from-mic** modes (`index.html` audio dropzone buttons).
- **Vectorscope** with mid/side decomposition.
- **Loudness / analysis**: RMS & peak dB, **K-weighted LUFS integrated loudness**, spectral centroid, **YIN pitch detection** (frequency + note + cents), **BPM/tempo detection** (spectral-flux onset + autocorrelation, falls back to ID3/MP4 BPM tag), stereo phase correlation / width / mid-side.
- **Codec sniffing & tag parsing**: MP3 frame parse (CBR/VBR, Xing/Info/VBRI, LAME encoder/preset), FLAC STREAMINFO, AAC ADTS, OGG, MP4 atoms; ID3v2/3/4 tags; **embedded cover-art extraction** (APIC / covr / FLAC PICTURE); AAC->M4A remux.
- **Reverse audio** tool (writes a reversed WAV you can download).
- **Long-tail audio identification**: Monkey's Audio APE, WavPack WV, TAK, True Audio TTA, OptimFROG, **DSD/SACD DSF/DFF**, Musepack, Apple Core Audio CAF, RF64/BW64, Wave64, Sun AU, **Broadcast Wave with SMPTE timecode**, Speex, AMR-WB, QCP, GSM, MPEG Layer I/II, **SoundFont SF2/SF3, SFZ, DLS, GigaStudio GIG**, ringtones (RTTTL, iMelody, M4R), **tracker modules (MOD, XM, IT, S3M, OctaMED, 669, Oktalyzer)**, **chiptunes (NES NSF, SNES SPC, VGM, Game Boy GBS, AY, YM, PSF)**, Audacity AUP/AUP3.
- **MIDI** (`midi.js`): tempo/BPM, time + key signature, General MIDI instruments, track names, note counts, duration. **Lyrics** (`lrc.js`): LRC ID tags + every timestamped line.
- **Dolby surround (ID)**: E-AC-3, TrueHD, MLP, Atmos with 5.1/7.1 channel-layout detection.

### Video
Source: `video.js`, `video-avi.js`, `sony-rtmd.js`, `gcsv.js`, `parsers-video.js`.

- **Container / codec / resolution / frame rate / bitrate / duration** detection (MP4 container parse with FFmpeg fallback).
- **Frame-by-frame stepping** with **editable HH:MM:SS:FF timecode**, capture-any-frame to PNG, and **route a captured frame into full photo analysis**.
- **Extract the audio track** to feed the waveform + spectrogram.
- **Scene-change detection** with confidence scoring + thumbnail grid.
- **In-browser remux / transcode**: raw **H.264/H.265 elementary streams (.h264/.265)** remuxed to MP4 so they play; unplayable codecs transcoded to H.264+AAC via **FFmpeg WASM**; **video reverse** (segmented keyframe chunking); AVI Motion-JPEG + PCM player.
- **Sony gyro / IMU metadata**: decodes the **"rtmd" timed-metadata track** Sony Alpha/FX/RX cameras embed - 3-axis **gyroscope + accelerometer** plotted on a zoomable timeline, plus ISO / white balance / capture time. Exports **Gyroflow .gcsv** and plain CSV - the same data Gyroflow / Catalyst Browse use to stabilise footage.
- **Gyroflow .gcsv IMU logs** opened directly and plotted (gyro deg/s + accel g).
- **Streaming manifests & broadcast containers (ID)**: HLS M3U8, DASH MPD, Smooth Streaming, HDS; **MXF / GXF / LXF**, DV, ASF/.dvr-ms, RealMedia, DivX, **Insta360 / GoPro proxies**, IVF/Y4M/AV1 OBU raw streams, MPEG program/transport, Windows Recorded TV (WTV), DPX/Cineon, Dahua CCTV .dav.

### Documents & ebooks
Source: `pdf.js`, `docx.js`, `xlsx.js`, `xlsb.js`, `pptx.js`, `odf.js`,
`legacy-office.js`, `iwork.js`, `textdoc.js`, `paged.js`, `mobi.js`, `epub.js`,
`djvu.js`, `comic.js`, `markdown.js`, `parsers-docs.js`.

- **PDF** (`pdf.js`): page rendering with prev/next + zoom + lightbox, per-page text extraction, **embedded-image extraction**, **OCR of image-only pages** (Tesseract), full metadata, **outline/TOC, embedded files, embedded JavaScript review, encryption/permissions, form fields, links, annotations, font enumeration (embedded vs not)**, and forensic flags (revision count, linearisation, appended-data detection).
- **Microsoft Office (modern, OOXML)**: **DOCX** renders formatted text/tables/images paginated onto A4 sheets + comments, tracked changes, hyperlinks, protection status, word/char/paragraph/page counts; **XLSX/XLSB** spreadsheet grid with per-sheet tabs, macro detection, hidden sheets, named ranges, formulas, external links; **PPTX** slide-thumbnail grid + fullscreen lightbox, speaker notes, on-slide tables, hyperlinks, embedded images.
- **Legacy Office (OLE2)**: **DOC/XLS/PPT 97-2003** text extraction via compound-file parsing (FIB piece table, BIFF8 SST/RK/FORMULA, PPT text atoms).
- **OpenDocument family**: ODT/ODS/ODP/ODG + flat FODT/FODS + templates + StarOffice SXW/SXC - paginated text, materialised sheets, slides, embedded images.
- **Apple iWork** (Pages / Numbers / Keynote): renders the embedded QuickLook **Preview.pdf** page by page (or preview image), reads the iWork app version.
- **Markup / lightweight docs** (`textdoc.js`): RTF (control words stripped to prose), AbiWord ABW, FictionBook FB2, Hangul HWPX, **MHTML web archives** (sanitised), plus DITA, TEI, JATS, reStructuredText, AsciiDoc, Org-mode, Textile, TeX/LaTeX, BibTeX as selectable page previews.
- **Ebooks**: **Kindle / Mobipocket MOBI, AZW, AZW3 / KF8** (`mobi.js`) - title/author/publisher/cover + section-by-section reader; **EPUB** (`epub.js`) - chapter reader, real TOC, word count + reading time, DRM detection, cover; **DjVu** scanned books (`djvu.js`) - page decode + paging + DPI.
- **Comic books** (`comic.js`): **CBZ/CBR/CBT/CB7** thumbnail grid + lightbox reader with pan/zoom, **ComicInfo.xml** metadata (series, issue, creators, publisher, year, age rating).
- **Markdown** (`markdown.js`): CommonMark + GFM renderer (tables, task lists), word/heading/link counts, reading-time estimate.
- **Fonts** (`font.js`): **live FontFace specimen** (pangram + alphabet + sizes) for TTF/OTF/WOFF/WOFF2/TTC, **variable-font axis sliders** driving the render in real time, opentype.js reads family/foundry/licence/units-per-em and **draws a grid of every glyph outline**. UFO **GLIF** glyph sources too.
- **More publishing (ID)**: XPS/OXPS, FB3, iBooks, Scrivener, Visio VSDX, R Markdown/Quarto, WARC/MAFF, TeX DVI, legacy HWP, WordPerfect, QuarkXPress, PageMaker, Scribus SLA, MS Works, Windows Write, FrameMaker.

### 3D models / CAD / engineering
Source: `stl.js`, `model3d.js`, `parsers-threed.js`, plus catalog rows.

- **Interactive WebGL 3D viewer** (`stl.js` base, inherited by `model3d.js`): **orbit / pan / mouse-wheel zoom**, spin toggle, reset view, **model colour picker**, fullscreen, isometric snapshot export.
- **Geometry stats**: triangle + vertex count, **bounding box (W x D x H)**, **surface area**, **volume (if watertight)**, multi-body connected-component splitting.
- **Formats with full viewer**: STL (binary + ASCII), OBJ, PLY (binary/ASCII), OFF, **glTF 2.0 / GLB** (node-graph flatten, mesh/material/animation counts, authoring tool), **STEP / IGES / BREP** tessellated by **OpenCASCADE WASM** (shows originating CAD system + AP203/214/242 protocol), **3MF / AMF** (per-part / build-plate inspection).
- **3D / CAD / point clouds (ID)**: MagicaVoxel VOX, COLLADA DAE, USD crate, X3D/VRML, LightWave LWO/LWS, Quake MD2/MD3/MDL, **VRM avatars**, Siemens JT, **LiDAR point clouds LAS/LAZ/PCD/PTS/E57**, **IFC BIM**, **Gaussian splats .splat/.spz/KSplat**, Google Draco, Universal 3D, Autodesk Revit RVT/RFA, Solid Edge, Navisworks, FARO/Trimble scans.
- **CAD app files (ID)**: SolidWorks SLDPRT/SLDASM (+ .sldreg Settings Wizard, .svap/.svpj Visualize), Fusion 360 F3D, Inventor IPT/IAM, Rhino 3DM + Grasshopper GH/GHX, SketchUp SKP, 3ds Max, Cinema 4D, Houdini, ZBrush, Maya, CATIA, Eagle, KiCad; **CAD exchange**: Parasolid X_T/X_B, ACIS SAT.
- **2D CAD drawings rendered to SVG** (`dwg.js`, `diagram.js`): **AutoCAD DWG/DWT via LibreDWG WASM** (entity + layer breakdown), DXF (ASCII ENTITIES parse), **draw.io / diagrams.net** mxGraph decode.
- **G-code / CNC (ID)**: detects slicer/CAM tool, machine, controller, toolpath and print/cut dimensions (Prusa, Bambu, Cura, Fusion 360, Mastercam, GRBL, Fanuc, Haas).

### Design / raster art
Source: `psd.js`, `paint.js`, `illustrator.js`, `svg.js`.

- **Photoshop PSD/PSB** (`psd.js`): flattened composite + **full layer tree with per-layer name, blend mode, opacity, visibility, thumbnail**; canvas dims, colour mode, bit depth (ag-psd).
- **Adobe Illustrator AI** (`illustrator.js`): modern PDF-compatible .ai rendered page by page via pdf.js; older EPS/PostScript identified.
- **Raster art**: Krita KRA (merged preview + canvas meta), Procreate (QuickLook thumbnail), Paint.NET PDN (embedded PNG preview).
- **SVG** (`svg.js`): renders at actual size with **security sanitisation** (strips scripts/foreignObject/handlers/external refs), **creator detection** (Illustrator/Inkscape/Sketch/Figma/Vectornator), element histogram, colour palette, text listing, **rasterise to PNG**.
- **Design-app ID**: Figma FIG, Sketch, Affinity Photo/Designer/Publisher, GIMP XCF, Substance.

### Video-editing & motion projects (NLE timelines)
Source: `timeline.js`, `aftereffects.js`, `premiere.js`, `davinci.js`,
`vegas.js`, plus `formats.js`.

- **Interchange timelines** (`timeline.js`): **CMX3600 EDL, Final Cut Pro FCPXML, OpenTimelineIO OTIO** rendered as **track/clip bars positioned by timecode**, with durations, clip names, frame rate.
- **Adobe After Effects AEP/AET** (`aftereffects.js`): walks the RIFX chunk tree to **rebuild every composition timeline** (layers as colour-coded bars by in/out point, 3D layers marked), comp dimensions/fps/duration, AE version + create/modify dates from XMP, referenced footage list.
- **Adobe Premiere Pro PRPROJ / Premiere Elements PREL** (`premiere.js`): inflates the gzip PremiereData XML, **rebuilds stacked video/audio timelines**, sequence resolution/fps/duration, source media names.
- **DaVinci Resolve DRP/DRT** (`davinci.js`): unzips the DB XML, **rebuilds timelines** from SeqContainer track/clip objects, media-pool bins, source paths, colour-coded titles/generators/transitions.
- **Sony/MAGIX VEGAS Pro VEG / Movie Studio VF** (`vegas.js`): reads the RIFF GUID container - VEGAS version, project summary, every media generator + video FX (Titles & Text, Solid Color, Cookie Cutter) by plugin id, **title text decoded from embedded RTF**, source/template paths.
- **Project ID only**: Wondershare Filmora WFP/WSP, CapCut draft_content.json (resolution, duration, tracks).
- **DAW projects (ID)**: Ableton ALS, FL Studio FLP (full parse - tempo, channels, plugins), Reaper RPP, Logic, Pro Tools PTX, Cubase CPR, GarageBand.

### Archives & packages
Source: `archive.js`, `zip.js`, `folder.js`, `folder-archive-shared.js`,
`treemap.js`, `comic.js`, `parsers-archive.js`.

- **Browse the file tree without extracting**: ZIP (pure-JS central-directory walk), and RAR / 7z / TAR / compressed tarballs (.tar.gz/.tgz, .tar.xz, .tar.zst, .tar.bz2) via **libarchive WASM** - **click any file inside to analyse it**.
- **Single compressed streams decompressed** (.gz, .xz, .zst, .lz4, .lzma, .Z) so the inner file opens.
- **Compression details**: per-entry method/CRC/size/date, total ratio, methods used.
- **Archive safety / forensics**: encrypted-entry count, **path-traversal / absolute / UNC unsafe-path detection**, **zip-bomb ratio heuristic**, ZIP64, host OS.
- **Category breakdown + treemap**: per-category (photo/audio/video/doc/archive/other) counts & sizes; **WizTree-style squarified treemap** (`treemap.js`) sized by bytes, colour-coded, with hover tooltips, click-to-drill, breadcrumb zoom, and an aggregate small-file search.
- **Folder drop** (`folder.js`): recursive enumeration, category breakdown, treemap, "which files can't be opened" probe.
- **Software packages / Unix archives (ID)**: Python wheels, NuGet, **Chrome/Firefox/VS Code extensions**, Electron ASAR, Windows APPX/MSIX/.msu, Debian DEB, RPM, RubyGems, conda, Anki APKG, Microsoft CAB, cpio, ar, macOS XAR/.pkg/.mpkg, Snap, Flatpak, StuffIt SIT/SITX, lzop, Brotli, Java Web Start JNLP.

### Maps, GIS & geospatial
Source: `geo.js`, `parsers-geodata.js`, plus catalog rows.

- **GPX / KML / GeoJSON** (`geo.js`): parsed and **plotted on a Leaflet + OpenStreetMap map** (polylines + markers), with **distance (great-circle), ascent/descent, moving time, pace, average speed, elevation profile chart**, plus HR/cadence/temperature sensor channels.
- **GIS files inspected without a map (ID)**: TopoJSON, OpenStreetMap OSM XML + binary o5m/o5c, **Esri Shapefile siblings SHP/SHX/DBF/PRJ/CPG**, world files, GML, **NMEA GPS logs**, **IGC paragliding flight logs**, MapInfo TAB/MIF, GDAL VRT, **PMTiles**, **DTED terrain**, Esri ASCII grids, **SRTM .hgt elevation**, GRIB/NetCDF weather, **GeoPackage / MBTiles**, MrSID, ECW, QGIS QGS/QGZ, Esri layer LYR/LYRX - surfacing CRS/EPSG, feature counts, bounding boxes, elevation ranges.

### Developer / code / data
Source: `notebook.js`, `dataview.js`, `markdown.js`, `csv.js`, `gitobject.js`,
`vssolution.js`, `unity.js`, `unknown.js`, `parsers-dev.js`.

- **Jupyter notebooks** (`notebook.js`): cell-by-cell render with markdown, code, and **captured outputs (text + decoded PNG/JPEG images)**, kernel/language metadata.
- **HAR network captures** (`dataview.js`): request table (method, status, type, size, timing), totals.
- **JSON supersets** JSON5 / JSONC / Hjson: selectable source + **expandable value tree**.
- **CSV / TSV** (`csv.js`): delimiter auto-detect, **per-column type inference + numeric stats (quartiles, stddev, median), data-quality checks** (ragged rows, duplicates, BOM, line-ending consistency).
- **Git internals, no git binary** (`gitobject.js`): inflates loose objects (blob/tree/commit/tag), parses **.pack / .idx**, shows type/size/SHA-1, tree entries, commit messages.
- **Visual Studio solution .sln** (`vssolution.js`): format version, VS year, projects + GUIDs, build configurations, language resolution.
- **Unity assets** (`unity.js`): splits the YAML object stream - scene GameObjects + component histogram, AnimationClip sample rate, AnimatorController states, material friction, MonoBehaviour script GUID, .meta importer record.
- **Windows scripts** (catalog `Web / code`): PowerShell PS1/PSM1/PSD1 (comment-help synopsis, #Requires, function/param counts, CmdletBinding, Authenticode), batch BAT/CMD (echo state, labels, variables, external tools invoked).
- **Dev/data ID**: JWT (header+claims+expiry), WebAssembly, Java .class, **NumPy NPY / Safetensors / GGUF LLM model files**, source maps, SQL dumps, Terraform, Protobuf, GraphQL, SARIF, Python .pyc/.pkl (with security note), Apple plist (XML+binary), dependency lockfiles (npm/Yarn/pnpm/Cargo/Poetry/Composer), MessagePack/CBOR/BSON, FlatBuffers/Thrift/Cap'n Proto, MATLAB MAT, Redis RDB, **Apache Arrow/Parquet/ORC**.
- **Databases**: SQLite .sqlite/.db full schema (tables, columns, row counts, views, indexes, triggers, DDL, sample rows) **including WAL/SHM sidecar parsing** (sql.js WASM); **Microsoft Access MDB/ACCDB** table viewer with sample rows (mdb-reader).
- **Unknown files** (`unknown.js`): ~50-signature magic-byte guessing, **hex/ASCII dump**, SHA-256, enhanced text/JSON/XML previews.

### Email, calendar & contacts
Source: `email.js`, `parsers-email.js`.

- **Email messages & mailboxes** (`email.js`): EML, Apple Mail EMLX, **MBOX** - From/To/Subject/Date, **Received relay-hop count**, **SPF / DKIM / DMARC authentication verdicts**, attachment list, **sanitised HTML body** (scripts + remote content removed).
- **Calendar / contacts (ID)**: iCalendar ICS/ICAL/VCS (events, recurrence, organiser/attendees), vCard VCF (fields + inline base64 photo), LDIF, Windows .contact; Outlook MSG/PST/OST, IBM Notes NSF, Exchange EDB, Outlook Express DBX, Outlook-for-Mac OLM, phone backups (Nokia .vmg SMS, .vnt notes).

### Security, keys & forensics
Source: `parsers-security.js`, plus catalog rows.

- **Crypto/keys (ID + decode)**: PEM private/public keys (RSA/EC/Ed25519, PKCS#1 vs PKCS#8, encryption), **OpenSSH .pub with SHA-256 fingerprint**, PuTTY PPK, PKCS#10 CSR, X.509 CRL, PKCS#7 bundles, **PKCS#12 P12/PFX**, X.509 certificates (CRT/CER/PEM/DER - subject/issuer/validity), OpenVPN/WireGuard configs, **Java KeyStore JKS/JCEKS**, Apple .mobileconfig/.mobileprovision - **warns when a private key or secret is present**.
- **Forensics**: **pcap/pcapng** network captures, **Windows .evtx Event Log**, **Prefetch .pf**, Registry hive, Group Policy Registry.pol, .reg (autorun flagging), **KeePass KDBX/KDB**, **AFF/AFF4 forensic disk images**, Fiddler SAZ, 1Password 1PUX, Apple Keychain, **YARA rules**, Snort/Suricata IDS rules, STIX/OpenIOC threat intel, **OpenPGP PGP/GPG/SIG** (armor type, packet walk, key algorithm, secret-key warning).

### Disk images, firmware & VMs
Source: `parsers-disk.js`, plus catalog rows.

- **VM descriptors / disks (ID)**: OVF/OVA, VMware VMX/VMDK, VirtualBox VBOX/VDI, Hyper-V VHD/VHDX, QEMU QCOW2, Parallels PVM/HDD, VMware snapshots.
- **Disc images**: ISO, Nero NRG, Alcohol MDS/MDF, CloneCD, CUE sheets.
- **Raw IMG**: decodes **partition table (MBR/GPT with GUIDs)** and the first volume's filesystem - **FAT16/32, NTFS, exFAT** - with label, cluster size, volume size.
- **Embedded firmware**: **Intel HEX, Motorola S-record, UF2** (Raspberry Pi Pico / micro:bit), **ELF/AXF**, Device Tree Blobs, U-Boot uImage/FIT, UEFI/BIOS flash volumes, TRX router firmware, USB DFU, Android sparse images.
- **Linux filesystem superblocks**: ext2/3/4, SquashFS, cramfs, romfs, UBI; **Windows imaging WIM/ESD/SWM**; forensic JFFS2/UBIFS/YAFFS2; Veeam VBK.

### Executables & system
Source: `proprietary.js`, `parsers-osmisc.js`, plus catalog rows.

- **Executables (ID + header parse)**: **Windows PE EXE/DLL** - architecture, sections, compile date, linker version, subsystem, security mitigations, .NET flag, imported DLL count, version-resource strings, installer detection (`proprietary.js`); MSI; **Android APK** - decodes binary AndroidManifest.xml (package, versions, full permission/feature list, launcher activity, signing v1/v2/v3, native ABIs); iOS IPA; macOS DMG; Linux AppImage.
- **OS/system files**: OPML subscription lists, RSS/Atom feeds, Linux .desktop launchers + systemd .service units, Apple .crash reports + IPS panics, Android .ab backups, Windows Task Scheduler .job, .scr screensaver PE headers, **Windows .lnk shortcuts** (target/args/working dir/timestamps), .url / .webloc, .DS_Store, Thumbs.db, dSYM/DWARF, shim .sdb.
- **Scene NFO** ASCII art rendered from native **CP437 / IBM PC OEM** code page.

### Games & emulation
Source: `parsers-gaming.js`, `unity.js`, plus catalog rows.

- **ROM headers**: iNES/NES 2.0, Game Boy / Color / Advance, SNES, Nintendo DS/DSi, Nintendo 64, Sega Genesis/Mega Drive - title, mapper, region, checksum; plus Atari, PC Engine, Master System/Game Gear, WonderSwan, 3DS/Switch (NSP/XCI).
- **ROM patches**: IPS, BPS, UPS, PPF, xdelta.
- **Engine assets**: Doom WAD lumps, **Minecraft NBT / schematics / Bedrock / Anvil regions**, **Aseprite** sprites, Godot .pck/.tscn/.tres, Quake/id Tech PAK/PK3, **Source engine BSP/VPK/VTF/VMT**, KTX/KTX2 textures, **Tiled TMX**, LÖVE games, **PICO-8 carts**, Unity asset bundles / .unitypackage, **Unreal cooked UASSET/UMAP/UTOC**, **FMOD FSB / Wwise BNK/WEM sound banks**, **Spine** skeletons/atlases, GameMaker, LDtk, TIC-80, Warcraft III maps, Ren'Py, RPG Maker, Basis textures, emulator save states + TAS movies.
- **Game saves**: **ULTRAKILL .bepis** - decodes the .NET BinaryFormatter save into money, unlocked weapons, furthest level, per-level ranks, Cyber Grind high score.
- **Valve / Steam**: VDF KeyValues + Steam appmanifest ACF (App ID, name, install dir, size, key tree).

### Science, medical & engineering
Source: `parsers-sci.js`, plus catalog rows.

- **Medical imaging**: **DICOM** scans, **NIfTI** brain volumes.
- **Fitness/activity**: Garmin **FIT**, **TCX** (Strava/Zwift/Garmin).
- **Astronomy**: **FITS** frames.
- **Genomics**: FASTA / FASTQ sequences, **BAM/SAM/BCF** alignments (samtools), ABIF .ab1 Sanger traces.
- **Chemistry**: MOL / SDF / MOL2 / CIF crystallography / XYZ structures, ChemDraw CDX/CDXML, **VASP/Gaussian/XCrySDen DFT** structures.
- **Electronics/PCB**: **Gerber** + Excellon drill PCB data (KiCad/Altium/Eagle), **SPICE netlists** (LTspice/ngspice).
- **Biosignals/neuro**: EDF/BDF, BrainVision VHDR/VMRK, Neuroscan CNT, EEGLAB SET.
- **Spectroscopy**: JCAMP-DX (IR/NMR).
- **Statistics datasets**: SPSS .sav, Stata .dta, SAS7BDAT, R RDS/RData/RDA.
- **Engineering / FEA-CFD**: VTK/ParaView meshes (VTU/VTP/VTI/VTS/VTR), Gmsh MSH, Abaqus/Nastran INP, ANSYS CDB, oscilloscope WFM, NI TDMS, Axon ABF; **seismic SEG-Y**.

---

## 3. Interactive viewers & tools (distinct UI surfaces)

1. **Photo inspector** - EXIF panel, histogram, palette swatches, OCR pane, QR readout.
2. **Leaflet + OpenStreetMap map** - GPS photo location & GPX/KML/GeoJSON tracks with elevation profile.
3. **Spectrogram canvas** - STFT/reassigned, zoom, colourmaps, fullscreen, PNG export; **live mic** + **record** modes.
4. **Waveform / vectorscope** renderer.
5. **Audio player** - shared transport, seek scrub, volume, mute.
6. **Video player** - frame stepping, editable timecode, frame capture, scene-detection thumbnail grid; AVI MJPEG player.
7. **Gyro/IMU timeline** - zoomable gyroscope + accelerometer plot synced to a video mini-player (Sony rtmd + Gyroflow gcsv).
8. **Interactive WebGL 3D viewer** - orbit/pan/zoom, spin, colour picker, fullscreen, snapshot (STL/OBJ/PLY/glTF/STEP/3MF...).
9. **NLE timeline renderers** - track/clip bars by timecode for EDL/FCPXML/OTIO, After Effects, Premiere, DaVinci, VEGAS.
10. **Treemap** - WizTree-style squarified size map of folders/archives with drill-down + breadcrumbs + small-file search.
11. **PDF / DjVu / MOBI / EPUB / comic readers** - paged viewers with prev/next + lightbox + zoom.
12. **Spreadsheet grid** - per-sheet tabs for XLSX/XLSB/ODS/MDB/Access.
13. **Slide grid + fullscreen lightbox** - PPTX/ODP.
14. **Font specimen + variable-axis sliders + glyph-outline grid**.
15. **2D vector preview (SVG render)** - DWG/DXF/draw.io rendered to SVG.
16. **Hex / ASCII dump** for unknown files.
17. **JSON value tree** (JSON5/JSONC/Hjson/HAR).
18. **Embedded-image grid** - ICO sizes, MPO halves, multi-page TIFF, in-doc images, each downloadable.
19. **Format-help overlay** - searchable 1000+ format catalog with category chips, on both index and about pages.
20. **Export data** + **Analyse next file** flow; per-file `/formats/<ext>` guide CTA.

---

## 4. Notable / long-tail formats (strong "how to open .X" SEO targets)

These are uncommon enough that searchers look for a tool, and Analyser handles
them on-device with no upload - prime per-format landing-page targets.

- **Camera RAW long tail**: .arw .cr3 .nef .raf .x3f .iiq .3fr .gpr .crw .nrw .pef .orf .rw2 .dng (Sony/Canon/Nikon/Fuji/Sigma/Pentax/Olympus/Panasonic/Adobe).
- **RAW edit sidecars**: .aae (Apple Photos), .pp3 (RawTherapee), .cos (Capture One), .dop (DxO), .nksc (Nikon NX Studio).
- **Cinema RAW**: .r3d (RED), .braw (Blackmagic), .crm (Canon Cinema RAW Light), .ari (ARRIRAW), .cine (Phantom).
- **Proprietary creative-app projects**: .aep/.aet (After Effects), .prproj/.prel (Premiere), .drp/.drt (DaVinci Resolve), .veg/.vf (VEGAS), .als/.flp/.rpp (DAWs), .psd/.psb (Photoshop), .ai (Illustrator), .kra (Krita), .procreate, .pdn (Paint.NET).
- **CAD / 3D**: .sldprt/.sldasm (SolidWorks), .f3d (Fusion 360), .ipt/.iam (Inventor), .3dm (Rhino), .skp (SketchUp), .step/.iges/.brep, .3mf/.amf, .gltf/.glb, .dwg/.dxf, .vox, .vrm, .splat/.spz (Gaussian splat), .las/.laz/.e57 (LiDAR), .ifc (BIM).
- **Ebooks / scanned docs**: .mobi/.azw/.azw3 (Kindle), .djvu, .fb2, .cbz/.cbr/.cb7 (comics), .epub, .lrf (Sony BBeB).
- **Apple-specific**: .pages/.numbers/.key (iWork), .heic, .icns, .webloc, .emlx, .aae, .crash/.ips.
- **Gaming**: .nes/.gb/.gba/.z64/.smc ROMs, .bepis (ULTRAKILL save), .pck (Godot), .uasset/.umap (Unreal), .nbt (Minecraft), .ase (Aseprite), .wad (Doom), .vpk/.bsp/.vtf (Source), .love (LÖVE), .p8 (PICO-8), .fsb/.bnk (FMOD/Wwise).
- **Science/medical**: .dcm (DICOM), .nii (NIfTI), .fits, .fasta/.fastq, .fit/.tcx (Garmin), .sav/.dta (SPSS/Stata), .gbr (Gerber), .segy.
- **Forensics/security**: .pcap/.pcapng, .evtx, .pf (Prefetch), .kdbx (KeePass), .p12/.pfx, .jks, .pgp/.gpg, .aff4.
- **Obscure but searched**: .nfo (CP437 scene art), .torrent, .lnk (Windows shortcut), .ds_store, .sqlite-wal, .gcode, .gcsv (Gyroflow), .ctg (Canon camera catalog), .vdf/.acf (Steam), .ipynb, .har, .gguf/.safetensors (LLM models), .qoi, .uf2, .mxf.

---

### Caveats worth noting in copy
- Many long-tail formats are **identification + header metadata only** ("ID"
  badge), not full viewers - copy should say "identify and read metadata" for
  those, "open and view" for full-analysis rows. The distinction is the
  `depth: 'full'` vs `'id'` field in `catalogGrouped()` (`formats.js`).
- Some heavy decoders need a one-time WASM download (FFmpeg, ImageMagick,
  Ghostscript, OpenCASCADE, LibreDWG) - fine offline once cached, but worth a
  light "loaded on demand" note.
