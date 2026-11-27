import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { corsOptions } from './lib/core/cors';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import fs from 'fs';
import videosRouter from './routes/videos';
import visualSearchRouter from './routes/visualSearch';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import marketplaceRouter from './routes/marketplace';
import frameSearchRouter from './routes/frameSearch';
import profileRouter from './routes/profile';
import accountsRouter from './routes/accounts';
import accountRouter from './routes/account';
import notificationsRouter from './routes/notifications';
import attributionRouter, { goRouter } from './routes/attribution';
import publicRouter from './routes/public';
import savedItemsRouter from './routes/savedItems';
import eventsRouter from './routes/events';
import partnersRouter from './routes/partners';
import configRouter from './routes/config';
import { enforceSiteSettings } from './middleware/siteSettings';
import { ensureDefaultSite } from './lib/shops/sites';
import { UPLOAD_ROOT, VIDEOS_DIR, POSTERS_DIR, PRODUCTS_DIR, AVATARS_DIR } from './paths';
import { HttpError } from './lib/core/httpError';

for (const dir of [VIDEOS_DIR, POSTERS_DIR, PRODUCTS_DIR, AVATARS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = express();
// Behind nginx/Vercel the socket address is the proxy's. Trust one hop so req.ip is the real client
// (needed for IP rate limits and anonymous click de-duplication). Set TRUST_PROXY=0 if the backend
// is exposed directly, or a larger number for extra proxies (e.g. a CDN in front of nginx).
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
const PORT = Number(process.env.PORT) || 4000;

// Security headers. Cross-origin resource policy is relaxed for
// /uploads since video/image files there are meant to be embedded
// cross-origin (e.g. if the frontend is served from a different host).
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
// Browser origins allowed to call the API (see lib/core/cors.ts). Set ALLOWED_ORIGIN to add more.
app.use(cors(corsOptions()));
// The raw bytes are kept for the conversion postback: its HMAC signature is computed over them.
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

// Uploaded files are named with random UUIDs and never overwritten in
// place, so it's safe to let browsers/CDNs cache them aggressively.
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d', immutable: true }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// Maintenance mode and feature switches (Admin → Site & app settings) apply to everything below.
app.use('/api', enforceSiteSettings);
app.use('/api/config', configRouter);
app.use('/api/videos', videosRouter);
app.use('/api/visual-search', visualSearchRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/frame-search', frameSearchRouter);
app.use('/api/profile', profileRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/account', accountRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/attribution', attributionRouter);
app.use('/api/saved-items', savedItemsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/partners', partnersRouter);
app.use(goRouter); // /go/:videoId/:productId
app.use(publicRouter); // /embed, /v, /embed.js, /api/oembed, /api/embed/by-product

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
    res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.details || {}) });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

ensureDefaultSite().catch((err) => console.error('Could not ensure the default shop:', err));

app.listen(PORT, () => {
  console.log(`Piitrade backend listening on port ${PORT}`);
});
