// App state — mirror of AppState.swift (the parts the island needs).

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";

export type AgentSource = "claudeCode" | "n8n";
export type PillBadge = "approval" | "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
}

export interface ApprovalInfo {
  requestId: string;
  sessionId: string;
  tool: string;
  command: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

const task = (
  id: string, name: string, color: string, source: AgentSource,
): AgentTask => ({
  id, name, color, state: "idle", stepIndex: 0, steps: [], source, isIntegration: true,
});

/** AgentTask.integrationAgents — same ids, names and colours as macOS. */
export const INTEGRATION_AGENTS: AgentTask[] = [
  task("integration_claude", "VS Code", "#F5F6F8", "claudeCode"),
  task("integration_resend", "Resend", "#22C55E", "n8n"),
  task("integration_n8n", "n8n", "#F29B38", "n8n"),
  task("integration_vercel", "Vercel", "#7C5CFF", "n8n"),
  task("integration_github", "GitHub", "#F4505E", "n8n"),
  task("integration_notion", "Notion", "#8C8C8C", "n8n"),
  task("integration_calcom", "Cal.com", "#C9956A", "n8n"),
  task("integration_stripe", "Stripe", "#0570DE", "n8n"),
];

export const TOGGLEABLE_INTEGRATION_IDS = [
  "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  "integration_notion", "integration_calcom", "integration_stripe",
];

/** What an integration poller last reported. */
export interface IntegrationInfo {
  data: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

import type { ScheduleItem, PartnerChatMessage } from "./bridge";

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  activeIntegrations: string[];
  screen: "primary" | "cursor";
  autostart: boolean;
  hooksInstalled: boolean;
  model: string;

  // Creator & AI settings
  aiProvider: "gemini" | "openrouter" | "groq";
  geminiApiKey: string;
  openrouterApiKey: string;
  groqApiKey: string;
  geminiModel: string;
  openrouterModel: string;
  groqModel: string;
  micEnabled: boolean;
  userName: string;
  partnerName: string;
  userRole: "me" | "her";
  gdriveApiKey: string;
  gdriveFolderId: string;
  gdriveUploadUrl: string;
  shareChannel: string;
  syncUrl: string;
  syncApiKey?: string;
  notifyPartnerOnline?: boolean;
  appPaths: Record<string, string>;

  // Mark-LV PC Control & Agent Engine Settings
  assistantName?: string;
  voiceName?: string;
  wakeWordEnabled?: boolean;
  pushToTalkEnabled?: boolean;
  proactiveAudio?: boolean;
  thinkingEnabled?: boolean;
  mediaResolution?: "default" | "low" | "medium" | "high";
  morningBriefEnabled?: boolean;
  turnSilenceMs?: number;
  turnPrefixMs?: number;
  turnEndSensitivity?: "high" | "medium" | "low";
  hudStyle?: "face" | "core";
  audioInputDevice?: string;
  audioOutputDevice?: string;
  activeActions?: Record<string, boolean>;
}

export interface IncomingDriveFile {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  webContentLink?: string;
  webViewLink?: string;
  partnerName?: string;
  time?: string;
  downloading?: boolean;
  downloadedPath?: string;
  error?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.14,
  autoCloseInterval: 15,
  absenceInterval: 180,
  activeIntegrations: [
    "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  ],
  screen: "primary",
  autostart: false,
  hooksInstalled: false,
  model: "gemini-2.5-flash",

  aiProvider: "gemini",
  geminiApiKey: "",
  openrouterApiKey: "",
  groqApiKey: "",
  geminiModel: "gemini-2.5-flash",
  openrouterModel: "meta-llama/llama-3.3-70b-instruct:free",
  groqModel: "openai/gpt-oss-120b",
  micEnabled: true,
  userName: "Badsha",
  partnerName: "Ayzil",
  userRole: "me",
  gdriveApiKey: "",
  gdriveFolderId: "",
  gdriveUploadUrl: "",
  shareChannel: "coucou-badsha-ayzil",
  syncUrl: "https://brxmmguaybfozzyrditx.supabase.co/",
  syncApiKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyeG1tZ3VheWJmb3p6eXJkaXR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NDQzNTksImV4cCI6MjEwNjUyMDM1OX0.JW8GbyVOSoUfjHvNVCcPpSGsAf9Qq-BCtGP2RRRIboM",
  notifyPartnerOnline: true,
  appPaths: {
    discord: "Discord",
    whatsapp: "WhatsApp",
    obs: "OBS",
    premiere: "Premiere",
    notepad: "Notepad",
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

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;
  emoteQueue: BotEmoteName | null = null;

  triggerEmote(emote: BotEmoteName) {
    this.emoteQueue = emote;
    this.notify();
  }

  schedule: ScheduleItem[] = [];
  scheduleFilter: "me" | "her" = "me";

  /** Cursor in logical screen pixels, origin top-left (like AppState.mousePosition). */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  droppedFile: { name: string; path: string; uploadedToDrive?: boolean; driveUrl?: string } | null = null;
  incomingFile: IncomingDriveFile | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  pendingApproval: ApprovalInfo | null = null;

  integrations: Record<string, IntegrationInfo> = {};

  partnerOnline = false;
  partnerLastSeen = 0;
  partnerChatMessages: PartnerChatMessage[] = [];
  unreadPartnerChatCount = 0;

  // Remote Access (Mochi Eye Co-Pilot)
  remoteAccessStatus: "idle" | "requesting" | "incoming_request" | "active_host" | "active_viewer" = "idle";
  remoteRequesterName = "";
  remoteActivePartner = "";

  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.steps.push(step);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** loadIntegrationTasks() — VS Code always on, the rest opt-in (max 4). */
  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad =
        proto.id === "integration_claude" || this.settings.activeIntegrations.includes(proto.id);
      const idx = this.tasks.findIndex((t) => t.id === proto.id);
      if (shouldLoad && idx < 0) this.tasks.push({ ...proto, steps: [] });
      if (!shouldLoad && idx >= 0) this.tasks.splice(idx, 1);
    }
    // Keep the declared order so pills never shuffle.
    const order = INTEGRATION_AGENTS.map((t) => t.id);
    this.tasks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    if (!this.focusId) this.focusId = "integration_claude";
    this.notify();
  }

  toggleIntegration(id: string) {
    if (id === "integration_claude") return;
    const active = this.settings.activeIntegrations;
    if (active.includes(id)) {
      this.settings.activeIntegrations = active.filter((x) => x !== id);
      if (this.focusId === id) this.focusId = "integration_claude";
    } else {
      if (active.length >= 4) return;
      this.settings.activeIntegrations = [...active, id];
    }
    this.loadIntegrationTasks();
  }

  defaultView(): IslandViewName {
    return this.tasks.length === 0 ? "empty" : "overview";
  }
}

export const State = new AppState();
