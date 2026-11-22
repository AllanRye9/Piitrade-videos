// Pure (no React Native imports) so it can be unit-tested under plain Node.

export interface EventQueueOptions<T> {
  /** Delivers one batch. Reject to keep the events for the next attempt. */
  send: (batch: T[]) => Promise<void>;
  /** Largest batch per request (the server accepts up to 50). */
  maxBatch?: number;
  /** Oldest events are dropped beyond this, so a long offline stretch can't grow memory without bound. */
  maxBuffer?: number;
}

export interface EventQueue<T> {
  push(event: T): void;
  flush(): Promise<void>;
  size(): number;
  /** Flush every `ms`; returns a stop function. */
  startAutoFlush(ms: number): () => void;
}

/**
 * Buffers analytics events and sends them in batches. Analytics is best-effort and must never get in
 * the way of watching: pushes are synchronous and cheap, sending is fire-and-forget, a failed batch
 * goes back to the front of the queue for the next flush, and only one send is in flight at a time.
 */
export function createEventQueue<T>(opts: EventQueueOptions<T>): EventQueue<T> {
  const maxBatch = opts.maxBatch ?? 20;
  const maxBuffer = opts.maxBuffer ?? 200;
  let buffer: T[] = [];
  let sending = false;

  const cap = () => {
    if (buffer.length > maxBuffer) buffer = buffer.slice(buffer.length - maxBuffer);
  };

  async function flush(): Promise<void> {
    if (sending || buffer.length === 0) return;
    sending = true;
    const batch = buffer.splice(0, maxBatch);
    try {
      await opts.send(batch);
    } catch {
      buffer = [...batch, ...buffer]; // try again next time
      cap();
    } finally {
      sending = false;
    }
  }

  return {
    push(event) {
      buffer.push(event);
      cap();
      if (buffer.length >= maxBatch) void flush();
    },
    flush,
    size: () => buffer.length,
    startAutoFlush(ms) {
      const t = setInterval(() => void flush(), ms);
      return () => clearInterval(t);
    },
  };
}
