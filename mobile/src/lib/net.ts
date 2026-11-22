// Pure (no React Native imports) so it can be unit-tested under plain Node.

/** How long to wait for the server to start answering before giving up. */
export const REQUEST_TIMEOUT_MS = 20_000;

export const TIMEOUT_MESSAGE = 'The server is taking too long to respond. Check your connection and try again.';
export const OFFLINE_MESSAGE = 'Can’t reach the server. Check your connection and try again.';

/** The request never got an answer: no connection (`offline`) or no reply in time (`timeout`). */
export class NetworkError extends Error {
  readonly kind: 'offline' | 'timeout';
  constructor(kind: 'offline' | 'timeout') {
    super(kind === 'timeout' ? TIMEOUT_MESSAGE : OFFLINE_MESSAGE);
    this.name = 'NetworkError';
    this.kind = kind;
  }
}

export const isNetworkError = (e: unknown): e is NetworkError => e instanceof NetworkError;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * fetch() with a deadline and human error messages.
 *
 * Without this, a stalled mobile connection (very common between cell towers or on captive Wi-Fi)
 * never rejects, so every screen sat on its spinner forever; and a plain offline failure surfaced as
 * React Native's raw "Network request failed". A caller-supplied `signal` still works: if the caller
 * cancels on purpose, that abort is passed through untouched rather than reported as a timeout.
 */
export async function fetchWithTimeout(fetchFn: FetchLike, url: string, init: RequestInit = {}, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const outer = init.signal ?? undefined;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new NetworkError('timeout');
    if (outer?.aborted) throw err; // the caller cancelled deliberately
    // fetch rejects with a TypeError for DNS failure, no connection, refused, TLS errors…
    if (err instanceof TypeError) throw new NetworkError('offline');
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}
