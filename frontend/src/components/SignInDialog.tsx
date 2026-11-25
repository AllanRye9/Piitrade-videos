import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { SIGN_IN_REQUIRED_EVENT } from '../api';
import AuthGate from './AuthGate';

/**
 * Anyone can open the site and watch. The first thing that needs an account (like, comment, follow, upload…)
 * makes the server answer 401 SIGN_IN_REQUIRED; api.ts turns that into SIGN_IN_REQUIRED_EVENT and this dialog
 * asks the person to sign in or sign up — and can always be closed to keep watching.
 *
 * After a successful sign-in the page reloads: the session id changed to the account's, so every screen
 * (likes, saved state, profile) has to be re-read under it.
 */
export default function SignInDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SIGN_IN_REQUIRED_EVENT, show);
    return () => window.removeEventListener(SIGN_IN_REQUIRED_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black overflow-y-auto" role="dialog" aria-modal="true" aria-label="Sign in">
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Close sign-in and keep watching"
        className="tap-target fixed top-3 right-3 z-10 flex items-center justify-center text-white/70 hover:text-white"
      >
        <X size={24} />
      </button>
      <AuthGate onAuthenticated={() => window.location.reload()} />
    </div>
  );
}
