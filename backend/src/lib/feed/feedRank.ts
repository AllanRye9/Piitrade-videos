/**
 * Ranking for the Trending feed. Engagement over age (a "hot" score) with a small
 * boost for videos that actually sell, so creators whose videos convert surface more.
 */
export interface RankInput {
  likes: number;
  comments: number;
  shares: number;
  views: number;
  createdAt: Date;
  clicks: number;
  conversions: number;
}

/** Assumed conversion rate for a video with no data yet, and how many clicks that assumption is worth. */
export const PRIOR_RATE = 0.02;
export const PRIOR_WEIGHT = 20;
export const MAX_BOOST = 0.5;
export const MAX_PENALTY = 0.2;

/** Bayesian-smoothed conversion rate: with few clicks it stays near the prior, so one lucky sale can't dominate (cold start). */
export function smoothedConversionRate(clicks: number, conversions: number): number {
  return (conversions + PRIOR_RATE * PRIOR_WEIGHT) / (clicks + PRIOR_WEIGHT);
}

/** Multiplier applied to the base score: 1 at the prior rate, up to +50% for strong sellers, down to −20% for videos that get clicks but never sell. */
export function conversionMultiplier(clicks: number, conversions: number): number {
  const delta = (smoothedConversionRate(clicks, conversions) - PRIOR_RATE) * 10;
  return 1 + Math.min(MAX_BOOST, Math.max(-MAX_PENALTY, delta));
}

export function scoreVideo(v: RankInput, now = Date.now()): number {
  const ageHours = Math.max(0, (now - v.createdAt.getTime()) / 3_600_000);
  const base = (v.likes * 2 + v.comments * 3 + v.shares * 4 + v.views * 0.1) / Math.pow(ageHours + 2, 1.5);
  return base * conversionMultiplier(v.clicks, v.conversions);
}
