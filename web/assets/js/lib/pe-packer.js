/* Analyser - PE packer / protector / toolchain identification.

   DOM-free. Given a PE's section table and the file it came from, this works out
   what produced the binary and whether its code is compressed or encrypted.

   Two halves, and they answer different questions:

   - The **signature table** names things. Packers leave fingerprints that are
     hard to remove because the unpacking stub needs them: UPX renames its
     sections UPX0/UPX1, VMProtect uses .vmp0/.vmp1, PyInstaller leaves an "MEI"
     cookie in the overlay. A hit here is a name, not a judgement.
   - The **heuristics** measure. A packed binary looks the same whichever packer
     made it: the code section is near-random (entropy ~7.9 against ~6.2 for
     ordinary compiled code), the import table shrinks to the two or three
     functions the stub needs to rebuild the real one, and there is usually a
     section that occupies far more memory than it does disk because the stub
     unpacks into it.

   Neither half is proof of anything bad. Packing is what installers, licensed
   commercial software and anti-cheat all do, and it is also what malware does to
   defeat signature scanning - so the readout describes the evidence and leaves
   the conclusion to the reader. */
import { shannonEntropy } from '../core/binutil.js';
import { PE_SECTION_SAMPLE, PE_PACKER_SCAN } from '../core/limits.js';
const SIGS = [
    // ---- compressors: shrink the file, restore it at load time ----
    { name: 'UPX', kind: 'Packer', sections: ['upx0', 'upx1', 'upx2', 'upx!'], marker: /UPX[0-9!]/,
        note: 'The most common packer, and the only widely used one that is not trying to hide: `upx -d` unpacks it.' },
    { name: 'ASPack', kind: 'Packer', sections: ['.aspack', '.adata'] },
    { name: 'PECompact', kind: 'Packer', sections: ['pec1', 'pec2'], marker: /PEC2|PECompact2/ },
    { name: 'FSG', kind: 'Packer', marker: /FSG!/ },
    { name: 'MPRESS', kind: 'Packer', sections: ['.mpress1', '.mpress2'] },
    { name: 'Petite', kind: 'Packer', sections: ['.petite'] },
    { name: 'NsPack', kind: 'Packer', sections: ['.nsp0', '.nsp1', '.nsp2'] },
    { name: 'MEW', kind: 'Packer', sections: ['mew'] },
    { name: 'kkrunchy', kind: 'Packer', sections: ['kkrunchy'],
        note: 'A demoscene packer, built to fit a whole 64 KB intro in the space of a document.' },
    // ---- protectors: obfuscate and resist analysis, not primarily size ----
    { name: 'Themida / WinLicense', kind: 'Protector', sections: ['.themida', '.winlice'], marker: /Themida|WinLicense/ },
    { name: 'VMProtect', kind: 'Protector', sections: ['.vmp0', '.vmp1', '.vmp2'], marker: /VMProtect/,
        note: 'Rewrites the protected functions into bytecode for a virtual machine it ships with the binary, so there is no original machine code left to read.' },
    { name: 'Enigma Protector', kind: 'Protector', sections: ['.enigma1', '.enigma2'] },
    { name: 'Obsidium', kind: 'Protector', marker: /Obsidium/ },
    { name: 'Armadillo', kind: 'Protector', marker: /Armadillo|SecuROM/ },
    { name: 'MoleBox', kind: 'Protector', marker: /MoleBox/ },
    { name: 'ConfuserEx', kind: 'Protector', marker: /ConfuserEx|Confused by/, note: 'A .NET obfuscator.' },
    { name: '.NET Reactor', kind: 'Protector', marker: /NETReactor|\.NET Reactor/ },
    { name: 'Denuvo', kind: 'Protector', marker: /Denuvo/ },
    // ---- self-contained runtimes: a whole interpreter plus a program ----
    // The MEI cookie a PyInstaller archive ends with is four control bytes, which
    // do not survive being read as latin1 text - the two name markers are enough.
    { name: 'PyInstaller', kind: 'Runtime', marker: /PyInstaller|pyi-windows-manifest|pyi-runtime-tmpdir/,
        note: 'A Python program with the interpreter and its libraries bundled in. The Python code is in the overlay at the end of the file, not in the PE sections.' },
    { name: 'py2exe', kind: 'Runtime', marker: /py2exe|zipextimporter/ },
    { name: 'cx_Freeze', kind: 'Runtime', marker: /cx_Freeze/ },
    { name: 'Nuitka', kind: 'Runtime', marker: /__nuitka|Nuitka/,
        note: 'Python compiled to C first, so unlike PyInstaller there is no bundled .pyc to recover.' },
    { name: 'AutoIt', kind: 'Runtime', marker: /AU3!EA06|AutoIt v3/ },
    { name: 'Electron', kind: 'Runtime', marker: /electron\.asar|Electron Framework/ },
    { name: 'Node SEA / pkg', kind: 'Runtime', marker: /NODE_SEA_BLOB|PKG_DUMMY_ENTRYPOINT/ },
    { name: 'Java launcher (Launch4j)', kind: 'Runtime', marker: /Launch4j|launch4j/ },
    // ---- toolchains: what compiled it ----
    { name: 'Go', kind: 'Toolchain', marker: /Go build ID:|go\.buildid|runtime\.morestack/,
        note: 'Go statically links everything, so a Go binary is large and has almost no imports - which on its own looks like packing until you see the build ID.' },
    { name: 'Rust', kind: 'Toolchain', marker: /rustc\/|\/rust\/deps|rust_panic/ },
    { name: 'Delphi / C++ Builder', kind: 'Toolchain', sections: ['code', 'data', 'bss'], all: true, marker: /Borland|Embarcadero|Delphi/ },
    { name: 'MinGW / GCC', kind: 'Toolchain', marker: /GCC: \(|mingw/ },
    { name: 'Visual Basic 6', kind: 'Toolchain', marker: /MSVBVM60\.DLL|VB5!/ },
    { name: 'AutoHotkey', kind: 'Runtime', marker: /AutoHotkey/ },
];
// Section names a normal compiler and linker produce. Anything outside this set
// is worth mentioning, because a packer has to name its sections something and
// most pick a name of their own.
const KNOWN_SECTIONS = new Set([
    '.text', '.data', '.rdata', '.bss', '.idata', '.edata', '.pdata', '.xdata',
    '.rsrc', '.reloc', '.tls', '.debug', '.didat', '.crt', '.sdata', '.gfids',
    '.00cfg', '.detourc', '.detourd', '.textbss', '.symtab', '.buildid',
    'code', 'data', 'bss', '.ndata', '.wixburn', '.giats', '.msvcjmc', '.retplne',
]);
function flagNames(f) {
    const out = [];
    if (f & 0x20000000)
        out.push('exec');
    if (f & 0x40000000)
        out.push('read');
    if (f & 0x80000000)
        out.push('write');
    if (f & 0x00000020)
        out.push('code');
    if (f & 0x00000040)
        out.push('init-data');
    if (f & 0x00000080)
        out.push('uninit-data');
    return out;
}
/* Read a sample of each section's raw bytes and measure its entropy.

   Sampling rather than reading the whole section is deliberate: entropy is a
   property of the byte distribution, and a few hundred KB settles to within a
   few hundredths of a bit of the full-section figure while keeping a 200 MB
   binary from being pulled through memory to answer one question. Sections with
   no raw data (the classic UPX0 "unpack into me" section) report null, which is
   itself the signal. */
async function measureSections(file, sections, entryRva) {
    const out = [];
    for (const s of sections) {
        let entropy = null;
        if (s.rawSize > 0 && s.rawOff > 0 && s.rawOff < file.size) {
            try {
                const end = Math.min(file.size, s.rawOff + Math.min(s.rawSize, PE_SECTION_SAMPLE));
                const bytes = new Uint8Array(await file.slice(s.rawOff, end).arrayBuffer());
                if (bytes.length)
                    entropy = shannonEntropy(bytes);
            }
            catch (_) {
                entropy = null;
            }
        }
        out.push({
            name: s.name, vsize: s.vsize, rawSize: s.rawSize, entropy,
            flags: flagNames(s.flags),
            atEntry: entryRva > 0 && entryRva >= s.vaddr && entryRva < s.vaddr + Math.max(s.vsize, s.rawSize),
        });
    }
    return out;
}
// The head and the tail of the file, where the markers worth scanning for live:
// a packer's stub sits near the entry point at the front, and bundled runtimes
// put their payload cookie in the overlay at the back.
async function scanText(file) {
    const n = Math.min(PE_PACKER_SCAN, file.size);
    const dec = new TextDecoder('latin1');
    let text = dec.decode(new Uint8Array(await file.slice(0, n).arrayBuffer()));
    if (file.size > n * 2)
        text += '\n' + dec.decode(new Uint8Array(await file.slice(file.size - n).arrayBuffer()));
    return text;
}
export async function analysePePacking(file, sections, meta) {
    if (!file || !sections.length)
        return null;
    const reports = await measureSections(file, sections, meta.entry);
    let text = '';
    try {
        text = await scanText(file);
    }
    catch (_) {
        text = '';
    }
    const lower = sections.map((s) => s.name.toLowerCase());
    const matches = [];
    for (const sig of SIGS) {
        const bySection = sig.sections
            ? (sig.all ? sig.sections.every((n) => lower.includes(n)) : sig.sections.some((n) => lower.includes(n)))
            : false;
        const byMarker = sig.marker ? sig.marker.test(text) : false;
        // A signature that declares BOTH a section set and a marker wants both when
        // its section names are ordinary words ("code", "data") that would otherwise
        // match half the binaries ever compiled.
        const needsBoth = !!(sig.all && sig.marker);
        const hit = needsBoth ? (bySection && byMarker) : (bySection || byMarker);
        if (!hit)
            continue;
        const why = bySection && byMarker ? 'section names and an internal marker'
            : bySection ? 'section names' : 'an internal marker';
        matches.push({ name: sig.name, kind: sig.kind, why: sig.note ? why + '. ' + sig.note : why });
    }
    // ---- heuristics ----
    const signals = [];
    const entrySec = reports.find((r) => r.atEntry);
    const codeSecs = reports.filter((r) => r.flags.includes('code') || r.flags.includes('exec'));
    const measured = reports.filter((r) => r.entropy != null);
    const topEntropy = measured.length ? Math.max(...measured.map((r) => r.entropy)) : 0;
    if (entrySec && entrySec.entropy != null && entrySec.entropy >= 7.2) {
        signals.push('The section holding the entry point measures ' + entrySec.entropy.toFixed(2) +
            ' bits per byte. Ordinary compiled code sits near 6.0 to 6.5; above about 7.2 the bytes are compressed or encrypted rather than executable as they stand.');
    }
    const hollow = reports.filter((r) => r.rawSize === 0 && r.vsize > 4096);
    if (hollow.length) {
        signals.push('Section ' + hollow.map((r) => r.name).join(', ') + ' takes up space in memory but holds no data on disk - the shape of a section a packer unpacks itself into at start-up.');
    }
    const bloat = reports.filter((r) => r.rawSize > 4096 && r.vsize > r.rawSize * 4);
    if (bloat.length && !hollow.length) {
        signals.push('Section ' + bloat.map((r) => r.name).join(', ') + ' expands more than fourfold once loaded, which is what a compressed payload does.');
    }
    if (!meta.isDotNet && meta.importDlls > 0 && meta.importDlls <= 2 && topEntropy >= 7.0) {
        signals.push('Only ' + meta.importDlls + ' DLL' + (meta.importDlls === 1 ? ' is' : 's are') +
            ' imported. A packed binary rebuilds its real import table at run time, so what survives in the header is just enough to call LoadLibrary.');
    }
    const wx = reports.filter((r) => r.flags.includes('write') && r.flags.includes('exec'));
    if (wx.length) {
        signals.push('Section ' + wx.map((r) => r.name).join(', ') + ' is both writable and executable. Compilers do not emit that; code that rewrites itself needs it.');
    }
    const unusual = reports.filter((r) => r.name && !KNOWN_SECTIONS.has(r.name.toLowerCase()));
    if (unusual.length && !matches.length) {
        signals.push('Section name' + (unusual.length === 1 ? '' : 's') + ' ' + unusual.map((r) => r.name).join(', ') +
            ' ' + (unusual.length === 1 ? 'is' : 'are') + ' not what a compiler produces.');
    }
    if (entrySec && codeSecs.length && entrySec !== codeSecs[0] && reports.indexOf(entrySec) === reports.length - 1) {
        signals.push('Execution starts in the last section rather than in the first code section, which is where an unpacking stub is normally appended.');
    }
    if (meta.overlaySize > 1024 * 1024) {
        signals.push('There is ' + Math.round(meta.overlaySize / 1048576) + ' MB of data appended past the end of the last section. Self-extracting installers and bundled runtimes keep their payload there.');
    }
    // ---- verdict ----
    const packers = matches.filter((m) => m.kind === 'Packer' || m.kind === 'Protector');
    let verdict;
    let confidence;
    if (packers.length) {
        verdict = 'Packed with ' + packers.map((m) => m.name).join(' and ') + '.';
        confidence = 'high';
    }
    else if (signals.length >= 2) {
        verdict = 'Looks packed or protected, but by nothing this recognises by name.';
        confidence = 'medium';
    }
    else if (signals.length === 1) {
        verdict = 'One sign of packing, which on its own is not much.';
        confidence = 'low';
    }
    else if (matches.length) {
        verdict = 'No sign of packing. Built with ' + matches.map((m) => m.name).join(', ') + '.';
        confidence = 'high';
    }
    else {
        verdict = 'No sign of packing - the code sections read as ordinary compiled code.';
        confidence = 'medium';
    }
    return { matches, signals, sections: reports, verdict, confidence };
}
//# sourceMappingURL=pe-packer.js.map