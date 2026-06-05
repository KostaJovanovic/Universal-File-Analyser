/* Analyser - service worker
   Precache the app shell; stale-while-revalidate the rest. */

const VERSION = 'analyser-v53';
const SHELL = [
  './',
  './index.html',
  './about.html',
  './patch.html',
  './manifest.json',
  './assets/analyser.css',
  './assets/fonts.css',
  './assets/analyser/app.js',
  './assets/analyser/util.js',
  './assets/analyser/formats.js',
  './assets/analyser/search.js',
  './assets/analyser/photo.js',
  './assets/analyser/photo-convert.js',
  './assets/analyser/audio.js',
  './assets/analyser/audio-player.js',
  './assets/analyser/audio-analysis.js',
  './assets/analyser/audio-codec.js',
  './assets/analyser/video.js',
  './assets/analyser/video-avi.js',
  './assets/analyser/spectrogram.js',
  './assets/analyser/pdf.js',
  './assets/analyser/archive.js',
  './assets/analyser/svg.js',
  './assets/analyser/csv.js',
  './assets/analyser/lrc.js',
  './assets/analyser/midi.js',
  './assets/analyser/subtitles.js',
  './assets/analyser/geo.js',
  './assets/analyser/markdown.js',
  './assets/analyser/comic.js',
  './assets/analyser/unknown.js',
  './assets/analyser/proprietary.js',
  './assets/analyser/binutil.js',
  './assets/analyser/plist.js',
  './assets/analyser/cfbf.js',
  './assets/analyser/sqlite.js',
  './assets/analyser/libarchive-loader.js',
  './assets/analyser/openjpeg-loader.js',
  './assets/analyser/xz-loader.js',
  './assets/analyser/ghostscript-loader.js',
  './assets/analyser/parsers-dev.js',
  './assets/analyser/parsers-archive.js',
  './assets/analyser/parsers-email.js',
  './assets/analyser/parsers-security.js',
  './assets/analyser/parsers-gaming.js',
  './assets/analyser/parsers-disk.js',
  './assets/analyser/parsers-sci.js',
  './assets/analyser/parsers-osmisc.js',
  './assets/analyser/parsers-image.js',
  './assets/analyser/parsers-threed.js',
  './assets/analyser/parsers-geodata.js',
  './assets/analyser/parsers-audio.js',
  './assets/analyser/parsers-video.js',
  './assets/analyser/parsers-docs.js',
  './assets/analyser/docx.js',
  './assets/analyser/xlsx.js',
  './assets/analyser/epub.js',
  './assets/analyser/pptx.js',
  './assets/analyser/stl.js',
  './assets/analyser/zip.js',
  './assets/analyser/folder.js',
  './assets/analyser/folder-archive-shared.js',
  './assets/analyser/treemap.js',
  './assets/analyser/navigate.js',
  './assets/favicon.svg',
  './assets/icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/vendor/exifr.umd.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol === 'chrome-extension:' || url.protocol === 'about:') return;

  e.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
