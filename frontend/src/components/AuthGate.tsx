import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, setSessionId, setAccountEmail } from '../api';
import { setProfileDisplayName, setProfileHandle, setProfileAvatar, setProfileBio } from '../profileStore';
import { Loader2, LogIn, UserPlus, ArrowLeft } from 'lucide-react';

type Mode = 'login' | 'signup' | 'forgot' | 'forgot-sent' | 'reset' | 'reset-done';

interface Props {
  onAuthenticated: () => void;
}

// Shown before anything else in the app — see main.tsx's RequireConsumerAuth.
// Signing up here does the same session-adoption dance ProfileSettings used
// to do inline; this is now the ONLY place that happens, since Settings is
// only reachable once already signed in.
export default function AuthGate({ onAuthenticated }: Props) {
  const [searchParams] = useSearchParams();
  const resetToken = searchParams.get('token');

  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login');
  const [identifier, setIdentifier] = useState(''); // email (signup) or email/handle (login, forgot)
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyAuthResult(res: { sessionId: string; email: string; handle: string | null; displayName: string | null; avatar: string | null; bio: string | null }) {
    setSessionId(res.sessionId);
    setAccountEmail(res.email);
    setProfileDisplayName(res.displayName);
    setProfileHandle(res.handle);
    setProfileAvatar(res.avatar);
    setProfileBio(res.bio);
    onAuthenticated();
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(identifier.trim(), password);
      applyAuthResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in');
    } finally {
      setBusy(false);
    }
  }

  async function submitSignup(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.signup(identifier.trim(), password);
      applyAuthResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account');
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(identifier.trim());
      setMode('forgot-sent');
    } catch (err) {
      // The backend always returns success regardless of whether the
      // account exists (see routes/account.ts) — an error here means
      // something actually went wrong (network, rate limit), so it's
      // safe and correct to surface it rather than hide it too.
      setError(err instanceof Error ? err.message : 'Could not send reset email');
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(resetToken || '', password);
      setMode('reset-done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === 'signup' ? 'Create your account' : mode === 'forgot' || mode === 'forgot-sent' ? 'Reset your password' : mode === 'reset' || mode === 'reset-done' ? 'Choose a new password' : 'Log in to Piitrade';

  return (
    <div className="h-dvh w-full bg-black flex items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-pink to-brand-cyan flex items-center justify-center text-white font-extrabold text-2xl">
            P
          </div>
          <h1 className="text-white text-xl font-bold">{title}</h1>
          {mode === 'login' && <p className="text-white/50 text-sm text-center">Shop what you see — log in to continue.</p>}
        </div>

        {error && <p className="text-red-400 text-sm text-center mb-4">{error}</p>}

        {mode === 'login' && (
          <form onSubmit={submitLogin} className="space-y-3">
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Email or username"
              autoComplete="username"
              required
              className="w-full bg-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none placeholder:text-white/40"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
              className="w-full bg-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none placeholder:text-white/40"
            />
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('forgot');
              }}
              className="text-brand-cyan text-xs"
            >
              Forgot password?
            </button>
            <button
              type="submit"
              disabled={busy}
              className="w-full h-12 rounded-lg bg-brand-pink text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
              Log in
            </button>
            <p className="text-white/50 text-sm text-center pt-2">
              New here?{' '}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode('signup');
                }}
                className="text-brand-cyan font-semibold"
              >
                Create an account
              </button>
            </p>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={submitSignup} className="space-y-3">
            <input
              type="email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className="w-full bg-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none placeholder:text-white/40"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 8 characters)"
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full bg-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none placeholder:text-white/40"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full bg-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none placeholder:text-white/40"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full h-12 rounded-lg bg-brand-pink text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              Create account
            </button>
            <p className="text-white/50 text-sm text-center pt-2">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode('login');
                }}
                className="text-brand-cyan font-semibold"
              >
                Log in
              </button>
            </p>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={submitForgot} className="space-y-3">
            <p className="text-white/50 text-sm text-center -mt-2 mb-2">Enter your email or username and we'll send you a reset link.</p>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Email or username"
              autoComplete="username"
              required
              className="w-full bg-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none placeholder:text-white/40"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full h-12 rounded-lg bg-brand-pink text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              Send reset link
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('login');
              }}
              className="w-full text-white/50 text-sm flex items-center justify-center gap-1 pt-1"
            >
              <ArrowLeft size={14} /> Back to log in
            </button>
          </form>
        )}

        {mode === 'forgot-sent' && (
          <div className="text-center space-y-4">
            <p className="text-white/70 text-sm">If an account exists for that email or username, a reset link is on its way. Check your inbox.</p>
            <button type="button" onClick={() => setMode('login')} className="text-brand-cyan text-sm font-semibold">
              Back to log in
            </button>
          </div>
        )}

        {mode === 'reset' && (
          <form onSubmit={submitReset} className="space-y-3">
            {!resetToken && <p className="text-red-400 text-sm text-center">This reset link is missing its token — please use the link from your email.</p>}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 characters)"
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full bg-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none placeholder:text-white/40"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full bg-white/10 text-white text-sm rounded-lg px-4 py-3 outline-none placeholder:text-white/40"
            />
            <button
              type="submit"
              disabled={busy || !resetToken}
              className="w-full h-12 rounded-lg bg-brand-pink text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              Reset password
            </button>
          </form>
        )}

        {mode === 'reset-done' && (
          <div className="text-center space-y-4">
            <p className="text-white/70 text-sm">Your password has been reset. Log in with your new password.</p>
            <button
              type="button"
              onClick={() => {
                setPassword('');
                setConfirmPassword('');
                setMode('login');
              }}
              className="text-brand-cyan text-sm font-semibold"
            >
              Back to log in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
