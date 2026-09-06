import multer from 'multer';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { UPLOAD_ROOT } from '../paths';
import { HttpError } from '../lib/httpError';

function makeStorage(subdir: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(UPLOAD_ROOT, subdir)),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `${uuid()}${ext}`);
    },
  });
}

export const uploadVideo = multer({
  storage: makeStorage('videos'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    const extIsMp4 = path.extname(file.originalname).toLowerCase() === '.mp4';
    // Some clients send a generic/empty mimetype for local files; treat
    // the extension as authoritative but still reject anything that
    // explicitly claims to be a different, non-mp4 type.
    const mimeIsMp4OrUnknown = file.mimetype === 'video/mp4' || file.mimetype === 'application/octet-stream';
    if (!extIsMp4 || !mimeIsMp4OrUnknown) {
      cb(new HttpError(400, 'Only .mp4 video files are allowed'));
      return;
    }
    cb(null, true);
  },
});

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new HttpError(400, 'Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
});
