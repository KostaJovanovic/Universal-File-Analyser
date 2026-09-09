/* Analyser desktop - one open menu panel, drawn in its own window.
 *
 * Why a window at all: the bar is the main window's own web contents and the
 * site is a CHILD view, and a child view always composites above the contents
 * it was added to. A panel dropped below the bar therefore lands underneath the
 * site and cannot be seen - the DOM measures it as perfectly on-screen, because
 * nothing in the page knows another native view is on top of it. The full note
 * is above ensurePanelWindow() in desktop/main.mjs.
 *
 * The markup is authored here from a tree main sends as plain data. No
 * file-derived string reaches it, so it needs nothing from the site's
 * sanitiser. Styles: the DESKTOP WINDOW CHROME block in analyser.css - the same
 * .anr-tb-panel rules the bar would have used, plus the small
 * html.anr-tb-panel-window block that turns a popover into a whole window.
 */
import { accelLabel } from './accel.js';

const panelApi = window.anrPanel;
const isMacUI = panelApi && panelApi.platform === 'darwin';
const root = document.getElementById('anrPanel');

/** Every entry, in order, for the arrow keys to walk. */
const rows = () => [...root.querySelectorAll('.anr-tb-panel-item')];

function draw(menu) {
  root.textContent = '';
  for (const item of menu.items) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'anr-tb-panel-sep';
      root.appendChild(sep);
      continue;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'anr-tb-panel-item';
    row.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = item.label;
    const key = document.createElement('span');
    key.className = 'anr-tb-panel-key';
    key.textContent = accelLabel(item.accel, isMacUI);
    row.append(label, key);
    row.addEventListener('click', () => panelApi.run(item.id));
    root.appendChild(row);
  }
}

/* The panel keeps its natural size whatever the window is (see the
   html.anr-tb-panel-window block in analyser.css), so this measurement does not
   depend on the size the window happens to be - which is what makes it safe to
   read straight after drawing. Main resizes the window to the answer and only
   then shows it. */
function report(at) {
  const b = root.getBoundingClientRect();
  panelApi.size(Math.ceil(b.width), Math.ceil(b.height), at);
}

if (panelApi) {
  panelApi.onMenu(({ menu, at }) => {
    draw(menu);
    report(at);
    /* And again once the fonts are in. A hidden window produces no frames, so
       requestAnimationFrame cannot be used to wait for layout here - the first
       report is what gets the window on screen, and this one corrects it if the
       mono face landed late and changed the width. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => report(at)).catch(() => {});
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { panelApi.close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = rows();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    list[(at + step + list.length) % list.length].focus();
  });
}
