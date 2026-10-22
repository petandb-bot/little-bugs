/**
 * LITTLE BUGS v0.5 — POCKET RHYTHM ENGINE
 *
 * 主役は録音された声。シーケンスの強拍・裏拍・休符・反復を先に設計してから、
 * そこへ声の断片を当てはめる。エフェクトが変わっても拍の骨格は壊さない。
 * GROOVE は声とは別の打楽器トラックとして生成し、再生中も切り替えられる。
 * 配列の処理は端末内だけで行い、録音データをネットワークへ送信しない。
 */
export const RATE = 44100;
const TAU = Math.PI * 2;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const choose=(rng,arr)=>arr[Math.min(arr.length-1,Math.floor(rng()*arr.length))];
const wrap=(x,n)=>(x%n+n)%n;
const rand=(rng,a,b)=>a+(b-a)*rng();
export function mulberry32(seed) { let x=seed>>>0;return()=>{x=(x+0x6D2B79F5)|0;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;}; }
const allocate=n=>({left:new Float32Array(n),right:new Float32Array(n)});

/** 入力のDC成分を除去し、極端に小さな声だけ穏やかにレベルを上げる。 */
export function monoFromAudioBuffer(buffer){
  const {numberOfChannels,length,sampleRate}=buffer;
  const data=new Float32Array(length);
  for(let c=0;c<numberOfChannels;c++){const ch=buffer.getChannelData(c);for(let i=0;i<length;i++)data[i]+=ch[i]/numberOfChannels;}
  let dc=0,peak=0,sumsq=0;const coefficient=1-Math.exp(-TAU*24/sampleRate);
  for(let i=0;i<length;i++){dc+=coefficient*(data[i]-dc);data[i]-=dc;peak=Math.max(peak,Math.abs(data[i]));sumsq+=data[i]*data[i];}
  const rms=Math.sqrt(sumsq/Math.max(1,length));
  const gain=peak>.004?Math.min(6,.83/peak,.18/Math.max(rms,.001)):1;
  for(let i=0;i<length;i++)data[i]*=gain;
  return {data,sampleRate,duration:length/sampleRate,peak:peak*gain,rms:rms*gain};
}

/** 14ms フレームでエネルギーとノイズ成分を観察。単一母音も扱えるように時間均等候補を追加。 */
function analyze(input){
  const sr=input.sampleRate,data=input.data,total=data.length/sr;
  const hop=Math.max(256,Math.round(sr*.014));const frames=[];
  for(let start=0;start<data.length;start+=hop){
    let power=0,cross=0,count=0,previous=data[start]||0;
    for(let j=start;j<Math.min(data.length,start+hop);j+=2){
      const v=data[j];power+=v*v;if(v*previous<0)cross++;previous=v;count++;
    }
    frames.push({time:start/sr,rms:Math.sqrt(power/Math.max(1,count)),zcr:cross/Math.max(1,count)});
  }
  const sorted=frames.map(x=>x.rms).filter(x=>x>.004).sort((a,b)=>a-b);
  const median=sorted[Math.floor(sorted.length*.5)]||0;
  const threshold=Math.max(.006,median*.26);
  const onsets=[];
  for(let i=2;i<frames.length-1;i++){
    const f=frames[i],prev=(frames[i-1].rms+frames[i-2].rms)/2;
    if(f.rms>threshold && f.rms>prev*1.38 && (!onsets.length || f.time-onsets.at(-1)>.085))onsets.push(f.time);
  }
  const candidates=onsets.slice();
  // 声が長く伸びている場合にも、声のある領域から断片を切り出す。
  const spacing=clamp(total/10,.16,.38);
  for(let t=.025;t<total-.075;t+=spacing){
    const f=frames[Math.min(frames.length-1,Math.round(t*sr/hop))];
    if(f && f.rms>threshold && !candidates.some(x=>Math.abs(x-t)<.09))candidates.push(t);
  }
  candidates.sort((a,b)=>a-b);
  const slices=candidates.map((start,i)=>{
    const a=frames[Math.min(frames.length-1,Math.floor(start*sr/hop))];
    const next=candidates[i+1]??total;
    return {start,len:clamp(Math.min(next-start+.028,total-start),.062,.55),rms:a?.rms||0,zcr:a?.zcr||0};
  }).filter(s=>s.start<total-.03&&s.len>.048);
  if(!slices.length)slices.push({start:0,len:Math.min(total,.32),rms:0,zcr:0});
  // 語句：拍ごとに近似原音を挿入するための、少し長めの声の区間。
  const phrases=[];
  for(let t=0;t<Math.max(total-.1,.1);t+=clamp(total/5,.2,.85)){
    let best=t,bestEnergy=-1;
    for(let d of [-.12,0,.12]){
      const at=clamp(t+d,0,Math.max(0,total-.16));
      const f=frames[Math.min(frames.length-1,Math.floor(at*sr/hop))];
      if(f&&f.rms>bestEnergy){best=at;bestEnergy=f.rms;}
    }
    const len=Math.min(total-best,clamp(total*.28,.2,.74));
    if(len>.08 && bestEnergy>threshold*.5)phrases.push({start:best,len});
  }
  if(!phrases.length)phrases.push({start:0,len:Math.min(.7,total)});
  const loud=slices.filter(s=>s.rms>=threshold).sort((a,b)=>b.rms-a.rms);
  const crisp=loud.filter(s=>s.zcr>.07);
  const low=loud.filter(s=>s.zcr<=.07);
  return {slices,phrases,loud:loud.length?loud:slices,crisp:crisp.length?crisp:(loud.length?loud:slices),low:low.length?low:(loud.length?loud:slices),energy:median};
}

const TYPES=[
  {id:'BEATBOX',tag:'MOUTH BEAT',range:[100,134]},
  {id:'RAP',tag:'FAST RAP',range:[108,148]},
  {id:'CHANT',tag:'LOOP CHANT',range:[88,126]},
  {id:'SPELL',tag:'SPELL TALK',range:[96,136]},
  {id:'SING',tag:'SING TALK',range:[105,138]},
  {id:'BREAK',tag:'BROKEN RHYTHM',range:[112,149]},
];
export function makeDna(seed){
  const rng=mulberry32(seed>>>0),type=choose(rng,TYPES),bpm=Math.round(rand(rng,...type.range)),beat=60/bpm;
  return {...type,seed:seed>>>0,sprite:(rng()*0xFFFFFFFF)>>>0,bpm,beat,beats:16,seconds:16*beat,
    swing:rand(rng,.105,.27),voiceShift:choose(rng,[0,0,0,2,3,5]),bugEnergy:rand(rng,.7,1.3)};
}

/**
 * 音声断片をループへ貼り付ける。最大長と速度を制限し、原音の低音沈み込みを防ぐ。
 * エンベロープは切断面のクリックを消すが、子音のアタックを残すため短めに設定。
 */
function paste(out,input,e){
  const sr=input.sampleRate,base=Math.floor(e.start*sr),srcN=Math.min(Math.floor(e.len*sr),input.data.length-base);
  if(srcN<30)return;
  const rate=clamp(e.rate??1,.92,2.65);const samples=Math.min(Math.floor(srcN/rate*RATE/sr),Math.round(.92*RATE));
  if(samples<30)return;
  const at=Math.round(e.time*RATE),size=out.left.length;
  const attack=Math.max(15,Math.min(samples*.14,RATE*.004));
  const release=Math.max(15,Math.min(samples*.23,RATE*.011));
  const pan=clamp(e.pan??0,-1,1);const left=Math.cos((pan+1)*Math.PI/4)*(e.gain??.5);
  const right=Math.sin((pan+1)*Math.PI/4)*(e.gain??.5);
  const filter=clamp(e.filter??12000,950,16000),alpha=1-Math.exp(-TAU*filter/RATE);
  let low=0;
  for(let i=0;i<samples;i++){
    const srcAt=i*rate*sr/RATE;
    const srcIndex=e.reverse?(base+srcN-1-srcAt):(base+srcAt);
    if(srcIndex<base||srcIndex>=base+srcN-1)break;
    const j=Math.floor(srcIndex),frac=srcIndex-j;
    let v=lerp(input.data[j],input.data[j+1],frac);
    low+=alpha*(v-low);v=low;
    if(e.ring)v*=(.68+.32*Math.sin(TAU*e.ring*i/RATE));
    const env=clamp(Math.min(i/attack,(samples-1-i)/release,1),0,1);
    const pos=wrap(at+i,size);
    out.left[pos]+=v*env*left;out.right[pos]+=v*env*right;
  }
}

/** 拍のオフセットは全パートで共通。声とGROOVEがズレないようにする。 */
function gridTime(dna,bar,step,rng=null){
  const s=dna.beat/4;
  const swing=step%2?dna.swing*s:0;
  const jitter=rng?(rng()-.5)*.006:0;
  return bar*4*dna.beat + step*s + swing + jitter;
}

/** 16分単位の骨格。2小節のモチーフを繰り返し、最終小節のみ短いフィルを加える。 */
const PATTERNS={
  BEATBOX:[[0,3,4,6,8,10,12,15],[0,2,4,7,8,11,12,14]],
  RAP:[[0,2,3,6,8,9,11,14],[0,3,4,6,8,10,11,13,15]],
  CHANT:[[0,4,8,12,14],[0,4,7,8,12,15]],
  SPELL:[[0,3,4,7,8,11,12,14],[0,2,4,6,8,11,12,15]],
  SING:[[0,3,6,8,11,14],[0,2,4,7,8,12,15]],
  BREAK:[[0,2,4,5,8,10,12,15],[0,3,4,7,8,9,12,14]],
};
const TONES=[0,2,3,5,7,5,3,2];
function buildVoice(input,analysis,dna,rng,frames){
  const out=allocate(frames),step=dna.beat/4;
  const lead=Array.from({length:8},()=>choose(rng,analysis.loud));
  const mouth=Array.from({length:4},()=>choose(rng,analysis.crisp));
  const thump=Array.from({length:3},()=>choose(rng,analysis.low));
  const phrases=Array.from({length:2},()=>choose(rng,analysis.phrases));
  for(let bar=0;bar<4;bar++){
    const pattern=PATTERNS[dna.id][bar%2];
    const fill=bar===3?[13,14,15]:[];
    // beatboxは、声素材だけでキック/スネア的な2層を作る。
    // 声質が母音だけでも音量包絡と高低差で強拍を区別できる。
    for(let beat=0;beat<4;beat++){
      const base=beat*4;
      const onKick=beat===0||beat===2||(bar%2===1&&beat===3);
      if(onKick){
        const src=thump[(beat+bar)%thump.length];
        paste(out,input,{time:gridTime(dna,bar,base,rng),start:src.start,len:Math.min(src.len,.135),
          rate:choose(rng,[.96,1,1.04]),gain:.50,filter:1650,pan:-.06});
      }
      if(beat===1||beat===3){
        const src=mouth[(beat+bar)%mouth.length];
        paste(out,input,{time:gridTime(dna,bar,base,rng),start:src.start,len:Math.min(src.len,.095),
          rate:choose(rng,[1.45,1.65,1.88]),gain:.35,filter:11200,pan:.07});
      }
    }
    // 声のリード: 毎小節すべてをランダムに変えず、同一位置の音節を固定して記憶に残す。
    for(const k of [...new Set([...pattern,...fill])].sort((a,b)=>a-b)){
      const s=lead[(k+Math.floor(k/4)+(bar%2)*2)%lead.length];
      const onDownbeat=k%4===0, strong=k===0||k===8;
      let rate;
      if(dna.id==='RAP')rate=choose(rng,[1,1.12,1.3,1.48,1.65]);
      else if(dna.id==='CHANT')rate=choose(rng,[.98,1,1.04,1.12]);
      else if(dna.id==='SPELL')rate=choose(rng,[1,1.15,1.26,1.38]);
      else if(dna.id==='SING')rate=Math.pow(2,(TONES[(k/2|0)%8]+dna.voiceShift)/12);
      else if(dna.id==='BREAK')rate=choose(rng,[1,1.06,1.2,1.5,1.85]);
      else rate=choose(rng,[1,1.24,1.48,1.72]);
      // 休符の間を意識して長い声を詰め込みすぎない。
      const maxLength=dna.id==='CHANT'?.33:dna.id==='SING'?.31:dna.id==='RAP'?.19:.23;
      const length=Math.min(s.len,maxLength,Math.max(.065,step*1.48));
      paste(out,input,{time:gridTime(dna,bar,k,rng),start:s.start,len:length,rate,
        gain:strong?.66:onDownbeat?.50:.39,filter:strong?14000:10000,pan:(k%4===0)?0:(bar%2?.21:-.21),
        reverse:dna.id==='BREAK'&&k>=13&&rng()<.21});
      // 細かい音節を1拍の終わりにだけ畳み掛ける。常時刻まないからフロウが感じられる。
      const roll=(dna.id==='RAP'&&(k===6||k===14))||(dna.id==='SPELL'&&k===11)||(dna.id==='BREAK'&&k===15);
      if(roll){
        for(let q=0;q<3;q++)paste(out,input,{time:gridTime(dna,bar,k,rng)+step*(q+1)*.22,
          start:s.start,len:Math.min(s.len,.060),rate:clamp(rate*(1+q*.08),1,2.55),gain:.20,filter:11000,pan:q%2?.4:-.4});
      }
    }
    // 元の声の意味が失われないよう、2小節ごとに原音に近い語句を残す。
    // 語句が重なると発音が不明瞭になるので、配置箇所は小節内の隙間へ逃がす。
    const clear=phrases[(bar>>1)%2];
    const phraseAt=dna.id==='CHANT'?8:dna.id==='RAP'?4:10;
    paste(out,input,{time:gridTime(dna,bar,phraseAt),start:clear.start,len:Math.min(clear.len,.44),
      rate:dna.id==='RAP'?1.13:1.0,gain:.43,filter:14000,pan:0});
    if(dna.id==='CHANT'||dna.id==='SPELL'){
      const src=lead[(bar%2)*3];
      paste(out,input,{time:gridTime(dna,bar,15),start:src.start,len:Math.min(src.len,.16),rate:1.06,gain:.28,pan:-.23});
    }
  }
  // 原音ベースの短い反響のみ。前景のリズムを滲ませない。
  const tap=Math.round(dna.beat*.75*RATE),amount=dna.id==='SPELL'?.12:.068;
  const originalL=out.left.slice(),originalR=out.right.slice();
  for(let i=0;i<frames;i++){
    out.left[i]+=originalR[wrap(i-tap,frames)]*amount;
    out.right[i]+=originalL[wrap(i-tap,frames)]*amount;
  }
  return out;
}

/** 軽量な電子ドラム。キックは周波数下降、スネアは短いノイズ、ハットは帯域限定ノイズ。 */
function drum(out,at,type,rng,gain=1,pan=0){
  const durations={kick:.22,snare:.15,hat:.054,bass:.125,blip:.11};
  const n=Math.round(durations[type]*RATE),start=Math.round(at*RATE),size=out.left.length;
  const lg=Math.cos((clamp(pan,-1,1)+1)*Math.PI/4)*gain,rg=Math.sin((clamp(pan,-1,1)+1)*Math.PI/4)*gain;
  let hp=0,lastNoise=0,phase=0;
  for(let i=0;i<n;i++){
    const t=i/RATE,random=rng()*2-1;let v=0;
    if(type==='kick'){
      // 速く沈むピッチエンベロープにクリックを加えて音量を小さくしても拍を感じさせる。
      const freq=57+165*Math.exp(-t*30);phase+=TAU*freq/RATE;
      v=Math.sin(phase)*Math.exp(-t*20)+random*.065*Math.exp(-t*95);
    }else if(type==='snare'){
      const noisy=(random-lastNoise);lastNoise=random;
      v=(noisy*.64+Math.sin(TAU*187*t)*.20)*Math.exp(-t*27);
    }else if(type==='hat'){
      hp+=.16*(random-hp);v=(random-hp)*Math.exp(-t*76);
    }else if(type==='bass'){
      const freq=92;v=(Math.sin(TAU*freq*t)+.24*Math.sin(TAU*freq*2*t))*Math.exp(-t*32);
    }else{
      v=(Math.sin(TAU*545*t)+.17*Math.sin(TAU*1088*t))*Math.exp(-t*36);
    }
    const p=wrap(start+i,size);out.left[p]+=v*lg;out.right[p]+=v*rg;
  }
}

/** GROOVE ON は旋律で埋めず、ヒップホップの背骨を作る。 */
function buildGroove(dna,rng,frames,energy){
  const out=allocate(frames);
  if(energy<.0005)return out;
  for(let bar=0;bar<4;bar++){
    // キック：1拍目・3拍目を核に、2小節ごとに裏拍の先取り。
    for(const [s,g] of [[0,.63],[8,.51],...(bar%2?[[14,.34]]:[[10,.28]])]){
      drum(out,gridTime(dna,bar,s), 'kick',rng,g,-.05);
    }
    // スネア：常に2拍目と4拍目。ここが v0.4 との最も重要な差分。
    for(const s of [4,12])drum(out,gridTime(dna,bar,s),'snare',rng,.37,.05);
    // ハット：少数の裏拍とゴースト。完全な8分連打に固定しない。
    for(const s of [2,6,10,14])drum(out,gridTime(dna,bar,s), 'hat',rng,s===6?.17:.13,s%4===2?.36:-.36);
    if(bar===1||bar===3){
      for(const s of [11,15])drum(out,gridTime(dna,bar,s),'hat',rng,.10,-.28);
    }
    // 電子音は毎小節少数。前バージョンのテクノポップ的メロディを復活させない。
    if(bar===1||bar===3)drum(out,gridTime(dna,bar,7),'blip',rng,.13,.4);
    if(bar%2===0)drum(out,gridTime(dna,bar,0),'bass',rng,.15,-.16);
  }
  return out;
}
function stats(layer){
  let peak=0,sum=0;
  for(let i=0;i<layer.left.length;i+=2){
    const l=layer.left[i],r=layer.right[i];peak=Math.max(peak,Math.abs(l),Math.abs(r));sum+=l*l+r*r;
  }
  return {peak,rms:Math.sqrt(sum/Math.max(1,layer.left.length))};
}
function smoothLoop(layer){
  for(const channel of [layer.left,layer.right]){
    const n=Math.min(270,Math.round(channel.length*.002)),mid=(channel[0]+channel.at(-1))*.5;
    for(let i=0;i<n;i++){
      const w=((n-i)/n)**2;
      channel[i]=lerp(channel[i],mid,w);channel[channel.length-1-i]=lerp(channel[channel.length-1-i],mid,w);
    }
  }
}
function normalizeLayers(voice,groove){
  const v=stats(voice),g=stats(groove);
  const gv=v.peak>.0001?Math.min(5.5,.76/v.peak,.125/Math.max(v.rms,.0002)):1;
  for(let i=0;i<voice.left.length;i++){
    voice.left[i]=Math.tanh(voice.left[i]*gv)*.94;
    voice.right[i]=Math.tanh(voice.right[i]*gv)*.94;
  }
  // ピークだけでなく RMS を基準にゲインを決める。
  // v0.4 でスネアやキックが聴こえにくかった原因（伴奏を peak=.15 に固定）を解消。
  const vr=stats(voice),gg=g.rms>.00001?Math.min(3,.61*vr.rms/g.rms,.41/Math.max(.00001,g.peak)):0;
  for(let i=0;i<groove.left.length;i++){
    groove.left[i]*=gg;groove.right[i]*=gg;
  }
  smoothLoop(voice);smoothLoop(groove);
}
export function hatch(input,seed){
  if(!input?.data?.length||!(input.sampleRate>0))throw Error('No recorded audio.');
  const dna=makeDna(seed),frames=Math.round(dna.seconds*RATE),a=analyze(input);
  const voice=buildVoice(input,a,dna,mulberry32(seed^0x4B105),frames);
  const groove=buildGroove(dna,mulberry32(seed^0xB00B15),frames,a.energy);
  normalizeLayers(voice,groove);
  return {voice,groove,sampleRate:RATE,duration:frames/RATE,dna};
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
