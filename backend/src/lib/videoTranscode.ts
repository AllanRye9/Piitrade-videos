import ffmpeg from 'fluent-ffmpeg';
import { buildAudioFilter } from './audioMix';

/** An audio track that replaces source audio during the transcode. */
export interface AddedAudio {
  path: string;
  /** Where in the audio file to start, in seconds. */
  startSeconds: number;
  audioVolume: number;
}

export interface TranscodeOptions {
  /** Keep only the section starting here (seconds into the source). */
  startSeconds?: number;
  /** Keep at most this many seconds from the start point. */
  durationSeconds?: number;
  /** Replace the video's audio with an uploaded audio track. */
  audio?: AddedAudio;
}

/**
 * Transcodes an uploaded video (whatever container/codec it arrived
 * in — see middleware/upload.ts for the accepted formats) to a
 * normalized H.264 video / AAC audio MP4, so:
 *
 *   1. Every video ever served is guaranteed browser-playable,
 *      regardless of what format the uploader's device produced
 *      (iPhones commonly upload .mov, Android/older devices .3gp,
 *      screen recorders .webm/.mkv, etc — most of these are not
 *      reliably playable via a plain <video> tag as-is).
 *   2. Source audio is preserved unless the uploader supplies a separate
 *      audio track, in which case that track replaces it.
 *   3. `+faststart` moves the MP4 moov atom to the front of the file,
 *      so playback can begin before the whole file has downloaded
 *      (otherwise large uploads have to fully load before frame 1).
 *   4. Optionally cuts the clip to a start/length window — this is how
 *      the 60-second cap is met when an uploader trims a longer video
 *      (see lib/videoLimits.ts). Because the file is re-encoded
 *      anyway, ffmpeg's input-side seek is frame-accurate here, and
 *      timestamps restart at 0 so the stored clip has no leading gap.
 *   5. Optionally replaces the clip's sound with an uploaded audio track,
 *      starting from the selected point and cut to the clip's length by
 *      the same output duration that bounds the video.
 *
 * Rejects (never resolves) if ffmpeg reports an error, so callers can
 * clean up the source upload and surface a clear error rather than
 * serving a corrupt file.
 */
export function transcodeToMp4(inputPath: string, outputPath: string, options: TranscodeOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath);
    if (options.startSeconds && options.startSeconds > 0) command.setStartTime(options.startSeconds);
    if (options.durationSeconds && options.durationSeconds > 0) command.setDuration(options.durationSeconds);

    if (options.audio) {
      const a = options.audio;
      command.input(a.path);
      if (a.startSeconds > 0) command.inputOptions(['-ss', String(a.startSeconds)]);
      command.complexFilter(buildAudioFilter({ audioVolume: a.audioVolume }));
      command.outputOptions(['-map 0:v:0', '-map [aout]']);
    }

    command
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('128k')
      .outputOptions(['-movflags +faststart', '-pix_fmt yuv420p', '-preset veryfast', '-crf 23'])
      .format('mp4')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}
