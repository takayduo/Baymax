import { h, svg } from './dom';
import { ICONS } from './icons';
import { Bridge } from '../core/bridge';
import { State } from '../core/state';
import type { ViewActions, ViewHost } from './views';
import { Calls, localCallAppearance } from '../call/player';
import { getAppearance } from '../companion/appearance';
import { drawPortrait } from '../companion/render';
import type { CallAppearance } from '../call/voiceCall';

const phone='M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.6 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1z';
function names(){
  const me=State.settings.userRole!=='her';
  return {mine:me?State.settings.userName || 'You':State.settings.partnerName || 'You',partner:me?State.settings.partnerName || 'Partner':State.settings.userName || 'Partner'};
}
export function dedupeMessages(){
  State.partnerChatMessages=[...new Map(State.partnerChatMessages.filter(m=>m?.id).map(m=>[m.id,m])).values()].sort((a,b)=>a.timestamp-b.timestamp || a.id.localeCompare(b.id));
}
function button(label:string,run:()=>unknown,cls=''){
  return h('button',{type:'button',class:`call-button ${cls}`,text:label,onclick:(event:Event)=>{event.stopPropagation();void run();}});
}
export function buildCoupleChat(_actions:ViewActions):ViewHost {
  const title=h('strong',{class:'couple-title'});
  const presence=h('span',{class:'couple-presence'});
  const callButton=h('button',{type:'button',class:'call-button call-start',title:'Call partner','aria-label':'Call partner'},svg(phone,13)) as HTMLButtonElement;
  const regularHeader=h('header',{class:'couple-header'},title,h('div',{class:'couple-header-actions'},presence,callButton));
  callButton.addEventListener('click',()=>{if(State.partnerOnline)void Calls.call();});
  const callArea=h('div',{class:'call-area'});
  const log=h('div',{class:'chat-log couple-chat-log',role:'log','aria-label':'Partner messages'});
  const error=h('div',{class:'chat-error',role:'status',hidden:true});
  const input=h('input',{type:'text',class:'chat-input',maxlength:8000,placeholder:'Message your partner…','aria-label':'Message your partner'}) as HTMLInputElement;
  const send=h('button',{type:'submit',class:'send-btn',title:'Send message','aria-label':'Send message',disabled:true},svg(ICONS.arrowUp,11)) as HTMLButtonElement;
  const compose=h('form',{class:'chat-bar couple-compose'},input,send);
  const body=h('div',{class:'chat-body couple-body'},regularHeader,callArea,log,error,compose);
  const el=h('div',{class:'view couple-chat-view'},h('div',{class:'card chat-card'},body));
  let sending=false,messageKey='',callKey='';
  const tiles:{el:HTMLElement;canvas:HTMLCanvasElement;remote:boolean}[]=[];

  function portrait(appearance:CallAppearance,remote:boolean,mini=false){
    const canvas=h('canvas',{width:160,height:160,'aria-label':remote?'Partner companion':'Your companion'}) as HTMLCanvasElement;
    const tile=h('div',{class:`call-avatar${mini?' mini':''}`},canvas);
    const ctx=canvas.getContext('2d');if(ctx)drawPortrait(ctx,160,getAppearance(appearance.companion.avatarId,appearance.companion),1,appearance.headphones);
    tiles.push({el:tile,canvas,remote});return tile;
  }
  function renderCall(){
    const local=localCallAppearance(),n=names();
    const key=JSON.stringify([Calls.phase,Calls.compact,Calls.muted,Calls.remoteMuted,Calls.error,local,Calls.remoteAppearance,n]);
    if(key===callKey)return;callKey=key;tiles.length=0;callArea.replaceChildren();
    regularHeader.hidden=Calls.active && Calls.compact;
    callArea.hidden=!Calls.active;
    log.hidden=Calls.active && !Calls.compact;
    compose.hidden=Calls.active && !Calls.compact;
    error.hidden=!Calls.error;error.textContent=Calls.error;
    if(!Calls.active)return;
    if(Calls.compact){
      const bar=h('div',{class:'call-compact',role:'group','aria-label':'Active voice call'});
      const show=h('button',{type:'button',class:'call-expand',title:'Expand voice call','aria-label':'Expand voice call',onclick:()=>Calls.setCompact(false)},portrait(local,false,true),portrait(Calls.remoteAppearance,true,true),h('span',{class:'call-duration',text:'Connected'}));
      bar.append(show,button(Calls.muted?'Unmute':'Mute',()=>Calls.toggleMute()),button('End',()=>Calls.end(),'danger'));callArea.append(bar);
    }else{
      const status=Calls.phase==='incoming'?`${n.partner} is calling…`:Calls.phase==='outgoing'?`Calling ${n.partner}…`:Calls.phase==='connecting'?'Connecting securely…':'Together, wherever you are';
      const heading=h('div',{class:'call-heading'},h('span',{text:status}),h('small',{class:'call-duration',text:Calls.phase==='connected'?'0:00':'AI microphone paused'}));
      const companions=h('div',{class:'call-companions'});
      if(Calls.phase==='incoming')companions.append(h('div',{class:'call-person'},portrait(Calls.remoteAppearance,true),h('span',{text:n.partner})));
      else for(const remote of [false,true])companions.append(h('div',{class:'call-person'},portrait(remote?Calls.remoteAppearance:local,remote),h('span',{text:remote?n.partner:n.mine}),h('small',{text:(remote?Calls.remoteMuted:Calls.muted)?'Muted':'Voice on'})));
      const controls=h('div',{class:'call-controls'});
      if(Calls.phase==='incoming')controls.append(button('Accept',()=>Calls.accept(),'accept'),button('Decline',()=>Calls.decline(),'danger'));
      else if(Calls.phase==='connected')controls.append(button(Calls.muted?'Unmute':'Mute',()=>Calls.toggleMute()),button('Chat',()=>Calls.setCompact(true)),button('End call',()=>Calls.end(),'danger'));
      else controls.append(button('Cancel call',()=>Calls.end(),'danger'));
      callArea.append(h('section',{class:'voice-call-card'},heading,companions,controls));
    }
    if(Calls.error.includes('Resume call audio'))callArea.append(button('Resume call audio',()=>Calls.resumeAudio()));
  }
  function renderMessages(){
    dedupeMessages();
    const messages=State.partnerChatMessages,n=names(),key=JSON.stringify([messages,n]);
    if(key===messageKey)return;messageKey=key;
    const atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<50;
    log.replaceChildren();
    if(!messages.length)log.append(h('div',{class:'couple-empty'},h('strong',{text:`A little space for you and ${n.partner}`}),h('span',{text:'Send a message, or spend a moment on a call.'})));
    for(const msg of messages){
      const mine=msg.senderRole?msg.senderRole===(State.settings.userRole || 'me'):(msg.sender || '').toLowerCase()===n.mine.toLowerCase();
      const footer=h('div',{class:'couple-message-meta'},h('time',{text:new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}));
      if(msg.isAiGenerated)footer.append(h('span',{text:'AI'}));
      if(mine)footer.append(h('span',{text:msg.delivery==='pending'?'Pending':msg.delivery==='stored'?'Saved':msg.delivery==='sent'?'Sent':''}));
      log.append(h('div',{class:`chat-row ${mine?'user':'partner'}`},h('div',{class:`couple-bubble ${mine?'me':'them'}`},h('div',{text:msg.text}),footer)));
    }
    if(atBottom)requestAnimationFrame(()=>{log.scrollTop=log.scrollHeight;});
  }
  async function sendMessage(){
    const text=input.value.trim();if(!text || sending)return;
    sending=true;send.disabled=true;input.value='';error.hidden=true;
    try{
      const msg=await Bridge.sendChatMessage(text,false);
      if(msg){const index=State.partnerChatMessages.findIndex(m=>m.id===msg.id);if(index>=0)State.partnerChatMessages[index]={...State.partnerChatMessages[index],...msg};else State.partnerChatMessages.push(msg);dedupeMessages();State.notify();renderMessages();log.scrollTop=log.scrollHeight;}
    }catch(reason){input.value=text;error.textContent=`Could not save message. ${reason instanceof Error?reason.message:reason}`;error.hidden=false;}
    finally{sending=false;send.disabled=!input.value.trim();input.focus();}
  }
  compose.addEventListener('submit',event=>{event.preventDefault();void sendMessage();});
  input.addEventListener('input',()=>send.disabled=sending || !input.value.trim());
  return {el,sync(){
    const n=names();title.textContent=`Chat with ${n.partner}`;input.placeholder=`Message ${n.partner}…`;
    presence.textContent=State.partnerOnline?'Online':'Offline';presence.classList.toggle('online',State.partnerOnline);
    callButton.disabled=!State.partnerOnline || Calls.active;callButton.title=State.partnerOnline?'Call partner':'Partner is offline';
    renderCall();renderMessages();
    if(State.view==='couple-chat' && State.mode==='expanded' && State.unreadPartnerChatCount){State.unreadPartnerChatCount=0;void Bridge.markChatRead();}
  },focus(){if(!Calls.active || Calls.compact)input.focus();void Bridge.markChatRead();State.unreadPartnerChatCount=0;},tick(){
    if(Calls.startedAt){const total=Math.max(0,Math.floor((Date.now()-Calls.startedAt)/1000));callArea.querySelectorAll('.call-duration').forEach(el=>el.textContent=`${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`);}
    for(const tile of tiles){const level=tile.remote?Calls.remoteLevel:Calls.localLevel;tile.el.classList.toggle('speaking',level>.009);tile.canvas.style.transform=`translateY(${-Math.min(4,level*65)}px) scale(${1+Math.min(.05,level*.6)})`;}
  }};
}
