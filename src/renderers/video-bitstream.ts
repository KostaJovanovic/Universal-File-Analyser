/* Analyser - video bitstream + Matroska metadata

   DOM-free parsers for the parts of a video file that live below the container:
   the H.264 / H.265 sequence parameter set (SPS), the avcC / hvcC codec-config
   records that MP4 and Matroska both wrap an SPS in, and the Matroska (MKV /
   WebM) EBML track structure.

   video.js owns the presentation; everything here returns plain objects and
   never touches the page, so the same parse serves the raw-elementary-stream
   path, the MP4 moov walk and the Matroska walk without three copies drifting
   apart. */

// ---------- result shapes ----------
// Every parser below builds its answer field by field as the bitstream reveals
// it, so each key is optional: an SPS that stops parsing cleanly half way still
// returns what it managed to read. Values are mostly `any` because they come
// straight off untyped bit reads and codec-config walks - the value of naming
// the keys here is that a typo in one of the ~30 field names is now a build
// error rather than a silently undefined row.

/** A single elementary video/audio stream, as described by an SPS, an avcC /
 *  hvcC config record, or a Matroska track entry. */
export interface StreamInfo {
  codec?: string;
  codecName?: any;
  profileIdc?: number;
  profile?: string;
  tier?: any;
  levelIdc?: number;
  level?: any;
  progressive?: any;
  temporalLayers?: number;
  chromaIdc?: number;
  chroma?: any;
  bitDepth?: any;
  bitDepthLuma?: number;
  bitDepthChroma?: number;
  width?: any;
  height?: any;
  fps?: number;
  fpsSource?: string;
  fullRange?: boolean;
  range?: any;
  primaries?: any;
  transfer?: any;
  matrix?: any;
  matrixName?: any;
  aspectRatioIdc?: number;
  sarWidth?: number;
  sarHeight?: number;
  pixelAspect?: string;
  hdr?: any;
  maxCll?: any;
  maxFall?: any;
  mdcv?: any;
  sps?: any;
  // Filled in by the MP4/MOV moov walk in video.ts, which builds the same shape
  // from sample-entry boxes rather than from a raw SPS.
  avgBitrate?: any;
  maxBitrate?: any;
  clli?: any;
  dvProfile?: any;
  dvLevel?: any;
  dvBlCompatible?: any;
  paramSets?: any;
  partialParse?: any;
  partial?: any;
  rotation?: any;
  // Audio-only members (Matroska A_ tracks share this shape).
  channels?: any;
  sampleRate?: any;
  language?: any;
}

/** The MP4/MOV moov walk's answer: the first video and audio stream plus the
 *  movie-level duration. */
export interface MoovInfo {
  video: StreamInfo | null;
  audio: StreamInfo | null;
  durationSec?: number;
}

/** What the Matroska/WebM walk returns: the promoted first video and audio
 *  streams, every track it saw, and the segment-level metadata. */
export interface MatroskaInfo {
  container: string;
  video: StreamInfo | null;
  audio: StreamInfo | null;
  tracks: any[];
  muxingApp?: string;
  writingApp?: string;
  title?: string;
  dateUtc?: any;
  durationSec?: number;
}

// ---------- shared code-point tables (ISO/IEC 23001-8) ----------

const CHROMA_FORMATS = { 0: 'monochrome', 1: '4:2:0', 2: '4:2:2', 3: '4:4:4' };

export const COLOUR_PRIMARIES = {
  1: 'BT.709', 4: 'BT.470M', 5: 'BT.601 (PAL)', 6: 'BT.601 (NTSC)', 7: 'SMPTE 240M',
  8: 'Film', 9: 'BT.2020', 10: 'SMPTE ST 428', 11: 'DCI-P3', 12: 'Display P3'
};

export const TRANSFER_CHARS = {
  1: 'BT.709', 4: 'Gamma 2.2', 5: 'Gamma 2.8', 6: 'BT.601', 7: 'SMPTE 240M',
  8: 'Linear', 11: 'IEC 61966-2-4', 13: 'sRGB', 14: 'BT.2020 (10-bit)',
  15: 'BT.2020 (12-bit)', 16: 'PQ', 17: 'SMPTE ST 428', 18: 'HLG'
};

export const MATRIX_COEFFS = {
  0: 'Identity (RGB)', 1: 'BT.709', 4: 'FCC', 5: 'BT.601 (PAL)', 6: 'BT.601 (NTSC)',
  7: 'SMPTE 240M', 8: 'YCgCo', 9: 'BT.2020 non-constant', 10: 'BT.2020 constant',
  11: 'SMPTE ST 2085', 14: 'ICtCp'
};

// general_profile_idc -> name (H.265 Annex A).
const HEVC_PROFILES = {
  1: 'Main', 2: 'Main 10', 3: 'Main Still Picture', 4: 'Range Extensions',
  5: 'High Throughput', 6: 'Multiview Main', 7: 'Scalable Main', 8: '3D Main',
  9: 'Screen Content Coding', 10: 'Scalable Range Extensions',
  11: 'High Throughput Screen Content'
};

// profile_idc -> name (H.264 Annex A).
const AVC_PROFILES = {
  66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10',
  122: 'High 4:2:2', 244: 'High 4:4:4 Predictive', 44: 'CAVLC 4:4:4 Intra',
  83: 'Scalable Baseline', 86: 'Scalable High', 118: 'Multiview High',
  128: 'Stereo High', 138: 'Multiview Depth High'
};

// A colour description is only worth showing when it says something. Files that
// leave the fields at "unspecified" (2) carry no information at all.
export const isSpecifiedColourCode = (n) => n != null && n !== 2 && n !== 0;

// ---------- bit reader (exp-Golomb, for SPS parsing) ----------

// Reads past the end return 0 and latch `overrun`, so a truncated or misparsed
// NAL yields a flagged-incomplete result instead of nonsense that looks real.
class BitReader {
  b: Uint8Array;
  pos: number;
  end: number;
  /** Latched when a read runs past the end - see the note above. */
  overrun: boolean;
  constructor(bytes) { this.b = bytes; this.pos = 0; this.end = bytes.length * 8; this.overrun = false; }
  bit() {
    if (this.pos >= this.end) { this.overrun = true; return 0; }
    const v = (this.b[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return v;
  }
  // Multiplies rather than shifts so 32-bit reads don't wrap into negatives.
  bits(n) { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + this.bit(); return v; }
  skip(n) { this.pos += n; if (this.pos > this.end) { this.pos = this.end; this.overrun = true; } }
  ue() {
    let zeros = 0;
    while (zeros < 32 && !this.overrun && this.bit() === 0) zeros++;
    if (this.overrun || zeros >= 32) { this.overrun = true; return 0; }
    return this.bits(zeros) + Math.pow(2, zeros) - 1;
  }
  se() { const k = this.ue(); return (k & 1) ? (k + 1) >> 1 : -(k >> 1); }
}

// Remove emulation-prevention bytes (00 00 03 -> 00 00) to recover the RBSP.
export function stripEpb(bytes) {
  const out = new Uint8Array(bytes.length);
  let n = 0, zeros = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (zeros >= 2 && bytes[i] === 0x03) { zeros = 0; continue; }
    out[n++] = bytes[i];
    if (bytes[i] === 0) zeros++; else zeros = 0;
  }
  return out.subarray(0, n);
}

// Locate Annex B NAL units in `buf`. Returns [{ type, start, end }] where `start`
// is the first byte of the NAL header. Handles both 3- and 4-byte start codes.
function findAnnexBNals(buf, hevc, max = 256) {
  const nals = [];
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] !== 0 || buf[i + 1] !== 0) continue;
    const sc3 = buf[i + 2] === 1;
    const sc4 = buf[i + 2] === 0 && buf[i + 3] === 1;
    if (!sc3 && !sc4) continue;
    const start = i + (sc4 ? 4 : 3);
    if (start >= buf.length) break;
    nals.push({ type: hevc ? (buf[start] >> 1) & 0x3f : buf[start] & 0x1f, start, end: buf.length });
    i = start;
    if (nals.length >= max) break;
  }
  // Each NAL runs to the next start code; trim the trailing zeros that belong to it.
  for (let k = 0; k + 1 < nals.length; k++) {
    let e = nals[k + 1].start - 3;
    while (e > nals[k].start && buf[e - 1] === 0) e--;
    nals[k].end = e;
  }
  return nals;
}

// ---------- H.265 / HEVC sequence parameter set ----------

// profile_tier_level(): 2+1+5 profile bits, 32 compatibility flags, 44 bits of
// source/constraint flags, then general_level_idc, then the optional per-sub-layer
// records. Consumes exactly what the syntax defines so the reader stays aligned
// for everything that follows.
function profileTierLevel(br, maxSubLayersMinus1) {
  br.skip(2);                            // general_profile_space
  const tier = br.bit();                 // general_tier_flag
  const profileIdc = br.bits(5);
  br.skip(32);                           // general_profile_compatibility_flag[32]
  const progressive = br.bit();          // general_progressive_source_flag
  const interlaced = br.bit();           // general_interlaced_source_flag
  br.skip(42);                           // non-packed / frame-only + reserved constraint flags
  const levelIdc = br.bits(8);
  const subProfile = [], subLevel = [];
  for (let i = 0; i < maxSubLayersMinus1; i++) { subProfile.push(br.bit()); subLevel.push(br.bit()); }
  if (maxSubLayersMinus1 > 0) for (let i = maxSubLayersMinus1; i < 8; i++) br.skip(2);
  for (let i = 0; i < maxSubLayersMinus1; i++) {
    if (subProfile[i]) br.skip(88);
    if (subLevel[i]) br.skip(8);
  }
  // A stream that flags neither (or both) leaves the scan type unstated rather
  // than claiming progressive, which is what the flags actually mean.
  const scan = (progressive && !interlaced) ? true : (interlaced && !progressive) ? false : undefined;
  return { profileIdc, tier: tier ? 'High' : 'Main', levelIdc, progressive: scan };
}

// scaling_list_data(): four size ids, six matrices each (three at size id 3).
function skipScalingListData(br) {
  for (let sizeId = 0; sizeId < 4; sizeId++) {
    for (let matrixId = 0; matrixId < 6; matrixId += (sizeId === 3 ? 3 : 1)) {
      if (!br.bit()) br.ue();            // scaling_list_pred_matrix_id_delta
      else {
        const coefNum = Math.min(64, 1 << (4 + (sizeId << 1)));
        if (sizeId > 1) br.se();         // scaling_list_dc_coef_minus8
        for (let i = 0; i < coefNum; i++) br.se();
      }
      if (br.overrun) return;
    }
  }
}

// st_ref_pic_set(): the reason a naive SPS parser desynchronises before the VUI.
// Returns NumDeltaPocs for this set, which the next inter-predicted set needs.
function stRefPicSet(br, idx, numSets, numDeltaPocs) {
  let interPred = 0;
  if (idx !== 0) interPred = br.bit();
  if (interPred) {
    if (idx === numSets) br.ue();        // delta_idx_minus1
    br.bit();                            // delta_rps_sign
    br.ue();                             // abs_delta_rps_minus1
    const refIdx = idx - 1;              // delta_idx_minus1 is 0 inside an SPS
    const refCount = numDeltaPocs[refIdx] || 0;
    let count = 0;
    for (let j = 0; j <= refCount; j++) {
      const used = br.bit();
      let useDelta = 1;
      if (!used) useDelta = br.bit();
      if (used || useDelta) count++;
    }
    return count;
  }
  const neg = br.ue(), pos = br.ue();
  // A corrupt set can claim thousands of pictures; the spec ceiling is 16 each.
  if (neg > 64 || pos > 64) { br.overrun = true; return 0; }
  for (let i = 0; i < neg; i++) { br.ue(); br.bit(); }
  for (let i = 0; i < pos; i++) { br.ue(); br.bit(); }
  return neg + pos;
}

// vui_parameters(): read only as far as the timing info, which is what carries
// the real frame rate. Everything past it (HRD, bitstream restriction) is noise
// for our purposes.
function hevcVui(br, out) {
  if (br.bit()) {                                   // aspect_ratio_info_present_flag
    const idc = br.bits(8);
    if (idc === 255) { out.sarWidth = br.bits(16); out.sarHeight = br.bits(16); }
    else out.aspectRatioIdc = idc;
  }
  if (br.bit()) br.bit();                           // overscan_info / overscan_appropriate
  if (br.bit()) {                                   // video_signal_type_present_flag
    br.skip(3);                                     // video_format
    out.fullRange = !!br.bit();
    if (br.bit()) {                                 // colour_description_present_flag
      out.primaries = br.bits(8);
      out.transfer = br.bits(8);
      out.matrix = br.bits(8);
    }
  }
  if (br.bit()) { br.ue(); br.ue(); }               // chroma_loc_info
  br.skip(3);                                       // neutral_chroma / field_seq / frame_field_info
  if (br.bit()) { br.ue(); br.ue(); br.ue(); br.ue(); }   // default_display_window
  if (br.bit()) {                                   // vui_timing_info_present_flag
    const numUnitsInTick = br.bits(32);
    const timeScale = br.bits(32);
    if (!br.overrun && numUnitsInTick > 0 && timeScale > 0) {
      const fps = timeScale / numUnitsInTick;
      if (fps > 0 && fps < 1000) { out.fps = fps; out.fpsSource = 'SPS VUI timing'; }
    }
  }
}

// Parse an HEVC SPS. `rbsp` is the NAL payload with the 2-byte NAL header already
// removed and emulation-prevention bytes stripped. Returns null if it doesn't
// parse cleanly enough to trust the essentials.
export function parseHevcSps(rbsp) {
  const br = new BitReader(rbsp);
  const out: StreamInfo = { codec: 'hevc' };
  br.skip(4);                                       // sps_video_parameter_set_id
  const maxSubLayersMinus1 = br.bits(3);
  br.bit();                                         // sps_temporal_id_nesting_flag
  const ptl = profileTierLevel(br, maxSubLayersMinus1);
  out.profileIdc = ptl.profileIdc;
  out.profile = HEVC_PROFILES[ptl.profileIdc] || ('profile ' + ptl.profileIdc);
  out.tier = ptl.tier;
  out.levelIdc = ptl.levelIdc;
  if (ptl.levelIdc) out.level = (ptl.levelIdc / 30).toFixed(1);
  if (ptl.progressive !== undefined) out.progressive = ptl.progressive;
  out.temporalLayers = maxSubLayersMinus1 + 1;

  br.ue();                                          // sps_seq_parameter_set_id
  const chromaIdc = br.ue();
  if (chromaIdc === 3) br.bit();                    // separate_colour_plane_flag
  out.chromaIdc = chromaIdc;
  out.chroma = CHROMA_FORMATS[chromaIdc] || ('idc ' + chromaIdc);
  const picW = br.ue(), picH = br.ue();
  let cropL = 0, cropR = 0, cropT = 0, cropB = 0;
  if (br.bit()) { cropL = br.ue(); cropR = br.ue(); cropT = br.ue(); cropB = br.ue(); }
  // Conformance-window offsets are in chroma units, so they scale with subsampling.
  const subW = (chromaIdc === 1 || chromaIdc === 2) ? 2 : 1;
  const subH = (chromaIdc === 1) ? 2 : 1;
  out.width = picW - (cropL + cropR) * subW;
  out.height = picH - (cropT + cropB) * subH;
  out.bitDepthLuma = br.ue() + 8;
  out.bitDepthChroma = br.ue() + 8;
  if (br.overrun || !(out.width > 0) || !(out.height > 0) ||
      out.bitDepthLuma < 8 || out.bitDepthLuma > 16) return null;
  // Everything above is what we most need; a desync later must not discard it.
  const essentials = { ...out, partial: true };

  const log2MaxPocLsb = br.ue() + 4;
  const subLayerOrdering = br.bit();
  for (let i = subLayerOrdering ? 0 : maxSubLayersMinus1; i <= maxSubLayersMinus1; i++) {
    br.ue(); br.ue(); br.ue();
  }
  br.ue(); br.ue(); br.ue(); br.ue(); br.ue(); br.ue();   // CTB / transform sizes + hierarchy depths
  if (br.bit() && br.bit()) skipScalingListData(br);      // scaling_list_enabled + data present
  br.bit();                                               // amp_enabled_flag
  br.bit();                                               // sample_adaptive_offset_enabled_flag
  if (br.bit()) {                                         // pcm_enabled_flag
    br.skip(8);                                           // pcm bit depths
    br.ue(); br.ue();
    br.bit();                                             // pcm_loop_filter_disabled_flag
  }
  const numSets = br.ue();
  if (numSets > 64) return essentials;
  const numDeltaPocs = [];
  for (let i = 0; i < numSets; i++) {
    numDeltaPocs[i] = stRefPicSet(br, i, numSets, numDeltaPocs);
    if (br.overrun) return essentials;
  }
  if (br.bit()) {                                         // long_term_ref_pics_present_flag
    const numLt = br.ue();
    if (numLt > 64) return essentials;
    for (let i = 0; i < numLt; i++) { br.skip(log2MaxPocLsb); br.bit(); }
  }
  br.bit();                                               // sps_temporal_mvp_enabled_flag
  br.bit();                                               // strong_intra_smoothing_enabled_flag
  if (br.overrun) return essentials;
  if (br.bit()) hevcVui(br, out);                         // vui_parameters_present_flag
  // A VUI that ran the reader off the end was being read at the wrong offset, so
  // anything it produced is untrustworthy - fall back to the pre-VUI snapshot.
  return br.overrun ? essentials : out;
}

// ---------- H.264 / AVC sequence parameter set ----------

function skipAvcScalingList(br, size) {
  let lastScale = 8, nextScale = 8;
  for (let i = 0; i < size; i++) {
    if (nextScale !== 0) {
      const delta = br.se();
      nextScale = (lastScale + delta + 256) % 256;
    }
    lastScale = nextScale === 0 ? lastScale : nextScale;
    if (br.overrun) return;
  }
}

function avcVui(br, out) {
  if (br.bit()) {                                   // aspect_ratio_info_present_flag
    const idc = br.bits(8);
    if (idc === 255) { out.sarWidth = br.bits(16); out.sarHeight = br.bits(16); }
    else out.aspectRatioIdc = idc;
  }
  if (br.bit()) br.bit();                           // overscan
  if (br.bit()) {                                   // video_signal_type_present_flag
    br.skip(3);
    out.fullRange = !!br.bit();
    if (br.bit()) { out.primaries = br.bits(8); out.transfer = br.bits(8); out.matrix = br.bits(8); }
  }
  if (br.bit()) { br.ue(); br.ue(); }               // chroma_loc_info
  if (br.bit()) {                                   // timing_info_present_flag
    const numUnitsInTick = br.bits(32);
    const timeScale = br.bits(32);
    br.bit();                                       // fixed_frame_rate_flag
    // H.264 counts two field ticks per frame, so the frame rate is halved.
    if (!br.overrun && numUnitsInTick > 0 && timeScale > 0) {
      const fps = timeScale / (2 * numUnitsInTick);
      if (fps > 0 && fps < 1000) { out.fps = fps; out.fpsSource = 'SPS VUI timing'; }
    }
  }
}

// Parse an H.264 SPS. `rbsp` is the payload after the 1-byte NAL header, with
// emulation-prevention bytes stripped.
export function parseAvcSps(rbsp) {
  const br = new BitReader(rbsp);
  const out: StreamInfo = { codec: 'avc' };
  const profileIdc = br.bits(8);
  br.skip(8);                                       // constraint flags + reserved
  const levelIdc = br.bits(8);
  out.profileIdc = profileIdc;
  out.profile = AVC_PROFILES[profileIdc] || ('profile ' + profileIdc);
  out.levelIdc = levelIdc;
  if (levelIdc) out.level = (levelIdc / 10).toFixed(1);
  br.ue();                                          // seq_parameter_set_id
  let chromaIdc = 1;
  out.bitDepthLuma = 8; out.bitDepthChroma = 8;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profileIdc)) {
    chromaIdc = br.ue();
    if (chromaIdc === 3) br.bit();                  // separate_colour_plane_flag
    out.bitDepthLuma = br.ue() + 8;
    out.bitDepthChroma = br.ue() + 8;
    br.bit();                                       // qpprime_y_zero_transform_bypass_flag
    if (br.bit()) {                                 // seq_scaling_matrix_present_flag
      const n = chromaIdc !== 3 ? 8 : 12;
      for (let i = 0; i < n; i++) if (br.bit()) skipAvcScalingList(br, i < 6 ? 16 : 64);
    }
  }
  out.chromaIdc = chromaIdc;
  out.chroma = CHROMA_FORMATS[chromaIdc] || ('idc ' + chromaIdc);
  br.ue();                                          // log2_max_frame_num_minus4
  const pocType = br.ue();
  if (pocType === 0) br.ue();
  else if (pocType === 1) {
    br.bit(); br.se(); br.se();
    const n = br.ue();
    if (n > 256) return null;
    for (let i = 0; i < n; i++) br.se();
  }
  br.ue();                                          // max_num_ref_frames
  br.bit();                                         // gaps_in_frame_num_value_allowed_flag
  const wMbs = br.ue() + 1;
  const hMapUnits = br.ue() + 1;
  const frameMbsOnly = br.bit();
  out.progressive = !!frameMbsOnly;
  if (!frameMbsOnly) br.bit();                      // mb_adaptive_frame_field_flag
  br.bit();                                         // direct_8x8_inference_flag
  let cropL = 0, cropR = 0, cropT = 0, cropB = 0;
  if (br.bit()) { cropL = br.ue(); cropR = br.ue(); cropT = br.ue(); cropB = br.ue(); }
  const subW = (chromaIdc === 1 || chromaIdc === 2) ? 2 : 1;
  const subH = (chromaIdc === 1) ? 2 : 1;
  out.width = wMbs * 16 - (cropL + cropR) * subW;
  out.height = (2 - frameMbsOnly) * hMapUnits * 16 - (cropT + cropB) * subH * (frameMbsOnly ? 1 : 2);
  if (br.overrun || !(out.width > 0) || !(out.height > 0)) return null;
  const essentials = { ...out, partial: true };
  if (br.bit()) avcVui(br, out);                    // vui_parameters_present_flag
  return br.overrun && !out.fps ? essentials : out;
}

// ---------- codec configuration records (avcC / hvcC) ----------

// hvcC (ISO/IEC 14496-15 §8.3.3.1). Also carries the SPS in its NAL arrays, so
// the VUI - colour, and the only frame rate HEVC ever states - is reachable from
// an MP4 or a Matroska CodecPrivate without touching the media data.
export function parseHvcC(u8) {
  if (!u8 || u8.length < 23) return null;
  const out: StreamInfo = { codec: 'hevc' };
  const b1 = u8[1];
  out.tier = (b1 & 0x20) ? 'High' : 'Main';
  out.profileIdc = b1 & 0x1f;
  out.profile = HEVC_PROFILES[out.profileIdc] || ('profile ' + out.profileIdc);
  out.levelIdc = u8[12];
  if (out.levelIdc) out.level = (out.levelIdc / 30).toFixed(1);
  // Reserved bits read as 1s in a real record; validating them stops a truncated
  // or padded box being misread as exotic chroma / high bit depth.
  if ((u8[16] & 0xFC) === 0xFC && (u8[17] & 0xF8) === 0xF8 && (u8[18] & 0xF8) === 0xF8) {
    out.chromaIdc = u8[16] & 0x03;
    out.chroma = CHROMA_FORMATS[out.chromaIdc];
    out.bitDepthLuma = (u8[17] & 0x07) + 8;
    out.bitDepthChroma = (u8[18] & 0x07) + 8;
  }
  const avgFrameRate = (u8[19] << 8) | u8[20];      // frames per 256 seconds; 0 = unstated
  if (avgFrameRate > 0) { out.fps = avgFrameRate / 256; out.fpsSource = 'hvcC average frame rate'; }
  out.temporalLayers = (u8[21] >> 3) & 0x07;
  // NAL arrays: [completeness/type byte][numNalus u16][len u16 + payload]...
  let p = 22;
  const numArrays = u8[p++];
  for (let a = 0; a < numArrays && p + 3 <= u8.length; a++) {
    const nalType = u8[p] & 0x3f; p += 1;
    const numNalus = (u8[p] << 8) | u8[p + 1]; p += 2;
    for (let n = 0; n < numNalus && p + 2 <= u8.length; n++) {
      const len = (u8[p] << 8) | u8[p + 1]; p += 2;
      if (p + len > u8.length) return mergeSps(out);
      if (nalType === 33 && len > 2 && !out.sps) {
        try { out.sps = parseHevcSps(stripEpb(u8.subarray(p + 2, p + len))); } catch (_) { /* keep the record */ }
      }
      p += len;
    }
  }
  return mergeSps(out);
}

// avcC (ISO/IEC 14496-15 §5.3.3.1), same idea: config bytes plus the SPS itself.
export function parseAvcC(u8) {
  if (!u8 || u8.length < 7) return null;
  const out: StreamInfo = { codec: 'avc' };
  out.profileIdc = u8[1];
  out.profile = AVC_PROFILES[out.profileIdc] || ('profile ' + out.profileIdc);
  out.levelIdc = u8[3];
  if (out.levelIdc) out.level = (out.levelIdc / 10).toFixed(1);
  // profile_idc alone fixes chroma for the 4:2:2 / 4:4:4 High profiles, and no
  // browser ships a decoder for either - so set it before the optional extension.
  if (out.profileIdc === 122) out.chroma = '4:2:2';
  else if (out.profileIdc === 244) out.chroma = '4:4:4';
  let p = 5;
  const numSps = u8[p++] & 0x1f;
  for (let i = 0; i < numSps && p + 2 <= u8.length; i++) {
    const len = (u8[p] << 8) | u8[p + 1]; p += 2;
    if (p + len > u8.length) return mergeSps(out);
    if (len > 1 && !out.sps) {
      try { out.sps = parseAvcSps(stripEpb(u8.subarray(p + 1, p + len))); } catch (_) { /* keep the record */ }
    }
    p += len;
  }
  if (p < u8.length) {
    const numPps = u8[p++];
    for (let i = 0; i < numPps && p + 2 <= u8.length; i++) { p += 2 + ((u8[p] << 8) | u8[p + 1]); }
  }
  // Optional chroma / bit-depth extension, present only on the High profiles and
  // optional even there. Reserved bits are 1s, so validate before trusting it.
  if ([100, 110, 122, 144, 244].includes(out.profileIdc) && p + 3 <= u8.length) {
    const b0 = u8[p], b1 = u8[p + 1], b2 = u8[p + 2];
    if ((b0 & 0xFC) === 0xFC && (b1 & 0xF8) === 0xF8 && (b2 & 0xF8) === 0xF8) {
      if (out.chroma === undefined) {
        out.chromaIdc = b0 & 0x03;
        out.chroma = CHROMA_FORMATS[out.chromaIdc];
      }
      const luma = (b1 & 0x07) + 8, chromaDepth = (b2 & 0x07) + 8;
      if (luma >= 8 && luma <= 16) { out.bitDepthLuma = luma; out.bitDepthChroma = chromaDepth; }
    }
  }
  return mergeSps(out);
}

// Fold an embedded SPS parse into the config record. The record wins on profile
// and level (it is what the container advertises); the SPS supplies everything
// the record has no field for - frame rate, colour description, exact geometry.
function mergeSps(rec) {
  const sps = rec.sps;
  if (!sps) return rec;
  for (const k of ['width', 'height', 'fps', 'fpsSource', 'fullRange', 'primaries',
                   'transfer', 'matrix', 'sarWidth', 'sarHeight']) {
    if (rec[k] === undefined && sps[k] !== undefined) rec[k] = sps[k];
  }
  if (rec.bitDepthLuma === undefined && sps.bitDepthLuma) {
    rec.bitDepthLuma = sps.bitDepthLuma; rec.bitDepthChroma = sps.bitDepthChroma;
  }
  if (rec.chroma === undefined && sps.chroma) { rec.chroma = sps.chroma; rec.chromaIdc = sps.chromaIdc; }
  return rec;
}

// ---------- raw Annex B elementary stream ----------

// Read the stream-level facts out of a blob of Annex B parameter sets (the shape
// extractRawParamSets() in video.js produces): profile/tier/level, geometry,
// bit depth, chroma, colour description and - crucially - the frame rate, which
// is the one thing the raw-stream path has always had to assume.
export function parseAnnexBStreamInfo(bytes, hevc) {
  const nals = findAnnexBNals(bytes, hevc);
  const spsType = hevc ? 33 : 7;
  const sps = nals.find((n) => n.type === spsType);
  if (!sps) return null;
  const headerLen = hevc ? 2 : 1;
  const rbsp = stripEpb(bytes.subarray(sps.start + headerLen, sps.end));
  let info = null;
  try { info = hevc ? parseHevcSps(rbsp) : parseAvcSps(rbsp); } catch (_) { return null; }
  if (!info) return null;
  info.hasVps = nals.some((n) => n.type === 32) && hevc;
  info.hasPps = nals.some((n) => n.type === (hevc ? 34 : 8));
  return info;
}

// ---------- Matroska / WebM (EBML) ----------

const MKV_VIDEO_CODECS = {
  'V_MPEGH/ISO/HEVC': 'H.265 / HEVC', 'V_MPEG4/ISO/AVC': 'H.264 / AVC',
  'V_AV1': 'AV1', 'V_VP9': 'VP9', 'V_VP8': 'VP8',
  'V_MPEG4/ISO/ASP': 'MPEG-4 Visual (ASP)', 'V_MPEG4/ISO/SP': 'MPEG-4 Visual (SP)',
  'V_MPEG4/ISO/AP': 'MPEG-4 Visual (AP)', 'V_MPEG4/MS/V3': 'MS MPEG-4 v3 (DivX 3)',
  'V_MPEG2': 'MPEG-2 Video', 'V_MPEG1': 'MPEG-1 Video',
  'V_MS/VFW/FOURCC': 'VfW-wrapped', 'V_QUICKTIME': 'QuickTime-wrapped',
  'V_PRORES': 'Apple ProRes', 'V_THEORA': 'Theora', 'V_FFV1': 'FFV1',
  'V_UNCOMPRESSED': 'Uncompressed', 'V_DIRAC': 'Dirac', 'V_REAL/RV40': 'RealVideo 9/10'
};

const MKV_AUDIO_CODECS = {
  'A_AAC': 'AAC', 'A_AC3': 'Dolby Digital (AC-3)', 'A_EAC3': 'Dolby Digital Plus (E-AC-3)',
  'A_TRUEHD': 'Dolby TrueHD', 'A_MLP': 'MLP', 'A_DTS': 'DTS', 'A_DTS/EXPRESS': 'DTS Express',
  'A_DTS/LOSSLESS': 'DTS-HD Master Audio', 'A_MPEG/L3': 'MP3', 'A_MPEG/L2': 'MP2',
  'A_MPEG/L1': 'MP1', 'A_FLAC': 'FLAC', 'A_OPUS': 'Opus', 'A_VORBIS': 'Vorbis',
  'A_ALAC': 'Apple Lossless (ALAC)', 'A_WAVPACK4': 'WavPack', 'A_TTA1': 'TTA',
  'A_PCM/INT/LIT': 'PCM (little-endian)', 'A_PCM/INT/BIG': 'PCM (big-endian)',
  'A_PCM/FLOAT/IEEE': 'PCM (float)', 'A_MS/ACM': 'ACM-wrapped', 'A_REAL/COOK': 'RealAudio Cook'
};

const MKV_SUBTITLE_CODECS = {
  'S_TEXT/UTF8': 'SubRip (SRT)', 'S_TEXT/ASS': 'ASS', 'S_TEXT/SSA': 'SSA',
  'S_TEXT/WEBVTT': 'WebVTT', 'S_TEXT/USF': 'USF', 'S_HDMV/PGS': 'PGS (Blu-ray)',
  'S_HDMV/TEXTST': 'TextST (Blu-ray)', 'S_VOBSUB': 'VobSub (DVD)', 'S_DVBSUB': 'DVB subtitles',
  'S_KATE': 'Kate', 'S_IMAGE/BMP': 'BMP subtitles'
};

const EBML = {
  SEGMENT: 0x18538067, SEEKHEAD: 0x114D9B74, INFO: 0x1549A966, TRACKS: 0x1654AE6B,
  TIMECODE_SCALE: 0x2AD7B1, DURATION: 0x4489, MUXING_APP: 0x4D80, WRITING_APP: 0x5741,
  DATE_UTC: 0x4461, TITLE: 0x7BA9,
  TRACK_ENTRY: 0xAE, TRACK_NUMBER: 0xD7, TRACK_TYPE: 0x83, FLAG_DEFAULT: 0x88,
  FLAG_FORCED: 0x55AA, DEFAULT_DURATION: 0x23E383, NAME: 0x536E, LANGUAGE: 0x22B59C,
  LANGUAGE_BCP47: 0x22B59D, CODEC_ID: 0x86, CODEC_PRIVATE: 0x63A2, CODEC_NAME: 0x258688,
  VIDEO: 0xE0, PIXEL_WIDTH: 0xB0, PIXEL_HEIGHT: 0xBA, DISPLAY_WIDTH: 0x54B0,
  DISPLAY_HEIGHT: 0x54BA, COLOUR: 0x55B0, MATRIX_COEFFS: 0x55B1, BITS_PER_CHANNEL: 0x55B2,
  RANGE: 0x55B9, TRANSFER: 0x55BA, PRIMARIES: 0x55BB, MAX_CLL: 0x55BC, MAX_FALL: 0x55BD,
  MASTERING: 0x55D0,
  AUDIO: 0xE1, SAMPLING_FREQ: 0xB5, OUT_SAMPLING_FREQ: 0x78B5, CHANNELS: 0x9F, BIT_DEPTH: 0x6264
};

// EBML numbers are variable-length with a leading marker bit. `id` keeps the
// marker (element ids are conventionally written that way); `size` strips it.
function readVint(b, p, keepMarker) {
  if (p >= b.length) return null;
  const first = b[p];
  if (first === 0) return null;
  let len = 1, mask = 0x80;
  while (!(first & mask)) { mask >>= 1; len++; }
  if (len > 8 || p + len > b.length) return null;
  let val = keepMarker ? first : (first & (mask - 1));
  let allOnes = (first & (mask - 1)) === (mask - 1);
  for (let i = 1; i < len; i++) {
    val = val * 256 + b[p + i];
    if (b[p + i] !== 0xff) allOnes = false;
  }
  return { len, val, unknown: !keepMarker && allOnes };
}

const uintOf = (b, s, e) => { let v = 0; for (let i = s; i < e; i++) v = v * 256 + b[i]; return v; };
const floatOf = (b, s, e) => {
  const dv = new DataView(b.buffer, b.byteOffset + s, e - s);
  if (e - s === 4) return dv.getFloat32(0);
  if (e - s === 8) return dv.getFloat64(0);
  return null;
};
const strOf = (b, s, e) => new TextDecoder('utf-8').decode(b.subarray(s, e)).replace(/\0+$/, '').trim();

// Walk the children of one EBML master element, calling `fn(id, dataStart, dataEnd)`.
function eachChild(b, start, end, fn) {
  let p = start, guard = 0;
  while (p < end && guard++ < 20000) {
    const id = readVint(b, p, true);
    if (!id) return;
    const size = readVint(b, p + id.len, false);
    if (!size) return;
    const dataStart = p + id.len + size.len;
    const dataEnd = size.unknown ? end : Math.min(end, dataStart + size.val);
    if (dataEnd < dataStart) return;
    fn(id.val, dataStart, dataEnd);
    if (size.unknown) return;
    p = dataEnd;
  }
}

function parseMkvTrackEntry(b, start, end) {
  const t: any = {};
  eachChild(b, start, end, (id, s, e) => {
    switch (id) {
      case EBML.TRACK_NUMBER: t.number = uintOf(b, s, e); break;
      case EBML.TRACK_TYPE: t.type = uintOf(b, s, e); break;
      case EBML.CODEC_ID: t.codecId = strOf(b, s, e); break;
      case EBML.CODEC_NAME: t.codecName = strOf(b, s, e); break;
      case EBML.NAME: t.name = strOf(b, s, e); break;
      case EBML.LANGUAGE: case EBML.LANGUAGE_BCP47: t.language = t.language || strOf(b, s, e); break;
      case EBML.FLAG_DEFAULT: t.isDefault = uintOf(b, s, e) === 1; break;
      case EBML.FLAG_FORCED: t.forced = uintOf(b, s, e) === 1; break;
      case EBML.DEFAULT_DURATION: t.defaultDurationNs = uintOf(b, s, e); break;
      case EBML.CODEC_PRIVATE: t.codecPrivate = b.subarray(s, e); break;
      case EBML.VIDEO:
        eachChild(b, s, e, (vid, vs, ve) => {
          switch (vid) {
            case EBML.PIXEL_WIDTH: t.width = uintOf(b, vs, ve); break;
            case EBML.PIXEL_HEIGHT: t.height = uintOf(b, vs, ve); break;
            case EBML.DISPLAY_WIDTH: t.displayWidth = uintOf(b, vs, ve); break;
            case EBML.DISPLAY_HEIGHT: t.displayHeight = uintOf(b, vs, ve); break;
            case EBML.COLOUR:
              eachChild(b, vs, ve, (cid, cs, ce) => {
                switch (cid) {
                  case EBML.MATRIX_COEFFS: t.matrix = uintOf(b, cs, ce); break;
                  case EBML.BITS_PER_CHANNEL: t.bitDepthLuma = uintOf(b, cs, ce); break;
                  case EBML.RANGE: t.colourRange = uintOf(b, cs, ce); break;
                  case EBML.TRANSFER: t.transfer = uintOf(b, cs, ce); break;
                  case EBML.PRIMARIES: t.primaries = uintOf(b, cs, ce); break;
                  case EBML.MAX_CLL: t.maxCll = uintOf(b, cs, ce); break;
                  case EBML.MAX_FALL: t.maxFall = uintOf(b, cs, ce); break;
                  case EBML.MASTERING: t.mdcv = true; break;
                  default: break;
                }
              });
              break;
            default: break;
          }
        });
        break;
      case EBML.AUDIO:
        eachChild(b, s, e, (aid, as, ae) => {
          switch (aid) {
            case EBML.SAMPLING_FREQ: t.sampleRate = floatOf(b, as, ae) || uintOf(b, as, ae); break;
            case EBML.CHANNELS: t.channels = uintOf(b, as, ae); break;
            case EBML.BIT_DEPTH: t.audioBitDepth = uintOf(b, as, ae); break;
            default: break;
          }
        });
        break;
      default: break;
    }
  });
  return t;
}

// Read the header/track metadata out of a Matroska or WebM file.
//
// Info and Tracks normally sit at the head, but a muxer is free to put them after
// the clusters, so this walks the Segment's children by size (seeking, never
// reading the media data) rather than scanning bytes. Returns the same shape as
// the ISOBMFF moov walk in video.js - { video, audio, durationSec, ... } - plus a
// full `tracks` list, which Matroska files routinely have several of.
export async function parseMatroskaTracks(file) {
  if (!file || file.size < 64) return null;
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer());
  if (!(head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3)) return null;

  // Top-level: EBML header, then Segment. Find the Segment's data range.
  let p = 0, segStart = -1, segEnd = file.size;
  for (let i = 0; i < 8 && p < head.length; i++) {
    const id = readVint(head, p, true);
    if (!id) break;
    const size = readVint(head, p + id.len, false);
    if (!size) break;
    const dataStart = p + id.len + size.len;
    if (id.val === EBML.SEGMENT) {
      segStart = dataStart;
      segEnd = size.unknown ? file.size : Math.min(file.size, dataStart + size.val);
      break;
    }
    p = dataStart + size.val;
    if (p > file.size) break;
  }
  if (segStart < 0) return null;

  // Walk the Segment's children, reading only the headers, and pull just the
  // Info and Tracks elements into memory.
  const out: MatroskaInfo = { video: null, audio: null, tracks: [], container: 'Matroska' };
  let timecodeScale = 1000000, rawDuration = 0;
  let pos = segStart, guard = 0, infoDone = false, tracksDone = false;
  while (pos < segEnd && guard++ < 4096 && !(infoDone && tracksDone)) {
    const hdr = new Uint8Array(await file.slice(pos, Math.min(segEnd, pos + 16)).arrayBuffer());
    const id = readVint(hdr, 0, true);
    if (!id) break;
    const size = readVint(hdr, id.len, false);
    if (!size || size.unknown) break;
    const dataStart = pos + id.len + size.len;
    const dataEnd = Math.min(segEnd, dataStart + size.val);
    if (dataEnd <= dataStart) break;

    if (id.val === EBML.INFO && size.val < 8 * 1024 * 1024) {
      const b = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer());
      eachChild(b, 0, b.length, (cid, s, e) => {
        switch (cid) {
          case EBML.TIMECODE_SCALE: timecodeScale = uintOf(b, s, e) || 1000000; break;
          case EBML.DURATION: rawDuration = floatOf(b, s, e) || 0; break;
          case EBML.MUXING_APP: out.muxingApp = strOf(b, s, e); break;
          case EBML.WRITING_APP: out.writingApp = strOf(b, s, e); break;
          case EBML.TITLE: out.title = strOf(b, s, e); break;
          case EBML.DATE_UTC: {
            // Nanoseconds since 2001-01-01, as a signed 8-byte integer.
            const ns = uintOf(b, s, e);
            if (ns) out.dateUtc = new Date(Date.UTC(2001, 0, 1) + ns / 1e6);
            break;
          }
          default: break;
        }
      });
      infoDone = true;
    } else if (id.val === EBML.TRACKS && size.val < 32 * 1024 * 1024) {
      const b = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer());
      eachChild(b, 0, b.length, (cid, s, e) => {
        if (cid === EBML.TRACK_ENTRY) out.tracks.push(parseMkvTrackEntry(b, s, e));
      });
      tracksDone = true;
    }
    pos = dataEnd;
  }

  if (rawDuration > 0 && timecodeScale > 0) out.durationSec = rawDuration * timecodeScale / 1e9;
  if (!out.tracks.length) return (out.writingApp || out.muxingApp || out.durationSec) ? out : null;

  // Promote the first video and audio track into the shape appendTrackRows()
  // already knows, so a Matroska file reads out exactly like an MP4.
  for (const t of out.tracks) {
    t.kindName = t.type === 1 ? 'Video' : t.type === 2 ? 'Audio' : t.type === 17 ? 'Subtitle'
      : t.type === 16 ? 'Logo' : t.type === 18 ? 'Buttons' : 'Other';
    t.codecLabel = MKV_VIDEO_CODECS[t.codecId] || MKV_AUDIO_CODECS[t.codecId]
      || MKV_SUBTITLE_CODECS[t.codecId] || t.codecName || t.codecId || 'unknown';
    if (t.defaultDurationNs > 0) t.fps = 1e9 / t.defaultDurationNs;

    if (t.type === 1 && !out.video) {
      const v: StreamInfo = { codec: t.codecId, codecName: t.codecLabel, width: t.width, height: t.height };
      if (t.fps) { v.fps = t.fps; v.fpsSource = 'Matroska DefaultDuration'; }
      // DisplayWidth/Height give the shape the picture should be shown at. When
      // that disagrees with the stored pixel size the video is anamorphic, and
      // the ratio between them is the pixel aspect.
      if (t.displayWidth > 0 && t.displayHeight > 0 && t.width > 0 && t.height > 0
          && (t.displayWidth !== t.width || t.displayHeight !== t.height)) {
        const num = t.displayWidth * t.height, den = t.displayHeight * t.width;
        const gcd = (a, b) => (b ? gcd(b, a % b) : a);
        const g = gcd(num, den) || 1;
        if (num !== den) v.pixelAspect = (num / g) + ':' + (den / g);
      }
      // CodecPrivate is a verbatim hvcC / avcC record for HEVC and H.264, which
      // is where profile, level, bit depth, chroma and the SPS colour info live.
      try {
        const cfg = t.codecId === 'V_MPEGH/ISO/HEVC' ? parseHvcC(t.codecPrivate)
          : t.codecId === 'V_MPEG4/ISO/AVC' ? parseAvcC(t.codecPrivate) : null;
        if (cfg) {
          v.profile = cfg.tier ? cfg.profile + ' (' + cfg.tier + ')' : cfg.profile;
          if (cfg.level) v.level = cfg.level.replace(/\.0$/, '');
          if (cfg.chroma) v.chroma = cfg.chroma;
          if (cfg.bitDepthLuma) v.bitDepth = Math.max(cfg.bitDepthLuma, cfg.bitDepthChroma || 0);
          if (cfg.fps && !v.fps) { v.fps = cfg.fps; v.fpsSource = cfg.fpsSource; }
          if (cfg.primaries !== undefined && t.primaries === undefined) t.primaries = cfg.primaries;
          if (cfg.transfer !== undefined && t.transfer === undefined) t.transfer = cfg.transfer;
          if (cfg.matrix !== undefined && t.matrix === undefined) t.matrix = cfg.matrix;
          if (cfg.fullRange !== undefined && t.colourRange === undefined) t.colourRange = cfg.fullRange ? 2 : 1;
        }
      } catch (_) { /* CodecPrivate is optional and format-specific */ }
      // The Colour element (or the SPS VUI it fell back to) gives HDR and range.
      if (t.bitDepthLuma && !v.bitDepth) v.bitDepth = t.bitDepthLuma;
      if (isSpecifiedColourCode(t.primaries)) v.primaries = COLOUR_PRIMARIES[t.primaries] || ('code ' + t.primaries);
      if (isSpecifiedColourCode(t.transfer)) v.transfer = TRANSFER_CHARS[t.transfer] || ('code ' + t.transfer);
      if (isSpecifiedColourCode(t.matrix)) v.matrixName = MATRIX_COEFFS[t.matrix] || ('code ' + t.matrix);
      if (t.colourRange === 1) v.range = 'Limited (TV)';
      else if (t.colourRange === 2) v.range = 'Full (PC)';
      if (t.transfer === 16) v.hdr = 'PQ (' + (v.primaries || 'BT.2020') + ')';
      else if (t.transfer === 18) v.hdr = 'HLG (' + (v.primaries || 'BT.2020') + ')';
      if (t.mdcv) v.mdcv = true;
      if (t.maxCll) v.maxCll = t.maxCll;
      if (t.maxFall) v.maxFall = t.maxFall;
      out.video = v;
    } else if (t.type === 2 && !out.audio) {
      out.audio = {
        codec: t.codecId, codecName: t.codecLabel, channels: t.channels,
        sampleRate: t.sampleRate, bitDepth: t.audioBitDepth, language: t.language
      };
    }
  }
  return out;
}
