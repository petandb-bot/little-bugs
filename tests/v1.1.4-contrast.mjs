import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FX_IDENTITIES,makeDna,hatch,mixLayers,wavBlob,applySelectiveCrush,RATE} from '../audio-engine.js';

// 高低の音節、子音的なアタック、間を備えた声風の信号を用意する。
// 実録音の聴感テストの代わりではなく、内部の条件とオーディオの安全性を検査。
const sr=44100,data=new Float32Array(sr*3.8);
for(let i=0;i<data.length;i++){
  const t=i/sr;
  for(const [a,b,f] of [[.15,.82,178],[1.10,1.88,197],[2.18,3.12,161]]){
    if(t<a||t>b)continue;
    const e=Math.min(1,(t-a)*26,(b-t)*25);
    const consonant=t-a<.045?Math.sin(2*Math.PI*3200*t)*.06:0;
    data[i]+=e*(.17*Math.sin(2*Math.PI*f*t)+.06*Math.sin(4*Math.PI*f*t)+consonant);
  }
}
const input={data,sampleRate:sr,duration:data.length/sr};
const hash=x=>createHash('sha256').update(new Uint8Array(x.buffer,x.byteOffset,x.byteLength)).digest('hex');
const modes=FX_IDENTITIES.map(x=>x.id);
assert.deepEqual(modes,['ALIEN','CUTUP','FILTER','CRUSH','CRYSTAL','ECHO']);
assert.equal(FX_IDENTITIES.reduce((acc,x)=>acc+x.weight,0),100);
const heard=new Set(),seeds=[3432,4578,96234,12983,62431,81727];
let firstGrooveHash='';
for(let j=0;j<modes.length;j++){
  const fx=modes[j],seed=seeds[j];
  const result=hatch(input,seed,'PHRASE',fx);
  assert.equal(result.analysis.fxIdentity,fx);
  assert.equal(result.dna.fxIdentity,fx);
  assert.equal(result.dna.id,'PHRASE');
  assert(Number.isFinite(result.analysis.fxHits));
  assert(result.analysis.fxHits>0,`${fx}: must audibly modify at least one event`);
  if(fx==='ECHO')assert(['PING-PONG','DUB-SKIP','WOBBLE-TAPE','GHOST-TAPS','SHORT-SLAP','SHORT-EIGHTH','SHORT-DOTTED'].includes(result.analysis.echoMode));
  else assert(!['PING-PONG','DUB-SKIP','WOBBLE-TAPE','GHOST-TAPS','SHORT-SLAP','SHORT-EIGHTH','SHORT-DOTTED'].includes(result.analysis.echoMode),`${fx}: no global echo`);
  if(fx==='ALIEN')assert.equal(result.analysis.echoMode,'DRY-ALIEN');
  if(fx==='CRUSH')assert.equal(result.analysis.echoMode,'DRY-CRUSH');
  assert(result.voice.left.every(Number.isFinite));
  const dry=mixLayers(result,false),wet=mixLayers(result,true);
  assert(dry.left.some(x=>x!==0));
  assert(wet.left.every(Number.isFinite) && wet.right.every(Number.isFinite));
  assert(Math.max(...[...wet.left.filter((_,i)=>i%157===0)].map(Math.abs))<=.971);
  const same=hatch(input,seed,'PHRASE',fx);
  assert.equal(hash(result.voice.left),hash(same.voice.left),'Voice repeatable for each seed');
  assert.equal(hash(result.groove.left),hash(same.groove.left),'GROOVE repeatable for each seed');
  heard.add(hash(result.voice.left));
  const wav=new Uint8Array(await wavBlob(wet).arrayBuffer());
  assert.equal(String.fromCharCode(...wav.slice(0,4)),'RIFF');
  console.log(`PASS ${fx.padEnd(7)} — ${result.analysis.fxHits} actions, ${result.analysis.echoMode}`);
}
assert.equal(heard.size,6,'Six identities sound different with same recorded voice');
const counts=Object.fromEntries(modes.map(x=>[x,0]));
for(let seed=0;seed<800;seed++)counts[makeDna(seed).fxIdentity]++;
assert(Object.values(counts).every(x=>x>40),'All FX identities reachable');
assert(counts.ALIEN>counts.ECHO,'Dry alien frequency higher than echo');

// 量子化が指定された区間以外に波及しないことを確認する。
const n=RATE*2,layer={left:new Float32Array(n),right:new Float32Array(n)};
for(let i=0;i<n;i++){
  layer.left[i]=.20*Math.sin(i/RATE*2*Math.PI*230);
  layer.right[i]=layer.left[i];
}
const before=layer.left.slice();
const changed=applySelectiveCrush(layer,{seed:176,bpm:120},[{time:.3,end:1.3,duration:1,gain:.8}]);
assert(changed>=1);
assert.notEqual(hash(layer.left),hash(before));
assert(Math.max(...[...layer.left.filter((_,i)=>i%109===0)].map(Math.abs))<.4,'Crush never spikes');
console.log('Sonic contrast and short-delay behavior verified.',counts);
