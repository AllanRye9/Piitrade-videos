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

function grab(input: string, atMs: number, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .seekInput(atMs / 1000)
      .frames(1)
      .outputOptions(['-vf', 'scale=640:-2', '-q:v', '4'])
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
