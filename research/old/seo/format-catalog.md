# Analyser — Supported-Format Catalog (SEO reference)

Source of truth: `assets/js/core/formats.js` (rows in `FULL_ANALYSIS`,
`IDENTIFICATION_CORE`, `IDENTIFICATION_EXTENDED`; grouping via `CAT_OF` →
`CATEGORIES`). All figures below are computed from that file (verified by running
its exported `formatCount()` / `categoryCounts()`), not hand-counted.

## 1. Totals

| Metric | Count |
| --- | --- |
| Distinct extensions (lower-cased, deduped) — `formatCount()` | **1061** |
| — of which appear in a full-analysis (viewer) row | 249 |
| Catalog rows total | **86** |
| — Full-analysis rows (`FULL_ANALYSIS`) | **36** |
| — Identification rows (`IDENTIFICATION` = CORE + EXTENDED) | **50** |
| &nbsp;&nbsp;&nbsp;&nbsp;• `IDENTIFICATION_CORE` | 24 |
| &nbsp;&nbsp;&nbsp;&nbsp;• `IDENTIFICATION_EXTENDED` | 26 |
| Categories (`CATEGORIES`) | **12** |

Distinct extensions per category (`categoryCounts()`):

| Category | Distinct exts |
| --- | --- |
| System & disk (`system`) | 298 |
| 3D / CAD / engineering (`threed`) | 130 |
| Images (`images`) | 98 |
| Documents & ebooks (`documents`) | 90 |
| Audio (`audio`) | 87 |
| Video (`video`) | 83 |
| Data & code (`data`) | 70 |
| Games (`games`) | 60 |
| Email & security (`security`) | 43 |
| Maps & GIS (`maps`) | 39 |
| Archives (`archives`) | 34 |
| Design (`design`) | 33 |

(Category ext counts sum to more than 1061 because a few extensions appear in
rows mapped to different categories; `formatCount()` dedupes globally.)

---

## 2. By category

Depth: **full** = real viewer / deep analysis; **id** = identified + header
metadata only. `tags` shown are the brand/software search synonyms (the SEO gold).

### Images (`images`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Photo | full | JPG JPEG JIF JFIF PNG GIF WebP HEIC HEIF BMP TIFF AVIF JXL ICO MPO THM | image picture photograph camera apple google pixel samsung iphone screenshot live photo motion photo ultra hdr gain map computational heic heif thm thumbnail movie clip preview icon favicon cursor multi page stereo 3d mpo embedded images | EXIF, GPS, camera settings, histograms, dominant colours, OCR, AI-gen markers; computational-photo wrappers (Apple Live Photo, Google/Samsung Motion Photo, Ultra HDR); extracts embedded images. |
| RAW photo | full | RAW ARW CR2 CR3 NEF DNG RAF RW2 ORF PEF SR2 SRW X3F 3FR IIQ MRW NRW RWL CRW GPR FFF MEF MOS KDC DCR DCS ERF SRF | sony nikon canon fujifilm fuji olympus om system pentax sigma panasonic lumix leica hasselblad phase one mamiya leaf kodak gopro epson minolta x-trans foveon proraw shutter count bayer demosaic | Camera RAW from Sony/Canon/Nikon/Fuji/Sigma/Olympus/etc.; full EXIF + lens, true sensor res, shutter-actuation count, develops RAW or extracts embedded preview. |
| Images (more) | id | TGA QOI PPM PGM PBM PNM PAM PCX FF FARBFELD WBMP XBM XPM RAS SGI BW HDR DDS EXR JP2 J2K JPF JPX JPC JXR WDP HDP EPS PS WMF EMF EMZ ICNS CUR ANI MNG LOTTIE | truevision targa game texture qoi netpbm zsoft paintbrush farbfeld suckless sun raster sgi iris radiance hdr directdraw surface directx bcn dxt bc7 openexr ilm vfx jpeg 2000 openjpeg jpeg xr hd photo ghostscript apple icns lottie bodymovin airbnb coreldraw cdr | Decodes/previews extra still-image formats (TGA, QOI, Netpbm, PCX, farbfeld, Sun Raster, SGI) and reads headers for HDR, DDS, EXR, JPEG 2000/XR, EPS, WMF/EMF, ICNS, MNG, Lottie. |
| RAW sidecars / cinema | id | AAE PP3 COS COF COP DOP NKSC R3D BRAW CRM ARI CINE FPF EIP BAY PXN RWZ | apple photos rawtherapee capture one dxo photolab nikon nx studio redcode r3d blackmagic braw canon cinema raw light crm arriraw phantom cine flir thermal rawzor | RAW edit sidecars (Apple Photos, RawTherapee, Capture One, DxO PhotoLab, Nikon NX) + cinema/rare RAW (REDCODE, Blackmagic, Canon CRM, ARRIRAW, Phantom CINE, FLIR). |

### Audio (`audio`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Sound | full | MP3 WAV M4A M4B AAC FLAC OGG OPUS AIFF WMA AMR AC3 DTS MKA | audio music podcast recording microphone audiobook | Waveform, spectrogram, codec, bitrate, channels, tags of MP3/WAV/FLAC/M4A/AAC/OGG/Opus. |
| Audio (more) | id | APE WV TAK TTA OFR DSF DFF MPC CAF RF64 BW64 W64 AU SND VOC BWF SPX AWB QCP 3GA M4R GSM MP2 MP1 SF2 SF3 SFZ DLS RMI MMF GIG RTTTL IMY SAP MOD XM IT S3M STM MTM MED 669 FAR OKT NSF NSFE SPC VGM VGZ GBS AY YM AUP AUP3 PSF | monkeys audio wavpack tak true audio dsd sacd musepack core audio broadcast wave soundfont sfz gigastudio rtttl nokia ringtone imelody protracker amiga fasttracker impulse tracker octamed nes spc vgm game boy ay zx spectrum ym audacity chiptune tracker module | Identifies many more audio formats: lossless/hi-res, pro containers, speech/mobile, instrument banks, ringtones, tracker modules, chiptunes, Audacity projects. |
| Surround audio | id | EC3 EAC3 TrueHD THD MLP Atmos | dolby digital plus eac3 truehd atmos surround 5.1 7.1 meridian lossless object audio home theatre | Dolby surround codecs (E-AC-3, TrueHD, MLP, Atmos) with channel-layout detection. |
| Music production | id | ALS ALP FLP RPP LOGIC LOGICX PTX CPR BAND | ableton fl studio fruity loops reaper logic pro tools cubase garageband steinberg daw | DAW project files: version/tempo/plugin data (Ableton Live, FL Studio, Reaper, Logic Pro, Pro Tools, Cubase). |
| MIDI | full | MID MIDI | midi music score sequencer general gm synthesizer notes tempo instruments | Standard MIDI: format, tempo, time sig, GM instruments, track names, note counts, duration. |
| Lyrics | full | LRC | lyrics synced timed karaoke song subtitle text | .lrc timed-lyric files: ID tags + every timestamped line. |

### Video (`video`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Video | full | MP4 MOV AVI MKV WebM WMV FLV 3GP 3G2 MPG MPEG MTS M2TS TS VOB OGV H264 264 AVC H265 265 HEVC | movie film clip h.264 h.265 hevc sony gyro gyroscope accelerometer imu rtmd gyroflow catalyst stabilisation xavc a6700 fx3 a7 | Container/codec/res/fps; step frames, extract audio; raw H.264/265 remuxed in-browser; Sony gyro/accel rtmd track decoded & plotted. |
| Video / streaming (more) | id | M3U8 M3U MPD ISM ISMC F4M ASX WPL XSPF PLS MXF GXF LXF DV DIF ASF DVR-MS RM RMVB DIVX F4V INSV INSP LRV GIFV IVF Y4M M2V M1V MPV H264 H265 HEVC AVC OBU M2P M2T TRP WTV OGM NUT DPX CIN DAV YUV | hls apple mpeg-dash smooth streaming adobe hds winamp playlist mxf avid sony xdcam realmedia divx insta360 gopro dji proxy vp8 vp9 av1 aom mpeg-2 windows media center dvr-ms ffmpeg cineon dahua cctv dvb | Streaming manifests + video containers: HLS/DASH/Smooth/HDS; MXF/GXF/LXF/DV; ASF/RealMedia; DivX/Insta360/GoPro; raw elementary streams; PVR/DVB recordings. |
| Video editing | id | AEPX WFP WSP | adobe after effects wondershare filmora capcut bytedance ndi draft_content.json | AEPX, Wondershare Filmora (WFP/WSP), CapCut drafts (canvas/duration/tracks). |
| Editing timeline | full | EDL FCPXML OTIO | cmx3600 edit decision list final cut pro x opentimelineio premiere davinci resolve avid nle timeline conform | Visualise edit timelines from Premiere/FCP/Resolve/Avid (EDL, FCPXML, OTIO) with clip blocks by timecode. |
| Subtitles | full | SRT VTT ASS SSA SUB | subtitle caption closed captions webvtt substation alpha timed text microdvd subviewer vobsub | Subtitle cues/timing (SubRip, WebVTT, ASS/SSA, MicroDVD, SubViewer); VobSub identified. |
| After Effects | full | AEP AET | adobe after effects motion graphics compositing vfx animation precomp riff rifx xmp | Walks RIFX chunk tree to rebuild comp timelines; reads AE version, create/modify dates, footage list. |
| Premiere Pro | full | PRPROJ PREL | adobe premiere pro premiere elements nle premieredata gzip xml ticks master clip | Inflates gzip PremiereData XML; rebuilds timelines (clip bars), reads res/fps/version/media. |
| DaVinci Resolve | full | DRP DRT | blackmagic davinci resolve colour grading nle seqcontainer media pool fusion | Unzips .drp DB XML; rebuilds timelines, source filenames/paths/timecode, media pool bins. |
| VEGAS Pro | full | VEG VF | sony vegas pro magix vegas movie studio sonic foundry riff guid titles and text cookie cutter svfx rtf | Sonic Foundry RIFF GUID; reads version, summary, media generators/FX, decoded RTF title text. |
| Gyro log | full | GCSV | gyroflow gcsv imu gyroscope accelerometer stabilisation telemetry sony gopro insta360 betaflight blackbox | Gyroflow .gcsv IMU logs; plots 3-axis gyro (deg/s) + accel (g) on zoomable timeline. |

### Design (`design`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Illustrator | full | AI | adobe illustrator vector artwork eps pdf compatible logo poster artboard postscript | Adobe Illustrator artwork; modern (v9+) PDF-compatible rendered via pdf.js; older EPS identified. |
| Photoshop | full | PSD PSB | adobe photoshop large document layers composite blend mode opacity raster | PSD/PSB composite + full layer tree (name, blend, opacity, thumbnail), canvas/mode/bit-depth. |
| Raster art | full | KRA Procreate PDN | krita procreate ipad apple pencil paint.net layers merged image preview | Krita/Procreate/Paint.NET flattened preview + canvas size, layer count, app version. |
| Adobe | id | INDD INDT IDML AEPX MOGRT SESX XD FLA SWF XMP LRtemplate LRcat ACV ACO ASL ABR GRD PAT | photoshop illustrator indesign after effects premiere pro audition xd animate flash lightroom substance | Adobe project metadata: InDesign, AEPX, XD, Animate (FLA), Lightroom. |
| Design | id | FIG Sketch afphoto afdesign afpub XCF SPP SBSAR SBS | figma sketch affinity photo designer publisher gimp substance painter | Design-app files: Figma, Sketch, Affinity, GIMP (XCF), Substance. |

### Documents & ebooks (`documents`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| PDF | full | PDF | adobe acrobat document | View pages, extract text/images, OCR, metadata. |
| Office docs | full | DOCX DOCM DOTX DOTM XLSX XLSB XLSM XLTX XLTM PPTX PPTM PPSX PPSM POTX POTM ODT OTT FODT ODS OTS FODS ODP OTP FODP ODG OTG FODG SXW SXC SXD DOC XLS PPT EPUB | microsoft word excel powerpoint opendocument libreoffice openoffice staroffice ole2 biff12 epub | Microsoft Office (modern + templates/macro/slideshow + legacy 97-2003 binaries), full OpenDocument family, EPUB; page previews with selectable text/tables/sheets/slides. |
| Text & markup | full | RTF ABW FB2 HWPX MHT MHTML DITA DITAMAP TEI JATS NXML RST ADOC ORG Textile TeX LaTeX BIB | rich text wordpad abiword fictionbook hangul hwpx mhtml web archive oasis tei jats pubmed restructuredtext asciidoc org-mode emacs textile latex bibtex | Lightweight doc/markup as selectable page previews: RTF, AbiWord, FB2, HWPX, MHTML + DITA/TEI/JATS/reST/AsciiDoc/Org/Textile/TeX/BibTeX. |
| Apple iWork | full | Pages Numbers Keynote | apple iwork pages numbers keynote macos ios ipad icloud quicklook | iWork docs via embedded QuickLook PDF/preview; reads type + app version. |
| DjVu | full | DjVu DjV | djvu scanned document book journal archive scan lizardtech bitonal | DjVu scanned docs; pages decoded to images with paging, page count/dimensions. |
| Kindle e-book | full | MOBI AZW AZW3 | ebook kindle amazon mobipocket kf8 calibre cover author title | Kindle/Mobipocket e-books; title/author/publisher/cover, section paging, decoded on-device. |
| Documents / ebooks (more) | id | CBZ CBR CBT CB7 XPS OXPS HWP FB3 IBOOKS SCRIV VSDX RMD QMD RTFD WARC MAFF DVI CHM WPD QXD PMD LIT KFX | comic book comicinfo manga openxps hancom hangul ibooks apple author scrivener visio r markdown quarto warc mozilla dvi chm wordperfect quarkxpress pagemaker ms reader kindle kfx | Docs/ebooks/publishing beyond Office: comics (CBZ/CBT preview), XPS, FB3, iBooks, Scrivener, Visio, R Markdown/Quarto, WARC, DVI, HWP, WordPerfect/QuarkXPress/PageMaker. |
| Documents / publishing (more) | id | SLA SCD WPS WPT WRI DOT SDW SDC SDD SNB LRF LRX TCR CBA FM Book AWT PM6 P65 PT6 ADF | scribus dtp microsoft works windows write staroffice shanda bambook sony bbeb ebookwise framemaker aldus pagemaker ole2 cfbf | More doc/ebook/publishing: Scribus, MS Works, Windows Write, Word templates, StarOffice 5.x, Sony BBeB, FrameMaker, legacy PageMaker. |
| Fonts | full | TTF OTF WOFF WOFF2 TTC | font typeface typography truetype opentype web font collection variable font glyph specimen foundry | Live font preview (FontFace API) + variable-axis sliders; opentype.js reads family/style/version/foundry/licence, glyph grid. |
| Fonts (more) | id | GLIF | ufo unified font object glif robofont glyphs fontforge defcon fonttools type design | UFO glyph sources (.glif): name, Unicode, advance width, contour counts, renders outline. |

### Data & code (`data`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Data | full | CSV TSV SVG | spreadsheet vector markup data table | CSV/TSV tables with per-column stats; view/rasterise SVG. |
| Web / code | full | HTML CSS JS TS TSX JSX JSON YAML XML MD PS1 PSM1 PSD1 BAT CMD | react typescript javascript node powershell ps1 psm1 psd1 cmdlet sysadmin batch cmd dos | Preview/inspect HTML/CSS/JS/TS/JSON/YAML/XML/MD source + Windows scripts (PowerShell help/#Requires/signing; BAT/CMD echo/labels/tools). |
| Notebooks & data | full | IPYNB HAR JSON5 JSONC Hjson | jupyter notebook colab python r julia http archive devtools network json5 jsonc hjson relaxed json | Jupyter notebooks (cells+outputs), HAR network captures (request table), JSON5/JSONC/Hjson with value tree. |
| Access database | full | MDB ACCDB | microsoft access database jet ace office relational | MS Access (.mdb Jet / .accdb ACE): tables, columns, row counts, sample rows; in-browser. |
| Visual Studio solution | full | SLN USERPREFS | visual studio solution msbuild csproj dotnet c# vb monodevelop rider unity assembly-csharp | .sln format/VS release, projects (name/path/lang/GUID), build configs; MonoDevelop .userprefs. |
| Git objects | full | PACK IDX | git loose blob tree commit tag packfile index sha1 zlib github gitlab bitbucket | Git internals with no git binary: loose objects, .pack, .idx; inflates/parses type/size/SHA-1. |
| Databases | id | SQLite SQLite3 DB DB3 SQL SQLite-WAL SQLite-SHM DB-WAL DB-SHM | sqlite sqlite3 microsoft access sql dump schema ddl wal shm write-ahead log checkpoint | SQLite + WAL/SHM sidecars: schema, tables/columns/rows, views/indexes/triggers, DDL; .sql dumps. |
| Config | id | TOML INI ENV CONF CFG PROPERTIES | configuration settings dotenv toml ini | Config files: TOML, INI, .env, CONF, CFG, Java properties. |
| Logs | id | LOG | log file server apache nginx syslog error debug log4j logcat | Log files + origin (Apache, Nginx, syslog, Python, Java/Log4j, Android logcat). |
| Developer / data | id | JWT JSONL NDJSON DIFF PATCH WASM CLASS NPY Safetensors GGUF MAP SQL SLN CSPROJ VBPROJ FSPROJ VCXPROJ Gradle TF TFState EditorConfig PROTO GraphQL GQL SARIF PYC PLIST | json web token jwt webassembly java class bytecode numpy safetensors gguf llm ai model machine learning source map terraform protobuf protocol buffers graphql sarif python pyc apple property list plist | Dev/data metadata: JWT, WASM, Java class, NumPy/Safetensors/GGUF model files, source maps, SQL, VS/.NET projects, Terraform, Protobuf, GraphQL, SARIF, plists. |
| Developer / data (more) | id | LOCK PB MsgPack MPK BSON CBOR PKL Pickle NPZ JAR WAR EAR FBS Thrift CapnProto HCL MAT RDB Arrow Feather Parquet ORC DESC DUMP | lockfile package-lock yarn pnpm cargo poetry composer bundler protobuf grpc messagepack bson mongodb cbor python pickle java maven gradle spring flatbuffers thrift apache capnp matlab mathworks redis arrow feather parquet orc hive spark columnar | Dev/serialisation: lockfiles, MessagePack/CBOR/BSON/Protobuf, pickles, NumPy .npz, jar/war/ear, FlatBuffers/Thrift/Cap'n Proto/HCL, MATLAB, Redis RDB, Arrow/Parquet/ORC. |

### 3D / CAD / engineering (`threed`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| 3D model | full | STL OBJ PLY OFF STEP STP IGES IGS BREP 3MF AMF glTF GLB | wavefront stanford khronos gltf 2.0 cad solidworks fusion catia inventor freecad opencascade bambu prusa orcaslicer blender sketchfab webgl ar | Interactive WebGL viewer (tri count, bbox, area, volume); glTF/GLB native; STEP/IGES/BREP tessellated via OpenCASCADE w/ CAD system + AP protocol. |
| 3D / CAD / point clouds (more) | id | VOX DAE ZAE USDC X3D WRL VRML LWO LWS MD2 MD3 MDL VRM JT LAS LAZ PCD PTS E57 IFC IFCZIP SPLAT SPZ | magicavoxel collada blender maya lightwave newtek quake id software lidar point cloud asprs laszip leica faro pcl ros e57 bim buildingsmart revit archicad siemens jt usd vrm vroid gaussian splat scaniverse niantic | Header/metadata for meshes, voxels, BIM, point clouds, Gaussian splats: VOX, DAE, USD crate, X3D/VRML, LightWave, Quake MDx, VRM, JT, LAS/LAZ/PCD/E57, IFC, .splat/.spz. |
| 3D / CAD (more) | id | DRC KSplat U3D 3DXML X QB Wings RVT RFA RTE RFT PAR PSM PWD NWD NWF NWC Model EXP DLV Session CL3 CLR TZF VSD | draco google gaussian splat universal 3d 3d pdf dassault catia directx qubicle wings3d revit autodesk bim solid edge siemens navisworks faro trimble scanner visio ole2 | Draco meshes, KSplat, U3D, 3DXML, DirectX .x, Qubicle, Wings3D, Revit, Solid Edge, Navisworks, CATIA V4, scanner point clouds, legacy binary Visio. |
| CAD | id | SLDPRT SLDASM SLDDRW SLDREG SVAP SVPJ F3D F3Z IPT IAM IDW 3DM SKP 3DS MAX C4D HIP ZPR ZTL MA MB CATPART CATPRODUCT PRT ASM BRD SCH KiCad_pcb GH GHX | autocad autodesk solidworks fusion 360 inventor rhinoceros rhino grasshopper sketchup trimble 3ds max cinema 4d maxon houdini sidefx zbrush pixologic maya catia dassault eagle kicad pcb | CAD header metadata: SolidWorks (incl. Settings Wizard + Visualize), Fusion 360, Inventor, Rhino/Grasshopper, SketchUp, 3ds Max, C4D, Houdini, ZBrush, Maya, CATIA, Eagle, KiCad. |
| CAD exchange | id | SAT X_T X_B | parasolid acis exchange neutral format | Neutral CAD exchange: Parasolid (X_T/X_B), ACIS (SAT). |
| 3D / printing | id | FBX USDZ USD USDA BLEND | blender mesh 3d printing prusa bambu cura slicer wavefront autodesk pixar apple unity unreal | FBX, USD/USDZ, Blender (BLEND). |
| Engineering | id | CDP | cdp4 comet data platform esa engineering systems concurrent design criterium decisionplus decision analysis ahp | CDP: CDP4 (COMET) concurrent-design (ESA) or Criterium DecisionPlus. |
| CNC / 3D print | id | GCODE GCO NC NGC TAP CNC | gcode cnc 3d printing slicer prusa cura bambu orca simplify3d slic3r mill router lathe laser fusion 360 mastercam grbl fanuc haas vectric lightburn | G-code for 3D printers/CNC: slicer/CAM tool, machine/controller, toolpath, print/cut dims. |
| Science / medical / engineering | id | DCM DICOM NII FIT TCX FITS FTS FASTA FA FNA FAA FASTQ FQ MOL SDF MOL2 CIF MMCIF XYZ GBR GBL GTL DRL XLN CIR SP SPI SPICE EDF BDF JDX DX SAV DTA SAS7BDAT VTK VTU VTP VTI SEGY SGY BAM SAM BCF HEA | dicom medical imaging ct mri pacs radiology garmin strava zwift fit fits astronomy nasa nifti neuroimaging fasta fastq dna rna genomics ncbi illumina chemistry rdkit chemdraw crystallography avogadro vmd gerber pcb kicad altium eagle excellon spice ltspice ngspice eeg ecg jcamp spss stata sas paraview kitware seg-y seismic samtools physionet | Scientific/medical/eng: DICOM, NIfTI, Garmin FIT/TCX, FITS, FASTA/FASTQ, chem (MOL/SDF/CIF/XYZ), Gerber/Excellon PCB, SPICE, EDF/BDF, JCAMP-DX, SPSS/Stata/SAS, VTK. |
| Science / engineering (more) | id | RDS RData RDA AB1 POSCAR CUBE XSF CDX CDXML ABF TDMS VHDR VMRK CNT EEG SET VTS VTR NET MSH INP CDB WFM | r rstudio abif sanger sequencing vasp dft gaussian xcrysden chemdraw axon pclamp ni tdms labview brainvision neuroscan eeglab gmsh abaqus nastran ansys spice paraview oscilloscope | More sci/med/eng: R serialized, ABIF traces, VASP/Gaussian DFT, ChemDraw, Axon ABF, NI TDMS, EEG, Gmsh/Abaqus/Nastran/ANSYS FEA, SPICE, VTK grids, oscilloscope. |
| Diagrams | full | DRAWIO DXF DWG DWT | drawio diagrams.net flowchart mxgraph autocad cad libredwg 2d preview | 2D vector diagrams/CAD to preview: draw.io (mxGraph), AutoCAD DXF, binary DWG/DWT via LibreDWG (WASM). |

### Archives (`archives`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Archives | full | ZIP RAR 7Z TAR GZ TGZ BZ2 XZ ZST LZ4 LZMA Z | compressed archive extract winrar 7zip tarball gzip bzip2 xz lzma zstandard lzw unix compress | Browse file tree/compression without extracting: ZIP (pure JS), RAR/7z/TAR via libarchive; single streams decompressed. |
| Archives (packages) | id | CPIO A WHL NUPKG CRX XPI VSIX ASAR APPX MSIX APKG CONDA DEB RPM GEM CAB ACE ARJ LZH LHA ZOO ARC | cpio initramfs unix ar static library python wheel pip nuget chrome extension firefox addon vs code electron asar windows app msix anki conda debian ubuntu dpkg redhat fedora rpm rubygems microsoft cabinet lha lharc | Software packages + Unix archive streams: wheels, NuGet, browser/VS Code extensions, ASAR, APPX/MSIX, DEB, RPM, gems, conda, Anki, CAB, cpio, ar. |
| Archives (more) | id | XAR PKG MPKG MSU SNAP Flatpak SIT SITX LZO BR JNLP TLZ TBZ TZ | xar apple installer macos pkg windows update wusa snap canonical flatpak flathub ostree stuffit aladdin lzop brotli google java web start | More archives/installers: macOS XAR/.pkg, Windows .msu, Snap, Flatpak, StuffIt, lzop, Brotli, Java Web Start, tarball shorthands. |

### Maps & GIS (`maps`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Map data | full | GPX KML GeoJSON | gps track waypoint route geojson kml google earth strava garmin map gis | GPX/KML/GeoJSON: counts, distance, elevation, time span, bounds; plotted on OpenStreetMap. |
| Geospatial / GIS | id | TopoJSON OSM SHP SHX DBF PRJ CPG PGW TFW JGW WLD GML NMEA IGC TAB MIF VRT PMTiles DT0 DT1 DT2 DTED ASC HGT GRIB GRB GRIB2 CDF NC4 PBF GPKG MBTiles SID ECW GDB | gis geospatial shapefile esri arcgis qgis gdal ogr topojson d3 openstreetmap mapinfo dbase wkt crs epsg gml nmea igc paragliding dted srtm pmtiles protomaps grib netcdf geopackage mbtiles mapbox mrsid ecw geodatabase | Geospatial/GIS without a map: TopoJSON, OSM XML, Shapefile siblings, world files, GML, NMEA, IGC, MapInfo, VRT, PMTiles, DTED, ASCII grids, .hgt; GRIB/NetCDF/GPKG/etc. identified. |
| GIS / mapping (more) | id | O5M O5C LYR LYRX QGS QGZ SBN SBX CPT BIL BIP BSQ | openstreetmap osmconvert esri arcgis layer arcmap arcgis pro cim qgis spatial index gmt gdal colour palette envi remote sensing | More GIS: o5m/o5c, Esri layer files, QGIS projects, shapefile spatial indexes, GMT/GDAL palettes, ENVI rasters. |
| GIS / mapping | id | SHP KMZ | geographic gis mapping google earth shapefile esri kmz | Shapefile (SHP), zipped Google Earth (KMZ). |

### Games (`games`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Unity | full | UNITY PREFAB ASSET CONTROLLER ANIM MAT META physicsMaterial2D physicMaterial CUBEMAP SPRITEATLAS MIXER overrideController | unity game engine yaml scene prefab gameobject animator controller animation material meta importer guid monobehaviour gamedev | Unity YAML assets: scenes/prefabs/controllers/anims/materials/.meta; GameObjects, component breakdown, curves, states, GUID. |
| Game ROMs / assets | id | NES GB GBC GBA SFC SMC NDS DSI Z64 N64 V64 GEN SMD IPS BPS UPS PPF WAD NBT MCWORLD ASE PCK PAK PK3 BSP VPK VTF VMT KTX KTX2 TMX TMJ LOVE PACKAGE MPQ CIA NSP XCI | rom emulator nintendo nes famicom game boy gba snes nintendo ds n64 sega genesis ips romhack doom wad minecraft nbt litematica bedrock aseprite godot quake idtech valve source engine pico-8 love2d tiled the sims maxis simcity spore starcraft mpq blizzard 3ds switch citra ryujinx renpy rpg maker fceux mesen mgba snes9x project64 | Game ROMs/patches/engine assets: NES/GB/GBA/SNES/DS/N64/Genesis headers; IPS/BPS/UPS/PPF patches; Doom WAD; Minecraft NBT; Aseprite; Godot; Quake; Source; KTX; Tiled; LÖVE; PICO-8; MPQ/3DS/Switch/Ren'Py. |
| Game assets (more) | id | Assets Bundle Resource UTOC UCAS UEXP UMD CSO CHD FSB Bank BNK WEM Spine Skel Atlas YYP YY GMX MCA MCR MCTemplate 3DSX A78 A26 LNX J64 PCE GG SMS WS WSC W3X W3M RPYC RVData2 RXData Pyxel LDtk TIC XDelta Basis SRM State DSV DSM VBM FM2 | unity asset bundle unreal engine ue4 ue5 iostore mame dreamcast fmod fsb5 wwise audiokinetic spine gamemaker yoyo minecraft anvil bedrock warcraft 3 mpq renpy rpg maker marshal pyxel ldtk tic-80 xdelta vcdiff atari 2600 7800 lynx jaguar pc engine turbografx master system game gear wonderswan 3ds homebrew desmume vbm fceux tas speedrun | More game/emulator: Unity bundles, Unreal cooked, CISO/CHD, FMOD/Wwise banks, Spine, GameMaker/LDtk/TIC-80, Minecraft Anvil, Warcraft III, Ren'Py/RPG Maker, console ROMs, patches, saves/movies. |
| Game engines | id | UNITYPACKAGE UASSET UMAP GODOT TSCN TRES | unity unreal godot game development asset | Unity (UNITYPACKAGE), Unreal (UASSET/UMAP), Godot (TSCN/TRES). |
| Game saves | id | BEPIS | ultrakill save game progress slot bepis hakita cyber grind binaryformatter nrbf dotnet | ULTRAKILL saves: decodes .NET BinaryFormatter → money, weapons, level/difficulty, ranks, Cyber Grind score. |
| Valve / Steam | id | VDF ACF | valve steam keyvalues kv source engine appmanifest libraryfolders loginusers | Valve KeyValues (VDF) + Steam app manifests (ACF): App ID, name, install dir, size, key tree. |

### Email & security (`security`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Email | full | EML EMLX MBOX | email message rfc822 mime apple mail outlook thunderbird mbox mailbox spf dkim dmarc | Messages/mailboxes (EML, Apple Mail EMLX, MBOX): headers, Received hops, SPF/DKIM/DMARC, attachments, sanitised body. |
| Calendar / contacts | id | ICS ICAL IFB VCF VCARD VCS LDIF CONTACT MSG PST OST NSF EDB DBX | icalendar calendar event vevent rrule google calendar vcard contact address book ldif ldap exchange ese lotus notes domino outlook express pim | iCalendar/.vcs events, vCard contacts, LDIF, Windows .contact; Outlook .msg/.pst, Notes .nsf, Exchange .edb, .dbx identified. |
| Security / keys / certs | id | KEY PUB P8 CSR CRL P7B P7C PPK OVPN WG JKS KEYSTORE JCEKS MOBILECONFIG MOBILEPROVISION REG PCAP PCAPNG P12 PFX KDBX EVTX | openssl ssh openssh putty rsa ed25519 ecdsa pkcs1 pkcs8 pkcs7 pkcs12 x509 certbot letsencrypt keystore java tomcat apns apple mdm wireguard openvpn registry regedit forensics keepass encase etw wireshark tcpdump | Security/crypto: PEM keys, OpenSSH .pub fingerprint, PuTTY .ppk, CSR/CRL/PKCS#7, OpenVPN/WireGuard, Java KeyStores, Apple .mobileconfig, .reg, pcap/pcapng. |
| Security / forensics (more) | id | PGP GPG SIG EVT YAR YARA RULES STIX IOC SAZ 1PUX OPVault Keychain AFF AFF4 KDB PVK | openpgp gnupg pgp signature windows event log yara malware snort suricata ids stix taxii misp openioc mandiant fiddler 1password 1pux opvault agilebits apple keychain keepass authenticode forensic | More security/forensics: OpenPGP, YARA, Snort/Suricata rules, STIX/OpenIOC, Fiddler .saz, 1Password .1pux, Apple Keychain, KeePass .kdb, .pvk, AFF/AFF4. |
| Certificates | id | CRT CER PEM DER | x509 certificate ssl tls https openssl public key private rsa ec | X.509 certs (CRT/CER/PEM/DER): subject, issuer, validity, key details. |
| Email / contacts (more) | id | OLM OFT P7M P7S MSF MAB MBX TOC VMG VNT XCAL JCAL XCARD JCARD LDI PAB WAB ABBU | outlook for mac oft s/mime pkcs7 mozilla mork thunderbird eudora qualcomm nokia sms backup vnote xcalendar jcard rfc6321 ldif personal address book windows wab apple contacts | More email/calendar/contacts: Outlook for Mac, S/MIME, Mork stores, Eudora/OE mailboxes, phone backups, XML/JSON iCal/vCard, legacy address books. |

### System & disk (`system`)

| Label | Depth | Extensions | Search tags (brands/synonyms) | Desc (one-line) |
| --- | --- | --- | --- | --- |
| Text art | full | NFO | nfo scene release ascii art ansi cp437 oem ibm pc box drawing block characters | Scene NFO decoded from CP437 so box-drawing/block ASCII art renders correctly. |
| Disk images | id | ISO IMG VHD VHDX VMDK QCOW2 VDI | virtual machine disk image hyper-v vmware virtualbox qemu boot partition mbr gpt fat ntfs exfat sd card usb raw dd clone | ISO, VHD/VHDX (Hyper-V), VMDK (VMware), QCOW2 (QEMU), VDI (VirtualBox); raw IMG decodes partition table + first FS. |
| Disk images / firmware | id | OVF OVA VBOX VMX CUE CCD NRG MDS MDF HEX SREC S19 S28 S37 MOT UF2 ELF AXF O SO DTB DTBO UIMAGE GPT MBR EXT4 EXT SQUASHFS SFS CRAMFS ROMFS WIM SWM ESD EWF JFFS2 UBIFS YAFFS2 ISZ CDI VMSN VMEM | virtual machine vmware virtualbox oracle ovf ova vmx vbox hypervisor nero alcohol clonecd intel hex motorola s-record microcontroller uf2 raspberry pi micro:bit elf gcc clang arm risc-v avr device tree u-boot openwrt iot ext4 squashfs wim esd encase ewf forensic jffs2 ubifs yaffs2 nand | VM descriptors, disc images, embedded firmware (Intel HEX, S-record, UF2, ELF, DTB, U-Boot), partition tables, Linux FS superblocks, Windows imaging. |
| Disk images / firmware (more) | id | TRX DFU FD ROM UBI SIMG ITB DSK IMA VFD VMSD NVRAM PVM HDD MF VBK | trx broadcom openwrt router dfu stm32 uefi bios coreboot edk2 flash ubi nand android sparse u-boot fit floppy fat vmware snapshot parallels virtual pc veeam backup | More disk/firmware/VM: TRX, USB DFU, UEFI/BIOS, UBI, Android sparse, U-Boot FIT, floppy images, VMware snapshot/NVRAM, Parallels, OVF manifests, Veeam. |
| Executables | id | EXE DLL MSI APK IPA DMG AppImage | windows android apple mac macos linux program installer apk androidmanifest permissions sdk versioncode signing dex abi arm64 google play | Programs/installers: Windows (EXE/DLL/MSI), Android (APK - decodes manifest), iOS (IPA), macOS (DMG), Linux (AppImage). |
| System / misc | id | OPML RSS ATOM DESKTOP SERVICE CRASH AB JOB POL SCR DS_STORE THUMBSDB DSYM DWARF SDB | opml feed reader rss atom syndication freedesktop linux desktop systemd apple crash panic android backup adb windows task scheduler group policy screensaver macos ds_store finder thumbs.db dsym dwarf debug symbols shim | OS/system files: OPML, RSS/Atom, .desktop/.service, Apple .crash, Android .ab, Task Scheduler .job, Group Policy, .scr; .DS_Store/Thumbs.db/dSYM/.sdb identified. |
| Shortcuts | id | LNK URL WEBLOC | windows shortcut link target arguments internet shortcut url macos webloc alias launcher | Shortcut files: Windows LNK (target/args/cwd/icon/hotkey/timestamp), .url, macOS .webloc. |
| Recordings | id | REC | pvr dvr recording mpeg transport stream topfield humax cctv getdataback reclaime recovery | REC: PVR/DVR video (MPEG-TS/PS) vs data-recovery session files. |
| Camera catalog | id | CTG | canon dcim catalog index database camera memory card eos digital ic | Canon CTG DCIM index: folder path/number, shot count, photo/movie/voice-memo entry counts. |
| Other | id | TORRENT PART CRDOWNLOAD | bittorrent peer to peer p2p download partial incomplete chrome firefox crdownload | BitTorrent .torrent (file list) + partial downloads (.part, .crdownload). |

---

## 3. Full-analysis vs identification (label split)

**Full-analysis (36 labels — real viewer / deep analysis, `FULL_ANALYSIS`):**
Photo, RAW photo, Illustrator, Photoshop, Raster art, Sound, Video, PDF, DjVu,
Kindle e-book, Office docs, Text & markup, Apple iWork, 3D model, Editing
timeline, After Effects, Gyro log, Premiere Pro, DaVinci Resolve, VEGAS Pro,
Unity, Visual Studio solution, Notebooks & data, Access database, Email,
Diagrams, Fonts, Text art, Archives, Data, Lyrics, Subtitles, MIDI, Map data,
Web / code, Git objects.

**Identification (50 labels — identified + header metadata, `IDENTIFICATION_CORE`
+ `IDENTIFICATION_EXTENDED`):**

- *Core (24):* Adobe, Design, CAD, CAD exchange, 3D / printing, Music
  production, Databases, GIS / mapping, Disk images, Recordings, Game engines,
  Game saves, Valve / Steam, Config, Executables, Video editing, Surround audio,
  Certificates, Engineering, Logs, Camera catalog, Shortcuts, Other. *(23 listed
  here + "Video editing" = 24 — note "Video editing"/"Surround audio" included.)*
- *Extended (26):* Developer / data, RAW sidecars / cinema, Archives (packages),
  Calendar / contacts, Security / keys / certs, Game ROMs / assets, Disk images
  / firmware, Science / medical / engineering, System / misc, Images (more), 3D
  / CAD / point clouds (more), Geospatial / GIS, Audio (more), Video / streaming
  (more), Documents / ebooks (more), Developer / data (more), Archives (more), 3D
  / CAD (more), Disk images / firmware (more), Game assets (more), Documents /
  publishing (more), Email / contacts (more), Security / forensics (more),
  Science / engineering (more), GIS / mapping (more), Fonts (more).

---

## 4. High-value keyword opportunities

Rows whose `tags` name well-known software/brands people actually search for
("how to open a .X file from <brand>"). These brand↔extension synonym mappings
are the SEO core.

**Strongest brand-anchored rows (full-analysis = best landing pages):**

- **CAD** (id) — SLDPRT/SLDASM ↔ **SolidWorks**, F3D ↔ **Fusion 360**, IPT/IAM ↔
  **Inventor**, 3DM ↔ **Rhino/Grasshopper**, SKP ↔ **SketchUp/Trimble**, MAX ↔
  **3ds Max**, C4D ↔ **Cinema 4D/Maxon**, HIP ↔ **Houdini/SideFX**, ZTL ↔
  **ZBrush/Pixologic**, MA/MB ↔ **Maya**, CATPART ↔ **CATIA/Dassault**, BRD/SCH
  ↔ **Eagle/KiCad**. Extremely high-intent, low-competition long tail.
- **Photoshop** (full) — PSD/PSB ↔ **Adobe Photoshop**; **Illustrator** (full) —
  AI ↔ **Adobe Illustrator**; **After Effects / Premiere Pro / DaVinci Resolve /
  VEGAS Pro** (all full) ↔ the named editors — strong "open <editor> project in
  browser" intent.
- **RAW photo** (full) — per-camera-brand synonyms (**Sony, Nikon, Canon,
  Fujifilm, Olympus, Pentax, Sigma, Panasonic/Lumix, Leica, Hasselblad, Phase
  One, GoPro**) each map to specific extensions (ARW, NEF, CR2/CR3, RAF, ORF,
  PEF, X3F, RW2). "open .arw / .nef / .cr3 file" is high-volume.
- **Office docs** (full) ↔ **Word/Excel/PowerPoint/LibreOffice/OpenOffice**;
  **Apple iWork** (full) ↔ **Pages/Numbers/Keynote**; **Kindle e-book** (full) ↔
  **Amazon Kindle/Mobipocket/Calibre**.
- **Music production** (id) — ALS ↔ **Ableton Live**, FLP ↔ **FL Studio**, RPP ↔
  **Reaper**, LOGICX ↔ **Logic Pro**, PTX ↔ **Pro Tools**, CPR ↔ **Cubase**.
- **Design** (id) — FIG ↔ **Figma**, Sketch ↔ **Sketch**, afphoto/afdesign ↔
  **Affinity**, XCF ↔ **GIMP**, SBSAR ↔ **Substance**.
- **Game ROMs / assets** + **Game saves** + **Game engines** — emulator/console
  brands (**Nintendo, Sega, Game Boy, SNES, N64, Doom/WAD, Minecraft, Godot,
  Unity, Unreal, PICO-8, Aseprite, Ren'Py, RPG Maker, ULTRAKILL, Steam/Valve**)
  — strong niche search intent.
- **Science / medical / engineering** (id) — **DICOM** (medical imaging),
  **Garmin/Strava FIT/TCX**, **FASTA/FASTQ** genomics, **Gerber/KiCad/Altium**
  PCB, **SPICE/LTspice**, **SPSS/Stata/SAS** — each a distinct professional
  search audience.
- **Geospatial / GIS** + **GIS / mapping** — **Esri/ArcGIS shapefile (SHP)**,
  **QGIS**, **Google Earth (KMZ/KML)**, **Mapbox MBTiles**, **MrSID/ECW** — GIS
  pros search exact extensions.
- **Security / keys / certs** + **Certificates** — **OpenSSL, OpenSSH, PuTTY,
  WireGuard, OpenVPN, KeePass, 1Password, X.509** — high-intent admin/dev audience.

**Notably rich `desc` rows (long, keyword-dense — strongest SEO body copy):**
Photo, RAW photo, Office docs, 3D model, After Effects, Premiere Pro, DaVinci
Resolve, VEGAS Pro, Unity, Databases (SQLite WAL/SHM detail), Diagrams,
Executables (Android manifest detail), Science / medical / engineering, Video
(Sony gyro/rtmd detail). These already read like ready-made "what is / how to
open a .X file" landing-page copy.
