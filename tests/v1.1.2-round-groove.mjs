import assert from 'node:assert/strict';
import {makePixelEgg,EGG_SHAPES} from '../visual.js';
import {planToyMusic,renderToyMusic} from '../music-fx.js';
import {createHash} from 'node:crypto';

// 形の差が偶然ではなく6種類のユニークな輪郭として識別できること。
assert.equal(EGG_SHAPES.length,6);
const shapes=new Set(), palette=new Set();
for(let seed=0;seed<1500;seed++){
 const egg=makePixelEgg(seed*31+9);
 shapes.add(egg.shapeName);
 palette.add(egg.shell);
 const counts=egg.body.map(row=>row.filter(Boolean).length);
 assert(counts[8]>=counts[0]+7);
 assert(counts[8]>counts[16]);
 assert(counts.every((c,i)=>c===EGG_SHAPES[egg.shapeIndex].widths[i]));
 assert(egg.accent.every((row,y)=>row.every((cell,x)=>!cell||egg.body[y][x])));
 assert.deepEqual(egg,makePixelEgg(seed*31+9));
}
assert.equal(shapes.size,6);
assert(palette.size>=9);

// GROOVEの主流（既存のSUS/PENTA）は温存し、ときどきHOUSEが現れる。
const dna={bpm:132};
const onsets=[{time:.35,end:1.1,duration:.75,gain:.9}];
const modes={HOUSE:0,SUS:0,PENTA:0};
for(let seed=0;seed<400;seed++){
 const plan=planToyMusic(onsets,dna,seed,7.3,175);
 assert(plan.mode in modes);
 modes[plan.mode]++;
 assert(plan.events.every(e=>e.time>=0 && e.time<7.3 && e.frequency>95));
 const voices=plan.events.filter(e=>e.kind==='bass');
 const accents=plan.events.filter(e=>e.kind==='pluck');
 if(plan.mode==='HOUSE'){
  assert(voices.length>=16,'House should have a regularly pulsing bass');
  assert(accents.length===8,'House includes eight offbeat synth accents');
  assert(plan.events.filter(e=>e.kind==='pad').length===8);
 } else assert(voices.length===4,'Original accompaniment still available');
 const gro=renderToyMusic(plan,7.3,seed);
 assert(gro.left.every(Number.isFinite)&&gro.right.every(Number.isFinite));
}
assert(modes.HOUSE>=65&&modes.HOUSE<=130,`House frequency is occasional: ${modes.HOUSE}/400`);
assert(modes.SUS>=110 && modes.PENTA>=110,'Original styles remain common');
console.log('PASS round eggs and GROOVE mix',modes);
