/**
 * LITTLE BUGS v1.0 — MOVING VOICE & TOY MUSIC
 *
 * すべて独立したWeb Audio向けの波形処理。商用プラグインのコードやアルゴリズムは使用しない。
 * エフェクトを単に直列に積み上げず、発音がある部分に限って短い「事件」を起こす。
 * パンニングやディレイは録音素材を主役にし、シンセは同じ拍と調性感を共有する。
 */
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
export function randomFactory(seed){
 let x=seed>>>0;
 return ()=>{x=(x+0x6D2B79F5)|0;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};
}
function monoEnergy(a,b,from,to){let sum=0,n=0;
 for(let i=from;i<to;i+=97){const x=(a[i]||0)+(b[i]||0);sum+=x*x;n++;}return Math.sqrt(sum/Math.max(n,1));
}

/**
 * Event-driven Effectrix / Replicant 型の部分変異。
 * 小節の一定位置だけを壊すのではなく、発話イベントの中に加工を置く。
 * エフェクトを適用しない区間には元の声がそのまま残る。
 */
export function applyStepMutations(layer,dna,seed,events,rate=44100){
 const rng=randomFactory(seed),n=layer.left.length,beat=60/dna.bpm,barDuration=n/rate/4;
 const srcL=layer.left.slice(),srcR=layer.right.slice();
 const effects=['stutter','reverse','half','crush','gate'];
 const actions=[];
 for(let bar=0;bar<4;bar++){
  const active=(events||[]).filter(e=>e.time<barDuration*(bar+1)-.08&&e.end>barDuration*bar+.1&&e.duration>.15);
  const count=bar===3?2:1;
  for(let k=0;k<count;k++){
   if(!active.length)continue;
   const e=active[Math.floor(rng()*active.length)];
   const start=clamp(e.time+Math.min(e.duration*.32,beat*.33)+rng()*Math.min(.10,e.duration*.14),bar*barDuration+.07,(bar+1)*barDuration-.20);
   const duration=Math.min(.17+beat*rng()*.54,e.end-start+.13,(bar+1)*barDuration-start-.04);
   if(duration<.09)continue;
   const begin=Math.max(0,Math.floor(start*rate)),end=Math.min(n,Math.floor((start+duration)*rate));
   if(monoEnergy(srcL,srcR,begin,end)<.0025)continue;
   const type=effects[(bar*3+k+Math.floor(rng()*5))%effects.length];
   const amount=dna.id==='BROKEN'?.82:dna.id==='CHOIR'?.43:.56;
   const cell=Math.max(250,Math.round(beat*rate*(type==='half'?.20:.115)));
   const edge=Math.min(Math.round(rate*.018),Math.floor((end-begin)/7));
   let holdL=0,holdR=0;
   for(let i=begin;i<end;i++){
    const local=i-begin,progress=local/(end-begin),env=Math.min(1,local/Math.max(1,edge),(end-1-i)/Math.max(1,edge));
    const wet=amount*clamp(env,0,1);
    let pos=i,addL,addR;
    if(type==='stutter')pos=begin+(local%cell);
    else if(type==='reverse')pos=end-1-local;
    else if(type==='half')pos=begin+Math.floor(local*.53)%Math.max(1,end-begin);
    pos=clamp(pos,0,n-1);
    addL=srcL[pos];addR=srcR[pos];
    if(type==='crush'){
     if(local%11===0){holdL=Math.round(addL*22)/22;holdR=Math.round(addR*22)/22;}
     addL=holdL;addR=holdR;
    }
    if(type==='gate'){
     const gate=(local%cell)<cell*.63?1:.08;addL*=gate;addR*=gate;
    }
    // 部分変異を高音量で上書きせず、原音との比率を保持する。
    layer.left[i]=mix(srcL[i],addL,wet);
    layer.right[i]=mix(srcR[i],addR,wet);
   }
   actions.push({type,time:start,duration});
  }
 }
 layer.stepActions=actions;
 return actions;
}

/**
 * PanMan の発音追従パン／ステップモーションの発想を参考にした独立実装。
 * 原音を完全に左右へ振り切らず、モノ成分の大半はセンターに残す。
 * 25ms前後の滑らかな遷移を使い、ステレオでしか聴けない変化に偏らないようにする。
 */
export function applyMovingPan(layer,dna,seed,events,rate=44100){
 const rng=randomFactory(seed),n=layer.left.length,beat=60/dna.bpm;
 const positions=Array.from({length:8},()=>rng()*1.7-.85);
 const speed=beat*(rng()<.5?.5:1);
 const mode=rng()<.38?'orbit':rng()<.62?'step':'trigger';
 const strength=dna.id==='BROKEN'?.60:.40;
 const attack=1-Math.exp(-1/(rate*.026));
 const onsets=(events||[]).filter(e=>e.gain>.38).map(e=>e.time).sort((a,b)=>a-b);
 let smooth=0,next=0,trigger=0;
 for(let i=0;i<n;i++){
  const time=i/rate;
  let target;
  if(mode==='orbit')target=.78*Math.sin(TAU*time/(beat*2.2)+.3);
  else if(mode==='step')target=positions[Math.floor(time/speed)%positions.length];
  else {
   while(next<onsets.length&&onsets[next]<=time){trigger++;next++;}
   target=positions[trigger%positions.length];
  }
  smooth+=(target-smooth)*attack;
  const l=layer.left[i],r=layer.right[i],center=(l+r)*.5;
  const pan=clamp(smooth*strength,-.65,.65);
  const a=Math.cos((pan+1)*Math.PI/4)*Math.SQRT2;
  const b=Math.sin((pan+1)*Math.PI/4)*Math.SQRT2;
  layer.left[i]=mix(l,center*a,.59);
  layer.right[i]=mix(r,center*b,.59);
 }
 return mode;
}

/**
 * 時間を刻む可変ディレイ。固定の3-tap echo と異なり、4つのリズム構成から選択。
 * ダッキング、ゆっくり変動するディレイ時間、左右の移動、逆方向の残響を導入。
 * wet は乾いた声より後ろへ置く。ループ端は元の波形へ折り返す。
 */
export function applyToyDelay(layer,dna,seed,rate=44100){
 const rng=randomFactory(seed),n=layer.left.length,beat=60/dna.bpm;
 const modes=[
  {name:'PING-PONG',tap:[[.5,.25],[1.5,.19],[2.25,.11]]},
  {name:'DUB-SKIP',tap:[[.75,.27],[1.75,.16],[3,.10]]},
  {name:'WOBBLE-TAPE',tap:[[.375,.23],[1.125,.20],[2.5,.09]]},
  {name:'GHOST-TAPS',tap:[[1,.26],[1.75,.14],[2.75,.09]]}
 ];
 const mode=modes[Math.floor(rng()*modes.length)];
 const L=layer.left.slice(),R=layer.right.slice(),wL=new Float32Array(n),wR=new Float32Array(n);
 for(let t=0;t<mode.tap.length;t++){
  const [b,gain]=mode.tap[t];
  const offset=b*beat*rate;
  for(let i=0;i<n;i++){
   const phase=TAU*(i/rate)/(beat*(2+t));
   const wander=mode.name==='WOBBLE-TAPE'?Math.sin(phase)*rate*.006:Math.sin(phase)*rate*.0015;
   const pos=i-offset-wander;
   let k=Math.floor(pos)%n;if(k<0)k+=n;
   const f=pos-Math.floor(pos),j=(k+1)%n;
   const dl=mix(L[k],L[j],f),dr=mix(R[k],R[j],f);
   const m=Math.sin(phase*.5+t)*.54;
   const leftP=clamp(.46-m,-.3,1),rightP=clamp(.46+m,-.3,1);
   wL[i]+=(dl*leftP+dr*(1-leftP)*.36)*gain;
   wR[i]+=(dr*rightP+dl*(1-rightP)*.36)*gain;
  }
 }
 const aHP=1-Math.exp(-TAU*220/rate),aLP=1-Math.exp(-TAU*3600/rate);
 let lowL=0,lowR=0,hiL=0,hiR=0,env=0;
 const followUp=1-Math.exp(-1/(rate*.007)),followDown=1-Math.exp(-1/(rate*.11));
 for(let i=0;i<n;i++){
  lowL+=(wL[i]-lowL)*aHP;lowR+=(wR[i]-lowR)*aHP;
  hiL+=((wL[i]-lowL)-hiL)*aLP;hiR+=((wR[i]-lowR)-hiR)*aLP;
  const peak=Math.max(Math.abs(L[i]),Math.abs(R[i]));
  env+=(peak>env?followUp:followDown)*(peak-env);
  const duck=clamp(1.05-env*3.9,.43,1);
  layer.left[i]+=Math.tanh(hiL*1.4)*duck*.92;
  layer.right[i]+=Math.tanh(hiR*1.4)*duck*.92;
 }
 return mode.name;
}

const midiToHz=m=>440*Math.pow(2,(m-69)/12);
const toMidi=f=>69+12*Math.log2(f/440);
function addNote(out,time,duration,frequency,volume,kind,pan,rate,rng){
 const n=out.left.length,at=Math.round(time*rate),samples=Math.min(Math.floor(duration*rate),n),l=Math.cos((pan+1)*Math.PI/4),r=Math.sin((pan+1)*Math.PI/4);
 if(at>=n)return;
 const phaseOffset=rng()*TAU;
 for(let j=0;j<samples;j++){
  const t=j/rate,rel=j/Math.max(1,samples-1),i=at+j;
  if(i<0||i>=n)continue;
  const attack=clamp(t/(kind==='pad'?.060:.009),0,1);
  const release=clamp((1-rel)/(kind==='pad'?.20:.09),0,1);
  let amp=attack*release,carrier=0;
  if(kind==='pluck'){
   amp*=Math.exp(-t*4.7);
   const modulation=Math.sin(TAU*frequency*1.98*t)*1.55*Math.exp(-t*9);
   carrier=Math.sin(TAU*frequency*t+modulation)+.21*Math.sin(TAU*frequency*2*t+phaseOffset)*Math.exp(-t*5);
  }else if(kind==='bass'){
   amp*=Math.exp(-t*5.2);
   carrier=Math.sin(TAU*frequency*t+.65*Math.exp(-t*20)*Math.sin(TAU*frequency*2*t));
   carrier+=.19*Math.sin(TAU*frequency*2*t);
  }else{
   amp*=Math.exp(-t*.72);
   carrier=.76*Math.sin(TAU*frequency*t+phaseOffset)+.22*Math.sin(TAU*frequency*2*t+phaseOffset*.3);
   carrier+=.13*Math.sin(TAU*frequency*1.004*t+phaseOffset*1.7);
  }
  const v=carrier*amp*volume;
  out.left[i]+=v*l;out.right[i]+=v*r;
 }
}

/**
 * GROOVE は打楽器の追加ではなく、音階を持った短いシンセアンサンブル。
 * 声から推定した音高を穏やかに量子化し、sus/pentatonic 系の音を選ぶ。
 * 4章の同じモチーフを反復しつつ、3章目だけ軽く変奏する。
 * 発音イベントの位相へ寄せるため、声と別々の拍で走らない。
 */
export function planToyMusic(voiceEvents,dna,seed,duration,pitchHz){
 const rng=randomFactory(seed),beat=60/dna.bpm,bar=duration/4;
 const reliable=Number.isFinite(pitchHz)&&pitchHz>100&&pitchHz<420;
 // 誤推定した音高へ強引に合わせるより、安定したルートと5度を基本にする。
 const midiRoot=reliable?Math.round(toMidi(pitchHz)): [57,60,62,65,67][Math.floor(rng()*5)];
 const pitchClass=((midiRoot%12)+12)%12;
 const leadRoot=60+pitchClass; // C4より上に置いて低音のモゴモゴを避ける
 const bassRoot=48+pitchClass;
 const mode=rng()<.5?'SUS':'PENTA';
 const intervals=mode==='SUS'?[0,2,5,7,9]:[0,2,4,7,9];
 const motifs=[[0,2,1,3],[0,1,3,2],[0,2,3,1],[0,3,2,1]];
 const motif=motifs[Math.floor(rng()*motifs.length)];
 const events=[];
 const audible=(voiceEvents||[]).filter(e=>e.gain>.39&&e.duration>.13);
 const first=audible.length?audible[0].time:0;
 const phase=clamp(Math.round((first%beat)/(beat*.25))*.25,0,.5)*beat;
 const barBeats=bar/beat;
 for(let b=0;b<4;b++){
  const start=b*bar;
  // キック風の重低音ではなく、丸いベース音を小節の頭に短く配置。
  events.push({kind:'bass',time:start+phase*.35,duration:.24,frequency:midiToHz(bassRoot+(b===2?5:0)),gain:.37,pan:-.07,bar:b});
  // 薄い2音和声は休符を確保。セクション変化も和声が連続して聞こえるようにする。
  if(b!==3){
   const root=leadRoot+(b===2?5:0);
   events.push({kind:'pad',time:start+phase*.25+.035,duration:Math.min(bar*.78,1.4),frequency:midiToHz(root),gain:.11,pan:-.28,bar:b});
   events.push({kind:'pad',time:start+phase*.25+.065,duration:Math.min(bar*.73,1.35),frequency:midiToHz(root+7),gain:.075,pan:.32,bar:b});
  }
  // 2小節の反復と小さな応答。歌の声と競合しない短いフレーズ。
  const hitPositions=[.35,1.50,Math.min(2.85,barBeats-.52)];
  for(let j=0;j<3;j++){
   if(b===3&&j===1)continue;
   const noteIndex=motif[(j+(b===2?1:0))%4];
   const voiceOnsets=audible.filter(e=>e.time>=start && e.time<start+bar);
   let t=start+hitPositions[j]*beat+phase*.32;
   if(j===0 && voiceOnsets.length){
    const nearest=voiceOnsets.reduce((best,e)=>Math.abs(e.time-t)<Math.abs(best.time-t)?e:best,voiceOnsets[0]);
    if(Math.abs(nearest.time-t)<beat*.65)t=mix(t,nearest.time,.46);
   }
   t=clamp(t,start+.02,start+bar-.18);
   events.push({kind:'pluck',time:t,duration:.30+beat*.18,frequency:midiToHz(leadRoot+intervals[noteIndex]+(b===2?0:0)),gain:j===0?.29:.23,pan:j===1?.21:-.15,bar:b});
  }
 }
 return {events,rootMidi:leadRoot,mode,phase};
}
export function renderToyMusic(plan,duration,seed,rate=44100){
 const n=Math.round(duration*rate),out={left:new Float32Array(n),right:new Float32Array(n)};
 const rng=randomFactory(seed);
 for(const note of plan.events)addNote(out,note.time,note.duration,note.frequency,note.gain,note.kind,note.pan,rate,rng);
 out.events=plan.events;
 return out;
}

/** 出力の局所音圧で音楽を少し引き、語尾・休符にシンセが現れる。 */
export function duckSynthAgainstVoice(groove,voice,rate=44100){
 let env=0;const attack=1-Math.exp(-1/(rate*.018)),release=1-Math.exp(-1/(rate*.19));
 for(let i=0;i<voice.left.length;i++){
  const level=(Math.abs(voice.left[i])+Math.abs(voice.right[i]))*.5;
  env+=(level>env?attack:release)*(level-env);
  const gain=clamp(1.07-env*3.6,.62,1);
  groove.left[i]*=gain;groove.right[i]*=gain;
 }
}
