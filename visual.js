import {mulberry32} from './audio-engine.js';

/**
 * LITTLE BUGS v0.3 — 8-bit pet engine
 * 固定画像を使わず、個体のDNAから「種類・色・目・表情・装飾」を組み立てる。
 * スプライトは短いコマ送りで、耳・脚・目・羽・口が別々に動く。
 * 描画はp5.jsのCanvasを使用。CDNが使えない場合はCanvas2Dへ退避する。
 */
const PALETTES=[
  {body:'#F6D66A',shadow:'#DF8D71',spot:'#FFF0B1',cheek:'#FF799F'},
  {body:'#83E5CC',shadow:'#389DAD',spot:'#E0FFE5',cheek:'#FFC0D1'},
  {body:'#F7A7CB',shadow:'#BD68AC',spot:'#FFF4DD',cheek:'#F9D66F'},
  {body:'#ADA6FF',shadow:'#6D73C8',spot:'#D6F6FF',cheek:'#FFB19E'},
  {body:'#FFB77D',shadow:'#E2738F',spot:'#F9F0B4',cheek:'#F4E3FF'},
  {body:'#95D4FA',shadow:'#568DCF',spot:'#D7FFFF',cheek:'#FEA8B8'},
];
const INK='#17203F',BLACK='#141C35',SKY='#141C3D',GLOW='#FFF0B4';
const SPECIES=[
  {name:'PIP',shape:[2,4,6,7,7,7,6,5,3],kind:'ears'},
  {name:'MOMO',shape:[3,4,6,7,7,6,6,4,2],kind:'puff'},
  {name:'DOT',shape:[1,3,5,6,6,7,7,6,4,2],kind:'sprout'},
  {name:'POPPY',shape:[3,6,7,7,7,6,5,4,2],kind:'wings'},
  {name:'BIBI',shape:[3,5,5,6,6,5,5,4,2],kind:'robot'},
  {name:'MINT',shape:[2,4,7,7,7,7,5,4,2],kind:'frog'},
  {name:'GIGI',shape:[1,3,5,6,5,5,4,3,1],kind:'ghost'},
  {name:'BOO',shape:[2,4,5,7,7,6,5,5,3],kind:'star'},
  {name:'MIMI',shape:[3,4,6,7,7,6,5,4,2],kind:'antenna'},
  {name:'NIB',shape:[2,5,6,6,7,7,6,4,2],kind:'shell'},
  {name:'ZUZU',shape:[2,4,6,7,7,6,5,4,3],kind:'cat'},
  {name:'TOTO',shape:[3,5,7,7,7,6,5,4,2],kind:'crab'},
];
export class BugVisual {
  constructor(mount){
    this.mount=mount;this.width=192;this.height=160;
    this.mode='idle';this.dna=null;this.level=0;this.progress=0;this.elapsed=0;
    this.pokedUntil=0;this.sprite=null;this.groove=true;this.start=performance.now();this.setupCanvas();
    this.mount.addEventListener('pointerdown',()=>this.poke());
  }
  setupCanvas(){
    if(window.p5){
      this.p5=new window.p5(p=>{
        p.setup=()=>{p.createCanvas(this.width,this.height);p.pixelDensity(1);p.noSmooth();p.frameRate(30);};
        p.draw=()=>this.paint(p.drawingContext);
      },this.mount);
    }else{
      const c=document.createElement('canvas');c.width=this.width;c.height=this.height;
      this.mount.appendChild(c);this.canvas=c;this.ctx=c.getContext('2d');
      const loop=()=>{this.paint(this.ctx);this.animation=requestAnimationFrame(loop);};loop();
    }
  }
  setMode(x){this.mode=x;}
  setDna(dna){this.dna=dna;this.sprite=dna?this.createSprite(dna):null;this.mode=dna?'hatched':'idle';}
  setLevel(x){this.level=Math.max(0,Math.min(1,x));}
  setProgress(x){this.progress=Math.max(0,Math.min(1,x));}
  setElapsed(x){this.elapsed=x;}
  setGroove(enabled){this.groove=!!enabled;}
  poke(){this.pokedUntil=performance.now()+900;}
  createSprite(dna){
    const r=mulberry32(dna.sprite),species=SPECIES[Math.floor(r()*SPECIES.length)];
    return {...species,palette:PALETTES[Math.floor(r()*PALETTES.length)],
      eyeStyle:Math.floor(r()*4),mouth:Math.floor(r()*4),mark:Math.floor(r()*5),
      personality:Math.floor(r()*4),leftHand:r()>.27,feet:Math.floor(r()*3),
      eyeSpace:r()>.4?5:4,earHeight:r()>.45?2:3};
  }
  px(ctx,x,y,w=1,h=1,color=INK){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),w,h);}
  text(ctx,content,x,y,color=GLOW,size=7){ctx.fillStyle=color;ctx.font=`bold ${size}px monospace`;ctx.textAlign='center';ctx.fillText(content,x,y);}
  star(ctx,x,y,s=2,color=GLOW){this.px(ctx,x-s,y,2*s,s,color);this.px(ctx,x,y-s,s,4*s,color);}
  paint(ctx){
    const ms=performance.now(),t=(ms-this.start)/1000;
    this.px(ctx,0,0,this.width,this.height,SKY);
    // 少ないタイルと星だけで、初期コンソールのステージを構成する。
    this.px(ctx,9,19,174,1,'#344475');this.px(ctx,9,140,174,1,'#344475');
    for(let i=0;i<7;i++){
      const x=14+i*27;
      this.px(ctx,x,148,13,2,'#344475');
    }
    for(const [x,y] of [[22,40],[162,42],[35,96],[166,101],[69,29],[122,114]]){
      this.px(ctx,x,y,2,2,'#485B8E');
    }
    const blink=Math.floor(t*2)%2===0;
    if(blink){this.star(ctx,34,52,2,'#8EE4D3');this.star(ctx,155,73,2,'#FFE3A5');}
    if(!this.dna)this.egg(ctx,t);
    else this.creature(ctx,t,ms);
    if(this.mode==='recording'){
      for(let k=0;k<5;k++)this.px(ctx,77+k*9,122-Math.floor(this.level*11),6,3+Math.floor(this.level*11),k%2?'#FFAFBF':'#FFE39A');
    }
    if(this.mode==='playing'){
      const count=20,active=Math.floor(this.progress*count);
      for(let i=0;i<count;i++)this.px(ctx,24+i*7.3,133,4,3,i<=active?'#FAE18D':'#354776');
    }
  }
  egg(ctx,t){
    const cell=5,beat=Math.floor(t*3)%3;
    const wobble=this.mode==='recording'?(beat===0?-2:beat===1?2:0):0;
    const px=92+wobble,py=78;
    const shape=[2,4,5,6,6,6,5,5,4,3];
    for(let row=0;row<shape.length;row++)for(let x=-shape[row];x<=shape[row];x++){
      const xx=px+x*cell,yy=py+(row-shape.length/2)*cell;
      const edge=Math.abs(x)===shape[row]||row===0||row===shape.length-1;
      this.px(ctx,xx,yy,cell,cell,edge?'#19203F':'#FFE5AD');
    }
    this.px(ctx,px-8,py-2,5,5,'#19203F');this.px(ctx,px+8,py-2,5,5,'#19203F');
    this.px(ctx,px-2,py+9,5,3,'#D8859B');
    if(beat!==1){this.star(ctx,37,83,2,'#F8A9CE');this.star(ctx,147,60,2,'#88DACF');}
    this.text(ctx,this.mode==='recording'?'FEED ME!':'HELLO?',96,119,'#D4E8C9',8);
  }
  creature(ctx,t,now){
    const s=this.sprite,p=s.palette,unit=5;
    const playing=this.mode==='playing';
    const poked=now<this.pokedUntil;
    const beat=playing?(this.groove?this.elapsed*(this.dna.bpm/60):t*.78):t*.75;
    const step=Math.floor(beat*2);
    const bouncy=playing?Math.sin(beat*Math.PI*2):Math.sin(t*1.9);
    const hop=poked?11:playing?Math.max(0,bouncy)*(this.groove?11:5):Math.max(0,bouncy)*3;
    const sway=(step%4===0?-2:step%4===2?2:0)+(s.personality===2?Math.round(Math.sin(t*2)*2):0);
    const centerX=96+sway,baseY=86-hop;
    const top=baseY-Math.floor(s.shape.length/2)*unit;
    // 短い影でジャンプの高さを分かりやすくする。
    this.px(ctx,70,125,52,3,'#4A5487');
    this.px(ctx,78,128,37,2,'#2B3767');
    // 手足・羽を体の後ろに描く。
    const flap=step%2?4:-5;
    if(s.kind==='wings'||s.kind==='star'){
      this.px(ctx,centerX-52,top+25+flap,20,12,p.shadow);
      this.px(ctx,centerX+34,top+25-flap,20,12,p.shadow);
      this.px(ctx,centerX-46,top+28+flap,10,6,p.spot);
      this.px(ctx,centerX+37,top+28-flap,10,6,p.spot);
    }else if(s.kind==='crab'){
      this.px(ctx,centerX-50,top+32+flap,19,6,p.body);
      this.px(ctx,centerX+34,top+32-flap,19,6,p.body);
      this.px(ctx,centerX-53,top+20+flap,12,13,p.cheek);
      this.px(ctx,centerX+46,top+20-flap,12,13,p.cheek);
    }else{
      this.px(ctx,centerX-42,top+30+flap/2,14,8,p.shadow);
      this.px(ctx,centerX+30,top+30-flap/2,14,8,p.shadow);
    }
    // 体型の定義は横幅だけ。行ごとに輪郭線と胴体色を分ける。
    for(let row=0;row<s.shape.length;row++){
      const radius=s.shape[row];
      for(let x=-radius;x<=radius;x++){
        const edge=Math.abs(x)===radius||row===0||row===s.shape.length-1;
        let fill=edge?INK:p.body;
        if(!edge && row>s.shape.length*.62 && (x+row)%3===0)fill=p.spot;
        this.px(ctx,centerX+x*unit,top+row*unit,unit,unit,fill);
      }
    }
    // 特徴的な耳・花・触角。手作り形状を保ち、DNAで長さを変える。
    const ear=s.earHeight*unit;
    if(['ears','cat','frog'].includes(s.kind)){
      const outside=s.kind==='frog'?27:25;
      this.px(ctx,centerX-outside,top-ear,10,ear+5,INK);
      this.px(ctx,centerX+outside-5,top-ear,10,ear+5,INK);
      this.px(ctx,centerX-outside+2,top-ear+3,6,ear-3,s.kind==='cat'?p.cheek:p.body);
      this.px(ctx,centerX+outside-3,top-ear+3,6,ear-3,p.body);
    }
    if(['sprout','antenna','flower'].includes(s.kind)||s.kind==='star'){
      this.px(ctx,centerX-3,top-17,6,17,INK);
      this.px(ctx,centerX-15,top-22,13,9,p.body);
      this.px(ctx,centerX+3,top-19,12,9,p.shadow);
    }
    if(s.kind==='robot'){
      this.px(ctx,centerX-3,top-16,6,16,INK);
      this.px(ctx,centerX-6,top-21,13,7,p.cheek);
    }
    if(s.kind==='shell'){
      for(let i=0;i<3;i++)this.px(ctx,centerX+15+i*5,top+27-i*4,4,5,p.shadow);
    }
    // 表情: 時間でまばたき、音のエネルギーで口が開閉、タップで驚いた表情。
    const eyesY=top+(s.kind==='ghost'?3:4)*unit;
    const eyeOffset=s.eyeSpace*unit;
    const blink=!poked && (Math.floor(t*1.45+s.eyeStyle*1.5)%9===0)&&((t*1.45)%1<.20);
    if(blink){
      this.px(ctx,centerX-eyeOffset,eyesY+5,9,3,INK);
      this.px(ctx,centerX+eyeOffset-5,eyesY+5,9,3,INK);
    }else{
      this.px(ctx,centerX-eyeOffset,eyesY,10,11,INK);
      this.px(ctx,centerX+eyeOffset-5,eyesY,10,11,INK);
      // 瞳のハイライトは静かな液晶表現を崩さず愛嬌を増す。
      this.px(ctx,centerX-eyeOffset+2,eyesY+2,4,4,p.spot);
      this.px(ctx,centerX+eyeOffset-3,eyesY+2,4,4,p.spot);
    }
    if(s.mark!==0){
      this.px(ctx,centerX-eyeOffset-12,eyesY+12,8,5,p.cheek);
      this.px(ctx,centerX+eyeOffset+8,eyesY+12,8,5,p.cheek);
    }
    const mouthY=eyesY+20;
    if(poked){
      this.px(ctx,centerX-3,mouthY,9,11,INK);
      this.px(ctx,centerX-1,mouthY+6,5,3,p.cheek);
    }else if(playing && (step%3===0||this.level>.33)){
      this.px(ctx,centerX-4,mouthY,10,9,INK);
      this.px(ctx,centerX-1,mouthY+5,4,3,p.cheek);
    }else if(s.mouth===0){
      this.px(ctx,centerX-7,mouthY,5,3,INK);this.px(ctx,centerX+3,mouthY,5,3,INK);
      this.px(ctx,centerX-2,mouthY+4,5,3,INK);
    }else if(s.mouth===1){
      this.px(ctx,centerX-6,mouthY,13,4,INK);this.px(ctx,centerX-2,mouthY+4,6,4,INK);
    }else{
      this.px(ctx,centerX-3,mouthY,8,5,INK);
    }
    const footY=top+s.shape.length*unit-2;
    const foot=playing&&step%2?6:0;
    if(s.feet!==2){
      this.px(ctx,centerX-27,footY,13,5+foot,p.shadow);
      this.px(ctx,centerX+16,footY,13,11-foot,p.shadow);
    }else{
      this.px(ctx,centerX-19,footY,14,6,p.shadow);
      this.px(ctx,centerX+7,footY,14,6,p.shadow);
    }
    if((playing&&this.groove)||poked){
      const phase=Math.floor(beat)%4;
      this.star(ctx,31+phase*2,70-phase*3,2,p.cheek);
      this.star(ctx,154-phase*2,57+phase*4,2,p.spot);
      if(poked)this.text(ctx,'!',135,43,'#FFE2AA',12);
    }
    // 名前は個体の愛称。小さな図鑑を見ている感覚を作る。
    this.text(ctx,s.name,96,120,'#D2D7FA',8);
  }
}
