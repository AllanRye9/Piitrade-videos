/**
 * A single shared mute/unmute preference for the whole feed, instead
 * of each VideoCard keeping its own local `muted` state.
 *
 * Previously every VideoCard initialized `useState(true)` on its own,
 * so unmuting the video you're watching had no effect on the next one
 * you scrolled to — it came in muted again, every time, since
 * VideoFeed mounts multiple VideoCard instances at once (only the
 * active one plays, but they're all mounted). That made "sound" feel
 * broken/absent even though the mute button itself worked.
 *
 * All videos still start muted (required for autoplay in every
 * browser), but the moment the viewer unmutes one, that preference now
 * applies feed-wide and survives reloads via localStorage — matching
 * how TikTok/Reels/Shorts behave.
 */

const STORAGE_KEY = 'piitrade_muted';

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    // localStorage unavailable (private browsing, etc.) — default to
    // muted, which browsers require for autoplay anyway.
    return true;
  }
}

let muted = readInitial();
const listeners = new Set<() => void>();

// Whether the current preference is still just the browser-mandated
// autoplay default, or something the viewer actually chose (by
// tapping the mute icon, or from a prior visit — see readInitial).
// Drives registerFirstInteractionAutoUnmute below: an explicit choice
// is never second-guessed, but a viewer who's never touched the mute
// icon shouldn't have to find and tap that one specific tiny icon
// just to get sound — everything (autoplay policy aside) about a
// TikTok-style feed assumes sound-on, so the first tap/keypress
// anywhere in the app, on a session with no stored preference at all,
// is treated as "I'm engaging with this, give me sound" the same way
// tapping the speaker icon would.
let hasExplicitPreference = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
})();

export function getMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  hasExplicitPreference = true;
  if (muted === value) return;
  muted = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Non-fatal — the preference just won't survive a reload.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let firstInteractionRegistered = false;

/**
 * Call once, near the app root. No-ops if the viewer already has an
 * explicit mute preference (nothing to override) or has already been
 * registered this session. Otherwise, the very next pointer/keyboard
 * interaction anywhere in the app unmutes — a real user gesture, so
 * it satisfies the same browser autoplay-with-sound requirement the
 * mute button itself relies on, it's just no longer gated behind
 * finding that one specific icon first.
 */
export function registerFirstInteractionAutoUnmute(): void {
  if (firstInteractionRegistered || hasExplicitPreference) return;
  firstInteractionRegistered = true;

  const unmuteOnce = () => {
    document.removeEventListener('pointerdown', unmuteOnce);
    document.removeEventListener('keydown', unmuteOnce);
    document.removeEventListener('touchstart', unmuteOnce);
    if (!hasExplicitPreference) setMuted(false);
  };
  document.addEventListener('pointerdown', unmuteOnce, { once: true, passive: true });
  document.addEventListener('keydown', unmuteOnce, { once: true });
  document.addEventListener('touchstart', unmuteOnce, { once: true, passive: true });
}
