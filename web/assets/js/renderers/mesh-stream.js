/* Analyser - STL / PLY too large to hold whole.

   Past WALL_PARSE a mesh is read in MESH_STREAM_CHUNK slices rather than
   declined. Two things come out of the one read:

   - MeshStats: the triangle count, bounding box, surface area and volume over
     EVERY triangle - the same sums makeResult() in stl.ts does, so the figures
     match what the whole-file path would print.
   - MeshDecimator: a simplified copy for the viewer, by vertex clustering. Each
     corner snaps to the centre of its cell in a grid over the bounding box;
     triangles whose corners land in fewer than three cells vanish, and repeats
     are dropped through a hash of the cell triple. When the copy outgrows
     MESH_STREAM_PREVIEW_TRIS the grid halves and the kept triangles are
     re-snapped, so one pass always fits.

   A binary or ASCII STL is read twice (the grid needs the box first). A PLY is
   read once: its vertex list comes first and is held as float32 - faces are
   indices into it - which is what PLY_STREAM_VERTS_MAX bounds. DOM-free. */
import { MESH_STREAM_CHUNK, MESH_STREAM_PREVIEW_TRIS, PLY_STREAM_VERTS_MAX, MESH_FACE_VERTS_MAX } from '../core/limits.js';
export class MeshStats {
    count = 0;
    min = [Infinity, Infinity, Infinity];
    max = [-Infinity, -Infinity, -Infinity];
    area = 0;
    vol = 0;
    add(ax, ay, az, bx, by, bz, cx, cy, cz) {
        this.count++;
        if (!(isFinite(ax) && isFinite(ay) && isFinite(az) && isFinite(bx) && isFinite(by) && isFinite(bz)
            && isFinite(cx) && isFinite(cy) && isFinite(cz)))
            return;
        const mn = this.min, mx = this.max;
        if (ax < mn[0])
            mn[0] = ax;
        if (bx < mn[0])
            mn[0] = bx;
        if (cx < mn[0])
            mn[0] = cx;
        if (ay < mn[1])
            mn[1] = ay;
        if (by < mn[1])
            mn[1] = by;
        if (cy < mn[1])
            mn[1] = cy;
        if (az < mn[2])
            mn[2] = az;
        if (bz < mn[2])
            mn[2] = bz;
        if (cz < mn[2])
            mn[2] = cz;
        if (ax > mx[0])
            mx[0] = ax;
        if (bx > mx[0])
            mx[0] = bx;
        if (cx > mx[0])
            mx[0] = cx;
        if (ay > mx[1])
            mx[1] = ay;
        if (by > mx[1])
            mx[1] = by;
        if (cy > mx[1])
            mx[1] = cy;
        if (az > mx[2])
            mx[2] = az;
        if (bz > mx[2])
            mx[2] = bz;
        if (cz > mx[2])
            mx[2] = cz;
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const crx = e1y * e2z - e1z * e2y, cry = e1z * e2x - e1x * e2z, crz = e1x * e2y - e1y * e2x;
        this.area += 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
        this.vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
}
export class MeshDecimator {
    cap;
    grid = 1024;
    o;
    span;
    s = 0;
    gy = 1;
    gz = 1;
    gx = 1;
    // Kept triangles as cell triples, in their original winding.
    ta;
    tb;
    tc;
    n = 0;
    // Open-addressed set of sorted cell triples.
    ha;
    hb;
    hc;
    used;
    mask;
    constructor(min, max, cap) {
        this.cap = cap;
        this.o = min.slice();
        this.span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
        this.ta = new Uint32Array(cap);
        this.tb = new Uint32Array(cap);
        this.tc = new Uint32Array(cap);
        let size = 1;
        while (size < cap * 2)
            size *= 2;
        this.mask = size - 1;
        this.ha = new Uint32Array(size);
        this.hb = new Uint32Array(size);
        this.hc = new Uint32Array(size);
        this.used = new Uint8Array(size);
        this.dims(max);
    }
    max = [];
    dims(max) {
        this.max = max;
        this.s = this.span / this.grid;
        this.gx = Math.max(1, Math.ceil((max[0] - this.o[0]) / this.s) + 1);
        this.gy = Math.max(1, Math.ceil((max[1] - this.o[1]) / this.s) + 1);
        this.gz = Math.max(1, Math.ceil((max[2] - this.o[2]) / this.s) + 1);
    }
    cell(x, y, z) {
        let ix = Math.floor((x - this.o[0]) / this.s), iy = Math.floor((y - this.o[1]) / this.s), iz = Math.floor((z - this.o[2]) / this.s);
        ix = ix < 0 ? 0 : ix >= this.gx ? this.gx - 1 : ix;
        iy = iy < 0 ? 0 : iy >= this.gy ? this.gy - 1 : iy;
        iz = iz < 0 ? 0 : iz >= this.gz ? this.gz - 1 : iz;
        return (ix * this.gy + iy) * this.gz + iz;
    }
    // 1 stored, 0 dropped (degenerate or a repeat), -1 the copy is full.
    insert(a, b, c) {
        if (a === b || b === c || a === c)
            return 0;
        let k1 = a, k2 = b, k3 = c, t;
        if (k1 > k2) {
            t = k1;
            k1 = k2;
            k2 = t;
        }
        if (k2 > k3) {
            t = k2;
            k2 = k3;
            k3 = t;
        }
        if (k1 > k2) {
            t = k1;
            k1 = k2;
            k2 = t;
        }
        let h = (Math.imul(k1, 73856093) ^ Math.imul(k2, 19349663) ^ Math.imul(k3, 83492791)) & this.mask;
        while (this.used[h]) {
            if (this.ha[h] === k1 && this.hb[h] === k2 && this.hc[h] === k3)
                return 0;
            h = (h + 1) & this.mask;
        }
        if (this.n >= this.cap)
            return -1;
        this.used[h] = 1;
        this.ha[h] = k1;
        this.hb[h] = k2;
        this.hc[h] = k3;
        this.ta[this.n] = a;
        this.tb[this.n] = b;
        this.tc[this.n] = c;
        this.n++;
        return 1;
    }
    // Halve the grid and re-snap what is kept.
    coarsen() {
        const { gy, gz } = this;
        const down = (id) => {
            const iz = id % gz, r = (id - iz) / gz, iy = r % gy, ix = (r - iy) / gy;
            return [ix >> 1, iy >> 1, iz >> 1];
        };
        this.grid /= 2;
        this.dims(this.max);
        const n = this.n, a = this.ta.slice(0, n), b = this.tb.slice(0, n), c = this.tc.slice(0, n);
        this.used.fill(0);
        this.n = 0;
        const id = (p) => (p[0] * this.gy + p[1]) * this.gz + p[2];
        for (let i = 0; i < n; i++)
            this.insert(id(down(a[i])), id(down(b[i])), id(down(c[i])));
    }
    add(ax, ay, az, bx, by, bz, cx, cy, cz) {
        if (!(isFinite(ax) && isFinite(ay) && isFinite(az) && isFinite(bx) && isFinite(by) && isFinite(bz)
            && isFinite(cx) && isFinite(cy) && isFinite(cz)))
            return;
        for (;;) {
            const r = this.insert(this.cell(ax, ay, az), this.cell(bx, by, bz), this.cell(cx, cy, cz));
            if (r >= 0 || this.grid <= 2)
                return;
            this.coarsen();
        }
    }
    positions() {
        const out = new Float32Array(this.n * 9);
        const { gy, gz, s, o } = this;
        const put = (id, p) => {
            const iz = id % gz, r = (id - iz) / gz, iy = r % gy, ix = (r - iy) / gy;
            out[p] = o[0] + (ix + 0.5) * s;
            out[p + 1] = o[1] + (iy + 0.5) * s;
            out[p + 2] = o[2] + (iz + 0.5) * s;
        };
        for (let i = 0; i < this.n; i++) {
            put(this.ta[i], i * 9);
            put(this.tb[i], i * 9 + 3);
            put(this.tc[i], i * 9 + 6);
        }
        return out;
    }
}
// A window over a Blob that refills in MESH_STREAM_CHUNK slices, keeping the
// unread tail, so a record can always be read whole from `buf` at `off`.
class ByteWindow {
    file;
    buf = new Uint8Array(0);
    dv = new DataView(this.buf.buffer);
    off = 0;
    base;
    constructor(file, start) {
        this.file = file;
        this.base = start;
    }
    get pos() { return this.base + this.off; }
    get eof() { return this.base + this.buf.length >= this.file.size; }
    get left() { return this.buf.length - this.off; }
    async ensure(n) {
        if (this.off + n <= this.buf.length || this.eof)
            return;
        const keep = this.buf.subarray(this.off);
        const from = this.base + this.buf.length;
        const more = new Uint8Array(await this.file.slice(from, from + Math.max(n, MESH_STREAM_CHUNK)).arrayBuffer());
        const next = new Uint8Array(keep.length + more.length);
        next.set(keep);
        next.set(more, keep.length);
        this.base += this.off;
        this.buf = next;
        this.dv = new DataView(next.buffer);
        this.off = 0;
    }
}
// ---------- STL ----------
async function stlIsAscii(file) {
    const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    if (!new TextDecoder('latin1').decode(head).trimStart().startsWith('solid'))
        return false;
    if (head.length < 84)
        return true;
    return 84 + new DataView(head.buffer).getUint32(80, true) * 50 !== file.size;
}
async function eachBinaryStlTri(file, cb, onProgress) {
    const count = new DataView(await file.slice(80, 84).arrayBuffer()).getUint32(0, true);
    const per = Math.floor(MESH_STREAM_CHUNK / 50);
    for (let t = 0; t < count; t += per) {
        const n = Math.min(per, count - t);
        const b = await file.slice(84 + t * 50, 84 + (t + n) * 50).arrayBuffer();
        const dv = new DataView(b);
        const m = Math.floor(b.byteLength / 50);
        for (let i = 0, o = 12; i < m; i++, o += 50) {
            cb(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true), dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true), dv.getFloat32(o + 24, true), dv.getFloat32(o + 28, true), dv.getFloat32(o + 32, true));
        }
        if (m < n)
            break;
        onProgress((t + n) / count);
    }
}
// ASCII STL: the first three `vertex x y z` lines of each `outer loop` make a
// triangle, as the whole-file regex reads them (a loop with fewer is skipped);
// lines are carried across slice edges.
async function eachAsciiStlTri(file, cb, onProgress) {
    const dec = new TextDecoder('latin1');
    const v = [];
    let carry = '', open = false;
    const num = /-?\d+\.?\d*(?:[eE][-+]?\d+)?/g;
    const line = (ln) => {
        const s = ln.trimStart();
        const w = s.slice(0, 6).toLowerCase();
        if (w === 'outer ') {
            open = true;
            v.length = 0;
            return;
        }
        if (w !== 'vertex' || !open)
            return;
        const p = (s.slice(6).match(num) || []);
        v.push(+p[0] || 0, +p[1] || 0, +p[2] || 0);
        if (v.length === 9) {
            cb(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
            v.length = 0;
            open = false;
        }
    };
    for (let off = 0; off < file.size; off += MESH_STREAM_CHUNK) {
        const end = Math.min(file.size, off + MESH_STREAM_CHUNK);
        const text = carry + dec.decode(new Uint8Array(await file.slice(off, end).arrayBuffer()));
        const last = text.lastIndexOf('\n');
        carry = end < file.size ? text.slice(last + 1) : '';
        const body = end < file.size ? text.slice(0, last + 1) : text;
        let a = 0;
        for (let i = body.indexOf('\n'); i >= 0; i = body.indexOf('\n', a)) {
            line(body.slice(a, i));
            a = i + 1;
        }
        if (a < body.length)
            line(body.slice(a));
        onProgress(end / file.size);
    }
}
export async function streamStl(file, onProgress) {
    const ascii = await stlIsAscii(file);
    const each = ascii ? eachAsciiStlTri : eachBinaryStlTri;
    const stats = new MeshStats();
    await each(file, (...t) => stats.add(...t), (f) => onProgress(f, 'Measuring'));
    if (!stats.count || !isFinite(stats.min[0]))
        return null;
    const dec = new MeshDecimator(stats.min, stats.max, MESH_STREAM_PREVIEW_TRIS);
    await each(file, (...t) => dec.add(...t), (f) => onProgress(f, 'Building the preview'));
    return { format: ascii ? 'STL (ASCII)' : 'STL (binary)', stats, positions: dec.positions(), grid: dec.grid };
}
// ---------- PLY ----------
const PLY_SIZE = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
function plyGet(dv, off, t, le) {
    switch (t) {
        case 'char':
        case 'int8': return dv.getInt8(off);
        case 'uchar':
        case 'uint8': return dv.getUint8(off);
        case 'short':
        case 'int16': return dv.getInt16(off, le);
        case 'ushort':
        case 'uint16': return dv.getUint16(off, le);
        case 'int':
        case 'int32': return dv.getInt32(off, le);
        case 'uint':
        case 'uint32': return dv.getUint32(off, le);
        case 'double':
        case 'float64': return dv.getFloat64(off, le);
        default: return dv.getFloat32(off, le);
    }
}
export async function streamPly(file, onProgress) {
    const head = new Uint8Array(await file.slice(0, 1 << 16).arrayBuffer());
    const headStr = new TextDecoder('latin1').decode(head);
    const eh = headStr.indexOf('end_header');
    if (eh < 0)
        return null;
    let dataStart = eh + 'end_header'.length;
    while (dataStart < head.length && head[dataStart] !== 0x0a)
        dataStart++;
    dataStart++;
    let format = 'ascii';
    const elements = [];
    let cur = null;
    for (const ln of headStr.slice(0, eh).split(/\r?\n/)) {
        const t = ln.trim().split(/\s+/);
        if (t[0] === 'format')
            format = t[1];
        else if (t[0] === 'element') {
            cur = { name: t[1], count: +t[2] || 0, props: [] };
            elements.push(cur);
        }
        else if (t[0] === 'property' && cur) {
            if (t[1] === 'list')
                cur.props.push({ name: t[4], isList: true, countType: t[2], valType: t[3] });
            else
                cur.props.push({ name: t[2], isList: false, type: t[1] });
        }
    }
    const vEl = elements.find((e) => e.name === 'vertex');
    const fEl = elements.find((e) => e.name === 'face');
    if (!vEl || !fEl)
        return null;
    if (vEl.count > PLY_STREAM_VERTS_MAX) {
        return { error: 'This PLY has ' + vEl.count.toLocaleString() + ' vertices - more than the ' + PLY_STREAM_VERTS_MAX.toLocaleString() + ' that can be held in memory to draw its faces.' };
    }
    const xi = vEl.props.findIndex((p) => p.name === 'x');
    const yi = vEl.props.findIndex((p) => p.name === 'y');
    const zi = vEl.props.findIndex((p) => p.name === 'z');
    const verts = new Float32Array(vEl.count * 3);
    const stats = new MeshStats();
    let dec = null;
    const vmin = [Infinity, Infinity, Infinity], vmax = [-Infinity, -Infinity, -Infinity];
    const finishVerts = () => {
        for (let i = 0; i < verts.length; i += 3) {
            for (let k = 0; k < 3; k++) {
                const x = verts[i + k];
                if (x < vmin[k])
                    vmin[k] = x;
                if (x > vmax[k])
                    vmax[k] = x;
            }
        }
        dec = new MeshDecimator(vmin, vmax, MESH_STREAM_PREVIEW_TRIS);
    };
    const nv = vEl.count;
    const tri = (a, b, c) => {
        if (a < 0 || b < 0 || c < 0 || a >= nv || b >= nv || c >= nv)
            return;
        const A = a * 3, B = b * 3, C = c * 3;
        stats.add(verts[A], verts[A + 1], verts[A + 2], verts[B], verts[B + 1], verts[B + 2], verts[C], verts[C + 1], verts[C + 2]);
        dec.add(verts[A], verts[A + 1], verts[A + 2], verts[B], verts[B + 1], verts[B + 2], verts[C], verts[C + 1], verts[C + 2]);
    };
    const progress = (pos) => onProgress(pos / file.size, 'Reading');
    if (format === 'ascii') {
        // Tokens carried across slice edges; vertex, then face, then anything else.
        const dec8 = new TextDecoder('latin1');
        let carry = '', ei = 0, done = 0, pi = 0, vx = 0, vy = 0, vz = 0, listLeft = -1;
        const idx = [];
        const order = elements;
        const faceList = fEl.props.findIndex((p) => p.isList);
        const token = (tk) => {
            while (ei < order.length && done >= order[ei].count) {
                ei++;
                done = 0;
                pi = 0;
            }
            const e = order[ei];
            if (!e)
                return false;
            if (e === vEl) {
                const val = +tk;
                if (pi === xi)
                    vx = val;
                else if (pi === yi)
                    vy = val;
                else if (pi === zi)
                    vz = val;
                if (++pi === e.props.length) {
                    verts[done * 3] = vx;
                    verts[done * 3 + 1] = vy;
                    verts[done * 3 + 2] = vz;
                    pi = 0;
                    done++;
                    if (done === e.count)
                        finishVerts();
                }
            }
            else if (e === fEl) {
                // Only the first list property is the vertex index list.
                const p = e.props[pi];
                if (p.isList && listLeft < 0) {
                    listLeft = Math.min(+tk || 0, MESH_FACE_VERTS_MAX);
                    idx.length = 0;
                    if (listLeft === 0) {
                        listLeft = -1;
                        pi++;
                    }
                }
                else if (p.isList) {
                    idx.push(+tk);
                    if (--listLeft === 0) {
                        listLeft = -1;
                        if (pi === faceList) {
                            if (!dec)
                                finishVerts();
                            for (let k = 1; k + 1 < idx.length; k++)
                                tri(idx[0], idx[k], idx[k + 1]);
                        }
                        pi++;
                    }
                }
                else
                    pi++;
                if (pi >= e.props.length) {
                    pi = 0;
                    done++;
                }
            }
            else if (++pi >= e.props.length) {
                pi = 0;
                done++;
            }
            return true;
        };
        outer: for (let off = dataStart; off < file.size; off += MESH_STREAM_CHUNK) {
            const end = Math.min(file.size, off + MESH_STREAM_CHUNK);
            const parts = (carry + dec8.decode(new Uint8Array(await file.slice(off, end).arrayBuffer()))).split(/\s+/);
            carry = end < file.size ? parts.pop() || '' : '';
            for (const tk of parts)
                if (tk && !token(tk))
                    break outer;
            progress(end);
        }
        if (carry)
            token(carry);
    }
    else {
        const le = format !== 'binary_big_endian';
        const w = new ByteWindow(file, dataStart);
        for (const e of elements) {
            if (e === vEl) {
                const rec = e.props.reduce((s, p) => s + (PLY_SIZE[p.type] || 4), 0);
                const offs = [];
                let o = 0;
                for (const p of e.props) {
                    offs.push(o);
                    o += PLY_SIZE[p.type] || 4;
                }
                for (let v = 0; v < e.count;) {
                    await w.ensure(rec);
                    const n = Math.min(e.count - v, Math.floor(w.left / rec));
                    if (n <= 0)
                        break;
                    const dv = w.dv;
                    for (let k = 0, at = w.off; k < n; k++, at += rec, v++) {
                        if (xi >= 0)
                            verts[v * 3] = plyGet(dv, at + offs[xi], e.props[xi].type, le);
                        if (yi >= 0)
                            verts[v * 3 + 1] = plyGet(dv, at + offs[yi], e.props[yi].type, le);
                        if (zi >= 0)
                            verts[v * 3 + 2] = plyGet(dv, at + offs[zi], e.props[zi].type, le);
                    }
                    w.off += n * rec;
                    progress(w.pos);
                }
                finishVerts();
            }
            else if (e === fEl) {
                if (!dec)
                    finishVerts();
                let maxRec = 0;
                for (const p of e.props)
                    maxRec += p.isList ? (PLY_SIZE[p.countType] || 1) + MESH_FACE_VERTS_MAX * (PLY_SIZE[p.valType] || 4) : (PLY_SIZE[p.type] || 4);
                const idx = [];
                let f = 0, lost = false;
                while (f < e.count && !lost) {
                    await w.ensure(maxRec);
                    if (w.left <= 0)
                        break;
                    const dv = w.dv;
                    // Read whole faces while a maximal one still fits (or the file ends).
                    while (f < e.count && (w.left >= maxRec || (w.eof && w.left > 0))) {
                        let first = true;
                        for (const p of e.props) {
                            if (p.isList) {
                                const cs = PLY_SIZE[p.countType] || 1, vs = PLY_SIZE[p.valType] || 4;
                                if (w.left < cs) {
                                    lost = true;
                                    break;
                                }
                                const n = plyGet(dv, w.off, p.countType, le);
                                w.off += cs;
                                if (!(n >= 0) || n > MESH_FACE_VERTS_MAX || w.left < n * vs) {
                                    lost = true;
                                    break;
                                }
                                if (first) {
                                    idx.length = 0;
                                    for (let k = 0; k < n; k++)
                                        idx.push(plyGet(dv, w.off + k * vs, p.valType, le));
                                    for (let k = 1; k + 1 < idx.length; k++)
                                        tri(idx[0], idx[k], idx[k + 1]);
                                    first = false;
                                }
                                w.off += n * vs;
                            }
                            else
                                w.off += PLY_SIZE[p.type] || 4;
                        }
                        f++;
                        if (lost)
                            break;
                    }
                    progress(w.pos);
                }
                break;
            }
            else {
                // Another element before the faces: skippable only with fixed-size records.
                if (e.props.some((p) => p.isList))
                    return { error: 'This PLY stores a "' + e.name + '" element with variable-length records before its faces, which the piece-by-piece reader cannot step over.' };
                const rec = e.props.reduce((s, p) => s + (PLY_SIZE[p.type] || 4), 0);
                let skip = rec * e.count;
                while (skip > 0) {
                    await w.ensure(1);
                    if (w.left <= 0)
                        break;
                    const n = Math.min(skip, w.left);
                    w.off += n;
                    skip -= n;
                }
            }
        }
    }
    if (!dec || !stats.count)
        return null;
    const d = dec;
    return { format: 'PLY', stats, positions: d.positions(), grid: d.grid, vertices: vEl.count };
}
//# sourceMappingURL=mesh-stream.js.map