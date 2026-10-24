import {applyStepMutations,applyMovingPan,applyToyDelay,applyShortDelay,planToyMusic,renderToyMusic,duckSynthAgainstVoice} from './music-fx.js';
/**
 * LITTLE BUGS v1.1.4 — DYNAMICS & DELAY POLISH
 *
 * 設計原則：短い声をドラム用の極小断片に分解するのではなく、
 * 先に息継ぎ・無音・発音のまとまりからフレーズを抽出する。
 * 4章構成（主題→変奏→逸脱→回帰）で声を反復させ、粒子化は局所的な装飾に限定する。
 * 異なる5種の作曲規則を用意し、原音を認識できる箇所と大胆な変異を共存させる。
 * 極端な低音化を防ぐため、主題は自然速度に近い再生を基本にする。
 * GROOVEは声の発音イベントに追従する別レイヤー。完成した音声へいつでもON/OFFできる。
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

/**
 * 録音の後処理。DC/超低域を取り除き、静かな区間だけを穏やかに減衰。
 * スペクトル全域に強いゲートをかけると「サ行」「息」が壊れるため、
 * 極端なノイズ除去を避けた補助処理とする。ブラウザー側のノイズ抑制と併用。
 */
export function monoFromAudioBuffer(buffer){
  const {numberOfChannels,length,sampleRate}=buffer;
  const data=new Float32Array(length);
  for(let c=0;c<numberOfChannels;c++){
    const channel=buffer.getChannelData(c);
    for(let i=0;i<length;i++)data[i]+=channel[i]/numberOfChannels;
  }
  // 2段ハイパス（直流・空調の低域を抑制）。音声帯域に届きすぎないよう95Hz。
  const decay=Math.exp(-TAU*95/sampleRate);
  let x1=0,y1=0,x2=0,y2=0;
  for(let i=0;i<length;i++){
    const x=data[i],a=decay*(y1+x-x1);x1=x;y1=a;
    const b=decay*(y2+a-x2);x2=a;y2=b;data[i]=b;
  }
  // 20msごとのRMSから静かな環境音レベルを推定。
  const hop=Math.max(64,Math.round(sampleRate*.02)),levels=[];
  let peak=0,sum=0;
  for(let j=0;j<length;j+=hop){
    let energy=0,n=0;
    for(let i=j;i<Math.min(length,j+hop);i+=2){energy+=data[i]*data[i];n++;}
    levels.push(Math.sqrt(energy/Math.max(1,n)));
  }
  const sorted=levels.slice().sort((a,b)=>a-b);
  const floor=sorted[Math.floor(sorted.length*.22)]||0;
  const loud=sorted[Math.floor(sorted.length*.92)]||0;
  // 常にノイズしかない場合、無理に声として増幅しない。
  // 無音に近い部屋ではゲート不要。ノイズに近い信号も不自然に削りすぎない。
  const threshold=(floor>.0009&&loud>floor*1.8)?floor*2.3:0;
  let env=0,mask=1;
  const envRise=1-Math.exp(-1/(sampleRate*.006));
  const envFall=1-Math.exp(-1/(sampleRate*.085));
  const gateRise=1-Math.exp(-1/(sampleRate*.016));
  const gateFall=1-Math.exp(-1/(sampleRate*.11));
  for(let i=0;i<length;i++){
    const amp=Math.abs(data[i]);env+=(amp>env?envRise:envFall)*(amp-env);
    let target=1;
    if(threshold){
      const ratio=clamp((env-threshold*.55)/(threshold*1.5),0,1);
      const smooth=ratio*ratio*(3-2*ratio);
      target=.25+.75*smooth;
    }
    mask+=(target>mask?gateRise:gateFall)*(target-mask);
    data[i]*=mask;
    peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]*data[i];
  }
  const rms=Math.sqrt(sum/Math.max(1,length));
  const gain=peak>.003?Math.min(3.5,.85/peak,.18/Math.max(rms,.001)):1;
  for(let i=0;i<length;i++)data[i]*=gain;
  return {data,sampleRate,duration:length/sampleRate,peak:peak*gain,rms:rms*gain,
    noiseFloor:floor,noiseGate:threshold>0};
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

/**
 * 発話の有声音から大まかな基音を検出する。
 * 3つの短い窓で、平均を引いた波形の正規化自己相関を計算。
 * 「しゃべり声全体の音階を正確に抽出」するものではなく、補助音の音高を
 * 録音と極端に乖離させないためだけの控えめな推定として使用する。
 * 無声子音・雑音などで周期性が弱い場合は null を返し、音程のある伴奏を出さない。
 */
export function estimateVoicePitch(input,analysis){
  const source=analysis?.phrases?.[0];
  if(!source || source.len<.19)return null;
  const sr=input.sampleRate,step=Math.max(1,Math.round(sr/10000));
  const effective=sr/step,windowSamples=Math.min(Math.round(.065*effective),Math.floor(source.len*effective*.85));
  if(windowSamples<300)return null;
  const candidates=[];
  for(const portion of [.22,.48,.72]){
    const center=(source.start+source.len*portion)*sr;
    const from=Math.max(0,Math.floor(center-windowSamples*step*.5));
    if(from+(windowSamples-1)*step>=input.data.length)continue;
    const values=new Float32Array(windowSamples);let mean=0,energy=0;
    for(let i=0;i<windowSamples;i++){const v=input.data[from+i*step];values[i]=v;mean+=v;}
    mean/=windowSamples;
    for(let i=0;i<windowSamples;i++){values[i]-=mean;energy+=values[i]*values[i];}
    if(energy/windowSamples<.00008)continue;
    const minLag=Math.round(effective/380),maxLag=Math.round(effective/105);
    let best=0,bestLag=0;
    for(let lag=minLag;lag<=maxLag;lag++){
      let correlation=0,a=0,b=0;
      for(let i=0;i<windowSamples-lag;i++){
        const x=values[i],y=values[i+lag];correlation+=x*y;a+=x*x;b+=y*y;
      }
      const score=correlation/Math.sqrt(Math.max(1e-12,a*b));
      // 倍音で2倍の周波数を選ぶ場合を減らすため、ほぼ同率なら長い周期を優先。
      if(score>best+.015 || (score>best-.015&&score>.72&&lag>bestLag)){
        best=score;bestLag=lag;
      }
    }
    if(best>.68&&bestLag>0)candidates.push(effective/bestLag);
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>a-b);
  const mid=candidates[Math.floor(candidates.length/2)];
  if(candidates.length>1&&candidates.at(-1)/candidates[0]>1.52)return null;
  return Math.round(mid*10)/10;
}

// 音声の時間構成（レシピ）と音色の性格（FX）を分離する。
// エコーを全パターンの最後に掛けると、違うレシピでも同じ音に聴こえる。
// DRY系を過半数にして、空間の余白があるエイリアン声を意図的に増やす。
export const FX_IDENTITIES=[
  {id:'ALIEN',weight:24,tag:'HIGH SPEED / DRY'},
  {id:'CUTUP',weight:19,tag:'RHYTHMIC REPEAT'},
  {id:'FILTER',weight:17,tag:'FILTER MOTION'},
  {id:'CRUSH',weight:17,tag:'PIXEL DECAY'},
  {id:'CRYSTAL',weight:14,tag:'PITCHED SPARKS'},
  {id:'ECHO',weight:9,tag:'SPATIAL ECHO'},
];
const RECIPES=[
  {id:'PHRASE',tag:'SHIFTED SPEECH',weight:20},
  {id:'MANTRA',tag:'CHANT MACHINE',weight:20},
  {id:'RAP',tag:'TALK RHYTHM',weight:20},
  {id:'CHOIR',tag:'VOWEL CHOIR',weight:20},
  {id:'BROKEN',tag:'RIPPED TAPE',weight:20},
];
export function makeDna(seed){
  const rng=mulberry32(seed>>>0);
  let value=rng()*100;let recipe=RECIPES[0];
  for(const candidate of RECIPES){value-=candidate.weight;if(value<0){recipe=candidate;break;}}
  const bpm=Math.round(random(rng,118,164));
  const fxRandom=mulberry32((seed^0x9E3779B9)>>>0);
  let fxValue=fxRandom()*100, fx=FX_IDENTITIES[0];
  for(const item of FX_IDENTITIES){fxValue-=item.weight;if(fxValue<0){fx=item;break;}}
  return {...recipe,seed:seed>>>0,sprite:(rng()*0xFFFFFFFF)>>>0,bpm,
    fxIdentity:fx.id, fxTag:fx.tag,bugEnergy:random(rng,.75,1.34)};
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
  let low=0;const filter=Math.min(e.filter??13500,isPitched?(e.pitch>=7?4400:e.pitch>=4?6100:8500):13500);
  const alpha=1-Math.exp(-TAU*filter/RATE);
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
      // 高音だけが宙に浮いて聞こえないよう、同じ声の自然な音色を少し混ぜる。
      // ピッチ処理を完全には打ち消さず、子音やフォルマントを元音側へ寄せる。
      const anchor=Math.abs(e.pitch??0)>=5?.30:.18;
      v=mix(v,voiceSample(src,srcStart+i*sourceAdvance),anchor);
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

/**
 * Bugの音響性格ごとに、異なる演奏と音色を与える。
 * 原音の声を丸ごと加工し続けるのではなく、必要な区間だけ置換する。
 * 全ての変更は一定の種から決まり、同じBugのWAVを再現できる。
 */
function duckForSolo(layer,start,duration,amount){
  const first=Math.max(0,Math.floor(start*RATE));
  const last=Math.min(layer.left.length,Math.floor((start+duration)*RATE));
  const edge=Math.min(Math.floor(RATE*.023),Math.floor((last-first)/4));
  for(let i=first;i<last;i++){
    const local=i-first;
    const fade=clamp(Math.min(local/Math.max(1,edge),(last-1-i)/Math.max(1,edge)),0,1);
    const g=1-amount*fade;
    layer.left[i]*=g;layer.right[i]*=g;
  }
}
/** テープ倍速で声の音程まで上昇させ、長い残響を作らない小さな異星人。 */
function addAlienPhrases(layer,input,analysis,dna,cell){
  const rng=mulberry32(dna.seed^0xA1E98);
  const phrases=analysis.phrases;
  if(!phrases.length)return 0;
  const count=3 + (dna.seed%2);
  for(let j=0;j<count;j++){
    const src=phrases[j%phrases.length];
    const len=Math.min(src.len,random(rng,.42,1.0));
    if(len<.13)continue;
    const speed=random(rng,1.52,2.02);
    const duration=len/speed;
    const bar=[0,1,2,3][j];
    const start=bar*cell+(j%2?.73:.20)*60/dna.bpm;
    // 変異声が鳴る時、元のフレーズの重なりを減らす。
    duckForSolo(layer,start,duration,.81);
    paste(layer,input,{time:start,src:{start:src.start,len},duration,
      style:'speed',gain:random(rng,.83,1.04),filter:random(rng,5100,8200),
      pan:j%2?.24:-.21});
    layer.events.push({time:start,end:start+duration,duration,gain:.8,style:'speed'});
  }
  return count;
}
/** タイムストレッチによる上方向の声を短く返す。長いディレイは使わない。 */
function addCrystalPhrases(layer,input,analysis,dna,cell){
  const phrases=analysis.phrases;
  if(!phrases.length)return 0;
  const rng=mulberry32(dna.seed^0xCBF124);
  let hits=0;
  for(const bar of [0,2,3]){
    const src=phrases[bar%phrases.length];
    const len=Math.min(.34,Math.max(.16,src.len*.46));
    const fragment={start:src.start+Math.max(0,src.len-len),len};
    const start=bar*cell+cell*.48;
    const count=bar===2?3:2;
    for(let j=0;j<count;j++){
      const at=start+j*60/dna.bpm*(bar===2?.34:.50);
      if(at+len>=layer.left.length/RATE-.05)continue;
      paste(layer,input,{time:at,src:fragment,duration:len,
        style:j===0&&bar===3?'reverse':'pitch',pitch:[5,9,12][j],
        filter:random(rng,3900,6200),gain:.36*Math.pow(.67,j),pan:j%2?.36:-.32});
      hits++;
    }
  }
  return hits;
}
/** 量子化＋サンプルホールド。音のある区間だけに作用し、急な境界はフェード。 */
export function applySelectiveCrush(layer,dna,events,rate=RATE){
  const rng=mulberry32(dna.seed^0x5A4E1);
  const original=[layer.left.slice(),layer.right.slice()];
  const candidates=(events||[]).filter(e=>e.duration>=.24&&e.gain>=.38);
  if(!candidates.length)return 0;
  let hits=0;
  const barLength=layer.left.length/rate/4;
  for(let bar=0;bar<4;bar++){
    const local=candidates.filter(e=>e.time<barLength*(bar+1)&&e.end>barLength*bar);
    if(!local.length)continue;
    const e=local[Math.floor(rng()*local.length)];
    const start=Math.max(barLength*bar+.04,e.time+.035);
    const duration=Math.min(random(rng,.28,.68),e.end-start,barLength*(bar+1)-start-.06);
    if(duration<.12)continue;
    const begin=Math.floor(start*rate),end=Math.min(layer.left.length,Math.floor((start+duration)*rate));
    const levels=2**Math.floor(random(rng,6,10));
    const holdSamples=Math.floor(random(rng,4,11));
    const wet=random(rng,.57,.76);
    const edge=Math.max(1,Math.round(Math.min(.026,duration*.22)*rate));
    const alphaLP=1-Math.exp(-2*Math.PI*4300/rate);
    const alphaHP=1-Math.exp(-2*Math.PI*135/rate);
    // 30ms前後のエネルギー追従。粗い量子化による一時的な音圧増大だけを抑える。
    const powerAlpha=1-Math.exp(-1/(rate*.028));
    const gainAlpha=1-Math.exp(-1/(rate*.014));
    const channelState=[0,1].map(()=>({hold:0,lp:0,bass:0,dryPower:.00008,wetPower:.00008,gain:1}));
    for(let i=begin;i<end;i++){
      const k=i-begin;
      const boundary=clamp(Math.min(k/edge,(end-1-i)/edge),0,1);
      const fade=boundary*boundary*(3-2*boundary);
      for(let c=0;c<2;c++){
        const state=channelState[c];
        const src=original[c],target=c?layer.right:layer.left;
        const dry=src[i];
        if(k%holdSamples===0)state.hold=Math.round(dry*levels)/levels;
        // サンプルホールドの鋭い段差を少し和らげ、DC/低域成分を除く。
        state.lp+=alphaLP*(state.hold-state.lp);
        state.bass+=alphaHP*(state.lp-state.bass);
        const crushed=state.lp-state.bass;
        // 量子化後のRMSが原音より大きい場合のみ、局所ゲインを徐々に下げる。
        state.dryPower+=powerAlpha*(dry*dry-state.dryPower);
        state.wetPower+=powerAlpha*(crushed*crushed-state.wetPower);
        const ratio=Math.sqrt((state.dryPower+.00008)/(state.wetPower+.00008));
        const targetGain=clamp(ratio*1.08,.54,1);
        state.gain+=gainAlpha*(targetGain-state.gain);
        target[i]=mix(dry,crushed*state.gain,wet*fade);
      }
    }
    hits++;
  }
  return hits;
}

/**
 * BPMに同期した2-pole SVF の可変ローパス＋共振帯域。
 * FilterFreakの「リズム/エンベロープ・フォロワーの思想」を参照した独立DSP。
 * 実製品のアルゴリズムや音色を再現するものではない。
 * 8ステップのフィルター開閉がカットアップにグルーヴを与える。
 */
export function applyRhythmicFilter(layer,dna,rng,wetOverride=null){
  const beat=60/dna.bpm,n=layer.left.length;
  const pattern=pick(rng,[
    [.80,.34,.60,.45,.90,.32,.55,.40],
    [.55,.82,.28,.72,.40,.89,.24,.64],
    [.30,.36,.85,.45,.34,.80,.60,.92],
    [.84,.23,.66,.38,.72,.26,.58,.91],
  ]);
  const wet=wetOverride??(dna.id==='BROKEN'?.50:dna.id==='CHOIR'?.27:.39);
  const q=dna.id==='BROKEN'?1.0:.73;
  const base=pick(rng,[680,900,1150,1450]);
  const range=pick(rng,[1900,2700,3350,4250]);
  const stepLength=Math.max(1,Math.round(beat*.5*RATE));
  const process=(arr)=>{
    let ic1=0,ic2=0,cut=2700,follow=0;
    let g=0,k=1/q,a1=0,a2=0,a3=0;
    const modSpeed=1-Math.exp(-1/(RATE*.025));
    const followUp=1-Math.exp(-1/(RATE*.009));
    const followDown=1-Math.exp(-1/(RATE*.065));
    for(let i=0;i<n;i++){
      const x=arr[i];
      follow+= (Math.abs(x)>follow?followUp:followDown)*(Math.abs(x)-follow);
      const step=Math.floor(i/stepLength)%pattern.length;
      const amplitude=pattern[step];
      // 発話でフィルターが開き、シーケンスの刻みで閉じる。
      const target=clamp(base+range*(amplitude*.77+clamp(follow*4,0,.28)),430,8300);
      cut+=(target-cut)*modSpeed;
      if(i%32===0){
        g=Math.tan(Math.PI*cut/RATE);a1=1/(1+g*(g+k));a2=g*a1;a3=g*a2;
      }
      const v3=x-ic2;
      const band=a1*ic1+a2*v3;
      const low=ic2+a2*ic1+a3*v3;
      ic1=2*band-ic1;ic2=2*low-ic2;
      const resonant=low*.92+band*.31;
      const y=(1-wet)*x+wet*resonant;
      arr[i]=Math.tanh(y*1.18)/1.1;
    }
  };
  process(layer.left);process(layer.right);
}

/**
 * EchoBoyの「マルチタップをグリッド/スウィングに配置する発想」を参照。
 * 8分・付点8分・3/16などの組み合わせで、声の空白に音響的な拍子を作る。
 * 往復は短く、ハイパス+ローパスで声が濁らない帯域に抑える。
 */
export function applyRhythmEcho(layer,dna,rng){
  const beat=60/dna.bpm,n=layer.left.length;
  const patterns=[
    [[.75,.27],[1.5,.16],[2.25,.085]],
    [[.50,.22],[1.25,.24],[2.0,.12]],
    [[.75,.29],[1.75,.15],[2.50,.09]],
    [[.375,.20],[1.00,.19],[1.875,.11]],
  ];
  const mode=pick(rng,patterns);
  const swing=random(rng,-.06,.09)*beat;
  const dryL=layer.left.slice(),dryR=layer.right.slice();
  const delayed=layers(n);
  const taps=mode.map(([beats,gain],i)=>({
    offset:Math.max(1,Math.round((beats*beat+(i%2?swing:0))*RATE)),gain
  }));
  const wrap=i=>(i%n+n)%n;
  // 純粋な声のコピーを加工するので、別の「ドラム」が勝手に走らない。
  for(const {offset,gain} of taps){
    for(let i=0;i<n;i++){
      const j=wrap(i-offset);
      delayed.left[i]+=dryR[j]*gain;
      delayed.right[i]+=dryL[j]*gain;
    }
  }
  const high=1-Math.exp(-TAU*250/RATE),low=1-Math.exp(-TAU*4200/RATE);
  // 声のある瞬間はエコーを控え、無音にエコーが浮かぶようダッキング。
  for(const [dest,src,other] of [[layer.left,delayed.left,dryL],[layer.right,delayed.right,dryR]]){
    let bass=0,treble=0,follow=0;
    for(let i=0;i<n;i++){
      bass+=high*(src[i]-bass);
      treble+=low*((src[i]-bass)-treble);
      follow+=.0012*(Math.abs(other[i])-follow);
      const duck=clamp(.98-follow*1.5,.60,1);
      dest[i]+=treble*duck;
    }
  }
}

/**
 * 変異音の作曲エンジン。
 * 大切なのは「5つの音色違い」ではなく「5つの違う時間構造」にすること。
 * PHRASE: セリフ編集、MANTRA: 拍に結びついた連呼、RAP: 休符と先取り、
 * CHOIR: ハーモニーの重層、BROKEN: v0.2型の破片的な循環。
 * 声が聴き取れる主題を適量残すが、毎回 A-A'-B-A を強制しない。
 */
function buildVoice(input,analysis,dna,rng,frames,cell,voicePitch){
  const out=layers(frames);
  const phrase=analysis.phrases;
  if(!phrase.length)return out;
  const length=frames/RATE;
  const beat=60/dna.bpm;
  const primary=phrase[0];
  const secondary=phrase.length>1?pick(rng,phrase.slice(1)):primary;
  const fragments=analysis.fragments.length?analysis.fragments:[primary];
  const variation=Math.floor(rng()*4);
  const main={start:primary.start,len:Math.min(primary.len,cell*.88)};
  const other={start:secondary.start,len:Math.min(secondary.len,cell*.86)};
  // 元の発話を残すイベントと、変調されたイベントは同じpaste関数を用いる。
  // 楽器側はこのイベント一覧を参照し、「声を聴いて反応する」伴奏を作る。
  // 必要なデータだけを保存し、画面や保存仕様は変更しない。
  out.events=[];
  const voice=(t,src,op={})=>{
    const duration=op.duration??src.len,gain=op.gain??.65;
    if(src.len>=.14 && gain>=.30 && t<length){
      out.events.push({time:Math.max(0,t),end:Math.min(length,t+duration),duration,gain,style:op.style??'clean'});
    }
    paste(out,input,{
      time:t,src,duration,gain,
      pan:op.pan??0,style:op.style??'clean',pitch:op.pitch??0,
      filter:op.filter??11000,ring:op.ring??0,
    });
  };
  const m=(len=.4)=>{
    const f=pick(rng,fragments);
    return {start:f.start,len:Math.min(f.len,len)};
  };
  const tail=(src=primary,len=.19)=>({
    start:src.start+Math.max(0,src.len-len),len:Math.min(len,src.len)
  });
  // 間隔のある短い音節の連打。長いフレーズを刻む際のアクセントとしてのみ使用。
  const chatter=(t,src,n=3,gap=beat*.25)=>{
    const tiny={start:src.start,len:Math.min(src.len,gap*.84,.22)};
    for(let i=0;i<n;i++)voice(t+i*gap,tiny,{
      duration:tiny.len,gain:.28+(.13*(i===0)),
      pan:i%2?.25:-.25,style:i===n-1?'reverse':'clean'
    });
  };
  const phraseAt=(t,src=main,op={})=>voice(t,src,{gain:.8,...op});
  // フレーズ終端を伸びる残響ではなく、リズムを持つコール&レスポンスに変える。
  if(dna.id==='PHRASE'){
    // 各試行で配置を切り替え、主題が冒頭から2度続くマンネリを避ける。
    const starts=[.09,cell*.13,cell*.07,cell*.22];
    phraseAt(starts[variation],variation%2?other:main,{gain:.84});
    if(variation===0){
      voice(cell*.78,m(.30),{gain:.41});
      phraseAt(cell+.06,other,{gain:.70,style:'pitch',pitch:5});
      chatter(2*cell+.13,tail(main,.22),4,beat*.30);
      phraseAt(2*cell+beat*1.7,main,{gain:.72,style:'pitch',pitch:3});
      phraseAt(3*cell+beat*.25,other,{gain:.82});
    }else if(variation===1){
      phraseAt(cell+.12,main,{gain:.72,style:'pitch',pitch:4});
      phraseAt(cell*1.7,other,{gain:.52});
      phraseAt(2*cell+.03,other,{gain:.75,style:'reverse'});
      phraseAt(2*cell+beat*2,main,{gain:.8});
      chatter(3*cell+beat,tail(other,.16),3,beat*.33);
      phraseAt(3*cell+beat*2.2,main,{gain:.69,style:'pitch',pitch:7});
    }else if(variation===2){
      phraseAt(cell+.09,other,{gain:.82});
      chatter(cell+beat*2.15,tail(primary,.18),3,beat*.33);
      phraseAt(2*cell+beat*.1,main,{gain:.69,style:'pitch',pitch:7});
      phraseAt(2*cell+beat*2.05,other,{gain:.59});
      phraseAt(3*cell+beat*.12,main,{gain:.83});
    }else{
      voice(beat*2.6,m(.33),{gain:.42,style:'reverse'});
      phraseAt(cell+beat*.5,main,{gain:.77,style:'pitch',pitch:3});
      phraseAt(2*cell+beat*.14,other,{gain:.82});
      phraseAt(2*cell+beat*2.4,main,{gain:.50,style:'pitch',pitch:5});
      chatter(3*cell+beat*.35,tail(primary,.18),4,beat*.42);
      phraseAt(3*cell+beat*2,other,{gain:.69});
    }
  }else if(dna.id==='MANTRA'){
    // 拍単位の周期構造：反復回数、合間、ピッチ曲線をseedで大きく変える。
    const unit=pick(rng,[beat*1.5,beat*2,beat*3]);
    const lengthLimit=Math.min(primary.len,unit*.88,1.50);
    const part={start:primary.start,len:lengthLimit};
    const transpose=[[0,3,0,7],[0,0,5,3],[3,7,3,0],[0,5,7,5]][variation];
    for(let bar=0;bar<4;bar++){
      const t=bar*cell+beat*.13;
      const count=bar===2?Math.max(2,Math.floor(cell/unit)):Math.max(1,Math.floor((cell-beat*.25)/unit));
      for(let j=0;j<count;j++){
        if(bar===3&&j===count-1&&variation%2===0)continue;
        const pitch=transpose[(bar+j)%4];
        phraseAt(t+j*unit,part,{gain:j===0?.78:.60,pitch,style:pitch?'pitch':'clean'});
      }
      if(bar===1||bar===3){
        const t2=bar*cell+cell*.73;
        chatter(t2,tail(part,.14),variation%2?4:2,beat*.27);
      }
    }
    if(variation===3)phraseAt(cell*2+beat*.3,other,{gain:.53,style:'reverse'});
  }else if(dna.id==='RAP'){
    // ラップ風フロウは極端な粒子化ではなく、先取り／タメ／休符／語尾の多重化で作る。
    const pulse=beat*.5;
    const patterns=[
      [[0,0],[0,5.5],[1,.8],[1,6.25],[2,.12],[2,5.2],[3,.1],[3,6.0]],
      [[0,.6],[0,6.25],[1,1.15],[2,0],[2,5.7],[3,1.0],[3,6.5]],
      [[0,0],[0,4],[1,.05],[1,6.25],[2,.65],[2,5.15],[3,0],[3,6.2]],
      [[0,.3],[0,5.7],[1,0],[1,3.8],[2,.3],[2,6],[3,.3],[3,5.8]]
    ][variation];
    const syllables=[main,other,m(.64),tail(primary,.42),m(.40)];
    patterns.forEach(([bar,pulsePos],i)=>{
      const src=i===0?main:i===patterns.length-1?other:syllables[(i+variation)%syllables.length];
      const t=bar*cell+pulsePos*pulse;
      voice(t,src,{gain:i%3===0?.77:.57,
        duration:Math.min(src.len,pulse*(i%3===0?3.6:2.6)),
        style:i===patterns.length-2?'pitch':'clean',pitch:i===patterns.length-2?4:0});
    });
    for(let i=0;i<2;i++)chatter((i+1)*cell+cell*.68,tail(primary,.16),variation%2?4:3,beat*.24);
    // 最終小節末尾にだけ発話の痕跡を戻す。冒頭と末尾を同じにしない。
  }else if(dna.id==='CHOIR'){
    // 音域を下げず、原音・上3度・上5度など高域側で声を交錯させる。
    const harmonies=[[0,4,7],[0,3,7],[0,5,7],[0,3,9]][variation];
    for(let b=0;b<4;b++){
      const chosen=b===2?other:main;
      const t=b*cell+beat*(b%2?.32:.12);
      phraseAt(t,chosen,{gain:.52});
      voice(t+beat*.19,chosen,{gain:.35,pan:-.46,pitch:harmonies[1],style:'pitch',filter:8900});
      if((b+variation)%3!==0){
        voice(t+beat*.42,chosen,{gain:.27,pan:.47,pitch:harmonies[2],style:'pitch',filter:10600});
      }
      if(b===1||b===3)voice(t+beat*2.2,tail(chosen,.28),{gain:.26,style:'pitch',pitch:7});
    }
  }else if(dna.id==='BROKEN'){
    // v0.2に近い素材破壊。音節の密度・長さ・逆再生頻度が他とは段違い。
    const pulse=beat*.25;
    const count=variation%2?25:33;
    const motif=Array.from({length:8},()=>({
      fragment:m(random(rng,.065,.36)),reverse:rng()<.42,
      pitch:pick(rng,[0,3,5,7,9]),pan:random(rng,-.58,.58),
    }));
    for(let i=0;i<count;i++){
      if(i%8===6&&rng()<.72)continue;
      const bar=i/count*4,cellIndex=Math.floor(bar);
      const t=clamp((bar*cell)+random(rng,-pulse*.27,pulse*.27),0,length-.15);
      const note=motif[i%8];
      voice(t,note.fragment,{gain:random(rng,.28,.57),pan:note.pan,
        duration:Math.min(note.fragment.len,random(rng,.065,.22)),
        style:(i+variation)%5===0?'pitch':note.reverse?'reverse':'clean',
        pitch:note.pitch,ring:rng()<.20?random(rng,76,230):0,
        filter:random(rng,2100,11000)});
    }
    const anchorAt=variation%2?cell*.65:cell*.12;
    phraseAt(anchorAt,main,{gain:.72});
    phraseAt(cell*2.25,variation>1?other:main,{gain:.64,style:'pitch',pitch:3});
  }
  // 声そのものを打音化する中程度のカットアップ。1つのモチーフを
  // 複数箇所で繰り返し、細切れにしすぎず「声のリフ」を生む。
  // Phrase / Choir / Mantra / Rap で繰り返す箇所を変え、同じ演奏にならないようにする。
  out.cutUpHits=0;
  if(dna.id!=='BROKEN'){
    const motifSrc=pick(rng,[primary,secondary]);
    const size=clamp(random(rng,.24,.52),.20,Math.min(.55,motifSrc.len));
    const srcA={start:motifSrc.start+Math.max(0,(motifSrc.len-size)*random(rng,.08,.49)),len:size};
    const srcB={start:motifSrc.start+Math.max(0,motifSrc.len-size),len:size};
    const firstPositions=pick(rng,[[1.5,2.75],[.50,2.5],[1.0,3.0],[.75,2.25]]);
    const grid={PHRASE:[1,2],MANTRA:[1,3],RAP:[0,1,2,3],CHOIR:[1,2]}[dna.id]||[1,2];
    for(const bar of grid){
      const positions=bar===2?[.5,1.5,2.75]:firstPositions;
      for(let i=0;i<positions.length;i++){
        if(bar===0&&i===1)continue;
        const swing=(i%2?1:-1)*beat*random(rng,.025,.075);
        const t=bar*cell+(positions[i]*beat)+swing;
        if(t>=length-.2)continue;
        const p=(bar===2&&i===positions.length-1)?3:0;
        voice(t,i%2?srcB:srcA,{
          gain:dna.id==='RAP'?.47:.34,
          duration:Math.min(size,beat*(i%2?.75:.98)),
          style:p?'pitch':'clean',pitch:p,
          filter:7200,pan:i%2?.22:-.22,
        });
        out.cutUpHits++;
      }
    }
  }
  // 明確な音高が拾えた声だけに、短い有声の「合いの手」を加える。
  // 新しいシンセではなく、元の語尾を軽く移調した声なので曲が別物にならない。
  // RAPは休符、MANTRAは応答、PHRASEは変奏に使う。BROKENは素材破壊を優先。
  if(voicePitch && dna.id!=='BROKEN'){
    const answerSteps=dna.seed%2?[2,5]:[3,5];
    const answerSource=tail(primary,Math.min(.35,primary.len*.43));
    if(answerSource.len>=.14){
      const isChoral=dna.id==='CHOIR';
      for(const b of isChoral?[1]:[1,3]){
        const candidates=out.events.filter(e=>e.time>=b*cell && e.time<(b+1)*cell && e.duration>.22);
        if(!candidates.length)continue;
        const source=candidates[0];
        const answerAt=source.end+beat*(dna.id==='RAP'?.16:.24);
        if(answerAt+answerSource.len>(b+1)*cell-beat*.10)continue;
        paste(out,input,{
          time:answerAt,src:answerSource,duration:answerSource.len,
          gain:isChoral?.14:.18,pan:b===1?.24:-.24,
          style:'pitch',pitch:answerSteps[b===1?0:1],filter:4800,
        });
      }
    }
  }
  // v1.1.3: 全Bugに同じEchoを重ねない。FXの「主役」を一つだけ選ぶ。
  // レシピは声の配置、identityは加工色を決め、両者の組合せで差が生まれる。
  out.effectActions=[];
  out.panMode='CENTER';
  out.echoMode='NONE';
  out.fxHits=0;
  switch(dna.fxIdentity){
    case 'ALIEN':
      out.fxHits=addAlienPhrases(out,input,analysis,dna,cell);
      out.echoMode='DRY-ALIEN';
      break;
    case 'CUTUP':
      out.effectActions=applyStepMutations(out,dna,dna.seed^0x61B9,out.events,RATE,
        {density:2, types:['stutter','reverse','half','gate'],intensity:.77});
      out.fxHits=out.effectActions.length;
      out.echoMode='NO-ECHO';
      break;
    case 'FILTER':
      applyRhythmicFilter(out,dna,mulberry32(dna.seed^0x731C),.81);
      out.panMode=applyMovingPan(out,dna,dna.seed^0x1A981,out.events,RATE);
      out.echoMode='FILTER-ONLY';
      out.fxHits=8;
      break;
    case 'CRUSH':
      out.fxHits=applySelectiveCrush(out,dna,out.events,RATE);
      out.echoMode='DRY-CRUSH';
      break;
    case 'CRYSTAL':
      out.fxHits=addCrystalPhrases(out,input,analysis,dna,cell);
      out.panMode=applyMovingPan(out,dna,dna.seed^0x1A981,out.events,RATE);
      out.echoMode='PITCH-SPARKS';
      break;
    case 'ECHO':
    default:
      out.effectActions=applyStepMutations(out,dna,dna.seed^0x61B9,out.events,RATE,
        {density:1,intensity:.39});
      out.panMode=applyMovingPan(out,dna,dna.seed^0x1A981,out.events,RATE);
      // Echoが毎回濃く聴こえないよう、約2/3は短いドライ寄りのDelayに分岐。
      // FXタイプの追加ではなく、従来ECHO内部の質感の選択なので画面は変えない。
      const echoChoice=mulberry32(dna.seed^0xD31A7)();
      out.echoMode=echoChoice<.66
        ? applyShortDelay(out,dna,dna.seed^0xEC40,RATE)
        : applyToyDelay(out,dna,dna.seed^0xEC40,RATE);
      out.fxHits=out.effectActions.length;
  }
  return out;
}

/**
 * v0.3由来の小さな電子音を、声の「発音した瞬間」へ同期させて発生する。
 * ボイスフレーズを覆わないよう短い音だけ。BPMと声の推定基音を共有する。
 * サンプル音源を増やさず、純粋な波形合成でブラウザー内で完結させる。
 */
/** GROOVE の設計は voice と同じ拍・推定基音を使う。打音は加えない。 */
export function planGrooveEvents(voiceEvents,dna,seed,duration,pitchHz=null){
  return planToyMusic(voiceEvents,dna,seed,duration,pitchHz).events;
}
function buildGroove(input,analysis,dna,rng,frames,cell,voice,pitchHz){
  if(!analysis.active || !voice.events.length){const out=layers(frames);out.events=[];return out;}
  const plan=planToyMusic(voice.events,dna,dna.seed^0x1876,frames/RATE,pitchHz);
  const out=renderToyMusic(plan,frames/RATE,dna.seed^0x3652,RATE);
  out.plan=plan;
  duckSynthAgainstVoice(out,voice,RATE);
  return out;
}
/**
 * 両レイヤーに同一の短い初期反射を与え、声とGROOVEが
 * 別々の部屋から鳴っているように聞こえる現象を抑える。
 * 長いリバーブでは音節が濁るため、テンポ同期の軽い反射のみ。
 */
function shortRoom(layer,beat,amount){
  const a=Math.round(clamp(beat*.19,.054,.11)*RATE);
  const b=Math.round(clamp(beat*.37,.115,.22)*RATE);
  for(const arr of [layer.left,layer.right]){
    const original=arr.slice();
    for(let i=a;i<arr.length;i++)arr[i]+=original[i-a]*amount;
    for(let i=b;i<arr.length;i++)arr[i]+=original[i-b]*amount*.43;
  }
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
/**
 * 低周波のモゴモゴを減らす。音声の倍音を保持しながら、
 * 出力バッファに残った直流／極低域を一段のDCブロック＋HPで削る。
 * 声そのものをローカットしすぎないように、ボイスは約105Hz、
 * 補助電子音は約155Hzを基準にする。
 */
function cutRumble(layer,frequency){
  const a=1-Math.exp(-TAU*frequency/RATE);
  for(const arr of [layer.left,layer.right]){
    let low=0;
    for(let i=0;i<arr.length;i++){
      const x=arr[i];low+=a*(x-low);arr[i]=x-low;
    }
  }
}
function normalize(voice,groove,dna){
  cutRumble(voice,95);cutRumble(groove,105);
  // 二つの音源に同じ距離感を与える。GROOVEは短く、声は語句の輪郭を優先。
  // DRY性格では短いルーム成分すら減らし、声の余白を保つ。
  shortRoom(voice,60/(voice.bpm||125),dna.fxIdentity==='ECHO'?.035:.012);
  shortRoom(groove,60/(voice.bpm||125),.035);

  const v=info(voice),g=info(groove);
  const vg=v.peak>.0002?Math.min(4.3,.88/v.peak,.155/Math.max(v.rms,.0001)):1;
  for(let i=0;i<voice.left.length;i++){
    voice.left[i]=Math.tanh(voice.left[i]*vg)*.94;
    voice.right[i]=Math.tanh(voice.right[i]*vg)*.94;
  }
  const vr=info(voice);
  // v0.3程度の存在感。v0.5のRMS比0.5前後を目指さず0.20前後を中心にする。
  const gg=g.rms>.000001?Math.min(3.6,vr.rms*.275/g.rms,.38/Math.max(.0001,g.peak)):0;
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
export function hatch(input,seed,forcedRecipe=null,forcedFx=null){
  if(!input?.data?.length||!(input.sampleRate>0))throw Error('No recorded audio.');
  const dna=makeDna(seed),analysis=analyzeVoice(input);
  if(forcedRecipe && RECIPES.some(r=>r.id===forcedRecipe)){
    const selected=RECIPES.find(r=>r.id===forcedRecipe);
    dna.id=selected.id;dna.tag=selected.tag;
  }
  if(forcedFx && FX_IDENTITIES.some(f=>f.id===forcedFx)){
    const chosen=FX_IDENTITIES.find(f=>f.id===forcedFx);
    dna.fxIdentity=chosen.id;dna.fxTag=chosen.tag;
  }
  const primary=analysis.phrases[0];
  const phraseLength=primary?.len??.8;
  const rng=mulberry32(seed^0xC12F25);
  // cellは拍周期の整数倍。BPM表示と実際の配置を一致させる。
  const beat=60/dna.bpm;
  const cell=beat*(phraseLength>1.95?6:4);
  const frames=Math.round(cell*4*RATE);
  const basePitch=estimateVoicePitch(input,analysis);
  const voice=buildVoice(input,analysis,dna,mulberry32(seed^0xB01234),frames,cell,basePitch);
  const groove=buildGroove(input,analysis,dna,mulberry32(seed^0x5A5501),frames,cell,voice,basePitch);
  voice.bpm=dna.bpm;
  normalize(voice,groove,dna);
  return {voice,groove,sampleRate:RATE,duration:frames/RATE,dna:{...dna,seconds:frames/RATE,cell},
    analysis:{phraseCount:analysis.phrases.length,fragmentCount:analysis.fragments.length,
      pitchHz:basePitch,grooveHits:groove.events.length,cutUpHits:voice.cutUpHits??0,
      stepFX:voice.effectActions?.length??0,panMode:voice.panMode,echoMode:voice.echoMode,
      grooveMode:groove.plan?.mode,fxIdentity:dna.fxIdentity,fxHits:voice.fxHits}};
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
