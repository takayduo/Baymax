import type { VoiceSignal } from '../call/voiceCall';
// Thin wrapper over Electron IPC (and fallback for browser preview).
import type { Settings } from "./state";
import type { Library, Track } from '../music/model';
import type { MusicSignal } from '../music/peer';
export interface TalkKeyState { enabled: boolean; held: boolean; ready: boolean; suspended: boolean; key: string; error: string }

declare global {
  interface Window {
    electronAPI?: {
      accountSnapshot?():Promise<import('./account').AccountSnapshot>;
      accountFiles?(op:string,args:unknown):Promise<any>;
      accountConfig?(value:import('./account').CloudConfig):Promise<import('./account').AccountSnapshot>;
      accountLogin?():Promise<unknown>;
      accountCancelLogin?():Promise<unknown>;
      accountLogout?():Promise<import('./account').AccountSnapshot>;
      accountRefresh?():Promise<import('./account').AccountSnapshot>;
      accountAction?(op:string,args:unknown):Promise<any>;
      accountBilling?(op:string,args:unknown):Promise<any>;
      voiceSignal?(value:VoiceSignal): Promise<boolean>;
      setVoiceCallActive?(active:boolean): Promise<boolean>;
      appActionResult?(result:unknown): void;
      musicLoad?(): Promise<Library>;
      musicSave?(library:Library): Promise<Library>;
      musicSearch?(query:string): Promise<Track[]>;
      writeClipboard?(text:string): Promise<boolean>;
      musicResolve?(id:string, refresh?:boolean): Promise<string>;
      musicSignal?(value:MusicSignal): Promise<boolean>;
      boot(): Promise<BootInfo>;
      saveSettings(settings: Partial<Settings>): Promise<boolean>;
      setCompanionIcon?(png: string): Promise<boolean>;
      setCollapsed(collapsed: boolean): Promise<boolean>;
      setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): Promise<boolean>;
      setIslandRect(rect: { x: number; y: number; w: number; h: number }): Promise<boolean>;
      focusWindow(focused: boolean): Promise<boolean>;
      reposition(): Promise<boolean>;
      openUrl(url: string): Promise<boolean>;
      launchApp(nameOrPath: string): Promise<{ success: boolean; path?: string; error?: string }>;
      closeApp(nameOrPath: string): Promise<{ success: boolean; app?: string; notRunning?: boolean; error?: string }>;
      selectAppFile(): Promise<{ canceled: boolean; path?: string }>;
      openSettingsWindow(): Promise<boolean>;
      quit(): Promise<void>;
      log(msg: string): Promise<boolean>;

      chatSend(query: string, context: ChatContext | null): Promise<{ text: string }>;
      chatReset(): Promise<boolean>;
      aiInterrupt?(): Promise<boolean>;
      aiMute?(muted: boolean): Promise<boolean>;
      getPushToTalkState?(): Promise<TalkKeyState>;
      suspendPushToTalk?(paused: boolean): Promise<boolean>;
      aiSetVoice?(voice: string): Promise<boolean>;
      transcribeAudio(audioBase64: string): Promise<{ success: boolean; text?: string; error?: string }>;
      kokoroTTS(text: string): Promise<{ success: boolean; base64?: string; error?: string }>;
      speakNative?(text: string): Promise<{ success: boolean; error?: string }>;
      stopNativeSpeech?(): Promise<boolean>;
      ingestFile(fileData: string | DroppedFileInput): Promise<DroppedFile>;
      downloadDriveFile?(fileInfo: any): Promise<{ success: boolean; localPath?: string; error?: string }>;
      openPath?(path: string): Promise<boolean>;
      testDriveConnection?(): Promise<{ readOk: boolean; writeOk: boolean; folderName: string; saEmail: string; error?: string }>;
      selectServiceAccount?(): Promise<{ success: boolean; canceled?: boolean; email?: string; error?: string }>;
      getServiceAccountStatus?(): Promise<{ configured: boolean; email: string }>;
      googleOAuthStart?(creds: { clientId: string; clientSecret: string }): Promise<{ success: boolean; email?: string; error?: string }>;
      googleOAuthDisconnect?(): Promise<{ success: boolean }>;
      googleOAuthStatus?(): Promise<{ connected: boolean; email: string; clientId: string; clientSecret: string }>;
      selectOAuthClient?(): Promise<{ success: boolean; canceled?: boolean; clientId?: string; clientSecret?: string; error?: string }>;
      getPathForFile?(file: any): string;
      testSupabase?(creds: { url: string; key: string }): Promise<{ success: boolean; error?: string }>;
      checkSupabaseCloudStatus?(creds?: { url?: string; key?: string }): Promise<{ ready: boolean; error?: string; code?: string }>;
      getSupabaseSqlSetup?(): Promise<string>;

      getSchedule(): Promise<ScheduleItem[]>;
      saveScheduleItem(item: ScheduleItem): Promise<ScheduleItem[]>;
      deleteScheduleItem(id: string): Promise<ScheduleItem[]>;
      toggleScheduleItem(id: string): Promise<ScheduleItem[]>;

      getChatMessages?(): Promise<PartnerChatMessage[]>;
      sendChatMessage?(text: string | { text: string; isAiGenerated?: boolean }, isAiGenerated?: boolean): Promise<PartnerChatMessage>;
      markChatRead?(): Promise<boolean>;

      requestRemoteAccess?(): Promise<boolean>;
      prepareRemoteHost?(): Promise<boolean>;
      respondRemoteAccess?(accepted: boolean, extra?: any): Promise<boolean>;
      sendRemoteSignal?(signal: any): Promise<boolean>;
      endRemoteAccess?(): Promise<boolean>;
      getAvailableScreens?(): Promise<Array<{ id: string; displayId?: number; name: string; label: string; bounds: { x: number; y: number; width: number; height: number }; width: number; height: number; isPrimary: boolean }>>;
      getPrimaryScreenSource?(): Promise<{ id: string; name: string; width: number; height: number; bounds?: { x: number; y: number; width: number; height: number } } | null>;
      injectInput?(cmd: string): Promise<boolean>;
      injectInputFast?(cmd: string): void;

      checkForUpdates?(): Promise<UpdateCheckResult>;
      performUpdate?(): Promise<{ success: boolean; error?: string }>;

      // Mark-LV PC Control Engine & Hardware Bridge
      markLvListActions?(): Promise<{ success: boolean; actions: any[]; count: number; error?: string }>;
      markLvListDevices?(): Promise<{ success: boolean; inputs: string[]; outputs: string[]; error?: string }>;
      markLvListMemory?(): Promise<{ success: boolean; entries: any[]; raw?: any; error?: string }>;
      markLvSaveMemory?(category: string, key: string, value: string): Promise<{ success: boolean; result?: string; error?: string }>;
      markLvDeleteMemory?(category: string, key: string): Promise<{ success: boolean; result?: string; error?: string }>;
      markLvExecuteAction?(name: string, parameters: any): Promise<{ success: boolean; result?: string; error?: string }>;
      markLvLaunchHud?(): Promise<{ success: boolean; error?: string }>;

      // Productivity & Focus Engine (Baymax)
      openProductivityWindow?(): Promise<boolean>;
      startFocusSession?(config: any): Promise<boolean>;
      stopFocusSession?(): Promise<boolean>;
      getProductivityStats?(timeframe?: string): Promise<any[]>;
      getProductivityDailyTotals?(): Promise<any[]>;

      secretSet(key: string, val: string): Promise<boolean>;
      secretGet(key: string): Promise<string>;
      secretClear(key: string): Promise<boolean>;

      on(channel: string, callback: (...args: any[]) => void): () => void;
    };
  }
}

export const IS_DESKTOP = typeof window !== "undefined" && !!window.electronAPI;
export const IS_TAURI = IS_DESKTOP; // For Coucou compatibility

export interface BootInfo {
  account?:import('./account').AccountSnapshot;
  settings: Settings;
  schedule?: ScheduleItem[];
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
}

export interface ScheduleItem {
  id: string;
  title: string;
  time: string;
  assignee: "me" | "her";
  assignedBy: "me" | "her";
  completed: boolean;
  completedAt?: number;
  createdAt: number;
}

export interface PartnerChatMessage {
  delivery?: "pending" | "sent" | "stored";
  senderRole?: string;
  id: string;
  sender: string;
  recipient: string;
  text: string;
  timestamp: number;
  read: boolean;
  isAiGenerated?: boolean;
}

export interface ChatContext {
  kind: "file" | "window";
  name: string;
  path?: string;
  appName?: string;
  title?: string;
}

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
  uploadedToDrive?: boolean;
  driveUrl?: string;
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  fingerprint: string;
}

export interface IntegrationUpdate {
  id: string;
  data: Record<string, any>;
  error: string | null;
  event?: {
    success: boolean;
    label: string;
    detail?: string;
  };
}

export interface UpdateCheckResult {
  success: boolean;
  updateAvailable?: boolean;
  local?: { version: string; commit: string; commitShort: string; commitMessage: string; commitDate: string };
  remote?: { commit: string; commitShort: string; message: string; date: string };
  error?: string;
}

export const Bridge = {
  voiceSignal: async (value:VoiceSignal):Promise<boolean> => window.electronAPI?.voiceSignal?.(value) ?? false,
  setVoiceCallActive: async (active:boolean):Promise<boolean> => window.electronAPI?.setVoiceCallActive?.(active) ?? true,
  musicLoad: async ():Promise<Library> => {
    if(window.electronAPI?.musicLoad)return window.electronAPI.musicLoad();
    return {version:1,activePlaylistId:'favorites',currentTrackId:'',playlists:[{id:'favorites',name:'My playlist',tracks:[]}]};
  },
  musicSave: async (value:Library):Promise<Library> => {if(window.electronAPI?.musicSave)return window.electronAPI.musicSave(value);throw new Error('Saving playlists requires the desktop app.');},
  musicSearch: async (query:string):Promise<Track[]> => {if(window.electronAPI?.musicSearch)return window.electronAPI.musicSearch(query);throw new Error('Music search requires the desktop app.');},
  writeClipboard: async (text:string) => {if(window.electronAPI?.writeClipboard)await window.electronAPI.writeClipboard(text);else await navigator.clipboard.writeText(text);},
  musicResolve: async (id:string, refresh=false):Promise<string> => {if(window.electronAPI?.musicResolve)return window.electronAPI.musicResolve(id, refresh);throw new Error('Music playback requires the desktop app.');},
  musicSignal: async (value:MusicSignal):Promise<boolean> => window.electronAPI?.musicSignal?.(value) ?? false,
  boot: async (): Promise<BootInfo | null> => {
    if (window.electronAPI) return await window.electronAPI.boot();
    return {
      settings: {
        soundEnabled: true,
        soundVolume: 0.14,
        autoCloseInterval: 15,
        absenceInterval: 60,
        activeIntegrations: [],
        screen: "primary",
        autostart: false,
        hooksInstalled: false,
        model: "gemini-1.5-flash",
      } as any,
      screen: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      version: "1.0.0-creator",
      hookPath: "",
    };
  },

  saveSettings: async (settings: Partial<Settings>): Promise<void> => {
    if (window.electronAPI) { if (await window.electronAPI.saveSettings(settings) === false) throw new Error('Settings were not saved'); }
    else localStorage.setItem("coucou_settings", JSON.stringify({ ...JSON.parse(localStorage.getItem("coucou_settings") || "{}"), ...settings }));
  },

  setCollapsed: async (collapsed: boolean): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.setCollapsed(collapsed);
  },

  setIgnoreMouseEvents: async (ignore: boolean, options?: { forward?: boolean }): Promise<void> => {
    if (window.electronAPI?.setIgnoreMouseEvents) {
      await window.electronAPI.setIgnoreMouseEvents(ignore, options);
    }
  },

  setIslandRect: async (x: number, y: number, width: number, height: number): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.setIslandRect({ x, y, w: width, h: height });
  },

  focusWindow: async (focused: boolean): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.focusWindow(focused);
  },

  reposition: async (): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.reposition();
  },

  openUrl: async (url: string): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.openUrl(url);
    else window.open(url, "_blank");
  },

  openInVSCode: async (path: string | null): Promise<boolean> => {
    if (window.electronAPI) {
      const res = await window.electronAPI.launchApp(path || "code");
      return res.success;
    }
    return false;
  },

  launchApp: async (nameOrPath: string) => {
    if (window.electronAPI) return await window.electronAPI.launchApp(nameOrPath);
    return { success: false, error: "Not in desktop environment" };
  },

  closeApp: async (nameOrPath: string) => {
    if (window.electronAPI) return await window.electronAPI.closeApp(nameOrPath);
    return { success: false, error: "Not in desktop environment" };
  },

  selectAppFile: async () => {
    if (window.electronAPI) return await window.electronAPI.selectAppFile();
    return { canceled: true };
  },

  quit: async (): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.quit();
  },

  openSettingsWindow: async (): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.openSettingsWindow();
    else window.open("/settings.html", "_blank");
  },

  log: async (message: string): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.log(message);
    else console.log("[Bridge Log]:", message);
  },

  // ── AI & Chat ─────────────────────────────────────────────────────────────
  chatSend: async (query: string, context: ChatContext | null): Promise<{ text: string }> => {
    if (window.electronAPI) return await window.electronAPI.chatSend(query, context);
    return { text: `[Browser Preview]: You asked: "${query}". Please open in the desktop app for live AI generation!` };
  },

  chatReset: async (): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.chatReset();
  },

  aiInterrupt: async (): Promise<boolean> => {
    if (window.electronAPI?.aiInterrupt) return await window.electronAPI.aiInterrupt();
    return true;
  },

  aiMute: async (muted: boolean): Promise<boolean> => {
    if (window.electronAPI?.aiMute) return await window.electronAPI.aiMute(muted);
    return true;
  },
  getPushToTalkState: async (): Promise<TalkKeyState> => window.electronAPI?.getPushToTalkState?.() ?? { enabled: false, held: false, ready: false, suspended: false, key: 'Control+Space', error: '' },
  suspendPushToTalk: async (paused: boolean): Promise<boolean> => {
    if (!window.electronAPI?.suspendPushToTalk) throw new Error('The desktop app is required for a global talk key.');
    return window.electronAPI.suspendPushToTalk(paused);
  },

  aiSetVoice: async (voice: string): Promise<boolean> => {
    if (window.electronAPI?.aiSetVoice) return await window.electronAPI.aiSetVoice(voice);
    return true;
  },

  transcribeAudio: async (audioBase64: string): Promise<{ success: boolean; text?: string; error?: string }> => {
    if (window.electronAPI) return await window.electronAPI.transcribeAudio(audioBase64);
    return { success: false, error: "Not in desktop environment" };
  },

  kokoroTTS: async (text: string): Promise<{ success: boolean; base64?: string; error?: string }> => {
    if (window.electronAPI) return await window.electronAPI.kokoroTTS(text);
    return { success: false, error: "Not in desktop environment" };
  },

  speakNative: async (text: string): Promise<{ success: boolean; error?: string }> => {
    if (window.electronAPI?.speakNative) return await window.electronAPI.speakNative(text);
    return { success: false, error: "Not in desktop environment" };
  },

  stopNativeSpeech: async (): Promise<boolean> => {
    if (window.electronAPI?.stopNativeSpeech) return await window.electronAPI.stopNativeSpeech();
    return true;
  },

  ingestFile: async (fileData: string | DroppedFileInput): Promise<DroppedFile> => {
    if (window.electronAPI) return await window.electronAPI.ingestFile(fileData);
    const name = typeof fileData === "string" ? fileData.split(/[\\/]/).pop() || "file" : fileData.name;
    const path = typeof fileData === "string" ? fileData : fileData.path || name;
    return { name, path, size: 1024 * 1024 * 2 };
  },

  downloadDriveFile: async (fileInfo: any): Promise<{ success: boolean; localPath?: string; error?: string }> => {
    if (window.electronAPI?.downloadDriveFile) return await window.electronAPI.downloadDriveFile(fileInfo);
    return { success: false, error: "Desktop bridge unavailable" };
  },

  openPath: async (filePath: string): Promise<boolean> => {
    if (window.electronAPI?.openPath) return await window.electronAPI.openPath(filePath);
    return false;
  },

  testDriveConnection: async (): Promise<{ readOk: boolean; writeOk: boolean; folderName: string; saEmail: string; error?: string }> => {
    if (window.electronAPI?.testDriveConnection) return await window.electronAPI.testDriveConnection();
    return { readOk: false, writeOk: false, folderName: "", saEmail: "", error: "Desktop bridge unavailable" };
  },

  selectServiceAccount: async (): Promise<{ success: boolean; canceled?: boolean; email?: string; error?: string }> => {
    if (window.electronAPI?.selectServiceAccount) return await window.electronAPI.selectServiceAccount();
    return { success: false, error: "Desktop bridge unavailable" };
  },

  getServiceAccountStatus: async (): Promise<{ configured: boolean; email: string }> => {
    if (window.electronAPI?.getServiceAccountStatus) return await window.electronAPI.getServiceAccountStatus();
    return { configured: false, email: "" };
  },

  googleOAuthStart: async (creds: { clientId: string; clientSecret: string }): Promise<{ success: boolean; email?: string; error?: string }> => {
    if (window.electronAPI?.googleOAuthStart) return await window.electronAPI.googleOAuthStart(creds);
    return { success: false, error: "Desktop bridge unavailable" };
  },

  googleOAuthDisconnect: async (): Promise<{ success: boolean }> => {
    if (window.electronAPI?.googleOAuthDisconnect) return await window.electronAPI.googleOAuthDisconnect();
    return { success: false };
  },

  googleOAuthStatus: async (): Promise<{ connected: boolean; email: string; clientId: string; clientSecret: string }> => {
    if (window.electronAPI?.googleOAuthStatus) return await window.electronAPI.googleOAuthStatus();
    return { connected: false, email: "", clientId: "", clientSecret: "" };
  },

  selectOAuthClient: async (): Promise<{ success: boolean; canceled?: boolean; clientId?: string; clientSecret?: string; error?: string }> => {
    if (window.electronAPI?.selectOAuthClient) return await window.electronAPI.selectOAuthClient();
    return { success: false, error: "Desktop bridge unavailable" };
  },

  testSupabase: async (creds: { url: string; key: string }): Promise<{ success: boolean; error?: string }> => {
    if (window.electronAPI?.testSupabase) return await window.electronAPI.testSupabase(creds);
    return { success: false, error: "Desktop bridge unavailable" };
  },

  checkSupabaseCloudStatus: async (creds?: { url?: string; key?: string }): Promise<{ ready: boolean; error?: string; code?: string }> => {
    if (window.electronAPI?.checkSupabaseCloudStatus) return await window.electronAPI.checkSupabaseCloudStatus(creds);
    return { ready: false, error: "Desktop bridge unavailable" };
  },

  getSupabaseSqlSetup: async (): Promise<string> => {
    if (window.electronAPI?.getSupabaseSqlSetup) return await window.electronAPI.getSupabaseSqlSetup();
    return "";
  },

  // ── Schedule ──────────────────────────────────────────────────────────────
  getSchedule: async (): Promise<ScheduleItem[]> => {
    if (window.electronAPI) return await window.electronAPI.getSchedule();
    return [];
  },

  saveScheduleItem: async (item: ScheduleItem): Promise<ScheduleItem[]> => {
    if (window.electronAPI) return await window.electronAPI.saveScheduleItem(item);
    return [];
  },

  deleteScheduleItem: async (id: string): Promise<ScheduleItem[]> => {
    if (window.electronAPI) return await window.electronAPI.deleteScheduleItem(id);
    return [];
  },

  toggleScheduleItem: async (id: string): Promise<ScheduleItem[]> => {
    if (window.electronAPI) return await window.electronAPI.toggleScheduleItem(id);
    return [];
  },

  // ── Live Partner Chat ─────────────────────────────────────────────────────
  getChatMessages: async (): Promise<PartnerChatMessage[]> => {
    if (window.electronAPI?.getChatMessages) return await window.electronAPI.getChatMessages();
    return [];
  },

  sendChatMessage: async (text: string, isAiGenerated = false): Promise<PartnerChatMessage | null> => {
    if (window.electronAPI?.sendChatMessage) {
      return await window.electronAPI.sendChatMessage(text, isAiGenerated);
    }
    return null;
  },

  markChatRead: async (): Promise<boolean> => {
    if (window.electronAPI?.markChatRead) return await window.electronAPI.markChatRead();
    return false;
  },

  // ── Remote Access (Mochi Eye Co-Pilot) ───────────────────────────────────────
  requestRemoteAccess: async (): Promise<boolean> => {
    if (window.electronAPI?.requestRemoteAccess) return await window.electronAPI.requestRemoteAccess();
    return false;
  },

  respondRemoteAccess: async (accepted: boolean, extra?: any): Promise<boolean> => {
    if (window.electronAPI?.respondRemoteAccess) return await window.electronAPI.respondRemoteAccess(accepted, extra);
    return false;
  },

  sendRemoteSignal: async (signal: any): Promise<boolean> => {
    if (window.electronAPI?.sendRemoteSignal) return await window.electronAPI.sendRemoteSignal(signal);
    return false;
  },

  endRemoteAccess: async (): Promise<boolean> => {
    if (window.electronAPI?.endRemoteAccess) return await window.electronAPI.endRemoteAccess();
    return false;
  },

  getAvailableScreens: async (): Promise<Array<{ id: string; displayId?: number; name: string; label: string; bounds: { x: number; y: number; width: number; height: number }; width: number; height: number; isPrimary: boolean }>> => {
    if (window.electronAPI?.getAvailableScreens) return await window.electronAPI.getAvailableScreens();
    return [];
  },

  getPrimaryScreenSource: async (): Promise<{ id: string; name: string; width: number; height: number; bounds?: { x: number; y: number; width: number; height: number } } | null> => {
    if (window.electronAPI?.getPrimaryScreenSource) return await window.electronAPI.getPrimaryScreenSource();
    return null;
  },

  injectInput: async (cmd: string): Promise<boolean> => {
    if (window.electronAPI?.injectInput) return await window.electronAPI.injectInput(cmd);
    return false;
  },

  injectInputFast: (cmd: string): void => {
    if (window.electronAPI?.injectInputFast) {
      window.electronAPI.injectInputFast(cmd);
    } else if (window.electronAPI?.injectInput) {
      void window.electronAPI.injectInput(cmd);
    }
  },

  // ── GitHub 1-Click Auto-Updater ──────────────────────────────────────────
  checkForUpdates: async (): Promise<UpdateCheckResult> => {
    if (window.electronAPI?.checkForUpdates) return await window.electronAPI.checkForUpdates();
    return { success: false, error: "Auto-updater only available in desktop app" };
  },

  performUpdate: async () => {
    if (window.electronAPI?.performUpdate) return await window.electronAPI.performUpdate();
    return { success: false, error: "Auto-updater only available in desktop app" };
  },

  on: (channel: string, callback: (...args: any[]) => void): (() => void) => {
    if (window.electronAPI?.on) {
      return window.electronAPI.on(channel, callback);
    }
    return () => {};
  },

  // ── Secrets & Keys ────────────────────────────────────────────────────────
  secretPresent: async (key: string): Promise<boolean> => {
    if (window.electronAPI) {
      const val = await window.electronAPI.secretGet(key);
      return !!val;
    }
    return !!localStorage.getItem("secret_" + key);
  },

  secretSet: async (key: string, value: string): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.secretSet(key, value);
    else localStorage.setItem("secret_" + key, value);
  },

  secretClear: async (key: string): Promise<void> => {
    if (window.electronAPI) await window.electronAPI.secretClear(key);
    else localStorage.removeItem("secret_" + key);
  },

  // Coucou hook stubs for backward compatibility
  hooksStatus: async (): Promise<HookStatus> => ({
    installed: false,
    settingsPath: "",
    hookPath: "",
    hookReady: true,
  }),
  hooksPreview: async (_install: boolean): Promise<HookPreview> => ({
    diff: "",
    backup: "",
    settingsPath: "",
    fingerprint: "",
  }),
  hooksApply: async (_install: boolean, _fingerprint: string): Promise<string> => "ok",
  approvalDecision: async (_requestId: string, _decision: "allow" | "deny") => {},
  approvalAck: async (_requestId: string) => {},
  approvalDecline: async (_requestId: string) => {},

  // Coucou integration stubs
  refreshIntegration: async (_id: string) => {},
  openN8n: async () => {},
  setPaused: async (_paused: boolean) => {},

  // Mark-LV PC Control Engine & Hardware Bridge
  markLvListActions: async () => {
    if (window.electronAPI?.markLvListActions) return await window.electronAPI.markLvListActions();
    return { success: false, actions: [], count: 0 };
  },
  markLvListDevices: async () => {
    if (window.electronAPI?.markLvListDevices) return await window.electronAPI.markLvListDevices();
    return { success: false, inputs: [], outputs: [] };
  },
  markLvListMemory: async () => {
    if (window.electronAPI?.markLvListMemory) return await window.electronAPI.markLvListMemory();
    return { success: false, entries: [] };
  },
  markLvSaveMemory: async (category: string, key: string, value: string) => {
    if (window.electronAPI?.markLvSaveMemory) return await window.electronAPI.markLvSaveMemory(category, key, value);
    return { success: false };
  },
  markLvDeleteMemory: async (category: string, key: string) => {
    if (window.electronAPI?.markLvDeleteMemory) return await window.electronAPI.markLvDeleteMemory(category, key);
    return { success: false };
  },
  markLvExecuteAction: async (name: string, parameters: any) => {
    if (window.electronAPI?.markLvExecuteAction) return await window.electronAPI.markLvExecuteAction(name, parameters);
    return { success: false, error: "Bridge unavailable" };
  },
  markLvLaunchHud: async () => {
    if (window.electronAPI?.markLvLaunchHud) return await window.electronAPI.markLvLaunchHud();
    return { success: false };
  },

  // Productivity & Focus Engine (Baymax)
  openProductivityWindow: async (): Promise<boolean> => {
    if (window.electronAPI?.openProductivityWindow) return await window.electronAPI.openProductivityWindow();
    return false;
  },
  startFocusSession: async (config: any): Promise<boolean> => {
    if (window.electronAPI?.startFocusSession) return await window.electronAPI.startFocusSession(config);
    return false;
  },
  stopFocusSession: async (): Promise<boolean> => {
    if (window.electronAPI?.stopFocusSession) return await window.electronAPI.stopFocusSession();
    return false;
  },
  getProductivityStats: async (timeframe?: string): Promise<any[]> => {
    if (window.electronAPI?.getProductivityStats) return await window.electronAPI.getProductivityStats(timeframe);
    return [];
  },
  getProductivityDailyTotals: async (): Promise<any[]> => {
    if (window.electronAPI?.getProductivityDailyTotals) return await window.electronAPI.getProductivityDailyTotals();
    return [];
  },
};

export interface DroppedFileInput {
  path?: string;
  name: string;
  buffer?: ArrayBuffer;
  size?: number;
}

export interface DragDropEvent {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
  files?: DroppedFileInput[];
  x?: number;
  y?: number;
}

export async function onDragDrop(handler: (e: DragDropEvent) => void) {
  let dragCount = 0;

  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    dragCount++;
    handler({ type: "enter", x: e.clientX, y: e.clientY });
  });

  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    handler({ type: "over", x: e.clientX, y: e.clientY });
  });

  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCount--;
    if (dragCount <= 0) {
      dragCount = 0;
      handler({ type: "leave" });
    }
  });

  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragCount = 0;
    const dtFiles = e.dataTransfer?.files;
    const paths: string[] = [];
    const files: DroppedFileInput[] = [];

    if (dtFiles && dtFiles.length > 0) {
      for (let i = 0; i < dtFiles.length; i++) {
        const f = dtFiles[i];
        let p = "";
        if (window.electronAPI?.getPathForFile) {
          try {
            p = window.electronAPI.getPathForFile(f);
          } catch (err) {
            console.warn("getPathForFile error:", err);
          }
        }
        if (!p) {
          p = (f as any).path || "";
        }
        if (p) paths.push(p);

        let buf: ArrayBuffer | undefined = undefined;
        try {
          // If no local disk path was obtained, read arrayBuffer so ingestion never fails
          if (!p || !window.electronAPI) {
            buf = await f.arrayBuffer();
          }
        } catch (readErr) {
          console.warn("Could not read file buffer:", readErr);
        }

        files.push({
          path: p || f.name,
          name: f.name || (p ? p.split(/[\\/]/).pop() || "file" : "file"),
          buffer: buf,
          size: f.size || 0,
        });
      }
    }

    handler({ type: "drop", paths, files, x: e.clientX, y: e.clientY });
  });
  return () => {};
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (window.electronAPI) {
    return window.electronAPI.on(name, handler);
  }
  return () => {};
}
