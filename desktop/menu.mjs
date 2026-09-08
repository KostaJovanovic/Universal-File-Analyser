/* Analyser desktop - application menu.
 *
 * Deliberately small. The app's own header is the real navigation; this exists
 * for the two things a browser tab cannot do (open a path from disk) and for
 * the window controls people expect from a native menu bar.
 *
 * Labels follow the site's writing convention: British spelling, no em-dashes.
 */

import { app, Menu } from 'electron';

const isMac = process.platform === 'darwin';
const REPO = 'https://github.com/KostaJovanovic/Universal-File-Analyser';

/**
 * @param {{openFile: Function, openFolder: Function, go: Function, external: Function, showData: Function}} actions
 * @returns {Electron.Menu}
 */
export function buildMenu(actions) {
  const template = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    });
  }

  template.push({
    label: '&File',
    submenu: [
      { label: 'Open file…', accelerator: 'CmdOrCtrl+O', click: () => actions.openFile() },
      { label: 'Open folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => actions.openFolder() },
      { type: 'separator' },
      { label: 'Compare two files', click: () => actions.go('/compare') },
      { label: 'Home', click: () => actions.go('/') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  });

  template.push({
    label: '&Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { type: 'separator' }, { role: 'selectAll' },
    ],
  });

  template.push({
    label: '&View',
    submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ],
  });

  template.push({
    label: '&Go',
    submenu: [
      { label: 'Formats', click: () => actions.go('/formats') },
      // No Samples entry: web/samples/ is left out of the package (19 MB of
      // example files), so the gallery has nothing to hand out here.
      { label: 'Documentation', click: () => actions.go('/docs') },
      { label: 'Statistics', click: () => actions.go('/stats') },
      { label: 'Changelog', click: () => actions.go('/patch') },
      { label: 'About', click: () => actions.go('/about') },
      { label: 'Privacy', click: () => actions.go('/privacy') },
    ],
  });

  template.push({
    role: 'help',
    label: '&Help',
    submenu: [
      { label: 'User guide', click: () => actions.go('/docs/user-guide') },
      { label: 'Frequently asked questions', click: () => actions.go('/docs/faq') },
      { type: 'separator' },
      // Portable copies keep everything beside the program. Make that checkable.
      { label: 'Where my data is stored', click: () => actions.showData() },
      { type: 'separator' },
      { label: 'Open the website', click: () => actions.external('https://analyser.valjdakosta.com/') },
      { label: 'Source on GitHub', click: () => actions.external(REPO) },
    ],
  });

  return Menu.buildFromTemplate(template);
}
