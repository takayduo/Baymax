import {allowed as hasFeature,openPlans} from '../core/account';
// Baymax — Productivity & Focus Workspace View (Distrack Inside Mochi)
import { h } from "./dom";
import { State } from "../core/state";
import { assistantName } from "../core/branding";
import { companionIconDataURL } from "../companion/nativeIcon";
import type { ViewActions, ViewHost } from "./views";

export function buildProductivity(_actions: ViewActions): ViewHost {
  const isFileProto = window.location.protocol === "file:";
  const iframeSrc = window.location.protocol === 'baymax:' ? 'baymax://app/productivity/index.html' : isFileProto
    ? window.location.href.replace(/\/dist\/[^\/]*$/, "/productivity/dist/index.html")
    : "http://localhost:3000";

  const iframe = h("iframe", {
    src: "about:blank",
    class: "productivity-iframe",
    style:
      "width: 100%; height: 100%; border: 0; border-radius: 14px; background: #0A0A0A; display: block; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);",
    sandbox: "allow-scripts",
  }) as HTMLIFrameElement;

  const api = (window as any).electronAPI;
  const allowed = new Set(['getTrackedApps','getDailyTotals','getAppCategories','updateAppCategory','scanRunningApps','scanAllApps','getKnownApps','addCustomApp','getFocusSessions','startFocusSession','stopFocusSession','getFocusActive','getBlocklist','toggleBlockApp','setBlocklist','getSettings','updateSettings','clearData','isOnboarded','setOnboarded','getUserProfile','setUserProfile','setAppHidden','getTrackingHealth']);
  const expectedOrigin = 'null'; // sandboxed frame has an opaque origin
  const targetOrigin = expectedOrigin === 'null' ? '*' : expectedOrigin;
  function send(message: any) { iframe.contentWindow?.postMessage(message, targetOrigin); }
  window.addEventListener('message', async event => {
    if (event.source !== iframe.contentWindow || event.origin !== expectedOrigin) return;
    const { type, id, method, args } = event.data || {};
    if (type !== 'baymax:rpc' || typeof id !== 'string' || !allowed.has(method) || !Array.isArray(args)) return;
    try {
      if (typeof api?.[method] !== 'function') throw new Error('This feature is unavailable.');
      send({ type: 'baymax:rpc-result', id, result: await api[method](...args) });
    } catch (e) { send({ type: 'baymax:rpc-result', id, error: String(e) }); }
  });
  for (const event of ['onTrackingUpdate','onFocusStateChanged','onAppBlocked','onAppCloseWarning','onAppCloseWarningCancelled','onAppBlockFailedPrivilege','onFocusDistractionWarning']) {
    api?.[event]?.((data: any) => send({ type: 'baymax:event', event, data }));
  }
  let sentName = "";
  let sentIcon = "";
  function syncIframeState() {
    const name = assistantName(State.settings.assistantName);
    const icon = companionIconDataURL();
    if (name !== sentName || icon !== sentIcon) {
      send({ type: 'baymax:brand', assistantName: name, companionIcon: icon });
      sentName = name;
      sentIcon = icon;
    }
  }
  iframe.addEventListener('load', () => { sentName = ''; syncIframeState(); });

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
  const locked=h('div',{class:'feature-preview'},h('h2',{text:'A little more focus'}),h('p',{text:'Productivity, Insights and focus tools are included in Pro and Duo.'}),h('button',{class:'btn glass',text:'Upgrade Plan',onclick:()=>openPlans()}));container.append(locked);

  return {
    el,
    sync() {
      const permitted=hasFeature('productivity');
      if(permitted&&iframe.getAttribute('src')!==iframeSrc)iframe.src=iframeSrc;
      if(!permitted&&iframe.getAttribute('src')!=='about:blank')iframe.src='about:blank';
      iframe.style.display=permitted?'block':'none';locked.hidden=permitted;
      syncIframeState();
    },
  };
}
