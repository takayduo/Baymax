import Icon from "./Icon";
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { formatTime } from '../utils/logic';

export default function TopBar() {
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const { apps, userProfile, setUserProfile } = useAppContext();
  
  const totalScreenTime = apps.reduce((acc, app) => acc + app.timeSpentMinutes, 0);
  const displayName = userProfile.name || 'User';

  return (
    <header className="sticky top-0 z-50 h-16 border-b border-outline-variant px-6 lg:px-10 flex items-center justify-between bg-background/80 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex flex-col justify-center">
          <h1 className="text-lg lg:text-xl font-serif italic tracking-tight text-primary leading-none">
            Distrack
          </h1>
          <span className="text-[8px] uppercase font-sans font-bold tracking-[0.25em] text-on-surface-variant mt-1.5 opacity-65">
            Digital Mindfulness
          </span>
        </div>
      </div>
      <div className="flex items-center gap-6 text-on-surface">
        <div className="hidden lg:flex flex-col items-end">
          <span className="text-[10px] text-on-surface-variant uppercase tracking-widest">Screen Time</span>
          <span className="text-base font-mono text-primary">{formatTime(totalScreenTime)}</span>
        </div>
        <div className="relative">
          <div 
            className="w-10 h-10 flex items-center justify-center rounded-full border border-outline-variant bg-surface hover:bg-surface-bright cursor-pointer transition-colors"
            onClick={() => setProfileOpen(!profileOpen)}
          >
            {userProfile.picture ? (
              <img src={userProfile.picture} alt={displayName} className="w-full h-full rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : userProfile.name ? (
              <span className="text-primary text-sm font-bold uppercase">{userProfile.name.charAt(0)}</span>
            ) : (
              <Icon className="app-icon text-primary text-[20px]" name="person" />
            )}
          </div>
          {profileOpen && (
            <div className="absolute right-0 top-14 w-48 bg-surface border border-outline-variant shadow-2xl flex flex-col z-50">
              <div className="px-4 py-3 border-b border-outline-variant">
                <p className="text-sm text-primary font-serif tracking-wide">{displayName}</p>
                {userProfile.email && (
                  <p className="text-[10px] text-on-surface-variant font-mono mt-1 truncate">{userProfile.email}</p>
                )}
              </div>
              <button 
                onClick={() => {
                  setProfileOpen(false);
                  navigate('/settings');
                }}
                className="text-left px-4 py-3 text-[10px] uppercase tracking-widest hover:bg-surface-bright transition-colors text-on-surface hover:text-primary flex items-center justify-between w-full"
              >
                Settings
                <Icon className="app-icon text-[16px]" name="settings" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
