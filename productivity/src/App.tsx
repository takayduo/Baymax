import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Classification from './pages/Classification';
import Insights from './pages/Insights';
import FocusMode from './pages/FocusMode';
import Settings from './pages/Settings';

export default function App() {
  useEffect(() => { document.documentElement.classList.add('dark'); }, []);

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
