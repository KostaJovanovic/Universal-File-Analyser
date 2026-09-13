/* electron-builder afterPack hook: an ad-hoc signature for the macOS app.
 *
 * There is no Apple Developer ID certificate, so electron-builder.yml sets
 * mac.identity to null and electron-builder signs nothing. That would leave the
 * bundle with a BROKEN signature: Electron's own, which the renamed executable
 * and the new Info.plist invalidate. macOS calls a downloaded app with a broken
 * signature "damaged", and the only way past that is a terminal command. An
 * ad-hoc signature is valid, so macOS offers "Open Anyway" in Privacy &
 * Security instead.
 *
 * It runs last among the afterPack handlers ("user handler should be last" in
 * app-builder-lib's packager.js), so after electron-builder writes
 * resources/app-update.yml. Anything written into the bundle after this line
 * would break the signature again.
 *
 * Remove this hook and `mac.identity: null` once a certificate exists. Then
 * electron-builder signs, notarisation becomes possible, and updater.mjs can
 * let macOS install updates by itself.
 *
 * CommonJS on purpose: electron-builder require()s a .cjs hook.
 */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const bundle = join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
};
