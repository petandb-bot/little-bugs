/**
 * LITTLE BUGS v0.7 — CONTRAST SEQUENCER
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
  const bpm=Math.round(random(rng,98,154));
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

/**
 * 変異音の作曲エンジン。
 * 大切なのは「5つの音色違い」ではなく「5つの違う時間構造」にすること。
 * PHRASE: セリフ編集、MANTRA: 拍に結びついた連呼、RAP: 休符と先取り、
 * CHOIR: ハーモニーの重層、BROKEN: v0.2型の破片的な循環。
 * 声が聴き取れる主題を適量残すが、毎回 A-A'-B-A を強制しない。
 */
function buildVoice(input,analysis,dna,rng,frames,cell){
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
  const voice=(t,src,op={})=>paste(out,input,{
    time:t,src,duration:op.duration??src.len,gain:op.gain??.65,
    pan:op.pan??0,style:op.style??'clean',pitch:op.pitch??0,
    filter:op.filter??11000,ring:op.ring??0,
  });
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
    const harmonies=[[0,4,7],[0,3,7],[0,5,9],[0,7,12]][variation];
    for(let b=0;b<4;b++){
      const chosen=b===2?other:main;
      const t=b*cell+beat*(b%2?.32:.12);
      phraseAt(t,chosen,{gain:.52});
      voice(t+beat*.19,chosen,{gain:.35,pan:-.46,pitch:harmonies[1],style:'pitch',filter:8900});
      if((b+variation)%3!==0){
        voice(t+beat*.42,chosen,{gain:.27,pan:.47,pitch:harmonies[2],style:'pitch',filter:10600});
      }
      if(b===1||b===3)voice(t+beat*2.2,tail(chosen,.28),{gain:.35,style:'pitch',pitch:12});
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
  // 声そのものから短い残響を作る。レシピごとに量を変え、元の動きをぼかし過ぎない。
  if(dna.id==='CHOIR'||dna.id==='PHRASE'||dna.id==='BROKEN'){
    const delay=Math.round(random(rng,.18,.32)*RATE);
    const decay=dna.id==='CHOIR'?.14:dna.id==='BROKEN'?.18:.09;
    for(const channel of [out.left,out.right]){
      const dry=channel.slice();
      for(let i=delay;i<frames;i++)channel[i]+=dry[i-delay]*decay;
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
      phase+=TAU*(195+pitch*19+85*Math.exp(-t*30))/RATE;
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
function normalize(voice,groove){
  cutRumble(voice,105);cutRumble(groove,155);

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
export function hatch(input,seed,forcedRecipe=null){
  if(!input?.data?.length||!(input.sampleRate>0))throw Error('No recorded audio.');
  const dna=makeDna(seed),analysis=analyzeVoice(input);
  if(forcedRecipe && RECIPES.some(r=>r.id===forcedRecipe)){
    const selected=RECIPES.find(r=>r.id===forcedRecipe);
    dna.id=selected.id;dna.tag=selected.tag;
  }
  const primary=analysis.phrases[0];
  const phraseLength=primary?.len??.8;
  const rng=mulberry32(seed^0xC12F25);
  // cellは拍周期の整数倍。BPM表示と実際の配置を一致させる。
  const beat=60/dna.bpm;
  const cell=beat*(phraseLength>1.95?6:4);
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
