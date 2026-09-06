import multer from 'multer';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { UPLOAD_ROOT } from '../paths';

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
    if (!file.mimetype.startsWith('video/')) {
      cb(new Error('Only video files are allowed'));
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
      cb(new Error('Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
});
