import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { AppUsage, AppCategory } from '../data/mockData';
import { formatTime } from '../utils/logic';

export default function Classification() {
  const { apps, updateAppCategory, scanApps, scanAllApps } = useAppContext();
  const [isScanning, setIsScanning] = useState(false);
  const [isScanningAll, setIsScanningAll] = useState(false);
  const [scannedApps, setScannedApps] = useState<AppUsage[]>([]);
  const [filter, setFilter] = useState<'all' | 'productive' | 'neutral' | 'wasteful'>('all');
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

  // Merge tracked apps + scanned apps
  const allApps = React.useMemo(() => {
    const merged = new Map<string, AppUsage>();
    for (const app of apps) {
      merged.set(app.id, { ...app });
    }
    for (const app of scannedApps) {
      const existing = merged.get(app.id);
      if (existing) {
        if (app.icon && app.icon.startsWith('data:') && (!existing.icon || !existing.icon.startsWith('data:'))) {
          existing.icon = app.icon;
        }
      } else {
        merged.set(app.id, { ...app });
      }
    }
    return Array.from(merged.values()).sort((a, b) => b.timeSpentMinutes - a.timeSpentMinutes);
  }, [apps, scannedApps]);

  const filteredApps = React.useMemo(() => {
    if (filter === 'all') return allApps;
    return allApps.filter((a) => a.category === filter);
  }, [allApps, filter]);

  const handleCategoryChange = (id: string, newCategory: AppCategory) => {
    updateAppCategory(id, newCategory);
    setScannedApps(prev => prev.map(a => a.id === id ? { ...a, category: newCategory } : a));
  };

  const handleScan = async () => {
    if (isScanning || isScanningAll) return;
    setIsScanning(true);
    setScanFeedback(null);

    try {
      const scanned = await scanApps();
      if (scanned && scanned.length > 0) {
        setScannedApps(scanned);
        const newCount = scanned.filter(s => !apps.find(a => a.id === s.id)).length;
        setScanFeedback(`Found ${scanned.length} running apps (${newCount} new)`);
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
        setScannedApps(scanned);
        const newCount = scanned.filter(s => !apps.find(a => a.id === s.id)).length;
        setScanFeedback(`Discovered ${scanned.length} installed apps (${newCount} new)`);
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

  return (
    <div className="p-4 sm:p-5 w-full h-full flex flex-col justify-between select-none font-sans overflow-hidden">
      {/* Header Row */}
      <div className="flex items-center justify-between flex-shrink-0 mb-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-white">App Classification</h2>
          <p className="text-[11px] text-zinc-400">Classify apps to regulate focus blocking and intentionality score</p>
        </div>

        <div className="flex items-center gap-2">
          {scanFeedback && (
            <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
              {scanFeedback}
            </span>
          )}

          <button
            onClick={handleScan}
            disabled={isScanning || isScanningAll}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 border border-white/10"
          >
            <span className={`material-symbols-outlined text-[14px] ${isScanning ? 'animate-spin' : ''}`}>
              {isScanning ? 'progress_activity' : 'radar'}
            </span>
            <span>{isScanning ? 'Scanning...' : 'Scan Running Apps'}</span>
          </button>

          <button
            onClick={handleScanAll}
            disabled={isScanning || isScanningAll}
            className="px-3 py-1.5 bg-white text-black hover:bg-zinc-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
          >
            <span className={`material-symbols-outlined text-[14px] ${isScanningAll ? 'animate-spin' : ''}`}>
              {isScanningAll ? 'progress_activity' : 'apps'}
            </span>
            <span>{isScanningAll ? 'Scanning All...' : 'Scan All Apps'}</span>
          </button>
        </div>
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
                  <span className="material-symbols-outlined text-[16px] text-zinc-400 flex-shrink-0">
                    {app.icon || 'apps'}
                  </span>
                )}
                <div className="min-w-0 flex flex-col">
                  <span className="text-xs font-medium text-white truncate">{app.name}</span>
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {app.timeSpentMinutes > 0 ? `${formatTime(app.timeSpentMinutes)} recorded` : 'Running process'}
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
              </div>
            </div>
          ))
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-zinc-500">
            No applications match the current filter
          </div>
        )}
      </div>
    </div>
  );
}
