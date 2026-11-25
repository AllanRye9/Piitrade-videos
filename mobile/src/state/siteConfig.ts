import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';
import { NUDGE } from '../config';
import type { SiteConfig } from '../types';

/**
 * Admin-managed settings (Admin → Site & app settings) from GET /api/config: when to ask guests to sign in,
 * maintenance, the announcement banner, feature switches and the app version policy. The last answer is cached
 * so a cold start without network still behaves; if the server can't be reached the defaults apply — the
 * app must never stop working because settings couldn't load.
 */
export const DEFAULT_CONFIG: SiteConfig = {
  guestPrompt: { enabled: true, firstAfterSeconds: NUDGE.firstAfterSeconds, baseGapSeconds: NUDGE.baseGapSeconds, backoff: NUDGE.backoff, maxPerSession: NUDGE.maxPerSession, autoHideSeconds: NUDGE.autoHideSeconds },
  maintenance: { enabled: false, message: '' },
  announcement: { enabled: false, text: '', link: '', level: 'info', version: '0' },
  features: { signups: true, uploads: true, comments: true, partnerApplications: true },
  app: { minVersion: '', latestVersion: '', updateUrl: '', updateMessage: '' },
};

const KEY = 'piitrade_site_config';
let current: SiteConfig = DEFAULT_CONFIG;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getSiteConfig = () => current;

/** Reads the cached copy (fast, offline-safe), then asks the server. Safe to call repeatedly (e.g. on foreground). */
export async function refreshSiteConfig(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw && current === DEFAULT_CONFIG) {
      current = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      emit();
    }
  } catch {
    // no cache yet
  }
  try {
    const fresh = await api.getConfig();
    current = { ...DEFAULT_CONFIG, ...fresh };
    emit();
    AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
  } catch {
    // keep what we have
  }
}

export function useSiteConfig(): SiteConfig {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => current
  );
}
