import { Router, Request, Response } from 'express';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '../db';
import { HttpError } from '../lib/core/httpError';
import { VIDEOS_DIR } from '../paths';
import { grabFrameJpeg } from '../lib/video/keyframes';
import { identifyImage } from '../lib/search/aiSearch';
import { toSearchResultDto, browseUrlFor } from '../lib/search/marketplace';
import { searchSites, searchConfigured } from '../lib/search/searchSites';
import { FrameRegion, interpretFrames } from '../lib/search/frameSearch';
import { searchLimiter } from '../middleware/rateLimit';

const router = Router();

function parseRegion(raw: unknown): FrameRegion | null {
  if (raw === undefined || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const x = Number(r.x);
  const y = Number(r.y);
  const w = Number(r.w);
  const h = Number(r.h);
  if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) {
    throw new HttpError(400, 'region must be fractions of the frame inside 0–1', { code: 'INVALID_REGION' });
  }
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

async function cropJpeg(jpeg: Buffer, region: FrameRegion): Promise<Buffer> {
  const meta = await sharp(jpeg).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return jpeg;
  const left = Math.min(W - 2, Math.max(0, Math.floor(region.x * W)));
  const top = Math.min(H - 2, Math.max(0, Math.floor(region.y * H)));
  const width = Math.max(2, Math.min(W - left, Math.round(region.w * W)));
  const height = Math.max(2, Math.min(H - top, Math.round(region.h * H)));
  return sharp(jpeg).extract({ left, top, width, height }).jpeg({ quality: 88 }).toBuffer();
}

/** The small picture shown in the app as "what was analysed". */
async function thumbnail(jpeg: Buffer): Promise<string> {
  const small = await sharp(jpeg).resize({ width: 320, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  return `data:image/jpeg;base64,${small.toString('base64')}`;
}

// POST /api/frame-search  { videoId, atMs, region? }
//
// Find on Piitrade from a screenshot. The app sends the video and the position the viewer was at; the server cuts
// that frame out of the stored file, has the AI say what it shows and searches every connected shop for it. If the
// frame yields nothing, nearby frames are tried (lib/search/frameSearch.ts); only after that does it fall back to
// searching the video's own title/hashtag — and says so, so the app can tell the viewer which it was.
// Open to guests like every other search; the per-session search limiter applies.
router.post('/', searchLimiter, async (req: Request, res: Response) => {
  const videoId = typeof req.body?.videoId === 'string' ? req.body.videoId : '';
  if (!videoId) throw new HttpError(400, 'videoId is required', { code: 'INVALID_FRAME_SEARCH' });
  const atRaw = req.body?.atMs === undefined || req.body?.atMs === null ? 0 : Number(req.body.atMs);
  if (!Number.isFinite(atRaw) || atRaw < 0) throw new HttpError(400, 'atMs must be a number of milliseconds', { code: 'INVALID_FRAME_SEARCH' });
  const region = parseRegion(req.body?.region);

  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new HttpError(404, 'Video not found');
  const durationMs = video.duration ? Math.round(video.duration * 1000) : null;
  const input = /^https?:\/\//i.test(video.filename) ? video.filename : path.join(VIDEOS_DIR, path.basename(video.filename));

  const titleQuery = (video.hashtags?.[0] || video.title || '').replace(/^#/, '').trim();
  const respondWithTitle = async (note: string, attempts: unknown[] = []) => {
    if (!titleQuery) throw new HttpError(404, 'Could not identify anything in this video', { code: 'NOTHING_IDENTIFIED' });
    const outcome = await searchSites(titleQuery);
    res.json({
      source: 'title',
      note,
      query: titleQuery,
      results: outcome.results.map((p) => toSearchResultDto(p, titleQuery)),
      matchedQuery: outcome.matchedQuery,
      browseUrl: browseUrlFor(outcome.matchedQuery || titleQuery),
      shops: { searched: outcome.searched, failed: outcome.failed },
      attempts,
    });
  };

  if (!process.env.AI_SEARCH || !(await searchConfigured())) {
    console.log('[FrameSearch] image identification not configured — searching by the video title instead');
    await respondWithTitle('Picture analysis is not set up on this server, so this searched by the video’s title.');
    return;
  }

  console.log(`[FrameSearch] video ${video.id} at ${Math.round(atRaw)}ms${region ? ' (marked region)' : ''}`);
  const outcome = await interpretFrames(
    {
      grabFrame: (atMs) => grabFrameJpeg(input, atMs),
      cropFrame: cropJpeg,
      identify: async (jpeg) => (await identifyImage(jpeg, 'image/jpeg')).text,
      search: (q) => searchSites(q),
      countResults: (o) => o.results.length,
    },
    { atMs: atRaw, durationMs, region }
  );
  const attempts = outcome.attempts;
  console.log(`[FrameSearch] ${attempts.length} attempt(s): ` + attempts.map((a) => `${a.atMs}ms→${a.identification ? `"${a.identification}" (${a.results})` : a.stopped}`).join('; '));

  if (!outcome.best) {
    if (attempts.length && attempts.every((a) => a.stopped === 'no-frame')) {
      throw new HttpError(422, 'Could not take a picture of this video — try again in a moment', { code: 'FRAME_UNAVAILABLE' });
    }
    await respondWithTitle('The picture could not be interpreted, so this searched by the video’s title.', attempts);
    return;
  }

  const { best } = outcome;
  if (!best.found) {
    // Understood but not listed anywhere. Try the title once before telling the viewer nothing was found.
    const byTitle = titleQuery ? await searchSites(titleQuery) : null;
    if (byTitle && byTitle.results.length > 0) {
      res.json({
        source: 'title',
        note: `It looks like “${best.identification}”, which isn’t listed — here is what the video’s title matches instead.`,
        identification: best.identification,
        query: titleQuery,
        frame: await thumbnail(best.frame),
        atMs: best.atMs,
        results: byTitle.results.map((p) => toSearchResultDto(p, titleQuery)),
        matchedQuery: byTitle.matchedQuery,
        browseUrl: browseUrlFor(byTitle.matchedQuery || titleQuery),
        shops: { searched: byTitle.searched, failed: byTitle.failed },
        attempts,
      });
      return;
    }
  }

  const o = best.outcome;
  res.json({
    source: 'frame',
    identification: best.identification,
    frame: await thumbnail(best.frame),
    atMs: best.atMs,
    results: o.results.map((p) => toSearchResultDto(p, best.identification)),
    matchedQuery: o.matchedQuery,
    browseUrl: browseUrlFor(o.matchedQuery || best.identification),
    shops: { searched: o.searched, failed: o.failed },
    attempts,
  });
});

export default router;
