import { Router, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/httpError';
import { audit } from '../../lib/audit';
import { invalidateSites } from '../../lib/sites';
import { searchProducts } from '../../lib/marketplace';
import { API_TYPES, SiteValidationError, normalizeBaseUrl, normalizePathTemplate, slugify, listingUrlFor, searchUrlFor, sellUrlFor, siteHomeUrl } from '../../lib/siteUrls';

const router = Router();

const newSecret = () => crypto.randomBytes(32).toString('hex');

const allowPrivate = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_PRIVATE_SITE_URLS === 'true';

/** Validates + normalises the editable fields. `partial` = PATCH (only fields present). */
function clean(body: any, partial = false) {
  const data: Record<string, unknown> = {};
  try {
    if (!partial || body.name !== undefined) {
      const name = String(body.name ?? '').trim().slice(0, 80);
      if (!name) throw new SiteValidationError('A site name is required');
      data.name = name;
    }
    if (!partial || body.siteUrl !== undefined) data.siteUrl = normalizeBaseUrl(body.siteUrl, 'Website URL', { allowPrivate: allowPrivate() });
    if (body.apiUrl !== undefined) {
      const raw = String(body.apiUrl ?? '').trim();
      data.apiUrl = raw ? normalizeBaseUrl(raw, 'API URL', { allowPrivate: allowPrivate() }) : '';
    }
    if (body.apiType !== undefined) {
      const t = String(body.apiType);
      if (!(API_TYPES as readonly string[]).includes(t)) throw new SiteValidationError(`Type must be one of: ${API_TYPES.join(', ')}`);
      data.apiType = t;
    }
    if (body.country !== undefined) data.country = String(body.country).trim().toUpperCase().slice(0, 60);
    if (body.currency !== undefined) data.currency = String(body.currency).trim().toUpperCase().slice(0, 8);
    if (!partial || body.listingPath !== undefined) data.listingPath = normalizePathTemplate(body.listingPath, 'Listing path', '/listings/{id}', ['{id}']);
    if (!partial || body.searchPath !== undefined) data.searchPath = normalizePathTemplate(body.searchPath, 'Search path', '/listings?q={q}', ['{q}']);
    if (body.sellPath !== undefined) data.sellPath = String(body.sellPath ?? '').trim() ? normalizePathTemplate(body.sellPath, 'Sell path', '') : '';
    if (body.commissionPct !== undefined) {
      const n = Number(body.commissionPct);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new SiteValidationError('Commission must be between 0 and 100 percent');
      data.commissionPct = Math.round(n * 100) / 100;
    }
    if (body.active !== undefined) data.active = !!body.active;
    if (body.position !== undefined) {
      const n = Math.trunc(Number(body.position));
      if (!Number.isFinite(n)) throw new SiteValidationError('Position must be a number');
      data.position = Math.max(0, Math.min(10000, n));
    }
    // A site that says it has an API must say where it is.
    if (data.apiType === 'piitrade' && data.apiUrl === '') throw new SiteValidationError('A site with an API needs an API URL (or choose "link-only")');
  } catch (err) {
    if (err instanceof SiteValidationError) throw new HttpError(400, err.message);
    throw err;
  }
  return data;
}

function serialize(s: any, videoCount?: number, withSecret = false) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    siteUrl: s.siteUrl,
    apiUrl: s.apiUrl,
    apiType: s.apiType,
    country: s.country,
    currency: s.currency,
    listingPath: s.listingPath,
    searchPath: s.searchPath,
    sellPath: s.sellPath,
    active: s.active,
    position: s.position,
    commissionPct: s.commissionPct ?? 0,
    // The signing secret is only shown to admins who may edit sites.
    ...(withSecret ? { postbackSecret: s.postbackSecret } : {}),
    createdAt: s.createdAt,
    ...(videoCount !== undefined ? { videoCount } : {}),
    // Live previews of what the links will look like, so an admin can spot a bad template immediately.
    preview: {
      home: siteHomeUrl(s),
      listing: listingUrlFor(s, 'EXAMPLE-ID'),
      search: searchUrlFor(s, 'red sneakers'),
      sell: sellUrlFor(s),
    },
  };
}

// GET /api/admin/sites/options — id+name only, for the pickers on the video
// forms. Open to every admin so those forms work without "sites.view".
router.get('/options', async (_req, res: Response) => {
  const sites = await prisma.site.findMany({ where: { active: true }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true, name: true, slug: true, siteUrl: true } });
  res.json({ sites });
});

// GET /api/admin/sites
router.get('/', requirePermission('sites.view'), async (req: AuthedRequest, res: Response) => {
  const sites = await prisma.site.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }], include: { _count: { select: { videos: true } } } });
  const canSee = req.admin!.permissions.includes('sites.edit');
  res.json({ sites: sites.map((s: any) => serialize(s, s._count.videos, canSee)) });
});

// POST /api/admin/sites
router.post('/', requirePermission('sites.create'), async (req: AuthedRequest, res: Response) => {
  const data = clean(req.body) as any;
  const base = slugify(String(req.body.slug || '') || data.name) || 'site';
  // Find a free slug (my-shop, my-shop-2, …) rather than failing on a name clash.
  let slug = base;
  for (let i = 2; await prisma.site.findUnique({ where: { slug } }); i++) slug = `${base.slice(0, 36)}-${i}`;
  const position = data.position ?? (await prisma.site.count());
  try {
    const site = await prisma.site.create({ data: { ...data, slug, position, postbackSecret: newSecret() } });
    invalidateSites();
    audit(req, 'site.create', 'site', site.id, `${site.name} (${site.siteUrl})`);
    res.status(201).json({ site: serialize(site, 0, true) });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'A site with that slug already exists');
    throw err;
  }
});

// PATCH /api/admin/sites/:id
router.patch('/:id', requirePermission('sites.edit'), async (req: AuthedRequest, res: Response) => {
  const data = clean(req.body, true);
  // Keep the API settings coherent when only one of them changes.
  const existing = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Site not found');
  const apiType = (data.apiType as string | undefined) ?? existing.apiType;
  const apiUrl = (data.apiUrl as string | undefined) ?? existing.apiUrl;
  if (apiType === 'piitrade' && !apiUrl) throw new HttpError(400, 'A site with an API needs an API URL (or choose "link-only")');
  if (req.body.slug !== undefined) {
    const slug = slugify(String(req.body.slug));
    if (!slug) throw new HttpError(400, 'Slug may only contain letters, numbers and hyphens');
    data.slug = slug;
  }
  try {
    const site = await prisma.site.update({ where: { id: existing.id }, data });
    invalidateSites();
    audit(req, 'site.update', 'site', site.id, `${site.name}: ${Object.keys(data).join(', ')}`);
    res.json({ site: serialize(site, undefined, true) });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'A site with that slug already exists');
    throw err;
  }
});

// POST /api/admin/sites/:id/rotate-secret — issues a new postback signing secret (the old one stops working at once).
router.post('/:id/rotate-secret', requirePermission('sites.edit'), async (req: AuthedRequest, res: Response) => {
  const existing = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Site not found');
  const site = await prisma.site.update({ where: { id: existing.id }, data: { postbackSecret: newSecret() } });
  invalidateSites();
  audit(req, 'site.rotate_secret', 'site', site.id, site.name);
  res.json({ site: serialize(site, undefined, true) });
});

// POST /api/admin/sites/:id/test — runs a real product search against the site's API.
router.post('/:id/test', requirePermission('sites.edit'), async (req: AuthedRequest, res: Response) => {
  const site = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!site) throw new HttpError(404, 'Site not found');
  if (site.apiType !== 'piitrade' || !site.apiUrl) {
    res.json({ ok: true, linkOnly: true, message: 'Link-only site: nothing to test — search will open the site\'s own search page.', search: searchUrlFor(site, 'test') });
    return;
  }
  const started = Date.now();
  try {
    const results = await searchProducts(site, String(req.body?.q || 'a').slice(0, 60));
    res.json({ ok: true, ms: Date.now() - started, count: results.length, sample: results.slice(0, 3).map((r) => ({ name: r.name, price: r.price, listingUrl: r.listingUrl })) });
  } catch (err) {
    res.json({ ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : 'Search failed' });
  }
});

// DELETE /api/admin/sites/:id — videos that used it just lose the site tag (and keep no product link).
router.delete('/:id', requirePermission('sites.delete'), async (req: AuthedRequest, res: Response) => {
  const site = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!site) throw new HttpError(404, 'Site not found');
  // A product link only makes sense on a registered site, so clear them with it.
  await prisma.$transaction([
    prisma.video.updateMany({ where: { siteId: site.id }, data: { productUrl: null, productTitle: null } }),
    prisma.site.delete({ where: { id: site.id } }),
  ]);
  invalidateSites();
  audit(req, 'site.delete', 'site', site.id, site.name);
  res.status(204).send();
});

export default router;
