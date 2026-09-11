import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import fs from 'fs';
import videosRouter from './routes/videos';
import visualSearchRouter from './routes/visualSearch';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import marketplaceRouter from './routes/marketplace';
import profileRouter from './routes/profile';
import { UPLOAD_ROOT, VIDEOS_DIR, POSTERS_DIR, PRODUCTS_DIR, AVATARS_DIR } from './paths';
import { HttpError } from './lib/httpError';

for (const dir of [VIDEOS_DIR, POSTERS_DIR, PRODUCTS_DIR, AVATARS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Security headers. Cross-origin resource policy is relaxed for
// /uploads since video/image files there are meant to be embedded
// cross-origin (e.g. if the frontend is served from a different host).
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : true,
  })
);
app.use(express.json());

// Uploaded files are named with random UUIDs and never overwritten in
// place, so it's safe to let browsers/CDNs cache them aggressively.
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d', immutable: true }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/videos', videosRouter);
app.use('/api/visual-search', visualSearchRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/profile', profileRouter);

// Centralized error handler. Thanks to `express-async-errors`, any
// error thrown (or rejected promise) inside an async route handler
// ends up here instead of hanging the request or crashing the process.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: err.message });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Piitrade backend listening on port ${PORT}`);
});
