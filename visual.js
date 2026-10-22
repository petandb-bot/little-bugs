import {mulberry32} from './audio-engine.js';

/**
 * LITTLE BUGS visual organism
 *
 * p5.js が取得できる環境では p5 のインスタンスモードで Canvas を管理します。
 * CDN がブロックされたときにはネイティブ Canvas に切り替えて遊べるようにしています。
 * 生き物の形・色・動きは sound DNA の sprite seed に従い自動生成。
 * スプライト画像は使わず、左右対称のドットの集合を組み立てます。
 */
export class BugVisual {
  constructor(mount) {
    this.mount = mount;
    this.width = 320; this.height = 260;
    this.mode = 'idle'; this.dna = null; this.level = 0; this.progress = 0;
    this.frame = 0;
    this.setupCanvas();
  }
  setupCanvas() {
    if (window.p5) {
      // p5.js は画面・フレーム更新のライフサイクルを提供する。
      this.p5 = new window.p5(p => {
        p.setup = () => {
          p.createCanvas(this.width, this.height);
          p.pixelDensity(1);
          p.noSmooth();
          p.frameRate(30);
        };
        p.draw = () => this.paint(p.drawingContext);
      }, this.mount);
    } else {
      // ネットワーク障害でも音響体験を失わせないフォールバック。
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.width; this.canvas.height = this.height;
      this.mount.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      const loop = () => { this.paint(this.ctx); this.animation = requestAnimationFrame(loop); };
      loop();
    }
  }
  setMode(mode) { this.mode = mode; }
  setDna(dna) { this.dna = dna; this.mode = dna ? 'hatched' : 'idle'; }
  setLevel(level) { this.level = Math.max(0, Math.min(1,level)); }
  setProgress(p) { this.progress = Math.max(0, Math.min(1,p)); }
  rect(ctx,x,y,w,h,color) { ctx.fillStyle=color; ctx.fillRect(Math.floor(x),Math.floor(y),Math.ceil(w),Math.ceil(h)); }
  paint(ctx) {
    this.frame++;
    const t = this.frame / 30;
    const W = this.width,H = this.height;
    ctx.clearRect(0,0,W,H);
    this.rect(ctx,0,0,W,H,'#11182C');
    // 小さな固定星を擬似乱数で配置。毎フレーム新しい乱数は作らない。
    const stars = mulberry32(this.dna ? this.dna.sprite ^ 0xA731 : 0xA731);
    for (let i=0;i<50;i++) {
      const x = 8 + Math.floor(stars()*303);
      const y = 16 + Math.floor(stars()*206);
      const flash = stars();
      const visible = Math.sin(t*(.7+flash*1.8)+i*1.7) > -.45;
      if (visible) this.rect(ctx,x,y,flash>.85?3:2,flash>.85?3:2,['#425677','#5B527F','#6E5E78'][i%3]);
    }
    // 古い電子ゲームの薄い地面とシンプルな波線。
    this.rect(ctx, 13, 221, 294, 2, '#465272');
    for(let x=15;x<310;x+=21) this.rect(ctx,x,231,7,2,'#2A3659');

    if (!this.dna) {
      this.egg(ctx,t);
    } else {
      this.bug(ctx,t);
    }
    if (this.mode === 'recording') {
      // マイク入力の音量が高いほど録音中の波が大きくなる。
      const power = Math.max(.11,this.level);
      for(let i=0;i<17;i++) {
        const h = 6 + Math.round(Math.abs(Math.sin(t*6+i*.65))*power*28);
        this.rect(ctx,90+i*9,204-h,5,h,i%3===0?'#FFDD73':'#FE87AF');
      }
    }
    if (this.mode === 'playing') {
      // 下端の音楽フレーズ・インジケーターは再生位置と同期する。
      const n = Math.floor(this.progress*24);
      for(let i=0;i<24;i++) this.rect(ctx,43+i*10,240,7,4,i<n?'#8AE9D7':'#334568');
    }
  }
  egg(ctx,t) {
    const wobble = this.mode === 'recording' ? Math.sin(t*8)*Math.min(10,this.level*22+2) : Math.sin(t*2)*2;
    ctx.save(); ctx.translate(160+wobble,126);
    this.rect(ctx,-30,-50,60,9,'#E0D4FA');
    this.rect(ctx,-40,-41,80,12,'#CDB7EF');
    this.rect(ctx,-47,-29,94,49,'#E7DFFA');
    this.rect(ctx,-41,20,82,17,'#CDB7EF');
    this.rect(ctx,-33,37,66,9,'#CDB7EF');
    this.rect(ctx,-24,46,48,6,'#8F91BC');
    this.rect(ctx,-14,-30,10,10,'#FF85B7');
    this.rect(ctx,5,-11,15,10,'#88E8DC');
    this.rect(ctx,-26,6,10,9,'#FFDA72');
    this.rect(ctx,-15,19,29,6,'#CDB7EF');
    ctx.restore();
    for(let i=0;i<3;i++) {
      const y = 96 + Math.sin(t*2+i*2)*4 + i*28;
      this.rect(ctx,87-i*13,y,7,3,'#FA8FBB');
      this.rect(ctx,226+i*11,y+10,6,3,'#8DEBDE');
    }
  }
  bug(ctx,t) {
    const d = this.dna;
    const rng = mulberry32(d.sprite);
    const body = d.palette[0], wing = d.palette[1], highlight = d.palette[2];
    const high = this.mode==='playing' ? 1 : 0.18;
    const bounce = Math.sin(t * (d.bpm/60)*Math.PI*2) * (3+high*8);
    const w = 8;
    const x0 = 160, y0 = 110 + bounce;
    // 脚、尾、触角は DNA で本数・長さを変える。
    const legCount = 2 + Math.floor(rng()*2);
    const antLen = 2 + Math.floor(rng()*3);
    for(let i=0;i<legCount;i++) {
      const sideY = y0 + 7+i*17;
      const wiggle = Math.sin(t*9+i*2)*high*8;
      this.rect(ctx,x0-69+wiggle,sideY,25,8,wing);
      this.rect(ctx,x0+44-wiggle,sideY,25,8,wing);
      this.rect(ctx,x0-76+wiggle,sideY+8,8,8,wing);
      this.rect(ctx,x0+68-wiggle,sideY+8,8,8,wing);
    }
    // 本体を横方向の半径列から生成することで、常に生物らしい輪郭を維持。
    const radii=[2,3,4,5,6,6,6,5,4,3];
    const shift = Math.floor(rng()*3)-1;
    const rows = radii.length;
    for (let row=0;row<rows;row++) {
      const rad = Math.max(2,radii[row]+(row>1&&row<7?shift:0));
      const y = y0-54+row*w;
      for(let c=-rad;c<=rad;c++) {
        let color = body;
        if (Math.abs(c)===rad || row===0 || row===rows-1) color=wing;
        else if ((Math.abs(c)+row)%6===0) color=highlight;
        this.rect(ctx,x0+c*w-4,y,w,w,color);
      }
    }
    for(let side of [-1,1]) {
      const a = x0+side*19;
      this.rect(ctx,a-4,y0-54-antLen*7,8,antLen*7,highlight);
      this.rect(ctx,a-11,y0-59-antLen*7,16,8,wing);
    }
    // 二つの大きな目と口は共通性を残し、全ての個体に愛嬌を持たせる。
    const blink = Math.sin(t*1.2+d.sprite)>.984;
    for(let eye of [-1,1]) {
      const x = x0+eye*21-8;
      this.rect(ctx,x,y0-29,16,blink?3:15,'#171A32');
      if(!blink) this.rect(ctx,x+3,y0-27,4,4,'#FFFFFF');
    }
    this.rect(ctx,x0-8,y0-2,16,6,'#1D2341');
    this.rect(ctx,x0-3,y0+4,9,5,highlight);
    // DNAから派生した周囲の光粒。音量によって軽やかに動く。
    for(let i=0;i<10;i++) {
      const angle = i*Math.PI*.2+t*(this.mode==='playing'?.8:.12);
      const radius = 74 + Math.sin(t*2+i)*8 + high*8;
      const px = x0+Math.cos(angle)*radius;
      const py = y0+Math.sin(angle)*radius*.72;
      if(i%3!==1 || high>.4) this.rect(ctx,px,py,(i%3?3:5),(i%3?3:5),i%2?wing:highlight);
    }
  }
}
