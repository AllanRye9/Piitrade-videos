import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface Keyframe {
  atMs: number;
  jpeg: Buffer;
}

/** Hard ceiling on frames per request so AI cost per call stays predictable. */
export const MAX_KEYFRAMES = 3;

/** Evenly spaced sample points (20% / 50% / 80% …) inside a clip, in milliseconds. */
export function keyframeTimes(durationSec: number, count: number): number[] {
  const n = Math.max(1, Math.min(MAX_KEYFRAMES, Math.floor(count)));
  if (!(durationSec > 0)) return [0];
  return Array.from({ length: n }, (_, i) => Math.round(durationSec * 1000 * ((i + 1) / (n + 1))));
}

function grab(input: string, atMs: number, outFile: string, width = 640, quality = 4): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .seekInput(atMs / 1000)
      .frames(1)
      // Never wider than the source: `min(width,iw)` keeps a small video from being blown up.
      .outputOptions(['-vf', `scale='min(${width},iw)':-2`, '-q:v', String(quality)])
      .on('end', () => resolve())
      .on('error', reject)
      .save(outFile);
  });
}

/** Extracts up to MAX_KEYFRAMES JPEG frames from a local file or http(s) URL. Temporary files are always removed. */
export async function extractKeyframes(input: string, durationSec: number, count = MAX_KEYFRAMES): Promise<Keyframe[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-'));
  try {
    const out: Keyframe[] = [];
    for (const atMs of keyframeTimes(durationSec, count)) {
      const file = path.join(dir, `${atMs}.jpg`);
      try {
        await grab(input, atMs, file);
        if (fs.existsSync(file)) out.push({ atMs, jpeg: fs.readFileSync(file) });
      } catch (err) {
        console.warn(`[keyframes] frame at ${atMs}ms failed`, err);
      }
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One "screenshot" of a stored video at a given moment, as a JPEG. This is what Find on Piitrade sends to the AI:
 * the app can't screenshot a native video surface (it comes out black), so the server cuts the frame out of the
 * stored file at the position the viewer was watching. Resolves null when no frame could be produced there
 * (position past the end, unreadable file). Temporary files are always removed.
 */
export async function grabFrameJpeg(input: string, atMs: number, width = 960): Promise<Buffer | null> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-'));
  try {
    const file = path.join(dir, 'frame.jpg');
    await grab(input, Math.max(0, atMs), file, width, 3);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  } catch (err) {
    console.warn(`[frame] grab at ${atMs}ms failed`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
