/**
 * LITTLE BUGS v0.6 — VOICE PHRASE ENGINE
 *
 * 設計原則：短い声をドラム用の極小断片に分解するのではなく、
 * 先に息継ぎ・無音・発音のまとまりからフレーズを抽出する。
 * 4章構成（主題→変奏→逸脱→回帰）で声を反復させ、粒子化は局所的な装飾に限定する。
 * 音色が異なる5種の作曲規則を用意し、すべてのレシピに聞き取れる声の主題を残す。
 * 極端な低音化を防ぐため、主題は自然速度に近い再生を基本にする。
 * GROOVEは独立した疎な電子音レイヤー。完成した音声へいつでもON/OFFできる。
 * 録音・合成・書き出しを端末内だけで行い、外部サーバーへ音声を送らない。
 */
export const RATE=44100;
const TAU=2*Math.PI;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const mix=(a,b,t)=>a+(b-a)*t;
const pick=(r,a)=>a[Math.min(a.length-1,Math.floor(r()*a.length))];
const random=(r,a,b)=>a+(b-a)*r();
const layers=n=>({left:new Float32Array(n),right:new Float32Array(n)});
export function mulberry32(seed){let x=seed>>>0;return()=>{x=(x+0x6D2B79F5)|0;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}

/** 録音にDCが残っている場合は除き、小さな声だけ穏やかに増幅する。 */
export function monoFromAudioBuffer(buffer){
  const {numberOfChannels,length,sampleRate}=buffer;
  const data=new Float32Array(length);
  for(let c=0;c<numberOfChannels;c++){
    const channel=buffer.getChannelData(c);
    for(let i=0;i<length;i++)data[i]+=channel[i]/numberOfChannels;
  }
  let dc=0,peak=0,sum=0;
  const alpha=1-Math.exp(-TAU*15/sampleRate);
  for(let i=0;i<length;i++){
    dc+=alpha*(data[i]-dc);data[i]-=dc;
    peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]*data[i];
  }
  const rms=Math.sqrt(sum/Math.max(1,length));
  const gain=peak>.003?Math.min(5,.87/peak,.20/Math.max(rms,.001)):1;
  for(let i=0;i<length;i++)data[i]*=gain;
  return {data,sampleRate,duration:length/sampleRate,peak:peak*gain,rms:rms*gain};
}

/**
 * 20msごとに声のエネルギーを観察する。音声認識ではなく、自然な間を保つための検出。
 * 無音区間の短い穴を埋めた後にフレーズを作り、長い発話だけを小さい音量の谷で分割。
 */
export function analyzeVoice(input){
  const {data,sampleRate:sr}=input;
  const total=data.length/sr,hop=Math.max(128,Math.round(.02*sr));
  const energy=[];let peak=0;
  for(let i=0;i<data.length;i+=hop){
    let sum=0,count=0;
    for(let k=i;k<Math.min(i+hop,data.length);k+=2){sum+=data[k]*data[k];count++;}
    const v=Math.sqrt(sum/Math.max(1,count));energy.push(v);peak=Math.max(peak,v);
  }
  if(!energy.length||peak<.002)return {phrases:[],fragments:[],active:false,energy:peak};
  const sorted=energy.filter(x=>x>peak*.07).sort((a,b)=>a-b);
  const median=sorted[Math.floor(sorted.length*.5)]||peak;
  const threshold=Math.max(.0025,Math.min(peak*.25,median*.28));
  const active=energy.map(v=>v>=threshold);
  // 短い子音間の隙間を語句の切れ目と誤認しない。
  const bridge=Math.ceil(.105*sr/hop);
  for(let i=0;i<active.length;){
    if(active[i]){i++;continue;}
    let j=i;while(j<active.length&&!active[j])j++;
    if(i>0&&j<active.length&&j-i<=bridge)for(let k=i;k<j;k++)active[k]=true;
    i=j;
  }
  let intervals=[];
  for(let i=0;i<active.length;){
    if(!active[i]){i++;continue;}
    let j=i;while(j<active.length&&active[j])j++;
    if((j-i)*hop/sr>=.15)intervals.push({start:Math.max(0,i*hop/sr-.023),end:Math.min(total,j*hop/sr+.037)});
    i=j;
  }
  if(!intervals.length){
    const at=energy.indexOf(peak)*hop/sr;
    intervals=[{start:clamp(at-.14,0,total),end:clamp(at+.3,0,total)}];
  }
  // 長すぎるフレーズは最も静かな谷を探し、語句の真ん中の切断を最小限にする。
  function splitRegion(a,b){
    const len=b-a;
    if(len<=3.0)return [{start:a,end:b}];
    const lo=a+Math.min(1.35,len*.39),hi=Math.min(b-.55,a+2.7);
    if(hi<=lo)return [{start:a,end:b}];
    let pivot=(lo+hi)/2,best=Infinity;
    for(let t=lo;t<=hi;t+=.04){
      const fi=Math.round(t*sr/hop);
      let e=0;
      for(let j=-2;j<=2;j++)e+=energy[clamp(fi+j,0,energy.length-1)];
      if(e<best){best=e;pivot=t;}
    }
    return [...splitRegion(a,pivot),...splitRegion(pivot,b)];
  }
  intervals=intervals.flatMap(x=>splitRegion(x.start,x.end));
  const phrases=intervals.map(x=>{
    const a=clamp(x.start,0,total),b=clamp(x.end,0,total);
    const from=Math.floor(a*sr/hop),to=Math.ceil(b*sr/hop);
    let power=0,n=0;
    for(let i=from;i<Math.min(energy.length,to);i++){power+=energy[i];n++;}
    return {start:a,len:b-a,rms:power/Math.max(1,n)};
  }).filter(p=>p.len>=.14);
  phrases.sort((a,b)=>(b.len*.68+b.rms*.8)-(a.len*.68+a.rms*.8));
  const fragments=[];
  for(const p of phrases){
    // 粒子は補助素材。150msより短い断片に切り続けない。
    const count=clamp(Math.floor(p.len/.47),1,7),step=p.len/count;
    for(let j=0;j<count;j++)fragments.push({start:p.start+j*step,len:Math.min(step+.045,.9),rms:p.rms});
  }
  return {phrases,fragments,active:phrases.length>0,energy:peak};
}

const RECIPES=[
  {id:'PHRASE',tag:'PHRASE LOOP',weight:30},
  {id:'MANTRA',tag:'MANTRA',weight:25},
  {id:'RAP',tag:'LOOSE RAP',weight:20},
  {id:'CHOIR',tag:'GHOST CHOIR',weight:15},
  {id:'BROKEN',tag:'BROKEN VOICE',weight:10},
];
export function makeDna(seed){
  const rng=mulberry32(seed>>>0);
  let value=rng()*100;let recipe=RECIPES[0];
  for(const candidate of RECIPES){value-=candidate.weight;if(value<0){recipe=candidate;break;}}
  const bpm=Math.round(random(rng,92,133));
  return {...recipe,seed:seed>>>0,sprite:(rng()*0xFFFFFFFF)>>>0,bpm,
    bugEnergy:random(rng,.75,1.34)};
}
function voiceSample(data,x){
  const k=Math.floor(x),f=x-k;
  if(k<0||k>=data.length-1)return 0;
  return mix(data[k],data[k+1],f);
}
/**
 * 1つの語句を時刻位置に再生する。cleanは波形を極力そのまま保持。
 * pitchは約90msの重なり合う粒で音程と発話速度を独立させる軽量処理。
 * 詳細な位相同期はしないため、pitchは変奏に限定し、原音の主題を常に残す。
 */
function paste(out,input,e){
  const src=input.data,sr=input.sampleRate;
  const srcStart=clamp(e.src.start,0,src.length/sr)*sr;
  const srcLen=Math.min(e.src.len*sr,src.length-srcStart);
  const seconds=clamp(e.duration??e.src.len,.055,4.25);
  const n=Math.max(1,Math.round(seconds*RATE));
  if(srcLen<24)return;
  const outAt=Math.round(e.time*RATE),outN=out.left.length;
  const gain=e.gain??.7,pan=clamp(e.pan??0,-1,1);
  const gainL=gain*Math.cos((pan+1)*Math.PI/4),gainR=gain*Math.sin((pan+1)*Math.PI/4);
  const fadeIn=Math.min(.02*n,Math.round(.012*RATE)),fadeOut=Math.min(.07*n,Math.round(.035*RATE));
  const sourceAdvance=srcLen/n;
  const pitch=Math.pow(2,clamp(e.pitch??0,-3,9)/12);
  const isPitched=e.style==='pitch'&&Math.abs(e.pitch??0)>.1;
  const isReverse=e.style==='reverse';
  const ring=e.ring??0;
  const hop=Math.round(RATE*.042),grain=hop*2;
  let low=0;const filter=e.filter??13500,alpha=1-Math.exp(-TAU*filter/RATE);
  for(let i=0;i<n;i++){
    const idx=(outAt+i)%outN;if(idx<0)continue;
    let v;
    if(isPitched){
      const g0=Math.floor(i/hop)*hop;
      let acc=0,weight=0;
      for(const g of [g0-hop,g0]){
        const local=i-g;if(local<0||local>=grain)continue;
        const w=.5-.5*Math.cos(TAU*local/(grain-1));
        const position=srcStart+g*sourceAdvance+local*pitch*sr/RATE;
        acc+=voiceSample(src,position)*w;weight+=w;
      }
      v=weight>1e-5?acc/weight:0;
    }else{
      const position=isReverse?(srcStart+srcLen-1-i*sourceAdvance):(srcStart+i*sourceAdvance);
      v=voiceSample(src,position);
    }
    low+=alpha*(v-low);v=low;
    if(ring)v*=.66+.34*Math.sin(TAU*ring*i/RATE);
    const env=clamp(Math.min(1,i/Math.max(1,fadeIn),(n-1-i)/Math.max(1,fadeOut)),0,1);
    out.left[idx]+=v*env*gainL;out.right[idx]+=v*env*gainR;
  }
}

/** 4章の物語構造。主題 / 変奏 / 逸脱 / 回帰。 */
function buildVoice(input,analysis,dna,rng,frames,cell){
  const out=layers(frames),primary=analysis.phrases[0];
  if(!primary)return out;
  const rest=analysis.phrases.filter(p=>p!==primary);
  const secondary=rest.length?pick(rng,rest):primary;
  const full=(source=primary,limit=cell*.90)=>({start:source.start,len:Math.min(source.len,limit)});
  const play=(section,source,options={})=>paste(out,input,{
    time:section*cell+(options.offset??.10),src:source,duration:options.duration??source.len,
    gain:options.gain??.65,pan:options.pan??0,style:options.style??'clean',
    pitch:options.pitch??0,filter:options.filter??13000,ring:options.ring??0,
  });
  // 全レシピの入口には一つ聞き取れる主題を置く。BROKENも例外にしない。
  const main=full();
  play(0,main,{offset:.07,gain:.83});
  if(dna.id==='PHRASE'){
    // 声のほぼ全体をA→A'→B→Aと展開する。語尾だけの反復を装飾に使う。
    play(1,main,{offset:.10,gain:.68,style:'pitch',pitch:pick(rng,[2,3,4])});
    play(2,full(secondary),{offset:.12,gain:.71,style:pick(rng,['pitch','clean']),pitch:pick(rng,[0,3,5])});
    const tail={start:main.start+main.len*.62,len:main.len*.38};
    if(tail.len>.12)play(2,tail,{offset:cell*.68,duration:Math.min(tail.len,cell*.22),gain:.30,pan:.30});
    play(3,main,{offset:.07,gain:.86});
    if(main.len>.4)play(3,{start:main.start+main.len*.72,len:main.len*.28},{offset:cell*.74,gain:.24,pan:-.3});
  }else if(dna.id==='MANTRA'){
    // 声の抑揚ごと短い詠唱を反復。音節を機械的に16分割しない。
    const mantra=full(primary,Math.min(cell*.54,1.65));
    for(let section=0;section<4;section++){
      if(section!==0)play(section,mantra,{offset:.07,gain:section===3?.79:.67,
        style:section===2?'pitch':'clean',pitch:section===2?3:0});
      const secondAt=Math.min(cell*.56,mantra.len+random(rng,.17,.35));
      if(secondAt+mantra.len<cell+.14){
        play(section,mantra,{offset:secondAt,gain:.49,style:section%2?'pitch':'clean',pitch:section%2?2:0,pan:section%2?.18:-.18});
      }
    }
    if(main.len>.35)play(2,{start:main.start+main.len*.4,len:main.len*.4},{offset:cell*.77,gain:.22,style:'reverse'});
  }else if(dna.id==='RAP'){
    // 全体は語句のまとまりのまま。A'の先取り・休符・末尾の重複でラップらしいフロウ。
    play(1,full(secondary,cell*.60),{offset:.04,gain:.75,duration:Math.min(secondary.len,cell*.55)});
    const phrase=full(primary,cell*.54);
    play(1,phrase,{offset:cell*.57,gain:.65,duration:Math.min(phrase.len,cell*.36)});
    const call=full(primary,cell*.42),response=full(secondary,cell*.44);
    play(2,call,{offset:.02,gain:.72,duration:Math.min(call.len,cell*.38)});
    play(2,response,{offset:cell*.49,gain:.69,duration:Math.min(response.len,cell*.37),style:'pitch',pitch:2});
    const end={start:main.start+main.len*.65,len:main.len*.35};
    play(3,main,{offset:.06,gain:.80});
    if(end.len>.13)for(let i=0;i<2;i++){
      play(3,end,{offset:cell*.69+i*cell*.13,duration:Math.min(end.len,cell*.12),gain:.25-i*.06,pan:i?-.2:.2});
    }
  }else if(dna.id==='CHOIR'){
    // 元のフレーズの背後に薄い歌声を追加。厚いコード伴奏にはしない。
    for(let section=0;section<4;section++){
      if(section!==0)play(section,full(section===2?secondary:primary),{offset:.08,gain:.66});
      const line=full(section===2?secondary:primary,cell*.83);
      play(section,line,{offset:.14,gain:.32,pan:-.4,style:'pitch',pitch:section===2?5:3,filter:8200});
      if(section===1||section===3)play(section,line,{offset:.18,gain:.19,pan:.4,style:'pitch',pitch:-2,filter:6800});
    }
  }else if(dna.id==='BROKEN'){
    // v0.2のような粒子・逆再生は2〜3章のみ。冒頭と終章は原音を戻す。
    const fragments=analysis.fragments.length?analysis.fragments:[primary];
    play(1,full(secondary,cell*.46),{offset:.11,gain:.56,style:'pitch',pitch:4});
    for(let section=1;section<=2;section++){
      const count=section===1?4:7;
      for(let i=0;i<count;i++){
        const sample=pick(rng,fragments),s={start:sample.start,len:Math.min(sample.len,random(rng,.14,.38))};
        play(section,s,{offset:cell*(i+.25)/(count+.5),duration:Math.min(s.len,.33),
          gain:random(rng,.22,.39),pan:random(rng,-.5,.5),style:pick(rng,['reverse','pitch','clean']),
          pitch:pick(rng,[0,2,4,7]),ring:rng()<.18?random(rng,70,140):0});
      }
    }
    play(3,main,{offset:.09,gain:.85});
  }
  // 控えめな語尾のエコー。拍で毎回鳴るドラム的なディレイにはしない。
  if(dna.id==='PHRASE'||dna.id==='MANTRA'||dna.id==='CHOIR'){
    const tap=Math.round(random(rng,.20,.36)*RATE),decay=dna.id==='CHOIR'?.095:.07;
    for(const channel of [out.left,out.right]){
      const dry=channel.slice();
      for(let i=tap;i<frames;i++)channel[i]+=dry[i-tap]*decay;
    }
  }
  return out;
}

/** 数音だけの補助電子音。キック・スネア固定配置やハイハット連打をしない。 */
function smallTone(out,at,type,rng,gain,pitch=0){
  const length={plop:.18,click:.05,blip:.14}[type];
  const start=Math.round(at*RATE),size=out.left.length,n=Math.round(length*RATE);
  let phase=0,lp=0;
  for(let i=0;i<n;i++){
    const t=i/RATE,noise=rng()*2-1;
    let v=0;
    if(type==='plop'){
      phase+=TAU*(108+pitch*13+100*Math.exp(-t*28))/RATE;
      v=(Math.sin(phase)+.17*Math.sin(phase*2))*Math.exp(-t*26);
    }else if(type==='click'){
      lp+=.12*(noise-lp);v=(noise-lp)*Math.exp(-t*92);
    }else{
      phase+=TAU*(380+pitch*69+15*Math.sin(t*37))/RATE;
      v=Math.sin(phase)*Math.exp(-t*34);
    }
    const atSample=start+i;
    if(atSample<0||atSample>=size)continue;
    const p=type==='blip'?.23:-.14,gl=Math.cos((p+1)*Math.PI/4)*gain,gr=Math.sin((p+1)*Math.PI/4)*gain;
    out.left[atSample]+=v*gl;out.right[atSample]+=v*gr;
  }
}
function buildGroove(input,analysis,dna,rng,frames,cell){
  const out=layers(frames);
  if(!analysis.active)return out;
  // 1章あたり平均1〜3発、ゼロの章もあり。レシピは音数を変えるだけ。
  for(let s=0;s<4;s++){
    if(s===2&&rng()<.23)continue;
    const hits=s===0?1:pick(rng,[1,2,2,3]);
    const slots=[cell*.15,cell*.39,cell*.68,cell*.85];
    for(let j=0;j<hits;j++){
      const t=s*cell+slots[(j+s)%slots.length]+random(rng,-.065,.065);
      const type=j===0?pick(rng,['plop','plop','click']):pick(rng,['click','blip','plop']);
      smallTone(out,clamp(t,0,frames/RATE-.21),type,rng,type==='click'?.11:.22,Math.floor(rng()*4));
    }
  }
  return out;
}
function info(layer){
  let peak=0,sum=0;
  for(let i=0;i<layer.left.length;i+=3){const l=layer.left[i],r=layer.right[i];peak=Math.max(peak,Math.abs(l),Math.abs(r));sum+=l*l+r*r;}
  return {peak,rms:Math.sqrt(sum/Math.max(1,Math.ceil(layer.left.length/3)*2))};
}
function edgeFade(layer){
  // ループの切れ目は必ず非常に短い無音クロスフェードで抑える。
  const n=Math.min(400,Math.floor(layer.left.length/8));
  for(const arr of [layer.left,layer.right])for(let i=0;i<n;i++){
    const w=Math.sin(Math.PI*.5*i/n);
    arr[i]*=w;arr[arr.length-1-i]*=w;
  }
}
function normalize(voice,groove){
  const v=info(voice),g=info(groove);
  const vg=v.peak>.0002?Math.min(4.3,.88/v.peak,.155/Math.max(v.rms,.0001)):1;
  for(let i=0;i<voice.left.length;i++){
    voice.left[i]=Math.tanh(voice.left[i]*vg)*.94;
    voice.right[i]=Math.tanh(voice.right[i]*vg)*.94;
  }
  const vr=info(voice);
  // v0.3程度の存在感。v0.5のRMS比0.5前後を目指さず0.20前後を中心にする。
  const gg=g.rms>.000001?Math.min(2.8,vr.rms*.22/g.rms,.37/Math.max(.0001,g.peak)):0;
  for(let i=0;i<groove.left.length;i++){
    groove.left[i]*=gg;groove.right[i]*=gg;
  }
  edgeFade(voice);edgeFade(groove);
  // 再生では二つの音声ソースを加算するため、WAV書き出し時の波形と一致させる。
  // 重なりが過大な箇所だけ、両レイヤーを同率で抑え、合計がクリップしないようにする。
  let sumPeak=0;
  for(let i=0;i<voice.left.length;i++){
    sumPeak=Math.max(sumPeak,Math.abs(voice.left[i]+groove.left[i]),Math.abs(voice.right[i]+groove.right[i]));
  }
  if(sumPeak>.94){
    const scale=.94/sumPeak;
    for(let i=0;i<voice.left.length;i++){
      voice.left[i]*=scale;voice.right[i]*=scale;
      groove.left[i]*=scale;groove.right[i]*=scale;
    }
  }
}
export function hatch(input,seed){
  if(!input?.data?.length||!(input.sampleRate>0))throw Error('No recorded audio.');
  const dna=makeDna(seed),analysis=analyzeVoice(input);
  const primary=analysis.phrases[0];
  const phraseLength=primary?.len??.8;
  const rng=mulberry32(seed^0xC12F25);
  const cell=clamp(phraseLength*random(rng,1.14,1.48)+.32,1.72,3.7);
  const frames=Math.round(cell*4*RATE);
  const voice=buildVoice(input,analysis,dna,mulberry32(seed^0xB01234),frames,cell);
  const groove=buildGroove(input,analysis,dna,mulberry32(seed^0x5A5501),frames,cell);
  normalize(voice,groove);
  return {voice,groove,sampleRate:RATE,duration:frames/RATE,dna:{...dna,seconds:frames/RATE,cell},
    analysis:{phraseCount:analysis.phrases.length,fragmentCount:analysis.fragments.length}};
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
  const {left,right,sampleRate}=audio,buf=new ArrayBuffer(44+left.length*4),v=new DataView(buf);
  const word=(offset,text)=>{for(let i=0;i<text.length;i++)v.setUint8(offset+i,text.charCodeAt(i));};
  word(0,'RIFF');v.setUint32(4,36+left.length*4,true);word(8,'WAVE');word(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);
  v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);
  word(36,'data');v.setUint32(40,left.length*4,true);
  let offset=44;for(let i=0;i<left.length;i++){
    v.setInt16(offset,Math.round(clamp(left[i],-1,1)*32767),true);
    v.setInt16(offset+2,Math.round(clamp(right[i],-1,1)*32767),true);offset+=4;
  }
  return new Blob([buf],{type:'audio/wav'});
}
