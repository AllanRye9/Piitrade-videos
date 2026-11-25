/**
 * Turns a failed ffmpeg run (or a related I/O failure) into a precise, user-readable cause.
 *
 * Before this, every failure surfaced as "Could not process this video — please upload a valid video
 * file", whatever had actually gone wrong: a damaged file, a codec the server can't read, a full disk,
 * a server out of memory and a timeout all looked identical to the uploader, and the real reason only
 * reached the server console. Pure (no I/O) so it can be unit tested without ffmpeg.
 */

/** Thrown by transcodeToMp4 so callers can see ffmpeg's own diagnostics, not just a one-line message. */
export class TranscodeError extends Error {
  /** The tail of ffmpeg's stderr (where its real error lines are). */
  readonly stderr: string;
  /** True when the run was killed for exceeding the processing time limit. */
  readonly timedOut: boolean;
  constructor(message: string, stderr = '', timedOut = false) {
    super(message);
    this.name = 'TranscodeError';
    this.stderr = stderr;
    this.timedOut = timedOut;
  }
}

export interface MediaFailure {
  status: number;
  /** Machine-readable code the app can branch on. */
  code: string;
  /** What the person sees — states the cause and what to do about it. */
  message: string;
  /** The last meaningful line ffmpeg printed, for support/debugging (never shown as the main message). */
  reason: string | null;
  /** True when the fault is on the server's side rather than the file's, so retrying later can succeed. */
  serverSide: boolean;
}

/** Last non-empty line of ffmpeg's output that looks like an error, trimmed. */
export function lastReason(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const errorish = [...lines].reverse().find((l) => /error|invalid|fail|not found|no such|cannot|unable|unsupported|denied|space|killed/i.test(l));
  return (errorish ?? lines[lines.length - 1]).slice(0, 200);
}

/**
 * Classifies a failed transcode. `withAudio` is true when the upload carried an extra audio track, in
 * which case an otherwise-unclassified failure is blamed on that track first.
 */
export function describeTranscodeFailure(err: unknown, opts: { withAudio?: boolean } = {}): MediaFailure {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const stderr = err instanceof TranscodeError ? err.stderr : '';
  const timedOut = err instanceof TranscodeError && err.timedOut;
  const code = (err as { code?: unknown } | null)?.code;
  const text = `${message}\n${stderr}`.toLowerCase();
  const reason = lastReason(stderr || message);

  const fail = (status: number, failureCode: string, msg: string, serverSide: boolean): MediaFailure => ({ status, code: failureCode, message: msg, reason, serverSide });

  if (timedOut) {
    return fail(504, 'PROCESSING_TIMEOUT', 'Processing this video took too long, so it was stopped. The file is probably very large or very high resolution — trim it to a shorter clip or export it at a lower resolution (1080p is plenty) and try again.', false);
  }
  if (code === 'ENOSPC' || /no space left on device|enospc/.test(text)) {
    return fail(507, 'SERVER_STORAGE_FULL', 'The server has run out of storage space, so your video could not be saved. This is not a problem with your file — please try again later.', true);
  }
  if (code === 'ENOENT' || /cannot find ffmpeg|spawn ffmpeg|ffmpeg: not found|ffmpeg.*enoent/.test(text)) {
    return fail(503, 'SERVER_PROCESSING_UNAVAILABLE', 'Video processing is unavailable on the server right now. This is not a problem with your file — please try again later.', true);
  }
  if (/cannot allocate memory|out of memory|std::bad_alloc|killed with signal sigkill|signal sigkill|\boom\b/.test(text)) {
    return fail(503, 'SERVER_OUT_OF_MEMORY', 'The server ran out of memory while processing this video — it is probably too large or too high resolution. Try a shorter clip or a lower resolution (1080p is plenty).', true);
  }
  if (/moov atom not found|invalid data found when processing input|end of file|truncated|partial file/.test(text)) {
    return fail(422, 'VIDEO_CORRUPT', 'This video file looks damaged or incomplete (it may not have finished saving or downloading). Re-export or re-record it and try again.', false);
  }
  if (/does not contain any stream|no video stream|stream map '0:v:0'|matches no streams/.test(text)) {
    return fail(422, 'NO_VIDEO_STREAM', 'This file has no video in it. Choose a video file.', false);
  }
  if (/unknown encoder|decoder .*not found|unsupported codec|codec not currently supported|could not find codec parameters|unknown decoder/.test(text)) {
    return fail(422, 'UNSUPPORTED_CODEC', 'This video uses a format the server cannot read. Re-export it as a standard MP4 (H.264) and try again.', false);
  }
  if (opts.withAudio) {
    return fail(422, 'AUDIO_FAILED', 'Could not add this audio to the video — the audio file may be damaged or in an unsupported format. Try a different audio file, or post without music.', false);
  }
  return fail(422, 'PROCESSING_FAILED', 'Could not process this video. The file may be damaged or in an unusual format — re-export it as MP4 and try again.', false);
}

/** A short random id that is logged next to ffmpeg's stderr and shown to the user, so a report can be matched to the log. */
export function referenceId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
