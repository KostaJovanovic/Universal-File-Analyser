/* Analyser desktop - an Electron accelerator string, as the user reads it.
 *
 * Shared by the bar (titlebar.js) and the menu panels (panel.js). They are
 * separate pages in separate windows with no scope between them, so the one
 * thing they both need lives here rather than being written twice and drifting.
 */

/** @param {string} a  an Electron accelerator, e.g. 'CmdOrCtrl+Shift+I'
 *  @param {boolean} isMac  macOS joins the parts with nothing, not '+' */
export function accelLabel(a, isMac) {
  if (!a) return '';
  return a
    .replace(/CmdOrCtrl|CommandOrControl/g, isMac ? 'Cmd' : 'Ctrl')
    .replace(/\bPlus\b/g, '+')
    .split('+')
    .filter(Boolean)
    .join(isMac ? '' : '+');
}
