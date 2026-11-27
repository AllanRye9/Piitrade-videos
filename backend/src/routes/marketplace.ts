import { Router, Request, Response } from 'express';
import { HttpError } from '../lib/core/httpError';
import { prisma } from '../db';
import { toSearchResultDto, browseUrlFor } from '../lib/search/marketplace';
import { searchSites } from '../lib/search/searchSites';
import { searchLimiter } from '../middleware/rateLimit';

const router = Router();

// GET /api/marketplace/search?q=<text> — manual, user-typed search across every
// connected shop (see lib/search/searchSites.ts; one failing shop never blocks the rest).
//
// Independent of the AI-identify pipeline in visualSearch.ts: this
// lets a viewer type their own words and search the marketplace
// directly, which doubles as a way to verify whether an item genuinely
// exists there (bypassing whatever the AI identified). Uses the same
// query-shortening fallback as the visual-search pipeline, since the
// marketplace's own search is a verbatim substring match and even a
// typed multi-word phrase can miss a shorter real listing title.
//
// Read-only on purpose: piitrade.com is a classifieds site, so there
// is nothing to buy or check out here — each result's `listingUrl`
// opens the listing on piitrade.com, and `browseUrl` opens the full
// result set there.
router.get('/search', searchLimiter, async (req: Request, res: Response) => {
  const q = req.query.q;
  if (typeof q !== 'string' || !q.trim()) {
    throw new HttpError(400, 'q query parameter is required');
  }
  console.log(`[Marketplace] manual search: "${q}"`);
  const outcome = await searchSites(q);
  const results = outcome.results.map((p) => toSearchResultDto(p, q));
  res.json({ results, matchedQuery: outcome.matchedQuery, browseUrl: browseUrlFor(outcome.matchedQuery || q), shops: { searched: outcome.searched, failed: outcome.failed } });
});

// GET /api/marketplace/sites — the connected shops (public fields only). The app reads this so newly
// registered shops appear without an app update.
router.get('/sites', async (_req: Request, res: Response) => {
  const sites = await prisma.site.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, baseUrl: true, country: true, currency: true } });
  res.json({ sites });
});

export default router;
