import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';

/** Tiny external-store helper so components can subscribe with useSyncExternalStore. */
function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => T)) {
      state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

// ---------------------------------------------------------------- profile
export interface ProfileState {
  avatar: string | null;
  displayName: string | null;
  handle: string | null;
  bio: string | null;
  loaded: boolean;
}

export const profileStore = createStore<ProfileState>({ avatar: null, displayName: null, handle: null, bio: null, loaded: false });

let profileLoading: Promise<void> | null = null;

/** Idempotent — loads the signed-in account's profile once. */
export function ensureProfileLoaded(force = false): void {
  if ((profileStore.get().loaded && !force) || profileLoading) return;
  profileLoading = api
    .getProfile()
    .then((res) => profileStore.set({ avatar: res.avatar, displayName: res.displayName, handle: res.handle, bio: res.bio, loaded: true }))
    .catch(() => profileStore.set({ loaded: true }))
    .finally(() => {
      profileLoading = null;
    });
}

export function clearProfile() {
  profileStore.set({ avatar: null, displayName: null, handle: null, bio: null, loaded: false });
}

// ------------------------------------------------------------------ sound
const MUTE_KEY = 'piitrade_muted';
// Feeds autoplay muted; the viewer's explicit choice (persisted) wins afterwards.
export const mutedStore = createStore<{ muted: boolean }>({ muted: false });

export async function hydrateMuted(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(MUTE_KEY);
    if (raw !== null) mutedStore.set({ muted: raw === 'true' });
  } catch {
    // keep default
  }
}

export function setMuted(muted: boolean) {
  mutedStore.set({ muted });
  AsyncStorage.setItem(MUTE_KEY, String(muted)).catch(() => {});
}

// --------------------------------------------------------- recent searches
const RECENT_KEY = 'piitrade_recent_searches';

export async function getRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function addRecentSearch(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  const existing = (await getRecentSearches()).filter((s) => s.toLowerCase() !== q.toLowerCase());
  AsyncStorage.setItem(RECENT_KEY, JSON.stringify([q, ...existing].slice(0, 10))).catch(() => {});
}
