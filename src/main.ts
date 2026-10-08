// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent, type PartnerChatMessage } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { Island } from "./island/island";
import { registerHookHandlers } from "./island/hooks";
import { registerIntegrationHandlers, refreshConfigured } from "./island/integrations";
import { stopHostScreenSharing, handleHostSignal } from "./remote/hostStream";

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  const island = new Island(root);

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
    if (boot.schedule) State.schedule = boot.schedule;
  }
  island.applySettings();
  State.loadIntegrationTasks();

  // Load chat history & unread count
  try {
    const initialMessages = await Bridge.getChatMessages();
    State.partnerChatMessages = initialMessages;
    const isMe = (State.settings.userRole || "me") === "me";
    const myName = (isMe ? (State.settings.userName || "Badsha") : (State.settings.partnerName || "Ayzil")).toLowerCase();
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
    State.partnerLastSeen = Date.now();

    const isMe = (State.settings.userRole || "me") === "me";
    const partnerName = pres?.partnerName || pres?.user || (isMe ? State.settings.partnerName || "Ayzil" : State.settings.userName || "Badsha");

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

  await onEvent<PartnerChatMessage>("partner-chat-received", (msg) => {
    if (!msg || !msg.id) return;
    const exists = State.partnerChatMessages.some((m) => m.id === msg.id);
    if (!exists) {
      State.partnerChatMessages.push(msg);
    }

    const isCurrentCoupleChat = State.mode === "expanded" && State.view === "couple-chat";
    const isMe = (State.settings.userRole || "me") === "me";
    const myName = (isMe ? (State.settings.userName || "Badsha") : (State.settings.partnerName || "Ayzil")).toLowerCase();
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
    Sound.play("blip");
    State.remoteAccessStatus = "idle";
    island.setView(State.defaultView());
    State.notify();
  });

  await onEvent("remote-access-ended", () => {
    Sound.play("close");
    stopHostScreenSharing();
    State.remoteAccessStatus = "idle";
    State.notify();
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
        island.alert("settings");
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

    const uName = payload?.userName || ((State.settings.userRole || "me") === "me" ? State.settings.userName || "Badsha" : State.settings.partnerName || "Ayzil");
    import("./core/voice").then(({ VoiceManager }) => {
      VoiceManager.speakText(`Hey ${uName}, focus on your work! You have an active focus session going on.`);
    }).catch(console.error);

    setTimeout(() => {
      if (State.view === "note" && State.noteMessage?.includes("blocked")) {
        island.collapse();
      }
    }, 5500);
    State.notify();
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    State.settings = { ...State.settings, ...s };
    island.applySettings();
    State.loadIntegrationTasks();
    void refreshConfigured();
    State.notify();
  });

  registerHookHandlers(island);
  registerIntegrationHandlers(island);

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
