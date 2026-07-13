# User guide

The front door for a first-time user of Analyser: how to drop a file, what
the readout means, why it's safe, how to install it offline, and where to
go for deeper feature detail. For end users, not developers - see
`docs/architecture.md` and `docs/renderers.md` for the technical picture.

## Dropping files

On the home page (`/`), drop a file (or click to pick one) onto one of the
dropzones - a dedicated Photo/Video zone, a Sound zone (with **Record** and
**Live spectrogram** buttons for capturing audio directly), or the general
"any file or folder" zone, which also accepts whole dropped folders. There
is also a compact **Compare** square next to the main dropzone that links
to `/compare`, where two files can be dropped side by side and their full
analyses lined up field-by-field (see the "/compare" entry in
`docs/features/cross-cutting.md`).

Once a file is analysed, an **Info** button opens the full supported-format
catalogue (searchable, filterable by category) if you want to check whether
a type is supported before dropping it, or browse what Analyser can do.

## Reading the readout

Every analysis is built from the same recurring pieces:

- **Readout tables** - label/value rows for metadata (EXIF, document
  properties, container info, etc.). A `[?]` next to some labels opens a
  plain-language explanation of what that field means.
- **Cards** - a titled block grouping one feature's controls and output
  (e.g. "RGB histogram", "Isolate", "Document structure & security").
- **Integrity card** - present on most files: a SHA-256 fingerprint (with
  CRC-32/MD5/SHA-1/SHA-512 available on click), plus, when conclusive,
  forensic flags for a signature-vs-extension mismatch or trailing data
  appended past the file's logical end (see `docs/features/cross-cutting.md`).
- **Network indicators** - if a file's text contains URLs, IPs, domains or
  email addresses, a card lists them with click-to-open lookup links to
  public OSINT services. Nothing is contacted automatically.

For the full catalogue of what each file type unlocks, see the
`docs/features/` documents - the site groups them the same way:

| Doc | Covers |
|---|---|
| `docs/features/images.md` | Photos, EXIF/GPS, histogram, OCR, HEIC/RAW conversion, broken-image recovery, ICO/MPO/TIFF multi-image extraction, image-to-sound "sonify" |
| `docs/features/audio.md` | Playback, spectrogram, codec/loudness/pitch/tempo analysis, frequency isolation, AI vocal separation, reversed playback, mic recording |
| `docs/features/video.md` | Playback, frame capture, scene detection, reversed video, truncated-recording salvage, AVI handling |
| `docs/features/animation-frames.md` | GIF/WebP frame stepping, Lottie/dotLottie/Telegram sticker playback |
| `docs/features/documents.md` | PDF, Office (modern and legacy), OpenDocument, iWork, e-books, notebooks, Markdown |
| `docs/features/design-cad-3d.md` | SVG, Illustrator, Photoshop, fonts, LUTs, STL/3MF/STEP 3D viewers, G-code, DWG, SolidWorks, Fusion 360 |
| `docs/features/eda-nle.md` | Altium/KiCad PCB design, SPICE waveforms, IPC netlists, After Effects/Premiere/Resolve/VEGAS projects, editing timelines |
| `docs/features/data-archive.md` | CSV/spreadsheet table workbench, archives, folders, treemap, comics, git objects, email, MIDI, subtitles |
| `docs/features/cross-cutting.md` | Hashing, OSINT extraction, exporting the analysis, in-page search, forensic integrity checks, `/compare` |

## The privacy promise

Nothing you drop is ever uploaded. Analyser reads files with the browser's
File API and does every bit of parsing, decoding and rendering on your own
device - open your browser's network tab while dropping a file and you'll
see no request carrying its bytes. The only network activity the site ever
makes is: fetching its own code/WASM engines (lazily, only for the feature
you're actually using, then cached for offline use), a single anonymous
"file analysed" ping with just a lowercase extension string (see
`docs/worker.md`), and - only if a lookup link in the Network indicators
card is clicked - opening a third-party OSINT service in a new tab. See
`/privacy` and `docs/faq.md` for more detail.

The footer's "Recently analysed" panel is a convenience, not a network
feature: it stores file metadata (name, type, size) in your browser's
`localStorage` so you can see what you looked at recently. The files
themselves are never stored, so they can't be reopened automatically.

## Offline install

The "Download for offline use" section in the footer lets you cache
Analyser as an installable, fully offline Progressive Web App, in three
cumulative tiers (see `docs/pwa-offline.md` for exact contents and sizes):

- **Essentials** - the whole app, open/inspect/analyse any file offline.
- **Everything** (recommended) - adds OCR, photo-location maps, QR
  scanning, HEIC conversion, archives, PostScript/EPS, CAD drawings, and the
  samples gallery.
- **Complete** - optional extras on top of Everything: OCR in 30+
  languages, and on-device AI vocal separation.

Click **Install as app** to add Analyser to your home screen/app list
(uses the browser's native install prompt where available, or shows
platform-specific manual instructions otherwise). **Clear storage** removes
everything cached.

## Where to go next

- Browse `/formats` for the full list of 1350+ recognised file types, with
  a dedicated guide page for many extensions.
- Try `/samples` for example files to drop without needing your own.
- See `docs/faq.md` for quick answers to common questions.
- See the `docs/features/*.md` docs above for exhaustive detail on any
  specific feature.
