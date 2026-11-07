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

// Extensions accepted for upload — the formats phones/screen
// recorders/desktop tools most commonly produce for short clips.
const ACCEPTED_VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.3gp', '.avi', '.mkv', '.wmv', '.flv']);

export const uploadVideo = multer({
  storage: makeStorage('videos'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ACCEPTED_VIDEO_EXTENSIONS.has(ext)) {
      cb(new HttpError(400, 'Unsupported video format. Supported: MP4, MOV, WebM, M4V, 3GP, AVI, MKV, WMV, FLV.'));
      return;
    }
    // Mimetype is a secondary check, deliberately loose: browsers are
    // inconsistent about what they report for less common containers
    // (.wmv sometimes arrives as video/x-ms-asf, .mkv sometimes as
    // video/mkv, etc), and a browser that doesn't recognize the file's
    // type at all sends 'application/octet-stream' rather than leaving
    // it blank. Reject only mimetypes that positively claim to be a
    // different, non-video kind of file — extension is authoritative
    // for which video formats we accept.
    if (file.mimetype && !file.mimetype.startsWith('video/') && file.mimetype !== 'application/octet-stream') {
      cb(new HttpError(400, 'Unsupported video format. Supported: MP4, MOV, WebM, M4V, 3GP, AVI, MKV, WMV, FLV.'));
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

// Audio that can be added to a video in the upload editor — what
// phones/recorders/music apps commonly produce. The browser can't
// decode all of these for the live preview (FLAC/Opus in Safari, for
// instance), but the server accepts and mixes every one of them.
const ACCEPTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.weba']);
export const AUDIO_FORMATS_LABEL = 'MP3, M4A, AAC, WAV, OGG, Opus, FLAC';

/** The video upload endpoint: the video itself (`video`) plus an optional
 *  audio track (`audio`) to add to it. Both land in the videos upload
 *  directory as temporary files; the route deletes them once the mixed,
 *  normalized MP4 has been produced. */
export const uploadVideoWithAudio = multer({
  storage: makeStorage('videos'),
  limits: { fileSize: 500 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'audio') {
      const mimetypeOk = !file.mimetype || file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream' || file.mimetype.startsWith('video/');
      if (!ACCEPTED_AUDIO_EXTENSIONS.has(ext) || !mimetypeOk) {
        cb(new HttpError(400, `Unsupported audio format. Supported: ${AUDIO_FORMATS_LABEL}.`));
        return;
      }
      cb(null, true);
      return;
    }
    if (file.fieldname !== 'video') {
      cb(new HttpError(400, `Unexpected file field "${file.fieldname}"`));
      return;
    }
    if (!ACCEPTED_VIDEO_EXTENSIONS.has(ext)) {
      cb(new HttpError(400, 'Unsupported video format. Supported: MP4, MOV, WebM, M4V, 3GP, AVI, MKV, WMV, FLV.'));
      return;
    }
    if (file.mimetype && !file.mimetype.startsWith('video/') && file.mimetype !== 'application/octet-stream') {
      cb(new HttpError(400, 'Unsupported video format. Supported: MP4, MOV, WebM, M4V, 3GP, AVI, MKV, WMV, FLV.'));
      return;
    }
    cb(null, true);
  },
}).fields([
  { name: 'video', maxCount: 1 },
  { name: 'audio', maxCount: 1 },
]);
