/* Per-extension copy for the /format/<ext> landing pages.
   ============================================================================
   WHY THIS FILE EXISTS
   The catalog (assets/js/core/formats.js) describes formats one ROW at a time,
   so every sibling extension in a row shares one `desc` (JPG, PNG and GIF all
   sit in the "Photo" row). That is fine for the overlay and the /formats hub,
   but a per-extension landing page needs something UNIQUE to say about each
   extension or the pages read as thin/duplicate content. This map supplies that
   unique line.

   WHO USES IT
   tools/prerender-format-pages.mjs merges this with the catalog: `blurb` becomes
   the page's opening "what is a .X file" sentence; the catalog `desc` supplies
   the "what Analyser does with it" part.

   UPKEEP  (see CLAUDE.md -> "Per-format landing pages")
   - Pages are generated ONLY for extensions whose catalog row has depth 'full'
     (a real viewer / deep analysis), i.e. "more than basic identification".
   - When you add such an extension to formats.js, add a matching entry here
     keyed by the LOWERCASE extension. The generator warns (and falls back to a
     generic line) for any full-analysis extension missing here, so a save.bat
     run will tell you what to fill in.
   - `name`: a short human name shown in the title, e.g. 'JPEG image'.
   - `blurb`: one or two plain sentences - what the format is and where it comes
     from. Keep the house style: British spelling, no em-dashes.
   ============================================================================ */
export const EXT_PAGES = {
  // ---- Photos ----
  jpg:  { name: 'JPEG image', blurb: 'JPEG is the most widely used photo format, using lossy compression to keep files small. It is the default for most cameras, phones and the web.' },
  jpeg: { name: 'JPEG image', blurb: 'JPEG is the most widely used photo format, using lossy compression to keep files small. It is the default for most cameras, phones and the web.' },
  jif:  { name: 'JPEG image (JIF)', blurb: 'JIF is the original JPEG File Interchange name - an early variant of the JPEG image format, now usually seen as .jpg or .jfif.' },
  jfif: { name: 'JPEG image (JFIF)', blurb: 'JFIF (JPEG File Interchange Format) is a standard JPEG image variant, functionally the same as a .jpg file.' },
  png:  { name: 'PNG image', blurb: 'PNG is a lossless image format with full alpha transparency, ideal for graphics, screenshots and logos.' },
  gif:  { name: 'GIF image', blurb: 'GIF is an 8-bit (256-colour) image format best known for short looping animations.' },
  webp: { name: 'WebP image', blurb: 'WebP is a modern Google image format offering both lossy and lossless compression, smaller than JPEG or PNG at similar quality.' },
  heic: { name: 'HEIC photo', blurb: 'HEIC (HEIF) is Apple’s high-efficiency image format used by iPhones, storing photos at higher quality and about half the size of JPEG.' },
  heif: { name: 'HEIF photo', blurb: 'HEIF is the high-efficiency image format behind Apple’s HEIC, storing photos at higher quality and smaller size than JPEG.' },
  bmp:  { name: 'Bitmap image', blurb: 'BMP is an uncompressed Windows bitmap image format - large but simple.' },
  tiff: { name: 'TIFF image', blurb: 'TIFF is a high-quality, often lossless image format used in photography, scanning and publishing.' },
  avif: { name: 'AVIF image', blurb: 'AVIF is a next-generation image format based on the AV1 video codec, with excellent compression and HDR support.' },
  jxl:  { name: 'JPEG XL image', blurb: 'JPEG XL (JXL) is a modern image format offering high compression, lossless JPEG recompression and HDR.' },
  ico:  { name: 'Windows icon', blurb: 'ICO is the Windows icon format, storing one or more small images at several sizes for app icons and favicons.' },
  raw:  { name: 'Camera RAW', blurb: 'RAW refers to unprocessed camera sensor data; the generic .raw extension covers several manufacturers’ raw photo files.' },
  arw:  { name: 'Sony RAW', blurb: 'ARW is Sony’s camera RAW format, holding unprocessed sensor data from Sony Alpha cameras.' },
  cr2:  { name: 'Canon RAW (CR2)', blurb: 'CR2 is Canon’s older camera RAW format (Canon Raw v2), used by most Canon DSLRs.' },
  cr3:  { name: 'Canon RAW (CR3)', blurb: 'CR3 is Canon’s newer camera RAW format, used by recent EOS cameras.' },
  nef:  { name: 'Nikon RAW', blurb: 'NEF is Nikon’s camera RAW format (Nikon Electronic Format), holding unprocessed sensor data.' },
  dng:  { name: 'Digital Negative', blurb: 'DNG (Digital Negative) is Adobe’s open, manufacturer-independent camera RAW format.' },
  raf:  { name: 'Fujifilm RAW', blurb: 'RAF is Fujifilm’s camera RAW format.' },
  rw2:  { name: 'Panasonic RAW', blurb: 'RW2 is Panasonic’s camera RAW format, used by Lumix cameras.' },
  orf:  { name: 'Olympus RAW', blurb: 'ORF is Olympus’s camera RAW format.' },
  pef:  { name: 'Pentax RAW', blurb: 'PEF is Pentax’s camera RAW format (Pentax Electronic Format).' },
  sr2:  { name: 'Sony RAW (SR2)', blurb: 'SR2 is an older Sony camera RAW format.' },
  srw:  { name: 'Samsung RAW', blurb: 'SRW is Samsung’s camera RAW format.' },
  x3f:  { name: 'Sigma RAW', blurb: 'X3F is Sigma’s camera RAW format, produced by its Foveon X3 sensors.' },
  '3fr':{ name: 'Hasselblad RAW', blurb: '3FR is Hasselblad’s camera RAW format.' },
  iiq:  { name: 'Phase One RAW', blurb: 'IIQ is Phase One’s medium-format camera RAW format (Intelligent Image Quality).' },
  mrw:  { name: 'Minolta RAW', blurb: 'MRW is Minolta’s camera RAW format.' },
  nrw:  { name: 'Nikon RAW (NRW)', blurb: 'NRW is a Nikon camera RAW format used by some Coolpix compacts.' },
  rwl:  { name: 'Leica RAW', blurb: 'RWL is Leica’s camera RAW format.' },
  crw:  { name: 'Canon RAW (CRW)', blurb: 'CRW is Canon’s original camera RAW format, predating CR2.' },
  gpr:  { name: 'GoPro RAW', blurb: 'GPR is GoPro’s camera RAW format, based on Adobe DNG.' },
  fff:  { name: 'Hasselblad RAW (FFF)', blurb: 'FFF is the Hasselblad and Imacon camera RAW format.' },
  mef:  { name: 'Mamiya RAW', blurb: 'MEF is Mamiya’s camera RAW format.' },
  mos:  { name: 'Leaf RAW', blurb: 'MOS is Leaf’s medium-format camera RAW format.' },
  kdc:  { name: 'Kodak RAW (KDC)', blurb: 'KDC is a Kodak camera RAW format.' },
  dcr:  { name: 'Kodak RAW (DCR)', blurb: 'DCR is a Kodak camera RAW format.' },
  dcs:  { name: 'Kodak RAW (DCS)', blurb: 'DCS is Kodak’s professional camera RAW format.' },
  erf:  { name: 'Epson RAW', blurb: 'ERF is Epson’s camera RAW format.' },
  srf:  { name: 'Sony RAW (SRF)', blurb: 'SRF is an older Sony camera RAW format.' },
  thm:  { name: 'Camera thumbnail', blurb: 'THM is a small JPEG thumbnail that cameras save alongside videos or RAW photos.' },

  // ---- Sound ----
  mp3:  { name: 'MP3 audio', blurb: 'MP3 is the most common lossy audio format, compressing music to small files with near-universal device support.' },
  wav:  { name: 'WAV audio', blurb: 'WAV is an uncompressed, lossless audio format common in recording and editing.' },
  m4a:  { name: 'M4A audio', blurb: 'M4A is an MP4-based audio file, usually holding AAC (or ALAC lossless) audio - used by Apple Music and iTunes.' },
  m4b:  { name: 'M4B audiobook', blurb: 'M4B is an MP4-based audiobook format that supports chapters and bookmarks.' },
  aac:  { name: 'AAC audio', blurb: 'AAC is a lossy audio format that succeeded MP3, offering better quality at the same bitrate.' },
  flac: { name: 'FLAC audio', blurb: 'FLAC is a popular lossless audio format that compresses without losing any quality.' },
  ogg:  { name: 'Ogg audio', blurb: 'OGG is an open audio container, usually holding Vorbis or Opus audio.' },
  opus: { name: 'Opus audio', blurb: 'Opus is a modern, highly efficient lossy audio codec used for streaming and voice.' },
  aiff: { name: 'AIFF audio', blurb: 'AIFF is Apple’s uncompressed, lossless audio format, similar to WAV.' },
  wma:  { name: 'Windows Media Audio', blurb: 'WMA is Microsoft’s Windows Media Audio format.' },
  amr:  { name: 'AMR audio', blurb: 'AMR is a speech-optimised audio format used for voice recordings on phones.' },
  ac3:  { name: 'Dolby Digital (AC-3)', blurb: 'AC-3 (Dolby Digital) is a surround-sound audio format used on DVDs and in broadcast.' },
  dts:  { name: 'DTS audio', blurb: 'DTS is a surround-sound audio format used in films and on Blu-ray.' },
  mka:  { name: 'Matroska audio', blurb: 'MKA is the Matroska audio container, the audio-only counterpart of MKV.' },

  // ---- Lyrics ----
  lrc:  { name: 'Synced lyrics', blurb: 'LRC is a synchronised lyrics format that time-stamps each line to a song for karaoke-style display.' },

  // ---- MIDI ----
  mid:  { name: 'MIDI sequence', blurb: 'MIDI stores musical note and instrument instructions rather than recorded audio, so any synthesiser can play it back.' },
  midi: { name: 'MIDI sequence', blurb: 'MIDI stores musical note and instrument instructions rather than recorded audio, so any synthesiser can play it back.' },

  // ---- Video ----
  mp4:  { name: 'MP4 video', blurb: 'MP4 is the most common video container, widely supported and usually holding H.264 video with AAC audio.' },
  mov:  { name: 'QuickTime video', blurb: 'MOV is Apple’s QuickTime video container, common from iPhones and Macs.' },
  avi:  { name: 'AVI video', blurb: 'AVI is a classic Microsoft video container.' },
  mkv:  { name: 'Matroska video', blurb: 'MKV (Matroska) is a flexible open video container that can hold many video, audio and subtitle tracks.' },
  webm: { name: 'WebM video', blurb: 'WebM is an open, royalty-free video format designed for the web, using VP8, VP9 or AV1.' },
  wmv:  { name: 'Windows Media Video', blurb: 'WMV is Microsoft’s Windows Media Video format.' },
  flv:  { name: 'Flash video', blurb: 'FLV is the Flash Video container, once the standard for web video.' },
  '3gp':{ name: '3GP mobile video', blurb: '3GP is a mobile video container used by older phones.' },
  '3g2':{ name: '3G2 mobile video', blurb: '3G2 is a mobile video container used on CDMA phones, related to 3GP.' },
  mpg:  { name: 'MPEG video', blurb: 'MPG (MPEG) is an early standard video format using MPEG-1/2 compression.' },
  mpeg: { name: 'MPEG video', blurb: 'MPEG is an early standard video format using MPEG-1/2 compression.' },
  mts:  { name: 'AVCHD video', blurb: 'MTS is the AVCHD video format used by camcorders, holding H.264 video.' },
  m2ts: { name: 'AVCHD video (M2TS)', blurb: 'M2TS is the AVCHD/Blu-ray transport-stream video format used by camcorders.' },
  ts:   { name: 'Transport stream / TypeScript', blurb: 'TS has two unrelated uses: an MPEG-2 transport-stream video file (broadcast and recordings), and TypeScript source code. Analyser tells them apart by their contents.' },
  vob:  { name: 'DVD video', blurb: 'VOB is the video format used on DVD-Video discs.' },
  ogv:  { name: 'Ogg video', blurb: 'OGV is the Ogg video format, an open container usually holding Theora video.' },
  h264: { name: 'H.264 stream', blurb: 'H.264 (AVC) is the most widely used video codec; a raw .h264 file is an unwrapped elementary stream.' },
  '264':{ name: 'H.264 stream', blurb: 'A .264 file is a raw H.264 (AVC) video elementary stream, without a container.' },
  avc:  { name: 'H.264 / AVC stream', blurb: 'AVC is another name for the H.264 video codec; a raw .avc file is an unwrapped elementary stream.' },
  h265: { name: 'H.265 stream', blurb: 'H.265 (HEVC) is a high-efficiency video codec; a raw .h265 file is an unwrapped elementary stream.' },
  '265':{ name: 'H.265 stream', blurb: 'A .265 file is a raw H.265 (HEVC) video elementary stream, without a container.' },
  hevc: { name: 'HEVC stream', blurb: 'HEVC is another name for the H.265 video codec; a raw .hevc file is an unwrapped elementary stream.' },

  // ---- Editing timelines ----
  edl:    { name: 'Edit Decision List', blurb: 'EDL (Edit Decision List) is a plain-text video-editing format listing cuts and timecodes.' },
  fcpxml: { name: 'Final Cut Pro XML', blurb: 'FCPXML is Apple’s Final Cut Pro project interchange format - an XML description of an edit.' },
  otio:   { name: 'OpenTimelineIO', blurb: 'OTIO (OpenTimelineIO) is an open editing-timeline interchange format used across film and VFX tools.' },

  // ---- Subtitles ----
  srt: { name: 'SubRip subtitles', blurb: 'SRT (SubRip) is the most common subtitle format - a simple text file of timed captions.' },
  vtt: { name: 'WebVTT subtitles', blurb: 'WebVTT (VTT) is the web-standard subtitle format used by HTML5 video.' },
  ass: { name: 'ASS subtitles', blurb: 'ASS (Advanced SubStation Alpha) is a styled subtitle format supporting fonts, colours and positioning.' },
  ssa: { name: 'SSA subtitles', blurb: 'SSA (SubStation Alpha) is a styled subtitle format, the predecessor of ASS.' },

  // ---- Documents ----
  pdf:  { name: 'PDF document', blurb: 'PDF (Portable Document Format) is a fixed-layout document format for sharing and printing.' },
  docx: { name: 'Word document', blurb: 'DOCX is the modern Microsoft Word document format, stored as a zipped XML package.' },
  xlsx: { name: 'Excel spreadsheet', blurb: 'XLSX is the modern Microsoft Excel spreadsheet format, stored as a zipped XML package.' },
  pptx: { name: 'PowerPoint presentation', blurb: 'PPTX is the modern Microsoft PowerPoint presentation format, stored as a zipped XML package.' },
  epub: { name: 'EPUB ebook', blurb: 'EPUB is the open ebook format used by most readers - a zipped package of HTML and assets.' },

  // ---- Data ----
  csv:  { name: 'CSV table', blurb: 'CSV is a plain-text table format storing rows of comma-separated values.' },
  tsv:  { name: 'TSV table', blurb: 'TSV is a plain-text table format storing tab-separated values.' },
  svg:  { name: 'SVG vector image', blurb: 'SVG is an XML-based vector image format that scales to any size without losing quality.' },

  // ---- Web / code ----
  html: { name: 'HTML page', blurb: 'HTML is the markup language of web pages.' },
  css:  { name: 'CSS stylesheet', blurb: 'CSS is the stylesheet language that controls the look of web pages.' },
  js:   { name: 'JavaScript', blurb: 'JavaScript (JS) is the programming language of the web.' },
  tsx:  { name: 'TypeScript + JSX', blurb: 'TSX is a TypeScript source file containing JSX/React markup.' },
  jsx:  { name: 'JavaScript + JSX', blurb: 'JSX is a JavaScript source file containing React markup.' },
  json: { name: 'JSON data', blurb: 'JSON is a lightweight, human-readable data-interchange format.' },
  yaml: { name: 'YAML data', blurb: 'YAML is a human-readable data format often used for configuration files.' },
  xml:  { name: 'XML data', blurb: 'XML is a flexible markup language for structured data.' },
  md:   { name: 'Markdown', blurb: 'Markdown (MD) is a lightweight plain-text formatting syntax that renders to HTML.' },

  // ---- 3D models ----
  stl:  { name: 'STL 3D model', blurb: 'STL is the most common 3D-printing mesh format, storing a model’s surface as triangles.' },
  obj:  { name: 'OBJ 3D model', blurb: 'OBJ is a widely supported 3D model format storing geometry, and optionally materials and texture coordinates.' },
  ply:  { name: 'PLY 3D model', blurb: 'PLY (Polygon File Format) stores 3D meshes and point clouds, often with per-vertex colour.' },
  off:  { name: 'OFF 3D model', blurb: 'OFF (Object File Format) is a simple 3D mesh format storing polygons.' },
  step: { name: 'STEP CAD model', blurb: 'STEP is a standard CAD exchange format for precise 3D solid models, used across engineering tools.' },
  stp:  { name: 'STEP CAD model', blurb: 'STP is the same standard CAD exchange format as STEP, for precise 3D solid models.' },
  iges: { name: 'IGES CAD model', blurb: 'IGES is an older standard CAD exchange format for 3D models and surfaces.' },
  igs:  { name: 'IGES CAD model', blurb: 'IGS is the same older CAD exchange format as IGES, for 3D models and surfaces.' },
  brep: { name: 'BREP CAD solid', blurb: 'BREP is a boundary-representation CAD format describing exact solid geometry (OpenCASCADE).' },
  '3mf':{ name: '3MF 3D print', blurb: '3MF is a modern 3D-printing format - a zipped package that is richer than STL.' },
  amf:  { name: 'AMF 3D print', blurb: 'AMF (Additive Manufacturing Format) is an XML-based 3D-printing format supporting colour and materials.' },

  // ---- Archives ----
  zip:  { name: 'ZIP archive', blurb: 'ZIP is the most common archive format, bundling and compressing multiple files into one.' },

  // ---- Maps ----
  gpx:    { name: 'GPS track (GPX)', blurb: 'GPX is the standard GPS exchange format, storing tracks, routes and waypoints as XML.' },
  kml:    { name: 'Google Earth (KML)', blurb: 'KML is Google’s XML format for geographic data, used by Google Earth and Maps.' },
  geojson:{ name: 'GeoJSON', blurb: 'GeoJSON is a JSON format for geographic features such as points, lines and polygons.' },
};
