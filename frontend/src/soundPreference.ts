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

export function getMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
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
