import { prisma } from '../db';
import { HttpError } from './httpError';

/**
 * Site & app settings, edited by admins (Admin → Site & app settings) and read by the web app, the mobile app
 * and the API itself. Stored as ONE JSON document (AppSetting key "site"); anything missing falls back to
 * DEFAULT_SETTINGS, so adding a setting later never needs a migration.
 */
export interface SiteSettings {
  /**
   * Everyone can watch without an account. After they have really been watching for a while a closable
   * "sign in" card appears, then again less and less often (each gap × backoff).
   */
  guestPrompt: {
    enabled: boolean;
    /** Seconds of actual watch time before the first prompt. */
    firstAfterSeconds: number;
    /** Watch-time gap before the 2nd prompt; later gaps are multiplied by `backoff`. */
    baseGapSeconds: number;
    backoff: number;
    /** Most prompts shown in one visit / app session. */
    maxPerSession: number;
    /** The card closes itself after this long if ignored. */
    autoHideSeconds: number;
  };
  /** While on, every write (POST/PUT/PATCH/DELETE) from the public app is refused with 503; watching still works. */
  maintenance: { enabled: boolean; message: string };
  /** A banner shown on web and app. `version` changes whenever the content does, so dismissed banners reappear. */
  announcement: { enabled: boolean; text: string; link: string; level: 'info' | 'success' | 'warning'; version: string };
  /** Switches for parts of the product. */
  features: { signups: boolean; uploads: boolean; comments: boolean; partnerApplications: boolean };
  /** Mobile app version policy: below `minVersion` the app asks for an update and cannot be used. */
  app: { minVersion: string; latestVersion: string; updateUrl: string; updateMessage: string };
}

export const DEFAULT_SETTINGS: SiteSettings = {
  guestPrompt: { enabled: true, firstAfterSeconds: 20, baseGapSeconds: 60, backoff: 1.6, maxPerSession: 5, autoHideSeconds: 12 },
  maintenance: { enabled: false, message: 'We are making improvements and will be back shortly. You can keep watching, but uploads, likes and comments are paused.' },
  announcement: { enabled: false, text: '', link: '', level: 'info', version: '0' },
  features: { signups: true, uploads: true, comments: true, partnerApplications: true },
  app: { minVersion: '', latestVersion: '', updateUrl: '', updateMessage: 'A new version of Piitrade Videos is required to continue.' },
};

const bad = (field: string, why: string) => new HttpError(400, `${field}: ${why}`, { code: 'INVALID_SETTING' });

function num(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw bad(field, `must be a number between ${min} and ${max}`);
  return n;
}
function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw bad(field, 'must be true or false');
  return v;
}
function text(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string') throw bad(field, 'must be text');
  const t = v.trim();
  if (t.length > max) throw bad(field, `must be at most ${max} characters`);
  return t;
}
function url(v: unknown, field: string): string {
  const t = text(v, field, 500);
  if (t && !/^https?:\/\/[^\s]+$/i.test(t) && !/^\/[^\s]*$/.test(t)) throw bad(field, 'must be an http(s) URL or a path starting with /');
  return t;
}
function version(v: unknown, field: string): string {
  const t = text(v, field, 20);
  if (t && !/^\d+(\.\d+){0,3}$/.test(t)) throw bad(field, 'must look like 1.2.3');
  return t;
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Applies a (partial) patch on top of `base` and returns the full, validated settings. Unknown keys are ignored;
 * a known key with a bad value throws a 400 naming it, so a typo never silently half-saves.
 */
export function applySettingsPatch(base: SiteSettings, patch: unknown): SiteSettings {
  if (!isObj(patch)) throw bad('settings', 'must be an object');
  const out: SiteSettings = JSON.parse(JSON.stringify(base));
  const g = patch.guestPrompt;
  if (g !== undefined) {
    if (!isObj(g)) throw bad('guestPrompt', 'must be an object');
    if ('enabled' in g) out.guestPrompt.enabled = bool(g.enabled, 'guestPrompt.enabled');
    if ('firstAfterSeconds' in g) out.guestPrompt.firstAfterSeconds = num(g.firstAfterSeconds, 'guestPrompt.firstAfterSeconds', 3, 3600);
    if ('baseGapSeconds' in g) out.guestPrompt.baseGapSeconds = num(g.baseGapSeconds, 'guestPrompt.baseGapSeconds', 10, 7200);
    if ('backoff' in g) out.guestPrompt.backoff = num(g.backoff, 'guestPrompt.backoff', 1, 5);
    if ('maxPerSession' in g) out.guestPrompt.maxPerSession = Math.round(num(g.maxPerSession, 'guestPrompt.maxPerSession', 0, 50));
    if ('autoHideSeconds' in g) out.guestPrompt.autoHideSeconds = num(g.autoHideSeconds, 'guestPrompt.autoHideSeconds', 3, 120);
  }
  const m = patch.maintenance;
  if (m !== undefined) {
    if (!isObj(m)) throw bad('maintenance', 'must be an object');
    if ('enabled' in m) out.maintenance.enabled = bool(m.enabled, 'maintenance.enabled');
    if ('message' in m) out.maintenance.message = text(m.message, 'maintenance.message', 300);
  }
  const a = patch.announcement;
  if (a !== undefined) {
    if (!isObj(a)) throw bad('announcement', 'must be an object');
    const before = JSON.stringify([base.announcement.enabled, base.announcement.text, base.announcement.link, base.announcement.level]);
    if ('enabled' in a) out.announcement.enabled = bool(a.enabled, 'announcement.enabled');
    if ('text' in a) out.announcement.text = text(a.text, 'announcement.text', 280);
    if ('link' in a) out.announcement.link = url(a.link, 'announcement.link');
    if ('level' in a) {
      if (a.level !== 'info' && a.level !== 'success' && a.level !== 'warning') throw bad('announcement.level', 'must be info, success or warning');
      out.announcement.level = a.level;
    }
    if (out.announcement.enabled && !out.announcement.text) throw bad('announcement.text', 'is required while the announcement is on');
    // New content (or switching it on) must reach people who dismissed the previous one.
    if (before !== JSON.stringify([out.announcement.enabled, out.announcement.text, out.announcement.link, out.announcement.level])) {
      out.announcement.version = String(Date.now());
    }
  }
  const f = patch.features;
  if (f !== undefined) {
    if (!isObj(f)) throw bad('features', 'must be an object');
    for (const k of ['signups', 'uploads', 'comments', 'partnerApplications'] as const) {
      if (k in f) out.features[k] = bool(f[k], `features.${k}`);
    }
  }
  const p = patch.app;
  if (p !== undefined) {
    if (!isObj(p)) throw bad('app', 'must be an object');
    if ('minVersion' in p) out.app.minVersion = version(p.minVersion, 'app.minVersion');
    if ('latestVersion' in p) out.app.latestVersion = version(p.latestVersion, 'app.latestVersion');
    if ('updateUrl' in p) out.app.updateUrl = url(p.updateUrl, 'app.updateUrl');
    if ('updateMessage' in p) out.app.updateMessage = text(p.updateMessage, 'app.updateMessage', 300);
    if (out.app.minVersion && out.app.latestVersion && compareVersions(out.app.minVersion, out.app.latestVersion) > 0) {
      throw bad('app.minVersion', 'cannot be higher than the latest version');
    }
  }
  return out;
}

/** -1 / 0 / 1 — compares dotted numeric versions ("1.10.0" > "1.9.2"); a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Reads the stored document. The announcement version is restored as saved — applying the stored values over the
 *  defaults would otherwise look like a content change and mint a new version on every load. */
function parseStored(raw: string): SiteSettings {
  const doc = JSON.parse(raw);
  const out = applySettingsPatch(DEFAULT_SETTINGS, doc);
  const v = isObj(doc) && isObj(doc.announcement) ? doc.announcement.version : undefined;
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) out.announcement.version = v;
  return out;
}

const KEY = 'site';
const TTL_MS = 15_000;
let cache: { at: number; value: SiteSettings } | null = null;

/** Current settings (cached ~15 s per instance). Never throws: if the table is unreachable the defaults apply. */
export async function getSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = DEFAULT_SETTINGS;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    if (row?.value) value = parseStored(row.value);
  } catch (err) {
    console.error('could not load site settings, using defaults', err);
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function getSettingsRecord(): Promise<{ settings: SiteSettings; updatedAt: Date | null; updatedBy: string }> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const settings = row?.value ? parseStored(row.value) : DEFAULT_SETTINGS;
  return { settings, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? '' };
}

/** Validates `patch` against the stored settings, saves the result, and returns it. */
export async function saveSettings(patch: unknown, adminEmail: string): Promise<SiteSettings> {
  const { settings: current } = await getSettingsRecord();
  const next = applySettingsPatch(current, patch);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(next), updatedBy: adminEmail },
    update: { value: JSON.stringify(next), updatedAt: new Date(), updatedBy: adminEmail },
  });
  cache = { at: Date.now(), value: next };
  return next;
}

export function clearSettingsCache(): void {
  cache = null;
}

/** Which top-level sections differ — for the audit trail ("guestPrompt, maintenance"). */
export function changedSections(a: SiteSettings, b: SiteSettings): string[] {
  return (Object.keys(a) as Array<keyof SiteSettings>).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
