import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell, { RequireAuth } from './components/AppShell.jsx';
import Landing from './pages/Landing.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Assessment from './pages/Assessment.jsx';
import Results from './pages/Results.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Accessibility from './pages/Accessibility.jsx';
import AITools from './pages/AITools.jsx';
import Profile from './pages/Profile.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      {/* full-page screens from the design (no sidebar) */}
      <Route path="/assessment" element={<RequireAuth><Assessment /></RequireAuth>} />
      <Route path="/results" element={<RequireAuth><Results /></RequireAuth>} />
      {/* app screens with the Dashboard sidebar */}
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/accessibility" element={<Accessibility />} />
        <Route path="/ai-tools" element={<AITools />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
