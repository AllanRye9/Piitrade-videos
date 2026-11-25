import { useEffect, useRef, useState } from 'react';
import { UserCircle2, X } from 'lucide-react';
import { isSignedIn, requestSignIn, SIGN_IN_REQUIRED_EVENT } from '../api';
import { initialPromptState, tickPrompt, PromptState } from '../guestPrompt';
import { useSiteConfig } from '../siteConfig';

// Kept at module level so moving between screens (feed → profile → feed) doesn't restart the clock.
let promptState: PromptState = initialPromptState();

/**
 * "Enjoying the videos? Sign in…" — a small, closable card shown to signed-out viewers after they have been
 * watching for a while (timing set in Admin → Site & app settings), then again less and less often. It floats
 * above the feed, never blocks it, hides itself if ignored, and counts only while the tab is visible.
 */
export default function GuestNudge() {
  const { guestPrompt } = useSiteConfig();
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  visibleRef.current = visible;

  useEffect(() => {
    if (!guestPrompt.enabled || isSignedIn()) return;
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible' || visibleRef.current || isSignedIn()) return;
      const r = tickPrompt(promptState, guestPrompt);
      promptState = r.state;
      if (r.show) setVisible(true);
    }, 1000);
    return () => clearInterval(tick);
  }, [guestPrompt]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), guestPrompt.autoHideSeconds * 1000);
    return () => clearTimeout(t);
  }, [visible, guestPrompt.autoHideSeconds]);

  // The sign-in dialog opening for any other reason (a like, an upload) makes this card redundant.
  useEffect(() => {
    const hide = () => setVisible(false);
    window.addEventListener(SIGN_IN_REQUIRED_EVENT, hide);
    return () => window.removeEventListener(SIGN_IN_REQUIRED_EVENT, hide);
  }, []);

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
      <div role="alert" className="animate-sheet-in pointer-events-auto w-full max-w-sm flex items-start gap-3 rounded-2xl bg-neutral-900/95 border border-white/10 p-4 shadow-2xl shadow-black/60 backdrop-blur">
        <span className="shrink-0 w-10 h-10 rounded-full bg-brand-amber/15 flex items-center justify-center text-brand-amber">
          <UserCircle2 size={24} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">Enjoying the videos?</p>
          <p className="text-white/60 text-xs mt-0.5 leading-snug">Sign in to like, comment, follow creators and upload your own.</p>
          <div className="mt-3 flex items-center gap-4">
            <button type="button" onClick={() => { setVisible(false); requestSignIn(); }} className="h-8 px-4 rounded-full bg-brand-orange text-white text-xs font-bold">
              Sign in
            </button>
            <button type="button" onClick={() => setVisible(false)} className="text-white/60 text-xs font-semibold">
              Maybe later
            </button>
          </div>
        </div>
        <button type="button" onClick={() => setVisible(false)} aria-label="Dismiss" className="shrink-0 -mt-1 -mr-1 w-8 h-8 flex items-center justify-center text-white/50">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
