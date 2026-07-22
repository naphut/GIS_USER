import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import DashboardLayout from './components/layouts/DashboardLayout';
import LoginPage from './components/auth/LoginPage';

function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('gis_logged_in_user');
      if (savedUser) {
        setUser(JSON.parse(savedUser));
      }
    } catch (e) {
      console.error('Failed to read user session:', e);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-indigo-300 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400"></div>
          <span className="text-xs font-bold uppercase tracking-wider">Loading Session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoginSuccess={setUser} />;
  }

  const handleLogout = () => {
    try {
      localStorage.removeItem('gis_logged_in_user');
    } catch (e) {
      console.error('Failed to clear user session:', e);
    }
    setUser(null);
  };

  return (
    <Router>
      <Routes>
        <Route path="/*" element={<DashboardLayout user={user} onLogout={handleLogout} />} />
      </Routes>
    </Router>
  );
}

export default App;
