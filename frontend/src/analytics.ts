import { api } from './api';

export type AnalyticsEvent =
  | { type: 'watch'; videoId: string; watchedMs: number; durationMs?: number }
  | { type: 'chip'; videoId: string; productId: string };

const BATCH_SIZE = 25;
const MAX_QUEUED = 500;
const pending: AnalyticsEvent[] = [];
let flushing = false;

async function flush(): Promise<void> {
  if (flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending.splice(0, BATCH_SIZE);
  try {
    await api.sendEvents(batch);
  } catch {
    pending.unshift(...batch);
    if (pending.length > MAX_QUEUED) pending.length = MAX_QUEUED;
  } finally {
    flushing = false;
  }
}

export function track(event: AnalyticsEvent): void {
  pending.push(event);
  if (pending.length > MAX_QUEUED) pending.shift();
  if (pending.length >= BATCH_SIZE) void flush();
}

if (typeof window !== 'undefined') {
  window.setInterval(() => void flush(), 10_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  window.addEventListener('pagehide', () => void flush());
}
