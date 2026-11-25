// Pure (no React Native imports) so it can be unit-tested under plain Node.

export type UploadStatusReply<V> = { status: 'done'; video: V } | { status: 'processing' } | { status: 'unknown' };

export interface PollOptions {
  intervalMs?: number;
  /** Give up after this long in total. */
  maxMs?: number;
  /** How long "unknown" is tolerated before the server has ever reported the upload (it may still be arriving). */
  graceMs?: number;
  /** Test hooks. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * After an upload's connection died with the whole file already sent, asks the server what became of it
 * instead of re-uploading hundreds of MB. Resolves with the video once it exists, or null when the server
 * has stopped working on it (or never heard of it). Network errors while asking just mean "ask again".
 */
export async function pollUploadStatus<V>(check: () => Promise<UploadStatusReply<V>>, opts: PollOptions = {}): Promise<V | null> {
  const interval = opts.intervalMs ?? 5000;
  const maxMs = opts.maxMs ?? 10 * 60 * 1000;
  const graceMs = opts.graceMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;

  const started = now();
  let seenProcessing = false;
  let unknownAfterProcessing = 0;
  while (now() - started < maxMs) {
    let reply: UploadStatusReply<V> | null = null;
    try {
      reply = await check();
    } catch {
      reply = null; // couldn't reach the server this time; keep asking until the deadline
    }
    if (reply?.status === 'done') return reply.video;
    if (reply?.status === 'processing') {
      seenProcessing = true;
      unknownAfterProcessing = 0;
    } else if (reply?.status === 'unknown') {
      if (seenProcessing) {
        // It was being processed and now it's neither saved nor in progress: the encode failed.
        if (++unknownAfterProcessing >= 2) return null;
      } else if (now() - started >= graceMs) {
        return null;
      }
    }
    await sleep(interval);
  }
  return null;
}
