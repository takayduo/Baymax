import React from 'react';
import { useAppContext } from '../context/AppContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatTime } from '../utils/logic';

export default function Insights() {
  const { apps, focusSessions } = useAppContext();

  const COLORS = {
    productive: '#10b981',
    neutral: '#71717a',
    wasteful: '#f43f5e',
  };

  const usageByCategory = apps.reduce((acc, app) => {
    const cat = (app.category && acc[app.category] !== undefined) ? app.category : 'neutral';
    acc[cat] += (app.timeSpentMinutes || 0);
    return acc;
  }, { productive: 0, neutral: 0, wasteful: 0 });

  const totalMins = usageByCategory.productive + usageByCategory.neutral + usageByCategory.wasteful;

  const pieData = [
    { name: 'Productive', value: usageByCategory.productive, color: COLORS.productive },
    { name: 'Neutral', value: usageByCategory.neutral, color: COLORS.neutral },
    { name: 'Distraction', value: usageByCategory.wasteful, color: COLORS.wasteful },
  ].filter(item => item.value > 0);

  const productiveApps = apps
    .filter(a => a.category === 'productive')
    .sort((a, b) => b.timeSpentMinutes - a.timeSpentMinutes)
    .slice(0, 3);

  const distractingApps = apps
    .filter(a => a.category === 'wasteful')
    .sort((a, b) => b.timeSpentMinutes - a.timeSpentMinutes)
    .slice(0, 3);

  return (
    <div className="p-4 sm:p-5 w-full h-full flex flex-col justify-between select-none font-sans overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-white">Focus & Activity Insights</h2>
          <p className="text-[11px] text-zinc-400">Deep behavioral breakdown and focus session records</p>
        </div>
        <span className="text-[11px] font-mono text-zinc-400 bg-white/5 border border-white/5 px-2.5 py-1 rounded-lg">
          Total Recorded: {formatTime(totalMins)}
        </span>
      </div>

      {/* Main Grid: Pie Chart on Left, Breakdown & Sessions on Right */}
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Left Column: Time Distribution Pie Chart */}
        <div className="col-span-6 glass-card p-4 rounded-xl border border-white/10 bg-[#121316] flex flex-col items-center justify-between min-h-0">
          <div className="w-full flex items-center justify-between mb-1 flex-shrink-0">
            <span className="text-xs font-semibold text-white">Time Distribution</span>
            <span className="text-[10px] text-zinc-400 font-mono">
              {totalMins > 0 ? `${Math.round((usageByCategory.productive / totalMins) * 100)}% productive` : '0%'}
            </span>
          </div>

          <div className="flex-1 w-full min-h-[160px] flex items-center justify-center">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius="50%"
                    outerRadius="75%"
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: number) => formatTime(val)}
                    contentStyle={{
                      backgroundColor: '#18191D',
                      borderColor: 'rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: '#F5F6F8',
                      fontSize: '11px',
                      fontFamily: 'monospace'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-zinc-500">No activity data recorded yet</div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 flex-shrink-0 mt-2">
            {pieData.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-zinc-400">{entry.name}</span>
                <span className="font-mono text-white text-[10px]">
                  ({totalMins > 0 ? Math.round((entry.value / totalMins) * 100) : 0}%)
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Top Productive vs Distracting & Sessions */}
        <div className="col-span-6 flex flex-col gap-3 min-h-0">
          {/* Top Apps Highlights */}
          <div className="glass-card p-3 rounded-xl border border-white/10 bg-[#121316] flex flex-col flex-1 min-h-0">
            <span className="text-xs font-semibold text-white mb-2 flex-shrink-0">Key Drivers</span>
            <div className="grid grid-cols-2 gap-2 flex-1 overflow-y-auto">
              {/* Productive Highlights */}
              <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider block mb-1">
                  Productive
                </span>
                {productiveApps.length > 0 ? (
                  productiveApps.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-xs py-0.5">
                      <span className="text-zinc-300 truncate font-medium">{a.name}</span>
                      <span className="font-mono text-[10px] text-emerald-400">{formatTime(a.timeSpentMinutes)}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-[10px] text-zinc-500">None logged yet</span>
                )}
              </div>

              {/* Distraction Highlights */}
              <div className="p-2 rounded-lg bg-rose-500/5 border border-rose-500/20">
                <span className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider block mb-1">
                  Distractions
                </span>
                {distractingApps.length > 0 ? (
                  distractingApps.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-xs py-0.5">
                      <span className="text-zinc-300 truncate font-medium">{a.name}</span>
                      <span className="font-mono text-[10px] text-rose-400">{formatTime(a.timeSpentMinutes)}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-[10px] text-zinc-500">None logged yet</span>
                )}
              </div>
            </div>
          </div>

          {/* Recent Focus Sessions */}
          <div className="glass-card p-3 rounded-xl border border-white/10 bg-[#121316] flex flex-col h-36 flex-shrink-0">
            <div className="flex items-center justify-between mb-1.5 flex-shrink-0">
              <span className="text-xs font-semibold text-white">Recent Focus Sessions</span>
              <span className="text-[10px] text-zinc-400 font-mono">{focusSessions.length} total</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {focusSessions.length > 0 ? (
                focusSessions.slice(0, 5).map((s) => (
                  <div key={s.id} className="p-1.5 rounded-lg bg-white/5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[13px] text-emerald-400">check_circle</span>
                      <span className="text-white font-medium">{s.mode || 'Focus'}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
                      <span>{s.durationMinutes} mins</span>
                      <span>{new Date(s.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                  No focus sessions completed yet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
