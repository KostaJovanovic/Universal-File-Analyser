# parsers (archive/audio/dev) comment audit

## assets/js/parsers/parsers-archive.js — no issues

All comments verified against the parsing code. Spot-checks that passed:

- TAR ustar magic at offset 257, octal size field at 124, checksum at 148 (lines 82-87, 99-103) — correct.
- GZIP magic `1f 8b 08`, flag bits FEXTRA/FNAME/FCOMMENT/FHCRC, XFL 2=best/4=fastest, ISIZE = last 4 bytes (lines 142-184) — correct.
- bzip2 `BZh`, block magic `0x314159265359` ("pi") / EOS `0x177245385090` (lines 190-194) — correct (code checks the first 3 bytes of the pi magic).
- xz magic `FD 37 7A 58 5A 00`, check-type nibble (lines 209-213) — correct.
- zstd frame magic `28 B5 2F FD`, skippable-frame magic range `0x184D2A50..5F`, FHD field extraction, checksum xxHash64 (lines 288-324) — comments correct (note: the skippable-magic *code* test `(head[3] & 0xf0) === 0x18` is a code bug, but the comment is accurate).
- LZ4 frame magic `0x184D2204` (LE), block-max-size map, FLG/BD bit layout (lines 335-351) — correct.
- LZMA props `< 225`, lc/lp/pb derivation, 8-byte LE uncompressed size, `0xFF…` = unknown (lines 375-381) — correct.
- compress `.Z` magic `1f 9d`, maxbits low 5 bits, block-mode bit 7 (lines 396-404) — correct.
- cpio newc/odc/bin magics and offsets (namesize@94/filesize@54 for newc; @59/@65 for odc) (lines 415-444) — correct.
- ar `!<arch>\n`, 60-byte members, `` `\n `` terminator, 2-byte alignment (lines 469-476) — correct.
- RPM lead magic `ED AB EE DB`, 96-byte lead, header magic `8E AD E8` + 8-byte total, index entries 16 bytes (lines 598-634) — correct.
- XAR `xar!`, 28-byte big-endian header, zlib TOC (lines 1024-1051) — correct.
- lzop 9-byte magic `89 4C 5A 4F 00 0D 0A 1A 0A` (lines 1093-1094) — correct.
- SquashFS `hsqs`(LE)/`sqsh`(BE), compression-id map, superblock field order (lines 1137-1157) — correct.
- cab CFFILE "16 bytes + null-terminated name" (line 718) and CFHEADER field order — correct.

## assets/js/parsers/parsers-audio.js

- **Line 1058** — `// Magic: 0xFE 'FAR' followed by ... actually "FAR\xFE"` → The two halves of this comment contradict each other and the code. The code (line 1059) tests `head[0] === 0xFE && ascii(head, 1, 3) === 'FAR'`, i.e. byte order `FE 46 41 52` (0xFE then "FAR"). The Farandole Composer magic is actually "FAR" followed by `0xFE` (`46 41 52 FE`), as the comment's own "actually FAR\xFE" tail states — which is the reverse of both the comment's opening "0xFE 'FAR'" and of what the code checks. The note is self-contradictory and does not match the code. **Fix:** `// Magic: "FAR" + 0xFE (bytes 46 41 52 FE).` (and the byte-order test in the code should be revisited).

Other spot-checks that passed:

- APEv2 footer `APETAGEX`, header-flag bit 29 (`0x20000000`), size includes 32-byte footer (lines 34-54) — correct.
- ID3v2 syncsafe size `(b6<<21)|(b7<<14)|(b8<<7)|b9`, total = 10 + size (lines 83-87) — correct.
- APE `MAC `, new header (>=3980) descriptor layout, old-header field order, compression-level map (lines 95-137) — correct.
- WavPack `wvpk`, flags bits 0-1 bytes/sample-1, bit2 mono, bit3 hybrid, bits 23-26 sample-rate index (lines 162-173) — correct.
- DSF `DSD `, DSD chunk magic(4)+size(8), fmt chunk at 28, metaPtr offset (lines 261-283) — correct.
- DFF `FRM8`/`DSD `, FRM8+size(8)+"DSD " = offset 16, PROP/FS/CHNL/CMPR walk (lines 290-317) — correct.
- AU `.snd` = `0x2E736E64` big-endian, encoding/bits maps (lines 489-505) — correct.
- BWF bext field offsets (desc@0, originator@256, ref@288, date@320, time@330, timeref@338) (lines 538-549) — correct.
- Speex `OggS` + "Speex   ", header field layout (lines 569-583) — correct.
- GSM 33-byte frames, 160 samples/frame @ 8 kHz, first-nibble 0xD heuristic (lines 644-652) — correct.
- MPEG-1/2 verBits 3=MPEG1/2=MPEG2/0=MPEG2.5, layerBits 3=I/2=II/1=III, bitrate/samplerate tables (lines 662-702) — correct.
- SF2 `RIFF`/`sfbk`, record sizes phdr=38/inst=22/shdr=46 (count = bytes/recsize − 1) (lines 717-742) — correct.
- SPC `SNES-SPC700 Sound File Data`, ID666 at 0x2E, tag byte at 0x23 (lines 1130-1133) — correct.
- VGM `Vgm `, version/eof/sample/gd3 offsets, GD3 `Gd3 ` UTF-16LE fields (lines 1168-1202) — correct.
- AY `ZXAYEMUL`, relative big-endian pointers at 0x12/0x14 (lines 1226-1234) — correct.
- YM `YM[2-6]!` / `LeOnArD!` at offset 4, 50 Hz VBL, `-lh5-` LHA wrapper at offset 2 (lines 1245-1258) — correct.
- Composer 669 "if"/"JN", MMD0-3, OKTASONG, MMMD (SMAF) magics — correct.

## assets/js/parsers/parsers-dev.js — no issues

All comments verified. Spot-checks that passed:

- JWT base64url header/payload split, `alg: none` warning (lines 36-59) — correct.
- WASM magic `00 61 73 6d`, section IDs 2=Import/3=Function/7=Export/0=Custom, ULEB sizes (lines 158-178) — correct.
- Java class `CA FE BA BE`, minor/major u16, constant-pool count − 1, JDK major→version map (lines 193-202) — correct.
- NumPy `.npy` magic `93 4E 55 4D 50 59` ("\x93NUMPY"), v2+ 4-byte hlen else 2-byte (lines 209-213) — correct.
- Safetensors 8-byte LE header length, JSON metadata (lines 229-233) — correct.
- GGUF `GGUF`, u32 version, u64 tensor/kv counts (lines 254-258) — correct.
- pyc magic u16 + `0D 0A` at bytes 2-3, magic→version map (lines 481-489) — correct.
- MessagePack type ranges/opcode map, big-endian Reader (lines 596-651) — correct.
- CBOR major types, argument-length encoding, self-describe tag `D9 D9 F7` (= tag 55799) (lines 668-695) — correct.
- BSON little-endian, type map, value-skip sizes per type (lines 712-743) — correct.
- Protobuf wire types (varint/64-bit/len-delimited/32-bit), `field = tag/8`, `wire = tag & 7` (lines 760-797) — correct.
- Pickle PROTO opcode `0x80` carrying version, GLOBAL `0x63` "module\nname\n", protocol-0/1 openers `( c ] } {` (lines 828-858) — correct.
- Redis RDB `REDIS`, version ascii(5,4), aux `0xFA` / SELECTDB `0xFE`, length-encoding type bits (lines 1030-1054) — correct.
- Arrow `ARROW1` head+tail / `FEA1` v1 / `FF FF FF FF` stream marker (lines 1066-1082) — correct.
- Parquet `PAR1`/`PARE`, footer length = 4 bytes before trailing magic (LE) (lines 1091-1095) — correct.
- ORC trailing `ORC` magic, PostScript length byte before it (lines 1110-1116) — correct.
- MAT v7.3 HDF5 `89 48 44 46`, v5 128-byte text header + `IM`/`MI` endian at 126 (lines 1005-1016) — correct.
