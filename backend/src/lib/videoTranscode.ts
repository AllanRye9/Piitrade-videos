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
  console.log(`[VideoTranscode] starting: ${inputPath} -> ${outputPath}`);
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('128k')
      .outputOptions(['-movflags +faststart', '-pix_fmt yuv420p', '-preset veryfast', '-crf 23'])
      .format('mp4')
      .on('end', () => {
        console.log(`[VideoTranscode] finished in ${Date.now() - startedAt}ms: ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`[VideoTranscode] failed after ${Date.now() - startedAt}ms:`, err instanceof Error ? err.message : err);
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * Probes a media file's streams (via ffprobe) and reports whether it
 * carries at least one audio stream.
 *
 * transcodeToMp4() above never strips an audio track that exists (no
 * `-an`, ever) — so if a video ends up silent in the app, the real
 * cause is virtually always that the SOURCE file the uploader recorded
 * had no audio track to begin with (muted screen recording, camera app
 * with mic permission denied, etc), not something this pipeline did.
 * This is run right after every transcode so that case is caught and
 * logged clearly, rather than silently producing a video nobody
 * realizes is soundless until a viewer reports it — see
 * routes/videos.ts, which surfaces this back to the uploader too.
 */
export function probeHasAudio(filePath: string): Promise<boolean> {
  console.log(`[VideoTranscode] probing for an audio stream: ${filePath}`);
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.warn(`[VideoTranscode] ffprobe failed while checking for audio, assuming audio present: ${filePath}:`, err instanceof Error ? err.message : err);
        // Fail open: an unreadable probe shouldn't itself cause a
        // false "no audio" warning to reach the uploader.
        resolve(true);
        return;
      }
      const hasAudio = (metadata.streams || []).some((s) => s.codec_type === 'audio');
      if (hasAudio) {
        console.log(`[VideoTranscode] audio stream present: ${filePath}`);
      } else {
        console.warn(`[VideoTranscode] NO audio stream found — this video will play silently: ${filePath}`);
      }
      resolve(hasAudio);
    });
  });
}
