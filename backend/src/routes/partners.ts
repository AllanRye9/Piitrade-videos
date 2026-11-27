import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { HttpError } from '../lib/core/httpError';
import { cleanApplication, newApplicationToken, tokenMatches } from '../lib/shops/partners';
import { checkListingApi } from '../lib/shops/sites';
import { partnerApplyLimiter, partnerStatusLimiter } from '../middleware/rateLimit';

/**
 * Self-service partner onboarding. Piitrade Videos promotes the shops and apps that connect to it, so a shop
 * applies here with its own listing API (docs/LISTING_SPEC.md). The server calls that API and checks it against
 * the spec before the application is even queued; an admin then approves it (Admin → Partner applications),
 * which registers the shop, and the applicant collects its postback secret once from the status endpoint.
 */
const router = Router();

function publicView(app: any) {
  return {
    id: app.id,
    name: app.name,
    status: app.status,
    reviewNote: app.reviewNote || '',
    createdAt: app.createdAt,
    reviewedAt: app.reviewedAt ?? null,
  };
}

// GET /api/partners/spec — what a shop has to expose (machine-readable summary of docs/LISTING_SPEC.md).
router.get('/spec', (_req: Request, res: Response) => {
  res.json({
    listingEndpoint: 'GET {apiBase}/api/listings?q=<text>&sort=relevance&limit=<n>&country=<ISO-3166 alpha-2>',
    requiredFields: ['listings[].id', 'listings[].title', 'listings[].price'],
    recommendedFields: ['listings[].productImages[0].cdnUrl | listings[].images[0]', 'listings[].url (on your registered host)'],
    conversionPostback: 'POST /api/attribution/conversion (HMAC-SHA256 over "<timestamp>.<rawBody>" with your postback secret) — optional, enables creator commission',
    docs: '/docs/PARTNERS.md',
  });
});

// POST /api/partners/apply — verifies the applicant's listing API, then queues the application for review.
router.post('/apply', partnerApplyLimiter, async (req: Request, res: Response) => {
  const data = cleanApplication(req.body);

  const [shop, open] = await Promise.all([
    prisma.site.findMany({ select: { baseUrl: true } }),
    prisma.partnerApplication.findFirst({ where: { host: data.host, status: 'pending' }, select: { id: true } }),
  ]);
  if (shop.some((s: { baseUrl: string }) => new URL(s.baseUrl).hostname.toLowerCase().replace(/^www\./, '') === data.host)) {
    throw new HttpError(409, 'This website is already a connected partner', { code: 'ALREADY_PARTNER' });
  }
  if (open) throw new HttpError(409, 'An application for this website is already waiting for review', { code: 'ALREADY_PENDING' });

  // The connection IS the application: if the API doesn't answer the open spec, nothing is queued and the
  // applicant gets the exact problems to fix.
  const check = await checkListingApi(data.apiBase, data.country);
  if (!check.ok) {
    throw new HttpError(422, 'Your listing API did not pass the connection check', { code: 'API_CHECK_FAILED', details: { check } });
  }

  const { token, hash } = newApplicationToken();
  const app = await prisma.partnerApplication.create({
    data: { ...data, tokenHash: hash, verification: JSON.stringify({ ok: check.ok, ms: check.ms, sampleCount: check.sampleCount ?? 0, issues: check.issues }) },
  });
  // The token is returned exactly once; only its hash is stored.
  res.status(201).json({ application: publicView(app), statusToken: token, check });
});

// GET /api/partners/applications/:id  (header X-Application-Token) — status; once approved, the credentials, once.
router.get('/applications/:id', partnerStatusLimiter, async (req: Request, res: Response) => {
  const app = await prisma.partnerApplication.findUnique({ where: { id: req.params.id }, include: { site: true } });
  // Same answer for "no such application" and "wrong token", so ids can't be probed.
  if (!app || !tokenMatches(req.header('x-application-token'), app.tokenHash)) throw new HttpError(404, 'Application not found');

  const out: Record<string, unknown> = { application: publicView(app) };
  if (app.status === 'approved' && app.site) {
    out.partner = { slug: app.site.slug, name: app.site.name, commissionPct: app.site.commissionPct };
    if (!app.credentialsClaimedAt) {
      // Claim atomically so two simultaneous requests can't both receive the secret.
      const claimed = await prisma.partnerApplication.updateMany({ where: { id: app.id, credentialsClaimedAt: null }, data: { credentialsClaimedAt: new Date() } });
      if (claimed.count === 1) out.credentials = { postbackSecret: app.site.postbackSecret, note: 'Shown once. Store it now; an admin can rotate it if it is lost.' };
    }
  }
  res.json(out);
});

export default router;
