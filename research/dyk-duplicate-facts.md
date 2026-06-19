# "Did you know" - duplicate facts audit

Each `/formats/<ext>` page carries a **Did you know** list of 3+ facts. This is a
scan of all 1147 generated pages for cases where **two facts in the same list say
the same thing, just worded differently**.

- **Source of the facts:** the hand-authored `fact` / `facts` fields in
  `tools/format-page-content.mjs` (`EXT_PAGES`) and the per-ext bullets in
  `tools/dyk-extra.json`. (The auto-derived backfill in
  `tools/prerender-format-pages.mjs` already dedupes by keyword, so the overlaps
  below are almost all between two *hand-written* bullets.)
- **How to read it:** the two duplicated bullets are quoted under each format.
  Fixing one means dropping or rewriting one of the pair in the source above, then
  re-running `save.bat` (or the generator) to regenerate the page.

Methodology: token-overlap + sequence similarity across the bullets of every page,
then a manual pass to keep only real semantic repeats and drop pairs that merely
share a subject.

---

## Strong duplicates - the same fact restated

These pairs state the same core fact; the second bullet usually just adds a name,
date or detail on top of the identical claim.

### Photo / raw formats

- **/formats/erf** - "ERF was used by the Epson R-D1, one of the first digital rangefinder cameras." vs "ERF was the raw format of the Epson R-D1, which on its 2004 release was the world's first digital rangefinder camera."
- **/formats/crw** - "CRW was Canon's first raw format, used before CR2 arrived in 2004." vs "It was Canon's first consumer raw format, used on early digital cameras before CR2 took over."
- **/formats/nrw** - "NRW is a lighter Nikon raw format used in Coolpix compact cameras." vs "NRW is a Nikon raw format made for Coolpix compact cameras, beginning with the Coolpix P6000."
- **/formats/srw** - "SRW is the raw format from Samsung's NX mirrorless cameras." vs "SRW is the raw format of Samsung's NX mirrorless line, including the well-regarded NX1, before Samsung exited the camera business around 2015."
- **/formats/srf** - "SRF came from Sony's fixed-lens Cyber-shot prosumer cameras such as the DSC-F828, predating the later SR2 and ARW formats." vs "SRF was Sony's earliest raw format, debuting on prosumer Cyber-shot fixed-lens cameras such as the DSC-F828 before any Sony DSLR existed."
- **/formats/arw** - "Sony introduced ARW with its Alpha camera line in 2006." vs "ARW stands for Alpha RAW, named after Sony's Alpha camera line that the format debuted with."
- **/formats/mos** - "MOS comes from Leaf digital camera backs, prized in studio photography." vs "MOS files come from Leaf digital camera backs, including the Leaf Aptus and Mamiya-branded medium-format systems." (and a third bullet: "Leaf MOS is most at home in studio and commercial photography, where its large medium-format files are prized for quality." - overlaps the first on "prized / studio photography")
- **/formats/gpr** - "GPR is built on Adobe's open DNG format, tuned for GoPro action cameras." vs "GPR is built on Adobe's open DNG standard, so most software that reads DNG can also work with GoPro's raw files."
- **/formats/id/bay** - "BAY holds the unprocessed Bayer-sensor data from certain cameras." vs "BAY holds uncompressed raw sensor data, written by some Casio QV-series cameras to a file named NOCOMP.BAY."
- **/formats/id/eip** - "An EIP keeps a raw photo and its Capture One adjustments together in one file." vs "An EIP keeps the original raw photo together with manifest.xml files describing every Capture One adjustment."
- **/formats/id/lrtemplate** - "Adobe Lightroom replaced its .lrtemplate presets with a newer XMP-based preset format." vs "Adobe shifted from .lrtemplate to XMP presets with Lightroom Classic CC 7.3, so newer versions only write the XMP format."
- **/formats/id/cin** - "Cineon was Kodak's pioneering format for scanning film into the computer." vs "Cineon was created by Kodak in the early 1990s as one of the first digital film systems, scanning frames into the computer."
- **/formats/id/crm** - "Cinema RAW Light lets Canon cameras record raw video at manageable file sizes." vs "Cinema RAW Light debuted on the Canon EOS C200, compiling the raw frames into one .CRM movie rather than thousands of stills."

### Image formats

- **/formats/id/pat** - "PAT files store tileable patterns for filling and texturing in Photoshop." vs "A single PAT file can hold a whole library of tileable patterns for filling and texturing in Photoshop."
- **/formats/id/sgi** - "The SGI image format came from the graphics workstations that rendered early CGI films." vs "The SGI image format was invented by Paul Haeberli as the native raster format of Silicon Graphics workstations."
- **/formats/id/bw** - "BW is the single-channel greyscale variant of the SGI image format." vs "The SGI image format was invented by Paul Haeberli, and the .bw extension marks its single-channel black-and-white variant."
- **/formats/id/pam** - "PAM extended the old Netpbm formats with an alpha channel and more." vs "PAM was added to the Netpbm family in 2000 to bring an alpha channel and arbitrary tuples to the simple maps."
- **/formats/id/wdp** - "WDP was Microsoft's Windows Media Photo before it was standardised as JPEG XR." vs "WDP began as Microsoft's Windows Media Photo, was renamed HD Photo, then became the international standard JPEG XR."
- **/formats/id/jxr** - "JPEG XR grew out of Microsoft's HD Photo and became a standard in 2009." vs "JPEG XR began life as Microsoft's HD Photo, which was itself first announced as Windows Media Photo." (same Windows Media Photo -> HD Photo -> JPEG XR lineage as wdp above)

### Audio formats

- **/formats/id/dsf** - "DSF stores the 1-bit DSD audio used by Super Audio CD." vs "It carries the 1-bit, 2.8 MHz Direct Stream Digital signal that underpins the Super Audio CD."
- **/formats/id/tak** - "TAK aims to match the best lossless compression while decoding quickly." vs "It is designed to roughly match Monkey's Audio compression while decoding nearly as fast as FLAC."
- **/formats/id/sfz** - "SFZ is a free, human-readable way to define sampled instruments." vs "SFZ was created by Cakewalk in the early 2000s as a plain-text, human-editable way to map sampled instruments."

### Video formats

- **/formats/m2ts** - "M2TS is the transport-stream form of AVCHD, also used on Blu-ray discs." vs "M2TS is a modified MPEG-2 Transport Stream used as the BDAV container on Blu-ray discs and AVCHD camcorders."
- **/formats/id/m1v** - "MPEG-1 video powered the Video CD, an early-1990s precursor to the DVD." vs "The same MPEG-1 video stream is what plays back from a Video CD, the disc format that preceded the DVD."
- **/formats/id/ismc** - "The ISMC tells the player which quality levels a Smooth Streaming video offers." vs "The ISMC is the client manifest delivered to the player, listing the available quality levels of a Smooth Streaming presentation."

### Documents / office

- **/formats/ott** - "OTT is the OpenDocument equivalent of a Word .dotx template." vs "OTT is the OpenDocument text template from the OASIS standard, the open-format counterpart to a Word .dotx template."
- **/formats/id/dot** - "DOT was Word's template format before the XML-based DOTX." vs "DOT was Word's template format, holding the styles, layout and boilerplate that new documents are built from."
- **/formats/id/sdc** - "SDC was StarOffice's spreadsheet before the move to open ODF formats." vs "SDC was the file of StarCalc, the spreadsheet in the StarOffice 5 suite."
- **/formats/id/book** - "A FrameMaker book file assembles many documents into one numbered publication." vs "A FrameMaker book file lists its component documents and stores the pagination and numbering rules that knit them into one publication."
- **/formats/id/oxps** - "OXPS is the Ecma-standard form of XPS used by newer Windows." vs "OXPS is the Ecma-388 standard form of XPS, approved by Ecma International in 2009."

### Email / PIM

- **/formats/id/pst** - "An Outlook PST can hold years of mail, contacts and calendar in a single file." vs "PST stands for Personal Storage Table, the on-disc file Outlook uses to hold mail, contacts and calendar items."
- **/formats/id/dbx** - "Outlook Express stored each mail folder as a DBX file in Windows XP and earlier." vs "Outlook Express kept one DBX per mail folder, with a master Folders.dbx indexing them all."

### CAD / 3D / engineering

- **/formats/brep** - "Boundary representation has been the core way CAD kernels describe solids since the 1970s." vs "Boundary representation has underpinned mainstream CAD modelling kernels since the 1970s, making it one of the oldest ideas in solid modelling still in daily use."
- **/formats/igs** - "IGS is IGES under its short extension - the first widely used CAD exchange format, from 1980." vs "IGS and IGES are the same vendor-neutral CAD exchange format, just written with the short three-letter extension."
- **/formats/id/psm** - "PSM is Solid Edge's format for parts to be folded from sheet metal." vs "It is a sibling of Solid Edge's ordinary part files, specialised for components that will be folded from flat sheet." vs "PSM is the sheet-metal part format of Solid Edge, the mechanical CAD package now developed by Siemens." (all three bullets repeat "Solid Edge sheet-metal part")
- **/formats/id/session** - "A CATIA session bundles the models a designer was working with together." vs "The .session format dates from CATIA Version 4, bundling together the .model files a designer was using."
- **/formats/id/nwc** - "The NWC cache lets Navisworks reopen a heavy model quickly." vs "An NWC is exported from CAD or laser-scan software, capturing just the geometry and properties Navisworks needs so it can reopen heavy models quickly."
- **/formats/id/rte** - "An RTE gives a new Revit project its standard settings and views." vs "An RTE seeds a new Revit project with standard settings, views and content, much as RFT does for individual families."
- **/formats/id/vtp** - "VTP holds points and polygons in VTK's XML format." vs "VTP is the .vtp member of VTK's XML family, holding vtkPolyData - points joined into vertices, lines, polygons and strips."

### Dev / data

- **/formats/id/desc** - "A descriptor set lets tools understand Protobuf messages without the original .proto file." vs "It is produced by protoc's --descriptor_set_out flag and lets tools parse messages or use reflection without the source .proto."
- **/formats/id/feather** - "Feather was built to move data frames between Python and R at high speed." vs "Feather was created by Wes McKinney and Hadley Wickham in 2016 to swap data frames quickly between Python and R."
- **/formats/id/tfstate** - "Terraform keeps a state file mapping your config to the resources it actually created." vs "The file maps every resource in your configuration to the real object Terraform created in the cloud."
- **/formats/id/bam** - "BAM is the compressed binary form of the SAM alignment format in genomics." vs "BAM is the binary counterpart of the text-based SAM alignment format, shrinking a multi-gigabyte SAM file to a fraction of its size."
- **/formats/id/fna** - "The .fna suffix marks a FASTA file as nucleic-acid sequences." vs "The .fna suffix flags a FASTA file as nucleic-acid sequences, distinguishing it from the .faa used for proteins."
- **/formats/id/pbf** - "PBF uses Protocol Buffers to pack map data far smaller than XML." vs "PBF is built on Google's Protocol Buffers, packing map data far more tightly than the equivalent XML."
- **/formats/id/axf** - "AXF is the ELF-based image produced by Arm's development toolchains." vs "AXF stands for ARM eXecutable Format, the ELF/DWARF image produced by Arm's compiler toolchain."

### Games / emulation

- **/formats/id/cso** - "CSO shrinks a game ISO so more titles fit on a memory card." vs "CSO, also called CISO, was built to shrink ripped PSP UMD games so more titles fit on a memory card."
- **/formats/id/ppf** - "PPF was created to patch CD-based console images that IPS could not handle." vs "PPF was created by Icarus of the group Paradox specifically to patch CD-based console images, which the older IPS format could not handle."
- **/formats/id/dsv** - "DSV stores the in-game saves of DS titles played in DeSmuME." vs "A DSV holds the in-game battery saves that real DS cartridges would keep, written out by DeSmuME as a file on disk."
- **/formats/id/state** - "A savestate captures the exact moment of play, letting you resume instantly." vs "A savestate serialises the whole machine - CPU registers, RAM and video memory - so play resumes at that exact instant."
- **/formats/id/ldtk** - "LDtk is a free level editor built by one of the developers of Dead Cells." vs "LDtk stands for Level Designer Toolkit and was built by Sebastien Benard, director of the game Dead Cells."
- **/formats/id/spine** - "Spine animates 2D game characters with bones instead of frame-by-frame drawing." vs "Spine animates characters with bones and meshes rather than drawn frames, keeping file size and artwork small."
- **/formats/id/tmj** - "TMJ is just a Tiled map saved as JSON instead of XML." vs "TMJ is the JSON serialisation of a Tiled map, an alternative to the older XML-based TMX form."
- **/formats/id/uexp** - "Unreal splits an asset's header and its heavy data into .uasset and .uexp." vs "Splitting the header into .uasset and the payload into .uexp lets Unreal load all package headers first and fetch the heavy data only when needed."
- **/formats/id/mcr** - "MCR was Minecraft's region format before the Anvil update raised the height limit." vs "MCR was Minecraft Java Edition's region format from Beta 1.3 onward, before the Anvil update renamed the files to .mca."
- **/formats/id/acf** - "Steam writes an ACF manifest for every game so it knows what is installed and up to date." vs "Steam names each manifest after the game's numeric App ID, for example appmanifest_730.acf, and it tracks install paths and update state."

### System / disk / security

- **/formats/id/fd** - "An FD image is the raw contents of a motherboard's firmware chip." vs "An FD image is the raw contents of a board's firmware chip, the form coreboot and EDK2 produce and flash."
- **/formats/id/simg** - "A sparse image skips empty space, so flashing an Android partition is faster." vs "A sparse image marks unused regions as 'don't care' chunks, so only meaningful data is written and transferred."
- **/formats/id/vhd** - "VHD came from Connectix Virtual PC, which Microsoft acquired in 2003." vs "VHD was created by Connectix for Virtual PC, technology Microsoft acquired in 2003 and later folded into Hyper-V."
- **/formats/id/job** - "JOB files stored scheduled tasks in older versions of Windows." vs "A .job file stored a single Task Scheduler entry in the older Windows scheduler before newer versions moved to XML task definitions."
- **/formats/id/pvk** - "A PVK holds the private key developers use to sign Windows software." vs "It holds the private half of an Authenticode key used to sign Windows executables, drivers and installers."
- **/formats/id/kdb** - "KDB is the original KeePass vault, since succeeded by the KDBX format." vs "KDB was the format of KeePass 1.x and was superseded by KDBX when the manager moved to its version 2 line."
- **/formats/id/exe** - "The 'MZ' marker at the start of an EXE is the initials of Mark Zbikowski, an early MS-DOS developer." vs "Analyser spots a .EXE file by its signature bytes 4D 5A - ASCII for 'MZ', the initials of MS-DOS architect Mark Zbikowski." (the hand-written fact collides with the auto-generated magic-bytes line)

### Other

- **/formats/gpx** - "GPX was released in 2002 as a universal, open way to share GPS data between devices and apps." vs "GPX was created by Dan Foster of the company TopoGrafix as an open, vendor-neutral way to move GPS data between devices and software."
- **/formats/id/aff** - "AFF was created as an open alternative for storing forensic disk images." vs "It was created as a vendor-neutral alternative to closed forensic formats, storing the disk image alongside case metadata."
- **/formats/id/vhdr** - "BrainVision splits an EEG recording into a header, markers and the raw signal." vs "The BrainVision format from Brain Products GmbH splits a recording into a .vhdr header, a .vmrk marker file and a binary .eeg data file."
- **/formats/id/resource** - "Unity keeps bulk data like audio in .resource files alongside its scenes." vs "Unity stores bulky binary assets like audio and video in a .resource file that sits alongside the serialised scene data in a build or asset bundle."
- **/formats/id/dt2** - "DTED level 2 packs the most detailed elevation grid of the standard DTED levels." vs "Level 2 packs a 1-arc-second post spacing, about a 30-metre grid - the finest of the standard DTED resolutions."
- **/formats/id/bip** - "BIP stores all of a pixel's bands together, one pixel after another." vs "BIP stores every band of a pixel together before moving to the next pixel, the most interleaved of the three ENVI layouts."
- **/formats/id/crdownload** - "Chrome adds the .crdownload suffix while a file downloads, removing it once finished." vs "Chrome renames the file to its real name and drops the .crdownload suffix only once the download finishes successfully."
- **/formats/id/lrx** - "LRX was the encrypted form of Sony's early e-book format." vs "LRX is the encrypted member of Sony's BBeB (Broad Band eBook) family, alongside the readable LRS source and the compiled LRF."
- **/formats/id/afpub** - "Affinity Publisher completed Serif's design suite when it launched in 2019." vs "Affinity Publisher was the last of Serif's three Affinity apps to arrive, completing the suite in 2019."
- **/formats/id/asx** - "ASX was the metafile that launched streams in Windows Media Player." vs "ASX stands for Advanced Stream Redirector, an XML metafile that points Windows Media Player at one or more streams to play in turn."
- **/formats/id/cbt** - "CBT packs comic pages into a TAR archive instead of a ZIP." vs "The trailing letter of a comic archive names its format, so CBT stores comic pages in an uncompressed TAR archive."
- **/formats/tap** - "The .tap name recalls the punched paper tape that fed early CNC machines." vs "The extension recalls the punched paper tape that early numerically controlled machines read before computers were built in."

---

## Borderline - shared subject, but each bullet adds something

These pairs overlap heavily on a core claim but each carries a distinct extra fact,
so they read as repetitive without being strict duplicates. Worth a look if you want
the lists fully tight, but lower priority than the section above.

- **/formats/amr** - "AMR was adopted in 1999 as the standard voice codec for GSM mobile networks." vs "AMR uses the ACELP technique and was chosen by 3GPP as the standard speech codec for GSM and later mobile networks." (both: standard codec for GSM)
- **/formats/mts** - "AVCHD was launched by Sony and Panasonic in 2006 for HD camcorders." vs "MTS is the camcorder recording form of AVCHD, which Sony and Panasonic jointly introduced in 2006 for HD camcorders." (the AVCHD launch fact repeats)
- **/formats/nrw** - "NRW is a lighter Nikon raw format used in Coolpix compact cameras." vs "It is a lighter sibling of Nikon's professional NEF format, aimed at consumer compact bodies rather than SLRs." (third NRW bullet; "lighter Nikon ... compact" repeats the first)
- **/formats/id/cramfs** - "cramfs was an early compressed filesystem for squeezing Linux onto tiny flash chips." vs "cramfs was written by Linus Torvalds as a deliberately minimal read-only filesystem for cramming Linux onto small ROM chips."
- **/formats/id/scr** - "A screensaver is just a Windows program with an .scr name, which made them a malware trick." vs "A screensaver is a normal Windows PE executable; the .scr name just tells the system to treat it as one."
- **/formats/id/lock** - "Lockfiles make sure every developer and server installs identical package versions." vs "Lockfiles are normally checked into version control so every developer and build server resolves to the very same versions."
- **/formats/id/dtbo** - "Overlays let add-on boards describe their hardware without rebuilding the whole device tree." vs "On Android, overlays live in a dedicated dtbo partition so the bootloader can patch hardware without reflashing the base tree."
- **/formats/id/conf** - "Many classic services, from Apache to SSH, keep their settings in .conf files." vs "The convention is a Unix tradition, where services from SSH to Nginx expect their settings under names like sshd_config."
- **/formats/id/shp** - "Esri created the Shapefile in the early 1990s and it remains the de-facto GIS exchange format." vs "Esri published the shapefile specification openly, which helped it become the de-facto exchange format across rival GIS tools."
- **/formats/id/xln** - "Drill files tell the factory the position and size of every hole in a board." vs "An XLN drill file follows the Excellon format, the de facto standard that drives the CNC machines drilling holes in circuit boards."
- **/formats/id/m2t** - "The transport stream was built to survive the errors of broadcast and tape." vs "Transport-stream data is chopped into fixed 188-byte packets so interleaved programmes survive the dropouts of broadcast and tape."
- **/formats/3fr** - "3FR comes from Hasselblad's medium-format cameras and digital backs." vs "3FR was introduced with Hasselblad's H2D camera, the firm's move into its own digital raw workflow."
- **/formats/sxd** - "SXD was the drawing format of the OpenOffice 1 era." vs "SXD was used by both OpenOffice.org Draw and StarOffice, which shared the same OpenOffice.org XML format."
- **/formats/mka** - "MKA is part of the open Matroska family, first released in 2002." vs "MKA is the audio-only member of the Matroska family, alongside MKV for video and MKS for subtitles."
- **/formats/dwt** - "DWT is an AutoCAD drawing template, storing the standard layers and styles a firm reuses." vs "AutoCAD ships ready-made DWT templates preset to drafting standards such as ISO and ANSI sheet sizes."
- **/formats/id/wtv** - "WTV was the format Windows Media Center used for HD television recordings." vs "WTV was introduced with the Windows Media Center TV Pack for Windows Vista and became standard in Windows 7."
- **/formats/id/grib** - "GRIB is the World Meteorological Organization's standard for sharing forecast data." vs "GRIB was created by the World Meteorological Organization's Commission for Basic Systems, with the first edition introduced in the mid-1980s."
- **/formats/id/csproj** - "A .csproj lists the files, settings and dependencies the .NET build needs." vs "A .csproj is an MSBuild file, structured around properties, items, targets and tasks that drive the .NET build."
- **/formats/id/gdb** - "The file geodatabase is Esri's modern container for organising GIS data." vs "An Esri file geodatabase is a folder of binary files, the successor to the Access-based personal geodatabase."
- **/formats/id/zoo** - "The Zoo archiver was used in the late 1980s before ZIP took over." vs "The Zoo archiver was written by Rahul Dhesi in the mid-1980s and built on the LZSS compression algorithm."
- **/formats/zst** - "Zstandard was created by Facebook in 2016 and is now used everywhere from Linux to game engines." vs "Zstandard was created by Yann Collet, who is also the author of the even faster LZ4 algorithm."
- **/formats/id/thrift** - "Thrift came out of Facebook to let services written in different languages talk to each other." vs "Thrift was built at Facebook and open-sourced in 2007, later becoming a top-level Apache project."
- **/formats/epub** - "EPUB was released in 2007 by the International Digital Publishing Forum and is the standard everywhere except Amazon Kindle." vs "EPUB grew out of the earlier Open eBook Publication Structure, the standard that the International Digital Publishing Forum first approved at the end of the 1990s."
- **/formats/odt** - "ODT is the OpenDocument text format used by LibreOffice Writer and OpenOffice, ratified as a standard in 2006." vs "OpenDocument descends from the XML format OpenOffice.org introduced and is standardised internationally as ISO/IEC 26300."
- **/formats/id/crl** - "A CRL lets software reject certificates that were revoked before they expired." vs "Each CRL is issued and signed by a certificate authority, listing serial numbers of certificates revoked before they expire."
- **/formats/id/desc** - "A descriptor set lets tools understand Protobuf messages without the original .proto file." vs "A .desc file is itself a serialised Protobuf message - a FileDescriptorSet describing one or more compiled .proto schemas." (second overlap on the desc page, separate from the strong pair above)
- **/formats/id/vts** - "VTS stores data on a curved structured grid for tools like ParaView." vs "It belongs to VTK's XML format family and is read straight into tools like ParaView."
- **/formats/id/bib** - "A .bib file is the reference database that feeds citations into a LaTeX paper." vs "A .bib file separates raw reference data from presentation, leaving a .bst style file to decide how each citation is formatted."
- **/formats/id/pce** - "The PC Engine was a hit in Japan, sold as the TurboGrafx-16 elsewhere." vs "The PC Engine launched in Japan in 1987, built by Hudson Soft and manufactured by NEC."
- **/formats/id/gba** - "The Game Boy Advance launched in 2001 with 32-bit power in a handheld." vs "The Game Boy Advance is driven by a 32-bit ARM7TDMI, a leap over its 8-bit predecessors."

---

Scan covered 1147 pages; ~65 strong duplicate pages and ~30 borderline. Not flagged
(distinct facts that merely share a keyword): whl, set, overridecontroller,
physicsMaterial2D and the like.
