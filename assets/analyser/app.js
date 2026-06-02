/* Analyser - entry point
   - Boots photo + audio + video modules
   - Acts as the page-wide drop target (until the first file lands)
   - Classifies dropped files into photo / audio / video / unknown
   - Renders a basic dump for unknown formats */

import { initPhoto, renderPhoto } from './photo.js';
import { initAudio, renderAudio } from './audio.js';
import { initVideo, renderVideo } from './video.js';
import { renderPdf } from './pdf.js';
import { renderArchive } from './archive.js';
import { renderSvg } from './svg.js';
import { renderCsv } from './csv.js';
import { renderUnknown } from './unknown.js';
import { initSearch } from './search.js';
import { fileExt } from './util.js';

function $(id) { return document.getElementById(id); }

// ---------- file classification ----------
const PHOTO_EXTS = new Set([
  'jpg','jpeg','jpe','jif','jfif','png','gif','webp','heic','heif','heics','heifs',
  'bmp','tif','tiff','avif','jxl','ico',
  'raw','arw','cr2','cr3','nef','dng','raf','rw2','orf','pef','sr2','srw','x3f'
]);
const AUDIO_EXTS = new Set([
  'mp3','wav','wave','m4a','m4b','aac','flac','ogg','oga','opus',
  'aiff','aif','aifc','wma','weba','amr','ac3','dts','mka','mid','midi'
]);
const VIDEO_EXTS = new Set([
  'mp4','m4v','mov','avi','mkv','webm','wmv','flv',
  '3gp','3g2','mpg','mpeg','mts','m2ts','ts','vob','ogv'
]);

const CSV_EXTS = new Set(['csv', 'tsv']);
const SVG_EXTS = new Set(['svg']);

function classifyFile(file) {
  const t = (file.type || '').toLowerCase();
  const ext = fileExt(file.name);
  // SVG before generic image/ MIME so it gets its own handler
  if (t === 'image/svg+xml' || SVG_EXTS.has(ext)) return 'svg';
  if (t.startsWith('image/')) return 'photo';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (CSV_EXTS.has(ext) || t === 'text/csv' || t === 'text/tab-separated-values') return 'csv';
  if (PHOTO_EXTS.has(ext)) return 'photo';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'unknown';
}

// ---------- page-wide drag-drop ----------
function hasFiles(e) {
  const t = e.dataTransfer && e.dataTransfer.types;
  if (!t) return false;
  for (let i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
  return false;
}

function boot() {
  if (!window.exifr) {
    console.warn('exifr not loaded yet; photo metadata will be missing until it loads.');
  }

  const photoResults   = $('photoResults');
  const audioResults   = $('audioResults');
  const videoResults   = $('videoResults');
  const unknownResults = $('unknownResults');
  const pageDropEl     = $('pageDrop');

  let firstFileLoaded = false;
  let dragCounter = 0;

  async function handleFile(file) {
    if (!file) return;

    // Clear all previous results
    photoResults.innerHTML = ''; photoResults.hidden = true;
    audioResults.innerHTML = ''; audioResults.hidden = true;
    videoResults.innerHTML = ''; videoResults.hidden = true;
    unknownResults.innerHTML = ''; unknownResults.hidden = true;

    // Clear preview slots
    const previewSlots = ['photoPreview', 'photoOcrSlot', 'photoHistSlot', 'videoPreview'];
    for (const id of previewSlots) {
      const slot = $(id);
      if (slot) slot.innerHTML = '';
    }

    // Clear nav indicators
    document.querySelectorAll('.nav-link.has-data').forEach(link => link.classList.remove('has-data'));

    firstFileLoaded = true;
    if (pageDropEl) pageDropEl.hidden = true;
    let kind = classifyFile(file);

    // For files classified as 'unknown', check magic bytes for PDF / ZIP / SVG / CSV
    if (kind === 'unknown') {
      try {
        const head = new Uint8Array(await file.slice(0, 128).arrayBuffer());
        const a = (s, l) => Array.from(head.slice(s, s + l)).map((c) => String.fromCharCode(c)).join('');
        if (a(0, 4) === '%PDF') kind = 'pdf';
        else if (head[0] === 0x50 && head[1] === 0x4B) kind = 'zip';
        else {
          // Check for SVG: may start with <svg or <?xml ... <svg
          const headStr = a(0, Math.min(head.length, 128));
          if (headStr.trimStart().startsWith('<svg') || (headStr.includes('<svg') && headStr.includes('xmlns'))) {
            kind = 'svg';
          }
        }
        // CSV heuristic: check if lines have consistent comma/tab counts
        if (kind === 'unknown') {
          const peekText = await file.slice(0, 2048).text().catch(() => '');
          const lines = peekText.split('\n').filter((l) => l.trim()).slice(0, 10);
          if (lines.length >= 2) {
            const commas = lines.map((l) => (l.match(/,/g) || []).length);
            const tabs = lines.map((l) => (l.match(/\t/g) || []).length);
            const avgCommas = commas.reduce((s, n) => s + n, 0) / commas.length;
            const avgTabs = tabs.reduce((s, n) => s + n, 0) / tabs.length;
            const commaConsistent = avgCommas >= 1 && commas.every((c) => Math.abs(c - avgCommas) <= 1);
            const tabConsistent = avgTabs >= 1 && tabs.every((c) => Math.abs(c - avgTabs) <= 1);
            if (commaConsistent || tabConsistent) kind = 'csv';
          }
        }
      } catch (_) {}
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
      if (el) el.classList.add('has-data');
    }

    function scrollTo(hash) {
      location.hash = hash;
      setTimeout(() => history.replaceState(null, '', location.pathname + location.search), 2000);
    }

    if (kind === 'photo') {
      markNav('#photo');
      scrollTo('#photo');
      renderPhoto(file, photoResults);
    } else if (kind === 'audio') {
      markNav('#audio');
      scrollTo('#audio');
      renderAudio(file, audioResults);
    } else if (kind === 'video') {
      markNav('#video');
      markNav('#audio');
      markNav('#photo');
      scrollTo('#video');
      renderVideo(file, videoResults);
    } else if (kind === 'pdf') {
      scrollTo('#unknownResults');
      renderPdf(file, unknownResults);
    } else if (kind === 'zip') {
      scrollTo('#unknownResults');
      renderArchive(file, unknownResults);
    } else if (kind === 'svg') {
      scrollTo('#unknownResults');
      renderSvg(file, unknownResults);
    } else if (kind === 'csv') {
      scrollTo('#unknownResults');
      renderCsv(file, unknownResults);
    } else {
      scrollTo('#unknownResults');
      renderUnknown(file, unknownResults);
    }
  }

  initPhoto({
    dropEl:    $('photoDrop'),
    inputEl:   $('photoInput'),
    resultsEl: photoResults,
    onFile:    handleFile
  });

  initAudio({
    dropEl:    $('audioDrop'),
    inputEl:   $('audioInput'),
    recordBtn: $('audioRecord'),
    liveBtn:   $('audioLive'),
    resultsEl: audioResults,
    onFile:    handleFile
  });

  initVideo({
    dropEl:    $('videoDrop'),
    inputEl:   $('videoInput'),
    resultsEl: videoResults,
    onFile:    handleFile
  });

  // ----- Page-level drag/drop -----
  // Before the first file lands the whole page is a drop target and an overlay
  // appears while a file is being dragged. After the first file, drops anywhere
  // still route through handleFile but the overlay no longer flashes.
  //
  // Why a `dragCounter`? `dragenter` / `dragleave` fire for every child element
  // the cursor crosses, not just the page boundary. Counting +1/-1 instead of
  // toggling on a single boolean prevents flicker while dragging across the
  // header, nav, dropzones, etc.
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragCounter++;
    if (!firstFileLoaded && pageDropEl) pageDropEl.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0 && pageDropEl) pageDropEl.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();   // required to allow drop
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter = 0;
    if (pageDropEl) pageDropEl.hidden = true;
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files) for (const file of files) handleFile(file);
  });

  // ----- Dark mode toggle -----
  const saved = localStorage.getItem('anr-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  const darkBtn = $('darkToggle');
  if (darkBtn) {
    darkBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Disable' : 'Enable';
    darkBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('anr-theme', next);
      darkBtn.textContent = next === 'dark' ? 'Disable' : 'Enable';
    });
  }

  // ----- Clipboard paste (Ctrl+V) -----
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) handleFile(file);
      }
    }
  });

  // ----- Scroll-spy for the sticky nav -----
  const links = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
  const sections = links
    .map((a) => ({ a, el: document.querySelector(a.getAttribute('href')) }))
    .filter((s) => s.el);
  function onScroll() {
    // No link is active until the page is scrolled down to a section, so the
    // Photo button isn't black while still up at the top of the page.
    let active = null;
    const y = window.scrollY + 140;
    for (const s of sections) {
      if (s.el.offsetTop <= y) active = s;
    }
    for (const s of sections) s.a.classList.toggle('is-active', s === active);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ----- Smooth in-page anchors -----
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 60;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  }

  // ----- Home button (scroll to top), mirrors the search button -----
  const homeBtn = $('navHomeBtn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    const homeNav = homeBtn.closest('nav');
    const sizeHome = () => { if (homeNav) homeBtn.style.width = homeNav.clientHeight + 'px'; };
    sizeHome();
    window.addEventListener('resize', sizeHome);
  }

  // ----- Desktop only: match the Sound nav button to the sound dropzone width -----
  const soundLink = document.querySelector('.site-nav a[href="#audio"]');
  const soundDrop = $('audioDrop');
  if (soundLink && soundDrop) {
    const alignSoundNav = () => {
      if (window.innerWidth > 700) {
        // -2px: the dropzone's measured width includes both its borders, which
        // makes the nav button read a touch wider otherwise.
        const w = soundDrop.getBoundingClientRect().width - 2;
        if (w > 0) soundLink.style.flex = '0 0 ' + w + 'px';
      } else {
        soundLink.style.flex = '';   // restore the default equal-width flex on mobile
      }
    };
    alignSoundNav();
    window.addEventListener('resize', alignSoundNav);
  }

  // ----- Search -----
  initSearch();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
