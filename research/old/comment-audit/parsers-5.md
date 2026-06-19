# parsers (security/threed/video) comment audit

Audited all three files in full, verifying every comment (`//`, `/* */`, JSDoc)
against the code it describes — magic bytes, offsets, field sizes, endianness,
spec facts and numeric constants. Verification cross-checked against
`core/binutil.js` (`Reader.u64` etc.) and the relevant format specs (PKCS#12,
RFC 4880 OpenPGP, LAS 1.4, ASF, MPEG-2 sequence header, H.264/H.265 SPS,
ISOBMFF, libpcap/pcapng, JKS, MD2/MD3/MDL, DPX, E57). No factually wrong,
stale, or control-flow-contradicting comments were found.

## assets/js/parsers/parsers-security.js — no issues

Spot-verified correct comments include: `0xFEEDFEED`/`0xCECECECE` JKS/JCEKS
magic; `LfLe` at offset 4 / `0x30` header-size for legacy `.evt`; PCAP byte-order
magics (`A1B2C3D4` / `D4C3B2A1` / nano variants) and pcapng SHB
`0x0A0D0D0A` + BOM `0x1A2B3C4D`; the PKCS#12 PFX/authSafe/macData ASN.1 walk
comments and OID tables; RFC 4880 old/new-format packet length encodings and the
v4 key-packet field layout; KeePass `0x9AA2D903`/`0xB54BFB65` and PVK
`0x1EF1B5B0` signatures with their field order. All accurate.

## assets/js/parsers/parsers-threed.js — no issues

Spot-verified correct comments include: OBJ/PLY/OFF line-keyword handling; USDC
`PXR-USDC` magic and "TOC offset is a u64 at byte 16"; the LAS header skip
comments and "1.4 introduced a 64-bit point count at offset 247"; MD2 (`IDP2`),
MD3 (`IDP3`), MDL (`IDPO`) header field-by-field offsets; VOX chunk walk; E57
`ASTM-E57` magic and tail-XML note; Draco/`.x`/Qubicle/U3D headers; the
`.splat` 32-byte record layout (pos f32x3 + scale f32x3 + rgba u8x4 + rot u8x4).
All accurate.

## assets/js/parsers/parsers-video.js — no issues

Spot-verified correct comments include: HLS/DASH/Smooth/F4M manifest handling and
the "no eval" note on `eval2`; MXF partition-pack UL and BER-length decode; GXF
`00 00 00 00 01` packet leader; DV DIF section-type/DSF bit notes; ASF header
GUID set and File-Properties field-offset comment; RealMedia chunk walk;
ISOBMFF box walk and VisualSampleEntry width@24/height@26 offsets; MPEG-1/2
sequence-header `00 00 01 B3`, 12+12-bit width/height, 18-bit bitrate, and the
`MPEG_AR`/`MPEG_FR` tables; H.264 SPS (profile/level, `levelIdc/10`) and H.265
SPS (`levelIdc/30`) decoding; AV1 OBU sequence-header parse and profile names;
MPEG-TS 188/192/204 packet-size detection and PAT/PMT walk; WTV magic GUID;
Insta360 trailer signature; DPX `SDPX`/`XPDS` magic with width@0x6C/height@0x70;
Cineon `80 2A 5F D7` magic. All accurate.
