import assert from 'node:assert/strict';
import {makeDna,hatch,wavBlob} from '../audio-engine.js';
import {createHash} from 'node:crypto';

// 模擬音声を使い、4種のレシピ・疑似乱数の再現性・WAV構造を検証。
const sampleRate=44100;
const data=new Float32Array(sampleRate*2);
for(let i=0;i<data.length;i++){
  const t=i/sampleRate;
  const pulsation=Math.max(0,Math.sin(2*Math.PI*3.2*t));
  data[i]=(.20*Math.sin(2*Math.PI*196*t)+.13*Math.sin(2*Math.PI*351*t))*pulsation;
}
const recording={data,sampleRate,duration:2};
const types=['FLEA','MOTH','WORM','PUPA'];
const seeds=new Map();
for(let i=0;i<150 && seeds.size<4;i++){
  const id=makeDna(i).id;
  if(!seeds.has(id))seeds.set(id,i);
}
assert.equal(seeds.size,4);
for(const [type,seed] of seeds){
  const a=hatch(recording,seed),b=hatch(recording,seed);
  assert.equal(a.dna.id,type);
  assert(a.duration>6&&a.duration<12);
  assert.equal(a.left.length,a.right.length);
  let peak=0,energy=0;
  for(const s of a.left){assert(Number.isFinite(s));peak=Math.max(peak,Math.abs(s));energy+=s*s;}
  assert(peak>.025&&peak<=1,'Generated audio must be audible and unclipped.');
  assert(energy/a.left.length>.00001,'Generated audio must not be silent.');
  const sha=x=>createHash('sha256').update(new Uint8Array(x.buffer)).digest('hex');
  assert.equal(sha(a.left),sha(b.left),'Same recording and seed must generate identical audio.');
  const wav=new Uint8Array(await wavBlob(a).arrayBuffer());
  assert.equal(String.fromCharCode(...wav.slice(0,4)),'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8,12)),'WAVE');
  assert.equal(wav.byteLength,44+a.left.length*4);
  // 再生をループしたときに境界で大きな段差を生じさせない。
  assert(Math.abs(a.left[0]-a.left.at(-1))<.0001);
  console.log(`PASS ${type}: ${a.duration.toFixed(2)}s / ${wav.byteLength} bytes`);
}
// 録音が完全無音なら、音楽的な伴奏や追加ノイズを生成しない。
const silent=hatch({data:new Float32Array(44100),sampleRate:44100,duration:1},19);
assert(silent.left.every(x=>x===0) && silent.right.every(x=>x===0));
console.log('All experimental-loop tests passed.');
