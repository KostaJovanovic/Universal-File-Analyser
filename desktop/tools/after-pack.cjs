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
  // The universal build packs x64 and arm64 into `<dir>-x64-temp` and
  // `<dir>-arm64-temp`, merges them, then calls this hook once more on the
  // merged app. Only that last one ships. Signing the two halves first would
  // make their files differ, which @electron/universal refuses to merge.
  if (/-temp$/.test(context.appOutDir)) return;
  const bundle = join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
};
