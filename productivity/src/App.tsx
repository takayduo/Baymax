import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAppContext } from './context/AppContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Classification from './pages/Classification';
import Insights from './pages/Insights';
import FocusMode from './pages/FocusMode';
import Settings from './pages/Settings';

export default function App() {
  const { settings } = useAppContext();

  useEffect(() => {
    // Default to dark mode if 'system' or not defined
    const isDark = settings.theme === 'dark' || 
                  (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.theme]);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="classification" element={<Classification />} />
          <Route path="insights" element={<Insights />} />
          <Route path="focus" element={<FocusMode />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
