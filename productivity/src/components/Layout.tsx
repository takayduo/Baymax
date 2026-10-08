import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import FocusOverlay from './FocusOverlay';

const navItems = [
  { path: '/', icon: 'space_dashboard', label: 'Overview' },
  { path: '/classification', icon: 'grid_view', label: 'Apps' },
  { path: '/focus', icon: 'timer', label: 'Focus' },
  { path: '/insights', icon: 'query_stats', label: 'Insights' },
  { path: '/settings', icon: 'tune', label: 'Settings' },
];

export default function Layout() {
  const { isFocusModeActive, focusTimeRemaining, focusSelectedMode, stopFocusSession, apps } = useAppContext();
  const screenTimeMinutes = apps.reduce((acc, app) => acc + app.timeSpentMinutes, 0);
  const h = Math.floor(screenTimeMinutes / 60);
  const m = Math.floor(screenTimeMinutes % 60);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#08080A] text-[#F5F6F8] select-none font-sans overflow-hidden">
      {/* Sleek Baymax Navigation Bar */}
      <header className="h-10 px-4 flex items-center justify-between border-b border-white/10 bg-[#0E0F12]/90 backdrop-blur-md flex-shrink-0 z-40">
        <div className="flex items-center gap-1.5">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  isActive
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <span className="material-symbols-outlined text-[14px] leading-none">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>

        {/* Right side status indicator */}
        <div className="flex items-center gap-3">
          {isFocusModeActive ? (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-[11px] font-medium text-rose-300 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
              <span>Focus Active: {formatTimer(focusTimeRemaining)} ({focusSelectedMode})</span>
              <button
                onClick={() => stopFocusSession()}
                className="ml-1 text-[10px] text-zinc-400 hover:text-white px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
                title="Stop Focus"
              >
                Stop
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
              <span className="material-symbols-outlined text-[13px] text-zinc-500">schedule</span>
              <span>Today: {h}h {m}m</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace View */}
      <main className="flex-1 w-full h-[calc(100vh-40px)] overflow-hidden flex flex-col">
        <Outlet />
      </main>

      <FocusOverlay />
    </div>
  );
}
