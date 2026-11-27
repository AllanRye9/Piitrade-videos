import ffmpeg from 'fluent-ffmpeg';

/**
 * The Piitrade frame standard — what every stored video looks like, whatever
 * the uploader's device produced.
 *
 * Why it exists: phones now record 4K (3840×2160) and even 8K. Stored as-is,
 * those files are huge, stall on mobile data, and the player has to scale
 * them down every frame anyway — so they look *worse* in a feed than a clean
 * 1080p encode. The standard fixes the largest frame we keep, never upscales
 * (upscaling only adds blur and bytes), and caps the bitrate in proportion to
 * the frame so quality is spent where it can be seen.
 *
 *   portrait  / square : fit inside 1080 × 1920   (the 9:16 feed size)
 *   landscape          : fit inside 1920 × 1080
 *   both sides even    : H.264 (yuv420p) cannot encode odd dimensions
 *   frame rate         : at most 30 fps
 *   bitrate            : CRF 23 with a ceiling that scales with the frame
 *
 * Keep the numbers in frontend/src/lib/frameStandard.ts (upload preview and
 * the size hint) in step with these; tests/contracts.test.mjs checks it.
 */
export const FRAME_STANDARD = {
  portrait: { maxWidth: 1080, maxHeight: 1920 },
  landscape: { maxWidth: 1920, maxHeight: 1080 },
  maxFps: 30,
  crf: 23,
  /** Bitrate ceiling for a full 1080p frame; smaller frames get a proportional share (never below the floor). */
  maxVideoKbps: 5000,
  minVideoKbps: 1200,
  audioKbps: 128,
} as const;

export interface FrameSize {
  width: number;
  height: number;
}

/** Largest even number ≤ n (and at least 2). */
function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

/** The box a frame of this shape must fit in. Wider-than-tall is landscape; everything else uses the portrait box. */
export function frameBox(width: number, height: number): { maxWidth: number; maxHeight: number } {
  return width > height ? FRAME_STANDARD.landscape : FRAME_STANDARD.portrait;
}

/**
 * The size a source frame is stored at: shrunk to fit the standard box when it
 * is larger, left alone when it already fits, and always made even.
 * `scaled` is true when the result differs from the input, i.e. a scale filter
 * is needed.
 */
export function fitFrame(width: number, height: number): FrameSize & { scaled: boolean } {
  if (!(width > 0) || !(height > 0)) throw new RangeError('Frame dimensions must be positive');
  const box = frameBox(width, height);
  const ratio = Math.min(1, box.maxWidth / width, box.maxHeight / height);
  const w = even(width * ratio);
  const h = even(height * ratio);
  return { width: w, height: h, scaled: w !== width || h !== height };
}

/** Frame-rate cap: the fps to force, or null when the source is already within the standard. */
export function fpsCap(sourceFps: number | null): number | null {
  if (sourceFps === null || !Number.isFinite(sourceFps)) return null;
  return sourceFps > FRAME_STANDARD.maxFps + 0.5 ? FRAME_STANDARD.maxFps : null;
}

/** Bitrate ceiling (kbit/s) for a frame: proportional to its pixel count relative to 1080p. */
export function videoBitrateCeilingKbps(width: number, height: number): number {
  const share = (width * height) / (1920 * 1080);
  const kbps = Math.round(FRAME_STANDARD.maxVideoKbps * share);
  return Math.min(FRAME_STANDARD.maxVideoKbps, Math.max(FRAME_STANDARD.minVideoKbps, kbps));
}

// ---- probing ---------------------------------------------------------------

export interface VideoProbe {
  /** Frame size as people see it: rotation metadata (phones film sideways and tag the file) already applied. */
  width: number;
  height: number;
  /** Average frames per second, when the container reports one. */
  fps: number | null;
  hasAudio: boolean;
  /** Container duration in seconds. */
  duration: number | null;
}

function parseRate(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const [n, d] = raw.split('/').map(Number);
  if (!Number.isFinite(n)) return null;
  const rate = d ? n / d : n;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** Clockwise rotation (0/90/180/270) a player applies on display, from either the legacy tag or the display matrix. */
export function streamRotation(stream: { tags?: Record<string, unknown>; side_data_list?: Array<Record<string, unknown>> }): number {
  let deg = 0;
  const tag = Number(stream.tags?.rotate);
  if (Number.isFinite(tag)) deg = tag;
  for (const sd of stream.side_data_list ?? []) {
    const r = Number(sd.rotation);
    // ffprobe reports the display matrix counter-clockwise; the legacy tag is clockwise.
    if (Number.isFinite(r)) deg = -r;
  }
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

/** Pure part of probing, split out so it can be tested without a media file. */
export function summarizeProbe(metadata: {
  format?: { duration?: number | string };
  streams?: Array<Record<string, any>>;
}): VideoProbe | null {
  const streams = metadata.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && Number(s.width) > 0 && Number(s.height) > 0);
  if (!video) return null;
  const rotated = streamRotation(video) % 180 !== 0;
  const w = Number(video.width);
  const h = Number(video.height);
  const duration = Number(metadata.format?.duration ?? video.duration);
  return {
    width: rotated ? h : w,
    height: rotated ? w : h,
    fps: parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

/** Reads frame size, frame rate, audio presence and duration with ffprobe. Resolves null when the file can't be read as video. */
export function probeVideo(filePath: string): Promise<VideoProbe | null> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err || !metadata) {
        resolve(null);
        return;
      }
      resolve(summarizeProbe(metadata as any));
    });
  });
}
