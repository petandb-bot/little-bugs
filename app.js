import {hatch, wavBlob, monoFromAudioBuffer, RATE, mixLayers} from './audio-engine.js';
import {BugVisual} from './visual.js';

/**
 * LITTLE BUGS v0.4 — recording, live GROOVE switch and export
 *
 * データは端末上のメモリーにのみ保持します。
 * iOS Safari の MediaRecorder は MP4/AAC を使う場合があるため、
 * MIME を機能検出してから選択し、decodeAudioData へ渡しています。
 */
const $ = (id) => document.getElementById(id);
const ui = {
  rec:$('rec-btn'), recLabel:$('rec-label'), recIcon:$('rec-icon'),
  hatch:$('hatch-btn'), play:$('play-btn'), playLabel:$('play-label'),playIcon:$('play-icon'),
  save:$('save-btn'), status:$('status'), counter:$('counter'),
  time:$('time-label'), elapsed:$('elapsed'), stage:$('stage-label'),dna:$('dna-label'),
  led:$('led'), meter:$('meter-bars'),meterTitle:$('meter-title'),
  groove:$('groove-btn'), grooveText:$('groove-state'),
};
const visual = new BugVisual($('visual-stage'));
const MAX_RECORD_S = 12;
let context = null;
let state = 'idle';
let mediaStream = null, recorder = null, analyzer = null, meterData = null;
let recordingTimer = null, recordingStart = 0;
let original = null, rendered = null;
let playingSource = null, grooveSource = null, grooveGain = null, playingStart = 0;
let grooveEnabled = true;
visual.setGroove(grooveEnabled);
let counter = 0;
let renderInProgress = false;
const meterBars = Array.from({length:26},()=>{
  const el = document.createElement('span'); el.className='meter-bar'; ui.meter.appendChild(el); return el;
});

function clock(seconds) {
  const x = Math.max(0,Math.floor(seconds));
  return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`;
}
function setStatus(msg) { ui.status.textContent=msg; }
function syncUI() {
  const recording = state==='recording';
  ui.rec.disabled=renderInProgress || state==='requesting' || state==='loading';
  ui.rec.classList.toggle('recording',recording);
  ui.rec.setAttribute('aria-label',recording?'Stop recording':'Start recording');
  ui.recLabel.textContent=recording?'STOP':'REC';
  ui.recIcon.textContent=recording?'■':'●';
  ui.led.classList.toggle('rec',recording);
  ui.hatch.disabled=!original || recording || renderInProgress || state==='requesting' || state==='loading';
  ui.play.disabled=!rendered || recording || renderInProgress || state==='requesting' || state==='loading';
  ui.playLabel.textContent=state==='playing'?'STOP':'PLAY';
  ui.playIcon.textContent=state==='playing'?'■':'▶';
  ui.save.disabled=!rendered || recording || renderInProgress || state==='requesting' || state==='loading';
  ui.meterTitle.textContent=recording?'LIVE MIC':state==='playing'?'PLAYBACK':'MIC INPUT';
  ui.groove.setAttribute('aria-pressed',String(grooveEnabled));
  ui.grooveText.textContent=grooveEnabled?'ON':'OFF';
  ui.groove.classList.toggle('enabled',grooveEnabled);
}
function showError(err, action='ACTION') {
  console.error(err);
  let message = `${action} FAILED — TRY AGAIN.`;
  if (err?.name==='NotAllowedError' || err?.name==='PermissionDeniedError') message='MIC ACCESS DENIED. CHECK BROWSER PERMISSIONS.';
  if (err?.name==='NotFoundError') message='NO MICROPHONE FOUND.';
  if (!window.isSecureContext) message='OPEN VIA HTTPS (GITHUB PAGES).';
  setStatus(message);
}
async function getContext() {
  if (!context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Web Audio is unsupported.');
    context = new AudioContext();
  }
  if (context.state!=='running') await context.resume();
  return context;
}
function stopPlayback() {
  const voice = playingSource, backing=grooveSource;
  playingSource=null;grooveSource=null;grooveGain=null;
  for (const src of [voice,backing]) {
    if(src){try{src.stop();src.disconnect();}catch(_){/* すでに終了したソースは無視 */}}
  }
  if(state==='playing'){
    state=rendered?'hatched':'idle';visual.setMode('hatched');
    ui.stage.textContent=`MUTATION NO. ${String(counter).padStart(4,'0')}`;
    setStatus('BUG IS READY TO LOOP.');
  }
  visual.setProgress(0);visual.setElapsed(0);
  syncUI();
}
/** GROOVE を音楽の再生成なしに切り替える。現在の再生位置を保ったまま音量のみ変える。 */
function toggleGroove(){
  grooveEnabled=!grooveEnabled;
  visual.setGroove(grooveEnabled);
  if(grooveGain && context){
    const now=context.currentTime;
    grooveGain.gain.cancelScheduledValues(now);
    grooveGain.gain.setTargetAtTime(grooveEnabled?1:0,now,.015);
  }
  setStatus(grooveEnabled?'GROOVE ON — TINY SOUNDS ADDED.':'GROOVE OFF — ONLY YOUR VOICE.');
  syncUI();
}
function releaseMic() {
  if (recordingTimer!==null) clearTimeout(recordingTimer);
  recordingTimer=null;
  if(mediaStream) mediaStream.getTracks().forEach(track=>track.stop());
  mediaStream=null; analyzer=null; meterData=null;
}
function preferredMime() {
  const options = ['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
  if(!window.MediaRecorder?.isTypeSupported) return '';
  return options.find(type=>MediaRecorder.isTypeSupported(type)) || '';
}
async function startRecording() {
  if(renderInProgress || state==='recording') return;
  stopPlayback();
  state='requesting'; setStatus('OPENING MICROPHONE…'); syncUI();
  try {
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone needs HTTPS or localhost.');
    if(!window.MediaRecorder) throw new Error('This browser does not support MediaRecorder.');
    const audio=await getContext();
    try {
      mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    } catch (firstError) {
      // 端末が細かなオーディオ制約を拒否した場合だけ通常のマイク設定へ戻す。
      if(firstError.name==='OverconstrainedError' || firstError.name==='NotSupportedError') {
        mediaStream=await navigator.mediaDevices.getUserMedia({audio:true});
      } else throw firstError;
    }
    const chunks=[];
    const mime=preferredMime();
    recorder=new MediaRecorder(mediaStream,mime?{mimeType:mime}:undefined);
    recorder.ondataavailable=(e)=>{if(e.data && e.data.size) chunks.push(e.data);};
    recorder.onerror=(event)=>{
      releaseMic(); state=original?'recorded':'idle';syncUI();
      setStatus('RECORDER ERROR. TRY AGAIN.');
      console.error(event);
    };
    recorder.onstop=async()=>{
      releaseMic();
      if(!chunks.length){setStatus('NO AUDIO CAPTURED. TRY AGAIN.');state=original?'recorded':'idle';syncUI();return;}
      state='loading'; syncUI();setStatus('READING YOUR VOICE…');
      try {
        const blob = new Blob(chunks,{type:recorder.mimeType || mime || 'audio/mp4'});
        const ab=await blob.arrayBuffer();
        const decoded=await audio.decodeAudioData(ab);
        if(decoded.duration < .22) throw new Error('Recording too short');
        original=monoFromAudioBuffer(decoded);
        rendered=null;
        visual.setDna(null);
        state='recorded';
        ui.stage.textContent='VOICE CAPTURED!';
        ui.dna.textContent=`${decoded.duration.toFixed(1)} SEC / READY`;
        ui.time.textContent=clock(decoded.duration);
        setStatus('TAP HATCH TO MAKE A BUG.');
      } catch(err) {
        console.error(err);
        state=original?'recorded':'idle';
        setStatus('COULD NOT READ RECORDING. PLEASE TRY AGAIN.');
      }
      syncUI();
    };
    const source=audio.createMediaStreamSource(mediaStream);
    analyzer=audio.createAnalyser(); analyzer.fftSize=512;
    meterData=new Float32Array(analyzer.fftSize);
    source.connect(analyzer); // 出力へ接続しない＝マイクのハウリングを防止
    recorder.start();
    recordingStart=performance.now();
    state='recording';
    visual.setDna(null);visual.setMode('recording');
    ui.stage.textContent='FEEDING THE EGG…'; ui.dna.textContent='SAY SOMETHING NICE!';
    ui.time.textContent='00:00';ui.elapsed.textContent='MAX 12 SEC';
    setStatus('RECORDING… TAP STOP WHEN DONE.');
    syncUI();
    recordingTimer=setTimeout(stopRecording,MAX_RECORD_S*1000);
  }catch(err){
    releaseMic();state=original?'recorded':'idle';syncUI();showError(err,'RECORD');
  }
}
function stopRecording() {
  if(state!=='recording') return;
  if(recorder && recorder.state==='recording') recorder.stop();
  state='loading';visual.setMode('idle');
  ui.stage.textContent='MAKING A LITTLE EGG…';
  setStatus('FINALIZING RECORDING…');
  syncUI();
}
function newSeed() {
  if(window.crypto?.getRandomValues){const buf=new Uint32Array(1);crypto.getRandomValues(buf);return buf[0];}
  return Math.floor(Math.random()*0xFFFFFFFF);
}
async function doHatch() {
  if(!original || renderInProgress || ['recording','requesting','loading'].includes(state)) return;
  stopPlayback();
  renderInProgress=true;state='hatching';
  ui.stage.textContent='HATCHING…';setStatus('SUMMONING A LOOP FROM YOUR VOICE…');syncUI();
  // 大きな同期処理の前に画面を少なくとも1フレーム描画する。
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  try {
    const next=hatch(original,newSeed());
    rendered=next;
    counter++;
    ui.counter.textContent=`NO. ${String(counter).padStart(4,'0')}`;
    ui.stage.textContent=`MUTATION NO. ${String(counter).padStart(4,'0')}`;
    ui.dna.textContent=`VOICE LOOP / ${next.dna.bpm} BPM`;
    ui.time.textContent=clock(next.duration);
    ui.elapsed.textContent=`${next.duration.toFixed(1)} SEC LOOP`;
    visual.setDna(next.dna);
    setStatus('IT LIVES. TAP PLAY OR HATCH AGAIN.');
    state='hatched';
  } catch(err) {state=rendered?'hatched':'recorded';showError(err,'HATCH');}
  renderInProgress=false;syncUI();
}
/** 同じタイムスタンプから声と薄い伴奏を再生。ON/OFF後もループ位相がずれない。 */
async function togglePlay() {
  if(state==='playing'){stopPlayback();return;}
  if(!rendered)return;
  try {
    const ctx=await getContext();
    stopPlayback();
    const toBuffer=(stereo)=>{
      const buffer=ctx.createBuffer(2,stereo.left.length,RATE);
      buffer.copyToChannel(stereo.left,0);buffer.copyToChannel(stereo.right,1);
      return buffer;
    };
    const voice=ctx.createBufferSource();voice.buffer=toBuffer(rendered.voice);voice.loop=true;
    const backing=ctx.createBufferSource();backing.buffer=toBuffer(rendered.groove);backing.loop=true;
    const gain=ctx.createGain();gain.gain.value=grooveEnabled?1:0;
    voice.connect(ctx.destination);backing.connect(gain);gain.connect(ctx.destination);
    const when=ctx.currentTime+.04;
    playingSource=voice;grooveSource=backing;grooveGain=gain;playingStart=when;
    voice.onended=()=>{
      if(playingSource!==voice)return;
      playingSource=null;grooveSource=null;grooveGain=null;
      state='hatched';visual.setMode('hatched');syncUI();
    };
    voice.start(when);backing.start(when);
    state='playing';visual.setMode('playing');
    ui.stage.textContent='BUG IS LOOPING…';
    setStatus('LOOPING… TAP PLAY TO STOP.');syncUI();
  }catch(err){stopPlayback();showError(err,'PLAY');}
}
async function saveWav() {
  if(!rendered)return;
  const filename=`little-bugs-${String(counter).padStart(4,'0')}-${grooveEnabled?'groove':'voice'}.wav`;
  // 再生中であっても、GROOVEの最新状態を含めたWAVを保存する。
  const blob=wavBlob(mixLayers(rendered,grooveEnabled));
  const file=new File([blob],filename,{type:'audio/wav'});
  // iPhone では共有シートを優先し、ファイル App への保存を容易にする。
  // Web Share はユーザーの直接操作時のみ呼ぶ（ブラウザーの制約）。
  const isIOS=/iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  if(isIOS && navigator.share && navigator.canShare?.({files:[file]})){
    try {
      await navigator.share({files:[file],title:'LITTLE BUGS'});
      setStatus('BUG SHARED / SAVED!');return;
    }catch(err){if(err.name==='AbortError')return;console.warn('Share unavailable:',err);}
  }
  // 通常のブラウザーでは WAV のダウンロードを開始。
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  setStatus('WAV FILE READY / SAVED!');
}

// レベルメーターとカウンターを音声状態に同期させる。
function tick() {
  let meterLevel=0;
  if(state==='recording' && analyzer && meterData) {
    analyzer.getFloatTimeDomainData(meterData);
    let rms=0;
    for(let i=0;i<meterData.length;i++)rms+=meterData[i]*meterData[i];
    rms=Math.sqrt(rms/meterData.length);
    meterLevel=Math.min(1,Math.sqrt(rms)*2.8);
    visual.setLevel(meterLevel);
    const duration=(performance.now()-recordingStart)/1000;
    ui.time.textContent=clock(duration);
    ui.elapsed.textContent=`${Math.max(0,MAX_RECORD_S-duration).toFixed(1)} SEC LEFT`;
  } else if(state==='playing' && context && rendered) {
    const elapsed=Math.max(0,(context.currentTime-playingStart)%rendered.duration);
    const progress=Math.min(1,elapsed/rendered.duration);
    visual.setProgress(progress);visual.setElapsed(elapsed);
    ui.time.textContent=clock(elapsed);
    // 入力から生成した波形の短時間音量でメーターを動かす。人工的な拍は使わない。
    const start=Math.min(rendered.voice.left.length-1,Math.floor(elapsed*RATE));
    let energy=0,n=0;
    for(let k=0;k<1024;k+=8){
      const idx=(start+k)%rendered.voice.left.length;
      const x=rendered.voice.left[idx]+(grooveEnabled?rendered.groove.left[idx]:0);
      const y=rendered.voice.right[idx]+(grooveEnabled?rendered.groove.right[idx]:0);
      energy+=x*x+y*y;n+=2;
    }
    meterLevel=Math.min(1,Math.sqrt(energy/Math.max(1,n))*3.2);
    visual.setLevel(meterLevel);
  } else visual.setLevel(0);
  meterBars.forEach((bar,i)=>{
    const waviness=Math.sin(i*1.19+performance.now()*.002)*.11;
    bar.classList.toggle('on',i/meterBars.length<meterLevel+waviness);
  });
  requestAnimationFrame(tick);
}
ui.rec.addEventListener('click',()=>state==='recording'?stopRecording():startRecording());
ui.hatch.addEventListener('click',doHatch);
ui.play.addEventListener('click',togglePlay);
ui.save.addEventListener('click',saveWav);
ui.groove.addEventListener('click',toggleGroove);
window.addEventListener('pagehide',()=>{stopPlayback();releaseMic();});
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
}
syncUI();tick();
