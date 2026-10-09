const { contextBridge, ipcRenderer } = require('electron');

/**
 * Secure bridge between Electron main process and the Productivity React renderer.
 * Matches 100% of distrack electronAPI.
 */
if (process.isMainFrame) contextBridge.exposeInMainWorld('electronAPI', {
  // -- Tracking --
  getTrackedApps: (timeframe) => ipcRenderer.invoke('get-tracked-apps', timeframe),
  getDailyTotals: () => ipcRenderer.invoke('get-daily-totals'),
  onTrackingUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('tracking-update', handler);
    return () => ipcRenderer.removeListener('tracking-update', handler);
  },

  // -- App categories --
  getAppCategories: () => ipcRenderer.invoke('get-app-categories'),
  updateAppCategory: (processName, category) => ipcRenderer.invoke('update-app-category', processName, category),

  // -- Scan running apps & all installed apps --
  scanRunningApps: () => ipcRenderer.invoke('scan-running-apps'),
  scanAllApps: () => ipcRenderer.invoke('scan-all-installed-apps'),
  getTrackingHealth: () => ipcRenderer.invoke("get-tracking-health"),
  setAppHidden: (id, hidden) => ipcRenderer.invoke("set-app-hidden", id, hidden),
  getKnownApps: (includeHidden) => ipcRenderer.invoke('get-known-apps', includeHidden),
  addCustomApp: (appData) => ipcRenderer.invoke('add-custom-app', appData),

  // -- Focus sessions --
  getFocusSessions: () => ipcRenderer.invoke('get-focus-sessions'),
  addFocusSession: (session) => ipcRenderer.invoke('add-focus-session', session),
  setFocusSessions: (sessions) => ipcRenderer.invoke('set-focus-sessions', sessions),
  startFocusSession: (config) => ipcRenderer.invoke('start-focus-session', config),
  stopFocusSession: () => ipcRenderer.invoke('stop-focus-session'),
  getFocusActive: () => ipcRenderer.invoke('get-focus-active'),
  onFocusStateChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('focus-state-changed', handler);
    return () => ipcRenderer.removeListener('focus-state-changed', handler);
  },
  onAppBlocked: (callback) => {
    const handler = (_event, name) => callback(name);
    ipcRenderer.on('app-blocked', handler);
    return () => ipcRenderer.removeListener('app-blocked', handler);
  },
  onAppCloseWarning: (callback) => {
    const handler = (_event, name) => callback(name);
    ipcRenderer.on('app-close-warning', handler);
    return () => ipcRenderer.removeListener('app-close-warning', handler);
  },
  onAppCloseWarningCancelled: (callback) => {
    const handler = (_event, name) => callback(name);
    ipcRenderer.on('app-close-warning-cancelled', handler);
    return () => ipcRenderer.removeListener('app-close-warning-cancelled', handler);
  },
  onAppBlockFailedPrivilege: (callback) => {
    const handler = (_event, name) => callback(name);
    ipcRenderer.on('app-block-failed-privilege', handler);
    return () => ipcRenderer.removeListener('app-block-failed-privilege', handler);
  },

  // -- Blocklist --
  getBlocklist: () => ipcRenderer.invoke('get-blocklist'),
  toggleBlockApp: (appId) => ipcRenderer.invoke('toggle-block-app', appId),
  setBlocklist: (newList) => ipcRenderer.invoke('set-blocklist', newList),

  // -- Settings --
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),

  // -- Data management --
  clearData: () => ipcRenderer.invoke('clear-data'),

  // -- Onboarding --
  isOnboarded: () => ipcRenderer.invoke('is-onboarded'),
  setOnboarded: () => ipcRenderer.invoke('set-onboarded'),

  // -- User Profile --
  getUserProfile: () => ipcRenderer.invoke('get-user-profile'),
  setUserProfile: (profile) => ipcRenderer.invoke('set-user-profile', profile),
  googleSignIn: () => ipcRenderer.invoke('google-sign-in'),
  sendOTPEmail: (email, otpCode) => ipcRenderer.invoke('send-otp-email', email, otpCode),

  // -- Process control --
  killProcess: (processName) => ipcRenderer.invoke('kill-process', processName),
});
