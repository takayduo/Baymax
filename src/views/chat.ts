// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type ChatContext } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import { assistantName } from "../core/branding";
import { VoiceManager } from "../core/voice";
import type { ViewHost } from "./views";

let nextId = 1;

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  return h("div", { class: "chat-row" }, h("div", { class: "reply", text: message.content }));
}

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string): HTMLElement {
  const chip = h("div", { class: "chip" }, h("i", { class: "chip-dot" }), h("span", { text: label }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "chip-row", style: "display:flex;align-items:center;gap:6px" });
  const log = h("div", { class: "chat-log" });
  const input = h("textarea", {
    rows: "1",
    "aria-label": "Message your assistant",
    class: "chat-input",
    placeholder: "Ask me anything…",
    spellcheck: "false",
  }) as HTMLTextAreaElement;
  const send = h("button", { class: "send-btn", title: "Send" }, svg(ICONS.arrowUp, 11));
  const bar = h("div", { class: "chat-bar" }, input, send);

  const errorStatus = h("div", { class: "chat-error", role: "alert", hidden: true });
  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, chipRow, log, errorStatus, bar)),
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  let renderedCount = -1;

  async function submit() {
    const query = input.value.trim();
    if (!query || sending) return;
    input.value = "";
    errorStatus.hidden = true;
    sending = true;
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const context: ChatContext | null = null;
    const speechGeneration = VoiceManager.speechGeneration;

    try {
      const reply = await Bridge.chatSend(query, context);
      if (speechGeneration !== VoiceManager.speechGeneration) return;
      if (reply && reply.text && reply.text !== "(Command sent to Mochi)") {
        const lastMsg = State.chatHistory[State.chatHistory.length - 1];
        if (!lastMsg || lastMsg.content !== reply.text) {
          State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
        }
        void VoiceManager.speak(reply.text);
      }
      State.stateOverride = null;
      State.triggerEmote("happy");
      Sound.play("finish");
    } catch (err) {
      if (speechGeneration !== VoiceManager.speechGeneration) return;
      State.stateOverride = null;
      input.value = query;
      errorStatus.textContent = `Could not send. ${String(err).replace(/^Error:\s*/, "")}`;
      errorStatus.hidden = false;
      Sound.play("error");
    } finally {
      sending = false;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  input.addEventListener("input", () => { send.disabled = sending || !input.value.trim(); });
  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
    if (e.key !== "Escape") e.stopPropagation();
  });

  return {
    el,
    sync() {
      const curVoice = State.settings.voiceName || "Charon";
      const curRole = `${State.settings.userRole}|${State.settings.userName}|${State.settings.partnerName}|${State.settings.aiProvider}`;
      if (
        chipRow.dataset.voice !== curVoice ||
        chipRow.dataset.role !== curRole
      ) {
        chipRow.dataset.voice = curVoice;
        chipRow.dataset.role = curRole;
        clear(chipRow);
    
      }

      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0);
      if (count !== renderedCount || log.dataset.assistant !== assistantName(State.settings.assistantName)) {
        log.dataset.assistant = assistantName(State.settings.assistantName);
        renderedCount = count;
        clear(log);
        if (!State.chatHistory.length && !thinking) {
          const suggestions = h("div", { class: "chat-suggestions" });
          for (const prompt of ["Help me plan my day", "Explain something simply"]) {
            suggestions.append(h("button", { text: prompt, onclick: () => { input.value = prompt; send.disabled = false; input.focus(); } }));
          }
          log.append(h("div", { class: "chat-empty" },
            h("h2", { text: `A moment with ${assistantName(State.settings.assistantName)}` }),
            h("p", { text: "Ask a question, work through an idea, or make a plan." }), suggestions));
        }
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }

      input.placeholder = State.chatHistory.length === 0 ? "Ask me anything…" : "Continue…";
      input.disabled = sending;
      send.disabled = sending || !input.value.trim();
      send.setAttribute("aria-label", sending ? "Sending message" : "Send message");
      log.setAttribute("aria-live", "polite");
      log.setAttribute("aria-busy", String(thinking));
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
