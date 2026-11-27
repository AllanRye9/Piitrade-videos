import type { SiteConfig } from '../../lib/types';

/**
 * When to ask a guest to sign in. Everyone starts by just watching; only real watch time counts, and the
 * prompts back off (each gap is `backoff` × the last) so it never nags. The mobile app uses the same rule
 * (mobile/src/state/AppContext.tsx) with the same admin-managed numbers.
 */
export interface PromptState {
  /** Seconds of watching so far. */
  seconds: number;
  shown: number;
  /** Watch-seconds at which the next prompt is due; null until the first tick. */
  nextAt: number | null;
}

export const initialPromptState = (): PromptState => ({ seconds: 0, shown: 0, nextAt: null });

/** One second of watching. Returns the new state and whether to show the prompt now. */
export function tickPrompt(state: PromptState, cfg: SiteConfig['guestPrompt']): { state: PromptState; show: boolean } {
  const seconds = state.seconds + 1;
  const nextAt = state.nextAt ?? cfg.firstAfterSeconds;
  if (seconds >= nextAt && state.shown < cfg.maxPerSession) {
    const shown = state.shown + 1;
    return { state: { seconds, shown, nextAt: seconds + cfg.baseGapSeconds * Math.pow(cfg.backoff, shown - 1) }, show: true };
  }
  return { state: { seconds, shown: state.shown, nextAt }, show: false };
}
