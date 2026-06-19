# renderers (photo group) comment audit

Audited every `//`, `/* */`, and JSDoc comment in the ten photo-group renderer
files against the code, with particular attention to claimed EXIF/IFD tags, byte
offsets, magic bytes, codec/format facts and numeric constants. Verified the
following representative facts hold against the code (no fix needed): Sony
maker-note tag 0x9050 + cubic substitution cipher `(i*i*i) % 249` and the
0x3a/0x32 (Tag9050b/Tag9050a) offsets; Nikon tag 0x00A7 ShutterCount, "Nikon\0"
signature, embedded-TIFF-at-mo+10 maths; the TIFF base / `Exif\0\0` APP1 logic;
MPF tags 0xB001 (NumberOfImages) / 0xB002 (MP Entry), 16-byte MP entries;
SOF marker exclusions (DHT C4, JPG C8, DAC CC); ICONDIRENTRY field offsets and
the rebuilt 22-byte head; TIFF type-size table and the 0x002A/0x002B (BigTIFF)
magic; GIF interlace passes, NETSCAPE loop offset (pos+16), centisecond delays;
WebP VP8X flag bits (alpha 0x10, anim 0x02, EXIF 0x08, XMP 0x04, ICC 0x20) and
24-bit-minus-one canvas dimensions; PNG pHYs ppm→DPI (×0.0254), colour-type
table, APNG acTL; pHYs/BMP/JFIF density maths; tonal-split cutoffs (shadows < 64,
midtones 64–191, highlights ≥ 192); OCR 60% confidence filter and 2000px upscale;
X3F FOVb/SECd/IMA2 format-18-JPEG parsing.

No factual correctness problems were found in any of the ten files.

## assets/js/renderers/photo.js — no issues

## assets/js/renderers/photo-convert.js — no issues

## assets/js/renderers/mpo.js — no issues

## assets/js/renderers/tiff.js — no issues

## assets/js/renderers/ico.js — no issues

## assets/js/renderers/gif-frames.js — no issues

## assets/js/renderers/webp-frames.js — no issues

## assets/js/renderers/gif-encode.js — no issues

## assets/js/renderers/embedded-images.js — no issues

## assets/js/renderers/illustrator.js — no issues
