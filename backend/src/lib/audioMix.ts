import { HttpError } from './httpError';

/** Largest audio file accepted for adding to a video. A 30-second clip
 *  never needs more; this stops a full album being uploaded as a "track". */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

/** Highest volume multiplier accepted (the editor offers 0–100%; the
 *  server allows a little headroom for other clients). */
const MAX_VOLUME = 2;
const MIN_AUDIO_LEFT_SECONDS = 0.5;

export interface AudioMix {
  /** Volume of the video's own sound, 0–2 (1 = unchanged). */
  videoVolume: number;
  /** Volume of the added audio, 0–2 (1 = unchanged). */
  audioVolume: number;
  /** Where in the added audio to start, in seconds. */
  audioStart: number;
}

function num(raw: unknown, fallback: number, label: string): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = typeof raw === 'number' ? raw : Number(String(raw));
  if (!Number.isFinite(n)) {
    throw new HttpError(400, `${label} must be a number`, { code: 'INVALID_AUDIO' });
  }
  return n;
}

/**
 * Validates the audio-mix settings sent with an upload. Pure (no I/O) so
 * it can be tested without ffmpeg.
 *
 * `audioDuration` is the measured length of the added audio file; the
 * start point must leave some audio to play.
 */
export function resolveAudioMix(raw: { videoVolume?: unknown; audioVolume?: unknown; audioStart?: unknown }, audioDuration: number): AudioMix {
  const videoVolume = num(raw.videoVolume, 1, 'Original sound volume');
  const audioVolume = num(raw.audioVolume, 1, 'Added audio volume');
  const audioStart = num(raw.audioStart, 0, 'Audio start');

  if (videoVolume < 0 || videoVolume > MAX_VOLUME || audioVolume < 0 || audioVolume > MAX_VOLUME) {
    throw new HttpError(400, 'Volumes must be between 0% and 200%', { code: 'INVALID_AUDIO' });
  }
  if (videoVolume === 0 && audioVolume === 0) {
    throw new HttpError(400, 'Both sounds are at 0% — raise at least one, or remove the added audio', { code: 'INVALID_AUDIO' });
  }
  if (audioStart < 0) {
    throw new HttpError(400, 'Audio start cannot be negative', { code: 'INVALID_AUDIO' });
  }
  if (audioStart > audioDuration - MIN_AUDIO_LEFT_SECONDS) {
    throw new HttpError(400, `Audio start (${Math.round(audioStart)}s) is past the end of the audio (${Math.round(audioDuration)}s)`, {
      code: 'INVALID_AUDIO',
      details: { audioDuration },
    });
  }
  return { videoVolume, audioVolume, audioStart };
}

function vol(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/**
 * Builds the ffmpeg filter graph that puts the added audio (input 1) onto
 * the video (input 0). Output label is always [aout].
 *
 *  - Source has sound and its volume > 0: both are mixed, ending with
 *    the video (`duration=first`); `normalize=0` keeps each at the
 *    level the uploader set instead of ffmpeg halving both.
 *  - Source is silent, or its volume is 0 (the "replace" case): the
 *    added audio alone becomes the sound.
 *
 * The added audio is padded with silence (`apad`) so a track shorter
 * than the clip leaves the rest quiet rather than cutting the video
 * short; the caller always bounds the output length with `-t`.
 */
export function buildAudioFilter(opts: { hasSourceAudio: boolean; videoVolume: number; audioVolume: number }): string {
  const added = `[1:a]volume=${vol(opts.audioVolume)},apad[a1]`;
  if (opts.hasSourceAudio && opts.videoVolume > 0) {
    return [
      `[0:a]volume=${vol(opts.videoVolume)}[a0]`,
      added,
      '[a0][a1]amix=inputs=2:duration=first:normalize=0[aout]',
    ].join(';');
  }
  return `[1:a]volume=${vol(opts.audioVolume)},apad[aout]`;
}
