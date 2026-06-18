# parsers (image/sci) comment audit

## assets/js/parsers/parsers-image.js — no issues

All comments verified against the code. Spot-checked: TGA footer offsets
(`TRUEVISION-XFILE.` at `b.length-18`, 26-byte footer), TGA RLE packet flag
(`0x80`) and 15/16-bit ARRRRRGGGGGBBBBB unpacking, QOI 14-byte header / 8-byte
end marker and the op tags (RGB `0xfe`, RGBA `0xff`, INDEX/DIFF/LUMA/RUN), Netpbm
P1-P7 magic and P4 MSB-first padding, PCX RLE (`0xc0` mask) and the 769-byte
palette marker `0x0C`, farbfeld 16-bit BE high-byte extraction, WBMP multi-byte
ints, XBM LSB-first / XPM colour table, Sun raster magic `0x59a66a95`, SGI magic
474 (`0x01DA`) bottom-up storage, DDS FourCC/DXGI -> BCn kind mapping and 128/148
byte data offsets, BC1 RGB565->RGB888 expansion and 4-colour vs 3-colour+alpha
logic, BC4 alpha block 8-endpoint interpolation and 48-bit index packing, EXR
magic `76 2f 31 01`, flags (tiled `0x200`, long names `0x400`, multi-part
`0x1000`, deep `0x800`), channel attribute 16-byte stride and compression list,
JP2 SOC/SIZ markers and box walking, JXR `II BC` header + GUID tag IDs, EPS DOS
header `C5 D0 D3 C6` and PS offset at byte 4, WMF placeable magic `D7 CD C6 9A`
and standard header type/headerSize, EMF ` EMF` signature at offset 40 and field
offsets, ICNS type table, CUR header (type=2), ANI `anih` field offsets
(nFrames/nSteps/iDispRate), MNG signature `8a 4d 4e 47` and MHDR fields, Lottie
layer-type map.

## assets/js/parsers/parsers-sci.js — no issues

All comments verified against the code. Spot-checked: DICOM "DICM" at byte 128,
explicit-VR long set, transfer-syntax UIDs, PixelRepresentation 0/1
(unsigned/signed two's complement), MONOCHROME1 inversion, pixel-data tag
(7FE0,0010); FIT header (`.FIT` magic at byte 8, header size 12/14, protocol
nibble split) and FITS disambiguation via "SIMPLE ="; FITS 80-byte cards /
2880-byte blocks, BITPIX map and big-endian sample reads, bottom-up flip; TCX/
FASTA/FASTQ tallies and Phred encoding ranges; MOL V2000/V3000 counts and SDF
`$$$$`; CIF `data_`/`_atom_site`; XYZ molecular sniff; Gerber `%FS`/`%MO`/`%TF`
and Excellon tool table; SPICE component-letter map; EDF/BDF ASCII header offsets
(patient@8, headerBytes@184, numRecords@236, numSignals@252, labels@256×16);
JCAMP `##` tags; SPSS `$FL2`/`$FL3` header layout and record-type-2 variable
walk (32-byte stride, name@24); Stata new (`<stata_dta>`) and legacy release
codes (0x69..0x73 = 105..115) and byte-order; SAS7BDAT magic, alignment bytes
32/35, endian byte 37, name@92, release@216+a1; VTK legacy/XML; NIfTI sizeof_hdr
348, magic@344, dim/datatype/pixdim offsets, scl_slope@112 / scl_inter@116,
datatype code map; SEG-Y sample interval at 1-based bytes 3217-3218 (BE) and
format-code map; SAM/VCF/BAM/BCF identification; WFDB `.hea`; R serialization
(gzip/bzip2/xz sniff, RDX2/RDX3, XDR `X`=0x58 / version ints / SEXP map); ABIF
"ABIF" magic, big-endian, 28-byte directory entries, pString/cString types
18/19; POSCAR/cube/XSF text layouts; ChemDraw `VjCD0100`; ABF `ABF `/`ABF2`
version reads; TDMS `TDSm` ToC bitmask and version 4712/4713; BrainVision
`.vhdr`/`.vmrk`; Neuroscan `.cnt` "Version 3.x" and channel u16@370; EEGLAB
`.set` MAT5/HDF5; Gmsh/Abaqus/Nastran/ANSYS deck parsers.
