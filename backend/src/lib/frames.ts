import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Which moments of a clip to look at: evenly spread, at most `max`, roughly one per `everySeconds`. */
export function sampleTimes(durationSeconds: number, max = 4, everySeconds = 5): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const n = Math.max(1, Math.min(max, Math.ceil(durationSeconds / everySeconds)));
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) / n) * durationSeconds * 1000) / 1000);
}

/** Grabs one JPEG frame at `seconds` from a local file or an http(s) URL (ffmpeg reads both). */
export async function extractFrame(input: string, seconds: number): Promise<Buffer> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'frame-'));
  const out = path.join(dir, 'f.jpg');
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(input)
        .seekInput(seconds)
        .frames(1)
        .outputOptions(['-q:v 4', '-vf scale=640:-2'])
        .on('end', () => resolve())
        .on('error', reject)
        .save(out);
    });
    return await fs.promises.readFile(out);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
