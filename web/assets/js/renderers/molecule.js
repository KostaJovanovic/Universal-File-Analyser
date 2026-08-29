/* Analyser - chemical structures (MOL, SDF, MOL2, XYZ, PDB, mmCIF, CIF).

   A structure file is a list of atoms with coordinates, and sometimes a list of
   which ones are bonded. That is nearly useless as text and immediately legible
   as a picture, so this is a viewer first: 3Dmol.js (BSD-3, vendored, lazy) does
   the rendering, and everything around it is read out of the same parsed model.

   Two quite different kinds of file arrive here:

   - **Small molecules** (MOL/SDF/MOL2/XYZ) - tens of atoms, explicit bonds, and
     for an SDF a stack of records with tagged data fields after each. Drawn as
     ball-and-stick, which is what a chemist expects to see.
   - **Macromolecules** (PDB, mmCIF) - tens of thousands of atoms in chains of
     amino acids. Ball-and-stick on one of those is a hairball; the answer is the
     cartoon, which draws each chain as a ribbon following its backbone with the
     helices and sheets picked out. That is why the default style is chosen from
     what is actually in the file rather than fixed.

   The formula and molecular weight are computed here rather than taken from the
   file, because most of these formats do not state them - and where one does, it
   is an annotation that can disagree with the atoms actually listed. */
import { el, row, rowHelp, h3help, errorCard, fmtBytes, loadScript } from '../core/util.js';
import { MOLECULE_MAX, MOLECULE_ATOM_MAX } from '../core/limits.js';
const MOL3D_JS = 'assets/vendor/3dmol/3Dmol-min.js';
// Standard atomic weights (IUPAC 2021, conventional values), H to U. Enough for
// anything that turns up in a structure file; anything heavier contributes zero
// to the mass and is still counted in the formula.
const ATOMIC_WEIGHT = {
    H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007,
    O: 15.999, F: 18.998, Ne: 20.180, Na: 22.990, Mg: 24.305, Al: 26.982,
    Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.95, K: 39.098, Ca: 40.078,
    Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845,
    Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.630,
    As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62,
    Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95, Tc: 98, Ru: 101.07, Rh: 102.91,
    Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76,
    Te: 127.60, I: 126.90, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91,
    Ce: 140.12, Pr: 140.91, Nd: 144.24, Pm: 145, Sm: 150.36, Eu: 151.96,
    Gd: 157.25, Tb: 158.93, Dy: 162.50, Ho: 164.93, Er: 167.26, Tm: 168.93,
    Yb: 173.05, Lu: 174.97, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21,
    Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59, Tl: 204.38,
    Pb: 207.2, Bi: 208.98, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226,
    Ac: 227, Th: 232.04, Pa: 231.04, U: 238.03,
};
// The 20 standard amino acids plus the common nucleotides, used to tell a
// polymer chain from the ligands, ions and waters sitting around it.
const AMINO = new Set(['ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
    'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL', 'SEC', 'PYL', 'MSE']);
const NUCLEIC = new Set(['A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'DU']);
const SOLVENT = new Set(['HOH', 'WAT', 'DOD', 'H2O']);
/* Hill notation: carbon first, then hydrogen, then everything else
   alphabetically - and if there is no carbon, everything alphabetically
   including hydrogen. It is the convention every chemistry database sorts by,
   so a formula written any other way looks wrong to the people reading it. */
function hillFormula(counts) {
    const keys = Object.keys(counts);
    const rest = keys.filter((k) => k !== 'C' && k !== 'H').sort();
    const order = counts.C ? ['C', ...(counts.H ? ['H'] : []), ...rest] : keys.sort();
    return order.map((k) => k + (counts[k] > 1 ? counts[k] : '')).join('');
}
// Which 3Dmol parser to hand the text to. A .mol is a single-record SDF, and a
// .cif from a crystallography program and an .mmcif from the PDB are the same
// syntax, so both map to the one reader.
function formatFor(ext) {
    if (ext === 'sdf' || ext === 'sd' || ext === 'mol' || ext === 'mdl')
        return 'sdf';
    if (ext === 'pdb' || ext === 'ent' || ext === 'pdb1')
        return 'pdb';
    if (ext === 'cif' || ext === 'mmcif' || ext === 'mcif')
        return 'cif';
    if (ext === 'mol2')
        return 'mol2';
    if (ext === 'xyz')
        return 'xyz';
    if (ext === 'pqr')
        return 'pqr';
    if (ext === 'gro')
        return 'gro';
    return 'sdf';
}
// SDF records are separated by a line of "$$$$", and each carries its own tagged
// data fields (`> <NAME>` then the value) after the connection table. That is
// where a downloaded compound keeps its identifiers, so it is worth reading.
function splitSdf(text) {
    return text.split(/^\$\$\$\$\s*$/m).map((r) => r.trim()).filter(Boolean);
}
function sdfFields(record) {
    const out = [];
    const re = /^>\s*(?:\S+\s+)?<([^>]+)>[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n>|$)/gm;
    let m;
    while ((m = re.exec(record)) && out.length < 60) {
        const v = m[2].trim();
        if (v)
            out.push([m[1].trim(), v.length > 300 ? v.slice(0, 300) + '…' : v]);
    }
    return out;
}
// PDB header lines that say what the structure IS, which the coordinates cannot.
function pdbHeader(text) {
    const out = [];
    const grab = (tag, label) => {
        const lines = text.split('\n').filter((l) => l.startsWith(tag));
        if (!lines.length)
            return;
        const v = lines.map((l) => l.slice(10).trim()).join(' ').replace(/\s+/g, ' ').trim();
        if (v)
            out.push([label, v.length > 400 ? v.slice(0, 400) + '…' : v]);
    };
    const header = text.split('\n').find((l) => l.startsWith('HEADER'));
    if (header) {
        const id = header.slice(62, 66).trim();
        const cls = header.slice(10, 50).trim();
        const date = header.slice(50, 59).trim();
        if (id)
            out.push(['PDB ID', id]);
        if (cls)
            out.push(['Classification', cls]);
        if (date)
            out.push(['Deposited', date]);
    }
    grab('TITLE', 'Title');
    const exp = text.split('\n').find((l) => l.startsWith('EXPDTA'));
    if (exp)
        out.push(['Method', exp.slice(10).trim()]);
    const res = text.split('\n').find((l) => /^REMARK\s+2\s+RESOLUTION/.test(l));
    if (res) {
        const m = /RESOLUTION\.\s*([\d.]+)/.exec(res);
        if (m)
            out.push(['Resolution', m[1] + ' A']);
    }
    return out;
}
export async function renderMolecule(file, resultsEl) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    if (file.size > MOLECULE_MAX) {
        resultsEl.appendChild(errorCard('This structure file is larger than ' + fmtBytes(MOLECULE_MAX) + '. Not opened - the whole thing has to be parsed and turned into geometry.'));
        return;
    }
    let text = '';
    try {
        text = await file.text();
    }
    catch (e) {
        resultsEl.appendChild(errorCard('Could not read this file.'));
        return;
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const fmt = formatFor(ext);
    const records = fmt === 'sdf' ? splitSdf(text) : [text];
    if (!records.length) {
        resultsEl.appendChild(errorCard('No structure records found in this file.'));
        return;
    }
    const infoCard = el('div', { class: 'anr-card' });
    const [h, help] = h3help('Chemical structure', 'A structure file is a list of atoms with their coordinates, and often a list of which are bonded to which. Drawn here in your browser - the formula and molecular weight below are worked out from the atoms actually present rather than taken from any label in the file.');
    infoCard.appendChild(h);
    infoCard.appendChild(help);
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('File', file.name));
    tbl.appendChild(row('Size', fmtBytes(file.size)));
    tbl.appendChild(row('Format', ext.toUpperCase() + (fmt !== ext ? ' (read as ' + fmt.toUpperCase() + ')' : '')));
    if (records.length > 1)
        tbl.appendChild(rowHelp('Records', records.length.toLocaleString(), 'An SDF is a stack of separate molecules, one after another, each ending with a $$$$ line. Use the picker below the viewer to step through them.'));
    infoCard.appendChild(tbl);
    resultsEl.appendChild(infoCard);
    // ---- viewer ----
    const viewCard = el('div', { class: 'anr-card' });
    const [vh, vhelp] = h3help('Structure', 'Drag to rotate, scroll to zoom, right-drag to pan. Ball-and-stick shows every atom and bond; the cartoon draws each protein chain as a ribbon following its backbone, with helices and sheets picked out - the only way a structure of tens of thousands of atoms is readable at all.');
    viewCard.appendChild(vh);
    viewCard.appendChild(vhelp);
    const controls = el('div', { class: 'anr-mol-controls' });
    viewCard.appendChild(controls);
    const host = el('div', { class: 'anr-mol-view' });
    host.appendChild(el('p', { class: 'anr-hint' }, 'Loading the 3D viewer…'));
    viewCard.appendChild(host);
    const legend = el('div', { class: 'anr-geo-legend' });
    viewCard.appendChild(legend);
    resultsEl.appendChild(viewCard);
    const detailCard = el('div', { class: 'anr-card' });
    resultsEl.appendChild(detailCard);
    try {
        await loadScript(MOL3D_JS);
    }
    catch (e) {
        host.innerHTML = '';
        host.appendChild(errorCard('The 3D viewer failed to load. Offline?'));
        return;
    }
    const $3Dmol = window.$3Dmol;
    if (!$3Dmol) {
        host.innerHTML = '';
        host.appendChild(errorCard('The 3D viewer did not initialise.'));
        return;
    }
    host.innerHTML = '';
    const viewer = $3Dmol.createViewer(host, { backgroundColor: '#14161a' });
    let style = '';
    let colour = 'element';
    let spinning = false;
    let atoms = [];
    let isMacro = false;
    const applyStyle = () => {
        viewer.setStyle({}, {});
        const byElement = colour === 'element';
        const scheme = byElement ? {} : { colorscheme: colour === 'chain' ? 'chain' : 'ssJmol' };
        if (style === 'cartoon') {
            viewer.setStyle({}, { cartoon: colour === 'element' ? { color: 'spectrum' } : { colorscheme: colour === 'chain' ? 'chain' : 'ssJmol' } });
            // Ligands and ions are not part of any ribbon, so they would simply
            // vanish - draw them as sticks so a bound drug is still visible.
            viewer.setStyle({ hetflag: true }, { stick: { radius: 0.16 }, sphere: { scale: 0.22 } });
        }
        else if (style === 'sphere') {
            viewer.setStyle({}, { sphere: { ...scheme } });
        }
        else if (style === 'stick') {
            viewer.setStyle({}, { stick: { radius: 0.14, ...scheme } });
        }
        else if (style === 'line') {
            viewer.setStyle({}, { line: { ...scheme } });
        }
        else {
            viewer.setStyle({}, { stick: { radius: 0.14, ...scheme }, sphere: { scale: 0.28, ...scheme } });
        }
        viewer.render();
        for (const b of controls.querySelectorAll('button[data-style]'))
            b.classList.toggle('is-active', b.dataset.style === style);
        for (const b of controls.querySelectorAll('button[data-colour]'))
            b.classList.toggle('is-active', b.dataset.colour === colour);
        drawLegend();
    };
    const drawLegend = () => {
        legend.innerHTML = '';
        const swatch = (c, label) => {
            const item = el('span', { class: 'anr-legend-item' });
            const sw = el('span', { class: 'anr-legend-swatch' });
            sw.style.background = c;
            item.appendChild(sw);
            item.appendChild(document.createTextNode(label));
            return item;
        };
        if (colour === 'element') {
            if (style === 'cartoon') {
                legend.appendChild(el('span', { class: 'anr-legend-item' }, 'Ribbon coloured from one end of each chain to the other'));
                return;
            }
            const common = [['#909090', 'Carbon'], ['#ffffff', 'Hydrogen'], ['#3050f8', 'Nitrogen'], ['#ff0d0d', 'Oxygen'], ['#ffff30', 'Sulfur'], ['#ff8000', 'Phosphorus']];
            const present = new Set(atoms.map((a) => a.elem));
            for (const [c, name] of common)
                if (present.has(name === 'Sulfur' ? 'S' : name === 'Phosphorus' ? 'P' : name[0]))
                    legend.appendChild(swatch(c, name));
        }
        else if (colour === 'chain') {
            legend.appendChild(el('span', { class: 'anr-legend-item' }, 'One colour per chain'));
        }
        else {
            legend.appendChild(swatch('#ff0080', 'Helix'));
            legend.appendChild(swatch('#ffc800', 'Sheet'));
            legend.appendChild(swatch('#ffffff', 'Loop'));
        }
    };
    const loadRecord = (index) => {
        viewer.removeAllModels();
        const src = records[index] + (fmt === 'sdf' ? '\n$$$$\n' : '');
        let model;
        try {
            model = viewer.addModel(src, fmt);
        }
        catch (e) {
            host.innerHTML = '';
            host.appendChild(errorCard('This structure could not be parsed.'));
            return;
        }
        atoms = model.selectedAtoms({}) || [];
        if (atoms.length > MOLECULE_ATOM_MAX) {
            // Past this the browser is drawing more geometry than it can turn round in
            // a frame. The cartoon is far cheaper than per-atom spheres, so a very
            // large structure gets it whether or not it is a protein.
            style = 'cartoon';
        }
        isMacro = atoms.some((a) => AMINO.has(String(a.resn || '').toUpperCase()) || NUCLEIC.has(String(a.resn || '').toUpperCase()));
        if (!style)
            style = isMacro ? 'cartoon' : 'ball';
        applyStyle();
        viewer.zoomTo();
        viewer.render();
        describe(index);
    };
    const describe = (index) => {
        detailCard.innerHTML = '';
        const counts = {};
        let mass = 0, charge = 0, bonds = 0;
        const chains = new Set();
        const residues = new Set();
        const ligands = {};
        let waters = 0, ss = { h: 0, s: 0 };
        for (const a of atoms) {
            const e = String(a.elem || '').replace(/[^A-Za-z]/g, '');
            const sym = e ? e[0].toUpperCase() + e.slice(1).toLowerCase() : '?';
            counts[sym] = (counts[sym] || 0) + 1;
            mass += ATOMIC_WEIGHT[sym] || 0;
            if (a.charge)
                charge += a.charge;
            if (a.bonds)
                bonds += a.bonds.length;
            if (a.chain)
                chains.add(a.chain);
            const resn = String(a.resn || '').toUpperCase();
            if (a.resi != null && a.chain)
                residues.add(a.chain + ':' + a.resi);
            if (SOLVENT.has(resn))
                waters++;
            else if (resn && !AMINO.has(resn) && !NUCLEIC.has(resn))
                ligands[resn] = (ligands[resn] || 0) + 1;
            if (a.ss === 'h')
                ss.h++;
            else if (a.ss === 's')
                ss.s++;
        }
        bonds = Math.round(bonds / 2); // each bond is listed on both atoms
        const [dh, dhelp] = h3help('Composition', 'Worked out from the atoms in the file. The formula is in Hill notation - carbon first, then hydrogen, then everything else alphabetically - which is how every chemistry database sorts one.');
        detailCard.appendChild(dh);
        detailCard.appendChild(dhelp);
        const t = el('table', { class: 'anr-readout' });
        t.appendChild(row('Atoms', atoms.length.toLocaleString()));
        if (bonds)
            t.appendChild(row('Bonds', bonds.toLocaleString()));
        const formula = hillFormula(counts);
        if (formula)
            t.appendChild(row('Formula', formula));
        if (mass)
            t.appendChild(rowHelp('Molecular weight', mass.toFixed(2) + ' g/mol', 'The sum of the standard atomic weights of every atom present. If the file omits hydrogens - which many crystal structures do - this will read low by exactly those.'));
        if (charge)
            t.appendChild(row('Net charge', (charge > 0 ? '+' : '') + charge));
        const elements = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        t.appendChild(row('Elements', elements.map(([k, v]) => k + ' x' + v).join(', ')));
        if (chains.size)
            t.appendChild(rowHelp('Chains', String(chains.size), 'Separate polymer molecules in the structure - two chains often means the protein was crystallised as a pair.'));
        if (residues.size)
            t.appendChild(row('Residues', residues.size.toLocaleString()));
        if (ss.h || ss.s)
            t.appendChild(rowHelp('Secondary structure', ss.h.toLocaleString() + ' atoms in helices, ' + ss.s.toLocaleString() + ' in sheets', 'Helices and sheets are the repeating local shapes a protein backbone folds into. They are what the cartoon view draws.'));
        const ligNames = Object.keys(ligands);
        if (ligNames.length)
            t.appendChild(rowHelp('Non-polymer groups', ligNames.slice(0, 20).join(', ') + (ligNames.length > 20 ? ' and ' + (ligNames.length - 20) + ' more' : ''), 'Everything that is not part of a chain: bound drugs and cofactors, metal ions, and whatever the crystallisation buffer left behind.'));
        if (waters)
            t.appendChild(row('Water molecules', String(waters)));
        detailCard.appendChild(t);
        if (fmt === 'pdb') {
            const hdr = pdbHeader(records[index]);
            if (hdr.length) {
                detailCard.appendChild(el('div', { class: 'anr-readout-section' }, 'From the file header'));
                const ht = el('table', { class: 'anr-readout' });
                for (const [k, v] of hdr)
                    ht.appendChild(row(k, v));
                detailCard.appendChild(ht);
            }
        }
        else if (fmt === 'sdf') {
            const title = records[index].split('\n')[0].trim();
            const fields = sdfFields(records[index]);
            if (title || fields.length) {
                detailCard.appendChild(el('div', { class: 'anr-readout-section' }, 'From the file'));
                const ft = el('table', { class: 'anr-readout' });
                if (title)
                    ft.appendChild(row('Name', title));
                for (const [k, v] of fields)
                    ft.appendChild(row(k, v));
                detailCard.appendChild(ft);
            }
        }
    };
    // ---- controls ----
    const styleBtn = (key, label) => {
        const b = el('button', { class: 'anr-seg-btn', type: 'button' }, label);
        b.dataset.style = key;
        b.addEventListener('click', () => { style = key; applyStyle(); });
        controls.appendChild(b);
        return b;
    };
    const colourBtn = (key, label) => {
        const b = el('button', { class: 'anr-seg-btn', type: 'button' }, label);
        b.dataset.colour = key;
        b.addEventListener('click', () => { colour = key; applyStyle(); });
        controls.appendChild(b);
        return b;
    };
    loadRecord(0);
    controls.appendChild(el('span', { class: 'anr-daw-zoomlabel' }, 'Style'));
    styleBtn('ball', 'Ball and stick');
    styleBtn('stick', 'Sticks');
    styleBtn('sphere', 'Spheres');
    styleBtn('line', 'Wireframe');
    if (isMacro)
        styleBtn('cartoon', 'Cartoon');
    controls.appendChild(el('span', { class: 'anr-daw-zoomlabel' }, 'Colour'));
    colourBtn('element', 'Element');
    if (isMacro) {
        colourBtn('chain', 'Chain');
        colourBtn('ss', 'Structure');
    }
    const spinBtn = el('button', { class: 'anr-btn anr-btn-sm', type: 'button' }, 'Spin');
    spinBtn.addEventListener('click', () => {
        spinning = !spinning;
        viewer.spin(spinning ? 'y' : false);
        spinBtn.textContent = spinning ? 'Stop' : 'Spin';
    });
    controls.appendChild(spinBtn);
    const fitBtn = el('button', { class: 'anr-btn anr-btn-sm', type: 'button' }, 'Fit');
    fitBtn.addEventListener('click', () => { viewer.zoomTo(); viewer.render(); });
    controls.appendChild(fitBtn);
    applyStyle();
    // A spinning viewer left running would keep a WebGL loop alive behind the next
    // file, so it registers a stopper like any other player.
    (window._anrMediaStoppers = window._anrMediaStoppers || new Set())
        .add(() => { try {
        viewer.spin(false);
    }
    catch (_) { } });
    if (records.length > 1) {
        const strip = el('div', { class: 'anr-seg-strip' });
        records.slice(0, 200).forEach((r, i) => {
            const name = r.split('\n')[0].trim();
            const b = el('button', { class: 'anr-seg-btn', type: 'button', title: name || ('Record ' + (i + 1)) }, String(i + 1));
            b.addEventListener('click', () => {
                for (const other of strip.children)
                    other.classList.remove('is-active');
                b.classList.add('is-active');
                style = ''; // let the new record choose its own default
                loadRecord(i);
            });
            strip.appendChild(b);
        });
        if (strip.firstElementChild)
            strip.firstElementChild.classList.add('is-active');
        const c = el('div', { class: 'anr-card' });
        const [rh, rhelp] = h3help('Records (' + records.length.toLocaleString() + ')', 'An SDF holds a stack of separate molecules. Pick one to draw it; the composition below updates with it.');
        c.appendChild(rh);
        c.appendChild(rhelp);
        c.appendChild(strip);
        if (records.length > 200)
            c.appendChild(el('p', { class: 'anr-hint' }, 'Showing the first 200 of ' + records.length.toLocaleString() + '.'));
        resultsEl.insertBefore(c, detailCard);
    }
}
//# sourceMappingURL=molecule.js.map