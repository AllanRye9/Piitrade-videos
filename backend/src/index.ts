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

app.use(cors());
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
