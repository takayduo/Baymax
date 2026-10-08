const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === "function") {
        return webUtils.getPathForFile(file);
      }
    } catch (e) {
      console.warn("getPathForFile error:", e);
    }
    return file.path || "";
  },
  boot: () => ipcRenderer.invoke("boot"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  setCollapsed: (collapsed) => ipcRenderer.invoke("set-collapsed", collapsed),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.invoke("set-ignore-mouse-events", ignore, options),
  setIslandRect: (rect) => ipcRenderer.invoke("set-island-rect", rect),
  focusWindow: (focused) => ipcRenderer.invoke("focus-window", focused),
  reposition: () => ipcRenderer.invoke("reposition"),
  openUrl: (url) => ipcRenderer.invoke("open-url", url),
  launchApp: (nameOrPath) => ipcRenderer.invoke("launch-app", nameOrPath),
  closeApp: (nameOrPath) => ipcRenderer.invoke("close-app", nameOrPath),
  selectAppFile: () => ipcRenderer.invoke("select-app-file"),
  openSettingsWindow: () => ipcRenderer.invoke("open-settings-window"),
  quit: () => ipcRenderer.invoke("quit"),
  log: (msg) => ipcRenderer.invoke("log", msg),

  // AI & Chat (Mark-LV Live Engine & Groq)
  chatSend: (query, context) => ipcRenderer.invoke("chat-send", { query, context }),
  chatReset: () => ipcRenderer.invoke("chat-reset"),
  transcribeAudio: (audioBase64) => ipcRenderer.invoke("transcribe-audio", audioBase64),
  aiInterrupt: () => ipcRenderer.invoke("ai-interrupt"),
  aiMute: (muted) => ipcRenderer.invoke("ai-mute", muted),
  aiSetVoice: (voice) => ipcRenderer.invoke("ai-set-voice", voice),

  // Files & Drive
  ingestFile: (path) => ipcRenderer.invoke("ingest-file", path),
  downloadDriveFile: (fileInfo) => ipcRenderer.invoke("download-drive-file", fileInfo),
  openPath: (path) => ipcRenderer.invoke("open-path", path),
  testDriveConnection: () => ipcRenderer.invoke("test-drive-connection"),
  selectServiceAccount: () => ipcRenderer.invoke("select-service-account"),
  getServiceAccountStatus: () => ipcRenderer.invoke("get-service-account-status"),
  googleOAuthStart: (creds) => ipcRenderer.invoke("google-oauth-start", creds),
  googleOAuthDisconnect: () => ipcRenderer.invoke("google-oauth-disconnect"),
  googleOAuthStatus: () => ipcRenderer.invoke("google-oauth-status"),
  selectOAuthClient: () => ipcRenderer.invoke("select-oauth-client"),

  // Schedule / Content Calendar
  getSchedule: () => ipcRenderer.invoke("get-schedule"),
  saveScheduleItem: (item) => ipcRenderer.invoke("save-schedule-item", item),
  deleteScheduleItem: (id) => ipcRenderer.invoke("delete-schedule-item", id),
  toggleScheduleItem: (id) => ipcRenderer.invoke("toggle-schedule-item", id),

  // Secrets & API Keys
  secretSet: (key, val) => ipcRenderer.invoke("secret-set", { key, val }),
  secretGet: (key) => ipcRenderer.invoke("secret-get", key),
  secretClear: (key) => ipcRenderer.invoke("secret-clear", key),

  testSupabase: (creds) => ipcRenderer.invoke("test-supabase", creds),
  checkSupabaseCloudStatus: (creds) => ipcRenderer.invoke("check-supabase-cloud-status", creds),
  getSupabaseSqlSetup: () => ipcRenderer.invoke("get-supabase-sql-setup"),

  // Live Partner Chat
  getChatMessages: () => ipcRenderer.invoke("get-chat-messages"),
  sendChatMessage: (arg1, arg2) => {
    const text = typeof arg1 === "string" ? arg1 : (arg1?.text || "");
    const isAiGenerated = typeof arg1 === "object" ? !!arg1.isAiGenerated : !!arg2;
    return ipcRenderer.invoke("send-chat-message", { text, isAiGenerated });
  },
  markChatRead: () => ipcRenderer.invoke("mark-chat-read"),

  // Remote Access (Mochi Eye Co-Pilot)
  requestRemoteAccess: () => ipcRenderer.invoke("request-remote-access"),
  respondRemoteAccess: (accepted, extra) => ipcRenderer.invoke("respond-remote-access", accepted, extra),
  sendRemoteSignal: (signal) => ipcRenderer.invoke("send-remote-signal", signal),
  endRemoteAccess: () => ipcRenderer.invoke("end-remote-access"),
  getAvailableScreens: () => ipcRenderer.invoke("get-available-screens"),
  getPrimaryScreenSource: () => ipcRenderer.invoke("get-primary-screen-source"),
  injectInput: (cmd) => ipcRenderer.invoke("inject-remote-input", cmd),
  injectInputFast: (cmd) => ipcRenderer.send("inject-remote-input-fast", cmd),

  // GitHub 1-Click Auto-Updater
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  performUpdate: () => ipcRenderer.invoke("perform-update"),

  // Mark-LV PC Control Engine & Hardware Bridge
  markLvListActions: () => ipcRenderer.invoke("marklv-list-actions"),
  markLvListDevices: () => ipcRenderer.invoke("marklv-list-devices"),
  markLvListMemory: () => ipcRenderer.invoke("marklv-list-memory"),
  markLvSaveMemory: (category, key, value) => ipcRenderer.invoke("marklv-save-memory", { category, key, value }),
  markLvDeleteMemory: (category, key) => ipcRenderer.invoke("marklv-delete-memory", { category, key }),
  markLvExecuteAction: (name, parameters) => ipcRenderer.invoke("marklv-execute-action", { name, parameters }),
  markLvLaunchHud: () => ipcRenderer.invoke("marklv-launch-hud"),

  // Productivity & Focus Engine (Distrack inside Baymax)
  openProductivityWindow: () => ipcRenderer.invoke("open-productivity-window"),
  getTrackedApps: (timeframe) => ipcRenderer.invoke("get-tracked-apps", timeframe),
  getDailyTotals: () => ipcRenderer.invoke("get-daily-totals"),
  getAppCategories: () => ipcRenderer.invoke("get-app-categories"),
  updateAppCategory: (data) => ipcRenderer.invoke("update-app-category", data),
  scanRunningApps: () => ipcRenderer.invoke("scan-running-apps"),
  getFocusSessions: () => ipcRenderer.invoke("get-focus-sessions"),
  addFocusSession: (session) => ipcRenderer.invoke("add-focus-session", session),
  setFocusSessions: (sessions) => ipcRenderer.invoke("set-focus-sessions", sessions),
  startFocusSession: (config) => ipcRenderer.invoke("start-focus-session", config),
  stopFocusSession: () => ipcRenderer.invoke("stop-focus-session"),
  getFocusActive: () => ipcRenderer.invoke("get-focus-active"),
  getBlocklist: () => ipcRenderer.invoke("get-blocklist"),
  toggleBlockApp: (id) => ipcRenderer.invoke("toggle-block-app", id),
  setBlocklist: (list) => ipcRenderer.invoke("set-blocklist", list),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  updateSettings: (settings) => ipcRenderer.invoke("update-settings", settings),
  clearData: () => ipcRenderer.invoke("clear-data"),
  isOnboarded: () => ipcRenderer.invoke("is-onboarded"),
  setOnboarded: () => ipcRenderer.invoke("set-onboarded"),
  getUserProfile: () => ipcRenderer.invoke("get-user-profile"),
  setUserProfile: (profile) => ipcRenderer.invoke("set-user-profile", profile),
  killProcess: (processName) => ipcRenderer.invoke("kill-process", processName),
  googleSignIn: () => ipcRenderer.invoke("google-sign-in"),
  sendOtpEmail: (email) => ipcRenderer.invoke("send-otp-email", email),
  getProductivityStats: (timeframe) => ipcRenderer.invoke("get-tracked-apps", timeframe),
  getProductivityDailyTotals: () => ipcRenderer.invoke("get-daily-totals"),
  onTrackingUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("tracking-update", handler);
    return () => ipcRenderer.removeListener("tracking-update", handler);
  },
  onFocusDistractionWarning: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("productivity-distraction-warning", handler);
    return () => ipcRenderer.removeListener("productivity-distraction-warning", handler);
  },
  onAppCloseWarning: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("app-close-warning", handler);
    return () => ipcRenderer.removeListener("app-close-warning", handler);
  },
  onAppBlocked: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("app-blocked", handler);
    return () => ipcRenderer.removeListener("app-blocked", handler);
  },

  // Events from Main Process
  on: (channel, callback) => {
    const validChannels = [
      "cursor",
      "tray",
      "settings-changed",
      "schedule-updated",
      "file-received",
      "incoming-file",
      "partner-presence",
      "partner-chat-received",
      "open-couple-chat",
      "screen-changed",
      "mouse-enter",
      "mouse-leave",
      "remote-access-requested",
      "remote-access-accepted",
      "remote-access-declined",
      "remote-access-ended",
      "host-signal",
      "update-progress",
      "update-available",
      "ai-state",
      "ai-transcript",
      "ai-audio-level",
      "ai-content",
      "ai-confirm",
      "productivity-distraction-warning",
      "tracking-update",
      "app-close-warning",
      "app-blocked",
    ];
    if (validChannels.includes(channel)) {
      const handler = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
});
