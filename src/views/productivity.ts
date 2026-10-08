// Baymax — Productivity & Focus Workspace View (Distrack Inside Mochi)
import { h } from "./dom";
import type { ViewActions, ViewHost } from "./views";

export function buildProductivity(_actions: ViewActions): ViewHost {
  const isFileProto = window.location.protocol === "file:";
  const iframeSrc = isFileProto
    ? window.location.href.replace(/\/dist\/[^\/]*$/, "/productivity/dist/index.html")
    : "http://localhost:3000";

  const iframe = h("iframe", {
    src: iframeSrc,
    class: "productivity-iframe",
    style:
      "width: 100%; height: 100%; border: 0; border-radius: 14px; background: #0A0A0A; display: block; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);",
    allow: "camera; microphone; display-capture",
  }) as HTMLIFrameElement;

  const container = h(
    "div",
    {
      class: "productivity-container",
      style:
        "width: 100%; height: 100%; padding: 4px 6px 6px; box-sizing: border-box; display: flex; flex-direction: column;",
    },
    iframe
  );

  const el = h("div", { class: "view productivity-view" }, container);

  return {
    el,
    sync() {
      // Sync or ensure iframe is active
      try {
        if (iframe && iframe.contentWindow && (iframe.contentWindow as any).electronAPI == null) {
          if ((window as any).electronAPI) {
            (iframe.contentWindow as any).electronAPI = (window as any).electronAPI;
          }
        }
      } catch (_e) {}
    },
  };
}
