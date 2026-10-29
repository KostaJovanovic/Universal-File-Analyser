# Third-Party Notices

This repository is distributed under the GNU Affero General Public License v3.0.
The components below retain their own upstream licenses and are used as third-party dependencies or embedded source copies.

## Parser Library

- zlib, used through the bundled third-party sources, is licensed under the zlib license.
- stb_image is licensed under the Creative Commons Zero v1.0 Universal license.
- PDFium is used in `src/prc_pdf_decrypt.c` for adapted encryption-related methods and is licensed under the BSD 3-Clause License. See `thirdparty/PDFium_LICENSE.txt`.
- `src/prc_pdf_decrypt.c` contains code adapted from PDFium and carries a file-level attribution notice for that reason.

## Viewer Application

- ImGui is licensed under the MIT license.
- MatrixUtil is licensed under the MIT license.
- SDL is licensed under the zlib license.
- stb_image is licensed under the Creative Commons Zero v1.0 Universal license.
- stb_truetype is licensed under the Creative Commons Zero v1.0 Universal license.
- stb_image_write is distributed under its upstream public-domain-style license.

If you redistribute binaries or source bundles, include the relevant upstream license texts for these dependencies.