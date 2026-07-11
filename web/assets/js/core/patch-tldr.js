/* Analyser - changelog "tl;dr" digest.
   The whole patch history condensed into release groups, and the button wiring
   that swaps the full changelog entry list for this digest on /patch. Only
   setupPatchTldr is exported; PATCH_DIGEST is its private data. */

import { el } from './util.js';

// Changelog "tl;dr" digest - the whole history condensed into release groups of
// five (every X.0 milestone kept on its own via milestone:true), each with a few short notes
// on what was new, no specifics unless they really matter. The tl;dr button
// (setupPatchTldr) hides the full entry list and shows this instead. Newest first.
// When you add a patch: extend the newest group's notes, or - once that group holds
// five versions - start a new group above it (and never fold an X.0 milestone into a range).
const PATCH_DIGEST = [
  { range: '6.12 - 6.13', notes: [
    'Java KeyStores (.jks / .keystore) now open up: Analyser lists each entry - its name, whether it holds a private key or a trusted certificate, and when it was created - and decodes every certificate inside (issued to and by, validity and SHA-256 fingerprint), including today\'s PKCS#12-based keystores.',
    'The desktop and mobile apps get smaller: the AI vocal-separation model and the 30+ OCR language packs now download on first use, like the website, instead of being carried inside - the Android app especially, with everyday analysis and the video, audio and 3D engines still fully offline.',
    'Clear storage now clears only your history and app data, keeping everything you have downloaded or that came bundled; and reading text in other languages now works in the apps, not just the website.',
  ] },
  { range: '6.08 - 6.11', notes: [
    'AI vocal separation now runs on iPhone and Safari instead of crashing the tab - it takes the steady, well-supported path there, while Chrome and Edge keep the fast graphics-card path.',
    'The spectrogram Isolate/Separate controls now stack cleanly on a phone, and Clear storage spares the large AI model if you have an offline download saved, so offline separation keeps working.',
    'A tidier page edge on very wide screens, a lighter default for recorded G-code clips (Standard quality, 30fps, with High and Max a tap away), and the desktop app now adds to the anonymous analysed-count.',
    'Behind the scenes: a large internal reorganisation of the site and its build scripts, with nothing changed for you.',
  ] },
  { range: '6.06 - 6.07', notes: [
    'A broad robustness and safety pass: a corrupt or crafted file can no longer freeze a tab, and previews of documents, e-mail, presentations, drawings, maps, diagrams and vector images are kept strictly inert.',
    'Dropping several files at once now analyses just the first; a viewer that hits an error shows a clear message with the fingerprint still available; and very large archives or G-code files bow out gracefully instead of risking a crash.',
    'The offline download and the anonymous analysed-count now survive updates and reloads reliably, and previews across many formats release their memory once hidden.',
    'The desktop app now only reads the file you actually drop onto it, and the Asteroids high-score board is marked as just for fun (scores are unverified).',
  ] },
  { range: '6.01 - 6.05', notes: [
    'Analyser is now a desktop app for Windows, macOS and Linux - the same on-device engine, installable and auto-updating, downloadable from GitHub Releases.',
    'AI vocal separation adds a lighter phone-friendly model (the default on mobile), a model prompt to choose Standard or Lite on every run, an on/off toggle, and keeps the downloaded model for a day.',
    'The vocal/instrumental blend now plays through the Isolate filters and redraws at your exact FFT/window settings, so the blended spectrogram is as truthful as the original.',
    'The 3D model viewer gains the G-code viewer\'s camera controls: a press-and-hold zoom pad, a scroll-to-zoom toggle and a fullscreen button.',
    'Your anonymous "a file was analysed" count now survives going offline; the samples page tidies its list behind a "+ More" reveal; and fixes land for the offline picker\'s invisible tap-blocking layer, high-contrast readability and the volume popup closing too soon.',
  ] },
  { range: '6.0', milestone: true, notes: [
    'Sixth milestone: Analyser pulls a song apart, entirely on your device.',
    'A neural network (the MDX-Net "Kim Vocal 2" model) runs in the browser to split any track into separate vocal and instrumental stems - nothing is uploaded, and each stem gets its own player, spectrogram and WAV download.',
    'A Vocals-to-Instrumental slider under the spectrogram fades between the two while the picture morphs in real time to the exact mix, and the play control follows your chosen blend with every scrubber in step.',
    'A brief branded loading screen greets a cold start and fades away the moment the app is ready.',
    'The Complete offline download opens a chooser: the OCR language packs and the AI separation model are now separate optional downloads on top of Everything, so you can grab just what you need.',
  ] },
  { range: '5.16 - 5.21', notes: [
    'A new /compare page runs two dropped files through the full analysis and lines up every field, hash and date side by side, with a Show differences toggle.',
    'Audio and video players can push a too-quiet clip past 100%, up to 225%, with a limiter to keep the boost clean; the level resets to 100% on every fresh visit.',
    'The spectrogram Isolate tool gains one-tap Vocals, Bass and Drums solos and a stereo Remove vocals option, and the isolated result can be downloaded as a WAV.',
    'A large ZIP archive whose file index sits deep in the file now lists every entry, and the stats page charts respond to a tap on a phone.',
    'The G-code viewer’s "dim other tools" highlight now cross-fades smoothly on a tool change, and a build defaults to a fixed 30-second playback instead of real time.',
    'The per-format guide pages had a fact-checking pass and gain the full site navigation, and the footer credits gain a licence link beside every open-source dependency.',
  ] },
  { range: '5.13 - 5.15', notes: [
    'Files the browser cannot play or read on its own now get through: an unusual camera video is offered as a one-tap conversion, and audio it cannot decode is rebuilt so it plays instead of loading silent.',
    'Overlong PDF page previews are capped to a page shape and an open page can be dragged to pan, the G-code clip fades its dimmed tools back in, and the After Effects timeline scrollbar can be grabbed.',
    'Every file now shows a CRC-32 checksum alongside its other fingerprints.',
    'A wide compatibility pass: Office, e-book and comic archives open on older Safari, Firefox and Chrome, PDF and document zoom works in Firefox, some HEVC video plays there too, and the 3D and G-code viewers no longer blank out after opening several models.',
    'Very large comics, DjVu scans and databases now warn on a phone instead of crashing the tab.',
    'A recorded G-code clip exports at a higher bitrate by default, with a new Standard/High/Max quality choice so the thin toolpath lines stay crisp.',
  ] },
  { range: '5.08 - 5.12', notes: [
    'The home page becomes a single "drop any file" zone, and multi-channel sound can be analysed one channel at a time.',
    'The G-code viewer gains a press-and-hold zoom pad, a scroll-zoom toggle and a tidier fullscreen.',
    'A G-code build can be recorded as an MP4 video - choose its length, speed, aspect, quality and camera moves - and downloaded to keep or share.',
    'Exported clips now play and send everywhere, including WhatsApp, and the export panel goes fullscreen on phones.',
    'Every viewer now leads with the actual render, preview or file tree, with the technical details below.',
    'The After Effects project timeline is rebuilt: layers sit at their true positions, take their real label colours and type glyphs, and a frame-snapping scrubber shows the timecode under the cursor.',
    'The Sound spectrogram gains an Isolate mode: drag across it or type an exact range to mute those frequency bands from playback and shade them on the view, with the playhead still scrubbable.',
    'Image to sound previews every setting live on the picture (with a [?] guide and an Analyse WAV button), and the spectrogram now reaches below 20 Hz.',
    'A recorded G-code clip rushes its setup moves past in the opening second, so the clip spends its time on the real build.',
  ] },
  { range: '5.05 - 5.07', notes: [
    'Turn any photo into sound: it is read as a spectrogram and resynthesised, with a choice of engine, an adjustable pitch range and a length up to three minutes.',
    'A real spectrogram image can be inverted back into the sound it depicts, then run through the full Sound analysis with a WAV download.',
    'Microphone and live-spectrogram recordings gain a Download button.',
    'Variable fonts animate each axis on their own, the Samples gallery adds the Fraunces variable font, and the offline download bundles more formats.',
  ] },
  { range: '5.01 - 5.04', notes: [
    'Every format is tagged Full, Partial or ID, so you can see before dropping a file whether it opens in a complete viewer, a preview, or is just identified.',
    'An unknown file gets a byte-entropy strip showing where its data turns random, and data hidden after a file\'s real end can be extracted.',
    'URLs, IPs, domains and emails found in a file are listed with one-click OSINT lookups.',
    'New forensic flags: impossible photo and PDF timestamps, a JPEG thumbnail that no longer matches the full image, and a PDF\'s embedded scripts traced by trigger.',
    'Documents give up more: Photoshop layers export to PNG, Word flags ghost authorship, Excel lists pivot tables, and a SQLite database gains a query box.',
    'ASS/SSA subtitles render with their real styling, Lottie and Telegram stickers play with a timeline, and Autodesk FBX models open in 3D.',
    'Exported reports lead with a tamper-evident verification block and can be printed straight to PDF.',
  ] },
  { range: '5.0', milestone: true, notes: [
    'Fifth milestone: Analyser brings broken files back from the dead and opens professional CAD.',
    'A truncated or corrupt photo is repaired, and an unfinished video with no playable index is rebuilt frame by frame.',
    'Autodesk Fusion 360 and SolidWorks designs open, shown as their rendered thumbnail with the document type and metadata.',
    'A new Samples gallery runs the whole workbench on built-in example files in one click.',
    'Adobe .look colour grades open, every LUT previews on a sample photo, and multi-tool G-code marks each toolhead in its own colour.',
  ] },
  { range: '4.16 - 4.17', notes: [
    'Extensions shared by unrelated formats (a .pkg installer or a Destiny package) get a guide page with a self-contained card for each meaning.',
    'The folder scan judges each file by its contents, not just its name, and recognises more developer and Android/Samsung formats.',
    'Files that are not what they claim are flagged on open, including data hidden after a file\'s real end.',
    'A file\'s integrity panel adds MD5, SHA-1 and SHA-512 fingerprints on demand, alongside SHA-256.',
    'ZIP archives gain a timing chart that flags repacked or future-dated entries, plus a stored-checksum check.',
    'The home page keeps a private on-device list of recently analysed files, and spreadsheets flag statistical anomalies.',
  ] },
  { range: '4.12 - 4.15', notes: [
    'KiCad circuit designs open as interactive drawings with pan, zoom and per-layer toggles, tying a schematic to its board.',
    'SPICE simulation waveforms and IPC-D-356 fabrication netlists open too.',
    'Source code in almost any language opens as readable text, along with build, shader and configuration files.',
    'Hundreds more formats are recognised, from Cyberpunk 2077 and Unity game files to ONNX machine-learning models.',
  ] },
  { range: '4.08 - 4.11', notes: [
    'Altium Designer schematics, boards and libraries open as interactive vector views with pan, zoom and per-layer toggles.',
    'The G-code visualiser draws travel moves in true order and paints multi-material prints in each filament\'s real colour.',
    'A "Show full anyway" button renders even million-segment prints whole, with detail scaled to your device.',
  ] },
  { range: '4.01 - 4.07', notes: [
    'The stats page gained a graph of visitors and files over time, switchable between per-day and cumulative.',
    'Colour look-up tables come alive: drop a .cube to see its tone curve and 3D colour cube, then apply the look to your own photo or video.',
    'DaVinci Resolve .drt timelines read out each clip\'s colour-grade node chain, and Microsoft .lib libraries open.',
    'Files with no extension open as readable text, with a prompt to reopen them as a known format.',
    'Font specimens show a sample sentence for every script a font covers, and collections preview each face inside.',
    'Hundreds more formats are recognised, past 1,260 in all, each with its own guide page.',
    'Video gains Prev/Next frame buttons that step exactly one frame at a time.',
  ] },
  { range: '4.0', milestone: true, notes: [
    'Fourth milestone: Analyser steps into 3D.',
    'A full G-code visualiser rebuilds the printed or machined object - orbit it, colour by height or tool, peel it back by layer, and play it building move by move.',
    'CNC milling files list their whole tool table and reconstruct the full toolpath faithfully.',
    'A real 3D model viewer for STL, OBJ, PLY, STEP, 3MF and glTF, with a grabbable orientation cube and wireframe mode.',
  ] },
  { range: '3.45 - 3.46', notes: [
    'The newest Visual Studio solution format (.slnx) opens, listing every project, language and build configuration.',
    'Over eighty more file types are recognised - more than 1,140 in all - with a new group for the niche and rare ones.',
    'A sweep of polish across the format guide pages and small consistency fixes throughout.',
  ] },
  { range: '3.37 - 3.44', notes: [
    'AVCHD camcorder video opens and plays: .mts and .m2ts clips are repackaged into a browser-friendly MP4 on the fly, picture untouched.',
    'A round of internal refactoring - dead code removed, shared helpers consolidated, a parser-crash safeguard, and CSS and theme set-up tidied.',
  ] },
  { range: '3.30 - 3.36', notes: [
    'Professional editing projects open with their full timeline: Adobe Premiere Pro and Elements, DaVinci Resolve and VEGAS Pro.',
    'Sony camera gyroscope and accelerometer metadata is decoded and plotted, and Gyroflow .gcsv motion logs open.',
    'Unity game-engine assets and Visual Studio solutions are read.',
    'A rebuilt About page with a how-it-works walkthrough and FAQ, plus a sweep of internal tidy-ups.',
  ] },
  { range: '3.26 - 3.29', notes: [
    'A wave of creative apps open: After Effects projects with a zoomable layer timeline, plus Photoshop, Illustrator, Paint.NET and fonts.',
    'E-books (Kindle, DjVu), Access databases, AutoCAD drawings, glTF/GLB 3D, binary Excel and PowerShell/batch scripts now open too.',
    'Most files now show which program and version created them - After Effects, audio and video encoders, SVG and EPUB.',
    'A go.mod manifest is no longer mistaken for a music module, and the offline-download panel folds away once it is saved.',
  ] },
  { range: '3.14 - 3.25', notes: [
    'Play video, sound, and animated GIFs and WebP backwards - and download the reversed result.',
    'Three more image formats open: icons (ICO), 3D stereo photos (MPO) and multi-page TIFFs, each showing every image inside.',
    'Volume controls on every player, kept in sync across the site.',
    'Livelier font previews, with a slider and play button for every variable-font axis, plus support for UFO .glif glyph sources.',
  ] },
  { range: '3.06 - 3.13', notes: [
    'Old Office files (Word, Excel, PowerPoint 97-2003) and OpenDocument files now open as page-by-page previews.',
    'Step through an animated GIF one frame at a time.',
    'Industrial CAD models (STEP, IGES, BREP) now work fully offline.',
    'High scores can now be seen on the Stats page.',
  ] },
  { range: '3.01 - 3.05', notes: [
    'Export any analysis as a self-contained report, a JSON data file, or a CSV.',
    'SQLite write-ahead logs, git repository internals and Sigma Foveon RAW now open.',
    'A folder scan flags every file that will not open - unrecognised types included - and checks HEIC photos far faster.',
    'The Stats page is one tap from every page, and exported reports now capture the whole analysis.',
  ] },
  { range: '3.0', milestone: true, notes: [
    'Third milestone: camera RAW files get a full darkroom.',
    'See every JPEG baked inside a RAW, decode the real sensor data, read the true resolution, and pull the shutter count out of Sony and Nikon files.',
  ] },
  { range: '2.35 - 2.39', notes: [
    'Anonymous visitor and file-analysis counters, with new Stats and Privacy pages.',
    'PowerPoint slides now open full-size in a lightbox.',
    'A tidier drop zone, plus internal tidy-ups.',
  ] },
  { range: '2.30 - 2.34', notes: [
    'Mostly internal refactoring and housekeeping.',
    'A fix for a loading bar that could stick on screen.',
  ] },
  { range: '2.25 - 2.29', notes: [
    'Photo, PDF and comic viewers gained zoom and pan, and Back now closes them.',
    'Android APK files are read in depth.',
    'Every format guide page gained researched facts and Previous/Next navigation.',
    'The 3D viewer splits multi-body models into separate parts.',
  ] },
  { range: '2.20 - 2.24', notes: [
    'A new Formats page listing every supported type, grouped and searchable.',
    'Every format gained its own plain-language guide page, findable by web search.',
    'Lighter loads for pages that do not open a file.',
  ] },
  { range: '2.15 - 2.19', notes: [
    'A Share button and popup for passing Analyser on.',
    'Smarter folder and ZIP treemaps, with filter chips and collapsing of huge folders.',
    'The video sound track regained its full waveform tools.',
  ] },
  { range: '2.09 - 2.14', notes: [
    'Raw H.264 and H.265 camera and dash-cam clips open reliably, split into parts when large.',
    'Clean web addresses and a sitemap so links and search engines resolve.',
    'Live online/offline status and a spam-safe suggest-a-format prompt.',
  ] },
  { range: '2.0', milestone: true, notes: [
    'Second milestone: over 120 new file types identified across many domains.',
    'Richer video-editing project and 10-bit video readouts, with clearer banners for files the browser cannot show.',
  ] },
  { range: '1.25 - 1.29', notes: [
    'The supported-formats popup was rebuilt - grouped, searchable, with badges.',
    'Images pulled from other files open with the full photo readout.',
    'Professional video the browser cannot play is named and previewed.',
  ] },
  { range: '1.20 - 1.24', notes: [
    'Hundreds more formats recognised, with new comic book, SQLite and JPEG 2000 viewers.',
    'Many more camera RAW formats open with full analysis.',
    'A site-wide visual tidy-up.',
  ] },
  { range: '1.15 - 1.19', notes: [
    'New viewers for subtitles, MIDI, Markdown and map data.',
    'Pictures inside Office, EPUB and PDF files can be analysed in place.',
    'Shortcut files and raw disk images are decoded.',
  ] },
  { range: '1.10 - 1.14', notes: [
    'Music files surface their tags, lyrics and timed .lrc lyrics.',
    'Plain-language help notes appear beside most readouts.',
    'A Cancel button for slow loads, and a richer spectrogram.',
  ] },
  { range: '1.05 - 1.09', notes: [
    'Drop a folder or ZIP for an interactive treemap sized by disk use.',
    'The app updates itself automatically.',
    'Heavy tools stream on first use, then cache for offline use.',
  ] },
  { range: '1.01 - 1.04', notes: [
    'OCR reads 32 languages and the app runs fully offline.',
    'A loading bar for large files, with deep-linkable format descriptions.',
  ] },
  { range: '1.0', milestone: true, notes: [
    'The big release - Analyser becomes a document and 3D workstation.',
    'Excel, EPUB, PowerPoint and STL viewers, folder and ZIP trees, and PDF image extraction.',
  ] },
  { range: '0.24 - 0.28', notes: [
    'A new Word (DOCX) viewer and AI-image detection.',
    'Real metadata from many proprietary files.',
    'Dark mode follows your system setting.',
  ] },
  { range: '0.19 - 0.23', notes: [
    'Automatic video scene detection.',
    'A central format catalog drives the supported-types list and search.',
    'Inline help for audio and photo statistics.',
  ] },
  { range: '0.14 - 0.18', notes: [
    'First public build, with an About page and over 100 formats identified.',
    'Metadata search, plus CSV, SVG and unknown-file viewers.',
    'Drop a folder for an overview, and analyse AVI directly.',
  ] },
  { range: '0.09 - 0.13', notes: [
    'Custom audio and video players synced to the spectrogram.',
    'Run full photo analysis on any video frame, and decode RAW photos in-browser.',
    'A nav search box that jumps to matching results.',
  ] },
  { range: '0.04 - 0.08', notes: [
    'Video support and a dark mode.',
    'New PDF, ZIP, SVG and CSV viewers, and camera RAW support.',
    'Waveform region export and video frame-stepping.',
  ] },
  { range: '0.01 - 0.03', notes: [
    'Analyser launches - on-device file analysis with nothing uploaded.',
    'Magic-byte identification, hex dump, SHA-256, photo EXIF with a GPS map and OCR, and a live audio spectrogram.',
  ] },
];

// Wire the changelog "tl;dr" button: build the condensed digest once (release
// groups, each with a few short notes), then toggle a class that hides the full
// entry list and the "Older updates" fold and shows the digest in their place.
// Re-runs per navigation; guarded on the button element so it binds only once.
export function setupPatchTldr() {
  const section = document.getElementById('when');
  const btn = document.getElementById('tldrToggle');
  if (!section || !btn || btn._tldrBound) return;
  btn._tldrBound = true;

  if (!section.querySelector('.patch-digest')) {
    const digest = el('div', { class: 'patch-digest' });
    PATCH_DIGEST.forEach((g) => {
      const group = el('div', { class: 'patch-digest-group' + (g.milestone ? ' is-milestone' : '') });
      group.appendChild(el('p', { class: 'patch-digest-range' }, g.range));
      const ul = el('ul', { class: 'patch-digest-list' });
      g.notes.forEach((n) => ul.appendChild(el('li', {}, n)));
      group.appendChild(ul);
      digest.appendChild(group);
    });
    // Insert just before the first patch entry, within the entry's own parent
    // (the entries are nested inside .section-content, not direct children of #when).
    const firstEntry = section.querySelector('.patch-entry');
    if (firstEntry) firstEntry.parentNode.insertBefore(digest, firstEntry);
    else section.appendChild(digest);
  }

  btn.addEventListener('click', () => {
    const on = section.classList.toggle('tldr-mode');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-active', on);
  });
}
