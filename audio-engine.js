/**
 * LITTLE BUGS v0.2 — Voice-first experimental loop engine.
 *
 * 音源は録音した波形だけ。追加のドラム、コード、メロディは鳴らさない。
 * 同じ seed と録音からは同じループを再現でき、異なる seed は異なる編集手順になる。
 * 生成結果はブラウザー内のPCM波形。再生とWAV書き出しは同一データを利用する。
 */
export const RATE = 44100;
const TAU = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const mix = (a,b,t) => a*(1-t)+b*t;
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick=(r,items)=>items[Math.floor(r()*items.length)];
const between=(r,lo,hi)=>mix(lo,hi,r());

/** マイクの直流成分を除去し、過小入力だけを穏やかに増幅する。 */
export function monoFromAudioBuffer(buffer) {
  const data = new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++) {
    const src=buffer.getChannelData(ch);
    for(let i=0;i<data.length;i++)data[i]+=src[i]/buffer.numberOfChannels;
  }
  let dc=0,peak=0;
  for(let i=0;i<data.length;i++) {
    dc+=(data[i]-dc)*.0008;
    data[i]-=dc;
    peak=Math.max(peak,Math.abs(data[i]));
  }
  // 環境ノイズだけを過剰に増幅しないため、無音近傍では音量を据え置く。
  const gain=peak<.004?1:Math.min(6,.78/peak);
  for(let i=0;i<data.length;i++)data[i]*=gain;
  return {data,sampleRate:buffer.sampleRate,duration:buffer.duration,peak};
}

/** 音量の立ち上がりを拾い、単調な持続音には均等な分割点を補う。 */
function discoverSlices(input) {
  const sr=input.sampleRate;
  const hop=Math.max(128,Math.round(sr*.019));
  const rms=[];
  for(let pos=0;pos<input.data.length;pos+=hop) {
    let s=0,n=0;
    for(let i=pos;i<Math.min(pos+hop,input.data.length);i+=3){s+=input.data[i]**2;n++;}
    rms.push(Math.sqrt(s/Math.max(1,n)));
  }
  const sorted=[...rms].sort((a,b)=>a-b);
  const percentile=sorted[Math.floor((sorted.length-1)*.76)]||0;
  const threshold=Math.max(.009,percentile*.28);
  const duration=input.data.length/sr;
  const starts=[];
  let last=-1;
  for(let i=2;i<rms.length;i++) {
    const t=i*hop/sr;
    if(rms[i]>threshold && rms[i]>((rms[i-1]+rms[i-2])*.5)*1.42 && t-last>.085) {
      starts.push(Math.max(0,t-.018));last=t;
    }
  }
  const interval=clamp(duration/14,.11,.34);
  for(let t=0;t<duration-.07;t+=interval) {
    const idx=Math.min(rms.length-1,Math.floor((t+.028)*sr/hop));
    if(rms[idx]>threshold*.65 && !starts.some(s=>Math.abs(s-t)<.075))starts.push(t);
  }
  if(!starts.length)starts.push(0);
  starts.sort((a,b)=>a-b);
  const result=[];
  for(let i=0;i<starts.length;i++) {
    const start=starts[i];
    if(duration-start<.027)continue;
    const next=starts[i+1]??duration;
    result.push({start,len:Math.min(duration-start,clamp(next-start,.055,.52))});
  }
  return result.length?result:[{start:0,len:Math.min(.2,duration)}];
}

/** 音と画面が共有するDNA。BPMは使わず、速度・密度・形態を記録する。 */
export function makeDna(seed) {
  const rng=mulberry32(seed>>>0);
  const presets=[
    {id:'FLEA',name:'PIXEL FLEA',palette:['#34483D','#526650','#7A8C69']},
    {id:'MOTH',name:'ECHO MOTH',palette:['#34483D','#526650','#7A8C69']},
    {id:'WORM',name:'TAPE WORM',palette:['#34483D','#526650','#7A8C69']},
    {id:'PUPA',name:'GRAIN PUPA',palette:['#34483D','#526650','#7A8C69']},
  ];
  const type=pick(rng,presets);
  const cycleSeconds=Math.round(between(rng,3.15,5.7)*10)/10;
  return {seed:seed>>>0,id:type.id,name:type.name,palette:type.palette,
    sprite:Math.floor(rng()*0xFFFFFF),cycleSeconds,
    rate:between(rng,.73,1.58),density:between(rng,.42,.86),
    wobble:between(rng,.015,.11),variation:between(rng,.17,.47)};
}

/** 後段処理やステレオ幅に使う、周期波形のリング型バッファー。 */
function allocate(frames) {return {left:new Float32Array(frames),right:new Float32Array(frames),sampleRate:RATE};}
function wrap(i,n){return ((i%n)+n)%n;}

/**
 * 1つの小さな音声断片を合成する。
 * reverse / ring / crush / gate / wow / filter は、すべて録音サンプルの変形。
 * 出力は循環配置するので、最後の音が先頭まで継続しループ接合部が不自然に切れない。
 */
function addFragment(out,input,opts) {
  const {time,start,len,rate,gain,pan=0,reverse=false,ring=0,crush=1,
    gate=0,wow=0,cutoff=11000,sharp=false}=opts;
  const sr=input.sampleRate;
  const at=Math.floor(clamp(start,0,input.data.length/sr)*sr);
  const sourceCount=Math.min(Math.floor(len*sr),input.data.length-at);
  if(sourceCount<8)return;
  const length=Math.min(Math.round((sourceCount/sr)/Math.max(.25,rate)*RATE),Math.round(RATE*.92));
  if(length<8)return;
  const pos0=Math.round(time*RATE);
  const fade=Math.max(5,Math.min(Math.floor(length*.28),Math.floor(RATE*(sharp?.003:.009))));
  const angle=(clamp(pan,-1,1)+1)*Math.PI/4;
  const gl=Math.cos(angle)*gain,gr=Math.sin(angle)*gain;
  const a=1-Math.exp(-TAU*clamp(cutoff,180,14000)/RATE);
  let low=0,held=0;
  for(let i=0;i<length;i++) {
    const sec=i/RATE;
    const warble=wow?wow*(Math.sin(TAU*5.7*sec)+.31*Math.sin(TAU*13.3*sec)):0;
    const displacement=(i*rate*sr/RATE)*(1+warble);
    const read=reverse?at+sourceCount-1-displacement:at+displacement;
    if(read<at || read>=at+sourceCount-1)break;
    const k=Math.floor(read),f=read-k;
    let x=input.data[k]*(1-f)+input.data[k+1]*f;
    if(crush>1){if(i%crush===0)held=x;x=held;}
    low+=a*(x-low);
    x=low;
    if(ring>0)x*=.45+.55*Math.sin(TAU*ring*sec);
    if(gate>0){const period=Math.max(6,Math.floor(RATE/gate));if((i%period)/period>.68)x*=.12;}
    const env=Math.min(1,i/fade,(length-1-i)/fade);
    const j=wrap(pos0+i,out.left.length);
    out.left[j]+=x*env*gl;
    out.right[j]+=x*env*gr;
  }
}

/** 短い断片を同じ場所の周囲に密集させ、音声由来の微小なリズムを作る。 */
function addStutters(out,input,slice,t,baseRate,rng,settings) {
  const repeats=2+Math.floor(rng()*settings.maxRepeats);
  const gap=between(rng,.038,.118);
  const len=clamp(gap*between(rng,.54,1.25),.026,Math.min(.16,slice.len));
  for(let n=0;n<repeats;n++) {
    const rate=clamp(baseRate*Math.pow(between(rng,.92,1.12),n),.45,3.15);
    addFragment(out,input,{time:t+n*gap,start:slice.start,len,rate,
      gain:settings.gain*(1-n/(repeats+2))*.8,pan:between(rng,-.65,.65),
      reverse:rng()<settings.reverse,ring:settings.ring?between(rng,36,170):0,
      crush:settings.crush?pick(rng,[2,3,4,6]):1,
      cutoff:between(rng,1800,11500),sharp:true});
  }
}

/**
 * ドライ波形を周期的なタップへ加算。元の声をコピーするだけで空間を作る。
 * コピー元のバッファーを分離することでフィードバックの不安定化を防ぐ。
 */
function circularEcho(out,dna,rng) {
  const l=out.left.slice(),r=out.right.slice(),n=l.length;
  const base= dna.id==='MOTH' ? .31 : dna.id==='WORM' ? .19 : .14;
  const offsets=[base,base*2.31,base*3.87].map(x=>Math.round(x*RATE));
  const gains=dna.id==='MOTH'?[.29,.18,.12]:[.22,.12,.07];
  const drift=between(rng,.85,1.2);
  for(let i=0;i<n;i++) {
    for(let j=0;j<offsets.length;j++) {
      const k=wrap(i-Math.round(offsets[j]*drift),n);
      out.left[i]+=r[k]*gains[j];
      out.right[i]+=l[k]*gains[j];
    }
  }
}

/**
 * 2周で1つの作品となる循環ループ。2周目は初回の断片を保持しながら一部を変異。
 * 一般的な4つ打ち、シンセのベースや装飾音は発生させない。
 */
export function hatch(input,seed) {
  if(!input?.data?.length || !(input.sampleRate>0))throw Error('No recorded sound available.');
  const dna=makeDna(seed);
  const rng=mulberry32((seed^0xBEDB0B5)>>>0);
  const frames=Math.round(dna.cycleSeconds*2*RATE);
  const out=allocate(frames);
  const slices=discoverSlices(input);
  const count=dna.id==='FLEA'?26:dna.id==='PUPA'?21:16;
  const unit=dna.cycleSeconds/count;
  // モチーフとなる断片を初回に決めておき、2周目は完全なランダムではなく変奏にする。
  const motif=Array.from({length:count},(_,i)=>({
    slice:pick(rng,slices),
    rate:between(rng,.61,2.16)*dna.rate,
    reverse:rng()<(dna.id==='WORM'?.46:.24),
    skip:rng()>(dna.density+(i%4===0?.12:0)),
    pan:between(rng,-.68,.68),
    jitter:between(rng,-unit*.34,unit*.32),
  }));
  for(let turn=0;turn<2;turn++) {
    for(let step=0;step<count;step++) {
      const m=motif[step],t=turn*dna.cycleSeconds+step*unit+m.jitter;
      if(m.skip && !(turn===1 && rng()<dna.variation))continue;
      const mutated=turn===1 && rng()<dna.variation;
      const slice=mutated?pick(rng,slices):m.slice;
      const rate=clamp(m.rate*(mutated?between(rng,.5,1.85):1),.43,3.25);
      const len=Math.min(slice.len, dna.id==='PUPA'?between(rng,.07,.24):
        dna.id==='WORM'?between(rng,.18,.5):between(rng,.06,.31));
      addFragment(out,input,{time:t,start:slice.start,len,rate,
        gain:dna.id==='MOTH'?.50:.59,pan:m.pan,
        reverse:mutated?!m.reverse:m.reverse,
        ring:dna.id==='PUPA'?between(rng,41,220):dna.id==='FLEA' && rng()<.29?between(rng,31,95):0,
        crush:dna.id==='FLEA' && rng()<.50?pick(rng,[2,3,4,5,7]):1,
        gate:dna.id==='PUPA' && rng()<.43?between(rng,19,53):0,
        wow:dna.id==='WORM'?dna.wobble:0,
        cutoff:dna.id==='MOTH'?between(rng,1300,5500):dna.id==='WORM'?between(rng,800,9200):between(rng,1500,12000)});
      // 主役の音を変形する微小な反復。ドラムではなく声そのものの断続音。
      const chance={FLEA:.67,MOTH:.28,WORM:.23,PUPA:.54}[dna.id];
      if(rng()<chance) {
        addStutters(out,input,slice,t+between(rng,-.016,.065),rate,rng,{
          maxRepeats:dna.id==='FLEA'?5:3,reverse:dna.id==='WORM'?.5:.20,
          ring:dna.id==='PUPA',crush:dna.id==='FLEA',gain:.40});
      }
    }
    // 1周に1〜4個だけ、元音に長く残る断片を置いて「入力した声の痕跡」を残す。
    const anchors=dna.id==='MOTH'?4:dna.id==='WORM'?3:2;
    for(let a=0;a<anchors;a++) {
      const slice=pick(rng,slices);
      addFragment(out,input,{time:turn*dna.cycleSeconds+(a+.28)*dna.cycleSeconds/anchors,
        start:slice.start,len:Math.min(slice.len,.5),rate:dna.id==='WORM'?.67:between(rng,.78,1.34),
        gain:.36,pan:between(rng,-.8,.8),reverse:dna.id==='MOTH'&&rng()<.4,
        wow:dna.id==='WORM'?dna.wobble*.45:0,cutoff:between(rng,2000,10000)});
    }
  }
  circularEcho(out,dna,rng);
  // 時間軸全体をフェードアウトさせず、接合部を含め同じ波形を再生できるようにする。
  let peak=0;
  for(let i=0;i<frames;i++)peak=Math.max(peak,Math.abs(out.left[i]),Math.abs(out.right[i]));
  const gain=peak<.0001?1:Math.min(2,.8/peak);
  for(let i=0;i<frames;i++) {
    out.left[i]=Math.tanh(out.left[i]*gain*1.05)*.9;
    out.right[i]=Math.tanh(out.right[i]*gain*1.05)*.9;
  }
  // 単一サンプルでループ接合部が跳ねる場合のみ、約12msの端点補正を行う。
  const seam=Math.min(Math.floor(RATE*.012),Math.floor(frames*.005));
  for(const channel of [out.left,out.right]) {
    const boundary=(channel[0]+channel[frames-1])*.5;
    for(let i=0;i<seam;i++) {
      const weight=(1-i/seam)**2;
      channel[i]=mix(channel[i],boundary,weight);
      channel[frames-1-i]=mix(channel[frames-1-i],boundary,weight);
    }
  }
  return {...out,duration:frames/RATE,dna};
}

/** WAV/PCM 16bit。ファイル生成時に音声をサーバーへ送らない。 */
export function wavBlob(rendered) {
  const {left,right,sampleRate}=rendered;
  const count=left.length;
  const array=new ArrayBuffer(44+count*4),v=new DataView(array);
  const tag=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
  tag(0,'RIFF');v.setUint32(4,36+count*4,true);tag(8,'WAVE');tag(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);
  v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*4,true);
  v.setUint16(32,4,true);v.setUint16(34,16,true);
  tag(36,'data');v.setUint32(40,count*4,true);
  let p=44;
  for(let i=0;i<count;i++) {
    v.setInt16(p,Math.round(clamp(left[i],-1,1)*32767),true);p+=2;
    v.setInt16(p,Math.round(clamp(right[i],-1,1)*32767),true);p+=2;
  }
  return new Blob([array],{type:'audio/wav'});
}
