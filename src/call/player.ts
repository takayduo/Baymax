import { Bridge } from '../core/bridge';
import { State } from '../core/state';
import { VoiceManager } from '../core/voice';
import { musicAppearance, normalizePreferences } from '../companion/appearance';
import { VoiceCall } from './voiceCall';

export const localCallAppearance=()=>({companion:normalizePreferences(State.settings.companion),headphones:musicAppearance().headphones});
export const Calls = new VoiceCall({
  signal:value=>Bridge.voiceSignal(value),
  appearance:localCallAppearance,
  active:async active=>{
    State.voiceCallActive=active;
    if(active)VoiceManager.stopSpeech();
    VoiceManager.syncEngineMode();
    await Bridge.setVoiceCallActive(active);
    if(!active)VoiceManager.syncEngineMode();
  },
  changed:()=>State.notify(),
  incoming:()=>window.dispatchEvent(new Event('baymax-incoming-call')),
});
