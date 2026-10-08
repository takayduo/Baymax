import React from 'react';
import { useAppContext } from '../context/AppContext';

export default function Settings() {
  const { settings, updateSettings, clearData, isElectron } = useAppContext();
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = React.useState(false);
  const themeDropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(event.target as Node)) {
        setIsThemeDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="p-4 sm:p-5 max-w-3xl mx-auto w-full h-full flex flex-col justify-start space-y-4 select-none font-sans overflow-hidden">
      <header className="flex-shrink-0">
        <h1 className="text-base font-semibold tracking-tight text-white">Settings</h1>
        <p className="text-[11px] text-zinc-400">Configure your productivity and focus preferences</p>
      </header>

      <div className="space-y-3 flex-1 overflow-y-auto pr-1">
        {/* Appearance Settings */}
        <section className="glass-card p-4 rounded-xl border border-white/10 bg-[#121316]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-zinc-400">palette</span>
            Appearance
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-white">Theme</p>
              <p className="text-[10px] text-zinc-400 mt-0.5">Select interface color scheme</p>
            </div>
            <div className="relative inline-block text-left" ref={themeDropdownRef}>
              <button
                onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                className="flex items-center justify-between gap-2 bg-[#1A1C20] border border-white/10 px-3 py-1.5 text-[11px] font-medium text-white rounded-lg outline-none cursor-pointer min-w-[100px] hover:bg-white/10 transition-colors"
              >
                <span className="capitalize">{settings.theme}</span>
                <span className={`material-symbols-outlined text-[14px] text-zinc-400 transition-transform duration-200 ${isThemeDropdownOpen ? 'rotate-180' : ''}`}>
                  keyboard_arrow_down
                </span>
              </button>

              {isThemeDropdownOpen && (
                <div className="absolute right-0 mt-1 w-full bg-[#18191D] border border-white/10 shadow-2xl z-50 py-1 rounded-lg">
                  <button
                    onClick={() => { updateSettings({ theme: 'system' }); setIsThemeDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/10 ${settings.theme === 'system' ? 'text-white bg-white/10' : 'text-zinc-400 hover:text-white'}`}
                  >
                    System
                  </button>
                  <button
                    onClick={() => { updateSettings({ theme: 'dark' }); setIsThemeDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/10 ${settings.theme === 'dark' ? 'text-white bg-white/10' : 'text-zinc-400 hover:text-white'}`}
                  >
                    Dark
                  </button>
                  <button
                    onClick={() => { updateSettings({ theme: 'light' }); setIsThemeDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/10 ${settings.theme === 'light' ? 'text-white bg-white/10' : 'text-zinc-400 hover:text-white'}`}
                  >
                    Light
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section className="glass-card p-4 rounded-xl border border-white/10 bg-[#121316]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-zinc-400">notifications</span>
            Notifications
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-white">Focus Alerts & Distraction Prompts</p>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                {isElectron ? 'Notify when focus sessions complete or blocked apps open' : 'Show alerts for focus sessions'}
              </p>
            </div>
            <button
              onClick={() => updateSettings({ notifications: !settings.notifications })}
              className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${settings.notifications ? 'bg-white' : 'bg-zinc-800 border border-white/10'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${settings.notifications ? 'left-[18px] bg-black' : 'left-0.5 bg-zinc-400'}`}></div>
            </button>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="glass-card p-4 rounded-xl border border-red-500/20 bg-[#121316]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-rose-400 mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-rose-400">warning</span>
            Data & Privacy
          </h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-white">Reset Activity Data</p>
              <p className="text-[10px] text-zinc-400 mt-0.5">Permanently clear app usage history and recorded sessions</p>
            </div>
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to clear all productivity data? This cannot be undone.')) {
                  clearData();
                }
              }}
              className="px-3 py-1.5 border border-rose-500/40 text-rose-400 text-[11px] font-medium rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
            >
              Clear Data
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
