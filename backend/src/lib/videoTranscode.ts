import ffmpeg from 'fluent-ffmpeg';

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
 *   2. The audio track is always explicitly preserved. Output is
 *      never produced with `-an` (no audio) — if the source has no
 *      audio stream, ffmpeg's own output simply carries none; this
 *      function never strips one that exists.
 *   3. `+faststart` moves the MP4 moov atom to the front of the file,
 *      so playback can begin before the whole file has downloaded
 *      (otherwise large uploads have to fully load before frame 1).
 *
 * Rejects (never resolves) if ffmpeg reports an error, so callers can
 * clean up the source upload and surface a clear error rather than
 * serving a corrupt file.
 */
export function transcodeToMp4(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
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
