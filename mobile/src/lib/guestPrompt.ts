/**
 * When to ask a guest to sign in — the same rule as the website (frontend/src/guestPrompt.ts), driven by the
 * same admin-managed numbers (Admin → Site & app settings). Only real watch time counts and each gap is
 * `backoff` × the previous one, so the prompt never nags.
 */
export interface PromptConfig {
  enabled: boolean;
  firstAfterSeconds: number;
  baseGapSeconds: number;
  backoff: number;
  maxPerSession: number;
  autoHideSeconds: number;
}

export interface PromptState {
  seconds: number;
  shown: number;
  nextAt: number | null;
}

export const initialPromptState = (): PromptState => ({ seconds: 0, shown: 0, nextAt: null });

/** One second of watching → the new state and whether to show the prompt now. */
export function tickPrompt(state: PromptState, cfg: PromptConfig): { state: PromptState; show: boolean } {
  const seconds = state.seconds + 1;
  const nextAt = state.nextAt ?? cfg.firstAfterSeconds;
  if (cfg.enabled && seconds >= nextAt && state.shown < cfg.maxPerSession) {
    const shown = state.shown + 1;
    return { state: { seconds, shown, nextAt: seconds + cfg.baseGapSeconds * Math.pow(cfg.backoff, shown - 1) }, show: true };
  }
  return { state: { seconds, shown: state.shown, nextAt }, show: false };
}

/** -1 / 0 / 1 for dotted numeric versions ("1.10.0" > "1.9.2"); a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
