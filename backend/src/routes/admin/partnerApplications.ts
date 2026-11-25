import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/httpError';
import { audit } from '../../lib/audit';
import { checkListingApi, newPostbackSecret, uniqueSlug } from '../../lib/sites';
import { invalidateShopCache } from '../../lib/searchSites';

const router = Router();

function serialize(a: any) {
  let verification: unknown = null;
  try {
    verification = a.verification ? JSON.parse(a.verification) : null;
  } catch {
    verification = null;
  }
  return {
    id: a.id,
    name: a.name,
    baseUrl: a.baseUrl,
    apiBase: a.apiBase,
    country: a.country,
    currency: a.currency,
    contactName: a.contactName,
    contactEmail: a.contactEmail,
    notes: a.notes,
    status: a.status,
    reviewNote: a.reviewNote,
    siteId: a.siteId ?? null,
    verification,
    createdAt: a.createdAt,
    reviewedAt: a.reviewedAt ?? null,
  };
}

// GET /api/admin/partner-applications?status=pending|approved|rejected
router.get('/', requirePermission('sites.view'), async (req: AuthedRequest, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const rows = await prisma.partnerApplication.findMany({
    where: ['pending', 'approved', 'rejected'].includes(status) ? { status } : undefined,
    orderBy: [{ createdAt: 'desc' }],
    take: 200,
  });
  res.json({ applications: rows.map(serialize) });
});

// POST /api/admin/partner-applications/:id/recheck — re-runs the listing-API check (the shop may have fixed or broken it since).
router.post('/:id/recheck', requirePermission('sites.view'), async (req: AuthedRequest, res: Response) => {
  const app = await prisma.partnerApplication.findUnique({ where: { id: req.params.id } });
  if (!app) throw new HttpError(404, 'Application not found');
  const check = await checkListingApi(app.apiBase, app.country);
  await prisma.partnerApplication.update({ where: { id: app.id }, data: { verification: JSON.stringify({ ok: check.ok, ms: check.ms, sampleCount: check.sampleCount ?? 0, issues: check.issues }) } });
  res.json(check);
});

// POST /api/admin/partner-applications/:id/approve  { commissionPct? } — registers the shop as a partner.
router.post('/:id/approve', requirePermission('sites.create'), async (req: AuthedRequest, res: Response) => {
  const pct = req.body?.commissionPct === undefined ? 5 : Number(req.body.commissionPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, 'Commission must be between 0 and 100');

  const app = await prisma.partnerApplication.findUnique({ where: { id: req.params.id } });
  if (!app) throw new HttpError(404, 'Application not found');
  if (app.status !== 'pending') throw new HttpError(409, `This application was already ${app.status}`);

  // Claim the review first so two admins approving at once can't create two shops.
  const claimed = await prisma.partnerApplication.updateMany({ where: { id: app.id, status: 'pending' }, data: { status: 'approved', reviewedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(409, 'This application was just reviewed by someone else');

  try {
    const site = await prisma.site.create({
      data: {
        name: app.name,
        slug: await uniqueSlug(app.name),
        baseUrl: app.baseUrl,
        apiBase: app.apiBase,
        apiType: 'piitrade',
        country: app.country,
        currency: app.currency,
        commissionPct: pct,
        postbackSecret: newPostbackSecret(),
        active: true,
      },
    });
    await prisma.partnerApplication.update({ where: { id: app.id }, data: { siteId: site.id, reviewNote: String(req.body?.reviewNote ?? '').slice(0, 500) } });
    audit(req, 'partner.approve', 'site', site.id, `${app.name} (${app.host})`);
    invalidateShopCache();
    res.json({ application: serialize({ ...app, status: 'approved', siteId: site.id }), siteId: site.id });
  } catch (err) {
    // Put it back in the queue rather than leaving an "approved" application with no shop.
    await prisma.partnerApplication.updateMany({ where: { id: app.id }, data: { status: 'pending', reviewedAt: null } });
    throw err;
  }
});

// POST /api/admin/partner-applications/:id/reject  { reviewNote? }
router.post('/:id/reject', requirePermission('sites.edit'), async (req: AuthedRequest, res: Response) => {
  const app = await prisma.partnerApplication.findUnique({ where: { id: req.params.id } });
  if (!app) throw new HttpError(404, 'Application not found');
  const claimed = await prisma.partnerApplication.updateMany({
    where: { id: app.id, status: 'pending' },
    data: { status: 'rejected', reviewedAt: new Date(), reviewNote: String(req.body?.reviewNote ?? '').slice(0, 500) },
  });
  if (claimed.count !== 1) throw new HttpError(409, `This application was already ${app.status === 'pending' ? 'reviewed' : app.status}`);
  audit(req, 'partner.reject', 'partnerApplication', app.id, `${app.name} (${app.host})`);
  res.json({ ok: true });
});

export default router;
