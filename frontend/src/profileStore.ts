import { api } from './api';

/**
 * Shared session profile (avatar + display name), following the same
 * external-store pattern as soundPreference.ts. Without this, each
 * component that wants to show "your" avatar (TopBar, CommentModal,
 * CheckoutModal, ProfilePage) would need its own fetch + local state,
 * and changing your avatar/name in one place wouldn't update any of
 * the others until they happened to re-mount. This way every consumer
 * reads the same state and re-renders the moment it changes.
 */

interface ProfileState {
  avatar: string | null;
  displayName: string | null;
  /** Whether the initial GET /api/profile has resolved (success or failure). */
  loaded: boolean;
}

let state: ProfileState = { avatar: null, displayName: null, loaded: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<ProfileState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

let loadPromise: Promise<void> | null = null;

/** Idempotent — safe to call from every component that needs the profile; only fetches once. */
export function ensureProfileLoaded(): void {
  if (state.loaded || loadPromise) return;
  loadPromise = api
    .getProfile()
    .then((res) => setState({ avatar: res.avatar, displayName: res.displayName, loaded: true }))
    .catch(() => setState({ loaded: true })) // non-fatal — the app works fine with no profile loaded
    .finally(() => {
      loadPromise = null;
    });
}

export function getProfileState(): ProfileState {
  return state;
}

export function subscribeProfile(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setProfileAvatar(avatar: string | null): void {
  setState({ avatar });
}

export function setProfileDisplayName(displayName: string | null): void {
  setState({ displayName });
}
