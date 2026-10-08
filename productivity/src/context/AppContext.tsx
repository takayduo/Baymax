import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppUsage, AppCategory, initialApps } from '../data/mockData';
import { calculateFocusScore } from '../utils/logic';
import type { FocusSession, AppSettings, DailyTotal } from '../types/electron';
// Local-first architecture: Electron IPC + local storage (No cloud dependencies)

const isElectron = !!window.electronAPI;

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

  // ── Initial data load ──
  useEffect(() => {
    if (!isElectron) {
      // Seed mock data for browser presentation mode
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

    const api = window.electronAPI!;

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
    ]).then(([trackedApps, bl, sessions, sett, totals, onboarded, focusActive, profile]) => {
      if (trackedApps.length > 0) {
        setApps(trackedApps);
        setFocusScore(calculateFocusScore(trackedApps));
      }
      setBlocklist(bl);
      setFocusSessions(sessions);
      setSettings(sett);
      setDailyTotals(totals);
      setIsOnboardedState(onboarded);
      setIsFocusModeActive(focusActive);
      if (profile && profile.name) setUserProfileState(profile);
    }).catch(console.error);

    // Listen for live tracking updates from the tracker
    const unsub = api.onTrackingUpdate((data) => {
      if (timeframeRef.current === 'weekly') {
        api.getTrackedApps('weekly').then((trackedApps) => {
          setApps(trackedApps);
          setFocusScore(calculateFocusScore(trackedApps));
        });
      } else {
        setApps(data.apps);
        setFocusScore(calculateFocusScore(data.apps));
      }
    });
    cleanupRef.current = unsub;

    // Also poll for daily totals every 30 seconds to keep the chart fresh
    const totalsTimer = setInterval(() => {
      api.getDailyTotals().then(setDailyTotals);
    }, 30000);

    return () => {
      if (cleanupRef.current) cleanupRef.current();
      clearInterval(totalsTimer);
    };
  }, []);

  // Refresh data when timeframe changes
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI!.getTrackedApps(timeframe).then((trackedApps) => {
      if (trackedApps.length > 0) {
        setApps(trackedApps);
        setFocusScore(calculateFocusScore(trackedApps));
      }
    });
    window.electronAPI!.getDailyTotals().then(setDailyTotals);
  }, [timeframe]);

  // ── Recalculate score when apps change ──
  useEffect(() => {
    setFocusScore(calculateFocusScore(apps));
  }, [apps]);

  // ── Handlers ──
  const updateAppCategory = useCallback((id: string, newCategory: AppCategory) => {
    const updateLocal = () => {
      setApps(prev => prev.map(a => a.id === id ? { ...a, category: newCategory } : a));
    };
    if (isElectron) {
      window.electronAPI!.updateAppCategory(id, newCategory).then(() => {
        updateLocal();
        window.electronAPI!.getAppCategories().then(cats => {
          safeSyncToCloud({ appCategories: cats });
        });
      });
    } else {
      updateLocal();
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

  const stopFocusSession = useCallback((bypassBackend?: boolean) => {
    setIsFocusModeActive(false);
    focusEndTimeRef.current = null;
    setFocusTimeRemaining(focusDuration);

    if (isElectron && !bypassBackend) {
      window.electronAPI!.stopFocusSession().catch(console.error);
    }
  }, [focusDuration, isElectron]);

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

    if (isElectron && !bypassBackend) {
      window.electronAPI!.startFocusSession({ mode: sessionMode }).catch(console.error);
    }
  }, [focusSelectedMode, focusDuration, focusTimerMode, pomodoroState, focusBreakDuration, isElectron]);

  const toggleBlockApp = useCallback((id: string) => {
    if (isElectron) {
      window.electronAPI!.toggleBlockApp(id).then(newBlocklist => {
        setBlocklist(newBlocklist);
        safeSyncToCloud({ blocklist: newBlocklist });
      });
    } else {
      setBlocklist(prev => {
        const newBlocklist = prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id];
        safeSyncToCloud({ blocklist: newBlocklist });
        return newBlocklist;
      });
    }
  }, [safeSyncToCloud]);

  const addFocusSession = useCallback((session: Omit<FocusSession, 'id'>) => {
    const newSession = { ...session, id: Date.now().toString() };
    if (isElectron) {
      window.electronAPI!.addFocusSession(session).then(() => {
        window.electronAPI!.getFocusSessions().then(sessions => {
          setFocusSessions(sessions);
          safeSyncToCloud({ focusSessions: sessions });
        });
      });
    } else {
      setFocusSessions(prev => {
        const list = [newSession, ...prev];
        safeSyncToCloud({ focusSessions: list });
        return list;
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

        if (rem <= 0) {
          const completedMins = Math.max(1, Math.round(focusDuration / 60));
          addFocusSession({
            durationMinutes: completedMins,
            date: new Date().toISOString(),
            mode: focusTimerMode === 'pomodoro' ? `Pomodoro (${pomodoroState})` : focusSelectedMode,
          });

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Baymax — Focus Session Completed', {
              body: focusTimerMode === 'pomodoro' && pomodoroState === 'work'
                ? 'Great focus! Take a well-deserved break.'
                : `Completed ${completedMins} minute${completedMins > 1 ? 's' : ''} of deep work.`,
            });
          }

          if (focusTimerMode === 'pomodoro') {
            if (pomodoroState === 'work') {
              setPomodoroState('break');
              const breakSecs = focusBreakDuration;
              focusEndTimeRef.current = Date.now() + breakSecs * 1000;
              setFocusTimeRemaining(breakSecs);
              if (isElectron) {
                window.electronAPI!.stopFocusSession().catch(console.error);
              }
            } else {
              setPomodoroState('work');
              setIsFocusModeActive(false);
              focusEndTimeRef.current = null;
              setFocusTimeRemaining(focusDuration);
              if (isElectron) {
                window.electronAPI!.stopFocusSession().catch(console.error);
              }
            }
          } else {
            setIsFocusModeActive(false);
            focusEndTimeRef.current = null;
            setFocusTimeRemaining(focusDuration);
            if (isElectron) {
              window.electronAPI!.stopFocusSession().catch(console.error);
            }
          }
        }
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isFocusModeActive, focusDuration, focusBreakDuration, focusTimerMode, pomodoroState, focusSelectedMode, addFocusSession, isElectron]);

  // Sync with Electron backend when AI or Island toggles focus
  useEffect(() => {
    if (!isElectron) return;
    const cleanup = (window.electronAPI as any)?.onFocusStateChanged?.((data: any) => {
      if (data?.active) {
        startFocusSession(data.config, true);
      } else {
        stopFocusSession(true);
      }
    });
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [startFocusSession, stopFocusSession, isElectron]);

  const scanApps = useCallback(async (): Promise<AppUsage[]> => {
    if (isElectron) {
      const scanned = await window.electronAPI!.scanRunningApps();
      // Merge scanned apps into existing apps list
      setApps(prev => {
        const merged = [...prev];
        for (const app of scanned) {
          if (!merged.find(a => a.id === app.id)) {
            merged.push(app);
          }
        }
        return merged;
      });
      return scanned;
    } else {
      // Simulate scan in browser mode
      const mockScanned: AppUsage[] = [
        { id: "chrome", name: "Google Chrome", timeSpentMinutes: 0, category: "neutral", type: "application", icon: "public" },
        { id: "notion", name: "Notion", timeSpentMinutes: 0, category: "productive", type: "application", icon: "edit_note" },
        { id: "spotify", name: "Spotify", timeSpentMinutes: 0, category: "neutral", type: "application", icon: "music_note" },
        { id: "discord", name: "Discord", timeSpentMinutes: 0, category: "wasteful", type: "application", icon: "chat" }
      ];
      setApps(prev => {
        const merged = [...prev];
        for (const app of mockScanned) {
          if (!merged.find(a => a.id === app.id)) {
            merged.push(app);
          }
        }
        return merged;
      });
      return mockScanned;
    }
  }, []);

  const updateSettingsFn = useCallback((s: Partial<AppSettings>) => {
    if (isElectron) {
      window.electronAPI!.updateSettings(s).then(newSettings => {
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
    if (isElectron) {
      window.electronAPI!.clearData().then(() => {
        setApps([]);
        setFocusSessions([]);
        setDailyTotals([]);
      });
    }
  }, []);

  const setOnboarded = useCallback(() => {
    if (isElectron) {
      window.electronAPI!.setOnboarded();
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
      scanApps, settings, updateSettings: updateSettingsFn,
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
