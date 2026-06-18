# parsers (gaming/geodata/osmisc/raw) comment audit

## assets/js/parsers/parsers-gaming.js

- **Line 1024** — `r.seek(0x54); // hunkbytes (v5)` → The comment labels offset 0x54 (= 84) as the CHD v5 `hunkbytes` field, but in the CHD v5 header `hunkbytes` is a u32 at offset 56 (0x38) — offset 0x54 (84) falls inside the SHA-1 digest area (rawsha1/sha1), not `hunkbytes`. (v5 layout: compressors[4]@0x10, logicalbytes u64@0x20, mapoffset u64@0x28, metaoffset u64@0x30, hunkbytes u32@0x38, unitbytes u32@0x3C, then 20-byte SHA-1 hashes.) → **Fix:** `r.seek(0x38); // hunkbytes (v5, u32 at offset 56)`.

- **Line 1572** — `// VCDIFF magic: 0xD6 0xC3 0xC4 'C' (xdelta3) then a version byte.` → The 4th byte of the VCDIFF magic is the version byte (0x00 per RFC 3284), not the ASCII character `'C'` (0x43). The first three bytes 0xD6 0xC3 0xC4 are `'V'|0x80 'C'|0x80 'D'|0x80`; the comment both mislabels the 4th byte as `'C'` and then contradicts itself by saying "then a version byte". The code only checks the first three bytes, consistent with the magic being 3 signature bytes + a version byte. → **Fix:** `// VCDIFF magic: 0xD6 0xC3 0xC4 (V|80 C|80 D|80) then a version byte (0x00).`

- **Line 256 / 258** — `// Read enough to inspect both raw and +512 offsets.` and `// "SEGA" sits at 0x100 in a plain ROM; with a 512-byte copier header at 0x300.` → The code reads 0x300 bytes but only ever tests `startsWithAscii(buf, 'SEGA', 0x100)`; it never inspects the +512 (0x300) offset, so a copier-headered Genesis/SMD ROM (SEGA at 0x300) is *not* detected — the function returns null. The comments describe a both-offsets / +512 inspection the code does not perform. → **Fix:** note that only the 0x100 (headerless) offset is checked, e.g. `// "SEGA" sits at 0x100 in a plain de-interleaved ROM; copier-headered ROMs (SEGA at 0x300) are not detected here.`

## assets/js/parsers/parsers-geodata.js — no issues

## assets/js/parsers/parsers-osmisc.js — no issues

## assets/js/parsers/parsers-raw.js — no issues
