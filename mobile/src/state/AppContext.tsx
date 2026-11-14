import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';
import type { Video } from '../types';
import { NUDGE } from '../config';
import { bootstrapSession, getAccountEmail, setAccountEmail, setSessionId, resetSessionId } from '../lib/session';
import { clearProfile, ensureProfileLoaded, hydrateMuted, profileStore } from './stores';

// ----------------------------------------------------------------- sheets
export type SheetDescriptor =
  | { type: 'auth'; reason?: string }
  | { type: 'upload' }
  | { type: 'profile' }
  | { type: 'settings' }
  | { type: 'notifications' }
  | { type: 'comments'; video: Video; onCountChange?: (n: number) => void }
  | { type: 'more'; video: Video }
  | { type: 'find'; initialQuery?: string };

// ------------------------------------------------------------------ pages
export type PageDescriptor =
  | { name: 'discover' }
  | { name: 'account'; handle: string }
  | { name: 'tag'; tag: string }
  | { name: 'video'; id: string }
  | { name: 'viewer'; videos: Video[]; index: number; title?: string };

interface AuthResult {
  sessionId: string;
  email: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
}

interface AppContextValue {
  ready: boolean;
  signedIn: boolean;
  email: string | null;
  completeAuth(res: AuthResult): void;
  signOut(): void;

  sheet: SheetDescriptor | null;
  openSheet(s: SheetDescriptor): void;
  closeSheet(): void;
  /** Runs `action` if signed in, otherwise opens the (cancellable) sign-in popup explaining why. */
  requireAuth(reason: string, action?: () => void): boolean;

  pages: PageDescriptor[];
  pushPage(p: PageDescriptor): void;
  popPage(): void;

  unreadCount: number;
  setUnreadCount(n: number): void;

  /** The feed reports whether a video is actually playing — this drives the guest nudge timer. */
  setWatching(watching: boolean): void;
  nudgeVisible: boolean;
  dismissNudge(): void;
  acceptNudge(): void;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

const NUDGE_STATE_KEY = 'piitrade_nudge_seen_once';
const NOTIFICATION_POLL_MS = 30_000;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetDescriptor[]>([]);
  const [pages, setPages] = useState<PageDescriptor[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nudgeVisible, setNudgeVisible] = useState(false);

  const signedIn = !!email;

  // Boot: load session + persisted prefs before the first render of the feed.
  useEffect(() => {
    (async () => {
      await Promise.all([bootstrapSession(), hydrateMuted()]);
      setEmail(getAccountEmail());
      setReady(true);
    })();
  }, []);

  // Load the account profile once signed in.
  useEffect(() => {
    if (ready && signedIn) ensureProfileLoaded(true);
  }, [ready, signedIn]);

  // Unread badge poll — signed-in only (guests have no notifications).
  useEffect(() => {
    if (!ready || !signedIn) {
      setUnreadCount(0);
      return;
    }
    const refresh = () =>
      api
        .getNotifications()
        .then((res) => setUnreadCount(res.unreadCount))
        .catch(() => {});
    refresh();
    const t = setInterval(refresh, NOTIFICATION_POLL_MS);
    return () => clearInterval(t);
  }, [ready, signedIn]);

  const completeAuth = useCallback((res: AuthResult) => {
    setSessionId(res.sessionId);
    setAccountEmail(res.email);
    profileStore.set({ displayName: res.displayName, handle: res.handle, avatar: res.avatar, bio: res.bio, loaded: true });
    setEmail(res.email);
    setNudgeVisible(false);
    setSheets([]); // close the auth popup (and anything under it)
  }, []);

  const signOut = useCallback(() => {
    setAccountEmail(null);
    resetSessionId();
    clearProfile();
    setEmail(null);
    setSheets([]);
    setPages([]);
    setUnreadCount(0);
  }, []);

  const openSheet = useCallback((s: SheetDescriptor) => setSheets((cur) => [...cur, s]), []);
  const closeSheet = useCallback(() => setSheets((cur) => cur.slice(0, -1)), []);

  const requireAuth = useCallback(
    (reason: string, action?: () => void) => {
      if (signedIn) {
        action?.();
        return true;
      }
      setNudgeVisible(false);
      setSheets((cur) => [...cur, { type: 'auth', reason }]);
      return false;
    },
    [signedIn]
  );

  const pushPage = useCallback((p: PageDescriptor) => setPages((cur) => [...cur, p]), []);
  const popPage = useCallback(() => setPages((cur) => cur.slice(0, -1)), []);

  // Android hardware back: sheets are handled by their own Modal; pages pop here.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheets.length > 0) return false; // the Modal's onRequestClose closes it
      if (pages.length > 0) {
        setPages((cur) => cur.slice(0, -1));
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [sheets.length, pages.length]);

  // ------------------------------------------------------- guest nudges
  const watchingRef = useRef(false);
  const watchSecondsRef = useRef(0);
  const nudgesShownRef = useRef(0);
  const nextAtRef = useRef<number>(NUDGE.firstAfterSeconds);
  const blockedRef = useRef(false);
  blockedRef.current = sheets.length > 0 || nudgeVisible;

  const setWatching = useCallback((w: boolean) => {
    watchingRef.current = w;
  }, []);

  useEffect(() => {
    if (!ready || signedIn) {
      setNudgeVisible(false);
      return;
    }
    // Reset the schedule whenever the viewer becomes a guest (app start or sign-out).
    watchSecondsRef.current = 0;
    nudgesShownRef.current = 0;
    nextAtRef.current = NUDGE.firstAfterSeconds;

    const tick = setInterval(() => {
      // Only real watch time counts, and never while another popup is up.
      if (!watchingRef.current || blockedRef.current) return;
      watchSecondsRef.current += 1;
      if (watchSecondsRef.current >= nextAtRef.current && nudgesShownRef.current < NUDGE.maxPerSession) {
        nudgesShownRef.current += 1;
        const gap = NUDGE.baseGapSeconds * Math.pow(NUDGE.backoff, nudgesShownRef.current - 1);
        nextAtRef.current = watchSecondsRef.current + gap;
        setNudgeVisible(true);
        AsyncStorage.setItem(NUDGE_STATE_KEY, '1').catch(() => {});
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [ready, signedIn]);

  const dismissNudge = useCallback(() => setNudgeVisible(false), []);
  const acceptNudge = useCallback(() => {
    setNudgeVisible(false);
    setSheets((cur) => [...cur, { type: 'auth', reason: 'Create a free account to like, comment, follow and upload.' }]);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      signedIn,
      email,
      completeAuth,
      signOut,
      sheet: sheets.length ? sheets[sheets.length - 1] : null,
      openSheet,
      closeSheet,
      requireAuth,
      pages,
      pushPage,
      popPage,
      unreadCount,
      setUnreadCount,
      setWatching,
      nudgeVisible,
      dismissNudge,
      acceptNudge,
    }),
    [ready, signedIn, email, completeAuth, signOut, sheets, openSheet, closeSheet, requireAuth, pages, pushPage, popPage, unreadCount, setWatching, nudgeVisible, dismissNudge, acceptNudge]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hook for the shared profile state. */
export function useProfile() {
  return useSyncExternalStore(profileStore.subscribe, profileStore.get);
}
