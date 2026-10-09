import { AppUsage } from '../data/mockData';

export function calculateFocusScore(apps: AppUsage[]): number {
  const total = apps.reduce((sum, app) => sum + seconds(app), 0);
  if (total === 0) return 0;
  const productive = apps.filter(a => a.category === 'productive').reduce((sum, a) => sum + seconds(a), 0);
  const wasteful = apps.filter(a => a.category === 'wasteful').reduce((sum, a) => sum + seconds(a), 0);
  
  let score = 50 + ((productive / total) * 50) - ((wasteful / total) * 30);
  return Math.min(Math.max(Math.round(score), 0), 100);
}

export function getTopDistractions(apps: AppUsage[]): AppUsage[] {
  return apps
    .filter(a => a.category === 'wasteful')
    .sort((a, b) => seconds(b) - seconds(a))
    .slice(0, 3);
}

export const seconds = (app: AppUsage): number => Math.max(0, app.totalSeconds ?? app.timeSpentMinutes * 60);
export const localDateKey = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function formatTime(minutes: number): string {
  const secs = Math.max(0, Math.floor(minutes * 60));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function getTotalScreenTime(apps: AppUsage[]): string {
  const totalMinutes = apps.reduce((sum, app) => sum + seconds(app), 0);
  return formatTime(totalMinutes / 60);
}

export function classifyApp(appName: string, currentCategory: AppUsage['category']): AppUsage['category'] {
  // Simulating an AI classification mechanism. If user reclassifies, we respect that.
  return currentCategory;
}
