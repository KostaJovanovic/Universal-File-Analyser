/* Analyser - entry point
   - Boots photo + audio + video modules
   - Acts as the page-wide drop target (until the first file lands)
   - Classifies dropped files into photo / audio / video / unknown
   - Renders a basic dump for unknown formats
   ============================================================================
   THE FILE-TYPE MACHINERY - WHERE EVERYTHING LIVES

   This file is the spine, so the map starts here. Each of these carries its own
   instructions in its header; read the one you are about to edit.

     core/formats.ts              THE CATALOG. Routing extension sets, the
                                  display/search rows, category mapping,
                                  EXT_VARIANTS. Drives the overlay, the about
                                  tables, search and the /formats pages.
     core/classify.ts             classifyFile(): name/MIME -> a ROUTES key.
                                  Deliberately does NO byte sniffing.
     core/app.ts (here)           resolveKind() layers byte-level reroutes on
                                  top; ROUTES maps a kind to a renderer;
                                  handleFile() runs the pipeline;
                                  renderFileExtras() wraps the shared cards.
     core/file-sniff.ts           Magic-byte identification. What rescues a file
                                  whose extension is missing or lying.
     renderers/proprietary-formats.ts  The identification catalog (data only).
     renderers/proprietary.ts     The identification renderer + the built-in
                                  parser dispatch.
     parsers/parsers-<chunk>.ts   Lazy metadata parsers, 15 domains. The parser
                                  contract is in parsers/parser-util.ts.
     core/limits.ts               EVERY size/memory/enumeration cap. Never
                                  hardcode a new threshold outside it.

   Which path does a change take?
     - Another extension of an existing kind  -> formats.ts alone.
     - Identify a format + read its header    -> formats.ts + proprietary-formats.ts
                                                 + a parser in its chunk.
     - It deserves its own viewer             -> formats.ts + classify.ts + the
                                                 ROUTES checklist below.
     - One extension, two unrelated formats   -> EXT_VARIANTS (formats.ts) +
                                                 VARIANT_REROUTE (below).
     - No extension, or the extension lies    -> file-sniff.ts.

   Edit src/, never web/assets/js/ - that tree is tsc output and is overwritten
   on every build, so an edit there is silently lost. src/ edits do nothing until
   `npm run build` recompiles.
   ============================================================================ */
const COMMIT_COUNT = 299;
// Versioning: every commit is its own version. Pre-1.0 commits read 0.01, 0.02,
// 0.03 … (the part after the dot is the commit's 1-based position, zero-padded to
// two digits - 0.09, 0.10, 0.11). Each commit listed in RELEASE_COMMITS bumps the
// major version and resets the counter within its era: commit 29 reads "1.0" (and
// 30 → "1.01"), commit 60 reads "2.0", commit 100 reads "3.0" (and 101 → "3.01"),
// commit 151 reads "4.0", commit 173 reads "5.0", commit 195 reads "6.0" and commit
// 250 reads "7.0" and commit 256 reads "8.0". To crown a future 9.0, append its
// commit number here (keep the
// list sorted ascending, and mirror the RELEASES constant in save.bat).
const RELEASE_COMMITS = [29, 60, 100, 151, 173, 195, 250, 256];
function analyserVersion(n, releases) {
    let major = 0, base = 0;
    for (const r of releases) {
        if (n >= r) {
            major += 1;
            base = r;
        }
        else
            break;
    }
    if (major === 0)
        return '0.' + String(n).padStart(2, '0');
    const minor = n - base;
    return major + '.' + (minor === 0 ? '0' : String(minor).padStart(2, '0'));
}
// photo/audio/video are the heaviest renderers and pull the largest dependency
// chains (spectrogram, codecs, frame tools, recovery, ...). They are imported
// DYNAMICALLY - their routes via lazy() below, their dropzone init via import() in
// boot() - so that whole subtree stays out of the initial critical module graph and
// the page becomes interactive sooner. See the media-init block in boot().
import { renderArchive, renderArchiveEmbedded } from '../renderers/archive.js';
import { renderUnknown } from '../renderers/unknown.js';
import { renderProprietary, extractPeIcon } from '../renderers/proprietary.js';
import { renderSpiceRaw, sniffSpiceRaw } from '../renderers/spice.js';
import { initSearch } from './search.js';
import { fileExt, el, row, fmtBytes, probeReadable, cloudFileWarning, emptyFileWarning, integrityCard, errorCard } from './util.js';
import { walkItems, renderFolder } from '../renderers/folder.js';
import { setupHeaderFx, setupSectionFx, setupFooterFx } from './effects.js';
import { setupStatsPage } from './stats-page.js';
import { sniffFileType, resolveByContent, isReadableText } from './file-sniff.js';
import { signatureCheck, signatureCard, trailingDataCheck, trailingCard, findIntegrityCard, setReanalyse } from './forensics.js';
import { anrConfirm, showDropLoader, hideDropLoader, setDropLoaderLabel, showTypeSuggestion, hideTypeSuggestion, showLinkConfirm } from './overlays.js';
import { setupPatchTldr } from './patch-tldr.js';
import { setupOfflineTiers } from './offline-tiers.js';
import { setupFormatOverlay } from './format-overlay.js';
import { classifyFile } from './classify.js';
import { recordAnalysed, recordHistory, recordFolderHistory, renderHistoryPanel, recordVisit, clearHistory } from './history.js';
import { showSuggestPopup, hideSuggestPopup, scheduleShareNudge, hideShareNudge, wireShareButtons, wireFooterContact, updateNetStatus } from './popups.js';
import { wireExportButton } from './export-data.js';
import { PHOTO_EXTS, formatPageHref, hasFormatPage, detectVariant } from './formats.js';
function $(id) { return document.getElementById(id); }
// Transient overlay UI (anrConfirm, drop loader, type-suggestion, link-confirm)
// lives in ./overlays.js - imported at the top of this file.
// ---------- file classification ----------
// Extension sets live in formats.js (the central catalog). See that file to
// add a new type - the overlay, about page, and search update automatically.
// Lightweight-markup / source document formats rendered as selectable text.
// Extensions that name more than one unrelated format and whose classifyFile()
// route (by extension alone) is tuned for the COMMON variant - so a file that is
// actually the OTHER variant would be fed to the wrong viewer (TypeScript .ts to
// the video player, NetCDF .nc to the G-code viewer). For each, `primary` is the
// variant the default renderer handles (from EXT_VARIANTS) and `to` is the safe
// fallback kind when the bytes prove a different variant: 'plaintext' for a
// text/source variant, 'unknown' for a binary one (hex + identify). detectVariant()
// (in formats.js) is the single source of truth for which variant the bytes are.
// One extension, two unrelated formats. The variants themselves are declared in
// EXT_VARIANTS in core/formats.ts (the single source of truth, which also drives
// the /formats/<ext> page); this table is only the drop-time consequence: when
// detectVariant() proves the file is NOT `primary` - the variant the default
// route already handles - send it to `to` instead. Add the variant there first,
// then a row here only if the wrong renderer would otherwise get the file.
const VARIANT_REROUTE = {
    ts: { primary: 'MPEG transport stream', to: 'plaintext' }, // TypeScript source
    dts: { primary: 'DTS audio', to: 'plaintext' }, // Device Tree Source
    key: { primary: 'Apple Keynote presentation', to: 'plaintext' }, // PEM key (text)
    obj: { primary: 'Wavefront 3D model', to: 'unknown' }, // compiled object (binary)
    nc: { primary: 'CNC G-code', to: 'unknown' }, // NetCDF (binary)
    md: { primary: 'Markdown document', to: 'unknown' }, // Mega Drive ROM (binary)
    mat: { primary: 'Unity material', to: 'unknown' }, // MATLAB MAT-file (binary)
    mod: { primary: 'Tracker module', to: 'unknown' }, // JVC camcorder video (MPEG-2)
    ase: { primary: 'Aseprite sprite', to: 'proprietary' }, // Adobe Swatch Exchange
    wld: { primary: 'Esri world file', to: 'terraria' }, // Terraria world save
};
// A dotenv secrets file: `.env` or any `.env.<environment>` sibling
// (.env.local, .env.production, …). These routinely hold API keys, database
// passwords and access tokens in plaintext, so we flag them with a loud "never
// share this" warning. The example/template/sample siblings are meant to be
// committed and carry no real secrets, so they're deliberately excluded.
function isEnvFile(name) {
    const n = (name || '').toLowerCase().replace(/^.*[\\/]/, ''); // basename
    if (!/^\.env(\.|$)/.test(n))
        return false;
    return !/\.(example|sample|template|dist|defaults?)$/.test(n);
}
// The red "never share this" banner shown above a dotenv file's analysis.
function envSecretWarning(file) {
    const box = el('div', { class: 'anr-env-warning', role: 'alert' });
    box.appendChild(el('div', { class: 'anr-env-warning-title' }, 'Never share this file with anyone, ever'));
    box.appendChild(el('p', { class: 'anr-env-warning-body' }, [
        'This looks like a ',
        el('code', {}, file.name || '.env'),
        ' secrets file. It typically stores API keys, database passwords and access ' +
            'tokens in plaintext. Do not post it in chat, email, screenshots, an issue or ' +
            'a public repo - anyone who gets it can impersonate you and take over your ' +
            'accounts and services. If this file has already been shared, rotate every ' +
            'secret inside it now.',
    ]));
    return box;
}
// The full routing resolution handleFile performs, minus the DOM work: start from
// classifyFile (extension/MIME), then the same byte-sniffing reroutes - the SPICE
// .raw disambiguation, the ambiguous-extension VARIANT_REROUTE, and (crucially)
// resolveByContent for 'unknown'/'extensionless', which is what turns a PDF/ZIP/
// image with no recognised extension into its real kind. classifyFile alone
// returns 'unknown' for a .pdf, so anything that routes without this (e.g. the
// compare view) would fall to the hex-dump renderer. Async; returns a kind key.
async function resolveKind(file) {
    let kind = classifyFile(file);
    if (kind === 'photo' && fileExt(file.name) === 'raw') {
        try {
            if (await sniffSpiceRaw(file))
                kind = 'spice';
        }
        catch (_) { }
    }
    const vr = VARIANT_REROUTE[fileExt(file.name)];
    if (vr) {
        try {
            const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
            let txt = '';
            for (let i = 0; i < head.length; i++)
                txt += String.fromCharCode(head[i]);
            const vname = detectVariant(fileExt(file.name), head, txt);
            if (vname && vname !== vr.primary)
                kind = vr.to;
        }
        catch (_) { }
    }
    if (kind === 'unknown' || kind === 'extensionless') {
        try {
            const r = await resolveByContent(file);
            if (r.kind && r.kind !== 'unknown')
                kind = r.kind;
        }
        catch (_) { }
    }
    return kind;
}
// Map a sniffed container extension to its browse-as-archive descriptor
// ({ mode, label }), or null when it isn't a browsable archive/compressed stream.
// Single source for the choice handleFile and renderFileExtras (the compare/folder
// parity path) both make, so a new container type is wired in exactly one place.
function pickArchiveEmbed(ext) {
    if (ext === 'zip')
        return { mode: 'zip', label: 'ZIP' };
    if (ext === 'rar')
        return { mode: 'libarchive', label: 'RAR' };
    if (ext === '7z')
        return { mode: 'libarchive', label: '7-Zip' };
    // ar / static & import library (.a / .lib): browsed by our own ar walk.
    if (ext === 'a')
        return { mode: 'ar', label: 'Library' };
    // TAR + the single-stream compressors: libarchive reads tar/tarballs, and a bare
    // .gz/.xz/.zst/.lz4/.lzma/.Z stream is decompressed to open the file inside (bare
    // .bz2 is identified only - no in-browser decoder).
    if (['tar', 'gz', 'xz', 'zst', 'bz2', 'lz4', 'lzma', 'z'].includes(ext)) {
        const NICE = { gz: 'GZIP', zst: 'Zstandard', bz2: 'BZIP2', lzma: 'LZMA', z: 'compress (.Z)' };
        return { mode: 'compressed', label: NICE[ext] || ext.toUpperCase() };
    }
    return null;
}
// The per-file "extras" handleFile renders AROUND the core renderer: the dotenv
// secrets warning, the signature-vs-extension and trailing-data forensic cards,
// and the browse-as-archive tree for files that are physically a zip/rar/7z (APK,
// JAR, DOCX, ...). Factored out so the compare view renders the same depth as a
// normal single-file analysis. Renders into `container`; `kind` gates the archive
// embed exactly as handleFile does (skip media, the dedicated ZIP view, Fusion360).
async function renderFileExtras(file, container, kind) {
    if (!container)
        return;
    const media = kind === 'photo' || kind === 'audio' || kind === 'video';
    try {
        if (isEnvFile(file.name))
            container.insertBefore(envSecretWarning(file), container.firstChild);
        const sniff = await sniffFileType(file);
        const sig = await signatureCheck(file, sniff);
        if (sig)
            container.insertBefore(signatureCard(sig), container.firstChild);
        // Guarantee an Integrity card (mirrors handleFile) so every compared file - even
        // an archive/APK whose renderer builds none - has its fingerprint, and so the
        // "Integrity above all else" hoist always has a card to lift.
        if (!findIntegrityCard(container))
            container.appendChild(integrityCard(file));
        const trail = await trailingDataCheck(file, sniff);
        if (trail) {
            const tCard = trailingCard(trail, file);
            const integ = findIntegrityCard(container);
            if (integ)
                container.insertBefore(tCard, integ);
            else
                container.appendChild(tCard);
        }
        if (sniff && !media && kind !== 'zip' && kind !== 'f3d') {
            const embed = pickArchiveEmbed(sniff.ext);
            if (embed)
                await renderArchiveEmbedded(file, container, embed);
        }
        // Shared forensic timestamp timeline (all file types) - hidden unless the file
        // carries two or more timestamps or a provably inconsistent one. Lazy so its
        // zip.js dependency stays off the critical module graph.
        try {
            const { forensicTimelineCard } = await import('../renderers/timeline-forensic.js');
            const tlCard = await forensicTimelineCard(file);
            if (tlCard)
                container.appendChild(tlCard);
        }
        catch (_) { /* timeline is best-effort */ }
    }
    catch (_) { /* extras are best-effort - never break the core analysis */ }
}
// kind → how to route it. `results` names the container (the three media kinds
// get their own section + nav flash + scroll; everything else funnels into
// unknownResults). `nav`/`analysed` list the nav links and sections to mark.
//
// ADDING A NEW TOP-LEVEL KIND - the full checklist, in order:
//   1. renderers/newtype.ts exporting
//      `export async function renderNewtype(file: File, resultsEl: HTMLElement)`.
//      Async, and it draws into the element it is handed. Nothing else.
//   2. A classifyFile() case in core/classify.ts returning the new kind string.
//      Read the ordering warning in that function first - a recognised extension
//      with a real renderer must be matched BEFORE the generic image/ audio/
//      video/ MIME shortcuts, or a vendor MIME hijacks the route.
//   3. One row here: `newtype: { render: lazy('../renderers/newtype.js', 'renderNewtype') }`.
//      Use lazy() - it keeps the module out of the initial graph.
//   4. The EMITTED path in the SHELL array in web/sw.js
//      ('assets/js/renderers/newtype.js', not the .ts source path). Missing from
//      that list the module silently breaks offline use, and check-shell only
//      reports it at commit time, non-fatally.
//   5. A line in the inventory in src/CLAUDE.md - that file is the map the next
//      session reads first, and it drifts silently otherwise.
// Skipping 4 or 5 leaves no build-time error, which is exactly why they are here.
// Each kind maps to a renderer. `results` names the on-page section the renderer
// draws into; it defaults to 'unknown' (the generic #unknownResults block) in the
// dispatch, so only photo/audio/video - which target their own sections and light
// up their own nav links - need the full config. Everything else is just a render fn.
// Lazily import a renderer module on first dispatch and call its export, so the
// long-tail viewers (office, CAD, EDA, NLE, 3D, e-book, ...) are NOT in the initial
// module graph - only the file type actually dropped is fetched. The hot-path
// renderers (photo/audio/video/archive/proprietary/unknown/folder/compare) stay
// statically imported above. import() of an already-cached module is instant offline.
const lazy = (p, name) => (...args) => import(p).then((m) => m[name](...args));
const ROUTES = {
    photo: { render: lazy('../renderers/photo.js', 'renderPhoto'), results: 'photo', nav: ['#photo'], analysed: ['photo'] },
    audio: { render: lazy('../renderers/audio.js', 'renderAudio'), results: 'audio', nav: ['#audio'], analysed: ['audio'] },
    video: { render: lazy('../renderers/video.js', 'renderVideo'), results: 'video', nav: ['#video', '#audio', '#photo'], analysed: ['video', 'photo'] },
    docx: { render: lazy('../renderers/docx.js', 'renderDocx') },
    xlsx: { render: lazy('../renderers/xlsx.js', 'renderXlsx') },
    xlsb: { render: lazy('../renderers/xlsb.js', 'renderXlsb') },
    epub: { render: lazy('../renderers/epub.js', 'renderEpub') },
    pptx: { render: lazy('../renderers/pptx.js', 'renderPptx') },
    odt: { render: lazy('../renderers/odf.js', 'renderOdt') },
    ods: { render: lazy('../renderers/odf.js', 'renderOds') },
    odp: { render: lazy('../renderers/odf.js', 'renderOdp') },
    odg: { render: lazy('../renderers/odf.js', 'renderOdg') },
    doc: { render: lazy('../renderers/legacy-office.js', 'renderDoc') },
    xls: { render: lazy('../renderers/legacy-office.js', 'renderXls') },
    ppt: { render: lazy('../renderers/legacy-office.js', 'renderPpt') },
    rtf: { render: lazy('../renderers/textdoc.js', 'renderRtf') },
    abw: { render: lazy('../renderers/textdoc.js', 'renderAbw') },
    fb2: { render: lazy('../renderers/textdoc.js', 'renderFb2') },
    hwpx: { render: lazy('../renderers/textdoc.js', 'renderHwpx') },
    mhtml: { render: lazy('../renderers/textdoc.js', 'renderMhtml') },
    markup: { render: lazy('../renderers/textdoc.js', 'renderMarkup') },
    notebook: { render: lazy('../renderers/notebook.js', 'renderNotebook') },
    har: { render: lazy('../renderers/dataview.js', 'renderHar') },
    jsondata: { render: lazy('../renderers/dataview.js', 'renderJsonData') },
    nfo: { render: lazy('../renderers/dataview.js', 'renderNfo') },
    eml: { render: lazy('../renderers/email.js', 'renderEml') },
    mbox: { render: lazy('../renderers/email.js', 'renderMbox') },
    drawio: { render: lazy('../renderers/diagram.js', 'renderDrawio') },
    dxf: { render: lazy('../renderers/diagram.js', 'renderDxf') },
    dwg: { render: lazy('../renderers/dwg.js', 'renderDwg') },
    altium: { render: lazy('../renderers/altium.js', 'renderAltium') },
    kicad: { render: lazy('../renderers/kicad.js', 'renderKicad') },
    spice: { render: renderSpiceRaw },
    ipcnet: { render: lazy('../renderers/ipcnet.js', 'renderIpcNetlist') },
    aep: { render: lazy('../renderers/aftereffects.js', 'renderAep') },
    premiere: { render: lazy('../renderers/premiere.js', 'renderPremiere') },
    davinci: { render: lazy('../renderers/davinci.js', 'renderDavinci') },
    vegas: { render: lazy('../renderers/vegas.js', 'renderVegas') },
    daw: { render: lazy('../renderers/daw.js', 'renderDaw') },
    mlmodel: { render: lazy('../renderers/mlmodel.js', 'renderMlModel') },
    molecule: { render: lazy('../renderers/molecule.js', 'renderMolecule') },
    ifc: { render: lazy('../renderers/ifc.js', 'renderIfc') },
    unity: { render: lazy('../renderers/unity.js', 'renderUnity') },
    vssolution: { render: lazy('../renderers/vssolution.js', 'renderVsSolution') },
    lut: { render: lazy('../renderers/lut.js', 'renderLut') },
    xmp: { render: lazy('../renderers/xmp.js', 'renderXmp') },
    gcsv: { render: lazy('../renderers/gcsv.js', 'renderGcsv') },
    iwork: { render: lazy('../renderers/iwork.js', 'renderIwork') },
    stl: { render: lazy('../renderers/stl.js', 'renderStl') },
    model3d: { render: lazy('../renderers/model3d.js', 'renderModel3d') },
    f3d: { render: lazy('../renderers/f3d.js', 'renderF3d') },
    solidworks: { render: lazy('../renderers/solidworks.js', 'renderSolidworks') },
    gcode: { render: lazy('../renderers/gcode.js', 'renderGcode') },
    timeline: { render: lazy('../renderers/timeline.js', 'renderTimeline') },
    lrc: { render: lazy('../renderers/lrc.js', 'renderLrc') },
    midi: { render: lazy('../renderers/midi.js', 'renderMidi') },
    subtitles: { render: lazy('../renderers/subtitles.js', 'renderSubtitles') },
    geo: { render: lazy('../renderers/geo.js', 'renderGeo') },
    markdown: { render: lazy('../renderers/markdown.js', 'renderMarkdown') },
    comic: { render: lazy('../renderers/comic.js', 'renderComic') },
    paint: { render: lazy('../renderers/paint.js', 'renderPaint') },
    psd: { render: lazy('../renderers/psd.js', 'renderPsd') },
    aseprite: { render: lazy('../renderers/aseprite.js', 'renderAseprite') },
    xcf: { render: lazy('../renderers/xcf.js', 'renderXcf') },
    sketch: { render: lazy('../renderers/sketch.js', 'renderSketch') },
    tracker: { render: lazy('../renderers/tracker.js', 'renderTrackerModule'), results: 'audio', nav: ['#audio'], analysed: ['audio'] },
    terraria: { render: lazy('../renderers/terraria.js', 'renderTerraria') },
    ai: { render: lazy('../renderers/illustrator.js', 'renderAi') },
    font: { render: lazy('../renderers/font.js', 'renderFont') },
    djvu: { render: lazy('../renderers/djvu.js', 'renderDjvu') },
    mdb: { render: lazy('../renderers/mdb.js', 'renderMdb') },
    mobi: { render: lazy('../renderers/mobi.js', 'renderMobi') },
    pdf: { render: lazy('../renderers/pdf.js', 'renderPdf') },
    zip: { render: renderArchive },
    diskimage: { render: lazy('../renderers/diskimage.js', 'renderDiskImage') },
    svg: { render: lazy('../renderers/svg.js', 'renderSvg') },
    lottie: { render: lazy('../renderers/lottie.js', 'renderLottie') },
    csv: { render: lazy('../renderers/csv.js', 'renderCsv') },
    proprietary: { render: renderProprietary },
    // Licence / marker text files open exactly like a .txt - the Plain Text view in
    // proprietary.js (metadata, line count, source preview + the "Open full" reader),
    // not the paginated markup page-sheets.
    plaintext: { render: (f, r) => renderProprietary(f, r, 'txt') },
    'git-object': { render: lazy('../renderers/gitobject.js', 'renderGitObject') },
    unknown: { render: renderUnknown },
    // Extensionless files: same inspector as 'unknown' but framed as an expected
    // category (shown as text, hex fallback for binary) rather than "unrecognised".
    extensionless: { render: (f, r) => renderUnknown(f, r, { extensionless: true }) },
};
// ---------- page-wide drag-drop ----------
function hasFiles(e) {
    const t = e.dataTransfer && e.dataTransfer.types;
    if (!t)
        return false;
    for (let i = 0; i < t.length; i++)
        if (t[i] === 'Files')
            return true;
    return false;
}
let _handleFile = null;
let _scrollHandler = null;
let _alignSoundNav = null;
// Changelog "tl;dr" digest (PATCH_DIGEST + setupPatchTldr) lives in
// ./patch-tldr.js - imported at the top of this file.
// exifr (74 KB) is only needed when a photo or video is actually analysed, which
// only ever happens on the home page. Rather than ship a static <script> tag on
// every page (about/patch/formats and the 100+ per-format landing pages never
// touch it), inject it on demand the first time the analysis pipeline needs it.
// Idempotent and cached; resolves instantly once loaded. The script is precached
// by the service worker, so the first lazy load is offline-safe and near-instant.
let _exifrPromise = null;
function ensureExifr() {
    if (window.exifr)
        return Promise.resolve(window.exifr);
    if (_exifrPromise)
        return _exifrPromise;
    _exifrPromise = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = '/assets/vendor/exifr.umd.js';
        s.onload = () => resolve(window.exifr);
        s.onerror = () => {
            _exifrPromise = null;
            console.warn('exifr failed to load; photo/video metadata will be missing.');
            resolve(null);
        };
        document.head.appendChild(s);
    });
    return _exifrPromise;
}
function boot() {
    // Fade out the boot splash (index.html only) now that the app's JS is running.
    // Runs first so a later setup error can't leave the page covered; the element is
    // removed after the fade so it can't trap clicks, and it's a harmless no-op on
    // other pages and on SPA re-boots (it's gone after the first dismiss).
    const splashEl = document.getElementById('splash');
    if (splashEl) {
        requestAnimationFrame(() => splashEl.classList.add('is-done'));
        splashEl.addEventListener('transitionend', () => splashEl.remove(), { once: true });
    }
    const photoResults = $('photoResults');
    const audioResults = $('audioResults');
    const videoResults = $('videoResults');
    const unknownResults = $('unknownResults');
    const pageDropEl = $('pageDrop');
    let firstFileLoaded = false;
    let dragCounter = 0;
    // Token for the load currently in flight. Cancelling marks it so the
    // (uncancellable) renderer's output is suppressed and the loader stays hidden.
    let _currentToken = null;
    // Reset the result containers, preview slots, and nav/section state back to
    // the pre-load layout. Shared by a fresh load and by cancelLoad().
    function clearResultsUI() {
        // Stop any still-playing media before we detach it below. innerHTML = ''
        // removes an <audio>/<video> node but a *detached* HTMLMediaElement keeps
        // playing - and most players on the site (music, video, reversed, sonified,
        // the muted-video PCM companion) ultimately sound through one - so without
        // this the previous file's audio carries on over a newly imported file.
        document.querySelectorAll('audio, video').forEach((m) => { try {
            m.pause();
        }
        catch (_) { } });
        // Playback that runs through raw Web Audio instead of a media element (the AI
        // vocal/instrumental blend plays buffer sources straight to the destination)
        // isn't stopped by pausing elements, so each such player registers a stopper
        // here. Run them all, then clear - the incoming file's renderer re-registers.
        if (window._anrMediaStoppers) {
            for (const stop of window._anrMediaStoppers) {
                try {
                    stop();
                }
                catch (_) { }
            }
            window._anrMediaStoppers.clear();
        }
        photoResults.innerHTML = '';
        photoResults.hidden = true;
        audioResults.innerHTML = '';
        audioResults.hidden = true;
        videoResults.innerHTML = '';
        videoResults.hidden = true;
        unknownResults.innerHTML = '';
        unknownResults.hidden = true;
        // Clear preview slots
        for (const id of ['photoPreview', 'photoOcrSlot', 'photoHistSlot', 'videoPreview']) {
            const slot = $(id);
            if (slot)
                slot.innerHTML = '';
        }
        // Reset the mobile post-analysis layout (heading moved into the meta card,
        // lede hidden) so a fresh file starts from the default section layout.
        ['photo', 'audio', 'video'].forEach((id) => {
            const sec = $(id);
            if (sec)
                sec.classList.remove('is-analysed');
        });
        // Clear nav indicators and re-enable the media nav links (a fresh load
        // re-disables them if the new file isn't photo/audio/video - see handleFile).
        document.querySelectorAll('.nav-link.has-data').forEach(link => link.classList.remove('has-data'));
        document.querySelectorAll('.nav-link.is-disabled').forEach(link => link.classList.remove('is-disabled'));
        // Hide the "About .EXT files" footer link until the next analysis fills it.
        const guideCta = $('formatGuideCta');
        if (guideCta)
            guideCta.hidden = true;
    }
    // --- Drill-down breadcrumb (folder / zip / archive -> nested file) ---------
    // Opening a file from a container view replaces the results, so we keep a stack
    // of restore closures - one per level - and show a Back bar that re-renders the
    // parent container one level at a time. Container renderers (folder.js,
    // archive.js) call window._anrPushNav right before they open a child; a fresh
    // top-level load calls resetNav so the breadcrumb never leaks across drops.
    const navStack = [];
    function refreshBackBar() {
        const bar = $('anrBackBar');
        if (!bar)
            return;
        const top = navStack[navStack.length - 1];
        if (top) {
            const lbl = bar.querySelector('.anr-back-label');
            if (lbl)
                lbl.textContent = top.label;
            bar.hidden = false;
        }
        else {
            bar.hidden = true;
        }
    }
    function resetNav() { navStack.length = 0; refreshBackBar(); }
    function popNav() {
        const frame = navStack.pop();
        refreshBackBar();
        if (!frame)
            return;
        clearResultsUI();
        try {
            frame.restore();
        }
        catch (_) { }
        const sec = unknownResults.closest('.section') || unknownResults;
        requestAnimationFrame(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    // Exposed for the container renderers, which run in their own modules.
    window._anrPushNav = (label, restore) => { navStack.push({ label, restore }); refreshBackBar(); };
    window._anrResetNav = resetNav;
    const backBarEl = $('anrBackBar');
    if (backBarEl && !backBarEl._wired) {
        backBarEl._wired = true;
        backBarEl.addEventListener('click', popNav);
    }
    // Once a file is loaded the three pick-a-file dropzones are redundant, so swap
    // them for a single "Analyse next file?" button that reloads to a fresh page.
    function showAnalyseNext() {
        const grid = document.querySelector('.quickdrop');
        const btn = $('analyseNext');
        const jump = $('scrollToData');
        const exp = $('exportData');
        if (grid)
            grid.hidden = true;
        if (btn)
            btn.hidden = false;
        if (jump)
            jump.hidden = false;
        if (exp)
            exp.hidden = false;
    }
    function restoreQuickdrop() {
        const grid = document.querySelector('.quickdrop');
        const btn = $('analyseNext');
        const jump = $('scrollToData');
        const exp = $('exportData');
        if (grid)
            grid.hidden = false;
        if (btn)
            btn.hidden = true;
        if (jump)
            jump.hidden = true;
        if (exp)
            exp.hidden = true;
        document.body.classList.remove('anr-has-file'); // un-invert the nav back to normal
    }
    // Folder/zip overviews are rendered directly (not via handleFile), so they must
    // run the same "a file is loaded" UI transition handleFile does: hide the three
    // dropzones (swap in "Analyse next file?"), invert the nav, and drop the
    // full-page drop overlay. Without this the dropzones stay on screen behind the
    // overview.
    function enterLoadedUI() {
        firstFileLoaded = true;
        document.body.classList.add('anr-has-file');
        if (pageDropEl)
            pageDropEl.hidden = true;
        showAnalyseNext();
        // A folder/ZIP overview is not itself photo/audio/video, so collapse the three
        // numbered media explainer sections (01/02/03) and grey out their nav links -
        // exactly what handleFile does for any non-media file. They reappear when a
        // file picked FROM the overview is analysed and turns out to be media.
        ['photo', 'audio', 'video'].forEach((id) => { const sec = $(id); if (sec)
            sec.hidden = true; });
        ['#photo', '#audio', '#video'].forEach((href) => {
            const link = document.querySelector('.site-nav a[href="' + href + '"]');
            if (link)
                link.classList.add('is-disabled');
        });
        document.body.classList.remove('anr-nav-live');
    }
    // Jump to the first analysed section. Results elements are hidden+emptied until
    // a renderer populates them, so the first visible .anr-results with children is
    // the first section with data (document order: unknown, photo, audio, video).
    function scrollToFirstData() {
        for (const res of document.querySelectorAll('.anr-results')) {
            if (!res.hidden && res.childElementCount > 0) {
                (res.closest('.section') || res).scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
        }
    }
    // Stop the in-flight load: drop its results and restore the empty page state
    // (the three analysis sections are explainer sections - visible by default).
    function cancelLoad(token) {
        if (!token || token.cancelled)
            return;
        token.cancelled = true;
        if (_currentToken === token)
            _currentToken = null;
        clearResultsUI();
        resetNav();
        restoreQuickdrop();
        ['photo', 'audio', 'video'].forEach((id) => { const sec = $(id); if (sec)
            sec.hidden = false; });
    }
    async function handleFile(file, opts) {
        if (!file)
            return;
        // opts carries either a forced type ({kind, ext}, from the sniff popup) or a
        // paired RAW develop-settings sidecar ({sidecarXmp}, from a RAW+XMP drop).
        const force = (opts && opts.kind) ? opts : null;
        const sidecarXmp = (opts && opts.sidecarXmp) || null;
        // Opened from a folder/zip/document view: bytes are already in memory and the
        // render beats the loader's 160ms debounce, so show the bar immediately.
        const nested = !!(opts && opts.nested);
        // Sandboxed sample (clicked from the /samples gallery): analyse it fully, but
        // never count it in the public stats and never log it to the local history -
        // samples are a demo, kept completely separate from real user analyses.
        const isSample = !!(opts && opts.sample);
        // Replaying an already-counted analysis after an SPA round trip back to home
        // (see window._anrRestore below) - must not re-count stats/history or re-nudge.
        const isRestore = !!(opts && opts.restore);
        if (!nested)
            resetNav(); // a fresh top-level drop ends any drill-down breadcrumb
        hideTypeSuggestion();
        hideSuggestPopup(); // clear any "suggest this format" nudge from a prior file
        hideShareNudge(); // and any pending/visible "share this" nudge
        // If the "Supported formats" overlay is open, drop/paste/pick dismisses it.
        const fmtOv = $('fmtOverlay');
        if (fmtOv && !fmtOv.hidden) {
            if (fmtOv._backClose)
                fmtOv._backClose();
            else {
                fmtOv.hidden = true;
                document.body.style.overflow = '';
            }
        }
        const token = { cancelled: false };
        _currentToken = token;
        showDropLoader(file, () => cancelLoad(token), undefined, nested);
        clearResultsUI();
        firstFileLoaded = true;
        document.body.classList.add('anr-has-file'); // flips the primary nav to its inverted colours
        if (pageDropEl)
            pageDropEl.hidden = true;
        showAnalyseNext();
        // Probe that the bytes are actually readable before any renderer tries. A
        // cloud-only file (OneDrive/iCloud/etc.) whose sync app can't hydrate it has
        // a valid name+size but throws on read - show a clear warning instead of a
        // generic "could not read" from deep inside a renderer. Any throw from the
        // probe means the bytes aren't available (sync app off, online-only, or
        // permission lost), whatever the exact DOMException name/message - a renderer
        // would only fail the same way, so treat every probe error as unavailable.
        // An empty (0-byte) file passes every read probe - there's simply nothing to
        // read - but then makes every renderer fail deep in its pipeline with a
        // cryptic "unexpected end of data" or a blank result. Intercept it here and
        // explain plainly. (Not counted in stats/history: it isn't a real analysis.)
        if (file.size === 0) {
            hideDropLoader();
            unknownResults.hidden = false;
            unknownResults.innerHTML = '';
            const card = el('div', { class: 'anr-card' });
            card.appendChild(el('h3', {}, 'Empty file'));
            card.appendChild(emptyFileWarning(file));
            unknownResults.appendChild(card);
            return;
        }
        const readErr = await probeReadable(file);
        if (token.cancelled)
            return; // cancelled while probing - don't render
        if (readErr) {
            hideDropLoader();
            unknownResults.hidden = false;
            unknownResults.innerHTML = '';
            const card = el('div', { class: 'anr-card' });
            card.appendChild(el('h3', {}, 'File unavailable'));
            card.appendChild(cloudFileWarning(file));
            unknownResults.appendChild(card);
            showSuggestPopup(fileExt(file.name)); // couldn't load - nudge to suggest the format
            return;
        }
        let kind = force ? force.kind : classifyFile(file);
        // An extension sniffed from the file's bytes (not its name) when it has none -
        // e.g. a git blob holding an HTML page. Threaded into extOverride below so the
        // proprietary renderer knows the real type.
        let sniffedExt = null;
        // A .raw file classifies as a camera RAW photo by extension, but ngspice /
        // LTspice simulation dumps share it. Sniff the header and reroute the SPICE
        // waveform files to their own viewer before the photo pipeline takes them.
        if (!force && kind === 'photo' && fileExt(file.name) === 'raw') {
            try {
                const isSpice = await sniffSpiceRaw(file);
                if (token.cancelled)
                    return;
                if (isSpice)
                    kind = 'spice';
            }
            catch (_) { }
        }
        // Ambiguous-extension reroute: classifyFile() routes these by extension to the
        // common variant's viewer, so sniff the bytes and divert a file that is really
        // the OTHER variant (a TypeScript .ts, a NetCDF .nc, ...) to a safe view rather
        // than the wrong heavy renderer. See VARIANT_REROUTE / detectVariant().
        const _vr = !force && VARIANT_REROUTE[fileExt(file.name)];
        if (_vr) {
            try {
                const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
                if (token.cancelled)
                    return;
                let txt = '';
                for (let i = 0; i < head.length; i++)
                    txt += String.fromCharCode(head[i]);
                const vname = detectVariant(fileExt(file.name), head, txt);
                if (vname && vname !== _vr.primary)
                    kind = _vr.to;
            }
            catch (_) { }
        }
        // For files classified as 'unknown' or 'extensionless', resolve the true type
        // from the bytes (PDF/ZIP/image/git/CSV/the niche game+dev magics) via the
        // shared resolver, so a recognised type auto-routes even with no (or a wrong)
        // extension. Nothing recognised: keep the original kind - 'extensionless'
        // still renders as text below, 'unknown' as a hex dump.
        if (!force && (kind === 'unknown' || kind === 'extensionless')) {
            const r = await resolveByContent(file);
            if (token.cancelled)
                return;
            if (r.kind && r.kind !== 'unknown') {
                kind = r.kind;
                if (r.sniffedExt)
                    sniffedExt = r.sniffedExt;
            }
        }
        // Offer to re-analyse as the sniffed true type when the file has no extension
        // or its extension disagrees with its actual content. Shown as a popup once
        // the normal (extension-based) analysis has rendered.
        let suggestion = null;
        // When the file is physically a zip/rar/7z container, browse-as-archive is
        // appended under its primary analysis (set here, rendered after it settles).
        let archiveEmbed = null;
        // Forensic checks prepended above the analysis below: signature-vs-extension
        // mismatch and data appended past the file's logical end.
        let sigCheck = null;
        let trailCheck = null;
        if (!force) {
            try {
                const sniff = await sniffFileType(file);
                if (token.cancelled)
                    return;
                sigCheck = await signatureCheck(file, sniff);
                if (token.cancelled)
                    return;
                trailCheck = await trailingDataCheck(file, sniff);
                if (token.cancelled)
                    return;
                const noExt = !fileExt(file.name);
                const zipFamily = new Set(['docx', 'xlsx', 'pptx', 'epub', 'zip', 'comic', 'odt', 'ods', 'odp', 'odg', 'hwpx', 'iwork']);
                const offerable = noExt || kind === 'unknown' || kind === 'proprietary'
                    || kind === 'photo' || kind === 'audio' || kind === 'video';
                if (sniff && sniff.kind !== kind && !(sniff.kind === 'zip' && zipFamily.has(kind)) && offerable) {
                    suggestion = sniff;
                }
                // Browse-as-archive: any non-media file that really is a zip/rar/7z (and
                // isn't already the dedicated ZIP tree view) gets the archive browser
                // appended below its normal results.
                const mediaKind = kind === 'photo' || kind === 'audio' || kind === 'video';
                // Fusion 360 (.f3d/.f3z) is physically a Zstd ZIP, but its members are
                // opaque proprietary blobs (Manifest.dat, BulkStream.dat, ShapeManager
                // BREP) - "browse as archive" just lists files that analyse to nothing,
                // so skip it; renderF3d already reports what the package holds.
                if (sniff && !mediaKind && kind !== 'zip' && kind !== 'f3d') {
                    archiveEmbed = pickArchiveEmbed(sniff.ext);
                }
                // Don't also pop the "analyse as <archive>" suggestion - it's embedded now.
                if (archiveEmbed && suggestion && ['zip', 'rar', '7z', 'tar', 'gz', 'xz', 'zst', 'bz2', 'lz4', 'lzma', 'z', 'a'].includes(suggestion.ext)) {
                    suggestion = null;
                }
            }
            catch (_) { }
        }
        // Count this analysis (anonymous, extension-only). `kind` is final here and
        // the read probe already passed, so cloud-unavailable files - which return
        // early above - are correctly never counted. 'unknown' = a type Analyser
        // doesn't recognise, recorded as unsupported.
        // Sandboxed samples are excluded from both the public tally and the local
        // history - the /api/analysed POST is the only thing that bumps the global
        // files_total and per-extension counts, so this single gate fully isolates them.
        if (!isSample && !isRestore) {
            recordAnalysed(fileExt(file.name), kind !== 'unknown');
            // On-device "Recently analysed" snapshot (metadata only, never the bytes).
            recordHistory({ name: file.name, size: file.size, ext: fileExt(file.name), kind, when: Date.now() });
            renderHistoryPanel();
        }
        const navMap = { photo: '#photo', audio: '#audio', video: '#video' };
        const href = navMap[kind];
        if (href) {
            const link = document.querySelector('.site-nav a[href="' + href + '"]');
            if (link) {
                link.classList.remove('is-flash');
                void link.offsetWidth;
                link.classList.add('is-flash');
            }
        }
        function markNav(selector) {
            const el = document.querySelector('.site-nav a[href="' + selector + '"]');
            if (el)
                el.classList.add('has-data');
        }
        // Mobile only (gated by CSS): flag a section as having analysed a file, which
        // moves its heading up into the numbered card and hides the lede.
        function markAnalysed(id) { const sec = $(id); if (sec)
            sec.classList.add('is-analysed'); }
        const sectionPhoto = $('photo');
        const sectionAudio = $('audio');
        const sectionVideo = $('video');
        const mediaSections = [sectionPhoto, sectionAudio, sectionVideo];
        const isMedia = kind === 'photo' || kind === 'audio' || kind === 'video';
        if (isMedia) {
            mediaSections.forEach(s => { if (s)
                s.hidden = false; });
        }
        else {
            const ext = fileExt(file.name);
            const keepPhoto = ext === 'exe' || ext === 'dll' || ext === 'scr';
            if (sectionPhoto)
                sectionPhoto.hidden = !keepPhoto;
            if (sectionAudio)
                sectionAudio.hidden = true;
            if (sectionVideo)
                sectionVideo.hidden = true;
        }
        // The Photo/Sound/Video nav links only make sense when their section is on the
        // page. Grey out + disable any whose section is now hidden (a non-media file
        // hides them); Home and Search are separate controls and always stay live.
        const navPairs = [['#photo', sectionPhoto], ['#audio', sectionAudio], ['#video', sectionVideo]];
        navPairs.forEach(([href, sec]) => {
            const link = document.querySelector('.site-nav a[href="' + href + '"]');
            if (link)
                link.classList.toggle('is-disabled', !sec || !!sec.hidden);
        });
        // Only flip the nav to its inverted palette when at least one section link is
        // still live. If every link is greyed out (a non-media file with no section on
        // the page) the inverted bar would just be a wall of dimmed text, so leave it
        // in its normal colours - the invert is gated on body.anr-nav-live in CSS.
        const anyNavLive = ['#photo', '#audio', '#video'].some((href) => {
            const link = document.querySelector('.site-nav a[href="' + href + '"]');
            return link && !link.classList.contains('is-disabled');
        });
        document.body.classList.toggle('anr-nav-live', anyNavLive);
        const route = ROUTES[kind] || ROUTES.unknown;
        // Most routes render into the generic #unknownResults block, so 'unknown' is
        // the default target - only photo/audio/video name their own section.
        const results = route.results || 'unknown';
        const resultsByName = {
            photo: photoResults, audio: audioResults, video: videoResults, unknown: unknownResults,
        };
        (route.nav || []).forEach(markNav);
        (route.analysed || []).forEach(markAnalysed);
        const extOverride = (force && force.ext) || sniffedExt;
        // Photo and video metadata both come from exifr; pull it in (once) before the
        // renderer runs so the global is ready by the time photo.js/video.js read it.
        if (kind === 'photo' || kind === 'video')
            await ensureExifr();
        let renderPromise;
        if ((kind === 'proprietary' || kind === 'comic') && extOverride) {
            renderPromise = route.render(file, resultsByName[results], extOverride);
        }
        else if (kind === 'photo' && sidecarXmp) {
            renderPromise = route.render(file, resultsByName[results], { sidecarXmp });
        }
        else {
            renderPromise = route.render(file, resultsByName[results]);
        }
        // Autoscroll straight to the media section so the player/analysis is in view
        // the moment a video or audio file is dropped. The catch: content that lands
        // ABOVE it - the Photo/Sound "Analyse" cards - and the section's own player
        // are appended asynchronously, so a single early scroll lands too high (it
        // "misses" by whatever appears above afterwards). So we scroll now for
        // responsiveness and re-assert once the renderer settles (below) - unless the
        // user has grabbed the scroll themselves in the meantime.
        // Autoscroll the analysed section into view, right under the nav bar (each
        // target carries scroll-margin-top: --nav-offset). The three media kinds each
        // scroll to their own numbered section - photo to 01, audio to 02, video to 03.
        // Every OTHER kind - documents, archives, EDA projects, the unknown/hex view -
        // scrolls to wherever its result lands (the generic #unknownResults block or its
        // section), so the analysis is in view the moment the file is dropped instead of
        // leaving the user up at the dropzones.
        const resultEl = resultsByName[results];
        const autoScrollSec = kind === 'video' ? sectionVideo
            : kind === 'audio' ? sectionAudio
                : kind === 'photo' ? sectionPhoto
                    : resultEl ? (resultEl.closest('.section') || resultEl)
                        : null;
        let userTookScroll = false;
        let stopScrollWatch = () => { };
        // Our own smooth scrollIntoView also fires 'scroll', so bracket each
        // programmatic scroll with a short window; any 'scroll' outside it is the user.
        let progScrollUntil = 0;
        const doAutoScroll = () => {
            progScrollUntil = performance.now() + 1200;
            autoScrollSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        if (autoScrollSec) {
            const onUserScroll = () => { userTookScroll = true; };
            // wheel / touch-drag / arrow & page keys are always the user.
            window.addEventListener('wheel', onUserScroll, { passive: true });
            window.addEventListener('touchmove', onUserScroll, { passive: true });
            window.addEventListener('keydown', onUserScroll);
            // Also catch scrollbar drags / momentum (which fire only 'scroll'), as long
            // as they land outside a programmatic-scroll window - this covers scrolling
            // away during a slow audio decode before the section is even ready.
            const onScroll = () => { if (performance.now() > progScrollUntil)
                userTookScroll = true; };
            stopScrollWatch = () => {
                window.removeEventListener('wheel', onUserScroll);
                window.removeEventListener('touchmove', onUserScroll);
                window.removeEventListener('keydown', onUserScroll);
                window.removeEventListener('scroll', onScroll);
            };
            requestAnimationFrame(() => {
                if (userTookScroll)
                    return;
                // Same guard as every other continuation in here. A backgrounded tab does
                // not run rAF at all, so this can still be queued long after the load was
                // cancelled or superseded - at which point stopScrollWatch() has already
                // run, and the listener added below would never be taken off again (and it
                // would scroll to an analysis the user abandoned).
                if (token.cancelled || _currentToken !== token)
                    return;
                doAutoScroll();
                // Only NOW start treating a bare 'scroll' as the user. A plain scroll event
                // is not proof of intent: handleFile has just hidden the page-drop overlay
                // and swapped the three dropzones for "Analyse next file?", which shortens
                // the document - and if the reader was near the bottom of it (the footer,
                // the offline-use block) the browser clamps the scroll position to the new
                // height and fires 'scroll' for that. Armed from the start, that clamp read
                // as "the user took over" before the first autoscroll had even run, and the
                // drop silently left them wherever they were. Nothing above this line can
                // move the page, so anything after it is either our own smooth scroll
                // (inside the window) or genuinely them.
                window.addEventListener('scroll', onScroll, { passive: true });
            });
        }
        // Windows executables/DLLs/screensavers carry their app icon in the PE
        // resource section. Pull it out and analyse it as a photo (the Photo section
        // is kept visible above for exe/dll/scr). A screensaver (.scr) is just a
        // renamed PE, so this is the preview of what the screensaver ships as its
        // icon. Best-effort and fully async - never blocks the render.
        if (kind === 'proprietary' && /\.(exe|dll|scr)$/i.test(file.name) && photoResults) {
            const isScr = /\.scr$/i.test(file.name);
            extractPeIcon(file).then(async (iconFile) => {
                if (!iconFile || token.cancelled || _currentToken !== token)
                    return;
                await ensureExifr();
                if (token.cancelled || _currentToken !== token)
                    return;
                photoResults.hidden = false;
                markAnalysed('photo');
                const { renderPhoto } = await import('../renderers/photo.js');
                renderPhoto(iconFile, photoResults, { sourceNote: (isScr ? 'Screensaver icon extracted from ' : 'Application icon extracted from ')
                        + (file.name || (isScr ? 'the screensaver' : 'the executable')) + '.' });
            }).catch(() => { });
        }
        // Hide the bottom loader once the renderer settles (or immediately if it
        // wasn't async). Errors still dismiss it so it can't get stuck on screen.
        // If this load was cancelled (or superseded by a newer one) leave the loader
        // alone - cancelLoad already cleared the UI, and a newer load owns the popup.
        let renderFailed = false;
        Promise.resolve(renderPromise).catch((err) => {
            // A renderer that rejects (unexpected parse exception, failed lazy import)
            // must not masquerade as a completed analysis. Record it so the finally
            // below shows a visible error card and skips the share nudge, instead of
            // silently producing a hash-only card that looks like success.
            renderFailed = true;
            console.error('Renderer failed for', file && file.name, err);
        }).finally(() => {
            if (token.cancelled) {
                // A cancelled renderer may have appended output after cancelLoad cleared
                // the UI. Scrub it - but only if no newer load has since taken over
                // (cancelLoad nulls _currentToken; a fresh load sets it non-null).
                stopScrollWatch();
                if (_currentToken === null)
                    clearResultsUI();
                return;
            }
            if (_currentToken !== token) {
                stopScrollWatch();
                return;
            } // superseded
            hideDropLoader();
            // If the renderer threw, lead the analysis with a plain error card so the
            // failure is visible (the Integrity card below still gives the fingerprint).
            if (renderFailed && resultEl) {
                resultEl.hidden = false;
                resultEl.insertBefore(errorCard('This file could not be fully analysed - the viewer for its type hit an unexpected error. Its fingerprint is still shown below.'), resultEl.firstChild);
            }
            // Loud, unmissable warning for dotenv secrets files - prepended above the
            // analysis so it's the first thing seen, whatever the renderer produced.
            if (resultEl && isEnvFile(file.name)) {
                resultEl.hidden = false;
                resultEl.insertBefore(envSecretWarning(file), resultEl.firstChild);
            }
            // Signature-vs-extension mismatch: a renamed/disguised file or one whose
            // declared type its bytes don't back up. Prepended so it leads the analysis.
            if (resultEl && sigCheck) {
                resultEl.hidden = false;
                resultEl.insertBefore(signatureCard(sigCheck), resultEl.firstChild);
            }
            // Every file gets an Integrity card. Most renderers build their own (SHA-256 +
            // the on-demand hash extras); those that don't - archives/APKs, folders, a few
            // identify-only views - get a standard one appended here so the file's
            // fingerprint is always available. The guard keeps renderers that already have
            // one from getting a duplicate.
            if (resultEl && !findIntegrityCard(resultEl)) {
                resultEl.hidden = false;
                resultEl.appendChild(integrityCard(file));
            }
            // Data appended past the file's logical end (polyglot / smuggled content).
            // Slotted in just above the Integrity card (the renderer has finished, so it
            // is in the DOM by now); falls back to the end when there is no integrity card.
            if (resultEl && trailCheck) {
                resultEl.hidden = false;
                const tCard = trailingCard(trailCheck, file);
                const integ = findIntegrityCard(resultEl);
                if (integ)
                    resultEl.insertBefore(tCard, integ);
                else
                    resultEl.appendChild(tCard);
            }
            // Everything above the media section (the Photo/Sound "Analyse" cards) and
            // its player are in place now, so re-assert the scroll - the early one
            // landed too high before they pushed it down. Two rAFs let the final layout
            // settle first; keep watching for a user takeover until that last scroll.
            if (autoScrollSec && !userTookScroll) {
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    if (!userTookScroll)
                        autoScrollSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    stopScrollWatch();
                }));
            }
            else {
                stopScrollWatch();
            }
            if (suggestion) {
                showTypeSuggestion(suggestion, () => handleFile(file, { kind: suggestion.kind, ext: suggestion.ext }));
            }
            // Append the browse-as-archive view under the primary analysis for files
            // that are physically a zip/rar/7z container (APK, DOCX, JAR, RAR, …).
            if (archiveEmbed && resultEl) {
                renderArchiveEmbedded(file, resultEl, archiveEmbed).catch(() => { });
            }
            // Record what was just analysed and, unless a format-suggestion popup is
            // taking the spotlight, line up the post-analysis "share this" nudge. Skip
            // the nudge when the file couldn't actually be read (a OneDrive/iCloud
            // cloud-only placeholder that failed inside the renderer, showing the
            // cloud-file warning) - there's nothing worth sharing.
            const analysed = { ext: fileExt(file.name), category: kind, name: file.name };
            window._anrLastAnalysis = analysed;
            // Keep a handle on the analysed File so the data export can compute a hash
            // (e.g. the video SHA-256) on demand without re-reading from disk.
            window._anrLastFile = file;
            // Enough to replay this exact analysis on a later SPA return to home. Force the
            // resolved `kind` so the replay routes straight to the same renderer with no
            // re-sniff/type-suggestion popup. Not persisted anywhere - lives in memory and
            // survives SPA nav (same document); a full reload clears it, by design. Only for
            // a genuine top-level render that actually produced a result (not nested/failed).
            // Sandboxed /samples runs are deliberately excluded: a demo file clicked in the
            // gallery is not the visitor's own analysis, so it must not follow them to the
            // home page - home is either empty or still holds whatever real file they last
            // dropped. See research/PERSIST-ANALYSED-FILE-SPA.md.
            if (!nested && !renderFailed && !isSample) {
                window._anrRestore = { file, kind, ext: extOverride || analysed.ext, sidecarXmp };
            }
            // Reveal the "About .EXT files" link above the footer, deep-linking to the
            // analysed extension's own /formats guide page. A forced re-analyse (sniff
            // popup) passes the true extension; otherwise use the file's own. Stays
            // hidden when the extension has no catalog page (or there's no extension).
            const guideCta = $('formatGuideCta');
            if (guideCta) {
                const guideExt = ((extOverride || analysed.ext) || '').toLowerCase();
                if (guideExt && hasFormatPage(guideExt)) {
                    guideCta.href = formatPageHref(guideExt);
                    guideCta.textContent = 'About .' + guideExt.toUpperCase() + ' files';
                    guideCta.hidden = false;
                }
                else {
                    guideCta.hidden = true;
                }
            }
            const unreadable = document.querySelector('.anr-results:not([hidden]) .anr-cloud-warning');
            // Never nudge for a sandboxed /samples demo run - those aren't the visitor's
            // own analysis worth sharing. (scheduleShareNudge also guards on the page, but
            // this flag is the ground truth and holds even if the page check is bypassed.)
            if (!suggestion && !unreadable && !isSample && !renderFailed && !isRestore)
                scheduleShareNudge(analysed);
        });
    }
    _handleFile = handleFile;
    setReanalyse(handleFile); // forensics.js "Analyse appended data" button
    window._anrHandleFile = handleFile;
    // Expose the (extension/MIME-based) classifier so the folder "can it open?" scan
    // can use the SAME verdict the real drop path does, instead of a parallel list
    // that drifts out of sync. Runtime hook (not a static import) to avoid an
    // app.js <-> folder.js import cycle.
    window._anrClassify = classifyFile;
    // Shared with folder.js's analysability scan so its verdict matches what actually
    // opens: the content resolver (magic/text/git/CSV) and the readable-text test.
    window._anrResolveContent = resolveByContent;
    window._anrReadableText = isReadableText;
    // "Analyse next file?" (shown once a file is loaded) reloads to a clean page.
    const analyseNextBtn = $('analyseNext');
    if (analyseNextBtn && !analyseNextBtn._wired) {
        analyseNextBtn._wired = true;
        analyseNextBtn.addEventListener('click', () => location.reload());
    }
    const scrollToDataBtn = $('scrollToData');
    if (scrollToDataBtn && !scrollToDataBtn._wired) {
        scrollToDataBtn._wired = true;
        scrollToDataBtn.addEventListener('click', scrollToFirstData);
    }
    wireExportButton();
    // ----- Compare two files (the /compare page) -----
    // compare.html carries two dropzones (A/B). Each captures one File WITHOUT going
    // through handleFile; the comparison then runs AUTOMATICALLY as soon as both are
    // in (no button), rendering both full analyses merged field-by-field into
    // #unknownResults via renderers/compare.js. All of this stays inert on any page
    // without the compare zones (the wiring guards on them).
    let _cmpA = null, _cmpB = null, _cmpBusy = false, _cmpAgain = false;
    // Auto-run once both files are present - and again if either is swapped while a
    // comparison is still rendering. Runs are serialised so two never interleave in
    // the shared results container.
    const maybeCompare = () => {
        if (!(_cmpA && _cmpB))
            return;
        if (_cmpBusy) {
            _cmpAgain = true;
            return;
        }
        runCompare();
    };
    async function runCompare() {
        _cmpBusy = true;
        _cmpAgain = false;
        try {
            await handleCompare();
        }
        finally {
            _cmpBusy = false;
            if (_cmpAgain && _cmpA && _cmpB)
                runCompare();
        }
    }
    const wireCompareZone = (dropEl, inputEl, onSet) => {
        if (!dropEl || !inputEl || dropEl._cmpWired)
            return;
        dropEl._cmpWired = true;
        const nameSlot = dropEl.querySelector('[data-cmp-name]');
        const set = (file) => {
            if (!file)
                return;
            onSet(file);
            if (nameSlot)
                nameSlot.textContent = file.name + ' (' + fmtBytes(file.size) + ')';
            dropEl.classList.add('is-set');
        };
        inputEl.addEventListener('change', () => { if (inputEl.files && inputEl.files[0])
            set(inputEl.files[0]); });
        dropEl.addEventListener('dragover', (e) => {
            if (!hasFiles(e))
                return;
            e.preventDefault();
            e.stopPropagation(); // keep it off the page-wide drop handler
            dropEl.classList.add('is-dragover');
        });
        dropEl.addEventListener('dragleave', () => dropEl.classList.remove('is-dragover'));
        dropEl.addEventListener('drop', (e) => {
            if (!hasFiles(e))
                return;
            e.preventDefault();
            e.stopPropagation(); // do NOT fall through to handleFile
            dropEl.classList.remove('is-dragover');
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f)
                set(f);
        });
    };
    wireCompareZone($('cmpDropA'), $('cmpInputA'), (f) => { _cmpA = f; maybeCompare(); });
    wireCompareZone($('cmpDropB'), $('cmpInputB'), (f) => { _cmpB = f; maybeCompare(); });
    async function handleCompare() {
        if (!_cmpA || !_cmpB)
            return;
        const ur = $('unknownResults');
        if (!ur)
            return;
        // The compare page has no media sections to reset, so skip the full
        // clearResultsUI/enterLoadedUI transition (which assumes the home layout) -
        // just refresh the results container and let the dropzones stay in place so
        // the user can swap a file and compare again.
        ur.innerHTML = '';
        ur.hidden = false;
        // Count BOTH files toward the anonymous analysed tally (extension-only), one
        // increment each - a comparison analyses two files, so it counts as two, the
        // same recordAnalysed() the single-file path uses. `supported` mirrors
        // handleFile: resolved kind !== 'unknown'.
        for (const f of [_cmpA, _cmpB]) {
            try {
                const k = await resolveKind(f);
                recordAnalysed(fileExt(f.name), k !== 'unknown');
            }
            catch (_) {
                recordAnalysed(fileExt(f.name), false);
            }
        }
        // Drive the shared bottom loading popup while both files analyse and merge - the
        // compare render can be slow (two full analyses, WASM loads, hashing), so the
        // same bar the single-file drop shows should be visible here too.
        window._anrLoader.show('Comparing files…');
        try {
            const { renderCompare } = await import('../renderers/compare.js');
            await renderCompare(_cmpA, _cmpB, ur, { classify: resolveKind, routes: ROUTES, ensureExifr, renderExtras: renderFileExtras });
        }
        catch (e) {
            ur.appendChild(el('div', { class: 'anr-error' }, 'Comparison failed: ' + (e && e.message ? e.message : e)));
        }
        finally {
            window._anrLoader.hide();
        }
        requestAnimationFrame(() => ur.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    // Wire the photo/audio/video dropzones by DYNAMICALLY importing their (heavy)
    // renderer modules, so their subtree loads in parallel without blocking the
    // initial critical graph. Until each import resolves the zones are unwired, but a
    // file dropped on one still bubbles to the window drop handler below (which calls
    // handleFile), so there is no dead window; once wired, each zone stopPropagation's
    // its own drops. import() is served from cache after the first visit, so on a warm
    // load the zones are wired within a frame or two. The hero layout (single "any
    // file" zone + Record / Live buttons) and the classic grid both live in the DOM
    // (CSS shows one), so wiring both is harmless - the hidden one can't be clicked.
    // Skipped when navigate.js just reinserted a preserved home main (window.
    // _anrHomeRestored): those nodes are the exact same ones from before the SPA
    // round trip and are already wired - redoing it here would double-bind every
    // listener below (initPhoto/initAudio/initVideo have no _wired guard of their
    // own, unlike most of the rest of this file).
    if (!window._anrHomeRestored) {
        if ($('photoDrop')) {
            import('../renderers/photo.js').then(({ initPhoto }) => initPhoto({
                dropEl: $('photoDrop'), inputEl: $('photoInput'), resultsEl: photoResults, onFile: handleFile,
            }));
        }
        if ($('audioDrop') || $('heroRecord') || $('heroLive')) {
            import('../renderers/audio.js').then(({ initAudio }) => {
                if ($('audioDrop'))
                    initAudio({
                        dropEl: $('audioDrop'), inputEl: $('audioInput'), recordBtn: $('audioRecord'),
                        liveBtn: $('audioLive'), resultsEl: audioResults, onFile: handleFile,
                    });
                if ($('heroRecord') || $('heroLive'))
                    initAudio({
                        recordBtn: $('heroRecord'), liveBtn: $('heroLive'), resultsEl: audioResults, onFile: handleFile,
                    });
            });
        }
        if ($('videoDrop') || $('heroDrop')) {
            import('../renderers/video.js').then(({ initVideo }) => {
                if ($('videoDrop'))
                    initVideo({
                        dropEl: $('videoDrop'), inputEl: $('videoInput'), resultsEl: videoResults, onFile: handleFile,
                    });
                if ($('heroDrop'))
                    initVideo({
                        dropEl: $('heroDrop'), inputEl: $('heroInput'), resultsEl: videoResults, onFile: handleFile,
                    });
            });
        }
        // ----- Mobile: tap a section card to upload (with confirm) -----
        // On touch devices, tapping a section's description card (its number +
        // heading + lede, or the heading once it's been moved up after analysis)
        // offers to open a file picker for that section's type. A Swiss-style modal
        // confirms first so a stray tap while scrolling doesn't pop the picker. The
        // top dropzones are deliberately left alone (instant on tap).
        // The photo dropzone handles both photos and videos, so the photo and video
        // sections share photoInput (image/* + video/*).
        if (window.matchMedia('(pointer: coarse)').matches) {
            const sectionUploads = [
                { id: 'photo', input: 'photoInput', prompt: 'Open a photo or video to analyse?' },
                { id: 'audio', input: 'audioInput', prompt: 'Open a sound file to analyse?' },
                { id: 'video', input: 'photoInput', prompt: 'Open a photo or video to analyse?' }
            ];
            for (const s of sectionUploads) {
                const section = $(s.id);
                const input = $(s.input);
                if (!section || !input)
                    continue;
                // Mirror the heading into the numbered meta card. It stays hidden until
                // the section has analysed a file (see the .section-meta-head CSS), then
                // takes the place of the original head + lede on mobile. Created once.
                const meta = section.querySelector('.section-meta');
                const head = section.querySelector('.section-head');
                if (meta && head && !meta.querySelector('.section-meta-head')) {
                    const clone = el('p', { class: 'section-meta-head' }, head.textContent);
                    const kicker = meta.querySelector('.section-kicker');
                    if (kicker)
                        kicker.after(clone);
                    else
                        meta.appendChild(clone);
                }
                // Only the description text opens the picker - never the results/controls
                // below it, which stay interactive.
                section.addEventListener('click', (e) => {
                    if (!e.target.closest('.section-head, .section-lede, .section-meta-head, .section-num, .section-kicker'))
                        return;
                    anrConfirm(s.prompt).then((ok) => { if (ok)
                        input.click(); });
                });
                section.classList.add('is-tappable');
            }
        }
    }
    // ----- "Analyse any file" CTA on the per-format landing pages -----
    // The /formats/<ext> pages carry a CTA that should open the OS file picker
    // (any extension) rather than just linking home. On pick we stash the file
    // and SPA-navigate to '/', where boot() below reads window._anrPendingFile and
    // analyses it. Re-bound every navigation (the element is swapped on SPA nav);
    // a flag guards against double-binding when boot re-runs on the same element.
    const fmtPick = $('fmtPick'), fmtPickInput = $('fmtPickInput');
    if (fmtPick && fmtPickInput && !fmtPick._anrWired) {
        fmtPick._anrWired = true;
        fmtPick.addEventListener('click', (e) => { e.preventDefault(); fmtPickInput.click(); });
        fmtPickInput.addEventListener('change', () => {
            if (!fmtPickInput.files || !fmtPickInput.files.length)
                return;
            window._anrPendingFile = fmtPickInput.files[0];
            const a = document.createElement('a');
            a.href = '/';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }
    // ----- Sample gallery chips (the /samples page) -----
    // Each chip carries the sample's path in data-sample. On click we fetch it,
    // wrap it in a File and run the normal analyser pipeline inline, flagged
    // { sample: true } so it never touches the public stats or local history.
    // Wired every boot (the <main> is swapped on SPA nav); _anrWired guards against
    // double-binding the same element.
    // Lazily-created singleton popup that floats above the cursor while a chip is
    // hovered, showing the extension, type, size and a one-line blurb (from the
    // chip's data-* attributes). pointer-events:none, so it never blocks the chip.
    let samplePop = null;
    const ensureSamplePop = () => {
        if (samplePop && document.body.contains(samplePop))
            return samplePop;
        samplePop = document.createElement('div');
        samplePop.className = 'sample-pop';
        samplePop.setAttribute('aria-hidden', 'true');
        document.body.appendChild(samplePop);
        return samplePop;
    };
    let samplePopTimer = 0;
    const hideSamplePop = () => {
        clearTimeout(samplePopTimer);
        if (samplePop)
            samplePop.classList.remove('is-on');
    };
    document.querySelectorAll('.sample-chip:not(.sample-chip--more)').forEach((card) => {
        if (card._anrWired)
            return;
        card._anrWired = true;
        card.addEventListener('pointerenter', (e) => {
            if (e.pointerType && e.pointerType !== 'mouse')
                return; // touch/pen: no hover popup
            const ext = card.dataset.ext || '';
            const label = card.dataset.label || '';
            const size = card.dataset.size || '';
            const desc = card.dataset.desc || '';
            // Show only after a 0.7s hover dwell, so sweeping across the gallery
            // doesn't flash a popup over every chip.
            clearTimeout(samplePopTimer);
            samplePopTimer = setTimeout(() => {
                const pop = ensureSamplePop();
                pop.innerHTML =
                    '<div class="sample-pop-head">'
                        + (ext ? '<span class="sample-pop-ext"></span>' : '')
                        + (label ? '<span class="sample-pop-label"></span>' : '')
                        + (size ? '<span class="sample-pop-size"></span>' : '')
                        + '</div>'
                        + (desc ? '<div class="sample-pop-desc"></div>' : '');
                if (ext)
                    pop.querySelector('.sample-pop-ext').textContent = ext;
                if (label)
                    pop.querySelector('.sample-pop-label').textContent = label;
                if (size)
                    pop.querySelector('.sample-pop-size').textContent = size;
                if (desc)
                    pop.querySelector('.sample-pop-desc').textContent = desc;
                // Anchor centred above the card (the CSS translate puts the popup's
                // bottom-centre at this point), so it sits over the card, not the cursor.
                const r = card.getBoundingClientRect();
                pop.style.left = (r.left + r.width / 2) + 'px';
                pop.style.top = r.top + 'px';
                pop.classList.add('is-on');
            }, 700);
        });
        card.addEventListener('pointerleave', hideSamplePop);
        card.addEventListener('click', async () => {
            hideSamplePop();
            const url = card.dataset.sample;
            if (!url || card._anrLoading)
                return;
            card._anrLoading = true;
            card.classList.add('is-loading');
            try {
                const res = await fetch(url);
                if (!res.ok)
                    throw new Error('HTTP ' + res.status);
                // A missing sample path doesn't 404 - it hits the SPA fallback and returns the
                // app shell (index.html, 200 text/html). Feeding that to a renderer silently
                // "analyses" the wrong file (the classic "works imported, not from samples"), so
                // reject an HTML response for a sample that isn't itself HTML.
                const ctype = res.headers.get('content-type') || '';
                const sx = (card.dataset.name || '').split('.').pop().toLowerCase();
                if (/^\s*text\/html/i.test(ctype) && sx !== 'html' && sx !== 'htm' && sx !== 'xhtml') {
                    throw new Error('sample not found (got the app shell): ' + url);
                }
                const blob = await res.blob();
                const file = new File([blob], card.dataset.name || 'sample', { type: blob.type || '' });
                await handleFile(file, { sample: true });
            }
            catch (e) {
                console.warn('Sample load failed:', e);
                if (unknownResults) {
                    unknownResults.hidden = false;
                    unknownResults.innerHTML = '<p class="anr-hint">Could not load that sample - please try again.</p>';
                }
            }
            finally {
                card._anrLoading = false;
                card.classList.remove('is-loading');
            }
        });
    });
    // ----- "More" chip: one-way reveal of the rest of the sample gallery -----
    // Adds .is-expanded to the gallery (unhides + fades in the .sample-chip--extra
    // chips), moves focus to the first revealed chip for keyboard users, then
    // removes itself - there's no collapse back.
    const sampleMore = $('sampleMore');
    if (sampleMore && !sampleMore._anrWired) {
        sampleMore._anrWired = true;
        sampleMore.addEventListener('click', () => {
            const gallery = sampleMore.closest('.sample-gallery');
            if (gallery)
                gallery.classList.add('is-expanded');
            sampleMore.setAttribute('aria-expanded', 'true');
            sampleMore.hidden = true;
            const firstExtra = gallery && gallery.querySelector('.sample-chip--extra');
            if (firstExtra)
                firstExtra.focus();
        });
    }
    // ----- Page-level drag/drop (window listeners added once) -----
    if (!boot._once) {
        let dragCounter = 0;
        // The /compare page: its two zones (A/B) are the real targets, so the
        // page-level drop handling is skipped entirely - no full-page overlay to
        // obscure them, and a stray drop outside the zones is swallowed rather than
        // routed into the single-file analyse pipeline (which this page has no
        // sections for). Each zone lights its own .is-dragover instead.
        const onComparePage = () => !!document.getElementById('cmpDropA');
        window.addEventListener('dragenter', (e) => {
            if (!hasFiles(e))
                return;
            dragCounter++;
            if (onComparePage())
                return;
            const drop = $('pageDrop');
            if (drop)
                drop.hidden = false;
        });
        window.addEventListener('dragleave', () => {
            dragCounter = Math.max(0, dragCounter - 1);
            if (dragCounter === 0) {
                const drop = $('pageDrop');
                if (drop)
                    drop.hidden = true;
            }
        });
        window.addEventListener('dragover', (e) => {
            if (!hasFiles(e))
                return;
            e.preventDefault();
        });
        window.addEventListener('drop', async (e) => {
            if (!hasFiles(e))
                return;
            e.preventDefault();
            dragCounter = 0;
            // On /compare, only the A/B zones (which stopPropagation) should accept a
            // drop - swallow anything that lands on the page background so it doesn't
            // fall through to the analyse pipeline.
            if (onComparePage())
                return;
            const drop = $('pageDrop');
            if (drop)
                drop.hidden = true;
            // The /samples page can render inline (it has the result containers), but a
            // dropped file is the user's own - it must NOT be treated as a sandboxed demo
            // sample. Route it to the home page so it analyses (and counts) like any real
            // drop, exactly as dropping on a /formats page does.
            const onSamples = /\/samples(\.html)?\/?$/.test(location.pathname);
            // Synchronous folder peek so the bottom loading bar can show while the
            // (potentially slow) recursive folder walk reads thousands of File objects.
            let droppedFolderName = null;
            const dtItems = e.dataTransfer.items;
            if (dtItems) {
                for (let i = 0; i < dtItems.length; i++) {
                    const en = dtItems[i].webkitGetAsEntry && dtItems[i].webkitGetAsEntry();
                    if (en && en.isDirectory) {
                        droppedFolderName = en.name;
                        break;
                    }
                }
            }
            const folderToken = { cancelled: false };
            if (droppedFolderName)
                showDropLoader({ name: droppedFolderName }, () => { folderToken.cancelled = true; });
            // The walk polls shouldStop between batches, so Cancel stops it partway
            // instead of only being noticed once the whole tree has been read.
            const folderFiles = await walkItems(e.dataTransfer, {
                shouldStop: () => folderToken.cancelled,
                onProgress: (n) => setDropLoaderLabel('Reading ' + droppedFolderName + '… ' + n.toLocaleString() + ' files'),
            });
            if (folderToken.cancelled)
                return; // cancelled during the folder walk
            if (folderFiles) {
                if (!$('photoResults') || onSamples) {
                    window._anrPendingFolder = folderFiles;
                    const home = new URL('/', location.href).href;
                    if (location.href !== home) {
                        const link = document.createElement('a');
                        link.href = '/';
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                    }
                    return;
                }
                const ur = $('unknownResults');
                if (ur) {
                    resetNav();
                    renderFolder(folderFiles, ur);
                    enterLoadedUI();
                    recordFolderHistory(folderFiles);
                    // Match the file-drop behaviour: bring the overview up under the nav bar.
                    requestAnimationFrame(() => ur.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                }
                hideDropLoader();
                return;
            }
            if (droppedFolderName)
                hideDropLoader();
            const files = e.dataTransfer && e.dataTransfer.files;
            if (!files || !files.length)
                return;
            if (!$('photoResults') || onSamples) {
                window._anrPendingFile = files[0];
                // Navigate to the site root with an ABSOLUTE path. A relative 'index.html'
                // resolves against the current directory, which breaks on the nested
                // /formats/<ext> landing pages (it would aim at /formats/index.html). The
                // folder branch above already uses '/'; keep them consistent.
                const home = new URL('/', location.href).href;
                if (location.href !== home) {
                    const link = document.createElement('a');
                    link.href = '/';
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                }
                return;
            }
            if (_handleFile) {
                const list = Array.from(files);
                const baseOf = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();
                const extOf = (n) => (n.split('.').pop() || '').toLowerCase();
                // Analyse a SINGLE file. Dropping several at once used to start a
                // concurrent analysis per file, and they rendered on top of one another
                // into the same result panels (interleaved, unreadable output). This is a
                // single-file tool, so take just the first file and ignore the rest.
                // Exception: a RAW/photo still picks up its same-named .xmp develop-settings
                // sidecar (Photoshop / Lightroom / Camera Raw) so the settings show with it.
                const primary = list.find((f) => extOf(f.name) !== 'xmp') || list[0];
                if (primary) {
                    const xmp = PHOTO_EXTS.has(extOf(primary.name))
                        ? list.find((f) => extOf(f.name) === 'xmp' && baseOf(f.name) === baseOf(primary.name))
                        : null;
                    if (xmp)
                        _handleFile(primary, { sidecarXmp: xmp });
                    else
                        _handleFile(primary);
                }
            }
        });
        // ----- Version number -----
        const verEl = $('versionNum');
        if (verEl) {
            verEl.textContent = analyserVersion(COMMIT_COUNT, RELEASE_COMMITS);
        }
        // ----- Storage with 7-day expiry -----
        const ANR_TTL = 7 * 24 * 60 * 60 * 1000;
        const ANR_REFRESH = 24 * 60 * 60 * 1000;
        function anrSet(key, value) {
            try {
                localStorage.setItem(key, value);
                localStorage.setItem(key + ':ts', Date.now().toString());
            }
            catch (e) { /* quota or private mode */ }
        }
        function anrGet(key) {
            try {
                var ts = parseInt(localStorage.getItem(key + ':ts') || '', 10);
                if (!ts || Date.now() - ts > ANR_TTL) {
                    localStorage.removeItem(key);
                    localStorage.removeItem(key + ':ts');
                    return null;
                }
                return localStorage.getItem(key);
            }
            catch (e) {
                return null;
            }
        }
        // Keys that are deliberately PERMANENT: they carry no ':ts' companion because
        // they are written with a raw setItem (not anrSet), so the sweep's "no
        // timestamp" branch below would otherwise delete them on every single page
        // load. Each is either managed by its own module or must never silently
        // expire:
        //   anr-history          per-entry 7-day expiry of its own (readHistory)
        //   anr-a11y             "Clear view" - an accessibility choice must not expire
        //   anr-analytics-queue  offline-durable analysed-count queue (history.js)
        //   anr-offline(-feat)   offline cache-tier version records (offline-tiers.js)
        // Prefixes cover the families, which is what the old exact-match list got
        // wrong: it named anr-asteroids-hi and -bestwave but not the game's other four
        // keys, so its settings object, boss unlock, start-wave choice and dismissed
        // keyboard hint were swept on every load - atari.html loads app.js too, so a
        // setting did not even survive reloading the game.
        var ANR_PERMANENT = ['anr-history', 'anr-a11y', 'anr-analytics-queue',
            'anr-offline', 'anr-offline-feat'];
        var ANR_PERMANENT_PREFIX = ['anr-asteroids-'];
        function anrPermanent(k) {
            if (ANR_PERMANENT.indexOf(k) !== -1)
                return true;
            for (var p = 0; p < ANR_PERMANENT_PREFIX.length; p++) {
                if (k.startsWith(ANR_PERMANENT_PREFIX[p]))
                    return true;
            }
            return false;
        }
        function anrSweep() {
            try {
                var now = Date.now();
                for (var i = localStorage.length - 1; i >= 0; i--) {
                    var k = localStorage.key(i);
                    if (!k || !k.startsWith('anr-') || k.endsWith(':ts') || anrPermanent(k))
                        continue;
                    var ts = parseInt(localStorage.getItem(k + ':ts') || '', 10);
                    if (!ts || now - ts > ANR_TTL) {
                        localStorage.removeItem(k);
                        localStorage.removeItem(k + ':ts');
                    }
                    else if (now - ts > ANR_REFRESH) {
                        localStorage.setItem(k + ':ts', now.toString());
                    }
                }
            }
            catch (e) { /* ignore */ }
        }
        anrSweep();
        // ----- Dark mode toggle -----
        const saved = anrGet('anr-theme');
        const effective = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : null);
        if (effective)
            document.documentElement.setAttribute('data-theme', effective);
        const darkBtn = $('darkToggle');
        if (darkBtn) {
            // Label shows the CURRENT mode: NIGHT while dark, DAY while light. The sun/moon
            // glyphs are built from code points (sun U+2600, moon U+263E, each + the U+FE0E
            // text-presentation variation selector) so the source stays pure ASCII - a raw
            // glyph here was previously mojibaked by an encoding round-trip and rendered as
            // garbage.
            const SUN = String.fromCodePoint(0x2600, 0xFE0E);
            const MOON = String.fromCodePoint(0x263E, 0xFE0E);
            const themeLabel = () => document.documentElement.getAttribute('data-theme') === 'dark'
                ? MOON + ' NIGHT' : SUN + ' DAY';
            darkBtn.textContent = themeLabel();
            darkBtn.addEventListener('click', () => {
                const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                const next = isDark ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                anrSet('anr-theme', next);
                darkBtn.textContent = themeLabel();
            });
        }
        // ----- Clear view (low-vision accessibility mode) -----
        // Larger type + higher contrast, applied by flipping data-a11y on <html> (the
        // CSS re-points the type/contrast tokens - no per-component work). Persisted as
        // a PERMANENT key: raw localStorage with no :ts, exempted from anrSweep, because
        // an accessibility choice must not silently expire the way the 7-day theme pref
        // does. THEME_SCRIPT applies it before paint; this only wires the chip + keeps
        // its label/pressed-state in sync. Lives on the persistent .site-meta node
        // (never swapped by the SPA router), so wiring it once here is enough.
        const a11yBtn = $('a11yToggle');
        if (a11yBtn) {
            const DOT_ON = String.fromCodePoint(0x25C9, 0xFE0E); // filled circle
            const DOT_OFF = String.fromCodePoint(0x25CB, 0xFE0E); // hollow circle
            const a11yOn = () => document.documentElement.getAttribute('data-a11y') === 'on';
            const syncA11y = () => {
                const on = a11yOn();
                a11yBtn.textContent = on ? DOT_ON + ' ON' : DOT_OFF + ' OFF';
                a11yBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
            };
            syncA11y();
            a11yBtn.addEventListener('click', () => {
                const next = a11yOn() ? null : 'on';
                if (next)
                    document.documentElement.setAttribute('data-a11y', 'on');
                else
                    document.documentElement.removeAttribute('data-a11y');
                try {
                    if (next)
                        localStorage.setItem('anr-a11y', 'on');
                    else
                        localStorage.removeItem('anr-a11y');
                }
                catch (e) { /* quota or private mode */ }
                syncA11y();
            });
        }
        // ----- "Links" external link: confirm before leaving -----
        const otherLink = $('otherStuffLink');
        if (otherLink) {
            otherLink.onclick = (e) => { e.preventDefault(); showLinkConfirm(otherLink); };
        }
        // ----- Clipboard paste (window listener, added once) -----
        window.addEventListener('paste', (e) => {
            const items = e.clipboardData && e.clipboardData.items;
            if (!items)
                return;
            for (const item of items) {
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file && _handleFile)
                        _handleFile(file);
                }
            }
        });
        // Header letter FX is initialised per-navigation by setupHeaderFx() (imported from effects.js).
        setInterval(anrSweep, ANR_REFRESH);
        // Live connectivity → header "Status" line (Online / Offline). The probe runs only
        // on page load (the updateNetStatus() call below) - no interval, focus, visibility or
        // online/offline re-probes, so the network ping happens once per (re)load and no more.
        // Deep-links in the patch notes (and anywhere else) jump to an #anchor, then
        // quietly clean the hash out of the address bar a few seconds later so the URL
        // stays tidy and shareable. replaceState doesn't re-scroll, so the user stays
        // put. We only strip if the hash hasn't changed in the meantime (no new jump).
        const HASH_CLEAN_DELAY = 3000;
        let hashCleanTimer = null;
        const scheduleHashClean = () => {
            if (hashCleanTimer)
                clearTimeout(hashCleanTimer);
            if (!location.hash)
                return;
            const target = location.hash;
            hashCleanTimer = setTimeout(() => {
                if (location.hash === target) {
                    // Keep the entry's state (its navigation tag) and only strip the hash.
                    // Passing null here wiped the tag, which made the installed-PWA back
                    // guard (util.js) mistake this ordinary in-app entry for the app's
                    // pre-launch base and wrongly prompt "Are you sure you want to exit?".
                    history.replaceState(history.state, '', location.pathname + location.search);
                }
            }, HASH_CLEAN_DELAY);
        };
        const onHashChange = () => {
            // A sticky-nav jump (#photo/#audio/#video) creates a fresh, untagged
            // history entry. Tag it in place (no extra entry) so the PWA back guard
            // doesn't later read it as the app's base and prompt to exit when Back
            // lands on it. navigate.js's SPA entries already carry anrNav.
            if (location.hash && !(history.state && history.state.anrNav)) {
                try {
                    history.replaceState({ anrNav: 1 }, '', location.href);
                }
                catch (_) { }
            }
            scheduleHashClean();
        };
        window.addEventListener('hashchange', onHashChange);
        scheduleHashClean(); // handle a hash present on initial load
        // Console easter egg, printed once per session for anyone who opens devtools.
        try {
            console.log("%cyou are probably looking for a secret page. there is one but i'm not telling you how to find it.", 'font-family:monospace;font-size:13px;');
        }
        catch (_) { }
        // Konami code (↑↑↓↓←→←→ B A) anywhere on the site jumps to the hidden /atari
        // page (the Asteroids easter egg lives there now). A throwaway <a> click lets
        // navigate.js do the SPA View Transition, falling back to a plain navigation.
        const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
        let konamiPos = 0;
        window.addEventListener('keydown', (e) => {
            if (e.repeat)
                return;
            const k = (e.key || '').toLowerCase();
            konamiPos = (k === KONAMI[konamiPos]) ? konamiPos + 1 : (k === KONAMI[0] ? 1 : 0);
            if (konamiPos === KONAMI.length) {
                konamiPos = 0;
                // While the game itself is running it tracks its own Konami code (to reveal the
                // sandbox) - without this guard, entering it there also re-triggers this listener
                // and navigates to /atari mid-game, tearing the running game down.
                if (window._anrAsteroidsActive)
                    return;
                const a = document.createElement('a');
                a.href = '/atari';
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        });
        // Space bar = play/pause, whenever the page is showing a player. Bound once on
        // window so every renderer that mounts an <audio> or <video> gets it for free -
        // sound, video, the separated-stem and reversed players, the compare view - with
        // no per-renderer key handling.
        //
        // The main audio element is deliberately display:none (its transports live under
        // the spectrogram and waveform), so we must NOT filter candidates by visibility.
        window.addEventListener('keydown', (e) => {
            if (e.repeat)
                return;
            if (e.code !== 'Space' && e.key !== ' ' && e.key !== 'Spacebar')
                return;
            if (e.ctrlKey || e.metaKey || e.altKey)
                return;
            // Never steal space from typing, nor from a control that space natively
            // activates (button, link, checkbox, select, <summary>) - taking it there
            // would break the keyboard interface of every control on the page.
            const t = e.target;
            if (t && (t.isContentEditable
                || (t.closest && t.closest('input, textarea, select, button, a[href], summary, [contenteditable="true"], [role="button"]'))))
                return;
            // Separation stems (data-anr-stem) opt out: they sit earlier in the DOM than
            // the main track's audio element, so without this the space bar would jump to
            // a stem after an AI separation. Space stays on the main track; the stems keep
            // their own play buttons.
            const all = [...document.querySelectorAll('audio, video')].filter((m) => !m.hasAttribute('data-anr-stem'));
            if (!all.length)
                return;
            // Whatever is audible wins, so space always pauses what you can actually
            // hear; otherwise take the first player on the page.
            let media = null;
            for (const m of all) {
                if (!m.paused && !m.ended) {
                    media = m;
                    break;
                }
            }
            if (!media)
                for (const m of all) {
                    if (m.currentSrc || m.src) {
                        media = m;
                        break;
                    }
                }
            if (!media)
                return;
            e.preventDefault();
            if (media.paused) {
                const p = media.play();
                if (p && p.catch)
                    p.catch(() => { });
            }
            else
                media.pause();
        });
        boot._once = true;
    } // end one-time guard
    // A file dropped on the About / Changelog page stashes itself here and
    // navigates home; pick it up once this (home) boot has the result containers.
    // Runs every boot - NOT inside the one-time guard - so it fires on the
    // anr:navigate boot that the drop triggers, not only on a cold first load.
    if (window._anrPendingFile && photoResults) {
        handleFile(window._anrPendingFile);
        delete window._anrPendingFile;
    }
    // Fallback: replay the most-recently-analysed top-level file after an SPA round
    // trip (home -> About/Samples/etc -> home) when navigate.js couldn't preserve the
    // rendered DOM. Only a file the visitor really analysed is replayed - a sandboxed
    // /samples demo never writes _anrRestore (see handleFile), so clicking through the
    // gallery leaves home exactly as they left it. The File object survives in memory
    // across the in-place page swap, so this just re-runs the same route. Home-only
    // (by pathname, not container presence -
    // /samples shares these same result containers), yields to a preserved main
    // (window._anrHomeRestored - see navigate.js swap()) which already put the
    // analysis back verbatim, and yields to an explicit pending file above.
    // Deliberately not persisted to any storage (survives navigation only, not a
    // reload) - see research/PERSIST-ANALYSED-FILE-SPA.md.
    const isHome = location.pathname === '/' || location.pathname === '/index.html';
    if (isHome && !window._anrHomeRestored && !firstFileLoaded && window._anrRestore && photoResults) {
        const r = window._anrRestore;
        handleFile(r.file, { kind: r.kind, ext: r.ext, sidecarXmp: r.sidecarXmp, restore: true });
    }
    if (window._anrPendingFolder && unknownResults) {
        resetNav();
        renderFolder(window._anrPendingFolder, unknownResults);
        recordFolderHistory(window._anrPendingFolder);
        enterLoadedUI();
        // The folder was dropped on a non-home page, which showed the bottom drop
        // loader before SPA-navigating here. That loader lives on document.body and
        // survives the swap, so it would spin forever - dismiss it now that the
        // folder overview is rendered (mirrors the same-page folder-drop branch).
        hideDropLoader();
        requestAnimationFrame(() => unknownResults.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        delete window._anrPendingFolder;
    }
    // Re-bind the header letter effect to the (possibly swapped) title.
    setupHeaderFx();
    // Hover effect on each section's number / kicker / heading (no sweep).
    setupSectionFx();
    // Same per-letter hover effect on the footer "Everything runs in your browser." mark.
    setupFooterFx();
    // Footer "Email me!" Turnstile gate (footer is swapped on every navigation).
    wireFooterContact();
    // Size the linkback gif to match the "valjdakosta.com · 2026" line above it -
    // CSS alone can't size one flex item to a specific sibling's content width
    // when another item (the nav columns) has to render between them on mobile.
    (function sizeFooterLinkback() {
        const copyright = document.querySelector('.footer-copyright');
        const linkback = document.querySelector('.footer-linkback');
        if (copyright && linkback)
            linkback.style.width = copyright.offsetWidth + 'px';
    })();
    // Nav "Share" button (header is swapped on every navigation).
    wireShareButtons();
    // Mobile access to the Asteroids easter egg: the Konami code needs a keyboard, so
    // on touch you reach it by quickly tapping the header description 5 times - which
    // now jumps to the hidden /atari page (via a throwaway <a> so navigate.js does the
    // SPA hop). Bound to whichever .site-sub is on the current page (the header is
    // swapped on navigation), guarded so it only binds once per element.
    (function wireTapEgg() {
        const sub = document.querySelector('.site-sub');
        if (!sub || sub.dataset.eggBound)
            return;
        sub.dataset.eggBound = '1';
        let taps = 0, tapTimer = 0;
        sub.addEventListener('click', () => {
            taps++;
            clearTimeout(tapTimer);
            tapTimer = setTimeout(() => { taps = 0; }, 600);
            if (taps >= 5) {
                taps = 0;
                const a = document.createElement('a');
                a.href = '/atari';
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        });
    })();
    // Header "Status" line reflects live connectivity (header is swapped too).
    updateNetStatus();
    // Files-analysed total, shown above Status in the header of every main page.
    // The markup ships a "..." placeholder so the badge is visible before JS runs;
    // recordVisit() pings the stats Worker once per page load (cached across SPA
    // navigations, and it also records an anonymous visit - one per IP / 3 days),
    // then swaps the live files-analysed total into the header badge once it
    // arrives. The badge shows the analysed count, not the visit count. Offline or
    // on the mock-less dev server it simply stays "...".
    if ($('analysedCount')) {
        recordVisit().then((t) => {
            if (!t || typeof t.files !== 'number')
                return;
            const n = $('analysedCount');
            if (n)
                n.textContent = t.files.toLocaleString();
        });
    }
    // "Recently analysed" panel (main page only). Paint it, and wire its Clear button.
    renderHistoryPanel();
    const recentClear = $('recentClear');
    if (recentClear && !recentClear._wired) {
        recentClear._wired = true;
        recentClear.addEventListener('click', () => {
            clearHistory();
            renderHistoryPanel();
        });
    }
    // /stats page: fetch + render the public counters (no-op on every other page).
    // The same call also fills the leaderboard on the hidden /atari page, which
    // reuses the #statsRoot / #statsScores markup.
    setupStatsPage();
    // Hidden /atari page: the "Play game" button launches the Asteroids easter egg.
    // Guarded by element presence (a no-op everywhere else) and by a flag so a
    // repeated boot on SPA navigation doesn't double-bind.
    const atariPlay = $('atariPlay');
    if (atariPlay && !atariPlay._wired) {
        atariPlay._wired = true;
        atariPlay.addEventListener('click', () => {
            import('../games/asteroids.js').then((m) => m.launchAsteroids()).catch(() => { });
        });
    }
    // Dev-only "Reset cache" button on /atari - mirrors the in-game hard-reload: unregister
    // the service worker and delete every cache bucket, then reload so all modules refetch.
    // Hidden in production; shown only on localhost, a private LAN IP, or the :3000 dev server.
    const atariReset = $('atariReset');
    if (atariReset && !atariReset._wired) {
        atariReset._wired = true;
        const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ||
            /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname) || location.port === '3000';
        if (isDev) {
            atariReset.hidden = false;
            atariReset.addEventListener('click', async () => {
                atariReset.disabled = true;
                try {
                    if ('serviceWorker' in navigator) {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        await Promise.all(regs.map((r) => r.unregister()));
                    }
                    if (window.caches) {
                        const keys = await caches.keys();
                        await Promise.all(keys.map((k) => caches.delete(k)));
                    }
                }
                catch (_) { }
                location.reload();
            });
        }
    }
    // link.valjdakosta.com links open in this tab - except the "Other stuff" one,
    // which keeps its confirm popup -> new tab (bound below). Runs every navigation
    // because navigate.js swaps the header, recreating the byline anchor.
    document.querySelectorAll('a[href*="link.valjdakosta.com"]').forEach((a) => {
        if (a.id === 'otherStuffLink')
            return;
        a.removeAttribute('target');
        a.removeAttribute('rel');
    });
    // Tapping a hyperlink inside the patch notes asks for confirmation first
    // (same cursor-style popup as the external "Links" button) before following
    // it, then navigates on Proceed.
    document.querySelectorAll('.patch-list a[href]').forEach((a) => {
        if (a._confirmBound)
            return;
        a._confirmBound = true;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const href = a.getAttribute('href') || '';
            let dest = 'another page';
            if (href.indexOf('/about') === 0 || href.indexOf('about.html') === 0)
                dest = 'the About page';
            else if (href.indexOf('/patch') === 0 || href.indexOf('patch.html') === 0)
                dest = 'the Changelog';
            else if (href === '/' || href.indexOf('index') === 0)
                dest = 'the analyser';
            showLinkConfirm(a, {
                message: 'This link leads to ' + dest + ', proceed?',
                onProceed: function () { window.location.href = href; }
            });
        });
    });
    // Changelog "tl;dr" button (patch.html only; no-ops elsewhere).
    setupPatchTldr();
    // ----- Scroll-spy for the sticky nav (re-binds per page) -----
    const links = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
    const sections = links
        .map((a) => ({ a, el: document.querySelector(a.getAttribute('href')) }))
        .filter((s) => s.el);
    // The bar is position:sticky/top:0, so its bounding top reaches 0 exactly when
    // it pins to the viewport top. That drives the inverted palette (together with
    // the anr-has-file / anr-nav-live body gates handled in handleFile + CSS). A
    // direct geometry read on every scroll is 100% reliable; the previous
    // zero-height IntersectionObserver sentinel had a zero-area target, whose
    // intersection readings were flaky - so the bar (and its dividers) sometimes
    // failed to flip or un-flip. Folded into the scroll-spy handler so it's one
    // passive listener.
    const stickyNav = document.querySelector('.site-nav');
    if (_scrollHandler)
        window.removeEventListener('scroll', _scrollHandler);
    _scrollHandler = () => {
        let active = null;
        const y = window.scrollY + 140;
        for (const s of sections) {
            if (s.el.offsetTop <= y)
                active = s;
        }
        // A greyed-out (disabled) nav link is never highlighted - its section isn't
        // really on the page for a non-media file.
        for (const s of sections)
            s.a.classList.toggle('is-active', s === active && !s.a.classList.contains('is-disabled'));
        if (stickyNav) {
            document.body.classList.toggle('anr-nav-stuck', stickyNav.getBoundingClientRect().top <= 0);
        }
    };
    window.addEventListener('scroll', _scrollHandler, { passive: true });
    _scrollHandler();
    // Re-evaluate the stuck state on resize too (the header above the bar can change
    // height, moving where it pins). Bound once; calls whatever the latest handler is.
    if (!boot._stuckResizeWired) {
        boot._stuckResizeWired = true;
        window.addEventListener('resize', () => { if (_scrollHandler)
            _scrollHandler(); }, { passive: true });
    }
    // ----- Collapsible analysis cards -----
    // One delegated listener (added once) toggles a card open/closed when its title
    // (a direct-child <h3>) is clicked. Only cards opted in with .anr-collapsible
    // toggle - in practice the ones that render closed by default (e.g. the archive
    // "Text file previews" card), so users can open them. Every other card is a
    // static, always-open section. .is-collapsed hides the body via CSS. Clicks on
    // interactive controls in a title don't toggle.
    if (!boot._cardToggleWired) {
        boot._cardToggleWired = true;
        document.addEventListener('click', (e) => {
            if (e.target.closest('a, button, input, select, textarea, label'))
                return;
            const h3 = e.target.closest('h3');
            if (!h3)
                return;
            const card = h3.parentElement;
            if (card && card.classList.contains('anr-card') && card.classList.contains('anr-collapsible')) {
                card.classList.toggle('is-collapsed');
            }
        });
    }
    // ----- In-page anchors -----
    // Native anchor jumps handle navigation (offset via CSS scroll-margin-top); no
    // programmatic/animated autoscroll.
    // ----- Desktop only: match the Sound nav button to the sound dropzone width -----
    const soundLink = document.querySelector('.site-nav a[href="#audio"]');
    const soundDrop = $('audioDrop');
    if (soundLink && soundDrop) {
        _alignSoundNav = () => {
            if (window.innerWidth > 700) {
                const w = soundDrop.getBoundingClientRect().width - 2;
                if (w > 0)
                    soundLink.style.flex = '0 0 ' + w + 'px';
            }
            else {
                soundLink.style.flex = '';
            }
        };
        _alignSoundNav();
        // The width is a pixel value read off the dropzone, so it goes stale the
        // moment the window changes size - and the narrow branch, which clears it
        // again, could never run at all while this was a one-shot call. Bound once;
        // calls whatever the latest boot() installed, like the stuck-nav resize above.
        if (!boot._soundNavResizeWired) {
            boot._soundNavResizeWired = true;
            window.addEventListener('resize', () => { if (_alignSoundNav)
                _alignSoundNav(); }, { passive: true });
        }
    }
    else {
        _alignSoundNav = null; // page without the audio dropzone - nothing to align
    }
    // Offline download tiers + PWA install + clear-storage - see ./offline-tiers.js.
    setupOfflineTiers(COMMIT_COUNT, RELEASE_COMMITS, analyserVersion);
    // Supported-formats catalog + help overlay + hub search - see ./format-overlay.js.
    setupFormatOverlay();
    // ----- Search -----
    initSearch();
    // Consumed for this boot only - navigate.js's swap() sets it fresh each time it
    // reinserts a preserved home main, so it must not leak into the next, unrelated
    // navigation's wiring decisions.
    delete window._anrHomeRestored;
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
}
else {
    boot();
}
window.addEventListener('anr:navigate', boot);
//# sourceMappingURL=app.js.map