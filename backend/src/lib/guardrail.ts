import { hashId } from './attribution';

/**
 * Viewing guardrail: statistics for "do product tags hurt watch time?".
 *
 * Observational comparisons ("tagged videos vs untagged videos") are confounded — creators choose what
 * to tag. So a small share of viewers (the hold-out) is deterministically NOT shown tags, and their
 * watch-through on the same tagged videos is compared against everyone else's. Random assignment makes
 * that comparison causal.
 */

export type Cohort = 'exposed' | 'holdout' | 'untagged';

/** % of viewers who don't see tags. 0 turns the experiment off. */
export function holdoutPct(): number {
  const n = Number(process.env.CHIP_HOLDOUT_PCT ?? 5);
  return Number.isFinite(n) ? Math.min(50, Math.max(0, n)) : 5;
}

/** Stable per viewer (the same session is always in the same group) and not guessable from the raw id. */
export function inHoldout(sessionId: string, pct: number = holdoutPct()): boolean {
  if (!sessionId || sessionId === 'anonymous' || pct <= 0) return false;
  const bucket = parseInt(hashId(`holdout:${sessionId}`).slice(0, 8), 16) % 10_000;
  return bucket < pct * 100;
}

export interface CohortSums {
  sessions: number;
  completions: number;
  sumWatchMs: number;
  sumFrac: number;
  sumFracSq: number;
}

export interface CohortSummary {
  sessions: number;
  /** Mean share of the video watched (0..1, each session capped at 1). */
  watchThrough: number;
  /** Sample standard deviation of watch-through. */
  sd: number;
  /** Share of sessions that watched ≥ 90%. */
  completionRate: number;
  avgWatchSec: number;
}

export const COMPLETION_THRESHOLD = 0.9;

export function summarize(c: CohortSums): CohortSummary {
  const n = c.sessions;
  if (n <= 0) return { sessions: 0, watchThrough: 0, sd: 0, completionRate: 0, avgWatchSec: 0 };
  const mean = c.sumFrac / n;
  const variance = n > 1 ? Math.max(0, (c.sumFracSq - n * mean * mean) / (n - 1)) : 0;
  return { sessions: n, watchThrough: mean, sd: Math.sqrt(variance), completionRate: c.completions / n, avgWatchSec: c.sumWatchMs / n / 1000 };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26), accurate to ~1e-7. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

export type Verdict = 'insufficient_data' | 'no_harm' | 'harm' | 'benefit';

export interface Comparison {
  verdict: Verdict;
  /** exposed − holdout, in watch-through (e.g. −0.02 = tags cost 2 points of the video watched). */
  deltaWatchThrough: number;
  /** 95% confidence interval for that difference. */
  ci95: [number, number];
  deltaCompletion: number;
  /** Two-sided p-value for the watch-through difference (Welch). */
  pValue: number;
  /** Sessions needed per group before a verdict is given. */
  minSessions: number;
}

export const MIN_SESSIONS_PER_GROUP = 200;
/** A drop smaller than this isn't treated as harm even if "significant" (huge samples make tiny differences significant). */
export const MATERIAL_DROP = 0.01;

/**
 * exposed vs holdout. The verdict only says "harm" when the drop is BOTH statistically significant
 * and big enough to matter; with too little data it says so instead of guessing.
 */
export function compare(exposed: CohortSummary, holdout: CohortSummary, minSessions: number = MIN_SESSIONS_PER_GROUP): Comparison {
  const delta = exposed.watchThrough - holdout.watchThrough;
  const deltaCompletion = exposed.completionRate - holdout.completionRate;
  if (exposed.sessions < minSessions || holdout.sessions < minSessions) {
    return { verdict: 'insufficient_data', deltaWatchThrough: delta, ci95: [NaN, NaN], deltaCompletion, pValue: NaN, minSessions };
  }
  const se = Math.sqrt((exposed.sd * exposed.sd) / exposed.sessions + (holdout.sd * holdout.sd) / holdout.sessions);
  const z = se > 0 ? delta / se : 0;
  const pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : 1;
  const ci95: [number, number] = [delta - 1.96 * se, delta + 1.96 * se];
  let verdict: Verdict = 'no_harm';
  if (pValue < 0.05 && delta <= -MATERIAL_DROP) verdict = 'harm';
  else if (pValue < 0.05 && delta >= MATERIAL_DROP) verdict = 'benefit';
  return { verdict, deltaWatchThrough: delta, ci95, deltaCompletion, pValue, minSessions };
}

// ---------- events ----------
export const MAX_EVENTS_PER_REQUEST = 50;

export type RawEvent = { type: 'watch'; videoId: string; watchedMs: number; durationMs?: number } | { type: 'chip'; videoId: string; productId: string };

/** Keeps the well-formed events from a client batch and silently drops the rest (analytics must never fail a request). */
export function parseEvents(body: unknown): RawEvent[] {
  const list = Array.isArray((body as any)?.events) ? (body as any).events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
  const out: RawEvent[] = [];
  for (const e of list) {
    const videoId = typeof e?.videoId === 'string' ? e.videoId.slice(0, 64) : '';
    if (!videoId) continue;
    if (e.type === 'watch') {
      const watchedMs = Number(e.watchedMs);
      if (!Number.isFinite(watchedMs) || watchedMs < 0) continue;
      const durationMs = Number(e.durationMs);
      out.push({ type: 'watch', videoId, watchedMs: Math.min(watchedMs, 6 * 60 * 60 * 1000), durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined });
    } else if (e.type === 'chip' && typeof e.productId === 'string' && e.productId) {
      out.push({ type: 'chip', videoId, productId: e.productId.slice(0, 64) });
    }
  }
  return out;
}

export interface WatchFacts {
  frac: number;
  completed: boolean;
  watchMs: number;
}

/** Share of the video watched (capped at 1 — looping shouldn't read as >100%), from the server's own duration when known. */
export function watchFacts(watchedMs: number, serverDurationSec: number | null, clientDurationMs?: number): WatchFacts | null {
  const durationMs = serverDurationSec && serverDurationSec > 0 ? serverDurationSec * 1000 : clientDurationMs;
  if (!durationMs || durationMs <= 0) return null;
  const frac = Math.min(1, watchedMs / durationMs);
  return { frac, completed: frac >= COMPLETION_THRESHOLD, watchMs: Math.round(Math.min(watchedMs, durationMs * 20)) };
}

export function utcDay(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
