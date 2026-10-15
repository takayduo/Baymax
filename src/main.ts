import { Calls } from './call/player';
import { needsOnboarding, allowed } from './core/account';
import type { VoiceSignal } from './call/voiceCall';
// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent, type PartnerChatMessage } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { Island } from "./island/island";
import { registerHookHandlers } from "./island/hooks";
import { registerIntegrationHandlers, refreshConfigured } from "./island/integrations";
import { stopHostScreenSharing, handleHostSignal } from "./remote/hostStream";
import { Music } from './music/player';
import { runMusicAction } from './music/actions';
import { triggerMusicVibe } from './companion/appearance';
import type { IslandViewName, BotEmoteName } from './core/layout';

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  const island = new Island(root);

  const boot = await Bridge.boot();
  if (boot) {
    State.account = boot.account || null;
    State.settings = { ...State.settings, ...boot.settings };
    if (boot.schedule) State.schedule = boot.schedule;
  }
  island.applySettings();
  const showPage=(page:string)=>{sessionStorage.setItem('baymax-settings-page',page);island.alert('preferences');window.dispatchEvent(new CustomEvent('baymax-settings-page',{detail:page}));};
  const showAccount=()=>showPage('account');
  window.addEventListener('baymax-open-account',showAccount);
  window.addEventListener('baymax-open-plans',()=>showPage('plans'));
  window.addEventListener('baymax-open-welcome',()=>island.alert('onboarding'));
  await onEvent<any>('account-changed',next=>{
    const changed=State.account?.user?.id!==next.user?.id||State.account?.pair?.id!==next.pair?.id;
    State.account=next;
    if(changed){State.chatHistory=[];State.partnerChatMessages=[];State.unreadPartnerChatCount=0;State.partnerOnline=false;Music.receiveLibrary(Music.library);void Bridge.getChatMessages().then(messages=>{State.partnerChatMessages=messages;State.notify();});}
    if(changed||!allowed('listenTogether'))Music.leave();
    if(changed||!allowed('partner'))Calls.end();
    island.applySettings();State.notify();
    window.dispatchEvent(new Event('baymax-account-changed'));
  });
  await onEvent<any>('partner-unpaired', () => {
    State.partnerOnline = false;
    State.partnerChatMessages = [];
    island.handleDizzy();
    island.alert('prompt');
  });
  await onEvent<any>('partner-invite-received', () => {
    island.reveal();
  });
  await onEvent<any>('partner-invite-accepted', () => {
    island.reveal();
  });
  void Music.init();
  window.addEventListener('baymax-incoming-call',()=>island.alert('couple-chat'));
  window.addEventListener('beforeunload',()=>{Music.leave();Calls.end();});
  await onEvent<VoiceSignal>('voice-signal',message=>{void Calls.signal(message);});
  await onEvent<any>('app-action', async action => {
    try {
      let result='';
      if(action.action==='music')result=await runMusicAction(Music,action);
      else if(action.action==='open_view'){
        const views:Record<string,IslandViewName>={music:'music',chat:'prompt',partner_chat:'couple-chat',tasks:'schedule',share:'partner-file',productivity:'productivity',settings:'preferences'};
        if(!views[action.view])throw new Error('Unknown view');
        island.alert(views[action.view]);result=`Opened ${action.view}.`;
      }else if(action.action==='emote'){
        island.reveal();
        if(action.emote==='dizzy')island.handleDizzy();
        else if(action.emote==='vibe')triggerMusicVibe();
        else {const emotes:Record<string,BotEmoteName>={love:'love',celebrate:'proud',sleepy:'yawn'};
          if(!emotes[action.emote])throw new Error('Unknown emote');State.triggerEmote(emotes[action.emote]);}
        result=`Showing ${action.emote}.`;
      }else throw new Error('Unsupported app action');
      window.electronAPI?.appActionResult?.({id:action.id,result});
    }catch(error){window.electronAPI?.appActionResult?.({id:action.id,error:error instanceof Error?error.message:String(error)});}
  });
  await onEvent<any>('music-library', library => Music.receiveLibrary(library));
  await onEvent<any>('music-signal', message => {void Music.signal(message);});
  // Keep this listener ahead of async history/partner setup. applySettings owns voice sync.
  await onEvent<Settings>("settings-changed", (s) => {
    const pairChanged=(s.syncUrl!==undefined && State.settings.syncUrl!==s.syncUrl) || (s.shareChannel!==undefined && State.settings.shareChannel!==s.shareChannel) || (s.userRole!==undefined && State.settings.userRole!==s.userRole) || (s.syncApiKey!==undefined && State.settings.syncApiKey!==s.syncApiKey);
    State.settings = { ...State.settings, ...s };
    if(pairChanged){Music.leave();Calls.end();Music.receiveLibrary(Music.library);}
    Calls.syncAppearance();
    island.applySettings();
    State.loadIntegrationTasks();
    void refreshConfigured();
    State.notify();
  });
  await onEvent("open-preferences", () => island.alert("preferences"));
  State.loadIntegrationTasks();

  // Load chat history & unread count
  try {
    const initialMessages = await Bridge.getChatMessages();
    State.partnerChatMessages = initialMessages;
    const isMe = (State.settings.userRole || "me") === "me";
    const myName = (isMe ? (State.settings.userName || "You") : (State.settings.partnerName || "Partner")).toLowerCase();
    State.unreadPartnerChatCount = initialMessages.filter(
      (m) => !m.read && (m.sender || "").toLowerCase() !== myName
    ).length;
  } catch (e) {
    console.warn("Failed to load initial chat history:", e);
  }

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));

  await onEvent<any[]>("schedule-updated", (sched) => {
    State.schedule = sched;
    Sound.play("done");
    State.notify();
  });

  await onEvent<{ online: boolean; user?: string; partnerName?: string; justCameOnline?: boolean }>("partner-presence", (pres) => {
    const wasOffline = !State.partnerOnline;
    State.partnerOnline = !!pres?.online;
    Music.presence(State.partnerOnline);
    if(!State.partnerOnline && Calls.active)Calls.end("Partner went offline.");
    State.partnerLastSeen = Date.now();

    const isMe = (State.settings.userRole || "me") === "me";
    const partnerName = pres?.partnerName || pres?.user || (isMe ? State.settings.partnerName || "Partner" : State.settings.userName || "You");

    if (pres?.online && pres?.justCameOnline) {
      if (State.settings.notifyPartnerOnline !== false) {
        Sound.play("greet");
        State.triggerEmote("love");
        State.noteMessage = `💖 ${partnerName} is now online!`;
        island.expand("note");
        setTimeout(() => {
          if (State.view === "note" && State.noteMessage?.includes("online")) {
            island.collapse();
          }
        }, 4500);
      }
    }
    State.notify();
  });

  await onEvent<PartnerChatMessage[]>('partner-chat-history', (messages) => {
    const merged = new Map(State.partnerChatMessages.map(m => [m.id, m]));
    for (const m of messages || []) merged.set(m.id, m);
    State.partnerChatMessages = [...merged.values()].sort((a,b) => a.timestamp-b.timestamp || a.id.localeCompare(b.id));
    State.notify();
  });
  await onEvent<PartnerChatMessage>("partner-chat-received", (msg) => {
    if (!msg || !msg.id) return;
    const exists = State.partnerChatMessages.some((m) => m.id === msg.id);
    if (!exists) {
      State.partnerChatMessages.push(msg);
    } else {
      State.partnerChatMessages = State.partnerChatMessages.map(m => m.id === msg.id ? { ...m, ...msg } : m);
      State.notify(); return;
    }

    const isCurrentCoupleChat = State.mode === "expanded" && State.view === "couple-chat";
    const isMe = (State.settings.userRole || "me") === "me";
    const myName = (isMe ? (State.settings.userName || "You") : (State.settings.partnerName || "Partner")).toLowerCase();
    const isFromPartner = (msg.sender || "").toLowerCase() !== myName;

    if (isCurrentCoupleChat) {
      Sound.play("pop");
      void Bridge.markChatRead();
      State.unreadPartnerChatCount = 0;
    } else {
      Sound.play("love");
      State.triggerEmote("love");
      if (isFromPartner) {
        State.unreadPartnerChatCount++;
      }
    }
    State.notify();
  });

  await onEvent("open-couple-chat", () => {
    island.reveal();
    island.setView("couple-chat");
    State.unreadPartnerChatCount = 0;
    void Bridge.markChatRead();
    State.notify();
  });

  // ── Remote Access (Mochi Eye Co-Pilot) ─────────────────────────────────────
  await onEvent<{ sender: string }>("remote-access-requested", (payload) => {
    Sound.play("love");
    State.triggerEmote("surprised");
    State.remoteAccessStatus = "incoming_request";
    State.remoteRequesterName = payload?.sender || "Partner";
    island.reveal();
    island.setView("remote-control");
    State.notify();
  });

  await onEvent<{ sender: string; accepted: boolean }>("remote-access-accepted", (payload) => {
    Sound.play("done");
    State.triggerEmote("happy");
    State.remoteAccessStatus = "active_viewer";
    State.remoteActivePartner = payload?.sender || "Partner";
    State.notify();
  });

  await onEvent<{ sender: string }>("remote-access-declined", () => {
    if (State.remoteAccessStatus !== "idle") {
      Sound.play("blip");
      State.remoteAccessStatus = "idle";
      island.setView(State.defaultView());
      State.notify();
    }
  });

  await onEvent("remote-access-ended", () => {
    if (State.remoteAccessStatus !== "idle") {
      Sound.play("close");
      stopHostScreenSharing();
      State.remoteAccessStatus = "idle";
      State.notify();
    }
  });

  await onEvent<any>("host-signal", async (signal) => {
    await handleHostSignal(signal);
  });

  await onEvent<{ name: string; size: string; sender: string; path: string }>("file-received", (info) => {
    Sound.play("greet");
    State.triggerEmote("happy");
    State.noteMessage = `${info.sender} sent ${info.name} (${info.size})!`;
    island.expand("note");
    State.notify();
  });

  /** Pause has to reach Rust too, or the pollers keep calling out. */
  const setPaused = (on: boolean) => {
    if (State.paused === on) return;
    State.paused = on;
    void Bridge.setPaused(on);
  };

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        setPaused(false);
        island.alert("preferences");
        break;
      case "open":
        setPaused(false);
        island.alert(State.defaultView());
        break;
      case "open-productivity":
        setPaused(false);
        island.alert("productivity");
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
    }
  });

  // ── Productivity & Distraction Alert (Baymax) ──────────────────────────
  await onEvent<{ app: string; userName?: string }>("productivity-distraction-warning", (payload) => {
    Sound.play("error");
    State.triggerEmote("annoyed");
    const appName = payload?.app || "distraction";
    State.noteMessage = `⚠️ Focus! "${appName}" is blocked during your focus session.`;
    island.expand("note");

    const uName = payload?.userName || ((State.settings.userRole || "me") === "me" ? State.settings.userName || "You" : State.settings.partnerName || "Partner");
    import("./core/voice").then(({ VoiceManager }) => {
      void VoiceManager.speakCheckIn(`Hey ${uName}, focus on your work! You have an active focus session going on.`);
    }).catch(console.error);

    setTimeout(() => {
      if (State.view === "note" && State.noteMessage?.includes("blocked")) {
        island.collapse();
      }
    }, 5500);
    State.notify();
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  registerHookHandlers(island);
  registerIntegrationHandlers(island);

  island.launch();
  if(needsOnboarding()&&!localStorage.getItem('baymax-welcome-shown')){localStorage.setItem('baymax-welcome-shown','1');island.alert('onboarding');}

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
