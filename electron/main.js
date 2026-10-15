const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell, dialog, Notification, session, desktopCapturer } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const secrets = require("./secretSettings");
const { normalizeCompanion } = require("./companion");
const { PushToTalkService, parseShortcut } = require("./pushToTalk");
const { terminateProcessTree } = require('./processTree');
const { syncInterestsMemory } = require('./interests');
const { MusicStore, MusicExtractor, cleanMusicSignal } = require('./music');
const { cleanVoiceSignal } = require('./voiceCall');
let voiceCallActive = false, voiceCallSession = '', musicSession = '';
const seenCallRings = new Set();
const { safeStorage } = require("electron");
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
  broadcastRemoteAccess: transportRemoteAccess,
  broadcastMusicSignal,
  broadcastVoiceSignal,
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

const { RemoteSession } = require('./remoteSession');
const remoteSession = new RemoteSession();
const {VideoPlayer}=require('./videoPlayer');
const videoPlayer=new VideoPlayer({BrowserWindow,ipcMain});
const appCommands = require('./appCommands');
async function broadcastRemoteAccess(payload) {
  const session = remoteSession.current();
  const sessionId = payload.sessionId || session?.id;
  if (!sessionId) return false;
  if (!['request', 'response', 'end'].includes(payload.action) && !session?.accepted) return false;
  if (payload.action === 'end') remoteSession.end();
  return transportRemoteAccess({ ...payload, sessionId });
}

function isTrustedRendererUrl(url) {
  if (!url) return false;
  const { pathToFileURL } = require('node:url');
  const allowed = ['dist/index.html', 'dist/settings.html', 'dist/island.html', 'productivity/dist/index.html', 'public/remote-viewer.html', 'electron/video.html'].map(p => pathToFileURL(path.join(__dirname, '..', p)).href);
  try { const parsed = new URL(url); parsed.hash = ''; parsed.search = ''; return ['baymax://app/index.html','baymax://app/settings.html','baymax://app/productivity/index.html'].includes(parsed.href) || allowed.includes(parsed.href) || (!app.isPackaged && ['http://localhost:1420','http://localhost:3000'].includes(parsed.origin)); } catch { return false; }
}
const registerHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => registerHandle(channel, (event, ...args) => {
  if (!isTrustedRendererUrl(event.senderFrame?.url)) throw new Error('Untrusted IPC sender');
  account.guardIPC(channel,args);
  return handler(event, ...args);
});
const checkoutContents=new WeakSet();
const navigationAllowed=(contents,url)=>checkoutContents.has(contents)?String(url).startsWith('https://'):isTrustedRendererUrl(url);
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!navigationAllowed(contents,url)) event.preventDefault(); });
  contents.on('will-frame-navigate', event => { if (!navigationAllowed(contents,event.url)) event.preventDefault(); });
});

const { protocol, net } = require('electron');
const { registerAppScheme, installAppProtocol } = require('./appProtocol');
registerAppScheme(protocol);

// Enable Windows Graphics Capture (WGC) for reliable capture across hybrid/multi-GPU systems
app.commandLine.appendSwitch("enable-features", "WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer");

if (process.env.BAYMAX_USER_DATA) app.setPath("userData", path.resolve(process.env.BAYMAX_USER_DATA));
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
const {AccountService}=require('./account');
let checkoutWindow=null;
async function openMembershipCheckout(url){
  if(checkoutWindow&&!checkoutWindow.isDestroyed())checkoutWindow.close();
  const popup=new BrowserWindow({width:510,height:720,minWidth:420,minHeight:550,show:false,title:'Baymax · Secure checkout',backgroundColor:'#17201f',autoHideMenuBar:true,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,partition:'baymax-checkout-'+require('node:crypto').randomUUID()}});
  checkoutWindow=popup;
  checkoutContents.add(popup.webContents);
  popup.webContents.on('will-navigate',(event,target)=>{if(!target.startsWith('https://'))event.preventDefault();});
  popup.webContents.setWindowOpenHandler(({url:target})=>{if(target.startsWith('https://'))void shell.openExternal(target);return {action:'deny'};});
  popup.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  popup.on('closed',()=>{if(checkoutWindow===popup)checkoutWindow=null;void account.refresh();});
  popup.once('ready-to-show',()=>popup.show());
  try{await popup.loadURL(url);}catch(error){if(!popup.isDestroyed())popup.close();throw error;}
}
const account=new AccountService({folder:userDataDir,safeStorage,openExternal:url=>shell.openExternal(url),openCheckout:openMembershipCheckout});
ipcMain.handle('account-snapshot',()=>account.snapshot());
ipcMain.handle('account-files',(_e,op,args)=>require('./cloudFiles').cloudFiles(account,dialog,op,args));
ipcMain.handle('account-config',(_event,value)=>account.saveConfig(value));
ipcMain.handle('account-login',()=>account.startLogin());
ipcMain.handle('account-cancel-login',()=>{account.cancelLogin();return true;});
ipcMain.handle('account-logout',()=>account.logout());
ipcMain.handle('account-refresh',()=>account.refresh());
ipcMain.handle('account-action',(_event,op,args)=>account.action(op,args));
ipcMain.handle('account-billing',(_event,op,args)=>account.billing(op,args));
const schedulePath = path.join(userDataDir, "schedule.json");
const serviceAccountPath = path.join(userDataDir, "service-account.json");
const companionIconPath = path.join(userDataDir, "companion-icon.png");
let companionIcon = null;
function currentCompanionIcon() {
  if (!companionIcon) {
    companionIcon = nativeImage.createFromPath(fs.existsSync(companionIconPath) ? companionIconPath : path.join(__dirname, '../public/icons/icon.png'));
    if (companionIcon.isEmpty()) companionIcon = nativeImage.createFromPath(path.join(__dirname, '../public/icons/icon.png'));
  }
  return companionIcon;
}
app.on('browser-window-created', (_, window) => window.setIcon(currentCompanionIcon()));
ipcMain.handle('get-companion-icon', () => currentCompanionIcon().toDataURL());
ipcMain.handle('set-companion-icon', (_event, png) => {
  if (typeof png !== 'string' || png.length > 180000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png)) throw new Error('Invalid companion portrait');
  const bytes = Buffer.from(png.slice(22), 'base64');
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== 128 || bytes.readUInt32BE(20) !== 128) throw new Error('Invalid portrait dimensions');
  const icon = nativeImage.createFromBuffer(bytes);
  if (icon.isEmpty()) throw new Error('Could not read companion portrait');
  fs.writeFileSync(companionIconPath, icon.toPNG());
  companionIcon = icon;
  tray?.setImage(icon.resize({ width: 32, height: 32 }));
  for (const window of BrowserWindow.getAllWindows()) {
    window.setIcon(icon);
    window.webContents.send('companion-icon-changed', icon.toDataURL());
  }
  return true;
});

function loadServiceAccount() {
  try {
    if (fs.existsSync(serviceAccountPath)) {
      return secrets.reveal(JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8")), safeStorage);
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
  userName: "You",
  partnerName: "Partner",
  userRole: "me", // "me" | "her"
  gdriveApiKey: "",
  gdriveFolderId: "",
  gdriveUploadUrl: "",
  shareChannel: "coucou-badsha-ayzil",
  syncUrl: "",
  syncApiKey: "",
  appPaths: {},
  // Baymax PC Control & Agent Engine Defaults
  assistantName: "Baymax",
  voiceName: "Charon",
  wakeWordEnabled: false,
  pushToTalkEnabled: false,
  pushToTalkKey: "Control+Space",
  proactiveAudio: true,
  proactiveTalkingEnabled: false,
  musicHeadphonesEnabled: true,
  userInterests: '',
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
  if (!app.isReady()) return { ...DEFAULT_SETTINGS };
  try {
    if (fs.existsSync(settingsPath)) {
      const loaded = { ...DEFAULT_SETTINGS, ...secrets.decodeSettings(JSON.parse(fs.readFileSync(settingsPath, "utf-8")), safeStorage) };
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
        loaded.userName = "You";
      }
      if (!loaded.partnerName || loaded.partnerName === "Her") {
        loaded.partnerName = "Partner";
      }
      if (loaded.geminiModel === "gemini-3.8-flash" || loaded.geminiModel === "gemini-2.0-flash") {
        loaded.geminiModel = "gemini-2.5-flash";
      }
      return loaded;
    }
  } catch (err) {
    console.error("Failed to read settings:", err);
    throw new Error("Settings could not be decrypted/read. The original settings file has been preserved.");
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    const temporary = settingsPath + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(secrets.encodeSettings(settings, safeStorage), null, 2), "utf-8");
    fs.renameSync(temporary, settingsPath);
  } catch (err) {
    console.error("Failed to save settings:", err);
    throw err;
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
  // An isolated development/QA profile must not alter the user's login startup.
  if (process.env.BAYMAX_USER_DATA) return;
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

const {readArray, writeJson} = require('./jsonFiles');
function accountFile(base,pairScoped=false){
  if(!account.configured)return base;
  const state=account.snapshot(),scope=state.user?.id||'signed-out';
  const folder=path.join(userDataDir,'accounts',scope,pairScoped?(state.pair?.id||'unpaired'):'local');fs.mkdirSync(folder,{recursive:true});
  return path.join(folder,path.basename(base));
}
function loadSchedule() {
  if(!account.configured)return readArray(schedulePath);
  const local=readArray(accountFile(schedulePath)).map(t=>({...t,syncPairId:null}));
  const pair=account.snapshot().pair?.id;
  return pair?[...local,...readArray(accountFile(schedulePath,true)).map(t=>({...t,syncPairId:pair}))]:local;
}
const { mergeTasks, stampTasks } = require('./taskSync');
function saveSchedule(items) {
  stampTasks(items, loadSchedule());
  if(!account.configured){writeJson(schedulePath,items);return;}
  const pair=account.snapshot().pair?.id;
  for(const item of items)if(item.syncPairId===undefined)item.syncPairId=pair||null;
  writeJson(accountFile(schedulePath),items.filter(t=>!t.syncPairId));
  if(pair)writeJson(accountFile(schedulePath,true),items.filter(t=>t.syncPairId===pair));
}

let activeSettings = loadSettings();
let activeSchedule = loadSchedule();

const chatHistoryPath = path.join(userDataDir, "chat_history.json");

function loadChatHistory() { return readArray(accountFile(chatHistoryPath,true)); }
function saveChatHistory(history) { writeJson(accountFile(chatHistoryPath,true), history); }

const engineDir = app.isPackaged ? path.join(process.resourcesPath, "engine") : path.join(__dirname, "..", "engine");
const engineDataDir = app.isPackaged ? path.join(userDataDir, "engine") : engineDir;
process.env.BAYMAX_ENGINE_DATA = engineDataDir;
const musicStore = new MusicStore(userDataDir);
const musicExtractor = new MusicExtractor(() => ({file:resolvePythonPath(), prefix:app.isPackaged ? ['python','-m','yt_dlp'] : ['-m','yt_dlp'],runtime:process.execPath,pythonPath:app.isPackaged ? undefined : path.join(__dirname,'..','.build-cache','music-core')}));
const { SharedMusicStore } = require('./sharedMusic');
function sharedMusicStore() { return new SharedMusicStore(userDataDir,account.configured?(account.snapshot().user?.id||'signed-out')+'|'+(account.snapshot().pair?.id||'unpaired'):(activeSettings.syncUrl || '')+'|'+(activeSettings.shareChannel || 'coucou-badsha-ayzil')); }
function loadMusicLibrary() {
  const library=musicStore.load(), tracks=sharedMusicStore().tracks();
  library.playlists=library.playlists.filter(p=>p.id!=='shared');
  library.playlists.unshift({id:'shared',name:'Our playlist',tracks});
  return library;
}
async function sendPlaylistEntries(entries) {
  const scope=sharedMusicStore().file;
  for(let i=0;i<entries.length;i+=40){
    if(sharedMusicStore().file!==scope)break;
    if(!await broadcastMusicSignal({type:'playlist',entries:entries.slice(i,i+40)}))break;
    if(i+40<entries.length)await new Promise(resolve=>setTimeout(resolve,150));
  }
}
function saveMusicLibrary(library) {
  const shared=library?.playlists?.find(p=>p.id==='shared');
  // Validate the entire library before either persistent file is changed.
  require('./music').cleanLibrary(library);
  if(shared && Array.isArray(library.sharedBase)){
    const changes=sharedMusicStore().edit(library.sharedBase,shared.tracks,activeSettings.userRole==='her'?'her':'me');
    void sendPlaylistEntries(changes);
    shared.tracks=sharedMusicStore().tracks();
  }
  musicStore.save(library);return loadMusicLibrary();
}
ipcMain.handle('music-load', () => loadMusicLibrary());
ipcMain.handle('music-save', (_event, library) => saveMusicLibrary(library));
ipcMain.handle('music-search', (_event, query) => musicExtractor.search(query));
ipcMain.handle('music-resolve', (_event, id, refresh) => musicExtractor.resolve(id, refresh === true));
ipcMain.handle('clipboard:writeText', (_event, text) => {
  if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('Invalid clipboard text');
  require('electron').clipboard.writeText(text); return true;
});
ipcMain.handle('music-signal', (_event, value) => {
  const message=cleanMusicSignal(value);
  if(['join','offer','answer'].includes(message.type))musicSession=message.sessionId;
  if(message.type==='leave' && musicSession===message.sessionId)musicSession='';
  return broadcastMusicSignal(message);
});
ipcMain.handle('voice-signal', (event, value) => {
  if(event.sender!==overlayWin?.webContents)return false;
  const message=cleanVoiceSignal(value);
  if(['ring','accept','offer','answer'].includes(message.type))voiceCallSession=message.sessionId;
  if(['hangup','decline'].includes(message.type) && voiceCallSession===message.sessionId)voiceCallSession='';
  return broadcastVoiceSignal(message);
});
ipcMain.handle('voice-call-active', (event, value) => {
  if(event.sender!==overlayWin?.webContents)return false;
  voiceCallActive=value===true;
  if(!voiceCallActive)voiceCallSession='';
  if(voiceCallActive){cancelTextRequests();resetLiveSpeechOutput('call');}
  sendToLiveEngine({cmd:'call_active',active:voiceCallActive});
  sendToLiveEngine({cmd:'mute',muted:voiceCallActive || activeSettings.micEnabled===false || activeSettings.aiProvider==='groq'});
  return true;
});
async function endPartnerSessions() {
  const signals=[broadcastMusicSignal({type:'status',playing:false,title:''})];
  if(musicSession)signals.push(broadcastMusicSignal({type:'leave',sessionId:musicSession}));
  if(voiceCallSession)signals.push(broadcastVoiceSignal({type:'hangup',sessionId:voiceCallSession}));
  await Promise.race([Promise.allSettled(signals),new Promise(resolve=>setTimeout(resolve,1200))]);
  await Promise.race([disconnectSupabase(),new Promise(resolve=>setTimeout(resolve,800))]);
  musicSession='';voiceCallSession='';voiceCallActive=false;
}

const engineArgs = (mode, args = []) => app.isPackaged ? [mode, ...args] : [path.join(engineDir, { bridge: "mochi_bridge.py", live: "mochi_runner.py", hud: "main.py" }[mode]), ...args];
const bridgeScript = path.join(engineDir, "mochi_bridge.py");
const engineMainScript = path.join(engineDir, "main.py");

function resolvePythonPath() {
  if (app.isPackaged) return path.join(engineDir, "BaymaxEngine.exe");
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

const { EngineBridge } = require('./engineBridge');
const actionBridge = new EngineBridge({
  spawn: () => spawn(resolvePythonPath(), engineArgs('bridge', ['server']), {
    cwd: engineDir, windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  }),
  terminate: terminateProcessTree,
});
function runMochiBridgeCmd(cmd, ...args) {
  let payload = {cmd};
  try {
    if(cmd === 'execute') Object.assign(payload,{name:args[0],parameters:JSON.parse(args[1] || '{}')});
    if(cmd === 'save-memory') Object.assign(payload,{category:args[0],key:args[1],value:args[2]});
    if(cmd === 'delete-memory') Object.assign(payload,{category:args[0],key:args[1]});
    if(cmd === 'sync-config') payload.config=JSON.parse(args[0] || '{}');
  } catch { return Promise.resolve({success:false,error:'Invalid action parameters'}); }
  return actionBridge.request(payload);
}

function syncEngineSettings(settings) {
  try {
    syncEngineConfig(settings);
  } catch (err) {
    console.warn("Failed to sync Baymax config:", err);
  }
}

// Initial Baymax config sync on boot
setTimeout(() => {
  if (app.isReady()) syncEngineSettings(activeSettings);
}, 1000);

let cachedEngineTools = null;

async function getEngineToolDeclarations() {
  if (cachedEngineTools) return cachedEngineTools;
  try {
    const res = await runMochiBridgeCmd("list-actions");
    if (res && res.success && Array.isArray(res.actions)) {
      const enabled = activeSettings.activeActions || {};
      cachedEngineTools = res.actions.filter((a) => enabled[a.name] !== false);
      return cachedEngineTools;
    }
  } catch (err) {
    console.warn("Error fetching Baymax tool declarations:", err);
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
  const rawPartner = isMe ? (activeSettings.partnerName || "Partner") : (activeSettings.userName || "You");
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
  if (isCollapsed && activeSettings.notifyPartnerOnline !== false && Notification.isSupported()) {
    try {
      const notif = new Notification({
        title: `✨ ${displayName} is online! 💖`,
        body: `${displayName} just opened ${displayAssistantName()} and joined.`,
        icon: currentCompanionIcon(),
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
  if (!account.configured && (!activeSettings.syncUrl || !activeSettings.syncApiKey)) {
    console.log("[Supabase Sync] syncUrl or syncApiKey not configured yet.");
    disconnectSupabase();
    return;
  }

  const isMe = (activeSettings.userRole || "me") === "me";
  const rawMe = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
  const rawPartner = isMe ? (activeSettings.partnerName || "Partner") : (activeSettings.userName || "You");
  const currentUserName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);
  const partnerUserName = rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1);
  const partnerRole = isMe ? "her" : "me";

  console.log(`[Supabase Sync] Initializing live Realtime connection for ${currentUserName}...`);
  initSupabase({
    account,
    url: activeSettings.syncUrl,
    key: activeSettings.syncApiKey,
    onStatus: status => { for (const win of [overlayWin, settingsWin]) if (win && !win.isDestroyed()) win.webContents.send('sync-status', status); },
    channelName: activeSettings.shareChannel || "coucou-badsha-ayzil",
    userName: currentUserName,
    userRole: activeSettings.userRole || "me",
    onVoiceSignal: payload => {
      const message=cleanVoiceSignal(payload);
      if(message.type==='ring' && !seenCallRings.has(message.sessionId)) {
        if(!voiceCallActive)voiceCallSession=message.sessionId;
        seenCallRings.add(message.sessionId);
        if(seenCallRings.size>64)seenCallRings.delete(seenCallRings.values().next().value);
        if(!voiceCallActive && isCollapsed && Notification.isSupported()) {
          const notification=new Notification({title:`${partnerUserName} is calling`,body:'Open Baymax to accept or decline.',icon:currentCompanionIcon(),silent:true});
          notification.on('click',()=>{overlayWin?.show();overlayWin?.focus();overlayWin?.webContents.send('open-couple-chat');});notification.show();
        }
      }
      if(['hangup','decline'].includes(message.type) && voiceCallSession===message.sessionId)voiceCallSession='';
      if(overlayWin && !overlayWin.isDestroyed())overlayWin.webContents.send('voice-signal',message);
    },
    onMusicSignal: payload => {
      const message = cleanMusicSignal(payload);
      if(message.type==='playlist'){
        if(sharedMusicStore().merge(message.entries))overlayWin?.webContents.send('music-library',loadMusicLibrary());
        return;
      }
      if(message.type==='probe')void sendPlaylistEntries(sharedMusicStore().load());
      if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('music-signal', message);
    },
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
      if (exists) return;
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

      // Windows Action Center native notification only when island is collapsed
      if (isCollapsed && Notification.isSupported()) {
        try {
          const sender = payload.sender || partnerUserName;
          const notif = new Notification({
            title: `💬 ${sender}`,
            body: payload.text,
            icon: currentCompanionIcon(),
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
            body: `${payload.name} (${sizeMb} MB)\nClick to open in ${displayAssistantName()}`,
            icon: currentCompanionIcon(),
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
        if(account.configured)payload.items=payload.items.map(t=>({...t,syncPairId:account.snapshot().pair?.id}));
        console.log("[Supabase Sync] Real-time task update from:", payload.senderName);
        activeSchedule = mergeTasks(activeSchedule, payload.items);
        saveSchedule(activeSchedule);
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("schedule-updated", activeSchedule.filter(t => !t.deleted));
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
        const justCameOnline = !lastPartnerOnline;
        lastPartnerOnline = true;
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("partner-presence", { online: true, partnerName: partnerUserName, justCameOnline });
        }
        if (justCameOnline) {
          triggerPartnerOnlineNotification(partnerUserName);
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
      if(account.configured&&Array.isArray(payload.schedule))payload.schedule=payload.schedule.map(t=>({...t,syncPairId:account.snapshot().pair?.id}));
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
            overlayWin.webContents.send("partner-chat-history", history);
          }
          if (isCollapsed && Notification.isSupported() && lastMsg) {
            try {
              const notif = new Notification({
                title: `💬 ${lastMsg.sender} (${added} missed message${added > 1 ? "s" : ""})`,
                body: lastMsg.text,
                icon: currentCompanionIcon(),
                silent: false,
              });
              notif.show();
            } catch (e) {}
          }
        }
      }

      if (Array.isArray(payload.schedule) && payload.schedule.length > 0) {
        activeSchedule = mergeTasks(activeSchedule, payload.schedule);
        saveSchedule(activeSchedule);
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("schedule-updated", activeSchedule.filter(t => !t.deleted));
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
      if(!account.caps.pcControl)return;
      console.log("[Supabase Sync] Incoming remote_access:", payload?.action, "from:", payload?.sender);
      if (!remoteSession.receive(payload)) return;

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
        if (payload.cmd && remoteSession.isHost()) {
          injectInput(payload.cmd);
        }
      } else if (action === "end") {
        remoteSession.end();
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
          let newCount = 0, restoredCount = 0;
          let latestNewMsg = null;

          for (const msg of cloudMessages) {
            if (!existingIds.has(msg.id)) {
              const isFromPartner = (msg.sender || "").toLowerCase() !== currentUserName.toLowerCase() &&
                                    (!msg.senderRole || msg.senderRole !== (activeSettings.userRole || "me"));
              history.push({
                ...msg,
                read: !isFromPartner ? true : false,
              });
              existingIds.add(msg.id);restoredCount++;
              if (isFromPartner) {
                newCount++;
                latestNewMsg = msg;
              }
            }
          }

          if (restoredCount > 0) {
            console.log(`[Supabase Cloud DB] Restored ${newCount} offline chat message(s)!`);
            saveChatHistory(history);
            if (overlayWin && !overlayWin.isDestroyed()) {
              overlayWin.webContents.send("partner-chat-history", history);
            }
            if (isCollapsed && Notification.isSupported() && latestNewMsg) {
              try {
                const notif = new Notification({
                  title: `💬 ${latestNewMsg.sender} (${newCount} new message${newCount > 1 ? "s" : ""})`,
                  body: latestNewMsg.text,
                  icon: currentCompanionIcon(),
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
          activeSchedule = mergeTasks(activeSchedule, cloudTasks);
          saveSchedule(activeSchedule);
          if (overlayWin && !overlayWin.isDestroyed()) {
            overlayWin.webContents.send("schedule-updated", activeSchedule.filter(t => !t.deleted));
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
const { pointerInside, createMousePassthrough } = require('./overlayInteraction');
let setMousePassthrough = () => {};
let lastPointer = '';

function startMouseTracking() {
  if (mouseCheckTimer) clearInterval(mouseCheckTimer);
  mouseCheckTimer = setInterval(() => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    try {
      const cursor = screen.getCursorScreenPoint();
      const winBounds = overlayWin.getBounds();
      const rect = currentIslandRect || { x: 240, y: 0, w: 240, h: 40 };

      const x = cursor.x - winBounds.x, y = cursor.y - winBounds.y;
      const inside = pointerInside(x, y, rect, isMouseInsideIsland);
      const pointerKey = `${x},${y},${inside}`;
      setMousePassthrough(!inside);
      if (pointerKey !== lastPointer) {
        lastPointer = pointerKey;
        overlayWin.webContents.send("cursor", { x, y });
      }
      isMouseInsideIsland = inside;
    } catch (e) {}
  }, 40);
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
    show: false,
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
      nodeIntegrationInSubFrames: false,
      backgroundThrottling: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  overlayWin.webContents.on('render-process-gone',()=>{
    if(voiceCallSession)void broadcastVoiceSignal({type:'hangup',sessionId:voiceCallSession});
    voiceCallSession='';voiceCallActive=false;sendToLiveEngine({cmd:'call_active',active:false});
    sendToLiveEngine({cmd:'mute',muted:activeSettings.micEnabled===false || activeSettings.aiProvider==='groq'});
  });

  setMousePassthrough = createMousePassthrough((ignore, options) => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setIgnoreMouseEvents(ignore, options);
  });
  overlayWin.once("ready-to-show", () => overlayWin?.showInactive());
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const isDev = process.env.NODE_ENV === "development";
  const distIndex = path.join(__dirname, "..", "dist", "index.html");

  if (isDev) {
    overlayWin.loadURL("http://localhost:1420");
  } else if (fs.existsSync(distIndex)) {
    overlayWin.loadURL('baymax://app/index.html');
  } else {
    // If not built yet, fallback to dev URL or wait
    overlayWin.loadURL("http://localhost:1420");
  }

  // Pass mouse clicks through outside the island pill to desktop & background apps
  setMousePassthrough(true);
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

function displayAssistantName() {
  return String(activeSettings.assistantName || "Baymax").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40) || "Baymax";
}

function createSettingsWindow() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.show();
    overlayWin.focus();
    overlayWin.webContents.send("open-preferences");
  }
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
  const userName = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
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
        title: `${displayAssistantName()} — Focus Active`,
        body: `Hey ${userName}, "${displayName}" is blocked during your focus session.`,
        silent: false,
      }).show();
    } catch (e) {}
  }

  // 3. Spoken voice intervention via Live Assistant (at most once every 60 seconds)
  if (activeSettings.proactiveTalkingEnabled === true && !liveOutputSuppressed && now - lastVoiceAlertTime > 60000) {
    lastVoiceAlertTime = now;
    sendToLiveEngine({
      cmd: "background",
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
    title: `${displayAssistantName()} — Productivity & Focus`,
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
    productivityWin.loadURL('baymax://app/productivity/index.html');
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
  tray = new Tray(currentCompanionIcon().resize({ width: 32, height: 32 }));
  tray.setToolTip(`${displayAssistantName()} — AI Desktop Companion`);

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

function launchApplication(query) {
  account.guardAction('open_app');
  return appCommands.launchApplication(query, activeSettings.appPaths, productivityTracker?.getKnownApps() || [], shell);
}
function closeApplication(query) {
  account.guardAction('close_app');
  const getRunning = () => new Promise((resolve, reject) => {
    require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOW_SCANNER_SCRIPT],
      { windowsHide: true, timeout: 15000 }, (err, out) => {
        if (err) return reject(err);
        try { const rows = JSON.parse(out || '[]'); resolve(Array.isArray(rows) ? rows : [rows]); } catch (e) { reject(e); }
      });
  });
  return appCommands.closeApplication(query, activeSettings.appPaths, productivityTracker?.getKnownApps() || [], getRunning, isProtectedProcess);
}

// ── Baymax Live Assistant Process Manager ──────────────────────────────────
let mochiLiveProc = null;
let liveOutputSuppressed = false;
let liveUserStopped = false;
function resetLiveSpeechOutput(reason = 'user') {
  if (reason === 'user') liveUserStopped = true;
  liveOutputSuppressed = true;
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('ai-speech-reset');
    overlayWin.webContents.send('ai-state', 'idle');
    overlayWin.webContents.send('ai-audio-level', 0);
  }
}
const talkShortcut = new PushToTalkService(state => {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('push-to-talk-state', state);
  sendToLiveEngine({ cmd: 'ptt_config', enabled: state.enabled, suspended: state.suspended });
  sendToLiveEngine({ cmd: 'ptt', held: state.held });
});
ipcMain.handle('get-push-to-talk-state', () => talkShortcut.snapshot());
const talkShortcutOwners = new WeakSet();
ipcMain.handle('suspend-push-to-talk', (event, paused) => {
  const owner = event.sender.id;
  talkShortcut.suspend(owner, !!paused);
  if (!talkShortcutOwners.has(event.sender)) {
    talkShortcutOwners.add(event.sender);
    event.sender.once('destroyed', () => talkShortcut.suspend(owner, false));
    event.sender.on('render-process-gone', () => talkShortcut.suspend(owner, false));
    event.sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) talkShortcut.suspend(owner, false); });
  }
  return true;
});
let mochiLiveRestartTimer = null;
let mochiLiveStopPromise = null;
let mochiLiveStartRequested = false;
const intentionallyStoppedLiveProcesses = new WeakSet();
let pendingTextResolvers = [];

function syncEngineConfig(settings) {
  try {
    const configPath = path.join(engineDataDir, 'config', 'api_keys.json');
    let currentConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {}
    }
    const isHer = (settings.userRole || "me") === "her";
    const rawMe = isHer ? (settings.partnerName || "Partner") : (settings.userName || "You");
    const rawPartner = isHer ? (settings.userName || "You") : (settings.partnerName || "Partner");
    const activeUserName = rawMe.trim() || (isHer ? "Partner" : "You");
    const activePartnerName = rawPartner.trim() || (isHer ? "You" : "Partner");

    const updatedConfig = {
      ...currentConfig,
      gemini_api_key: '',
      assistant_name: settings.assistantName || 'Baymax',
      companion: normalizeCompanion(settings.companion),
      user_name: activeUserName,
      partner_name: activePartnerName,
      user_role: settings.userRole || 'me',
      voice_name: settings.voiceName || 'Charon',
      wake_word_enabled: !!settings.wakeWordEnabled,
      push_to_talk_enabled: !!settings.pushToTalkEnabled,
      push_to_talk_key: settings.pushToTalkKey || 'Control+Space',
      proactive_audio: settings.proactiveAudio !== false,
      proactive_talking_enabled: settings.proactiveTalkingEnabled === true,
      user_interests: String(settings.userInterests || '').trim().slice(0, 2000),
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
    process.env.GEMINI_API_KEY = settings.geminiApiKey || '';
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 4), 'utf-8');
    if (!mochiLiveProc) syncInterestsMemory(engineDataDir, updatedConfig.user_interests);
  } catch (err) {
    console.warn('[Baymax Engine] Failed to write api_keys.json:', err);
  }
}

function startMochiLiveEngine() {
  clearTimeout(mochiLiveRestartTimer); mochiLiveRestartTimer = null;
  if (isQuitting || mochiLiveProc || !account.caps.gemini) return;
  if (mochiLiveStopPromise) { mochiLiveStartRequested = true; return; }
  const provider = activeSettings.aiProvider || "gemini";
  if (provider !== "gemini") {
    console.log(`[Baymax Engine] Current AI provider is '${provider}'. Gemini Live process will not be spawned.`);
    return;
  }
  if (!activeSettings.geminiApiKey && !process.env.GEMINI_API_KEY) {
    console.log('[Baymax Engine] Gemini API key not set yet. Waiting for key in Settings...');
    return;
  }

  syncEngineConfig(activeSettings);

  const runnerScript = path.join(engineDir, 'mochi_runner.py');
  console.log('[Baymax Engine] Spawning live assistant process:', runnerScript);

  try {
    const pyExe = resolvePythonPath();
    const pyDir = path.dirname(pyExe);
    const pyScripts = path.join(pyDir, "Scripts");
    const pathEnv = `${pyDir};${pyScripts};${process.env.PATH || ""}`;

    console.log(`[Baymax Engine] Spawning with Python: ${pyExe}`);

    const proc = spawn(pyExe, engineArgs('live'), {
      cwd: engineDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: pathEnv, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', BAYMAX_EXTERNAL_PTT: '1', BAYMAX_SPEECH_STOPPED: liveUserStopped ? '1' : '0' },
    });
    mochiLiveProc = proc;
    proc.stdin?.on('error', error => { if (mochiLiveProc === proc) console.warn('[Baymax Engine] Input pipe:', error.message); });

    let buffer = '';

    proc.stdout.on('data', (data) => {
      if (mochiLiveProc !== proc) return;
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
          console.log(`[Baymax Engine]: ${trimmed}`);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      if (mochiLiveProc !== proc) return;
      const errStr = data.toString('utf-8').trim();
      if (errStr) console.warn(`[Baymax Stderr]: ${errStr}`);
    });

    proc.on('close', (code) => {
      if (mochiLiveProc !== proc) return;
      console.log(`[Baymax Engine] Process closed with code ${code}`);
      mochiLiveProc = null;
      while (pendingTextResolvers.length > 0) {
        const resolve = pendingTextResolvers.shift();
        resolve({ text: `${displayAssistantName()} is restarting. Please try again.` });
      }
      if (!intentionallyStoppedLiveProcesses.has(proc) && !isQuitting && (activeSettings.aiProvider || 'gemini') === 'gemini' && activeSettings.geminiApiKey) {
        clearTimeout(mochiLiveRestartTimer);
        mochiLiveRestartTimer = setTimeout(() => {
          startMochiLiveEngine();
        }, 3000);
      }
    });

    proc.on('error', (err) => {
      if (mochiLiveProc !== proc) return;
      console.error('[Baymax Engine] Process error:', err);
      // A failed spawn has no PID. Other errors do not prove the process exited.
      if (!proc.pid) {
        mochiLiveProc = null;
        if (!isQuitting && !intentionallyStoppedLiveProcesses.has(proc)) {
          clearTimeout(mochiLiveRestartTimer);
          mochiLiveRestartTimer = setTimeout(startMochiLiveEngine, 3000);
        }
      }
      while (pendingTextResolvers.length > 0) {
        const resolve = pendingTextResolvers.shift();
        resolve({ text: `${displayAssistantName()} engine process error: ${err.message}` });
      }
    });

  } catch (err) {
    console.error('[Baymax Engine] Failed to spawn runner:', err);
  }
}

function stopMochiLiveEngine() {
  clearTimeout(mochiLiveRestartTimer); mochiLiveRestartTimer = null;
  mochiLiveStartRequested = false;
  const proc = mochiLiveProc;
  if (!proc) return mochiLiveStopPromise || Promise.resolve();
  intentionallyStoppedLiveProcesses.add(proc);
  mochiLiveProc = null; // Old callbacks cannot own or restart the next engine.
  try { proc.stdin?.write(JSON.stringify({cmd:'mute',muted:true}) + '\n' + JSON.stringify({cmd:'interrupt'}) + '\n'); } catch {}
  while (pendingTextResolvers.length) pendingTextResolvers.shift()({text: `${displayAssistantName()} voice was restarted. Please try again.`});
  mochiLiveStopPromise = terminateProcessTree(proc).catch(error => {
    // Keep ownership if termination failed: starting another mic would recreate the bug.
    if (proc.exitCode === null && proc.signalCode == null) mochiLiveProc = proc;
    mochiLiveStartRequested = false;
    console.error('[Baymax Engine] Stop failed:', error.message);
  }).finally(() => {
    mochiLiveStopPromise = null;
    const restart = mochiLiveStartRequested; mochiLiveStartRequested = false;
    if (restart && !isQuitting) startMochiLiveEngine();
  });
  return mochiLiveStopPromise;
}

function sendToLiveEngine(cmdObj) {
  if(voiceCallActive && cmdObj.cmd==='mute')cmdObj={...cmdObj,muted:true};
  if(voiceCallActive && ['background','user_turn'].includes(cmdObj.cmd))return false;
  if (!mochiLiveProc || !mochiLiveProc.stdin || mochiLiveProc.stdin.destroyed) {
    return false;
  }
  try {
    mochiLiveProc.stdin.write(JSON.stringify(cmdObj) + '\n');
    return true;
  } catch (err) {
    console.warn('[Baymax Engine] Stdin write error:', err);
    return false;
  }
}

function handleLiveEngineEvent(msg) {
  if (!msg || !msg.event) return;

  switch (msg.event) {
    case 'user_turn':
      if(voiceCallActive)break;
      liveUserStopped = false;
      liveOutputSuppressed = false;
      break;
    case 'speech_allowed':
      if (!voiceCallActive && !liveUserStopped) liveOutputSuppressed = false;
      break;
    case 'speech_reset':
      resetLiveSpeechOutput(msg.reason);
      break;
    case 'visemes':
      if (!msg.frames?.length && overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('ai-audio-level', 0);
      break;
    case 'ready':
      sendToLiveEngine({cmd:'call_active',active:voiceCallActive});
      sendToLiveEngine({ cmd: 'mute', muted: activeSettings.micEnabled === false || activeSettings.aiProvider === 'groq' });
      sendToLiveEngine({ cmd: 'ptt_config', enabled: !!activeSettings.pushToTalkEnabled, suspended: talkShortcut.snapshot().suspended });
      sendToLiveEngine({ cmd: 'ptt', held: talkShortcut.snapshot().held });
      break;
    case 'state': {
      const st = String(msg.state || 'listening').toLowerCase();
      if (liveOutputSuppressed && (st === 'speaking' || st === 'thinking')) break;
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send('ai-state', st);
      }
      break;
    }
    case 'transcript': {
      if (liveOutputSuppressed && msg.role !== 'user') break;
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
        overlayWin.webContents.send('ai-audio-level', liveOutputSuppressed ? 0 : msg.level || 0);
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
      if (!msg.requestId || !overlayWin || overlayWin.isDestroyed()) break;
      const requestId = msg.requestId, requestedAt = Date.now();
      dialog.showMessageBox(overlayWin, { type:'question', title: `${displayAssistantName()} action confirmation`, message: String(msg.title || 'Confirm action'), detail: String(msg.detail || ''), buttons:['Cancel','Confirm'], defaultId:0, cancelId:0, noLink:true }).then(result => {
        sendToLiveEngine({cmd:'confirm',requestId,accepted:result.response === 1 && Date.now()-requestedAt < 90000});
      }).catch(() => sendToLiveEngine({cmd:'confirm',requestId,accepted:false}));
      break;
    }
    case 'reconfig': {
      if (overlayWin && !overlayWin.isDestroyed()) {
        createSettingsWindow();
      }
      break;
    }
    case 'focus_session_command': {
      const action = msg.action || 'start';
      if (action === 'start') {
        const duration = Number(msg.duration_minutes) || 5;
        const mode = msg.mode || 'Strict Lock';
        if (productivityBlocker) {
          productivityBlocker.start({ mode, durationMinutes: duration });
        }
        const status = productivityBlocker ? productivityBlocker.getStatus() : { active: true, durationMinutes: duration, mode };
        broadcastToProductivity('focus-state-changed', {
          active: true,
          ...status,
          config: { durationMinutes: duration, mode },
        });
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
      const rawMe = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
      const rawPartner = isMe ? (activeSettings.partnerName || "Partner") : (activeSettings.userName || "You");
      const myName = (rawMe.trim() || (isMe ? "You" : "Partner"));
      const partnerName = (rawPartner.trim() || (isMe ? "Partner" : "You"));
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
          overlayWin.webContents.send("schedule-updated", activeSchedule.filter(t => !t.deleted));
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
          overlayWin.webContents.send("schedule-updated", activeSchedule.filter(t => !t.deleted));
        }
      }
      break;
    }
  }
}

async function deliverMessage(msg) {
  const live = msg.liveSent || msg.delivery === 'sent' || await broadcastChatMessage(msg);
  const cloud = await saveChatMessageToCloud(msg, activeSettings.shareChannel || 'coucou-badsha-ayzil');
  msg.liveSent = !!live;
  msg.delivery = cloud ? 'stored' : (live ? 'sent' : 'pending');
  // Until persisted in cloud, retain a durable retry even if the broadcast succeeded.
  msg.cloudPending = !cloud;
  const history = loadChatHistory(), index = history.findIndex(m => m.id === msg.id);
  if (index >= 0) history[index] = { ...history[index], ...msg }; else history.push(msg);
  saveChatHistory(history);
  overlayWin?.webContents.send('partner-chat-received', msg);
  return msg;
}
let flushingOutbox = false;
async function flushOutbox() {
  if (flushingOutbox) return;
  flushingOutbox = true;
  try { for (const msg of loadChatHistory().filter(m => m.cloudPending || m.delivery === 'pending')) await deliverMessage(msg); }
  finally { flushingOutbox = false; }
}
const pendingAppActions=new Map();
ipcMain.on('app-action-result',(event,value)=>{
  if(event.sender!==overlayWin?.webContents)return;
  const pending=pendingAppActions.get(value?.id);if(!pending)return;
  pendingAppActions.delete(value.id);clearTimeout(pending.timer);
  value.error?pending.reject(new Error(String(value.error).slice(0,500))):pending.resolve(value.result);
});
function requestAppAction(params) {
  const action=require('./appActions').cleanAppAction(params);
  if(!overlayWin || overlayWin.isDestroyed())throw new Error('Open the companion before using this action');
  return new Promise((resolve,reject)=>{
    const id=require('node:crypto').randomUUID();
    const timer=setTimeout(()=>{pendingAppActions.delete(id);reject(new Error('The app did not confirm this action. Check the Music view before retrying.'));},75000);
    pendingAppActions.set(id,{resolve,reject,timer});overlayWin.webContents.send('app-action',{id,...action});
  });
}
async function handleEngineAction(action, params) {
  if(action==='entitlements')return {...account.caps,activeActions:activeSettings.activeActions||{}};
  if(action==='engine_video'){
    account.guardAction('video_player',params);
    if(activeSettings.activeActions?.video_player===false)throw new Error('Video Player is disabled in Settings');
    return videoPlayer.command(params);
  }
  if(action==='engine_confirm'){
    account.require('pcControl');
    const started=Date.now();
    const result=await dialog.showMessageBox(overlayWin,{type:'question',title:`${displayAssistantName()} action confirmation`,message:String(params.title||'Confirm action').slice(0,500),detail:String(params.detail||'').slice(0,4000),buttons:['Cancel','Confirm'],defaultId:0,cancelId:0,noLink:true});
    return result.response===1&&Date.now()-started<90000;
  }
  if(activeSettings.activeActions?.[action]===false)throw new Error('This skill is disabled in Settings > AI engine');
  account.guardAction(action==='manage_productivity'?'productivity_manager':action,params);
  if(action==='control_app'){
    if(params.action==='read_partner_messages')return loadChatHistory().slice(-20).map(m=>({sender:m.sender,text:m.text,timestamp:m.timestamp}));
    return requestAppAction(params);
  }
  if (action === 'open_app' || action === 'close_app') {
    const result = await (action === 'open_app' ? launchApplication(params.app_name) : closeApplication(params.app_name));
    if (!result.success) throw new Error(result.error);
    return result;
  }
  if (action === 'send_partner_message') {
    const msg = await sendPartnerMessage({ text: params.message_text || params.text, isAiGenerated: true });
    if (!msg) throw new Error('Message text required');
    return { id: msg.id, delivery: msg.delivery, text: msg.text };
  }
  if (action === 'manage_productivity') {
    if (!productivityTracker || !productivityBlocker) throw new Error('Productivity is not ready');
    const act = String(params.action || 'analyze_stats').toLowerCase();
    if (['start_focus','start_session','focus','start'].includes(act)) { productivityBlocker.start({durationMinutes:Number(params.duration_minutes || params.minutes || 25),mode:params.mode || 'Deep Silence',timerMode:params.timer_mode || params.timerMode}); return productivityBlocker.getStatus(); }
    if (['stop_focus','stop_session','stop','end_focus','cancel_focus'].includes(act)) { productivityBlocker.stop(); return productivityBlocker.getStatus(); }
    if (['classify','set_category','mark_app'].includes(act)) {
      const query = String(params.app_name || params.app || '').toLowerCase();
      const matches = productivityTracker.getKnownApps(true).filter(a => [a.id,a.name.toLowerCase(),...(a.aliases || [])].includes(query));
      if(matches.length !== 1) throw new Error('Choose one exact application from the Apps library.');
      productivityTracker.updateCategory(matches[0].id, params.category); return 'Category saved.';
    }
    const apps = params.timeframe === 'weekly' ? productivityTracker.getWeekApps() : productivityTracker.getTodayApps();
    const total = apps.reduce((s,a)=>s+a.totalSeconds,0), productive=apps.filter(a=>a.category==='productive').reduce((s,a)=>s+a.totalSeconds,0), wasteful=apps.filter(a=>a.category==='wasteful').reduce((s,a)=>s+a.totalSeconds,0);
    return { apps, totalSeconds:total, focusScore:total ? Math.round(50+50*productive/total-30*wasteful/total) : 0, focus:productivityBlocker.getStatus() };
  }
  if (action === 'manage_schedule') {
    const act=String(params.action || 'list').toLowerCase();
    if (['add','create','new'].includes(act)) {
      if (!String(params.title || '').trim()) throw new Error('Task title required');
      await executeActionTags('[ADD_TASK: '+JSON.stringify({title:params.title,time:params.time_str || params.time,for:params.for_who || params.for || activeSettings.userRole})+']');
      return 'Task saved.';
    }
    if (['complete','done','finish','toggle','delete','remove'].includes(act)) {
      const query=String(params.title || '').trim().toLowerCase();
      const role=resolveRole(params.for_who || params.for,activeSettings.userRole);
      const matches=activeSchedule.filter(t=>!t.deleted && (t.assignee===role || t.assignee==='both') && (t.id.toLowerCase()===query || t.title.toLowerCase()===query));
      if(matches.length!==1) throw new Error('Choose one exact task title or ID.');
      if(['delete','remove'].includes(act)){
        matches[0].deleted=true;saveSchedule(activeSchedule);void syncScheduleToPartner();
        overlayWin?.webContents.send('schedule-updated',activeSchedule.filter(t=>!t.deleted));return 'Task deleted.';
      }
      await executeActionTags('[MARK_DONE: '+matches[0].id+']');return 'Task completed.';
    }
    const role=resolveRole(params.for_who || params.for,activeSettings.userRole);
    return activeSchedule.filter(t=>!t.deleted && (t.assignee===role || t.assignee==='both'));
  }
  throw new Error('Unknown engine command');
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle("boot", () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    settings: secrets.publicSettings(activeSettings),
    account:account.snapshot(),
    schedule: activeSchedule.filter(t => !t.deleted),
    screen: {
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      width: primaryDisplay.bounds.width,
      height: primaryDisplay.bounds.height,
      scale: primaryDisplay.scaleFactor,
    },
    version: (() => { try { const b=JSON.parse(fs.readFileSync(path.join(__dirname,"../dist/build-info.json"),"utf8")); return `${app.getVersion()} • ${b.revision.slice(0,8)}${b.dirty ? ' + local changes' : ''} • ${b.builtAt}`; } catch { return `${app.getVersion()} • build unknown`; } })(),
    hookPath: "",
  };
});

// ── Baymax Autonomous PC Control Handlers ──────────────────────────────────
ipcMain.handle("engine-list-actions", async () => {
  return await runMochiBridgeCmd("list-actions");
});

ipcMain.handle("engine-list-devices", async () => {
  return await runMochiBridgeCmd("list-devices");
});

ipcMain.handle("engine-list-memory", async () => {
  return await runMochiBridgeCmd("list-memory");
});

ipcMain.handle("engine-save-memory", async (_event, { category, key, value }) => {
  return await runMochiBridgeCmd("save-memory", category || "notes", key || "", value || "");
});

ipcMain.handle("engine-delete-memory", async (_event, { category, key }) => {
  return await runMochiBridgeCmd("delete-memory", category || "notes", key || "");
});

ipcMain.handle("engine-execute-action", async (_event, { name, parameters }) => {
  account.guardAction(name,parameters);
  return await runMochiBridgeCmd("execute", name, JSON.stringify(parameters || {}));
});

ipcMain.handle("engine-launch-hud", async () => {
  try {
    const hudChild = spawn(resolvePythonPath(), engineArgs('hud'), {
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
  const oldUserName = activeSettings.userName || "You";
  const oldPartnerName = activeSettings.partnerName || "Partner";
  const oldAssistantName = activeSettings.assistantName;
  const oldVoice = activeSettings.voiceName || "Charon";
  const previous = activeSettings;
  const next = secrets.mergeSettings(previous, newSettings);
  if(account.configured){
    if(newSettings.aiProvider && newSettings.aiProvider!=='groq')account.require('gemini');
    for(const key of ['syncUrl','syncApiKey','shareChannel','userRole'])next[key]=previous[key];
  }
  next.proactiveTalkingEnabled = next.proactiveTalkingEnabled === true;
  next.userInterests = String(next.userInterests || '').trim().slice(0, 2000);
  const shortcut = parseShortcut(next.pushToTalkKey || 'Control+Space');
  if (!shortcut) throw new Error('Choose a supported push-to-talk key.');
  next.pushToTalkKey = shortcut.key;
  next.companion = normalizeCompanion(next.companion);
  next.assistantName = String(next.assistantName || "Baymax").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40) || "Baymax";
  saveSettings(next);
  activeSettings = next;
  talkShortcut.configure(activeSettings);
  cachedEngineTools = null;
  tray?.setToolTip(`${displayAssistantName()} — AI Desktop Companion`);
  if (oldAutostart !== activeSettings.autostart) {
    applyStartupMode(activeSettings.autostart);
  }
  if (["syncUrl", "syncApiKey", "shareChannel", "userRole", "userName", "partnerName"].some(key => previous[key] !== activeSettings[key])) startSupabaseSync();
  syncEngineConfig(activeSettings);


  const identityChanged =
    // Proactive preferences are sent live below; they do not restart the process.
    ["proactiveAudio", "thinkingEnabled", "mediaResolution", "morningBriefEnabled", "turnSilenceMs", "turnPrefixMs", "turnEndSensitivity", "audioInputDevice", "audioOutputDevice"].some(key => previous[key] !== activeSettings[key]) ||
    oldAssistantName !== activeSettings.assistantName ||
    oldUserRole !== (activeSettings.userRole || "me") ||
    oldUserName !== (activeSettings.userName || "You") ||
    oldPartnerName !== (activeSettings.partnerName || "Partner");

  const currentProvider = activeSettings.aiProvider || "gemini";
  if (previous.proactiveTalkingEnabled !== activeSettings.proactiveTalkingEnabled || previous.userInterests !== activeSettings.userInterests) {
    sendToLiveEngine({cmd: 'proactive_config', enabled: activeSettings.proactiveTalkingEnabled, interests: activeSettings.userInterests});
  }
  if (currentProvider === "gemini") {
    if (oldProvider !== "gemini" || !mochiLiveProc || oldGeminiKey !== activeSettings.geminiApiKey || identityChanged) {
      if (mochiLiveProc) stopMochiLiveEngine();
      startMochiLiveEngine();
    } else {
      if (previous.pushToTalkEnabled !== activeSettings.pushToTalkEnabled || previous.pushToTalkKey !== activeSettings.pushToTalkKey) {
        sendToLiveEngine({ cmd: 'ptt_config', enabled: !!activeSettings.pushToTalkEnabled, suspended: talkShortcut.snapshot().suspended });
        sendToLiveEngine({ cmd: 'ptt', held: talkShortcut.snapshot().held });
      }
      if (previous.wakeWordEnabled !== activeSettings.wakeWordEnabled) sendToLiveEngine({
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
    overlayWin.webContents.send("settings-changed", secrets.publicSettings(activeSettings));
  }
  return true;
});

ipcMain.handle("test-supabase", async (_event, creds) => {
  if (creds?.key === secrets.MARKER) creds = { ...creds, key: activeSettings.syncApiKey };
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

async function sendPartnerMessage(arg) {
  account.require('partner');
  const history = loadChatHistory();
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawMe = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
  const rawPartner = isMe ? (activeSettings.partnerName || "Partner") : (activeSettings.userName || "You");
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
    id: require('node:crypto').randomUUID(),
    sender: myName,
    recipient: partnerName,
    senderRole: activeSettings.userRole || "me",
    text: cleanText,
    timestamp: Date.now(),
    read: true,
    isAiGenerated: isAiGenerated,
    delivery: 'pending',
    cloudPending: true,
  };

  history.push(msg);
  saveChatHistory(history);

  await deliverMessage(msg);
  return msg;
}
ipcMain.handle("send-chat-message", (_event, arg) => sendPartnerMessage(arg));

ipcMain.handle("mark-chat-read", () => {
  const history = loadChatHistory();
  const isMe = (activeSettings.userRole || "me") === "me";
  const myName = (isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner")).toLowerCase();
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
  if (remoteSession.current()) return false;
  remoteSession.begin();
  activeRemoteRole = "viewer";
  pendingViewerSignals = [];
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawMe = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
  const currentUserName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);
  let delivered = false;
  try {
    delivered = await broadcastRemoteAccess({ action: "request", sender: currentUserName });
    return delivered;
  } finally {
    if (!delivered) { remoteSession.end(); activeRemoteRole = null; pendingViewerSignals = []; }
  }
});

ipcMain.handle("prepare-remote-host", event => {
  if(event.sender !== overlayWin?.webContents || !remoteSession.allowCapture())return false;
  activeRemoteRole='host';return true;
});
ipcMain.handle("respond-remote-access", async (_event, accepted, extra) => {
  const sessionId = remoteSession.accept(accepted);
  if (!sessionId) return false;
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawMe = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
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
      sessionId,
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
      sessionId,
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
  if (cmd && remoteSession.isHost() && _event.sender === overlayWin?.webContents) injectInput(cmd);
  return true;
});

ipcMain.on("inject-remote-input-fast", (_event, cmd) => {
  if (cmd && remoteSession.isHost() && _event.sender === overlayWin?.webContents) injectInput(cmd);
});

// Viewer Window IPC handlers
ipcMain.handle("viewer-get-partner-info", () => {
  const isMe = (activeSettings.userRole || "me") === "me";
  const rawPartner = isMe ? (activeSettings.partnerName || "Partner") : (activeSettings.userName || "You");
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
    assistantName: displayAssistantName(),
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
  const rawMe = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
  const currentUserName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);
  return await broadcastRemoteAccess({ action: "end", sender: currentUserName });
});

ipcMain.handle("set-collapsed", (_event, collapsed) => {
  isCollapsed = collapsed;
  return true;
});

ipcMain.handle("set-ignore-mouse-events", (_event, ignore, options) => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    setMousePassthrough(ignore);
  }
  return true;
});

ipcMain.handle("set-island-rect", (_event, rect) => {
  if (rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w >= 0 && rect.w <= 1040 && rect.h >= 0 && rect.h <= 640) {
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
async function buildCompanionSystemPrompt() {
  const tools = await getEngineToolDeclarations();
  const userRole = activeSettings.userRole || "me";
  const partnerRole = userRole === "me" ? "her" : "me";
  const currentUserName = userRole === "me" ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
  const partnerUserName = userRole === "me" ? (activeSettings.partnerName || "Partner") : (activeSettings.userName || "You");

  // Load latest schedule items
  const myTasks = activeSchedule.filter((s) => !s.deleted && (s.assignee === userRole || s.assignee === "both"));
  const partnerTasks = activeSchedule.filter((s) => !s.deleted && (s.assignee === partnerRole || s.assignee === "both"));

  const myTasksText = myTasks.length > 0
    ? myTasks.map((s) => `  [${s.completed ? "DONE" : "PENDING"}] ${s.time ? s.time + " - " : ""}${s.title}${s.assignedBy === partnerRole ? ` (set by ${partnerUserName})` : ""}`).join("\n")
    : "No tasks scheduled for today.";

  const partnerTasksText = partnerTasks.length > 0
    ? partnerTasks.map((s) => `  [${s.completed ? "DONE" : "PENDING"}] ${s.time ? s.time + " - " : ""}${s.title}${s.assignedBy === userRole ? ` (set by ${currentUserName})` : ""}`).join("\n")
    : "No tasks scheduled for today.";

  return `You are ${displayAssistantName()}, a warm, super cute, energetic, and snappy AI desktop companion for YouTube creator couple ${currentUserName} and ${partnerUserName}.
CURRENT ACTIVE USER ON THIS PC: ${currentUserName}
THEIR PARTNER: ${partnerUserName}

--- ${currentUserName.toUpperCase()}'S TASKS ---
${myTasksText}

--- ${partnerUserName.toUpperCase()}'S TASKS ---
${partnerTasksText}

Configured Apps: ${Object.keys(activeSettings.appPaths || {}).join(", ")}
Enabled tool schemas: ${JSON.stringify(tools)}

CRITICAL IDENTITY & TASK OWNERSHIP RULES:
1. You are speaking directly to ${currentUserName}.
2. When ${currentUserName} asks about "my task", "my tasks", "my schedule", "what do I have to do": ONLY list ${currentUserName}'s tasks.
3. Only if ${currentUserName} specifically asks about ${partnerUserName}: tell them about ${partnerUserName}'s tasks.
4. Keep answers short, sweet, and assistant-friendly (maximum 1-2 short sentences!).
5. Do NOT use markdown symbols (no **, ##, *, backticks) or bullet spam so spoken voice sounds natural.
6. You can use enabled PC and browser tools to launch apps, manage windows, search files, change settings and interact with websites. Use [TOOL: {"name":"registered_tool_name","parameters":{...}}] with the exact parameters below. Execute steps in order; never invent coordinates or claim success without tool results.
7. Respect these verified capabilities: ${JSON.stringify(account.caps)}. Never promise a locked feature.
8. If asked to add a task for ${currentUserName}: Confirm and append [ADD_TASK: {"title":"...","time":"...","for":"${userRole}"}].
9. If asked to add a task for ${partnerUserName}: Confirm and append [ADD_TASK: {"title":"...","time":"...","for":"${partnerRole}"}].
10. If asked to add a task for both: Confirm and append [ADD_TASK: {"title":"...","time":"...","for":"both"}].
11. If asked to mark done: Confirm in one line and append [MARK_DONE: task_id_or_title].
12. If asked to send/text a message to ${partnerUserName}: Confirm in a sweet sentence and append [SEND_CHAT: {"text":"..."}].
13. Use the built-in music player for songs: [APP: {"action":"music","command":"play","query":"song or artist"}]. Omit query to resume. Other music commands: pause, resume, next, previous, volume (volume:0–100), add_shared (query or current song), join (Listen Together with partner), leave. When the user names Spotify, YouTube or another app, honor that destination with its browser/PC tools; do not use APP music for an explicitly named external player.
Use [APP: {"action":"open_view","view":"music"}] to navigate. Views: music, chat (AI), partner_chat, tasks, share, productivity, settings.
Use [APP: {"action":"emote","emote":"love"}] for love, celebrate, vibe, dizzy, sleepy.
Use [APP: {"action":"read_partner_messages"}] for recent partner messages.
Use [TASK: {"action":"list|add|complete|delete","title":"exact task title or ID","for_who":"me|her|both","time":"optional"}] for schedule actions; choose the correct literal role from the current user identity. Never claim an action succeeded before executing its tag.
14. If asked to search Google or the web (e.g. "search...", "who is...", "what is the score of...", "google..."): Say e.g. "Searching that for you!" and append [WEB_SEARCH: search_query].
15. If asked to open a website or URL: Say e.g. "Opening that website right now!" and append [BROWSER_OPEN: website_url].
16. Use the built-in music volume command for Baymax music, computer_settings for system volume, and browser_control/computer_control for an explicitly named external player.
17. If asked to start a focus or flow session (e.g. "start focus session for 1 hour", "focus session start karo", "focus mode on"): Say e.g. "Starting your focus session now. Time to lock in!" and append [START_FOCUS: {"durationMinutes": <minutes>, "mode": "Strict Lock"}].
For Pomodoro, include "timerMode":"pomodoro" in START_FOCUS.
18. If asked to stop or end focus mode: Say e.g. "Ending your focus session!" and append [STOP_FOCUS].
Be sweet, playful, and helpful!`;
}

const { parseActionTags, resolveRole } = require('./actionTags');
async function executeRegisteredAction(name,parameters={},signal) {
  signal?.throwIfAborted();
  if(typeof name!=='string'||!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw new Error('Invalid tool request');
  if(activeSettings.activeActions?.[name]===false)throw new Error('This skill is disabled in Settings > AI engine');
  account.guardAction(name,parameters);
  const tools=await getEngineToolDeclarations();
  if(!tools.some(tool=>tool.name===name))throw new Error('This tool is unavailable. Check AI engine settings and the installed engine.');
  signal?.throwIfAborted();
  const cancel=()=>{void actionBridge.stop('Action interrupted by the user');};
  signal?.addEventListener('abort',cancel,{once:true});
  try{return await runMochiBridgeCmd('execute',name,JSON.stringify(parameters));}
  finally{signal?.removeEventListener('abort',cancel);}
}
async function executeActionTags(rawReply, signal) {
  const parsed = parseActionTags(rawReply), userRole = activeSettings.userRole || 'me', outcomes = [];
  for (const {name,value} of parsed.actions) {
    signal?.throwIfAborted();
    let result;
    switch(name) {
      case 'TOOL': result=await executeRegisteredAction(value?.name,value?.parameters,signal);break;
      case 'APP': result={data:await handleEngineAction('control_app',value)};break;
      case 'TASK': result={data:await handleEngineAction('manage_schedule',value)};break;
      case 'START_FOCUS':
        account.require('productivity');
        if(!productivityBlocker) throw new Error('Focus backend is unavailable');
        productivityBlocker.start({mode:value.mode || 'Strict Lock',durationMinutes:Number(value.durationMinutes || 25),timerMode:value.timerMode}); break;
      case 'STOP_FOCUS':
        account.require('productivity');
        if(!productivityBlocker) throw new Error('Focus backend is unavailable');
        productivityBlocker.stop(); break;
      case 'SEND_CHAT':
        result=await sendPartnerMessage({text:value.text,isAiGenerated:true});
        if(!result || result.delivery==='pending') throw new Error('Message saved in the outbox; partner delivery is pending');
        break;
      case 'ADD_TASK':
        if(typeof value.title!=='string' || !value.title.trim()) throw new Error('Task title is missing');
        activeSchedule.push({id:require('node:crypto').randomUUID(),title:value.title.trim(),time:value.time || '',assignee:resolveRole(value.for,userRole),assignedBy:userRole,completed:false,createdAt:Date.now()});
        saveSchedule(activeSchedule);void syncScheduleToPartner();
        overlayWin?.webContents.send('schedule-updated',activeSchedule.filter(t=>!t.deleted)); break;
      case 'MARK_DONE': {
        const query=String(value).toLowerCase(),matches=activeSchedule.filter(t=>!t.deleted && (t.id.toLowerCase()===query || t.title.toLowerCase()===query));
        if(matches.length!==1) throw new Error('Choose one exact task title or ID');
        matches[0].completed=true;matches[0].completedAt=Date.now();saveSchedule(activeSchedule);void syncScheduleToPartner();
        overlayWin?.webContents.send('schedule-updated',activeSchedule.filter(t=>!t.deleted));break;
      }
      case 'LAUNCH': result=await executeRegisteredAction('open_app',{app_name:value},signal);break;
      case 'CLOSE': result=await executeRegisteredAction('close_app',{app_name:value},signal);break;
      case 'PLAY_YOUTUBE': result=await executeRegisteredAction('youtube_video',{action:'play',query:value},signal);break;
      case 'WEB_SEARCH': result=await executeRegisteredAction('web_search',{query:value,mode:'search'},signal);break;
      case 'MEDIA_CONTROL': result=await executeRegisteredAction('computer_settings',{description:value},signal);break;
      case 'BROWSER_OPEN': {
        const url=new URL(/^https?:\/\//i.test(value)?value:'https://'+value);
        if(!['http:','https:'].includes(url.protocol))throw new Error('Unsupported URL');
        result=await executeRegisteredAction('browser_control',{action:'go_to',url:url.href},signal);break;
      }
      default: throw new Error('Unsupported action: '+name);
    }
    if(Array.isArray(result?.data))result.data=result.data.map(item=>item.title?`${item.completed?'Done':'Pending'}: ${item.title}${item.time?' at '+item.time:''}`:`${item.sender}: ${item.text}`).join('\n') || 'Nothing to show yet.';
    if(result && result.success===false) throw new Error(result.error || 'Action failed');
    const labels = {START_FOCUS:'Focus session started.',STOP_FOCUS:'Focus session stopped.',ADD_TASK:'Task saved.',MARK_DONE:'Task marked complete.',LAUNCH:'Application launch requested successfully.',CLOSE:'Application close request succeeded.',BROWSER_OPEN:'URL opened in your browser.'};
    outcomes.push(name==='SEND_CHAT' ? ({stored:'Message saved for partner delivery.',sent:'Message sent to the live channel.',pending:'Message saved locally and queued; delivery is pending.'}[result.delivery] || 'Delivery status is unavailable.') : labels[name] || (typeof result?.data==='object'?JSON.stringify(result.data):String(result?.result || result?.data || 'Action returned no completion details.')));
  }
  return outcomes.length ? outcomes.join("\n") : parsed.text;
}

// ── Gemini REST Engine (Instant Text Chat & Action Fallback) ────────────────
// ── Groq Secondary AI Engine ────────────────────────────────────────────────
const {runActionConversation}=require('./actionConversation');
async function callTextAI(provider,query,signal) {
  const gemini=provider==='gemini';
  const key=gemini?(activeSettings.geminiApiKey||process.env.GEMINI_API_KEY):(activeSettings.groqApiKey||activeSettings.grokApiKey);
  if(!key)return {text:'Enter your '+(gemini?'Gemini':'Groq')+' API key in Settings first.'};
  const systemPrompt=await buildCompanionSystemPrompt();
  const model=gemini?(activeSettings.geminiModel||'gemini-2.5-flash'):(activeSettings.groqModel||'llama-3.3-70b-versatile');
  try{
    return await runActionConversation({signal,execute:executeActionTags,request:async steps=>{
      const messages=[...textHistory,{role:'user',text:query},...steps];
      const url=gemini?'https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent':'https://api.groq.com/openai/v1/chat/completions';
      const body=gemini?{
        system_instruction:{parts:[{text:systemPrompt}]},
        contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.text}]})),
        generationConfig:{temperature:0.4,maxOutputTokens:1200},
      }:{model,messages:[{role:'system',content:systemPrompt},...messages.map(m=>({role:m.role,content:m.text}))],temperature:0.4,max_tokens:1200};
      const response=await fetch(url,{method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),
        headers:{'Content-Type':'application/json',...(gemini?{'x-goog-api-key':key}:{Authorization:'Bearer '+key})},body:JSON.stringify(body)});
      if(!response.ok)throw new Error((gemini?'Gemini':'Groq')+' returned HTTP '+response.status+'. Check your API key, quota and connection.');
      const data=await response.json();
      return gemini?(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim():(data.choices?.[0]?.message?.content||'').trim();
    }});
  }catch(error){
    if(signal.aborted)return {text:'Request cancelled. Actions already completed are not undone.'};
    return {text:error.message+' Earlier actions may already have completed; they were not retried.'};
  }
}
async function callGeminiAI(query,context,signal){return callTextAI('gemini',query,signal);}
async function callGroqAI(query,context,signal){return callTextAI('groq',query,signal);}

// ── AI & Chat: Engine IPC Handlers (Gemini Live & Groq) ───────────────────

let textHistory = [], textQueue = Promise.resolve(), activeTextAbort = null, textGeneration = 0;
function cancelTextRequests() { textGeneration++; activeTextAbort?.abort(); }
ipcMain.handle('chat-send', (_event, {query,context}) => {
  if(activeSettings.aiProvider!=='groq')account.require('gemini');
  if(typeof query!=='string' || !query.trim())return {text:''};
  sendToLiveEngine({cmd:'user_turn'});
  const generation = textGeneration;
  const task=textQueue.catch(()=>{}).then(async()=>{
    if(generation!==textGeneration)return {text:'Request cancelled.'};
    const controller = new AbortController(); activeTextAbort = controller;
    try {
      const response=(activeSettings.aiProvider || 'gemini')==='groq' ? await callGroqAI(query,context,controller.signal) : await callGeminiAI(query,context,controller.signal);
      if(generation===textGeneration){textHistory.push({role:'user',text:query},{role:'assistant',text:response.text});textHistory=textHistory.slice(-20);}
      return response;
    } finally { if(activeTextAbort===controller)activeTextAbort=null; }
  });
  textQueue=task;return task;
});

ipcMain.handle("chat-reset", () => {
  cancelTextRequests();
  textHistory = [];
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
  cancelTextRequests();
  resetLiveSpeechOutput();
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

    if (!fileInfo.uploadedToDrive) throw new Error('File saved locally, but sharing failed. Configure a private Drive folder shared with your partner.');

    // 3. Live Broadcast via Supabase Realtime (<50ms delivery to partner PC)
    try {
      await broadcastFileShared({
        id: fileInfo.driveId || fileName,
        name: fileName,
        size: fileInfo.size,
        driveUrl: fileInfo.driveUrl || "",
        driveId: fileInfo.driveId || "",
        senderName: activeSettings.userName || "You",
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
ipcMain.handle('download-drive-file', async (_event, fileInfo) => {
  try {
    const fileId=String(fileInfo?.driveId || fileInfo?.id || '');
    if(!/^[A-Za-z0-9_-]+$/.test(fileId)) throw new Error('This file has no valid private Drive ID. Ask the sender to share it through Drive.');
    const fileName=path.win32.basename(String(fileInfo.name || 'shared_file')).replace(/[<>:"|?*\x00-\x1f]/g,'_');
    if(!fileName || fileName==='.' || fileName==='..')throw new Error('Invalid filename');
    const dir=app.getPath('downloads');fs.mkdirSync(dir,{recursive:true});
    const targetPath=path.join(dir, `${Date.now()}_${fileName}`);
    const oauth=activeSettings.googleOAuth;
    const accessToken=oauth?.refreshToken ? await refreshOAuthAccessToken(oauth) : null;
    await downloadFileFromDrive({fileId,accessToken,serviceAccount:accessToken?null:loadServiceAccount(),targetPath});
    return {success:true,localPath:targetPath};
  } catch(error) { return {success:false,error:error.message}; }
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

    fs.writeFileSync(serviceAccountPath, JSON.stringify(secrets.protect(sa, safeStorage), null, 2), "utf-8");
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
  if (creds?.clientSecret === secrets.MARKER) creds = { ...creds, clientSecret: activeSettings.googleOAuth?.clientSecret };
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
      saveSettings(activeSettings);
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
  saveSettings(activeSettings);
  return { success: true };
});

ipcMain.handle("google-oauth-status", () => {
  const oauth = activeSettings.googleOAuth;
  return {
    connected: !!(oauth && oauth.refreshToken),
    email: oauth?.email || "",
    clientId: oauth?.clientId || "",
    clientSecret: oauth?.clientSecret ? secrets.MARKER : "",
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
  return; // Legacy public relay is disabled. Use the authenticated Drive folder.

  try {
    const shareBin = activeSettings.shareChannel || "coucou-badsha-ayzil";
    const url = `https://filebin.net/${encodeURIComponent(shareBin)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(45000),
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
          const rawPartner = isMe ? (activeSettings.partnerName || "Partner") : (activeSettings.userName || "You");
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
          const rawPartner = isMe ? (activeSettings.partnerName || "Partner") : (activeSettings.userName || "You");
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
  if(account.configured&&!account.caps.partner)return;
  const shared=account.configured?activeSchedule.filter(t=>t.syncPairId===account.snapshot().pair?.id):activeSchedule;
  // 1. Live WebSocket Broadcast via Supabase Realtime (<50ms latency)
  try {
    const isMe = (activeSettings.userRole || "me") === "me";
    const rawMe = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
    const currentUserName = rawMe.charAt(0).toUpperCase() + rawMe.slice(1);
    await broadcastScheduleUpdate({
      items: shared,
      senderName: currentUserName,
      senderRole: activeSettings.userRole || "me",
    });
  } catch (sbErr) {
    console.warn("[Supabase Realtime] Task broadcast error:", sbErr.message);
  }

  // 3. 24/7 Persistent Cloud Database save (so offline partner gets it on boot)
  try {
    await saveAllTasksToCloud(shared, activeSettings.shareChannel || "coucou-badsha-ayzil");
    if(account.configured)await broadcastScheduleUpdate({items:shared});
  } catch (dbErr) {}
}

async function checkRemoteScheduleUpdates() {
  const tasks = await fetchOfflineTasks(activeSettings.shareChannel || 'coucou-badsha-ayzil');
  if (!tasks.length) return;
  activeSchedule = mergeTasks(activeSchedule, tasks); saveSchedule(activeSchedule);
  overlayWin?.webContents.send('schedule-updated', activeSchedule.filter(t => !t.deleted));
  await saveAllTasksToCloud(activeSchedule, activeSettings.shareChannel || 'coucou-badsha-ayzil');
}
setInterval(checkRemoteScheduleUpdates, 30000).unref();

ipcMain.handle("get-schedule", () => activeSchedule.filter(t => !t.deleted));

ipcMain.handle("save-schedule-item", (_event, item) => {
  if(account.configured){
    item.id=require('./cloudTransport').stableId(item.id);
    if(item.assignee!==activeSettings.userRole && item.assignee!=='both')account.require('partner');
    if(account.snapshot().pair?.id) item.syncPairId = account.snapshot().pair.id;
  }
  const existingIndex = activeSchedule.findIndex((s) => s.id === item.id);
  if (existingIndex >= 0) {
    activeSchedule[existingIndex] = item;
  } else {
    activeSchedule.push(item);
  }
  saveSchedule(activeSchedule);
  syncScheduleToPartner();
  try {
    saveTaskToCloud(item, activeSettings.shareChannel || "coucou-badsha-ayzil");
  } catch (e) {}
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("schedule-updated", activeSchedule.filter(t => !t.deleted));
  }
  return activeSchedule.filter(t => !t.deleted);
});

ipcMain.handle("delete-schedule-item", (_event, id) => {
  const removed = activeSchedule.find(s => s.id === id);
  if (removed) removed.deleted = true;
  saveSchedule(activeSchedule);
  syncScheduleToPartner();
  try {
    if (removed) saveTaskToCloud(removed, activeSettings.shareChannel || "coucou-badsha-ayzil");
  } catch (e) {}
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("schedule-updated", activeSchedule.filter(t => !t.deleted));
  }
  return activeSchedule.filter(t => !t.deleted);
});

ipcMain.handle("toggle-schedule-item", (_event, id) => {
  const item = activeSchedule.find((s) => s.id === id);
  if (item) {
    item.completed = !item.completed;
    if (item.completed) item.completedAt = Date.now();
    saveSchedule(activeSchedule);
    syncScheduleToPartner();
    try {
      saveTaskToCloud(item, activeSettings.shareChannel || "coucou-badsha-ayzil");
    } catch (e) {}
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("schedule-updated", activeSchedule.filter(t => !t.deleted));
    }
  }
  return activeSchedule.filter(t => !t.deleted);
});

// Secrets
ipcMain.handle("secret-set", (_event, { key, val }) => {
  if (!secrets.secretKey(key) || typeof val !== "string") throw new Error("Invalid secret field");
  activeSettings[key] = val;
  saveSettings(activeSettings);
  return true;
});

ipcMain.handle("secret-get", (_event, key) => secrets.secretKey(key) && activeSettings[key] ? "configured" : "");
ipcMain.handle("secret-clear", (_event, key) => {
  if (!secrets.secretKey(key)) throw new Error("Invalid secret field");
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
  if (typeof processName !== "string" || !["productive","neutral","wasteful"].includes(cat)) throw new Error("Invalid application category");
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
  if (productivityTracker) {
    productivityTracker.updateCategory(processName, cat);
  }
  return true;
});

ipcMain.handle('scan-running-apps', () => new Promise((resolve,reject) => {
  require('node:child_process').execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command',WINDOW_SCANNER_SCRIPT], {windowsHide:true,timeout:15000}, (err,out) => {
    if(err) return reject(err);
    try {
      const data=JSON.parse(out || '[]'), result=[];
      for(const p of Array.isArray(data) ? data : [data]) if(p?.ProcessName && p.Id!==process.pid && p.Path?.toLowerCase()!==process.execPath.toLowerCase() && !SYSTEM_IGNORED_PROCS.includes(p.ProcessName.toLowerCase())) {
        const entry=productivityTracker.register({processName:p.ProcessName,name:p.ProcessName,path:p.Path,source:'observed'});
        result.push({...entry,category:productivityTracker.getCategory(entry.id),totalSeconds:0,timeSpentMinutes:0});
      }
      resolve(result);
    } catch(e) { reject(e); }
  });
}));

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
  if (!productivityBlocker) throw new Error('Focus backend is unavailable. Reopen Baymax and check tracker status.');
  productivityBlocker.start(config);
  const status = productivityBlocker.getStatus();
  broadcastToProductivity("focus-state-changed", { active: true, ...status, config });
  return true;
});

ipcMain.handle("stop-focus-session", () => {
  if (productivityBlocker) productivityBlocker.stop();
  broadcastToProductivity("focus-state-changed", { active: false });
  return true;
});

ipcMain.handle("get-focus-active", () => {
  return productivityBlocker ? productivityBlocker.getStatus() : { active: false };
});

ipcMain.handle("scan-all-installed-apps", async () => {
  if (productivityTracker) {
    return await productivityTracker.scanAllInstalledApps();
  }
  return [];
});

ipcMain.handle("get-tracking-health", () => productivityTracker?.getHealth());
ipcMain.handle("set-app-hidden", (_, id, hidden) => productivityTracker?.setHidden(id, hidden));
ipcMain.handle("get-known-apps", (_, includeHidden) => {
  if (productivityTracker) {
    return productivityTracker.getKnownApps(includeHidden === true);
  }
  return [];
});

ipcMain.handle("add-custom-app", (_, appData) => {
  if (productivityTracker) {
    return productivityTracker.saveCustomApp(appData);
  }
  return null;
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
  if (!productivityStore) return { name: "You", email: "user@baymax.local", emailVerified: true };
  const prof = productivityStore.get("userProfile", {});
  if (!prof.name) {
    const isMe = (activeSettings.userRole || "me") === "me";
    const uName = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
    return { name: uName, email: `${uName.toLowerCase()}@baymax.local`, picture: "", emailVerified: true };
  }
  return prof;
});

ipcMain.handle("set-user-profile", (_, profile) => {
  if (productivityStore) productivityStore.set("userProfile", profile);
  return true;
});

ipcMain.handle("kill-process", async (_, application) => (await closeApplication(application)).success);

ipcMain.handle("google-sign-in", async () => {
  const isMe = (activeSettings.userRole || "me") === "me";
  const uName = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
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

let cloudConnectionKey='',lastCapabilities='';
account.on('changed',state=>{
  const key=JSON.stringify([state.config.supabaseUrl,state.user?.id,state.pair?.id,state.pair?.channel_token,state.pair?.backend,state.pair?.cloudEligible,state.capabilities.cloud]);
  const connectionChanged=key!==cloudConnectionKey;
  const capabilitiesKey=JSON.stringify(state.capabilities);
  if(!state.capabilities.pcControl||connectionChanged){
    const wasActive=Boolean(activeRemoteRole||remoteSession.current());
    remoteSession.end();activeRemoteRole=null;pendingViewerSignals=[];
    closeRemoteViewerWindow();stopInputInjector();setHostDisplayBounds(null);
    if(wasActive&&overlayWin&&!overlayWin.isDestroyed())overlayWin.webContents.send('remote-access-ended');
  }
  if(state.configured){
    const me=state.pair?.members?.find(m=>m.userId===state.user?.id),other=state.pair?.members?.find(m=>m.userId!==state.user?.id);
    activeSettings.userRole=me?.slot===2?'her':'me';
    const first=state.pair?.members?.find(m=>m.slot===1),second=state.pair?.members?.find(m=>m.slot===2);
    activeSettings.userName=first?.displayName||state.profile?.display_name||'You';activeSettings.partnerName=second?.displayName||other?.displayName||'Partner';
    if(!state.capabilities.gemini)activeSettings.aiProvider='groq';
  }
  if(capabilitiesKey!==lastCapabilities){
    lastCapabilities=capabilitiesKey;cachedEngineTools=null;
    if(!state.capabilities.gemini)void stopMochiLiveEngine();else if(app.isReady())startMochiLiveEngine();
    if(!state.capabilities.productivity){productivityTracker?.stop();productivityBlocker?.stop();}else if(app.isReady())productivityTracker?.start();
  }
  if(connectionChanged){
    cloudConnectionKey=key;activeSchedule=loadSchedule();lastPartnerOnline=false;
    overlayWin?.webContents.send('partner-chat-history',loadChatHistory());overlayWin?.webContents.send('schedule-updated',activeSchedule.filter(t=>!t.deleted));
    if(app.isReady())startSupabaseSync();
  }
  for(const win of [overlayWin,settingsWin])if(win&&!win.isDestroyed()){
    win.webContents.send('account-changed',state);win.webContents.send('settings-changed',secrets.publicSettings(activeSettings));
  }
});

account.on('partner-invite-received', payload => {
  const sender = payload.senderUsername || 'Someone';
  if (Notification.isSupported()) {
    try {
      new Notification({
        title: 'Baymax — Partner Invitation',
        body: `@${sender} sent you a partner invitation. Open Account to accept!`,
        icon: currentCompanionIcon()
      }).show();
    } catch {}
  }
  for (const win of [overlayWin, settingsWin]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('partner-invite-received', payload);
      win.webContents.send('account-notice', { type: 'invite', message: `@${sender} sent you an invitation!` });
    }
  }
});

account.on('partner-invite-accepted', payload => {
  const partner = payload.partnerUsername || 'Your partner';
  if (Notification.isSupported()) {
    try {
      new Notification({
        title: 'Baymax — Connected!',
        body: `@${partner} accepted your invitation! You are now paired.`,
        icon: currentCompanionIcon()
      }).show();
    } catch {}
  }
  for (const win of [overlayWin, settingsWin]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('partner-invite-accepted', payload);
      win.webContents.send('account-notice', { type: 'connected', message: `Connected with @${partner}!` });
    }
  }
});

account.on('partner-unpaired', payload => {
  const who = payload.endedByUsername || 'Your partner';
  if (Notification.isSupported()) {
    try {
      new Notification({
        title: 'Baymax — Relationship Ended',
        body: `@${who} has ended the relationship.`,
        icon: currentCompanionIcon()
      }).show();
    } catch {}
  }
  for (const win of [overlayWin, settingsWin]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('partner-unpaired', payload);
      win.webContents.send('account-notice', { type: 'unpaired', message: `@${who} ended the relationship.` });
    }
  }
});

// App Lifecycle
app.whenReady().then(async () => {
  installAppProtocol(protocol, net, path.join(__dirname, ".."));
  activeSettings = loadSettings();
  await require("./engineRpc").startEngineRpc(handleEngineAction);
  await account.init();
  activeSchedule=loadSchedule();
  if(account.configured&&!account.caps.gemini)activeSettings.aiProvider='groq';
  let legacyEngineKey = '';
  try { legacyEngineKey = JSON.parse(fs.readFileSync(path.join(engineDataDir,'config','api_keys.json'),'utf8')).gemini_api_key || ''; } catch {}
  activeSettings.geminiApiKey ||= process.env.GEMINI_API_KEY || legacyEngineKey;
  saveSettings(activeSettings);
  const migratedServiceAccount = loadServiceAccount();
  if (migratedServiceAccount) fs.writeFileSync(serviceAccountPath, JSON.stringify(secrets.protect(migratedServiceAccount, safeStorage)));
  setInterval(flushOutbox, 30000).unref();
  setInterval(() => {
    if (!remoteSession.current()) {
      stopInputInjector();
      if (activeRemoteRole) {
        activeRemoteRole = null; pendingViewerSignals = []; closeRemoteViewerWindow();
        if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('remote-access-ended');
      }
    }
  }, 1000).unref();
  if (session && session.defaultSession) {
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
      return !!details.isMainFrame && isTrustedRendererUrl(details.requestingUrl || contents?.getURL()) && (['media', 'notifications'].includes(permission) || (permission === 'display-capture' && remoteSession.canCapture()));
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(!!details.isMainFrame && isTrustedRendererUrl(details.requestingUrl || contents?.getURL()) && (['media', 'notifications'].includes(permission) || (permission === 'display-capture' && remoteSession.canCapture())));
    });
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      if (!remoteSession.canCapture() || !isTrustedRendererUrl(_request.frame?.url)) { callback({}); return; }
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
    const currentUserName = isMe ? (activeSettings.userName || "You") : (activeSettings.partnerName || "Partner");
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

    if(account.caps.productivity)productivityTracker.start();
    if(account.caps.productivity)void productivityTracker.scanAllInstalledApps().catch(error => {
      console.warn('[Productivity] Installed-app scan failed:', error.message);
    });
    console.log("[Productivity Engine] Tracker and Blocker initialized successfully.");
  } catch (prodErr) {
    console.error("[Productivity Engine] Initialization error:", prodErr);
  }

  setupTray();
  createOverlayWindow();
  talkShortcut.configure(activeSettings);
  const { powerMonitor } = require('electron');
  powerMonitor.on('suspend', () => talkShortcut.suspend('sleep', true));
  powerMonitor.on('resume', () => talkShortcut.suspend('sleep', false));
  powerMonitor.on('lock-screen', () => talkShortcut.suspend('lock', true));
  powerMonitor.on('unlock-screen', () => talkShortcut.suspend('lock', false));
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
}).catch(error => {
  dialog.showErrorBox('Baymax could not start', error.message);
  app.quit();
});

app.on("before-quit", event => {
  videoPlayer.close();
  musicExtractor.close();
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  talkShortcut.stop();
  if (productivityTracker) {
    try { productivityTracker.stop(); } catch (e) {}
  }
  if (productivityBlocker) {
    try { productivityBlocker.stop(); } catch (e) {}
  }
  if (productivityStore) {
    try { productivityStore.saveSync(); } catch (e) {}
  }
  void Promise.allSettled([endPartnerSessions(),stopMochiLiveEngine(),actionBridge.stop()]).finally(() => app.quit());
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
