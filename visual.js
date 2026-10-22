import {mulberry32} from './audio-engine.js';
/**
 * LITTLE BUGS v0.4 — TOXIC PIXEL PET ENGINE
 * 18種の「形態遺伝子」と、眼・口・色・模様・動きの組み合わせで個体を作る。
 * 名前表示はしない。絵は低解像度Canvasへ離散的に描画して初期ゲーム機らしさを保つ。
 */
const PALETTES=[
  {skin:'#C9FB47',shade:'#729D3A',shine:'#F1FFAE',cheek:'#FF599B'},
  {skin:'#FF6BB1',shade:'#AC417D',shine:'#FFD0EA',cheek:'#E9FF66'},
  {skin:'#A8A1FF',shade:'#5C4DA3',shine:'#E5D4FF',cheek:'#F7E36D'},
  {skin:'#FFCC51',shade:'#DC6C43',shine:'#FFF1A0',cheek:'#FC5F94'},
  {skin:'#6AE5CE',shade:'#249D9C',shine:'#CCFFF3',cheek:'#FA74A2'},
  {skin:'#FA8B61',shade:'#C6466B',shine:'#FFE5A2',cheek:'#94F7CD'},
  {skin:'#E6E5D0',shade:'#9F96A7',shine:'#FFFFFF',cheek:'#FC63A4'},
  {skin:'#BFF270',shade:'#48ABAD',shine:'#F2FFAE',cheek:'#BB79E3'},
];
const INK='#101326',DARK='#100E28',SKY='#17102D';
const noiseDots=[[12,23],[177,25],[23,97],[161,103],[58,44],[140,129],[34,143]];
const cell=5,W=21,H=17;
const within=(v,a,b)=>v>=a&&v<=b;

/** 輪郭を全く異なる数式で構成する。左右対称が基本だが、ウイルスやワームは偏心。 */
function maskFor(species){
  const mask=[];
  for(let y=0;y<H;y++){
    const row=[];
    for(let x=0;x<W;x++){
      const nx=(x-10)/10,ny=(y-8)/8,ax=Math.abs(nx),ay=Math.abs(ny);
      let yes=false;
      switch(species){
        case 0:yes=(nx*nx*.9+ny*ny*1.03)<.91;break; // まるいゼリー
        case 1:yes=(ny<.45&&(nx*nx*.8+(ny+.2)**2)<.92)||(ny>=.4&&ax<.81&&((x+y)%5!==0||y<12));break; // 幽霊
        case 2:yes=(ax<.76&&ay<.83)||(y<6&&within(x,3,6))||(y<6&&within(x,14,17));break; // 長い耳
        case 3:yes=(y<10&&nx*nx*.92+((y-6)/8)**2<.95)||(y>=10&&y<16&&[4,7,10,13,16].some(a=>Math.abs(x-a)<2));break; // クラゲ
        case 4:yes=(ax<.54&&ay<.85)||(y>=4&&y<=10&&ax>.5&&ax<1&&((y+Math.floor(x/3))%4!==0));break; // コウモリ
        case 5:yes=(y<8&&nx*nx+((y-6)/6)**2<.98)||(y>=8&&ax<.35)||(y>=12&&ax<.58);break; // キノコ
        case 6:yes=(ny<.36&&(nx*nx/.95+((ny+.08)/.62)**2<1))||(ny>=.1&&ny<.85&&ax<.48);break; // UFO
        case 7:yes=(ax+ay*.85<.97)||(ax<.21)||(ay<.25&&ax<.98);break; // 星型
        case 8:yes=(nx*nx/.86+((ny+.33)/.66)**2<1)||(nx*nx/.85+((ny-.36)/.69)**2<1);break; // 二段虫
        case 9:yes=(ax<.53&&ay<.65)||(y>=5&&y<=11&&ax>.48&&ax<1&&y%3!==0);break; // 蜘蛛
        case 10:yes=(nx*nx/.73+(ny+.02)**2<.9)||(y<=5&&((x>=3&&x<=7)||(x>=13&&x<=17)));break; // ネコ
        case 11:yes=(ax<.8&&ay<.74)||(y>=12&&ax<.6&&x%3!==0);break; // 歯のある箱
        case 12:yes=Math.abs(y-(8+3*Math.sin(x*.38)))<3&&ax<.94;break; // うねるワーム
        case 13:yes=(y<=9&&((((x-6)**2+(y-7)**2)<35)||(((x-14)**2+(y-7)**2)<35)))||(y>9&&Math.abs(x-10)<(18-y)*.85);break; // ハート
        case 14:yes=(nx*nx+ny*ny<.76)||(Math.abs(x-10)<2&&ay<1)||(Math.abs(y-8)<2&&ax<1);break; // ウイルス
        case 15:yes=(ax<.70&&ny<.2)||(ny>=.2&&ax<.77*(1-(ny-.2)*.42))||(ny<-.6&&ax<.28);break; // しずく
        case 16:yes=(nx*nx/.85+ny*ny/.82<1)||(y>=10&&x>=5&&x<=16&&x%4!==0);break; // 溶け虫
        case 17:yes=(ax<.58&&ay<.75)||(y>=4&&y<=11&&ax>.58&&ax<.98&&y%3!==1);break; // カニ
      }
      row.push(yes);
    }
    mask.push(row);
  }
  return mask;
}
export class BugVisual{
  constructor(mount){
    this.mount=mount;this.width=192;this.height=160;
    this.mode='idle';this.dna=null;this.level=0;this.progress=0;this.elapsed=0;this.groove=true;
    this.bug=null;this.pokedUntil=0;this.start=performance.now();this.lastFrame=-1;
    this.createCanvas();this.mount.addEventListener('pointerdown',()=>this.poke());
  }
  createCanvas(){
    if(window.p5){
      this.p5=new window.p5(p=>{
        p.setup=()=>{p.createCanvas(this.width,this.height);p.pixelDensity(1);p.noSmooth();p.frameRate(30);};
        p.draw=()=>this.paint(p.drawingContext);
      },this.mount);
    }else{
      const canvas=document.createElement('canvas');canvas.width=this.width;canvas.height=this.height;
      this.mount.appendChild(canvas);this.canvas=canvas;this.ctx=canvas.getContext('2d');
      const frame=()=>{this.paint(this.ctx);this.animation=requestAnimationFrame(frame);};frame();
    }
  }
  setDna(dna){this.dna=dna;this.bug=dna?this.makeBug(dna):null;this.mode=dna?'hatched':'idle';this.lastFrame=-1;}
  setMode(m){this.mode=m;this.lastFrame=-1;}
  setLevel(v){this.level=Math.max(0,Math.min(1,v));}
  setProgress(p){this.progress=p;}
  setElapsed(t){this.elapsed=t;}
  setGroove(v){this.groove=!!v;}
  poke(){this.pokedUntil=performance.now()+950;this.lastFrame=-1;}
  makeBug(dna){
    const rng=mulberry32(dna.sprite),species=Math.floor(rng()*18);
    return {species,mask:maskFor(species),palette:PALETTES[Math.floor(rng()*PALETTES.length)],
      eyes:Math.floor(rng()*5),mouth:Math.floor(rng()*6),spots:Math.floor(rng()*5),
      temperament:Math.floor(rng()*6),head:Math.floor(rng()*3),
      feet:Math.floor(rng()*3),hair:Math.floor(rng()*4),flip:rng()>.5};
  }
  rect(ctx,x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
  star(ctx,x,y,color){this.rect(ctx,x-5,y,11,3,color);this.rect(ctx,x,y-4,3,11,color);}
  paint(ctx){
    const ms=performance.now(),t=(ms-this.start)/1000,frame=Math.floor(t*9);
    // アニメーションの切替だけを9fps相当に制限。画素は平滑化しない。
    if(frame===this.lastFrame&&ms>this.pokedUntil)return;
    this.lastFrame=frame;
    this.rect(ctx,0,0,192,160,SKY);
    // 背景は家庭用8bitゲーム機風の少数色パターン。少し不穏な遊園地。
    this.rect(ctx,5,18,182,1,'#733A80');
    this.rect(ctx,5,139,182,1,'#733A80');
    for(let i=0;i<12;i++)this.rect(ctx,6+i*16,144+(i%3===0?0:2),9,2,'#58325E');
    for(let i=0;i<noiseDots.length;i++){
      const [x,y]=noiseDots[i],flicker=(frame+i*7)%15<9;
      this.rect(ctx,x,y,3,3,flicker?'#F4639D':'#7453A6');
    }
    if(frame%10<5){this.star(ctx,35,53,'#C8F760');this.star(ctx,160,68,'#F4D365');}
    // 装飾の毒々しいピクセル稲妻はテンポ同期・ランダム配置ではなくDNA固定。
    if(this.dna){
      const s=this.bug.species;
      for(let i=0;i<3;i++){
        const x=16+((i*79+s*23)%160),y=34+((s*19+i*33)%89);
        this.rect(ctx,x,y,5,2,i%2?'#DBFF71':'#F871BC');
        this.rect(ctx,x+2,y-2,2,6,i%2?'#DBFF71':'#F871BC');
      }
      this.drawBug(ctx,t,frame,ms);
    }else this.egg(ctx,frame);
    if(this.mode==='recording'){
      for(let k=0;k<8;k++)this.rect(ctx,61+k*9,122-Math.round(this.level*13),5,3+Math.round(this.level*13),k%2?'#FF5EAE':'#C7FC58');
    }
    if(this.mode==='playing'){
      for(let k=0;k<20;k++)this.rect(ctx,21+k*7.6,133,5,3,k<=Math.floor(this.progress*20)?'#DDFF70':'#4F366E');
    }
  }
  egg(ctx,frame){
    const jiggle=this.mode==='recording'?((frame%3)-1)*3:0;
    const x=96+jiggle,y=81,r=[2,4,6,7,8,8,8,8,7,6,5,3];
    for(let j=0;j<r.length;j++)for(let i=-r[j];i<=r[j];i++){
      const edge=Math.abs(i)===r[j]||j===0||j===r.length-1;
      this.rect(ctx,x+i*4,y+(j-6)*4,4,4,edge?'#0B0A25':j%3===0?'#F773B4':'#C9FF59');
    }
    this.rect(ctx,x-15,y-4,7,9,INK);this.rect(ctx,x+8,y-4,7,9,INK);
    this.rect(ctx,x-2,y+11,6,4,INK);
    if(frame%9<5){this.star(ctx,32,86,'#F5E16F');this.star(ctx,161,64,'#A6EBDB');}
  }
  drawBug(ctx,t,frame,ms){
    const b=this.bug,p=b.palette,playing=this.mode==='playing',hit=ms<this.pokedUntil;
    const beat=playing?this.elapsed*this.dna.bpm/60:t*.9;
    const motion=Math.floor(beat*2.1),phase=motion%4;
    const hop=hit?13:playing?[1,8,3,0][phase]*this.dna.bugEnergy:((frame%9===0)?3:0);
    const wobble=[-2,0,3,0][(phase+b.temperament)%4];
    const tilt=b.temperament===3?(phase%2?2:-2):0;
    const originX=Math.round(96-10*cell+wobble+tilt),originY=Math.round(83-8*cell-hop);
    const x0=originX,y0=originY;
    this.rect(ctx,67,125,57,3,'#603B7D');
    this.rect(ctx,75,128,43,2,'#362550');
    // 触角・耳・羽・足は最初に描くことで身体の背面になる。
    const draw=(x,y,w,h,color)=>this.rect(ctx,x0+x*cell,y0+y*cell,w*cell,h*cell,color);
    const flap=phase%2===0?-2:2;
    if([4,6,17].includes(b.species)){
      draw(-4+flap,6,5,2,p.shade);draw(20-flap,6,5,2,p.shade);
      draw(-6+flap,5,2,4,p.skin);draw(24-flap,5,2,4,p.skin);
    }
    if([2,8,14].includes(b.species)||b.hair===3){
      draw(5,-3,2,5,p.shade);draw(14,-4,2,6,p.shade);
      draw(4,-5,4,3,p.cheek);draw(14,-5,4,3,p.shine);
    }
    if(b.species===3){
      for(let a=0;a<4;a++)draw(4+a*4,12+Math.round(Math.sin(beat*4+a)*1.5),2,5,p.shade);
    }
    if(b.species===9||b.species===17){
      for(let a=0;a<3;a++){
        draw(-3,4+a*3,4,1,p.shade);draw(20,4+a*3,4,1,p.shade);
      }
    }
    if(b.feet===0){draw(4,15+phase%2,4,2,p.shade);draw(13,15+(phase+1)%2,4,2,p.shade);}
    if(b.feet===1){draw(6,15+phase%2,3,3,p.shade);draw(12,15+phase%2,3,3,p.shade);}
    // 格子状の生物は外周に濃色を必ず置く。内部はDNA由来の斑点を配置。
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(!b.mask[y][x])continue;
      const edge=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].some(([a,c])=>!b.mask[c]?.[a]);
      const pattern=(x*7+y*11+b.species*13)%9;
      const color=edge?INK:(b.spots&&pattern<b.spots&&y>8)?p.shade:((x+y)%13===0?p.shine:p.skin);
      draw(x,y,1,1,color);
    }
    // ユニークな顔：瞳1～3つ、目つき、瞬き、歯、舌などを組み合わせる。
    const blink=!hit&&frame%42===b.species%42;
    const eyeY=b.species===5?8:6;
    const eye=(x,y,w=3,h=3)=>{
      if(blink){draw(x,y+Math.floor(h/2),w,1,INK);return;}
      draw(x,y,w,h,INK);
      if(w>=5){
        // 一つ目の個体も「黒い穴」に見えないよう、虹彩と瞳を明示する。
        draw(x+1,y+1,w-2,h-2,p.shine);
        draw(x+Math.floor(w/2),y+Math.floor(h/2),1,1,INK);
        draw(x+1,y+1,1,1,'#FFFFFF');
      }else{
        draw(x+(b.eyes%2),y,1,1,p.shine);
        if(h>=4)draw(x+1,y+2,1,1,p.shine);
      }
    };
    if(b.eyes===2){eye(8,eyeY,5,5);}
    else if(b.eyes===4){eye(4,eyeY,3,3);eye(9,eyeY-2,3,3);eye(14,eyeY,3,3);}
    else {eye(5,eyeY,b.eyes===3?2:3,b.eyes===1?4:3);eye(13,eyeY,b.eyes===3?2:3,b.eyes===1?4:3);}
    if(b.spots>0){draw(2,10,2,1,p.cheek);draw(17,10,2,1,p.cheek);}
    const open=hit||playing&&(phase===0||this.level>.33);
    if(open){
      draw(9,11,3,3,INK);draw(10,12,1,2,p.cheek);
    }else{
      if(b.mouth===0){draw(9,12,3,1,INK);draw(10,13,1,1,INK);}
      if(b.mouth===1){draw(8,12,5,1,INK);draw(9,13,3,1,p.shine);}
      if(b.mouth===2){draw(9,12,3,2,INK);}
      if(b.mouth===3){draw(8,12,2,1,INK);draw(12,12,2,1,INK);draw(10,13,2,1,INK);}
      if(b.mouth===4){draw(8,12,6,2,INK);draw(9,12,1,1,p.shine);draw(12,12,1,1,p.shine);}
      if(b.mouth===5){draw(9,12,4,1,INK);draw(11,13,2,2,p.cheek);}
    }
    if(hit){
      this.star(ctx,32,61,'#C6F64A');this.star(ctx,154,68,'#FF71B5');
      this.rect(ctx,137,39,4,11,'#F5DB61');this.rect(ctx,137,53,4,4,'#F5DB61');
    }else if(playing){
      this.star(ctx,28+(phase*3),73-phase*4,p.cheek);
      this.star(ctx,159-phase*3,52+phase*4,p.shine);
    }
  }
}
