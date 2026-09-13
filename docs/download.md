# Download

Analyser runs in any modern browser at
[analyser.valjdakosta.com](https://analyser.valjdakosta.com/), with nothing to
install. The apps below wrap that same site. They add hardware video encoding,
opening files from other apps and native save dialogs. Everything still happens
on your own device.

Every file is on one page: the
**[latest release on GitHub](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest)**.
The links below always point at the newest version.

| System | Download | Updates |
|---|---|---|
| Windows 10 and 11 | [Installer](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest/download/Analyser-Setup-x64.exe) | Installs itself |
| Windows, portable | [One .exe that runs from anywhere](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest/download/Analyser-Portable-x64.exe) | Tells you |
| Windows, zip | [Unzip and run](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest/download/Analyser-win-x64.zip) | Tells you |
| macOS, Apple silicon (M1 and later) | [Disk image](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest/download/Analyser-mac-arm64.dmg) | Tells you |
| macOS, Intel | [Disk image](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest/download/Analyser-mac-x64.dmg) | Tells you |
| Linux | [AppImage](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest/download/Analyser-linux-x64.AppImage) | Installs itself |
| Linux, Debian and Ubuntu | [.deb package](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest/download/Analyser-linux-x64.deb) | Tells you |
| Android 7 and later | [APK](https://github.com/KostaJovanovic/Universal-File-Analyser/releases/latest/download/Analyser-android.apk) | Asks, then installs |

"Installs itself" means that the app downloads a new version in the background
and installs it when you quit. It also offers to restart at once. "Tells you"
means that a message offers to open the release page when a new version is out.
Those copies cannot replace themselves: a portable copy has no installer, and
macOS installs an update by itself only for an app with a paid Apple signature.

The Android app asks before it downloads anything. Then the Android installer
asks you to confirm, as it does for any app.

## The first run

No build carries a paid signing certificate yet, so each system asks once:

- **Windows:** SmartScreen stops the first run. Click **More info**, then
  **Run anyway**.
- **macOS:** open the app once and close the warning. Then open **System
  Settings > Privacy & Security** and click **Open Anyway**.
- **Linux:** make the AppImage executable
  (`chmod +x Analyser-linux-x64.AppImage`), then run it.
- **Android:** when Android asks, allow your browser or file manager to install
  apps.

## Privacy

The apps check GitHub for a new version. A check asks for one small file that
names the latest version. It sends nothing about you or your files. See the
[desktop app](desktop.md) and the [Android app](mobile.md) pages for the
details.
