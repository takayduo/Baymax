import { getAppearance } from "./appearance";
import { drawPortrait } from "./render";

let lastIcon = "";
let portraitKey = "", portraitPng = "";
export function companionIconDataURL() {
  const appearance = getAppearance(), key = JSON.stringify(appearance);
  if (portraitKey !== key) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    drawPortrait(canvas.getContext("2d")!, 128, appearance);
    portraitPng = canvas.toDataURL("image/png"); portraitKey = key;
  }
  return portraitPng;
}
export function syncCompanionIcon() {
  const appearance = getAppearance(), key = JSON.stringify(appearance);
  if (key === lastIcon || !window.electronAPI?.setCompanionIcon) return;
  lastIcon = key;
  void window.electronAPI.setCompanionIcon(companionIconDataURL()).catch(() => { lastIcon = ""; });
}
