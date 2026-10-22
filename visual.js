import {mulberry32} from './audio-engine.js';

/**
 * LITTLE BUGS v0.2 — Pocket LCD creatures.
 *
 * 初期携帯型ゲーム機を参照した少数ドットの抽象生物。
 * 画像アセットは使わず、音声DNAから輪郭を生成する。
 * 動きは意図的に3〜5fps相当のコマ送りとし、現代的な滑らかさを避ける。
 */
export class BugVisual {
  constructor(mount) {
    this.mount=mount;
    this.width=160;this.height=130;
    this.mode='idle';this.dna=null;this.level=0;this.progress=0;
    this.frame=0;this.sprite=null;
    this.setupCanvas();
  }
  setupCanvas(){
    if(window.p5){
      this.p5=new window.p5(p=>{
        p.setup=()=>{p.createCanvas(this.width,this.height);p.pixelDensity(1);p.noSmooth();p.frameRate(20);};
        p.draw=()=>this.paint(p.drawingContext);
      },this.mount);
    } else {
      // CDNなしでもマイクや音響エンジンは使用可能とするフォールバック。
      this.canvas=document.createElement('canvas');
      this.canvas.width=this.width;this.canvas.height=this.height;
      this.mount.appendChild(this.canvas);
      this.ctx=this.canvas.getContext('2d');
      const loop=()=>{this.paint(this.ctx);this.animation=requestAnimationFrame(loop);};
      loop();
    }
  }
  setMode(mode){this.mode=mode;}
  setDna(dna){this.dna=dna;this.sprite=dna?this.createSprite(dna):null;this.mode=dna?'hatched':'idle';}
  setLevel(n){this.level=Math.max(0,Math.min(1,n));}
  setProgress(n){this.progress=Math.max(0,Math.min(1,n));}
  dot(ctx,x,y,w=1,h=1,color='#34473d'){
    ctx.fillStyle=color;ctx.fillRect(Math.floor(x),Math.floor(y),w,h);
  }
  /** 7〜11行の対称シルエットを作り、種族によって輪郭の大きさを変える。 */
  createSprite(dna){
    const rng=mulberry32(dna.sprite);
    const shapes={
      FLEA:[1,2,3,4,4,3,2,1],
      MOTH:[1,3,5,4,5,4,2,1],
      WORM:[2,3,5,5,4,3,2],
      PUPA:[1,2,3,3,4,4,3,3,2,1],
    };
    const radii=shapes[dna.id]||shapes.FLEA;
    const cells=[];
    const noise=Math.floor(rng()*3);
    for(let y=0;y<radii.length;y++){
      const rad=radii[y]+((y>1&&y<radii.length-2&&noise===2)?1:0);
      for(let x=-rad;x<=rad;x++){
        if((Math.abs(x)===rad && rng()<.07) || (dna.id==='MOTH' && Math.abs(x)>3 && y%3===2 && rng()<.42))continue;
        cells.push([x,y]);
      }
    }
    return {cells,rows:radii.length,eyes:Math.floor(rng()*3),feet:Math.floor(rng()*3),
      antenna:Math.floor(rng()*3),shade:rng()>.6};
  }
  paint(ctx){
    this.frame++;
    const tick=Math.floor(this.frame/6); // 最大3.3fpsのアニメーション
    ctx.clearRect(0,0,this.width,this.height);
    this.dot(ctx,0,0,this.width,this.height,'#c8d2b5');
    // LCDの枠・床・目盛り。背景をゲーム的にしすぎず、余白を十分に残す。
    this.dot(ctx,8,15,1,100,'#a8b799');this.dot(ctx,151,15,1,100,'#a8b799');
    this.dot(ctx,10,110,140,1,'#83977c');
    for(let i=0;i<8;i++){
      this.dot(ctx,15+i*19,116,5,2,'#9dac8d');
    }
    this.dot(ctx,12,21,5,2,'#758b6c');
    this.dot(ctx,143,21,5,2,'#758b6c');
    if(!this.dna)this.paintEgg(ctx,tick);
    else this.paintBug(ctx,tick);
    if(this.mode==='recording'){
      // 音量を段階的な4本の縦ドットに変換。装飾的な大きな波形は表示しない。
      const activity=Math.round(this.level*5);
      for(let i=0;i<5;i++)this.dot(ctx,68+i*6,99-i%2*2,4,i<activity?8:2,i<activity?'#34473d':'#9ba98e');
    }
    if(this.mode==='playing'){
      // 16分割の進行状況と、拍ではなく録音素材のフレーズの移動を示すカーソル。
      const position=Math.min(15,Math.floor(this.progress*16));
      for(let i=0;i<16;i++)this.dot(ctx,28+i*7,123,4,2,i<=position?'#34473d':'#a6b597');
    }
  }
  paintEgg(ctx,tick){
    const wiggle=this.mode==='recording'&&tick%2?1:0;
    const cx=80+wiggle,cy=62;
    const egg=['..####..','.######.','########','########','########','########','.######.','..####..'];
    for(let row=0;row<egg.length;row++)for(let col=0;col<egg[row].length;col++){
      if(egg[row][col]==='#')this.dot(ctx,cx+(col-4)*4,cy+(row-4)*4,4,4,'#52684f');
    }
    this.dot(ctx,cx-8,cy-4,4,4,'#c8d2b5');
    this.dot(ctx,cx+8,cy+4,4,4,'#c8d2b5');
    if(tick%2===0){this.dot(ctx,47,58,4,2,'#83977c');this.dot(ctx,110,73,4,2,'#83977c');}
  }
  paintBug(ctx,tick){
    const d=this.dna,s=this.sprite;
    const playing=this.mode==='playing';
    const bounce=playing?(tick%2?-3:1):0;
    const lean=playing?((tick%4===0)?-2:(tick%4===2?2:0)):0;
    const unit=4, cx=80+lean,cy=68+bounce;
    const top=cy-Math.round(s.rows*unit/2);
    const ink='#34473d',light='#52684f';
    for(const [x,y] of s.cells){
      this.dot(ctx,cx+x*unit,top+y*unit,unit,unit,s.shade&&Math.abs(x)>3?light:ink);
    }
    // 目はドット1個だけ。描き込みよりもシルエットの差と動きで人格を出す。
    const eyeY=top+Math.floor(s.rows*.35)*unit;
    const blinking=playing&&tick%13===0;
    if(!blinking){
      if(s.eyes===0){this.dot(ctx,cx-8,eyeY,4,4,'#c8d2b5');this.dot(ctx,cx+8,eyeY,4,4,'#c8d2b5');}
      else if(s.eyes===1){this.dot(ctx,cx,eyeY,4,4,'#c8d2b5');}
      else {this.dot(ctx,cx-4,eyeY,4,4,'#c8d2b5');this.dot(ctx,cx+4,eyeY,4,4,'#c8d2b5');}
    }
    // 脚や触角は省略可能。2フレームだけでぎこちなく動く。
    const footY=top+s.rows*unit;
    const legShift=playing&&tick%2?4:0;
    if(s.feet!==2){
      this.dot(ctx,cx-13,footY,4,7+legShift,ink);
      this.dot(ctx,cx+13,footY,4,7+(4-legShift),ink);
    }
    if(s.antenna>0){
      this.dot(ctx,cx-9,top-9,3,9,ink);
      if(s.antenna===2)this.dot(ctx,cx+11,top-10,3,10,ink);
    }
    // 余分なエフェクトは表示せず、一定間隔で1〜2点だけ現れる。
    if(playing&&tick%3===0){
      this.dot(ctx,114,49,3,3,'#758b6c');
      if(d.id==='MOTH')this.dot(ctx,43,78,2,2,'#758b6c');
    }
  }
}
