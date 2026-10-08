# 🤖 Baymax — Autonomous AI Desktop Companion & Productivity Engine

> **The ultimate fusion of Baymax's desktop companion, Distrack's digital mindfulness productivity suite, and Mark-LV's autonomous PC control engine.**
> Featuring real-time screen time tracking, automatic distraction blocking, voice-guided focus sessions, 2D squircle physics, live peer-to-peer partner chat, daily creator schedule, safe Remote Desktop Co-Pilot, and **Mark-LV Autonomous PC Control (clicking, typing, app launching, process closing, browser navigation, window management, system settings, document processing, vision, and long-term memory)**.

---

## ✨ Features

- ⏱️ **Distrack Productivity & Digital Mindfulness Engine**:
  - **Full Desktop Productivity Workspace**: Dedicated panel beside the task manager displaying complete interactive charts, process classification, weekly insights, flow sessions, and settings.
  - **Autonomous Screen Time Tracking**: High-performance Win32 background window scanning tracks time spent per app in real time without lag.
  - **3-Tier Intelligent App Classification**: Categorize applications as **Productive** 🟢, **Neutral** ⚪, or **Wasteful (Distraction)** 🔴.
  - **Automated Focus Sessions**: Start a focus session for any duration (e.g. 1 hour, 45 mins) via voice command (*"Baymax, start a focus session for 1 hour"*) or 1-click in the UI.
  - **Automatic Distraction Blacklisting**: Activating a focus session automatically blacklists and intercepts all apps classified as distractions (Discord, games, social media, etc.).
  - **Proactive AI Voice Interventions**: If you switch to any distraction app during a focus session, Baymax immediately speaks up: *"Hey Badsha, focus on your work! You have an active focus session going on."* Displays warning countdown on the island and force-closes the distraction if not exited.
  - **Screen Time Analytics by Voice**: Ask Baymax *"Analyze my screen time"* or *"How much time did I waste today?"* to get your real-time Focus Score percentage, productive hours, and top apps.

- ⚡ **Mark-LV Autonomous PC Control Engine**:
  - **Direct Computer Control**: Autonomous mouse clicking, typing, hotkeys, scroll, drag, screenshots, and visual element detection on screen.
  - **Targeted App Closer (`close_app`)**: Intelligent dual-tier app closing. First prioritizes custom user entries in **Application Paths**; if not found, performs fuzzy matching against active running Windows processes (handles complex game executables like Valorant / `VALORANT-Win64-Shipping.exe`, Riot Client, Steam, Discord, OBS, etc.). Includes an **anti-self-close safety shield** so Baymax and Electron can never accidentally terminate themselves.
  - **Long-Term Memory Vault**: Bi-directional persistent memory engine (`engine/memory/long_term.json`) with interactive GUI controls (`+ Remember` to add, `🗑️ Forget` to delete) and autonomous CLI bridge (`mochi_bridge.py save-memory`, `delete-memory`).
  - **Dual LLM Parity Architecture**: Flawless execution across both Gemini Live (`gemini-2.5-flash`, native multimodal live API with real-time video/audio) and Groq / OpenRouter. Built-in tool calling loop verifies actual task execution instead of hallucinating "done".
  - **Browser Automation**: Playwright autonomous web browser navigation, searching, form filling, and interaction.
  - **System Settings Mastery**: Real-time volume, brightness, mute, dark mode, task manager, window snapping, sleep display, and power controls.
  - **Universal App Launcher**: Open or terminate any desktop application or Windows store executable.
  - **Document & File Processing**: Search, read, write, parse PDFs, DOCX, TXT, CSV, and extract insights.
  - **Web Intelligence**: DuckDuckGo web search, news scraping, price comparisons, and YouTube playback.
  - **Flight Finder & Game Updater**: Google Flights search and Steam/Epic Games updater and scheduler.
  - **Autonomous Dev Agent**: Run Python scripts, code helpers, and autonomous developer problem solvers.
  - **Gemini Live Voice & Audio Routing**: Gemini Live models (`Charon`, `Puck`, `Kore`, `Fenrir`, `Aoede`), openWakeWord gating ("Hey Jarvis" / "Hey Baymax"), and hardware audio routing.
- 🖥️ **Remote Desktop Co-Pilot (Mochi Eye)**:
  - **Mutual Permission**: Either partner can click *"Request Remote Access"*. The other receives an interactive prompt to Accept or Decline.
  - **Full Control**: Smooth 60 FPS remote screen view, mouse movement, dragging, clicking, and keyboard shortcuts.
  - **GPU-Safe (Zero Virtual Drivers)**: Uses Microsoft DirectX Desktop Duplication (DXGI) without any intrusive kernel or virtual display drivers.
  - **Fullscreen Viewer Window**: Mochi's top notch stays small and pretty on your main screen, while the remote partner's screen opens in a dedicated window that can be toggled Fullscreen with 1 click (<kbd>F11</kbd>).
  - **1-Click Disconnect**: Both parties have immediate control to end the remote session at any second.
- 🍡 **Authentic Canvas 2D Physics & Non-Disruptive Notch UX**:
  - Exact squircle superellipse math, cursor-following pupils, eye blinks, breathing springs, particle systems (hearts, stars, sweat drops), and emotional states (`idle`, `thinking`, `happy`, `love`, `dizzy`, `annoyed`, `sleeping`, `error`).
  - **Click-to-Open Notch UX**: Smoothly expands from the mini notch into the full companion island without cutting off AI voice responses.
- 💬 **Live Partner Chat (Badsha 👤 ⟷ Ayzil 💖)**:
  - Sub-50ms real-time peer-to-peer messaging via Supabase Realtime broadcast.
  - 🌙 **24/7 Offline Cloud Storage**: Messages sent while your PC is off are safely stored and delivered the moment you turn on your PC.
  - 🔍 **Cloud Mailbox Diagnostics**: Live connection test button and table status indicator in Settings (`Test Database Tables`).
  - Sound chimes (`blip.wav`, `greet.wav`) on incoming messages.
  - Unread count badge on the chat tab when collapsed.
  - Desktop native Windows notifications.
  - Live partner presence indicator (🟢 Online).
- 📅 **Daily Content Calendar & Schedule**:
  - Assigned task management between creator couples ("Me" vs "Her").
  - Instant task creation, completion chimes (`finish.wav`), and cross-PC live synchronization (including offline task catch-up).
- 🎙️ **AI Voice & Assistant (Multi-LLM)**:
  - Connect your favorite free or pro AI: **Google Gemini** (`gemini-2.5-flash`), **Groq** (`openai/gpt-oss-120b`), or **OpenRouter**.
  - Natural speech input and Windows SAPI native voice readouts.
  - Ask schedule queries (*"What is our schedule for today?"*) and dictate partner messages (*"Send message to Ayzil: I'll be ready in 10 minutes"*).
- 🚀 **App Launcher & Closer**:
  - Say or click to launch: Discord, WhatsApp, OBS, Premiere Pro, Roblox, Spotify, and more.
  - Say *"Close OBS"* or *"Close Valorant"* to terminate background processes cleanly and safely.
  - Configure or remove shortcuts directly from the Settings GUI.
- 📦 **File Eating Suction Physics**:
  - Drag and drop any video, thumbnail, or script onto Mochi.
  - Superellipse mouth opening suction animation with signature `gulp.wav` eating sound effect.
  - Optional Google Drive cross-PC relay to share files with your partner.
- 🪟 **Frameless Top Bar Overlay**:
  - Always-on-top, transparent, click-through background when collapsed.
  - System tray icon with one-click settings, show/hide, and startup mode.

---

## 📋 Required System & Software Prerequisites

Before installing Mochi Ultra, make sure you have:

1. **Operating System**:
   - **Windows 10 / 11** (Recommended for native sound, SAPI speech, and auto-start integration).
   - Also runs on macOS and Linux with standard Electron support.
2. **Node.js**:
   - Version **18.0.0** or higher (LTS version 20+ recommended).
   - Download from [nodejs.org](https://nodejs.org/) (check with `node -v`).
3. **Python (For Autonomous Engine)**:
   - Version **3.10+** (Python 3.12 recommended).
   - Download from [python.org](https://www.python.org/) or let the installer set it up.

---

## 🚀 Easy Installation Guide (Works on Any PC — Even Brand New!)

You do **not** need Git or programming experience to run Baymax. Choose whichever method is easiest for you:

---

### 🌟 Method 1: 1-Line Automatic Installer (Fastest & Recommended)
Works on any fresh Windows 10/11 PC or Windows Sandbox (even with **no Git** and **no Node.js** installed):

1. Press `Win + X` and click **Terminal** or **Windows PowerShell**.
2. Paste this single command and press `Enter`:
   ```powershell
   irm https://raw.githubusercontent.com/takayduo/BEMAX/main/install.ps1 | iex
   ```
   *(Note: Fallback installer link `irm https://raw.githubusercontent.com/takayduo/Mochi-Ultra/main/install.ps1 | iex` also works).*
3. That's it! The script will:
   - Auto-install Node.js 22 LTS and Python 3.12 if missing.
   - Download the latest Baymax & Distrack suite files (no Git needed).
   - Install packages and build the desktop app bundle.
   - Install Python Mark-LV autonomous engine requirements.
   - Create a **Baymax** shortcut on your Desktop and launch it immediately.

---

### 📦 Method 2: Download ZIP (Zero Terminal Typing)
If you prefer not using commands at all:

1. Click the green **`<> Code`** button at the top of this GitHub page and select **`Download ZIP`**.
2. Right-click the downloaded `BEMAX-main.zip` (or `Mochi-Ultra-main.zip`) $\rightarrow$ click **Extract All…** $\rightarrow$ Extract.
3. Open the extracted folder and double-click **`setup.bat`**.
4. The batch installer will auto-configure everything and create a desktop shortcut for you!

---

### 💻 Method 3: For Developers & Terminal Users (Git & NPM)
If you already have Git, Node.js LTS, and Python installed:

```bash
git clone https://github.com/takayduo/BEMAX.git
cd BEMAX
npm install
pip install -r engine/requirements.txt
npm run build
npm start
```

---

## 🖥️ How to Run After Installation
Once installed, you can launch Baymax anytime:
- **Desktop Shortcut**: Double-click the **Baymax** icon on your Desktop.
- **Direct Launcher**: Double-click **`Launch Baymax.bat`** (instantly starts Baymax in background and closes the prompt).
- **Terminal Launch**: Run `npm start` or `npm run app`.

---

## 🗑️ How to Uninstall

If you ever want to completely remove Baymax from your PC:

### 🌟 Option 1: 1-Line Automatic Uninstaller (Fastest)
Open **PowerShell** and paste:
```powershell
irm https://raw.githubusercontent.com/takayduo/BEMAX/main/uninstall.ps1 | iex
```
This stops any running Baymax processes, removes the app folder, deletes the Desktop & Startup shortcuts, and cleans the cache automatically.

### ✋ Option 2: Manual Uninstallation (Simple 3 Steps)
1. **Quit Baymax**: Right-click the Baymax icon in your Windows System Tray (near the clock) $\rightarrow$ click **Quit** (or end process in Task Manager).
2. **Delete the App Folder**: Open File Explorer, go to your User folder (`C:\Users\YourUsername`), and delete the **`Baymax`** (or `Mochi-Ultra`) folder.
3. **Delete the Desktop Shortcut**: Delete **`Baymax`** from your Desktop.
*(Optional: If you enabled "Run on PC Startup", press <kbd>Win</kbd> + <kbd>R</kbd>, type `shell:startup`, and delete `Baymax.lnk`).*

---

## ⚙️ Quick Configuration Guide

You do **NOT** need to edit any code files to configure Mochi Ultra. Everything is set up via the built-in Settings window:

1. Click the **⚙️ Gear icon** on the Mochi top bar, or right-click the **Mochi icon** in your Windows System Tray $\rightarrow$ select **Settings…**.
2. **AI Models & API Keys**:
   - Choose **Google Gemini** (get a free key at [Google AI Studio](https://aistudio.google.com/)) or **Groq** (free key at [groq.com](https://groq.com/)).
   - Paste the key and click **Save**.
3. **Creator Couple Profile**:
   - Select your profile for this PC: **Me 👤** or **Her 💖**.
   - Set your name and your partner's name.
4. **Live Partner Sync (Supabase)**:
   - Enter your Supabase Project URL and Public Anon Key to enable cross-PC live chat, task syncing, and online presence.
5. **Application Paths (App Launcher)**:
   - Enter your favorite app executable or shortcut paths (e.g. `C:\Users\<user>\Desktop\Discord.lnk`).
   - Use the **✕** button to delete shortcuts you don't need, or add new ones with **Add Custom App**.
6. **Startup Mode**:
   - Toggle **Startup Mode** to **ON** to have Mochi automatically start when your PC turns on.

---

## 🌙 24/7 Offline Sync (Supabase Cloud Setup)

Mochi includes a **24/7 Cloud Mailbox** so you and your partner never miss a message or task update, even when one person is sleeping or has their PC completely shut down:
- **Nighttime / Offline Delivery**: If your partner messages you or plans your day's schedule while your computer is turned off, Mochi automatically retrieves them the exact second your computer boots up in the morning.
- **Dual-Layer Resilience**: Works via Supabase PostgreSQL tables (`mochi_messages`, `mochi_tasks`) and auto-recovers through peer catch-up.

### ⚡ 30-Second Setup Instructions

1. Go to your free project at [supabase.com](https://supabase.com/).
2. On the left navigation bar, click **SQL Editor**.
3. Click **+ New query**, paste the following script, and click **Run**:

```sql
-- 1. Create table for persistent messages (delivered even when PC was off)
create table if not exists public.mochi_messages (
  id text primary key,
  channel text not null default 'coucou-badsha-ayzil',
  sender text not null,
  recipient text not null,
  text text not null,
  timestamp bigint not null,
  is_ai_generated boolean default false,
  read boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Create table for shared couple tasks & schedule
create table if not exists public.mochi_tasks (
  id text primary key,
  channel text not null default 'coucou-badsha-ayzil',
  title text not null,
  time text default '',
  assignee text default '',
  assigned_by text default '',
  completed boolean default false,
  created_at bigint default (extract(epoch from now()) * 1000),
  updated_at bigint default (extract(epoch from now()) * 1000)
);

-- 3. Enable Row Level Security (RLS)
alter table public.mochi_messages enable row level security;
alter table public.mochi_tasks enable row level security;

-- 4. Create policies to allow read and write via Anon key
drop policy if exists "Allow all on mochi_messages" on public.mochi_messages;
create policy "Allow all on mochi_messages" on public.mochi_messages for all using (true) with check (true);

drop policy if exists "Allow all on mochi_tasks" on public.mochi_tasks;
create policy "Allow all on mochi_tasks" on public.mochi_tasks for all using (true) with check (true);

-- 5. Enable Supabase Realtime broadcast for database changes
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mochi_messages'
  ) then
    alter publication supabase_realtime add table public.mochi_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mochi_tasks'
  ) then
    alter publication supabase_realtime add table public.mochi_tasks;
  end if;
end $$;
```

4. In Mochi Settings (⚙️), under **Live PC-to-PC Sync**, verify that the status badge turns **🟢 24/7 Cloud Mailbox Active**.

---

## 📁 Repository Structure & Required Files

```
Mochi-Ultra/
├── electron/                  # Electron Main Process & Native Windows APIs
│   ├── main.js                # Core lifecycle, window management, closeApplication, IPC
│   ├── preload.js             # Secure ContextBridge between Electron & Renderer
│   ├── supabase.js            # Live Realtime channels, presence, 24/7 cloud mailbox
│   ├── gdrive.js              # Google Drive OAuth & cross-PC file uploads
│   └── sapi.js                # Windows SAPI native text-to-speech engine
│
├── engine/                    # Mark-LV Autonomous Python Engine
│   ├── actions/               # 20+ autonomous tools (mouse, keyboard, browser, apps)
│   │   ├── close_app.py       # Safe targeted process & Application Paths closer
│   │   ├── open_app.py        # Application launcher prioritizing user shortcuts
│   │   ├── computer_settings.py# Volume, display, lock, dark mode, task manager
│   │   └── ...                # Playwright browser, file processing, vision, search
│   ├── core/                  # LLM client, Gemini Live, Groq, hotkeys, audio routing
│   ├── memory/                # Persistent Long-Term Memory Vault
│   │   ├── memory_manager.py  # Read/write vault categories
│   │   └── long_term.json     # Saved user facts, preferences & identity
│   ├── mochi_bridge.py        # IPC bridge for tool execution & memory CLI commands
│   └── requirements.txt       # Engine dependencies (PyAutoGUI, Playwright, etc.)
│
├── src/                       # Frontend Application (TypeScript + Vite)
│   ├── core/                  # Core audio, layout, state, voice & IPC bridge
│   │   ├── bridge.ts          # Strongly-typed bridge calling Electron IPC
│   │   ├── state.ts           # Settings state & default configurations
│   │   ├── sound.ts           # Audio manager for sound effects
│   │   ├── voice.ts           # Speech recognition & mic handling
│   │   └── anim.ts            # Spring physics & easing helpers
│   ├── island/                # Dynamic Island UI Container
│   │   ├── island.ts          # Expansion states, pills, animations & tabs
│   │   └── fsm.ts             # Finite State Machine for island behaviors
│   ├── mochi/                 # Mochi Canvas Avatar Engine
│   │   ├── engine.ts          # Squircle math, pupil physics, emotes & particles
│   │   └── greeting.ts        # Slide-down greeting & wave animations
│   ├── views/                 # Island Tabs & Modules
│   │   ├── coupleChat.ts      # Live Partner Chat (Badsha ⟷ Ayzil)
│   │   ├── chat.ts            # AI Assistant chat view
│   │   ├── schedule.ts        # Content Calendar & task manager
│   │   ├── integrations.ts    # App launcher pills
│   │   └── views.ts           # Tab switcher & header layout
│   ├── settings/              # Settings Window GUI
│   │   ├── main.ts            # Settings inputs, tabs, memory vault GUI & save logic
│   │   └── settings.css       # Clean dark-mode stylesheet
│   └── upload/                # File suction & eating canvas animations
│
├── public/                    # Static Assets
│   ├── icons/                 # App and system tray icons (.ico, .png)
│   └── sounds/                # 28 handcrafted .wav audio sound effects
│
├── install.ps1                # 1-line PowerShell installer (auto Node/Python/shortcuts)
├── uninstall.ps1              # 1-line PowerShell uninstaller & cleanup
├── setup.bat                  # 1-click batch installer & dependency setup
├── Launch Mochi.bat           # 1-click Windows background launcher
├── package.json               # Node.js dependencies & scripts
├── tsconfig.json              # TypeScript compilation settings
├── vite.config.ts             # Vite multi-page build configuration
└── README.md                  # Comprehensive documentation & setup guides
```

---

## 🛠️ Verification & Build Commands

- **Build production bundle**:
  ```bash
  npm run build
  ```
- **Run in development mode**:
  ```bash
  npm run dev
  ```
- **Start Electron application**:
  ```bash
  npm run app
  ```

---

## 🔒 Privacy & Security

- **Zero Hardcoded Secrets**: No API keys, passwords, or personal credentials are hardcoded into the source code.
- **Local Storage**: All user settings, API keys, and chat histories are safely stored in your local operating system user profile (`%APPDATA%\coucou-creator\CoucouCreator`).
- **Encrypted Transmission**: Realtime chat and presence utilize encrypted TLS/WSS connections.

---

## 📄 License

MIT License — Feel free to customize and enjoy with your partner!
