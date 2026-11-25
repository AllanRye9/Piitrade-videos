import { HttpError } from './httpError';

/** Largest audio file accepted for adding to a video. A 60-second clip
 *  never needs more; this stops a full album being uploaded as a "track". */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

/** Highest volume multiplier accepted (the editor offers 0–100%; the
 *  server allows a little headroom for other clients). */
const MAX_VOLUME = 2;
const MIN_AUDIO_LEFT_SECONDS = 0.5;

export interface AudioMix {
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
 * start point must leave some audio to play. The legacy `videoVolume`
 * field is accepted but ignored so source audio is always replaced.
 */
export function resolveAudioMix(raw: { videoVolume?: unknown; audioVolume?: unknown; audioStart?: unknown }, audioDuration: number): AudioMix {
  const audioVolume = num(raw.audioVolume, 1, 'Added audio volume');
  const audioStart = num(raw.audioStart, 0, 'Audio start');

  if (audioVolume < 0 || audioVolume > MAX_VOLUME) {
    throw new HttpError(400, 'Added audio volume must be between 0% and 200%', { code: 'INVALID_AUDIO' });
  }
  if (audioVolume === 0) {
    throw new HttpError(400, 'Added audio is at 0% — raise its volume, or remove it', { code: 'INVALID_AUDIO' });
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
  return { audioVolume, audioStart };
}

function vol(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/**
 * Builds the ffmpeg filter graph that replaces source audio with the
 * uploaded audio (input 1). Output label is always [aout].
 *
 * The added audio is padded with silence (`apad`) so a track shorter
 * than the clip leaves the rest quiet rather than cutting the video
 * short; the caller always bounds the output length with `-t`.
 */
export function buildAudioFilter(opts: { audioVolume: number }): string {
  return `[1:a]volume=${vol(opts.audioVolume)},apad[aout]`;
}
