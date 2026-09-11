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
import { prisma } from './db';

for (const dir of [VIDEOS_DIR, POSTERS_DIR, PRODUCTS_DIR, AVATARS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Local disk is only a valid place to store uploads on a host with a
// PERSISTENT filesystem across restarts/redeploys. Most PaaS platforms
// (Render, Heroku, and serverless-style containers generally) give
// each deploy — and in some cases each restart, e.g. Render's free
// tier spinning back up after idling — a completely fresh filesystem,
// silently discarding anything written to disk since the image was
// built. Videos/posters/avatars uploaded that way will 404 the moment
// the process restarts, with no error at upload time to hint why. This
// is loud and unconditional (not just in dev) because it's exactly the
// kind of thing that works fine locally and fails silently in
// production — see VIDEO_STORE/IMAGES_POINT in lib/imagekit.ts.
if (!process.env.VIDEO_STORE || !process.env.IMAGES_POINT) {
  console.warn(
    '[Startup] WARNING: ' +
      [!process.env.VIDEO_STORE && 'VIDEO_STORE', !process.env.IMAGES_POINT && 'IMAGES_POINT'].filter(Boolean).join(' and ') +
      ' not set — falling back to local disk (uploads/). This is fine for local dev, but on any host without a ' +
      'PERSISTENT disk mounted at UPLOAD_DIR (most PaaS platforms, e.g. Render/Heroku, do NOT persist local ' +
      'disk across restarts or redeploys by default), uploaded videos/posters/avatars WILL be lost — often not ' +
      'immediately, but the next time the process restarts, which is easy to mistake for a random bug. Either ' +
      'set VIDEO_STORE/IMAGES_POINT (see .env.example) or attach a persistent disk mounted at UPLOAD_DIR.'
  );
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

// Logs every request/response that hits the API — method, path,
// status, and duration — so the server console has a trace of every
// process the backend handles, not just the ones individual route
// handlers happen to log themselves. Runs before the routers below so
// it wraps every request, including ones that error out.
app.use((req, res, next) => {
  const startedAt = Date.now();
  const sessionId = req.header('x-session-id');
  console.log(`[HTTP] -> ${req.method} ${req.originalUrl}${sessionId ? ` (session ${sessionId.slice(0, 8)})` : ''}`);
  res.on('finish', () => {
    console.log(`[HTTP] <- ${req.method} ${req.originalUrl} ${res.statusCode} in ${Date.now() - startedAt}ms`);
  });
  next();
});

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
  checkDatabaseSchema();
});

// Every model the app actually queries at runtime, checked with a
// trivial `count()` against each. This exists because a missing
// migration doesn't fail at startup or even at `prisma generate` time
// (generate only needs schema.prisma, not the live database) — it
// only shows up the first time a route touches that specific table,
// as a bare "Internal server error" with no indication of which table
// or why. Running this once at boot turns that into a specific,
// immediate, unmissable log line instead of a support ticket. Never
// blocks startup — the server should still come up and serve whatever
// routes DO work even if one table is missing.
async function checkDatabaseSchema() {
  const checks: Array<[string, () => Promise<unknown>]> = [
    ['Video', () => prisma.video.count()],
    ['Comment', () => prisma.comment.count()],
    ['UserVideoState', () => prisma.userVideoState.count()],
    ['AdminUser', () => prisma.adminUser.count()],
    ['Product', () => prisma.product.count()],
    ['MarketplaceLink', () => prisma.marketplaceLink.count()],
    ['SessionProfile', () => prisma.sessionProfile.count()],
  ];

  const missing: string[] = [];
  for (const [name, check] of checks) {
    try {
      await check();
    } catch (err) {
      missing.push(name);
      console.error(`[Startup] DB check failed for "${name}":`, err instanceof Error ? err.message : err);
    }
  }

  if (missing.length > 0) {
    console.error(
      `[Startup] ERROR: ${missing.length} table(s) are missing or unreachable — ${missing.join(', ')}. ` +
        `Every route that touches ${missing.length === 1 ? 'this table' : 'these tables'} will fail with a generic ` +
        `500 until this is fixed. This almost always means pending migrations haven't been applied to this ` +
        `database — run "npx prisma migrate deploy" against DATABASE_URL, then restart this service.`
    );
  } else {
    console.log(`[Startup] DB check passed — all ${checks.length} expected tables are reachable.`);
  }
}
