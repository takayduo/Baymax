import React, { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { formatTime } from '../utils/logic';
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip as RechartsTooltip, Cell } from 'recharts';

export default function Dashboard() {
  const { apps, focusScore, dailyTotals, timeframe, setTimeframe, focusSessions } = useAppContext();

  const screenTimeMinutes = apps.reduce((acc, app) => acc + app.timeSpentMinutes, 0);
  const productiveTimeMinutes = apps.filter(a => a.category === 'productive').reduce((acc, app) => acc + app.timeSpentMinutes, 0);
  const intentionalityScore = screenTimeMinutes > 0 ? Math.round((productiveTimeMinutes / screenTimeMinutes) * 100) : 0;
  const h = Math.floor(screenTimeMinutes / 60);
  const m = Math.floor(screenTimeMinutes % 60);
  const screenTime = screenTimeMinutes > 0 ? `${h}h ${m}m` : '0h 0m';

  const topApps = [...apps]
    .sort((a, b) => b.timeSpentMinutes - a.timeSpentMinutes)
    .slice(0, 4);

  const chartData = useMemo(() => {
    if (dailyTotals.length > 0) return dailyTotals;
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const mockTotals = [];
    const today = new Date();
    const day = today.getDay();
    const monday = new Date(today);
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    monday.setDate(diff);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      mockTotals.push({
        day: days[i],
        label: days[i],
        value: 0,
        date: d.toISOString().split('T')[0]
      });
    }
    return mockTotals;
  }, [dailyTotals]);

  const todayIdx = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const idx = chartData.findIndex(d => d.date === todayStr);
    return idx >= 0 ? idx : chartData.length - 1;
  }, [chartData]);

  const peakFlow = useMemo(() => {
    if (!focusSessions || focusSessions.length === 0) return '—';
    const hours = new Array(24).fill(0);
    for (const s of focusSessions) {
      const d = new Date(s.date);
      const hr = d.getHours();
      hours[hr] += s.durationMinutes;
    }
    const maxHour = hours.indexOf(Math.max(...hours));
    if (hours[maxHour] === 0) return '—';
    const formatHour = (hr: number) => {
      if (hr === 0 || hr === 24) return '12am';
      if (hr === 12) return '12pm';
      return hr > 12 ? `${hr - 12}pm` : `${hr}am`;
    };
    return `${formatHour(maxHour)} – ${formatHour(maxHour + 1)}`;
  }, [focusSessions]);

  return (
    <div className="p-4 sm:p-5 w-full h-full flex flex-col justify-between select-none font-sans overflow-hidden">
      {/* Header Row */}
      <div className="flex items-center justify-between flex-shrink-0 mb-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-white">Productivity Overview</h2>
          <p className="text-[11px] text-zinc-400">Activity and mindfulness metrics for {timeframe === 'daily' ? 'today' : 'this week'}</p>
        </div>
        <div className="flex items-center gap-1 bg-[#141518] border border-white/10 p-0.5 rounded-lg">
          <button
            onClick={() => setTimeframe('daily')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
              timeframe === 'daily'
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setTimeframe('weekly')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
              timeframe === 'weekly'
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Weekly
          </button>
        </div>
      </div>

      {/* Top 3 Metric Cards */}
      <div className="grid grid-cols-3 gap-3 flex-shrink-0 mb-3">
        <div className="glass-card p-3 rounded-xl border border-white/10 bg-[#121316] flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider">Focus Score</span>
            <span className="material-symbols-outlined text-[14px]">track_changes</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{focusScore}</span>
            <span className="text-[10px] text-zinc-400">/ 100</span>
          </div>
          <span className="text-[10px] text-emerald-400 mt-1 font-medium">
            {intentionalityScore}% intentional time
          </span>
        </div>

        <div className="glass-card p-3 rounded-xl border border-white/10 bg-[#121316] flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider">Screen Time</span>
            <span className="material-symbols-outlined text-[14px]">timer</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{screenTime}</span>
          </div>
          <span className="text-[10px] text-zinc-400 mt-1">
            {formatTime(productiveTimeMinutes)} productive
          </span>
        </div>

        <div className="glass-card p-3 rounded-xl border border-white/10 bg-[#121316] flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider">Peak Flow</span>
            <span className="material-symbols-outlined text-[14px]">bolt</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-white truncate">{peakFlow}</span>
          </div>
          <span className="text-[10px] text-zinc-400 mt-1">
            {focusSessions.length} sessions logged
          </span>
        </div>
      </div>

      {/* Main Content Grid: Activity Chart & Top Apps */}
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Weekly Activity Bar Chart */}
        <div className="col-span-7 glass-card p-3 rounded-xl border border-white/10 bg-[#121316] flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <span className="text-xs font-semibold text-white">Daily Screen Activity</span>
            <span className="text-[10px] text-zinc-400 font-mono">Hours / Day</span>
          </div>
          <div className="flex-1 w-full min-h-[140px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={140}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  stroke="#52525b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                />
                <RechartsTooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-[#18191D] border border-white/10 px-2.5 py-1.5 rounded-lg text-xs font-mono shadow-xl">
                          <span className="text-white font-bold">{payload[0].value} hrs</span>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={index === todayIdx ? '#3b82f6' : 'rgba(255,255,255,0.18)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Apps List */}
        <div className="col-span-5 glass-card p-3 rounded-xl border border-white/10 bg-[#121316] flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <span className="text-xs font-semibold text-white">Top Active Apps</span>
            <span className="text-[10px] text-zinc-400">Today</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {topApps.length > 0 ? (
              topApps.map((app) => {
                const percent = screenTimeMinutes > 0 ? Math.round((app.timeSpentMinutes / screenTimeMinutes) * 100) : 0;
                return (
                  <div key={app.id} className="p-2 rounded-lg bg-white/5 border border-white/5 flex items-center justify-between gap-2">
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
                      <span className="text-[11px] font-mono text-zinc-300">{formatTime(app.timeSpentMinutes)}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${
                        app.category === 'productive'
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : app.category === 'wasteful'
                          ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          : 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/30'
                      }`}>
                        {app.category}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                No apps tracked yet today
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
