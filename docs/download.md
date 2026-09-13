# Download

Analyser runs in any modern browser at
[analyser.valjdakosta.com](https://analyser.valjdakosta.com/), with nothing to
install. The apps below wrap that same site. They add hardware video encoding,
opening files from other apps and native save dialogs. Everything still happens
on your own device.

Every file is on one page: the
**[latest release on GitHub](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest)**.
Each file name ends in the version, for example `Analyser-Windows-9.9.0.exe`.

| System | File on the release page | Updates |
|---|---|---|
| Windows 10 and 11 | `Analyser-Windows-<version>.exe` | Installs itself |
| macOS, Apple silicon and Intel | `Analyser-mac-universal-<version>.dmg` | Tells you |
| Linux | `Analyser-linux-x64-<version>.AppImage` | Installs itself |
| Android 7 and later | `Analyser-android-<version>.apk` | Asks, then installs |

The Windows installer asks first how to set Analyser up. **Install** adds it to
the Start menu and the desktop, for your own user account. **Portable copy**
puts it in a folder you choose on the same page, for example on a USB stick. A
portable copy writes nothing to the computer and keeps its settings in its own
folder. To remove it, delete the folder.

"Installs itself" means that the app downloads a new version in the background
and installs it when you quit. It also offers to restart at once. "Tells you"
means that a message offers to open the release page when a new version is
out. A portable copy on Windows also tells you: run the new Windows file, choose
**Portable copy** and pick the same folder. macOS
installs an update by itself only for an app with a paid Apple signature.

The Android app asks before it downloads anything. On Android 12 and later the
update then installs with no further question. Older versions show the
Android confirm screen, as they do for any app.

## The first run

No build carries a paid signing certificate yet, so each system asks once:

- **Windows:** SmartScreen stops the first run. Click **More info**, then
  **Run anyway**.
- **macOS:** open the app once and close the warning. Then open **System
  Settings > Privacy & Security** and click **Open Anyway**.
- **Linux:** make the AppImage executable
  (`chmod +x Analyser-linux-x64-*.AppImage`), then run it.
- **Android:** when Android asks, allow your browser or file manager to install
  apps.

## Privacy

The apps ask GitHub which release is the latest. That request sends nothing
about you or your files. See the [desktop app](desktop.md) and the
[Android app](mobile.md) pages for the details.
