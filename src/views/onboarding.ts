import {h} from './dom';
import {State} from '../core/state';
import {Account} from '../core/account';
import {assistantName} from '../core/branding';
import {plansSection} from '../settings/plans';
import {drawWelcomeCompanion,welcomePose,type WelcomeStage} from '../mochi/greeting';
import type {ViewActions,ViewHost} from './views';

export function buildOnboarding(actions:ViewActions):ViewHost {
 const canvas=h('canvas',{'aria-hidden':'true',class:'welcome-canvas'});
 const cards=h('div',{class:'welcome-cards'}),progress=h('span',{class:'welcome-progress'});
 const el=h('div',{class:'view onboarding-view'},canvas,progress,cards,h('button',{class:'welcome-skip',text:'Explore Baymax',onclick:()=>actions.setView('overview')}));
 let stage:WelcomeStage='google',started=performance.now(),stamp='',busy=false,username='',shown=false;
 const status=h('p',{class:'welcome-status',role:'status','aria-live':'polite'});
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 async function run(action:()=>Promise<unknown>){
  if(busy)return;busy=true;status.textContent='';cards.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  try{await action();const next=await Account.snapshot();if(next&&typeof next==='object'&&'capabilities'in next){State.account=next;State.notify();}}
  catch(e){status.textContent=e instanceof Error?e.message:'Please try again.';}
  finally{busy=false;stamp='';sync();}
 }
 function sync(){
  const a=State.account,next:WelcomeStage=!a?.user?'google':!a.profile?'username':'plans';
  if(next!==stage){stage=next;started=performance.now();status.textContent='';}
  const key=[stage,a?.loggingIn,a?.user?.id,a?.profile?.username,busy].join(':');if(key===stamp)return;stamp=key;
  el.dataset.stage=stage;cards.replaceChildren();progress.textContent=stage==='google'?'01 · Welcome':stage==='username'?'02 · Your name':'03 · Your plan';
  if(stage==='plans'){cards.append(plansSection(()=>actions.setView('overview')));return;}
  const card=h('section',{class:'welcome-card'});
  if(stage==='google'){
   card.append(h('span',{class:'welcome-eyebrow',text:'A little company for your day'}),h('h1',{text:`Hello, I’m ${assistantName(State.settings.assistantName)}.`}),h('p',{text:'Make yourself at home. Sign in to choose a username and connect with your person.'}),h('button',{class:'btn glass welcome-google',text:a?.loggingIn?'Waiting for Google…':'Continue with Google',disabled:busy||a?.loggingIn,onclick:()=>void run(()=>Account.login())}));
   if(a?.loggingIn)card.append(h('button',{class:'btn glass',text:'Cancel sign-in',onclick:()=>void run(()=>Account.cancelLogin())}));
  }else{
   const name=h('input',{value:username,placeholder:'@your_name','aria-label':'Choose your username',minlength:3,maxlength:24,pattern:'[a-z0-9_]{3,24}',required:true,autocomplete:'off',spellcheck:'false',autocapitalize:'none'}) as HTMLInputElement;
   name.oninput=()=>{username=name.value;};
   const form=h('form',{},h('h1',{text:'What should we call you?'}),h('p',{text:'Your unique username helps your partner find you.'}),h('label',{},h('span',{text:'Your @username'}),name),h('small',{text:'3–24 lowercase letters, numbers or underscores.'}),h('button',{type:'submit',class:'btn glass',text:'Reserve username',disabled:busy}));
   form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity())return;void run(()=>Account.action('reserve',{username:name.value,displayName:a?.user?.displayName||name.value}));};
   card.append(form);
  }
  card.append(status);cards.append(card);
 }
 return {el,sync,focus(){if(!shown){started=performance.now();shown=true;}stamp='';sync();},tick(now){
  const dpr=Math.min(devicePixelRatio||1,2);if(canvas.width!==640*dpr){canvas.width=640*dpr;canvas.height=450*dpr;}
  const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,640,450);
  const t=(now-started)/1000,p=welcomePose(stage,t,reduced.matches);
  drawWelcomeCompanion(ctx,p.x,p.y,stage==='plans'?23:57,p.point,p.wave,p.raised,reduced.matches?0:t);
  cards.style.opacity=String(stage==='plans'?1:p.card);cards.style.transform=`translateY(${(1-p.card)*8}px)`;
  cards.style.pointerEvents=p.card>.9||stage==='plans'?'auto':'none';
 }};
}
