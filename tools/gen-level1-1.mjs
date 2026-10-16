// Generates levels/level1-1.json from docs/design/level1-1.md (Riddler's spec). Units: meters, +y up.
// Run: node tools/gen-level1-1.mjs
import fs from 'fs';
const FX = +(process.env.FX||97.95), FY = +(process.env.FY||2.75); // feather 2: moved from spec (98.5,3.6) to measured tap-jump apex band, see prototype.md
const B = -10; // solid bottom
// Ground surface chains (each chain is a solid piece down to y=B). Gaps are between chains.
const chains = [
  // A..D left: start, hill, step area, up to gap at 47
  [[0,0],[20,0],[26,3],[28,3],[34,0],[40,0],[40,1],[44,1],[47,1]],
  // D pit floor + 2 m-ish exit ramp to the ledge, then E, F, kicker
  [[47,-2],[50,-2],[58,2],[68,2],[78,2],[88,-1],[93,-1],[96,0.5]],
  // G landing, I, J
  [[102,0],[108,0],[133,0],[143,1.5],[158,1.5]],
];
const platforms = []; // H platform removed in 819528b
function surf(x){ for (const c of chains) for (let i=0;i<c.length-1;i++){ const [x1,y1]=c[i],[x2,y2]=c[i+1];
  if (x>=x1 && x<=x2 && x2>x1) return y1+(y2-y1)*(x-x1)/(x2-x1); } return null; }
const drops=[]; const line=(n,a,b,dy=0.8)=>{for(let i=0;i<n;i++){const x=a+(b-a)*(n===1?0:i/(n-1)); drops.push({x:+x.toFixed(2),y:+(surf(x)+dy).toFixed(2)});}};
const arc=(n,a,b,peak,base)=>{for(let i=0;i<n;i++){const t=i/(n-1),x=a+(b-a)*t; const y0=base(x); drops.push({x:+x.toFixed(2),y:+(y0+(peak-y0)*4*t*(1-t)).toFixed(2)});}};
line(10,4,18); line(12,21,33); line(6,35,39.4); for(let i=0;i<4;i++) drops.push({x:40+i,y:2.2});
arc(8,46.5,50.5,3.8,()=>1.8); line(6,54,66); line(6,69,77); line(12,79,92);
arc(10,95,103,3.5,()=>1.2); line(4,103,107); line(10,109,119); arc(4,119.5,122.5,2.6,()=>0.8); line(8,134,151);
const L = {
  id:'1-1', name:'First Puddle', source:'docs/design/level1-1.md', units:'m',
  bounds:{x0:0,x1:158,y0:-6,y1:14}, killY:-12, solidBottom:B,
  spawn:{x:2,y:0.45}, checkpoints:[{id:'N1',x:72,y:2,r:1},{id:'N2',x:112,y:0,r:1}],
  goal:{x:153,y:1.5,w:2,h:3}, chains, platforms,
  hazards:[{type:'thorns',x1:120,x2:122,y:0,h:0.6,inset:0.1}],
  dewdrops:drops, dropRadius:0.35,
  feathers:[{x:31,y:5.5},{x:FX,y:FY,r:0.6},{x:49,y:-1.2}],
  prompts:[{id:'P1',x:3,icon:'drag',text:'Drag left side to roll'},{id:'P2',x:37,icon:'tap',text:'Tap right side to jump'},{id:'P3',x:90,icon:'speed',text:'Keep rolling!'}],
  parTime:75
};
if (drops.length!==100) throw new Error('drop count '+drops.length);
fs.writeFileSync(new URL('../levels/level1-1.json', import.meta.url), JSON.stringify(L,null,1));
console.log('wrote level1-1.json', drops.length,'drops');
