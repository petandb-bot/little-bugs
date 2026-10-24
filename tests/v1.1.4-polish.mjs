import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {applySelectiveCrush,hatch,mixLayers,RATE} from '../audio-engine.js';
import {applyShortDelay,applyToyDelay} from '../music-fx.js';

// 音声を模した強弱のある信号。ノイズだけではなく有声音と短い無音を含める。
const sr=RATE,n=sr*4;
const recording=new Float32Array(n);
for(let i=0;i<n;i++){
 const t=i/sr;
 const envelope=[{s:.1,e:.72},{s:1.1,e:1.76},{s:2.13,e:2.9},{s:3.25,e:3.7}].reduce((a,p)=>{
   return t<p.s||t>p.e?a:Math.max(a,Math.min(1,(t-p.s)*30,(p.e-t)*23));
 },0);
 const phraseAmplitude=t>2.13&&t<2.9?.40:.15;
 recording[i]=envelope*phraseAmplitude*(Math.sin(2*Math.PI*196*t)+.25*Math.sin(2*Math.PI*392*t));
}
const input={data:recording,sampleRate:sr,duration:4};
const digest=x=>createHash('sha256').update(new Uint8Array(x.buffer,x.byteOffset,x.byteLength)).digest('hex');
const rms=(a,first=0,last=a.length)=>{
 let v=0,count=0;for(let i=first;i<last;i+=3){v+=a[i]**2;count++;}
 return Math.sqrt(v/Math.max(1,count));
};

// いくつかのシードと音量差で、局所処理が急に極端なゲインを作らないことを確認。
for(const seed of [1,25,176,849,9821,35872]){
 const layer={left:recording.slice(),right:recording.slice()};
 const events=[0,1,2,3].map(k=>({time:k,end:k+.89,duration:.89,gain:.8}));
 const hits=applySelectiveCrush(layer,{seed,bpm:135},events,sr);
 assert(hits>=1);
 for(let c=0;c<2;c++){
   const out=c?layer.right:layer.left;
   assert(out.every(Number.isFinite));
   assert.notEqual(digest(out),digest(recording));
   for(let start=0;start<n;start+=Math.round(sr*.05)){
     const end=Math.min(n,start+Math.round(sr*.05));
     const originalLevel=rms(recording,start,end);
     const adjustedLevel=rms(out,start,end);
     if(originalLevel>.015){
       assert(adjustedLevel<originalLevel*1.8+.015,`Uncontrolled local increase seed=${seed} time=${start/sr}`);
     }
   }
 }
}

// Delayはドライ音を保ち、派手なEchoより短い2タップの応答が出る。
const wave={left:recording.slice(),right:recording.slice()};
const name=applyShortDelay(wave,{bpm:133},4215,sr);
assert(['SHORT-SLAP','SHORT-EIGHTH','SHORT-DOTTED'].includes(name));
assert(wave.left.every(Number.isFinite));
assert.notEqual(digest(wave.left),digest(recording));
const repeat={left:recording.slice(),right:recording.slice()};
assert.equal(applyShortDelay(repeat,{bpm:133},4215,sr),name);
assert.equal(digest(repeat.left),digest(wave.left),'Short delay should be deterministic');

// ECHOの中から短いDelayと従来Echoの両方に到達できる。
const seen=new Set();
for(const seed of [251,918,1020,2871,3886,7951,9245,11862,14651,18220,23611,43321]){
 const song=hatch(input,seed,'PHRASE','ECHO');
 const mode=song.analysis.echoMode;
 seen.add(mode.startsWith('SHORT-')?'short':'echo');
 const withGroove=mixLayers(song,true),withoutGroove=mixLayers(song,false);
 for(const a of [withGroove.left,withGroove.right,withoutGroove.left,withoutGroove.right]){
  assert(a.every(Number.isFinite));
  assert(a.every(x=>Math.abs(x)<=.97));
 }
}
assert.deepEqual([...seen].sort(),['echo','short']);
console.log('v1.1.4 local crush loudness and subtle/echo delay split verified.');
