/**
 * The Piitrade frame standard as the web app knows it (the server enforces it —
 * backend/src/lib/video/videoStandard.ts; tests/contracts.test.mjs keeps the
 * numbers in step). Used to tell the uploader up front what their video will be
 * stored as, so a 4K clip getting smaller is expected rather than a surprise.
 */
export const FRAME_STANDARD = {
  portrait: { maxWidth: 1080, maxHeight: 1920 },
  landscape: { maxWidth: 1920, maxHeight: 1080 },
  maxFps: 30,
} as const;

export interface StoredSize {
  width: number;
  height: number;
  /** The stored size differs from the source (larger than the standard, or odd sides). */
  changed: boolean;
}

/** The size a source frame is stored at: shrunk to fit, never enlarged, sides even. */
export function storedSize(width: number, height: number): StoredSize {
  if (!(width > 0) || !(height > 0)) return { width, height, changed: false };
  const box = width > height ? FRAME_STANDARD.landscape : FRAME_STANDARD.portrait;
  const ratio = Math.min(1, box.maxWidth / width, box.maxHeight / height);
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const w = even(width * ratio);
  const h = even(height * ratio);
  return { width: w, height: h, changed: w !== width || h !== height };
}
