import assert from 'node:assert/strict';
import {makePixelBug} from '../visual.js';
import {bugName} from '../bug-names.js';
import {seamlessRepeatSample, applyStepMutations} from '../music-fx.js';

// 小さなドットでも輪郭が互いに異なり、顔を描き込みすぎていないこと。
const species=new Set(),poses=new Set(),shapes=new Set(),names=new Set();
for(let seed=0;seed<500;seed++){
  const b=makePixelBug(seed*1009+17);
  species.add(b.species);poses.add(b.motion);
  assert.equal(b.mask.length,17);
  assert(b.mask.every(row=>row.length===17));
  const solids=b.mask.flat().filter(Boolean).length;
  assert(solids>22&&solids<240,`Body must stay readable: ${solids}`);
  shapes.add(b.mask.map(row=>row.map(v=>v?'#':'.').join('')).join(''));
  const name=bugName(seed*1009+17);
  assert(/^[A-Z]{4,12}$/.test(name),`Pixel-font-safe name: ${name}`);
  names.add(name);
  assert.equal(bugName(seed*1009+17),name);
}
assert.equal(species.size,14,'14 distinct body types');
assert.equal(shapes.size,14,'14 unique silhouettes');
assert.equal(poses.size,8,'Eight personality motions');
assert(names.size>350,'Names should be genuinely varied');

// 意図的に片端が不連続になる声の断片を入力し、反復点のクリックを比較。
const cell=2200, overlap=400, period=cell-overlap,src=new Float32Array(cell+100);
for(let i=0;i<src.length;i++){
  src[i]=.6*Math.sin(i*2*Math.PI/91)+.17*Math.sin(i*2*Math.PI/23);
}
let before=0,after=0;
for(let k=1;k<8;k++){
  const t=k*period;
  const naivePrev=src[(t-1)%cell],naiveNext=src[t%cell];
  const smoothPrev=seamlessRepeatSample(src,0,t-1,cell,overlap);
  const smoothNext=seamlessRepeatSample(src,0,t,cell,overlap);
  before=Math.max(before,Math.abs(naivePrev-naiveNext));
  after=Math.max(after,Math.abs(smoothPrev-smoothNext));
}
assert(after<.07,`Crossfaded seams have no abrupt clicks: ${after}`);
assert(after<before*.3,`Repeat jumps reduced: ${after} vs ${before}`);

// 悪条件の大振幅パルスから、スタッターが正常な範囲に留まるか検証。
let verified=false;
for(let seed=1;seed<300&&!verified;seed++){
 const n=44100*2,layer={left:new Float32Array(n),right:new Float32Array(n)};
 for(let i=0;i<n;i++){
  const t=i/44100,carrier=Math.sin(t*2*Math.PI*230)*.43;
  const pulse=(i%2100)<65?.76:0;
  const v=(t>.15&&t<1.8)?carrier+pulse:0;
  layer.left[i]=v;layer.right[i]=v;
 }
 const actions=applyStepMutations(layer,{bpm:130,id:'BROKEN'},seed,[
  {time:.16,end:.72,duration:.56,gain:.9},{time:.75,end:1.6,duration:.85,gain:.9}
 ]);
 if(!actions.some(a=>a.type==='stutter'))continue;
 verified=true;
 assert(layer.left.every(Number.isFinite),'No invalid audio values');
 const max=Math.max(...Array.from({length:220},(_,i)=>Math.abs(layer.left[Math.floor(i/220*n)])));
 assert(max<1.7,`Repeat peaks contained ${max}`);
}
assert(verified,'Stutter action tested');
console.log('PASS v1.1 micro-pets, names and crossfaded beat repeat');
