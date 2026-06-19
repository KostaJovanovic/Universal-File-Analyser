# lib comment audit

Audited the shared binary/WASM-loader helpers for factual comment correctness.
All comments checked against code behaviour, magic bytes, offsets, spec facts, and
numeric constants. No correctness problems were found in any file.

## assets/js/lib/cfbf.js — no issues

Verified: special FAT sentinel values (MAXREGSECT 0xFFFFFFFA, DIFSECT 0xFFFFFFFC,
FATSECT 0xFFFFFFFD, ENDOFCHAIN 0xFFFFFFFE, FREESECT/NOSTREAM 0xFFFFFFFF); header
magic D0 CF 11 E0 A1 B1 1A E1; sectorShift 9/12 → 512/4096; miniSectorShift 6 →
64-byte mini-sectors; 4096-byte mini-stream cutoff; 109 in-header DIFAT pointers
at 0x4C; 128-byte directory entries; red-black tree walk. All match the code.

## assets/js/lib/ghostscript-loader.js — no issues

Verified: noInitialRun set; instantiateWasm hook feeds vendored bytes; gs args
(-dFirstPage=1/-dLastPage=1 = first page only, -r150, -dEPSCrop for EPS,
-dSAFER); PNG signature check 0x89 50 4E 47. All accurate.

## assets/js/lib/legacy-decompress.js — no issues

Verified: LZ4 magic 04 22 4D 18; FLG bit layout (version bits 7-6 must be 01,
contentSize bit 3, contentChecksum bit 2, blockChecksum bit 4, dictId bit 0);
minmatch +4; 7-byte minimum header; BD byte skipped; .Z magic 1F 9D; LZW
9..maxbits variable width with compress(1) bit-group realignment; 256 MB output
cap. All comments match.

## assets/js/lib/libarchive-loader.js — no issues

Verified: lazy ESM import + one-time Archive.init with vendored worker URL;
cached promise reset on failure; lazy per-entry getBytes; supported formats list
(rar/7z/zip/tar/cab/iso). Accurate.

## assets/js/lib/lzma-loader.js — no issues

Verified: 13-byte LZMA-alone header; 256 MB output / 128 MB dictionary caps; low
32 bits of size read with 0xFFFFFFFF as the "size unknown" sentinel mapped to -1;
distinction from .xz (LZMA2). All correct.

## assets/js/lib/nrbf.js — no issues

Verified: RecordTypeEnum values; SerializationHeaderRecord field order
(RootId/HeaderId/Major/Minor); 7-bit-encoded length prefix; BinaryTypeEnum
AdditionalInfo handling (Primitive 0 / PrimitiveArray 7 → PrimitiveTypeEnum,
SystemClass 3 → name, Class 4 → name+lib); DateTime 62-bit ticks + 2-bit kind
with ticks-to-epoch constant 621355968000000000; TimeSpan /1e7 ticks→seconds;
MAX_OBJECTS/MAX_ARRAY guards. All accurate.

## assets/js/lib/occt-loader.js — no issues

Verified: OCCT_VERSION 0.0.23; UMD global `occtimportjs` factory; locateFile
points at CDN; failed-load cache reset. Accurate.

## assets/js/lib/openjpeg-loader.js — no issues

Verified: documented J2KDecoder API (getEncodedBuffer/decode/getFrameInfo/
getDecodedBuffer) matches the code; frameInfo field names
(width/height/bitsPerSample/componentCount/isSigned); interleaved little-endian
sample read; ceil(bits/8) bytes per sample. All correct.

## assets/js/lib/plist.js — no issues

Verified: bplist00 magic check (62 70 6C 69 73 74); 32-byte trailer with
offsetSize at +6, objRefSize at +7, numObjects +8, topObject +16, offTableOff
+24; type markers (int 0x1, real 0x2, date 0x3 with Apple 2001 epoch
978307200000, data 0x4, ASCII 0x5, UTF-16BE 0x6 read as n*2 bytes, array/set
0xa/0xc, dict 0xd); XML data left as base64. All accurate.

## assets/js/lib/sqlite.js — no issues

Verified: lazy sql.js load + locateFile; sqlite_master queries; PRAGMA list;
sqlite\_% internal-table exclusion; largest-table sampling. Comments match.

## assets/js/lib/xz-loader.js — no issues

Verified: xzwasm UMD bundle with embedded base64 .wasm (no separate file);
XzReadableStream usage via Streams API; per-chunk copy due to reused output
buffer; 256 MB output cap. Accurate.
