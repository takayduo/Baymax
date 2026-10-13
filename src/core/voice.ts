import { allowed } from './account';
// Voice & Audio Coordinator for Mochi Ultra
// Supports both Google Gemini Multimodal Live Engine AND Secondary Groq AI Engine (with Local TTS)
import { Bridge, type TalkKeyState } from "./bridge";
import { HoldAudio } from './holdAudio';
import { Sound } from "./sound";
import { State } from "./state";

let nextChatId = 1000;

function float32ToWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: "audio/wav" });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function isWhisperHallucination(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length < 2) return true;
  if (/^[\[\(].*[\]\)]$/.test(t)) return true;
  if (/^[*].*[*]$/.test(t)) return true;

  const clean = t.replace(/[^a-z0-9 ]/g, "").trim();
  const hallucinations = new Set([
    "thank you",
    "thank you so much",
    "thank you for watching",
    "thanks for watching",
    "please subscribe",
    "like and subscribe",
    "subscribe to my channel",
    "see you next time",
    "see you in the next video",
    "see you later",
    "bye",
    "you",
    "the end",
  ]);
  return hallucinations.has(clean);
}

/** Converts formatted AI text, markdown, timestamps, and emojis into natural spoken words */
export function cleanForSpeech(rawText: string): string {
  if (!rawText) return "";

  let s = rawText;

  // 1. Remove command tags [LAUNCH:...], [ADD_TASK:...], [MARK_DONE:...]
  s = s.replace(/\[[A-Z_]+:[^\]]*\]/gi, "");

  // 2. Strip code blocks and inline code
  s = s.replace(/```[\s\S]*?```/g, "");
  s = s.replace(/`([^`]+)`/g, "$1");

  // 3. Strip markdown headers, blockquotes, bold, italics, strikethrough
  s = s.replace(/^[#>\s*+-]+ /gm, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");
  s = s.replace(/~~([^~]+)~/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 4. Strip ALL emojis and symbol pictographs
  s = s.replace(
    /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu,
    ""
  );

  // 5. Clean up times for natural speech: 11:00 AM -> 11 AM, 03:30 PM -> 3:30 PM
  s = s.replace(/\b0?(\d{1,2}):00\s*(AM|PM)\b/gi, "$1 $2");
  s = s.replace(/\b0?(\d{1,2}):(\d{2})\s*(AM|PM)\b/gi, "$1:$2 $3");

  // 6. Symbols
  s = s.replace(/&/g, " and ").replace(/@/g, " at ").replace(/\bw\//gi, " with ");
  s = s.replace(/[()\[\]{}]/g, " ");

  // 7. Split by line and combine into natural flowing sentences
  s = s
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(". ");

  s = s.replace(/[,;.]\s*[,;.]+/g, ".").replace(/\s+/g, " ").trim();
  return s;
}

class VoiceService {
  private onGeometryUpdate?: () => void;
  private currentAudioLevel = 0;
  private _engineState = "listening";
  private _localSpeaking = false;
  private holdAudio = new HoldAudio();
  private voiceMode = '';
  private micGeneration = 0;
  private micStarting = false;
  private initialized = false;
  private talkKeySuspended = false;
  private voiceProvider = '';
  private voiceGeneration = 0;
  private cancelLocalSpeech: (() => void) | null = null;
  private backgroundSpeechStopped = false;
  private localSpeechIsCheckIn = false;

  // Web Audio VAD for Groq Whisper Mode
  private isListening = false;
  private isProcessing = false;
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private audioChunks: Float32Array[] = [];
  private preRollBuffer: Float32Array[] = [];
  private readonly PRE_ROLL_LIMIT = 3;
  private silenceFrames = 0;
  private speakingFrames = 0;
  private ambientNoiseRms = 0.015;
  private readonly MIN_SPEECH_FRAMES = 4;
  private readonly SILENCE_FRAMES_LIMIT = 8;

  init(onUpdate?: () => void) {
    this.onGeometryUpdate = onUpdate;
    if (this.initialized) return;
    this.initialized = true;
    Bridge.on('push-to-talk-state', (state: TalkKeyState) => this.onTalkKey(state));
    Bridge.on('ai-speech-reset', () => {
      this.currentAudioLevel = 0;
      this._engineState = 'idle';
      State.stateOverride = null;
      this.onGeometryUpdate?.();
      State.notify();
    });
    void Bridge.getPushToTalkState().then(state => this.onTalkKey(state)).catch(() => {});

    // Listen for assistant state changes from Mark-LV Python engine (Gemini Mode)
    Bridge.on("ai-state", (state: string) => {
      if ((State.settings.aiProvider || "gemini") !== "gemini") return;
      const st = String(state).toLowerCase();
      this._engineState = st;
      if (st === "speaking") {
        State.stateOverride = "finished";
        State.triggerEmote("happy");
      } else if (st === "thinking") {
        State.stateOverride = "thinking";
      } else if (st === "sleeping") {
        State.stateOverride = "sleeping";
      } else {
        State.stateOverride = null;
      }
      State.notify();
    });

    // Listen for live RMS audio levels (0.0 to 1.0)
    Bridge.on("ai-audio-level", (level: number) => {
      this.currentAudioLevel = Math.max(0, Math.min(1, Number(level) || 0));
      if (this.onGeometryUpdate) {
        this.onGeometryUpdate();
      }
    });

    // Listen for live transcripts
    Bridge.on("ai-transcript", (data: { role: string; text: string; speaker?: string }) => {
      if ((State.settings.aiProvider || 'gemini') !== 'gemini') return;
      if (!data || !data.text) return;
      const text = data.text.trim();
      if (!text) return;

      const role = data.role === "user" ? "user" : "assistant";
      const last = State.chatHistory[State.chatHistory.length - 1];
      if (last && last.role === role && last.content === text) {
        return;
      }

      State.chatHistory.push({
        id: nextChatId++,
        role,
        content: text,
      });

      if (role === "assistant") {
        State.triggerEmote("happy");
        Sound.play("finish");
      }

      State.notify();
    });

    // Island.applySettings synchronizes voice only AFTER boot/event preferences are applied.
  }

  syncEngineMode() {
    if(!allowed('local')||((State.settings.aiProvider||'gemini')!=='groq'&&!allowed('gemini'))){this.stopGroqMic();this.stopSpeech();void Bridge.aiMute(true).catch(()=>{});return;}
    if(State.voiceCallActive){this.stopGroqMic();void Bridge.aiMute(true).catch(()=>{});return;}
    if (this.localSpeechIsCheckIn && State.settings.proactiveTalkingEnabled !== true) this.stopSpeech();
    const provider = State.settings.aiProvider || "gemini";
    if (provider !== this.voiceProvider) {
      this.voiceProvider = provider; ++this.voiceGeneration;
      this.cancelLocalSpeech?.();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    }
    const micOn = State.settings.micEnabled ?? true;
    const mode = JSON.stringify([provider, micOn, State.settings.pushToTalkEnabled, State.settings.pushToTalkKey]);
    if (mode !== this.voiceMode) {
      this.voiceMode = mode; this.holdAudio.reset(); this.clearCapture();
      // Ignore a key already held during a mode change. Require a fresh press.
    }

    if (provider === "groq") {
      // Groq mode: start web mic for whisper transcription
      Bridge.aiMute(true).catch(() => {});
      if (micOn) {
        void this.startGroqMic();
      } else {
        this.stopGroqMic();
      }
    } else {
      // Gemini mode: stop web mic, let Python live engine stream mic
      this.stopGroqMic();
      Bridge.aiMute(!micOn).catch(() => {});
    }
  }

  getAudioLevel(): number {
    return this.currentAudioLevel;
  }

  get speechGeneration(): number { return this.voiceGeneration; }

  start() {
    if(State.voiceCallActive)return;
    if ((State.settings.aiProvider || "gemini") === "groq") {
      void this.startGroqMic();
    } else {
      Bridge.aiMute(false).catch(() => {});
    }
  }

  stop() {
    if ((State.settings.aiProvider || "gemini") === "groq") {
      this.stopGroqMic();
    } else {
      Bridge.aiMute(true).catch(() => {});
    }
  }

  // ── Groq Mode: Web Microphone VAD & Whisper ───────────────────────────────

  private clearCapture() {
    this.audioChunks = []; this.preRollBuffer = []; this.silenceFrames = 0; this.speakingFrames = 0;
    this.currentAudioLevel = 0;
  }

  private onTalkKey(state: TalkKeyState) {
    this.talkKeySuspended = state.suspended;
    if (State.voiceCallActive || (State.settings.aiProvider || 'gemini') !== 'groq' || !State.settings.pushToTalkEnabled || State.settings.micEnabled === false || !state.enabled || !state.ready || state.suspended || state.error) {
      this.holdAudio.reset(); this.clearCapture(); return;
    }
    if (state.held && !this.holdAudio.held) {
      if (this._localSpeaking) this.stopSpeech();
      this.clearCapture(); this.holdAudio.reset(true);
    } else if (!state.held && this.holdAudio.held) {
      this.audioChunks = this.holdAudio.release(); this.currentAudioLevel = 0;
      if (this.audioChunks.length && !this.isProcessing) void this.handleSpeechComplete();
    }
  }

  private async startGroqMic() {
    if (State.voiceCallActive || this.isListening || this.micStarting || State.settings.micEnabled === false) return;
    this.micStarting = true;
    const generation = ++this.micGeneration;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (State.voiceCallActive || generation !== this.micGeneration || State.settings.aiProvider !== 'groq' || !(State.settings.micEnabled ?? true)) { stream.getTracks().forEach(track => track.stop()); return; }
      this.micStream = stream;

      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      if (this.audioCtx && this.audioCtx.state === "suspended") {
        try {
          await this.audioCtx.resume();
        } catch {}
      }

      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      this.processor = this.audioCtx.createScriptProcessor(2048, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (this._localSpeaking || this.isProcessing) {
          this.clearCapture();
          return;
        }

        if (this.talkKeySuspended || (State.settings.pushToTalkEnabled && !this.holdAudio.held)) { this.clearCapture(); return; }

        const inputData = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        this.currentAudioLevel = Math.min(1, rms * 4);
        if (this.onGeometryUpdate) this.onGeometryUpdate();

        if (State.settings.pushToTalkEnabled) { this.holdAudio.push(inputData); return; }

        const dynamicThreshold = Math.max(0.026, this.ambientNoiseRms * 2.4);

        if (rms > dynamicThreshold) {
          if (this.speakingFrames === 0) {
            this.audioChunks = this.preRollBuffer.map((b) => new Float32Array(b));
          }
          this.speakingFrames++;
          this.silenceFrames = 0;
          this.audioChunks.push(new Float32Array(inputData));
        } else {
          this.ambientNoiseRms = this.ambientNoiseRms * 0.95 + rms * 0.05;

          if (this.speakingFrames === 0) {
            this.preRollBuffer.push(new Float32Array(inputData));
            if (this.preRollBuffer.length > this.PRE_ROLL_LIMIT) {
              this.preRollBuffer.shift();
            }
          } else {
            this.audioChunks.push(new Float32Array(inputData));
            this.silenceFrames++;

            if (this.silenceFrames >= this.SILENCE_FRAMES_LIMIT) {
              if (this.speakingFrames >= this.MIN_SPEECH_FRAMES) {
                void this.handleSpeechComplete();
              } else {
                this.audioChunks = [];
                this.silenceFrames = 0;
                this.speakingFrames = 0;
              }
            }
          }
        }
      };

      source.connect(this.processor);
      const muteGain = this.audioCtx.createGain();
      muteGain.gain.value = 0;
      this.processor.connect(muteGain);
      muteGain.connect(this.audioCtx.destination);

      this.isListening = true;
      console.log("[Voice] Groq Microphone VAD active and listening!");
    } catch (err) {
      console.warn("[Voice] Failed to start Groq microphone:", err);
      if (generation === this.micGeneration) this.stopGroqMic();
    } finally {
      if (generation === this.micGeneration) this.micStarting = false;
    }
  }

  private stopGroqMic() {
    ++this.micGeneration; this.micStarting = false; this.holdAudio.reset();
    this.isListening = false;
    this.audioChunks = [];
    this.preRollBuffer = [];
    this.silenceFrames = 0;
    this.speakingFrames = 0;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
  }

  private async handleSpeechComplete() {
    if (this.isProcessing || this.audioChunks.length === 0) return;
    this.isProcessing = true;
    this.backgroundSpeechStopped = false;
    const generation = this.voiceGeneration;

    let totalLen = 0;
    for (const c of this.audioChunks) totalLen += c.length;
    const mergedSamples = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      mergedSamples.set(chunk, offset);
      offset += chunk.length;
    }

    this.audioChunks = [];
    this.preRollBuffer = [];
    this.silenceFrames = 0;
    this.speakingFrames = 0;

    try {
      const wavBlob = float32ToWavBlob(mergedSamples, 16000);
      const base64 = await blobToBase64(wavBlob);

      const res = await Bridge.transcribeAudio(base64);
      if (generation !== this.voiceGeneration) return;
      if (!res.success || !res.text) return;

      const transcript = res.text.trim();
      if (isWhisperHallucination(transcript)) {
        return;
      }

      console.log("[Voice Heard (Groq)]:", transcript);
      State.chatHistory.push({ id: nextChatId++, role: "user", content: transcript });
      Sound.play("think");
      State.stateOverride = "thinking";
      State.notify();

      const reply = await Bridge.chatSend(transcript, null);
      if (generation !== this.voiceGeneration) return;
      if (reply && reply.text) {
        State.chatHistory.push({ id: nextChatId++, role: "assistant", content: reply.text });
        State.stateOverride = "finished";
        State.triggerEmote("happy");
        Sound.play("finish");
        State.notify();
        await this.speak(reply.text);
      }
    } catch (err) {
      console.error("[Voice] Groq transcription error:", err);
      if (generation !== this.voiceGeneration) return;
      State.stateOverride = "error";
      Sound.play("error");
      setTimeout(() => {
        State.stateOverride = null;
        State.notify();
      }, 2000);
    } finally {
      if (generation === this.voiceGeneration) this.isProcessing = false;
    }
  }

  // ── Speech Output (Local TTS for Groq / WebSocket PCM for Gemini) ──────────

  async speak(text: string, checkIn = false) {
    if (State.voiceCallActive || !text || !text.trim()) return;
    if (!checkIn) this.backgroundSpeechStopped = false;

    const provider = State.settings.aiProvider || "gemini";
    if (provider === "gemini") {
      // In Gemini mode, live speech is natively streamed via sounddevice PCM
      return;
    }

    // In Groq mode, use local SpeechSynthesis TTS (as before)
    const cleanSpoken = cleanForSpeech(text);
    if (!cleanSpoken) return;

    this.cancelLocalSpeech?.();
    this.localSpeechIsCheckIn = checkIn;
    this._localSpeaking = true;
    State.stateOverride = "finished";
    State.notify();

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(cleanSpoken);
        utter.rate = 1.02;
        utter.pitch = 1.12; // warm, friendly Mochi pitch

        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find(
            (v) =>
              v.name.includes("Natural") ||
              v.name.includes("Jenny") ||
              v.name.includes("Aria") ||
              v.name.includes("Zira") ||
              (v.lang.startsWith("en") &&
                (v.name.toLowerCase().includes("female") || v.name.includes("Desktop")))
          ) || voices.find((v) => v.lang.startsWith("en"));

        if (preferred) utter.voice = preferred;

        await new Promise<void>((resolve) => {
          let finished = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const done = () => {
            if (!finished) {
              finished = true;
              clearTimeout(timer);
              if (this.cancelLocalSpeech === done) {
                this.cancelLocalSpeech = null;
                this._localSpeaking = false;
                this.localSpeechIsCheckIn = false;
                State.stateOverride = null;
                State.notify();
              }
              resolve();
            }
          };
          this.cancelLocalSpeech = done;

          utter.onend = done;
          utter.onerror = done;
          window.speechSynthesis.speak(utter);

          timer = setTimeout(() => {
            if (!finished) done();
          }, 20000);
        });
      } catch (e) {
        this.cancelLocalSpeech?.();
        console.warn("[Local TTS Error]:", e);
        this._localSpeaking = false;
        State.stateOverride = null;
        State.notify();
      }
    }
  }

  stopSpeech() {
    this.localSpeechIsCheckIn = false;
    this.backgroundSpeechStopped = true;
    ++this.voiceGeneration;
    this.isProcessing = false;
    this.currentAudioLevel = 0;
    this.holdAudio.reset();
    this.clearCapture();
    this.cancelLocalSpeech?.();
    this._localSpeaking = false;
    this._engineState = "idle";
    State.stateOverride = null;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    Bridge.aiInterrupt().catch(() => {});
    State.notify();
  }

  isSpeaking(): boolean {
    return (
      this._localSpeaking ||
      this._engineState === "speaking" ||
      State.stateOverride === "finished"
    );
  }

  async speakCheckIn(text: string) {
    if (State.settings.proactiveTalkingEnabled !== true || this.backgroundSpeechStopped) return;
    await this.speak(text, true);
  }

  isBusy(): boolean {
    return (
      this.isSpeaking() ||
      this.isProcessing ||
      this._engineState === "thinking" ||
      State.stateOverride === "thinking"
    );
  }
}

export const VoiceManager = new VoiceService();
