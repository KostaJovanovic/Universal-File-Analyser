# renderers/proprietary.js comment audit

No factual comment-correctness issues found.

The file (~4100 lines) was read in full and every comment - file/section headers,
inline `//` notes, JSDoc-style block comments, and the dense format-fact annotations
(magic bytes, byte offsets, vendor/app names, spec constants, control-flow notes) -
was verified against the surrounding code. All comments accurately describe the code.

Spot-checked claims that all proved correct against the code:

- **PE/EXE offsets** (lines 238, 248, 283, 293, 299, 304, 317, 328): COFF
  characteristics at `peOffset+22`, linker version at `optBase+2/+3`, subsystem at
  `+68`, subsystem version at `+48/+50`, image size at `+56`, DllCharacteristics at
  `+70`, entry point at `+16`, resource dir index 2 - all match the code and the PE
  spec. COFF/DllCharacteristics flag bits (0x2000 DLL, 0x0002 EXE, 0x0020 large-address,
  0x0020/0x0040/0x0080/0x0100/0x0400/0x4000/0x8000 mitigations) match.
- **VS_VERSIONINFO** struct layout (lines 379-385, 423) and `0xFEEF04BD` signature.
- **GRPICONDIR / GRPICONDIRENTRY(14)** layout (lines 523-525): width/height/colorCount/
  reserved/planes(2)/bitCount(2)/bytesInRes(4)/id(2) - offsets read at e+4 (planes),
  e+6 (bitCount), e+12 (id) all match.
- **GLB magic** `0x46546C67` (lines 92-96), **FBX** "Kaydara FBX Binary" + version at
  offset 23 (lines 79-84), **PSD** "8BPS" (line 32), **DWG** AC10xx version table
  (lines 50-60), **Blender** header (lines 63-68), **STL** ASCII/binary + triangle
  count at offset 80 (lines 107-118).
- **SWF** compression byte (C=zlib, Z=LZMA) and uncompressed-size at offset 4 (lines 123-135).
- **FLP** event IDs (lines 940-961): 0x42 legacy Tempo (WORD), 0x9C FineTempo/1000
  (DWORD), 199 FLP_Version, 194 Title, 195 Comment, 206 Genre, 207 Author, 192 ChanName,
  201/203 plugin names - all consistent with the FL Studio event enum.
- **SQLite** header magic, page-size encoding, **WAL** magic `0x377f0682/0683`
  (lines 1089, 1103), **SHM** WalIndexHdr iVersion 3007000 (lines 1149-1191), all frame/
  header offsets.
- **Android binary XML** chunk types (lines 1339, 1376-1407): RES_XML_TYPE 0x0003,
  string pool 0x0001, resource map 0x0180, start 0x0102, end 0x0103 - all correct.
- **APK Sig Block** magic "APK Sig Block 42" and scheme block IDs v2 `0x7109871a`,
  v3 `0xf05368c0`, v3.1 `0x1b93ad61` (LE byte order in code) (lines 1545-1550).
- **E-AC-3** 0x0B77 sync word, fscod2/numblkscod branch, acmod array `[2,1,2,3,3,4,4,5]`,
  sample-rate table (lines 2902-2936); **TrueHD/MLP** major sync `0xF8726FBA`/`0xF8726FBB`
  (lines 2939-2949).
- **STEP/ISO-10303-21** header parsing, AP203/214/242 schema mapping, comment-strip logic
  (lines 2017-2166).
- **X.509** ASN.1 walk, OID table, UTCTime/GeneralizedTime tags 0x17 vs others, version
  `der[vi.start]+1` (lines 2245-2352).
- **MSI** SummaryInformation Template "platform;language" and Intel->x86 mapping (lines 2199-2208).
- **LNK** MS-SHLLINK header CLSID, LinkFlags bits, FILETIME (100-ns ticks since 1601),
  StringData blocks (lines 3223-3322).
- **MBR/GPT/FAT** disk-image parsing: partition-type table, GPT `EFI PART` at sector 1,
  PartitionEntryLBA at GPT header offset 0x48, FAT BPB offsets (lines 3355-3466).
- **ISO 9660** PVD at sector 16 (32768) with "CD001" at offset 1 (lines 1210, 3919-3922).
- **CapCut** microsecond durations, **Premiere** 254016000000 ticks/sec, **CTG**,
  **Criterium/CDP4**, **RTF**, **VDF** notes - all consistent with the code.
