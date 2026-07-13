# FAQ

Quick answers to the questions users most often have about Analyser,
mirroring (and expanding on) the FAQ published on `/about`. See
`docs/user-guide.md` and the `docs/features/*.md` docs for deeper detail.

**Is Analyser free?**
Yes. Completely free, no ads, no account, no sign-up.

**Does Analyser upload my files?**
No. Every file is read and analysed entirely in your browser using the
File API. Nothing is uploaded to a server - the name, contents and bytes of
anything you open stay on your device and are gone when you close the tab.
The only network calls the site ever makes are fetching its own code/WASM
engines (lazily, cached after first use) and a single anonymous "one file
analysed" ping containing just a lowercase file extension (see
`docs/worker.md`) - never the file itself.

**Can I view a file's EXIF and metadata without uploading it?**
Yes. Drop a photo (or any file) and Analyser reads EXIF, GPS, camera
settings and other metadata locally, with nothing sent anywhere. See
`docs/features/images.md`.

**How do I open a file online without installing software?**
Open Analyser in any web browser and drag your file onto the page, or tap
to pick one. It opens directly in the browser - no install, no account, no
plugins.

**What file types can Analyser open?**
Over 1,350 file types (the exact count is computed live from the catalog
and grows over time) - photos, RAW camera files, audio, video, PDFs,
Office documents, e-books, archives, 3D models and CAD, fonts, executables
and many proprietary formats. See the full searchable list at `/formats`,
or `docs/renderers.md` for the developer-facing module map.

**Does Analyser work without internet?**
Yes. It's a Progressive Web App - install it to your home screen or
desktop and it works fully offline. The service worker caches the app on
first visit; heavier engines (FFmpeg, ImageMagick, Tesseract, and more) are
cached separately as part of the offline download tiers (see
`docs/pwa-offline.md`).

**Why does a WASM download happen for some files?**
Several of the deepest features - RAW-photo demosaicing (ImageMagick),
DWG drawings (LibreDWG), STEP/IGES CAD (OpenCASCADE), JPEG 2000
(OpenJPEG), PostScript/EPS (Ghostscript), archives (libarchive), AI vocal
separation (ONNX Runtime + the MDX-Net model) - are powered by WebAssembly
engines too large to bundle into the initial page load. They're fetched
only the first time you actually open a matching file, then cached by the
service worker so every later use (including offline) is instant. See
`docs/parsers-and-libs.md` and the "Under the hood" section of the repo
root `README.md` for the full dependency list and approximate sizes.

**Is it safe to open files here?**
Yes. Because your files never leave your browser, there's no upload to
intercept and no server that stores them. Analyser also actively sanitises
risky embedded content - stripping `<script>`, event handlers, and remote
references from SVG and DWG-derived SVG previews before rendering them, and
never executing scripts in HTML/MHTML/email previews - so opening an
untrusted file doesn't run its embedded code. See "Forensic integrity
cards" and the SVG entry in `docs/features/cross-cutting.md`/
`docs/features/design-cad-3d.md`.

**Can I open a .HEIC, .ARW, .PSD or .DWG file?**
Yes. iPhone HEIC photos, Sony ARW and other camera RAW files, Photoshop
PSD documents, AutoCAD DWG drawings and many more each get their own
dedicated viewer - drop the file in and it opens right in the browser. See
`docs/features/images.md` and `docs/features/design-cad-3d.md`.

**Can I recover a broken or truncated photo/video?**
Yes. Analyser can repair a truncated or corrupt JPEG/PNG, rebuild a
damaged JPEG header using a reference photo from the same camera, carve
embedded images out of any blob, and salvage an unfinalised MP4/MOV
recording with no index by extracting the raw H.264/H.265 stream (with a
reference clip as donor when needed). See "Broken/truncated/corrupt image
recovery" in `docs/features/images.md` and "Truncated/unfinalised
recording salvage" in `docs/features/video.md`.

**What browsers does Analyser support?**
It targets modern evergreen browsers (Chrome/Edge/Firefox/Safari) using
standard web APIs (File API, Web Audio, WebGL, WebAssembly, and - for a
few specific features like animated-WebP frame stepping - WebCodecs). Where
a feature depends on a newer API the browser lacks (e.g. the View
Transitions API for SPA navigation, or `document.startViewTransition`),
Analyser degrades gracefully rather than breaking - see "SPA navigation" in
`docs/architecture.md` for one concrete example. Exact minimum versions per
API were not independently verified for this doc.

**Where do I report a missing format or a bug?**
Via the footer's "Email me!" contact button (gated behind a spam check that
only loads when you open it), or the format-info overlay's suggestion flow
if a specific extension is missing.
