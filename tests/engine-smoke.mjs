import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hatch,makeDna,mixLayers,wavBlob,RATE,analyzeVoice,monoFromAudioBuffer} from '../audio-engine.js';

// 声のような母音と子音の立ち上がりを5つの区間に作る。途中に無音を入れてフレーズ抽出も検証する。
const sr=48000;
const d=new Float32Array(sr*4.5);
let state=481;
const noise=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2147483648-1;};
const utterances=[[.24,.94,154],[1.28,1.9,175],[2.09,2.56,187],[2.99,3.85,142]];
for(let i=0;i<d.length;i++){
  const t=i/sr;
  for(const [a,b,f] of utterances){
    if(t<a||t>=b)continue;
    const q=(t-a)/(b-a),en=Math.min(1,q*15,(1-q)*15);
    const vowel=Math.sin(2*Math.PI*f*t)+.3*Math.sin(2*Math.PI*f*2*t)+.16*Math.sin(2*Math.PI*f*3*t);
    d[i]+=en*(vowel*.2+noise()*(q<.1?.048:.006));
  }
}
const input={data:d,sampleRate:sr,duration:d.length/sr};
const analyzed=analyzeVoice(input);
assert(analyzed.active,'Non-silent voice detected');
assert(analyzed.phrases.length>=3,'Pauses separate natural phrases');
assert(analyzed.phrases.every(p=>p.len>=.14),'No tiny fragments used as primary phrases');
const ids=['PHRASE','MANTRA','RAP','CHOIR','BROKEN'];
const seeds=new Map();
for(let s=0;s<2000&&seeds.size<ids.length;s++){
  const id=makeDna(s).id;if(!seeds.has(id))seeds.set(id,s);
}
assert.equal(seeds.size,ids.length);
const hash=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const rms=a=>{
  let sum=0;
  for(let i=0;i<a.left.length;i+=3)sum+=a.left[i]*a.left[i]+a.right[i]*a.right[i];
  return Math.sqrt(sum/(Math.ceil(a.left.length/3)*2));
};
const hashes=new Set();
for(const [id,s] of seeds){
  const result=hatch(input,s),same=hatch(input,s);
  assert.equal(result.dna.id,id);
  assert(result.duration>=6.8&&result.duration<=14.81,'Phrase-sized loops');
  assert.equal(result.analysis.phraseCount,analyzed.phrases.length);
  assert.equal(hash(result.voice.left),hash(same.voice.left),'Deterministic voice per seed');
  assert.equal(hash(result.groove.left),hash(same.groove.left),'Deterministic groove per seed');
  hashes.add(hash(result.voice.left));
  const dry=mixLayers(result,false),wet=mixLayers(result,true);
  assert(dry.left.every((v,i)=>Math.abs(v-result.voice.left[i])<1e-7),'GROOVE OFF = recorded voice only');
  assert.notEqual(hash(wet.left),hash(dry.left),'GROOVE ON changes audio');
  const voiceVolume=rms(result.voice),grooveVolume=rms(result.groove);
  assert(voiceVolume>.024&&voiceVolume<.43,`Voice audible ${voiceVolume}`);
  assert(grooveVolume/voiceVolume>.05&&grooveVolume/voiceVolume<.32,`GROOVE sparse ${grooveVolume/voiceVolume}`);
  for(const arr of [dry.left,dry.right,wet.left,wet.right]){
    assert(arr.every(Number.isFinite),'Finite samples');
    assert(arr.every(x=>Math.abs(x)<=.971),'Limiter');
    assert(Math.abs(arr[0])<.00001&&Math.abs(arr.at(-1))<.00001,'Seam fades');
  }
  const wav=new Uint8Array(await wavBlob(wet).arrayBuffer());
  assert.equal(String.fromCharCode(...wav.slice(0,4)),'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8,12)),'WAVE');
  assert.equal(wav.length,44+dry.left.length*4);
  console.log(`PASS ${id.padEnd(7)} ${result.duration.toFixed(1)}s voiceRMS=${voiceVolume.toFixed(3)} groove/voice=${(grooveVolume/voiceVolume).toFixed(2)}`);
}
assert.equal(hashes.size,ids.length,'Five recipes produce distinct audio');
const empty=hatch({data:new Float32Array(sr),sampleRate:sr,duration:1},6);
assert(empty.voice.left.every(v=>v===0)&&empty.groove.left.every(v=>v===0));
const short=hatch({data:d.slice(Math.round(sr*.24),Math.round(sr*.56)),sampleRate:sr,duration:.32},19);
assert(short.voice.left.every(Number.isFinite));
const mono=monoFromAudioBuffer({numberOfChannels:1,length:sr,sampleRate:sr,getChannelData:()=>d.slice(0,sr)});
assert(Number.isFinite(mono.rms));
console.log('All v0.6 audio-engine tests passed.');
