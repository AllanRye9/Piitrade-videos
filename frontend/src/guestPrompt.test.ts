import { describe, expect, it } from 'vitest';
import { initialPromptState, tickPrompt } from './guestPrompt';
import { DEFAULT_CONFIG } from './siteConfig';

const cfg = DEFAULT_CONFIG.guestPrompt;

function run(seconds: number, c = cfg) {
  let state = initialPromptState();
  const shownAt: number[] = [];
  for (let s = 1; s <= seconds; s++) {
    const r = tickPrompt(state, c);
    state = r.state;
    if (r.show) shownAt.push(s);
  }
  return shownAt;
}

describe('guest sign-in prompt schedule', () => {
  it('lets people watch first: nothing before the first threshold, then one prompt at it', () => {
    expect(run(19)).toEqual([]);
    expect(run(20)).toEqual([20]);
  });

  it('backs off: each gap is 1.6x the last (60s, 96s, 153.6s…)', () => {
    const at = run(2000);
    expect(at.slice(0, 3)).toEqual([20, 20 + 60, 20 + 60 + 96]);
  });

  it('never exceeds maxPerSession and respects admin-set numbers', () => {
    expect(run(100000)).toHaveLength(cfg.maxPerSession);
    expect(run(100, { ...cfg, firstAfterSeconds: 45, baseGapSeconds: 10, backoff: 1, maxPerSession: 2 })).toEqual([45, 55]);
    expect(run(1000, { ...cfg, maxPerSession: 0 })).toEqual([]);
  });
});
