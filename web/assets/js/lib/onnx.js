/* Analyser - ONNX and TensorFlow GraphDef decoding.

   DOM-free. Both formats are Protocol Buffers, and protobuf's wire format keeps
   no field NAMES: a message on the wire is a run of (field number, wire type,
   value) triples and nothing else. Reading one therefore means knowing what each
   number means, which is what a .proto file is for.

   That is why this hand-decodes rather than vendoring protobuf.js: the library
   alone would not help, because it also needs the compiled ONNX schema, and
   between them that is roughly half a megabyte to recover a field mapping that
   is thirty stable numbers long and has not changed since ONNX 1.0. The wire
   reader below is generic; the field numbers are from onnx.proto3 and
   graph.proto, cited at each message.

   What comes out is a real graph: nodes with their op types and their input and
   output TENSOR NAMES, which is what the edges are made of. An ONNX graph has no
   explicit edge list - node B follows node A because one of B's inputs is one of
   A's outputs - so the connections are recovered by matching those names. */
/* A protobuf wire-format cursor. `each` walks the fields of one message,
   handing back the field number and a reader positioned on its value. */
class Wire {
    buf;
    p;
    end;
    constructor(buf, start = 0, end = buf.length) { this.buf = buf; this.p = start; this.end = end; }
    varint() {
        let shift = 0, v = 0;
        while (this.p < this.end) {
            const b = this.buf[this.p++];
            // Above 2^53 a JS number stops being exact. Nothing here (field numbers,
            // lengths, dimensions, versions) goes near that, and the alternative is a
            // BigInt per varint, so the shift is done in floating point deliberately.
            v += (b & 0x7f) * Math.pow(2, shift);
            shift += 7;
            if (!(b & 0x80))
                break;
        }
        return v;
    }
    skip(wire) {
        if (wire === 0)
            this.varint();
        else if (wire === 1)
            this.p += 8;
        else if (wire === 5)
            this.p += 4;
        else if (wire === 2) {
            const n = this.varint();
            this.p += n;
        }
        else
            this.p = this.end; // groups: unsupported, stop
    }
    bytes() {
        const n = this.varint();
        const start = this.p;
        this.p = Math.min(this.end, start + n);
        return this.buf.subarray(start, this.p);
    }
    str() { return new TextDecoder('utf-8', { fatal: false }).decode(this.bytes()); }
    f32() { const dv = new DataView(this.buf.buffer, this.buf.byteOffset + this.p, 4); this.p += 4; return dv.getFloat32(0, true); }
    atEnd() { return this.p >= this.end; }
}
// Walk one message, calling `fn(fieldNumber, wireType, cursor)`. The callback
// must consume the value or call `skip`; `each` does neither for it.
function each(w, fn) {
    while (!w.atEnd()) {
        const key = w.varint();
        const field = key >> 3, wire = key & 7;
        if (!field)
            break;
        const before = w.p;
        if (fn(field, wire, w) !== true) {
            if (w.p === before)
                w.skip(wire);
        }
        if (w.p <= before && wire !== 0)
            break; // no progress - malformed
    }
}
const sub = (w) => { const b = w.bytes(); return new Wire(b, 0, b.length); };
// onnx.proto3 TensorProto.DataType
const DTYPE = {
    1: 'float32', 2: 'uint8', 3: 'int8', 4: 'uint16', 5: 'int16', 6: 'int32',
    7: 'int64', 8: 'string', 9: 'bool', 10: 'float16', 11: 'float64',
    12: 'uint32', 13: 'uint64', 14: 'complex64', 15: 'complex128', 16: 'bfloat16',
};
const dimProduct = (dims) => dims.every((d) => typeof d === 'number') ? dims.reduce((a, b) => a * b, 1) : 0;
// ValueInfoProto: 1 name, 2 type. TypeProto: 1 tensor_type.
// TypeProto.Tensor: 1 elem_type, 2 shape. TensorShapeProto: 1 dim.
// Dimension: 1 dim_value (int64), 2 dim_param (string, e.g. "batch_size").
function readValueInfo(w) {
    const t = { name: '', dtype: '', dims: [], params: 0 };
    each(w, (f, wire, c) => {
        if (f === 1 && wire === 2) {
            t.name = c.str();
            return true;
        }
        if (f === 2 && wire === 2) {
            each(sub(c), (tf, tw, tc) => {
                if (tf !== 1 || tw !== 2)
                    return;
                each(sub(tc), (ttf, ttw, ttc) => {
                    if (ttf === 1 && ttw === 0) {
                        t.dtype = DTYPE[ttc.varint()] || 'unknown';
                        return true;
                    }
                    if (ttf === 2 && ttw === 2) {
                        each(sub(ttc), (sf, sw, sc) => {
                            if (sf !== 1 || sw !== 2)
                                return;
                            each(sub(sc), (df, dw, dc) => {
                                if (df === 1 && dw === 0) {
                                    t.dims.push(dc.varint());
                                    return true;
                                }
                                if (df === 2 && dw === 2) {
                                    t.dims.push(dc.str());
                                    return true;
                                }
                            });
                        });
                        return true;
                    }
                });
            });
            return true;
        }
    });
    t.params = dimProduct(t.dims);
    return t;
}
// TensorProto: 1 dims (repeated int64), 2 data_type, 8 name.
function readTensor(w) {
    const t = { name: '', dtype: '', dims: [], params: 0 };
    each(w, (f, wire, c) => {
        if (f === 1 && wire === 0) {
            t.dims.push(c.varint());
            return true;
        }
        if (f === 1 && wire === 2) { // packed dims
            const inner = sub(c);
            while (!inner.atEnd())
                t.dims.push(inner.varint());
            return true;
        }
        if (f === 2 && wire === 0) {
            t.dtype = DTYPE[c.varint()] || 'unknown';
            return true;
        }
        if (f === 8 && wire === 2) {
            t.name = c.str();
            return true;
        }
    });
    t.params = dimProduct(t.dims);
    return t;
}
// AttributeProto: 1 name, 2 f (float), 3 i (int64), 4 s (bytes),
// 7 floats, 8 ints. Summarised as "name=value" for display only.
function readAttr(w) {
    let name = '', value = '';
    each(w, (f, wire, c) => {
        if (f === 1 && wire === 2) {
            name = c.str();
            return true;
        }
        if (f === 2 && wire === 5) {
            value = String(Math.round(c.f32() * 1e6) / 1e6);
            return true;
        }
        if (f === 3 && wire === 0) {
            value = String(c.varint());
            return true;
        }
        if (f === 4 && wire === 2) {
            const s = c.str();
            value = s.length < 40 ? s : s.slice(0, 40) + '…';
            return true;
        }
        if (f === 8 && wire === 2) {
            const inner = sub(c);
            const nums = [];
            while (!inner.atEnd() && nums.length < 8)
                nums.push(inner.varint());
            value = '[' + nums.join(', ') + ']';
            return true;
        }
    });
    return name ? name + (value ? '=' + value : '') : '';
}
// NodeProto: 1 input, 2 output, 3 name, 4 op_type, 5 attribute, 7 domain.
function readNode(w, index) {
    const n = { index, name: '', op: '', inputs: [], outputs: [], attrs: [] };
    each(w, (f, wire, c) => {
        if (wire !== 2)
            return;
        if (f === 1) {
            n.inputs.push(c.str());
            return true;
        }
        if (f === 2) {
            n.outputs.push(c.str());
            return true;
        }
        if (f === 3) {
            n.name = c.str();
            return true;
        }
        if (f === 4) {
            n.op = c.str();
            return true;
        }
        if (f === 5) {
            const a = readAttr(sub(c));
            if (a)
                n.attrs.push(a);
            return true;
        }
    });
    return n;
}
// GraphProto: 1 node, 2 name, 5 initializer, 11 input, 12 output.
function readGraph(w, nodeMax) {
    const g = { name: '', nodes: [], inputs: [], outputs: [], initializers: [], truncated: false };
    each(w, (f, wire, c) => {
        if (wire !== 2)
            return;
        if (f === 1) {
            if (g.nodes.length >= nodeMax) {
                g.truncated = true;
                c.bytes();
                return true;
            }
            g.nodes.push(readNode(sub(c), g.nodes.length));
            return true;
        }
        if (f === 2) {
            g.name = c.str();
            return true;
        }
        if (f === 5) {
            g.initializers.push(readTensor(sub(c)));
            return true;
        }
        if (f === 11) {
            g.inputs.push(readValueInfo(sub(c)));
            return true;
        }
        if (f === 12) {
            g.outputs.push(readValueInfo(sub(c)));
            return true;
        }
    });
    return g;
}
/** Decode an ONNX ModelProto. Returns null if it does not look like one. */
export function parseOnnxModel(bytes, nodeMax = 20000) {
    const m = {
        irVersion: null, producer: '', producerVersion: '', domain: '', modelVersion: '',
        docString: '', opsets: [], metadata: [], graph: null,
    };
    try {
        each(new Wire(bytes), (f, wire, c) => {
            if (f === 1 && wire === 0) {
                m.irVersion = c.varint();
                return true;
            }
            if (f === 5 && wire === 0) {
                m.modelVersion = String(c.varint());
                return true;
            }
            if (wire !== 2)
                return;
            if (f === 2) {
                m.producer = c.str();
                return true;
            }
            if (f === 3) {
                m.producerVersion = c.str();
                return true;
            }
            if (f === 4) {
                m.domain = c.str();
                return true;
            }
            if (f === 6) {
                m.docString = c.str();
                return true;
            }
            if (f === 7) {
                m.graph = readGraph(sub(c), nodeMax);
                return true;
            }
            if (f === 8) { // OperatorSetIdProto
                let domain = '', version = 0;
                each(sub(c), (of_, ow, oc) => {
                    if (of_ === 1 && ow === 2) {
                        domain = oc.str();
                        return true;
                    }
                    if (of_ === 2 && ow === 0) {
                        version = oc.varint();
                        return true;
                    }
                });
                m.opsets.push({ domain: domain || 'ai.onnx', version });
                return true;
            }
            if (f === 14) { // StringStringEntryProto
                let k = '', v = '';
                each(sub(c), (mf, mw, mc) => {
                    if (mf === 1 && mw === 2) {
                        k = mc.str();
                        return true;
                    }
                    if (mf === 2 && mw === 2) {
                        v = mc.str();
                        return true;
                    }
                });
                if (k)
                    m.metadata.push([k, v]);
                return true;
            }
        });
    }
    catch (_) {
        return m.graph || m.producer ? m : null;
    }
    if (m.irVersion == null && !m.graph && !m.producer)
        return null;
    return m;
}
export function parseTfGraphDef(bytes, nodeMax = 20000) {
    const g = { nodes: [], truncated: false };
    try {
        each(new Wire(bytes), (f, wire, c) => {
            if (f !== 1 || wire !== 2)
                return;
            if (g.nodes.length >= nodeMax) {
                g.truncated = true;
                c.bytes();
                return true;
            }
            const n = { index: g.nodes.length, name: '', op: '', inputs: [], outputs: [], attrs: [] };
            each(sub(c), (nf, nw, nc) => {
                if (nw !== 2)
                    return;
                if (nf === 1) {
                    n.name = nc.str();
                    return true;
                }
                if (nf === 2) {
                    n.op = nc.str();
                    return true;
                }
                if (nf === 3) {
                    n.inputs.push(nc.str());
                    return true;
                }
            });
            // A NodeDef names itself rather than its outputs; other nodes refer to it
            // by that name, so it is its own output as far as the edges are concerned.
            if (n.name)
                n.outputs.push(n.name);
            if (n.op)
                g.nodes.push(n);
            return true;
        });
    }
    catch (_) { /* return what was read */ }
    return g.nodes.length ? g : null;
}
//# sourceMappingURL=onnx.js.map