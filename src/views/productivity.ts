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

  function forwardToIframe(type: string, data: any) {
    try {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type, data }, "*");
      }
    } catch (_e) {}
  }

  function syncIframeState() {
    try {
      const api = (window as any).electronAPI;
      if (!api || !iframe || !iframe.contentWindow) return;
      (iframe.contentWindow as any).electronAPI = api;

      if (typeof api.getFocusActive === "function") {
        api.getFocusActive().then((status: any) => {
          forwardToIframe("baymax:focus-state-changed", status);
        }).catch(() => {});
      }
      if (typeof api.getProductivityStats === "function") {
        api.getProductivityStats("daily").then((apps: any) => {
          forwardToIframe("baymax:tracking-update", { apps });
        }).catch(() => {});
      }
      if (typeof api.getDailyTotals === "function") {
        api.getDailyTotals().then((totals: any) => {
          forwardToIframe("baymax:daily-totals", totals);
        }).catch(() => {});
      }
    } catch (_e) {}
  }

  // Hook parent-level IPC listeners to broadcast directly into the child iframe
  const api = (window as any).electronAPI;
  if (api) {
    try {
      api.onFocusStateChanged?.((data: any) => {
        forwardToIframe("baymax:focus-state-changed", data);
      });
      api.onTrackingUpdate?.((data: any) => {
        forwardToIframe("baymax:tracking-update", data);
      });
      api.onFocusDistractionWarning?.((data: any) => {
        forwardToIframe("baymax:distraction-warning", data);
      });
      api.onAppCloseWarning?.((data: any) => {
        forwardToIframe("baymax:app-close-warning", data);
      });
    } catch (_e) {}
  }

  // Listen for sync requests from within the iframe
  window.addEventListener("message", (event) => {
    if (event.data?.type === "baymax:request-sync") {
      syncIframeState();
    }
  });

  iframe.addEventListener("load", () => {
    try {
      if ((window as any).electronAPI && iframe.contentWindow) {
        (iframe.contentWindow as any).electronAPI = (window as any).electronAPI;
      }
    } catch (_e) {}
    // Proactively push initial live state into iframe once loaded
    setTimeout(syncIframeState, 200);
    setTimeout(syncIframeState, 1000);
  });

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
      syncIframeState();
    },
  };
}
