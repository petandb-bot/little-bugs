import assert from 'node:assert/strict';
import {makeDna,hatch,wavBlob} from '../audio-engine.js';
import {createHash} from 'node:crypto';

// 2秒間の模擬音声を作り、外部マイク・ブラウザーを使わず音響エンジンを検証する。
const sampleRate=44100;
const input=new Float32Array(sampleRate*2);
for(let i=0;i<input.length;i++) {
  const t=i/sampleRate;
  input[i]=Math.sin(2*Math.PI*210*t)*Math.max(0,Math.sin(2*Math.PI*4*t))*.36;
}
const recording={data:input,sampleRate,duration:2};
// 全4系統のDNAを少なくとも1回ずつ網羅するseedを動的に探す。
const seeds=new Map();
for(let i=0;i<150&&!['CHIP','BOUNCE','CHOIR','ROBO'].every(id=>seeds.has(id));i++) {
  const id=makeDna(i).id;
  if(!seeds.has(id))seeds.set(id,i);
}
assert.equal(seeds.size,4);
for(const [type,seed] of seeds.entries()) {
  const a=hatch(recording,seed), b=hatch(recording,seed);
  assert.equal(a.dna.id,type);
  assert.equal(a.left.length,a.right.length);
  assert(a.duration>5&&a.duration<12);
  let peak=0,energy=0;
  for(const s of a.left){assert(Number.isFinite(s));peak=Math.max(peak,Math.abs(s));energy+=s*s;}
  assert(peak>.05&&peak<=1,'音が生成され、ピーク超過しないこと');
  assert(energy/a.left.length>.0001,'無音になっていないこと');
  const sha=x=>createHash('sha256').update(new Uint8Array(x.buffer)).digest('hex');
  assert.equal(sha(a.left),sha(b.left),'同じseedなら同じ音になること');
  const wav=new Uint8Array(await wavBlob(a).arrayBuffer());
  assert.equal(String.fromCharCode(...wav.slice(0,4)),'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8,12)),'WAVE');
  assert(wav.byteLength>100000);
  console.log(`PASS ${type}: ${a.duration.toFixed(2)}s / ${a.dna.bpm} BPM / ${wav.byteLength} bytes`);
}
console.log('All audio-engine tests passed.');
