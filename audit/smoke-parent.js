"use strict";
var Smoke = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/views/productivity.ts
  var productivity_exports = {};
  __export(productivity_exports, {
    buildProductivity: () => buildProductivity
  });

  // src/views/dom.ts
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "text") el.textContent = String(v);
      else if (k === "html") el.innerHTML = String(v);
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "style") el.setAttribute("style", String(v));
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      el.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  // src/views/productivity.ts
  function buildProductivity(_actions) {
    const isFileProto = window.location.protocol === "file:";
    const iframeSrc = isFileProto ? window.location.href.replace(/\/dist\/[^\/]*$/, "/productivity/dist/index.html") : "http://localhost:3000";
    const iframe = h("iframe", {
      src: iframeSrc,
      class: "productivity-iframe",
      style: "width: 100%; height: 100%; border: 0; border-radius: 14px; background: #0A0A0A; display: block; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);",
      allow: "camera; microphone; display-capture"
    });
    const api = window.electronAPI;
    const allowed = /* @__PURE__ */ new Set(["getTrackedApps", "getDailyTotals", "getAppCategories", "updateAppCategory", "scanRunningApps", "scanAllApps", "getKnownApps", "addCustomApp", "getFocusSessions", "startFocusSession", "stopFocusSession", "getFocusActive", "getBlocklist", "toggleBlockApp", "setBlocklist", "getSettings", "updateSettings", "clearData", "isOnboarded", "setOnboarded", "getUserProfile", "setUserProfile", "setAppHidden", "getTrackingHealth"]);
    const expectedOrigin = new URL(iframeSrc, window.location.href).origin;
    const targetOrigin = expectedOrigin === "null" ? "*" : expectedOrigin;
    function send(message) {
      iframe.contentWindow?.postMessage(message, targetOrigin);
    }
    window.addEventListener("message", async (event) => {
      if (event.source !== iframe.contentWindow || event.origin !== expectedOrigin) return;
      const { type, id, method, args } = event.data || {};
      if (type !== "baymax:rpc" || typeof id !== "string" || !allowed.has(method) || !Array.isArray(args)) return;
      try {
        if (typeof api?.[method] !== "function") throw new Error("This feature is unavailable.");
        send({ type: "baymax:rpc-result", id, result: await api[method](...args) });
      } catch (e) {
        send({ type: "baymax:rpc-result", id, error: String(e) });
      }
    });
    for (const event of ["onTrackingUpdate", "onFocusStateChanged", "onAppBlocked", "onAppCloseWarning", "onAppCloseWarningCancelled", "onAppBlockFailedPrivilege", "onFocusDistractionWarning"]) {
      api?.[event]?.((data) => send({ type: "baymax:event", event, data }));
    }
    function syncIframeState() {
    }
    const container = h(
      "div",
      {
        class: "productivity-container",
        style: "width: 100%; height: 100%; padding: 4px 6px 6px; box-sizing: border-box; display: flex; flex-direction: column;"
      },
      iframe
    );
    const el = h("div", { class: "view productivity-view" }, container);
    return {
      el,
      sync() {
        syncIframeState();
      }
    };
  }
  return __toCommonJS(productivity_exports);
})();
