/**
 * Money is kept in minor units (cents) as integers so sums and commissions are
 * exact. JS numbers are exact for integers up to 2^53, far above any order value.
 */
const MAX_MAJOR = 1_000_000_000_000; // sanity cap on a single order

/** "12.5" / 12.5 → 1250n. Returns null for anything that isn't a finite, positive amount. */
export function toMinor(amount: unknown): bigint | null {
  const n = typeof amount === 'string' ? Number(amount.trim()) : typeof amount === 'number' ? amount : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MAJOR) return null;
  return BigInt(Math.round(n * 100));
}

/** Commission owed on an order: amount × pct%, rounded to the nearest minor unit. pct is clamped to 0–100. */
export function commissionMinor(amountMinor: bigint, pct: number): bigint {
  const p = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  return BigInt(Math.round((Number(amountMinor) * p) / 100));
}

/** 123456n → 1234.56 (for display / JSON; safe because values stay below 2^53). */
export function fromMinor(minor: bigint | number): number {
  return Number(minor) / 100;
}
