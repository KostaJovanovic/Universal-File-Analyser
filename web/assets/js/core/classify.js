/* Analyser - extension/MIME file classification.
   classifyFile(file) maps a dropped file to a ROUTES kind purely from its name
   (extension / basename) and MIME type - no byte sniffing (that is the caller's
   job: resolveKind()/handleFile() in app.js layer content-based reroutes on top).
   The returned string must match a key in ROUTES (app.js). Exposed to the folder
   scan and /compare as window._anrClassify by app.js. */
import { fileExt } from './util.js';
import { PHOTO_EXTS, AUDIO_EXTS, VIDEO_EXTS, CSV_EXTS, SVG_EXTS } from './formats.js';
import { isProprietaryExt } from '../renderers/proprietary.js';
const MARKUP_EXTS = new Set([
    'dita', 'ditamap', 'tei', 'jats', 'nxml', 'rst', 'adoc', 'asciidoc',
    'org', 'textile', 'tex', 'latex', 'ltx', 'sty', 'cls', 'bib',
]);
// Unity serialises its assets as a YAML object stream; these extensions all route
// to the Unity viewer (which falls back to identification if the bytes aren't
// actually Unity YAML - protecting collisions like MATLAB .mat).
const UNITY_EXTS = new Set([
    'unity', 'prefab', 'asset', 'controller', 'overridecontroller', 'anim', 'mat',
    'physicsmaterial2d', 'physicmaterial', 'spriteatlas', 'cubemap', 'rendertexture',
    'mixer', 'guiskin', 'fontsettings', 'flare', 'brush', 'terrainlayer', 'signal',
    'preset', 'mask', 'playable', 'lighting', 'giparams', 'meta',
]);
// G-code from 3D-print slicers and CNC/CAM toolpaths - reconstructed in the
// gcode viewer (extruded moves drawn as the printed shape, or cut moves for CNC).
const GCODE_EXTS = new Set(['gcode', 'gco', 'g', 'ngc', 'nc', 'tap', 'cnc']);
export function classifyFile(file) {
    const t = (file.type || '').toLowerCase();
    const ext = fileExt(file.name);
    // SVG before generic image/ MIME so it gets its own handler
    if (t === 'image/svg+xml' || SVG_EXTS.has(ext))
        return 'svg';
    // NB: the generic image/ · audio/ · video/ MIME shortcuts live further down,
    // just above the PHOTO/AUDIO/VIDEO_EXTS fallbacks - NOT here. A recognised
    // extension with a dedicated renderer must win over the MIME guess: many
    // structured formats carry a misleading vendor image MIME (.tap is served as
    // image/vnd.tencent.tap, .dwg as image/vnd.dwg, .dxf as image/vnd.dxf, .djvu
    // as image/vnd.djvu) or a non-decodable audio MIME (.mid as audio/midi), and
    // checking the MIME first would route a CNC G-code / CAD / MIDI file to the
    // photo or audio renderer, which then fails ("image can't be decoded").
    if (CSV_EXTS.has(ext) || t === 'text/csv' || t === 'text/tab-separated-values')
        return 'csv';
    // Word, Excel, PowerPoint OOXML and their template / macro-enabled / show
    // siblings share the same package, so they reuse the same renderers.
    if (ext === 'docx' || ext === 'docm' || ext === 'dotx' || ext === 'dotm')
        return 'docx';
    if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xltx' || ext === 'xltm')
        return 'xlsx';
    if (ext === 'xlsb')
        return 'xlsb'; // binary BIFF12 - needs the SheetJS path, not the OOXML reader
    if (ext === 'pptx' || ext === 'pptm' || ext === 'ppsx' || ext === 'ppsm' || ext === 'potx' || ext === 'potm')
        return 'pptx';
    if (ext === 'epub')
        return 'epub';
    // Lottie / Bodymovin vector animations: dotLottie (.lottie, a ZIP) and Telegram
    // stickers (.tgs, gzip). Plain-.json Lottie is detected by content in the JSON
    // inspector, which offers to play it (classifyFile can't peek at content here).
    if (ext === 'lottie' || ext === 'tgs')
        return 'lottie';
    // OpenDocument, its template siblings (.ott/.ots/.otp/.otg), the flat
    // single-XML variants (.fodt/.fods/.fodp/.fodg) and legacy StarOffice 1.x
    // (.sxw/.sxc/.sxi/.sxd) all share the OpenDocument content model.
    if (ext === 'odt' || ext === 'ott' || ext === 'fodt' || ext === 'sxw')
        return 'odt';
    if (ext === 'ods' || ext === 'ots' || ext === 'fods' || ext === 'sxc')
        return 'ods';
    if (ext === 'odp' || ext === 'otp' || ext === 'fodp' || ext === 'sxi')
        return 'odp';
    if (ext === 'odg' || ext === 'otg' || ext === 'fodg' || ext === 'sxd')
        return 'odg';
    if (ext === 'doc')
        return 'doc';
    if (ext === 'xls')
        return 'xls';
    if (ext === 'ppt' || ext === 'pps')
        return 'ppt';
    // Text / lightweight-markup documents (textdoc.js).
    if (ext === 'rtf')
        return 'rtf';
    if (ext === 'abw')
        return 'abw';
    if (ext === 'fb2')
        return 'fb2';
    if (ext === 'hwpx')
        return 'hwpx';
    if (ext === 'mht' || ext === 'mhtml')
        return 'mhtml';
    if (MARKUP_EXTS.has(ext))
        return 'markup';
    // `.mod` collides: it is both a tracker/Amiga music module (handled as audio
    // by proprietary.js) and a Go module manifest, which is always named exactly
    // "go.mod". Route the Go file to the text viewer so it is not opened as sound.
    if (ext === 'mod' && file.name.toLowerCase() === 'go.mod')
        return 'markup';
    // Structured data / notebooks / email / diagrams - real viewers for what
    // were identification-only formats.
    if (ext === 'ipynb')
        return 'notebook';
    if (ext === 'har')
        return 'har';
    if (ext === 'json5' || ext === 'jsonc' || ext === 'hjson')
        return 'jsondata';
    if (ext === 'nfo')
        return 'nfo';
    if (ext === 'eml' || ext === 'emlx')
        return 'eml';
    if (ext === 'mbox')
        return 'mbox';
    if (ext === 'drawio')
        return 'drawio';
    if (ext === 'dxf')
        return 'dxf';
    // AutoCAD DWG / template: parse + render to a 2D drawing via libredwg-web.
    if (ext === 'dwg' || ext === 'dwt')
        return 'dwg';
    // Altium Designer schematics + boards (OLE compound files): rebuild the
    // schematic / PCB / footprint geometry as an interactive vector view. The
    // text sidecars (.epw model wrapper, .PrjPcb project, *Preview cache) share
    // the same renderer, which branches on extension.
    if (ext === 'schdoc' || ext === 'schlib' || ext === 'pcbdoc' || ext === 'pcblib')
        return 'altium';
    if (ext === 'epw' || ext === 'prjpcb' || ext === 'prjpcbstructure')
        return 'altium';
    if (ext === 'schdocpreview' || ext === 'pcbdocpreview')
        return 'altium';
    // KiCad documents (S-expression text + JSON sidecars): rebuild the schematic /
    // board / footprint / symbol geometry as an interactive vector view. The
    // extension-less library tables and footprint cache route by exact name.
    if (ext === 'kicad_pcb' || ext === 'kicad_sch' || ext === 'kicad_sym' || ext === 'kicad_mod'
        || ext === 'kicad_pro' || ext === 'kicad_prl' || ext === 'wbk')
        return 'kicad';
    // KiCad writes a "-bak" backup beside each saved document (foo.kicad_sch-bak).
    // Route those to the same viewer; renderKicad strips the -bak suffix.
    if (/\.kicad_(sch|pcb|sym|mod|pro|prl)-bak$/.test((file.name || '').toLowerCase()))
        return 'kicad';
    {
        const lower = (file.name || '').toLowerCase();
        if (lower === 'fp-lib-table' || lower === 'sym-lib-table' || lower === 'fp-info-cache')
            return 'kicad';
    }
    // IPC-D-356(A) bare-board / fabrication test netlist.
    if (ext === 'ipc')
        return 'ipcnet';
    // Adobe After Effects project: walk the RIFX tree to rebuild the comp timelines.
    if (ext === 'aep' || ext === 'aet')
        return 'aep';
    // Adobe Premiere Pro / Elements project: inflate the PremiereData XML and
    // rebuild each sequence's track / clip timeline.
    if (ext === 'prproj' || ext === 'prel')
        return 'premiere';
    // DaVinci Resolve project / timeline: unzip the SeqContainer XML and rebuild
    // each timeline's track / clip layout.
    if (ext === 'drp' || ext === 'drt')
        return 'davinci';
    // Sony / MAGIX VEGAS Pro project: read the RIFF-GUID container's embedded
    // metadata, plugin ids and title text.
    if (ext === 'veg' || ext === 'vf')
        return 'vegas';
    // Unity assets - the engine's YAML object stream (scenes, prefabs, animator
    // controllers, animations, materials, .meta importer records, …).
    if (UNITY_EXTS.has(ext))
        return 'unity';
    // Visual Studio solution manifest (projects + build configs) - classic text
    // .sln and the newer XML .slnx.
    if (ext === 'sln' || ext === 'slnx')
        return 'vssolution';
    // MonoDevelop / Unity user prefs are XML - show them in the markup viewer.
    if (ext === 'userprefs')
        return 'markup';
    // 3MF / OOXML package sidecars (e.g. Bambu / slicer 3MF bundles): the OPC
    // relationship XML (.rels) and the MD5 checksum text (.md5) - shown as source.
    if (ext === 'rels' || ext === 'md5')
        return 'markup';
    // Gyroflow IMU log: plot the gyroscope / accelerometer traces.
    if (ext === 'gcsv')
        return 'gcsv';
    // Apple iWork packages: render the embedded QuickLook preview (PDF or image).
    if (ext === 'pages' || ext === 'numbers' || ext === 'key' || ext === 'keynote')
        return 'iwork';
    if (ext === 'stl')
        return 'stl';
    // 3D models with an interactive WebGL viewer. Native meshes: STL (above), OBJ,
    // PLY, OFF, 3MF, AMF. B-rep CAD via OpenCASCADE: STEP, IGES, BREP.
    if (ext === '3mf' || ext === 'amf' || ext === 'obj' || ext === 'ply' || ext === 'off')
        return 'model3d';
    if (ext === 'mtl')
        return 'model3d';
    if (ext === 'gltf' || ext === 'glb')
        return 'model3d';
    if (ext === 'fbx')
        return 'model3d'; // Autodesk FBX - geometry viewer (binary + ASCII)
    if (ext === 'step' || ext === 'stp' || ext === 'iges' || ext === 'igs' || ext === 'brep')
        return 'model3d';
    // Autodesk Fusion 360 design / archive: a Zstd-compressed ZIP. Read the embedded
    // render preview + document metadata (the BREP geometry itself is proprietary).
    if (ext === 'f3d' || ext === 'f3z')
        return 'f3d';
    // SolidWorks part / assembly / drawing. Older files are OLE2 (preview + metadata
    // readable); modern files are encrypted (identified + an honest note). NOT
    // .sldreg (a registry-export text file - left to proprietary.js / parsers).
    if (ext === 'sldprt' || ext === 'sldasm' || ext === 'slddrw')
        return 'solidworks';
    // G-code: reconstruct the printed object from the extruded toolpath (3D-print
    // slicers) - or render the cutting path (CNC) when there's no extrusion.
    if (GCODE_EXTS.has(ext))
        return 'gcode';
    // Editing timelines (interchange formats): visual track/clip timeline view.
    if (ext === 'edl' || ext === 'fcpxml' || ext === 'otio')
        return 'timeline';
    if (ext === 'lrc')
        return 'lrc';
    // MIDI is a score, not decodable audio - route it before the AUDIO_EXTS check.
    if (ext === 'mid' || ext === 'midi')
        return 'midi';
    // Subtitles + geo files are otherwise identification-only (proprietary.js).
    if (ext === 'srt' || ext === 'vtt' || ext === 'ass' || ext === 'ssa' || ext === 'sub')
        return 'subtitles';
    if (ext === 'gpx' || ext === 'kml' || ext === 'geojson')
        return 'geo';
    // Markdown gets a real rendered view - route it before the proprietary `md`
    // (plain-text) entry would otherwise catch it.
    if (ext === 'md' || ext === 'markdown')
        return 'markdown';
    if (ext === 'cbz' || ext === 'cbr' || ext === 'cbt' || ext === 'cb7')
        return 'comic';
    // Raster painting documents: show the embedded merged-image / preview.
    if (ext === 'kra' || ext === 'procreate' || ext === 'pdn')
        return 'paint';
    // Photoshop: full composite render + layer tree via ag-psd.
    if (ext === 'psd' || ext === 'psb')
        return 'psd';
    // Illustrator: modern .ai is PDF-based, rendered with pdf.js.
    if (ext === 'ai')
        return 'ai';
    // Fonts: live FontFace specimen + opentype.js glyph grid.
    if (ext === 'ttf' || ext === 'otf' || ext === 'woff' || ext === 'woff2' || ext === 'ttc' || ext === 'otc')
        return 'font';
    // DjVu scanned documents: decode + render pages via DjVu.js.
    if (ext === 'djvu' || ext === 'djv')
        return 'djvu';
    // Microsoft Access databases: read tables + rows via mdb-reader.
    if (ext === 'mdb' || ext === 'accdb')
        return 'mdb';
    // Kindle / Mobipocket e-books: decode + read via foliate-js.
    if (ext === 'mobi' || ext === 'azw' || ext === 'azw3')
        return 'mobi';
    // Colour LUT: a .cube look-up table gets a full parser + visualiser. The same
    // extension is also Gaussian's volumetric DFT format, so renderLut sniffs for
    // LUT_*_SIZE and hands a non-LUT .cube back to the generic identifier. A .look
    // is an Adobe SpeedGrade / Iridas grade stack carrying a baked 3D LUT, read by
    // the same renderer (grade stack + the embedded LUT visualised).
    if (ext === 'cube' || ext === 'look')
        return 'lut';
    // XMP develop sidecar: the RAW edit recipe (crs:/Lightroom/darktable) written
    // next to a raw photo. renderXmp parses and visualises the develop settings
    // (tone curve, sliders, HSL, crop) and hands a non-XMP .xmp back to the
    // generic identifier. (Adobe .xmp templates carry the same packet, so they
    // read here too rather than as a bare Adobe identification.)
    if (ext === 'xmp')
        return 'xmp';
    // Raw disk-filesystem images: browsable like a folder/archive. renderDiskImage
    // mounts a FAT12/16/32 volume (bare "superfloppy" or an MBR-partitioned disk)
    // and falls back to identification for non-FAT images (ISO, ext4, NTFS, DMG,
    // firmware blobs), so a .img is never worse off than before.
    if (ext === 'img' || ext === 'ima' || ext === 'dsk')
        return 'diskimage';
    // Generic media MIME fallback - only now that every dedicated-extension route
    // above has had its say (see the note near the top of this function). A file
    // with a standard image/audio/video MIME and no recognised structured
    // extension is handled by its type here.
    if (t.startsWith('image/'))
        return 'photo';
    if (t.startsWith('audio/'))
        return 'audio';
    if (t.startsWith('video/'))
        return 'video';
    if (PHOTO_EXTS.has(ext))
        return 'photo';
    if (AUDIO_EXTS.has(ext))
        return 'audio';
    if (VIDEO_EXTS.has(ext))
        return 'video';
    if (isProprietaryExt(ext))
        return 'proprietary';
    // Licence/marker files whose suffix isn't a real extension (LICENSE.APACHE,
    // COPYING.GPL, LICENSE-MPL-2.0, py.typed, CACHEDIR.TAG) - opened as plain text,
    // exactly like a .txt (the Plain Text view, with its "Open full" reader).
    {
        const bn = (file.name || '').toLowerCase().replace(/^.*[\\/]/, '');
        if (/^(licen[cs]e|copying)([.\-]|$)/.test(bn) || bn === 'py.typed' || bn === 'cachedir.tag')
            return 'plaintext';
    }
    // No extension and nothing else matched: treat it as an "extensionless" file -
    // shown as text (with a hex fallback for binary) rather than flagged "unknown".
    // Most extensionless files in real projects are plain text (LICENSE, Makefile,
    // Dockerfile, shell scripts with no suffix, ...). The magic-sniff and
    // suggestion-popup paths in handleFile still run for this kind, so an
    // extensionless PDF / PNG / git object opens as itself or offers a re-open.
    if (!ext)
        return 'extensionless';
    return 'unknown';
}
//# sourceMappingURL=classify.js.map