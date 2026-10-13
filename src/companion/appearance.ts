import catalog from "../../public/companions/catalog.json";

export const AVATARS = catalog;
export type Avatar = typeof catalog[number];
export type Accessory = "none" | "scarf" | "bow" | "sparkle";
export type Markings = "plain" | "cheeks" | "freckles";
export interface AvatarStyle { color: string; accent: string; accessory: Accessory; markings: Markings }
export interface CompanionPreferences { avatarId: string; styles: Record<string, AvatarStyle> }
export interface Appearance { avatar: Avatar; style: AvatarStyle }

let musicPlaying=false, musicHeadphones=true, musicStarted=-Infinity;
let requestedVibe=-Infinity;
export function triggerMusicVibe(now=performance.now()) {requestedVibe=now;}
export function setMusicPlayback(playing:boolean, now=performance.now()) {
  if(playing && !musicPlaying)musicStarted=now;
  musicPlaying=playing;
}
export function setMusicHeadphones(enabled:boolean) {musicHeadphones=enabled;}
export function musicAppearance(now=performance.now()) {
  const start=Math.max(musicPlaying?musicStarted:-Infinity,requestedVibe);
  const progress=(now-start)/1800;
  const envelope=progress>=0 && progress<1 ? Math.sin(Math.PI*progress) : 0;
  return {headphones:musicPlaying && musicHeadphones,bob:envelope ? Math.sin(progress*Math.PI*10)*envelope : 0,tilt:envelope ? Math.sin(progress*Math.PI*6)*envelope : 0};
}

export function defaultStyle(avatar: Avatar): AvatarStyle {
  return { color: avatar.color, accent: avatar.accent, accessory: "none", markings: avatar.minimal ? "plain" : "cheeks" };
}
const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
export function normalizePreferences(value: unknown): CompanionPreferences {
  const input = value && typeof value === "object" ? value as Record<string, any> : {};
  const styles: Record<string, AvatarStyle> = {};
  for (const avatar of AVATARS) {
    const raw = input.styles?.[avatar.id];
    const defaults = defaultStyle(avatar);
    if (raw && typeof raw === "object") styles[avatar.id] = {
      color: color(raw.color, defaults.color), accent: color(raw.accent, defaults.accent),
      accessory: ["none", "scarf", "bow", "sparkle"].includes(raw.accessory) ? raw.accessory : defaults.accessory,
      markings: ["plain", "cheeks", "freckles"].includes(raw.markings) ? raw.markings : defaults.markings,
    };
  }
  return { avatarId: AVATARS.some(a => a.id === input.avatarId) ? input.avatarId : AVATARS[0].id, styles };
}
let current = normalizePreferences(null);
export function setCompanionPreferences(value: unknown) { current = normalizePreferences(value); }
export function getAppearance(id = current.avatarId, preferences = current): Appearance {
  const avatar = AVATARS.find(a => a.id === id) || AVATARS[0];
  return { avatar, style: preferences.styles[avatar.id] || defaultStyle(avatar) };
}
export function shade(hex: string, amount: number): string {
  const values = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${values.map(v => Math.round(v + ((amount > 0 ? 255 : 0) - v) * Math.abs(amount))).join(",")})`;
}

/** Minimal bodies have no pale face patch; keep expressions readable on custom colours. */
export function companionInk(appearance = getAppearance()): string {
  const rgb = [1, 3, 5].map(i => parseInt(appearance.style.color.slice(i, i + 2), 16) / 255);
  const luminance = rgb.reduce((sum, v, i) => sum + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0);
  return appearance.avatar.minimal && luminance < .24 ? "#F7F3FF" : "#242632";
}
