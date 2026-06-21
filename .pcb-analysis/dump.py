import olefile, os, sys, json

SRC = r"C:\Users\Kosta\OneDrive - Flatsoft\Desktop\PCB_Project"
OUT = r"C:\Users\Kosta\Projekti\file analyser\.pcb-analysis\streams"

targets = []
for root, dirs, files in os.walk(SRC):
    for f in files:
        p = os.path.join(root, f)
        if olefile.isOleFile(p):
            targets.append(p)

manifest = {}
for p in targets:
    rel = os.path.relpath(p, SRC).replace("\\", "_").replace(" ", "_")
    ole = olefile.OleFileIO(p)
    streams = ole.listdir(streams=True, storages=False)
    info = []
    for s in streams:
        data = ole.openstream(s).read()
        name = "__".join(s)
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
        odir = os.path.join(OUT, rel)
        os.makedirs(odir, exist_ok=True)
        outp = os.path.join(odir, safe + ".bin")
        with open(outp, "wb") as fh:
            fh.write(data)
        info.append({"stream": s, "bytes": len(data), "file": os.path.basename(outp)})
    manifest[rel] = info
    ole.close()
    print(f"{rel}: {len(streams)} streams")

with open(os.path.join(OUT, "_manifest.json"), "w") as fh:
    json.dump(manifest, fh, indent=2)
print("DONE")
