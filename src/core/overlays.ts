/* Analyser - transient overlay UI shared by the drop pipeline.
   Four self-contained bits of chrome that sit on top of the page and depend
   only on el() from util.js:
     - anrConfirm   : Swiss-style yes/no modal (Promise<boolean>)
     - showDropLoader/hideDropLoader : bottom-of-window progress bar (also driven
       by renderers via window._anrLoader)
     - showTypeSuggestion/hideTypeSuggestion : "this looks like a X" re-analyse nudge
     - showLinkConfirm : cursor-anchored "leave the site?" confirm popup */

import { el, type ElChild } from './util.js';

// Swiss-style confirmation modal. Resolves true on confirm, false on
// cancel/backdrop-dismiss. Used as the mobile "did you mean to upload?" guard
// so a stray tap on a dropzone doesn't immediately pop the native file picker.
// opts (all optional): { kicker } overrides the 'Upload' eyebrow, { cancelLabel }
// the Cancel text, { hideCancel } drops the cancel button (a one-button notice,
// e.g. the native updater's "up to date" message).
export function anrConfirm(title: ElChild | ElChild[], okLabel?: string, opts?: any) {
  opts = opts || {};
  return new Promise((resolve) => {
    const cancelBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-cancel' }, opts.cancelLabel || 'Cancel');
    const okBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-ok' }, okLabel || 'Choose file');
    const card = el('div', { class: 'anr-modal-card' }, [
      el('p', { class: 'anr-modal-kicker' }, opts.kicker || 'Upload'),
      el('p', { class: 'anr-modal-title' }, title),
      el('div', { class: 'anr-modal-actions' }, opts.hideCancel ? [okBtn] : [cancelBtn, okBtn])
    ]);
    const overlay = el('div', { class: 'anr-modal' }, card);
    document.body.appendChild(overlay);

    let settled = false;
    const close = (val: unknown) => {
      if (settled) return;
      settled = true;
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
      resolve(val);
    };
    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    // Defer the open class one frame so the CSS fade/slide transition runs.
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  });
}

// ---------- drop loading bar (bottom-of-window popup) ----------
// Big files take a moment to read/decode before their analysis renders. This
// shows a small popup at the bottom of the window with an indeterminate bar
// (same sliding style as the SHA-256 row) while that happens, then hides it
// when the renderer settles. A short delay before showing keeps quick files
// from flashing it.
let _dropLoaderEl: HTMLDivElement|null = null;
let _dropLoaderTimer: number|undefined;
let _dropLoaderHideTimer: number|undefined;
let _dropLoaderOnCancel: (() => void)|null = null;
let _dropLoaderShownAt = 0;
// Intent flag: true once reveal() commits to showing the bar - set BEFORE the
// rAF that actually applies the is-open class, so hideDropLoader() can tell
// "about to show" apart from "never shown" and never lose the race.
let _dropLoaderOpen = false;
// Latest label text, so a long multi-step read (the folder walk) can report
// progress even while the bar is still inside its 160ms anti-flash debounce -
// reveal() picks this up rather than the text captured when it was scheduled.
let _dropLoaderLabel: string|null = null;
// Once the bar is actually on screen, keep it up at least this long so a near-
// instant render (e.g. a small file opened straight from a folder/zip view,
// already in memory) doesn't make it flash-and-vanish.
const DROP_LOADER_MIN_MS = 420;

// `immediate` skips the 160ms anti-flash debounce. Use it when the source bytes
// are already in memory (a nested file from a folder/zip/document), where the
// render finishes before the debounce fires - so without this the bar would
// never show. Disk-backed drops keep the debounce (they cross 160ms on their own).
// Only the name is read, and the folder-drop path has no File to give - it passes
// a bare { name } for the folder itself. Typed to what is actually used.
export function showDropLoader(file: { name?: string }|null, onCancel?: (() => void)|null, labelText?: string, immediate?: boolean) {
  clearTimeout(_dropLoaderTimer);
  clearTimeout(_dropLoaderHideTimer);
  _dropLoaderOnCancel = onCancel || null;
  _dropLoaderLabel = null;
  const name = (file && file.name) ? file.name : 'file';
  const reveal = () => {
    if (!_dropLoaderEl || !_dropLoaderEl.isConnected) {
      // A window of accent slashes ('////') bouncing left↔right inside brackets
      // ([   ////   ]), stepped in discrete jumps via a CSS steps() timing so it
      // reads choppy like the original ASCII bar. The motion is a CSS transform,
      // NOT a requestAnimationFrame loop - rAF runs on the main thread, so it
      // froze under the file's heavy synchronous work (FFTs, BPM, pixel stats),
      // exactly when the loader is showing. A CSS animation keeps stepping.
      const win = el('div', { class: 'anr-css-bar-win' }, '/'.repeat(40));
      const track = el('div', { class: 'anr-css-bar-track' }, [win]);
      const bar = el('div', { class: 'anr-css-bar' }, ['[', track, ']']);
      const label = el('div', { class: 'anr-drop-loader-label' }, '');
      // Cancel sits on the same line as the label, pushed to the right; it
      // hides the popup and aborts the in-flight load (see cancelLoad below).
      const cancelBtn = el('button', { type: 'button', class: 'anr-drop-loader-cancel' }, 'Cancel');
      cancelBtn.addEventListener('click', () => {
        const cb = _dropLoaderOnCancel;
        hideDropLoader();
        if (cb) cb();
      });
      const head = el('div', { class: 'anr-drop-loader-head' }, [label, cancelBtn]);
      _dropLoaderEl = el('div', { class: 'anr-drop-loader', role: 'status', 'aria-live': 'polite' }, [head, bar]);
      _dropLoaderEl._label = label;
      document.body.appendChild(_dropLoaderEl);
    }
    _dropLoaderEl._label.textContent = _dropLoaderLabel || labelText || ('Reading ' + name + '…');
    _dropLoaderShownAt = performance.now();
    _dropLoaderOpen = true;
    // Guard the class-add on the intent flag: if hideDropLoader() runs in the
    // sub-frame gap before this fires (a render that settled in ~1 frame), it
    // clears _dropLoaderOpen, so the bar is never shown - otherwise it would
    // latch on here with nothing left to remove it (the stuck-loader bug).
    requestAnimationFrame(() => { if (_dropLoaderOpen && _dropLoaderEl) _dropLoaderEl.classList.add('is-open'); });
  };
  if (immediate) reveal();
  else _dropLoaderTimer = setTimeout(reveal, 160);
}

// Retitle the drop loader mid-flight (progress during a long read).
export function setDropLoaderLabel(text: string|null) {
  _dropLoaderLabel = text || null;
  if (_dropLoaderEl && _dropLoaderEl._label) _dropLoaderEl._label.textContent = text || '';
}

export function hideDropLoader() {
  clearTimeout(_dropLoaderTimer);
  clearTimeout(_dropLoaderHideTimer);
  _dropLoaderOnCancel = null;
  if (!_dropLoaderEl) return;
  // Never committed to showing (cancelled within the 160ms debounce). Check the
  // intent flag, NOT the is-open class - the class lags a frame behind reveal(),
  // so a class check here would bail during that gap and let the pending rAF
  // latch the bar on permanently.
  if (!_dropLoaderOpen) return;
  // doHide drops the intent first (so a still-pending reveal rAF won't re-add
  // is-open) then removes the class. The bar's CSS animation pauses itself via
  // `:not(.is-open)` (see CSS), so there's nothing else to tear down.
  const doHide = () => { _dropLoaderOpen = false; if (_dropLoaderEl) _dropLoaderEl.classList.remove('is-open'); };
  // Already visible: honour the minimum on-screen time so it doesn't flash.
  const shownFor = performance.now() - _dropLoaderShownAt;
  if (shownFor >= DROP_LOADER_MIN_MS) doHide();
  else _dropLoaderHideTimer = setTimeout(doHide, DROP_LOADER_MIN_MS - shownFor);
}

// Let renderers outside the main drop flow (e.g. the video module's "Analyse
// audio" button) drive the same bottom loading popup while they do heavy work.
// The bar is a CSS animation, so it keeps stepping even under the heavy
// synchronous decode/FFT work these actions trigger.
window._anrLoader = {
  show: (label?: string) => showDropLoader(null, null, label || 'Working…'),
  hide: hideDropLoader,
};

// Bottom-of-window suggestion popup (same look as the drop loader) offering to
// re-analyse a file as its sniffed true type.
let _typeSuggestEl: HTMLDivElement|null = null;
export function hideTypeSuggestion() {
  if (!_typeSuggestEl) return;
  const e = _typeSuggestEl; _typeSuggestEl = null;
  e.classList.remove('is-open');
  setTimeout(() => e.remove(), 200);
}
export function showTypeSuggestion(sniff: { label: string }, onAccept: () => void) {
  hideTypeSuggestion();
  const label = el('div', { class: 'anr-drop-loader-label' }, 'This looks like a ' + sniff.label + '.');
  const dismiss = el('button', { type: 'button', class: 'anr-drop-loader-cancel' }, 'Dismiss');
  dismiss.addEventListener('click', hideTypeSuggestion);
  const head = el('div', { class: 'anr-drop-loader-head' }, [label, dismiss]);
  const yes = el('button', { type: 'button', class: 'anr-btn', style: 'font-size:11px;padding:4px 12px;' }, 'Analyse as ' + sniff.label);
  yes.addEventListener('click', () => { hideTypeSuggestion(); onAccept(); });
  _typeSuggestEl = el('div', { class: 'anr-drop-loader', role: 'status' }, [head, el('div', { style: 'margin-top:8px;' }, [yes])]);
  document.body.appendChild(_typeSuggestEl);
  requestAnimationFrame(() => _typeSuggestEl!.classList.add('is-open'));
}

// Cursor-style confirm popup (reuses the treemap .anr-treemap-menu look) shown
// when the "Links" button is clicked, so leaving the site is deliberate.
export function showLinkConfirm(anchor: Element, opts?: any) {
  opts = opts || {};
  document.querySelectorAll('.anr-link-confirm').forEach((n) => n.remove());
  const url = anchor.getAttribute('href');
  const message = opts.message || 'This link leads to link.valjdakosta.com, proceed?';
  const onProceed = opts.onProceed || function () { window.open(url!, '_blank', 'noopener'); };
  const cancelBtn = el('button', { class: 'anr-tm-btn' }, 'Cancel');
  const okBtn = el('button', { class: 'anr-tm-btn anr-tm-btn-ok' }, 'Proceed');
  const menu = el('div', { class: 'anr-treemap-menu anr-link-confirm' }, [
    el('div', { class: 'anr-tm-q' }, message),
    el('div', { class: 'anr-tm-actions' }, [cancelBtn, okBtn]),
  ]);
  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let px = r.left, py = r.bottom + 8;
  if (px + mw > window.innerWidth - 4) px = window.innerWidth - mw - 4;
  if (py + mh > window.innerHeight - 4) py = r.top - mh - 8;
  menu.style.left = Math.max(4, px) + 'px';
  menu.style.top = Math.max(4, py) + 'px';

  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onOut, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
  }
  function onOut(e: Event) { if (!menu.contains(e.target as Node) && e.target !== anchor) close(); }
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', () => { close(); onProceed(); });
  setTimeout(() => {
    document.addEventListener('mousedown', onOut, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
  }, 0);
}
