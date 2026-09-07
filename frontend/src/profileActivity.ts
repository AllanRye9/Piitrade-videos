/**
 * The backend tracks per-session `liked` / `favorited` / `saved` state
 * against each video already (see api.ts / videos.ts), so the Profile
 * page can source those tabs straight from `GET /api/videos`. It does
 * NOT track "which videos did this session comment on" or "what has
 * this session searched for" — there's no server-side concept of
 * either. Rather than add backend endpoints for what's fundamentally
 * local UI convenience, both are kept in localStorage, the same place
 * the app already keeps its session id and admin token.
 */

const COMMENTED_KEY = 'piitrade_commented_video_ids';
const RECENT_SEARCHES_KEY = 'piitrade_recent_searches';
const MAX_RECENT_SEARCHES = 10;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or unavailable (private browsing in some
    // browsers) — profile history is a nice-to-have, so fail silently
    // rather than breaking the action that triggered it.
  }
}

export function getCommentedVideoIds(): string[] {
  return readJson<string[]>(COMMENTED_KEY, []);
}

export function markVideoCommented(videoId: string) {
  const ids = getCommentedVideoIds();
  if (!ids.includes(videoId)) {
    writeJson(COMMENTED_KEY, [videoId, ...ids].slice(0, 200));
  }
}

export function getRecentSearches(): string[] {
  return readJson<string[]>(RECENT_SEARCHES_KEY, []);
}

export function addRecentSearch(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;
  const existing = getRecentSearches().filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
  writeJson(RECENT_SEARCHES_KEY, [trimmed, ...existing].slice(0, MAX_RECENT_SEARCHES));
}

export function clearRecentSearches() {
  writeJson(RECENT_SEARCHES_KEY, []);
}
