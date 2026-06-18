import { readFileSync } from 'fs';
import { _internal } from '../assets/js/lib/sevenzip.js';
const hdr = new Uint8Array(readFileSync(new URL('./hdr.bin', import.meta.url)));
const oracle = JSON.parse(readFileSync(new URL('./oracle.json', import.meta.url)));
const model = _internal.parseHeader(hdr);
const got = model.entries;
console.log('parsed entries:', got.length, 'oracle:', oracle.length);
let mism = 0, sizeMism = 0, dirMism = 0;
for (let i = 0; i < Math.max(got.length, oracle.length); i++) {
  const g = got[i], o = oracle[i];
  if (!g || !o) { console.log('LEN mismatch at', i); mism++; if (mism>5) break; continue; }
  if (g.name !== o.name) { if (mism<5) console.log('NAME', i, JSON.stringify(g.name), '!=', JSON.stringify(o.name)); mism++; }
  if (!!g.isDir !== !!o.dir) { if (dirMism<5) console.log('DIR', i, g.name, g.isDir, '!=', o.dir); dirMism++; }
  if ((g.size||0) !== (o.size||0)) { if (sizeMism<5) console.log('SIZE', i, g.name, g.size, '!=', o.size); sizeMism++; }
}
const totGot = got.reduce((a,e)=>a+(e.size||0),0);
const totOra = oracle.reduce((a,e)=>a+(e.size||0),0);
console.log('name mismatches:', mism, 'dir mismatches:', dirMism, 'size mismatches:', sizeMism);
console.log('total size got:', totGot, 'oracle:', totOra, totGot===totOra?'OK':'DIFF');
const realFiles = got.filter(e=>!e.isDir).length;
console.log('non-dir entries:', realFiles);
console.log('sample first 3 real-with-stream:', got.filter(e=>e.hasStream).slice(0,3).map(e=>[e.name,e.size,e.folderIndex,e.offset]));
