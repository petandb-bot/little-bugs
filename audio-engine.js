/**
 * LITTLE BUGS v0.3 — Voice Music Laboratory
 * 録音を旋律・リズム・微細反復として再構成する。
 * GROOVE は独立した薄い音響レイヤー：いつでもON/OFF可能で、WAVに同じ状態を保存する。
 * 音声データは一切外部へ送らず、PCMをローカルで生成する。
 */
export const RATE=44100;
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const pick=(r,a)=>a[Math.min(a.length-1,Math.floor(r()*a.length))];
const random=(r,a,b)=>lerp(a,b,r());
const wrap=(i,n)=>(i%n+n)%n;

/** シードに対し一意な疑似乱数列。音声とキャラクターで共通のDNAを使う。 */
export function mulberry32(seed){let x=seed>>>0;return ()=>{x=(x+0x6d2b79f5)|0;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}

/** 録音されたマルチチャンネル音声を、直流を除いたモノラル波形へ変換。 */
export function monoFromAudioBuffer(buffer){
  const data=new Float32Array(buffer.length);
  for(let c=0;c<buffer.numberOfChannels;c++){
    const ch=buffer.getChannelData(c);
    for(let i=0;i<data.length;i++)data[i]+=ch[i]/buffer.numberOfChannels;
  }
  let dc=0,peak=0;
  for(let i=0;i<data.length;i++){dc+=.001*(data[i]-dc);data[i]-=dc;peak=Math.max(peak,Math.abs(data[i]));}
  const gain=peak<.004?1:Math.min(5,.78/peak);
  for(let i=0;i<data.length;i++)data[i]*=gain;
  return {data,sampleRate:buffer.sampleRate,duration:buffer.length/buffer.sampleRate,peak};
}

/** 音声の立ち上がりと空白を調べ、ラップ・歌・パーカッションに使える発音単位を探す。 */
function analyze(input){
  const sr=input.sampleRate,hop=Math.max(256,Math.round(sr*.016));
  const energy=[];
  for(let pos=0;pos<input.data.length;pos+=hop){
    let sum=0,n=0;
    for(let k=pos;k<Math.min(input.data.length,pos+hop);k+=4){sum+=input.data[k]*input.data[k];n++;}
    energy.push(Math.sqrt(sum/Math.max(1,n)));
  }
  const positive=energy.filter(x=>x>.008).sort((a,b)=>a-b);
  const level=positive.length?positive[Math.floor(positive.length*.35)]:.015;
  const threshold=Math.max(.009,level*.52);
  const peaks=[];
  for(let i=2;i<energy.length-2;i++){
    const here=energy[i],earlier=(energy[i-1]+energy[i-2])*.5;
    if(here>threshold && here>earlier*1.27 && (peaks.length===0||(i-peaks.at(-1))*hop/sr>.09))peaks.push(i);
  }
  const total=input.data.length/sr;
  // 長い母音や持続音でも演奏できるよう、一定間隔から音量のある候補を追加。
  for(let t=.015;t<Math.max(.02,total-.07);t+=clamp(total/11,.12,.35)){
    const idx=Math.min(energy.length-1,Math.floor(t*sr/hop));
    if(energy[idx]>=threshold*.65&&!peaks.some(i=>Math.abs(i*hop/sr-t)<.085))peaks.push(idx);
  }
  if(!peaks.length)peaks.push(0);
  const starts=[...new Set(peaks.map(i=>Math.min(total-.02,Math.max(0,i*hop/sr-.018))))].sort((a,b)=>a-b);
  const slices=starts.map((s,i)=>({start:s,len:clamp((starts[i+1]??total)-s,.055,.7)}))
    .filter(s=>s.start<total-.02).map(s=>({...s,len:Math.min(s.len,total-s.start)}));
  const mean=energy.reduce((a,b)=>a+b,0)/Math.max(1,energy.length);
  return {slices:slices.length?slices:[{start:0,len:Math.min(.24,total)}],energy:mean};
}

/** 音響レシピ。一定の音楽的反復を守りつつ、音の性格を変える。 */
export function makeDna(seed){
  const rng=mulberry32(seed>>>0);
  const recipes=[
    {id:'CHANT',name:'CHIRP CHANT',mood:'SING SONG',palette:0},
    {id:'BOUNCE',name:'BOUNCE TALK',mood:'HOP HOP',palette:1},
    {id:'CHOIR',name:'BUBBLE CHOIR',mood:'DREAM POP',palette:2},
    {id:'TAPE',name:'TAPE PARADE',mood:'ODD GROOVE',palette:3},
  ];
  const recipe=pick(rng,recipes);
  const bpm=Math.round(random(rng,108,158));
  const beats=16;
  return {...recipe,seed:seed>>>0,sprite:(rng()*0xFFFFFF)>>>0,
    bpm,seconds:beats*60/bpm,beat:60/bpm,beats,
    swing:random(rng,.015,.085),noteBias:pick(rng,[-3,0,2,5]),
    energy:random(rng,.72,1.05),bounce:random(rng,.7,1.2)};
}
const alloc=n=>({left:new Float32Array(n),right:new Float32Array(n)});

/** 声の短い断片を循環バッファーへ合成。端点をフェードしクリックノイズを回避する。 */
function putVoice(out,input,options){
  const {time,start,len,rate=1,gain=.5,pan=0,reverse=false,ring=0,cutoff=11000,warble=0,gate=0}=options;
  const sr=input.sampleRate,base=Math.floor(start*sr);
  const maxSource=Math.min(Math.round(len*sr),input.data.length-base);
  if(maxSource<32)return;
  const outLength=Math.min(Math.round(maxSource*RATE/(sr*Math.max(.32,rate))),Math.round(.77*RATE));
  if(outLength<32)return;
  const pos=Math.floor(time*RATE),size=out.left.length;
  const fade=Math.max(12,Math.min(Math.round(outLength*.22),Math.round(RATE*.008)));
  const a=1-Math.exp(-TAU*clamp(cutoff,250,18000)/RATE);
  const angle=(clamp(pan,-1,1)+1)*Math.PI/4;
  const gl=Math.cos(angle)*gain,gr=Math.sin(angle)*gain;
  let low=0;
  for(let i=0;i<outLength;i++){
    const seconds=i/RATE;
    const drift=warble*Math.sin(TAU*5.4*seconds);
    const offset=i*rate*sr/RATE*(1+drift);
    const read=reverse?base+maxSource-1-offset:base+offset;
    if(read<base||read>=base+maxSource-1)break;
    const j=Math.floor(read),f=read-j;
    let v=lerp(input.data[j],input.data[j+1],f);
    low+=a*(v-low);v=low;
    if(ring)v*=.6+.4*Math.sin(TAU*ring*seconds);
    if(gate)v*=((i%Math.max(1,Math.floor(RATE/gate)))/(RATE/gate)>.63)?.25:1;
    const env=clamp(Math.min(i/fade,(outLength-1-i)/fade),0,1);
    const dst=wrap(pos+i,size);
    out.left[dst]+=v*env*gl;
    out.right[dst]+=v*env*gr;
  }
}

/** 声の短い断片で「タタ・タッ」と刻み、音楽的なグリッド上に音を集める。 */
function stutter(out,input,slice,t,step,rng,rate,gain,recipe){
  const copies=recipe==='BOUNCE'?3:2;
  const interval=step/(copies+1);
  for(let i=0;i<copies;i++)putVoice(out,input,{
    time:t+i*interval,start:slice.start,len:Math.min(slice.len,random(rng,.055,.12)),
    rate:rate*(i===copies-1?1.24:1),gain:gain*(.8-i*.2),
    pan:random(rng,-.4,.4),cutoff:random(rng,2900,13500),
  });
}

/** 声の遺伝子から4小節の反復主題を作る。伴奏なしでも拍節感を持たせる。 */
function buildVoice(input,analysis,dna,rng,frames){
  const out=alloc(frames),slices=analysis.slices;
  const step=dna.beat/4;
  // 一度選んだ断片を繰り返すことで、完全ランダムな音響コラージュを避ける。
  const anchors=Array.from({length:8},()=>pick(rng,slices));
  const longNotes=[0,3,7,10,7,5,2,0];
  const melodic=[0,2,4,7,9,7,4,2];
  const rhythm={
    CHANT:[0,3,4,7,8,10,12,14],
    BOUNCE:[0,2,3,6,8,10,11,14,15],
    CHOIR:[0,4,6,8,12,14],
    TAPE:[0,2,5,7,8,10,12,15],
  }[dna.id];
  for(let bar=0;bar<4;bar++){
    const barStart=bar*4*dna.beat;
    for(let k=0;k<16;k++){
      if(!rhythm.includes(k) && !(bar===3&&k===15&&rng()<.4))continue;
      if(rng()<(dna.id==='CHOIR'?.11:.08)&&k%4!==0)continue;
      const phraseIndex=(k+bar%2*2)%anchors.length;
      const s=anchors[phraseIndex];
      const accent=k%4===0?1.05:.78;
      const swing=(k%2?dna.swing:0)*step;
      const n=dna.id==='BOUNCE'?pick(rng,[-2,0,3,7,10]):
        dna.id==='TAPE'?pick(rng,[-5,0,5,7,12]):
        dna.id==='CHOIR'?longNotes[phraseIndex]:melodic[phraseIndex];
      // rateの変更はピッチと長さの双方を変える。フォルマント保存のない玩具らしい歌声。
      const rate=clamp(Math.pow(2,(n+dna.noteBias)/12)*random(rng,.96,1.04),.55,2.55);
      const melodicLength=dna.id==='CHOIR'?.29:dna.id==='CHANT'?.21:.16;
      const len=Math.min(s.len,random(rng,melodicLength*.65,melodicLength*1.65));
      const reverse=dna.id==='TAPE'&&rng()<.3;
      const t=barStart+k*step+swing;
      putVoice(out,input,{time:t,start:s.start,len,rate,
        gain:(dna.id==='CHOIR'?.46:.57)*accent*dna.energy,
        pan:random(rng,-.42,.42),reverse,
        ring:dna.id==='TAPE'&&rng()<.20?random(rng,34,107):0,
        warble:dna.id==='TAPE'?.035:0,
        cutoff:random(rng,2500,13500)});
      // 細かい発音は拍の間に挿入し、16分より細かいリズムを生成。
      if((dna.id==='BOUNCE'&&rng()<.49)||(dna.id==='TAPE'&&rng()<.27)){
        stutter(out,input,s,t+step*.3,step,rng,rate,.29,dna.id);
      }
      // 長音の背後に薄い声の和声。元音の声質を優先して過剰なシンセ感を避ける。
      if(dna.id==='CHOIR'||(dna.id==='CHANT'&&k%8===0)){
        putVoice(out,input,{time:t+step*.10,start:s.start,len:Math.min(s.len,.31),
          rate:rate*Math.pow(2,(rng()<.5?7:-5)/12),gain:.15,pan:k%2?-.8:.8,
          cutoff:random(rng,2200,7100)});
      }
    }
    // 2小節の単位でテーマが戻る一方、4小節目に小さなフィルを置く。
    if(bar===1||bar===3){
      const s=pick(rng,slices),t=barStart+dna.beat*3.55;
      stutter(out,input,s,t,step,rng,random(rng,1.15,1.8),.21,'BOUNCE');
    }
  }
  // 周期に同期した少量の拡散エコーを声のみに加える。
  const oldL=out.left.slice(),oldR=out.right.slice();
  const offset1=Math.round(dna.beat*.75*RATE),offset2=Math.round(dna.beat*1.50*RATE);
  for(let i=0;i<frames;i++){
    out.left[i]+=oldR[wrap(i-offset1,frames)]*.13+oldL[wrap(i-offset2,frames)]*.075;
    out.right[i]+=oldL[wrap(i-offset1,frames)]*.13+oldR[wrap(i-offset2,frames)]*.075;
  }
  return out;
}

/** 短い電子打楽器を加算する。独立した主旋律を作らない「微量のGROOVE」。 */
function percussion(out,time,type,pitch,vol,pan=0){
  const frames=out.left.length,base=Math.round(time*RATE);
  const len=Math.round(RATE*(type==='bass'?.27:type==='snap'?.085:type==='bell'?.20:.075));
  const gl=Math.cos((pan+1)*Math.PI/4)*vol,gr=Math.sin((pan+1)*Math.PI/4)*vol;
  for(let i=0;i<len;i++){
    const t=i/RATE;
    let s=0;
    if(type==='bass')s=Math.sin(TAU*(pitch*t+pitch*.6*(1-Math.exp(-t*30))/30))*Math.exp(-t*17);
    if(type==='snap')s=(Math.sin(TAU*1900*t)+.45*Math.sin(TAU*3100*t))*Math.exp(-t*64);
    if(type==='tick')s=(Math.sin(TAU*1470*t)+.25*Math.sin(TAU*2600*t))*Math.exp(-t*75);
    if(type==='bell')s=(Math.sin(TAU*pitch*t)+.30*Math.sin(TAU*pitch*2.03*t))*Math.exp(-t*19);
    const j=wrap(base+i,frames);
    out.left[j]+=s*gl;out.right[j]+=s*gr;
  }
}

/** 小さな低音・アクセント・電子的な一音だけを配置。声を邪魔する密度にしない。 */
function buildGroove(dna,rng,frames,sourceEnergy){
  const out=alloc(frames),beat=dna.beat;
  if(sourceEnergy<.0009)return out;
  // 声から導いた相対音程に軽く合わせ、生成された歌と不協和になりすぎないようにする。
  const root=110*Math.pow(2,dna.noteBias/12);
  const notes=[0,7,5,2];
  for(let bar=0;bar<4;bar++){
    const start=bar*4*beat;
    // 1小節あたり2～3個の低音：四つ打ちトラックにはしない。
    percussion(out,start,'bass',root,.145,-.1);
    if(dna.id==='BOUNCE'||dna.id==='TAPE')percussion(out,start+beat*2.45,'bass',root*.75,.084,.1);
    if(dna.id!=='CHOIR'){
      percussion(out,start+beat*1.98,'snap',0,.058,.12);
      if(bar%2===1)percussion(out,start+beat*3.5,'tick',0,.052,-.3);
    }
    for(let b=0;b<4;b++){
      if(rng()<.62)percussion(out,start+(b+(b%2?.05:0))*beat,'tick',0,.035,b%2?.54:-.54);
    }
    if(bar%2===0||dna.id==='CHOIR'){
      const semitone=notes[bar];
      percussion(out,start+beat*(dna.id==='CHOIR'?2.25:3.25),'bell',
        root*4*Math.pow(2,semitone/12),dna.id==='CHOIR'?.046:.032,.46);
    }
  }
  return out;
}

/** ステレオ全体の最大値だけを制限して音量とキャラクターを保持する。 */
function trimLayers(voice,groove){
  let peakVoice=0,peakGroove=0;
  for(let i=0;i<voice.left.length;i++){
    peakVoice=Math.max(peakVoice,Math.abs(voice.left[i]),Math.abs(voice.right[i]));
    peakGroove=Math.max(peakGroove,Math.abs(groove.left[i]),Math.abs(groove.right[i]));
  }
  const gv=peakVoice>.0001?Math.min(3,.73/peakVoice):1;
  const gg=peakGroove>.0001?.22/peakGroove:1;
  for(let i=0;i<voice.left.length;i++){
    voice.left[i]=Math.tanh(voice.left[i]*gv)*.73/.625;
    voice.right[i]=Math.tanh(voice.right[i]*gv)*.73/.625;
    groove.left[i]*=gg;groove.right[i]*=gg;
  }
  // 軽い端点の補正でループ境界のクリックを除去する（過度なフェードは避ける）。
  for(const layer of [voice,groove])for(const ch of [layer.left,layer.right]){
    const width=Math.min(350,Math.floor(ch.length*.002));
    const midpoint=(ch[0]+ch.at(-1))*.5;
    for(let i=0;i<width;i++){
      const w=((width-i)/width)**2;
      ch[i]=lerp(ch[i],midpoint,w);
      ch[ch.length-1-i]=lerp(ch[ch.length-1-i],midpoint,w);
    }
  }
}

/** 録音 -> voiceとgrooveの両レイヤーを生成。grooveの初期状態と無関係に決定的。 */
export function hatch(input,seed){
  if(!input?.data?.length || !(input.sampleRate>0))throw Error('No recorded sound available.');
  const dna=makeDna(seed),frames=Math.round(dna.seconds*RATE),analysis=analyze(input);
  const voice=buildVoice(input,analysis,dna,mulberry32(seed^0xA17671),frames);
  const groove=buildGroove(dna,mulberry32(seed^0xB00B15),frames,analysis.energy);
  trimLayers(voice,groove);
  return {voice,groove,sampleRate:RATE,duration:frames/RATE,dna};
}

/** GROOVEボタンの状態と同じ音声をWAVへ書き出すための合成関数。 */
export function mixLayers(song,enabled=true){
  const size=song.voice.left.length;
  const left=new Float32Array(size),right=new Float32Array(size);
  for(let i=0;i<size;i++){
    left[i]=clamp(song.voice.left[i]+(enabled?song.groove.left[i]:0),-.97,.97);
    right[i]=clamp(song.voice.right[i]+(enabled?song.groove.right[i]:0),-.97,.97);
  }
  return {left,right,sampleRate:song.sampleRate,duration:song.duration,dna:song.dna};
}

/** PCM16 ステレオWAV。Blobを端末に直接保存する。 */
export function wavBlob(song){
  const {left,right,sampleRate}=song,n=left.length;
  const bytes=new ArrayBuffer(44+n*4),v=new DataView(bytes);
  const write=(pos,word)=>{for(let i=0;i<word.length;i++)v.setUint8(pos+i,word.charCodeAt(i));};
  write(0,'RIFF');v.setUint32(4,36+n*4,true);write(8,'WAVE');write(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);
  v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);
  write(36,'data');v.setUint32(40,n*4,true);
  let p=44;
  for(let i=0;i<n;i++){v.setInt16(p,Math.round(clamp(left[i],-1,1)*32767),true);p+=2;v.setInt16(p,Math.round(clamp(right[i],-1,1)*32767),true);p+=2;}
  return new Blob([bytes],{type:'audio/wav'});
}
