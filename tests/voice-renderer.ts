import { VoiceManager } from '../src/core/voice';
import { State } from '../src/core/state';
import { Bridge } from '../src/core/bridge';

/** Real Groq capture coordinator, with an artificial microphone and no API requests. */
export async function verifyHoldToTalk() {
  const voice = VoiceManager as any, oldSettings = State.settings;
  const oldAudio = window.AudioContext;
  const originalMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const originalTranscribe = Bridge.transcribeAudio;
  const originalMute = Bridge.aiMute, muteCommands: boolean[] = [];
  const originalSpeech = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');
  let processor: any, calls = 0, stopped = 0, sampleBytes = 0;
  let transcribed!: () => void;
  let completion = new Promise<void>(resolve => { transcribed = resolve; });
  const settle = async () => { for(let i=0;voice.isProcessing && i<20;i++) await new Promise(requestAnimationFrame); if(voice.isProcessing) throw new Error('Voice processing did not finish'); };
  class FakeAudioContext {
    state = 'running'; destination = {};
    createMediaStreamSource() { return { connect() {} }; }
    createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor; }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    async close() {}
  }
  try {
    State.settings = { ...oldSettings, aiProvider: 'groq', micEnabled: true, pushToTalkEnabled: true };
    (window as any).AudioContext = FakeAudioContext;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }),
    } });
    Bridge.transcribeAudio = async base64 => { calls++; sampleBytes = atob(base64).length - 44; transcribed(); return { success: false }; };
    Bridge.aiMute = async muted => { muteCommands.push(muted); return true; };
    voice.syncEngineMode(); await Promise.resolve(); await Promise.resolve();
    const pcm = new Float32Array(2048).fill(.15);
    const frame = (samples = pcm) => processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
    for (let i = 0; i < 8; i++) frame(); // Not held: must never enter the utterance.
    const state = { enabled: true, ready: true, held: true, suspended: false, error: '', key: 'F8' };
    voice.onTalkKey(state); frame(); frame();
    if (calls) throw new Error('Push-to-talk sent before release');
    voice.onTalkKey({ ...state, held: false });
    await completion;
    await settle();
    if (calls !== 1 || sampleBytes !== 2 * pcm.length * 2) throw new Error('Hold included unheld audio or failed to submit on release');
    voice.onTalkKey(state); frame();
    voice.onTalkKey({ ...state, suspended: true, held: false });
    voice.onTalkKey({ ...state, held: false });
    if (calls !== 1) throw new Error('Opening the shortcut picker sent unfinished speech');
    State.settings = { ...State.settings, pushToTalkEnabled: false };
    voice.syncEngineMode(); voice.onTalkKey({ ...state, enabled: false, held: false });
    completion = new Promise<void>(resolve => { transcribed = resolve; });
    for (let i=0;i<4;i++) frame();
    for (let i=0;i<8;i++) frame(new Float32Array(2048));
    await completion; await settle();
    if (calls !== 2) throw new Error('Turning push-to-talk OFF did not restore continuous voice detection');
    voice.onTalkKey({ ...state, enabled: false, held: false, suspended: true });
    for (let i=0;i<8;i++) frame();
    if (voice.audioChunks.length) throw new Error('The picker failed to pause continuous voice');
    voice.onTalkKey({ ...state, enabled: false, held: false });
    State.settings = { ...State.settings, micEnabled: false }; voice.syncEngineMode();
    if (voice.isListening) throw new Error('New mute settings were ignored');
    voice.stopGroqMic(); if (!stopped) throw new Error('Microphone was not stopped');
    // A permission prompt completing after a mode switch must not reopen the old mic.
    let grant!: (stream: unknown) => void;
    (navigator.mediaDevices as any).getUserMedia = () => new Promise(resolve => { grant = resolve; });
    State.settings = { ...State.settings, micEnabled: true };
    const pending = voice.startGroqMic(); voice.stopGroqMic();
    grant({ getTracks: () => [{ stop() { stopped++; } }] }); await pending;
    if (voice.isListening || stopped < 2) throw new Error('Late microphone permission reopened a stopped voice session');
    let cancelled = 0,spoken = 0;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {cancelled++;}, getVoices:()=>[], speak(){spoken++;} } });
    State.settings={...State.settings,micEnabled:false,proactiveTalkingEnabled:false};
    await voice.speakCheckIn('Uninvited reminder');if(spoken)throw new Error('Disabled check-ins spoke locally');
    State.settings={...State.settings,proactiveTalkingEnabled:true};
    const checkIn=voice.speakCheckIn('Allowed reminder');
    State.settings={...State.settings,proactiveTalkingEnabled:false};voice.syncEngineMode();await checkIn;
    if(voice._localSpeaking)throw new Error('Toggling OFF did not cancel a local check-in');
    State.settings={...State.settings,proactiveTalkingEnabled:true};
    const before=spoken;await voice.speakCheckIn('Should stay stopped');if(spoken!==before)throw new Error('Stopped check-in resumed before user input');
    let transcription!: (value:any)=>void;
    Bridge.transcribeAudio=()=>new Promise(resolve=>{transcription=resolve;});
    voice.audioChunks=[new Float32Array(2048).fill(.2)];
    const late=voice.handleSpeechComplete();
    for(let i=0;!transcription && i<30;i++)await new Promise(requestAnimationFrame);
    voice.stopSpeech();transcription({success:true,text:'A late user transcript'});await late;
    if(voice.isProcessing || spoken!==before)throw new Error('Interrupted transcription restarted speech');
    const speaking = voice.speak('Testing provider switch.');
    State.settings = { ...State.settings, aiProvider:'gemini',micEnabled:true }; voice.syncEngineMode(); await speaking;
    if (voice._localSpeaking || !cancelled || muteCommands.at(-1) !== false) throw new Error('Switching to Gemini left Groq speech or the wrong microphone active');
    return { releaseSubmitsOnce: true, unheldAudioExcluded: true, continuousModeAfterDisable: true, pickerCancelsAudio: true, pickerPausesContinuousAudio: true, lateMicGrantCancelled: true, providerSwitchStopsOldVoice: true, unsolicitedLocalSpeechGated:true, interruptedTranscriptionCancelled:true };
  } finally {
    voice.stopGroqMic(); State.settings = oldSettings; window.AudioContext = oldAudio; Bridge.transcribeAudio = originalTranscribe;
    Bridge.aiMute = originalMute;
    if(originalSpeech) Object.defineProperty(window,'speechSynthesis',originalSpeech); else delete (window as any).speechSynthesis;
    if (originalMedia) Object.defineProperty(navigator, 'mediaDevices', originalMedia);
    else delete (navigator as any).mediaDevices;
  }
}
