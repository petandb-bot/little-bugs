import {hatch, wavBlob, monoFromAudioBuffer, RATE} from './audio-engine.js';
import {BugVisual} from './visual.js';

/**
 * LITTLE BUGS v0.1 — UI and recording
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
};
const visual = new BugVisual($('visual-stage'));
const MAX_RECORD_S = 12;
let context = null;
let state = 'idle';
let mediaStream = null, recorder = null, analyzer = null, meterData = null;
let recordingTimer = null, recordingStart = 0;
let original = null, rendered = null, playingSource = null, playingStart = 0;
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
  ui.hatch.disabled=!original || recording || renderInProgress;
  ui.play.disabled=!rendered || recording || renderInProgress;
  ui.playLabel.textContent=state==='playing'?'STOP':'PLAY';
  ui.playIcon.textContent=state==='playing'?'■':'▶';
  ui.save.disabled=!rendered || recording || renderInProgress;
  ui.meterTitle.textContent=recording?'LIVE MIC':state==='playing'?'PLAYBACK':'MIC INPUT';
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
  const current = playingSource;
  playingSource=null;
  if(current) {
    try { current.stop(); current.disconnect(); } catch (_) { /* 再生終了済みなら無視 */ }
  }
  if(state==='playing') {
    state=rendered?'hatched':'idle'; visual.setMode('hatched');
    setStatus('BUG IS READY TO PLAY.');
  }
  visual.setProgress(0);
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
  if(!original || renderInProgress || state==='recording') return;
  stopPlayback();
  renderInProgress=true;state='hatching';
  ui.stage.textContent='HATCHING…';setStatus('GIVING YOUR VOICE LITTLE LEGS…');syncUI();
  // 大きな同期処理の前に画面を少なくとも1フレーム描画する。
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  try {
    const next=hatch(original,newSeed());
    rendered=next;
    counter++;
    ui.counter.textContent=`NO. ${String(counter).padStart(4,'0')}`;
    ui.stage.textContent=`HELLO, BUG #${String(counter).padStart(3,'0')}!`;
    ui.dna.textContent=`${next.dna.name} / ${next.dna.bpm} BPM`;
    ui.time.textContent=clock(next.duration);
    ui.elapsed.textContent=`${next.duration.toFixed(1)} SEC SONG`;
    visual.setDna(next.dna);
    setStatus('NEW BUG BORN! TAP PLAY OR HATCH AGAIN.');
    state='hatched';
  } catch(err) {state=rendered?'hatched':'recorded';showError(err,'HATCH');}
  renderInProgress=false;syncUI();
}
async function togglePlay() {
  if(state==='playing'){stopPlayback();return;}
  if(!rendered)return;
  try {
    const ctx=await getContext();
    stopPlayback();
    const buffer=ctx.createBuffer(2,rendered.left.length,RATE);
    buffer.copyToChannel(rendered.left,0);buffer.copyToChannel(rendered.right,1);
    const source=ctx.createBufferSource();
    source.buffer=buffer;source.connect(ctx.destination);
    playingSource=source;
    playingStart=ctx.currentTime;
    source.onended=()=>{
      if(playingSource!==source)return;
      playingSource=null;state='hatched';visual.setMode('hatched');
      visual.setProgress(1);setStatus('THE BUG FINISHED ITS LITTLE SONG.');syncUI();
    };
    source.start(0);
    state='playing';visual.setMode('playing');
    setStatus('BUG IS SINGING!');syncUI();
  }catch(err){showError(err,'PLAY');}
}
async function saveWav() {
  if(!rendered)return;
  const filename=`little-bugs-${String(counter).padStart(4,'0')}-${rendered.dna.name.toLowerCase().replace(/\s+/g,'-')}.wav`;
  const blob=wavBlob(rendered);
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
    const elapsed=Math.max(0,context.currentTime-playingStart);
    const progress=Math.min(1,elapsed/rendered.duration);
    visual.setProgress(progress);
    ui.time.textContent=clock(elapsed);
    const period=60/rendered.dna.bpm;
    meterLevel=0.22+0.7*Math.pow(Math.max(0,Math.cos(elapsed/period*Math.PI*2)),6);
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
window.addEventListener('pagehide',()=>{stopPlayback();releaseMic();});
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
}
syncUI();tick();
