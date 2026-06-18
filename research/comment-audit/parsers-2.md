# parsers (disk/docs/email) comment audit

## assets/js/parsers/parsers-disk.js

- **Line 961** — `// header checksum + ext offset packed; skip` → After `r.seek(44)`, this `r.u32()` skips the 4 bytes at offset 44 of the EFI_FIRMWARE_VOLUME_HEADER. Per the UEFI spec the field at offset 44 is `Attributes` (EFI_FVB_ATTRIBUTES_2, a u32), not the header checksum / extended-header offset. The 16-bit `Checksum` lives at offset 50 and the 16-bit `ExtHeaderOffset` at offset 52 (with HeaderLength at 48, Reserved at 54, Revision at 55 — the latter correctly read as `b[55]` on the next line). The comment mislabels the skipped field. **Fix:** `// skip Attributes (u32 at offset 44); header length/checksum/ext-offset follow`.

## assets/js/parsers/parsers-docs.js — no issues

## assets/js/parsers/parsers-email.js — no issues
