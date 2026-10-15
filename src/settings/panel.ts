import { voicePicker } from './voicePicker';
import { accountSection } from './account';
import { plansSection } from './plans';
import { requireFeature } from '../core/account';
// Settings window for Coucou Creator Companion
import "./settings.css";
import { Bridge } from "../core/bridge";
import { State, DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";
import { assistantName, assistantText } from "../core/branding";
import { wardrobe, musicHeadphonesToggle } from "./wardrobe";
import { pushToTalkSetting } from "./pushToTalk";
import { setCompanionPreferences } from "../companion/appearance";
import { syncCompanionIcon } from "../companion/nativeIcon";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "1.0.0-creator";

let root: HTMLElement;
let saveStatus: HTMLElement;
let previousSettings: Settings;
let saveQueue: Promise<unknown> = Promise.resolve();
let saveRevision = 0;

function branded(template: string) {
  return { "data-assistant-text": template, text: assistantText(template, settings.assistantName) };
}

function refreshBranding() {
  root.querySelectorAll<HTMLElement>("[data-assistant-text]").forEach(el => {
    el.textContent = assistantText(el.dataset.assistantText!, settings.assistantName);
  });
  document.title = `${assistantName(settings.assistantName)} · Settings`;
}

async function save(): Promise<boolean> {
  // Send only changed fields: quick settings and other windows may edit the rest.
  const patch: Partial<Settings> = {};
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    if (JSON.stringify(settings[key]) !== JSON.stringify(previousSettings[key])) {
      (patch as any)[key] = settings[key];
    }
  }
  const snapshot = structuredClone(settings);
  previousSettings = snapshot;
  const revision = ++saveRevision;
  saveStatus.textContent = "Saving…";
  saveStatus.dataset.state = "pending";
  refreshBranding();
  const job = saveQueue.then(() => Bridge.saveSettings(structuredClone(patch)));
  saveQueue = job.catch(() => undefined);
  try {
    await job;
    if (revision === saveRevision) {
      saveStatus.textContent = "Saved on this PC";
      saveStatus.dataset.state = "saved";
    }
    return true;
  } catch (error) {
    // A retry must include every unsaved field, even if a later edit was queued.
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      delete (previousSettings as any)[key];
    }
    saveStatus.textContent = `Could not save: ${error instanceof Error ? error.message : error}`;
    saveStatus.dataset.state = "error";
    return false;
  }
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": String(on) });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    el.setAttribute("aria-pressed", String(next));
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
      text: " Gemini Live (Default)",
    });

    const groqTab = h("button", {
      class: activeProvider === "groq" ? "primary" : "",
      style: "flex:1;padding:8px 12px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;",
      text: " Groq AI (Secondary / Fallback)",
    });

    geminiTab.addEventListener("click", async () => {
      if(!requireFeature('gemini'))return;
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
          text: "Gemini Live supports real-time voice and screen-based assistance. Bring your own Google API key; provider quotas and charges apply.",
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
          geminiSave.disabled = true;
          if (await save()) {
            geminiInput.value = "";
            geminiStatus.style.background = "#22c55e";
            draw();
          }
          geminiSave.disabled = false;
        }
      });

      const voiceSelect = voicePicker(settings.voiceName || 'Charon', async id => {
        settings.voiceName = id; return save();
      });

      body.append(
        h("div", { class: "group-title", text: "Gemini Live API Key" }),
        h("div", { class: "row" }, h("label", { text: "API Key" }), geminiInput, geminiSave, geminiStatus),
        h("div", {
          class: "hint",
          style: "margin-top:-4px;font-size:11.5px;",
          text: "Create your API key at aistudio.google.com. Live voice uses a supported Gemini Live model.",
        }),
        h("div", { class: "row", style: "margin-top:6px;" }, h("label", { text: "Live voice" }), voiceSelect)
      );
    } else {
      sectionTitle.textContent = "Groq Secondary AI Engine (with Local TTS)";

      body.append(
        h("div", {
          class: "hint",
          text: "Groq chat uses your API key. Spoken replies use a voice installed on this PC. Provider quotas and charges apply.",
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
          groqSave.disabled = true;
          if (await save()) {
            groqInput.value = "";
            groqStatus.style.background = "#22c55e";
            draw();
          }
          groqSave.disabled = false;
        }
      });

      // Groq Model Dropdown
      const modelSelect = h("select", {
        style: "flex:1;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.12);",
      }) as HTMLSelectElement;

      const GROQ_MODELS = [
        { id: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
        { id: "openai/gpt-oss-20b", label: "GPT OSS 20B" },
        { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (account access required)" },
        { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (account access required)" },
      ];
      if (settings.groqModel && !GROQ_MODELS.some(m => m.id === settings.groqModel)) {
        GROQ_MODELS.push({ id: settings.groqModel, label: `${settings.groqModel} (saved model; check availability)` });
      }

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
      const testVoiceBtn = h("button", { text: " Test Local Voice" });
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
          text: "Create your API key at console.groq.com. Check your Groq account for current usage limits.",
        }),
        h("div", { class: "group-title", style: "margin-top:8px;", text: "Groq Model Selection" }),
        h("div", { class: "row" }, h("label", { text: "Model" }), modelSelect),
        h("div", { class: "group-title", style: "margin-top:8px;", text: "Voice & Speech (Local TTS)" }),
        h("div", { class: "row" }, h("label", { text: "Local Audio" }), testVoiceBtn),
        h("div", {
          class: "hint",
          style: "margin-top:-4px;font-size:11.5px;",
          ...branded("In Groq mode, {assistant} uses Groq Whisper for speech recognition and local speech synthesis with the previous cute voice."),
        })
      );
    }
  }

  draw();
  return section;
}

// ── Baymax PC Control & AI Engine Section ──────────────────────────────────

function engineSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(true), h("span", { ...branded("{assistant} AI Engine") })),
    body
  );

  const ACTIONS_METADATA: Array<{ key: string; label: string; desc: string; emoji: string }> = [
    { key: "computer_control", label: "Computer Control", desc: "Mouse clicking, typing, hotkeys, scroll, drag, vision screen finding", emoji: "" },
    { key: "browser_control", label: "Browser Control", desc: "Playwright autonomous browser navigation, clicks, typing, form fills", emoji: "" },
    { key: "open_app", label: "Open App", desc: "Universal desktop app launcher & Windows executable runner", emoji: "" },
    { key: "close_app", label: "Close App", desc: "Safe targeted application & game closer (Application Paths + process lookup)", emoji: "" },
    { key: "desktop_control", label: "Desktop Control", desc: "Window manager (minimize, maximize, snap left/right, show desktop, clean)", emoji: "" },
    { key: "computer_settings", label: "Computer Settings", desc: "Volume, brightness, mute, dark mode, task manager, sleep display", emoji: "" },
    { key: "file_controller", label: "File Controller", desc: "File search, creation, reading, copying, moving, deleting", emoji: "" },
    { key: "file_processor", label: "File Processor", desc: "Document parser & summarizer (PDF, DOCX, TXT, CSV, analysis)", emoji: "" },
    { key: "web_search", label: "Web Search", desc: "DuckDuckGo real-time web & news search, comparison, research", emoji: "" },
    { key: "youtube_video", label: "YouTube Video", desc: "YouTube video playback, summarization & trending videos", emoji: "" },
    { key: "weather_report", label: "Weather Report", desc: "Live global weather forecasts & temperature lookup", emoji: "" },
    { key: "flight_finder", label: "Flight Finder", desc: "Google Flights route search, ticket prices & options", emoji: "" },
    { key: "game_updater", label: "Game Updater", desc: "Steam & Epic Games updates, library inspection, download scheduler", emoji: "" },
    { key: "video_player", label: "Video Player", desc: "Assistant display video playback & mute controls", emoji: "" },
    { key: "reminder", label: "Reminders", desc: "Windows Task Scheduler timed reminders and alarms", emoji: "⏰" },
    { key: "send_message", label: "Send Message", desc: "WhatsApp & Telegram automated message delivery", emoji: "" },
    { key: "code_helper", label: "Code Helper", desc: "Python code snippet execution & script analyzer", emoji: "" },
    { key: "dev_agent", label: "Developer Agent", desc: "Autonomous multi-step developer agent for complex coding tasks", emoji: "" },
  ];

  let audioInputs: string[] = [];
  let audioOutputs: string[] = [];
  let memoryEntries: Array<{ category?: string; key?: string; value?: string }> = [];

  async function loadEngineData() {
    try {
      const devRes = await Bridge.engineListDevices();
      if (devRes && devRes.success) {
        audioInputs = devRes.inputs || [];
        audioOutputs = devRes.outputs || [];
      }
    } catch {}

    try {
      const memRes = await Bridge.engineListMemory();
      if (memRes && memRes.success) {
        memoryEntries = memRes.entries || [];
      }
    } catch {}

    draw();
    refreshBranding();
  }

  function draw() {
    clear(body);

    body.append(
      h("div", {
        class: "hint",
        text: "Choose what your assistant can control. Audio, conversation tuning and memory live here. Select your voice in AI & voice.",
      })
    );

    // ── Group 2: Voice Gating & Conversational Tuning ──
    const wakeWordToggle = toggle(!!settings.wakeWordEnabled, (v) => {
      settings.wakeWordEnabled = v;
      void save();
    });


    const proactiveAudioToggle = toggle(settings.proactiveAudio !== false, (v) => {
      settings.proactiveAudio = v;
      void save();
    });

    const talkingToggle = toggle(settings.proactiveTalkingEnabled === true, async (v) => {
      const previous = settings.proactiveTalkingEnabled === true;
      settings.proactiveTalkingEnabled = v;
      if (!await save()) {
        settings.proactiveTalkingEnabled = previous;
        talkingToggle.classList.toggle('on', previous);
        talkingToggle.setAttribute('aria-pressed', String(previous));
      }
    });
    talkingToggle.setAttribute('aria-label', 'Unprompted AI Check-ins');
    const interests = h('textarea', {class: 'user-interests', id: 'user-interests', rows: 3, maxlength: 2000,
      placeholder: "For example: I'm a content creator. YouTube growth, tech, editing."}) as HTMLTextAreaElement;
    interests.value = settings.userInterests || '';
    interests.oninput = () => { settings.userInterests = interests.value; };
    const saveInterests = h('button', {text: 'Save interests', class: 'save-interests'});
    saveInterests.onclick = async () => { await save(); };

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
      h("div", { class: "row" }, h("label", { text: "Wake-Word Gating" }), wakeWordToggle, h("span", { class: "hint", text: "Uses the installed wake-word model. Renaming the assistant does not retrain its wake phrase." })),
      pushToTalkSetting(settings, save, draw),
      h('div', {class: 'group-title', text: 'Unprompted AI Check-ins'}),
      h('div', {class: 'row proactive-talking-row'}, h('label', {text: 'Random / Proactive AI Talking (Time check-ins, sleep reminders & news)'}), talkingToggle),
      h('p', {class: 'hint', text: 'Off by default. When off, startup briefings, background alerts and check-ins stay silent. Your requests still work.'}),
      h('label', {for: 'user-interests', text: 'My Interests & News Topics'}), interests,
      h('div', {class: 'row'}, saveInterests, h('span', {class: 'hint', text: 'Saved for this user on this PC. Separate topics with commas. Blank means no unsolicited news.'})),
      h("div", { class: "row" }, h("label", { text: "Proactive Audio" }), proactiveAudioToggle, h("span", { class: "hint", text: "Intelligently ignores background conversation" })),
      h("div", { class: "row" }, h("label", { text: "Deep Thinking Mode" }), thinkingToggle, h("span", { class: "hint", text: "Allow model reasoning tokens before replying" })),
      h("div", { class: "row" }, h("label", { text: "Morning Briefing" }), morningBriefToggle, h("span", { class: "hint", text: "Startup partner updates; requires Unprompted AI Check-ins to be on" })),
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
      text: " Refresh Devices",
    });
    refreshAudioBtn.addEventListener("click", () => void loadEngineData());

    body.append(
      h("div", { class: "group-title", style: "display:flex;align-items:center;justify-content:space-between;" },
        h("span", { text: "Audio Hardware Routing" }),
        refreshAudioBtn
      ),
      h("div", { class: "row" }, h("label", { text: "Microphone" }), micSelect),
      h("div", { class: "row" }, h("label", { text: "Audio Output" }), spkSelect)
    );

    // ── Group 4: Autonomous PC Control Actions (18 Actions) ──
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
      actToggle.setAttribute("aria-label", act.label);

      const card = h(
        "div",
        {
          "data-skill": act.key,
          style:
            "background:rgba(255,255,255,0.03);border:1px solid var(--hairline);border-radius:10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;",
        },
        h(
          "div",
          { style: "display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;" },
          h("div", { style: "font-weight:600;font-size:12.5px;color:var(--ink);display:flex;align-items:center;gap:6px;" },
            h("span", { text: "" }),
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
        h("span", { text: `Assistant skills (${ACTIONS_METADATA.length})` }),
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
          ...branded("No persistent memories saved yet. {assistant} will learn about you and your preferences over time, or you can add facts below."),
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
          text: " Forget",
        });

        forgetBtn.addEventListener("click", async () => {
          forgetBtn.setAttribute("disabled", "true");
          forgetBtn.textContent = "Removing...";
          try {
            const result = await Bridge.engineDeleteMemory(cat, key);
            if (!result?.success) throw new Error(result?.error || "Memory could not be removed");
            await loadEngineData();
          } catch (error) {
            saveStatus.textContent = String(error);
            saveStatus.dataset.state = "error";
            forgetBtn.disabled = false;
            forgetBtn.textContent = "Forget";
          }
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
      text: " Remember",
    });

    addMemoryBtn.addEventListener("click", async () => {
      const k = newKeyInput.value.trim();
      const v = newValInput.value.trim();
      const c = newCatSelect.value;
      if (!k || !v) return;

      addMemoryBtn.setAttribute("disabled", "true");
      try {
        const result = await Bridge.engineSaveMemory(c, k, v);
        if (!result?.success) throw new Error(result?.error || "Memory could not be saved");
        newKeyInput.value = "";
        newValInput.value = "";
        await loadEngineData();
      } catch (error) {
        saveStatus.textContent = String(error);
        saveStatus.dataset.state = "error";
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

  body.textContent = "Loading devices and memory…";
  draw(); // Controls are usable immediately while devices and memory load.
  void loadEngineData();

  return section;
}

// ── Couple Identity Section ───────────────────────────────────────────────────

function coupleSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(true), h("span", { text: "You & your partner" })),
    body
  );

  const roleMe = h("button", {
    class: (settings.userRole || "me") === "me" ? "btn primary" : "btn secondary",
    text: "First person’s PC",
  });
  const roleHer = h("button", {
    class: (settings.userRole || "me") === "her" ? "btn primary" : "btn secondary",
    text: "Second person’s PC",
  });

  const getCreator = () => (settings.userName && settings.userName !== "Me" ? settings.userName : "You");
  const getPartner = () => (settings.partnerName && settings.partnerName !== "Her" ? settings.partnerName : "Partner");

  const updateRoleButtons = () => {
    const creator = getCreator();
    const partner = getPartner();
    const isMe = (settings.userRole || "me") === "me";
    roleMe.textContent = `This is My PC (${creator} )`;
    roleHer.textContent = `This is Her PC (${partner} )`;
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
    settings.userName = userNameInput.value.trim() || "You";
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
    settings.partnerName = partnerNameInput.value.trim() || "Partner";
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
      text: "Enter both names in the same order on both PCs. Then choose which person uses this PC.",
    }),
    h("div", { class: "row", style: "gap:10px" }, roleMe, roleHer),
    h("div", { class: "row" }, h("label", { text: "First person" }), userNameInput),
    h("div", { class: "row" }, h("label", { text: "Second person" }), partnerNameInput),
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
        h("label", { style: "font-weight:600;color:var(--ink);cursor:pointer;", text: "Notify when Partner comes online " }),
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
  if(State.account?.configured)return accountSection('database');
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

  const pairChannelInput=h('input',{type:'text',value:settings.shareChannel || 'coucou-badsha-ayzil',maxlength:100,'aria-label':'Partner channel'}) as HTMLInputElement;
  pairChannelInput.addEventListener('input',()=>{settings.shareChannel=pairChannelInput.value.trim();});

  (window as any).electronAPI?.on('sync-status', (status: any) => {
    statusMsg.textContent = status.connected ? 'Connected to live partner channel' : (status.error || status.status || 'Disconnected');
    statusMsg.style.color = status.connected ? '#22c55e' : '#f59e0b';
  });
  const testBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 14px;",
    text: " Test Connection",
  });

  const saveBtn = h("button", {
    class: "primary",
    style: "font-size:12px;padding:6px 16px;background:#22c55e;color:#000;font-weight:600;",
    text: " Save & Connect",
  });

  const statusMsg = h("div", {
    class: "path",
    style: "font-size:12px;font-weight:500;padding:4px 0;",
    text: hasConfig ? "Configured — Ready for live synchronization" : "Not configured yet",
  });

  saveBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    const key = keyInput.value.trim();
    if(!/^[\w-]{1,100}$/.test(pairChannelInput.value.trim())){statusMsg.textContent='Channel needs letters, numbers, hyphens or underscores.';return;}
    if (url) settings.syncUrl = url;
    if (key) {
      settings.syncApiKey = key;
      keyInput.value = "";
      keyInput.placeholder = "•••••••••••• (saved anon key)";
    }
    if (!(await save())) return;
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
        statusMsg.textContent = "Connection successful. Save & Connect on both PCs to join your partner channel.";
        statusMsg.style.color = "#22c55e";
        statusDotEl.style.background = "#22c55e";
        void updateCloudStatus();
      } else {
        statusMsg.textContent = ` Connection failed: ${res?.error || "Unknown error"}`;
        statusMsg.style.color = "#f4505e";
        statusDotEl.style.background = "#f4505e";
      }
    } catch (err: any) {
      statusMsg.textContent = ` Error: ${err.message || err}`;
      statusMsg.style.color = "#f4505e";
      statusDotEl.style.background = "#f4505e";
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = " Test Connection";
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
    text: "Messages and tasks can be stored while a PC is offline and delivered when both accounts reconnect successfully.",
  });

  const copySqlBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 14px;display:flex;align-items:center;gap:6px;",
    text: " Copy 1-Click SQL Setup",
  });

  const checkCloudBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 14px;",
    text: " Refresh Cloud Status",
  });

  const sqlSteps = h(
    "div",
    {
      style:
        "display:none;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px 12px;font-size:11.5px;color:var(--dim);line-height:1.6;margin-top:4px;",
    },
    h("div", { style: "font-weight:600;color:var(--ink);margin-bottom:2px;", text: "Set up message storage:" }),
    h("div", { text: "1. Click ' Copy 1-Click SQL Setup' above." }),
    h("div", { text: "2. Open supabase.com  your project  click 'SQL Editor' on the left menu." }),
    h("div", { text: "3. Click '+ New Query', paste the code, and click 'Run'!" }),
    h("div", { text: "4. Return here and click ' Refresh Cloud Status' to verify." })
  );

  async function updateCloudStatus() {
    try {
      const url = urlInput.value.trim() || settings.syncUrl;
      const key = keyInput.value.trim() || settings.syncApiKey;
      const res = await Bridge.checkSupabaseCloudStatus({ url, key });
      if (res && res.ready) {
        offlineStatusDot.style.background = "#22c55e";
        offlineStatusTitle.textContent = " 24/7 Cloud Mailbox Active (Never Miss a Message)";
        offlineStatusTitle.style.color = "#22c55e";
        offlineDesc.textContent =
          "Messages and tasks are stored in your Supabase project so your partner can receive them after reconnecting. Our playlist syncs directly when both PCs are connected.";
        sqlSteps.style.display = "none";
        copySqlBtn.style.display = "none";
      } else {
        offlineStatusDot.style.background = "#f5a524";
        const errHint = res?.error ? ` (${res.error})` : " (24/7 Cloud Tables Not Set Up Yet)";
        offlineStatusTitle.textContent = ` Realtime & Peer Sync Active${errHint}`;
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
        await Bridge.writeClipboard(sql);
        copySqlBtn.textContent = " Copied to Clipboard!";
        setTimeout(() => {
          copySqlBtn.textContent = " Copy 1-Click SQL Setup";
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
      h("span", { text: " Custom Supabase setup guide" })
    ),
    h(
      "div",
      { style: "font-size:12px;color:var(--dim);line-height:1.6;" },
      h("div", { text: "1. Go to supabase.com (choose a plan suitable for your usage) and click 'Start your project'." }),
      h("div", { text: "2. Click 'New project', name it 'Baymax', set any password, and select your nearest region." }),
      h("div", { text: "3. In your dashboard, click  Project Settings (bottom-left)  API." }),
      h("div", { text: "4. Copy the Project URL and anon public Key, paste them above, and click 'Save & Connect'." }),
      h("div", {
        style: "color:#22c55e;margin-top:4px;font-weight:500;",
        text: "5. Run the 1-Click SQL Setup in the SQL Editor. Enable Realtime public access. Use the same channel on both PCs and opposite Me / Her roles.",
      })
    )
  );

  body.append(
    h("div", {
      class: "hint",
      text: "Connect your own Supabase project for partner messages, tasks and file notifications. Use the same project and channel on both PCs, with opposite Me / Her roles.",
    }),
    h("div", { class: "row" }, h("label", { text: "Project URL" }), urlInput),
    h("div", { class: "row" }, h("label", { text: "Anon Public Key" }), keyInput),
    h("div", { class: "row" }, h("label", { text: "Pair channel" }), pairChannelInput),
    h("p", { class: "hint", text: "Open project mode for private testing: anyone with the URL and public key can access partner data. No account sign-in is required." }),
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
    h("h2", {}, h("span", { text: "Google Drive file sharing" })),
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
    value: settings.gdriveFolderId || "",
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
      const fid = settings.gdriveFolderId || "";
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
    text: " Load client_secret.json",
  });

  const connectOAuthBtn = h("button", {
    class: "primary",
    style: "font-size:12px;padding:6px 16px;background:#22c55e;color:#000;font-weight:600;",
    text: " Sign In with Google",
  });

  const disconnectOAuthBtn = h("button", {
    class: "danger",
    style: "display:none;font-size:11.5px;padding:4px 10px;",
    text: "Disconnect",
  });

  const testBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 12px;",
    text: " Test Drive Connection",
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
      testFeedback.textContent = " Loaded OAuth Client JSON! Click 'Sign In with Google' below to authorize.";
    } else if (res.error) {
      testFeedback.style.display = "block";
      testFeedback.style.background = "rgba(244,80,94,0.12)";
      testFeedback.style.border = "1px solid rgba(244,80,94,0.3)";
      testFeedback.style.color = "#f4505e";
      testFeedback.textContent = ` ${res.error}`;
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
      testFeedback.textContent = ` Connected! Files dropped on ${assistantName(settings.assistantName)} will upload directly to your Drive as ${res.email}.`;
    } else {
      testFeedback.style.background = "rgba(244,80,94,0.12)";
      testFeedback.style.border = "1px solid rgba(244,80,94,0.3)";
      testFeedback.style.color = "#f4505e";
      testFeedback.textContent = ` Authorization failed: ${res.error || "Unknown error"}`;
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
        testFeedback.textContent = ` Success! Connected to folder "${result.folderName}". Full Editor upload permission confirmed for ${result.saEmail}!`;
      } else if (result.readOk && !result.writeOk) {
        testFeedback.style.background = "rgba(245,165,36,0.12)";
        testFeedback.style.border = "1px solid rgba(245,165,36,0.3)";
        testFeedback.style.color = "#f5a524";
        testFeedback.textContent = ` Folder "${result.folderName}" found, but write permission is missing. Share folder with ${result.saEmail} as "Editor"!`;
      } else {
        testFeedback.style.background = "rgba(244,80,94,0.12)";
        testFeedback.style.border = "1px solid rgba(244,80,94,0.3)";
        testFeedback.style.color = "#f4505e";
        testFeedback.textContent = ` Drive check: ${result.error || "Cannot access folder"}.`;
      }
    } catch (e: any) {
      testFeedback.style.background = "rgba(244,80,94,0.12)";
      testFeedback.style.border = "1px solid rgba(244,80,94,0.3)";
      testFeedback.style.color = "#f4505e";
      testFeedback.textContent = ` Test error: ${e.message || e}`;
    } finally {
      testBtn.removeAttribute("disabled");
    }
  });

  const activeBox = h(
    "div",
    {
      style: "background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px;padding:10px 14px;font-size:12px;color:rgba(255,255,255,0.85);line-height:1.5;",
    },
    h("div", { style: "font-weight:600;color:#22c55e;margin-bottom:2px;", text: " File sharing" }),
    h("div", { ...branded("Files dropped on {assistant} automatically upload to Google Drive and broadcast to your partner's PC with an instant download notification button.") })
  );

  const guideBox = h(
    "div",
    {
      style: "background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.55;display:flex;flex-direction:column;gap:6px;",
    },
    h("div", { style: "font-weight:600;color:var(--ink);margin-bottom:2px;", text: " Google Drive setup:" }),
    h("div", { text: "1. Open Google Cloud Console with your account: console.cloud.google.com" }),
    h("div", { text: "2. Configure the OAuth consent screen. For a test app, add each participating Google account as a test user. Public distribution may require Google verification." }),
    h("div", { text: "3. In left menu: APIs & Services → Credentials → '+ Create Credentials' → 'OAuth client ID' → Application type: 'Desktop app' → Click Create → Click 'DOWNLOAD JSON'." }),
    h("div", { text: "4. Click ' Load client_secret.json' above, pick that file, and click ' Sign In with Google'!" })
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
      ...branded("Configure paths for applications on your PC. When you tell {assistant} 'Open Discord' or 'Launch OBS', it will execute the application instantly."),
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
      text: "",
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
        h("label", { style: "font-weight:600;color:var(--ink);cursor:pointer;", text: "Launch on PC Startup " }),
        h(
          "span",
          { class: "hint", style: "margin:0;font-size:11.5px;color:rgba(255,255,255,0.5);", ...branded("{assistant} starts when you sign in to Windows") }
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
        ...branded("Quit {assistant}"),
        onclick: () => Bridge.quit(),
      })
    ),
    h("div", { class: "version", ...branded(`{assistant} v${version}`) })
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
    ...branded(`{assistant} v${version}`),
  });

  const checkBtn = h("button", {
    class: "secondary",
    style: "font-size:12px;padding:6px 14px;cursor:pointer;",
    text: " Check for Updates",
  });

  const statusText = h("div", {
    class: "hint",
    style: "font-size:12px;color:var(--dim);line-height:1.5;",
    text: "Source installations can check their configured Git repository. Packaged releases require a new installer until signed automatic updates are configured.",
  });

  // Card displayed when an update is available
  const updateCard = h("div", {
    style:
      "display:none;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:14px;flex-direction:column;gap:10px;margin-top:4px;",
  });

  const updateTitle = h("div", {
    style: "font-weight:600;font-size:13px;color:#22c55e;display:flex;align-items:center;gap:6px;",
    text: " New Update Available!",
  });

  const commitDetails = h("div", {
    style: "font-size:12px;color:var(--ink);display:flex;flex-direction:column;gap:4px;",
  });

  const updateBtn = h("button", {
    class: "primary",
    style:
      "background:#22c55e;color:#000;font-weight:600;font-size:12.5px;padding:8px 18px;align-self:flex-start;border-radius:8px;cursor:pointer;border:none;",
    ...branded(" Update {assistant} & Restart"),
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
        statusText.textContent = ` Could not check for updates: ${res?.error || "Network error"}`;
        statusText.style.color = "#f4505e";
        statusDotEl.style.background = "#f4505e";
        return;
      }

      const localShort = res.local?.commitShort || "current";
      versionLabel.textContent = `${assistantName(settings.assistantName)} v${res.local?.version || version} (${localShort})`;

      if (res.updateAvailable && res.remote) {
        statusDotEl.style.background = "#22c55e";
        statusText.textContent = " An update is ready to install!";
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
            text: "Review the release and back up important data before installing.",
          })
        );

        updateCard.style.display = "flex";
      } else {
        statusDotEl.style.background = "#22c55e";
        statusText.textContent = `Your installation is up to date with GitHub (Commit: ${localShort}).`;
        statusText.style.color = "#22c55e";
        updateCard.style.display = "none";
      }
    } catch (e: any) {
      statusText.textContent = ` Error checking for updates: ${e.message || e}`;
      statusText.style.color = "#f4505e";
      statusDotEl.style.background = "#f4505e";
    } finally {
      checkBtn.removeAttribute("disabled");
      checkBtn.textContent = " Check for Updates";
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
        progressText.textContent = ` Update failed: ${res.error || "Unknown error"}`;
        progressText.style.color = "#f4505e";
        updateBtn.removeAttribute("disabled");
        checkBtn.removeAttribute("disabled");
        updateBtn.textContent = " Retry Update";
      }
    } catch (err: any) {
      progressText.textContent = ` Update failed: ${err.message || err}`;
      progressText.style.color = "#f4505e";
      updateBtn.removeAttribute("disabled");
      checkBtn.removeAttribute("disabled");
      updateBtn.textContent = " Retry Update";
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
        text: "Back up important data before updating. Source updates validate a staged copy and refuse to overwrite local changes.",
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

function companionSection(): HTMLElement {
  const name = h("input", {
    id: "assistant-display-name", type: "text", maxlength: "40",
    value: assistantName(settings.assistantName), placeholder: "Baymax",
  }) as HTMLInputElement;
  name.addEventListener("change", () => {
    settings.assistantName = assistantName(name.value);
    name.value = settings.assistantName;
    void save();
  });
  return h("div", { class: "preferences-page-stack" },
    musicHeadphonesToggle(settings.musicHeadphonesEnabled !== false, async enabled => {
      const previous=settings.musicHeadphonesEnabled;settings.musicHeadphonesEnabled=enabled;
      if(!await save()){settings.musicHeadphonesEnabled=previous;return false;}return true;
    }),
    wardrobe(settings.companion, async value => {
      const previous = settings.companion;
      settings.companion = value;
      if (!await save()) { settings.companion = previous; return false; }
      setCompanionPreferences(value);
      syncCompanionIcon();
      return true;
    }),
    h("section", {}, h("h2", { text: "Make it yours" }),
      h("p", { class: "hint", text: "Your assistant’s name appears throughout the app. This is separate from your account username." }),
      h("div", { class: "row" }, h("label", { for: name.id, text: "Assistant name" }), name)),
    generalSection());
}

/** Mount once per renderer. Pages are lazy and retained to preserve drafts. */
export async function mountSettings(target: HTMLElement, close?: () => void): Promise<void> {
  root = target;
  root.classList.add("settings-surface");
  root.textContent = "Loading settings…";
  try {
    const boot = await Bridge.boot();
    settings = { ...DEFAULT_SETTINGS, ...boot?.settings };
    version = boot?.version || "1.0.0";
    previousSettings = structuredClone(settings);
    clear(root);
    saveStatus = h("span", { class: "preferences-save-status", role: "status", "aria-live": "polite", text: "Saved on this PC" });
    const title = h("h1", branded("{assistant} settings"));
    const nav = h("nav", { class: "preferences-nav", "aria-label": "Settings categories" });
    const content = h("div", { class: "preferences-content", tabindex: "0" });
    const pages: Array<[string, string, string, () => HTMLElement]> = [
      ["account", "Account", "Your identity & partner connection", accountSection],
      ["plans", "Plans & Membership", "Choose what works for you", plansSection],
      ["companion", "Companion", "Appearance & everyday preferences", companionSection],
      ["ai", "AI & voice", "Your providers, keys & live voice", aiSection],
      ["control", "AI engine", "Audio devices & memory", engineSection],
      ["sync", "Database & sync", "Your Supabase project & connection", supabaseSection],
      ["files", "File sharing", "Connect Google Drive separately", cloudSection],
      ["apps", "Applications", "Custom paths for launching apps", appLauncherSection],
      ["updates", "About & updates", "Installed build & release information", updateSection],
    ];
    const cache = new Map<string, HTMLElement>();
    const buttons = new Map<string, HTMLElement>();
    function select(id: string) {
            const page = pages.find(p => p[0] === id)!;
      if (!cache.has(id)) {
        const section = page[3]();
        // Attach labels to controls for keyboard and assistive technology users.
        section.querySelectorAll<HTMLElement>(".row").forEach((row, index) => {
          const label = row.querySelector("label");
          const input = row.querySelector<HTMLInputElement>("input, select, button.switch");
          if (label && input && !input.hasAttribute("aria-label")) {
            input.id ||= `preferences-${id}-${index}`;
            label.htmlFor = input.id;
            input.setAttribute("aria-label", label.textContent || "Setting");
          }
        });
        cache.set(id, section);
      }
      content.replaceChildren(h("header", { class: "preferences-page-heading" },
        h("h2", { text: page[1] }), h("p", { text: page[2] })), cache.get(id)!);
      content.scrollTop = 0;
      buttons.forEach((button, key) => button.setAttribute("aria-current", key === id ? "page" : "false"));
      root.dataset.page = id;
      refreshBranding();
    }
    for (const [id, label] of pages) {
      const button = h("button", { type: "button", "data-page": id, text: label, onclick: () => select(id) });
      buttons.set(id, button);
      nav.append(button);
    }
    const header = h("header", { class: "preferences-header" }, title, saveStatus);
    if (close) header.append(h("button", { class: "preferences-close", text: "Done", onclick: close }));
    root.append(header, h("div", { class: "preferences-body" },
      h("aside", { class: "preferences-sidebar" }, nav,
        h("p", { class: "preferences-footnote", text: `Baymax · ${version}\nAPI usage is billed by your provider.` })), content));
    select(pages.some(p=>p[0]===sessionStorage.getItem('baymax-settings-page'))?sessionStorage.getItem('baymax-settings-page')!:'companion');
    sessionStorage.removeItem('baymax-settings-page');
    window.addEventListener('baymax-settings-page',event=>{if(root.isConnected){const id=(event as CustomEvent<string>).detail;if(pages.some(p=>p[0]===id)){select(id);sessionStorage.removeItem('baymax-settings-page');}}});
    Bridge.on("account-changed", (next: any) => {
      State.account = next;
      window.dispatchEvent(new Event("baymax-account-changed"));
      if (root.dataset.page === "account") {
        cache.delete("account");
        select("account");
      }
    });
    Bridge.on("partner-unpaired", () => {
      if (root.dataset.page === "account") {
        cache.delete("account");
        select("account");
      }
    });
  } catch (error) {
    root.textContent = `Settings could not load: ${error instanceof Error ? error.message : error}`;
    root.append(h("button", { text: "Try again", onclick: () => void mountSettings(target, close) }));
  }
}
