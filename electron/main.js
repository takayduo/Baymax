const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell, dialog, Notification, session, desktopCapturer } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn, exec } = require("node:child_process");
const {
  getAccessToken,
  uploadFileToDrive,
  downloadFileFromDrive,
  startGoogleOAuthFlow,
  refreshOAuthAccessToken,
  uploadFileWithToken,
} = require("./gdrive");
const {
  SUPABASE_SQL_SETUP,
  testSupabaseConnection,
  checkCloudStorageReady,
  initSupabase,
  disconnectSupabase,
  broadcastFileShared,
  broadcastScheduleUpdate,
  broadcastChatMessage,
  broadcastRemoteAccess,
  broadcastSyncRequest,
  broadcastSyncResponse,
  saveChatMessageToCloud,
  fetchOfflineChatMessages,
  saveTaskToCloud,
  saveAllTasksToCloud,
  deleteTaskFromCloud,
  fetchOfflineTasks,
} = require("./supabase");

const {
  startInputInjector,
  injectInput,
  stopInputInjector,
  getAvailableScreens,
  getPrimaryScreenSource,
  setHostDisplayBounds,
  createRemoteViewerWindow,
  getRemoteViewerWindow,
  getViewerInitData,
  closeRemoteViewerWindow,
} = require("./remoteAccess");
const { checkForUpdates, performUpdate, getLocalVersionInfo } = require("./updater");
const { Store, STORE_DEFAULTS } = require("./productivity/store");
const {
  AppTracker,
  WINDOW_SCANNER_SCRIPT,
  SYSTEM_IGNORED_PROCS,
  DEFAULT_CATEGORIES,
  ICON_MAP,
  getLocalDateKey,
} = require("./productivity/tracker");
const { AppBlocker, isProtectedProcess } = require("./productivity/blocker");

// Enable Windows Graphics Capture (WGC) for reliable capture across hybrid/multi-GPU systems
app.commandLine.appendSwitch("enable-features", "WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer");

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let overlayWin = null;
let settingsWin = null;
let productivityWin = null;
let tray = null;
let isQuitting = false;
let productivityStore = null;
let productivityTracker = null;
let productivityBlocker = null;

app.on("second-instance", () => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    isCollapsed = false;
    overlayWin.show();
    overlayWin.focus();
    overlayWin.webContents.send("tray", "open");
  } else {
    createOverlayWindow();
  }
});

// Store paths
const userDataDir = path.join(app.getPath("userData"), "CoucouCreator");
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}
const settingsPath = path.join(userDataDir, "settings.json");
const schedulePath = path.join(userDataDir, "schedule.json");
const serviceAccountPath = path.join(userDataDir, "service-account.json");

function loadServiceAccount() {
  try {
    if (fs.existsSync(serviceAccountPath)) {
      return JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
    }
  } catch (err) {
    console.warn("Failed to read service-account.json:", err);
  }
  return null;
}

// Default settings
const DEFAULT_SETTINGS = {
  soundEnabled: true,
  soundVolume: 0.14,
  autoCloseInterval: 15,
  absenceInterval: 60,
  activeIntegrations: [],
  screen: "primary",
  autostart: false,
  aiProvider: "gemini", // "gemini" | "openrouter" | "groq"
  geminiApiKey: "",
  openrouterApiKey: "",
  groqApiKey: "",
  geminiModel: "gemini-2.5-flash",
  openrouterModel: "meta-llama/llama-3.3-70b-instruct:free",
  groqModel: "openai/gpt-oss-120b",
  micEnabled: true,
  userName: "Badsha",
  partnerName: "Ayzil",
  userRole: "me", // "me" | "her"
  gdriveApiKey: "",
  gdriveFolderId: "",
  gdriveUploadUrl: "",
  shareChannel: "coucou-badsha-ayzil",
  syncUrl: "https://brxmmguaybfozzyrditx.supabase.co/",
  syncApiKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyeG1tZ3VheWJmb3p6eXJkaXR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NDQzNTksImV4cCI6MjEwNjUyMDM1OX0.JW8GbyVOSoUfjHvNVCcPpSGsAf9Qq-BCtGP2RRRIboM",
  appPaths: {
    discord: "C:\\Users\\" + (process.env.USERNAME || "User") + "\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe",
    whatsapp: "explorer.exe shell:AppsFolder\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App",
    obs: "C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe",
    premiere: "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2024\\Adobe Premiere Pro.exe",
    notepad: "notepad",
  },
  // Mark-LV PC Control & Agent Engine Defaults
  assistantName: "Baymax",
  voiceName: "Charon",
  wakeWordEnabled: false,
  pushToTalkEnabled: false,
  proactiveAudio: true,
  thinkingEnabled: false,
  mediaResolution: "medium",
  morningBriefEnabled: true,
  turnSilenceMs: 550,
  turnPrefixMs: 150,
  turnEndSensitivity: "high",
  hudStyle: "face",
  audioInputDevice: "",
  audioOutputDevice: "",
  activeActions: {
    productivity_manager: true,
    computer_control: true,
    browser_control: true,
    open_app: true,
    close_app: true,
    desktop_control: true,
    computer_settings: true,
    file_controller: true,
    file_processor: true,
    screen_processor: true,
    system_monitor: true,
    web_search: true,
    youtube_video: true,
    code_helper: true,
    dev_agent: true,
    reminder: true,
    weather_report: true,
    send_message: true,
  },
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath, "utf-8")) };
      if (!loaded.syncUrl || !loaded.syncUrl.trim()) {
        loaded.syncUrl = DEFAULT_SETTINGS.syncUrl;
      }
      if (!loaded.syncApiKey || !loaded.syncApiKey.trim()) {
        loaded.syncApiKey = DEFAULT_SETTINGS.syncApiKey;
      }
      if (!loaded.shareChannel || !loaded.shareChannel.trim()) {
        loaded.shareChannel = DEFAULT_SETTINGS.shareChannel;
      }
      if (!loaded.userName || loaded.userName === "Me") {
        loaded.userName = "Badsha";
      }
      if (!loaded.partnerName || loaded.partnerName === "Her") {
        loaded.partnerName = "Ayzil";
      }
      if (loaded.geminiModel === "gemini-3.8-flash" || loaded.geminiModel === "gemini-2.0-flash") {
        loaded.geminiModel = "gemini-2.5-flash";
      }
      if (loaded.groqModel === "llama-3.3-70b-versatile" || loaded.groqModel === "llama-3.1-8b-instant") {
        loaded.groqModel = "openai/gpt-oss-120b";
      }
      return loaded;
    }
  } catch (err) {
    console.error("Failed to read settings:", err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}

const startupFolderPath = path.join(
  process.env.APPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Roaming") : "C:\\Users\\Administrator\\AppData\\Roaming"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup"
);
const startupShortcutPath = path.join(startupFolderPath, "Mochi.lnk");

function applyStartupMode(enabled) {
  try {
    const isPackaged = app.isPackaged;
    const appDir = path.resolve(__dirname, "..");
    const execPath = process.execPath;
    const args = isPackaged ? [] : [appDir];

    // 1. Electron official API (Windows Registry Run key)
    try {
      app.setLoginItemSettings({
        openAtLogin: !!enabled,
        path: execPath,
        args: args,
        name: "CoucouCreator",
      });
    } catch (e) {
      console.warn("[Startup Mode] app.setLoginItemSettings warning:", e);
    }

    // 2. Windows Startup Folder .lnk Shortcut (native GUI, zero .vbs)
    try {
      if (!fs.existsSync(startupFolderPath)) {
        fs.mkdirSync(startupFolderPath, { recursive: true });
      }

      // Cleanup legacy .vbs if present
      const legacyVbs = path.join(startupFolderPath, "CoucouCreator.vbs");
      if (fs.existsSync(legacyVbs)) {
        try { fs.unlinkSync(legacyVbs); } catch {}
      }

      if (enabled) {
        const psScript = `
          $wsh = New-Object -ComObject WScript.Shell;
          $s = $wsh.CreateShortcut('${startupShortcutPath.replace(/'/g, "''")}');
          $s.TargetPath = '${execPath.replace(/'/g, "''")}';
          $s.Arguments = '${(isPackaged ? "" : appDir).replace(/'/g, "''")}';
          $s.WorkingDirectory = '${appDir.replace(/'/g, "''")}';
          $icon = '${path.join(appDir, "public", "icons", "icon.ico").replace(/'/g, "''")}';
          if (Test-Path $icon) { $s.IconLocation = "$icon,0" };
          $s.Save();
        `;
        exec(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, " ")}"`, (psErr) => {
          if (!psErr) {
            console.log(`[Startup Mode] Created startup shortcut at: ${startupShortcutPath}`);
          }
        });
      } else {
        if (fs.existsSync(startupShortcutPath)) {
          fs.unlinkSync(startupShortcutPath);
          console.log(`[Startup Mode] Removed startup shortcut from: ${startupShortcutPath}`);
        }
      }
    } catch (fsErr) {
      console.warn("[Startup Mode] Startup folder shortcut error:", fsErr);
    }

    console.log(`[Startup Mode] Windows auto-start set to: ${!!enabled}`);
  } catch (err) {
    console.warn("[Startup Mode] Failed to set auto-start:", err);
  }
}

function loadSchedule() {
  try {
    if (fs.existsSync(schedulePath)) {
      return JSON.parse(fs.readFileSync(schedulePath, "utf-8"));
    }
  } catch (err) {
    console.error("Failed to read schedule:", err);
  }
  return [
    {
      id: "demo-1",
      title: "Record main YouTube video",
      time: "11:00 AM",
      assignee: "me",
      assignedBy: "her",
      completed: false,
      createdAt: Date.now(),
    },
    {
      id: "demo-2",
      title: "Review video intro cut & thumbnail",
      time: "03:30 PM",
      assignee: "her",
      assignedBy: "me",
      completed: true,
      createdAt: Date.now(),
    },
    {
      id: "demo-3",
      title: "YouTube Live Stream with community",
      time: "07:00 PM",
      assignee: "me",
      assignedBy: "her",
      completed: false,
      createdAt: Date.now(),
    },
  ];
}

function saveSchedule(items) {
  try {
    fs.writeFileSync(schedulePath, JSON.stringify(items, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save schedule:", err);
  }
}

let activeSettings = loadSettings();
let activeSchedule = loadSchedule();

const chatHistoryPath = path.join(userDataDir, "chat_history.json");

function loadChatHistory() {
  try {
    if (fs.existsSync(chatHistoryPath)) {
      const data = JSON.parse(fs.readFileSync(chatHistoryPath, "utf-8"));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.warn("Failed to load chat history:", err);
  }
  return [];
}

function saveChatHistory(history) {
  try {
    fs.writeFileSync(chatHistoryPath, JSON.stringify(history, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save chat history:", err);
  }
}

const engineDir = path.join(__dirname, "..", "engine");
const bridgeScript = path.join(engineDir, "mochi_bridge.py");
const markLvMainScript = path.join(engineDir, "main.py");

function resolvePythonPath() {
  const pyPathFile = path.join(engineDir, "python_path.txt");
  if (fs.existsSync(pyPathFile)) {
    try {
      const savedPath = fs.readFileSync(pyPathFile, "utf-8").trim();
      if (savedPath && fs.existsSync(savedPath)) {
        return savedPath;
      }
    } catch {}
  }

  const standardPaths = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python311", "python.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python310", "python.exe"),
    "C:\\Program Files\\Python312\\python.exe",
    "C:\\Program Files\\Python311\\python.exe",
    "C:\\Program Files\\Python310\\python.exe",
    "C:\\Program Files (x86)\\Python312\\python.exe",
    "C:\\Program Files (x86)\\Python311\\python.exe",
  ];
  for (const p of standardPaths) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const whichRes = require("node:child_process").execSync("where python.exe", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const lines = whichRes.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.toLowerCase().includes("windowsapps") && fs.existsSync(line)) {
        return line;
      }
    }
  } catch {}

  try {
    const whichPy = require("node:child_process").execSync("where py.exe", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const line = whichPy.split(/\r?\n/)[0]?.trim();
    if (line && fs.existsSync(line)) return line;
  } catch {}

  return "python";
}

function runMochiBridgeCmd(cmd, ...args) {
  return new Promise((resolve) => {
    const procArgs = [bridgeScript, cmd, ...args];
    const pyExe = resolvePythonPath();
    const child = spawn(pyExe, procArgs, {
      cwd: engineDir,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      try {
        const lines = stdout.trim().split("\n");
        const jsonLine = lines.reverse().find((l) => l.trim().startsWith("{") && l.trim().endsWith("}"));
        if (jsonLine) {
          return resolve(JSON.parse(jsonLine));
        }
        resolve({ success: false, error: stderr || stdout || `Process exited with code ${code}` });
      } catch (e) {
        resolve({ success: false, error: e.message, raw: stdout });
      }
    });
    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

function syncMarkLvConfig(settings) {
  try {
    runMochiBridgeCmd("sync-config", JSON.stringify(settings));
  } catch (err) {
    console.warn("Failed to sync Mark-LV config:", err);
  }
}

// Initial Mark-LV config sync on boot
setTimeout(() => {
  syncMarkLvConfig(activeSettings);
}, 1000);

let cachedMarkLvTools = null;

async function getMarkLvToolDeclarations() {
  if (cachedMarkLvTools) return cachedMarkLvTools;
  try {
    const res = await runMochiBridgeCmd("list-actions");
    if (res && res.success && Array.isArray(res.actions)) {
      const enabled = activeSettings.activeActions || {};
      cachedMarkLvTools = res.actions.filter((a) => enabled[a.name] !== false);
      return cachedMarkLvTools;
    }
  } catch (err) {
    console.warn("Error fetching Mark-LV tool declarations:", err);
  }
  return [];
}

async function captureScreenBase64() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });
    if (sources && sources.length > 0) {
      return sources[0].thumbnail.toJPEG(85).toString("base64");
    }
  } catch (err) {
    console.warn("captureScreenBase64 error:", err);
  }
  return null;
}

let activeRemoteRole = null;
let pendingViewerSignals = [];
let lastPartnerOnline = false;
let lastPartnerOnlineNotifyTime = 0;
let partnerOfflineTimer = null;

function triggerPartnerOnlineNotification(partnerName) {
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawPartner = isMe ? (activeSettings.partnerName || "Ayzil") : (activeSettings.userName || "Badsha");
  const displayName = partnerName || (rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1));

  // Cooldown: prevent duplicate notifications within 3 minutes (180s)
  const now = Date.now();
  if (now - lastPartnerOnlineNotifyTime < 180000) {
    return;
  }
  lastPartnerOnlineNotifyTime = now;

  console.log(`[Supabase Sync] Triggering partner online notification for: ${displayName}`);

  // 1. Notify overlay window (Mochi island will play sound and show love emote & note)
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("partner-presence", {
      online: true,
      partnerName: displayName,
      justCameOnline: true,
    });
  }

  // 2. Windows Native Action Center notification
  if (activeSettings.notifyPartnerOnline !== false && Notification.isSupported()) {
    try {
      const notif = new Notification({
        title: `✨ ${displayName} is online! 💖`,
        body: `${displayName} just opened Mochi and joined.`,
        icon: path.join(__dirname, "../assets/icon.png"),
        silent: false,
      });
      notif.on("click", () => {
        if (overlayWin && !overlayWin.isDestroyed()) {
          isCollapsed = false;
          overlayWin.show();
          overlayWin.focus();
          overlayWin.webContents.send("open-couple-chat");
        }
      });
      notif.show();
    } catch (notifErr) {
      console.warn("[Supabase Sync] Partner online notification error:", notifErr);
    }
  }
}

function startSupabaseSync() {
  if (!activeSettings.syncUrl || !activeSettings.syncApiKey) {
    console.log("[Supabase Sync] syncUrl or syncApiKey not configured yet.");
    disconnectSupabase();
    return;
  }

  const isMe = (activeSettings.userRole || "me") === "me";
  const rawMe = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
  const rawPartner = isMe ? (activeSettings.partnerName || "Ayzil") : (activeSettings.userName || "Badsha");
  const currentUserName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);
  const partnerUserName = rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1);
  const partnerRole = isMe ? "her" : "me";

  console.log(`[Supabase Sync] Initializing live Realtime connection for ${currentUserName}...`);
  initSupabase({
    url: activeSettings.syncUrl,
    key: activeSettings.syncApiKey,
    channelName: activeSettings.shareChannel || "coucou-badsha-ayzil",
    userName: currentUserName,
    userRole: activeSettings.userRole || "me",
    onChatMessage: (payload) => {
      console.log("[Supabase Sync] Incoming chat message:", payload?.text);
      if (!payload || !payload.text) return;

      // Ignore messages sent by self (by name or by senderRole)
      const myLower = currentUserName.toLowerCase();
      const senderLower = (payload.sender || "").toLowerCase();
      if (senderLower === myLower || (payload.senderRole && payload.senderRole === (activeSettings.userRole || "me"))) {
        return;
      }

      if (!payload.id) {
        payload.id = "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      }
      if (!payload.timestamp) {
        payload.timestamp = Date.now();
      }

      const history = loadChatHistory();
      const exists = history.some((m) => m.id === payload.id);
      if (!exists) {
        history.push({
          ...payload,
          read: false,
        });
        saveChatHistory(history);
      }

      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send("partner-chat-received", payload);
      }

      // Windows Action Center native notification if collapsed or app unfocused
      const isUnfocused = !overlayWin || overlayWin.isDestroyed() || !overlayWin.isFocused();
      if ((isCollapsed || isUnfocused) && Notification.isSupported()) {
        try {
          const sender = payload.sender || partnerUserName;
          const notif = new Notification({
            title: `💬 ${sender}`,
            body: payload.text,
            icon: path.join(__dirname, "../assets/icon.png"),
            silent: false,
          });
          notif.on("click", () => {
            if (overlayWin && !overlayWin.isDestroyed()) {
              isCollapsed = false;
              overlayWin.show();
              overlayWin.focus();
              overlayWin.webContents.send("open-couple-chat");
            }
          });
          notif.show();
        } catch (notifErr) {
          console.warn("[Supabase Sync] Chat Windows notification error:", notifErr);
        }
      }
    },
    onFileShared: (payload) => {
      console.log("[Supabase Sync] Incoming file event:", payload?.name);
      if (!payload || !payload.name) return;

      // Send to overlay UI
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send("incoming-file", payload);
      }

      // Windows Action Center native notification
      if (Notification.isSupported()) {
        try {
          const sender = payload.senderName || partnerUserName;
          const sizeMb = payload.size ? (payload.size / (1024 * 1024)).toFixed(2) : "0";
          const notif = new Notification({
            title: `💌 New file from ${sender}!`,
            body: `${payload.name} (${sizeMb} MB)\nClick to open in Mochi`,
            icon: path.join(__dirname, "../assets/icon.png"),
            silent: false,
          });
          notif.on("click", () => {
            if (overlayWin && !overlayWin.isDestroyed()) {
              overlayWin.show();
              overlayWin.focus();
            }
          });
          notif.show();
        } catch (notifErr) {
          console.warn("[Supabase Sync] Windows notification error:", notifErr);
        }
      }
    },
    onScheduleUpdated: (payload) => {
      if (payload && Array.isArray(payload.items)) {
        console.log("[Supabase Sync] Real-time task update from:", payload.senderName);
        activeSchedule = payload.items;
        saveSchedule(activeSchedule);
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("schedule-updated", activeSchedule);
        }
      }
    },
    onPresenceSync: (presenceState) => {
      const myName = currentUserName.toLowerCase();
      const partnerName = partnerUserName.toLowerCase();
      let partnerOnline = false;

      for (const key of Object.keys(presenceState)) {
        const presList = presenceState[key] || [];
        for (const p of presList) {
          const pUser = (p.user || "").toLowerCase();
          if (p.role === partnerRole || pUser === partnerName || (pUser && pUser !== myName)) {
            partnerOnline = true;
            break;
          }
        }
        if (partnerOnline) break;
      }

      console.log(`[Supabase Sync] Partner online status: ${partnerOnline}`);
      if (partnerOnline) {
        if (partnerOfflineTimer) {
          clearTimeout(partnerOfflineTimer);
          partnerOfflineTimer = null;
        }
        if (!lastPartnerOnline) {
          lastPartnerOnline = true;
          triggerPartnerOnlineNotification(partnerUserName);
        } else if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("partner-presence", { online: true, partnerName: partnerUserName, justCameOnline: false });
        }

        // Partner is online — request catch-up sync in case messages were sent while asleep
        const history = loadChatHistory();
        const lastChatTime = history.length > 0 ? history[history.length - 1].timestamp : 0;
        broadcastSyncRequest({
          lastChatTimestamp: lastChatTime,
          senderName: currentUserName,
        });
      } else {
        // Grace period: Wait 45s before considering partner truly offline to avoid fluttering
        if (!partnerOfflineTimer && lastPartnerOnline) {
          partnerOfflineTimer = setTimeout(() => {
            partnerOfflineTimer = null;
            lastPartnerOnline = false;
            console.log("[Supabase Sync] Partner marked offline after grace period.");
            if (overlayWin && !overlayWin.isDestroyed()) {
              overlayWin.webContents.send("partner-presence", { online: false, partnerName: partnerUserName, justCameOnline: false });
            }
          }, 45000);
        }
      }
    },
    onSyncRequest: (payload) => {
      console.log("[Supabase Sync] Partner requested peer catch-up sync:", payload?.senderName);
      const history = loadChatHistory();
      const since = payload?.lastChatTimestamp || 0;
      const missedMessages = history.filter((m) => (m.timestamp || 0) > since);
      broadcastSyncResponse({
        messages: missedMessages,
        schedule: activeSchedule,
        senderName: currentUserName,
      });
    },
    onSyncResponse: (payload) => {
      if (!payload) return;
      console.log("[Supabase Sync] Received catch-up response from partner:", payload?.senderName);
      if (Array.isArray(payload.messages) && payload.messages.length > 0) {
        const history = loadChatHistory();
        const existingIds = new Set(history.map((m) => m.id));
        let added = 0;
        let lastMsg = null;
        for (const m of payload.messages) {
          if (!existingIds.has(m.id)) {
            const isFromPartner = (m.sender || "").toLowerCase() !== currentUserName.toLowerCase();
            history.push({ ...m, read: !isFromPartner });
            existingIds.add(m.id);
            if (isFromPartner) {
              added++;
              lastMsg = m;
            }
          }
        }
        if (added > 0) {
          saveChatHistory(history);
          if (overlayWin && !overlayWin.isDestroyed() && lastMsg) {
            overlayWin.webContents.send("partner-chat-received", lastMsg);
          }
          if (Notification.isSupported() && lastMsg) {
            try {
              const notif = new Notification({
                title: `💬 ${lastMsg.sender} (${added} missed message${added > 1 ? "s" : ""})`,
                body: lastMsg.text,
                icon: path.join(__dirname, "../assets/icon.png"),
                silent: false,
              });
              notif.show();
            } catch (e) {}
          }
        }
      }

      if (Array.isArray(payload.schedule) && payload.schedule.length > 0) {
        const taskMap = new Map();
        for (const t of activeSchedule) taskMap.set(t.id, t);
        for (const t of payload.schedule) {
          if (!taskMap.has(t.id)) taskMap.set(t.id, t);
        }
        activeSchedule = Array.from(taskMap.values());
        saveSchedule(activeSchedule);
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("schedule-updated", activeSchedule);
        }
      }
    },
    onPartnerJoin: (payload) => {
      const myName = currentUserName.toLowerCase();
      const senderName = (payload?.senderName || "").toLowerCase();
      if (senderName && senderName !== myName) {
        console.log(`[Supabase Sync] Received partner_join announcement from: ${payload?.senderName}`);
        if (!lastPartnerOnline) {
          lastPartnerOnline = true;
          triggerPartnerOnlineNotification(payload?.senderName || partnerUserName);
        }
      }
    },
    onRemoteAccess: (payload) => {
      console.log("[Supabase Sync] Incoming remote_access:", payload?.action, "from:", payload?.sender);
      if (!payload || !payload.action) return;

      const action = payload.action;

      if (action === "request") {
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("remote-access-requested", payload);
        }
      } else if (action === "response") {
        if (payload.accepted) {
          activeRemoteRole = "viewer";
          if (overlayWin && !overlayWin.isDestroyed()) {
            overlayWin.webContents.send("remote-access-accepted", payload);
          }
          createRemoteViewerWindow({
            partnerName: payload.sender || partnerUserName,
            remoteResolution: payload.resolution || { width: 1920, height: 1080 },
            initialOffer: payload.offer || null,
            onViewerReady: (viewer) => {
              if (viewer && !viewer.isDestroyed()) {
                viewer.webContents.send("viewer-partner-info", {
                  partnerName: payload.sender || partnerUserName,
                  remoteResolution: payload.resolution || { width: 1920, height: 1080 },
                  initialOffer: payload.offer || null,
                });
                if (pendingViewerSignals.length > 0) {
                  for (const sig of pendingViewerSignals) {
                    viewer.webContents.send("viewer-signal", sig);
                  }
                  pendingViewerSignals = [];
                }
              }
            },
            onViewerClosed: () => {
              activeRemoteRole = null;
              pendingViewerSignals = [];
              broadcastRemoteAccess({ action: "end", sender: currentUserName });
              if (overlayWin && !overlayWin.isDestroyed()) {
                overlayWin.webContents.send("remote-access-ended");
              }
            },
          });
        } else {
          activeRemoteRole = null;
          pendingViewerSignals = [];
          if (overlayWin && !overlayWin.isDestroyed()) {
            overlayWin.webContents.send("remote-access-declined", payload);
          }
        }
      } else if (action === "signal") {
        const viewer = getRemoteViewerWindow();
        if (viewer && viewer.webContents && !viewer.webContents.isLoading()) {
          viewer.webContents.send("viewer-signal", payload.signal);
        } else if (activeRemoteRole === "viewer") {
          pendingViewerSignals.push(payload.signal);
        } else if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("host-signal", payload.signal);
        }
      } else if (action === "input") {
        if (payload.cmd) {
          injectInput(payload.cmd);
        }
      } else if (action === "end") {
        activeRemoteRole = null;
        pendingViewerSignals = [];
        closeRemoteViewerWindow();
        stopInputInjector();
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("remote-access-ended");
        }
      }
    },
  });

  // ── Automatic 24/7 Offline Catch-Up on Boot / Reconnect ────────────────────
  const channel = activeSettings.shareChannel || "coucou-badsha-ayzil";
  setTimeout(async () => {
    try {
      // 1. Cloud Database Catch-up (pull messages and tasks stored while PC was offline)
      const cloudReady = await checkCloudStorageReady();
      if (cloudReady.ready) {
        console.log("[Supabase Cloud DB] Cloud tables active. Fetching offline messages & tasks...");
        const cloudMessages = await fetchOfflineChatMessages(channel);
        if (Array.isArray(cloudMessages) && cloudMessages.length > 0) {
          const history = loadChatHistory();
          const existingIds = new Set(history.map((m) => m.id));
          let newCount = 0;
          let latestNewMsg = null;

          for (const msg of cloudMessages) {
            if (!existingIds.has(msg.id)) {
              const isFromPartner = (msg.sender || "").toLowerCase() !== currentUserName.toLowerCase() &&
                                    (!msg.senderRole || msg.senderRole !== (activeSettings.userRole || "me"));
              history.push({
                ...msg,
                read: !isFromPartner ? true : false,
              });
              existingIds.add(msg.id);
              if (isFromPartner) {
                newCount++;
                latestNewMsg = msg;
              }
            }
          }

          if (newCount > 0) {
            console.log(`[Supabase Cloud DB] Restored ${newCount} offline chat message(s)!`);
            saveChatHistory(history);
            if (overlayWin && !overlayWin.isDestroyed() && latestNewMsg) {
              overlayWin.webContents.send("partner-chat-received", latestNewMsg);
            }
            if (Notification.isSupported() && latestNewMsg) {
              try {
                const notif = new Notification({
                  title: `💬 ${latestNewMsg.sender} (${newCount} new message${newCount > 1 ? "s" : ""})`,
                  body: latestNewMsg.text,
                  icon: path.join(__dirname, "../assets/icon.png"),
                  silent: false,
                });
                notif.on("click", () => {
                  if (overlayWin && !overlayWin.isDestroyed()) {
                    isCollapsed = false;
                    overlayWin.show();
                    overlayWin.focus();
                    overlayWin.webContents.send("open-couple-chat");
                  }
                });
                notif.show();
              } catch (err) {}
            }
          }
        }

        // Catch-up tasks from cloud
        const cloudTasks = await fetchOfflineTasks(channel);
        if (Array.isArray(cloudTasks) && cloudTasks.length > 0) {
          console.log(`[Supabase Cloud DB] Syncing ${cloudTasks.length} task(s) from cloud...`);
          const taskMap = new Map();
          for (const t of activeSchedule) {
            taskMap.set(t.id, t);
          }
          for (const ct of cloudTasks) {
            const local = taskMap.get(ct.id);
            if (!local || (ct.updatedAt && ct.updatedAt > (local.updatedAt || local.createdAt || 0))) {
              taskMap.set(ct.id, ct);
            }
          }
          activeSchedule = Array.from(taskMap.values());
          saveSchedule(activeSchedule);
          if (overlayWin && !overlayWin.isDestroyed()) {
            overlayWin.webContents.send("schedule-updated", activeSchedule);
          }
        }
      }

      // 2. Peer Catch-Up: Broadcast sync_request to partner
      const history = loadChatHistory();
      const lastChatTime = history.length > 0 ? history[history.length - 1].timestamp : 0;
      await broadcastSyncRequest({
        lastChatTimestamp: lastChatTime,
        senderName: currentUserName,
      });
    } catch (catchErr) {
      console.warn("[Supabase Sync] Catch-up error:", catchErr);
    }
  }, 1000);
}

// Mouse tracking and click-through
let isCollapsed = true;
let currentIslandRect = { x: 240, y: 0, w: 240, h: 40 };
let isMouseInsideIsland = false;
let mouseCheckTimer = null;

function startMouseTracking() {
  if (mouseCheckTimer) clearInterval(mouseCheckTimer);
  mouseCheckTimer = setInterval(() => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    try {
      const cursor = screen.getCursorScreenPoint();
      const winBounds = overlayWin.getBounds();
      const rect = currentIslandRect || { x: 240, y: 0, w: 240, h: 40 };

      // Island exact coordinates in screen space
      const islandLeft = winBounds.x + rect.x - 6;
      const islandRight = winBounds.x + rect.x + rect.w + 6;
      const islandTop = winBounds.y;
      const islandBottom = winBounds.y + Math.max(38, (rect.h || 40) + 8);

      const inside =
        cursor.x >= islandLeft &&
        cursor.x <= islandRight &&
        cursor.y >= islandTop &&
        cursor.y <= islandBottom;

      if (inside !== isMouseInsideIsland) {
        isMouseInsideIsland = inside;
        if (inside) {
          overlayWin.setIgnoreMouseEvents(false);
          overlayWin.webContents.send("mouse-enter");
        } else {
          overlayWin.setIgnoreMouseEvents(true, { forward: true });
          overlayWin.webContents.send("mouse-leave");
        }
      }
    } catch (e) {}
  }, 25);
}

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  const panelWidth = 1040;
  const panelHeight = 640;
  const x = Math.round((screenWidth - panelWidth) / 2);
  const y = 0;

  overlayWin = new BrowserWindow({
    width: panelWidth,
    height: panelHeight,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const isDev = process.env.NODE_ENV === "development";
  const distIndex = path.join(__dirname, "..", "dist", "index.html");

  if (isDev) {
    overlayWin.loadURL("http://localhost:1420");
  } else if (fs.existsSync(distIndex)) {
    overlayWin.loadFile(distIndex);
  } else {
    // If not built yet, fallback to dev URL or wait
    overlayWin.loadURL("http://localhost:1420");
  }

  // Pass mouse clicks through outside the island pill to desktop & background apps
  overlayWin.setIgnoreMouseEvents(true);
  startMouseTracking();

  overlayWin.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[Renderer] [${level}] ${message} (${sourceId}:${line})`);
  });

  overlayWin.on("closed", () => {
    if (mouseCheckTimer) {
      clearInterval(mouseCheckTimer);
      mouseCheckTimer = null;
    }
    overlayWin = null;
  });
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const winW = 680;
  const winH = Math.min(760, screenHeight - 60);
  const winX = Math.round((screenWidth - winW) / 2);
  const winY = 60;

  settingsWin = new BrowserWindow({
    width: winW,
    height: winH,
    x: winX,
    y: winY,
    title: "Mochi Ultra Settings",
    backgroundColor: "#0b0c0e",
    frame: true,
    autoHideMenuBar: true,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWin.setAlwaysOnTop(true, "screen-saver");

  settingsWin.on("focus", () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setAlwaysOnTop(false);
    }
    settingsWin.setAlwaysOnTop(true, "screen-saver");
  });

  settingsWin.on("blur", () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setAlwaysOnTop(true, "screen-saver");
    }
  });

  const isDev = process.env.NODE_ENV === "development";
  const distSettings = path.join(__dirname, "..", "dist", "settings.html");

  if (isDev) {
    settingsWin.loadURL("http://localhost:1420/settings.html");
  } else if (fs.existsSync(distSettings)) {
    settingsWin.loadFile(distSettings);
  } else {
    settingsWin.loadURL("http://localhost:1420/settings.html");
  }

  settingsWin.on("closed", () => {
    settingsWin = null;
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setAlwaysOnTop(true, "screen-saver");
    }
  });
}

function broadcastToProductivity(channel, ...args) {
  if (productivityWin && !productivityWin.isDestroyed()) {
    try {
      productivityWin.webContents.send(channel, ...args);
    } catch (e) {}
  }
  if (overlayWin && !overlayWin.isDestroyed()) {
    try {
      overlayWin.webContents.send(channel, ...args);
    } catch (e) {}
  }
}

let lastDistractionAlertTime = 0;
let lastVoiceAlertTime = 0;
function handleFocusDistractionAlert(procName) {
  if (!procName) return;
  const cleanProc = procName.toLowerCase().replace(/\.exe$/i, "").trim();

  // Guard against any system / background process
  if (isProtectedProcess(cleanProc)) return;

  const now = Date.now();
  // Global cooldown for native notifications: at least 45 seconds
  if (now - lastDistractionAlertTime < 45000) return;
  lastDistractionAlertTime = now;

  const isMe = (activeSettings.userRole || "me") === "me";
  const userName = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
  const displayName = cleanProc.charAt(0).toUpperCase() + cleanProc.slice(1);

  console.log(`[Productivity] Alerting user: ${userName} opened distraction app ${displayName}`);

  // 1. Send warning to overlay island
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("productivity-distraction-warning", {
      app: displayName,
      userName: userName,
    });
  }

  // 2. Windows Native Notification
  const settings = productivityStore ? productivityStore.get("settings", { notifications: true }) : { notifications: true };
  if (settings.notifications && Notification.isSupported()) {
    try {
      new Notification({
        title: "Baymax — Focus Active",
        body: `Hey ${userName}, "${displayName}" is blocked during your focus session.`,
        silent: false,
      }).show();
    } catch (e) {}
  }

  // 3. Spoken voice intervention via Live Assistant (at most once every 60 seconds)
  if (now - lastVoiceAlertTime > 60000) {
    lastVoiceAlertTime = now;
    sendToLiveEngine({
      cmd: "text",
      text: `[FOCUS REMINDER]: The user ${userName} opened ${displayName} during an active focus session. Say once gently and concisely: "Hey ${userName}, ${displayName} is blocked during your focus session. Let's stay focused on work."`
    });
  }
}

function createProductivityWindow() {
  if (productivityWin && !productivityWin.isDestroyed()) {
    if (productivityWin.isMinimized()) productivityWin.restore();
    productivityWin.show();
    productivityWin.focus();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const winW = Math.min(1280, Math.round(screenWidth * 0.9));
  const winH = Math.min(840, Math.round(screenHeight * 0.9));
  const winX = Math.round((screenWidth - winW) / 2);
  const winY = Math.round((screenHeight - winH) / 2);

  productivityWin = new BrowserWindow({
    width: winW,
    height: winH,
    x: winX,
    y: winY,
    minWidth: 920,
    minHeight: 620,
    title: "Baymax — Productivity & Focus Workspace",
    backgroundColor: "#0A0A0A",
    frame: true,
    autoHideMenuBar: true,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-productivity.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const distProductivity = path.join(__dirname, "..", "productivity", "dist", "index.html");
  if (fs.existsSync(distProductivity)) {
    productivityWin.loadFile(distProductivity);
  } else {
    productivityWin.loadURL("http://localhost:3000");
  }

  productivityWin.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      productivityWin.hide();
    }
  });

  productivityWin.on("closed", () => {
    productivityWin = null;
  });
}

function setupTray() {
  const iconPath = path.join(__dirname, "..", "public", "icons", "icon.ico");
  let trayIcon = nativeImage.createEmpty();
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("Baymax — AI Desktop Companion & Productivity Engine");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Baymax",
      click: () => {
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("tray", "open");
        }
      },
    },
    {
      label: "Productivity & Focus (Baymax)…",
      click: () => {
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.show();
          overlayWin.focus();
          overlayWin.webContents.send("tray", "open-productivity");
        }
      },
    },
    {
      label: "Settings…",
      click: () => createSettingsWindow(),
    },
    {
      label: "Pause",
      click: () => {
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("tray", "pause");
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("tray", "open");
    }
  });
}

// ── App Launcher & Closer ───────────────────────────────────────────────────

function getProcessCandidates(appNameOrPath) {
  const query = (appNameOrPath || "").toLowerCase().trim().replace(/^["']|["']$/g, "");
  const candidates = new Set();

  // 1. Check if configured in activeSettings.appPaths
  const paths = activeSettings.appPaths || {};
  let configuredVal = null;
  for (const [key, val] of Object.entries(paths)) {
    if (val && (query.includes(key.toLowerCase()) || key.toLowerCase().includes(query))) {
      configuredVal = String(val).trim().replace(/^["']|["']$/g, "");
      break;
    }
  }

  if (configuredVal) {
    // If it is a Windows shortcut .lnk, read the target executable
    if (configuredVal.toLowerCase().endsWith(".lnk") && fs.existsSync(configuredVal)) {
      try {
        const linkInfo = shell.readShortcutLink(configuredVal);
        if (linkInfo && linkInfo.target) {
          candidates.add(path.basename(linkInfo.target));
        }
      } catch {}
    }

    // If it has --processStart App.exe (e.g. Discord update wrapper)
    const procStartMatch = configuredVal.match(/--processStart\s+([^\s]+\.exe)/i);
    if (procStartMatch) {
      candidates.add(procStartMatch[1]);
    }

    // Extract any .exe in configuredVal
    const exeMatches = configuredVal.match(/([a-zA-Z0-9_\-\. ]+\.exe)/gi);
    if (exeMatches) {
      for (const m of exeMatches) {
        const clean = m.trim();
        if (!clean.toLowerCase().includes("explorer.exe") && !clean.toLowerCase().includes("cmd.exe")) {
          candidates.add(clean);
        }
      }
    }

    // Base name matching from shortcut name (e.g. "OBS RECORDING.lnk", "Roblox Player.lnk")
    const base = path.basename(configuredVal).replace(/\.(lnk|url|exe)$/i, "").toLowerCase();
    if (base.includes("obs")) {
      candidates.add("obs64.exe");
      candidates.add("obs32.exe");
      candidates.add("obs.exe");
    }
    if (base.includes("roblox")) {
      candidates.add("RobloxPlayerBeta.exe");
      candidates.add("RobloxPlayer.exe");
      candidates.add("Roblox.exe");
    }
    if (base.includes("fortnite")) {
      candidates.add("FortniteClient-Win64-Shipping.exe");
      candidates.add("FortniteLauncher.exe");
    }
    if (base.includes("premiere")) {
      candidates.add("Adobe Premiere Pro.exe");
    }
  }

  // 2. Built-in known process mappings for common Windows apps
  if (query.includes("valorant")) {
    candidates.add("VALORANT.exe");
    candidates.add("VALORANT-Win64-Shipping.exe");
    candidates.add("RiotClientServices.exe");
    candidates.add("RiotClientCrashHandler.exe");
  }
  if (query.includes("riot")) {
    candidates.add("RiotClientServices.exe");
    candidates.add("RiotClientCrashHandler.exe");
  }
  if (query.includes("league") || query === "lol") {
    candidates.add("LeagueClient.exe");
    candidates.add("League of Legends.exe");
    candidates.add("LeagueClientUx.exe");
  }
  if (query.includes("csgo") || query.includes("cs2") || query.includes("counter-strike")) {
    candidates.add("cs2.exe");
    candidates.add("csgo.exe");
  }
  if (query.includes("gta")) {
    candidates.add("GTA5.exe");
    candidates.add("PlayGTAV.exe");
  }
  if (query.includes("notepad")) {
    candidates.add("Notepad.exe");
    candidates.add("notepad.exe");
  }
  if (query.includes("whatsapp")) {
    candidates.add("WhatsApp.exe");
    candidates.add("WhatsAppDesktop.exe");
  }
  if (query.includes("discord")) {
    candidates.add("Discord.exe");
  }
  if (query.includes("obs") || query.includes("stream")) {
    candidates.add("obs64.exe");
    candidates.add("obs32.exe");
    candidates.add("obs.exe");
  }
  if (query.includes("roblox")) {
    candidates.add("RobloxPlayerBeta.exe");
    candidates.add("RobloxPlayer.exe");
  }
  if (query.includes("fortnite")) {
    candidates.add("FortniteClient-Win64-Shipping.exe");
    candidates.add("FortniteLauncher.exe");
  }
  if (query.includes("premiere")) {
    candidates.add("Adobe Premiere Pro.exe");
  }
  if (query.includes("chrome")) {
    candidates.add("chrome.exe");
  }
  if (query.includes("edge") || query.includes("msedge")) {
    candidates.add("msedge.exe");
  }
  if (query.includes("spotify")) {
    candidates.add("Spotify.exe");
  }
  if (query.includes("calc") || query.includes("calculator")) {
    candidates.add("CalculatorApp.exe");
    candidates.add("Calculator.exe");
    candidates.add("calc.exe");
  }
  if (query.includes("paint") || query.includes("mspaint")) {
    candidates.add("mspaint.exe");
    candidates.add("PaintApp.exe");
  }
  if (query.includes("code") || query.includes("vscode")) {
    candidates.add("Code.exe");
  }
  if (query.includes("telegram")) {
    candidates.add("Telegram.exe");
  }
  if (query.includes("steam")) {
    candidates.add("steam.exe");
  }

  // 3. Direct base name as process
  const cleanName = path.basename(appNameOrPath).trim().replace(/^["']|["']$/g, "");
  if (cleanName.endsWith(".exe")) {
    candidates.add(cleanName);
  } else {
    candidates.add(`${cleanName}.exe`);
  }

  return Array.from(candidates);
}

function launchApplication(appNameOrPath) {
  const query = (appNameOrPath || "").toLowerCase().trim().replace(/^["']|["']$/g, "");
  const paths = activeSettings.appPaths || {};

  let targetPath = null;
  for (const [key, val] of Object.entries(paths)) {
    if (val && (query.includes(key.toLowerCase()) || key.toLowerCase().includes(query))) {
      targetPath = val;
      break;
    }
  }

  if (!targetPath) {
    const rawClean = appNameOrPath ? appNameOrPath.trim().replace(/^["']|["']$/g, "") : "";
    if (rawClean && (rawClean.endsWith(".exe") || rawClean.endsWith(".lnk") || rawClean.endsWith(".url")) && fs.existsSync(rawClean)) {
      targetPath = rawClean;
    } else {
      // Common Windows app fallback
      if (query.includes("discord")) targetPath = "discord";
      else if (query.includes("whatsapp")) targetPath = "explorer.exe shell:AppsFolder\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App";
      else if (query.includes("obs")) targetPath = "obs";
      else if (query.includes("premiere")) targetPath = "premiere";
      else if (query.includes("chrome")) targetPath = "chrome";
      else if (query.includes("notepad")) targetPath = "notepad";
      else if (query.includes("calculator") || query.includes("calc")) targetPath = "calc";
      else if (query.includes("paint") || query.includes("mspaint")) targetPath = "mspaint";
      else if (query.includes("spotify")) targetPath = "spotify";
      else if (query.includes("vscode") || query.includes("code")) targetPath = "code";
      else targetPath = appNameOrPath;
    }
  }

  const clean = (targetPath || "").trim().replace(/^["']|["']$/g, "");

  return new Promise((resolve) => {
    if (!clean) {
      return resolve({ success: false, error: "Empty path" });
    }

    if (clean.startsWith("explorer.exe")) {
      exec(`start "" ${clean}`, (err) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true, path: clean });
      });
    } else if (clean.includes(" ") || clean.toLowerCase().endsWith(".lnk") || clean.toLowerCase().endsWith(".url")) {
      exec(`start "" "${clean}"`, (err) => {
        if (err) {
          shell.openPath(clean).then((openErr) => {
            if (openErr) resolve({ success: false, error: openErr });
            else resolve({ success: true, path: clean });
          });
        } else {
          resolve({ success: true, path: clean });
        }
      });
    } else {
      exec(`start "" "${clean}"`, (err) => {
        if (!err) {
          resolve({ success: true, path: clean });
        } else {
          try {
            const proc = spawn(clean, [], { detached: true, stdio: "ignore", shell: true });
            proc.unref();
            resolve({ success: true, path: clean });
          } catch (spawnErr) {
            resolve({ success: false, error: spawnErr.message });
          }
        }
      });
    }
  });
}

function closeApplication(appNameOrPath) {
  const cleanLower = (appNameOrPath || "").toLowerCase().trim();
  if (!cleanLower) {
    return Promise.resolve({ success: false, error: "No application name provided." });
  }

  // Strict safety protection: NEVER close Mochi or Coucou or Dev tools
  if (
    cleanLower.includes("mochi") ||
    cleanLower.includes("coucou") ||
    cleanLower === "ultra" ||
    cleanLower === "electron" ||
    cleanLower === "python" ||
    cleanLower === "code" ||
    cleanLower === "cursor" ||
    cleanLower === "antigravity" ||
    cleanLower === "jarvis"
  ) {
    console.warn(`[App Closer] Refusing to close protected assistant process: ${appNameOrPath}`);
    return Promise.resolve({
      success: false,
      error: "Refusing to close Mochi assistant process.",
    });
  }

  const candidates = getProcessCandidates(appNameOrPath);
  console.log(`[App Closer] Closing ${appNameOrPath}, checking candidates:`, candidates);

  return new Promise((resolve) => {
    let closedAny = false;
    let checked = 0;

    if (candidates.length === 0) {
      return resolve({ success: false, error: "No matching process candidate found." });
    }

    candidates.forEach((proc) => {
      exec(`taskkill /IM "${proc}" /F /T`, (err, stdout) => {
        checked++;
        if (!err && stdout && stdout.includes("SUCCESS")) {
          closedAny = true;
          console.log(`[App Closer] Terminated ${proc}:`, stdout.trim());
        }

        if (checked === candidates.length) {
          if (closedAny) {
            resolve({ success: true, app: appNameOrPath });
          } else {
            // PowerShell wildcard fallback with strict exclusion of Mochi, Electron, Python, Code
            const queryName = appNameOrPath.replace(/\.exe$/i, "").trim();
            const safePsCmd = `Get-Process | Where-Object { ($_.ProcessName -like '*${queryName}*' -or $_.MainWindowTitle -like '*${queryName}*') -and $_.ProcessName -notmatch 'mochi|coucou|electron|python|code|explorer|system' } | Stop-Process -Force -ErrorAction Stop`;
            exec(`powershell -NoProfile -Command "${safePsCmd}"`, (psErr) => {
              if (!psErr) {
                console.log(`[App Closer] Terminated via PowerShell: *${queryName}*`);
                resolve({ success: true, app: appNameOrPath });
              } else {
                resolve({ success: false, notRunning: true, error: "App was not running." });
              }
            });
          }
        }
      });
    });
  });
}

// ── Mark-LV Live Assistant Process Manager ──────────────────────────────────
let mochiLiveProc = null;
let mochiLiveRestartTimer = null;
let pendingTextResolvers = [];

function syncEngineConfig(settings) {
  try {
    const configPath = path.join(engineDir, 'config', 'api_keys.json');
    let currentConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {}
    }
    const isHer = (settings.userRole || "me") === "her";
    const rawMe = isHer ? (settings.partnerName || "Ayzil") : (settings.userName || "Badsha");
    const rawPartner = isHer ? (settings.userName || "Badsha") : (settings.partnerName || "Ayzil");
    const activeUserName = rawMe.trim() || (isHer ? "Ayzil" : "Badsha");
    const activePartnerName = rawPartner.trim() || (isHer ? "Badsha" : "Ayzil");

    const updatedConfig = {
      ...currentConfig,
      gemini_api_key: settings.geminiApiKey || currentConfig.gemini_api_key || '',
      assistant_name: settings.assistantName || 'Mochi',
      user_name: activeUserName,
      partner_name: activePartnerName,
      user_role: settings.userRole || 'me',
      voice_name: settings.voiceName || 'Charon',
      wake_word_enabled: !!settings.wakeWordEnabled,
      push_to_talk_enabled: !!settings.pushToTalkEnabled,
      proactive_audio: settings.proactiveAudio !== false,
      thinking_enabled: !!settings.thinkingEnabled,
      morning_brief_enabled: settings.morningBriefEnabled !== false,
      media_resolution: settings.mediaResolution || 'medium',
      input_device: settings.audioInputDevice || '',
      output_device: settings.audioOutputDevice || '',
      turn_tuning: {
        silence_ms: settings.turnSilenceMs || 550,
        prefix_ms: settings.turnPrefixMs || 150,
        end_sensitivity: settings.turnEndSensitivity || 'high',
      },
      app_paths: settings.appPaths || currentConfig.app_paths || {},
      plugins_enabled: {
        ...(currentConfig.plugins_enabled || {}),
        close_app: true,
        open_app: true,
        ...(settings.activeActions || {}),
      },
    };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 4), 'utf-8');
  } catch (err) {
    console.warn('[Mark-LV Engine] Failed to write api_keys.json:', err);
  }
}

function startMochiLiveEngine() {
  if (mochiLiveProc) return;
  const provider = activeSettings.aiProvider || "gemini";
  if (provider !== "gemini") {
    console.log(`[Mark-LV Engine] Current AI provider is '${provider}'. Gemini Live process will not be spawned.`);
    return;
  }
  if (!activeSettings.geminiApiKey && !process.env.GEMINI_API_KEY) {
    console.log('[Mark-LV Engine] Gemini API key not set yet. Waiting for key in Settings...');
    return;
  }

  syncEngineConfig(activeSettings);

  const runnerScript = path.join(engineDir, 'mochi_runner.py');
  console.log('[Mark-LV Engine] Spawning live assistant process:', runnerScript);

  try {
    const pyExe = resolvePythonPath();
    const pyDir = path.dirname(pyExe);
    const pyScripts = path.join(pyDir, "Scripts");
    const pathEnv = `${pyDir};${pyScripts};${process.env.PATH || ""}`;

    console.log(`[Mark-LV Engine] Spawning with Python: ${pyExe}`);

    mochiLiveProc = spawn(pyExe, ['mochi_runner.py'], {
      cwd: engineDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: pathEnv, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });

    let buffer = '';

    mochiLiveProc.stdout.on('data', (data) => {
      buffer += data.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('MOCHI_IPC:')) {
          try {
            const jsonStr = trimmed.slice('MOCHI_IPC:'.length);
            const msg = JSON.parse(jsonStr);
            handleLiveEngineEvent(msg);
          } catch (e) {
            console.warn('[LiveEngine IPC Parse Error]:', e.message, trimmed);
          }
        } else {
          console.log(`[Mark-LV Engine]: ${trimmed}`);
        }
      }
    });

    mochiLiveProc.stderr.on('data', (data) => {
      const errStr = data.toString('utf-8').trim();
      if (errStr) console.warn(`[Mark-LV Stderr]: ${errStr}`);
    });

    mochiLiveProc.on('close', (code) => {
      console.log(`[Mark-LV Engine] Process closed with code ${code}`);
      mochiLiveProc = null;
      while (pendingTextResolvers.length > 0) {
        const resolve = pendingTextResolvers.shift();
        resolve({ text: "Mochi live engine is restarting. Please try again." });
      }
      if (!isQuitting && (activeSettings.aiProvider || 'gemini') === 'gemini' && activeSettings.geminiApiKey) {
        clearTimeout(mochiLiveRestartTimer);
        mochiLiveRestartTimer = setTimeout(() => {
          startMochiLiveEngine();
        }, 3000);
      }
    });

    mochiLiveProc.on('error', (err) => {
      console.error('[Mark-LV Engine] Process error:', err);
      mochiLiveProc = null;
      while (pendingTextResolvers.length > 0) {
        const resolve = pendingTextResolvers.shift();
        resolve({ text: `Mochi engine process error: ${err.message}` });
      }
    });

  } catch (err) {
    console.error('[Mark-LV Engine] Failed to spawn runner:', err);
  }
}

function stopMochiLiveEngine() {
  if (mochiLiveProc) {
    try {
      sendToLiveEngine({ cmd: 'interrupt' });
      mochiLiveProc.kill();
    } catch {}
    mochiLiveProc = null;
  }
}

function sendToLiveEngine(cmdObj) {
  if (!mochiLiveProc || !mochiLiveProc.stdin || mochiLiveProc.stdin.destroyed) {
    if (activeSettings.geminiApiKey) {
      startMochiLiveEngine();
    }
    return false;
  }
  try {
    mochiLiveProc.stdin.write(JSON.stringify(cmdObj) + '\n');
    return true;
  } catch (err) {
    console.warn('[Mark-LV Engine] Stdin write error:', err);
    return false;
  }
}

function handleLiveEngineEvent(msg) {
  if (!msg || !msg.event) return;

  switch (msg.event) {
    case 'state': {
      const st = String(msg.state || 'listening').toLowerCase();
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send('ai-state', st);
      }
      break;
    }
    case 'transcript': {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send('ai-transcript', {
          role: msg.role || 'assistant',
          text: msg.text || '',
          speaker: msg.speaker || 'Baymax',
        });
      }
      if (msg.role === 'assistant' && pendingTextResolvers.length > 0) {
        const resolver = pendingTextResolvers.shift();
        resolver({ text: msg.text });
      }
      break;
    }
    case 'audio_level': {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send('ai-audio-level', msg.level || 0);
      }
      break;
    }
    case 'content': {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send('ai-content', { title: msg.title, text: msg.text });
      }
      break;
    }
    case 'confirm': {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send('ai-confirm', msg);
      }
      break;
    }
    case 'reconfig': {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send('open-settings-window');
      }
      break;
    }
    case 'focus_session_command': {
      const action = msg.action || 'start';
      if (action === 'start') {
        const duration = Number(msg.duration_minutes) || 60;
        const mode = msg.mode || 'Deep Silence';
        if (productivityBlocker) {
          productivityBlocker.start({ mode, durationMinutes: duration });
        }
        broadcastToProductivity('focus-state-changed', { active: true, duration, mode });
      } else if (action === 'stop') {
        if (productivityBlocker) {
          productivityBlocker.stop();
        }
        broadcastToProductivity('focus-state-changed', { active: false });
      }
      break;
    }
    case 'video': {
      if (msg.source) {
        console.log('[LiveEngine] Video playback event received, opening in browser:', msg.title || msg.source);
        shell.openExternal(msg.source);
      }
      break;
    }
    case 'partner_chat_send': {
      const isMe = (activeSettings.userRole || "me") === "me";
      const rawMe = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
      const rawPartner = isMe ? (activeSettings.partnerName || "Ayzil") : (activeSettings.userName || "Badsha");
      const myName = (rawMe.trim() || (isMe ? "Badsha" : "Ayzil"));
      const partnerName = (rawPartner.trim() || (isMe ? "Ayzil" : "Badsha"));
      const myDisplayName = myName.charAt(0).toUpperCase() + myName.slice(1);
      const partnerDisplayName = partnerName.charAt(0).toUpperCase() + partnerName.slice(1);
      const userRole = activeSettings.userRole || "me";
      const newMsg = {
        id: msg.id || ("msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
        sender: msg.sender || myDisplayName,
        recipient: msg.recipient || partnerDisplayName,
        senderRole: msg.senderRole || userRole,
        text: msg.text || "",
        timestamp: Date.now(),
        read: true,
        isAiGenerated: true,
      };
      const history = loadChatHistory();
      if (!history.some((m) => m.id === newMsg.id)) {
        history.push(newMsg);
        saveChatHistory(history);
      }
      try {
        broadcastChatMessage(newMsg);
      } catch (err) {
        console.warn("[LiveEngine Broadcast Error]:", err);
      }
      try {
        saveChatMessageToCloud(newMsg, activeSettings.shareChannel || "coucou-badsha-ayzil");
      } catch (err) {}
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send("partner-chat-received", newMsg);
      }
      break;
    }
    case 'schedule_add': {
      if (msg.item) {
        const existingIndex = activeSchedule.findIndex((s) => s.id === msg.item.id);
        if (existingIndex >= 0) activeSchedule[existingIndex] = msg.item;
        else activeSchedule.push(msg.item);
        saveSchedule(activeSchedule);
        syncScheduleToPartner();
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("schedule-updated", activeSchedule);
        }
      }
      break;
    }
    case 'schedule_toggle': {
      const item = activeSchedule.find(
        (s) => s.id === msg.id || (msg.title && s.title.toLowerCase().includes(msg.title.toLowerCase()))
      );
      if (item) {
        item.completed = true;
        item.completedAt = Date.now();
        saveSchedule(activeSchedule);
        syncScheduleToPartner();
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("schedule-updated", activeSchedule);
        }
      }
      break;
    }
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle("boot", () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    settings: activeSettings,
    schedule: activeSchedule,
    screen: {
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      width: primaryDisplay.bounds.width,
      height: primaryDisplay.bounds.height,
      scale: primaryDisplay.scaleFactor,
    },
    version: "1.0.0-creator",
    hookPath: "",
  };
});

// ── Mark-LV Autonomous PC Control Handlers ──────────────────────────────────
ipcMain.handle("marklv-list-actions", async () => {
  return await runMochiBridgeCmd("list-actions");
});

ipcMain.handle("marklv-list-devices", async () => {
  return await runMochiBridgeCmd("list-devices");
});

ipcMain.handle("marklv-list-memory", async () => {
  return await runMochiBridgeCmd("list-memory");
});

ipcMain.handle("marklv-save-memory", async (_event, { category, key, value }) => {
  return await runMochiBridgeCmd("save-memory", category || "notes", key || "", value || "");
});

ipcMain.handle("marklv-delete-memory", async (_event, { category, key }) => {
  return await runMochiBridgeCmd("delete-memory", category || "notes", key || "");
});

ipcMain.handle("marklv-execute-action", async (_event, { name, parameters }) => {
  return await runMochiBridgeCmd("execute", name, JSON.stringify(parameters || {}));
});

ipcMain.handle("marklv-launch-hud", async () => {
  try {
    const hudChild = spawn(resolvePythonPath(), [markLvMainScript], {
      cwd: engineDir,
      detached: true,
      stdio: "ignore",
    });
    hudChild.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("save-settings", (_event, newSettings) => {
  const oldAutostart = activeSettings.autostart;
  const oldGeminiKey = activeSettings.geminiApiKey;
  const oldProvider = activeSettings.aiProvider || "gemini";
  const oldUserRole = activeSettings.userRole || "me";
  const oldUserName = activeSettings.userName || "Badsha";
  const oldPartnerName = activeSettings.partnerName || "Ayzil";
  const oldVoice = activeSettings.voiceName || "Charon";
  activeSettings = { ...activeSettings, ...newSettings };
  cachedMarkLvTools = null;
  saveSettings(activeSettings);
  if (oldAutostart !== activeSettings.autostart) {
    applyStartupMode(activeSettings.autostart);
  }
  startSupabaseSync();
  syncEngineConfig(activeSettings);

  const identityChanged =
    oldUserRole !== (activeSettings.userRole || "me") ||
    oldUserName !== (activeSettings.userName || "Badsha") ||
    oldPartnerName !== (activeSettings.partnerName || "Ayzil");

  const currentProvider = activeSettings.aiProvider || "gemini";
  if (currentProvider === "gemini") {
    if (oldProvider !== "gemini" || !mochiLiveProc || oldGeminiKey !== activeSettings.geminiApiKey || identityChanged) {
      if (mochiLiveProc) stopMochiLiveEngine();
      startMochiLiveEngine();
    } else {
      sendToLiveEngine({
        cmd: "wake_toggle",
        enabled: !!activeSettings.wakeWordEnabled,
      });
      if (oldVoice !== activeSettings.voiceName) {
        sendToLiveEngine({ cmd: "voice", voice: activeSettings.voiceName });
      }
    }
  } else {
    // Switched to groq or fallback provider
    if (mochiLiveProc) {
      console.log(`[Settings] Switched to '${currentProvider}'. Stopping Gemini Live engine.`);
      stopMochiLiveEngine();
    }
  }

  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("settings-changed", activeSettings);
  }
  return true;
});

ipcMain.handle("test-supabase", async (_event, creds) => {
  const targetCreds = creds || {
    url: activeSettings.syncUrl,
    key: activeSettings.syncApiKey,
  };
  const result = await testSupabaseConnection(targetCreds);
  if (result && result.success && targetCreds.url && targetCreds.key) {
    if (activeSettings.syncUrl !== targetCreds.url || activeSettings.syncApiKey !== targetCreds.key) {
      activeSettings.syncUrl = targetCreds.url;
      activeSettings.syncApiKey = targetCreds.key;
      saveSettings(activeSettings);
      startSupabaseSync();
    }
  }
  return result;
});

ipcMain.handle("check-supabase-cloud-status", async (_event, creds) => {
  return await checkCloudStorageReady(creds || {
    url: activeSettings.syncUrl,
    key: activeSettings.syncApiKey,
  });
});

ipcMain.handle("get-supabase-sql-setup", () => {
  return SUPABASE_SQL_SETUP;
});

ipcMain.handle("get-chat-messages", () => {
  return loadChatHistory();
});

ipcMain.handle("send-chat-message", async (_event, arg) => {
  const history = loadChatHistory();
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawMe = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
  const rawPartner = isMe ? (activeSettings.partnerName || "Ayzil") : (activeSettings.userName || "Badsha");
  const myName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);
  const partnerName = rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1);

  let rawText = "";
  let isAiGenerated = false;

  if (typeof arg === "string") {
    rawText = arg;
  } else if (typeof arg === "object" && arg !== null) {
    if (typeof arg.text === "string") {
      rawText = arg.text;
    } else if (typeof arg.text === "object" && arg.text !== null && typeof arg.text.text === "string") {
      rawText = arg.text.text;
    }
    isAiGenerated = !!arg.isAiGenerated;
  }

  const cleanText = (rawText || "").trim();
  if (!cleanText) {
    console.warn("[Chat Send] Empty message text received");
    return null;
  }

  const msg = {
    id: "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    sender: myName,
    recipient: partnerName,
    senderRole: activeSettings.userRole || "me",
    text: cleanText,
    timestamp: Date.now(),
    read: true,
    isAiGenerated: isAiGenerated,
  };

  history.push(msg);
  saveChatHistory(history);

  // 1. Fast Realtime WebSockets broadcast (<50ms)
  try {
    await broadcastChatMessage(msg);
    console.log(`[Supabase Realtime] Sent chat message from ${myName}: "${cleanText}"`);
  } catch (err) {
    console.warn("[Supabase Realtime] Chat send error:", err);
  }

  // 2. 24/7 Persistent Cloud DB save (so partner receives when booting up even if offline right now)
  try {
    await saveChatMessageToCloud(msg, activeSettings.shareChannel || "coucou-badsha-ayzil");
  } catch (cloudErr) {}

  return msg;
});

ipcMain.handle("mark-chat-read", () => {
  const history = loadChatHistory();
  const isMe = (activeSettings.userRole || "me") === "me";
  const myName = (isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil")).toLowerCase();
  let updated = false;

  for (const m of history) {
    if (!m.read && (m.sender || "").toLowerCase() !== myName) {
      m.read = true;
      updated = true;
    }
  }

  if (updated) {
    saveChatHistory(history);
  }
  return true;
});

// ── Remote Access (Mochi Eye Co-Pilot) ───────────────────────────────────────
ipcMain.handle("request-remote-access", async () => {
  activeRemoteRole = "viewer";
  pendingViewerSignals = [];
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawMe = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
  const currentUserName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);
  return await broadcastRemoteAccess({ action: "request", sender: currentUserName });
});

ipcMain.handle("respond-remote-access", async (_event, accepted, extra) => {
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawMe = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
  const currentUserName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);

  if (accepted) {
    activeRemoteRole = "host";
    startInputInjector();
    if (extra?.displayBounds) {
      setHostDisplayBounds(extra.displayBounds);
    }
    const primary = screen.getPrimaryDisplay();
    return await broadcastRemoteAccess({
      action: "response",
      accepted: true,
      sender: currentUserName,
      resolution: extra?.resolution || { width: primary.bounds.width, height: primary.bounds.height },
      offer: extra?.offer || null,
    });
  } else {
    activeRemoteRole = null;
    pendingViewerSignals = [];
    setHostDisplayBounds(null);
    return await broadcastRemoteAccess({
      action: "response",
      accepted: false,
      sender: currentUserName,
    });
  }
});

ipcMain.handle("send-remote-signal", async (_event, signal) => {
  return await broadcastRemoteAccess({ action: "signal", signal });
});

ipcMain.handle("end-remote-access", async () => {
  activeRemoteRole = null;
  pendingViewerSignals = [];
  closeRemoteViewerWindow();
  stopInputInjector();
  setHostDisplayBounds(null);
  return await broadcastRemoteAccess({ action: "end" });
});

ipcMain.handle("get-available-screens", async () => {
  return await getAvailableScreens();
});

ipcMain.handle("get-primary-screen-source", async () => {
  return await getPrimaryScreenSource();
});

ipcMain.handle("inject-remote-input", (_event, cmd) => {
  if (cmd) injectInput(cmd);
  return true;
});

ipcMain.on("inject-remote-input-fast", (_event, cmd) => {
  if (cmd) injectInput(cmd);
});

// Viewer Window IPC handlers
ipcMain.handle("viewer-get-partner-info", () => {
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawPartner = isMe ? (activeSettings.partnerName || "Ayzil") : (activeSettings.userName || "Badsha");
  const partnerUserName = rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1);
  const primary = screen.getPrimaryDisplay();
  const initData = getViewerInitData();

  // If there are pending signals, deliver them now that the viewer is requesting info
  const viewer = getRemoteViewerWindow();
  if (viewer && viewer.webContents && pendingViewerSignals.length > 0) {
    for (const sig of pendingViewerSignals) {
      viewer.webContents.send("viewer-signal", sig);
    }
    pendingViewerSignals = [];
  }

  return {
    partnerName: initData?.partnerName || partnerUserName,
    remoteResolution: initData?.remoteResolution || { width: primary.bounds.width, height: primary.bounds.height },
    initialOffer: initData?.initialOffer || null,
  };
});

ipcMain.handle("viewer-send-signal", async (_event, signal) => {
  return await broadcastRemoteAccess({ action: "signal", signal });
});

ipcMain.handle("viewer-send-input", async (_event, cmd) => {
  return await broadcastRemoteAccess({ action: "input", cmd });
});

ipcMain.on("viewer-send-input-fast", (_event, cmd) => {
  if (cmd) broadcastRemoteAccess({ action: "input", cmd });
});

ipcMain.handle("viewer-toggle-fullscreen", () => {
  const viewer = getRemoteViewerWindow();
  if (viewer) {
    viewer.setFullScreen(!viewer.isFullScreen());
  }
  return true;
});

ipcMain.handle("viewer-end-session", async () => {
  activeRemoteRole = null;
  pendingViewerSignals = [];
  closeRemoteViewerWindow();
  stopInputInjector();
  setHostDisplayBounds(null);
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawMe = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
  const currentUserName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);
  return await broadcastRemoteAccess({ action: "end", sender: currentUserName });
});

ipcMain.handle("set-collapsed", (_event, collapsed) => {
  isCollapsed = collapsed;
  return true;
});

ipcMain.handle("set-ignore-mouse-events", (_event, ignore, options) => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    isMouseInsideIsland = !ignore;
    overlayWin.setIgnoreMouseEvents(ignore, options);
  }
  return true;
});

ipcMain.handle("set-island-rect", (_event, rect) => {
  if (rect) {
    currentIslandRect = rect;
  }
  return true;
});

ipcMain.handle("focus-window", (_event, focused) => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    if (focused) overlayWin.focus();
  }
  return true;
});

ipcMain.handle("reposition", () => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;
    const panelWidth = 1040;
    const x = Math.round((screenWidth - panelWidth) / 2);
    overlayWin.setPosition(x, 0);
  }
  return true;
});

ipcMain.handle("open-url", (_event, url) => {
  if (url) shell.openExternal(url);
  return true;
});

ipcMain.handle("launch-app", async (_event, nameOrPath) => {
  return await launchApplication(nameOrPath);
});

ipcMain.handle("close-app", async (_event, nameOrPath) => {
  return await closeApplication(nameOrPath);
});

ipcMain.handle("select-app-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Application Executable or Shortcut",
    properties: ["openFile"],
    filters: [
      { name: "Applications & Shortcuts (*.exe, *.lnk, *.bat, *.cmd)", extensions: ["exe", "lnk", "bat", "cmd"] },
      { name: "All Files (*.*)", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle("open-settings-window", () => {
  createSettingsWindow();
  return true;
});

ipcMain.handle("quit", () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle("log", (_event, msg) => {
  console.log("[Renderer Log]:", msg);
  return true;
});

// ── GitHub 1-Click Auto-Updater ──────────────────────────────────────────────
ipcMain.handle("check-for-updates", async () => {
  return await checkForUpdates();
});

ipcMain.handle("perform-update", async () => {
  try {
    await performUpdate((progressMsg) => {
      if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.webContents.send("update-progress", progressMsg);
      }
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send("update-progress", progressMsg);
      }
    });
    return { success: true };
  } catch (err) {
    console.error("[Updater] Perform update error:", err);
    return { success: false, error: err.message };
  }
});

// ── AI Companion Prompt & Action Executor ──────────────────────────────────
function buildCompanionSystemPrompt() {
  const userRole = activeSettings.userRole || "me";
  const partnerRole = userRole === "me" ? "her" : "me";
  const currentUserName = userRole === "me" ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
  const partnerUserName = userRole === "me" ? (activeSettings.partnerName || "Ayzil") : (activeSettings.userName || "Badsha");

  // Load latest schedule items
  const myTasks = activeSchedule.filter((s) => s.assignee === userRole || s.assignee === "both");
  const partnerTasks = activeSchedule.filter((s) => s.assignee === partnerRole || s.assignee === "both");

  const myTasksText = myTasks.length > 0
    ? myTasks.map((s) => `  [${s.completed ? "DONE" : "PENDING"}] ${s.time ? s.time + " - " : ""}${s.title}${s.assignedBy === partnerRole ? ` (set by ${partnerUserName})` : ""}`).join("\n")
    : "No tasks scheduled for today.";

  const partnerTasksText = partnerTasks.length > 0
    ? partnerTasks.map((s) => `  [${s.completed ? "DONE" : "PENDING"}] ${s.time ? s.time + " - " : ""}${s.title}${s.assignedBy === userRole ? ` (set by ${currentUserName})` : ""}`).join("\n")
    : "No tasks scheduled for today.";

  return `You are Mochi, a warm, super cute, energetic, and snappy AI desktop companion for YouTube creator couple ${currentUserName} and ${partnerUserName}.
CURRENT ACTIVE USER ON THIS PC: ${currentUserName}
THEIR PARTNER: ${partnerUserName}

--- ${currentUserName.toUpperCase()}'S TASKS ---
${myTasksText}

--- ${partnerUserName.toUpperCase()}'S TASKS ---
${partnerTasksText}

Configured Apps: ${Object.keys(activeSettings.appPaths || {}).join(", ")}

CRITICAL IDENTITY & TASK OWNERSHIP RULES:
1. You are speaking directly to ${currentUserName}.
2. When ${currentUserName} asks about "my task", "my tasks", "my schedule", "what do I have to do": ONLY list ${currentUserName}'s tasks.
3. Only if ${currentUserName} specifically asks about ${partnerUserName}: tell them about ${partnerUserName}'s tasks.
4. Keep answers short, sweet, and assistant-friendly (maximum 1-2 short sentences!).
5. Do NOT use markdown symbols (no **, ##, *, backticks) or bullet spam so spoken voice sounds natural.
6. If asked to open/launch an app: Say e.g. "Opening Discord right now!" and append [LAUNCH: app_name].
7. If asked to close/exit an app: Say e.g. "Closing Discord for you!" and append [CLOSE: app_name].
8. If asked to add a task for ${currentUserName}: Confirm and append [ADD_TASK: {"title":"...","time":"...","for":"${userRole}"}].
9. If asked to add a task for ${partnerUserName}: Confirm and append [ADD_TASK: {"title":"...","time":"...","for":"${partnerRole}"}].
10. If asked to add a task for both: Confirm and append [ADD_TASK: {"title":"...","time":"...","for":"both"}].
11. If asked to mark done: Confirm in one line and append [MARK_DONE: task_id_or_title].
12. If asked to send/text a message to ${partnerUserName}: Confirm in a sweet sentence and append [SEND_CHAT: {"text":"..."}].
13. If asked to play a YouTube video, music, song, or artist (e.g. "play MrBeast", "play trending songs", "gaana chalao", "video play karo", "koi badhiya song play karo"): Say e.g. "Playing that for you right now!" and append [PLAY_YOUTUBE: search_or_song_query]. NEVER say you played it without appending [PLAY_YOUTUBE: query]!
14. If asked to search Google or the web (e.g. "search...", "who is...", "what is the score of...", "google..."): Say e.g. "Searching that for you!" and append [WEB_SEARCH: search_query].
15. If asked to open a website or URL: Say e.g. "Opening that website right now!" and append [BROWSER_OPEN: website_url].
16. If asked to adjust volume, mute, or media controls: Say e.g. "Got it!" and append [MEDIA_CONTROL: command_or_volume].
17. If asked to start a focus or flow session (e.g. "start focus session for 1 hour", "focus session start karo", "focus mode on"): Say e.g. "Starting your focus session now. Time to lock in!" and append [START_FOCUS: {"durationMinutes": <minutes>, "mode": "Strict Lock"}].
18. If asked to stop or end focus mode: Say e.g. "Ending your focus session!" and append [STOP_FOCUS].
Be sweet, playful, and helpful!`;
}

async function executeActionTags(rawReply) {
  const userRole = activeSettings.userRole || "me";
  const partnerRole = userRole === "me" ? "her" : "me";
  const currentUserName = userRole === "me" ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
  const partnerUserName = userRole === "me" ? (activeSettings.partnerName || "Ayzil") : (activeSettings.userName || "Badsha");

  // Execute [START_FOCUS: ...]
  const focusStartMatch = /\[START_FOCUS:\s*({[^}]+})\]/i.exec(rawReply);
  if (focusStartMatch) {
    try {
      const parsed = JSON.parse(focusStartMatch[1]);
      const mins = Number(parsed.durationMinutes) || 25;
      const mode = parsed.mode || "Strict Lock";
      if (productivityBlocker) productivityBlocker.start({ mode });
      broadcastToProductivity("focus-state-changed", { active: true, config: { mode, durationMinutes: mins } });
    } catch (e) {
      console.warn("Parse START_FOCUS error:", e);
    }
  }

  // Execute [STOP_FOCUS]
  if (/\[STOP_FOCUS\]/i.test(rawReply)) {
    if (productivityBlocker) productivityBlocker.stop();
    broadcastToProductivity("focus-state-changed", { active: false });
  }

  // Execute [SEND_CHAT: ...]
  const chatMatch = /\[SEND_CHAT:\s*({[^}]+})\]/i.exec(rawReply);
  if (chatMatch) {
    try {
      const parsed = JSON.parse(chatMatch[1]);
      if (parsed.text) {
        const history = loadChatHistory();
        const newMsg = {
          id: "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          sender: currentUserName,
          recipient: partnerUserName,
          senderRole: userRole,
          text: parsed.text,
          timestamp: Date.now(),
          read: true,
          isAiGenerated: true,
        };
        history.push(newMsg);
        saveChatHistory(history);
        try { broadcastChatMessage(newMsg); } catch {}
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("partner-chat-received", newMsg);
        }
      }
    } catch (e) {
      console.warn("Parse SEND_CHAT error:", e);
    }
  }

  // Execute [ADD_TASK: ...]
  const taskMatch = /\[ADD_TASK:\s*({[^}]+})\]/i.exec(rawReply);
  if (taskMatch) {
    try {
      const parsed = JSON.parse(taskMatch[1]);
      if (parsed.title) {
        const forRole = (parsed.for || userRole).toLowerCase();
        const assignee = forRole.includes("her") || forRole.includes("partner") ? partnerRole : (forRole.includes("both") ? "both" : userRole);
        const newItem = {
          id: "task_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          title: parsed.title,
          time: parsed.time || "",
          assignee: assignee,
          assignedBy: userRole,
          completed: false,
          createdAt: Date.now(),
        };
        activeSchedule.push(newItem);
        saveSchedule(activeSchedule);
        syncScheduleToPartner();
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("schedule-updated", activeSchedule);
        }
      }
    } catch (e) {
      console.warn("Parse ADD_TASK error:", e);
    }
  }

  // Execute [MARK_DONE: ...]
  const doneMatch = /\[MARK_DONE:\s*([^\]]+)\]/i.exec(rawReply);
  if (doneMatch) {
    const queryDone = doneMatch[1].trim().toLowerCase();
    const item = activeSchedule.find((s) => s.id === queryDone || s.title.toLowerCase().includes(queryDone));
    if (item) {
      item.completed = true;
      item.completedAt = Date.now();
      saveSchedule(activeSchedule);
      syncScheduleToPartner();
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send("schedule-updated", activeSchedule);
      }
    }
  }

  // Execute [LAUNCH: ...]
  const launchMatch = /\[LAUNCH:\s*([^\]]+)\]/i.exec(rawReply);
  if (launchMatch) {
    const target = launchMatch[1].trim();
    void launchApplication(target);
  }

  // Execute [CLOSE: ...]
  const closeMatch = /\[CLOSE:\s*([^\]]+)\]/i.exec(rawReply);
  if (closeMatch) {
    const target = closeMatch[1].trim();
    void closeApplication(target);
  }

  // Execute [PLAY_YOUTUBE: ...]
  const ytMatch = /\[PLAY_YOUTUBE:\s*([^\]]+)\]/i.exec(rawReply);
  if (ytMatch) {
    const ytQuery = ytMatch[1].trim();
    console.log(`[Action] Playing YouTube for query: "${ytQuery}"`);
    void runMochiBridgeCmd("execute", "youtube_video", JSON.stringify({ action: "play", query: ytQuery })).catch((err) => {
      console.warn("[Action] Bridge youtube_video fallback to shell:", err);
      shell.openExternal(`https://www.youtube.com/results?search_query=${encodeURIComponent(ytQuery)}`);
    });
  }

  // Execute [WEB_SEARCH: ...]
  const searchMatch = /\[WEB_SEARCH:\s*([^\]]+)\]/i.exec(rawReply);
  if (searchMatch) {
    const sQuery = searchMatch[1].trim();
    console.log(`[Action] Searching web for: "${sQuery}"`);
    void runMochiBridgeCmd("execute", "web_search", JSON.stringify({ query: sQuery, mode: "search" })).catch((err) => {
      console.warn("[Action] Bridge web_search fallback to shell:", err);
      shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(sQuery)}`);
    });
  }

  // Execute [BROWSER_OPEN: ...]
  const browserMatch = /\[BROWSER_OPEN:\s*([^\]]+)\]/i.exec(rawReply);
  if (browserMatch) {
    let bUrl = browserMatch[1].trim();
    if (!/^https?:\/\//i.test(bUrl)) bUrl = "https://" + bUrl;
    console.log(`[Action] Opening browser URL: "${bUrl}"`);
    shell.openExternal(bUrl);
  }

  // Execute [MEDIA_CONTROL: ...]
  const mediaMatch = /\[MEDIA_CONTROL:\s*([^\]]+)\]/i.exec(rawReply);
  if (mediaMatch) {
    const mCmd = mediaMatch[1].trim();
    console.log(`[Action] Media/setting command: "${mCmd}"`);
    void runMochiBridgeCmd("execute", "computer_settings", JSON.stringify({ description: mCmd }));
  }
}

// ── Gemini REST Engine (Instant Text Chat & Action Fallback) ────────────────
async function callGeminiAI(query, context) {
  const key = activeSettings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    return { text: "Please enter your free Google Gemini API key in Settings (⚙️) to chat with me!" };
  }

  const systemPrompt = buildCompanionSystemPrompt();
  const candidateModels = [
    activeSettings.geminiModel || "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-flash-latest",
  ];

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [
            { role: "user", parts: [{ text: query }] }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 350
          }
        })
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.warn(`[Gemini REST] Model ${model} returned ${res.status}:`, errBody);
        continue;
      }

      const data = await res.json();
      const rawReply = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      if (!rawReply) continue;

      await executeActionTags(rawReply);
      const cleanReply = rawReply.replace(/\[[A-Z_]+:[^\]]*\]/gi, "").trim();
      return { text: cleanReply || rawReply };
    } catch (err) {
      console.warn(`[Gemini REST] Error calling ${model}:`, err.message);
    }
  }

  return { text: "I couldn't reach Gemini right now. Please verify your internet connection or check your Gemini API key in Settings!" };
}

// ── Groq Secondary AI Engine ────────────────────────────────────────────────
async function callGroqAI(query, context) {
  const systemPrompt = buildCompanionSystemPrompt();
  const key = activeSettings.groqApiKey || activeSettings.grokApiKey;
  if (!key) {
    return { text: "Please enter your free Groq API Key (gsk_...) in Settings to chat with me!" };
  }
  const model = activeSettings.groqModel || "llama-3.3-70b-versatile";

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query },
        ],
        temperature: 0.7,
        max_tokens: 350,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let rawReply = (data.choices?.[0]?.message?.content || "").trim();

    await executeActionTags(rawReply);

    const cleanReply = rawReply.replace(/\[[A-Z_]+:[^\]]*\]/gi, "").trim();
    return { text: cleanReply || rawReply };
  } catch (err) {
    console.error("[Groq AI Error]:", err);
    return { text: `Groq error: ${err.message}` };
  }
}

// ── AI & Chat: Engine IPC Handlers (Gemini Live & Groq) ───────────────────

ipcMain.handle("chat-send", async (_event, { query, context }) => {
  if (!query || !query.trim()) return { text: "" };

  const provider = activeSettings.aiProvider || "gemini";
  if (provider === "groq") {
    return await callGroqAI(query, context);
  }

  // Gemini Provider:
  if (!activeSettings.geminiApiKey && !process.env.GEMINI_API_KEY) {
    return { text: "Please enter your free Google Gemini API key in Settings (⚙️) to chat with Mochi!" };
  }

  // Ensure Live Assistant engine is starting / running for voice/visemes
  if (!mochiLiveProc || mochiLiveProc.killed) {
    startMochiLiveEngine();
  } else {
    // Notify live assistant about the text interaction
    sendToLiveEngine({ cmd: "text", text: query });
  }

  // Instant response via Gemini REST (never hangs on '...' thinking dots!)
  return await callGeminiAI(query, context);
});

ipcMain.handle("chat-reset", () => {
  if ((activeSettings.aiProvider || "gemini") === "gemini") {
    sendToLiveEngine({ cmd: "interrupt" });
  }
  return true;
});

ipcMain.handle("transcribe-audio", async (_event, audioBase64) => {
  try {
    const key = activeSettings.groqApiKey || activeSettings.grokApiKey;
    if (!key) {
      return { success: false, error: "Please enter your free Groq API key in Settings for voice recognition!" };
    }
    const buffer = Buffer.from(audioBase64, "base64");
    const formData = new FormData();
    const file = new File([buffer], "audio.wav", { type: "audio/wav" });
    formData.append("file", file);
    formData.append("model", "whisper-large-v3");
    formData.append("temperature", "0");
    formData.append(
      "prompt",
      "Mochi, play songs, open YouTube, MrBeast, play video, Discord, WhatsApp, OBS, Premiere Pro, schedule, Ayzil, Badsha, send message to partner."
    );

    let res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
    });

    if (!res.ok) {
      const fbForm = new FormData();
      const fbFile = new File([buffer], "audio.wav", { type: "audio/wav" });
      fbForm.append("file", fbFile);
      fbForm.append("model", "whisper-large-v3-turbo");
      fbForm.append("temperature", "0");

      res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: fbForm,
      });

      if (!res.ok) {
        const fbErr = await res.text();
        throw new Error(`Whisper transcription failed: ${fbErr}`);
      }
    }

    const data = await res.json();
    return { success: true, text: data.text ? data.text.trim() : "" };
  } catch (err) {
    console.error("Transcribe audio error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("ai-interrupt", () => {
  sendToLiveEngine({ cmd: "interrupt" });
  return true;
});

ipcMain.handle("ai-mute", (_event, muted) => {
  sendToLiveEngine({ cmd: "mute", muted: !!muted });
  return true;
});

ipcMain.handle("ai-set-voice", (_event, voice) => {
  sendToLiveEngine({ cmd: "voice", voice });
  return true;
});

// File Ingestion & Google Drive Upload
const knownDriveFileIds = new Set();
const myUploadedFileIds = new Set();
let isFirstDrivePoll = true;

ipcMain.handle("ingest-file", async (_event, fileArg) => {
  try {
    let filePath = typeof fileArg === "string" ? fileArg : fileArg?.path || "";
    let fileName =
      (typeof fileArg === "object" && fileArg?.name) ||
      (filePath ? path.basename(filePath) : "file");
    let fileBuffer = (typeof fileArg === "object" && fileArg?.buffer) || null;
    let fileSize = (typeof fileArg === "object" && fileArg?.size) || 0;

    const inboxDir = path.join(userDataDir, "inbox");
    if (!fs.existsSync(inboxDir)) {
      fs.mkdirSync(inboxDir, { recursive: true });
    }

    const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_");
    const destPath = path.join(inboxDir, `${Date.now()}_${safeName}`);

    let resolvedPath = filePath;
    let stats = null;

    if (filePath && fs.existsSync(filePath)) {
      try {
        stats = fs.statSync(filePath);
        fileSize = stats.size;
        fs.copyFileSync(filePath, destPath);
      } catch (err) {
        console.warn("[Ingest File] copyFileSync failed:", err);
      }
    } else if (filePath) {
      // Look in common user directories if a relative name was passed
      const baseName = path.basename(filePath);
      const home = os.homedir();
      const candidates = [
        path.join(home, "Desktop", baseName),
        path.join(home, "Downloads", baseName),
        path.join(home, "Pictures", "Screenshots", baseName),
        path.join(home, "Pictures", baseName),
        path.join(home, "Videos", baseName),
        path.join(home, "Documents", baseName),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          resolvedPath = cand;
          try {
            stats = fs.statSync(cand);
            fileSize = stats.size;
            fs.copyFileSync(cand, destPath);
          } catch (e) {}
          break;
        }
      }
    }

    // If file was not found on disk, but renderer passed arrayBuffer:
    if (!fs.existsSync(destPath) && fileBuffer) {
      try {
        const nodeBuffer = Buffer.from(fileBuffer);
        fs.writeFileSync(destPath, nodeBuffer);
        fileSize = nodeBuffer.length;
      } catch (e) {
        console.warn("[Ingest File] Buffer write failed:", e);
      }
    }

    const finalPath = fs.existsSync(destPath) ? destPath : (resolvedPath || filePath);

    const fileInfo = {
      name: fileName,
      path: finalPath,
      size: fileSize || 1024 * 1024 * 2,
      uploadedToDrive: false,
    };

    console.log(`[File Ingestion]: Successfully ingested ${fileName} (${(fileInfo.size / (1024 * 1024)).toFixed(2)} MB) at ${finalPath}`);

    // 1. Google Drive Upload: Try Google Account OAuth First (15GB quota), then Service Account
    const driveFolderId = activeSettings.gdriveFolderId || "1d-IQvgmZTBDcUkIy7f_kJHl2YCgc80CE";
    const ext = path.extname(fileName).toLowerCase();
    let mimeType = "application/octet-stream";
    if (ext === ".png") mimeType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
    else if (ext === ".mp4") mimeType = "video/mp4";
    else if (ext === ".mov") mimeType = "video/quicktime";
    else if (ext === ".mkv") mimeType = "video/x-matroska";
    else if (ext === ".pdf") mimeType = "application/pdf";
    else if (ext === ".txt") mimeType = "text/plain";
    else if (ext === ".zip") mimeType = "application/zip";

    const oauth = activeSettings.googleOAuth;
    if (oauth && oauth.refreshToken && oauth.clientId && oauth.clientSecret) {
      try {
        console.log(`[Google Drive]: Uploading ${fileName} to Drive folder ${driveFolderId} via Google Account (${oauth.email || "user"})...`);
        const accessToken = await refreshOAuthAccessToken({
          clientId: oauth.clientId,
          clientSecret: oauth.clientSecret,
          refreshToken: oauth.refreshToken,
        });

        const driveResult = await uploadFileWithToken({
          filePath: finalPath,
          fileName,
          mimeType,
          folderId: driveFolderId,
          accessToken,
        });

        fileInfo.uploadedToDrive = true;
        fileInfo.driveUrl = driveResult.webViewLink || `https://drive.google.com/file/d/${driveResult.id}/view`;
        fileInfo.driveId = driveResult.id;
        myUploadedFileIds.add(driveResult.id);
        myUploadedFileIds.add(fileName);
        knownDriveFileIds.add(driveResult.id);
        knownDriveFileIds.add(fileName);

        console.log(`[Google Drive]: Upload successful via Google Account! File ID: ${driveResult.id}`);
      } catch (oauthErr) {
        console.error(`[Google Drive]: Google Account upload error:`, oauthErr);
      }
    }

    if (!fileInfo.uploadedToDrive) {
      const sa = loadServiceAccount();
      if (sa && driveFolderId) {
        try {
          console.log(`[Google Drive]: Uploading ${fileName} to Drive folder ${driveFolderId} using Service Account (${sa.client_email})...`);
          const driveResult = await uploadFileToDrive({
            filePath: finalPath,
            fileName,
            mimeType,
            folderId: driveFolderId,
            serviceAccount: sa,
          });

          fileInfo.uploadedToDrive = true;
          fileInfo.driveUrl = driveResult.webViewLink || `https://drive.google.com/file/d/${driveResult.id}/view`;
          fileInfo.driveId = driveResult.id;
          myUploadedFileIds.add(driveResult.id);
          myUploadedFileIds.add(fileName);
          knownDriveFileIds.add(driveResult.id);
          knownDriveFileIds.add(fileName);

          console.log(`[Google Drive]: Upload successful via Service Account! File ID: ${driveResult.id}`);
        } catch (driveErr) {
          console.error(`[Google Drive]: Service account upload error:`, driveErr);
        }
      }
    }

    // 2. Direct Cloud Relay Broadcast (Real-time partner sync)
    const shareBin = activeSettings.shareChannel || "coucou-badsha-ayzil";
    try {
      const uploadUrl = `https://filebin.net/${encodeURIComponent(shareBin)}/${encodeURIComponent(fileName)}`;
      console.log(`[Cloud Share]: Broadcasting ${fileName} to pair channel ${shareBin}...`);
      const fileBytes = fs.readFileSync(finalPath);
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "filename": fileName,
          "content-type": "application/octet-stream",
        },
        body: fileBytes,
      });
      if (res.ok) {
        fileInfo.uploadedToDrive = true;
        fileInfo.cloudUrl = uploadUrl;
        myUploadedFileIds.add(fileName);
        knownDriveFileIds.add(fileName);
        console.log(`[Cloud Share]: Successfully broadcast ${fileName} to pair channel ${shareBin}!`);
      }
    } catch (relayErr) {
      console.error(`[Cloud Share]: Relay upload error:`, relayErr);
    }

    // 3. Live Broadcast via Supabase Realtime (<50ms delivery to partner PC)
    try {
      await broadcastFileShared({
        id: fileInfo.driveId || fileName,
        name: fileName,
        size: fileInfo.size,
        driveUrl: fileInfo.driveUrl || "",
        driveId: fileInfo.driveId || "",
        senderName: activeSettings.userName || "Badsha",
        senderRole: activeSettings.userRole || "me",
      });
      console.log(`[Supabase Realtime]: Broadcasted ${fileName} to partner PC!`);
    } catch (sbErr) {
      console.warn("[Supabase Realtime]: Broadcast error:", sbErr.message);
    }

    return fileInfo;
  } catch (err) {
    console.error("Ingest file error:", err);
    const fileName = typeof fileArg === "string" ? path.basename(fileArg) : (fileArg?.name || "file");
    return {
      name: fileName,
      path: typeof fileArg === "string" ? fileArg : (fileArg?.path || fileName),
      size: 1024 * 1024 * 2,
      uploadedToDrive: false,
    };
  }
});

// Partner Drive & Cloud File Download
ipcMain.handle("download-drive-file", async (_event, fileInfo) => {
  try {
    const fileId = fileInfo.id;
    const fileName = fileInfo.name || "shared_file";
    const downloadsDir = path.join(os.homedir(), "Downloads");
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
    let targetPath = path.join(downloadsDir, fileName);
    if (fs.existsSync(targetPath)) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      targetPath = path.join(downloadsDir, `${base}_${Date.now()}${ext}`);
    }

    // Try Google Drive direct download if fileId is valid Google Drive ID
    const sa = loadServiceAccount();
    if (fileId && (!fileId.includes(".") || fileInfo.driveId)) {
      try {
        const actualId = fileInfo.driveId || fileId;
        console.log(`[Google Drive]: Downloading ${fileName} (ID: ${actualId}) from Drive...`);
        await downloadFileFromDrive({
          fileId: actualId,
          apiKey: activeSettings.gdriveApiKey,
          serviceAccount: sa,
          targetPath,
        });
        console.log(`[Google Drive]: File saved directly to ${targetPath}`);
        return { success: true, localPath: targetPath };
      } catch (gErr) {
        console.warn("[Google Drive]: Direct Drive download failed, attempting cloud fallback:", gErr.message);
      }
    }

    // Fallback: Cloud Relay Download
    const shareBin = activeSettings.shareChannel || "coucou-badsha-ayzil";
    let downloadUrl = fileInfo.downloadUrl;
    if (!downloadUrl) {
      downloadUrl = `https://filebin.net/${encodeURIComponent(shareBin)}/${encodeURIComponent(fileName)}`;
    }

    console.log(`[File Download]: Downloading ${fileName} from ${downloadUrl}...`);
    let res = await fetch(downloadUrl, {
      headers: { "User-Agent": "curl/8.0" },
    });
    if (!res.ok && fileInfo.webContentLink) {
      res = await fetch(fileInfo.webContentLink);
    }
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
    console.log(`[File Download]: File successfully written to ${targetPath}`);
    return { success: true, localPath: targetPath };
  } catch (err) {
    console.error("[File Download] Error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("select-service-account", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Google Service Account JSON Key",
    filters: [{ name: "JSON Files", extensions: ["json"] }],
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const selectedPath = result.filePaths[0];
  try {
    const raw = fs.readFileSync(selectedPath, "utf-8");
    const sa = JSON.parse(raw);
    if (!sa.client_email || !sa.private_key) {
      return { success: false, error: "Selected JSON is not a valid Google Service Account key (missing client_email or private_key)." };
    }

    fs.writeFileSync(serviceAccountPath, JSON.stringify(sa, null, 2), "utf-8");
    console.log(`[Service Account]: Successfully saved key for ${sa.client_email}`);
    return { success: true, email: sa.client_email };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-service-account-status", () => {
  const sa = loadServiceAccount();
  return {
    configured: !!sa,
    email: sa?.client_email || "",
  };
});

ipcMain.handle("open-path", (_event, filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return true;
    }
  } catch (e) {
    console.warn("Failed to open path:", e);
  }
  return false;
});

ipcMain.handle("google-oauth-start", async (_event, creds) => {
  try {
    const { clientId, clientSecret } = creds || {};
    if (!clientId || !clientSecret) {
      return { success: false, error: "Please enter or select your Client ID and Client Secret first." };
    }

    const { authUrl, serverStarted, completion } = startGoogleOAuthFlow({ clientId, clientSecret });
    await serverStarted;
    await shell.openExternal(authUrl);

    const result = await completion;
    if (result.success) {
      activeSettings.googleOAuth = {
        clientId,
        clientSecret,
        refreshToken: result.refreshToken,
        email: result.email,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(activeSettings, null, 2), "utf-8");
      console.log(`[Google OAuth]: Successfully connected as ${result.email}`);
      return { success: true, email: result.email };
    }
    return { success: false, error: "Failed to authorize" };
  } catch (err) {
    console.error("[Google OAuth Error]:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("google-oauth-disconnect", async () => {
  delete activeSettings.googleOAuth;
  fs.writeFileSync(settingsPath, JSON.stringify(activeSettings, null, 2), "utf-8");
  return { success: true };
});

ipcMain.handle("google-oauth-status", () => {
  const oauth = activeSettings.googleOAuth;
  return {
    connected: !!(oauth && oauth.refreshToken),
    email: oauth?.email || "",
    clientId: oauth?.clientId || "",
    clientSecret: oauth?.clientSecret || "",
  };
});

ipcMain.handle("select-oauth-client", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Google OAuth Client JSON (client_secret_*.json)",
    filters: [{ name: "JSON Files", extensions: ["json"] }],
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  try {
    const raw = fs.readFileSync(result.filePaths[0], "utf-8");
    const json = JSON.parse(raw);
    const client = json.installed || json.web;
    if (!client || !client.client_id || !client.client_secret) {
      return { success: false, error: "Invalid OAuth Client JSON. Must contain 'installed' or 'web' with client_id and client_secret." };
    }
    return {
      success: true,
      clientId: client.client_id,
      clientSecret: client.client_secret,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("test-drive-connection", async () => {
  const folderId = activeSettings.gdriveFolderId || "1d-IQvgmZTBDcUkIy7f_kJHl2YCgc80CE";
  const oauth = activeSettings.googleOAuth;
  const sa = loadServiceAccount();

  let readOk = false;
  let writeOk = false;
  let folderName = "";
  let saEmail = "";
  let method = "";
  let error = "";

  if (oauth && oauth.refreshToken && oauth.clientId && oauth.clientSecret) {
    method = "oauth";
    saEmail = oauth.email || "Google Account";
    try {
      const accessToken = await refreshOAuthAccessToken({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        refreshToken: oauth.refreshToken,
      });
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,capabilities`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        readOk = true;
        folderName = data.name || "FILES SHARED";
        writeOk = !!data.capabilities?.canAddChildren;
      } else {
        error = `Folder access HTTP ${res.status}: Make sure folder "${folderId}" is accessible by ${oauth.email}.`;
      }
    } catch (e) {
      error = e.message;
    }
  } else if (sa) {
    method = "service_account";
    saEmail = sa.client_email || "";
    try {
      const token = await getAccessToken(sa);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,capabilities`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        readOk = true;
        folderName = data.name || "FILES SHARED";
        writeOk = !!data.capabilities?.canAddChildren;
      } else {
        error = `Folder access HTTP ${res.status}: Share folder "${folderId}" with ${sa.client_email} as Editor!`;
      }
    } catch (e) {
      error = e.message;
    }
  }

  return { readOk, writeOk, folderName, saEmail, method, error };
});

// Cloud Relay Polling Watcher (Instant Partner Sync)
let isFirstCloudPoll = true;
async function checkCloudShareForNewFiles() {
  try {
    const shareBin = activeSettings.shareChannel || "coucou-badsha-ayzil";
    const url = `https://filebin.net/${encodeURIComponent(shareBin)}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.files || !Array.isArray(data.files)) return;

    if (isFirstCloudPoll) {
      for (const f of data.files) {
        knownDriveFileIds.add(f.filename);
      }
      isFirstCloudPoll = false;
      return;
    }

    for (const f of data.files) {
      if (!knownDriveFileIds.has(f.filename)) {
        knownDriveFileIds.add(f.filename);

        if (!myUploadedFileIds.has(f.filename)) {
          console.log(`[Cloud Share]: Detected new partner file: ${f.filename} (${f.bytes} bytes)`);

          const isMe = (activeSettings.userRole || "me") === "me";
          const rawPartner = isMe ? (activeSettings.partnerName || "Ayzil") : (activeSettings.userName || "Badsha");
          const pName = rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1);
          if (Notification.isSupported()) {
            try {
              const notif = new Notification({
                title: `📁 New File from ${pName}`,
                body: `${f.filename} is ready to download!`,
              });
              notif.on("click", () => {
                if (overlayWin && !overlayWin.isDestroyed()) {
                  overlayWin.show();
                  overlayWin.focus();
                }
              });
              notif.show();
            } catch (ne) {
              console.warn("Notification error:", ne);
            }
          }

          if (overlayWin && !overlayWin.isDestroyed()) {
            if (isCollapsed) {
              isCollapsed = false;
              overlayWin.show();
            }

            overlayWin.webContents.send("incoming-file", {
              id: f.filename,
              name: f.filename,
              size: Number(f.bytes || 0),
              mimeType: f["content-type"],
              downloadUrl: `https://filebin.net/${encodeURIComponent(shareBin)}/${encodeURIComponent(f.filename)}`,
              partnerName: pName,
              time: f.created_at,
            });
          }
        }
      }
    }
  } catch (err) {
    // quiet poll
  }
}

// Google Drive Background Polling Watcher
async function checkDriveFolderForNewFiles() {
  const folderId = activeSettings.gdriveFolderId || "1d-IQvgmZTBDcUkIy7f_kJHl2YCgc80CE";
  const oauth = activeSettings.googleOAuth;
  const sa = loadServiceAccount();
  const apiKey = activeSettings.gdriveApiKey;

  let headers = {};
  let queryUrl = "";

  if (oauth && oauth.refreshToken && oauth.clientId && oauth.clientSecret) {
    try {
      const accessToken = await refreshOAuthAccessToken({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        refreshToken: oauth.refreshToken,
      });
      headers = { Authorization: `Bearer ${accessToken}` };
      queryUrl = `https://www.googleapis.com/drive/v3/files?q='${encodeURIComponent(folderId)}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,webContentLink,webViewLink,createdTime)&orderBy=createdTime+desc&pageSize=10`;
    } catch {}
  } else if (sa) {
    try {
      const token = await getAccessToken(sa);
      headers = { Authorization: `Bearer ${token}` };
      queryUrl = `https://www.googleapis.com/drive/v3/files?q='${encodeURIComponent(folderId)}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,webContentLink,webViewLink,createdTime)&orderBy=createdTime+desc&pageSize=10`;
    } catch {}
  } else if (apiKey) {
    queryUrl = `https://www.googleapis.com/drive/v3/files?q='${encodeURIComponent(folderId)}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,webContentLink,webViewLink,createdTime)&orderBy=createdTime+desc&pageSize=10&key=${apiKey}`;
  }

  if (!queryUrl) return;

  try {
    const res = await fetch(queryUrl, { headers });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.files || !Array.isArray(data.files)) return;

    if (isFirstDrivePoll) {
      for (const f of data.files) {
        knownDriveFileIds.add(f.id);
      }
      isFirstDrivePoll = false;
      return;
    }

    for (const f of data.files) {
      if (!knownDriveFileIds.has(f.id)) {
        knownDriveFileIds.add(f.id);

        if (!myUploadedFileIds.has(f.id)) {
          console.log(`[Drive Watcher] Detected new partner file: ${f.name} (${f.id})`);

          const isMe = (activeSettings.userRole || "me") === "me";
          const rawPartner = isMe ? (activeSettings.partnerName || "Ayzil") : (activeSettings.userName || "Badsha");
          const pName = rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1);
          if (Notification.isSupported()) {
            try {
              const notif = new Notification({
                title: `📁 New Drive File from ${pName}`,
                body: `${f.name} is ready in your shared folder!`,
              });
              notif.on("click", () => {
                if (overlayWin && !overlayWin.isDestroyed()) {
                  overlayWin.show();
                  overlayWin.focus();
                }
              });
              notif.show();
            } catch (ne) {
              console.warn("Notification error:", ne);
            }
          }

          if (overlayWin && !overlayWin.isDestroyed()) {
            if (isCollapsed) {
              isCollapsed = false;
              overlayWin.show();
            }

            overlayWin.webContents.send("incoming-file", {
              id: f.id,
              name: f.name,
              size: Number(f.size || 0),
              mimeType: f.mimeType,
              webContentLink: f.webContentLink,
              webViewLink: f.webViewLink,
              partnerName: pName,
              time: f.createdTime,
            });
          }
        }
      }
    }
  } catch (err) {
    // quiet poll
  }
}

setInterval(checkCloudShareForNewFiles, 8000);
setTimeout(checkCloudShareForNewFiles, 1500);

setInterval(checkDriveFolderForNewFiles, 12000);
setTimeout(checkDriveFolderForNewFiles, 3000);

// Schedule Management & Cross-PC Syncing
let lastLocalScheduleUpdate = Date.now();

async function syncScheduleToPartner() {
  // 1. Live WebSocket Broadcast via Supabase Realtime (<50ms latency)
  try {
    const isMe = (activeSettings.userRole || "me") === "me";
    const rawMe = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
    const currentUserName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);
    await broadcastScheduleUpdate({
      items: activeSchedule,
      senderName: currentUserName,
      senderRole: activeSettings.userRole || "me",
    });
  } catch (sbErr) {
    console.warn("[Supabase Realtime] Task broadcast error:", sbErr.message);
  }

  // 2. Fallback relay
  const shareBin = activeSettings.shareChannel || "coucou-badsha-ayzil";
  try {
    const uploadUrl = `https://filebin.net/${encodeURIComponent(shareBin)}/schedule_sync.json`;
    lastLocalScheduleUpdate = Date.now();
    const payload = JSON.stringify({
      updatedAt: lastLocalScheduleUpdate,
      updatedBy: activeSettings.userName || "User",
      items: activeSchedule,
    });
    await fetch(uploadUrl, {
      method: "POST",
      headers: { "filename": "schedule_sync.json", "content-type": "application/json" },
      body: payload,
    });
  } catch (err) {
    console.warn("[Schedule Sync] Broadcast error:", err.message);
  }

  // 3. 24/7 Persistent Cloud Database save (so offline partner gets it on boot)
  try {
    await saveAllTasksToCloud(activeSchedule, activeSettings.shareChannel || "coucou-badsha-ayzil");
  } catch (dbErr) {}
}

async function checkRemoteScheduleUpdates() {
  const shareBin = activeSettings.shareChannel || "coucou-badsha-ayzil";
  try {
    const url = `https://filebin.net/${encodeURIComponent(shareBin)}/schedule_sync.json`;
    const res = await fetch(url, { headers: { "User-Agent": "curl/8.0" } });
    if (!res.ok) return;
    const remote = await res.json();
    if (remote && remote.updatedAt && remote.updatedAt > lastLocalScheduleUpdate && Array.isArray(remote.items)) {
      if (remote.updatedBy !== (activeSettings.userName || "User")) {
        console.log(`[Schedule Sync] Received schedule update from ${remote.updatedBy}!`);
        lastLocalScheduleUpdate = remote.updatedAt;
        activeSchedule = remote.items;
        saveSchedule(activeSchedule);
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("schedule-updated", activeSchedule);
        }
      }
    }
  } catch (e) {
    // quiet
  }
}

setInterval(checkRemoteScheduleUpdates, 7000);

ipcMain.handle("get-schedule", () => activeSchedule);

ipcMain.handle("save-schedule-item", (_event, item) => {
  const existingIndex = activeSchedule.findIndex((s) => s.id === item.id);
  if (existingIndex >= 0) {
    activeSchedule[existingIndex] = item;
  } else {
    activeSchedule.push(item);
  }
  saveSchedule(activeSchedule);
  syncScheduleToPartner();
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("schedule-updated", activeSchedule);
  }
  return activeSchedule;
});

ipcMain.handle("delete-schedule-item", (_event, id) => {
  activeSchedule = activeSchedule.filter((s) => s.id !== id);
  saveSchedule(activeSchedule);
  syncScheduleToPartner();
  try {
    deleteTaskFromCloud(id, activeSettings.shareChannel || "coucou-badsha-ayzil");
  } catch (e) {}
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("schedule-updated", activeSchedule);
  }
  return activeSchedule;
});

ipcMain.handle("toggle-schedule-item", (_event, id) => {
  const item = activeSchedule.find((s) => s.id === id);
  if (item) {
    item.completed = !item.completed;
    if (item.completed) item.completedAt = Date.now();
    saveSchedule(activeSchedule);
    syncScheduleToPartner();
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("schedule-updated", activeSchedule);
    }
  }
  return activeSchedule;
});

// Secrets
ipcMain.handle("secret-set", (_event, { key, val }) => {
  activeSettings[key] = val;
  saveSettings(activeSettings);
  return true;
});

ipcMain.handle("secret-get", (_event, key) => activeSettings[key] || "");
ipcMain.handle("secret-clear", (_event, key) => {
  delete activeSettings[key];
  saveSettings(activeSettings);
  return true;
});

// ── Productivity & Focus IPC Handlers (Baymax / Distrack) ───────────────────
ipcMain.handle("get-tracked-apps", (_, timeframe) => {
  if (!productivityTracker) return [];
  if (timeframe === "weekly") return productivityTracker.getWeekApps();
  return productivityTracker.getTodayApps();
});

ipcMain.handle("get-daily-totals", () => {
  if (!productivityTracker) return [];
  return productivityTracker.getDailyTotals();
});

ipcMain.handle("get-app-categories", () => {
  return productivityStore ? productivityStore.get("appCategories", {}) : {};
});

ipcMain.handle("update-app-category", (_, processNameOrData, category) => {
  if (!productivityStore) return true;
  let processName = processNameOrData;
  let cat = category;
  if (typeof processNameOrData === "object" && processNameOrData !== null) {
    processName = processNameOrData.id || processNameOrData.processName || processNameOrData.name;
    cat = processNameOrData.category;
  }
  if (!processName) return true;
  const cats = productivityStore.get("appCategories", {});
  cats[processName.toLowerCase()] = cat;
  productivityStore.set("appCategories", cats);
  const dateKey = getLocalDateKey();
  const usage = productivityStore.get(`usageData.${dateKey}`, {});
  const key = processName.toLowerCase();
  if (usage[key]) {
    usage[key].category = cat;
    productivityStore.set(`usageData.${dateKey}`, usage);
  }
  return true;
});

ipcMain.handle("scan-running-apps", () => {
  return new Promise((resolve) => {
    const { execFile } = require("node:child_process");
    execFile("powershell.exe", [
      "-NoProfile", "-NoLogo", "-NonInteractive", "-Command", WINDOW_SCANNER_SCRIPT
    ], { windowsHide: true, timeout: 10000 }, async (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        return resolve([]);
      }
      try {
        let data = JSON.parse(stdout.trim());
        if (!Array.isArray(data)) data = [data];
        const categories = productivityStore ? productivityStore.get("appCategories", {}) : {};
        const resultPromises = data
          .filter((p) => p && p.ProcessName && !SYSTEM_IGNORED_PROCS.includes(p.ProcessName.toLowerCase()))
          .map(async (p) => {
            const key = p.ProcessName.toLowerCase();
            let iconDataUrl = null;
            if (p.Path) {
              try {
                const img = await app.getFileIcon(p.Path, { size: "normal" });
                iconDataUrl = img.toDataURL();
              } catch (e) {}
            }
            return {
              id: key,
              name: p.ProcessName,
              windowTitle: p.MainWindowTitle || "",
              timeSpentMinutes: 0,
              category: categories[key] || DEFAULT_CATEGORIES[key] || "neutral",
              type: "application",
              icon: iconDataUrl || ICON_MAP[key] || "apps",
            };
          });
        const result = await Promise.all(resultPromises);
        const unique = [...new Map(result.map((r) => [r.id, r])).values()];
        resolve(unique);
      } catch (e) {
        resolve([]);
      }
    });
  });
});

ipcMain.handle("get-focus-sessions", () => {
  return productivityStore ? productivityStore.get("focusSessions", []) : [];
});

ipcMain.handle("add-focus-session", (_, session) => {
  if (!productivityStore) return true;
  const sessions = productivityStore.get("focusSessions", []);
  sessions.unshift({ ...session, id: Date.now().toString() });
  if (sessions.length > 100) sessions.length = 100;
  productivityStore.set("focusSessions", sessions);
  return true;
});

ipcMain.handle("set-focus-sessions", (_, sessions) => {
  if (productivityStore) productivityStore.set("focusSessions", sessions || []);
  return true;
});

ipcMain.handle("start-focus-session", (_, config) => {
  if (productivityBlocker) productivityBlocker.start(config);
  broadcastToProductivity("focus-state-changed", { active: true, config });
  return true;
});

ipcMain.handle("stop-focus-session", () => {
  if (productivityBlocker) productivityBlocker.stop();
  broadcastToProductivity("focus-state-changed", { active: false });
  return true;
});

ipcMain.handle("get-focus-active", () => {
  return productivityBlocker ? productivityBlocker.isActive : false;
});

ipcMain.handle("get-blocklist", () => {
  return productivityStore ? productivityStore.get("blocklist", []) : [];
});

ipcMain.handle("toggle-block-app", (_, appId) => {
  if (!productivityStore) return [];
  const list = productivityStore.get("blocklist", []);
  const idx = list.indexOf(appId);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(appId);
  productivityStore.set("blocklist", list);
  return list;
});

ipcMain.handle("set-blocklist", (_, newList) => {
  if (productivityStore) productivityStore.set("blocklist", newList || []);
  return newList || [];
});

ipcMain.handle("get-settings", () => {
  return productivityStore ? productivityStore.get("settings", STORE_DEFAULTS.settings) : STORE_DEFAULTS.settings;
});

ipcMain.handle("update-settings", (_, newSettings) => {
  if (!productivityStore) return newSettings;
  const current = productivityStore.get("settings", STORE_DEFAULTS.settings);
  const merged = { ...current, ...newSettings };
  productivityStore.set("settings", merged);
  return merged;
});

ipcMain.handle("clear-data", () => {
  if (productivityStore) {
    productivityStore.set("usageData", {});
    productivityStore.set("focusSessions", []);
  }
  return true;
});

ipcMain.handle("is-onboarded", () => {
  return productivityStore ? productivityStore.get("onboarded", true) : true;
});

ipcMain.handle("set-onboarded", () => {
  if (productivityStore) productivityStore.set("onboarded", true);
  return true;
});

ipcMain.handle("get-user-profile", () => {
  if (!productivityStore) return { name: "Badsha", email: "user@baymax.local", emailVerified: true };
  const prof = productivityStore.get("userProfile", {});
  if (!prof.name) {
    const isMe = (activeSettings.userRole || "me") === "me";
    const uName = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
    return { name: uName, email: `${uName.toLowerCase()}@baymax.local`, picture: "", emailVerified: true };
  }
  return prof;
});

ipcMain.handle("set-user-profile", (_, profile) => {
  if (productivityStore) productivityStore.set("userProfile", profile);
  return true;
});

ipcMain.handle("kill-process", (_, processName) => {
  return new Promise((resolve) => {
    const { execFile } = require("node:child_process");
    execFile("taskkill.exe", ["/IM", `${processName}.exe`, "/F"], { windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
});

ipcMain.handle("google-sign-in", async () => {
  const isMe = (activeSettings.userRole || "me") === "me";
  const uName = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
  return { name: uName, email: `${uName.toLowerCase()}@baymax.local`, emailVerified: true };
});

ipcMain.handle("send-otp-email", async () => {
  return true;
});

ipcMain.on("open-productivity-window", () => {
  createProductivityWindow();
});

ipcMain.handle("open-productivity-window", () => {
  createProductivityWindow();
  return true;
});

// App Lifecycle
app.whenReady().then(() => {
  if (session && session.defaultSession) {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      // Allow media, display-capture, notifications, etc.
      callback(true);
    });
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => {
          callback({ video: sources[0] || null });
        })
        .catch(() => {
          callback({ video: null });
        });
    });
  }

  // Initialize Productivity & Focus Tracker Engine
  try {
    productivityStore = new Store(STORE_DEFAULTS);
    const isMe = (activeSettings.userRole || "me") === "me";
    const currentUserName = isMe ? (activeSettings.userName || "Badsha") : (activeSettings.partnerName || "Ayzil");
    const existingProfile = productivityStore.get("userProfile", {});
    if (!existingProfile.name) {
      productivityStore.set("userProfile", {
        name: currentUserName,
        email: `${currentUserName.toLowerCase()}@baymax.local`,
        picture: "",
        emailVerified: true,
      });
      productivityStore.set("onboarded", true);
    }

    productivityTracker = new AppTracker(
      productivityStore,
      broadcastToProductivity,
      () => (productivityBlocker ? productivityBlocker.isActive : false),
      handleFocusDistractionAlert
    );

    productivityBlocker = new AppBlocker(
      productivityStore,
      broadcastToProductivity,
      handleFocusDistractionAlert
    );

    productivityTracker.start();
    console.log("[Productivity Engine] Tracker and Blocker initialized successfully.");
  } catch (prodErr) {
    console.error("[Productivity Engine] Initialization error:", prodErr);
  }

  setupTray();
  createOverlayWindow();
  startMochiLiveEngine();
  startSupabaseSync();
  applyStartupMode(activeSettings.autostart);

  // Background check for updates 10 seconds after launch
  setTimeout(async () => {
    try {
      const check = await checkForUpdates();
      if (check && check.updateAvailable && overlayWin && !overlayWin.isDestroyed()) {
        console.log("[Updater] Update available on GitHub:", check.remote?.commitShort, check.remote?.message);
        overlayWin.webContents.send("update-available", check);
      }
    } catch (err) {
      console.warn("[Updater] Background check failed:", err);
    }
  }, 10000);

  app.on("activate", () => {
    if (!overlayWin || overlayWin.isDestroyed()) {
      createOverlayWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (productivityTracker) {
    try { productivityTracker.stop(); } catch (e) {}
  }
  if (productivityBlocker) {
    try { productivityBlocker.stop(); } catch (e) {}
  }
  if (productivityStore) {
    try { productivityStore.saveSync(); } catch (e) {}
  }
  stopMochiLiveEngine();
});

app.on("window-all-closed", () => {
  // Do not quit when windows are closed; keep companion alive in tray and top bar
});

process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Unhandled Rejection]:", reason);
});
