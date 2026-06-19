# renderers (video group) comment audit

Audited five files in full against the code, focusing on MP4/box parsing facts,
codec fourCCs, byte offsets and numeric constants. Almost everything checks out;
the box-offset comments (tkhd matrix, avcC/hvcC profile/level, mvhd/mdhd version
branches, stsd sample-entry layout), the NAL-type/IDR/param-set constants
(H.264 5/7/8, HEVC 19/20/21 and 32/33/34), the rtmd TLV walk (header length at
0x1c, tags 0x8300/0x060e/0xe43b/0xe44b, 8-byte [count][stride] header, 8192
LSB/g), the AVI RIFF chunk offsets, and the Gyroflow scale-factor maths all match
the code. Only one genuine correctness problem found.

## assets/js/renderers/video.js

- **Line 1294** — `// Audio sample-entry fourCCs that are uncompressed PCM` → The set on line 1296 (`BROWSER_UNPLAYABLE_AUDIO`) includes `'ulaw'` and `'alaw'`, which are µ-law / A-law: 8-bit *companded* (logarithmically compressed) audio, not uncompressed PCM. (`fl32`/`fl64` are uncompressed but floating-point, not integer PCM either.) The blanket "uncompressed PCM" description is contradicted by those entries. **Fix:** `// Audio sample-entry fourCCs the browser can't play in <video> - uncompressed PCM (twos/sowt/lpcm/in16/in24/in32/raw /NONE/fl32/fl64) plus companded µ-law / A-law.`

## assets/js/renderers/video-avi.js — no issues

## assets/js/renderers/sony-rtmd.js — no issues

## assets/js/renderers/gcsv.js — no issues

## assets/js/renderers/media-reverse.js — no issues
