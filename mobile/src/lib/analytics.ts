import { AppState } from 'react-native';
import { api } from '../api';
import { createEventQueue } from './eventQueue';

export type AnalyticsEvent =
  | { type: 'watch'; videoId: string; watchedMs: number; durationMs?: number }
  | { type: 'chip'; videoId: string; productId: string };

const queue = createEventQueue<AnalyticsEvent>({ send: async (batch) => void (await api.sendEvents(batch)) });

/** Records an event. Never throws, never waits. */
export function track(event: AnalyticsEvent): void {
  try {
    queue.push(event);
  } catch {
    // analytics must never break the app
  }
}

/** Flushes every 10 s while the app is open, and when it goes to the background. Returns a cleanup. */
export function startAnalytics(): () => void {
  const stop = queue.startAutoFlush(10_000);
  const sub = AppState.addEventListener('change', (s) => {
    if (s !== 'active') void queue.flush();
  });
  return () => {
    stop();
    sub.remove();
  };
}
