// The embedded page gets only the Productivity RPC surface. It never receives
// the parent's general Electron API, credentials, filesystem or remote input.
import { assistantName, setAssistantName } from './branding';
const methods = ['getTrackedApps','getDailyTotals','getAppCategories','updateAppCategory','scanRunningApps','scanAllApps','getKnownApps','addCustomApp','getFocusSessions','startFocusSession','stopFocusSession','getFocusActive','getBlocklist','toggleBlockApp','setBlocklist','getSettings','updateSettings','clearData','isOnboarded','setOnboarded','getUserProfile','setUserProfile','setAppHidden','getTrackingHealth'];
const events = ['onTrackingUpdate','onFocusStateChanged','onAppBlocked','onAppCloseWarning','onAppCloseWarningCancelled','onAppBlockFailedPrivilege','onFocusDistractionWarning'];
if (!window.electronAPI && window.parent !== window) {
  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: number }>();
  const listeners = new Map<string, Set<(v: any) => void>>();
  const api: Record<string, any> = {};
  const parentOrigin = new URL(document.referrer || window.location.href).origin;
  const target = parentOrigin === 'null' ? '*' : parentOrigin;
  for (const method of methods) api[method] = (...args: any[]) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = window.setTimeout(() => { pending.delete(id); reject(new Error(`${assistantName()} did not respond. Please reopen Productivity.`)); }, 65000);
    pending.set(id, { resolve, reject, timer });
    window.parent.postMessage({ type: 'baymax:rpc', id, method, args }, target);
  });
  for (const event of events) api[event] = (callback: (v: any) => void) => {
    const set = listeners.get(event) || new Set(); set.add(callback); listeners.set(event, set);
    return () => set.delete(callback);
  };
  window.addEventListener('message', e => {
    if (e.source !== window.parent || e.origin !== parentOrigin) return;
    const data = e.data;
    if (data?.type === 'baymax:brand') { setAssistantName(data.assistantName); return; }
    if (data?.type === 'baymax:rpc-result') {
      const p = pending.get(data.id); if (!p) return;
      clearTimeout(p.timer); pending.delete(data.id);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
    } else if (data?.type === 'baymax:event') for (const fn of listeners.get(data.event) || []) fn(data.data);
  });
  (window as any).electronAPI = api;
}
