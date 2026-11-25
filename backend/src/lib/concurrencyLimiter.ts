/**
 * Limits how many async jobs run at once; the rest wait their turn, first come first served.
 * Used to cap simultaneous ffmpeg encodes: more than a small server can feed just makes every one of them
 * slower and risks running out of memory.
 */
export interface Limiter {
  /** Runs `job` as soon as a slot is free. A failing job still frees its slot. */
  run<T>(job: () => Promise<T>): Promise<T>;
  /** Jobs running right now. */
  readonly active: number;
  /** Jobs waiting for a slot. */
  readonly queued: number;
}

export function createLimiter(maxConcurrent: number): Limiter {
  const max = Math.max(1, Math.floor(maxConcurrent) || 1);
  let active = 0;
  const waiting: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < max) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release(): void {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else active--;
  }

  return {
    async run<T>(job: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await job();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
  };
}
