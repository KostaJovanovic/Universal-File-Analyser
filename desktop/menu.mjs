/* Analyser desktop - the application menu.
 *
 * ONE definition, two consumers, and that is the whole point of the shape here:
 *
 *   - buildMenu()  makes the real Electron Menu. It is never shown - the window
 *                  is frameless, so there is no menu bar to drop it from - but
 *                  setting it is what registers every accelerator, so Ctrl+O and
 *                  friends keep working.
 *   - menuModel()  strips the same tree down to plain data for the title bar,
 *                  which draws the menus itself (desktop/chrome/titlebar.js) in
 *                  the site's own type and hairlines rather than the OS's.
 *
 * A click in the drawn menu comes back as an id and runs through runMenuItem(),
 * so the handler in this file is the only copy of what an entry does.
 *
 * Deliberately small. The app's own header is the real navigation; this exists
 * for the things a browser tab cannot do, and for the window-level commands
 * people expect from a menu bar.
 *
 * Labels follow the site's writing convention: British spelling, no em-dashes.
 */

import { app, Menu } from 'electron';

const isMac = process.platform === 'darwin';
const REPO = 'https://github.com/KostaJovanovic/Universal-File-Analyser';

const SEP = { type: 'separator' };

/**
 * The menu, as data. Every clickable entry carries an `id` (what the title bar
 * sends back) and a `run` (what it does). `accel` is an Electron accelerator
 * string; the title bar formats it for display.
 *
 * @param {{openFile: Function, openFolder: Function, go: Function, external: Function,
 *          showData: Function, view: Function}} actions
 */
export function menuTree(actions) {
  return [
    {
      id: 'file', label: 'File', items: [
        { id: 'file.open', label: 'Open file', accel: 'CmdOrCtrl+O', run: () => actions.openFile() },
        { id: 'file.openFolder', label: 'Open folder', accel: 'CmdOrCtrl+Shift+O', run: () => actions.openFolder() },
        SEP,
        { id: 'file.compare', label: 'Compare two files', run: () => actions.go('/compare') },
        { id: 'file.home', label: 'Home', run: () => actions.go('/') },
        SEP,
        isMac
          ? { id: 'file.close', label: 'Close window', accel: 'Cmd+W', run: () => actions.view('close') }
          : { id: 'file.quit', label: 'Exit', accel: 'Ctrl+Q', run: () => actions.view('quit') },
      ],
    },
    {
      id: 'view', label: 'View', items: [
        { id: 'view.reload', label: 'Reload', accel: 'CmdOrCtrl+R', run: () => actions.view('reload') },
        SEP,
        { id: 'view.zoomIn', label: 'Zoom in', accel: 'CmdOrCtrl+Plus', run: () => actions.view('zoomIn') },
        { id: 'view.zoomOut', label: 'Zoom out', accel: 'CmdOrCtrl+-', run: () => actions.view('zoomOut') },
        { id: 'view.zoomReset', label: 'Actual size', accel: 'CmdOrCtrl+0', run: () => actions.view('zoomReset') },
        SEP,
        { id: 'view.full', label: 'Full screen', accel: isMac ? 'Ctrl+Cmd+F' : 'F11', run: () => actions.view('fullScreen') },
        { id: 'view.devtools', label: 'Developer tools', accel: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', run: () => actions.view('devTools') },
      ],
    },
    {
      id: 'go', label: 'Go', items: [
        { id: 'go.back', label: 'Back', accel: 'Alt+Left', run: () => actions.view('back') },
        { id: 'go.forward', label: 'Forward', accel: 'Alt+Right', run: () => actions.view('forward') },
        SEP,
        { id: 'go.formats', label: 'Formats', run: () => actions.go('/formats') },
        // No Samples entry: web/samples/ is left out of the package (19 MB of
        // example files), so the gallery has nothing to hand out here.
        { id: 'go.docs', label: 'Documentation', run: () => actions.go('/docs') },
        { id: 'go.stats', label: 'Statistics', run: () => actions.go('/stats') },
        { id: 'go.patch', label: 'Changelog', run: () => actions.go('/patch') },
        { id: 'go.about', label: 'About', run: () => actions.go('/about') },
        { id: 'go.privacy', label: 'Privacy', run: () => actions.go('/privacy') },
      ],
    },
    {
      id: 'help', label: 'Help', items: [
        { id: 'help.guide', label: 'User guide', run: () => actions.go('/docs/user-guide') },
        { id: 'help.faq', label: 'Frequently asked questions', run: () => actions.go('/docs/faq') },
        SEP,
        // Portable copies keep everything beside the program. Make that checkable.
        { id: 'help.data', label: 'Where my data is stored', run: () => actions.showData() },
        SEP,
        { id: 'help.site', label: 'Open the website', run: () => actions.external('https://analyser.valjdakosta.com/') },
        { id: 'help.repo', label: 'Source on GitHub', run: () => actions.external(REPO) },
      ],
    },
  ];
}

/**
 * The real Menu. Never popped up - the drawn one in the title bar replaces it -
 * but Menu.setApplicationMenu() is what makes the accelerators live, so this has
 * to exist and has to carry every shortcut the drawn menu advertises.
 *
 * The Edit block is here and NOT in the tree above on purpose: cut, copy, paste,
 * undo and select-all are keyboard reflexes and already sit in the page's own
 * context menu, so listing them in a drawn menu is noise. They still need their
 * accelerators registered, which is exactly what this does.
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

  for (const menu of menuTree(actions)) {
    template.push({
      label: menu.label,
      submenu: menu.items.map((it) => (it.type === 'separator'
        ? { type: 'separator' }
        : { label: it.label, accelerator: it.accel, click: it.run })),
    });
  }

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { type: 'separator' }, { role: 'selectAll' },
    ],
  });

  return Menu.buildFromTemplate(template);
}

/** The same tree as plain data, for the title bar to draw. No functions cross
 *  the IPC boundary - a click comes back as an id instead. */
export function menuModel(actions) {
  return menuTree(actions).map((menu) => ({
    id: menu.id,
    label: menu.label,
    items: menu.items.map((it) => (it.type === 'separator'
      ? { type: 'separator' }
      : { id: it.id, label: it.label, accel: it.accel || '' })),
  }));
}

/** Run the entry the title bar reports. Unknown ids are ignored rather than
 *  trusted: the id arrives from a renderer. */
export function runMenuItem(actions, id) {
  for (const menu of menuTree(actions)) {
    for (const it of menu.items) {
      if (it.type !== 'separator' && it.id === id) { it.run(); return true; }
    }
  }
  return false;
}
