import { Router, Request, Response } from 'express';
import { HttpError } from '../lib/httpError';
import { searchSites, toSearchResultDto } from '../lib/marketplace';
import { listActiveSites } from '../lib/sites';
import { siteHomeUrl, sellUrlFor, searchUrlFor } from '../lib/siteUrls';

const router = Router();

// GET /api/marketplace/sites — the connected sites (managed in Admin → Sites),
// with ready-made links, so clients never hardcode a marketplace.
router.get('/sites', async (_req: Request, res: Response) => {
  const sites = await listActiveSites();
  res.json({
    sites: sites.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      country: s.country,
      url: s.siteUrl,
      homeUrl: siteHomeUrl(s),
      browseUrl: searchUrlFor(s, ''),
      sellUrl: sellUrlFor(s),
      searchable: s.apiType === 'piitrade' && !!s.apiUrl,
    })),
  });
});

// GET /api/marketplace/search?q=<text>&site=<slug> — manual, user-typed
// search across every connected site (or just `site`).
//
// Independent of the AI-identify pipeline in visualSearch.ts: this lets a
// viewer type their own words and search the marketplaces directly. Uses the
// same query-shortening fallback as the visual-search pipeline, since a
// marketplace's own search is a verbatim substring match and even a typed
// multi-word phrase can miss a shorter real listing title.
//
// Read-only on purpose: each result's `listingUrl` opens the listing on its
// own site, and every entry in `sites` carries a link to that site's full
// result set.
router.get('/search', async (req: Request, res: Response) => {
  const q = req.query.q;
  if (typeof q !== 'string' || !q.trim()) {
    throw new HttpError(400, 'q query parameter is required');
  }
  const only = typeof req.query.site === 'string' && req.query.site ? req.query.site : undefined;
  console.log(`[Marketplace] manual search: "${q}"${only ? ` on ${only}` : ''}`);
  const outcome = await searchSites(q, only);
  res.json({
    results: outcome.results.map((p) => toSearchResultDto(p, q)),
    matchedQuery: outcome.matchedQuery,
    browseUrl: outcome.browseUrl,
    sites: outcome.sites,
  });
});

export default router;
