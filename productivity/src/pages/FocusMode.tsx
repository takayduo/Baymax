import React, { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';

export default function FocusMode() {
  const {
    apps,
    isFocusModeActive,
    startFocusSession,
    stopFocusSession,
    blocklist,
    toggleBlockApp,
    isElectron,
    focusDuration,
    focusBreakDuration,
    focusTimeRemaining,
    focusTimerMode,
    pomodoroState,
    focusSelectedMode,
    setFocusDuration,
    setFocusSelectedMode,
    setFocusTimerMode,
    setPomodoroState,
    adjustFocusDuration,
    resetFocusTimer,
  } = useAppContext();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [tempTimeInput, setTempTimeInput] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartStop = () => {
    if (!isFocusModeActive) {
      startFocusSession({ mode: focusSelectedMode, durationMinutes: Math.round(focusDuration / 60) });
    } else {
      stopFocusSession();
    }
  };

  const handleTimeInputSubmit = () => {
    setIsEditingTime(false);
    const parts = tempTimeInput.split(':');
    let mins = 0;
    let secs = 0;
    if (parts.length === 2) {
      mins = parseInt(parts[0], 10) || 0;
      secs = parseInt(parts[1], 10) || 0;
    } else if (parts.length === 1) {
      mins = parseInt(parts[0], 10) || 0;
    }
    if (mins >= 0 && secs >= 0 && secs < 60) {
      const totalSecs = Math.max(60, mins * 60 + secs);
      setFocusDuration(totalSecs);
    }
  };

  const presets = [5, 15, 25, 45, 60];
  const blockCandidates = apps.filter((app) => app.category !== 'productive');

  return (
    <div className="p-4 sm:p-5 w-full h-full flex flex-col justify-between select-none font-sans overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-white">Focus Session</h2>
          <p className="text-[11px] text-zinc-400">
            {focusSelectedMode === 'Strict Lock'
              ? 'Strict Lock terminates all non-productive apps immediately.'
              : focusSelectedMode === 'Light Focus'
              ? 'Blocks wasteful distractions while keeping neutral apps active.'
              : 'Blocks custom blocklist and wasteful distractions.'}
          </p>
        </div>

        {/* Mode selector pills */}
        <div className="flex items-center gap-1.5" ref={dropdownRef}>
          <div className="flex items-center gap-1 bg-[#141518] border border-white/10 p-0.5 rounded-lg">
            {(['Strict Lock', 'Deep Silence', 'Light Focus'] as const).map((mode) => (
              <button
                key={mode}
                disabled={isFocusModeActive}
                onClick={() => setFocusSelectedMode(mode)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer disabled:opacity-50 ${
                  focusSelectedMode === mode
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Grid: Timer on Left, Blocked Apps on Right */}
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Left: Timer Box */}
        <div className={`col-span-7 glass-card p-4 rounded-xl border flex flex-col items-center justify-between min-h-0 transition-colors ${
          !isFocusModeActive
            ? 'border-white/10 bg-[#121316]'
            : focusSelectedMode === 'Strict Lock'
            ? 'border-rose-500/40 bg-[#160E11] shadow-[0_0_30px_-10px_rgba(244,63,94,0.3)]'
            : 'border-emerald-500/40 bg-[#0E1511] shadow-[0_0_30px_-10px_rgba(16,185,129,0.3)]'
        }`}>
          {/* Top Timer Type (Classic / Pomodoro) */}
          <div className="flex items-center gap-1 bg-white/5 border border-white/5 p-0.5 rounded-lg">
            <button
              disabled={isFocusModeActive}
              onClick={() => setFocusTimerMode('classic')}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer disabled:opacity-50 ${
                focusTimerMode === 'classic' ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Classic Timer
            </button>
            <button
              disabled={isFocusModeActive}
              onClick={() => setFocusTimerMode('pomodoro')}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer disabled:opacity-50 ${
                focusTimerMode === 'pomodoro' ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Pomodoro {isFocusModeActive && `(${pomodoroState})`}
            </button>
          </div>

          {/* Central Countdown Clock */}
          <div className="flex flex-col items-center justify-center my-auto">
            {isEditingTime && !isFocusModeActive ? (
              <input
                type="text"
                value={tempTimeInput}
                onChange={(e) => setTempTimeInput(e.target.value)}
                onBlur={handleTimeInputSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTimeInputSubmit();
                  if (e.key === 'Escape') setIsEditingTime(false);
                }}
                autoFocus
                placeholder="MM:SS"
                className="text-6xl font-mono font-bold text-center tracking-tight bg-transparent border-b-2 border-white/30 text-white outline-none w-56"
              />
            ) : (
              <div
                onClick={() => {
                  if (!isFocusModeActive) {
                    setTempTimeInput(formatTimer(focusTimeRemaining));
                    setIsEditingTime(true);
                  }
                }}
                className={`text-6xl font-mono font-bold tracking-tight select-none cursor-pointer hover:opacity-90 transition-opacity ${
                  isFocusModeActive ? 'text-white' : 'text-zinc-100'
                }`}
                title={!isFocusModeActive ? 'Click to edit duration' : undefined}
              >
                {formatTimer(focusTimeRemaining)}
              </div>
            )}

            <span className="text-[11px] text-zinc-400 mt-1 font-medium">
              {isFocusModeActive
                ? `Active in ${focusSelectedMode} Mode`
                : 'Click time or choose preset below'}
            </span>
          </div>

          {/* Preset Buttons row */}
          {!isFocusModeActive && (
            <div className="flex items-center gap-1.5 mb-2">
              <button
                onClick={() => adjustFocusDuration(-5)}
                className="px-2 py-1 text-[10px] font-medium rounded bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors cursor-pointer"
              >
                -5m
              </button>
              {presets.map((mins) => (
                <button
                  key={mins}
                  onClick={() => setFocusDuration(mins * 60)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
                    Math.round(focusDuration / 60) === mins
                      ? 'bg-white/20 text-white font-bold border border-white/20'
                      : 'bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white'
                  }`}
                >
                  {mins}m
                </button>
              ))}
              <button
                onClick={() => adjustFocusDuration(5)}
                className="px-2 py-1 text-[10px] font-medium rounded bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors cursor-pointer"
              >
                +5m
              </button>
            </div>
          )}

          {/* Action Buttons: Start / Stop & Reset */}
          <div className="flex items-center gap-2 w-full max-w-xs">
            <button
              onClick={handleStartStop}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm ${
                isFocusModeActive
                  ? 'bg-rose-500 hover:bg-rose-600 text-white'
                  : 'bg-white text-black hover:bg-zinc-200'
              }`}
            >
              <span className="material-symbols-outlined text-[15px] leading-none">
                {isFocusModeActive ? 'stop' : 'play_arrow'}
              </span>
              <span>{isFocusModeActive ? 'Stop Session' : 'Start Focus'}</span>
            </button>

            {!isFocusModeActive && (
              <button
                onClick={resetFocusTimer}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Reset Timer"
              >
                <span className="material-symbols-outlined text-[14px] leading-none">replay</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Blocked Apps / Candidate Apps List */}
        <div className="col-span-5 glass-card p-3 rounded-xl border border-white/10 bg-[#121316] flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <div>
              <span className="text-xs font-semibold text-white">Blocked Apps</span>
              <p className="text-[10px] text-zinc-400">
                {focusSelectedMode === 'Strict Lock'
                  ? 'All non-productive apps auto-blocked'
                  : 'Toggle apps to block during sessions'}
              </p>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 font-mono text-zinc-300">
              {focusSelectedMode === 'Strict Lock' ? 'Strict' : `${blocklist.length} blocked`}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {blockCandidates.length > 0 ? (
              blockCandidates.map((app) => {
                const isBlocked = focusSelectedMode === 'Strict Lock' || blocklist.includes(app.id) || app.category === 'wasteful';
                return (
                  <div
                    key={app.id}
                    className="p-2 rounded-lg bg-white/5 border border-white/5 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {app.icon && app.icon.startsWith('data:') ? (
                        <img src={app.icon} className="w-4 h-4 object-contain rounded flex-shrink-0" alt="" />
                      ) : (
                        <span className="material-symbols-outlined text-[14px] text-zinc-400 flex-shrink-0">
                          {app.icon || 'apps'}
                        </span>
                      )}
                      <span className="text-xs text-white truncate font-medium">{app.name}</span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${
                        app.category === 'wasteful'
                          ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          : 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/30'
                      }`}>
                        {app.category}
                      </span>

                      {focusSelectedMode !== 'Strict Lock' && (
                        <button
                          onClick={() => toggleBlockApp(app.id)}
                          className={`w-6 h-6 flex items-center justify-center rounded cursor-pointer transition-colors ${
                            isBlocked ? 'text-rose-400 hover:bg-rose-500/20' : 'text-zinc-500 hover:bg-white/10'
                          }`}
                          title={isBlocked ? 'Unblock app' : 'Block app'}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {isBlocked ? 'block' : 'add'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                No distraction apps detected yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
