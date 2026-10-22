import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hatch,makeDna,mixLayers,wavBlob,RATE} from '../audio-engine.js';

// 音節、母音、破裂音を持つ模擬音声。マイクやネットワークに依存せず再現できる。
const inputData=new Float32Array(RATE*3);
let seed=137;const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/4294967296)*2-1;};
for(let i=0;i<inputData.length;i++){
  const t=i/RATE,syl=Math.floor(t*4.1),frac=(t*4.1)%1;
  const env=frac<.055?frac/.055:Math.exp(-(frac-.055)*2.3);
  const voiced=(Math.sin(2*Math.PI*(155+syl%4*22)*t)+.37*Math.sin(2*Math.PI*(310+syl%4*44)*t));
  inputData[i]=(voiced*.17+noise()*(frac<.13?.13:.018))*env;
}
const input={data:inputData,sampleRate:RATE,duration:3};
const ids=['BEATBOX','RAP','CHANT','SPELL','SING','BREAK'];
const seeds=new Map();
for(let s=0;s<1000&&seeds.size<ids.length;s++){const id=makeDna(s).id;if(!seeds.has(id))seeds.set(id,s);}
assert.equal(seeds.size,ids.length);
const hash=a=>createHash('sha256').update(new Uint8Array(a.buffer)).digest('hex');
const rms=(audio)=>{
  let sum=0;for(let i=0;i<audio.left.length;i++){sum+=audio.left[i]**2+audio.right[i]**2;}
  return Math.sqrt(sum/(audio.left.length*2));
};
for(const [id,s] of seeds){
  const a=hatch(input,s),same=hatch(input,s);
  assert.equal(a.dna.id,id);
  assert(a.duration>6 && a.duration<11.2);
  assert.equal(hash(a.voice.left),hash(same.voice.left),'Repeatable per seed');
  assert.equal(hash(a.groove.left),hash(same.groove.left),'Groove repeatable');
  const dry=mixLayers(a,false),wet=mixLayers(a,true);
  assert.equal(hash(dry.left),hash(a.voice.left));
  assert.notEqual(hash(wet.left),hash(dry.left));
  const groRms=rms(a.groove),voiceRms=rms(a.voice);
  assert(voiceRms>.025 && voiceRms<.45,`Voice audible: ${voiceRms}`);
  assert(groRms/voiceRms>.22 && groRms/voiceRms<.85,`GROOVE perceptible without dominance: ${groRms/voiceRms}`);
  for(const channel of [wet.left,wet.right]){
    assert(channel.every(Number.isFinite),'No invalid samples');
    const peak=channel.reduce((m,x)=>Math.max(m,Math.abs(x)),0);
    assert(peak<=.971,'Peak clipping guard');
  }
  for(const l of [a.voice,a.groove])for(const channel of [l.left,l.right])assert(Math.abs(channel[0]-channel.at(-1))<.0002,'click-safe seam');
  const wav=new Uint8Array(await wavBlob(wet).arrayBuffer());
  assert.equal(String.fromCharCode(...wav.slice(0,4)),'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8,12)),'WAVE');
  assert.equal(wav.length,44+wet.left.length*4);
  console.log(`PASS ${id.padEnd(7)} seed=${String(s).padStart(3)} BPM=${a.dna.bpm} voiceRMS=${voiceRms.toFixed(3)} groove/voice=${(groRms/voiceRms).toFixed(2)}`);
}
const silent=hatch({data:new Float32Array(RATE),sampleRate:RATE,duration:1},55);
assert(silent.voice.left.every(x=>x===0));
assert(silent.groove.left.every(x=>x===0));
const short=hatch({data:inputData.slice(0,Math.round(RATE*.28)),sampleRate:RATE,duration:.28},456);
assert(short.voice.left.every(Number.isFinite));
console.log('All v0.5 tests passed.');
