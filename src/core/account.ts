import {State} from './state';
export interface Capabilities {configured:boolean;signedIn:boolean;local:boolean;groq:boolean;tasks:boolean;musicSolo:boolean;gemini:boolean;productivity:boolean;listenTogether:boolean;partner:boolean;cloud:boolean;pcControl:boolean;grace:boolean}
export interface CloudConfig {supabaseUrl:string;supabaseAnonKey:string;razorpayKeyId:string;planIds:Record<string,string>}
export interface AccountSnapshot {configured:boolean;config:CloudConfig;user?:{id:string;email:string;displayName:string}|null;profile?:{user_id:string;username:string;display_name:string}|null;entitlement?:{plan:string;provider?:string;periodEnd?:string;subscriptionId?:string;purchaserId?:string;cancelAtPeriodEnd?:boolean;partnerSeat?:{userId:string;username:string;displayName:string;state:string}|null};pair?:any;invites?:any[];backends?:any[];migrations?:any[];capabilities:Capabilities;planChosen?:boolean;loggingIn?:boolean;error?:string;verifiedAt?:number}
export const betaCapabilities:Capabilities={configured:false,signedIn:false,local:true,groq:true,tasks:true,musicSolo:true,gemini:true,productivity:true,listenTogether:true,partner:true,cloud:false,pcControl:true,grace:false};
export function allowed(feature:keyof Capabilities){return State.account?.capabilities?.[feature]??betaCapabilities[feature];}
export function needsOnboarding(){const a=State.account;return !!a?.configured&&(!a.user||!a.profile||(!a.planChosen&&a.entitlement?.plan==='free'));}
export function openAccount(message=''){window.dispatchEvent(new CustomEvent('baymax-open-account',{detail:message}));}
export function openPlans(){window.dispatchEvent(new Event('baymax-open-plans'));}
export function requireFeature(feature:keyof Capabilities){
 if(allowed(feature))return true;
 if(feature==='partner'||feature==='local'){openAccount('Sign in and connect with your partner.');return false;}
 if(document.querySelector('.upgrade-dialog'))return false;
 const names:Partial<Record<keyof Capabilities,string>>={pcControl:'Remote PC Control',listenTogether:'Listen Together',productivity:'Productivity & Focus',gemini:'Gemini Live',cloud:'Baymax Cloud'};
 const dialog=document.createElement('dialog');dialog.className='upgrade-dialog';
 const title=document.createElement('h2');title.textContent=names[feature]||'More with Baymax';
 const copy=document.createElement('p');copy.textContent=feature==='listenTogether'&&State.account?.entitlement?.plan!=='free'?'Connect with a partner who has Pro, or give both of you a seat with Duo.':'This feature is included in Pro and Duo. Pick the plan that works for you.';
 const upgrade=document.createElement('button');upgrade.className='btn glass';upgrade.textContent='Upgrade Plan';
 const later=document.createElement('button');later.className='btn glass';later.textContent='Maybe later';
 const before=document.activeElement as HTMLElement|null;
 const close=()=>{dialog.close();dialog.remove();window.dispatchEvent(new CustomEvent('baymax-upgrade-dialog',{detail:false}));before?.focus();};
 upgrade.onclick=()=>{close();openPlans();};later.onclick=close;
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
 dialog.append(title,copy,upgrade,later);(document.querySelector('#island-clip')||document.body).append(dialog);window.dispatchEvent(new CustomEvent('baymax-upgrade-dialog',{detail:true}));dialog.showModal();upgrade.focus();
 return false;
}
export const Account={
 files:(op:string,args:unknown={})=>window.electronAPI!.accountFiles!(op,args),
 snapshot:()=>window.electronAPI?.accountSnapshot?.()||Promise.resolve(State.account),
 configure:(config:CloudConfig)=>window.electronAPI!.accountConfig!(config),
 login:()=>window.electronAPI!.accountLogin!(),
 cancelLogin:()=>window.electronAPI!.accountCancelLogin!(),
 logout:()=>window.electronAPI!.accountLogout!(),
 refresh:()=>window.electronAPI!.accountRefresh!(),
 action:(op:string,args:unknown={})=>window.electronAPI!.accountAction!(op,args),
 billing:(op:string,args:unknown={})=>window.electronAPI!.accountBilling!(op,args),
};
