import { Router, Response } from 'express';
import { prisma } from '../../db';
import { AuthedRequest, requirePermission } from '../../middleware/requireAdmin';
import { HttpError } from '../../lib/core/httpError';
import { audit } from '../../lib/core/audit';

const router = Router();

function clean(body: any, partial = false) {
  const data: { name?: string; country?: string; city?: string } = {};
  if (!partial || body.name !== undefined) {
    data.name = String(body.name ?? '').trim().slice(0, 120);
    if (!data.name) throw new HttpError(400, 'A location name is required');
  }
  if (body.country !== undefined) data.country = String(body.country).trim().slice(0, 80);
  if (body.city !== undefined) data.city = String(body.city).trim().slice(0, 80);
  return data;
}

// GET /api/admin/locations/options — id+name only, for the pickers on the
// users/videos forms. Open to every admin so those forms work without
// "locations.view".
router.get('/options', async (_req, res: Response) => {
  const locations = await prisma.location.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  res.json({ locations });
});

// GET /api/admin/locations?q=
router.get('/', requirePermission('locations.view'), async (req: AuthedRequest, res: Response) => {
  const q = String(req.query.q || '').trim();
  const locations = await prisma.location.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { country: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }] }
      : undefined,
    orderBy: { name: 'asc' },
    include: { _count: { select: { videos: true, profiles: true } } },
  });
  res.json({
    locations: locations.map((l: any) => ({
      id: l.id,
      name: l.name,
      country: l.country,
      city: l.city,
      videoCount: l._count.videos,
      userCount: l._count.profiles,
      createdAt: l.createdAt,
    })),
  });
});

// POST /api/admin/locations  { name, country?, city? }
router.post('/', requirePermission('locations.create'), async (req: AuthedRequest, res: Response) => {
  const data = clean(req.body) as { name: string; country?: string; city?: string };
  try {
    const location = await prisma.location.create({ data });
    audit(req, 'location.create', 'location', location.id, location.name);
    res.status(201).json({ location });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'A location with that name already exists');
    throw err;
  }
});

// PATCH /api/admin/locations/:id
router.patch('/:id', requirePermission('locations.edit'), async (req: AuthedRequest, res: Response) => {
  const data = clean(req.body, true);
  try {
    const location = await prisma.location.update({ where: { id: req.params.id }, data });
    audit(req, 'location.update', 'location', location.id, location.name);
    res.json({ location });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new HttpError(409, 'A location with that name already exists');
    if (err?.code === 'P2025') throw new HttpError(404, 'Location not found');
    throw err;
  }
});

// DELETE /api/admin/locations/:id — videos/users that used it just lose the tag.
router.delete('/:id', requirePermission('locations.delete'), async (req: AuthedRequest, res: Response) => {
  const location = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!location) throw new HttpError(404, 'Location not found');
  await prisma.location.delete({ where: { id: location.id } });
  audit(req, 'location.delete', 'location', location.id, location.name);
  res.status(204).send();
});

export default router;
