import { useSyncExternalStore } from 'react';
import defaultIcon from './assets/icon.png';
let icon = defaultIcon;
const subscribers = new Set<() => void>();
export function setCompanionIcon(value: unknown) {
  if (typeof value !== 'string' || value.length > 180000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) return;
  icon = value; subscribers.forEach(fn => fn());
}
export function useCompanionIcon() {
  return useSyncExternalStore(fn => { subscribers.add(fn); return () => { subscribers.delete(fn); }; }, () => icon);
}
