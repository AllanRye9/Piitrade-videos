import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SiteInfo } from '../types';

/**
 * The connected marketplaces/stores (managed by admins in Admin → Sites).
 * Nothing about which sites exist is hardcoded in the app: the list is fetched
 * once per app run and shared by every screen that needs it.
 */
let cache: SiteInfo[] | null = null;
let inflight: Promise<SiteInfo[]> | null = null;

function load(): Promise<SiteInfo[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .listSites()
      .then((r) => (cache = r.sites))
      .catch(() => [] as SiteInfo[]) // not cached, so a later screen retries
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useSites(): SiteInfo[] {
  const [sites, setSites] = useState<SiteInfo[]>(cache ?? []);
  useEffect(() => {
    let live = true;
    load().then((s) => live && setSites(s));
    return () => {
      live = false;
    };
  }, []);
  return sites;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
