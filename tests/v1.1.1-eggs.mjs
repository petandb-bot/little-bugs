import assert from 'node:assert/strict';
import {makePixelEgg,makePixelBug} from '../visual.js';

// 卵の輪郭は丸くすぼまる形を保ち、目のような対称的な黒い２点を描かない。
const types=new Set(), colors=new Set(), shapes=new Set();
for(let seed=1;seed<=1000;seed++){
 const egg=makePixelEgg(seed*9817);
 assert.equal(egg.body.length,17);
 assert(egg.body.every(row=>row.length===17));
 assert(egg.accent.every(row=>row.length===17));
 const sum=row=>row.filter(Boolean).length;
 assert(sum(egg.body[0])<sum(egg.body[8]),'Narrower at the top than the middle');
 assert(sum(egg.body[15])<sum(egg.body[10]),'Egg narrows at the base');
 assert(egg.accent.slice(0,4).every(row=>sum(row)===0),'No eye-like features at the top');
 assert(egg.accent.every((row,y)=>row.every((cell,x)=>!cell||egg.body[y][x])),'Shell pattern stays inside');
 assert.deepEqual(makePixelEgg(seed*9817),egg,'Seeded egg is deterministic');
 types.add(egg.style);colors.add(egg.shell+egg.pigment);
 shapes.add(egg.body.map(row=>row.map(p=>p?'#':'.').join('')).join(''));
}
assert.equal(types.size,8,'Eight surface patterns');
assert(colors.size>=8,'Several pastel/toxic color pairings');
assert(shapes.size>=2,'Multiple egg outlines');
assert.notDeepEqual(makePixelBug(45).mask,makePixelEgg(45).body,'Eggs differ from creatures');
for(const seed of [13,45,189,288,719]){
 const bug=makePixelBug(seed);
 assert.notEqual(bug.color,bug.accent,'Creature has two distinct body colors');
 assert(bug.tonePattern>=0&&bug.tonePattern<=2,'Simple two-tone shape variation');
}
console.log('Egg Parade geometry, pattern, color and determinism checks passed.');
