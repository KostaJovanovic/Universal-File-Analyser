## What this does

Briefly describe the change and the motivation.

Fixes # (issue number, if any)

## Type of change

- [ ] Bug fix
- [ ] New file format support / better format depth
- [ ] New feature or viewer capability
- [ ] Visual / UI polish
- [ ] Docs or internal tooling

## How it was tested

Editing a file and refreshing is the dev loop (`server.bat` on port 3000).
Say what you actually checked:

- Browsers tested:
- Checked in both light and dark themes:
- Checked at narrow / mobile widths:
- Sample file(s) used, if a format change:

## Checklist

- [ ] No new backend, and no code path sends a file's bytes or name off-device.
- [ ] Any new dependency is vendored locally so the app still works offline.
- [ ] No rounded corners or hardcoded colours - reused existing components and
      theme variables.
- [ ] User-facing text is em-dash-free and British-spelled (colour, analyse).
- [ ] I did not bump the version or edit the changelog (the maintainer handles
      that at commit time).
- [ ] I agree my contribution is licensed under the project's
      [GNU General Public License v3.0](../LICENSE).
