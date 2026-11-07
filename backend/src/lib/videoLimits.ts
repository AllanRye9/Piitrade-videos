import { HttpError } from './httpError';

/**
 * Hard cap on the length of a published video. Piitrade Videos is a
 * short-form companion to the piitrade.com classifieds marketplace —
 * clips are meant to show an item or a seller in a few seconds, not
 * replace a listing's own photos/description.
 */
export const MAX_VIDEO_SECONDS = 30;

/** Shortest clip we'll publish — below this the poster frame (taken at
 *  ~1s) and playback loop stop making sense. */
export const MIN_VIDEO_SECONDS = 1;

// Tolerance for float rounding in client-supplied trim points and for
// the encoder landing a few ms past the requested duration.
const EPSILON = 0.05;

export interface TrimWindow {
  /** Where the kept section starts, in seconds from the beginning of the source. */
  start: number;
  /** How long the kept section is, in seconds. */
  length: number;
  /** True when this differs from simply keeping the whole source. */
  trimmed: boolean;
}

function parseSeconds(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Decides which part of an uploaded video is kept, enforcing the
 * MAX_VIDEO_SECONDS cap. Pure function (no I/O) so it can be unit
 * tested without ffmpeg.
 *
 *  - No trim supplied and the source fits → keep everything.
 *  - No trim supplied and the source is too long → VIDEO_TOO_LONG, so
 *    the client can open its trim editor with the real duration.
 *  - Trim supplied → validated against the real duration. An end past
 *    the end of the source is clamped to it (the client can't always
 *    know the duration — e.g. .mkv/.avi can't be previewed in a
 *    browser — so it asks for "30s from here" and the server fits it).
 *    A window that is still longer than the cap is rejected: the cap
 *    is never silently applied on the uploader's behalf.
 */
export function resolveTrimWindow(duration: number, rawStart?: unknown, rawEnd?: unknown): TrimWindow {
  const startIn = parseSeconds(rawStart);
  const endIn = parseSeconds(rawEnd);
  if (Number.isNaN(startIn) || Number.isNaN(endIn)) {
    throw new HttpError(400, 'Trim points must be numbers of seconds', { code: 'INVALID_TRIM' });
  }

  if (startIn === null && endIn === null) {
    if (duration > MAX_VIDEO_SECONDS + EPSILON) {
      throw tooLong(duration);
    }
    return { start: 0, length: duration, trimmed: false };
  }

  const start = startIn ?? 0;
  if (start < 0) {
    throw new HttpError(400, 'Trim start cannot be negative', { code: 'INVALID_TRIM' });
  }
  if (start >= duration - EPSILON) {
    throw new HttpError(400, `Trim start (${round1(start)}s) is past the end of the video (${round1(duration)}s)`, {
      code: 'INVALID_TRIM',
      details: { duration },
    });
  }

  const end = Math.min(endIn ?? duration, duration);
  const length = end - start;
  if (length < MIN_VIDEO_SECONDS - EPSILON) {
    throw new HttpError(400, `The trimmed video must be at least ${MIN_VIDEO_SECONDS} second long`, { code: 'INVALID_TRIM' });
  }
  if (length > MAX_VIDEO_SECONDS + EPSILON) {
    throw tooLong(length, duration);
  }

  const trimmed = start > EPSILON || end < duration - EPSILON;
  return { start, length: Math.min(length, MAX_VIDEO_SECONDS), trimmed };
}

/** True if an encoded file's measured duration is within the cap (with the encoder tolerance). */
export function withinLimit(seconds: number): boolean {
  return seconds <= MAX_VIDEO_SECONDS + 0.5;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function tooLong(length: number, sourceDuration: number = length): HttpError {
  return new HttpError(
    400,
    `Videos can be at most ${MAX_VIDEO_SECONDS} seconds (this one is ${Math.round(length)}s). Trim it to ${MAX_VIDEO_SECONDS}s or less.`,
    { code: 'VIDEO_TOO_LONG', details: { duration: sourceDuration, maxSeconds: MAX_VIDEO_SECONDS } }
  );
}
