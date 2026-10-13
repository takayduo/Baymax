import { h } from '../views/dom';

// Gemini API voice IDs are case-sensitive. Preview slugs are Cloud TTS demo names.
export const VOICES = [
  ['Leda','Female','Youthful, Sweet & Cute'],['Zephyr','Female','Bright, Bubbly & Cheerful'],
  ['Aoede','Female','Breezy, Soft & Expressive'],['Despina','Female','Smooth & Playful'],
  ['Laomedeia','Female','Upbeat & Lively'],['Callirrhoe','Female','Easy-going & Friendly'],
  ['Autonoe','Female','Bright & Clear'],['Erinome','Female','Clear & Gentle'],
  ['Vindemiatrix','Female','Gentle & Soft'],['Sulafat','Female','Warm & Soothing'],
  ['Achernar','Female','Soft & Calm'],['Kore','Female','Warm, Natural & Firm'],
  ['Pulcherrima','Female','Forward & Crisp'],['Gacrux','Female','Mature & Smooth'],
  ['Puck','Male','Upbeat, Playful & Energetic'],['Achird','Male','Friendly & Youthful'],
  ['Charon','Male','Calm & Informative'],['Fenrir','Male','Excitable & Dynamic'],
  ['Orus','Male','Firm & Clear'],['Enceladus','Male','Breathy & Soft'],
  ['Iapetus','Male','Clear & Casual'],['Umbriel','Male','Easy-going'],['Algieba','Male','Smooth'],
  ['Algenib','Male','Gravelly'],['Rasalgethi','Male','Informative'],['Alnilam','Male','Firm'],
  ['Schedar','Male','Even & Steady'],['Sadachbia','Male','Lively'],['Sadaltager','Male','Knowledgeable'],
  ['Zubenelgenubi','Male','Casual'],
].map(([id,gender,style])=>({id,gender,style,slug:id==='Aoede'?'aoeda':id.toLowerCase()}));

let stopCurrent:(()=>void)|undefined;
export function voicePicker(selected:string, choose:(id:string)=>Promise<boolean>) {
  const summary=h('summary',{text:selected || 'Charon'});
  const list=h('div',{class:'voice-list','aria-label':'Live voice choices'});
  const status=h('div',{class:'hint',role:'status'});
  const details=h('details',{class:'voice-picker'},summary,list,status);
  const audio=new Audio();let active:HTMLButtonElement|null=null;
  const stop=()=>{audio.pause();audio.removeAttribute('src');if(active){active.textContent='▶';active.setAttribute('aria-pressed','false');}active=null;};
  audio.onended=stop;
  audio.onerror=()=>{stop();status.textContent='Sample unavailable. You can still select this voice.';};
  for(const voice of VOICES){
    const pick=h('button',{type:'button',class:'voice-choice','aria-pressed':String(selected===voice.id)},
      h('strong',{text:voice.id}),h('small',{text:`${voice.gender} · ${voice.style}`}));
    const preview=h('button',{type:'button',class:'voice-preview',text:'▶',title:`Play ${voice.id} sample`,'aria-label':`Play ${voice.id} sample`,'aria-pressed':'false'}) as HTMLButtonElement;
    pick.addEventListener('click',async()=>{
      pick.disabled=true;
      try{if(await choose(voice.id)){
        selected=voice.id;summary.textContent=selected;
        list.querySelectorAll('.voice-choice').forEach(row=>row.setAttribute('aria-pressed',String(row===pick)));
        details.removeAttribute('open');stop();
      }}finally{pick.disabled=false;}
    });
    preview.addEventListener('click',event=>{
      event.stopPropagation();event.preventDefault();
      if(active===preview){stop();return;}
      stopCurrent?.();stopCurrent=stop;status.textContent='';active=preview;
      preview.textContent='■';preview.setAttribute('aria-pressed','true');
      audio.src=`https://docs.cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-${voice.slug}.wav`;
      void audio.play().catch(()=>{stop();status.textContent='Could not play sample. Check your connection.';});
    });
    list.append(h('div',{class:'voice-row'},pick,preview));
  }
  details.addEventListener('toggle',()=>{if(!details.open)stop();});
  let wasConnected=false;
  const observer=new MutationObserver(()=>{
    if(details.isConnected)wasConnected=true;
    else if(wasConnected){stop();observer.disconnect();if(stopCurrent===stop)stopCurrent=undefined;}
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  return details;
}
