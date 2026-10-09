// Couple Chat view — Real-time peer-to-peer chat between creator partners
import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type PartnerChatMessage } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { ViewActions, ViewHost } from "./views";

export function buildCoupleChat(actions: ViewActions): ViewHost {
  const presenceBadge = h("span", {
    class: "sched-presence-badge",
    style: "font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:10px;background:rgba(34,197,94,0.15);color:#22c55e;display:inline-flex;align-items:center;gap:4px;",
    text: "🟢 Online",
  });

  const headerTitle = h("div", {
    class: "sched-title",
    style: "display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;",
    text: "Partner chat",
  });

  const topRow = h(
    "div",
    {
      class: "sched-header-row",
      style: "display:flex;align-items:center;justify-content:space-between;padding:2px 4px 6px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:6px;",
    },
    headerTitle,
    presenceBadge
  );

  const log = h("div", {
    class: "chat-log couple-chat-log",
    style: "flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px;scrollbar-width:thin;",
  });

  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Message your partner…",
    "aria-label": "Message your partner",
    spellcheck: "false",
    style: "font-size:12.5px;",
  }) as HTMLInputElement;

  const sendBtn = h(
    "button",
    {
      class: "send-btn",
      title: "Send Message",
      style: "background:#d9e6e1;color:#14211c;",
    },
    svg(ICONS.arrowUp, 11)
  );

  const errorStatus = h("div", { class: "chat-error", role: "alert", hidden: true });
  const bar = h("div", { class: "chat-bar", style: "margin-top:6px;" }, input, sendBtn);

  const el = h(
    "div",
    { class: "view couple-chat-view" },
    h(
      "div",
      { class: "card wash chat-card" },
      h("div", { class: "chat-body", style: "height:100%;display:flex;flex-direction:column;" }, topRow, log, errorStatus, bar)
    )
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(244, 63, 94, 0.28)");

  let sending = false;

  function scrollToBottom() {
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }

  function formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  function getCoupleInfo() {
    const isMe = (State.settings.userRole || "me") === "me";
    const creator = (State.settings.userName && State.settings.userName !== "Me" ? State.settings.userName : "You");
    const partner = (State.settings.partnerName && State.settings.partnerName !== "Her" ? State.settings.partnerName : "Partner");
    const rawMe = isMe ? creator : partner;
    const rawPartner = isMe ? partner : creator;
    const myName = (rawMe.charAt(0).toUpperCase() + rawMe.slice(1)) || "Me";
    const partnerName = (rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1)) || "Partner";
    const myIcon = isMe ? "👤" : "💖";
    const partnerIcon = isMe ? "💖" : "👤";
    return { isMe, myName, partnerName, myIcon, partnerIcon };
  }

  function renderMessages() {
    clear(log);
    const messages = State.partnerChatMessages || [];
    const { isMe, myName, partnerName, partnerIcon } = getCoupleInfo();

    if (messages.length === 0) {
      const empty = h(
        "div",
        {
          style:
            "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--dim);font-size:12px;text-align:center;gap:4px;padding:24px 0;",
        },
        h("div", { style: "font-size:24px;", text: "💌" }),
        h("div", { text: `No messages yet! Say hi to ${partnerName} ✨` }),
        h("div", { style: "font-size:11px;opacity:0.65;", text: "Messages arrive in real-time (<50ms) over WebSockets" })
      );
      log.append(empty);
      return;
    }

    for (const msg of messages) {
      const isFromMe = (msg.sender || "").toLowerCase() === myName.toLowerCase() ||
                       (msg.senderRole && msg.senderRole === (isMe ? "me" : "her"));
      const row = h("div", {
        class: isFromMe ? "chat-row user" : "chat-row partner",
        style: `display:flex;justify-content:${isFromMe ? "flex-end" : "flex-start"};width:100%;`,
      });

      const bubbleEl = h(
        "div",
        {
          class: isFromMe ? "bubble couple-bubble me" : "bubble couple-bubble them",
          style: isFromMe
            ? "background:linear-gradient(135deg, #6366f1, #8b5cf6);color:#fff;border-radius:14px 14px 2px 14px;padding:7px 12px;max-width:82%;font-size:12.5px;box-shadow:0 2px 8px rgba(99,102,241,0.25);"
            : "background:rgba(255,255,255,0.08);border:1px solid rgba(244,63,94,0.25);color:var(--ink);border-radius:14px 14px 14px 2px;padding:7px 12px;max-width:82%;font-size:12.5px;",
        }
      );

      // Sender tag for partner messages
      if (!isFromMe) {
        const displaySender = msg.sender ? (msg.sender.charAt(0).toUpperCase() + msg.sender.slice(1)) : partnerName;
        const senderTag = h("div", {
          style: "font-size:10.5px;font-weight:700;color:#f43f5e;margin-bottom:2px;",
          text: `${displaySender} ${partnerIcon}`,
        });
        bubbleEl.append(senderTag);
      }

      // Message content
      const textEl = h("div", {
        style: "word-break:break-word;line-height:1.45;",
        text: msg.text,
      });
      bubbleEl.append(textEl);

      // Footer: AI badge + timestamp
      const footerEl = h("div", {
        style: `display:flex;align-items:center;justify-content:${isFromMe ? "flex-end" : "flex-start"};gap:5px;margin-top:4px;font-size:9.5px;opacity:0.75;`,
      });

      if (msg.isAiGenerated) {
        const aiBadge = h("span", {
          style: "color:#fbbf24;font-weight:600;display:inline-flex;align-items:center;gap:2px;",
          text: "✨ AI",
        });
        footerEl.append(aiBadge);
      }

      const timeEl = h("span", { text: formatTime(msg.timestamp || Date.now()) });
      footerEl.append(timeEl);
      if (isFromMe && msg.delivery) footerEl.append(h("span", { text: msg.delivery === "pending" ? " · Pending" : msg.delivery === "stored" ? " · Saved for delivery" : " · Sent" }));

      bubbleEl.append(footerEl);
      row.append(bubbleEl);
      log.append(row);
    }

    scrollToBottom();
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || sending) return;

    input.value = "";
    sending = true;
    sendBtn.disabled = true;
    errorStatus.hidden = true;
    Sound.play("pop");

    try {
      const newMsg = await Bridge.sendChatMessage(text, false);
      if (newMsg) {
        State.partnerChatMessages.push(newMsg);
        renderMessages();
        State.notify();
      }
    } catch (err) {
      input.value = text;
      errorStatus.textContent = `Message could not be saved. ${String(err)}`;
      errorStatus.hidden = false;
    } finally {
      sending = false;
      sendBtn.disabled = !input.value.trim();
      input.focus();
    }
  }

  input.addEventListener("input", () => { sendBtn.disabled = sending || !input.value.trim(); });
  sendBtn.addEventListener("click", () => void sendMessage());
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter" && !e.isComposing) {
      e.preventDefault();
      void sendMessage();
    }
  });

  return {
    el,
    sync() {
      const { partnerName, partnerIcon } = getCoupleInfo();
      headerTitle.textContent = `Chat with ${partnerName} ${partnerIcon}`;
      input.placeholder = `Message ${partnerName}...`;

      if (State.partnerOnline) {
        presenceBadge.style.background = "rgba(34,197,94,0.15)";
        presenceBadge.style.color = "#22c55e";
        presenceBadge.textContent = "🟢 Online";
      } else {
        presenceBadge.style.background = "rgba(255,255,255,0.06)";
        presenceBadge.style.color = "var(--dim)";
        presenceBadge.textContent = "⚪ Offline";
      }

      renderMessages();

      // Mark unread as read since the user is looking at the chat
      if (State.unreadPartnerChatCount > 0) {
        State.unreadPartnerChatCount = 0;
        void Bridge.markChatRead();
      }
    },
    focus() {
      const { partnerName } = getCoupleInfo();
      input.placeholder = `Message ${partnerName}...`;
      input.focus();
      void Bridge.markChatRead();
      State.unreadPartnerChatCount = 0;
      State.notify();
    },
  };
}
