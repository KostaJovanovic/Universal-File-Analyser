/* Analyser - changelog "tl;dr" digest.
   The whole patch history condensed into release groups, and the button wiring
   that swaps the full changelog entry list for this digest on /patch. Only
   setupPatchTldr is exported; PATCH_DIGEST is its private data. */

import { el } from './util.js';

// Changelog "tl;dr" digest - the whole history condensed into release groups of
// five (every X.0 milestone kept on its own via milestone:true). KEEP THE NOTES
// SHORT: one terse bullet per idea, a clause not a paragraph - no piling up
// semicolons and dashes. Emphasise the key term(s) in each note by wrapping them
// in **double asterisks** (rendered as <strong>); bold the salient feature/format
// name, not whole phrases. The tl;dr button (setupPatchTldr) hides the full entry
// list and shows this instead. Newest first. When you add a patch: extend the
// newest group's notes, or - once that group holds five versions - start a new
// group above it (and never fold an X.0 milestone into a range).
const PATCH_DIGEST = [
  { range: '8.0', milestone: true, notes: [
    'Eighth milestone: a song that took **26 seconds** to analyse now takes **3** - the heavy sound reads moved to a background thread, the frequency maths rewritten, and each answer filling in as it lands.',
    'The same speed pass reaches **long documents** (measured once instead of per paragraph), **dropped folders** (read in parallel, cancellable, counted as they arrive) and **photos** (the heavy forensic reads prepared only when opened).',
    'New **XMP sidecar** viewer: the develop recipe Lightroom, Camera Raw and darktable write beside a raw photo, with the tone curve, sliders, colour mixer and crop drawn out.',
    'Sound gains a **Reverse** that re-analyses the reversed track in full, a **lossy-source check** promoted to its own card, redrawn **touch-tones** you can click to hear, and **space** to play or pause anywhere.',
    '**Circuit boards open offline** at last - the drawing engine both board viewers are built on was never saved for offline use - and the 3D board gains the **view cube** the other 3D viewers carry, an **Auto-rotate**, a three-quarter opening angle and a **Flip over** that keeps your viewing angle.',
    'One strict **cleaner** for anything a dropped file wants to display (email, saved web page, e-book chapter, SVG): there were four, they had drifted, three could be slipped past by a disguised link, and an **e-book chapter** could quietly fetch a picture from the internet.',
    'A video **contact sheet** stops dropping frames on a big file (two of eight on a 1.5 GB clip), both it and **scene detection** now show progress, the **content timeline** finally appears on a large video, and the raw **box tree** drops to the bottom of Advanced.',
    'A photo\'s **embedded thumbnail** is shown the right way up at last, and its **fingerprints** move into Advanced with the rest of the deep analysis.',
    '**Blank sheets hold the space** while a PDF, document, slideshow or comic draws its pages, instead of a tall block of previews landing on top of the finished analysis and shoving it downwards.',
    '**Clear storage** finally reclaims the space - the offline downloads, extra OCR languages and AI models go too - and **settings stop vanishing** on a reload, swept away by a tidy-up that had no business touching them.',
    'Searching the page now **opens a folded Advanced section** to show the match, a **sample** you open no longer replaces the file you had on the home page, and a 3D viewer no longer **swallows the page scroll**.',
  ] },
  { range: '7.01 - 7.02', notes: [
    'The deep **Advanced** forensic analysis is gathered into one tidy section - each panel now a sub-heading rather than a separate card - and dropped to the **very bottom** of every photo, video and sound, below everything else.',
    'Sound\'s **loudness graph** (EBU R128, with true peak) becomes playable like the waveform - a playhead tracks the sound and you can click or drag anywhere on it to seek.',
    'A photo\'s **privacy report** (GPS, serial, owner, copyright, unique IDs) moves up into the main metadata, and a copyright field that used to misread is fixed.',
    'The **compare** view reads far better - sub-headings stay with their tables, spectrograms and waveforms show as whole side-by-side panels, and **Show differences** now fades matching panels too, not just rows.',
    'The **changelog** is split - recent updates load quickly here, with the full older history archived to a separate page.',
  ] },
  { range: '7.0', milestone: true, notes: [
    'Seventh milestone: a deep **forensic** pass reads the hidden internals of every photo, video and sound - and everything on the site is now explained in **plain English**.',
    'Photos: **error-level analysis**, quantization fingerprint and JPEG ghosts to spot edits; **bit-plane / LSB** hidden-data analysis; edit history and a privacy report; and a switch to analyse a **RAW** as its embedded preview or fully demosaiced.',
    'Video: an **Advanced** card with the full box tree, track list, provenance tells and a keyframe/bitrate map; **GoPro/CAMM telemetry** (GPS route, motion, exposure); an **encoder fingerprint** and stream-vs-container check; HDR/Dolby Vision and C2PA; and a **content-timeline barcode** - with a converted clip used **only for playback**, so all analysis describes the original.',
    'Sound: a full **EBU R128** loudness meter with true peak; a **fake-lossless** (MP3-in-FLAC) detector; **musical key**; forensic listeners for **mains hum**, ultrasonic tones and **DTMF** - the loudness meter and forensics gathered into one **Advanced** section, with a video\'s own sound analysed in full the same way; and new on-device **AI denoise** (**DeepFilterNet3**) shown as a Clean-to-Noise blend, plus friendlier one-tap filters.',
    'Every **[?] explanation** rewritten in plain English, with many more readouts gaining one and a **[?]** now opening a tidy pop-up instead of pushing the page down - plus a clear answer for an **empty (0-byte) file**.',
  ] },
  { range: '6.38 - 6.51', notes: [
    'Long animated **GIFs** and **WebPs** now play in full, however many frames - each decoded as you scrub to it, with only a rolling window kept in memory.',
    'How much an animation keeps ready to replay - and the size at which a very large **archive or disk image** is turned away - now scale to your device\'s memory.',
    'Draws the waveform from a **DJI recorder\'s .pkf** overview file (Mic, Osmo, drone), and identifies Adobe Audition peak caches.',
    'The **See full document** reading view fixes vanishing dark-mode text and moves its open button above the excerpt.',
    'A visual tidy - every remaining **rounded corner** squared off - plus internal consolidation of provenance reads, the board viewer and all size limits.',
  ] },
  { range: '6.36 - 6.37', notes: [
    'Opens a raw **disk image** (.img/.ima/.dsk) like a folder - mounts its **FAT12/16/32** filesystem, browses every file in a tree and treemap, and reads the volume label, cluster size and free space.',
    '**Carves deleted photos** straight from a disk image\'s raw sectors, recovering pictures the file list no longer points to.',
    'A **damaged photo** that used to come back blank now shows its readable part, or, if its full image was overwritten, its embedded **thumbnail**.',
    'Photo recovery can now rebuild a **headerless JPEG** by borrowing a header from a healthy same-camera photo.',
    'Reads Android **app bundles** (XAPK, APKM, APKS) as browsable archives.',
  ] },
  { range: '6.32 - 6.35', notes: [
    'Every **3D model** gets a **Mesh integrity** check - flags **non-manifold** edges, open holes, degenerate and duplicate faces, and whether it is **watertight**.',
  ] },
  { range: '6.22 - 6.31', notes: [
    'Reads a photo\'s **C2PA Content Credentials** - the signing tool, edits, source images and any AI involvement it claims.',
    'A card weighs whether an image is **AI-generated**, from generator tags and hidden **Stable Diffusion**, **ComfyUI** and **Midjourney** parameter blocks.',
    'One-click **metadata stripping** (EXIF, XMP, IPTC, GPS) with no re-encode, plus a **date timeline** that flags impossible timestamps.',
    'A browsable **documentation site** with live, interactive component examples, and a reorganised footer.',
  ] },
  { range: '6.19 - 6.21', notes: [
    'A full **spreadsheet workbench** under every CSV, Excel and OpenDocument file - sort, filter, group, reshape and chart, all on-device.',
    'Recognises more **date formats**, read day-first (or month-first when a value proves it American).',
    'The open-source **readme** was rewritten with screenshots.',
  ] },
  { range: '6.14 - 6.18', notes: [
    'Analyser is a **pure website** again - the desktop and mobile app experiment was retired and stripped out.',
    'The open-source repo gains a **contributing guide**, security policy, code of conduct and issue templates.',
    'The **waveform selection** becomes an editing tool - resize, move or type exact times, with its own transport.',
    'Leaving the home page and returning **restores** your open file, player and results.',
  ] },
  { range: '6.12 - 6.13', notes: [
    'Opens **Java KeyStores** (.jks/.keystore), listing entries and decoding every certificate inside, including PKCS#12.',
    'The **desktop and mobile apps** shrink - the AI model and OCR packs now download on first use.',
    '**Clear storage** now spares your downloads, and other-language OCR works in the apps too.',
  ] },
  { range: '6.08 - 6.11', notes: [
    '**AI vocal separation** now runs on iPhone and Safari instead of crashing the tab.',
    'The **Isolate/Separate** controls stack cleanly on phones, and Clear storage spares the saved AI model.',
    'Lighter default **G-code clips** (Standard, 30fps), a tidier wide-screen edge, and the desktop app joins the analysed-count.',
    'A large internal **reorganisation** of the site and build scripts.',
  ] },
  { range: '6.06 - 6.07', notes: [
    'A broad **robustness and safety** pass - a crafted file can no longer freeze a tab, and previews stay strictly inert.',
    'Multi-file drops analyse the **first file**, viewer errors still show the fingerprint, and huge archives bow out gracefully.',
    'The **offline download** and analysed-count survive updates, and previews free their memory once hidden.',
    'The desktop app reads only the **dropped file**, and the Asteroids leaderboard is marked just for fun.',
  ] },
  { range: '6.01 - 6.05', notes: [
    'Analyser is now a **desktop app** for Windows, macOS and Linux - same engine, auto-updating, from GitHub Releases.',
    '**AI vocal separation** adds a lighter phone model, a Standard/Lite prompt, an on/off toggle and a day-long cache.',
    'The **vocal/instrumental blend** plays through the Isolate filters at your exact spectrogram settings.',
    'The **3D viewer** gains the G-code camera controls - hold-to-zoom, scroll-zoom toggle and fullscreen.',
    'The **analysed-count** survives going offline, plus fixes for the offline picker, contrast and the volume popup.',
  ] },
  { range: '6.0', milestone: true, notes: [
    'Sixth milestone: Analyser pulls a **song apart**, on your device.',
    'A neural network splits any track into **vocal and instrumental stems** - each with its own player, spectrogram and WAV.',
    'A **Vocals-to-Instrumental slider** fades between the two while the spectrogram morphs to the exact mix.',
    'A brief **branded loading screen** on cold start.',
    'The **Complete offline download** becomes a chooser - OCR packs and the AI model as separate optional extras.',
  ] },
  { range: '5.16 - 5.21', notes: [
    'A new **/compare** page runs two files through full analysis and lines up every field, hash and date, with a differences toggle.',
    'Players can **boost a quiet clip** past 100%, up to 225%, with a limiter.',
    'The **Isolate** tool gains one-tap Vocals, Bass and Drums solos, a Remove-vocals option and WAV download.',
    'A large **ZIP** with a deep index now lists every entry, and the stats charts respond to phone taps.',
    'The G-code **"dim other tools"** highlight cross-fades, and builds default to a 30-second playback.',
    'The **format guide pages** gain full navigation and a licence link beside every dependency.',
  ] },
  { range: '5.13 - 5.15', notes: [
    'Files the browser can\'t handle get through - **unusual video** converts in one tap, undecodable **audio** is rebuilt to play.',
    'Overlong **PDF previews** cap to a page shape and pan by drag; the After Effects timeline scrollbar is grabbable.',
    'Every file now shows a **CRC-32** checksum.',
    'A wide **compatibility** pass - Office, e-books and comics open on older browsers, and the 3D/G-code viewers stop blanking.',
    'Very large comics, **DjVu** scans and databases warn on phones instead of crashing.',
    'Recorded **G-code clips** export at higher bitrate, with a Standard/High/Max choice.',
  ] },
  { range: '5.08 - 5.12', notes: [
    'The home page becomes one **"drop any file"** zone, and multi-channel sound analyses one channel at a time.',
    'The **G-code viewer** gains a hold-to-zoom pad, scroll-zoom toggle and tidier fullscreen.',
    'A G-code build can be **recorded as MP4** - length, speed, aspect, quality and camera moves.',
    'Exported clips play **everywhere**, including WhatsApp.',
    'Every viewer now leads with the **render or preview**, technical details below.',
    'The **After Effects timeline** is rebuilt - true positions, label colours, type glyphs and a snapping scrubber.',
    'The spectrogram gains an **Isolate mode** - mute frequency bands by dragging or typing a range.',
    '**Image-to-sound** previews every setting live, and the spectrogram reaches below 20 Hz.',
  ] },
  { range: '5.05 - 5.07', notes: [
    'Turn any **photo into sound** - read as a spectrogram and resynthesised, with engine, pitch-range and length controls.',
    'A real **spectrogram image** can be inverted back into sound and analysed, with WAV download.',
    'Microphone and **live-spectrogram** recordings gain a Download button.',
    '**Variable fonts** animate each axis, and the offline bundle grows.',
  ] },
  { range: '5.01 - 5.04', notes: [
    'Every format is tagged **Full, Partial or ID** so you know before dropping what you get.',
    'An unknown file gets a **byte-entropy** strip, and data hidden past its end can be extracted.',
    '**URLs, IPs, domains and emails** in a file are listed with one-click OSINT lookups.',
    'New **forensic flags** - impossible timestamps, mismatched JPEG thumbnails, PDF scripts by trigger.',
    'Documents give up more - **Photoshop layers**, Word ghost authorship, Excel pivot tables, a SQLite query box.',
    '**ASS/SSA subtitles**, Lottie and Telegram stickers, and Autodesk FBX models now open.',
    'Exported reports lead with a **tamper-evident** block and print to PDF.',
  ] },
  { range: '5.0', milestone: true, notes: [
    'Fifth milestone: Analyser brings **broken files** back from the dead and opens professional CAD.',
    'A corrupt **photo** is repaired, and an unfinished **video** with no index is rebuilt frame by frame.',
    '**Fusion 360** and **SolidWorks** designs open as their rendered thumbnail with metadata.',
    'A new **Samples gallery** runs the whole workbench on example files in one click.',
    'Adobe **.look** grades open, every **LUT** previews on a photo, and multi-tool G-code colours each toolhead.',
  ] },
  { range: '4.16 - 4.17', notes: [
    'Shared extensions (a **.pkg** installer or Destiny package) get a guide page with a card per meaning.',
    'The **folder scan** judges files by contents, and recognises more developer and Android formats.',
    'Files that **aren\'t what they claim** are flagged, including data hidden past their end.',
    'The integrity panel adds **MD5, SHA-1 and SHA-512** on demand.',
    '**ZIP archives** gain a timing chart flagging repacked or future-dated entries.',
    'The home page keeps a private **recently-analysed** list, and spreadsheets flag anomalies.',
  ] },
  { range: '4.12 - 4.15', notes: [
    '**KiCad** designs open as interactive drawings with pan, zoom and per-layer toggles.',
    '**SPICE** waveforms and **IPC-D-356** netlists open too.',
    '**Source code** in almost any language opens as readable text.',
    'Hundreds more formats recognised, from **Cyberpunk 2077** and Unity to **ONNX** models.',
  ] },
  { range: '4.08 - 4.11', notes: [
    '**Altium Designer** schematics, boards and libraries open as interactive vector views.',
    'The **G-code** visualiser draws travel moves in order and paints prints in each filament\'s colour.',
    'A **"Show full anyway"** button renders even million-segment prints whole.',
  ] },
  { range: '4.01 - 4.07', notes: [
    'The **stats page** gains a graph of visitors and files over time.',
    '**Colour LUTs** come alive - drop a .cube for its tone curve and 3D cube, then apply it to your photo.',
    '**DaVinci Resolve** .drt timelines read out colour-grade nodes, and Microsoft **.lib** libraries open.',
    'Files with **no extension** open as readable text.',
    '**Font specimens** show a sample for every script, and collections preview each face.',
    'Hundreds more formats - past **1,260** - each with a guide page.',
    'Video gains **Prev/Next frame** buttons.',
  ] },
  { range: '4.0', milestone: true, notes: [
    'Fourth milestone: Analyser steps into **3D**.',
    'A full **G-code visualiser** rebuilds the printed object - orbit it, colour by height or tool, peel by layer, play it building.',
    '**CNC** files list their whole tool table and reconstruct the full toolpath.',
    'A real **3D model viewer** for STL, OBJ, PLY, STEP, 3MF and glTF, with an orientation cube and wireframe.',
  ] },
  { range: '3.45 - 3.46', notes: [
    'The newest **Visual Studio** solution format (.slnx) opens.',
    'Over eighty more file types - more than **1,140** in all.',
    'A sweep of **polish** across the format guide pages.',
  ] },
  { range: '3.37 - 3.44', notes: [
    '**AVCHD** camcorder video (.mts/.m2ts) repackages to MP4 on the fly and plays.',
    'A round of internal **refactoring**, with a parser-crash safeguard.',
  ] },
  { range: '3.30 - 3.36', notes: [
    'Professional **editing projects** open with full timelines - Premiere, DaVinci Resolve, VEGAS.',
    'Sony camera **gyroscope/accelerometer** metadata is plotted, and Gyroflow .gcsv logs open.',
    '**Unity** assets and **Visual Studio** solutions are read.',
    'A rebuilt **About** page with a how-it-works walkthrough and FAQ.',
  ] },
  { range: '3.26 - 3.29', notes: [
    'A wave of **creative apps** - After Effects, Photoshop, Illustrator, Paint.NET and fonts.',
    '**E-books** (Kindle, DjVu), Access databases, AutoCAD, glTF/GLB and binary Excel open too.',
    'Most files show which **program and version** created them.',
    'A go.mod is no longer mistaken for a music module.',
  ] },
  { range: '3.14 - 3.25', notes: [
    'Play **video, sound and animated GIFs/WebP backwards** - and download the result.',
    'Three more image formats - **icons (ICO)**, 3D stereo **(MPO)** and multi-page **TIFF**.',
    '**Volume** controls on every player, synced across the site.',
    'Livelier **font** previews, with per-axis variable-font controls.',
  ] },
  { range: '3.06 - 3.13', notes: [
    'Old **Office** files (97-2003) and **OpenDocument** open as page previews.',
    'Step through an **animated GIF** one frame at a time.',
    'Industrial **CAD** (STEP, IGES, BREP) works fully offline.',
    'High scores appear on the **Stats** page.',
  ] },
  { range: '3.01 - 3.05', notes: [
    'Export any analysis as a **report, JSON or CSV**.',
    '**SQLite** write-ahead logs, **git** internals and Sigma **Foveon RAW** open.',
    'A folder scan flags every file that **won\'t open**.',
    'The **Stats** page is one tap from everywhere.',
  ] },
  { range: '3.0', milestone: true, notes: [
    'Third milestone: camera **RAW** files get a full darkroom.',
    'See every JPEG inside a RAW, decode the sensor data, and pull the **shutter count** from Sony and Nikon.',
  ] },
  { range: '2.35 - 2.39', notes: [
    'Anonymous visitor and analysis **counters**, with new **Stats** and **Privacy** pages.',
    '**PowerPoint** slides open full-size in a lightbox.',
    'A tidier **drop zone**, plus internal tidy-ups.',
  ] },
  { range: '2.30 - 2.34', notes: [
    'Mostly internal **refactoring** and housekeeping.',
    'A fix for a **loading bar** that could stick.',
  ] },
  { range: '2.25 - 2.29', notes: [
    '**Photo, PDF and comic** viewers gain zoom and pan, and Back closes them.',
    '**Android APK** files are read in depth.',
    'Every **format guide** page gains facts and Previous/Next navigation.',
    'The **3D viewer** splits multi-body models into parts.',
  ] },
  { range: '2.20 - 2.24', notes: [
    'A new **Formats** page - every type, grouped and searchable.',
    'Every format gains a plain-language **guide page**, findable by search.',
    'Lighter loads for pages that don\'t open a file.',
  ] },
  { range: '2.15 - 2.19', notes: [
    'A **Share** button and popup.',
    'Smarter folder and ZIP **treemaps**, with filter chips.',
    'The **video sound track** regains its waveform tools.',
  ] },
  { range: '2.09 - 2.14', notes: [
    'Raw **H.264/H.265** camera and dash-cam clips open reliably, split into parts when large.',
    'Clean **web addresses** and a sitemap.',
    'Live **online/offline** status and a suggest-a-format prompt.',
  ] },
  { range: '2.0', milestone: true, notes: [
    'Second milestone: over **120 new file types** across many domains.',
    'Richer **video-editing project** and 10-bit video readouts.',
  ] },
  { range: '1.25 - 1.29', notes: [
    'The **formats popup** was rebuilt - grouped, searchable, badged.',
    'Images **pulled from other files** open with the full photo readout.',
    'Professional **video** the browser can\'t play is named and previewed.',
  ] },
  { range: '1.20 - 1.24', notes: [
    'Hundreds more formats, with new **comic, SQLite and JPEG 2000** viewers.',
    'Many more camera **RAW** formats open.',
    'A site-wide **visual tidy-up**.',
  ] },
  { range: '1.15 - 1.19', notes: [
    'New viewers for **subtitles, MIDI, Markdown and maps**.',
    'Pictures inside **Office, EPUB and PDF** analyse in place.',
    '**Shortcut** files and raw **disk images** decode.',
  ] },
  { range: '1.10 - 1.14', notes: [
    'Music files surface **tags, lyrics and timed .lrc** lyrics.',
    'Plain-language **help notes** beside most readouts.',
    'A **Cancel** button for slow loads, and a richer spectrogram.',
  ] },
  { range: '1.05 - 1.09', notes: [
    'Drop a **folder or ZIP** for an interactive treemap sized by disk use.',
    'The app **updates itself** automatically.',
    'Heavy tools **stream on first use**, then cache offline.',
  ] },
  { range: '1.01 - 1.04', notes: [
    '**OCR** reads 32 languages and the app runs fully **offline**.',
    'A **loading bar** for large files, with deep-linkable format descriptions.',
  ] },
  { range: '1.0', milestone: true, notes: [
    'The big release - Analyser becomes a **document and 3D workstation**.',
    '**Excel, EPUB, PowerPoint and STL** viewers, folder/ZIP trees, and PDF image extraction.',
  ] },
  { range: '0.24 - 0.28', notes: [
    'A new **Word (DOCX)** viewer and **AI-image** detection.',
    'Real metadata from many **proprietary** files.',
    '**Dark mode** follows your system setting.',
  ] },
  { range: '0.19 - 0.23', notes: [
    'Automatic video **scene detection**.',
    'A central **format catalog** drives the list and search.',
    'Inline **help** for audio and photo statistics.',
  ] },
  { range: '0.14 - 0.18', notes: [
    'First **public build**, with an About page and 100+ formats.',
    '**Metadata search**, plus CSV, SVG and unknown-file viewers.',
    'Drop a **folder** for an overview, and analyse **AVI** directly.',
  ] },
  { range: '0.09 - 0.13', notes: [
    'Custom **audio and video players** synced to the spectrogram.',
    'Run full **photo analysis** on any video frame, and decode **RAW** in-browser.',
    'A **nav search** box that jumps to matching results.',
  ] },
  { range: '0.04 - 0.08', notes: [
    '**Video** support and a **dark mode**.',
    'New **PDF, ZIP, SVG and CSV** viewers, and camera **RAW** support.',
    '**Waveform region export** and video frame-stepping.',
  ] },
  { range: '0.01 - 0.03', notes: [
    '**Analyser** launches - on-device file analysis, nothing uploaded.',
    '**Magic-byte ID**, hex dump, SHA-256, photo **EXIF** with a GPS map and **OCR**, and a live audio **spectrogram**.',
  ] },
];

// Tighter digest used by the live /patch page (opted in via data-tldr-variant=
// "new" on the #when section). Same facts as PATCH_DIGEST above, but every note
// is a single normal-length sentence - fewest bullets possible, information
// dense, no fluff, no piled-up semicolons. Milestones (X.0) may run past five
// notes; small ranges stay at one or two. The archived /patch_old page carries
// no marker, so it keeps the original PATCH_DIGEST above.
const PATCH_DIGEST_NEW = [
  { range: '8.16 - 8.19', notes: [
    'Analysing a picture pulled out of a **PDF** now leaves a **Back** bar to the PDF, the same breadcrumb you get when you open a file from inside an archive or a folder.',
    'Every one of the 176 files the app is built from is now **checked far more strictly** before it ships - about 11,400 places where something could have been missing or the wrong shape. The app itself is deliberately unchanged; the point was to make future mistakes fail early instead of in front of you.',
    'One real fix fell out of it: a **document that cannot read one of its inner parts now still shows the rest**, instead of throwing away everything it had already read.',
  ] },
  { range: '8.12 - 8.15', notes: [
    'The on-device **AI separation** finally fits on an **iPhone** - the model is started before the song is copied for it, the frequency workspace is reused instead of rebuilt for every window, and the blend view no longer keeps another full-length copy of the track.',
    'Apple devices download a **smaller AI engine** (about 10 MB instead of 21 MB), because Safari cannot use the graphics-card version at all.',
    'Pressing **Download WAV** on a separated part now saves a file on iPhone, instead of opening a preview or doing nothing.',
    'The first separation pass reads **Starting first separation pass** rather than a percentage it cannot know yet.',
    'The **Complete offline download** grows to about 96 MB, carrying both AI engines so separation stays offline in any browser.',
    'The old **lab.valjdakosta.com** address now forwards to **analyser.valjdakosta.com**, keeping the page you asked for.',
    'Underneath, all **176 files** the app is built from were rewritten in a stricter language, with the shipped code proved identical afterwards.',
  ] },
  { range: '8.07 - 8.11', notes: [
    'The site **moved to analyser.valjdakosta.com** - the old lab.valjdakosta.com address still works and serves the same pages, so nothing saved or installed breaks.',
    'The on-device **AI sound tools** got much harder to break - a stalled graphics card is retried on the compatible engine, a job that stops responding reports a failure instead of hanging for ever, and every model file is checked against its exact size before it is used.',
    'A downloaded **separation model no longer expires after a day** or gets stored twice, and the shared AI engine now survives a site update on its own.',
    'Separation **uses far less memory on a phone** - a separated part is only turned into a sound file when you play or download it - and the vocal/instrumental **blend slider can finally be dragged on an iPhone**.',
    'Asking for **another separation keeps the result you already have** until you confirm the new run, and each progress stage fills the bar in step with its own percentage.',
    'A small **video preview** and the main player no longer play at the same time, and an unfinished four-way split that was never switched on is gone along with its model files.',
  ] },
  { range: '8.05 - 8.06', notes: [
    'Video now reports what is genuinely inside it - exact **codec profile and level**, bit depth, **colour and HDR** detail including Dolby Vision, and every soundtrack and subtitle track in an **MKV** - all read from the picture data rather than from the summary the file gives of itself.',
    'A bare **.h264 or .h265 stream** reads its true frame rate instead of being assumed to run at 25 frames per second, which had been skewing its length and bitrate too.',
  ] },
  { range: '8.01 - 8.04', notes: [
    'The cleaner that handles anything a dropped file wants to display - an email body, a saved web page, an e-book chapter - now strips **animation tricks** that could turn a safe-looking link into a script after the fact, and stops a preview quietly fetching anything from the internet.',
    'The **format search** keeps up with fast typing, and a very large file no longer freezes the page while its fingerprints are worked out.',
    'Opening several **colour LUTs** in a row no longer holds on to every earlier file\'s preview frames.',
    'A **four-stem split** (vocals, drums, bass and a leftover other) now runs entirely in your browser on a desktop, with a **mixing desk** to fade and solo each part while the spectrogram reshapes live.',
    'The **motion (gyro) graph** under a video with motion data now follows the playhead smoothly as it plays, the way the spectrogram already does.',
    'A **long compressed song** (AAC and the like) opens without freezing the page - details, cover art and a player show at once, with the full analysis behind a **Decode and analyse** button.',
    '**AAC** files now read their profile, sample rate, channels and an estimated length and bitrate straight from the audio, without decoding.',
    'The **page stays smooth** while a long file is analysed - the waveform, spectrogram and forensic reads hand control back as they work.',
    'The **touch-tone (DTMF) reader** is fixed - it was keeping only the middle keypad column (2, 5, 8, 0) and dropping every other digit, plus tighter checks against phantom tones and a working **Show tones** button.',
    'A photo\'s **histogram** and **dominant colours** lead its analysis, and its **fingerprints** are back in a card of their own.',
  ] },
  { range: '8.0', milestone: true, notes: [
    'Eighth milestone: analysing a song is close to **nine times quicker** and the page stays smooth throughout, with the heavy sound reads moved onto a background thread.',
    'A new **.xmp sidecar** viewer shows the develop recipe beside a raw photo - tone curve, sliders, colour mixer and crop.',
    '**Touch-tones** were redrawn: the dialled number shown large, a timeline of where the tones fall, and one playable key per tone.',
    '**Circuit boards** (KiCad, Altium) finally open offline, gaining a view cube, auto-rotate and a three-quarter opening angle.',
    'One **strict cleaner** now handles everything a dropped file wants to display - email bodies, saved web pages, e-book chapters and SVGs.',
  ] },
  { range: '7.01 - 7.02', notes: [
    'The deep **Advanced** analysis is gathered into one tidy section and dropped to the **bottom** of every photo, video and sound.',
    'Sound\'s **loudness graph** (EBU R128) becomes playable - a playhead tracks it and you click or drag to seek.',
    'A photo\'s **privacy report** moves up into the main metadata, in plain sight.',
    'The **compare** view reads far better - side-by-side visuals, sub-headings kept with their tables, and a **Show differences** that fades matching panels too.',
    'The **changelog** is split, with older history archived to keep this page quick.',
  ] },
  { range: '7.0', milestone: true, notes: [
    'Seventh milestone: a deep **forensic** pass reads the hidden internals of every photo, video and sound, all in **plain English**.',
    'Photos gain **error-level analysis**, a quantization fingerprint and JPEG ghosts to spot edits.',
    '**Bit-plane / LSB** analysis estimates whether data is hidden in a picture.',
    'A **privacy report** and edit-history trail surface a photo\'s GPS, owner and Photoshop markers.',
    'A **RAW** can be read as its embedded preview or the fully demosaiced sensor image.',
    'Video gains an **Advanced** card with the box tree, tracks, keyframe map and re-save tells.',
    '**GoPro/CAMM telemetry** plots GPS route, motion and exposure.',
    'An **encoder fingerprint** recovers exact x264/x265 settings, HDR, Dolby Vision and C2PA.',
    'A **content-timeline barcode** maps the clip, with converted copies used only for playback.',
    'Sound gains a full **EBU R128** loudness meter, a **fake-lossless** detector and a **musical key** estimate.',
    'Forensic listeners flag **mains hum**, ultrasonic tones and **DTMF**, plus on-device **AI denoise** (DeepFilterNet3).',
    'Every **[?] explanation** was rewritten in plain English and opens a tidy pop-up, with a clear answer for an empty **0-byte** file.',
  ] },
  { range: '6.38 - 6.51', notes: [
    'Long animated **GIFs** and **WebPs** play in full, each frame decoded as you scrub with a rolling window in memory.',
    'A very large **archive or disk image** now scales its limits to your device\'s memory.',
    'Draws the waveform from a **DJI recorder\'s .pkf** overview and identifies Adobe Audition peak caches.',
    'The **See full document** view fixes vanishing dark-mode text and moves its open button up.',
    'A visual tidy squares off every remaining **rounded corner**.',
  ] },
  { range: '6.36 - 6.37', notes: [
    'Opens a raw **disk image** like a folder, mounting its **FAT12/16/32** filesystem into a browsable tree.',
    '**Carves deleted photos** straight from a disk image\'s raw sectors.',
    'A **damaged photo** shows its readable part, or its embedded **thumbnail** if the full image is gone.',
    'Rebuilds a **headerless JPEG** by borrowing a header from a healthy same-camera photo.',
    'Reads Android **app bundles** (XAPK, APKM, APKS) as browsable archives.',
  ] },
  { range: '6.32 - 6.35', notes: [
    'Every **3D model** gets a **Mesh integrity** check for non-manifold edges, holes and whether it is watertight.',
  ] },
  { range: '6.22 - 6.31', notes: [
    'Reads a photo\'s **C2PA Content Credentials** - signing tool, edits, source images and any AI it claims.',
    'A card weighs whether an image is **AI-generated** from generator tags and hidden parameter blocks.',
    'One-click **metadata stripping** with no re-encode, plus a date timeline that flags impossible timestamps.',
    'A browsable **documentation site** with live component examples.',
  ] },
  { range: '6.19 - 6.21', notes: [
    'A full **spreadsheet workbench** under every CSV, Excel and OpenDocument file, all on-device.',
    'Recognises more **date formats**, read day-first unless a value proves it American.',
    'The open-source **readme** was rewritten with screenshots.',
  ] },
  { range: '6.14 - 6.18', notes: [
    'Analyser is a **pure website** again - the desktop and mobile app experiment was retired.',
    'The open-source repo gains a **contributing guide**, security policy and issue templates.',
    'The **waveform selection** becomes an editing tool with resize, move and exact times.',
    'Leaving the home page and returning **restores** your open file, player and results.',
  ] },
  { range: '6.12 - 6.13', notes: [
    'Opens **Java KeyStores** (.jks/.keystore), decoding every certificate inside.',
    'The **desktop and mobile apps** shrink, downloading the AI and OCR packs on first use.',
    '**Clear storage** now spares your downloads.',
  ] },
  { range: '6.08 - 6.11', notes: [
    '**AI vocal separation** now runs on iPhone and Safari instead of crashing the tab.',
    'The **Isolate/Separate** controls stack cleanly on phones.',
    'Lighter default **G-code clips** and a tidier wide-screen edge.',
    'A large internal **reorganisation** of the site and build scripts.',
  ] },
  { range: '6.06 - 6.07', notes: [
    'A broad **robustness and safety** pass so a crafted file can no longer freeze a tab.',
    'Multi-file drops analyse the **first file**, and huge archives bow out gracefully.',
    'The **offline download** and analysed-count survive updates.',
    'The desktop app reads only the **dropped file**.',
  ] },
  { range: '6.01 - 6.05', notes: [
    'Analyser becomes a **desktop app** for Windows, macOS and Linux, auto-updating from GitHub Releases.',
    '**AI vocal separation** adds a lighter phone model, an on/off toggle and a day-long cache.',
    'The **vocal/instrumental blend** plays through the Isolate filters at your exact settings.',
    'The **3D viewer** gains the G-code camera controls.',
    'The **analysed-count** survives going offline.',
  ] },
  { range: '6.0', milestone: true, notes: [
    'Sixth milestone: Analyser pulls a **song apart**, on your device.',
    'A neural network splits any track into **vocal and instrumental stems**, each with its own player and WAV.',
    'A **Vocals-to-Instrumental slider** fades between the two as the spectrogram morphs to the mix.',
    'A brief **branded loading screen** on cold start.',
    'The **Complete offline download** becomes a chooser of optional extras.',
  ] },
  { range: '5.16 - 5.21', notes: [
    'A new **/compare** page runs two files through full analysis and lines up every field, hash and date.',
    'Players can **boost a quiet clip** past 100%, up to 225%, with a limiter.',
    'The **Isolate** tool gains one-tap Vocals, Bass and Drums solos and WAV download.',
    'A large **ZIP** with a deep index now lists every entry.',
    'The **format guide pages** gain full navigation and a licence link per dependency.',
  ] },
  { range: '5.13 - 5.15', notes: [
    'Files the browser can\'t handle get through - **unusual video** converts and undecodable **audio** is rebuilt.',
    'Overlong **PDF previews** cap to a page shape and pan by drag.',
    'Every file now shows a **CRC-32** checksum.',
    'A wide **compatibility** pass opens Office, e-books and comics on older browsers.',
    'Large comics, **DjVu** scans and databases warn on phones instead of crashing.',
  ] },
  { range: '5.08 - 5.12', notes: [
    'The home page becomes one **"drop any file"** zone.',
    'The **G-code viewer** gains a hold-to-zoom pad and scroll-zoom toggle.',
    'A G-code build can be **recorded as MP4** with length, speed and camera moves.',
    'Every viewer now leads with the **render or preview**, details below.',
    'The **After Effects timeline** is rebuilt with true positions, colours and a snapping scrubber.',
    'The spectrogram gains an **Isolate mode** to mute frequency bands, and reaches below 20 Hz.',
  ] },
  { range: '5.05 - 5.07', notes: [
    'Turn any **photo into sound**, read as a spectrogram and resynthesised.',
    'A real **spectrogram image** can be inverted back into sound and analysed.',
    'Microphone and **live-spectrogram** recordings gain a Download button.',
    '**Variable fonts** animate each axis.',
  ] },
  { range: '5.01 - 5.04', notes: [
    'Every format is tagged **Full, Partial or ID** so you know before dropping what you get.',
    'An unknown file gets a **byte-entropy** strip, and data hidden past its end can be extracted.',
    '**URLs, IPs, domains and emails** are listed with one-click OSINT lookups.',
    'New **forensic flags** for impossible timestamps, mismatched JPEG thumbnails and PDF scripts.',
    'Documents give up **Photoshop layers**, Word ghost authorship and Excel pivot tables.',
    '**ASS/SSA subtitles**, Lottie stickers and Autodesk FBX models now open.',
    'Exported reports lead with a **tamper-evident** block.',
  ] },
  { range: '5.0', milestone: true, notes: [
    'Fifth milestone: Analyser brings **broken files** back from the dead and opens professional CAD.',
    'A corrupt **photo** is repaired, and an unfinished **video** with no index is rebuilt frame by frame.',
    '**Fusion 360** and **SolidWorks** designs open as their rendered thumbnail with metadata.',
    'A new **Samples gallery** runs the whole workbench on example files in one click.',
    'Adobe **.look** grades and every **LUT** preview on a photo.',
  ] },
  { range: '4.16 - 4.17', notes: [
    'Shared extensions like a **.pkg** installer get a guide page with a card per meaning.',
    'The **folder scan** judges files by contents and flags ones that aren\'t what they claim.',
    'The integrity panel adds **MD5, SHA-1 and SHA-512** on demand.',
    '**ZIP archives** gain a timing chart flagging repacked or future-dated entries.',
    'The home page keeps a private **recently-analysed** list.',
  ] },
  { range: '4.12 - 4.15', notes: [
    '**KiCad** designs open as interactive drawings with pan, zoom and per-layer toggles.',
    '**SPICE** waveforms and **IPC-D-356** netlists open too.',
    '**Source code** in almost any language opens as readable text.',
    'Hundreds more formats, from **Cyberpunk 2077** to **ONNX** models.',
  ] },
  { range: '4.08 - 4.11', notes: [
    '**Altium Designer** schematics and boards open as interactive vector views.',
    'The **G-code** visualiser draws travel moves and paints each filament\'s colour.',
    'A **"Show full anyway"** button renders even million-segment prints.',
  ] },
  { range: '4.01 - 4.07', notes: [
    'The **stats page** gains a graph of visitors and files over time.',
    '**Colour LUTs** come alive - drop a .cube for its curve and 3D cube, then apply it to a photo.',
    '**DaVinci Resolve** timelines read out colour-grade nodes.',
    'Files with **no extension** open as readable text.',
    '**Font specimens** show a sample for every script.',
    'Hundreds more formats, past **1,260**, each with a guide page.',
    'Video gains **Prev/Next frame** buttons.',
  ] },
  { range: '4.0', milestone: true, notes: [
    'Fourth milestone: Analyser steps into **3D**.',
    'A full **G-code visualiser** rebuilds the printed object to orbit, colour and peel by layer.',
    '**CNC** files list their whole tool table and reconstruct the toolpath.',
    'A real **3D model viewer** for STL, OBJ, PLY, STEP, 3MF and glTF.',
  ] },
  { range: '3.45 - 3.46', notes: [
    'The newest **Visual Studio** solution format (.slnx) opens.',
    'Over eighty more file types, past **1,140** in all.',
    'A sweep of **polish** across the format guide pages.',
  ] },
  { range: '3.37 - 3.44', notes: [
    '**AVCHD** camcorder video repackages to MP4 on the fly and plays.',
    'A round of internal **refactoring** with a parser-crash safeguard.',
  ] },
  { range: '3.30 - 3.36', notes: [
    'Professional **editing projects** open with full timelines - Premiere, Resolve, VEGAS.',
    'Sony camera **gyroscope** metadata is plotted, and Gyroflow logs open.',
    '**Unity** assets and **Visual Studio** solutions are read.',
    'A rebuilt **About** page with a walkthrough and FAQ.',
  ] },
  { range: '3.26 - 3.29', notes: [
    'A wave of **creative apps** - After Effects, Photoshop, Illustrator and fonts.',
    '**E-books**, Access databases, AutoCAD and glTF/GLB open too.',
    'Most files show which **program and version** created them.',
    'A go.mod is no longer mistaken for a music module.',
  ] },
  { range: '3.14 - 3.25', notes: [
    'Play **video, sound and animated GIFs/WebP backwards**, and download the result.',
    'Three more image formats - **icons (ICO)**, stereo **(MPO)** and multi-page **TIFF**.',
    '**Volume** controls on every player, synced across the site.',
    'Livelier **font** previews with per-axis variable controls.',
  ] },
  { range: '3.06 - 3.13', notes: [
    'Old **Office** files and **OpenDocument** open as page previews.',
    'Step through an **animated GIF** one frame at a time.',
    'Industrial **CAD** (STEP, IGES, BREP) works fully offline.',
    'High scores appear on the **Stats** page.',
  ] },
  { range: '3.01 - 3.05', notes: [
    'Export any analysis as a **report, JSON or CSV**.',
    '**SQLite** logs, **git** internals and Sigma **Foveon RAW** open.',
    'A folder scan flags every file that **won\'t open**.',
    'The **Stats** page is one tap from everywhere.',
  ] },
  { range: '3.0', milestone: true, notes: [
    'Third milestone: camera **RAW** files get a full darkroom.',
    'See every JPEG inside a RAW, decode the sensor, and pull the **shutter count** from Sony and Nikon.',
  ] },
  { range: '2.35 - 2.39', notes: [
    'Anonymous visitor and analysis **counters**, with new **Stats** and **Privacy** pages.',
    '**PowerPoint** slides open full-size in a lightbox.',
    'A tidier **drop zone**.',
  ] },
  { range: '2.30 - 2.34', notes: [
    'Mostly internal **refactoring** and housekeeping.',
    'A fix for a **loading bar** that could stick.',
  ] },
  { range: '2.25 - 2.29', notes: [
    '**Photo, PDF and comic** viewers gain zoom and pan.',
    '**Android APK** files are read in depth.',
    'Every **format guide** page gains facts and navigation.',
    'The **3D viewer** splits multi-body models into parts.',
  ] },
  { range: '2.20 - 2.24', notes: [
    'A new **Formats** page - every type, grouped and searchable.',
    'Every format gains a plain-language **guide page**.',
    'Lighter loads for pages that don\'t open a file.',
  ] },
  { range: '2.15 - 2.19', notes: [
    'A **Share** button and popup.',
    'Smarter folder and ZIP **treemaps** with filter chips.',
    'The **video sound track** regains its waveform tools.',
  ] },
  { range: '2.09 - 2.14', notes: [
    'Raw **H.264/H.265** camera and dash-cam clips open reliably.',
    'Clean **web addresses** and a sitemap.',
    'Live **online/offline** status and a suggest-a-format prompt.',
  ] },
  { range: '2.0', milestone: true, notes: [
    'Second milestone: over **120 new file types** across many domains.',
    'Richer **video-editing project** and 10-bit video readouts.',
  ] },
  { range: '1.25 - 1.29', notes: [
    'The **formats popup** was rebuilt - grouped, searchable, badged.',
    'Images **pulled from other files** open with the full photo readout.',
    'Professional **video** the browser can\'t play is named and previewed.',
  ] },
  { range: '1.20 - 1.24', notes: [
    'Hundreds more formats, with new **comic, SQLite and JPEG 2000** viewers.',
    'Many more camera **RAW** formats open.',
    'A site-wide **visual tidy-up**.',
  ] },
  { range: '1.15 - 1.19', notes: [
    'New viewers for **subtitles, MIDI, Markdown and maps**.',
    'Pictures inside **Office, EPUB and PDF** analyse in place.',
    '**Shortcut** files and raw **disk images** decode.',
  ] },
  { range: '1.10 - 1.14', notes: [
    'Music files surface **tags, lyrics and timed .lrc** lyrics.',
    'Plain-language **help notes** beside most readouts.',
    'A **Cancel** button for slow loads.',
  ] },
  { range: '1.05 - 1.09', notes: [
    'Drop a **folder or ZIP** for an interactive treemap sized by disk use.',
    'The app **updates itself** automatically.',
    'Heavy tools **stream on first use**, then cache offline.',
  ] },
  { range: '1.01 - 1.04', notes: [
    '**OCR** reads 32 languages and the app runs fully **offline**.',
    'A **loading bar** for large files.',
  ] },
  { range: '1.0', milestone: true, notes: [
    'The big release - Analyser becomes a **document and 3D workstation**.',
    '**Excel, EPUB, PowerPoint and STL** viewers, folder/ZIP trees, and PDF image extraction.',
  ] },
  { range: '0.24 - 0.28', notes: [
    'A new **Word (DOCX)** viewer and **AI-image** detection.',
    'Real metadata from many **proprietary** files.',
    '**Dark mode** follows your system setting.',
  ] },
  { range: '0.19 - 0.23', notes: [
    'Automatic video **scene detection**.',
    'A central **format catalog** drives the list and search.',
    'Inline **help** for audio and photo statistics.',
  ] },
  { range: '0.14 - 0.18', notes: [
    'First **public build**, with an About page and 100+ formats.',
    '**Metadata search**, plus CSV, SVG and unknown-file viewers.',
    'Drop a **folder** for an overview, and analyse **AVI** directly.',
  ] },
  { range: '0.09 - 0.13', notes: [
    'Custom **audio and video players** synced to the spectrogram.',
    'Run full **photo analysis** on any video frame, and decode **RAW** in-browser.',
    'A **nav search** box that jumps to matching results.',
  ] },
  { range: '0.04 - 0.08', notes: [
    '**Video** support and a **dark mode**.',
    'New **PDF, ZIP, SVG and CSV** viewers, and camera **RAW** support.',
    '**Waveform region export** and video frame-stepping.',
  ] },
  { range: '0.01 - 0.03', notes: [
    '**Analyser** launches - on-device file analysis, nothing uploaded.',
    '**Magic-byte ID**, hex dump, SHA-256, photo **EXIF** with GPS and **OCR**, and a live audio **spectrogram**.',
  ] },
];

// Render a digest note: HTML-escape it, then turn **keyword** into
// <strong>keyword</strong>. Content is author-controlled static text, but the
// escape keeps any stray <, > or & literal before the emphasis pass runs.
function emphasise(text: string) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// Wire the changelog "tl;dr" button: build the condensed digest once (release
// groups, each with a few short notes), then toggle a class that hides the full
// entry list and the "Older updates" fold and shows the digest in their place.
// Re-runs per navigation; guarded on the button element so it binds only once.
export function setupPatchTldr() {
  const section = document.getElementById('when');
  const btn = document.getElementById('tldrToggle');
  if (!section || !btn || btn._tldrBound) return;
  btn._tldrBound = true;

  // The live /patch page opts into the tighter digest via data-tldr-variant="new"
  // on the #when section; the archived /patch_old (no marker) keeps PATCH_DIGEST.
  const digestData = section.dataset.tldrVariant === 'new' ? PATCH_DIGEST_NEW : PATCH_DIGEST;

  if (!section.querySelector('.patch-digest')) {
    const digest = el('div', { class: 'patch-digest' });
    digestData.forEach((g) => {
      const group = el('div', { class: 'patch-digest-group' + (g.milestone ? ' is-milestone' : '') });
      group.appendChild(el('p', { class: 'patch-digest-range' }, g.range));
      const ul = el('ul', { class: 'patch-digest-list' });
      g.notes.forEach((n) => ul.appendChild(el('li', { html: emphasise(n) })));
      group.appendChild(ul);
      digest.appendChild(group);
    });
    // Insert just before the first patch entry, within the entry's own parent
    // (the entries are nested inside .section-content, not direct children of #when).
    const firstEntry = section.querySelector('.patch-entry');
    if (firstEntry) firstEntry.parentNode!.insertBefore(digest, firstEntry);
    else section.appendChild(digest);
  }

  btn.addEventListener('click', () => {
    const on = section.classList.toggle('tldr-mode');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-active', on);
  });
}
