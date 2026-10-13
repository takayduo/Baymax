import {drawCompanionBody} from '../companion/render';
import {getAppearance,shade,companionInk} from '../companion/appearance';

// Original Baymax choreography: a raised hand, two waves, then a pointing glide.
export const GREETING_END=2.15;
export type WelcomeStage='google'|'username'|'plans';
export const welcomeGlide=(progress:number)=>{
 const t=Math.max(0,Math.min(1,progress));return t-Math.sin(2*Math.PI*t)/(2*Math.PI);
};
export function welcomePose(stage:WelcomeStage,elapsed:number,reduced=false){
 const travel=reduced?1:welcomeGlide((elapsed-(stage==='google'?1.15:0))/.9);
 return {x:stage==='google'?320-185*travel:stage==='username'?135+370*travel:320,
  y:stage==='plans'?43:190,point:stage==='username'?-travel:travel,
  wave:!reduced&&stage==='google'&&elapsed<1.15?Math.sin(elapsed*Math.PI*4)*.36:0,
  raised:stage==='google'&&elapsed<1.15,card:reduced?1:Math.max(0,Math.min(1,(elapsed-(stage==='google'?1.75:.55))/.35))};
}
export function drawWelcomeCompanion(ctx:CanvasRenderingContext2D,x:number,y:number,r:number,point:number,wave:number,raised:boolean,time=0){
 const appearance=getAppearance();ctx.save();ctx.translate(x,y);ctx.rotate(wave*.08);
 // A rounded mitten follows a shoulder arc independently of the chosen silhouette.
 const hand=(side:number,angle:number)=>{ctx.save();ctx.translate(side*r*.7,raised&&side===1?-r*.61:r*.13);ctx.rotate(angle);ctx.translate(side*r*.47,0);
  const g=ctx.createRadialGradient(-r*.03,-r*.09,0,0,0,r*.25);g.addColorStop(0,shade(appearance.style.color,.32));g.addColorStop(1,shade(appearance.style.color,-.16));ctx.fillStyle=g;
  ctx.beginPath();ctx.ellipse(0,0,r*.16,r*.23,side*.2,0,Math.PI*2);ctx.fill();ctx.restore();};
 hand(-1,point<0?-.42:-.65);hand(1,raised?-1.1+wave:point>0?-.42:.65);
 const body=drawCompanionBody(ctx,r*1.1,r,appearance,{yaw:point*.16,pitch:0});
 ctx.save();ctx.clip(body);ctx.fillStyle=companionInk(appearance);
 const blink=Math.sin(time*1.1)>0.996?.2:1;
 for(const side of [-1,1]){ctx.beginPath();ctx.ellipse(side*r*.27+point*r*.07,0,r*.054,r*.12*blink,0,0,Math.PI*2);ctx.fill();}
 ctx.strokeStyle=companionInk(appearance);ctx.lineWidth=r*.025;ctx.lineCap='round';ctx.beginPath();ctx.arc(point*r*.07,r*.18,r*.08,.1*Math.PI,.9*Math.PI);ctx.stroke();ctx.restore();ctx.restore();
}

/** Short returning-user greeting; first-run onboarding owns the longer sequence. */
export class Greeting {
 onComplete:(()=>void)|null=null;
 private started=0;private finished=false;private timer:number|undefined;
 start(){this.interrupt();this.started=performance.now();this.finished=false;this.timer=window.setTimeout(()=>this.complete(),GREETING_END*1000);}
 hover(){} // Navigation never waits for or extends the welcome animation.
 interrupt(){window.clearTimeout(this.timer);this.finished=true;}
 get elapsed(){return (performance.now()-this.started)/1000;}
 get done(){return this.finished;}
 private complete(){if(this.finished)return;this.finished=true;this.onComplete?.();}
 draw(ctx:CanvasRenderingContext2D){ctx.clearRect(0,0,640,150);const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  drawWelcomeCompanion(ctx,320,79,43,0,reduced?0:Math.sin(this.elapsed*10)*.32,!reduced,this.elapsed);
 }
}
