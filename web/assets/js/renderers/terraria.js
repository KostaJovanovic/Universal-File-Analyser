/* Analyser - Terraria world viewer (.wld)

   A Terraria world is a tile grid plus a large amount of game state. Drawing the
   map means reading two things: the header (name, seed, size, difficulty, and
   which bosses are down) and the tile section, which is a run-length-encoded
   column-major sweep of every tile in the world.

   Two things make this tractable rather than enormous:

     1. The file begins with a table of SECTION POINTERS. The header has dozens
        of version-gated fields, and parsing all of them correctly across every
        release is a research project - but the tile section's offset is in that
        table, so only the handful of header fields before `maxTilesX` need to be
        read, and the rest is skipped by seeking.
     2. Tiles are RLE'd, and most of a world is air. A large world is 8400x2400
        tiles, but the encoded form is a fraction of that.

   Versions: 1.3.x and 1.4.x (file versions ~140-279) are handled. The tile
   encoding is stable across that range; what changes is header content, which is
   mostly skipped. An older or newer file is identified and its header read, but
   the map is not drawn rather than drawn wrong.

   The colour table is representative, not exact: Terraria has several hundred
   tile types and no published palette, so the common terrain, ore, wood and
   liquid types are coloured deliberately and everything else falls back by
   category. It reads as a recognisable world map, not a pixel-perfect copy of
   the in-game one. */
import { el, row, fmtBytes, h3help, downloadBlob, inlineLoader } from '../core/util.js';
import { Reader } from '../core/binutil.js';
import { TERRARIA_MAP_MAX_PX } from '../core/limits.js';
// ---- tile colours ------------------------------------------------------------
// Chosen to read like the in-game map at a glance: earth browns, stone greys,
// ores by their real hue, and the evil biomes in their signature colours.
const TILE_COLOR = {
    0: 0x976B4B, // dirt
    1: 0x808080, // stone
    2: 0x1CD85E, // grass
    5: 0x8A5A2B, // tree trunk
    6: 0xB5A48D, // iron ore
    7: 0xC9A227, // copper ore
    8: 0xE8C33F, // gold ore
    9: 0xD9D9E5, // silver ore
    10: 0x8B5A2B, // door
    21: 0x9F6A3F, // chest
    22: 0x6A2B57, // demonite ore
    23: 0x8A3A5A, // corrupt grass
    25: 0x4A3A5A, // ebonstone
    30: 0xA0522D, // wood
    37: 0xB0A070, // meteorite
    38: 0x6E6E6E, // grey brick
    40: 0x7A5C3A, // clay
    53: 0xE0D2A0, // sand
    56: 0x2B2B33, // obsidian
    57: 0x3A3A3A, // ash
    58: 0x6E3A2B, // hellstone
    59: 0x5A4030, // mud
    60: 0x2FBF4A, // jungle grass
    63: 0x5A7FBF, // sapphire
    64: 0xBF4A4A, // ruby
    65: 0x4ABF9F, // emerald
    66: 0xBF8A4A, // topaz
    67: 0xBF4A8A, // amethyst
    68: 0xD9D9D9, // diamond
    70: 0xB08040, // mushroom grass
    75: 0x2A2A2A, // obsidian brick
    109: 0x5AC8FA, // hallowed grass
    112: 0xC8B8E8, // pearlsand
    116: 0xE8E8F8, // pearlstone
    117: 0x8A8AC8, // hallowed ice
    147: 0xE8F4FF, // snow
    161: 0xB8E4F0, // ice
    199: 0xB5334A, // crimson grass
    203: 0x8A2A3A, // crimstone
    211: 0x9BE04A, // chlorophyte
    221: 0xC85A3A, // fossil / desert
    225: 0xD8B060, // hardened sand
    226: 0xB09048, // corrupt sandstone
};
// Wall colours sit behind tiles and are drawn darker so the two read apart.
const WALL_COLOR = {
    1: 0x3A3A3A, 2: 0x2E2E2E, 3: 0x3A2E24, 4: 0x2A2A2A,
    16: 0x4A3A2A, 30: 0x3A2A1A, 40: 0x2A3A2A, 44: 0x30303A,
};
const LIQUID_COLOR = [0, 0x2C6FD1, 0xD1481F, 0xD1A82C]; // -, water, lava, honey
function tileColour(type) {
    const c = TILE_COLOR[type];
    if (c !== undefined)
        return c;
    // Unlisted types fall back by rough category rather than a single colour, so
    // built structures and furniture still read as distinct from raw terrain.
    if (type >= 470)
        return 0x9A9A9A;
    if (type >= 250)
        return 0x8A7A6A;
    return 0x7A7A7A;
}
/** Read the parts of the header that come before the section pointers can take
    over, plus the pointer table itself. */
function parseHeader(r) {
    const version = r.u32();
    // 1.3.0.1 (version 135) added the "relogic" magic + revision block.
    if (version >= 135) {
        const magic = r.ascii(7);
        if (magic !== 'relogic')
            return null;
        r.u8(); // file type: 1 map, 2 world
        r.u32(); // revision
        r.u64(); // favourite
    }
    const numSections = r.u16();
    if (numSections < 2 || numSections > 32)
        return null;
    const sectionPointers = [];
    for (let i = 0; i < numSections; i++)
        sectionPointers.push(r.u32());
    // Bit array of which tile types store frame coordinates - needed to walk the
    // tile stream at all, since it changes how many bytes each tile occupies.
    const maskCount = r.u16();
    const important = [];
    let bits = 0, cur = 0;
    for (let i = 0; i < maskCount; i++) {
        if (bits === 0) {
            cur = r.u8();
            bits = 8;
        }
        important.push((cur & 1) === 1);
        cur >>= 1;
        bits--;
    }
    // Header section: only the fields up to maxTilesX are read; everything after
    // is skipped by seeking to the tile section pointer.
    r.seek(sectionPointers[0]);
    const name = pstring(r);
    let seed = '';
    if (version >= 179) {
        seed = pstring(r);
        r.u64();
    }
    if (version >= 181)
        r.skip(16); // world GUID
    r.u32(); // world id
    r.i32();
    r.i32();
    r.i32();
    r.i32(); // left/right/top/bottom bounds
    const height = r.i32();
    const width = r.i32();
    let gameMode = 0;
    if (version >= 209)
        gameMode = r.i32();
    else if (version >= 112)
        gameMode = r.u8() ? 1 : 0;
    if (width <= 0 || height <= 0 || width > 20000 || height > 12000)
        return null;
    return {
        version, name, seed, width, height, gameMode,
        sectionPointers, important, tilesOffset: sectionPointers[1],
    };
}
// Terraria strings are .NET length-prefixed: a 7-bit encoded length, then UTF-8.
function pstring(r) {
    let len = 0, shift = 0;
    for (;;) {
        const b = r.u8();
        len |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0)
            break;
        shift += 7;
        if (shift > 28)
            return '';
    }
    if (len <= 0 || len > 4096)
        return '';
    const bytes = r.bytes_(len);
    try {
        return new TextDecoder().decode(bytes);
    }
    catch (_) {
        return '';
    }
}
/** Walk the RLE tile stream, painting straight into an RGBA map. Sampling is
    done by nearest tile so a large world still fits the pixel budget. */
function renderMap(r, w, step) {
    const mw = Math.max(1, Math.ceil(w.width / step));
    const mh = Math.max(1, Math.ceil(w.height / step));
    const img = new Uint8ClampedArray(mw * mh * 4);
    const sky = 0x0A1A33;
    r.seek(w.tilesOffset);
    let x = 0, y = 0;
    while (x < w.width && r.pos < r.length) {
        const flags1 = r.u8();
        let flags2 = 0, flags3 = 0;
        if (flags1 & 1) {
            flags2 = r.u8();
            if (flags2 & 1)
                flags3 = r.u8();
        }
        let colour = sky;
        let hasTile = false;
        if (flags1 & 2) {
            hasTile = true;
            const type = (flags1 & 32) ? r.u16() : r.u8();
            if (w.important[type]) {
                r.i16();
                r.i16();
            } // frame coordinates
            if (flags3 & 8)
                r.u8(); // paint
            colour = tileColour(type);
        }
        if (flags1 & 4) {
            let wall = r.u8();
            if (flags3 & 16)
                r.u8(); // wall paint
            if (flags3 & 64)
                wall |= r.u8() << 8; // walls above 255 (1.4)
            if (!hasTile)
                colour = WALL_COLOR[wall] ?? 0x2A2A2A;
        }
        const liquid = (flags1 & 24) >> 3;
        if (liquid) {
            r.u8(); // amount
            if (!hasTile)
                colour = LIQUID_COLOR[liquid] || colour;
        }
        if (flags3 & 128)
            r.u8(); // 1.4.4 liquid type byte
        let rle = 0;
        const rleMode = (flags1 & 192) >> 6;
        if (rleMode === 1)
            rle = r.u8();
        else if (rleMode === 2)
            rle = r.u16();
        // Paint this tile and its run.
        for (let n = 0; n <= rle; n++) {
            if (x % step === 0 && y % step === 0) {
                const px = ((y / step | 0) * mw + (x / step | 0)) * 4;
                if (px + 3 < img.length) {
                    img[px] = (colour >> 16) & 255;
                    img[px + 1] = (colour >> 8) & 255;
                    img[px + 2] = colour & 255;
                    img[px + 3] = 255;
                }
            }
            y++;
            if (y >= w.height) {
                y = 0;
                x++;
                if (x >= w.width)
                    break;
            }
        }
    }
    return { img, mw, mh };
}
const GAME_MODE = ['Classic', 'Expert', 'Master', 'Journey'];
/** Render a Terraria world: the header readout plus a drawn map. */
export async function renderTerraria(file, resultsEl) {
    const loader = inlineLoader('Reading world…');
    resultsEl.appendChild(loader);
    let world = null;
    let bytes = null;
    try {
        bytes = new Uint8Array(await file.arrayBuffer());
        world = parseHeader(new Reader(bytes, true));
    }
    catch (_) {
        world = null;
    }
    loader.remove();
    if (!world || !bytes) {
        resultsEl.appendChild(el('div', { class: 'anr-info' }, 'This file has a .wld extension but does not parse as a Terraria world.'));
        return;
    }
    const wld = world;
    const info = el('div', { class: 'anr-card' });
    const [ih, ihelp] = h3help('Terraria world', 'Read straight from the world file: its name and seed, the size and difficulty it was generated at, and the game version that last saved it.');
    info.appendChild(ih);
    info.appendChild(ihelp);
    const tbl = el('table', { class: 'anr-table' });
    if (wld.name)
        tbl.appendChild(row('World name', wld.name));
    if (wld.seed)
        tbl.appendChild(row('Seed', wld.seed));
    const sizeName = wld.width >= 8000 ? 'large' : wld.width >= 6000 ? 'medium' : 'small';
    tbl.appendChild(row('Size', wld.width + ' × ' + wld.height + ' tiles (' + sizeName + ')'));
    tbl.appendChild(row('Difficulty', GAME_MODE[wld.gameMode] || ('mode ' + wld.gameMode)));
    tbl.appendChild(row('File version', wld.version));
    tbl.appendChild(row('File size', fmtBytes(file.size)));
    info.appendChild(tbl);
    resultsEl.appendChild(info);
    // 1.3.x starts at file version ~140; 1.4.x runs to ~279. Outside that the tile
    // encoding is not one this parser has been written against.
    if (wld.version < 140 || wld.version > 300) {
        resultsEl.appendChild(el('div', { class: 'anr-info' }, 'The map is not drawn: this world was saved by a Terraria version outside the 1.3-1.4 range this reader covers.'));
        return;
    }
    const drawLoader = inlineLoader('Drawing map…');
    resultsEl.appendChild(drawLoader);
    let map = null;
    try {
        // A large world is ~20 million tiles; sample down so the map stays inside
        // the pixel budget on a phone as well as a desktop.
        const step = Math.max(1, Math.ceil(Math.sqrt((wld.width * wld.height) / TERRARIA_MAP_MAX_PX)));
        map = renderMap(new Reader(bytes, true), wld, step);
    }
    catch (_) {
        map = null;
    }
    drawLoader.remove();
    if (!map) {
        resultsEl.appendChild(el('div', { class: 'anr-info' }, 'The world header was read, but its tile data could not be walked to the end.'));
        return;
    }
    const cv = document.createElement('canvas');
    cv.width = map.mw;
    cv.height = map.mh;
    const data = new Uint8ClampedArray(map.img.buffer, map.img.byteOffset, map.img.length);
    cv.getContext('2d').putImageData(new ImageData(data, map.mw, map.mh), 0, 0);
    cv.style.width = '100%';
    cv.style.height = 'auto';
    cv.style.imageRendering = 'pixelated';
    cv.style.border = '1px solid var(--hairline)';
    const card = el('div', { class: 'anr-card' });
    const [h, help] = h3help('World map', 'One pixel per tile, drawn from the world’s own tile data: terrain and ores in the foreground, walls shaded behind them, and water, lava and honey in their own colours. The palette is representative rather than an exact copy of the in-game map.');
    card.appendChild(h);
    card.appendChild(help);
    card.appendChild(cv);
    card.appendChild(el('div', { style: 'margin-top:10px;' }, [
        el('button', { type: 'button', class: 'anr-btn', onclick: () => {
                cv.toBlob((b) => { if (b)
                    downloadBlob((file.name || 'world').replace(/\.[^.]+$/, '') + '_map.png', b); }, 'image/png');
            } }, 'Save map (PNG)'),
    ]));
    resultsEl.appendChild(card);
}
//# sourceMappingURL=terraria.js.map