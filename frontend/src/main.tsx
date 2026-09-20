import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import ProfilePage from './components/ProfilePage';
import AccountPage from './components/AccountPage';
import DiscoverPage from './components/DiscoverPage';
import { AdminAuthProvider } from './admin/AdminAuthContext';
import RequireAdmin from './admin/RequireAdmin';
import AdminLogin from './admin/AdminLogin';
import AdminRegister from './admin/AdminRegister';
import AdminDashboard from './admin/AdminDashboard';
import './styles/index.css';

// Register the app-shell service worker (see public/sw.js) — narrow in
// scope (shell only, never /api or /uploads) so it can't ever serve
// stale video data. Guarded for browsers without SW support rather
// than assumed, since the app must keep working there too.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal — the app works fully without offline/installable
      // support, it just loses that enhancement on this browser.
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AdminAuthProvider>
        <Routes>
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/register" element={<AdminRegister />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminDashboard />
              </RequireAdmin>
            }
          />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/u/:handle" element={<AccountPage />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </AdminAuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
