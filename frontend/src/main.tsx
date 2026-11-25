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
import SignInDialog from './components/SignInDialog';
import PartnersPage from './components/PartnersPage';
import TermsPage from './components/legal/TermsPage';
import PrivacyPage from './components/legal/PrivacyPage';
import DmcaPage from './components/legal/DmcaPage';
import AdminApp from './admin/AdminApp';
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
          {/* Legal pages — a prospective user can read these before signing up. */}
          {/* Shared video links (the mobile app's Share button points here) —
              anyone with the link can watch without an account; liking and
              commenting still need one, and the page says so. */}
          <Route path="/v/:id" element={<VideoPermalinkPage />} />
          {/* Partner onboarding — public: a shop applies with its listing API and checks the result here. */}
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/legal/terms" element={<TermsPage />} />
          <Route path="/legal/privacy" element={<PrivacyPage />} />
          <Route path="/legal/dmca" element={<DmcaPage />} />
          {/* Everyone can watch without an account (the whole point is to send viewers on to Piitrade and its
              partners). Writes — like, comment, follow, upload — are refused by the server for guests with
              401 SIGN_IN_REQUIRED, and SignInDialog (below) turns that into a sign-in prompt. */}
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/u/:handle" element={<AccountPage />} />
          <Route path="/tag/:tag" element={<HashtagPage />} />
          <Route path="/*" element={<App />} />
        </Routes>
        <SignInDialog />
    </BrowserRouter>
  </React.StrictMode>
);
