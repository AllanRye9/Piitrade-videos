import { useEffect, useState } from 'react';
import { api } from './api';
import type { SiteConfig } from './types';

/**
 * Admin-managed settings (Admin → Site & app settings), fetched once per page load from GET /api/config.
 * The last answer is kept in localStorage so the next visit starts with the right values instead of defaults,
 * and if the request fails the defaults apply — a settings outage must never stop people watching.
 */
export const DEFAULT_CONFIG: SiteConfig = {
  guestPrompt: { enabled: true, firstAfterSeconds: 20, baseGapSeconds: 60, backoff: 1.6, maxPerSession: 5, autoHideSeconds: 12 },
  maintenance: { enabled: false, message: '' },
  announcement: { enabled: false, text: '', link: '', level: 'info', version: '0' },
  features: { signups: true, uploads: true, comments: true, partnerApplications: true },
  app: { minVersion: '', latestVersion: '', updateUrl: '', updateMessage: '' },
};

const STORE_KEY = 'piitrade_site_config';

function readStored(): SiteConfig | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? ({ ...DEFAULT_CONFIG, ...JSON.parse(raw) } as SiteConfig) : null;
  } catch {
    return null;
  }
}

let current: SiteConfig = readStored() ?? DEFAULT_CONFIG;
let inflight: Promise<SiteConfig> | null = null;
const listeners = new Set<(c: SiteConfig) => void>();

export function getSiteConfig(): SiteConfig {
  return current;
}

export function loadSiteConfig(force = false): Promise<SiteConfig> {
  if (inflight && !force) return inflight;
  inflight = api
    .getConfig()
    .then((c) => {
      current = { ...DEFAULT_CONFIG, ...c };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(current));
      } catch {
        // private mode — fine, just not cached
      }
      listeners.forEach((l) => l(current));
      return current;
    })
    .catch(() => current);
  return inflight;
}

export function useSiteConfig(): SiteConfig {
  const [cfg, setCfg] = useState(current);
  useEffect(() => {
    listeners.add(setCfg);
    loadSiteConfig();
    return () => void listeners.delete(setCfg);
  }, []);
  return cfg;
}
