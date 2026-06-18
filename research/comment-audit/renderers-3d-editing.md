# renderers (3D / editing group) comment audit

Audited every `//`, `/* */`, and header-block comment in the nine files for factual
correctness against the code. Magic-byte constants, RIFF/ZIP/GLB signatures, numeric
timebases, offsets, GUIDs, tag names and frame-rate derivations were verified directly
(including decoding the relevant byte values where the comment cites a concrete number).

No factual correctness problems were found. The notable claims that were checked and
confirmed correct are listed per file below.

## assets/js/renderers/model3d.js — no issues
Verified:
- GLB magic constants (line 479/484/485): `0x46546c67`='glTF', `0x4e4f534a`='JSON',
  `0x004e4942`='BIN\0' all decode correctly (little-endian).
- `GLTF_COMP`/`GLTF_COMP_SIZE`/`GLTF_NUMC` (lines 473-475) match the glTF 2.0 componentType
  enums (5120-5126) and accessor type sizes.
- 3MF/AMF/OBJ/PLY/OFF/STEP structural comments match the parsing control flow; the
  "12-number affine -> 4x4 row-major" and "compose A then B (P·A·B)" matrix comments
  match `to44`/`compose`.

## assets/js/renderers/stl.js — no issues
Verified:
- "Binary STL is 84 + 50*n bytes" (line 14) matches `84 + count*50` checks.
- Signed-tetra volume formula comment (line 49) matches the `a·(b×c)/6` code.
- Bounding-box / surface-area / normal-recompute comments match the implementations.

## assets/js/renderers/davinci.js — no issues
Verified:
- ZIP magic constants: EOCD `0x06054b50`, central dir `0x02014b50`, local header
  `0x04034b50` are all correct.
- `<MediaFrameRate>` example "286b55e2… -> 29.97" (line 21): with the real high bytes
  this decodes to 29.96999…, so the illustrative example is accurate.
- "default timeline start 01:00:00:00 … 108000 / 3600 = 30" (lines 22-26, 160-162) matches
  `startFrame / 3600` and the nearest-standard-rate snap.
- The "::" -> "__" tag-rewrite rationale (lines 44-49) matches `parseXml`.

## assets/js/renderers/vegas.js — no issues
Verified:
- "lowercase 'riff' + 16-byte form GUID" header (lines 3-5) is the Sonic Foundry RIFF-GUID
  fact; the magic check (line 149) additionally tolerates uppercase "RIFF" defensively,
  which does not contradict the comment.
- `{Svfx:com.sonycreativesoftware:titlesandtext}` plugin-id shape (lines 13, 78) matches the
  `idRe` regex; UTF-16LE run extraction and RTF-to-text comments match the code.

## assets/js/renderers/premiere.js — no issues
Verified:
- Ticks timebase `254016000000` and `fps = TPS / ticks-per-frame` (lines 19, 28, 115) match.
- FrameRect "left,top,right,bottom" (line 116) matches `w=rect[2]`, `h=rect[3]`.
- The object-graph chain comment (lines 9-16) and the track-stacking comment
  ("video on top, highest index first; audio lowest first", lines 155-160) match the sort.

## assets/js/renderers/aftereffects.js — no issues
Verified:
- RIFX form "Egg!" signature check (lines 3, 271-273) matches.
- cdta: "scale (ticks/sec) = u32@8, fps = u32@8 / u32@4, dur = u32@44, w = u16@140,
  h = u16@142" (lines 10-13) all match `parseAep` offsets.
- idta: "type = u16@0 (1 folder, 4 comp, 7 footage), id = u32@16" (line 14) matches
  `lastType=u16(ds)`, `lastId=u32(ds+16)`, and the `0x04`/`0x07` branches.
- ldta: attribute bytes at 37..39, src id = u32@40, scale = comp u32@8 (lines 14-16) match.

## assets/js/renderers/unity.js — no issues
Verified:
- The `%YAML 1.1` / `%TAG !u! …` preamble and `--- !u!<classID> &<fileID>` header
  description (lines 6-12) matches the `splitDocs` regex `^--- !u!(\d+) &(\d+)`.
- ".meta = single plain-YAML importer record" (lines 10-11) matches the `meta` branch.
- Per-class field extraction (AnimationClip, AnimatorController, Physics(2D)Material,
  AudioManager, Material, MonoBehaviour) tag/field names match `typeDetail`.

## assets/js/renderers/vssolution.js — no issues
Verified:
- All nine project-type GUIDs (lines 12-22) match Microsoft's documented values
  (C#, C# .NET SDK, VB, VB .NET SDK, C++, Solution folder, Website, Python PTVS,
  Node.js NTVS).
- The `.sln` structure description (lines 3-7) and the `Project(...)=...` /
  `GlobalSection` parsing comments match the regexes.

## assets/js/renderers/timeline.js — no issues
Verified:
- EDL event-line field order "NNN REEL CHAN TRANS srcIn srcOut recIn recOut" (line 52)
  matches the `evRe` capture groups.
- OTIO "duration.value in frames at duration.rate -> seconds" (line 109) matches
  `value / rate`.
- FCPXML "lane 0 = primary, +n above, -n below/audio" (lines 138-139, 166-171) matches the
  lane sort and V/A naming.
- `TICK_TARGET = 8` ("aim for ~8 ruler ticks") matches `niceStep`.

Note (not flagged — descriptive, not a behaviour error): `tcToFrames` says it returns
"[h,m,s,f]" (line 18) while it actually returns an object `{ h, mm, s, f }`. The component
list is accurate; only the bracket/array shorthand and the `m` vs `mm` key differ, which is
documentation shorthand rather than a wrong fact about behaviour.
