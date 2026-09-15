import path from 'path';

export const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
export const VIDEOS_DIR = path.join(UPLOAD_ROOT, 'videos');
export const POSTERS_DIR = path.join(UPLOAD_ROOT, 'posters');
export const PRODUCTS_DIR = path.join(UPLOAD_ROOT, 'products');
export const AVATARS_DIR = path.join(UPLOAD_ROOT, 'avatars');
// Watermarked copies prepared for download (see lib/watermark.ts) —
// generated once per video and cached here, separate from VIDEOS_DIR
// so the original, un-watermarked file used for normal in-app
// playback is never touched.
export const DOWNLOADS_DIR = path.join(UPLOAD_ROOT, 'downloads');
