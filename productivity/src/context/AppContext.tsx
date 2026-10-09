import { assistantName } from "../branding";
import '../bridge';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppUsage, AppCategory, initialApps } from '../data/mockData';
import { calculateFocusScore } from '../utils/logic';
import type { FocusSession, AppSettings, DailyTotal } from '../types/electron';
// Local-first architecture: Electron IPC + local storage (No cloud dependencies)

export const getElectronAPI = () => typeof window === 'undefined' ? undefined : (window as any).electronAPI;

const isElectron = !!getElectronAPI();

interface UserProfile {
  name: string;
  email: string;
  picture?: string;
  idToken?: string;
  emailVerified?: boolean;
}

interface AppContextType {
  apps: AppUsage[];
  focusScore: number;
  updateAppCategory: (id: string, newCategory: AppCategory) => void;
  isFocusModeActive: boolean;
  focusDuration: number;
  focusBreakDuration: number;
  focusTimeRemaining: number;
  focusTimerMode: 'classic' | 'pomodoro';
  pomodoroState: 'work' | 'break';
  focusSelectedMode: string;
  setFocusDuration: (secs: number) => void;
  setFocusBreakDuration: (secs: number) => void;
  setFocusTimerMode: (m: 'classic' | 'pomodoro') => void;
  setPomodoroState: (s: 'work' | 'break') => void;
  setFocusSelectedMode: (m: string) => void;
  adjustFocusDuration: (deltaMins: number) => void;
  resetFocusTimer: () => void;
  startFocusSession: (config?: { mode?: string; durationMinutes?: number }, bypassBackend?: boolean) => void;
  stopFocusSession: (bypassBackend?: boolean) => void;
  blocklist: string[];
  toggleBlockApp: (id: string) => void;
  focusSessions: FocusSession[];
  addFocusSession: (session: Omit<FocusSession, 'id'>) => void;
  scanApps: () => Promise<AppUsage[]>;
  scanAllApps: () => Promise<AppUsage[]>;
  knownApps: AppUsage[];
  addCustomApp: (app: { name: string; processName?: string; category: AppCategory }) => Promise<AppUsage | null>;
  settings: AppSettings;
  updateSettings: (s: Partial<AppSettings>) => void;
  clearData: () => void;
  isElectron: boolean;
  dailyTotals: DailyTotal[];
  isOnboarded: boolean;
  setOnboarded: () => void;
  timeframe: 'daily' | 'weekly';
  setTimeframe: (t: 'daily' | 'weekly') => void;
  userProfile: UserProfile;
  setUserProfile: (p: UserProfile) => void;
}

const DEFAULT_SETTINGS: AppSettings = { theme: 'dark', notifications: true, launchOnStartup: false };

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Start with empty — real data will stream in from the tracker
  const [apps, setApps] = useState<AppUsage[]>([]);
  const [knownApps, setKnownApps] = useState<AppUsage[]>([]);
  const [focusScore, setFocusScore] = useState(0);
  const [isFocusModeActive, setIsFocusModeActive] = useState(false);
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [dailyTotals, setDailyTotals] = useState<DailyTotal[]>([]);
  const [isOnboarded, setIsOnboardedState] = useState(true);
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly'>('daily');
  const timeframeRef = useRef(timeframe);

  // Focus timer persistent state (survives tab switching and navigation)
  const [focusDuration, setFocusDurationState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('baymax_focus_duration');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch {}
    return 25 * 60;
  });
  const [focusBreakDuration, setFocusBreakDuration] = useState<number>(5 * 60);
  const [focusTimerMode, setFocusTimerMode] = useState<'classic' | 'pomodoro'>('classic');
  const [pomodoroState, setPomodoroState] = useState<'work' | 'break'>('work');
  const [focusSelectedMode, setFocusSelectedModeState] = useState<string>(() => {
    try {
      return localStorage.getItem('baymax_focus_mode') || 'Strict Lock';
    } catch {
      return 'Strict Lock';
    }
  });
  const [focusTimeRemaining, setFocusTimeRemaining] = useState<number>(() => focusDuration);
  const focusEndTimeRef = useRef<number | null>(null);

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  const [userProfile, setUserProfileState] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem('distrack_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name) return parsed;
      }
    } catch {}
    return { name: 'Badsha', email: 'user@baymax.local', emailVerified: true };
  });
  const cleanupRef = useRef<(() => void) | null>(null);

  const setUserProfile = useCallback((p: UserProfile) => {
    const valid = {
      name: p.name || 'Badsha',
      email: p.email || 'user@baymax.local',
      emailVerified: true,
      picture: p.picture
    };
    setUserProfileState(valid);
    localStorage.setItem('distrack_user', JSON.stringify(valid));
    if (isElectron) {
      window.electronAPI!.setUserProfile(valid);
    }
  }, []);

  useEffect(() => {
    (window as any).setUserProfile = setUserProfile;
    return () => {
      delete (window as any).setUserProfile;
    };
  }, [setUserProfile]);

  // Refs for tracking current local state values in the sync listener
  const settingsRef = useRef(settings);
  const blocklistRef = useRef(blocklist);
  const focusSessionsRef = useRef(focusSessions);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { blocklistRef.current = blocklist; }, [blocklist]);
  useEffect(() => { focusSessionsRef.current = focusSessions; }, [focusSessions]);

  // Helper to format local calendar date key (YYYY-MM-DD)
  const getLocalDateKey = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Local-first: all state saved via Electron IPC and local persistence
  const safeSyncToCloud = useCallback((_data: any) => {}, []);

  const handleFocusStateUpdate = useCallback((data: any) => {
    if (!data) return;
    if (typeof data === 'boolean') {
      setIsFocusModeActive(data);
      if (!data) focusEndTimeRef.current = null;
      return;
    }
    if (data.active) {
      const durMins = data.durationMinutes || data.config?.durationMinutes || 25;
      const durSecs = Math.round(durMins * 60);
      const mode = data.mode || data.config?.mode || 'Strict Lock';

      setFocusDurationState(durSecs);
      setFocusSelectedModeState(mode);
      try {
        localStorage.setItem('baymax_focus_duration', String(durSecs));
        localStorage.setItem('baymax_focus_mode', mode);
      } catch {}

      if (data.endTime && data.endTime > Date.now()) {
        focusEndTimeRef.current = data.endTime;
        const rem = Math.max(0, Math.ceil((data.endTime - Date.now()) / 1000));
        setFocusTimeRemaining(rem);
      } else if (data.remainingSeconds != null && data.remainingSeconds > 0) {
        focusEndTimeRef.current = Date.now() + (data.remainingSeconds * 1000);
        setFocusTimeRemaining(data.remainingSeconds);
      } else {
        focusEndTimeRef.current = null;
        setFocusTimeRemaining(0);
      }
      setPomodoroState(data.phase === 'break' ? 'break' : 'work');
      if (data.timerMode) setFocusTimerMode(data.timerMode);
      setIsFocusModeActive(true);
    } else {
      setIsFocusModeActive(false);
      focusEndTimeRef.current = null;
    }
  }, []);

  // ── Initial data load ──
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) {
      // Seed mock data for browser presentation mode
      if (new URLSearchParams(window.location.search).get('demo') !== '1') return;
      setApps(initialApps);
      
      const today = new Date();
      const day = today.getDay();
      const monday = new Date(today);
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      monday.setDate(diff);

      const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
      const mockValues = [3.5, 4.2, 2.8, 5.1, 3.0, 1.1, 1.0];
      const totals: DailyTotal[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const dateKey = getLocalDateKey(d);
        const val = mockValues[i];
        totals.push({
          day: days[i],
          label: days[i],
          value: val,
          date: dateKey
        });
      }
      setDailyTotals(totals);

      setFocusSessions([
        { id: '1', durationMinutes: 25, date: new Date(Date.now() - 3600000 * 2).toISOString(), mode: 'Deep Silence' },
        { id: '2', durationMinutes: 50, date: new Date(Date.now() - 3600000 * 24).toISOString(), mode: 'Strict Lock' },
        { id: '3', durationMinutes: 15, date: new Date(Date.now() - 3600000 * 48).toISOString(), mode: 'Light Focus' }
      ]);
      return;
    }

    // Load all initial data in parallel
    Promise.all([
      api.getTrackedApps('daily'),
      api.getBlocklist(),
      api.getFocusSessions(),
      api.getSettings(),
      api.getDailyTotals(),
      api.isOnboarded(),
      api.getFocusActive(),
      api.getUserProfile(),
      (api as any).getKnownApps ? (api as any).getKnownApps() : Promise.resolve([]),
    ]).then(([trackedApps, bl, sessions, sett, totals, onboarded, focusStatus, profile, libApps]) => {
      if (disposed) return;
      // Period-specific usage is owned by refresh and the timeframe effect.
      if (libApps && libApps.length > 0) {
        setKnownApps(libApps);
      } else if (Array.isArray(trackedApps)) {
        setKnownApps(trackedApps);
      }
      if (bl) setBlocklist(bl);
      setFocusSessions(Array.isArray(sessions) ? sessions : []);
      if (sett) setSettings(sett);
      if (totals) setDailyTotals(totals);
      if (typeof onboarded === 'boolean') setIsOnboardedState(onboarded);

      // Handle focus status from backend
      if (focusStatus) {
        handleFocusStateUpdate(focusStatus);
      }

      if (profile && profile.name) setUserProfileState(profile);
    }).catch(console.error);

    let disposed = false, revision = 0;
    const refresh = async () => {
      const request = ++revision, period = timeframeRef.current;
      try {
        const [rows, known, totals, status, sessions] = await Promise.all([
          api.getTrackedApps(period), api.getKnownApps(), api.getDailyTotals(), api.getFocusActive(), api.getFocusSessions()
        ]);
        if (disposed || request !== revision || period !== timeframeRef.current) return;
        setApps(rows || []); setKnownApps(known || []); setDailyTotals(totals || []);
        setFocusSessions(sessions || []); handleFocusStateUpdate(status);
      } catch (e) { console.warn('Productivity refresh failed', e); }
    };
    cleanupRef.current = api.onTrackingUpdate?.(() => { void refresh(); });
    const liveSyncTimer = setInterval(refresh, 1500);

    return () => {
      disposed = true; revision++;
      if (cleanupRef.current) cleanupRef.current();
      clearInterval(liveSyncTimer);
    };
  }, [handleFocusStateUpdate]);

  // Refresh data when timeframe changes
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    let cancelled = false;
    api.getTrackedApps(timeframe).then((trackedApps: AppUsage[]) => {
      if (cancelled) return;
      if (Array.isArray(trackedApps)) {
        setApps(trackedApps);
        setFocusScore(calculateFocusScore(trackedApps));
      }
    });
    api.getDailyTotals().then(setDailyTotals);
    return () => { cancelled = true; };
  }, [timeframe]);

  // ── Recalculate score when apps change ──
  useEffect(() => {
    setFocusScore(calculateFocusScore(apps));
  }, [apps]);

  // ── Handlers ──
  const updateAppCategory = useCallback((id: string, newCategory: AppCategory) => {
    setApps(prev => prev.map(a => a.id === id ? { ...a, category: newCategory } : a));
    setKnownApps(prev => prev.map(a => a.id === id ? { ...a, category: newCategory } : a));
    const api = getElectronAPI();
    if (api && api.updateAppCategory) {
      api.updateAppCategory(id, newCategory).then(() => {
        if (api.getAppCategories) {
          api.getAppCategories().then((cats: any) => {
            safeSyncToCloud({ appCategories: cats });
          });
        }
      }).catch(console.error);
    }
  }, [safeSyncToCloud]);

  const setFocusDuration = useCallback((secs: number) => {
    const valid = Math.max(60, Math.round(secs));
    setFocusDurationState(valid);
    try { localStorage.setItem('baymax_focus_duration', String(valid)); } catch {}
    if (!isFocusModeActive) {
      setFocusTimeRemaining(valid);
    }
  }, [isFocusModeActive]);

  const setFocusSelectedMode = useCallback((mode: string) => {
    setFocusSelectedModeState(mode);
    try { localStorage.setItem('baymax_focus_mode', mode); } catch {}
  }, []);

  const adjustFocusDuration = useCallback((deltaMinutes: number) => {
    if (isFocusModeActive) return;
    setFocusDurationState(prev => {
      const next = Math.max(60, prev + deltaMinutes * 60);
      try { localStorage.setItem('baymax_focus_duration', String(next)); } catch {}
      setFocusTimeRemaining(next);
      return next;
    });
  }, [isFocusModeActive]);

  const addFocusSession = useCallback((session: Omit<FocusSession, 'id'>) => {
    const newSession: FocusSession = { ...session, id: Date.now().toString() };
    setFocusSessions(prev => [newSession, ...prev]);

    const api = getElectronAPI();
    if (api && api.addFocusSession) {
      api.addFocusSession(session).then(() => {
        if (api.getFocusSessions) {
          api.getFocusSessions().then((sessions: FocusSession[]) => {
            if (sessions && sessions.length > 0) setFocusSessions(sessions);
          });
        }
      }).catch(console.error);
    }
  }, []);

  const stopFocusSession = useCallback((bypassBackend?: boolean) => {
    // If an active session was running, record elapsed focus time!
    if (isFocusModeActive && !getElectronAPI()) {
      let elapsedSecs = 0;
      if (focusEndTimeRef.current) {
        const totalTarget = (focusTimerMode === 'pomodoro' && pomodoroState === 'break') ? focusBreakDuration : focusDuration;
        const remaining = Math.max(0, Math.ceil((focusEndTimeRef.current - Date.now()) / 1000));
        elapsedSecs = Math.max(0, totalTarget - remaining);
      } else {
        elapsedSecs = Math.max(0, focusDuration - focusTimeRemaining);
      }

      if (elapsedSecs >= 10) {
        const durationMinutes = Math.max(1, Math.round(elapsedSecs / 60));
        addFocusSession({
          durationMinutes,
          date: new Date().toISOString(),
          mode: focusTimerMode === 'pomodoro' ? `Pomodoro (${pomodoroState})` : focusSelectedMode,
        });
      }
    }

    setIsFocusModeActive(false);
    focusEndTimeRef.current = null;
    setFocusTimeRemaining(focusDuration);

    const api = getElectronAPI();
    if (api && !bypassBackend && api.stopFocusSession) {
      api.stopFocusSession().catch(console.error);
    }
  }, [isFocusModeActive, focusDuration, focusBreakDuration, focusTimeRemaining, focusTimerMode, pomodoroState, focusSelectedMode, addFocusSession]);

  const resetFocusTimer = useCallback(() => {
    if (isFocusModeActive) {
      stopFocusSession();
    }
    setPomodoroState('work');
    setFocusTimeRemaining(focusDuration);
    focusEndTimeRef.current = null;
  }, [isFocusModeActive, focusDuration, stopFocusSession]);

  const startFocusSession = useCallback((config?: { mode?: string; durationMinutes?: number }, bypassBackend?: boolean) => {
    const sessionMode = config?.mode || focusSelectedMode;
    let durationSecs = focusDuration;
    if (config?.durationMinutes && config.durationMinutes > 0) {
      durationSecs = Math.round(config.durationMinutes * 60);
      setFocusDurationState(durationSecs);
      try { localStorage.setItem('baymax_focus_duration', String(durationSecs)); } catch {}
    }

    if (config?.mode) {
      setFocusSelectedModeState(config.mode);
      try { localStorage.setItem('baymax_focus_mode', config.mode); } catch {}
    }

    const targetSecs = (focusTimerMode === 'pomodoro' && pomodoroState === 'break') ? focusBreakDuration : durationSecs;
    focusEndTimeRef.current = Date.now() + (targetSecs * 1000);
    setFocusTimeRemaining(targetSecs);
    setIsFocusModeActive(true);

    const api = getElectronAPI();
    if (api && !bypassBackend && api.startFocusSession) {
      api.startFocusSession({ mode: sessionMode, durationMinutes: durationSecs / 60, timerMode: focusTimerMode, breakMinutes: focusBreakDuration / 60 }).catch(console.error);
    }
  }, [focusSelectedMode, focusDuration, focusTimerMode, pomodoroState, focusBreakDuration]);

  const toggleBlockApp = useCallback((id: string) => {
    const api = getElectronAPI();
    if (api && api.toggleBlockApp) {
      api.toggleBlockApp(id).then((newBlocklist: string[]) => {
        setBlocklist(newBlocklist);
        safeSyncToCloud({ blocklist: newBlocklist });
      }).catch(console.error);
    } else {
      setBlocklist(prev => {
        const newBlocklist = prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id];
        safeSyncToCloud({ blocklist: newBlocklist });
        return newBlocklist;
      });
    }
  }, [safeSyncToCloud]);

  // Global focus timer ticking effect — runs regardless of which tab is active!
  useEffect(() => {
    let interval: number | undefined;

    if (isFocusModeActive && focusEndTimeRef.current) {
      interval = window.setInterval(() => {
        const rem = Math.max(0, Math.ceil((focusEndTimeRef.current! - Date.now()) / 1000));
        setFocusTimeRemaining(rem);

        if (rem <= 0 && !getElectronAPI()) {
          const completedMins = Math.max(1, Math.round(focusDuration / 60));
          addFocusSession({
            durationMinutes: completedMins,
            date: new Date().toISOString(),
            mode: focusTimerMode === 'pomodoro' ? `Pomodoro (${pomodoroState})` : focusSelectedMode,
          });

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`${assistantName()} — Focus Session Completed`, {
              body: focusTimerMode === 'pomodoro' && pomodoroState === 'work'
                ? 'Great focus! Take a well-deserved break.'
                : `Completed ${completedMins} minute${completedMins > 1 ? 's' : ''} of deep work.`,
            });
          }

          const api = getElectronAPI();
          if (focusTimerMode === 'pomodoro') {
            if (pomodoroState === 'work') {
              setPomodoroState('break');
              const breakSecs = focusBreakDuration;
              focusEndTimeRef.current = Date.now() + breakSecs * 1000;
              setFocusTimeRemaining(breakSecs);
              if (api && api.stopFocusSession) {
                api.stopFocusSession().catch(console.error);
              }
            } else {
              setPomodoroState('work');
              setIsFocusModeActive(false);
              focusEndTimeRef.current = null;
              setFocusTimeRemaining(focusDuration);
              if (api && api.stopFocusSession) {
                api.stopFocusSession().catch(console.error);
              }
            }
          } else {
            setIsFocusModeActive(false);
            focusEndTimeRef.current = null;
            setFocusTimeRemaining(focusDuration);
            if (api && api.stopFocusSession) {
              api.stopFocusSession().catch(console.error);
            }
          }
        }
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isFocusModeActive, focusDuration, focusBreakDuration, focusTimerMode, pomodoroState, focusSelectedMode, addFocusSession]);

  // Sync with Electron backend when AI or Island toggles focus
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    let cleanup: any;
    try {
      if (typeof (api as any).onFocusStateChanged === 'function') {
        cleanup = (api as any).onFocusStateChanged((data: any) => {
          handleFocusStateUpdate(data);
        });
      }
    } catch (e) {
      console.warn('onFocusStateChanged subscription error:', e);
    }
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [handleFocusStateUpdate]);

  const scanApps = useCallback(async (): Promise<AppUsage[]> => {
    const api = getElectronAPI();
    if (!api?.scanRunningApps) throw new Error(`Open ${assistantName()} to scan real applications.`);
    const scanned = await api.scanRunningApps();
    setKnownApps(await api.getKnownApps());
    return scanned || [];
  }, []);

  const scanAllApps = useCallback(async (): Promise<AppUsage[]> => {
    const api = getElectronAPI();
    if (!api?.scanAllApps) throw new Error(`Open ${assistantName()} to scan real applications.`);
    const scanned = await api.scanAllApps();
    setKnownApps(scanned || []);
    return scanned || [];
  }, []);

  const addCustomApp = useCallback(async (appData: { name: string; processName?: string; category: AppCategory }): Promise<AppUsage | null> => {
    const api = getElectronAPI();
    if (api && (api as any).addCustomApp) {
      try {
        const added = await (api as any).addCustomApp(appData);
        if (added) {
          setKnownApps(prev => {
            const filtered = prev.filter(a => a.id !== added.id);
            return [added, ...filtered];
          });
          return added;
        }
      } catch (e) {
        console.error('Failed to add custom app:', e);
        throw e;
      }
    }
    throw new Error(`Open ${assistantName()} to add an application.`);
  }, []);

  const updateSettingsFn = useCallback((s: Partial<AppSettings>) => {
    const api = getElectronAPI();
    if (api && api.updateSettings) {
      api.updateSettings(s).then((newSettings: AppSettings) => {
        setSettings(newSettings);
        safeSyncToCloud({ settings: newSettings });
      });
    } else {
      setSettings(prev => {
        const newSettings = { ...prev, ...s };
        safeSyncToCloud({ settings: newSettings });
        return newSettings;
      });
    }
  }, [safeSyncToCloud]);

  const clearData = useCallback(() => {
    const api = getElectronAPI();
    if (api && api.clearData) {
      api.clearData().then(() => {
        setApps([]);
        setFocusSessions([]);
    setKnownApps(prev => prev.map(a => ({ ...a, totalSeconds: 0, timeSpentMinutes: 0 })));
        setDailyTotals([]);
      });
    }
  }, []);

  const setOnboarded = useCallback(() => {
    const api = getElectronAPI();
    if (api && api.setOnboarded) {
      api.setOnboarded();
    }
    setIsOnboardedState(true);
  }, []);

  return (
    <AppContext.Provider value={{
      apps, focusScore, updateAppCategory,
      isFocusModeActive, startFocusSession, stopFocusSession,
      focusDuration, focusBreakDuration, focusTimeRemaining,
      focusTimerMode, pomodoroState, focusSelectedMode,
      setFocusDuration, setFocusBreakDuration, setFocusTimerMode,
      setPomodoroState, setFocusSelectedMode, adjustFocusDuration,
      resetFocusTimer,
      blocklist, toggleBlockApp,
      focusSessions, addFocusSession,
      scanApps, scanAllApps, knownApps, addCustomApp, settings, updateSettings: updateSettingsFn,
      clearData, isElectron, dailyTotals,
      isOnboarded, setOnboarded,
      timeframe, setTimeframe,
      userProfile, setUserProfile,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
}
