import {mulberry32} from './audio-engine.js';

/**
 * LITTLE BUGS v0.5 — MINIMAL PIXEL PETS
 * 表情・装飾を描き込まず、11×11 のシルエットと1〜3点の目で個体差を作る。
 * アニメーションは少数コマの切替。音楽の拍と生き物の運動だけを同期させる。
 */
const BACK='#17102D';
const SKIN=['#DBFF6E','#F36BAA','#82EBDD','#F3CF63','#AD9BFA','#FE9264','#E7F3D9','#93DD83'];
const SKIN_SHADOW='#111028';
// 11列×11行の固定ドット・シルエット。記号「#」以外は透明。
// すべて明瞭に異なる体型（小さな丸、縦長、横長、宇宙虫、幽霊等）。
const SHAPES=[
  [
    '...........','...#####...','..#######..','.#########.','.#########.',
    '.#########.','.#########.','..#######..','...#####...','....###....','...........'],
  [
    '....###....','....###....','...#####...','...#####...','...#####...',
    '...#####...','...#####...','...#####...','....###....','....###....','...........'],
  [
    '...........','...........','.#########.','###########','###########',
    '..#######..','...#####...','....###....','...#...#...','...........','...........'],
  [
    '..##...##..','..##...##..','..#######..','..#######..','.#########.',
    '.#########.','..#######..','...#####...','...#...#...','...........','...........'],
  [
    '...........','...#####...','..#######..','.#########.','.#########.',
    '..#######..','..#######..','..##.###...','..#...##...','...........','...........'],
  [
    '...........','...........','..........#','..#########','.##########',
    '##########.','##########.','..#######..','....#..#...','...........','...........'],
  [
    '...........','.....#.....','....###....','...#####...','..#######..',
    '.#########.','###########','..#######..','....###....','.....#.....','...........'],
  [
    '...........','..##...##..','.#########.','###########','###########',
    '###########','.#########.','..#######..','...#...#...','...........','...........'],
  [
    '....###....','...#####...','..#######..','..#######..','..#######..',
    '...#####...','...#####...','..##.#.##..','.##.....##.','...........','...........'],
  [
    '...........','..###.###..','.#########.','###########','###########',
    '###.###.###','..#######..','..#######..','.#...#...#.','...........','...........'],
];

export class BugVisual{
  constructor(mount){
    this.mount=mount;this.width=192;this.height=160;
    this.mode='idle';this.dna=null;this.bug=null;this.level=0;this.progress=0;this.elapsed=0;this.groove=true;
    this.pokedUntil=0;this.start=performance.now();this.last=-1;
    this.createCanvas();this.mount.addEventListener('pointerdown',()=>this.poke());
  }
  createCanvas(){
    // p5.js が読み込まれていればグラフィックはp5に担当させる。
    // CDN未接続でも画面が消えないようにCanvas 2Dへのフォールバックを設ける。
    if(window.p5){
      this.p5=new window.p5(p=>{
        p.setup=()=>{const c=p.createCanvas(this.width,this.height);c.elt.setAttribute('aria-hidden','true');p.pixelDensity(1);p.noSmooth();p.frameRate(30);};
        p.draw=()=>this.paint(p.drawingContext);
      },this.mount);
      return;
    }
    const canvas=document.createElement('canvas');canvas.width=this.width;canvas.height=this.height;
    canvas.setAttribute('aria-hidden','true');this.mount.appendChild(canvas);
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});
    const draw=()=>{this.paint(this.ctx);this.animation=requestAnimationFrame(draw);};draw();
  }
  setDna(dna){this.dna=dna;this.bug=dna?this.makeBug(dna):null;this.mode=dna?'hatched':'idle';this.last=-1;}
  setMode(mode){this.mode=mode;this.last=-1;}
  setLevel(x){this.level=Math.max(0,Math.min(1,x));}
  setProgress(x){this.progress=x;}
  setElapsed(x){this.elapsed=x;}
  setGroove(x){this.groove=!!x;this.last=-1;}
  poke(){this.pokedUntil=performance.now()+860;this.last=-1;}
  makeBug(dna){
    const rng=mulberry32(dna.sprite),species=Math.floor(rng()*SHAPES.length);
    return {species,mask:SHAPES[species],color:SKIN[Math.floor(rng()*SKIN.length)],
      eyeCount:Math.floor(rng()*3)+1,faceY:Math.floor(rng()*2),personality:Math.floor(rng()*4),
      mirror:rng()>.5};
  }
  block(ctx,x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
  paint(ctx){
    const time=performance.now(),t=(time-this.start)/1000,frame=Math.floor(t*9);
    if(frame===this.last&&time>this.pokedUntil)return;
    this.last=frame;
    this.block(ctx,0,0,192,160,BACK);
    // 昔のゲーム機の空間。背景は2本の水平線と少数ドットのみ。
    this.block(ctx,11,29,170,2,'#37264E');this.block(ctx,11,131,170,2,'#37264E');
    for(const [x,y] of [[20,48],[164,57],[28,108],[158,110]]){
      this.block(ctx,x,y,3,3,frame%18<10?'#6B4D79':'#36284D');
    }
    if(this.bug)this.drawBug(ctx,frame,time);
    else this.drawEgg(ctx,frame);
    if(this.mode==='recording'){
      for(let i=0;i<8;i++)this.block(ctx,66+i*8,116-Math.floor(this.level*16),5,3+Math.floor(this.level*16),i%2?'#F36BAA':'#DBFF6E');
    }
    if(this.mode==='playing'){
      for(let i=0;i<20;i++)this.block(ctx,20+i*8,138,5,3,i<Math.floor(this.progress*20)?'#DBFF6E':'#4A365B');
    }
  }
  drawEgg(ctx,frame){
    const egg=['....###....','..#######..','.#########.','###########','###########','###########','.#########.','..#######..','....###....'];
    const x=96-5*5,y=77-4*5+(this.mode==='recording'?(frame%3-1)*3:0);
    for(let j=0;j<egg.length;j++)for(let i=0;i<11;i++)if(egg[j][i]==='#')
      this.block(ctx,x+i*5,y+j*5,5,5,(i+j)%7===0?'#F36BAA':'#DBFF6E');
    this.block(ctx,x+16,y+16,6,6,SKIN_SHADOW);this.block(ctx,x+35,y+16,6,6,SKIN_SHADOW);
  }
  drawBug(ctx,frame,ms){
    const b=this.bug,playing=this.mode==='playing',poked=ms<this.pokedUntil;
    const beat=playing?this.elapsed*this.dna.bpm/60:((ms-this.start)/1000)*.5;
    const cell=6,step=Math.floor(beat*2),pose=step%4;
    const rise=poked?16:playing?[0,10,3,6][pose]*this.dna.bugEnergy:((frame+b.species)%18===0?3:0);
    const sway=poked?((frame%2)*6-3):playing?[0,3,0,-3][pose]:0;
    const x0=Math.round(96-11*cell/2+sway),y0=Math.round(82-11*cell/2-rise);
    const color=b.color,dark=SKIN_SHADOW;
    const mask=b.mask;
    // 余計な輪郭線や斑点は描かない。シルエットを1色で描画する。
    for(let y=0;y<mask.length;y++)for(let x=0;x<mask[y].length;x++){
      if(mask[y][x]!=='#')continue;
      const xpos=b.mirror?10-x:x;
      const yoffset=playing&&((y>7&&pose===1)||(y<3&&pose===3))?1:0;
      this.block(ctx,x0+xpos*cell,y0+(y+yoffset)*cell,cell,cell,color);
    }
    // 顔の情報は目と1ドットの口だけ。口は発音の拍・タップで開閉。
    const eyey=b.species===1?4:b.species===2?3:4+b.faceY;
    const blink=!poked&&(frame+b.species*9)%51===0;
    const eyes=b.eyeCount===1?[5]:b.eyeCount===2?[3,7]:[2,5,8];
    for(const ex of eyes){
      const xx=x0+ex*cell,yy=y0+eyey*cell;
      this.block(ctx,xx,yy+(blink?3:0),cell*(b.eyeCount===1?2:1),blink?2:cell,dark);
    }
    const mouthOpen=poked||(playing&&(pose===0||this.level>.36));
    this.block(ctx,x0+5*cell,y0+7*cell,mouthOpen?cell:cell*.75,mouthOpen?cell:2,dark);
    if(poked){
      // タップ反応もドット2個だけ。派手な吹き出しを作らず動きで見せる。
      this.block(ctx,x0-15,y0+16,6,6,'#F36BAA');this.block(ctx,x0+76,y0+24,6,6,'#DBFF6E');
    }else if(playing&&this.groove&&pose%2===0){
      this.block(ctx,42,103,5,5,'#F3CF63');this.block(ctx,148,72,5,5,'#F3CF63');
    }
  }
}
