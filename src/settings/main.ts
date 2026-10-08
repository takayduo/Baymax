// Settings window for Coucou Creator Companion
import "./settings.css";
import { Bridge } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "1.0.0-creator";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

// ── AI Engine Section ─────────────────────────────────────────────────────────

function aiSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const sectionTitle = h("span", { text: "AI Engine & Speech Provider" });
  const statusIndicator = statusDot(true);
  const section = h(
    "section",
    {},
    h("h2", {}, statusIndicator, sectionTitle),
    body
  );

  function draw() {
    clear(body);

    const activeProvider = settings.aiProvider || "gemini";
    statusIndicator.style.background =
      (activeProvider === "gemini" ? !!settings.geminiApiKey : !!settings.groqApiKey)
        ? "#22c55e"
        : "#f4505e";

    // Provider Tabs (Gemini Live vs Groq AI)
    const geminiTab = h("button", {
      class: activeProvider === "gemini" ? "primary" : "",
      style: "flex:1;padding:8px 12px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;",
      text: "⚡ Gemini Live (Default)",
    });

    const groqTab = h("button", {
      class: activeProvider === "groq" ? "primary" : "",
      style: "flex:1;padding:8px 12px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;",
      text: "🚀 Groq AI (Secondary / Fallback)",
    });

    geminiTab.addEventListener("click", async () => {
      settings.aiProvider = "gemini";
      await save();
      draw();
    });

    groqTab.addEventListener("click", async () => {
      settings.aiProvider = "groq";
      await save();
      draw();
    });

    body.append(
      h("div", { style: "display:flex;gap:8px;margin-bottom:4px;" }, geminiTab, groqTab)
    );

    if (activeProvider === "gemini") {
      sectionTitle.textContent = "Google Gemini Live AI Engine";

      body.append(
        h("div", {
          class: "hint",
          text: "Mochi Ultra is powered directly by Google Gemini Live with Mark-LV autonomous tools. Features sub-300ms bidirectional natural speech, vision, and full PC control.",
        })
      );

      // Gemini API Key Input
      const geminiInput = h("input", {
        type: "password",
        placeholder: settings.geminiApiKey ? "•••••••••••• (saved)" : "AIzaSy... or AQ....",
        value: "",
      }) as HTMLInputElement;
      const geminiSave = h("button", { class: "primary", text: "Save" });
      const geminiStatus = statusDot(!!settings.geminiApiKey);

      geminiSave.addEventListener("click", async () => {
        const val = geminiInput.value.trim();
        if (val) {
          settings.geminiApiKey = val;
          geminiInput.value = "";
          geminiInput.placeholder = "•••••••••••• (saved)";
          geminiStatus.style.background = "#22c55e";
          await save();
          draw();
        }
      });

      // Gemini Voice Selector
      const voiceSelect = h("select", {
        style: "flex:1;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.12);",
      }) as HTMLSelectElement;
      const VOICES = [
        { id: "Kore", label: "Kore (Warm & Natural Female)" },
        { id: "Charon", label: "Charon (Calm Male Voice)" },
        { id: "Puck", label: "Puck (Playful & Energetic)" },
        { id: "Fenrir", label: "Fenrir (Deep & Authoritative)" },
        { id: "Aoede", label: "Aoede (Soft & Expressive)" },
      ];
      for (const v of VOICES) {
        const opt = h("option", { value: v.id, text: v.label }) as HTMLOptionElement;
        if ((settings.voiceName || "Kore") === v.id) opt.selected = true;
        voiceSelect.append(opt);
      }
      voiceSelect.addEventListener("change", async () => {
        settings.voiceName = voiceSelect.value;
        await save();
      });

      body.append(
        h("div", { class: "group-title", text: "Gemini Live API Key" }),
        h("div", { class: "row" }, h("label", { text: "API Key" }), geminiInput, geminiSave, geminiStatus),
        h("div", {
          class: "hint",
          style: "margin-top:-4px;font-size:11.5px;",
          text: "Get your free API key at aistudio.google.com. No model selection needed — automatically uses Gemini Live preview for real-time speech and 17 autonomous tools.",
        }),
        h("div", { class: "row", style: "margin-top:6px;" }, h("label", { text: "Voice Model" }), voiceSelect)
      );
    } else {
      sectionTitle.textContent = "Groq Secondary AI Engine (with Local TTS)";

      body.append(
        h("div", {
          class: "hint",
          text: "Secondary fast AI engine powered by Groq LPUs and local SpeechSynthesis TTS. Use this whenever Gemini credits run out, or when you want free, instant token responses and local cute voices.",
        })
      );

      // Groq API Key Input
      const groqInput = h("input", {
        type: "password",
        placeholder: settings.groqApiKey ? "•••••••••••• (saved)" : "gsk_...",
        value: "",
      }) as HTMLInputElement;
      const groqSave = h("button", { class: "primary", text: "Save" });
      const groqStatus = statusDot(!!settings.groqApiKey);

      groqSave.addEventListener("click", async () => {
        const val = groqInput.value.trim();
        if (val) {
          settings.groqApiKey = val;
          groqInput.value = "";
          groqInput.placeholder = "•••••••••••• (saved)";
          groqStatus.style.background = "#22c55e";
          await save();
          draw();
        }
      });

      // Groq Model Dropdown
      const modelSelect = h("select", {
        style: "flex:1;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.12);",
      }) as HTMLSelectElement;

      const GROQ_MODELS = [
        { id: "llama-3.3-70b-versatile", label: "Meta LLaMA 3.3 70B (Recommended — Fast & Smart)" },
        { id: "llama-3.1-8b-instant", label: "Meta LLaMA 3.1 8B (Ultra Fast)" },
        { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B (32k Context)" },
        { id: "gemma2-9b-it", label: "Google Gemma 2 9B" },
        { id: "qwen-2.5-32b", label: "Qwen 2.5 32B" },
      ];

      for (const m of GROQ_MODELS) {
        const opt = h("option", { value: m.id, text: m.label }) as HTMLOptionElement;
        if ((settings.groqModel || "llama-3.3-70b-versatile") === m.id) opt.selected = true;
        modelSelect.append(opt);
      }

      modelSelect.addEventListener("change", async () => {
        settings.groqModel = modelSelect.value;
        await save();
      });

      // Test Local TTS Button
      const testVoiceBtn = h("button", { text: "🔊 Test Local Voice" });
      testVoiceBtn.addEventListener("click", () => {
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance("Hi! Groq mode is active, and I can speak with you using local TTS!");
          u.pitch = 1.12;
          u.rate = 1.02;
          window.speechSynthesis.speak(u);
        }
      });

      body.append(
        h("div", { class: "group-title", text: "Groq API Key" }),
        h("div", { class: "row" }, h("label", { text: "Groq Key" }), groqInput, groqSave, groqStatus),
        h("div", {
          class: "hint",
          style: "margin-top:-4px;font-size:11.5px;",
          text: "Get your free Groq API key at console.groq.com. Instant token generation with 0 cost.",
        }),
        h("div", { class: "group-title", style: "margin-top:8px;", text: "Groq Model Selection" }),
        h("div", { class: "row" }, h("label", { text: "Model" }), modelSelect),
        h("div", { class: "group-title", style: "margin-top:8px;", text: "Voice & Speech (Local TTS)" }),
        h("div", { class: "row" }, h("label", { text: "Local Audio" }), testVoiceBtn),
        h("div", {
          class: "hint",
          style: "margin-top:-4px;font-size:11.5px;",
          text: "In Groq mode, Mochi uses Groq Whisper for speech recognition and local speech synthesis with the previous cute voice.",
        })
      );
    }
  }

  draw();
  return section;
}

// ── Mark-LV PC Control & AI Engine Section ──────────────────────────────────

function markLvSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(true), h("span", { text: "Mark-LV PC Control & AI Engine" })),
    body
  );

  const ACTIONS_METADATA: Array<{ key: string; label: string; desc: string; emoji: string }> = [
    { key: "computer_control", label: "Computer Control", desc: "Mouse clicking, typing, hotkeys, scroll, drag, vision screen finding", emoji: "🖱️" },
    { key: "browser_control", label: "Browser Control", desc: "Playwright autonomous browser navigation, clicks, typing, form fills", emoji: "🌐" },
    { key: "open_app", label: "Open App", desc: "Universal desktop app launcher & Windows executable runner", emoji: "🚀" },
    { key: "close_app", label: "Close App", desc: "Safe targeted application & game closer (Application Paths + process lookup)", emoji: "🛑" },
    { key: "desktop_control", label: "Desktop Control", desc: "Window manager (minimize, maximize, snap left/right, show desktop, clean)", emoji: "🪟" },
    { key: "computer_settings", label: "Computer Settings", desc: "Volume, brightness, mute, dark mode, task manager, sleep display", emoji: "⚙️" },
    { key: "file_controller", label: "File Controller", desc: "File search, creation, reading, copying, moving, deleting", emoji: "📁" },
    { key: "file_processor", label: "File Processor", desc: "Document parser & summarizer (PDF, DOCX, TXT, CSV, analysis)", emoji: "📄" },
    { key: "web_search", label: "Web Search", desc: "DuckDuckGo real-time web & news search, comparison, research", emoji: "🔍" },
    { key: "youtube_video", label: "YouTube Video", desc: "YouTube video playback, summarization & trending videos", emoji: "🎬" },
    { key: "weather_report", label: "Weather Report", desc: "Live global weather forecasts & temperature lookup", emoji: "☀️" },
    { key: "flight_finder", label: "Flight Finder", desc: "Google Flights route search, ticket prices & options", emoji: "✈️" },
    { key: "game_updater", label: "Game Updater", desc: "Steam & Epic Games updates, library inspection, download scheduler", emoji: "🎮" },
    { key: "video_player", label: "Video Player", desc: "Assistant display video playback & mute controls", emoji: "📽️" },
    { key: "reminder", label: "Reminders", desc: "Windows Task Scheduler timed reminders and alarms", emoji: "⏰" },
    { key: "send_message", label: "Send Message", desc: "WhatsApp & Telegram automated message delivery", emoji: "💬" },
    { key: "code_helper", label: "Code Helper", desc: "Python code snippet execution & script analyzer", emoji: "🐍" },
    { key: "dev_agent", label: "Developer Agent", desc: "Autonomous multi-step developer agent for complex coding tasks", emoji: "🤖" },
  ];

  let audioInputs: string[] = [];
  let audioOutputs: string[] = [];
  let memoryEntries: Array<{ category?: string; key?: string; value?: string }> = [];

  async function loadMarkLvData() {
    try {
      const devRes = await Bridge.markLvListDevices();
      if (devRes && devRes.success) {
        audioInputs = devRes.inputs || [];
        audioOutputs = devRes.outputs || [];
      }
    } catch {}

    try {
      const memRes = await Bridge.markLvListMemory();
      if (memRes && memRes.success) {
        memoryEntries = memRes.entries || [];
      }
    } catch {}

    draw();
  }

  function draw() {
    clear(body);

    body.append(
      h("div", {
        class: "hint",
        text: "Full Mark-LV Autonomous Engine: Gives Mochi hands-on desktop control, screen vision, live voice models, turn tuning, audio routing, 17 autonomous action skills, and long-term memory.",
      })
    );

    // ── Group 1: 3D Holographic Avatar & Voice Model ──
    const assistantNameInput = h("input", {
      type: "text",
      value: settings.assistantName || "Baymax",
      placeholder: "Baymax",
      style: "flex:1 1 auto;max-width:200px;",
    }) as HTMLInputElement;
    assistantNameInput.addEventListener("change", () => {
      settings.assistantName = assistantNameInput.value.trim() || "Baymax";
      void save();
    });

    const voiceSelect = h("select", { style: "flex:1 1 auto;max-width:260px;" }) as HTMLSelectElement;
    voiceSelect.append(
      h("option", { value: "Charon", text: "Charon (Deep & Commanding)" }),
      h("option", { value: "Puck", text: "Puck (Energetic & Youthful)" }),
      h("option", { value: "Kore", text: "Kore (Gentle & Serene)" }),
      h("option", { value: "Fenrir", text: "Fenrir (Bold & Resonant)" }),
      h("option", { value: "Aoede", text: "Aoede (Melodic & Warm)" })
    );
    voiceSelect.value = settings.voiceName || "Charon";
    voiceSelect.addEventListener("change", () => {
      settings.voiceName = voiceSelect.value;
      void save();
    });

    body.append(
      h("div", { class: "group-title", text: "Assistant Persona & Live Voice" }),
      h("div", { class: "row" }, h("label", { text: "Assistant Name" }), assistantNameInput),
      h("div", { class: "row" }, h("label", { text: "Live Voice Model" }), voiceSelect)
    );

    // ── Group 2: Voice Gating & Conversational Tuning ──
    const wakeWordToggle = toggle(!!settings.wakeWordEnabled, (v) => {
      settings.wakeWordEnabled = v;
      void save();
    });

    const pushToTalkToggle = toggle(!!settings.pushToTalkEnabled, (v) => {
      settings.pushToTalkEnabled = v;
      void save();
    });

    const proactiveAudioToggle = toggle(settings.proactiveAudio !== false, (v) => {
      settings.proactiveAudio = v;
      void save();
    });

    const thinkingToggle = toggle(!!settings.thinkingEnabled, (v) => {
      settings.thinkingEnabled = v;
      void save();
    });

    const morningBriefToggle = toggle(settings.morningBriefEnabled !== false, (v) => {
      settings.morningBriefEnabled = v;
      void save();
    });

    const mediaResSelect = h("select", { style: "flex:1 1 auto;max-width:260px;" }) as HTMLSelectElement;
    mediaResSelect.append(
      h("option", { value: "medium", text: "Medium (Recommended — Clear Text, Low Tokens)" }),
      h("option", { value: "high", text: "High (Maximum Detail)" }),
      h("option", { value: "low", text: "Low (Ultra Token Saver)" }),
      h("option", { value: "default", text: "Default" })
    );
    mediaResSelect.value = settings.mediaResolution || "medium";
    mediaResSelect.addEventListener("change", () => {
      settings.mediaResolution = mediaResSelect.value as any;
      void save();
    });

    const silenceSlider = h("input", {
      type: "range",
      min: "200",
      max: "3000",
      step: "50",
      value: String(settings.turnSilenceMs || 550),
    }) as HTMLInputElement;
    const silenceVal = h("span", {
      style: "font-family:var(--mono);font-size:12px;color:var(--ink);min-width:55px;",
      text: `${settings.turnSilenceMs || 550} ms`,
    });
    silenceSlider.addEventListener("input", () => {
      const v = Number(silenceSlider.value);
      settings.turnSilenceMs = v;
      silenceVal.textContent = `${v} ms`;
      void save();
    });

    const prefixSlider = h("input", {
      type: "range",
      min: "0",
      max: "1000",
      step: "25",
      value: String(settings.turnPrefixMs || 150),
    }) as HTMLInputElement;
    const prefixVal = h("span", {
      style: "font-family:var(--mono);font-size:12px;color:var(--ink);min-width:55px;",
      text: `${settings.turnPrefixMs || 150} ms`,
    });
    prefixSlider.addEventListener("input", () => {
      const v = Number(prefixSlider.value);
      settings.turnPrefixMs = v;
      prefixVal.textContent = `${v} ms`;
      void save();
    });

    const endSensSelect = h("select", { style: "flex:1 1 auto;max-width:260px;" }) as HTMLSelectElement;
    endSensSelect.append(
      h("option", { value: "high", text: "High (Snappy Cutoff — Recommended)" }),
      h("option", { value: "default", text: "Default (Standard Pause)" })
    );
    endSensSelect.value = settings.turnEndSensitivity || "high";
    endSensSelect.addEventListener("change", () => {
      settings.turnEndSensitivity = endSensSelect.value as any;
      void save();
    });

    body.append(
      h("div", { class: "group-title", text: "Voice Gating & Conversational Tuning" }),
      h("div", { class: "row" }, h("label", { text: "Wake-Word Gating" }), wakeWordToggle, h("span", { class: "hint", text: "Listens for 'Hey Jarvis' / 'Hey Mochi' before waking" })),
      h("div", { class: "row" }, h("label", { text: "Push-To-Talk" }), pushToTalkToggle, h("span", { class: "hint", text: "Hold key combo to speak to assistant" })),
      h("div", { class: "row" }, h("label", { text: "Proactive Audio" }), proactiveAudioToggle, h("span", { class: "hint", text: "Intelligently ignores background conversation" })),
      h("div", { class: "row" }, h("label", { text: "Deep Thinking Mode" }), thinkingToggle, h("span", { class: "hint", text: "Allow model reasoning tokens before replying" })),
      h("div", { class: "row" }, h("label", { text: "Morning Briefing" }), morningBriefToggle, h("span", { class: "hint", text: "Auto-briefs weather, news, and tasks on first startup" })),
      h("div", { class: "row" }, h("label", { text: "Vision Resolution" }), mediaResSelect),
      h("div", { class: "row" }, h("label", { text: "Turn Silence Delay" }), silenceSlider, silenceVal),
      h("div", { class: "row" }, h("label", { text: "Turn Prefix Buffer" }), prefixSlider, prefixVal),
      h("div", { class: "row" }, h("label", { text: "End Sensitivity" }), endSensSelect)
    );

    // ── Group 3: Audio Hardware Endpoints ──
    const micSelect = h("select", { style: "flex:1 1 auto;max-width:320px;" }) as HTMLSelectElement;
    micSelect.append(h("option", { value: "", text: "System Default Microphone" }));
    for (const inDev of audioInputs) {
      micSelect.append(h("option", { value: inDev, text: inDev }));
    }
    micSelect.value = settings.audioInputDevice || "";
    micSelect.addEventListener("change", () => {
      settings.audioInputDevice = micSelect.value;
      void save();
    });

    const spkSelect = h("select", { style: "flex:1 1 auto;max-width:320px;" }) as HTMLSelectElement;
    spkSelect.append(h("option", { value: "", text: "System Default Speaker / Headphones" }));
    for (const outDev of audioOutputs) {
      spkSelect.append(h("option", { value: outDev, text: outDev }));
    }
    spkSelect.value = settings.audioOutputDevice || "";
    spkSelect.addEventListener("change", () => {
      settings.audioOutputDevice = spkSelect.value;
      void save();
    });

    const refreshAudioBtn = h("button", {
      class: "secondary",
      style: "font-size:12px;padding:5px 12px;",
      text: "🔄 Refresh Devices",
    });
    refreshAudioBtn.addEventListener("click", () => void loadMarkLvData());

    body.append(
      h("div", { class: "group-title", style: "display:flex;align-items:center;justify-content:space-between;" },
        h("span", { text: "Audio Hardware Routing" }),
        refreshAudioBtn
      ),
      h("div", { class: "row" }, h("label", { text: "Microphone" }), micSelect),
      h("div", { class: "row" }, h("label", { text: "Audio Output" }), spkSelect)
    );

    // ── Group 4: Autonomous PC Control Actions (17 Actions) ──
    const actionsContainer = h("div", {
      style: "display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:10px;margin-top:6px;",
    });

    const enableAllBtn = h("button", { class: "secondary", style: "font-size:11.5px;padding:4px 10px;", text: "Enable All" });
    const disableAllBtn = h("button", { class: "secondary", style: "font-size:11.5px;padding:4px 10px;", text: "Disable All" });

    enableAllBtn.addEventListener("click", () => {
      if (!settings.activeActions) settings.activeActions = {};
      for (const act of ACTIONS_METADATA) {
        settings.activeActions[act.key] = true;
      }
      void save();
      draw();
    });

    disableAllBtn.addEventListener("click", () => {
      if (!settings.activeActions) settings.activeActions = {};
      for (const act of ACTIONS_METADATA) {
        settings.activeActions[act.key] = false;
      }
      void save();
      draw();
    });

    for (const act of ACTIONS_METADATA) {
      const isEnabled = settings.activeActions ? settings.activeActions[act.key] !== false : true;
      const actToggle = toggle(isEnabled, (v) => {
        if (!settings.activeActions) settings.activeActions = {};
        settings.activeActions[act.key] = v;
        void save();
      });

      const card = h(
        "div",
        {
          style:
            "background:rgba(255,255,255,0.03);border:1px solid var(--hairline);border-radius:10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;",
        },
        h(
          "div",
          { style: "display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;" },
          h("div", { style: "font-weight:600;font-size:12.5px;color:var(--ink);display:flex;align-items:center;gap:6px;" },
            h("span", { text: act.emoji }),
            h("span", { text: act.label })
          ),
          h("div", { style: "font-size:11px;color:var(--dim);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;", text: act.desc })
        ),
        actToggle
      );
      actionsContainer.append(card);
    }

    body.append(
      h(
        "div",
        { class: "group-title", style: "display:flex;align-items:center;justify-content:space-between;" },
        h("span", { text: `Autonomous PC Action Skills (${ACTIONS_METADATA.length} Actions)` }),
        h("div", { style: "display:flex;gap:6px;" }, enableAllBtn, disableAllBtn)
      ),
      actionsContainer
    );

    // ── Group 5: Long-Term Memory Vault ──
    const memoryContainer = h("div", {
      style: "display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;padding-right:4px;",
    });

    if (memoryEntries.length === 0) {
      memoryContainer.append(
        h("div", {
          style: "font-size:12px;color:var(--dim);padding:8px 0;font-style:italic;",
          text: "No persistent memories saved yet. Mochi will learn about you and your preferences over time, or you can add facts below.",
        })
      );
    } else {
      for (const item of memoryEntries) {
        const cat = item.category || "notes";
        const key = item.key || "";
        const val = item.value || "";

        const forgetBtn = h("button", {
          class: "danger",
          style: "font-size:11px;padding:3px 8px;",
          text: "🗑️ Forget",
        });

        forgetBtn.addEventListener("click", async () => {
          forgetBtn.setAttribute("disabled", "true");
          forgetBtn.textContent = "Removing...";
          try {
            await Bridge.markLvDeleteMemory(cat, key);
            await loadMarkLvData();
          } catch {}
        });

        const memRow = h(
          "div",
          {
            style:
              "background:rgba(255,255,255,0.03);border:1px solid var(--hairline);border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;",
          },
          h(
            "div",
            { style: "display:flex;flex-direction:column;gap:3px;flex:1 1 auto;min-width:0;" },
            h(
              "div",
              { style: "display:flex;align-items:center;gap:6px;" },
              h("span", {
                style:
                  "background:rgba(0,212,255,0.12);color:#00d4ff;padding:1px 6px;border-radius:4px;font-size:10.5px;font-weight:600;text-transform:uppercase;",
                text: cat,
              }),
              h("span", { style: "font-weight:600;font-size:12px;color:var(--ink);", text: key })
            ),
            h("span", { style: "font-size:11.5px;color:var(--dim);", text: val })
          ),
          forgetBtn
        );
        memoryContainer.append(memRow);
      }
    }

    // Add Memory Form
    const newCatSelect = h("select", { style: "font-size:12px;padding:4px 6px;" }) as HTMLSelectElement;
    newCatSelect.append(
      h("option", { value: "identity", text: "Identity" }),
      h("option", { value: "preferences", text: "Preferences" }),
      h("option", { value: "projects", text: "Projects" }),
      h("option", { value: "relationships", text: "Relationships" }),
      h("option", { value: "wishes", text: "Wishes" }),
      h("option", { value: "notes", text: "Notes" })
    );

    const newKeyInput = h("input", {
      type: "text",
      placeholder: "Key (e.g. Favorite food)",
      style: "flex:1 1 120px;font-size:12px;",
    }) as HTMLInputElement;

    const newValInput = h("input", {
      type: "text",
      placeholder: "Value (e.g. Ramen)",
      style: "flex:2 1 180px;font-size:12px;",
    }) as HTMLInputElement;

    const addMemoryBtn = h("button", {
      class: "primary",
      style: "font-size:12px;padding:5px 12px;white-space:nowrap;",
      text: "➕ Remember",
    });

    addMemoryBtn.addEventListener("click", async () => {
      const k = newKeyInput.value.trim();
      const v = newValInput.value.trim();
      const c = newCatSelect.value;
      if (!k || !v) return;

      addMemoryBtn.setAttribute("disabled", "true");
      try {
        await Bridge.markLvSaveMemory(c, k, v);
        newKeyInput.value = "";
        newValInput.value = "";
        await loadMarkLvData();
      } finally {
        addMemoryBtn.removeAttribute("disabled");
      }
    });

    const addForm = h(
      "div",
      {
        style:
          "display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:rgba(255,255,255,0.02);border:1px dashed var(--hairline);border-radius:8px;padding:8px 10px;",
      },
      newCatSelect,
      newKeyInput,
      newValInput,
      addMemoryBtn
    );

    body.append(
      h("div", { class: "group-title", text: "Long-Term Memory Vault" }),
      memoryContainer,
      addForm
    );
  }

  void loadMarkLvData();

  return section;
}

// ── Couple Identity Section ───────────────────────────────────────────────────

function coupleSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(true), h("span", { text: "Creator Couple Profile" })),
    body
  );

  const roleMe = h("button", {
    class: (settings.userRole || "me") === "me" ? "btn primary" : "btn secondary",
    text: "This is My PC (Badsha 👤)",
  });
  const roleHer = h("button", {
    class: (settings.userRole || "me") === "her" ? "btn primary" : "btn secondary",
    text: "This is Her PC (Ayzil 💖)",
  });

  const getCreator = () => (settings.userName && settings.userName !== "Me" ? settings.userName : "Badsha");
  const getPartner = () => (settings.partnerName && settings.partnerName !== "Her" ? settings.partnerName : "Ayzil");

  const updateRoleButtons = () => {
    const creator = getCreator();
    const partner = getPartner();
    const isMe = (settings.userRole || "me") === "me";
    roleMe.textContent = `This is My PC (${creator} 👤)`;
    roleHer.textContent = `This is Her PC (${partner} 💖)`;
    roleMe.className = isMe ? "btn primary" : "btn secondary";
    roleHer.className = !isMe ? "btn primary" : "btn secondary";
  };

  roleMe.addEventListener("click", () => {
    settings.userRole = "me";
    updateRoleButtons();
    void save();
  });

  roleHer.addEventListener("click", () => {
    settings.userRole = "her";
    updateRoleButtons();
    void save();
  });

  const userNameInput = h("input", {
    type: "text",
    value: getCreator(),
    placeholder: "e.g. Badsha",
  }) as HTMLInputElement;
  const saveUserName = () => {
    settings.userName = userNameInput.value.trim() || "Badsha";
    updateRoleButtons();
    void save();
  };
  userNameInput.addEventListener("change", saveUserName);
  userNameInput.addEventListener("blur", saveUserName);

  const partnerNameInput = h("input", {
    type: "text",
    value: getPartner(),
    placeholder: "e.g. Ayzil",
  }) as HTMLInputElement;
  const savePartnerName = () => {
    settings.partnerName = partnerNameInput.value.trim() || "Ayzil";
    updateRoleButtons();
    void save();
  };
  partnerNameInput.addEventListener("change", savePartnerName);
  partnerNameInput.addEventListener("blur", savePartnerName);

  updateRoleButtons();

  const notifyOnlineToggle = toggle(settings.notifyPartnerOnline !== false, (on) => {
    settings.notifyPartnerOnline = on;
    void save();
  });

  body.append(
    h("div", {
      class: "hint",
      text: "Configure couple identity. Keep Creator and Partner names the same on both computers, then simply select 'This is My PC (Me 👤)' on your computer and 'This is Her PC (Her 💖)' on her computer.",
    }),
    h("div", { class: "row", style: "gap:10px" }, roleMe, roleHer),
    h("div", { class: "row" }, h("label", { text: "Creator Name (Me 👤)" }), userNameInput),
    h("div", { class: "row" }, h("label", { text: "Partner Name (Her 💖)" }), partnerNameInput),
    h(
      "div",
      {
        class: "row",
        style:
          "display:flex;align-items:center;justify-content:space-between;padding:8px 0 4px;border-top:1px solid rgba(255,255,255,0.06);margin-top:4px;",
      },
      h(
        "div",
        { style: "display:flex;flex-direction:column;gap:3px;" },
        h("label", { style: "font-weight:600;color:var(--ink);cursor:pointer;", text: "Notify when Partner comes online 🔔" }),
        h(
          "span",
          { class: "hint", style: "margin:0;font-size:11.5px;color:rgba(255,255,255,0.5);", text: "Plays a sweet chime, hearts emote, and notification when your partner turns on their PC" }
        )
      ),
      notifyOnlineToggle
    )
  );

  return section;
}

// ── Supabase Live Realtime PC-to-PC Sync ────────────────────────────────────

function supabaseSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const hasConfig = !!(settings.syncUrl && settings.syncApiKey);
  const statusDotEl = statusDot(hasConfig);
  const section = h(
    "section",
    {},
    h("h2", {}, statusDotEl, h("span", { text: "Live PC-to-PC Sync (Supabase Realtime)" })),
    body
  );

  const urlInput = h("input", {
    type: "text",
    value: settings.syncUrl || "",
    placeholder: "https://your-project-id.supabase.co",
    style: "flex:1 1 auto;font-size:12px;",
  }) as HTMLInputElement;

  const keyInput = h("input", {
    type: "password",
    value: "",
    placeholder: settings.syncApiKey ? "•••••••••••• (saved anon key)" : "eyJhbGciOiJIUzI1NiIsInR5cCI...",
    style: "flex:1 1 auto;font-size:12px;",
  }) as HTMLInputElement;

  const testBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 14px;",
    text: "🔍 Test Connection",
  });

  const saveBtn = h("button", {
    class: "primary",
    style: "font-size:12px;padding:6px 16px;background:#22c55e;color:#000;font-weight:600;",
    text: "💾 Save & Connect",
  });

  const statusMsg = h("div", {
    class: "path",
    style: "font-size:12px;font-weight:500;padding:4px 0;",
    text: hasConfig ? "Configured — Ready for live synchronization" : "Not configured yet",
  });

  saveBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    const key = keyInput.value.trim();
    if (url) settings.syncUrl = url;
    if (key) {
      settings.syncApiKey = key;
      keyInput.value = "";
      keyInput.placeholder = "•••••••••••• (saved anon key)";
    }
    await save();
    statusMsg.textContent = "Saved settings! Testing connection...";
    statusMsg.style.color = "var(--ink)";
    runTest();
  });

  async function runTest() {
    const url = urlInput.value.trim() || settings.syncUrl;
    const key = keyInput.value.trim() || settings.syncApiKey;
    if (!url || !key) {
      statusMsg.textContent = "Please enter both Supabase Project URL and Anon Key.";
      statusMsg.style.color = "#f4505e";
      statusDotEl.style.background = "#f4505e";
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = "Testing...";
    statusMsg.textContent = "Connecting to Supabase...";
    statusMsg.style.color = "var(--dim)";

    try {
      const res = await Bridge.testSupabase({ url, key });
      if (res && res.success) {
        statusMsg.textContent = "🟢 Connected! Supabase WebSockets active (<50ms latency).";
        statusMsg.style.color = "#22c55e";
        statusDotEl.style.background = "#22c55e";
        void updateCloudStatus();
      } else {
        statusMsg.textContent = `🔴 Connection failed: ${res?.error || "Unknown error"}`;
        statusMsg.style.color = "#f4505e";
        statusDotEl.style.background = "#f4505e";
      }
    } catch (err: any) {
      statusMsg.textContent = `🔴 Error: ${err.message || err}`;
      statusMsg.style.color = "#f4505e";
      statusDotEl.style.background = "#f4505e";
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "🔍 Test Connection";
    }
  }

  testBtn.addEventListener("click", () => void runTest());

  // ── 24/7 Offline Cloud Sync Card ───────────────────────────────────────────
  const offlineStatusDot = statusDot(false);
  const offlineStatusTitle = h("span", {
    style: "font-weight:600;font-size:12.5px;color:var(--ink);",
    text: "Checking 24/7 offline cloud storage...",
  });

  const offlineDesc = h("div", {
    style: "font-size:12px;color:var(--dim);line-height:1.55;",
    text: "When 24/7 offline storage is active, any message she sends or task she adds while your PC is completely turned off will be delivered the instant your computer boots up.",
  });

  const copySqlBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 14px;display:flex;align-items:center;gap:6px;",
    text: "📋 Copy 1-Click SQL Setup",
  });

  const checkCloudBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 14px;",
    text: "🔄 Refresh Cloud Status",
  });

  const sqlSteps = h(
    "div",
    {
      style:
        "display:none;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px 12px;font-size:11.5px;color:var(--dim);line-height:1.6;margin-top:4px;",
    },
    h("div", { style: "font-weight:600;color:var(--ink);margin-bottom:2px;", text: "How to enable 24/7 offline delivery in 30 seconds:" }),
    h("div", { text: "1. Click '📋 Copy 1-Click SQL Setup' above." }),
    h("div", { text: "2. Open supabase.com ➔ your project ➔ click 'SQL Editor' on the left menu." }),
    h("div", { text: "3. Click '+ New Query', paste the code, and click 'Run'!" }),
    h("div", { text: "4. Return here and click '🔄 Refresh Cloud Status' to verify." })
  );

  async function updateCloudStatus() {
    try {
      const url = urlInput.value.trim() || settings.syncUrl;
      const key = keyInput.value.trim() || settings.syncApiKey;
      const res = await Bridge.checkSupabaseCloudStatus({ url, key });
      if (res && res.ready) {
        offlineStatusDot.style.background = "#22c55e";
        offlineStatusTitle.textContent = "🟢 24/7 Cloud Mailbox Active (Never Miss a Message)";
        offlineStatusTitle.style.color = "#22c55e";
        offlineDesc.textContent =
          "✅ Connected! All messages and tasks are stored 24/7 in your private Supabase database. You and Ayzil will receive all messages and task updates even if one of your PCs was shut down or offline!";
        sqlSteps.style.display = "none";
        copySqlBtn.style.display = "none";
      } else {
        offlineStatusDot.style.background = "#f5a524";
        const errHint = res?.error ? ` (${res.error})` : " (24/7 Cloud Tables Not Set Up Yet)";
        offlineStatusTitle.textContent = `🟡 Realtime & Peer Sync Active${errHint}`;
        offlineStatusTitle.style.color = "#f5a524";
        offlineDesc.textContent =
          "Live chat works while both PCs are on. To receive messages and tasks sent while your computer is completely shut down, copy the 1-click SQL setup script below and run it once in your Supabase SQL Editor.";
        sqlSteps.style.display = "block";
        copySqlBtn.style.display = "inline-flex";
      }
    } catch {
      offlineStatusDot.style.background = "#9398a1";
      offlineStatusTitle.textContent = "Offline cloud status unavailable";
    }
  }

  copySqlBtn.addEventListener("click", async () => {
    try {
      const sql = await Bridge.getSupabaseSqlSetup();
      if (sql) {
        await navigator.clipboard.writeText(sql);
        copySqlBtn.textContent = "✅ Copied to Clipboard!";
        setTimeout(() => {
          copySqlBtn.textContent = "📋 Copy 1-Click SQL Setup";
        }, 3000);
      }
    } catch (e: any) {
      alert("Could not copy to clipboard: " + e.message);
    }
  });

  checkCloudBtn.addEventListener("click", () => void updateCloudStatus());

  setTimeout(() => {
    void updateCloudStatus();
  }, 300);

  const offlineCard = h(
    "div",
    {
      style:
        "background:rgba(255,255,255,0.03);border:1px solid var(--hairline);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px;margin-top:6px;",
    },
    h("div", { style: "display:flex;align-items:center;gap:8px;" }, offlineStatusDot, offlineStatusTitle),
    offlineDesc,
    h("div", { style: "display:flex;align-items:center;gap:8px;margin-top:2px;" }, copySqlBtn, checkCloudBtn),
    sqlSteps
  );

  // Quick 2-Minute Setup Guide card
  const guideCard = h(
    "div",
    {
      style:
        "background:rgba(255,255,255,0.03);border:1px solid var(--hairline);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;margin-top:6px;",
    },
    h(
      "div",
      { style: "font-weight:600;font-size:12.5px;color:var(--ink);display:flex;align-items:center;gap:6px;" },
      h("span", { text: "⚡ 2-Minute Free Supabase Setup Guide" })
    ),
    h(
      "div",
      { style: "font-size:12px;color:var(--dim);line-height:1.6;" },
      h("div", { text: "1. Go to supabase.com (100% Free, no credit card required) and click 'Start your project'." }),
      h("div", { text: "2. Click 'New project', name it 'Coucou', set any password, and select your nearest region." }),
      h("div", { text: "3. In your dashboard, click ⚙️ Project Settings (bottom-left) ➔ API." }),
      h("div", { text: "4. Copy the Project URL and anon public Key, paste them above, and click 'Save & Connect'." }),
      h("div", {
        style: "color:#22c55e;margin-top:4px;font-weight:500;",
        text: "✓ Done! Tasks and incoming files will now synchronize between both PCs in real time (<100ms) with presence detection.",
      })
    )
  );

  body.append(
    h("div", {
      class: "hint",
      text: "Supabase Realtime provides live sub-50ms WebSockets between Badsha and Ayzil's PCs. When either of you adds or checks a task, or shares a file, the changes sync instantly without any local network or port forwarding needed.",
    }),
    h("div", { class: "row" }, h("label", { text: "Project URL" }), urlInput),
    h("div", { class: "row" }, h("label", { text: "Anon Public Key" }), keyInput),
    h("div", { class: "row", style: "gap:10px;margin-top:4px;" }, saveBtn, testBtn),
    statusMsg,
    offlineCard,
    guideCard
  );

  return section;
}

// ── Instant Pair Sharing & Google Drive ──────────────────────────────────────

function cloudSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(true), h("span", { text: "Pair File Sharing & Google Drive" })),
    body
  );

  const channelInput = h("input", {
    type: "text",
    value: settings.shareChannel || "coucou-badsha-ayzil",
    placeholder: "Pair Channel Name...",
  }) as HTMLInputElement;

  const channelSave = h("button", { class: "primary", text: "Save" });
  const channelStatus = statusDot(true);

  channelSave.addEventListener("click", async () => {
    const val = channelInput.value.trim() || "coucou-badsha-ayzil";
    settings.shareChannel = val;
    channelInput.value = val;
    await save();
  });

  const folderInput = h("input", {
    type: "text",
    value: settings.gdriveFolderId || "1d-IQvgmZTBDcUkIy7f_kJHl2YCgc80CE",
    placeholder: "Drive Folder ID...",
  }) as HTMLInputElement;

  const folderSave = h("button", { class: "primary", text: "Save" });
  const folderStatus = statusDot(!!settings.gdriveFolderId);

  folderSave.addEventListener("click", async () => {
    let val = folderInput.value.trim();
    const match = val.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match) val = match[1];
    settings.gdriveFolderId = val;
    folderInput.value = val;
    folderStatus.style.background = val ? "#22c55e" : "#f4505e";
    await save();
  });

  const openFolderBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 12px;",
    text: "Open Drive Folder ↗",
    onclick: () => {
      const fid = settings.gdriveFolderId || "1d-IQvgmZTBDcUkIy7f_kJHl2YCgc80CE";
      void Bridge.openUrl(`https://drive.google.com/drive/folders/${fid}`);
    },
  });

  // Google OAuth Elements
  const oauthStatusDot = statusDot(false);
  const oauthStatusText = h("span", {
    style: "font-size:12px;font-weight:500;color:var(--dim);word-break:break-all;",
    text: "Checking Google Account...",
  });

  const clientIdInput = h("input", {
    type: "text",
    placeholder: "Client ID (.apps.googleusercontent.com)",
    style: "flex:1 1 auto;font-size:11.5px;",
  }) as HTMLInputElement;

  const clientSecretInput = h("input", {
    type: "password",
    placeholder: "Client Secret",
    style: "width:180px;font-size:11.5px;",
  }) as HTMLInputElement;

  const selectOAuthJsonBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 12px;",
    text: "📂 Load client_secret.json",
  });

  const connectOAuthBtn = h("button", {
    class: "primary",
    style: "font-size:12px;padding:6px 16px;background:#22c55e;color:#000;font-weight:600;",
    text: "🔗 Sign In with Google",
  });

  const disconnectOAuthBtn = h("button", {
    class: "danger",
    style: "display:none;font-size:11.5px;padding:4px 10px;",
    text: "Disconnect",
  });

  const testBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 12px;",
    text: "🔍 Test Drive Connection",
  });

  const testFeedback = h("div", {
    style: "display:none;font-size:12px;padding:8px 12px;border-radius:6px;line-height:1.45;",
  });

  async function updateOAuthStatus() {
    try {
      const status = await Bridge.googleOAuthStatus();
      if (status.connected && status.email) {
        oauthStatusDot.style.background = "#22c55e";
        oauthStatusText.textContent = `Connected: ${status.email} (15 GB Storage)`;
        oauthStatusText.style.color = "#22c55e";
        connectOAuthBtn.style.display = "none";
        disconnectOAuthBtn.style.display = "inline-block";
        clientIdInput.style.display = "none";
        clientSecretInput.style.display = "none";
        selectOAuthJsonBtn.style.display = "none";
      } else {
        oauthStatusDot.style.background = "#9398a1";
        oauthStatusText.textContent = "Google Account not connected";
        oauthStatusText.style.color = "var(--dim)";
        connectOAuthBtn.style.display = "inline-block";
        disconnectOAuthBtn.style.display = "none";
        clientIdInput.style.display = "block";
        clientSecretInput.style.display = "block";
        selectOAuthJsonBtn.style.display = "inline-block";
        if (status.clientId) clientIdInput.value = status.clientId;
        if (status.clientSecret) clientSecretInput.value = status.clientSecret;
      }
    } catch {
      oauthStatusDot.style.background = "#9398a1";
      oauthStatusText.textContent = "OAuth status unavailable";
    }
  }

  void updateOAuthStatus();

  selectOAuthJsonBtn.addEventListener("click", async () => {
    testFeedback.style.display = "none";
    const res = await Bridge.selectOAuthClient();
    if (res.canceled) return;
    if (res.success && res.clientId && res.clientSecret) {
      clientIdInput.value = res.clientId;
      clientSecretInput.value = res.clientSecret;
      testFeedback.style.display = "block";
      testFeedback.style.background = "rgba(34,197,94,0.12)";
      testFeedback.style.border = "1px solid rgba(34,197,94,0.3)";
      testFeedback.style.color = "#22c55e";
      testFeedback.textContent = "✅ Loaded OAuth Client JSON! Click 'Sign In with Google' below to authorize.";
    } else if (res.error) {
      testFeedback.style.display = "block";
      testFeedback.style.background = "rgba(244,80,94,0.12)";
      testFeedback.style.border = "1px solid rgba(244,80,94,0.3)";
      testFeedback.style.color = "#f4505e";
      testFeedback.textContent = `❌ ${res.error}`;
    }
  });

  connectOAuthBtn.addEventListener("click", async () => {
    const clientId = clientIdInput.value.trim();
    const clientSecret = clientSecretInput.value.trim();
    if (!clientId || !clientSecret) {
      testFeedback.style.display = "block";
      testFeedback.style.background = "rgba(244,80,94,0.12)";
      testFeedback.style.border = "1px solid rgba(244,80,94,0.3)";
      testFeedback.style.color = "#f4505e";
      testFeedback.textContent = "Please select your OAuth client JSON or enter Client ID & Secret first.";
      return;
    }

    testFeedback.style.display = "block";
    testFeedback.style.background = "rgba(255,255,255,0.06)";
    testFeedback.style.border = "1px solid rgba(255,255,255,0.1)";
    testFeedback.style.color = "var(--ink)";
    testFeedback.textContent = "Browser opened for Google sign in. Authorize with your account...";

    connectOAuthBtn.setAttribute("disabled", "true");
    const res = await Bridge.googleOAuthStart({ clientId, clientSecret });
    connectOAuthBtn.removeAttribute("disabled");

    if (res.success) {
      await updateOAuthStatus();
      testFeedback.style.background = "rgba(34,197,94,0.12)";
      testFeedback.style.border = "1px solid rgba(34,197,94,0.3)";
      testFeedback.style.color = "#22c55e";
      testFeedback.textContent = `🎉 Connected! Files dropped on Mochi will upload directly to your Drive as ${res.email}.`;
    } else {
      testFeedback.style.background = "rgba(244,80,94,0.12)";
      testFeedback.style.border = "1px solid rgba(244,80,94,0.3)";
      testFeedback.style.color = "#f4505e";
      testFeedback.textContent = `❌ Authorization failed: ${res.error || "Unknown error"}`;
    }
  });

  disconnectOAuthBtn.addEventListener("click", async () => {
    await Bridge.googleOAuthDisconnect();
    await updateOAuthStatus();
    testFeedback.style.display = "none";
  });

  testBtn.addEventListener("click", async () => {
    testBtn.setAttribute("disabled", "true");
    testFeedback.style.display = "block";
    testFeedback.style.background = "rgba(255,255,255,0.06)";
    testFeedback.style.border = "1px solid rgba(255,255,255,0.1)";
    testFeedback.style.color = "var(--ink)";
    testFeedback.textContent = "Testing Drive folder access...";

    try {
      const result = await Bridge.testDriveConnection();
      if (result.readOk && result.writeOk) {
        testFeedback.style.background = "rgba(34,197,94,0.12)";
        testFeedback.style.border = "1px solid rgba(34,197,94,0.3)";
        testFeedback.style.color = "#22c55e";
        testFeedback.textContent = `🎉 Success! Connected to folder "${result.folderName}". Full Editor upload permission confirmed for ${result.saEmail}!`;
      } else if (result.readOk && !result.writeOk) {
        testFeedback.style.background = "rgba(245,165,36,0.12)";
        testFeedback.style.border = "1px solid rgba(245,165,36,0.3)";
        testFeedback.style.color = "#f5a524";
        testFeedback.textContent = `⚠️ Folder "${result.folderName}" found, but write permission is missing. Share folder with ${result.saEmail} as "Editor"!`;
      } else {
        testFeedback.style.background = "rgba(244,80,94,0.12)";
        testFeedback.style.border = "1px solid rgba(244,80,94,0.3)";
        testFeedback.style.color = "#f4505e";
        testFeedback.textContent = `❌ Drive check: ${result.error || "Cannot access folder"}.`;
      }
    } catch (e: any) {
      testFeedback.style.background = "rgba(244,80,94,0.12)";
      testFeedback.style.border = "1px solid rgba(244,80,94,0.3)";
      testFeedback.style.color = "#f4505e";
      testFeedback.textContent = `❌ Test error: ${e.message || e}`;
    } finally {
      testBtn.removeAttribute("disabled");
    }
  });

  const activeBox = h(
    "div",
    {
      style: "background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px;padding:10px 14px;font-size:12px;color:rgba(255,255,255,0.85);line-height:1.5;",
    },
    h("div", { style: "font-weight:600;color:#22c55e;margin-bottom:2px;", text: "✨ Real-Time Partner Sync Active" }),
    h("div", { text: "Files dropped on Mochi automatically upload to Google Drive and broadcast to your partner's PC with an instant download notification button." })
  );

  const guideBox = h(
    "div",
    {
      style: "background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.55;display:flex;flex-direction:column;gap:6px;",
    },
    h("div", { style: "font-weight:600;color:var(--ink);margin-bottom:2px;", text: "📋 2-Minute Google Account Setup (Never Blocked):" }),
    h("div", { text: "1. Open Google Cloud Console with your account: console.cloud.google.com" }),
    h("div", { text: "2. In left menu: APIs & Services → OAuth consent screen → Under 'Test users', click '+ ADD USERS' and add your email (takilaislive@gmail.com). Click Save! (This tells Google to never block your app)." }),
    h("div", { text: "3. In left menu: APIs & Services → Credentials → '+ Create Credentials' → 'OAuth client ID' → Application type: 'Desktop app' → Click Create → Click 'DOWNLOAD JSON'." }),
    h("div", { text: "4. Click '📂 Load client_secret.json' above, pick that file, and click '🔗 Sign In with Google'!" })
  );

  body.append(
    activeBox,
    h("div", { class: "row" }, h("label", { text: "Pair Channel" }), channelInput, channelSave, channelStatus),
    h("div", { class: "row" }, h("label", { text: "Shared Drive Folder" }), folderInput, folderSave, folderStatus),
    h("div", { class: "row", style: "align-items:center;" },
      h("label", { text: "Google Account" }),
      oauthStatusDot,
      oauthStatusText,
      disconnectOAuthBtn
    ),
    h("div", { class: "row", style: "align-items:center;gap:8px;" },
      selectOAuthJsonBtn,
      clientIdInput,
      clientSecretInput,
      connectOAuthBtn
    ),
    h("div", { style: "display:flex;align-items:center;gap:8px;margin-top:2px;" },
      testBtn,
      openFolderBtn
    ),
    testFeedback,
    guideBox
  );

  return section;
}


// ── Application Paths (Launcher) ─────────────────────────────────────────────

function appLauncherSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(true), h("span", { text: "Application Paths (App Launcher)" })),
    body
  );

  body.append(
    h("div", {
      class: "hint",
      text: "Configure paths for applications on your PC. When you tell Mochi 'Open Discord' or 'Launch OBS', it will execute the application instantly.",
    })
  );

  const apps = settings.appPaths || {};
  for (const [appName, appPath] of Object.entries(apps)) {
    const input = h("input", {
      type: "text",
      value: appPath,
      style: "flex:1 1 auto;min-width:0",
    }) as HTMLInputElement;

    input.addEventListener("change", () => {
      if (!settings.appPaths) settings.appPaths = {};
      settings.appPaths[appName] = input.value.trim();
      void save();
    });

    const removeBtn = h("button", {
      class: "danger",
      title: `Remove ${appName}`,
      text: "✕",
      style: "padding:6px 10px;font-size:11px;flex-shrink:0;border-radius:8px;line-height:1;cursor:pointer;",
    });

    removeBtn.addEventListener("click", () => {
      if (settings.appPaths) {
        delete settings.appPaths[appName];
        void save();
        section.replaceWith(appLauncherSection());
      }
    });

    body.append(
      h("div", { class: "row", style: "flex-wrap:nowrap;gap:8px" },
        h("label", { style: "min-width:90px;text-transform:capitalize", text: appName }),
        input,
        removeBtn
      )
    );
  }

  // Add custom app row
  const newName = h("input", { placeholder: "App name (e.g. DaVinci)", style: "width:110px" }) as HTMLInputElement;
  const newPath = h("input", { placeholder: "Executable path...", style: "flex:1 1 auto" }) as HTMLInputElement;
  const addBtn = h("button", { class: "primary", text: "Add App" });

  addBtn.addEventListener("click", () => {
    const name = newName.value.trim().toLowerCase();
    const pathVal = newPath.value.trim();
    if (name && pathVal) {
      if (!settings.appPaths) settings.appPaths = {};
      settings.appPaths[name] = pathVal;
      newName.value = "";
      newPath.value = "";
      void save();
      // Redraw section
      section.replaceWith(appLauncherSection());
    }
  });

  body.append(
    h("div", { class: "group-title", text: "Add Custom App" }),
    h("div", { class: "row" }, newName, newPath, addBtn)
  );

  return section;
}

// ── General Preferences Section ──────────────────────────────────────────────

function generalSection(): HTMLElement {
  const startupToggle = toggle(!!settings.autostart, (on) => {
    settings.autostart = on;
    void save();
  });

  const soundToggle = toggle(settings.soundEnabled, (on) => {
    settings.soundEnabled = on;
    void save();
  });

  const volSlider = h("input", {
    type: "range",
    min: "0",
    max: "0.2",
    step: "0.01",
    value: String(settings.soundVolume),
    style: "flex:1 1 auto",
  }) as HTMLInputElement;
  volSlider.addEventListener("input", () => {
    settings.soundVolume = parseFloat(volSlider.value);
    void save();
  });

  const autoCloseVal = Math.max(2, Math.min(30, settings.autoCloseInterval || 10));
  const autoCloseLabel = h("span", {
    style: "min-width:36px;font-weight:600;font-size:12px;color:var(--ink);",
    text: `${autoCloseVal}s`,
  });

  const autoCloseSlider = h("input", {
    type: "range",
    min: "2",
    max: "30",
    step: "1",
    value: String(autoCloseVal),
    style: "flex:1 1 auto;",
  }) as HTMLInputElement;

  function setAutoCloseSeconds(sec: number) {
    const clamped = Math.max(2, Math.min(30, sec));
    settings.autoCloseInterval = clamped;
    autoCloseSlider.value = String(clamped);
    autoCloseLabel.textContent = `${clamped}s`;
    void save();
  }

  autoCloseSlider.addEventListener("input", () => {
    setAutoCloseSeconds(parseInt(autoCloseSlider.value, 10));
  });

  const preset2s = h("button", { class: "secondary", style: "padding:3px 8px;font-size:11px;", text: "2s", onclick: () => setAutoCloseSeconds(2) });
  const preset5s = h("button", { class: "secondary", style: "padding:3px 8px;font-size:11px;", text: "5s", onclick: () => setAutoCloseSeconds(5) });
  const preset10s = h("button", { class: "secondary", style: "padding:3px 8px;font-size:11px;", text: "10s", onclick: () => setAutoCloseSeconds(10) });
  const preset15s = h("button", { class: "secondary", style: "padding:3px 8px;font-size:11px;", text: "15s", onclick: () => setAutoCloseSeconds(15) });
  const preset30s = h("button", { class: "secondary", style: "padding:3px 8px;font-size:11px;", text: "30s", onclick: () => setAutoCloseSeconds(30) });

  return h(
    "section",
    {},
    h("h2", {}, statusDot(true), h("span", { text: "General & Startup" })),
    h(
      "div",
      {
        class: "row",
        style:
          "display:flex;align-items:center;justify-content:space-between;padding:4px 0 8px;border-bottom:1px solid rgba(255,255,255,0.06);",
      },
      h(
        "div",
        { style: "display:flex;flex-direction:column;gap:3px;" },
        h("label", { style: "font-weight:600;color:var(--ink);cursor:pointer;", text: "Launch on PC Startup 🚀" }),
        h(
          "span",
          { class: "hint", style: "margin:0;font-size:11.5px;color:rgba(255,255,255,0.5);", text: "Mochi turns on instantly when your computer boots up" }
        )
      ),
      startupToggle
    ),
    h("div", { class: "row" }, h("label", { text: "Sound Effects" }), soundToggle),
    h("div", { class: "row" }, h("label", { text: "Volume" }), volSlider),
    h("div", { class: "row", style: "align-items:center;" },
      h("label", { text: "Auto-close Timer" }),
      autoCloseSlider,
      autoCloseLabel
    ),
    h("div", { class: "row", style: "margin-left:144px;gap:6px;" },
      preset2s,
      preset5s,
      preset10s,
      preset15s,
      preset30s
    ),

    h("div", { class: "row", style: "margin-top:8px" },
      h("button", {
        class: "danger",
        style: "background:#f4505e;color:#fff;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-weight:500;font-size:12px",
        text: "Quit Mochi Ultra",
        onclick: () => Bridge.quit(),
      })
    ),
    h("div", { class: "version", text: `Mochi Ultra v${version}` })
  );
}

// ── Updates & GitHub Sync Section ───────────────────────────────────────────

function updateSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const statusDotEl = statusDot(true);
  const section = h(
    "section",
    {},
    h("h2", {}, statusDotEl, h("span", { text: "Updates & GitHub Sync" })),
    body
  );

  const versionLabel = h("span", {
    style: "font-weight:600;font-size:12.5px;color:var(--ink);",
    text: `Mochi v${version}`,
  });

  const checkBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 14px;cursor:pointer;",
    text: "🔄 Check for Updates",
  });

  const statusText = h("div", {
    class: "hint",
    style: "font-size:12px;color:var(--dim);line-height:1.5;",
    text: "Mochi connects directly to your GitHub repository (takayduo/Mochi-Ultra) to check for updates and bug fixes.",
  });

  // Card displayed when an update is available
  const updateCard = h("div", {
    style:
      "display:none;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:14px;flex-direction:column;gap:10px;margin-top:4px;",
  });

  const updateTitle = h("div", {
    style: "font-weight:600;font-size:13px;color:#22c55e;display:flex;align-items:center;gap:6px;",
    text: "✨ New Update Available!",
  });

  const commitDetails = h("div", {
    style: "font-size:12px;color:var(--ink);display:flex;flex-direction:column;gap:4px;",
  });

  const updateBtn = h("button", {
    class: "primary",
    style:
      "background:#22c55e;color:#000;font-weight:600;font-size:12.5px;padding:8px 18px;align-self:flex-start;border-radius:8px;cursor:pointer;border:none;",
    text: "🚀 Update Mochi & Restart",
  });

  const progressText = h("div", {
    style: "display:none;font-size:12px;color:#f5a524;font-weight:500;",
    text: "",
  });

  updateCard.append(updateTitle, commitDetails, updateBtn, progressText);

  // Listen for live update progress events from Electron main process
  Bridge.on("update-progress", (msg: string) => {
    progressText.style.display = "block";
    progressText.textContent = `⏳ ${msg}`;
  });

  async function check() {
    checkBtn.setAttribute("disabled", "true");
    checkBtn.textContent = "Checking GitHub...";
    statusText.textContent = "Connecting to GitHub...";
    statusText.style.color = "var(--dim)";

    try {
      const res = await Bridge.checkForUpdates();
      if (!res || !res.success) {
        statusText.textContent = `⚠️ Could not check for updates: ${res?.error || "Network error"}`;
        statusText.style.color = "#f4505e";
        statusDotEl.style.background = "#f4505e";
        return;
      }

      const localShort = res.local?.commitShort || "current";
      versionLabel.textContent = `Mochi v${res.local?.version || version} (${localShort})`;

      if (res.updateAvailable && res.remote) {
        statusDotEl.style.background = "#22c55e";
        statusText.textContent = "✨ An update is ready to install!";
        statusText.style.color = "#22c55e";

        clear(commitDetails);
        const dateStr = res.remote.date ? new Date(res.remote.date).toLocaleString() : "";
        commitDetails.append(
          h("div", {
            style: "font-weight:500;color:var(--ink);",
            text: `Latest commit: ${res.remote.message || "New updates available"}`,
          }),
          h("div", {
            style: "color:var(--dim);font-size:11.5px;",
            text: `Commit ${res.remote.commitShort} • Released: ${dateStr}`,
          }),
          h("div", {
            style: "color:rgba(255,255,255,0.6);font-size:11.5px;margin-top:2px;",
            text: "Your settings, API keys, tasks, and chat history are safely preserved during updates.",
          })
        );

        updateCard.style.display = "flex";
      } else {
        statusDotEl.style.background = "#22c55e";
        statusText.textContent = `✅ Mochi is completely up to date with GitHub (Commit: ${localShort}).`;
        statusText.style.color = "#22c55e";
        updateCard.style.display = "none";
      }
    } catch (e: any) {
      statusText.textContent = `⚠️ Error checking for updates: ${e.message || e}`;
      statusText.style.color = "#f4505e";
      statusDotEl.style.background = "#f4505e";
    } finally {
      checkBtn.removeAttribute("disabled");
      checkBtn.textContent = "🔄 Check for Updates";
    }
  }

  checkBtn.addEventListener("click", () => void check());

  updateBtn.addEventListener("click", async () => {
    updateBtn.setAttribute("disabled", "true");
    checkBtn.setAttribute("disabled", "true");
    updateBtn.textContent = "Updating...";
    progressText.style.display = "block";
    progressText.textContent = "⏳ Starting update process...";

    try {
      const res = await Bridge.performUpdate();
      if (res && !res.success) {
        progressText.textContent = `❌ Update failed: ${res.error || "Unknown error"}`;
        progressText.style.color = "#f4505e";
        updateBtn.removeAttribute("disabled");
        checkBtn.removeAttribute("disabled");
        updateBtn.textContent = "🚀 Retry Update";
      }
    } catch (err: any) {
      progressText.textContent = `❌ Update failed: ${err.message || err}`;
      progressText.style.color = "#f4505e";
      updateBtn.removeAttribute("disabled");
      checkBtn.removeAttribute("disabled");
      updateBtn.textContent = "🚀 Retry Update";
    }
  });

  // Auto-check 400ms after opening settings
  setTimeout(() => {
    void check();
  }, 400);

  body.append(
    h(
      "div",
      {
        class: "hint",
        text: "Whenever Badsha pushes new features or fixes to GitHub, you can update Mochi in 1 click. All your personal data, API keys, tasks, and couple sync stay 100% untouched.",
      }
    ),
    h(
      "div",
      {
        class: "row",
        style: "display:flex;align-items:center;justify-content:space-between;padding:4px 0;",
      },
      h("div", { style: "display:flex;flex-direction:column;gap:3px;" },
        h("label", { style: "font-weight:600;color:var(--ink);", text: "Installed Version" }),
        versionLabel
      ),
      checkBtn
    ),
    statusText,
    updateCard
  );

  return section;
}

async function init() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...DEFAULT_SETTINGS, ...boot.settings };
    version = boot.version || "1.0.0-creator";
  }

  clear(root);
  root.append(
    aiSection(),
    markLvSection(),
    coupleSection(),
    supabaseSection(),
    cloudSection(),
    appLauncherSection(),
    generalSection(),
    updateSection()
  );
}

void init();
