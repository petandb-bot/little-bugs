import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makeDna,hatch,mixLayers,wavBlob,RATE} from '../audio-engine.js';

// 複数の母音と短い破裂音を想定したテスト入力。リアルマイクなしで決定性を検査。
const inputData=new Float32Array(RATE*3);
for(let i=0;i<inputData.length;i++){
  const t=i/RATE,syllable=Math.floor(t*3.2),env=.05+.72*Math.max(0,Math.sin(2*Math.PI*3.2*t));
  const freq=160+((syllable*37)%155);
  inputData[i]=(Math.sin(2*Math.PI*freq*t)*.15+Math.sin(2*Math.PI*freq*2*t)*.06)*env;
}
const input={data:inputData,sampleRate:RATE,duration:3};
const ids=['RAP','SPELL','MANTRA','SING','BOUNCE','MUTANT'];
const seeds=new Map();
for(let seed=0;seed<300&&seeds.size<ids.length;seed++){
  const id=makeDna(seed).id;if(!seeds.has(id))seeds.set(id,seed);
}
assert.equal(seeds.size,ids.length,'All six audio recipes must be reachable');
const hash=a=>createHash('sha256').update(new Uint8Array(a.buffer)).digest('hex');
for(const [id,seed] of seeds){
  const first=hatch(input,seed),repeat=hatch(input,seed);
  assert.equal(first.dna.id,id);
  assert(first.duration>5.4&&first.duration<12.1,'Four-bar loops should have practical durations');
  assert.equal(hash(first.voice.left),hash(repeat.voice.left),'Voice output must match its seed');
  assert.equal(hash(first.groove.left),hash(repeat.groove.left),'Accompaniment must match its seed');
  const dry=mixLayers(first,false),wet=mixLayers(first,true);
  assert.equal(hash(dry.left),hash(first.voice.left),'GROOVE OFF must preserve the voice');
  assert.notEqual(hash(wet.left),hash(dry.left),'GROOVE ON should add sound');
  let peak=0,sum=0,gain=0;
  for(let i=0;i<wet.left.length;i++){
    const a=wet.left[i],b=wet.right[i];
    assert(Number.isFinite(a)&&Number.isFinite(b));
    peak=Math.max(peak,Math.abs(a),Math.abs(b));sum+=a*a;
    gain+=Math.abs(wet.left[i]-dry.left[i]);
  }
  assert(peak>.04&&peak<=.971,'No clipping');
  assert(sum/wet.left.length>.00001,'Foreground voice must be audible');
  assert(gain/wet.left.length>.000005,'Backing should be faint but present');
  for(const l of [first.voice,first.groove])for(const c of [l.left,l.right])
    assert(Math.abs(c[0]-c.at(-1))<.0001,'Loop edges should connect');
  const wav=new Uint8Array(await wavBlob(wet).arrayBuffer());
  assert.equal(String.fromCharCode(...wav.slice(0,4)),'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8,12)),'WAVE');
  assert.equal(wav.length,44+wet.left.length*4);
  console.log(`PASS ${id}: ${first.dna.bpm}BPM / ${first.duration.toFixed(2)}s / peak ${peak.toFixed(2)}`);
}
const empty=hatch({data:new Float32Array(RATE),sampleRate:RATE,duration:1},1234);
assert(empty.voice.left.every(x=>x===0));
assert(empty.groove.left.every(x=>x===0));
const short=hatch({data:inputData.slice(0,Math.round(RATE*.3)),sampleRate:RATE,duration:.3},786);
assert(short.voice.left.every(Number.isFinite),'Short recordings must not produce NaN');
console.log('All v0.4 audio checks passed.');
