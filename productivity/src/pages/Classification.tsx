import Icon from "../components/Icon";
import React, { useState } from 'react';
import { useAppContext, getElectronAPI } from '../context/AppContext';
import { AppUsage, AppCategory } from '../data/mockData';
import { formatTime } from '../utils/logic';

export default function Classification() {
  const { apps, updateAppCategory, scanApps, scanAllApps, knownApps, addCustomApp } = useAppContext();
  const [isScanning, setIsScanning] = useState(false);
  const [isScanningAll, setIsScanningAll] = useState(false);
  const [filter, setFilter] = useState<'all' | 'productive' | 'neutral' | 'wasteful'>('all');
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

  const [showHidden, setShowHidden] = useState(false);
  const [libraryOverride, setLibraryOverride] = useState<AppUsage[] | null>(null);
  const [health, setHealth] = useState<any>(null);
  React.useEffect(() => {
    const api=getElectronAPI();
    const refresh=() => { api?.getKnownApps?.(true).then(setLibraryOverride); api?.getTrackingHealth?.().then(setHealth); };
    refresh(); const timer=setInterval(refresh,3000); return () => clearInterval(timer);
  }, []);
  const setHidden = async (app: AppUsage) => {
    const api=getElectronAPI(); await api?.setAppHidden(app.id,!app.hidden);
    setLibraryOverride(await api.getKnownApps(true));
  };

  // Add Custom App Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newAppProcess, setNewAppProcess] = useState('');
  const [newAppCategory, setNewAppCategory] = useState<AppCategory>('wasteful');
  const [isSavingApp, setIsSavingApp] = useState(false);

  // Merge persistent library (knownApps) + live tracked usage apps
  const allApps = React.useMemo(() => {
    const merged = new Map<string, AppUsage>();
    for (const app of libraryOverride || knownApps) {
      merged.set(app.id, { ...app });
    }
    for (const app of apps) {
      const existing = merged.get(app.id);
      if (existing) {
        existing.timeSpentMinutes = app.timeSpentMinutes;
        if (app.icon && (!existing.icon || !existing.icon.startsWith('data:'))) {
          existing.icon = app.icon;
        }
      } else {
        merged.set(app.id, { ...app });
      }
    }
    return Array.from(merged.values()).sort((a, b) => {
      if (b.timeSpentMinutes !== a.timeSpentMinutes) {
        return b.timeSpentMinutes - a.timeSpentMinutes;
      }
      return a.name.localeCompare(b.name);
    });
  }, [apps, knownApps, libraryOverride]);

  const filteredApps = React.useMemo(() => {
    return allApps.filter(a => (showHidden || !a.hidden) && (filter === 'all' || a.category === filter));
  }, [allApps, filter, showHidden]);

  const handleCategoryChange = (id: string, newCategory: AppCategory) => {
    updateAppCategory(id, newCategory);
  };

  const handleScan = async () => {
    if (isScanning || isScanningAll) return;
    setIsScanning(true);
    setScanFeedback(null);

    try {
      const scanned = await scanApps();
      if (scanned && scanned.length > 0) {
        setScanFeedback(`Found ${scanned.length} running apps`);
      } else {
        setScanFeedback('No active desktop windows found.');
      }
    } catch (e) {
      console.error('Scan failed:', e);
      setScanFeedback('Scan failed');
    }

    setIsScanning(false);
    setTimeout(() => setScanFeedback(null), 4000);
  };

  const handleScanAll = async () => {
    if (isScanning || isScanningAll) return;
    setIsScanningAll(true);
    setScanFeedback(null);

    try {
      const scanned = await scanAllApps();
      if (scanned && scanned.length > 0) {
        setScanFeedback(`Saved ${scanned.length} applications to library`);
      } else {
        setScanFeedback('No installed applications discovered.');
      }
    } catch (e) {
      console.error('Scan all installed apps failed:', e);
      setScanFeedback('Scan failed');
    }

    setIsScanningAll(false);
    setTimeout(() => setScanFeedback(null), 5000);
  };

  const handleAddAppSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) return;
    setIsSavingApp(true);

    try {
      const added = await addCustomApp({
        name: newAppName.trim(),
        processName: newAppProcess.trim(),
        category: newAppCategory,
      });
      if (added) {
        setScanFeedback(`Added ${added.name} to library`);
        setTimeout(() => setScanFeedback(null), 4000);
      }
      setIsAddModalOpen(false);
      setNewAppName('');
      setNewAppProcess('');
      setNewAppCategory('wasteful');
    } catch (err) {
      console.error('Failed to add app:', err);
      setScanFeedback(String(err));
    } finally {
      setIsSavingApp(false);
    }
  };

  return (
    <div className="p-4 sm:p-5 w-full h-full flex flex-col justify-between select-none font-sans overflow-hidden relative">
      {/* Header Row */}
      <div className="flex items-center justify-between flex-shrink-0 mb-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-white">App Classification</h2>
          <p className="text-[11px] text-zinc-400">Classify apps to regulate focus blocking and intentionality score</p>
        </div>

        <div className="flex items-center gap-2">
          {scanFeedback && (
            <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
              <Icon className="app-icon text-[13px]" name="check_circle" />
              {scanFeedback}
            </span>
          )}

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all cursor-pointer border border-white/10 shadow-sm"
          >
            <Icon className="app-icon text-[14px]" name="add" />
            <span>Add App</span>
          </button>

          <button
            onClick={handleScan}
            disabled={isScanning || isScanningAll}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 border border-white/10"
          >
            <Icon className={`app-icon text-[14px] ${isScanning ? 'animate-spin' : ''}`} name={isScanning ? 'progress_activity' : 'radar'} />
            <span>{isScanning ? 'Scanning...' : 'Scan Running Apps'}</span>
          </button>

          <button
            onClick={handleScanAll}
            disabled={isScanning || isScanningAll}
            className="px-3 py-1.5 bg-white text-black hover:bg-zinc-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
          >
            <Icon className={`app-icon text-[14px] ${isScanningAll ? 'animate-spin' : ''}`} name={isScanningAll ? 'progress_activity' : 'apps'} />
            <span>{isScanningAll ? 'Scanning All...' : 'Scan All Apps'}</span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
        <span>{health?.error ? `Tracking needs attention: ${health.error}` : health?.paused ? 'Tracking paused while locked or suspended' : health?.idle ? 'Idle — active time is paused' : health?.active ? 'Tracking is active' : 'Tracker reconnecting — usage may be incomplete'}</span>
        <label><input type="checkbox" checked={showHidden} onChange={e=>setShowHidden(e.target.checked)} /> Show hidden apps and utilities</label>
      </div>
      {/* Filter Tabs */}
      <div className="flex items-center justify-between flex-shrink-0 mb-2">
        <div className="flex items-center gap-1 bg-[#141518] border border-white/10 p-0.5 rounded-lg">
          {(['all', 'productive', 'neutral', 'wasteful'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md capitalize transition-all cursor-pointer ${
                filter === t
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t === 'wasteful' ? 'Distraction' : t}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-zinc-500 font-mono">
          Showing {filteredApps.length} of {allApps.length} apps
        </span>
      </div>

      {/* Main Apps List Container */}
      <div className="flex-1 min-h-0 glass-card p-3 rounded-xl border border-white/10 bg-[#121316] overflow-y-auto space-y-1.5 pr-1">
        {filteredApps.length > 0 ? (
          filteredApps.map((app) => (
            <div
              key={app.id}
              className="p-2.5 rounded-lg bg-white/5 border border-white/5 flex items-center justify-between gap-3 hover:bg-white/[0.07] transition-colors"
            >
              {/* App Icon + Name + Time */}
              <div className="flex items-center gap-2.5 min-w-0">
                {app.icon && app.icon.startsWith('data:') ? (
                  <img src={app.icon} className="w-5 h-5 object-contain rounded flex-shrink-0" alt="" />
                ) : (
                  <Icon className="app-icon text-[16px] text-zinc-400 flex-shrink-0" name={app.icon || 'apps'} />
                )}
                <div className="min-w-0 flex flex-col">
                  <span className="text-xs font-medium text-white truncate">{app.name}</span>
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {app.timeSpentMinutes > 0 ? `${formatTime(app.timeSpentMinutes)} recorded` : 'Installed app (0m)'}
                  </span>
                </div>
              </div>

              {/* 3-Segment Category Selector */}
              <div className="flex items-center gap-1 bg-[#1A1C20] border border-white/10 p-0.5 rounded-lg flex-shrink-0">
                <button
                  onClick={() => handleCategoryChange(app.id, 'productive')}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded transition-all cursor-pointer ${
                    app.category === 'productive'
                      ? 'bg-emerald-500/25 text-emerald-300 font-bold border border-emerald-500/40'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Productive
                </button>
                <button
                  onClick={() => handleCategoryChange(app.id, 'neutral')}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded transition-all cursor-pointer ${
                    app.category === 'neutral'
                      ? 'bg-zinc-500/25 text-zinc-200 font-bold border border-zinc-500/40'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Neutral
                </button>
                <button
                  onClick={() => handleCategoryChange(app.id, 'wasteful')}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded transition-all cursor-pointer ${
                    app.category === 'wasteful'
                      ? 'bg-rose-500/25 text-rose-300 font-bold border border-rose-500/40'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Distraction
                </button>
                <button onClick={() => void setHidden(app)} className="px-2 text-[10px] text-zinc-400 hover:text-white">{app.hidden ? "Restore" : "Hide"}</button>
              </div>
            </div>
          ))
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-zinc-500">
            No applications match the current filter
          </div>
        )}
      </div>

      {/* Add Custom App Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#141518] border border-white/15 rounded-xl shadow-2xl p-5 flex flex-col gap-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className="app-icon text-white text-[18px]" name="add_circle" />
                <h3 className="text-sm font-semibold">Add Custom Application</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <Icon className="app-icon text-[18px]" name="close" />
              </button>
            </div>

            <form onSubmit={handleAddAppSubmit} className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] text-zinc-400 font-medium mb-1 block">Application Display Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. League of Legends, Valorant, Figma"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
                />
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 font-medium mb-1 block">Exact process name (required)</label>
                <input
                  type="text"
                  placeholder="e.g. leagueclient, valorant, figma"
                  required
                  value={newAppProcess}
                  onChange={(e) => setNewAppProcess(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 font-mono"
                />
                <span className="text-[10px] text-zinc-500 mt-0.5 block">Used for process matching and focus blocking</span>
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 font-medium mb-1.5 block">Category Classification</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewAppCategory('productive')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      newAppCategory === 'productive'
                        ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-300 font-semibold'
                        : 'bg-white/5 border-white/5 text-zinc-400 hover:text-white'
                    }`}
                  >
                    Productive
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewAppCategory('neutral')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      newAppCategory === 'neutral'
                        ? 'bg-zinc-500/25 border-zinc-400/50 text-zinc-200 font-semibold'
                        : 'bg-white/5 border-white/5 text-zinc-400 hover:text-white'
                    }`}
                  >
                    Neutral
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewAppCategory('wasteful')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      newAppCategory === 'wasteful'
                        ? 'bg-rose-500/25 border-rose-500/50 text-rose-300 font-semibold'
                        : 'bg-white/5 border-white/5 text-zinc-400 hover:text-white'
                    }`}
                  >
                    Distraction
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newAppName.trim() || isSavingApp}
                  className="px-4 py-1.5 bg-white text-black text-xs font-semibold rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {isSavingApp ? 'Saving...' : 'Add Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
