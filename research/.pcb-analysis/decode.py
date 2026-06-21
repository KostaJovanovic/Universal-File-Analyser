import os, struct, re

ROOT = r"C:\Users\Kosta\Projekti\file analyser\.pcb-analysis\streams"
OUTROOT = r"C:\Users\Kosta\Projekti\file analyser\.pcb-analysis\decoded"

def parse_records(d):
    """Try Altium length-prefixed framing. Return list of payload bytes or None."""
    recs = []
    off = 0
    while off + 4 <= len(d):
        ln = struct.unpack('<I', d[off:off+4])[0]
        # high byte sometimes a layer flag in some streams; mask to 24-bit if absurd
        if ln == 0:
            off += 4
            continue
        if off + 4 + ln > len(d):
            # framing broke; bail
            if not recs:
                return None
            break
        recs.append(d[off+4:off+4+ln])
        off += 4 + ln
    return recs if recs else None

def pretty(payload):
    # pipe-delimited ascii records
    try:
        txt = payload.decode('latin-1')
    except Exception:
        return None
    if '|' in txt and '=' in txt:
        parts = [p for p in txt.split('|') if p]
        return '\n'.join(parts)
    return None

def strings(d, minlen=4):
    out = []
    cur = []
    for b in d:
        if 32 <= b < 127:
            cur.append(chr(b))
        else:
            if len(cur) >= minlen:
                out.append(''.join(cur))
            cur = []
    if len(cur) >= minlen:
        out.append(''.join(cur))
    return out

for root, dirs, files in os.walk(ROOT):
    for f in files:
        if not f.endswith('.bin'):
            continue
        p = os.path.join(root, f)
        d = open(p, 'rb').read()
        if len(d) <= 4:
            continue
        rel = os.path.relpath(p, ROOT)
        outp = os.path.join(OUTROOT, rel[:-4] + '.txt')
        os.makedirs(os.path.dirname(outp), exist_ok=True)
        lines = []
        recs = parse_records(d)
        decoded_any = False
        if recs:
            for i, r in enumerate(recs):
                pr = pretty(r)
                if pr:
                    lines.append(f"--- record {i} ({len(r)} bytes) ---")
                    lines.append(pr)
                    decoded_any = True
                else:
                    ss = strings(r)
                    if ss:
                        lines.append(f"--- record {i} ({len(r)} bytes) [binary, strings] ---")
                        lines.append('\n'.join(ss))
        if not decoded_any and not lines:
            ss = strings(d)
            lines.append(f"[raw binary, {len(d)} bytes, strings dump]")
            lines.append('\n'.join(ss))
        open(outp, 'w', encoding='utf-8').write('\n'.join(lines))
        print(f"{rel} -> {len(recs) if recs else 0} recs")

print("DONE")
