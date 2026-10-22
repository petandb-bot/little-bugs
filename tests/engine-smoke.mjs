import assert from 'node:assert/strict';
import {makeDna,hatch,mixLayers,wavBlob,RATE} from '../audio-engine.js';
import {createHash} from 'node:crypto';

// 録音を模した母音＋短い打音。完全な音楽サンプルを入力しなくてもループに変異できる。
const sr=RATE,data=new Float32Array(sr*2.8);
for(let i=0;i<data.length;i++){
  const t=i/sr,env=.25+.75*Math.max(0,Math.sin(2*Math.PI*2.3*t));
  data[i]=(.15*Math.sin(2*Math.PI*196*t)+.09*Math.sin(2*Math.PI*294*t)+.04*Math.sin(2*Math.PI*392*t))*env;
}
const input={data,sampleRate:sr,duration:data.length/sr};
const ids=['CHANT','BOUNCE','CHOIR','TAPE'],seeds=new Map();
for(let s=0;s<200&&seeds.size<ids.length;s++){const id=makeDna(s).id;if(!seeds.has(id))seeds.set(id,s);}
assert.equal(seeds.size,ids.length,'Every audio recipe must be reachable');
const digest=ch=>createHash('sha256').update(new Uint8Array(ch.buffer)).digest('hex');
for(const [id,seed] of seeds){
  const a=hatch(input,seed),b=hatch(input,seed);
  assert.equal(a.dna.id,id);
  assert(a.duration>5&&a.duration<10,'Four bars must fit within roughly 6–9 seconds');
  assert.equal(a.voice.left.length,a.groove.left.length);
  assert.equal(a.voice.left.length,a.voice.right.length);
  assert.equal(digest(a.voice.left),digest(b.voice.left),'Voice generation must be deterministic');
  assert.equal(digest(a.groove.left),digest(b.groove.left),'Groove generation must be deterministic');
  const off=mixLayers(a,false),on=mixLayers(a,true);
  assert.equal(digest(off.left),digest(a.voice.left),'GROOVE OFF must preserve voice only');
  assert.notEqual(digest(on.left),digest(off.left),'GROOVE ON must change the loop');
  let peak=0,rms=0,difference=0;
  for(let i=0;i<on.left.length;i++){
    const l=on.left[i],r=on.right[i];
    assert(Number.isFinite(l)&&Number.isFinite(r),'Audio must never produce NaN or Infinity');
    peak=Math.max(peak,Math.abs(l),Math.abs(r));rms+=l*l;
    difference+=Math.abs(l-off.left[i]);
  }
  assert(peak>.04&&peak<=.971,'Mix must be audible without digital clipping');
  assert(rms/on.left.length>.000008,'Mix must have nonzero energy');
  assert(difference/on.left.length>.00001,'GROOVE layer must be audible');
  for(const layer of [a.voice,a.groove])for(const ch of [layer.left,layer.right]){
    assert(Math.abs(ch[0]-ch.at(-1))<.0001,'Loop endpoints must meet');
  }
  const wav=new Uint8Array(await wavBlob(off).arrayBuffer());
  assert.equal(String.fromCharCode(...wav.slice(0,4)),'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8,12)),'WAVE');
  assert.equal(wav.length,44+a.voice.left.length*4);
  assert.equal(new DataView(wav.buffer).getUint32(24,true),RATE);
  console.log(`PASS ${id}: ${a.dna.bpm} BPM / ${a.duration.toFixed(2)} s / peak ${peak.toFixed(2)}`);
}
const silent=hatch({data:new Float32Array(RATE),sampleRate:RATE,duration:1},1234);
assert(silent.voice.left.every(x=>x===0));
assert(silent.groove.left.every(x=>x===0),'No music is added to silent recordings');
console.log('All v0.3 audio tests passed.');
