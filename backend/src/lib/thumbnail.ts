import ffmpeg from 'fluent-ffmpeg';
import path from 'path';

/**
 * Extracts a real poster frame (at ~1s, or 10% into short clips) from an
 * uploaded video using ffmpeg, so uploaded videos get an actual thumbnail
 * instead of a placeholder. Requires the `ffmpeg` binary to be present
 * in the container (installed in backend/Dockerfile).
 */
export function extractPoster(videoPath: string, outDir: string, outFilename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on('end', () => resolve(outFilename))
      .on('error', (err) => reject(err))
      .screenshots({
        count: 1,
        timemarks: ['1'],
        filename: outFilename,
        folder: outDir,
        size: '640x?',
      });
  });
}

export function getVideoDuration(videoPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err || !metadata?.format?.duration) {
        resolve(null);
        return;
      }
      resolve(metadata.format.duration);
    });
  });
}

/** True if the file has at least one audio stream (a silent screen
 *  recording, for example, doesn't) — decides whether an added audio
 *  track is mixed with the original sound or simply becomes the sound. */
export function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      resolve(!err && Boolean(metadata?.streams?.some((s) => s.codec_type === 'audio')));
    });
  });
}

export function posterPath(outDir: string, outFilename: string): string {
  return path.join(outDir, outFilename);
}
