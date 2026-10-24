import {mulberry32} from './audio-engine.js';

/**
 * LITTLE BUGS v1.1.1 — MICRO PETS / EGG PARADE
 * 17×17 の小さなセルから、描き込みすぎない異なる輪郭を生成する。
 * 顔は目と口だけ。個体の動きは歩幅、跳ね方、浮遊、伸縮のリズムで変える。
 * スプライトもアニメーションも Canvas 2D / p5.js 共通の描画関数で扱う。
 */
const BG='#17102D';
const COLORS=['#DBFF6E','#F36BAA','#82EBDD','#F3CF63','#AD9BFA','#FE9264','#E7F3D9','#93DD83'];
const INK='#17102D';
const S=17,HALF=8,CELL=4;
const ellipse=(x,y,cx,cy,rx,ry)=>((x-cx)/rx)**2+((y-cy)/ry)**2<=1;
const box=(x,y,x1,y1,x2,y2)=>x>=x1&&x<=x2&&y>=y1&&y<=y2;

// 影・装飾は使用しない。形状ごとの幾何学だけで種類を識別できるようにする。
const SHAPE_RULES=[
 (x,y)=>ellipse(x,y,8,8,6.8,5.3)||box(x,y,4,11,5,14)||box(x,y,11,11,12,14),                      // bean
 (x,y)=>ellipse(x,y,8,8,4.1,7.3)||box(x,y,4,13,5,15)||box(x,y,11,13,12,15),                       // tall
 (x,y)=>ellipse(x,y,8,8,7.8,3.2)||box(x,y,1,8,3,11)||box(x,y,13,8,15,11),                          // moth
 (x,y)=>ellipse(x,y,8,7,5.3,4.7)||(y>=10&&y<=15&&[3,5,8,11,13].some(c=>Math.abs(x-c)<=.6)),      // jelly
 (x,y)=>ellipse(x,y,8,8,5.5,6.3)&&(y<12||Math.floor(x/2)%2===0),                                   // ghost
 (x,y)=>ellipse(x,y,8,9,5.2,5.1)||box(x,y,7,1,8,5)||box(x,y,3,2,6,3)||box(x,y,9,2,12,3),         // sprout
 (x,y)=>Math.abs(x-8)+Math.abs(y-8)<8.7||(Math.abs(x-8)<2&&Math.abs(y-8)<8),                        // crystal
 (x,y)=>ellipse(x,y,7,9,7.6,4.1)||box(x,y,1,11,2,14)||box(x,y,12,11,13,14),                        // slug
 (x,y)=>ellipse(x,y,8,8,5.3,3.2)||box(x,y,3,6,13,11)||box(x,y,4,12,5,14)||box(x,y,11,12,12,14),   // beetle
 (x,y)=>ellipse(x,y,8,10,3.6,4.7)||(y<=8&&y>=4&&(x<=6&&x>=1||x>=10&&x<=15)),                   // bat
 (x,y)=>ellipse(x,y,8,9,5.9,4.6)||box(x,y,7,1,8,5)||box(x,y,4,3,5,4)||box(x,y,11,3,12,4),         // antenna
 (x,y)=>ellipse(x,y,5,8,3.8,5)||ellipse(x,y,11,8,3.8,5)||box(x,y,6,12,10,14),                     // twins
 (x,y)=>ellipse(x,y,8,7,6.5,3.4)||box(x,y,5,8,11,13)||box(x,y,5,13,6,15)||box(x,y,10,13,11,15),  // mushroom
 (x,y)=>Math.abs(x-8)<=Math.max(2,8-Math.abs(y-8))*.73||box(x,y,3,6,13,9),                           // star
];
/**
 * 卵には目・口・触角を付けず、上下非対称な卵殻の輪郭だけで判別する。
 * 色・殻の幅・模様をシードから決定し、読み込み時や次の録音時に再抽選する。
 * キャラクターの顔に見える左右対称の２点模様は避ける。
 */
const EGG_COLORS=[
 ['#FFF1B8','#FD78A9'],['#FAD6F2','#9E86E6'],['#CCFADE','#F2AB63'],
 ['#FBE9B5','#86DDD8'],['#FFD1B0','#E780D3'],['#EAF8CC','#F39178'],
 ['#DDD4FC','#B8F270'],['#F8E2C8','#8EA7E9']
];
const EGG_ROWS=[[7,9],[6,10],[5,11],[5,11],[4,12],[4,12],[3,13],[3,13],[2,14],[2,14],[2,14],[2,14],[2,14],[3,13],[3,13],[4,12],[5,11]];
export function makePixelEgg(seed){
 const r=mulberry32(seed>>>0),style=Math.floor(r()*8),palette=EGG_COLORS[Math.floor(r()*EGG_COLORS.length)];
 const widthShift=Math.floor(r()*3)-1,body=Array.from({length:S},()=>Array(S).fill(false));
 const accent=Array.from({length:S},()=>Array(S).fill(false));
 const sparkSeed=Math.floor(r()*4096),slope=r()>.5?1:-1;
 for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  const [min,max]=EGG_ROWS[y];
  // 上部は細く、下部は丸い、底が軽くすぼまる卵形。輪郭の差は控えめ。
  const lowerShift=y>=8&&y<=12?widthShift:0;
  const inside=x>=min-Math.max(0,lowerShift)&&x<=max+Math.max(0,lowerShift)
       &&(lowerShift>=0 || y<8 || y>12 ||(x>min&&x<max));
  body[y][x]=inside;
  if(!inside || y<4 || x<=min || x>=max)continue;
  const hash=(Math.imul(x+17,1103515245)^Math.imul(y+sparkSeed+3,2654435761))>>>0;
  const detail=hash%13;
  // 模様は斑点、帯、波線、斜線、片寄ったパッチなど。決して顔を描かない。
  if(style===0)accent[y][x]=(y>=10&&x<=10&&detail<4);
  if(style===1)accent[y][x]=(y===10||y===11||y===14);
  if(style===2)accent[y][x]=(y>=7&&y<=13&&((x+slope*y+23)%5===0));
  if(style===3)accent[y][x]=(y>=8&&Math.abs((x-8)+slope*(y-11))<=1);
  if(style===4)accent[y][x]=(y>=10&&((x+2*y)%3!==0));
  if(style===5)accent[y][x]=(y>=9&&x>=9&&((x+3*y+sparkSeed)%5===0));
  if(style===6)accent[y][x]=(y>=9&&y<=12&&Math.abs(x-(6+slope*(y-10)))<=1);
  if(style===7)accent[y][x]=(y>=8&&detail<3&&((x+y)%3!==1));
 }
 return {seed:seed>>>0,style,body,accent,shell:palette[0],pigment:palette[1]};
}

export function makePixelBug(seed){
 const r=mulberry32(seed>>>0),species=Math.floor(r()*SHAPE_RULES.length);
 const mask=Array.from({length:S},(_,y)=>Array.from({length:S},(_,x)=>!!SHAPE_RULES[species](x,y)));
 const eyes=r()<.24?1:2;
 // ２色は新しい飾りを足さず、胴体の一部の面積だけ切り替える。
 const colorIndex=Math.floor(r()*COLORS.length);
 const accentIndex=(colorIndex+2+Math.floor(r()*3))%COLORS.length;
 // 1点の口を付けても、顔の情報が過剰にならないようにする。
 return {species,mask,eyes,eyeshape:Math.floor(r()*3),color:COLORS[colorIndex],accent:COLORS[accentIndex],tonePattern:Math.floor(r()*3),
   motion:Math.floor(r()*8),energy:.7+r()*.55,faceOffset:Math.floor(r()*3)-1,
   phase:Math.floor(r()*8),breath:.65+r()*.8,mirror:r()>.5};
}

export class BugVisual{
 constructor(mount){
  this.mount=mount;this.width=192;this.height=160;
  this.mode='idle';this.dna=null;this.bug=null;this.level=0;this.progress=0;this.elapsed=0;this.groove=true;
  this.egg=null;this.hatchStarted=0;this.newEgg();
  this.pokedUntil=0;this.start=performance.now();this.last=-1;
  this.createCanvas();mount.addEventListener('pointerdown',()=>this.poke());
 }
 createCanvas(){
  if(window.p5){
   this.p5=new window.p5(p=>{
    p.setup=()=>{const c=p.createCanvas(this.width,this.height);c.elt.setAttribute('aria-hidden','true');p.pixelDensity(1);p.noSmooth();p.frameRate(30);};
    p.draw=()=>this.paint(p.drawingContext);
   },this.mount);
   return;
  }
  const canvas=document.createElement('canvas');canvas.width=this.width;canvas.height=this.height;
  canvas.setAttribute('aria-hidden','true');this.mount.appendChild(canvas);this.ctx=canvas.getContext('2d',{alpha:false});
  const draw=()=>{this.paint(this.ctx);this.animation=requestAnimationFrame(draw);};draw();
 }
 newEgg(seed){
  let value=seed;
  if(value===undefined){
   if(typeof crypto!=='undefined'&&crypto.getRandomValues){const n=new Uint32Array(1);crypto.getRandomValues(n);value=n[0];}
   else value=Math.floor(Math.random()*0xFFFFFFFF);
  }
  this.egg=makePixelEgg(value);this.last=-1;
 }
 setDna(dna){this.dna=dna;this.bug=dna?makePixelBug(dna.sprite):null;this.mode=dna?'hatched':'idle';this.last=-1;}
 setMode(mode){this.mode=mode;if(mode==='hatching')this.hatchStarted=performance.now();this.last=-1;}
 setLevel(x){this.level=Math.max(0,Math.min(1,x));}
 setProgress(x){this.progress=x;}
 setElapsed(x){this.elapsed=x;}
 setGroove(x){this.groove=!!x;this.last=-1;}
 poke(){
  // 未孵化の卵をタップすると、ボタンを増やさずに別の殻が現れる。
  if(!this.bug && this.mode!=='hatching')this.newEgg();
  this.pokedUntil=performance.now()+780;this.last=-1;
 }
 dot(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
 paint(ctx){
  const now=performance.now(),t=(now-this.start)/1000,frame=Math.floor(t*12);
  if(frame===this.last&&now>this.pokedUntil)return;
  this.last=frame;
  this.dot(ctx,0,0,192,160,BG);
  this.dot(ctx,11,29,170,2,'#37264E');this.dot(ctx,11,131,170,2,'#37264E');
  const stars=[[19,50],[166,54],[28,108],[161,113],[96,43]];
  for(let i=0;i<stars.length;i++){
    const [x,y]=stars[i];if((frame+4*i)%24<17)this.dot(ctx,x,y,2,2,'#66527A');
  }
  if(this.bug)this.drawBug(ctx,frame,now);else this.drawEgg(ctx,frame,now);
  if(this.mode==='recording')for(let i=0;i<8;i++){
    const height=3+Math.floor(this.level*17);
    this.dot(ctx,65+i*9,119-height,4,height,i%2?'#F36BAA':'#DBFF6E');
  }
  if(this.mode==='playing')for(let i=0;i<20;i++)this.dot(ctx,20+i*8,138,5,3,i<Math.floor(this.progress*20)?'#DBFF6E':'#4A365B');
 }
 drawEgg(ctx,frame,ms){
  const egg=this.egg;
  if(!egg)return;
  // RECORD中は微小に震え、孵化中は殻の中央が割れて左右へ開く。
  const hatching=this.mode==='hatching';
  const phase=hatching?Math.min(1,Math.max(0,(ms-this.hatchStarted)/400)):0;
  const split=Math.max(0,(phase-.32)/.68)*13;
  const wobble=ms<this.pokedUntil&&!hatching?Math.round(Math.sin(frame*1.7)*3) : this.mode==='recording'?Math.round(Math.sin(frame*.75)*2):Math.round(Math.sin(frame*.14)*1);
  const dx=96-8*CELL,dy=81-8*CELL+wobble;
  const divider=[8,8,9,9,8,8,7,8,9,8,7,8,9,8,8,8,8];
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){
   if(!egg.body[y][x])continue;
   const side=x<=divider[y]?-1:1;
   const offset=hatching?Math.round(split*side):0;
   const xPos=dx+x*CELL+offset;
   const yPos=dy+y*CELL+(hatching?Math.round(phase*phase*3):0);
   const pigment=egg.accent[y][x];
   this.dot(ctx,xPos,yPos,CELL,CELL,pigment?egg.pigment:egg.shell);
   // 割れ目が現れるまで、殻の中央は通常の色を保つ。
   if(hatching&&phase>.12&&Math.abs(x-divider[y])<1&&y>2&&y<15){
    this.dot(ctx,xPos+(side<0?CELL-2:0),yPos,2,CELL,BG);
   }
  }
  if(hatching&&phase>.4){
   const rise=Math.round(phase*9);
   this.dot(ctx,dx-12,dy+34-rise,3,3,egg.pigment);
   this.dot(ctx,dx+72,dy+52-rise,3,3,egg.shell);
   if(phase>.65)this.dot(ctx,dx+32,dy-9-rise,3,3,egg.pigment);
  }
 }

 drawBug(ctx,frame,ms){
  const b=this.bug,playing=this.mode==='playing',poked=ms<this.pokedUntil;
  const beat=playing?this.elapsed*this.dna.bpm/60:(ms-this.start)/2200;
  const step=Math.floor(beat*2+b.phase),phase=beat%1;
  let dx=0,dy=0,squash=0,turn=false,wing=0;
  if(poked){dy=-14-(frame%3)*2;dx=(frame%2?4:-4);squash=1;}
  else if(playing){
    const action=b.motion;
    if(action===0){dy=step%2?-11:-1;squash=step%4===0?1:0;}                      // pogo
    if(action===1){dx=[-7,0,7,0][step%4];dy=step%2?-3:1;}                    // shuffle
    if(action===2){dy=Math.round(Math.sin(beat*Math.PI)*6)-4;wing=step%2;}    // float
    if(action===3){dy=step%4===0?-5:0;squash=step%2?1:-1;}                   // squish
    if(action===4){dx=[-6,-1,6,1][step%4];turn=step%4===3;}                  // swivel
    if(action===5){dy=step%2?-8:0;dx=step%4===1?-4:4;wing=step%2;}          // gallop
    if(action===6){dx=step%2?-4:4;dy=step%4===0?-8:0;squash=-1;}            // jitter
    if(action===7){dy=[-2,-8,-2,3][step%4];turn=step%2===0;wing=step%2;}    // bow
    dy=Math.round(dy*b.energy);
  } else {
    dy=Math.round(Math.sin((ms-this.start)*.0016*b.breath+b.phase)*3);
    dx=Math.round(Math.sin((ms-this.start)*.0007+b.species)*2);
    squash=frame%62===0?1:0;
  }
  const x0=Math.round(96-8*CELL+dx),y0=Math.round(79-8*CELL+dy);
  const blink=!poked&&(frame+b.phase*7)%47===0;
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){
    if(!b.mask[y][x])continue;
    const xx=(turn||b.mirror)?S-1-x:x;
    let yy=y;
    if(squash===1&&y>9)yy=Math.max(0,y-1);
    if(squash===-1&&y>9)yy=Math.min(S-1,y+1);
    if(wing&&b.species===2&&x<4)yy-=1;
    if(wing&&b.species===2&&x>12)yy+=1;
    if(playing&&step%2&&b.species===3&&y>11)yy+=1;
    const twoTone=(b.tonePattern===0 && y>=12)
      ||(b.tonePattern===1 && x<=4 && y>=5 && y<=12)
      ||(b.tonePattern===2 && (y===5 || y===6) && x>=4 && x<=12);
    this.dot(ctx,x0+xx*CELL,y0+yy*CELL,CELL,CELL,twoTone?b.accent:b.color);
  }
  // 顔は必ず塗られたマスクの内部へ配置。目以外の描き込みを控える。
  const faceY=this.faceRow(b),cy=y0+faceY*CELL;
  const eyeXs=b.eyes===1?[8]:[5,11];
  for(const ex of eyeXs){
    const cx=(turn||b.mirror)?S-1-ex:ex;
    const left=x0+cx*CELL;
    this.dot(ctx,left,cy+(blink?2:0),b.eyes===1?6:4,blink?2:(b.eyeshape===1?6:4),INK);
    if(poked&&!blink)this.dot(ctx,left+1,cy+1,2,2,'#FFFFFF');
  }
  const mouthY=Math.min(13,faceY+3),mouthOpen=poked||(playing&&(step%4===1||this.level>.42));
  if(b.mask[mouthY]?.[8])this.dot(ctx,x0+8*CELL,y0+mouthY*CELL,mouthOpen?4:3,mouthOpen?5:2,INK);
  // 感情の吹き出しは2-3ドットのみに限定。キャラのシルエットが主役。
  if(poked){this.dot(ctx,x0-10,y0+20,4,4,'#F36BAA');this.dot(ctx,x0+74,y0+7,4,4,'#DBFF6E');}
  else if(playing&&this.groove&&step%3===0){
    this.dot(ctx,38,102,3,3,'#F3CF63');this.dot(ctx,150,70,3,3,'#F36BAA');
  }
 }
 faceRow(b){
  for(const row of [7+b.faceOffset,8+b.faceOffset,6,9,10,5]){
   if(row<2||row>12)continue;
   if(b.eyes===1 && b.mask[row][8])return row;
   if(b.eyes===2 && b.mask[row][5]&&b.mask[row][11])return row;
  }
  return 8;
 }
}
