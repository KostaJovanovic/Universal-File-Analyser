# FAQ

Short answers to the questions people ask most about Analyser. For depth, follow the
links into the rest of the doc set.

### Is anything uploaded? Do my files leave my device?

No. Files are read with the browser File API and analysed entirely on your device
with lazy-loaded WebAssembly. Nothing is uploaded - you can confirm it with the
network tab open. The only network call the app makes on its own is a single
anonymous "file analysed" ping carrying just a lowercase extension string (e.g.
`jpg`), which feeds the public stats page. See `docs2/worker.md` and `/privacy`.

### What does the stats ping actually send, and can it identify me?

Only the extension and an increment. Visits are deduplicated by a **salted hash** of
your IP, so the raw IP is never stored or derivable. Unsupported extensions (a raw,
user-supplied string) are folded into a single `(unsupported)` bucket before anything
leaves the server, so a hostile filename can't end up on the public page. See
`docs2/worker.md`.

### How many file types are supported?

Over 1,350. The depth varies: photos, audio, video, documents, 3D/CAD, archives, maps
and databases get full viewers and deep analysis; hundreds of proprietary formats are
identified by magic bytes with their header metadata decoded; anything still unknown
gets a hex dump and best-effort identification. The full searchable list is at
`/formats`, with a guide page per extension. See `docs2/pipeline.md` and
`docs2/renderers.md`.

### It opened my file as the wrong type (or "unknown"). Why?

Routing starts from the extension and MIME type, then checks the actual bytes. If the
extension lies or is missing, the content sniffer reroutes it (a PDF/ZIP/image with no
extension still opens correctly), and if it detects a better match it offers to
re-analyse as the real type. A few extensions name two unrelated formats (`.ts`,
`.nc`, `.key`, `.mat`, …) and are disambiguated by their bytes. See
`docs2/pipeline.md`.

### Can it recover a broken or truncated file?

Often, yes. Truncated/corrupt JPEG/PNG stills can be repaired (or their header rebuilt
from a reference photo shot on the same camera), embedded images can be carved out of
any blob, and unfinalised MP4/MOV recordings with no index can be salvaged by
extracting the raw H.264/H.265 stream (with a reference clip as donor if needed). See
`docs2/features/images.md` and `docs2/features/video.md`.

### Why did it download a big WASM file / an AI model?

Heavy engines (FFmpeg, ImageMagick, Ghostscript, OpenCASCADE, Tesseract, the MDX
vocal-separation model, …) are loaded lazily - only when a file actually needs them -
so the initial page stays small. After the first use they are cached for offline use.
The AI model in particular is kept in a cache that survives app updates so it isn't
re-downloaded. See `docs2/parsers-and-libs.md` and `docs2/pwa-offline.md`.

### Does it work offline?

Yes. The service worker precaches the app shell, and the footer's "Download for
offline use" section installs it as a PWA in three cumulative tiers (Essentials /
Everything / Complete). Once a tier is downloaded, everything works with no network.
See `docs2/pwa-offline.md`.

### Which browsers are supported?

Any modern browser. SPA page transitions use the View Transitions API where available
and fall back to normal navigation otherwise. Some features depend on browser support
(microphone capture, WebGL, `webkitGetAsEntry` for folder drops); where an engine or
API is missing, Analyser degrades to identification or an honest note rather than
failing silently.

### Is my `.env` / key file safe to analyse?

Analysing it is safe - it never leaves your device. Analyser also flags dotenv secrets
files with a loud "never share this" warning and marks private keys and secrets found
inside files, precisely because those must not be shared. It never transmits them.

### Can I get the analysis out of the browser?

Yes - the **Export data** button offers a self-contained HTML report, a PDF, a JSON
dump, or a CSV. All generated locally. See `docs2/features/cross-cutting.md`.
