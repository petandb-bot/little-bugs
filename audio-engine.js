/**
 * LITTLE BUGS v0.4 — VOICE-FIRST RITUAL MACHINE
 * 声の明瞭な断片を必ず残しながら、早口ラップ・呪文・詠唱・歌うループを生成する。
 * 伴奏は独立した低音量レイヤーであり、GROOVE OFFでも声だけの拍節が成立する。
 * Web Audio の再生レート変更はフォルマント維持を行わないため、低速化は最小限に制限。
 */
export const RATE=44100;
const TAU=2*Math.PI;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const pick=(rng,arr)=>arr[Math.min(arr.length-1,Math.floor(rng()*arr.length))];
const rand=(rng,a,b)=>a+rng()*(b-a);
const wrap=(x,n)=>(x%n+n)%n;
export function mulberry32(seed){let x=seed>>>0;return()=>{x=(x+0x6d2b79f5)|0;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}

/** マイクの直流・低域ノイズを抑え、声が小さいときだけ控えめに音量を持ち上げる。 */
export function monoFromAudioBuffer(buffer){
  const data=new Float32Array(buffer.length);
  for(let c=0;c<buffer.numberOfChannels;c++){
    const ch=buffer.getChannelData(c);
    for(let i=0;i<data.length;i++)data[i]+=ch[i]/buffer.numberOfChannels;
  }
  let lp=0,dc=0,peak=0,square=0;
  const dcCoef=1-Math.exp(-TAU*24/buffer.sampleRate);
  for(let i=0;i<data.length;i++){
    const s=data[i];dc+=dcCoef*(s-dc);lp+=.001*(s-lp);
    const v=s-dc;data[i]=v;peak=Math.max(peak,Math.abs(v));square+=v*v;
  }
  const rms=Math.sqrt(square/Math.max(1,data.length));
  const boost=peak>.006?Math.min(5.5,.83/peak,.19/Math.max(.002,rms)):1;
  for(let i=0;i<data.length;i++)data[i]*=boost;
  return {data,sampleRate:buffer.sampleRate,duration:data.length/buffer.sampleRate,peak:peak*boost,rms:rms*boost};
}

/** 発音開始点と連続した母音を両方扱う。語句として聴ける長い断片も別途保持する。 */
function analyze(input){
  const {data,sampleRate:sr}=input,total=data.length/sr;
  const hop=Math.max(256,Math.round(sr*.014)),levels=[];
  for(let start=0;start<data.length;start+=hop){
    let energy=0,count=0;
    for(let j=start;j<Math.min(data.length,start+hop);j+=3){energy+=data[j]*data[j];count++;}
    levels.push(Math.sqrt(energy/Math.max(1,count)));
  }
  const sorted=levels.filter(x=>x>.005).sort((a,b)=>a-b);
  const median=sorted.length?sorted[Math.floor(sorted.length*.5)]:0;
  const threshold=Math.max(.007,median*.32);
  const starts=[0];
  for(let i=3;i<levels.length-2;i++){
    const t=i*hop/sr,prev=(levels[i-1]+levels[i-2]+levels[i-3])/3;
    if(levels[i]>threshold && levels[i]>prev*1.32 && (t-starts.at(-1))>.075)starts.push(t);
  }
  // 子音の少ない「あー」なども、適切な位置を使ってリズム化できるようにする。
  for(let t=.1;t<total-.09;t+=clamp(total/9,.17,.42)){
    const idx=Math.min(levels.length-1,Math.floor(t*sr/hop));
    if(levels[idx]>threshold*.8&&!starts.some(x=>Math.abs(x-t)<.075))starts.push(t);
  }
  starts.sort((a,b)=>a-b);
  const syllables=starts.map((start,i)=>({start,len:Math.min(total-start,clamp((starts[i+1]??total)-start,.085,.65))}))
    .filter(s=>s.len>=.04);
  // 比較的クリアな「声の断片」を挿入し、加工後も原音が認識できる瞬間を残す。
  const phrases=[];
  const phraseStep=clamp(total/5,.25,1.25);
  for(let t=0;t<Math.max(.05,total-.12);t+=phraseStep){
    const start=Math.max(0,Math.min(t,total-.13));
    const length=Math.min(total-start,clamp(total*.35,.26,.92));
    const i0=Math.floor(start*sr),i1=Math.min(data.length,Math.floor((start+length)*sr));
    let sum=0,count=0;
    for(let j=i0;j<i1;j+=32){sum+=data[j]*data[j];count++;}
    if(Math.sqrt(sum/Math.max(1,count))>=threshold*.55)phrases.push({start,len:length});
  }
  if(!syllables.length)syllables.push({start:0,len:Math.min(total,.35)});
  if(!phrases.length)phrases.push({start:0,len:Math.min(total,.7)});
  const avg=levels.reduce((a,b)=>a+b,0)/Math.max(1,levels.length);
  return {syllables,phrases,energy:avg};
}

const RECIPES=[
  {id:'RAP',tag:'FAST TALK'},
  {id:'SPELL',tag:'SPELL LOOP'},
  {id:'MANTRA',tag:'VOICE CHANT'},
  {id:'SING',tag:'SING SONG'},
  {id:'BOUNCE',tag:'ODD BEAT'},
  {id:'MUTANT',tag:'MUTANT LOOP'},
];
export function makeDna(seed){
  const rng=mulberry32(seed>>>0),recipe=pick(rng,RECIPES);
  const tempo={RAP:[136,174],SPELL:[100,145],MANTRA:[82,125],SING:[110,150],BOUNCE:[120,162],MUTANT:[118,166]}[recipe.id];
  const bpm=Math.round(rand(rng,...tempo)),beat=60/bpm,beats=16;
  return {...recipe,seed:seed>>>0,sprite:(rng()*0xffffffff)>>>0,bpm,beat,beats,seconds:beats*beat,
    swing:rand(rng,.03,.14),brightness:rand(rng,.78,1.15),voiceShift:pick(rng,[0,0,0,2,3,5]),
    bugEnergy:rand(rng,.7,1.3)};
}
const alloc=n=>({left:new Float32Array(n),right:new Float32Array(n)});

/** 補間と短いエンベロープで波形断片を貼り付ける。loop終端の折り返しも安全に合成。 */
function voice(out,input,{time,start,len,rate=1,gain=.5,pan=0,reverse=false,ring=0,lowpass=12500,warble=0}){
  const sr=input.sampleRate,base=Math.floor(start*sr),remaining=input.data.length-base;
  const source=Math.min(Math.floor(len*sr),remaining);
  if(source<16)return;
  const speed=clamp(rate,.84,2.6); // 声が聞き取れなくなる低音化を防ぐ下限
  const n=Math.min(Math.floor(source/speed*RATE/sr),Math.floor(RATE*1.12));
  if(n<24)return;
  const dest=Math.round(time*RATE),size=out.left.length;
  const attack=Math.min(Math.round(RATE*.006),Math.round(n*.14));
  const release=Math.min(Math.round(RATE*.013),Math.round(n*.2));
  const angle=(clamp(pan,-1,1)+1)*Math.PI/4;
  const left=gain*Math.cos(angle),right=gain*Math.sin(angle);
  const alpha=1-Math.exp(-TAU*clamp(lowpass,900,15500)/RATE);
  let lp=0;
  for(let i=0;i<n;i++){
    const timeSec=i/RATE,drift=1+warble*Math.sin(TAU*4.3*timeSec);
    const offset=i*speed*sr/RATE*drift;
    const index=reverse?base+source-1-offset:base+offset;
    if(index<base||index>=base+source-1)break;
    const j=Math.floor(index),frac=index-j;
    let sample=lerp(input.data[j],input.data[j+1],frac);
    lp+=alpha*(sample-lp);sample=lp;
    if(ring)sample*=.70+.30*Math.sin(TAU*ring*timeSec);
    const envelope=Math.min(1,i/Math.max(1,attack),(n-i-1)/Math.max(1,release));
    const pos=wrap(dest+i,size);
    out.left[pos]+=sample*envelope*left;
    out.right[pos]+=sample*envelope*right;
  }
}

/** 4小節全体を組み立てる。毎小節の核となる子音・フレーズを固定して記憶に残る反復にする。 */
function buildVoice(input,analysis,dna,rng,frames){
  const out=alloc(frames),beat=dna.beat,step=beat/4;
  const syllables=analysis.syllables,phrases=analysis.phrases;
  const anchors=Array.from({length:8},()=>pick(rng,syllables));
  const words=Array.from({length:4},()=>pick(rng,phrases));
  const patterns={
    RAP:[0,2,3,4,6,7,8,10,11,12,14,15],
    SPELL:[0,3,4,6,8,11,12,14],
    MANTRA:[0,4,6,8,12],
    SING:[0,2,4,7,8,10,12,14],
    BOUNCE:[0,2,4,5,7,8,10,12,13,15],
    MUTANT:[0,1,4,6,8,9,11,12,14,15],
  };
  const melody=[0,2,5,7,5,3,2,0];
  for(let bar=0;bar<4;bar++){
    const barTime=bar*beat*4;
    for(const k of patterns[dna.id]){
      const phraseIndex=(k+((bar%2)*2))%anchors.length;
      const slice=anchors[phraseIndex];
      const swing=k%2?dna.swing*step:0;
      const t=barTime+k*step+swing;
      // ほぼ原音〜高めのピッチを中心にする。低速化は低音アクセントだけに限定。
      let rate=1;
      if(dna.id==='SING')rate=Math.pow(2,(melody[phraseIndex]+dna.voiceShift)/12);
      else if(dna.id==='MANTRA')rate=pick(rng,[.97,1,1.03,1.07,1.12]);
      else if(dna.id==='RAP')rate=pick(rng,[1.08,1.19,1.35,1.52,1.72]);
      else if(dna.id==='SPELL')rate=pick(rng,[.98,1.06,1.18,1.25,1.42]);
      else if(dna.id==='BOUNCE')rate=pick(rng,[.98,1.08,1.24,1.4,1.56]);
      else rate=pick(rng,[.90,1.03,1.23,1.46,1.85]);
      rate=clamp(rate*(.986+rng()*.028),.88,2.15);
      const length=dna.id==='MANTRA'?.42:dna.id==='SING'?.35:dna.id==='SPELL'?.30:.24;
      voice(out,input,{time:t,start:slice.start,len:Math.min(slice.len,length),rate,gain:(k%4===0?.64:.49),
        pan:rand(rng,-.35,.35),lowpass:rand(rng,6700,13500),
        reverse:dna.id==='MUTANT'&&rng()<.14,ring:dna.id==='MUTANT'&&rng()<.22?rand(rng,41,95):0});
      // 32分音符の高速な子音反復。速度と長さの両方を変えて機械的なラップを作る。
      if((dna.id==='RAP'&&k%4===3)||(dna.id==='SPELL'&&k===11)||(dna.id==='MUTANT'&&k===15)){
        const count=dna.id==='RAP'?3:4;
        for(let q=0;q<count;q++)voice(out,input,{time:t+step*.26+q*step*.18,start:slice.start,
          len:Math.min(slice.len,.055),rate:clamp(rate*(1+q*.08),1,2.45),gain:.20,pan:(q%2?-.5:.5),lowpass:11500});
      }
      // 「歌」も実音声断片から作る。電子的な和音は低音に埋もれない薄い高声のみ。
      if(dna.id==='SING'&&k%4===0){voice(out,input,{time:t+.035,start:slice.start,len:Math.min(slice.len,.32),
        rate:clamp(rate*1.26,1,2.2),gain:.16,pan:bar%2?-.75:.75,lowpass:9500});}
    }
    // もっとも大切な可聴性：各小節の中央または冒頭に、原音をほぼ保った短い語句を残す。
    // この経路にはリング変調・逆再生・重いフィルターを使わない。
    const word=words[bar%2],at=dna.id==='MANTRA'?barTime+beat*.65:barTime+beat*2.1;
    const clearRate=dna.id==='RAP'?1.18:dna.id==='BOUNCE'?1.12:1.02;
    voice(out,input,{time:at,start:word.start,len:word.len,rate:clearRate,gain:dna.id==='MUTANT'?.36:.43,
      lowpass:13500,pan:bar%2?-.12:.12});
    // 詠唱は短い同一語句を繰り返して呪文感を作る。ラップでは語句の頭を再び強調。
    if(dna.id==='MANTRA'||dna.id==='SPELL'){
      const unit=dna.id==='MANTRA'?beat*1.6:beat*.8;
      voice(out,input,{time:barTime+unit,start:word.start,len:Math.min(word.len,.68),
        rate:dna.id==='MANTRA'?1.04:1.24,gain:.30,pan:bar%2?.34:-.34,lowpass:11000});
    }
  }
  // 原音が聴こえる範囲でのみ、少量の折り返し反復エコーを付加する。
  const dryL=out.left.slice(),dryR=out.right.slice();
  const echoSamples=Math.round(beat*.75*RATE);
  const echo=dna.id==='SPELL'?.18:dna.id==='MANTRA'?.12:.09;
  for(let i=0;i<frames;i++){
    out.left[i]+=dryR[wrap(i-echoSamples,frames)]*echo;
    out.right[i]+=dryL[wrap(i-echoSamples,frames)]*echo;
  }
  return out;
}

/** 前景の声を邪魔しない短い8bit風音。単独で楽曲を作らず拍の目印にする。 */
function percussion(out,time,type,pitch,volume,pan){
  const base=Math.round(time*RATE),n=out.left.length;
  const duration=type==='bass'?.16:type==='plink'?.13:.047;
  const end=Math.round(duration*RATE),gl=volume*Math.cos((pan+1)*Math.PI/4),gr=volume*Math.sin((pan+1)*Math.PI/4);
  for(let i=0;i<end;i++){
    const t=i/RATE;let v;
    if(type==='bass')v=Math.sin(TAU*(pitch*t+pitch*.4*(1-Math.exp(-t*35))/35))*Math.exp(-t*23);
    else if(type==='plink')v=(Math.sin(TAU*pitch*t)+.18*Math.sin(TAU*pitch*2.7*t))*Math.exp(-t*32);
    else v=(Math.sin(TAU*1760*t)+.35*Math.sin(TAU*2940*t))*Math.exp(-t*82);
    const p=wrap(base+i,n);out.left[p]+=v*gl;out.right[p]+=v*gr;
  }
}
function buildGroove(dna,rng,frames,energy){
  const out=alloc(frames);
  if(energy<.0009)return out;
  const root=110*Math.pow(2,dna.voiceShift/12),beat=dna.beat;
  for(let bar=0;bar<4;bar++){
    const t=bar*4*beat;
    percussion(out,t,'bass',root,.085,-.17);
    if(dna.id==='RAP'||dna.id==='BOUNCE')percussion(out,t+beat*2.5,'bass',root*.75,.042,.18);
    if(bar%2===0)percussion(out,t+beat*2,'click',0,.035,.1);
    for(let b=0;b<4;b++)if(rng()<.48)percussion(out,t+(b+.5)*beat,'click',0,.021,b%2?.5:-.5);
    if(bar%2===1)percussion(out,t+beat*3,'plink',root*4*Math.pow(2,(bar%3)*2/12),.035,.35);
  }
  return out;
}
function levelLayers(voiceLayer,grooveLayer){
  let peak=0,groovePeak=0;
  for(let i=0;i<voiceLayer.left.length;i++){
    peak=Math.max(peak,Math.abs(voiceLayer.left[i]),Math.abs(voiceLayer.right[i]));
    groovePeak=Math.max(groovePeak,Math.abs(grooveLayer.left[i]),Math.abs(grooveLayer.right[i]));
  }
  const gVoice=peak>.0001?Math.min(3.8,.82/peak):1;
  const gGroove=groovePeak>.0001?.15/groovePeak:1;
  for(let i=0;i<voiceLayer.left.length;i++){
    voiceLayer.left[i]=Math.tanh(voiceLayer.left[i]*gVoice)*.90;
    voiceLayer.right[i]=Math.tanh(voiceLayer.right[i]*gVoice)*.90;
    grooveLayer.left[i]*=gGroove;grooveLayer.right[i]*=gGroove;
  }
  for(const layer of [voiceLayer,grooveLayer])for(const ch of [layer.left,layer.right]){
    // 最初と最後を同じ値に近づけてループの境界のクリックを抑える。
    const n=Math.min(300,Math.floor(ch.length*.002)),mid=(ch[0]+ch.at(-1))*.5;
    for(let i=0;i<n;i++){
      const w=((n-i)/n)**2;
      ch[i]=lerp(ch[i],mid,w);ch[ch.length-1-i]=lerp(ch[ch.length-1-i],mid,w);
    }
  }
}
export function hatch(input,seed){
  if(!input?.data?.length||!(input.sampleRate>0))throw Error('No recorded audio.');
  const dna=makeDna(seed),frames=Math.round(dna.seconds*RATE),analysis=analyze(input);
  const foreground=buildVoice(input,analysis,dna,mulberry32(seed^0xA17671),frames);
  const groove=buildGroove(dna,mulberry32(seed^0xB00B15),frames,analysis.energy);
  levelLayers(foreground,groove);
  return {voice:foreground,groove,sampleRate:RATE,duration:frames/RATE,dna};
}
export function mixLayers(song,enabled=true){
  const n=song.voice.left.length,left=new Float32Array(n),right=new Float32Array(n);
  for(let i=0;i<n;i++){
    left[i]=clamp(song.voice.left[i]+(enabled?song.groove.left[i]:0),-.97,.97);
    right[i]=clamp(song.voice.right[i]+(enabled?song.groove.right[i]:0),-.97,.97);
  }
  return {left,right,sampleRate:song.sampleRate,duration:song.duration,dna:song.dna};
}
export function wavBlob(audio){
  const {left,right,sampleRate}=audio,bytes=new ArrayBuffer(44+left.length*4),v=new DataView(bytes);
  const word=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
  word(0,'RIFF');v.setUint32(4,36+left.length*4,true);word(8,'WAVE');word(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);
  v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);
  word(36,'data');v.setUint32(40,left.length*4,true);
  let offset=44;
  for(let i=0;i<left.length;i++){
    v.setInt16(offset,Math.round(clamp(left[i],-1,1)*32767),true);
    v.setInt16(offset+2,Math.round(clamp(right[i],-1,1)*32767),true);offset+=4;
  }
  return new Blob([bytes],{type:'audio/wav'});
}
