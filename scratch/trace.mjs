import fs from 'fs';
let src = fs.readFileSync('assets/js/renderers/gcode.js','utf8');
src = src.replace(/import\s+\{[^}]*\}\s+from\s+'[^']*util\.js';/, '');
const idx = src.indexOf('function buildViewer');
src = src.slice(0, idx) + '\nexport { parseGcode };\n';
fs.writeFileSync('scratch/gcode-core.mjs', src);
const { parseGcode } = await import('./gcode-core.mjs');
const text = fs.readFileSync('C:/Users/Kosta/OneDrive - Flatsoft/Desktop/3DBenchy_PLA_4h25m.gcode','utf8');
const d = parseGcode(text, {});
console.log('mode', d.mode, 'segCount', d.segCount, 'travelCount', d.travelCount, 'orderCount', d.orderCount, 'pauseCount', d.pauseCount);
// walk first N order entries, reconstruct head endpoints
let gExt=0,gTrav=0,gP=0;
const seg=d.seg, trav=d.travel;
let prevEnd=null;
for (let g=0; g<Math.min(d.orderCount, 22); g++){
  const o=d.order[g];
  if (o>1.5){ const pi=gP++; const inf=d.pauseInfo[pi]; console.log(g, 'PAUSE', inf.label, 'hold', d.pauses[pi]); continue; }
  if (o>0.5){ const p=gTrav*7; const a=[trav[p],trav[p+1],trav[p+2]], b=[trav[p+3],trav[p+4],trav[p+5]]; 
    const jump = prevEnd? Math.hypot(a[0]-prevEnd[0],a[1]-prevEnd[1],a[2]-prevEnd[2]):0;
    console.log(g,'TRAVEL', a.map(n=>n.toFixed(2)).join(','), '->', b.map(n=>n.toFixed(2)).join(','), jump>0.01?('  <-- DISCONT '+jump.toFixed(2)):''); prevEnd=b; gTrav++; }
  else { const p=gExt*10; const a=[seg[p],seg[p+1],seg[p+2]], b=[seg[p+3],seg[p+4],seg[p+5]];
    const jump = prevEnd? Math.hypot(a[0]-prevEnd[0],a[1]-prevEnd[1],a[2]-prevEnd[2]):0;
    console.log(g,'EXTRUDE', a.map(n=>n.toFixed(2)).join(','), '->', b.map(n=>n.toFixed(2)).join(','), jump>0.01?('  <-- DISCONT '+jump.toFixed(2)):''); prevEnd=b; gExt++; }
}
