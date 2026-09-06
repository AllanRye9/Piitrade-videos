import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import videosRouter from './routes/videos';
import visualSearchRouter from './routes/visualSearch';
import { UPLOAD_ROOT, VIDEOS_DIR, POSTERS_DIR, PRODUCTS_DIR } from './paths';

for (const dir of [VIDEOS_DIR, POSTERS_DIR, PRODUCTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const allowedOrigins = (process.env.FRONTEND_URL || 'https://piitrade-videos.vercel.app,http://localhost:5173,http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origin is not allowed by CORS'));
    }
  },
}));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_ROOT));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/videos', videosRouter);
app.use('/api/visual-search', visualSearchRouter);

// Centralized error handler (multer errors, unhandled route errors, etc.)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Piitrade backend listening on port ${PORT}`);
});
