# User guide

The front door for using Analyser: how to open a file, how to read what comes back,
the privacy promise, installing it offline, and a map into the per-feature docs.
Analyser is a browser-only forensic file workbench - drop a file and it classifies
and analyses it entirely on your device, uploading nothing.

## Opening a file

There are several ways to start an analysis (all handled by `handleFile` in
`web/assets/js/core/app.js`):

- **Drop** a file anywhere on the home page (`/`).
- **Pick** one with the dropzone's file picker.
- **Paste** a file or image from the clipboard.
- **Record** from the microphone or start a **Live** spectrogram (the hero buttons)
  for audio.
- **Drop a whole folder** to browse it, with a treemap size breakdown and
  click-to-analyse on any file inside.
- Try the **[samples gallery](https://lab.valjdakosta.com/samples)** to watch it work
  on an example file without dropping your own.

Analyser recognises the file from its extension and MIME type, then double-checks the
actual bytes - so a file with a wrong or missing extension still opens correctly, and
a disguised file is flagged. If it detects a better match, it offers to re-analyse as
the real type. (See `docs2/pipeline.md` for the full routing story.)

## Reading the readout

Every analysis is a stack of cards:

- **The main viewer** for the file's type (a player, page preview, 3D viewer, map,
  hex dump, …).
- **Forensic cards** at the top when relevant: a signature-vs-extension mismatch, or
  data appended past the file's logical end.
- **The Integrity card** with the file's SHA-256 fingerprint, and a **Show more
  hashes** affordance for CRC-32, MD5, SHA-1 and SHA-512.
- **A network-indicator (OSINT) card** when the file contains URLs, IPs, domains or
  emails - each a click-to-open lookup (nothing is contacted until you click).
- **Browse as archive** appended when the file is physically a zip/rar/7z (an APK,
  DOCX, JAR, …).

Use the **Search** control to highlight matching fields across all cards, and
**Export data** (next to "Analyse next file?") to save the whole analysis as a
self-contained HTML report, a PDF, JSON, or CSV. See
`docs2/features/cross-cutting.md`.

## The privacy promise

Files are read with the File API and **never leave your device**. There are no
accounts, no tracking and no analytics cookies. The only network call the app makes
on its own is a single anonymous "file analysed" ping carrying nothing but a
lowercase extension string, which feeds the public [stats
page](https://lab.valjdakosta.com/stats). You can verify the no-upload claim with the
browser network tab open. See `docs2/worker.md` and `/privacy`.

## Installing for offline use

The "Download for offline use" section in the footer installs Analyser as a fully
offline PWA in three cumulative tiers:

- **Essentials** - the whole app.
- **Everything** - adds OCR, maps, QR, HEIC, archives, PostScript, CAD drawings and
  the samples gallery.
- **Complete** - adds OCR in 30+ languages and the on-device AI vocal separation.

Once installed with a tier downloaded, everything works with no network. See
`docs2/pwa-offline.md`.

## Map into the feature docs

| You dropped… | See |
|---|---|
| A photo, RAW, HEIC, ICO/MPO/TIFF, or a broken image | `docs2/features/images.md` |
| Audio, or want spectrogram / isolation / AI vocal separation | `docs2/features/audio.md` |
| A video, or want frames / recovery / gyro data | `docs2/features/video.md` |
| An animated GIF/WebP or a Lottie animation | `docs2/features/animation-frames.md` |
| A PDF, Office/OpenDocument, e-book, notebook or text | `docs2/features/documents.md` |
| A design file, 3D model, G-code, or CAD | `docs2/features/design-cad-3d.md` |
| A PCB/SPICE/netlist or an NLE/VFX project | `docs2/features/eda-nle.md` |
| A CSV/spreadsheet, archive, folder, comic, subtitles, MIDI, or map | `docs2/features/data-archive.md` |
| Anything - hashing, OSINT, export, compare, hex view | `docs2/features/cross-cutting.md` |

For the architecture behind all of this, start at `docs2/README.md`.
