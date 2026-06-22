/* Analyser - central format catalog
   ============================================================================
   SINGLE SOURCE OF TRUTH for which file types Analyser supports.

   Edit this file (and, for proprietary formats that need header parsing,
   proprietary.js) when adding a new file type. Everything else updates itself:
     - classifyFile() in app.js reads the *_EXTS sets below to route a drop
     - photo.js reads HEIC_EXTS / RAW_EXTS to decide on conversion
     - the format overlay on index.html is generated from FULL_ANALYSIS +
       IDENTIFICATION via renderFmtOverlay()
     - the "All supported file types" tables on about.html are generated from
       the same data via renderAboutFormats()
     - the overlay search box indexes the labels, extension lists, and tags

   Two kinds of data live here:
   1. Classification sets (lowercase, exhaustive) - drive routing logic.
   2. Display catalog (FULL_ANALYSIS / IDENTIFICATION) - curated, nicely-cased
      lists with search tags, shown in the overlay and about page.
   ----------------------------------------------------------------------------
   HOW TO ADD A FORMAT (read this before editing)

   Decide the kind first:
     • FULL ANALYSIS  = we open and analyse the bytes (photo, audio, video,
       csv, svg, pdf, zip, web/code). Routed to a real renderer.
     • IDENTIFICATION = we just name it and read header metadata (Adobe, CAD,
       fonts, etc.). Handled by proprietary.js.

   --- Case A: new extension for an EXISTING full-analysis category ---
   e.g. adding ".jpe" as another photo extension.
     1. Add 'jpe' to the matching set (PHOTO_EXTS here).
     2. Add the token to that category's `exts` string in FULL_ANALYSIS
        (e.g. append "JPE" to the Photo row). Done - overlay, about page, and
        search update on next load. No app.js change needed.
     • If it's a photo that needs decoding, also add it to HEIC_EXTS or
       RAW_EXTS so photo.js converts it first.

   --- Case B: new IDENTIFICATION-only format ---
   e.g. adding SketchUp ".skp".
     1. Add it to the right `IDENTIFICATION` row's `exts`, and add the software
        name to that row's `tags` so search-by-origin works (e.g. "sketchup").
        If no existing row fits, add a new { label, exts, tags } row.
     2. In proprietary.js, add a FORMATS entry: skp: { app, icon, magic?, parse? }.
        Add a parseXxx() if there's a header worth decoding.
     (Routing is automatic: classifyFile() falls back to isProprietaryExt().)

   --- Case C: brand-new full-analysis category with its own renderer ---
   Rare. See CLAUDE.md ("Adding a new file type" → step 3) for the app.js /
   sw.js wiring. The catalog part is still just a FULL_ANALYSIS row here.

   Field reference for a catalog row { label, exts, tags, note? }:
     label - category name (first column)
     exts  - space-separated extensions, curated casing (e.g. "WebP", "glTF")
     tags  - extra search keywords: brand/software names + synonyms
     note  - optional prose shown instead of the ext list on the about page
   ============================================================================ */

import { el } from './util.js';

// ---------- classification extension sets (logic) ----------
// Lowercase. These route a dropped file to the right renderer in app.js.

export const PHOTO_EXTS = new Set([
  'jpg','jpeg','jpe','jif','jfif','png','gif','webp','heic','heif','heics','heifs',
  'bmp','tif','tiff','avif','jxl','ico','mpo',
  'raw','arw','cr2','cr3','nef','dng','raf','rw2','orf','pef','sr2','srw','x3f',
  // Long-tail camera RAW (TIFF/EP or CIFF based - read via exifr + embedded JPEG
  // preview, with the ImageMagick WASM fallback for the pixels).
  '3fr','iiq','mrw','nrw','rwl','crw','gpr','fff','mef','mos','kdc','dcr','dcs','erf','srf',
  // THM = the JPEG thumbnail a camera writes next to each movie clip (Canon et al.)
  'thm'
]);

export const AUDIO_EXTS = new Set([
  'mp3','wav','wave','m4a','m4b','aac','flac','ogg','oga','opus',
  'aiff','aif','aifc','wma','weba','amr','ac3','dts','mka'
]);

export const VIDEO_EXTS = new Set([
  'mp4','m4v','mov','avi','mkv','webm','wmv','flv',
  '3gp','3g2','mpg','mpeg','mts','m2ts','ts','vob','ogv',
  'h264','264','avc','h265','265','hevc'
]);

export const CSV_EXTS = new Set(['csv', 'tsv']);
export const SVG_EXTS = new Set(['svg']);

// Photo conversion subsets - used by photo.js to decide which images need
// HEIC-to-JPEG (heic2any) or RAW-to-PNG (ImageMagick WASM) conversion first.
export const HEIC_EXTS = new Set(['heic', 'heif', 'heics', 'heifs']);
export const RAW_EXTS  = new Set(['arw', 'cr2', 'cr3', 'nef', 'dng', 'raf', 'rw2', 'orf', 'pef', 'sr2', 'srw', 'x3f', 'raw',
  '3fr', 'iiq', 'mrw', 'nrw', 'rwl', 'crw', 'gpr', 'fff', 'mef', 'mos', 'kdc', 'dcr', 'dcs', 'erf', 'srf']);

// Document and archive sets - used by folder/archive shared module for
// category classification in treemaps and breakdowns.
export const DOC_EXTS = new Set([
  'pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','csv','json',
  'xml','html','css','js','ts','tsx','jsx','yaml','yml','toml','ini',
  'rtf','odt','ods','odp','epub','log','sql','sh','bat','py','rb','java',
  'c','h','cpp','rs','go'
]);
export const ARCHIVE_EXTS = new Set([
  'zip','rar','7z','tar','gz','bz2','xz','zst','tgz'
]);

// ---------- display catalog (overlay + about page) ----------
// Each row: { label, exts, tags, note? }
//   label - category name shown in the first column
//   exts  - space-separated extension list (curated casing) for display/search
//   tags  - extra search keywords (software/brand names, synonyms)
//   note  - optional prose shown instead of the ext list on the about page
//           (used where a plain extension list undersells what we do, e.g. PDF)

export const FULL_ANALYSIS = [
  { label: 'Photo',     exts: 'JPG JPEG JIF JFIF PNG GIF WebP HEIC HEIF BMP TIFF AVIF JXL ICO MPO THM', tags: 'image picture photograph camera apple google pixel samsung iphone screenshot live photo motion photo ultra hdr gain map computational heic heif thm thumbnail movie video clip preview icon favicon cursor multi page stereo 3d mpo embedded images', desc: 'View EXIF, GPS, camera settings, histograms, dominant colours, OCR text, and AI-generation markers in JPG, PNG, HEIC, WebP, GIF, BMP, TIFF, AVIF and JPEG XL images. Detects computational-photo wrappers (Apple Live Photo, Google and Samsung Motion Photo, Ultra HDR gain maps), opens THM movie-thumbnail files, and extracts every embedded image from multi-image files - all sizes in an ICO, both halves of an MPO stereo pair, and every page of a multi-page TIFF.' },
  { label: 'RAW photo', exts: 'RAW ARW CR2 CR3 NEF DNG RAF RW2 ORF PEF SR2 SRW X3F 3FR IIQ MRW NRW RWL CRW GPR FFF MEF MOS KDC DCR DCS ERF SRF', tags: 'raw camera sensor negative undeveloped demosaic bayer cfa x-trans xtrans foveon proraw shutter count actuations actuation sony nikon canon fujifilm fuji olympus om system pentax sigma panasonic lumix leica hasselblad phase one mamiya leaf kodak gopro epson minolta', desc: 'Open camera RAW files from Sony (ARW), Canon (CR2, CR3, CRW), Nikon (NEF, NRW), Fujifilm X-Trans (RAF), Sigma Foveon (X3F), Olympus (ORF), Panasonic (RW2), Pentax (PEF), Adobe DNG and many more. Reads full EXIF and lens data, the true sensor resolution, GPS and histograms, recovers the Sony and Nikon shutter actuation count, and develops the RAW - decoding the sensor to a full-resolution image, or extracting the embedded preview when a true demosaic is not available.' },
  { label: 'Illustrator', exts: 'AI', tags: 'adobe illustrator ai vector artwork graphics design eps pdf compatible logo poster artboard postscript', desc: 'Open Adobe Illustrator artwork (.ai) in the browser. Modern Illustrator files (version 9 and later) are PDF-compatible, so Analyser renders the artwork page by page with pdf.js - the vector art, text and embedded images - and reads the document metadata. Older EPS/PostScript-based .ai files are identified from their header.' },
  { label: 'Photoshop', exts: 'PSD PSB', tags: 'adobe photoshop psd psb large document photo editing layers composite blend mode opacity raster image design', desc: 'Open Adobe Photoshop documents (PSD and PSB) in the browser: the flattened composite image Photoshop bakes in is shown, plus the full layer tree with each layer name, blend mode, opacity, visibility and a per-layer thumbnail. Reads the canvas dimensions, colour mode and bit depth. Files saved without Maximize Compatibility have no composite, so their layers are shown instead.' },
  { label: 'Raster art', exts: 'KRA Procreate PDN', tags: 'krita kra digital painting procreate ipad apple pencil brush canvas merged image preview artwork raster paint paint.net pdn layers', desc: 'Open Krita (.kra), Procreate and Paint.NET (.pdn) paintings by showing the flattened preview baked into the file - the full merged image for Krita, the QuickLook thumbnail for Procreate, the embedded PNG preview for Paint.NET - alongside the canvas size, layer count and app version. Their per-layer artwork is in a private format, so the embedded preview is the faithful render.' },
  { label: 'Sound',     exts: 'MP3 WAV M4A M4B AAC FLAC OGG OPUS AIFF WMA AMR AC3 DTS MKA', tags: 'audio music podcast recording microphone audiobook', desc: 'Inspect the waveform, spectrogram, codec, bitrate, channels, and tags of MP3, WAV, FLAC, M4A, AAC, OGG, and Opus audio.' },
  { label: 'Video',     exts: 'MP4 MOV AVI MKV WebM WMV FLV 3GP 3G2 MPG MPEG MTS M2TS TS VOB OGV H264 264 AVC H265 265 HEVC', tags: 'movie film clip recording screen raw elementary stream annex b h.264 h.265 hevc bitstream sony gyro gyroscope accelerometer imu rtmd metadata gyroflow catalyst stabilisation xavc a6700 fx3 a7 avchd camcorder handycam mts m2ts transport stream', desc: 'Read the container, codec, resolution, and frame rate of MP4, MOV, MKV, AVI, and WebM video, step through frames, and extract the audio track. Raw H.264/H.265 elementary streams (.h264/.265) are remuxed to MP4 in-browser so they play too, as are AVCHD camcorder files (.mts/.m2ts) - the video is copied and the audio transcoded to AAC. Sony cameras (Alpha, FX, RX) that embed a gyro / accelerometer "rtmd" timed-metadata track have that inertial data decoded and plotted - the same gyroscope and accelerometer samples Gyroflow and Catalyst Browse use to stabilise footage - alongside the ISO, white balance and capture time.' },
  { label: 'PDF',       exts: 'PDF', tags: 'adobe acrobat document', desc: 'View pages, extract text and embedded images, run OCR, and read the metadata of PDF documents.' },
  { label: 'DjVu',      exts: 'DjVu DjV', tags: 'djvu djv scanned document book journal archive scan lizardtech document compression bitonal page viewer', desc: 'Open DjVu scanned documents (.djvu / .djv) - the format used by digital libraries and archives for scanned books and journals. Each page is decoded and rendered to an image in the browser with prev/next paging, and the document page count and page dimensions are read.' },
  { label: 'Kindle e-book', exts: 'MOBI AZW AZW3', tags: 'ebook kindle amazon mobipocket azw azw3 kf8 reader calibre book reader cover author title sections chapters', desc: 'Open Kindle and Mobipocket e-books (MOBI, AZW, AZW3 / KF8) in the browser: reads the title, author, publisher, language and cover, then renders the book section by section with prev/next paging. MOBI 6 and KF8 (including combo .mobi) are decoded on-device - nothing is uploaded.' },
  { label: 'Office docs', exts: 'DOCX DOCM DOTX DOTM XLSX XLSB XLSM XLTX XLTM PPTX PPTM PPSX PPSM POTX POTM ODT OTT FODT ODS OTS FODS ODP OTP FODP ODG OTG FODG SXW SXC SXD DOC XLS PPT EPUB', tags: 'microsoft word excel powerpoint slides spreadsheet ebook epub viewer reader opendocument libreoffice openoffice odt ods odp odg graphics drawing flat fodt fods staroffice sxw sxc legacy 97-2003 doc xls ppt binary ole2 page preview template dotx xltx potx macro enabled docm xlsm pptm slideshow ppsx ppsm xlsb binary workbook biff12', desc: 'Open and read Microsoft Office documents - modern Word, Excel and PowerPoint (DOCX, XLSX, PPTX), their template, macro-enabled and slideshow variants (DOTX, XLTX, POTX, DOCM, XLSM, PPTM, PPSX), the binary Excel workbook (XLSB), and the legacy 97-2003 binaries (DOC, XLS, PPT) - plus the OpenDocument family in every shape: zipped and flat single-XML text, spreadsheets, presentations and graphics (ODT, ODS, ODP, ODG, FODT, FODS), templates (OTT, OTS, OTP, OTG), legacy StarOffice (SXW, SXC, SXD), and EPUB e-books, shown as page previews with selectable text, tables, sheets and slides.' },
  { label: 'Text & markup', exts: 'RTF ABW FB2 HWPX MHT MHTML DITA DITAMAP TEI JATS NXML RST ADOC AsciiDoc ORG Textile TeX LaTeX BIB RELS MD5', tags: 'rich text format rtf wordpad abiword abw fictionbook fb2 ebook hangul hwpx mhtml mht web archive mime html dita ditamap oasis tei jats nxml pubmed journal restructuredtext rst asciidoc adoc org-mode emacs textile tex latex bibtex bibliography markup source selectable text page preview opc relationships rels package part 3mf zip ooxml docx checksum md5 hash sidecar bambu slicer', desc: 'Open lightweight document and markup formats as selectable page previews: Rich Text Format (RTF, control words stripped to readable prose), AbiWord (ABW), FictionBook e-books (FB2), Hangul HWPX, and MHTML web archives (the saved HTML rendered with scripts removed), plus markup and typesetting source - DITA, TEI, JATS journal XML, reStructuredText, AsciiDoc, Org-mode, Textile, TeX/LaTeX and BibTeX - shown with every page selectable and copyable. Also opens the small sidecar files unpacked from 3MF and OOXML bundles: OPC relationship XML (.rels) and MD5 checksum text (.md5).' },
  { label: 'Apple iWork', exts: 'Pages Numbers Keynote', tags: 'apple iwork pages numbers keynote key macos ios ipad icloud word processing page layout spreadsheet presentation slides quicklook preview pdf', desc: 'Open Apple iWork documents - Pages (word processing and page layout), Numbers (spreadsheets) and Keynote (presentations, .key) - by showing the QuickLook preview Apple embeds in the file: a PDF rendered page by page, or the preview image. Reads the document type and the iWork app version that wrote it. The document body itself is stored in Apple’s undocumented Snappy / Protocol-Buffer .iwa format, which is not re-rendered.' },
  { label: '3D model',  exts: 'STL OBJ PLY OFF STEP STP IGES IGS BREP 3MF AMF glTF GLB MTL', tags: 'stl obj wavefront ply stanford off step stp iges igs brep 3mf amf gltf glb gltf 2.0 khronos binary gltf mtl material library texture map newmtl 3d model mesh print cad solidworks fusion catia inventor freecad opencascade tessellation assembly bambu prusa orcaslicer slicer scan point triangle viewer webgl ar augmented reality blender sketchfab wireframe topology orthographic', desc: 'View STL, OBJ, PLY, OFF, STEP, IGES, BREP, 3MF, AMF and glTF/GLB models in an interactive WebGL viewer with orbit, orthographic or perspective projection, a wireframe topology overlay, an orientation cube, triangle count, bounding box, surface area and volume. glTF 2.0 and binary GLB scenes are parsed natively - the node graph is flattened, mesh geometry shown, and the authoring tool, version and mesh/material/animation counts read. STEP/IGES/BREP are tessellated with OpenCASCADE and STEP shows its originating CAD system, version and AP203/214/242 protocol; 3MF and AMF let you inspect each model and assembly on the build plate individually. Wavefront material libraries (MTL) are broken out into each material with its colours, shininess, opacity and the texture files it references.' },
  { label: 'Colour LUT', exts: 'CUBE', tags: 'lut colour color look up table cube 3d lut 1d lut iridas adobe resolve davinci premiere film emulation log to rec709 rec.709 look grade grading colour grade color grade teal orange cinematic trilinear domain hald clut', desc: 'Open colour LUTs (.cube - the Adobe/Iridas/Resolve 3D and 1D look-up tables) and see exactly what they do: the neutral tone-response curve that reveals the contrast and colour cast, a before/after of a hue x brightness chart and memory colours (skin, sky, foliage) pushed through the LUT, and an interactive 3D scatter of the colour cube it defines. Reads the title, grid size, input domain and extended (HDR / scene-linear) output range, all in the browser. The same .cube extension that Gaussian uses for volumetric DFT data is detected and identified separately.' },
  { label: 'G-code', exts: 'GCODE GCO G NC NGC TAP CNC', tags: 'gcode g-code 3d printing slicer prusa prusaslicer superslicer orca orcaslicer cura ideamaker bambu bambustudio simplify3d slic3r kirimoto reconstruct toolpath extrusion extruder print preview visualise visualiser cnc mill router lathe laser plasma engraver fusion 360 mastercam grbl marlin klipper reprap fanuc haas vectric carbide lightburn arc g2 g3 layer wireframe webgl', desc: 'Reconstruct and visualise the printed (or machined) object straight from G-code: every extruded move is drawn as a line in an interactive WebGL viewer, height-coloured and Z-up, with a build-height scrubber to peel the print back layer by layer. Works universally across slicers (PrusaSlicer, SuperSlicer, OrcaSlicer, Cura, ideaMaker, Bambu Studio, Simplify3D) and CNC / laser CAM, handling absolute and relative moves, inch and millimetre units, and G2/G3 arcs; travel moves are separated out. Reads the slicer or CAM tool, object size, layer count and height, filament or cut-path length, feedrate range, and nozzle/bed temperatures.' },
  { label: 'Editing timeline', exts: 'EDL FCPXML OTIO', tags: 'edl cmx3600 edit decision list fcpxml final cut pro x otio opentimelineio premiere davinci resolve avid nle timeline sequence interchange tracks clips conform', desc: 'Visualise editing timelines exported from Premiere Pro, Final Cut Pro, DaVinci Resolve and Avid: CMX3600 EDL, Final Cut Pro FCPXML and OpenTimelineIO (OTIO). Renders the tracks with clip blocks positioned by timecode, plus durations, clip names and frame rate.' },
  { label: 'After Effects', exts: 'AEP AET', tags: 'adobe after effects aep aet motion graphics compositing vfx animation composition comp layer timeline keyframe precomp footage render riff rifx project version creatortool xmp', desc: 'Open Adobe After Effects projects (.aep) and templates (.aet) in the browser. Analyser walks the RIFX chunk tree to rebuild every composition timeline - each layer drawn as a bar positioned by its in and out point, colour-coded by footage, pre-comp, audio and shape, with 3D layers marked - and reads each comp\'s dimensions, frame rate, duration and layer count. The After Effects version that created and last saved the project (and the create/modify dates) are read from the embedded XMP metadata, alongside the list of footage and source files the project references.' },
  { label: 'Gyro log', exts: 'GCSV', tags: 'gyroflow gcsv imu gyroscope accelerometer gyro log stabilization stabilisation telemetry camera motion sony gopro insta360 betaflight blackbox deg/s', desc: 'Open Gyroflow .gcsv IMU logs - the gyroscope and accelerometer telemetry used to stabilise footage. Analyser applies the file\'s own scale factors and plots the three-axis gyroscope (deg/s) and accelerometer (g) against time on a zoomable timeline you can hover to read off values.' },
  { label: 'Premiere Pro', exts: 'PRPROJ PREL', tags: 'adobe premiere pro premiere elements prproj prel video editing nle non-linear editor timeline sequence track clip cut edit montage social media template motion graphics premieredata gzip xml ticks frame rate resolution master clip', desc: 'Open Adobe Premiere Pro (.prproj) and Premiere Elements (.prel) projects in the browser. Analyser inflates the gzip-compressed PremiereData XML and walks the sequence, track and clip objects to rebuild every timeline - each clip drawn as a bar positioned by its in and out point across stacked video and audio tracks, just like the Premiere editor - reading each sequence\'s resolution, frame rate, duration, track and clip counts, plus the project version, media-item count and the names of the clips the timelines reference.' },
  { label: 'DaVinci Resolve', exts: 'DRP DRT', tags: 'blackmagic davinci resolve drp drt project timeline export video editing colour grading nle non-linear editor sequenccontainer media pool bin track clip cut fusion title transition frame rate timecode source media path', desc: 'Open Blackmagic DaVinci Resolve project (.drp) and timeline (.drt) exports in the browser. A .drp is a ZIP of database XML; Analyser unzips it and walks the SeqContainer track and clip objects to rebuild every timeline - each clip drawn as a bar positioned by its Start and Duration across stacked video and audio tracks, just like the Resolve edit page - showing source filenames, paths, frame rates and timecode, plus the project name, Resolve version, the media pool bins and the source media the timelines reference. Titles, generators and transitions are colour-coded.' },
  { label: 'VEGAS Pro', exts: 'VEG VF', tags: 'sony vegas pro magix vegas movie studio veg vf video editing nle non-linear editor sonic foundry riff guid project media generator titles and text solid color cookie cutter svfx plugin effect rtf title text author copyright', desc: 'Open Sony / MAGIX VEGAS Pro (.veg) and VEGAS Movie Studio (.vf) projects in the browser. A .veg is a Sonic Foundry "RIFF GUID" container; Analyser reads the VEGAS version, the project summary (author, copyright, contact), every media generator and video FX used by its plugin id and friendly name (Titles & Text, Solid Color, Cookie Cutter and more), the actual title and text content decoded from the embedded RTF, and the source media and template file paths the project references.' },
  { label: 'Unity', exts: 'UNITY PREFAB ASSET CONTROLLER ANIM MAT META physicsMaterial2D physicMaterial CUBEMAP SPRITEATLAS MIXER overrideController', tags: 'unity game engine yaml scene prefab gameobject component transform animator controller animation clip material physics2d physics material meta importer guid monobehaviour script asset serialization gamedev game development', desc: 'Open Unity game-engine assets in the browser. Unity serialises scenes (.unity), prefabs, Animator Controllers (.controller), animation clips (.anim), materials (.mat), physics materials (.physicsMaterial2D) and other assets (.asset) as a YAML object stream, with a .meta importer record (carrying the asset GUID) beside every file. Analyser splits the object documents and reads each - a scene\'s GameObjects and component-type breakdown (Transform, SpriteRenderer, colliders, scripts), an animation\'s sample rate and curves, a controller\'s layers and states, a material\'s friction and bounciness, and a .meta\'s GUID and importer.' },
  { label: 'Visual Studio solution', exts: 'SLN SLNX USERPREFS', tags: 'visual studio solution sln slnx xml msbuild project csproj dotnet sln c# vb monodevelop rider unity assembly-csharp build configuration platform debug release userprefs ide', desc: 'Open Visual Studio solution files - the classic text .sln and the newer XML .slnx (Visual Studio 2022 and the dotnet sln tooling) - in the browser: the solution format version and Visual Studio release, every project it groups (name, path, language and GUID) and the build configurations (Debug/Release platforms). MonoDevelop / Unity .userprefs files - the IDE\'s open documents and editor state - are shown as readable XML.' },
  { label: 'Notebooks & data', exts: 'IPYNB HAR JSON5 JSONC Hjson', tags: 'jupyter notebook ipynb colab python r julia cells code markdown output http archive har devtools network waterfall requests json5 jsonc json with comments hjson relaxed json config structured data viewer tree', desc: 'Open and read structured developer data files: Jupyter notebooks (IPYNB) rendered cell by cell with their markdown, code and captured outputs (text and images); HAR network captures shown as a request table with status, type, size and timing; and the JSON supersets JSON5, JSONC and Hjson shown as selectable source with an expandable value tree.' },
  { label: 'Access database', exts: 'MDB ACCDB', tags: 'microsoft access database jet ace mdb accdb tables rows columns records office query relational desktop database', desc: 'Open Microsoft Access databases (.mdb Jet and .accdb ACE) fully in the browser: lists every user table with its columns and row count, and shows a sample of rows from each in a spreadsheet-style grid. Reads the creation date and format version. Nothing is uploaded.' },
  { label: 'Email',     exts: 'EML EMLX MBOX', tags: 'email message rfc822 mime eml emlx apple mail outlook thunderbird mbox mailbox from to subject attachments spf dkim dmarc headers received hops web archive sender authentication', desc: 'Open email messages and mailboxes in the browser: single messages (EML, Apple Mail EMLX) and whole mailboxes (MBOX). Reads From/To/Subject/Date, counts the Received relay hops, surfaces SPF/DKIM/DMARC authentication results, lists attachments, and renders the message body (HTML sanitised with scripts and remote content removed, or plain text).' },
  { label: 'Diagrams',  exts: 'DRAWIO DXF DWG DWT', tags: 'drawio diagrams.net diagram flowchart mxgraph mxfile shapes connectors svg vector autocad dxf dwg dwt drawing template entities cad lines circles arcs polyline 2d preview libredwg', desc: 'Render 2D vector diagrams and CAD drawings to a preview: draw.io / diagrams.net (DRAWIO) files - decoding the mxGraph model, inline or compressed - AutoCAD DXF drawings (parsing the ASCII ENTITIES section), and binary AutoCAD DWG/DWT drawings, parsed by LibreDWG (WebAssembly) into their entities and rendered to an SVG, with an entity and layer breakdown.' },
  { label: 'Altium (EDA)', exts: 'SchDoc SchLib PcbDoc PcbLib PrjPcb EPW', tags: 'altium designer eda electronics pcb printed circuit board schematic footprint symbol library protel ole compound file cfbf circuit cad samacsys ecad part wizard component designator net netlist layer stackup copper pad track via arc bom mouser manufacturer part number project prjpcb epw', desc: 'Open Altium Designer schematics, circuit boards and projects in the browser. Analyser reads the OLE compound-file streams of schematic documents (.SchDoc) and symbol libraries (.SchLib), and PCB documents (.PcbDoc) and footprint libraries (.PcbLib), and rebuilds the geometry as an interactive vector view: schematic symbols, wires and pins, or the board outline, copper, pads, tracks and arcs - with pan, zoom and per-layer visibility toggles. It surfaces the component part numbers, datasheet and supplier links, the pad table and the layers used, reads the project manifest (.PrjPcb) with its member documents, and decodes the SamacSys ECAD Model wrapper (.epw). Nothing is uploaded.' },
  { label: 'KiCad (EDA)', exts: 'kicad_sch kicad_pcb kicad_sym kicad_mod kicad_pro kicad_prl', tags: 'kicad eeschema pcbnew eda electronics pcb printed circuit board schematic footprint symbol library s-expression sexpr open source circuit cad component designator reference net netlist layer copper pad track trace via arc zone edge cuts courtyard silkscreen bom project fp-lib-table sym-lib-table fp-info-cache ngspice wbk simulation cross probe gerber backup bak spice ltspice raw waveform plot operating point transient ac analysis dc sweep node voltage branch current', desc: 'Open KiCad schematics, circuit boards, footprints and projects in the browser. Analyser parses the S-expression documents - schematics (.kicad_sch), boards (.kicad_pcb), symbol libraries (.kicad_sym) and footprint modules (.kicad_mod), including the "-bak" backups - and rebuilds the geometry as an interactive vector view: schematic symbols, wires, junctions and labels, or the board outline, copper tracks, pads, vias, zones and silkscreen, with pan, zoom and per-layer visibility toggles. It reads the project settings (.kicad_pro / .kicad_prl JSON) with its net classes, the library tables, the footprint cache and the ngspice simulation workbook (.wbk), and plots the SPICE simulation waveforms (.raw) from KiCad/ngspice or LTspice - decoding the analysis type, variables and samples to chart the traces or tabulate an operating point. Dropping a whole project folder opens every document together as one design with a combined bill of materials that cross-probes each part to its symbol on the schematic and its footprint on the board. Nothing is uploaded.' },
  { label: 'IPC netlist (EDA)', exts: 'IPC', tags: 'ipc ipc-d-356 ipc-356 ipc356 netlist fabrication fab bare board electrical test net testpoint test point pcb printed circuit board kicad altium net connectivity drill pad via smd through hole component reference pin signal manufacturing', desc: 'Open IPC-D-356A bare-board fabrication and electrical-test netlists (.ipc) exported by KiCad, Altium and other PCB tools. Analyser parses the fixed-column feature records - the net each test point belongs to, the component reference and pin, the pad or via geometry and its X/Y position - and rebuilds the full net-to-pin connectivity, summarises the nets, components and pad/via mix, and draws a fabrication map of every test point coloured by net.' },
  { label: 'Fonts',     exts: 'TTF OTF WOFF WOFF2 TTC', tags: 'font typeface typography truetype opentype web woff woff2 collection ttc variable font glyph specimen pangram axes weight foundry designer', desc: 'Preview fonts live in the browser and inspect them: the native FontFace API renders a real specimen (pangram, alphabet and sizes) of TrueType (TTF), OpenType (OTF), web fonts (WOFF, WOFF2) and collections (TTC), with sliders that drive each variable-font axis in real time. opentype.js reads the family, style, version, foundry, licence and units-per-em, counts the glyphs, and draws a grid of every glyph outline.' },
  { label: 'Text art',  exts: 'NFO', tags: 'nfo scene release ascii art ansi cp437 oem ibm pc box drawing block characters info notes', desc: 'Open scene-release NFO files decoded from their native CP437 (IBM PC OEM) code page, so the box-drawing and block-character ASCII art renders the way it was authored instead of as garbled text.' },
  { label: 'Archives',  exts: 'ZIP RAR 7Z TAR GZ TGZ BZ2 XZ ZST LZ4 LZMA Z', tags: 'compressed archive extract browse decompress zip winrar rar 7zip 7z tar tarball gzip gz bzip2 bz2 xz lzma zstandard zst tgz lz4 lzw compress dot-z unix compress', desc: 'Browse the file tree and compression details of archives without extracting them: ZIP in pure JavaScript, and RAR, 7z, TAR and compressed tarballs (.tar.gz / .tgz, .tar.xz, .tar.zst, .tar.bz2) through a bundled libarchive engine - click any file inside to analyse it. A single compressed stream (.gz, .xz, .zst, .lz4, .lzma, .Z) is decompressed so the file within can be opened; bare .bz2 streams are identified only.' },
  { label: 'Data',      exts: 'CSV TSV SVG', tags: 'spreadsheet vector markup data table', desc: 'Preview CSV and TSV tables with per-column stats, and view or rasterise SVG vector graphics.' },
  { label: 'Lyrics',    exts: 'LRC', tags: 'lyrics synced timed karaoke song subtitle text', desc: 'Parse .lrc timed-lyric files: read the artist/title/album ID tags and every timestamped line.' },
  { label: 'Subtitles', exts: 'SRT VTT ASS SSA SUB', tags: 'subtitle caption closed captions srt webvtt substation alpha timed text cues microdvd subviewer frame based vobsub', desc: 'Parse subtitle cues and timing from SubRip (SRT), WebVTT, ASS/SSA, MicroDVD and SubViewer (.sub): cue count, on-screen time, and a full timed cue list. MicroDVD frame timings are converted to time using the declared or assumed frame rate; binary VobSub .sub image subtitles are identified.' },
  { label: 'MIDI',      exts: 'MID MIDI', tags: 'midi music score sequencer general gm synthesizer notes tempo instruments', desc: 'Parse Standard MIDI Files: format, tempo (BPM), time signature, General MIDI instruments, track names, note counts, and duration.' },
  { label: 'Map data',  exts: 'GPX KML GeoJSON', tags: 'gps track waypoint route geojson kml google earth strava garmin map coordinates location gis', desc: 'Parse GPX tracks, KML placemarks, and GeoJSON features - counts, distance, elevation, time span, and bounds - plotted on an OpenStreetMap map.' },
  { label: 'Web / code', exts: 'HTML CSS JS TS TSX JSX JSON YAML XML MD HTM MJS YML TXT PS1 PSM1 PSD1 BAT CMD', tags: 'programming development website htm html mjs es module yml yaml txt plain text react typescript javascript node powershell ps1 psm1 psd1 script module manifest windows automation cmdlet sysadmin shell batch bat cmd command prompt dos launcher', desc: 'Preview and inspect HTML, CSS, JavaScript, TypeScript, JSON, YAML, XML and Markdown source files, plus Windows scripts - PowerShell (PS1, PSM1, PSD1), reading their comment-based help synopsis, #Requires directives, function and parameter counts, CmdletBinding and Authenticode signing; and batch/command scripts (BAT, CMD), reading the echo state, labels, variables set and the external tools they invoke - all alongside the source.' },
  { label: 'Git objects', exts: 'PACK IDX', tags: 'git object loose blob tree commit tag packfile pack idx index version control repository sha1 sha-1 zlib github gitlab bitbucket .git objects content addressable', desc: 'Open git repository internals with no git binary: loose objects (the zlib-compressed blob, tree, commit and tag files under .git/objects), pack files (.pack) and pack indexes (.idx). Inflates and parses each object - showing its type, size and SHA-1, rendering commit and tag messages, listing tree entries, and handing blob contents to the analyser.' },
];

// EXTENDED = the big format-coverage expansion (the long tail of newer formats,
// one row per parser-chunk domain). CORE = the original, well-known proprietary
// formats. They render as two separate groups; IDENTIFICATION below recombines
// them for formatCount() and any whole-catalog use.
export const IDENTIFICATION_EXTENDED = [
  { label: 'Developer / data', exts: 'JWT JSONL NDJSON DIFF PATCH WASM CLASS NPY Safetensors GGUF MAP SQL SLN CSPROJ VBPROJ FSPROJ VCXPROJ Gradle TF TFState EditorConfig PROTO GraphQL GQL SARIF PYC PLIST', tags: 'developer code json web token jwt auth webassembly wasm java class bytecode numpy npy safetensors gguf llm ai model machine learning source map sourcemap sql dump database visual studio solution sln dotnet msbuild csproj terraform tfstate protobuf protocol buffers graphql sarif python pyc property list plist apple serialization', desc: 'Identify and read metadata from developer and data files: JWT tokens (header + claims + expiry), WebAssembly, Java class files, NumPy/Safetensors/GGUF model files, source maps, SQL dumps (dialect, tables, columns, INSERT counts), Visual Studio/.NET projects, Terraform, Protobuf, GraphQL, SARIF, Python bytecode, and Apple property lists (XML + binary). Jupyter notebooks (IPYNB) and HAR captures now open in a full viewer - see Notebooks & data above.' },
  { label: 'RAW sidecars / cinema', exts: 'AAE PP3 COS COF COP DOP NKSC R3D BRAW CRM ARI CINE FPF EIP BAY PXN RWZ', tags: 'raw edit sidecar adjustments apple photos rawtherapee pp3 capture one cos dxo photolab dop nikon nx studio nksc redcode r3d blackmagic braw canon cinema raw light crm arriraw ari phantom cine flir thermal fpf casio bay logitech pxn rawzor rwz developer recipe', desc: 'Identify camera RAW edit sidecars - Apple Photos adjustments (AAE), RawTherapee (PP3), Capture One (COS), DxO PhotoLab (DOP) and Nikon NX Studio (NKSC) - reading the applied-edit recipe, plus cinema and rare camera RAW: REDCODE (R3D), Blackmagic (BRAW), Canon Cinema RAW Light (CRM), ARRIRAW (ARI), Phantom CINE and FLIR thermal (FPF).' },
  { label: 'Archives (packages)', exts: 'CPIO A LIB WHL NUPKG CRX XPI VSIX ASAR APPX MSIX APKG CONDA DEB RPM GEM CAB ACE ARJ LZH LHA ZOO ARC', tags: 'archive package installer compression cpio initramfs unix ar static library python wheel pip pypa nuget dotnet chrome extension firefox addon vs code vsix electron asar windows app package msix anki conda anaconda debian ubuntu apt dpkg redhat fedora rpm rubygems gem microsoft cabinet ace arj lha lharc zoo arc lib coff import library visual studio msvc msbuild link.exe linker object file obj webview2', desc: 'Read software packages and Unix archive streams: Python wheels, NuGet, Chrome/Firefox/VS Code extensions, Electron ASAR, Windows APPX/MSIX, Debian (DEB), RPM, RubyGems, conda, Anki, Microsoft CAB, cpio, Unix ar and Microsoft COFF libraries (.lib - telling a static library apart from a DLL import library, with the target architecture and the DLLs it binds to) - showing name, version, dependencies and the file tree.' },
  { label: 'Calendar / contacts', exts: 'ICS ICAL IFB VCF VCARD VCS LDIF CONTACT MSG PST OST NSF EDB DBX', tags: 'icalendar ics calendar event meeting invite vevent vtodo rrule google calendar vcard contact address book vcf vcs ldif ldap directory pst ost exchange ese lotus notes domino nsf dbx outlook express pim personal information', desc: 'Open personal-information files: iCalendar .ics/.ical and .vcs (events, times, recurrence, organiser/attendees), vCard .vcf contacts (fields + inline base64 photo), LDIF directory exports and Windows .contact - with Outlook .msg/.pst, IBM Notes .nsf, Exchange .edb and Outlook Express .dbx identified. Email messages (.eml/.emlx/.mbox) now open in a full viewer - see Email above.' },
  { label: 'Security / keys / certs', exts: 'KEY PUB P8 CSR CRL P7B P7C PPK OVPN WG JKS KEYSTORE JCEKS MOBILECONFIG MOBILEPROVISION REG PCAP PCAPNG P12 PFX KDBX EVTX', tags: 'openssl ssh openssh putty rsa ed25519 ecdsa pkcs1 pkcs8 pkcs10 pkcs7 pkcs12 pfx cms x509 certificate csr crl certbot letsencrypt keystore java jks jceks tomcat apns apple mdm provisioning mobileconfig wireguard openvpn vpn registry regedit forensics keepass encase prefetch etw wireshark tcpdump pcap fingerprint sha256 private key secret credentials', desc: 'Inspect security and crypto files: PEM private/public keys (RSA/EC/Ed25519, PKCS#1 vs PKCS#8, encryption), OpenSSH .pub with SHA-256 fingerprint, PuTTY .ppk, PKCS#10 CSR, X.509 CRL, PKCS#7 bundles, OpenVPN/WireGuard configs, Java KeyStores, Apple .mobileconfig/.mobileprovision, Windows .reg (with autorun flagging), and pcap/pcapng captures - warning when a private key or secret is present.' },
  { label: 'Game ROMs / assets', exts: 'NES GB GBC GBA SFC SMC NDS DSI Z64 N64 V64 GEN SMD IPS BPS UPS PPF WAD NBT MCWORLD ASE PCK PAK PK3 BSP VPK VTF VMT KTX KTX2 TMX TMJ LOVE PACKAGE MPQ CIA NSP XCI', tags: 'rom emulator emulation console retro nintendo nes famicom game boy gameboy gbc advance gba snes super famicom super nintendo nintendo ds dsi nintendo 64 n64 sega genesis mega drive ips bps ups ppf patch romhack doom wad slade minecraft nbt schematic litematica bedrock aseprite sprite godot quake idtech valve source engine vpk vtf vmt bsp pico-8 love2d love tiled tmx ktx ktx2 gpu texture the sims sims3 sims4 maxis dbpf package simcity spore cas mods starcraft mpq blizzard 3ds switch nsp xci citra ryujinx renpy rpg maker fceux mesen mgba snes9x project64 mednafen', desc: 'Inspect game ROMs, patches and engine assets: iNES/NES2.0, Game Boy/Color/Advance, SNES, Nintendo DS/DSi, Nintendo 64, and Sega Genesis ROM headers (title, mapper, region, checksum); IPS/BPS/UPS/PPF patches; Doom WAD lumps; Minecraft NBT/schematics and Bedrock bundles; Aseprite sprites; Godot .pck; Quake/id Tech PAK/PK3; Source BSP/VPK/VTF/VMT; KTX/KTX2 textures; Tiled maps; LÖVE games; PICO-8 carts - plus MPQ, 3DS/Switch and Ren’Py/RPG Maker identification.' },
  { label: 'Disk images / firmware', exts: 'OVF OVA VBOX VMX CUE CCD NRG MDS MDF HEX SREC S19 S28 S37 MOT UF2 ELF AXF O SO DTB DTBO UIMAGE GPT MBR EXT4 EXT SQUASHFS SFS CRAMFS ROMFS WIM SWM ESD EWF JFFS2 UBIFS YAFFS2 ISZ CDI VMSN VMEM', tags: 'disk image firmware virtual machine vm vmware virtualbox oracle ovf ova appliance vmx vbox hypervisor cue sheet clonecd nero alcohol optical cd dvd partition gpt mbr efi boot intel hex motorola s-record srec microcontroller mcu embedded uf2 raspberry pi pico micro:bit elf axf gcc clang arm risc-v avr x86 executable shared object device tree dtb u-boot uimage flash router iot openwrt ext4 ext3 squashfs cramfs romfs linux filesystem superblock wim esd swm windows imaging encase ewf forensic jffs2 ubifs yaffs2 nand', desc: 'Inspect virtual-machine descriptors (VMware .vmx, VirtualBox .vbox, OVF/OVA), disc images (Nero .nrg, Alcohol .mds/.mdf, CloneCD), embedded firmware (Intel HEX, Motorola S-record, UF2, ELF/AXF, Device Tree Blobs, U-Boot uImage), partition tables (MBR/GPT with GUIDs), Linux filesystem superblocks (ext2/3/4, SquashFS, cramfs, romfs) and Windows imaging (WIM/ESD) - reading headers directly, no upload.' },
  { label: 'Science / medical / engineering', exts: 'DCM DICOM NII FIT TCX FITS FTS FASTA FA FNA FAA FASTQ FQ MOL SDF MOL2 CIF MMCIF XYZ GBR GBL GTL DRL XLN CIR SP SPI SPICE EDF BDF JDX DX SAV DTA SAS7BDAT VTK VTU VTP VTI SEGY SGY BAM SAM BCF HEA', tags: 'dicom medical imaging ct mri x-ray pacs radiology garmin strava zwift activity fit tcx fits astronomy nasa telescope nifti neuroimaging brain fasta fastq dna rna protein genomics ncbi illumina sequencing chemistry molecule mdl sdf mol2 rdkit chemdraw cif crystallography xyz avogadro vmd gerber pcb kicad altium eagle excellon drill spice ltspice ngspice netlist eeg ecg edf bdf biosignal jcamp spectroscopy ir nmr spss stata sas statistics dataset vtk paraview kitware mesh fea cfd simulation seg-y seismic bam sam vcf variant samtools wfdb physionet', desc: 'Open scientific, medical and engineering files: DICOM scans, NIfTI brain volumes, Garmin FIT/TCX activities, FITS astronomy frames, FASTA/FASTQ sequences, chemistry structures (MOL/SDF/MOL2/CIF/XYZ), Gerber/Excellon PCB data, SPICE netlists, EDF/BDF biosignals, JCAMP-DX spectra, SPSS/Stata/SAS datasets and VTK/ParaView meshes - metadata extracted entirely in-browser.' },
  { label: 'System / misc', exts: 'OPML RSS ATOM DESKTOP SERVICE CRASH AB JOB POL SCR DS_STORE THUMBSDB DSYM DWARF SDB', tags: 'opml feed reader subscriptions rss atom syndication podcast enclosure freedesktop linux desktop launcher application systemd unit service daemon apple crash report ips panic exception android backup adb windows task scheduler job group policy registry.pol preg screensaver pe executable macos ds_store finder thumbs.db thumbnail dsym dwarf debug symbols shim database sdb', desc: 'Inspect OS and system files: OPML subscription lists, RSS/Atom feeds, Linux .desktop launchers and systemd .service units, Apple .crash reports, Android .ab backups, Windows Task Scheduler .job, Group Policy Registry.pol, and .scr screensaver PE headers, plus identification of .DS_Store, Thumbs.db, dSYM/DWARF and shim .sdb. Scene .nfo ASCII art now opens in a CP437 viewer - see Text art above.' },
  { label: 'Images (more)', exts: 'TGA QOI PPM PGM PBM PNM PAM PCX FF FARBFELD WBMP XBM XPM RAS SGI BW HDR DDS EXR JP2 J2K JPF JPX JPC JXR WDP HDP EPS PS WMF EMF EMZ ICNS CUR ANI MNG LOTTIE FLIF CGM PICT PCT EPSF EPSI J2C JBIG JBIG2 JB2 ICB VST', tags: 'flif free lossless image cgm computer graphics metafile apple pict pct quickdraw encapsulated postscript epsf epsi jpeg 2000 codestream j2c jbig jbig2 jb2 bi-level fax icb vst truevision targa tga game texture qoi quite ok image netpbm portable pixmap graymap bitmap pam zsoft pcx paintbrush farbfeld suckless wbmp wireless x11 xbm xpm sun raster sgi iris radiance hdr rgbe high dynamic range directdraw surface dds directx bcn dxt bc7 openexr exr ilm vfx jpeg 2000 jp2 openjpeg jpeg xr hd photo wmphoto encapsulated postscript eps ghostscript windows metafile emf wmf apple icns icon cursor cur ani mng lottie bodymovin airbnb after effects pict flif jbig coreldraw cdr', desc: 'Decode and preview extra still-image formats in pure JavaScript - Truevision TGA, QOI, Netpbm (PPM/PGM/PBM), PCX, farbfeld, WBMP, XBM/XPM, Sun Raster and SGI are fully rendered - and read header metadata from codec-heavy formats: Radiance HDR, DirectDraw Surface (DDS) game textures, OpenEXR, JPEG 2000, JPEG XR, EPS/PostScript, Windows WMF/EMF metafiles, Apple ICNS icons, CUR/ANI cursors, MNG and Lottie animations.' },
  { label: '3D / CAD / point clouds (more)', exts: 'VOX DAE ZAE USDC X3D WRL VRML LWO LWS MD2 MD3 MDL VRM JT LAS LAZ PCD PTS E57 IFC IFCZIP SPLAT SPZ PRC VDB X3DV HIPNC', tags: 'prc 3d pdf product representation compact openvdb vdb volume fog density x3d classic vrml x3dv houdini hipnc sidefx wavefront obj stanford ply khronos collada dae blender maya magicavoxel vox lightwave newtek quake id software studiomdl lidar point cloud asprs las laz laszip leica faro pcl ros e57 bim buildingsmart ifc revit archicad siemens jt jupiter tessellation usd usdc vrm vroid avatar gaussian splat spz scaniverse niantic openvdb alembic amf additive manufacturing voxel mesh scene off', desc: 'Header and metadata extraction for 3D meshes, voxels, BIM, point clouds and Gaussian splats: MagicaVoxel VOX, COLLADA DAE/ZAE, USD crate, X3D/VRML, LightWave LWO/LWS, Quake MD2/MD3/MDL, VRM avatars, Siemens JT, LAS/LAZ/PCD/PTS/E57 LiDAR clouds, IFC BIM, and .splat/.spz - vertex/face/point counts, bounding boxes, units and authoring tool. glTF/GLB now open in a full 3D viewer - see the 3D model section.' },
  { label: 'Geospatial / GIS', exts: 'TopoJSON OSM SHP SHX DBF PRJ CPG PGW TFW JGW WLD GML NMEA NMEA0183 IGC TAB MIF VRT PMTiles DT0 DT1 DT2 DTED ASC HGT GRIB GRB GRIB2 CDF NC4 PBF GPKG MBTiles SID ECW GDB', tags: 'gis geospatial shapefile esri arcgis qgis gdal ogr topojson d3 openstreetmap osm mapinfo dbase dbf wkt crs epsg projection prj world file georeferencing gml nmea gps igc paragliding flight log dted terrain elevation srtm hgt esri ascii grid pmtiles protomaps grib grib2 netcdf weather geopackage gpkg mbtiles mapbox mrsid ecw geodatabase vrt raster', desc: 'Inspect geospatial and GIS files without a map: TopoJSON, OpenStreetMap XML, Esri Shapefile siblings (SHP/SHX/DBF/PRJ/CPG), world files, GML, NMEA GPS logs, IGC flight logs, MapInfo TAB/MIF, GDAL VRT, PMTiles, DTED terrain, Esri ASCII grids and SRTM .hgt - surfacing CRS/EPSG, feature/record counts, bounding boxes and elevation ranges. GRIB/NetCDF/GeoPackage/MBTiles/MrSID/ECW identified.' },
  { label: 'Audio (more)', exts: 'APE WV TAK TTA OFR DSF DFF MPC CAF RF64 BW64 W64 AU SND VOC BWF SPX AWB QCP 3GA M4R GSM MP2 MP1 SF2 SF3 SFZ DLS RMI MMF GIG RTTTL IMY SAP MOD XM IT S3M STM MTM MED 669 FAR OKT NSF NSFE SPC VGM VGZ GBS AY YM AUP AUP3 PSF UMX MO3 SHN sfArk PSF2 miniPSF MP+ MPP MQA MMD', tags: "monkeys audio unreal music umx mo3 compressed module shorten shn lossless sfark soundfont mqa master quality musepack mp+ mpp octamed mmd portable sound psf2 minipsf ape wavpack wv tak true audio tta optimfrog dsd dsf dsdiff dff sacd musepack mpc core audio caf rf64 bw64 wave64 w64 sun next au snd creative voice voc broadcast wave bwf smpte timecode speex spx amr-wb awb qualcomm qcp purevoice 3gpp 3ga iphone ringtone m4r gsm mpeg layer 2 mp2 soundfont sf2 sf3 sfz sampler downloadable sounds dls riff midi rmi smaf yamaha gigastudio gig rtttl nokia ringtone imelody imy atari sap protracker amiga mod fasttracker xm impulse tracker it scream tracker s3m stm multitracker mtm octamed med composer 669 farandole far oktalyzer okt nes sound nsf famicom snes spc700 spc vgm vgz game boy gbs ay zx spectrum ym atari st audacity aup aup3 chiptune tracker module", desc: 'Identify many more audio formats: lossless/hi-res codecs (Monkey’s Audio, WavPack, TAK, True Audio, DSD/SACD, Musepack), pro containers (Core Audio, RF64/BW64, Wave64, Sun AU, Broadcast Wave with timecode), speech/mobile (Speex, AMR-WB, QCP, 3GA, M4R, GSM), MPEG Layer I/II, instrument banks (SoundFont, SFZ, DLS, RIFF MIDI, GigaStudio), ringtones (RTTTL, iMelody, SAP), tracker modules (MOD, XM, IT, S3M, OctaMED, 669, Oktalyzer), chiptunes (NES NSF, SNES SPC, VGM, Game Boy GBS, AY, YM) and Audacity projects.' },
  { label: 'Video / streaming (more)', exts: 'M3U8 M3U MPD ISM ISMC F4M ASX WPL XSPF PLS MXF GXF LXF DV DIF ASF DVR-MS RM RMVB DIVX F4V INSV INSP LRV GIFV IVF Y4M M2V M1V MPV H264 H265 HEVC AVC OBU M2P M2T TRP WTV OGM NUT DPX CIN DAV YUV', tags: 'hls m3u8 apple playlist mpeg-dash mpd manifest adaptive bitrate smooth streaming ism microsoft adobe hds f4m asx wpl xspf pls winamp playlist mxf material exchange smpte avid sony xdcam gxf lxf dv dvcam ntsc pal asf advanced systems wmv realmedia rm rmvb realvideo divx f4v flash insta360 insv insp 360 lrv gopro dji proxy gifv imgur ivf vp8 vp9 av1 y4m yuv4mpeg raw h264 avc h265 hevc x264 x265 obu aom mpeg-2 program transport stream pat pmt wtv windows media center dvr-ms ogm ogg nut ffmpeg dpx cineon cin dahua dav cctv pvr dvb', desc: 'Inspect streaming manifests and video containers: HLS/DASH/Smooth Streaming/HDS manifests and playlists; pro/broadcast MXF/GXF/LXF/DV; ASF/.dvr-ms and RealMedia; DivX/F4V/Insta360/GoPro proxies/GIFV; raw elementary streams (IVF, Y4M, MPEG-1/2, H.264/H.265 SPS, AV1 OBU); MPEG program/transport and PVR/DVB recordings; Windows Recorded TV, Ogg Media, NUT; DPX/Cineon/Dahua/.yuv identified.' },
  { label: 'Documents / e-books (more)', exts: 'CBZ CBR CBT CB7 XPS OXPS HWP FB3 IBOOKS SCRIV VSDX RMD QMD RTFD WARC MAFF DVI CHM WPD QXD PMD LIT KFX', tags: 'comic book cbz cbr cbt cb7 comicinfo manga reader xps oxps openxps hwp hancom hangul korean fb3 ibooks apple author scrivener visio vsdx r markdown rmd quarto qmd rtfd web archive warc maff mozilla dvi chm help wordperfect wpd quarkxpress qxd pagemaker pmd ms reader lit kindle kfx ebook', desc: 'Open documents, e-books and publishing files beyond Office: comic books (CBZ/CBT with ComicInfo + first-page preview; CBR/CB7 identified), Microsoft XPS, FictionBook FB3, iBooks, Scrivener, Visio VSDX, R Markdown/Quarto, RTFD, WARC/MAFF web archives, TeX DVI, legacy Hangul HWP, and WordPerfect/QuarkXPress/PageMaker identification.' },
  { label: 'Source code & build files', exts: 'C H CC CPP CXX HPP HH HXX INO MM HMM CS Java KT KTS Go RS PY PYW RB PHP Swift Scala Lua PL PM R Dart Groovy VB GLSL VERT FRAG COMP HLSL FS VS GS SH Bash ZSH Fish CMake MK MAK Make Ninja JAM Build IN INC AM AC M4 PRO PRI QRC RC DEF SPEC Skip Man DOX Doxygen GitIgnore GitAttributes GitModules DockerIgnore NPMIgnore ESLintIgnore PrettierIgnore CursorIgnore Clang-Format Clang-Tidy LESS SCSS Svelte PO POT Entitlements COPYING README LESSER FSH VSH Geom PYX Sample ESLintRC YarnClean ASPX PYI PXI PXD PYF PYS VBS F90 F95 F SCT RNG XSL CNF ZI 1', tags: 'pyi python type stub typeshed pxi pxd cython pyf f2py fortran interface pys python script vbs vbscript windows scripting host f90 f95 f fortran fixed-form free-form numpy scipy sct windows script component scriptlet rng relax ng schema xsl xslt stylesheet transform cnf openssl config zi tzdata zoneinfo time zone source troff man page manual licence license copying py.typed pep 561 cachedir.tag python path .pth site-packages source code programming language c cpp c++ cplusplus header python py ruby rust go golang java kotlin csharp c# dotnet php swift scala lua perl r dart groovy visual basic arduino sketch shader glsl hlsl vertex fragment compute opengl vulkan shell script bash sh zsh fish posix cmake makefile make ninja autoconf automake autotools configure m4 qmake qt qrc resource module definition rpm spec doxygen git gitignore gitattributes submodule docker dockerignore npm eslint prettier cursor clang-format clang-tidy formatter linter build system compiler developer repository repo objective-c++ objc mm shader fragment vertex geometry fs vs gs boost jam meson skip test manpage man page troff stylesheet less sass scss css preprocessor svelte component frontend web gettext translation po pot localisation localization i18n internationalisation apple entitlements plist licence license copying lgpl readme cython pyx opengl fragment vertex geometry shader fsh vsh geom git hook sample eslint eslintrc yarn yarnclean asp.net aspx web forms', desc: 'Open and read programming-language source, build and configuration files as text: C, C++ and their headers, C#, Java, Kotlin, Go, Rust, Python, Ruby, PHP, Swift, Scala, Lua, Perl, R, Dart, Groovy and Visual Basic, GPU shaders (GLSL, HLSL), shell scripts (sh, Bash, Zsh, Fish), and the build and tooling files that fill a source repository - CMake, Makefiles, Ninja, Autotools (.in / .ac / .am / .m4), qmake projects, Doxygen configs and the dotfiles that configure Git, Docker, npm, ESLint, Prettier, Cursor and clang-format. Also opens Objective-C++ (.mm / .hmm), more GPU shaders (.fs / .vs / .gs), Boost.Jam and Meson build scripts, Unix manual pages, web stylesheets (Less, Sass/SCSS) and Svelte components, gettext translations (.po / .pot), Apple entitlements and licence/readme text, plus Cython (.pyx), OpenGL shaders (.fsh / .vsh / .geom), Git hook samples, ESLint and Yarn configs and ASP.NET (.aspx) pages. Each opens with a source preview, line count and metadata, entirely in your browser.' },
  { label: 'Developer / data (more)', exts: 'LOCK PB MsgPack MPK BSON CBOR PKL Pickle NPZ JAR WAR EAR FBS Thrift Capnp HCL MAT RDB Arrow Feather Parquet ORC DESC DUMP', tags: 'lockfile dependency package-lock yarn pnpm cargo poetry gemfile composer bundler protobuf protocol buffers wire grpc messagepack msgpack mpk bson mongodb cbor python pickle pkl insecure numpy npz jar war ear java maven gradle spring manifest flatbuffers fbs thrift apache capnp cap n proto hcl terraform nomad vault packer matlab mat mathworks redis rdb dump arrow feather parquet orc hive spark columnar serialization descriptor', desc: 'Identify and read developer and data-serialisation files: dependency lockfiles (npm/Yarn/pnpm/Cargo/Poetry/Bundler/Composer - locked-package count), binary serialisations (MessagePack, CBOR, BSON, raw Protobuf messages and descriptor sets), Python pickles with a security note, NumPy .npz and Java jar/war/ear archives, IDL schemas (FlatBuffers/Thrift/Cap n Proto/HCL), MATLAB MAT-files, Redis RDB dumps and columnar big-data containers (Apache Arrow/Feather, Parquet, ORC). The JSON supersets JSON5/JSONC/Hjson now open in a full viewer - see Notebooks & data above.' },
  { label: 'Archives (more)', exts: 'XAR PKG MPKG MSU SNAP Flatpak SIT SITX LZO BR JNLP TLZ TBZ TZ TXZ TZST', tags: 'txz xz tarball tzst zstandard tarball compressed xar apple installer macos pkg mpkg windows update standalone wusa msu cab snap canonical squashfs flatpak flathub ostree stuffit sit sitx aladdin lzop lzo brotli google java web start jnlp tarball tlz tbz tz', desc: 'Open more archives, packages and installers: macOS XAR/.pkg/.mpkg installers (member list), Windows .msu updates (CAB), Snap SquashFS packages, Flatpak bundles, StuffIt (.sit/.sitx), lzop (.lzo) and Brotli (.br) streams, Java Web Start (.jnlp), and the .tlz/.tbz/.tz compressed-tarball shorthands.' },
  { label: '3D / CAD (more)', exts: 'DRC KSplat U3D 3DXML X QB Wings PLN PLA RVT RFA RTE RFT PAR PSM PWD NWD NWF NWC Model EXP DLV Session CL3 CLR TZF VSD', tags: 'draco google compressed mesh gaussian splat ksplat universal 3d ecma-363 3d pdf 3dxml dassault catia directx x model qubicle voxel wings3d archicad graphisoft pln pla bim solo project building information modelling rof fdb revit autodesk bim rvt rfa template solid edge siemens par psm pwd navisworks nwd nwf nwc catia v4 model exp dlv session faro trimble scanner point cloud cl3 clr tzf visio vsd ole2', desc: 'Identify more 3D, CAD and scene files: Google Draco compressed meshes, Gaussian splats (KSplat), Universal 3D, Dassault 3DXML, DirectX .x models, Qubicle voxels, Wings3D, Graphisoft ArchiCAD BIM projects (PLN/PLA, from their "ROF FDB" header), Autodesk Revit (RVT/RFA and templates, build version from BasicFileInfo), Siemens Solid Edge, Navisworks, legacy CATIA V4, terrestrial-scanner point clouds (FARO/Trimble) and legacy binary Visio (.vsd).' },
  { label: 'Disk images / firmware (more)', exts: 'TRX DFU FD ROM UBI SIMG ITB DSK IMA VFD VMSD NVRAM PVM HDD MF VBK', tags: 'trx broadcom openwrt router firmware dfu usb stm32 uefi bios coreboot edk2 fd rom flash volume ubi mtd nand android sparse image simg u-boot fit itb device tree floppy disk image dsk ima vfd fat vmware snapshot vmsd nvram parallels pvm virtual pc hdd ovf manifest mf veeam backup vbk', desc: 'Identify and read more disk images, firmware and VM files: TRX router firmware, USB DFU images, UEFI/BIOS flash volumes (.fd/.rom), Linux UBI volumes, Android sparse images (.simg), U-Boot FIT (.itb), raw floppy images (.dsk/.ima/.vfd with FAT boot sector), VMware snapshot metadata and NVRAM, Parallels VMs and disks (.pvm/.hdd), OVF manifests (.mf) and Veeam backups (.vbk).' },
  { label: 'Game assets (more)', exts: 'Assets Bundle Resource UTOC UCAS UEXP UMD CSO CHD FSB Bank BNK WEM Spine Skel Atlas YYP YY GMX MCA MCR MCTemplate 3DSX A78 A26 LNX J64 PCE GG SMS WS WSC W3X W3M RPYC RVData2 RXData Pyxel LDtk TIC XDelta Basis SRM State DSV DSM VBM FM2 Aseprite SC2Replay RPA RGSSAD RGSS3A Litematic Schem Schematic McAddon McPack PK4', tags: 'aseprite sprite pixel art sc2replay starcraft 2 replay mpq renpy archive rpa rgssad rgss3a rpg maker vx ace litematica litematic minecraft schematic schem sponge mcaddon mcpack bedrock addon pack quake doom 3 pk4 id tech 4 unity asset bundle assetbundle unreal engine ue4 ue5 utoc ucas iostore cooked compressed iso ciso cso chd mame dreamcast fmod fsb5 wwise audiokinetic bnk wem sound bank spine skeleton atlas gamemaker yoyo yyp gmx minecraft region anvil mca mcr bedrock template warcraft 3 w3x w3m mpq renpy rpyc rpg maker rvdata2 rxdata marshal pyxel edit ldtk level tic-80 fantasy console xdelta vcdiff patch basis universal texture atari 2600 7800 lynx jaguar pc engine turbografx sega master system game gear wonderswan 3ds homebrew emulator save state srm savestate desmume vbm fceux fm2 movie tas speedrun', desc: 'Identify and read more game and emulator files: Unity asset bundles, Unreal cooked assets, CISO/CHD disc images, FMOD/Wwise sound banks, Spine skeletons and atlases, GameMaker/LDtk/TIC-80 projects, Minecraft Anvil regions, Warcraft III maps, Ren Py and RPG Maker data, extra console ROMs (Atari, PC Engine, Master System/Game Gear, WonderSwan, 3DS homebrew), xdelta/Basis patches and emulator saves and movies.' },
  { label: 'Documents / publishing (more)', exts: 'SLA SCD WPS WPT WRI DOT SDW SDC SDD SNB LRF LRX TCR CBA FM Book AWT PM6 P65 PT6 ADF QXP ScrivX SXI ZABW', tags: 'quarkxpress qxp scrivener scrivx project staroffice impress sxi abiword gzip zabw scribus sla scd desktop publishing dtp microsoft works wps wpt windows write wri word template dot staroffice sdw sdc sdd writer calc impress shanda bambook snb sony bbeb lrf lrx ebook reader psion ebookwise tcr comic book ace cba framemaker fm book template awt pagemaker pm6 p65 pt6 aldus ole2 cfbf', desc: 'Identify and read more document, e-book and publishing files: Scribus (.sla/.scd version, pages, fonts), MS Works and Windows Write, Word 97 templates (.dot), StarOffice 5.x binary docs, Shanda Bambook and Sony BBeB (.lrf/.lrx) e-books, FrameMaker, document templates and legacy PageMaker.' },
  { label: 'Email / contacts (more)', exts: 'OLM OFT P7M P7S MSF MAB MBX TOC VMG VNT XCAL JCAL XCARD JCARD LDI PAB WAB ABBU', tags: 'outlook for mac olm archive template oft s/mime smime pkcs7 cms encrypted signed p7m p7s mozilla mork msf mail summary mab address book thunderbird eudora mbx toc qualcomm nokia vmg vmessage sms backup vnt vnote xcal jcal xcalendar jcalendar xcard jcard rfc6321 rfc7265 rfc6351 ldif ldi personal address book pab windows wab apple contacts abbu', desc: 'Identify and read more email, calendar and contact files: Outlook for Mac archives (.olm) and templates (.oft), S/MIME .p7m/.p7s, Mozilla Mork stores (.msf/.mab), Eudora/Outlook Express mailboxes (.mbx/.toc), phone backups (.vmg SMS, .vnt notes), XML/JSON iCalendar and vCard (.xcal/.jcal/.xcard/.jcard), LDIF (.ldi) and legacy address books (.pab/.wab/.abbu).' },
  { label: 'Security / forensics (more)', exts: 'PGP GPG SIG EVT YAR YARA RULES STIX IOC SAZ 1PUX OPVault Keychain AFF AFF4 KDB PVK authorized_keys known_hosts hive ETL DMP CAP NTAR E01', tags: 'ssh openssh authorized_keys known_hosts public key registry hive windows event trace log etl crash memory dump minidump dmp libpcap capture cap pcapng ntar encase forensic image e01 ewf openpgp gpg gnupg pgp armor signature windows event log evt yara rule malware snort suricata ids ips threat intel stix taxii misp openioc mandiant fiddler saz http session 1password 1pux opvault agilebits keychain apple credential aff aff4 forensic image acquisition keepass kdb authenticode pvk private key', desc: 'Identify and read more security and forensics files: OpenPGP messages/keys/signatures (.pgp/.gpg/.sig - armor type, packet walk, key algorithm and user ID, secret-key warning), YARA rules, Snort/Suricata IDS rules, STIX/OpenIOC threat intel, Fiddler captures (.saz), 1Password exports (.1pux), Apple Keychain, KeePass 1.x (.kdb), Microsoft keys (.pvk) and AFF/AFF4 forensic images.' },
  { label: 'Science / engineering (more)', exts: 'RDS RData RDA AB1 POSCAR XSF CDX CDXML ABF TDMS VHDR VMRK CNT EEG SET VTS VTR NET MSH INP CDB WFM', tags: 'r rds rdata rda rstudio serialized abif ab1 sanger sequencing chromatogram vasp poscar dft density functional gaussian cube volumetric xsf xcrysden chemdraw cdx cdxml perkinelmer axon abf pclamp electrophysiology ni tdms labview brainvision vhdr vmrk neuroscan cnt eeg meg eeglab set gmsh msh finite element fea cfd abaqus nastran inp ansys cdb apdl spice netlist net vtk vts vtr paraview oscilloscope waveform wfm', desc: 'Identify and read more scientific, medical and engineering files: R serialized data (RDS/RData), ABIF sequencing traces, VASP/Gaussian/XCrySDen DFT structures, ChemDraw (CDX/CDXML), Axon ABF and NI TDMS instrument data, BrainVision/Neuroscan/EEGLAB EEG, Gmsh/Abaqus/Nastran/ANSYS FEA decks, SPICE netlists, VTK structured/rectilinear grids and oscilloscope waveforms.' },
  { label: 'GIS / mapping (more)', exts: 'O5M O5C LYR LYRX QGS QGZ SBN SBX CPT BIL BIP BSQ', tags: 'openstreetmap osm o5m o5c osmconvert change esri arcgis layer lyr lyrx arcmap arcgis pro cim qgis project qgs qgz spatial index sbn sbx gmt gdal colour palette cpt envi band interleaved bil bip bsq raster remote sensing', desc: 'Identify and read more GIS and mapping files: OpenStreetMap o5m/o5c binaries, Esri layer files (.lyrx ArcGIS Pro CIM JSON, .lyr ArcMap), QGIS projects (.qgs/.qgz - version, CRS, layer list), shapefile spatial indexes (.sbn/.sbx), GMT/GDAL colour palettes (.cpt) and ENVI band-interleaved rasters (.bil/.bip/.bsq).' },
  { label: 'Native code, ML & misc (more)', exts: 'ONNX NODE DYLIB LDB REV CFF RSP CGP CHROMA STAMP', tags: 'onnx open neural network exchange machine learning model pytorch tensorflow scikit-learn ai inference node native addon node.js electron napi dylib mach-o macos dynamic library shared object ldb leveldb rocksdb sstable key-value chrome electron discord indexeddb git pack reverse index rev ridx citation cff citation file format yaml cffinit response file rsp compiler csc msbuild razer chroma rgb lighting animation build stamp marker ninja grid pattern cgp', desc: 'Identify and read cross-platform binaries, ML models and build artefacts: ONNX neural-network models (the framework that exported it and the IR/model version), native Node.js/Electron add-ons (.node) and macOS dynamic libraries (.dylib - Mach-O/PE/ELF container and architecture), LevelDB/RocksDB tables (.ldb), Git pack reverse indexes (.rev - RIDX header), Citation File Format metadata (CITATION.cff, content-gated against binary CFF fonts), compiler response files (.rsp), Razer Chroma animations (.chroma), build stamps/markers (.stamp) and pattern/grid data (.cgp).' },
  { label: 'REDengine (Cyberpunk 2077)', exts: 'ARCHIVE REDSCRIPTS SCRIPT TWEAK ADDCONT_KEYSTONE RNE', tags: 'cyberpunk 2077 cyberpunk2077 the witcher 3 witcher redengine red engine cd projekt red cdpr rdar archive wolvenkit redscript reds compiled scripts tweakxl tweakdb tweak redmod mod modding oodle kraken leviathan shader cache phantom liberty dlc addcont keystone steam_api64 renamed dll unins000 inno setup uninstall', desc: 'Identify CD Projekt Red REDengine 4 files from Cyberpunk 2077 and The Witcher 3: packed asset archives (.archive - RDAR header, version, index position/size and file count), compiled redscript caches (.redscripts), redscript/TweakXL source (.script, .tweak), add-on content keystones, and Cyberpunk\'s renamed Steam DLL (.rne). Also routes by magic the engine\'s Oodle-compressed blobs (oodle_dictionary.bin), per-platform shader caches (.cache) and the Inno Setup uninstall log (unins000.dat).' },
  { label: 'Marathon (Aleph One)', exts: 'SCEN SCEA APPL PHYS PHYA SHPS SHPA SNDZ SNDA FILA IMGA MML', tags: 'marathon bungie aleph one alephone classic marathon marathon 2 durandal infinity scenario map sceA physics model phyA shapes collection shps ShPa sprites sounds sndz sndA images imgA recorded film replay filA mml metafile markup language open source engine fps doom-era 1994 macintosh steam', desc: 'Identify Marathon (Bungie\'s 1994 FPS trilogy) and Aleph One data files - the open-source engine that runs Classic Marathon, Marathon 2 and Infinity on Steam: scenario maps (.scen / .sceA), physics models (.phys / .phyA), shapes/sprite collections (.shps / .ShPa), sound collections (.sndz / .sndA), recorded-game films (.filA), interface images (.imgA) and MML config XML (.mml). Reads the big-endian wad header version and the embedded internal name from each.' },
  { label: 'Unity / IL2CPP', exts: 'USYM PD_ SHADERVARIANTS SHADER HFTHUMB HASH', tags: 'unity il2cpp il2cpp global-metadata.dat global metadata addressables catalog.bin catalog binarystoragebuffer usym symbol map backtrace crash native gameassembly mono bsjb .net assembly metadata pd_ shaderlab shader shadervariants variant collection asset bundle manifest manifestfileversion crc house flipper hfthumb thumbnail jpeg bloons ultrakill checksum hash', desc: 'Identify and read Unity engine files, including IL2CPP-compiled games: the IL2CPP symbol map (.usym - version, symbol count) and global-metadata.dat (magic-gated - metadata version, mapped to a Unity release), Addressables binary catalogs (catalog.bin, content-gated) and their catalog.hash, ShaderLab shaders (.shader) and shader variant collections (.shadervariants), asset bundle manifests (core_assets.manifest), renamed .NET metadata blobs (.pd_ - BSJB runtime version) and House Flipper photo thumbnails (.hfthumb - JPEG wrapped, re-openable as an image). Plus generic hash/checksum text (.hash).' },
  { label: 'Source 2 (Valve)', exts: 'GI KV3 VCFG VQLAYOUT VSC QSS SIGNATURES VSND_TEMPLATE VNM_TEMPLATE MKS_TEMPLATE RES', tags: 'valve source 2 source2 source engine deadlock citadel counter-strike 2 cs2 dota 2 dota2 half-life alyx hlvr steam keyvalues3 kv3 keyvalues gameinfo gi vcfg config vqlayout layout qt qss stylesheet vsc style colours signatures resource res ui panorama hammer editor template vsnd_template vnm_template mks_template', desc: 'Identify and read Valve Source 2 text assets from Deadlock (Citadel), Counter-Strike 2, Dota 2 and Half-Life: Alyx: the gameinfo.gi manifest (game, title, search-path mounts), KeyValues3 files (.kv3 / .vcfg - surfacing the KV3 encoding and format header), the editor templates (.vsnd_template sound events, .vnm_template node graphs, .mks_template sheets), tools UI (.vqlayout, .vsc colours, .qss Qt stylesheets), function-signature databases (.signatures) and text resource/UI layouts (.res, content-gated against binary Windows .res) - each with parsed metadata plus a source preview.' },
  { label: 'Fonts (more)', exts: 'GLIF EOT', tags: 'eot embedded opentype web font legacy internet explorer @font-face microsoft ufo unified font object glif glyph interchange format robofont glyphs fontforge defcon fonttools font source outline contour type design', desc: 'Identify and inspect UFO glyph sources (.glif) - the XML one-glyph format inside Unified Font Object projects used by RoboFont, Glyphs, FontForge and fontTools: read the glyph name, Unicode, advance width and contour/point/component counts, and render the glyph outline. Legacy Embedded OpenType (.eot) web fonts - Microsoft\'s Internet Explorer-only wrapper around TrueType - are identified.' },
];

export const IDENTIFICATION_CORE = [
  { label: 'Adobe',           exts: 'INDD INDT IDML MOGRT SESX XD FLA SWF XMP LRtemplate LRcat ACV ACO ASL ABR GRD PAT', tags: 'photoshop illustrator indesign after effects aepx premiere pro premiere elements audition xd animate flash lightroom substance motion graphics compositing', desc: 'Identify Adobe project files and read their metadata: InDesign (INDD), XD, Animate (FLA), and Lightroom. After Effects projects (AEP, AET), Premiere Pro and Elements (PRPROJ, PREL), Photoshop (PSD, PSB) and Illustrator (AI) now open in full viewers - see After Effects, Premiere Pro, Photoshop and Illustrator.' },
  { label: 'Design',          exts: 'FIG Sketch afphoto afdesign afpub XCF SPP SBSAR SBS CDR MDP', tags: 'figma sketch affinity photo designer publisher gimp substance painter coreldraw cdr medibang paint mdp vector drawing', desc: 'Identify design-app files: Figma (FIG), Sketch, Affinity Photo/Designer/Publisher, GIMP (XCF), CorelDRAW (CDR), MediBang Paint (MDP) and Substance. Krita (KRA), Procreate and Paint.NET (PDN) now show their embedded preview - see Raster art above.' },
  { label: 'CAD',             exts: 'SLDPRT SLDASM SLDDRW SLDREG SVAP SVPJ F3D F3Z IPT IAM IDW 3DM SKP 3DS MAX C4D HIP ZPR ZTL MA MB CATPART CATPRODUCT PRT ASM BRD SCH KiCad_pcb GH GHX', tags: 'autocad autodesk solidworks fusion 360 inventor rhinoceros rhino grasshopper sketchup trimble 3ds max cinema 4d maxon houdini sidefx zbrush pixologic maya catia dassault eagle kicad electronic pcb settings wizard backup preferences registry sldreg visualize appearance material project render svap svpj', desc: 'Identify CAD files and read header metadata: AutoCAD DWG/DWT and DXF now open as a 2D drawing preview (see Diagrams), SolidWorks (SLDPRT, SLDASM, plus .sldreg Settings Wizard backups - release year, settings groups and the saved registry keys - and SOLIDWORKS Visualize .svap appearances and .svpj projects, opened as the ZIP packages they are), Fusion 360 (F3D), Inventor (IPT, IAM), Rhino (3DM) and Grasshopper (GH, GHX), SketchUp (SKP), 3ds Max, Cinema 4D, Houdini, ZBrush, Maya, CATIA, Eagle, and KiCad.' },
  { label: 'CAD exchange',    exts: 'SAT X_T X_B', tags: 'parasolid acis exchange neutral format', desc: 'Identify neutral CAD exchange formats: Parasolid (X_T, X_B) and ACIS (SAT). STEP and IGES get a full 3D viewer - see the 3D model section.' },
  { label: '3D / printing',   exts: 'FBX USDZ USD USDA BLEND IDEA', tags: 'blender mesh model 3d printing prusa bambu cura slicer wavefront autodesk pixar apple unity unreal stl ideamaker raise3d profile filament project sliced', desc: 'Identify 3D and 3D-printing files: FBX, USD/USDZ, Blender (BLEND) and Raise3D ideaMaker projects and print profiles (IDEA). OBJ, PLY, OFF, 3MF, AMF and glTF/GLB get a full 3D viewer - see the 3D model section.' },
  { label: 'Music production', exts: 'ALS ALP FLP RPP LOGIC LOGICX PTX CPR BAND', tags: 'ableton fl studio fruity loops reaper logic pro tools cubase garageband steinberg daw', desc: 'Identify DAW project files and read version, tempo, and plugin data: Ableton Live (ALS), FL Studio (FLP), Reaper (RPP), Logic Pro, Pro Tools (PTX), and Cubase (CPR).' },
  { label: 'Databases',       exts: 'SQLite SQLite3 DB DB3 SQLite-WAL SQLite-SHM DB-WAL DB-SHM DB3-WAL DB3-SHM SQLite3-WAL SQLite3-SHM', tags: 'sqlite sqlite3 microsoft access database sql dump schema table query rows ddl wal shm write-ahead log shared memory wal-index checkpoint journal rollback sidecar salt frames pages', desc: 'Open SQLite databases (.sqlite/.db/.sqlite3) and read their full schema in-browser - every table with its columns and row counts, views, indexes, triggers, the CREATE-statement DDL, and a sample of the largest table. Reads the WAL-mode sidecars too: the Write-Ahead Log (-wal) - page size, salts, frame and committed-transaction counts, and the pages it changed - and the shared-memory index (-shm) - valid frame count, database size and checkpoint progress. (.sql dumps are listed under Developer / data.) Microsoft Access (MDB, ACCDB) now opens in a full table viewer - see Access database above.' },
  { label: 'GIS / mapping',   exts: 'KMZ', tags: 'geographic gis mapping google earth shapefile esri kmz', desc: 'Identify geographic files: zipped Google Earth (KMZ). GPX, KML, and GeoJSON get full parsing + a map (see above); Esri Shapefiles (SHP and siblings) are listed under Geospatial / GIS above.' },
  { label: 'Disk images',     exts: 'ISO IMG VHD VHDX VMDK QCOW2 VDI', tags: 'virtual machine disk image hyper-v vmware virtualbox qemu boot partition table mbr gpt fat16 fat32 ntfs exfat volume sd card usb raw dd clone', desc: 'Identify disk and virtual-machine images: ISO, VHD/VHDX (Hyper-V), VMDK (VMware), QCOW2 (QEMU), and VDI (VirtualBox). For raw IMG images it decodes the partition table (MBR/GPT) and the first volume\'s filesystem - FAT16/32, NTFS, exFAT - with label, cluster size, and volume size.' },
  { label: 'Recordings',      exts: 'REC', tags: 'pvr dvr recording video mpeg transport stream topfield humax camera cctv getdataback reclaime recovery session', desc: 'Identify REC files, telling apart PVR/DVR video recordings (MPEG-TS / MPEG program stream) from data-recovery session files (GetDataBack, ReclaiMe) and reading their details.' },
  { label: 'Game engines',    exts: 'UNITYPACKAGE UASSET UMAP GODOT TSCN TRES UProject UPlugin UBulk UFont LocMeta LocRes UShaderBytecode resS MCMeta BK2 Lang LNG', tags: 'unity unreal godot game development asset unreal engine uproject uplugin ubulk bulk data ufont locmeta locres localization localisation ushaderbytecode shader bytecode unity resource stream ress minecraft mcmeta asset metadata bink video bk2 cutscene language strings lang lng', desc: 'Identify game-engine assets: Unity (UNITYPACKAGE, .resS resource streams), Unreal Engine (UASSET, UMAP, .uproject / .uplugin descriptors, .ubulk bulk data, .ufont fonts, .locmeta / .locres localisation, .ushaderbytecode shaders), Godot (TSCN, TRES), Minecraft asset metadata (.mcmeta) and language files (.lang / .lng), and Bink Video 2 (.bk2) cutscenes.' },
  { label: 'Game saves',      exts: 'BEPIS', tags: 'ultrakill save game progress slot bepis hakita money rank cyber grind weapons binaryformatter nrbf dotnet', desc: 'Read ULTRAKILL save files (BEPIS) - decoding the .NET BinaryFormatter stream into your actual progress: money and unlocked weapon variants, furthest level and difficulty reached, per-level ranks, secrets and best kills/style/time, and your Cyber Grind high score (wave, kills, style and time).' },
  { label: 'Valve / Steam',   exts: 'VDF ACF', tags: 'valve steam keyvalues kv source engine appmanifest libraryfolders loginusers config app manifest', desc: 'Parse Valve KeyValues files (VDF) and Steam app manifests (ACF) - appmanifest, libraryfolders, loginusers, and config - surfacing the App ID, name, install dir, size on disk, and the full key tree.' },
  { label: 'Config',          exts: 'TOML INI ENV CONF CFG PROPERTIES Config Info LST INF', tags: 'configuration settings dotenv toml ini config app.config info list lst index windows setup information inf driver install', desc: 'Identify configuration and small text files: TOML, INI, .env, CONF, CFG, Java properties, generic .config, info notes, .lst list/index files, and Windows Setup Information (.inf) driver/install scripts.' },
  { label: 'Electronics, runtime & backups (more)', exts: 'Kicad_Pro Kicad_Prl Kicad_Sch TPS Browser PYD ICU BAK OLD PDSBak', tags: 'kicad eda pcb electronics schematic kicad_pro kicad_prl kicad_sch project local settings s-expression unreal third party software notice tps asp.net browser definition python extension module pyd dll icu international components unicode data backup file bak old proteus design suite pdsbak', desc: 'Identify electronics, runtime and backup files: KiCad projects, local settings and schematics (.kicad_pro / .kicad_prl / .kicad_sch), Unreal third-party software notices (.tps), ASP.NET browser definitions (.browser), Python extension modules (.pyd DLLs), ICU internationalisation data (.icu), Proteus Design Suite backups (.pdsbak) and generic backup copies (.bak / .old).' },
  { label: 'Executables',     exts: 'EXE DLL MSI APK IPA DMG AppImage', tags: 'windows android apple mac macos linux program application installer package apk android package manifest androidmanifest permissions sdk api level versioncode versionname signing signature dex abi arm64 google play', desc: 'Identify and read metadata from programs and installers: Windows (EXE, DLL, MSI), Android (APK), iOS (IPA), macOS (DMG), and Linux (AppImage). For Android APKs it decodes the binary AndroidManifest.xml - package name, version, min/target SDK, the full permission and feature list, launcher activity, signing scheme (v1/v2/v3) and the native-code ABIs.' },
  { label: 'Video editing',   exts: 'AEPX WFP WSP', tags: 'adobe after effects motion graphics wondershare filmora capcut bytedance video editing timeline sequence compositing vfx ndi draft_content.json', desc: 'Identify and read video-editing project files: the After Effects XML project (AEPX); Wondershare Filmora (WFP, WSP); and CapCut drafts (draft_content.json) - canvas resolution, duration, tracks and material counts. After Effects (AEP, AET), Premiere Pro (PRPROJ, PREL), DaVinci Resolve (DRP, DRT) and VEGAS Pro (VEG, VF) projects now open in full viewers - see those entries.' },
  { label: 'Surround audio',  exts: 'EC3 EAC3 THD MLP Atmos', tags: 'dolby digital plus eac3 truehd atmos surround 5.1 7.1 meridian lossless object audio home theatre', desc: 'Identify Dolby surround codecs - Digital Plus (E-AC-3), TrueHD, MLP, and Atmos - with channel-layout detection (5.1, 7.1).' },
  { label: 'Certificates',    exts: 'CRT CER PEM DER', tags: 'x509 certificate ssl tls https security openssl public key private rsa ec', desc: 'Identify and decode X.509 security certificates (CRT, CER, PEM, DER) - subject, issuer, validity dates, and key details.' },
  { label: 'Engineering',     exts: 'CDP', tags: 'cdp4 comet data platform esa engineering systems concurrent design criterium decisionplus infoharvest decision analysis ahp smart', desc: 'Identify CDP files - either CDP4 (COMET) concurrent-design models from the ESA systems-engineering toolset, or Criterium DecisionPlus decision-analysis models.' },
  { label: 'Logs',            exts: 'LOG', tags: 'log file server apache nginx syslog error debug', desc: 'Identify log files and their origin - Apache, Nginx, syslog, Python, Java/Log4j, and Android logcat.' },
  { label: 'Camera catalog',  exts: 'CTG', tags: 'canon dcim catalog index database camera memory card ixus powershot thumbnail eos digital ic', desc: 'Identify and decode Canon camera catalog files (CTG) - the DCIM index a Canon camera keeps to track each folder: the catalogued folder path, folder number, recorded-shot count, and photo / movie / voice-memo entry counts. Holds no image data.' },
  { label: 'Shortcuts',       exts: 'LNK URL WEBLOC', tags: 'windows shortcut link lnk target arguments working directory internet shortcut url web macos webloc alias launcher pointer desktop', desc: 'Decode shortcut files: Windows shortcuts (LNK) - target path, arguments, working directory, icon, hotkey, window state, and target timestamp - plus internet shortcuts (URL) and macOS web shortcuts (WEBLOC), surfacing the URL or path they point to.' },
  { label: 'Other',           exts: 'TORRENT PART CRDOWNLOAD', tags: 'bittorrent peer to peer p2p download partial incomplete chrome firefox crdownload', desc: 'Identify BitTorrent files (TORRENT) and their file list, plus partial or incomplete downloads (PART, CRDOWNLOAD).' },
  { label: 'Niche / rare formats', exts: 'ABC AFL ARX BIE Binwalk CGR COMask DIO FLS FWS H2V OFS PF RPP-bak RTX STY CLS SUN TP TSJ VDA', tags: 'niche rare uncommon obscure long tail alembic abc 3d cache afl adobe flash arx arriraw camera raw bie jbig codestream binwalk firmware dump cgr catia graphics comask capture one mask draw.io dio diagram fls fws faro scan point cloud h2v mpeg-2 stream ofs optimfrog dualstream pf windows prefetch rpp-bak reaper backup rtx rtttl ringtone sty cls latex style class sun raster tp pvr dvb recording tsj tiled tileset vda truevision tga', desc: 'A catch-all for rare and niche formats Analyser still identifies from their bytes: 3D caches and scans (Alembic ABC, FARO FLS/FWS), camera and design data (ARRIRAW ARX, Capture One masks, CATIA CGR), JBIG codestreams, firmware dumps (Binwalk), draw.io diagrams, OptimFROG DualStream audio, RTTTL ringtones, LaTeX style and class files, Sun Raster and Truevision TGA images, MPEG-2 streams, PVR/DVB recordings, Tiled tilesets, Windows Prefetch and Reaper project backups.' },
];

// Whole identification catalog (Core + Extended), for formatCount() and search.
export const IDENTIFICATION = [...IDENTIFICATION_CORE, ...IDENTIFICATION_EXTENDED];

// ---------- categories (display grouping) ----------
// The overlay + about list group formats by domain category instead of by the
// old depth tiers. Each catalog row's `label` maps to one category via CAT_OF;
// the depth (viewer vs identification) becomes a per-row badge derived from which
// array the row lives in. CATEGORIES is the display order and the chip labels.
export const CATEGORIES = [
  { key: 'images',    label: 'Images' },
  { key: 'audio',     label: 'Audio' },
  { key: 'video',     label: 'Video' },
  { key: 'design',    label: 'Design' },
  { key: 'documents', label: 'Documents & e-books' },
  { key: 'data',      label: 'Data & code' },
  { key: 'threed',    label: '3D / CAD / engineering' },
  { key: 'archives',  label: 'Archives' },
  { key: 'maps',      label: 'Maps & GIS' },
  { key: 'games',     label: 'Games' },
  { key: 'security',  label: 'Email & security' },
  { key: 'system',    label: 'System & disk' },
];

// label -> category key. Every catalog row label must appear here (verified at
// load by an assertion in dev; unmapped rows fall back to 'system').
const CAT_OF = {
  // Images
  'Photo': 'images', 'RAW photo': 'images', 'Images (more)': 'images', 'RAW sidecars / cinema': 'images',
  // Design
  'Adobe': 'design', 'Design': 'design', 'Raster art': 'design', 'Photoshop': 'design', 'Illustrator': 'design',
  'After Effects': 'video',
  'Premiere Pro': 'video',
  'DaVinci Resolve': 'video',
  'VEGAS Pro': 'video',
  'Gyro log': 'video',
  'Unity': 'games',
  'Visual Studio solution': 'data',
  // Audio
  'Sound': 'audio', 'Audio (more)': 'audio', 'Surround audio': 'audio',
  'Music production': 'audio', 'MIDI': 'audio', 'Lyrics': 'audio',
  // Video
  'Video': 'video', 'Video / streaming (more)': 'video', 'Video editing': 'video',
  'Editing timeline': 'video', 'Subtitles': 'video', 'Colour LUT': 'video',
  // Documents & e-books
  'PDF': 'documents', 'Office docs': 'documents', 'Text & markup': 'documents', 'Apple iWork': 'documents',
  'Documents / e-books (more)': 'documents', 'Fonts': 'documents', 'Fonts (more)': 'documents',
  'DjVu': 'documents', 'Kindle e-book': 'documents',
  // Data & code
  'Data': 'data', 'Web / code': 'data', 'Developer / data': 'data', 'Git objects': 'data',
  'Databases': 'data', 'Config': 'data', 'Logs': 'data', 'Notebooks & data': 'data', 'Access database': 'data',
  'Diagrams': 'threed', 'Text art': 'system',
  // 3D / CAD / engineering
  '3D model': 'threed', '3D / printing': 'threed', 'CAD': 'threed', 'Altium (EDA)': 'threed', 'KiCad (EDA)': 'threed', 'IPC netlist (EDA)': 'threed',
  'CAD exchange': 'threed', '3D / CAD / point clouds (more)': 'threed',
  'Engineering': 'threed', 'G-code': 'threed',
  'Science / medical / engineering': 'threed',
  // Archives
  'Archives': 'archives', 'Archives (packages)': 'archives',
  // Maps & GIS
  'Map data': 'maps', 'GIS / mapping': 'maps', 'Geospatial / GIS': 'maps',
  // Games
  'Game ROMs / assets': 'games', 'Game engines': 'games', 'Game saves': 'games',
  'Valve / Steam': 'games', 'REDengine (Cyberpunk 2077)': 'games', 'Source 2 (Valve)': 'games',
  'Unity / IL2CPP': 'games', 'Marathon (Aleph One)': 'games',
  // Email & security
  'Calendar / contacts': 'security', 'Security / keys / certs': 'security',
  'Certificates': 'security', 'Email': 'security',
  // System & disk
  'Disk images': 'system', 'Disk images / firmware': 'system', 'Executables': 'system',
  'System / misc': 'system', 'Shortcuts': 'system', 'Recordings': 'system',
  'Camera catalog': 'system', 'Other': 'system', 'Niche / rare formats': 'system',
  // Domain "(more)" overflow rows - mapped to their real category so they group
  // with their family in the overlay / about list / formats hub, not under System.
  'Documents / publishing (more)': 'documents', 'Developer / data (more)': 'data',
  'Source code & build files': 'data', 'Electronics, runtime & backups (more)': 'data',
  'Native code, ML & misc (more)': 'data',
  'Archives (more)': 'archives', 'GIS / mapping (more)': 'maps', 'Game assets (more)': 'games',
  'Email / contacts (more)': 'security', 'Security / forensics (more)': 'security',
  '3D / CAD (more)': 'threed', 'Science / engineering (more)': 'threed',
  'Disk images / firmware (more)': 'system',
};

// Every catalog row tagged with its depth ('full' = viewer + deep metadata, 'id'
// = identified + header metadata) and category key. Depth comes from which array
// the row lives in (so the two same-named 'Archives' rows keep distinct depths).
function allRows() {
  const tagged = [
    ...FULL_ANALYSIS.map((r) => ({ r, depth: 'full' })),
    ...IDENTIFICATION_CORE.map((r) => ({ r, depth: 'id' })),
    ...IDENTIFICATION_EXTENDED.map((r) => ({ r, depth: 'id' })),
  ];
  return tagged.map(({ r, depth }) => ({ ...r, depth, cat: CAT_OF[r.label] || 'system' }));
}

// Distinct extension count per category key - used for chip labels and the count
// line. Each distinct ext is counted once, in the FIRST category it appears in
// (catalog order: full rows, then id), so the per-category counts partition the
// catalog and SUM to formatCount(). A few exts legitimately belong to two
// categories (.ts video/code, .nsf audio/Notes, .mat Unity/MATLAB) and still
// SHOW under both in the overlay, but are counted only under their primary one -
// otherwise the category numbers would over-count the distinct total.
export function categoryCounts() {
  const sets = {};
  const seen = new Set();
  for (const r of allRows()) {
    const set = sets[r.cat] || (sets[r.cat] = new Set());
    for (const t of r.exts.split(/\s+/)) {
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      set.add(k);
    }
  }
  const out = {};
  for (const k in sets) out[k] = sets[k].size;
  return out;
}

// ---------- count helper ----------

// Total number of distinct extension tokens across the whole catalog. Used for
// the "N supported formats" affordance in the UI. Tokens are compared
// lower-cased so e.g. "JPG" and "jpg" count once.
export function formatCount() {
  const seen = new Set();
  for (const r of [...FULL_ANALYSIS, ...IDENTIFICATION]) {
    for (const t of r.exts.split(/\s+/)) {
      if (t) seen.add(t.toLowerCase());
    }
  }
  return seen.size;
}

// ---------- renderers ----------

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Lowercased exts that appear in at least one full-analysis row. Full pages win
// cross-depth collisions, so this decides whether an extension links to its
// viewer page /formats/<ext> or its identification page /formats/id/<ext> - the
// same full-wins rule tools/prerender-format-pages.mjs uses, so the popup/about
// links can never point at a page that was not generated.
let _fullExtSet = null;
function fullExtSet() {
  if (_fullExtSet) return _fullExtSet;
  _fullExtSet = new Set();
  for (const r of FULL_ANALYSIS) for (const t of r.exts.split(/\s+/)) if (t) _fullExtSet.add(t.toLowerCase());
  return _fullExtSet;
}
export function formatPageHref(ext) {
  const k = ext.toLowerCase();
  return fullExtSet().has(k) ? `/formats/${k}` : `/formats/id/${k}`;
}

// Whether the extension is in the catalog at all - i.e. whether a /formats
// landing page exists for it (the generator writes one per catalog extension).
// Guards callers from linking formatPageHref() of an uncatalogued extension,
// which would 404.
let _allExtSet = null;
export function hasFormatPage(ext) {
  if (!_allExtSet) {
    _allExtSet = new Set();
    for (const r of [...FULL_ANALYSIS, ...IDENTIFICATION]) {
      for (const t of r.exts.split(/\s+/)) if (t) _allExtSet.add(t.toLowerCase());
    }
  }
  return _allExtSet.has((ext || '').toLowerCase());
}

// Shared collapsible row used by BOTH the overlay (#fmtBody) and the about page
// (#aboutFormats). Each format is a native <details class="fmt-item"> whose
// <summary> shows the label + extension list and whose body reveals the
// keyword-rich description on click.
//
//   opts.anchors - when true (about page) put id="fmt-<slug>" on the <details>
//                  and id="ext-<ext>" on each extension span so #fmt-… / #ext-…
//                  deep-links resolve and the desc text stays indexable in the
//                  DOM even while collapsed.
function fmtItem(r, opts = {}) {
  const extNodes = [];
  r.exts.split(/\s+/).forEach((t) => {
    if (!t) return;
    if (extNodes.length) extNodes.push(' ');
    // Each extension links to its own /formats/<ext> landing page. navigate.js
    // intercepts the click for an SPA hop (and suppresses the parent <details>
    // toggle); the id="ext-<ext>" deep-link anchor is preserved on the about page.
    const attrs = { class: 'fmt-item-ext', href: formatPageHref(t) };
    if (opts.anchors) attrs.id = 'ext-' + t.toLowerCase();
    extNodes.push(el('a', attrs, t));
  });
  // Depth badge: FULL = opens in a viewer with deep metadata; ID = identified +
  // header metadata only. Sits at the right of the summary, before the +/- glyph.
  const isFull = r.depth === 'full';
  const badge = el('span', {
    class: 'fmt-item-badge ' + (isFull ? 'is-full' : 'is-id'),
    title: isFull ? 'Opens in a viewer with deep metadata' : 'Identified + header metadata',
  }, isFull ? 'Full' : 'ID');
  const summary = el('summary', { class: 'fmt-item-summary' }, [
    el('div', { class: 'fmt-item-head' }, [
      el('span', { class: 'fmt-item-label' }, r.label),
      el('span', { class: 'fmt-item-exts' }, extNodes),
    ]),
    badge,
  ]);
  const detailsAttrs = { class: 'fmt-item', 'data-tags': r.tags || '', 'data-cat': r.cat || '' };
  if (opts.anchors) detailsAttrs.id = 'fmt-' + slugify(r.label);
  return el('details', detailsAttrs, [
    summary,
    el('div', { class: 'fmt-item-desc' }, r.desc || '')
  ]);
}

// Render the catalog grouped by domain category into a container. Each category
// is a heading (with its extension count) followed by its rows; every <details>
// carries data-cat so the overlay's chip filter can show/hide whole categories.
function renderFmtItems(container, opts) {
  container.innerHTML = '';
  const rows = allRows();
  const counts = categoryCounts();
  for (const c of CATEGORIES) {
    const catRows = rows.filter((r) => r.cat === c.key);
    if (!catRows.length) continue;
    const head = el('p', { class: 'fmt-section-label', 'data-cat-head': c.key }, c.label);
    head.appendChild(el('span', { class: 'fmt-section-note' }, (counts[c.key] || 0) + ' formats'));
    container.appendChild(head);
    const list = el('div', { class: 'fmt-list', 'data-cat-list': c.key });
    for (const r of catRows) list.appendChild(fmtItem(r, opts));
    container.appendChild(list);
  }
}

// Format help overlay on index.html / about.html. Each format is a collapsible
// dropdown; the description is hidden until the user opens it. Items carry
// data-tags so the search box in app.js can filter them.
export function renderFmtOverlay(container) {
  if (!container) return;
  renderFmtItems(container, { anchors: false });
}

// "All supported file types" list on about.html. Same collapsible look, but
// each item keeps id="fmt-<slug>" and each extension keeps id="ext-<ext>", and
// the description text stays in the DOM (inside the collapsed body) so SEO and
// #fmt-… / #ext-… deep-links keep working.
export function renderAboutFormats(container) {
  if (!container) return;
  renderFmtItems(container, { anchors: true });
}

// Pure (DOM-free) view of the catalog, grouped exactly like renderFmtItems():
// the standalone /formats page is prerendered to static HTML from this by
// tools/prerender-formats.mjs (run in save.bat). Keeping it here means the
// static page, the overlay and the about list all derive from one source, so
// they can never drift. Each row mirrors the data fmtItem() consumes.
export function catalogGrouped() {
  const rows = allRows();
  const counts = categoryCounts();
  const out = [];
  for (const c of CATEGORIES) {
    const catRows = rows.filter((r) => r.cat === c.key);
    if (!catRows.length) continue;
    out.push({
      key: c.key,
      label: c.label,
      count: counts[c.key] || 0,
      rows: catRows.map((r) => ({
        label: r.label,
        slug: slugify(r.label),
        exts: r.exts.split(/\s+/).filter(Boolean),
        desc: r.desc || '',
        tags: r.tags || '',
        depth: r.depth, // 'full' = viewer + deep metadata, 'id' = identified
      })),
    });
  }
  return out;
}
