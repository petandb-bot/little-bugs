/**
 * LITTLE BUGS v0.1 — Audio engine
 *
 * プログラムの核は「同じ録音＋同じ seed => 同じ結果」です。
 * エフェクトのランダム接続ではなく、4小節の音楽的な構造を先に作り、
 * そこへ音声断片・玩具シンセ・ドラム・空間エフェクトを配置します。
 *
 * 外部通信・依存ライブラリはなく、処理はブラウザー内で完結します。
 */

export const RATE = 44100;
const TWO_PI = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// seed で音の配置や生物の遺伝子を固定する疑似乱数。セキュリティ用途では使いません。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function randomInt(rng, a, b) { return Math.floor(a + rng() * (b - a + 1)); }

export function monoFromAudioBuffer(buffer) {
  const out = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / channels;
  }
  // マイク固有の直流成分を除去し、録音機種による基準音量の差を減らす。
  let dc = 0, peak = 0;
  for (let i = 0; i < out.length; i++) {
    dc += (out[i] - dc) * 0.0008;
    out[i] -= dc;
    const abs = Math.abs(out[i]);
    if (abs > peak) peak = abs;
  }
  // 小声でも遊べるように録音音量のみ最大約 0.8 へ持ち上げる。
  // ほぼ無音の場合は大きなノイズにならないよう増幅を制限する。
  const scale = peak < 0.004 ? 1 : Math.min(8, 0.82 / peak);
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return { data: out, sampleRate: buffer.sampleRate, duration: buffer.duration, peak };
}

/**
 * 録音から発声の立ち上がりを大雑把に検出します。
 * 音声認識やAIではなく短時間 RMS によるトランジェント検出。
 * トランジェントが少ない持続声では一定間隔の分割点を補います。
 */
function discoverSlices(input) {
  const { data, sampleRate: sr } = input;
  const windowSize = Math.max(128, Math.round(sr * 0.022));
  const energies = [];
  for (let pos = 0; pos < data.length; pos += windowSize) {
    let sum = 0, count = 0;
    for (let j = pos; j < Math.min(data.length, pos + windowSize); j += 3) {
      sum += data[j] * data[j]; count++;
    }
    energies.push(Math.sqrt(sum / Math.max(1, count)));
  }
  const sorted = [...energies].sort((a,b) => a-b);
  const loud = sorted[Math.floor(sorted.length * 0.78)] || 0;
  const threshold = Math.max(0.013, loud * 0.30);
  const starts = [];
  let last = -0.18;
  for (let i = 1; i < energies.length - 1; i++) {
    const previous = (energies[i-1] + (energies[i-2] || 0)) * 0.5;
    const t = i * windowSize / sr;
    if (energies[i] > threshold && energies[i] > previous * 1.65 && t - last > 0.105) {
      starts.push(Math.max(0, t - 0.023)); last = t;
    }
  }
  const duration = data.length / sr;
  // 間延びした入力でも1〜12秒の範囲から反応のよい場所を抽出する。
  const guide = Math.min(0.42, Math.max(0.17, duration / 10));
  for (let t = 0; t < Math.max(0.01, duration - 0.09); t += guide) {
    const i = Math.min(energies.length - 1, Math.floor((t + 0.045) * sr / windowSize));
    if (energies[i] >= threshold * 0.72 && !starts.some(s => Math.abs(s - t) < 0.11)) starts.push(t);
  }
  if (starts.length === 0) starts.push(0);
  starts.sort((a,b) => a-b);
  const slices = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const next = starts[i+1] ?? duration;
    const len = clamp(next - start, 0.09, 0.43);
    if (duration - start > 0.07) slices.push({ start, len });
  }
  return slices.length ? slices : [{start: 0, len: Math.min(duration, 0.4)}];
}

/**
 * サウンドと同じ seed に依存する「音響 DNA」。
 * ここで決めた性格をビジュアル側にも共有します。
 */
export function makeDna(seed) {
  const rng = mulberry32(seed >>> 0);
  const types = [
    {id:'CHIP', name:'CHIP HOP', palette:['#FF92BD','#FFDD78','#85F0DF'], tempo:[136,171], voice:[1.40,2.08]},
    {id:'BOUNCE', name:'BUBBLE POP', palette:['#80EADD','#FFC96C','#FA8FC0'], tempo:[112,148], voice:[1.12,1.64]},
    {id:'CHOIR', name:'TINY CHOIR', palette:['#D3B7FF','#9CE9F4','#FFF193'], tempo:[100,138], voice:[1.0,1.48]},
    {id:'ROBO', name:'ROBO PARADE', palette:['#FFB36A','#F986B7','#B2C5FF'], tempo:[119,157], voice:[0.92,1.52]},
  ];
  const type = pick(rng, types);
  return {
    seed: seed >>> 0, id: type.id, name: type.name, palette: type.palette,
    bpm: randomInt(rng, type.tempo[0], type.tempo[1]),
    rate: type.voice[0] + rng() * (type.voice[1] - type.voice[0]),
    sprite: randomInt(rng, 0, 999999),
    melody: randomInt(rng, 0, 4),
    brightness: 0.4 + rng() * 0.5,
  };
}

/** 波形をミックスするときの最小単位。パンによる音量の変化を抑えます。 */
function addStereo(out, index, value, pan = 0) {
  if (index < 0 || index >= out.left.length) return;
  const angle = (clamp(pan, -1, 1) + 1) * Math.PI / 4;
  out.left[index] += value * Math.cos(angle);
  out.right[index] += value * Math.sin(angle);
}

/**
 * マイク音声の断片を可変再生速度でレンダリング。
 * 0.005秒程度のフェードイン・アウトを常にかけ、クリックノイズを抑えます。
 * ピッチを上げると速度も上がる意図的に玩具的な方式です。
 */
function addVoice(out, input, slice, time, rate, gain, pan, robo = false) {
  const sr = input.sampleRate;
  const sourceStart = Math.max(0, Math.floor(slice.start * sr));
  const available = Math.min(Math.floor(slice.len * sr), input.data.length - sourceStart);
  const duration = available / sr / rate;
  const outputLen = Math.max(1, Math.floor(duration * RATE));
  const start = Math.round(time * RATE);
  const ramp = Math.min(Math.floor(RATE * 0.009), Math.floor(outputLen * 0.25));
  for (let i = 0; i < outputLen && start + i < out.left.length; i++) {
    const samplePos = sourceStart + i * rate * sr / RATE;
    const base = Math.floor(samplePos);
    if (base + 1 >= input.data.length) break;
    const fraction = samplePos - base;
    const sample = input.data[base] * (1 - fraction) + input.data[base+1] * fraction;
    const envelope = Math.min(1, i / Math.max(1,ramp), (outputLen-1-i)/Math.max(1,ramp));
    const robot = robo ? (0.68 + 0.32 * Math.sin(TWO_PI * 53 * i / RATE)) : 1;
    addStereo(out, start+i, sample * envelope * gain * robot, pan);
  }
}

function addKick(out, time, gain) {
  const start = Math.round(time * RATE);
  let phase = 0;
  for (let i = 0, count = Math.round(.24 * RATE); i < count && start+i < out.left.length; i++) {
    const t = i / RATE;
    const frequency = 53 + 126 * Math.exp(-t * 35);
    phase += TWO_PI * frequency / RATE;
    const env = Math.exp(-t * 21);
    const click = (i < RATE * .005) ? 0.14 * (1 - i/(RATE * .005)) : 0;
    addStereo(out, start+i, (Math.sin(phase) * env + click) * gain, 0);
  }
}

function addSnare(out, time, gain, rng) {
  const start = Math.round(time * RATE);
  let previous = 0;
  for (let i = 0, count = Math.round(.135 * RATE); i < count && start+i < out.left.length; i++) {
    const t = i / RATE;
    const white = rng() * 2 - 1;
    const filtered = white - previous * 0.7;
    previous = white;
    const tone = Math.sin(TWO_PI * 175 * t) * 0.2;
    addStereo(out, start+i, (filtered * .35 + tone) * Math.exp(-t * 29) * gain, -.08);
  }
}

function addHat(out, time, gain, pan, rng) {
  const start = Math.round(time * RATE);
  let prev = 0;
  for (let i = 0, count = Math.round(.07 * RATE); i < count && start+i < out.left.length; i++) {
    const t = i / RATE;
    const white = rng()*2-1;
    const high = white - prev; prev = white;
    addStereo(out, start+i, high * Math.exp(-t*66) * gain * .25, pan);
  }
}

function addTone(out, time, freq, duration, gain, pan, wave = 'toy') {
  const start = Math.round(time * RATE);
  const count = Math.round(duration * RATE);
  let phase = 0;
  for (let i = 0; i < count && start+i < out.left.length; i++) {
    const t = i / RATE;
    const pitchBend = 1 + 0.14 * Math.exp(-t*34);
    phase += TWO_PI * freq * pitchBend / RATE;
    const triangle = (2 / Math.PI) * Math.asin(Math.sin(phase));
    const square = Math.tanh(Math.sin(phase)*4);
    const voice = wave === 'bell' ? (Math.sin(phase) * 0.6 + Math.sin(phase*2.02)*0.22) : triangle*.72 + square*.19;
    const attack = Math.min(1, t*120);
    const release = Math.exp(-t*(wave === 'bell' ? 8 : 16));
    addStereo(out, start+i, voice * attack * release * gain, pan);
  }
}

/** 小さなステレオ・エコー。遅延音を逐次合成して短い残響を作ります。 */
function applyEcho(out, bpm, dryMix, feedback) {
  const tapA = Math.floor((60/bpm) * .75 * RATE);
  const tapB = Math.floor((60/bpm) * 1.5 * RATE);
  for (let i = tapA; i < out.left.length; i++) {
    const l = out.left[i-tapA], r = out.right[i-tapA];
    out.left[i] += r * feedback * dryMix;
    out.right[i] += l * feedback * dryMix;
    if (i >= tapB) {
      out.left[i] += out.left[i-tapB] * feedback * .18;
      out.right[i] += out.right[i-tapB] * feedback * .18;
    }
  }
}

/**
 * 1〜12 秒程度の録音から約 6〜11 秒の短い演奏を生成します。
 * オフライン合成を Float32Array で行うため、再生音と保存 WAV は一致します。
 * 音量は最終段でピーク補正＋ソフトクリップし、極端な入力にも耐えます。
 */
export function hatch(input, seed) {
  if (!input?.data?.length || !(input.sampleRate > 0)) throw new Error('No recorded sound available.');
  const dna = makeDna(seed);
  const rng = mulberry32((seed ^ 0xBEDB0B5) >>> 0);
  const beat = 60 / dna.bpm;
  const step = beat / 4;
  const bars = 4;
  const songSeconds = bars * 4 * beat;
  const totalSeconds = songSeconds + 1.2;
  const frames = Math.ceil(totalSeconds * RATE);
  const out = {left:new Float32Array(frames),right:new Float32Array(frames),sampleRate:RATE};
  const slices = discoverSlices(input);
  const scale = [0,2,4,7,9,12]; // 明るいメジャー・ペンタトニックの相対音程
  const voicePattern = Array.from({length:16}, (_,i) => i === 0 || i === 4 || i === 8 || i === 12 || rng() < (dna.id === 'CHIP' ? .77 : .57));
  const notePattern = Array.from({length:16}, () => pick(rng, scale));
  const slicePattern = Array.from({length:16}, () => pick(rng, slices));
  const rootHz = pick(rng, [196,220,246.94,261.63,293.66]);
  for (let s = 0; s < bars*16; s++) {
    const pos = s % 16;
    const bar = Math.floor(s / 16);
    const t = s * step;
    // 4つ打ちではなく、小さなドラムマシンの跳ねるリズム。
    if (pos % 4 === 0 && (pos !== 12 || rng() > .2)) addKick(out, t, dna.id === 'CHOIR' ? .35 : .5);
    if (pos === 4 || pos === 12) addSnare(out, t, .22, rng);
    if (s % 2 === 0 && (rng() > .16 || pos === 0)) addHat(out, t, .14 + rng()*.09, pos % 4 ? .38 : -.35, rng);
    if (s % 4 === 0 && (pos !== 8 || rng() > .25)) {
      const interval = pick(rng, [0,4,7,9,12]);
      const low = (dna.id === 'CHOIR' ? 1 : .5);
      addTone(out, t + .012, rootHz * low * Math.pow(2, interval/12), .34, .08, pos === 4 ? -.28 : .28, 'toy');
    }
    // 毎小節、原型を残しながら数カ所変化させることで音楽的な反復を維持。
    if (voicePattern[pos] && (bar < 3 || rng() > .16)) {
      const slice = rng() < .8 ? slicePattern[pos] : pick(rng, slices);
      const interval = notePattern[pos];
      const extra = bar === 3 && rng() > .7 ? 7 : 0;
      const rate = clamp(dna.rate * Math.pow(2, (interval + extra) / 12), .80, 3.5);
      const swing = (pos % 2) * (dna.id === 'BOUNCE' ? step*.16 : step*.075);
      const pan = (rng()-.5)*.8;
      addVoice(out, input, slice, t + swing, rate, dna.id === 'CHOIR' ? .53 : .72, pan, dna.id === 'ROBO');
      if (dna.id === 'CHOIR' || (dna.id === 'ROBO' && rng() < .25)) {
        // 極短い遅延と異なる音程で、小さな複数の声が喋る効果。
        addVoice(out, input, slice, t + swing + .035, rate * .75, .28, -pan-.25, dna.id === 'ROBO');
      }
      if (dna.id === 'BOUNCE' && rng() < .19) {
        addVoice(out, input, slice, t + swing + step*.50, rate * 1.18, .26, -pan, false);
      }
    }
    // 録音由来のリズムの間に、軽い音程的な返答を差し込む。
    if ((pos === 3 || pos === 11 || (pos === 15 && bar % 2)) && rng() < .93) {
      const interval = notePattern[(pos+2)%16];
      addTone(out, t, rootHz * 2 * Math.pow(2, interval/12), .24, .16, rng()>.5?.55:-.55, 'bell');
    }
  }
  // 最後を小さなチャイムで終える。原音が無音でも音楽的な返答が存在する。
  addTone(out, songSeconds - beat*.5, rootHz*2, .42, .22, -.33, 'bell');
  addTone(out, songSeconds - beat*.25, rootHz*2*Math.pow(2,4/12), .42, .19, .33, 'bell');
  applyEcho(out, dna.bpm, 1, dna.id === 'CHOIR' ? .28 : .19);
  // 最後の 100ms をフェードアウト、歪まない範囲に自動レベル調整。
  let peak = .0001;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(out.left[i]), Math.abs(out.right[i]));
  const makeup = Math.min(1.7, .82 / peak);
  const tail = Math.round(RATE * .11);
  for (let i = 0; i < frames; i++) {
    const fade = Math.min(1, (frames-1-i) / tail);
    out.left[i] = Math.tanh(out.left[i]*makeup*1.05) * .92 * fade;
    out.right[i] = Math.tanh(out.right[i]*makeup*1.05) * .92 * fade;
  }
  return { ...out, duration: frames/RATE, dna };
}

/** WAV 16-bit PCM ステレオ形式をローカルで作成。ネット送信は一切しません。 */
export function wavBlob(rendered) {
  const {left,right,sampleRate} = rendered;
  const frames = left.length;
  const buffer = new ArrayBuffer(44 + frames*4);
  const view = new DataView(buffer);
  const ascii = (pos, s) => { for (let i=0;i<s.length;i++) view.setUint8(pos+i,s.charCodeAt(i)); };
  ascii(0,'RIFF'); view.setUint32(4, 36+frames*4, true); ascii(8,'WAVE'); ascii(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,2,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*4,true);
  view.setUint16(32,4,true); view.setUint16(34,16,true);
  ascii(36,'data'); view.setUint32(40,frames*4,true);
  let offset=44;
  for (let i=0;i<frames;i++) {
    view.setInt16(offset,Math.round(clamp(left[i],-1,1)*32767),true); offset+=2;
    view.setInt16(offset,Math.round(clamp(right[i],-1,1)*32767),true); offset+=2;
  }
  return new Blob([buffer], {type:'audio/wav'});
}
