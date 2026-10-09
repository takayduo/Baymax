// Mochi Eye — Remote Desktop Host & Viewer Manager
const { app, BrowserWindow, desktopCapturer, screen } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let remoteViewerWin = null;
let inputInjectorProc = null;

/**
 * Ensures the InputInjector.exe exists, compiling if missing.
 */
function ensureInputInjector() {
  const binDir = path.join(__dirname, "bin");
  const exePath = path.join(binDir, "InputInjector.exe");
  const csPath = path.join(binDir, "InputInjector.cs");

  if (fs.existsSync(exePath)) return exePath;

  if (fs.existsSync(csPath)) {
    const cscCandidates = [
      "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
      "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
    ];
    for (const cscPath of cscCandidates) {
      if (fs.existsSync(cscPath)) {
        try {
          require("child_process").execSync(
            `"${cscPath}" /nologo /optimize+ /target:exe /out:"${exePath}" "${csPath}"`
          );
          if (fs.existsSync(exePath)) {
            console.log("[RemoteAccess] Successfully compiled InputInjector.exe using " + cscPath);
            return exePath;
          }
        } catch (err) {
          console.warn("[RemoteAccess] Failed to compile InputInjector with " + cscPath + ":", err);
        }
      }
    }
  }
  return null;
}

/**
 * Starts the native Win32 input injector process on the host being controlled.
 */
function startInputInjector() {
  if (inputInjectorProc && inputInjectorProc.stdin && !inputInjectorProc.stdin.destroyed) {
    return true;
  }
  stopInputInjector();
  const exePath = ensureInputInjector();
  if (!exePath) {
    console.error("[RemoteAccess] InputInjector.exe not available");
    return false;
  }

  try {
    inputInjectorProc = spawn(exePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    inputInjectorProc.stdout.on("data", (data) => {
      console.log("[RemoteAccess Injector]", data.toString().trim());
    });

    inputInjectorProc.stderr.on("data", (data) => {
      console.warn("[RemoteAccess Injector stderr]", data.toString().trim());
    });

    inputInjectorProc.on("error", (err) => {
      console.warn("[RemoteAccess Injector Error]:", err);
    });

    inputInjectorProc.on("exit", (code) => {
      console.log(`[RemoteAccess Injector] Exited with code ${code}`);
      inputInjectorProc = null;
    });

    console.log("[RemoteAccess] InputInjector spawned successfully:", exePath);
    return true;
  } catch (err) {
    console.error("[RemoteAccess] Could not spawn injector:", err);
    return false;
  }
}

/**
 * Injects input command:
 * "mn normX normY" | "m x y" | "d btn" | "u btn" | "w delta" | "k vk down" | "t unicode"
 */
function injectInput(cmd) {
  if (!cmd || typeof cmd !== "string") return;

  if (/[^\x20-\x7e]/.test(cmd) || cmd.length > 200) return false;
  if (!/^(?:mn -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?|m -?\d+ -?\d+|[du] [012](?: -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?)?|w -?\d+|k \d+ [01]|t \d+|bounds -?\d+ -?\d+ \d+ \d+)$/.test(cmd.trim())) return false;
  if (!inputInjectorProc?.stdin || inputInjectorProc.stdin.destroyed) return false;

  try {
    inputInjectorProc.stdin.write(cmd.trim() + "\n");
  } catch (e) {
    console.warn("[RemoteAccess] Write to injector failed:", e);
  }
}

/**
 * Stops the input injector process.
 */
function stopInputInjector() {
  if (inputInjectorProc) {
    try {
      inputInjectorProc.stdin.write("exit\n");
      inputInjectorProc.kill();
    } catch (e) {
      // ignore
    }
    inputInjectorProc = null;
  }
}

let currentHostDisplayBounds = null;

/**
 * Sets the active host monitor bounds and updates InputInjector.
 */
function setHostDisplayBounds(bounds) {
  if (!bounds) return;
  currentHostDisplayBounds = bounds;
  injectInput(`bounds ${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
}

/**
 * Gets all available screen sources mapped to their displays with friendly labels.
 */
async function getAvailableScreens() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
    });
    const allDisplays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    return sources.map((source, index) => {
      // Find matching display: match display_id or match by index
      let matchedDisplay = allDisplays.find((d) => String(d.id) === String(source.display_id));
      if (!matchedDisplay) {
        matchedDisplay = allDisplays[index] || primaryDisplay;
      }
      const isPrimary = matchedDisplay.id === primaryDisplay.id;
      return {
        id: source.id,
        displayId: matchedDisplay.id,
        name: source.name || `Screen ${index + 1}`,
        label: `${source.name || `Screen ${index + 1}`} (${matchedDisplay.bounds.width}x${matchedDisplay.bounds.height}${isPrimary ? " - Primary" : ""})`,
        bounds: matchedDisplay.bounds,
        width: matchedDisplay.bounds.width,
        height: matchedDisplay.bounds.height,
        isPrimary,
      };
    });
  } catch (err) {
    console.error("[RemoteAccess] Failed to get available screen sources:", err);
    return [];
  }
}

/**
 * Gets the primary display screen source ID for WebRTC capture.
 */
async function getPrimaryScreenSource() {
  try {
    const screens = await getAvailableScreens();
    if (screens.length > 0) {
      const primary = screens.find((s) => s.isPrimary) || screens[0];
      return {
        id: primary.id,
        name: primary.name,
        width: primary.width,
        height: primary.height,
        bounds: primary.bounds,
      };
    }
  } catch (err) {
    console.error("[RemoteAccess] Failed to get primary screen source:", err);
  }
  return null;
}

let currentViewerInitData = null;

/**
 * Creates the Fullscreen/Windowed Remote Desktop Viewer Window for viewing partner's PC.
 */
function createRemoteViewerWindow({ partnerName, remoteResolution, initialOffer, onViewerReady, onViewerClosed, onSignal, onEndSession }) {
  currentViewerInitData = {
    partnerName: partnerName || "Partner",
    remoteResolution: remoteResolution || { width: 1920, height: 1080 },
    initialOffer: initialOffer || null,
  };

  if (remoteViewerWin && !remoteViewerWin.isDestroyed()) {
    remoteViewerWin.focus();
    if (onViewerReady) onViewerReady(remoteViewerWin);
    return remoteViewerWin;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  remoteViewerWin = new BrowserWindow({
    width: Math.min(1440, width - 100),
    height: Math.min(900, height - 100),
    minWidth: 800,
    minHeight: 500,
    backgroundColor: "#09090b",
    title: `Partner desktop — ${partnerName}`,
    icon: path.join(__dirname, "../public/icons/icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-viewer.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  remoteViewerWin.loadFile(path.join(__dirname, "../public/remote-viewer.html"));

  remoteViewerWin.once("ready-to-show", () => {
    remoteViewerWin.show();
    if (onViewerReady) onViewerReady(remoteViewerWin);
  });

  remoteViewerWin.on("closed", () => {
    remoteViewerWin = null;
    currentViewerInitData = null;
    if (onViewerClosed) onViewerClosed();
  });

  return remoteViewerWin;
}

function getRemoteViewerWindow() {
  return remoteViewerWin && !remoteViewerWin.isDestroyed() ? remoteViewerWin : null;
}

function getViewerInitData() {
  return currentViewerInitData;
}

function closeRemoteViewerWindow() {
  if (remoteViewerWin && !remoteViewerWin.isDestroyed()) {
    remoteViewerWin.close();
  }
  remoteViewerWin = null;
  currentViewerInitData = null;
}

module.exports = {
  ensureInputInjector,
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
};
