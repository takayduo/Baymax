import { setCompanionPreferences, getAppearance, setMusicHeadphones } from "../companion/appearance";
import { syncCompanionIcon } from "../companion/nativeIcon";
import { allowed, requireFeature } from '../core/account';
// The island: DOM shell, sizing animation, Mochi placement, mouse handling.
// Mirrors IslandRootView.swift + IslandWindowController.swift.

import { Tracked, Spring, clamp } from "../core/anim";
import { Bridge, IS_TAURI, onDragDrop, onEvent, type DragDropEvent, type DroppedFileInput } from "../core/bridge";
import {
  EXPANDED_CORNER, EXPANDED_W, NOTCH_W, PANEL_H, PANEL_W,
  ROUNDED_CORNER, VIEW_LAYOUTS, botGlowColor, botGlowOpacity, botPosition, chatPromptHeight,
  islandSize,
  type IslandMode, type IslandViewName,
} from "../core/layout";
import { Sound } from "../core/sound";
import { State, type IncomingDriveFile } from "../core/state";
import { BotEngine, hexToRGB } from "../mochi/engine";
import { Greeting } from "../mochi/greeting";
import { createMiniBot, pruneMiniBots, syncMiniBotStates, tickMiniBots } from "../mochi/minibots";
import { UploadCanvas } from "../upload/canvas";
import { USC, UploadSeq } from "../upload/sequence";
import { buildHeader, buildViews, type ViewActions, type ViewHost } from "../views/views";
import { h } from "../views/dom";
import { IslandStateMachine } from "./fsm";
import { VoiceManager } from "../core/voice";

const BOT_OVERHANG = 40;
/** Same margin as the Rust hit test (src-tauri/src/island.rs). */
const HIT_MARGIN = 14;

/** The three views the drop sequence owns; leaving them stops the engine. */
const UPLOAD_VIEWS: ReadonlySet<IslandViewName> = new Set(["upload", "uploading", "choose"]);

/** Seconds between the drop and the moment the progress bar starts filling. */
const PRE_PROGRESS = USC.T_PROG_START - USC.T_DROP;

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

export class Island {
  readonly fsm = new IslandStateMachine();

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private clipEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private viewsEl!: HTMLElement;
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private miniGrid!: HTMLElement;
  private countdown!: HTMLElement;
  private wakeStrip!: HTMLElement;

  private header!: ViewHost;
  private views!: Map<IslandViewName, ViewHost>;
  private uploadCanvas!: UploadCanvas;

  private width = new Tracked(NOTCH_W);
  private height = new Tracked(0);
  private radius = new Tracked(ROUNDED_CORNER);
  private botCx = new Spring(46);
  private botCy = new Spring(16);
  private botSize = new Spring(10);

  private engine = new BotEngine();
  private greeting = new Greeting();

  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private canvasPx = 0;

  // Rust starts the window at full size so the launch greeting has room.
  private collapsed = false;
  private collapseTimer: number | null = null;
  private wasInIsland = false;
  /** Last shape handed to Rust for the click-through test. */
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };
  private homeCollapseAt: number | null = null;
  private homeCollapseTimer: number | null = null;

  // Bot hover → love (IslandWindowController.botHoverIn)
  private botHovering = false;
  private botHoverTimer: number | null = null;
  private lastLoveTime = 0;
  private lastSlapClickTime = 0;
  private botHoverStart = { x: 0, y: 0 };

  private confusedRecovery: number | null = null;
  private prevViewBeforeConfused: IslandViewName = "overview";
  private lastSyncedView: IslandViewName | null = null;
  private remoteConsentExpanded = false;
  private upgradeDialogOpen = false;

  /** Drop sequence bookkeeping: last tick played, and whether the ✓ has fired. */
  private uploadTens = 0;
  private uploadDone = false;
  private uploadStartTime: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.wireFsm();
    this.wireInput();
    this.engine.onDizzy = () => this.handleDizzy();
    window.addEventListener('baymax-upgrade-dialog',event=>{
      this.upgradeDialogOpen=(event as CustomEvent<boolean>).detail;
      this.fsm.cancelTimers();if(this.homeCollapseTimer!=null)window.clearTimeout(this.homeCollapseTimer);this.homeCollapseTimer=null;this.homeCollapseAt=null;
      if(this.upgradeDialogOpen){this.greeting.interrupt();void Bridge.focusWindow(true);}
      this.animateGeometry(!this.upgradeDialogOpen);State.notify();
    });
    this.greeting.onComplete = () => this.fsm.greetComplete();
    State.subscribe(() => {
      const remoteConsent = State.view === "remote-control" && State.remoteAccessStatus === "incoming_request";
      if (remoteConsent !== this.remoteConsentExpanded) {
        this.remoteConsentExpanded = remoteConsent;
        this.animateGeometry(!remoteConsent);
      }
      this.dirty = true;
      this.ensureRunning();
    });
    (window as any).coucouApp = this;
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    const actions: ViewActions = {
      setView: (v) => this.setView(v),
      collapse: () => this.collapse(),
      setFocus: (id) => {
        State.setFocus(id);
        Sound.play("blip");
      },
      openTerminal: () => {
        const cwd = State.focusTask?.sessionCwd ?? null;
        void Bridge.openInVSCode(cwd);
      },
      // The ↗ button — same targets as openAgentTarget() on macOS.
      openTarget: () => {
        const task = State.focusTask;
        if (!task) return;
        const urls: Record<string, string> = {
          integration_resend: "https://resend.com/emails",
          integration_vercel: "https://vercel.com/dashboard",
          integration_github: "https://github.com",
          integration_stripe: "https://dashboard.stripe.com/payments",
          integration_notion: "https://notion.so",
          integration_calcom: "https://app.cal.com/bookings",
        };
        if (task.id === "integration_claude") void Bridge.openInVSCode(task.sessionCwd ?? null);
        else if (task.id === "integration_n8n") void Bridge.openN8n();
        else if (urls[task.id]) void Bridge.openUrl(urls[task.id]);
      },
      openUrl: (url) => {
        if (url) void Bridge.openUrl(url);
      },
      decide: (d) => {
        const req = State.pendingApproval;
        void Bridge.log(`decide ${d} req=${req?.requestId ?? "none"}`);
        if (!req) return;
        Sound.play(d === "deny" ? "blip" : "approve");
        void Bridge.approvalDecision(req.requestId, d);
        State.pendingApproval = null;
        State.isPinned = false;
        this.fsm.pinned = false;
        State.updateTask("integration_claude", "working");
        State.setPillBadge("integration_claude", null);
        this.setView(State.defaultView());
      },
      toggleMic: () => {
        State.settings.micEnabled = !(State.settings.micEnabled ?? true);
        if (State.settings.micEnabled) {
          Sound.play("open");
          VoiceManager.start();
        } else {
          Sound.play("close");
          VoiceManager.stop();
        }
        void Bridge.saveSettings({ micEnabled: State.settings.micEnabled });
        State.notify();
      },
      toggleSound: () => {
        State.settings.soundEnabled = !State.settings.soundEnabled;
        Sound.setEnabled(State.settings.soundEnabled);
        void Bridge.saveSettings({ soundEnabled: State.settings.soundEnabled });
        State.notify();
      },
      setVolume: (v) => {
        State.settings.soundVolume = v;
        Sound.setVolume(v);
        void Bridge.saveSettings({ soundVolume: v });
        State.notify();
      },
      setAutoClose: (s) => {
        State.settings.autoCloseInterval = s;
        this.fsm.homeToPetitDelay = s;
        void Bridge.saveSettings({ autoCloseInterval: s });
        State.notify();
      },
      openSettingsWindow: () => this.setView("preferences"),
      blip: () => Sound.play("blip"),
    };

    this.wakeStrip = h("div", { id: "wake-strip" });
    this.botGlow = h("div", { id: "bot-glow" });
    this.botCanvas = h("canvas", { id: "bot-canvas" });
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.miniGrid = h("div", { id: "mini-grid" });
    this.countdown = h("div", { id: "countdown" });

    this.header = buildHeader(actions);
    this.views = buildViews(actions, () => this.animateGeometry(false));
    this.viewsEl = h("div", { id: "views" });
    for (const v of this.views.values()) this.viewsEl.append(v.el);
    this.contentEl = h("div", { id: "content" }, this.header.el, this.viewsEl);

    // The drop sequence draws the card, the bar and its own Mochi. It sits under
    // the header, which stays visible on top of it exactly as on macOS.
    this.uploadCanvas = new UploadCanvas({
      openDrive: () => {
        if (State.settings.gdriveFolderId) {
          void Bridge.openUrl(`https://drive.google.com/drive/folders/${State.settings.gdriveFolderId}`);
        } else {
          this.setView(State.defaultView());
        }
      },
      done: () => this.setView(State.defaultView()),
    });

    this.clipEl = h(
      "div",
      { id: "island-clip" },
      this.greetingCanvas,
      this.uploadCanvas.el,
      this.contentEl,
    );
    this.islandEl = h(
      "div",
      { id: "island" },
      this.clipEl,
      this.botGlow,
      this.botCanvas,
      this.miniGrid,
      this.countdown,
    );

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
    this.greetingCanvas.height = Math.round(150 * dpr);
    this.greetingCanvas.style.width = `${EXPANDED_W}px`;
    this.greetingCanvas.style.height = "150px";

    this.root.append(this.wakeStrip, this.islandEl);
    this.applyGeometry();
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.onTransition = (from, to) => {
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "welcome") this.greeting.interrupt();
          else if (from === "hidden") Sound.play("peek");
          this.setMode("compact");
          if (from === "welcome") State.view = State.defaultView();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(State.defaultView());
          break;
        case "welcome":
          this.expand("greeting");
          this.greeting.start();
          break;
      }
      State.notify();
    };
  }

  launch() {
    this.fsm.launch();
    VoiceManager.init(() => this.animateGeometry(false));
    void onEvent('ai-speech-reset', () => this.engine.setMouthOpen(0));
  }

  // ── Mode / view ─────────────────────────────────────────────────────────────

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    if (mode === "expanded") {
      Sound.play("open");
      void Bridge.setIgnoreMouseEvents(false);
      const layout = VIEW_LAYOUTS[State.view];
      if (layout && layout.botDiameter > 0 && this.botSize.value < 20) {
        this.botSize.set(layout.botDiameter / 0.6);
      }
      this.ensureRunning();
    }
    if (prev === "expanded") {
      Sound.play("close");
      State.isPinned = false;
      void Bridge.focusWindow(false);
    }
    if (mode !== "expanded") {
      this.engine.resetMorph();
      // Nothing can be seen of the sequence once the island is shut, and leaving
      // it running would keep the frame loop awake — the island must cost
      // nothing while hidden.
      UploadSeq.deactivate();
    }
    this.updateWindowCollapsed();
    this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    State.notify();
  }

  /** True while the drop sequence owns the island body. */
  private get uploadActive(): boolean {
    return State.mode === "expanded" && UploadSeq.isActive && UPLOAD_VIEWS.has(State.view);
  }

  /** Navigating out of the drop flow ends the sequence, as on macOS. */
  private stopSequenceIfLeaving(view: IslandViewName) {
    if (!UPLOAD_VIEWS.has(view)) {
      UploadSeq.deactivate();
      this.uploadStartTime = null;
      State.uploadProgress = 0;
    }
  }

  expand(view: IslandViewName) {
    if(view!=="greeting")this.greeting.interrupt();
    this.stopSequenceIfLeaving(view);
    State.view = view;
    this.fsm.state = "home";
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.animateGeometry(false);
    State.lastActivity = performance.now();
    this.homeCollapseAt = null;
    if (this.homeCollapseTimer != null) {
      window.clearTimeout(this.homeCollapseTimer);
      this.homeCollapseTimer = null;
    }
    State.notify();
  }

  setView(view: IslandViewName) {
    if (view === "preferences" || view === "onboarding") {
      this.fsm.cancelTimers();
      if (this.homeCollapseTimer != null) window.clearTimeout(this.homeCollapseTimer);
      this.homeCollapseTimer = null;
      this.homeCollapseAt = null;
    }
    this.stopSequenceIfLeaving(view);
    if (this.fsm.state === "welcome" || State.view === "greeting") {
      this.greeting.interrupt();
      this.fsm.forceHome();
    }
    if (State.mode !== "expanded") {
      this.fsm.forceHome();
      State.view = view;
      this.animateGeometry(false);
      State.notify();
      return;
    }
    const grew = VIEW_LAYOUTS[view].height >= VIEW_LAYOUTS[State.view].height;
    State.view = view;
    State.lastActivity = performance.now();
    this.animateGeometry(!grew);
    State.notify();
  }


  collapse() {
    State.isPinned = false;
    this.fsm.pinned = false;
    if (this.homeCollapseTimer != null) {
      window.clearTimeout(this.homeCollapseTimer);
      this.homeCollapseTimer = null;
    }
    this.homeCollapseAt = null;
    this.countdown.style.width = "0px";
    this.fsm.forcePetit();
  }

  /** Alert from the hook server or file drop: open on this view. Pinned alerts never auto-close. */
  alert(view: IslandViewName) {
    this.fsm.pinned = State.isPinned;
    this.fsm.cancelTimers();
    this.fsm.state = "home";
    this.expand(view);
  }

  reveal() {
    this.fsm.reveal();
  }

  /** An alert stopped waiting for an answer: let the island auto-close again. */
  dropPin() {
    this.fsm.pinned = false;
  }

  // ── File drop ───────────────────────────────────────────────────────────────

  private onDragDrop(e: DragDropEvent) {
    if (e.x !== undefined && e.y !== undefined) {
      this.onCursor(e.x, e.y);
    }
    if (e.type !== "over") void Bridge.log(`drag ${e.type} ${e.paths?.length ?? 0} file(s)`);
    if (State.paused) return;

    switch (e.type) {
      case "enter":
      case "over": {
        void Bridge.setIgnoreMouseEvents(false);
        if (!State.fileDragOver) {
          State.fileDragOver = true;
          this.engine.animateMorph(1);
          // enterZone must run before the island expands, so the sequence is
          // already active by the time the view becomes `upload`.
          UploadSeq.enterZone(State.mouseInIsland.x, State.mouseInIsland.y);
          this.alert("upload");
        } else {
          UploadSeq.updateCursor(State.mouseInIsland.x, State.mouseInIsland.y);
        }
        break;
      }
      case "leave": {
        if (!State.fileDragOver) return;
        State.fileDragOver = false;
        this.engine.animateMorph(0);
        // The island deliberately stays open: the drag session is still alive.
        UploadSeq.exitZone();
        State.notify();
        break;
      }
      case "drop": {
        State.fileDragOver = false;
        const droppedItem =
          e.files?.[0] ||
          (e.paths?.[0]
            ? { path: e.paths[0], name: e.paths[0].split(/[\\/]/).pop() || "file" }
            : null);
        if (!droppedItem) {
          this.engine.animateMorph(0);
          this.setView(State.defaultView());
          return;
        }
        this.swallow(droppedItem);
        break;
      }
    }
  }

  /**
   * Mochi eats the file. Nothing here waits on the file system: the copy into
   * the inbox runs in the background and swaps the path in when it lands, so a
   * slow disk can never stall the animation — same as FileDropHandler on macOS.
   */
  private swallow(fileArg: DroppedFileInput | string) {
    const fileItem =
      typeof fileArg === "string"
        ? { path: fileArg, name: fileArg.split(/[\\/]/).pop() || "file" }
        : fileArg;
    const name =
      fileItem.name || (fileItem.path ? fileItem.path.split(/[\\/]/).pop() || "file" : "file");
    const path = fileItem.path || name;

    State.droppedFile = { name, path };

    this.uploadStartTime = performance.now();
    this.uploadTens = 0;
    this.uploadDone = false;
    State.uploadProgress = 0;

    UploadSeq.performDrop(1.8);

    this.engine.gulp();
    Sound.play("approve");
    this.engine.triggerEmote("happy");
    this.engine.animateMorph(0);

    this.setView("uploading");
    this.ensureRunning();

    void Bridge.ingestFile(fileItem)
      .then((file) => {
        State.droppedFile = {
          name: file.name,
          path: file.path,
          uploadedToDrive: file.uploadedToDrive,
          driveUrl: file.driveUrl,
        };
        State.notify();
      })
      .catch((err) => {
        console.warn("Background file ingest error:", err);
      });
  }

  /**
   * Sounds and view changes: smooth progress bar animation, ticks every 10%,
   * chime when complete, then transitions to choose view.
   */
  private stepSequence() {
    if (this.uploadStartTime == null) return;
    const now = performance.now();
    const elapsed = (now - this.uploadStartTime) / 1000;
    const dur = 1.8;
    const p = Math.max(0, Math.min(1, elapsed / dur));

    if (Math.abs(State.uploadProgress - p) > 0.005 || (p === 1 && State.uploadProgress < 1)) {
      State.uploadProgress = p;
      State.notify();
    }

    const tens = Math.floor(p * 10);
    if (tens > this.uploadTens && tens < 10) {
      this.uploadTens = tens;
      Sound.play("tick");
    }

    if (!this.uploadDone && p >= 1) {
      this.uploadDone = true;
      Sound.play("approve");
      this.engine.triggerEmote("happy");
    }

    if (elapsed >= dur + 0.35 && State.view === "uploading") {
      this.uploadStartTime = null;
      UploadSeq.deactivate();
      this.setView("choose");
    }
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  private targetSize(): { w: number; h: number; r: number } {
    const { w, h } = islandSize(State.mode, State.view, State.chatHistory.length, State.remoteAccessStatus === "incoming_request");
    const r = State.mode === "expanded" ? EXPANDED_CORNER : ROUNDED_CORNER;
    return { w, h: this.upgradeDialogOpen ? Math.max(370,h) : h, r };
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h, r } = this.targetSize();
    if (shrinking) {
      this.width.curveTowards(w);
      this.height.curveTowards(h);
      this.radius.curveTowards(r);
    } else {
      this.width.springTo(w);
      this.height.springTo(h);
      this.radius.springTo(r);
    }
    this.ensureRunning();
  }

  private applyGeometry() {
    const w = Math.max(0, this.width.value);
    const hh = Math.max(0, this.height.value);
    const r = this.radius.value;
    this.islandEl.style.width = `${w}px`;
    this.islandEl.style.height = `${hh}px`;
    this.islandEl.style.borderRadius = `0 0 ${r}px ${r}px`;
    this.islandEl.style.transform = `translateX(-50%)`;
    // These follow the island as it resizes, so they belong here rather than in
    // the state-driven DOM sync.
    this.miniGrid.style.left = `${w - 40 - 14.5}px`;
    this.miniGrid.style.top = `${hh / 2 - 14.5}px`;
    this.greetingCanvas.style.left = `${(w - EXPANDED_W) / 2}px`;
    this.uploadCanvas.el.style.left = `${(w - EXPANDED_W) / 2}px`;

    const winW = window.innerWidth || PANEL_W;
    const rect = { x: (winW - w) / 2, y: 0, w, h: hh };
    const p = this.pushedRect;
    if (Math.abs(p.x - rect.x) > 0.5 || Math.abs(p.w - rect.w) > 0.5 || Math.abs(p.h - rect.h) > 0.5) {
      this.pushedRect = rect;
      void Bridge.setIslandRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  /** Island rect in window coordinates (origin top-left of window). */
  private islandRect(): { x: number; y: number; w: number; h: number } {
    const w = Math.max(0, this.width.value);
    const hh = Math.max(0, this.height.value);
    const winW = window.innerWidth || PANEL_W;
    return { x: (winW - w) / 2, y: 0, w, h: hh };
  }

  // ── Window collapse (hidden → tiny wake strip, zero polling) ────────────────

  private updateWindowCollapsed() {
    if (this.collapseTimer != null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (State.mode === "hidden") {
      // The native transparent surface keeps a stable size while the painted
      // island retracts. Mark idle after the animation, without resizing it.
      this.collapseTimer = window.setTimeout(() => {
        this.collapseTimer = null;
        if (State.mode !== "hidden") return;
        this.collapsed = true;
        void Bridge.setCollapsed(true);
      }, 420);
    } else {
      const nextCollapsed = State.mode !== "expanded";
      this.collapsed = nextCollapsed;
      void Bridge.setCollapsed(nextCollapsed);
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private wireInput() {
    // The wake strip is the only thing the OS can hit while the island is hidden.
    this.wakeStrip.addEventListener("mouseenter", () => {
      Sound.resume();
      this.ensureRunning();
      if (State.mode === "hidden") this.fsm.mouseEntered();
    });

    this.islandEl.addEventListener("mouseenter", () => {
      this.onMouseEnterIsland();
    });

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      this.ensureRunning();
      State.lastActivity = performance.now();
      const hitBot = this.isBotHit(e.clientX, e.clientY);
      if (hitBot) {
        // Native state events can lag behind audio: never rely on a stale busy flag.
        VoiceManager.stopSpeech();
        this.engine.setMouthOpen(0);
      }

      if (this.fsm.state === "welcome" || State.view === "greeting") {
        this.greeting.interrupt();
        this.fsm.forceHome();
        this.setView(State.defaultView());
        return;
      }
      if (State.mode !== "expanded") {
        this.fsm.forceHome();
        return;
      }
      if (hitBot) {
        // Keep the recovery owner intact during the dizzy animation. Further
        // clicks still interrupt speech above, but must not clear its override.
        if (State.stateOverride === "dizzy") return;
        const nowMs = performance.now();
        if (nowMs - this.lastSlapClickTime < 250) {
          return;
        }
        this.lastSlapClickTime = nowMs;
        this.cancelBotHover();
        State.stateOverride = null;
        State.triggerEmote("surprised");
        State.notify();
        this.engine.slap();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && State.mode === "expanded" && !State.isPinned && !this.upgradeDialogOpen) this.collapse();
      State.lastActivity = performance.now();
    });

    void onDragDrop((e) => this.onDragDrop(e));

    // Listen for partner file sharing events from Google Drive
    onEvent<IncomingDriveFile>("incoming-file", (file) => {
      State.incomingFile = file;
      State.isPinned = true;
      this.fsm.pinned = true;
      if (this.homeCollapseTimer != null) {
        window.clearTimeout(this.homeCollapseTimer);
        this.homeCollapseTimer = null;
      }
      this.homeCollapseAt = null;
      this.countdown.style.width = "0px";
      Sound.play("task");
      this.engine.triggerEmote("happy");
      if (State.mode !== "expanded") {
        this.expand("partner-file");
      } else {
        this.setView("partner-file");
      }
      this.ensureRunning();
      State.notify();
    });

    onEvent("mouse-enter", () => this.onMouseEnterIsland());
    onEvent("mouse-leave", () => this.onMouseLeaveIsland());

    // Drive cursor from window events so Mochi tracks mouse and responds to all clicks
    window.addEventListener("mousemove", (e) => this.onCursor(e.clientX, e.clientY));
    document.addEventListener("mouseleave", () => this.onMouseLeaveIsland());
  }

  onMouseEnterIsland() {
    this.wasInIsland = true;
    if (this.homeCollapseTimer != null) {
      window.clearTimeout(this.homeCollapseTimer);
      this.homeCollapseTimer = null;
    }
    this.homeCollapseAt = null;
    this.countdown.style.width = "0px";
    void Bridge.setIgnoreMouseEvents(false);
    if (this.fsm.state === "welcome") this.greeting.hover();
    if(State.voiceCallActive && State.mode!=="expanded")this.fsm.forceHome();
    else this.fsm.mouseEntered();
    this.ensureRunning();
  }

  onMouseLeaveIsland() {
    this.wasInIsland = false;
    void Bridge.setIgnoreMouseEvents(true, { forward: true });

    // If waiting for partner file manual dismiss, or pinned, do not collapse
    if (this.upgradeDialogOpen || State.isPinned || (State.view === "partner-file" || ["preferences","onboarding"].includes(State.view))) {
      this.fsm.cancelTimers();
      return;
    }
    this.fsm.mouseLeft();

    if (State.mode === "expanded") {
      const delay = Math.max(2, Math.min(30, State.settings.autoCloseInterval || 10));
      this.homeCollapseAt = performance.now() + delay * 1000;

      if (this.homeCollapseTimer != null) window.clearTimeout(this.homeCollapseTimer);
      this.homeCollapseTimer = window.setTimeout(() => {
        this.homeCollapseTimer = null;
        const isInputFocused =
          document.hasFocus() && document.activeElement &&
          (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA");
        if (!this.wasInIsland && !State.isPinned && !isInputFocused && State.view !== "partner-file" && State.view !== "preferences" && State.view !== "onboarding" && State.mode === "expanded") {
          this.collapse();
        }
      }, delay * 1000);

      this.ensureRunning();
    }
  }

  /** Cursor in window-logical coordinates. */
  onCursor(x: number, y: number) {
    State.mouse = { x, y };
    const rect = this.islandRect();
    State.mouseInIsland = { x: x - rect.x, y: y - rect.y };

    // Windows sends no cursor position with an OLE drag, so the drop sequence is
    // fed from the Win32 cursor poll instead — it runs throughout the drag.
    if (UploadSeq.isActive && !UploadSeq.dropped) {
      UploadSeq.updateCursor(State.mouseInIsland.x, State.mouseInIsland.y);
    }

    const hidden = rect.h <= 1;
    const hitWidth = hidden ? 240 : rect.w;
    const hitLeft = rect.x + (rect.w - hitWidth) / 2;
    const margin = this.wasInIsland ? 10 : 6;
    const inIsland = x >= hitLeft - margin && x <= hitLeft + hitWidth + margin &&
      y >= rect.y && y <= rect.y + (hidden ? 6 : rect.h) + margin;

    if (inIsland && !this.wasInIsland) {
      this.onMouseEnterIsland();
    } else if (!inIsland && this.wasInIsland) {
      this.onMouseLeaveIsland();
    }
    this.wasInIsland = inIsland;

    // Bot hover → love
    const overBot = State.mode === "expanded" && State.stateOverride == null && this.isBotHit(x, y);
    if (overBot && !this.botHovering) this.botHoverIn(x, y);
    if (!overBot && this.botHovering) this.cancelBotHover();
    this.botHovering = overBot;
    if (this.botHovering) {
      const d = Math.hypot(x - this.botHoverStart.x, y - this.botHoverStart.y);
      if (d > 40) {
        this.botHoverStart = { x, y };
        this.scheduleLove();
      }
    }

    this.ensureRunning();
  }

  private isBotHit(x: number, y: number): boolean {
    if (this.botCanvas.style.display === "none" || this.botCanvas.style.opacity === "0") return false;
    const rect = this.islandRect();
    const cx = rect.x + this.botCx.value;
    const cy = rect.y + this.botCy.value;
    const radius = this.botSize.value / 2;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  }

  private botHoverIn(x: number, y: number) {
    if (performance.now() / 1000 - this.lastLoveTime < 6) return;
    this.botHoverStart = { x, y };
    this.engine.blink();
    this.engine.tgEs = 1.08;
    Sound.play("hover");
    this.scheduleLove();
  }

  private scheduleLove() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = window.setTimeout(() => {
      this.botHoverTimer = null;
      if (!this.botHovering || State.stateOverride != null) return;
      if (performance.now() / 1000 - this.lastLoveTime < 6) return;
      this.lastLoveTime = performance.now() / 1000;
      this.engine.triggerEmote("love");
      Sound.play("love");
    }, 1900);
  }

  private cancelBotHover() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = null;
    this.engine.tgEs = 1;
  }

  /** Three slaps → dizzy + confused view for 3.3 s, then back. */
  handleDizzy() {
    this.prevViewBeforeConfused = State.view === "confused" ? State.defaultView() : State.view;
    State.stateOverride = "dizzy";
    this.engine.setState("dizzy");
    Sound.play("dizzy");
    this.alert("confused");
    if (this.confusedRecovery != null) window.clearTimeout(this.confusedRecovery);
    this.confusedRecovery = window.setTimeout(() => {
      this.confusedRecovery = null;
      State.stateOverride = null;
      this.engine.setState(State.effectiveState);
      if (State.view === "confused") {
        const fallback = State.defaultView();
        this.setView(this.prevViewBeforeConfused === "confused" ? fallback : this.prevViewBeforeConfused);
      }
      this.engine.triggerEmote("happy");
    }, 3400);
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
    this.applyGeometry();

    if (this.dirty) {
      this.dirty = false;
      this.syncDom();
    }

    this.updateBotTargets();
    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    if (greetingActive) {
      const gctx = this.greetingCanvas.getContext("2d");
      if (gctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.greeting.draw(gctx);
      }
    } else {
      // Kept running even while the drop canvas is up, so the island's own Mochi
      // is already in the right place the moment the canvas fades out.
      this.drawBot(dt);
    }

    const uploadActive = this.uploadActive;
    if (uploadActive) this.uploadCanvas.draw(UploadSeq.frame(), nowMs / 1000);
    this.uploadCanvas.el.classList.toggle("on", uploadActive);
    this.viewsEl.classList.toggle("hidden-by-upload", uploadActive);

    tickMiniBots(dt);
    this.views.get(State.view)?.tick?.(nowMs);
    if (UploadSeq.isActive || State.view === "uploading") this.stepSequence();
    this.updateCountdown(nowMs);

    // Nothing is drawn while the island is hidden, so nothing may keep the loop
    // alive either. This used to read `... || this.engine.busy || State.mode !==
    // "hidden"`, and engine.busy is permanently true for any state with a
    // looping animation — breathing, ratelimit sweat, sleeping z's, the search
    // sweep — so a hidden island went on burning frames in exactly the states it
    // spends most of its life in. Geometry still has to finish retracting.
    const settling =
      this.width.animating || this.height.animating || this.radius.animating;
    const busy = State.mode === "hidden"
      ? settling
      : settling ||
        !this.botCx.settled || !this.botCy.settled || !this.botSize.settled ||
        greetingActive || this.engine.busy || UploadSeq.isActive || State.view === "uploading";

    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private updateBotTargets() {
    const p = botPosition(State.mode, State.view, this.height.value, State.uploadProgress);
    this.botCx.target = p.cx;
    this.botCy.target = p.cy;
    if (p.diameter > 0) {
      this.botSize.target = p.diameter / 0.6;
    }

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    // The drop canvas draws its own Mochi; two of them would overlap.
    const visible = p.opacity > 0 && p.diameter > 0 && !greetingActive && !this.uploadActive;
    this.botCanvas.style.opacity = visible ? "1" : "0";
    this.botCanvas.style.display = visible ? "block" : "none";

    if (visible && State.mode === "expanded" && State.view !== "uploading") {
      const d = p.diameter;
      const color = botGlowColor(State.effectiveState);
      this.botGlow.style.display = "block";
      this.botGlow.style.width = `${d * 2.2}px`;
      this.botGlow.style.height = `${d * 2.2}px`;
      this.botGlow.style.left = `${this.botCx.value - d * 1.1}px`;
      this.botGlow.style.top = `${this.botCy.value - d * 1.1}px`;
      this.botGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 62%)`;
      this.botGlow.style.opacity = String(botGlowOpacity(State.effectiveState));
    } else {
      this.botGlow.style.display = "none";
    }
  }

  private drawBot(dt: number) {
    if (this.botCanvas.style.display === "none") return;
    const size = this.botSize.value;
    const w = Math.max(1, Math.round(size));
    const hCss = w + BOT_OVERHANG;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvasPx !== w) {
      this.canvasPx = w;
      this.botCanvas.width = Math.round(w * dpr);
      this.botCanvas.height = Math.round(hCss * dpr);
      this.botCanvas.style.width = `${w}px`;
      this.botCanvas.style.height = `${hCss}px`;
    }
    this.botCanvas.style.left = `${this.botCx.value - w / 2}px`;
    this.botCanvas.style.top = `${this.botCy.value - BOT_OVERHANG / 2 - hCss / 2}px`;

    const ctx = this.botCanvas.getContext("2d");
    if (!ctx) return;

    this.botCanvas.dataset.avatarId = getAppearance().avatar.id;
    this.engine.particleOverhang = BOT_OVERHANG;
    this.engine.lookX = this.lookX();
    this.engine.lookY = this.lookY();
    if (this.engine.morph > 0.3) {
      this.engine.slotHTarget = State.fileDragOver ? 0.2 : 0;
    } else {
      this.engine.slotHTarget = 0;
      if (this.engine.morph < 0.05) {
        this.engine.slotH = 0;
        this.engine.slotHVel = 0;
      }
    }
    this.engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hCss);
    this.engine.draw(ctx, w, hCss);
  }

  /** BotCanvasView.lookX / lookY — tanh of the distance to the bot. */
  private lookX(): number {
    const rect = this.islandRect();
    const botScreenX = rect.x + this.botCx.value;
    return Math.tanh((State.mouse.x - botScreenX) / 260);
  }

  private lookY(): number {
    return -Math.tanh((State.mouse.y - this.botCy.value) / 200);
  }

  private updateCountdown(nowMs: number) {
    if (State.mode !== "expanded" || State.isPinned || (State.view === "partner-file" || State.view === "preferences") || this.homeCollapseAt == null) {
      this.countdown.style.width = "0px";
      return;
    }
    const autoClose = Math.max(2, Math.min(30, State.settings.autoCloseInterval || 10));
    const windowS = Math.min(10, autoClose * 0.8);
    const remaining = (this.homeCollapseAt - nowMs) / 1000;
    if (remaining <= 0) {
      this.countdown.style.width = "0px";
      this.homeCollapseAt = null;
      const isInputFocused =
        document.hasFocus() && document.activeElement &&
        (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA");
      if (!this.wasInIsland && !State.isPinned && !isInputFocused && State.mode === "expanded") {
        this.collapse();
      }
      return;
    }
    this.countdown.style.width =
      remaining < windowS ? `${Math.max(0, clamp(remaining / windowS, 0, 1) * 160)}px` : "0px";
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
    const expanded = State.mode === "expanded";
    if (State.mode !== "hidden" && this.collapsed !== !expanded) {
      this.collapsed = !expanded;
      void Bridge.setCollapsed(this.collapsed);
    }
    const greetingActive = expanded && State.view === "greeting";

    this.contentEl.style.opacity = expanded ? "1" : "0";
    this.contentEl.style.pointerEvents = expanded ? "auto" : "none";
    this.greetingCanvas.style.display = greetingActive ? "block" : "none";
    this.header.el.style.display = greetingActive ? "none" : "";

    this.header.sync();
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) view.sync();
    }

    if (this.lastSyncedView !== State.view) {
      const wasChat = ["prompt","couple-chat","preferences","onboarding"].includes(this.lastSyncedView || "");
      this.lastSyncedView = State.view;
      if (State.view === "prompt" || ["couple-chat","onboarding","preferences"].includes(State.view)) {
        void Bridge.focusWindow(true);
        window.setTimeout(() => this.views.get(State.view)?.focus?.(), 120);
      } else if (wasChat) {
        void Bridge.focusWindow(false);
      }
    }

    // Compact mini grid
    const showGrid = State.mode === "compact";
    this.miniGrid.style.opacity = showGrid ? "1" : "0";
    if (showGrid) {
      const others = State.otherTasks.slice(0, 4);
      const key = others.map((t) => t.id).join("|");
      if (this.miniGrid.dataset.key !== key) {
        this.miniGrid.dataset.key = key;
        this.miniGrid.replaceChildren();
        for (const t of others) {
          this.miniGrid.append(createMiniBot(t, 13));
        }
        pruneMiniBots();
      }
    }

    syncMiniBotStates(State.tasks);
    this.engine.setState(State.effectiveState);
    if (State.emoteQueue) {
      this.engine.triggerEmote(State.emoteQueue);
      State.emoteQueue = null;
    }
  }

  /** Applies settings coming from Rust at boot. */
  applySettings() {
    setMusicHeadphones(State.settings.musicHeadphonesEnabled !== false);
    VoiceManager.syncEngineMode();
    setCompanionPreferences(State.settings.companion);
    syncCompanionIcon();
    Sound.setEnabled(State.settings.soundEnabled);
    Sound.setVolume(State.settings.soundVolume);
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    State.notify();
  }

  get panelSize() {
    return { w: PANEL_W, h: PANEL_H };
  }

  get chatHeight() {
    return chatPromptHeight(State.chatHistory.length);
  }
}
