import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import ProfilePage from './components/ProfilePage';
import AccountPage from './components/AccountPage';
import DiscoverPage from './components/DiscoverPage';
import VideoPermalinkPage from './components/VideoPermalinkPage';
import HashtagPage from './components/HashtagPage';
import AuthGate from './components/AuthGate';
import RequireConsumerAuth from './components/RequireConsumerAuth';
import TermsPage from './components/legal/TermsPage';
import PrivacyPage from './components/legal/PrivacyPage';
import DmcaPage from './components/legal/DmcaPage';
import AdminApp from './admin/AdminApp';
import RouteSeo from './RouteSeo';
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
        <RouteSeo />
        <Routes>
          {/* Admin dashboard. Owns its own auth provider, so the consumer app
              never loads or calls anything admin-related. The old /admin
              URLs keep working by redirecting. */}
          <Route path="/const/admin/*" element={<AdminApp />} />
          <Route path="/admin/*" element={<Navigate to="/const/admin" replace />} />
          {/* Reachable unconditionally, authed or not — resetting a
              password is a valid thing to do even while already signed
              in on this particular browser (e.g. suspected compromise),
              and a person arriving from the emailed link is by
              definition not signed in here yet. */}
          <Route path="/reset-password" element={<AuthGate onAuthenticated={() => window.location.assign('/')} />} />
          {/* Legal pages — reachable outside the login gate too, same
              reasoning as /reset-password: a prospective user should be
              able to read these before signing up, not only after. */}
          {/* Shared video links (the mobile app's Share button points here) —
              anyone with the link can watch without an account; liking and
              commenting still need one, and the page says so. */}
          <Route path="/v/:id" element={<VideoPermalinkPage />} />
          <Route path="/legal/terms" element={<TermsPage />} />
          <Route path="/legal/privacy" element={<PrivacyPage />} />
          <Route path="/legal/dmca" element={<DmcaPage />} />
          <Route
            path="/*"
            element={
              <RequireConsumerAuth>
                <Routes>
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/discover" element={<DiscoverPage />} />
                  <Route path="/u/:handle" element={<AccountPage />} />
                  <Route path="/tag/:tag" element={<HashtagPage />} />
                  <Route path="/*" element={<App />} />
                </Routes>
              </RequireConsumerAuth>
            }
          />
        </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
