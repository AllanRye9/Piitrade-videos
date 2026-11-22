import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/httpError';
import { audit } from '../../lib/audit';
import { isPublicHttpUrl, newPostbackSecret, slugify } from '../../lib/sites';
import { validateListingsResponse } from '../../lib/listingSpec';

const router = Router();

function serialize(s: any, counts?: { clicks: number; conversions: number }) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    baseUrl: s.baseUrl,
    apiBase: s.apiBase,
    apiType: s.apiType,
    country: s.country,
    currency: s.currency,
    commissionPct: s.commissionPct,
    active: s.active,
    createdAt: s.createdAt,
    // Never list the whole secret — reveal/rotate are separate, audited actions.
    secretHint: `…${String(s.postbackSecret).slice(-4)}`,
    ...(counts ?? {}),
  };
}

function clean(body: any, partial: boolean) {
  const d: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    d.name = String(body.name ?? '').trim().slice(0, 80);
    if (!d.name) throw new HttpError(400, 'A shop name is required');
  }
  if (!partial || body.baseUrl !== undefined) {
    const base = String(body.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+/i.test(base)) throw new HttpError(400, 'Shop website must be a full http(s) URL, e.g. https://shop.example.com');
    d.baseUrl = base;
  }
  if (body.apiBase !== undefined) {
    const api = String(body.apiBase).trim().replace(/\/+$/, '');
    if (api && !isPublicHttpUrl(api)) throw new HttpError(400, 'API base must be a public http(s) URL');
    d.apiBase = api;
  }
  if (body.apiType !== undefined) d.apiType = String(body.apiType).trim().slice(0, 30) || 'piitrade';
  if (body.country !== undefined) d.country = String(body.country).trim().toUpperCase().slice(0, 2);
  if (body.currency !== undefined) d.currency = String(body.currency).trim().toUpperCase().slice(0, 3);
  if (body.commissionPct !== undefined) {
    const pct = Number(body.commissionPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, 'Commission must be between 0 and 100');
    d.commissionPct = pct;
  }
  if (body.active !== undefined) d.active = !!body.active;
  return d;
}

// GET /api/admin/sites
router.get('/', requirePermission('sites.view'), async (_req: AuthedRequest, res: Response) => {
  const [sites, clicks, convs] = await Promise.all([
    prisma.site.findMany({ orderBy: { name: 'asc' } }),
    prisma.click.groupBy({ by: ['siteId'], _count: { _all: true } }),
    prisma.conversion.groupBy({ by: ['siteId'], _count: { _all: true } }),
  ]);
  const c = new Map<string, number>(clicks.map((x: any) => [x.siteId as string, x._count._all as number]));
  const v = new Map<string, number>(convs.map((x: any) => [x.siteId as string, x._count._all as number]));
  res.json({ sites: sites.map((s: any) => serialize(s, { clicks: c.get(s.id) || 0, conversions: v.get(s.id) || 0 })) });
});

// POST /api/admin/sites — returns the new postback secret ONCE (it can be revealed again later by an admin who may edit shops).
router.post('/', requirePermission('sites.create'), async (req: AuthedRequest, res: Response) => {
  const data = clean(req.body, false) as any;
  const slug = slugify(String(req.body.slug || data.name));
  if (!slug) throw new HttpError(400, 'Could not derive a slug — give the shop a name');
  const secret = newPostbackSecret();
  try {
    const site = await prisma.site.create({ data: { ...data, slug, postbackSecret: secret } });
    audit(req, 'site.create', 'site', site.id, site.name);
    res.status(201).json({ site: serialize(site), postbackSecret: secret });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'A shop with that slug already exists');
    throw err;
  }
});

// PATCH /api/admin/sites/:id
router.patch('/:id', requirePermission('sites.edit'), async (req: AuthedRequest, res: Response) => {
  const data = clean(req.body, true);
  try {
    const site = await prisma.site.update({ where: { id: req.params.id }, data });
    audit(req, 'site.update', 'site', site.id, `${site.name}: ${Object.keys(data).join(', ')}`);
    res.json({ site: serialize(site) });
  } catch (err: any) {
    if (err?.code === 'P2025') throw new HttpError(404, 'Shop not found');
    throw err;
  }
});

// GET /api/admin/sites/:id/secret — reveal (audited)
router.get('/:id/secret', requirePermission('sites.edit'), async (req: AuthedRequest, res: Response) => {
  const site = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!site) throw new HttpError(404, 'Shop not found');
  audit(req, 'site.reveal_secret', 'site', site.id, site.name);
  res.json({ postbackSecret: site.postbackSecret });
});

// POST /api/admin/sites/:id/rotate-secret — the old secret stops working immediately.
router.post('/:id/rotate-secret', requirePermission('sites.edit'), async (req: AuthedRequest, res: Response) => {
  const secret = newPostbackSecret();
  try {
    const site = await prisma.site.update({ where: { id: req.params.id }, data: { postbackSecret: secret } });
    audit(req, 'site.rotate_secret', 'site', site.id, site.name);
    res.json({ postbackSecret: secret });
  } catch (err: any) {
    if (err?.code === 'P2025') throw new HttpError(404, 'Shop not found');
    throw err;
  }
});

// POST /api/admin/sites/:id/test — "Test connection": calls the shop's listing API and validates the response against the open spec.
router.post('/:id/test', requirePermission('sites.view'), async (req: AuthedRequest, res: Response) => {
  const site = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!site) throw new HttpError(404, 'Shop not found');
  if (!site.apiBase) throw new HttpError(400, 'This shop has no API base set');
  if (!isPublicHttpUrl(site.apiBase)) throw new HttpError(400, 'API base must be a public http(s) URL');

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(`${site.apiBase}/api/listings?q=a&sort=relevance&limit=3${site.country ? `&country=${encodeURIComponent(site.country)}` : ''}`, { signal: controller.signal, redirect: 'error' });
    const ms = Date.now() - started;
    if (!r.ok) {
      res.json({ ok: false, status: r.status, ms, issues: [{ level: 'error', message: `The listing endpoint answered HTTP ${r.status}` }] });
      return;
    }
    let body: unknown;
    try {
      body = await r.json();
    } catch {
      res.json({ ok: false, status: r.status, ms, issues: [{ level: 'error', message: 'The response was not valid JSON (is this the API host rather than the website?)' }] });
      return;
    }
    res.json({ status: r.status, ms, ...validateListingsResponse(body) });
  } catch (err: any) {
    res.json({ ok: false, ms: Date.now() - started, issues: [{ level: 'error', message: err?.name === 'AbortError' ? 'Timed out after 10 seconds' : `Could not reach the API: ${err?.message || err}` }] });
  } finally {
    clearTimeout(timer);
  }
});

// DELETE /api/admin/sites/:id — only shops with no click history; otherwise disable (the ledger must stay intact).
router.delete('/:id', requirePermission('sites.delete'), async (req: AuthedRequest, res: Response) => {
  const site = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!site) throw new HttpError(404, 'Shop not found');
  if ((await prisma.click.count({ where: { siteId: site.id } })) > 0) {
    throw new HttpError(409, 'This shop has click history, so it can’t be deleted. Disable it instead.');
  }
  await prisma.site.delete({ where: { id: site.id } });
  audit(req, 'site.delete', 'site', site.id, site.name);
  res.status(204).send();
});

export default router;
