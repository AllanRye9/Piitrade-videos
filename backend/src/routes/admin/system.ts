import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../db';
import { AuthedRequest, requirePrimary } from '../../middleware/requireAdmin';
import { audit } from '../../lib/core/audit';
import { invalidateShopCache } from '../../lib/search/searchSites';
import { clearSettingsCache } from '../../lib/core/settings';

/** Primary-admin only: is the deployment healthy and fully configured? */
const router = Router();
router.use(requirePrimary);

const set = (name: string) => !!(process.env[name] || '').trim();

router.get('/', async (_req: AuthedRequest, res: Response) => {
  const t0 = Date.now();
  let db: { ok: boolean; ms: number; error?: string } = { ok: true, ms: 0 };
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    db.ms = Date.now() - t0;
  } catch (err: any) {
    db = { ok: false, ms: Date.now() - t0, error: String(err?.message || err).slice(0, 200) };
  }

  // Migrations that were applied (a deploy that forgot `prisma migrate deploy` shows up here).
  let migrations: { applied: number; latest: string | null; failed: number } | null = null;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL)::int AS applied,
              count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS failed,
              max(migration_name) AS latest FROM "_prisma_migrations"`
    )) as Array<{ applied: number; failed: number; latest: string | null }>;
    migrations = rows[0] ?? null;
  } catch {
    migrations = null;
  }
  let expected = 0;
  try {
    expected = fs.readdirSync(path.join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch {
    expected = 0;
  }

  let version = '';
  try {
    version = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version || '';
  } catch {
    version = '';
  }
  const mem = process.memoryUsage();
  res.json({
    db,
    migrations: migrations ? { ...migrations, expected } : null,
    runtime: { node: process.version, uptimeSeconds: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1048576), env: process.env.NODE_ENV || 'development', version },
    // Booleans only — never the values.
    config: {
      jwtSecret: set('JWT_SECRET'),
      adminSetupCode: set('ADMIN_SETUP_CODE'),
      emailProvider: set('RESEND_API_KEY'),
      appUrl: set('APP_URL'),
      allowedOrigins: set('ALLOWED_ORIGIN'),
      attributionSalt: set('ATTRIBUTION_SALT'),
      aiSearch: set('AI_SEARCH_API_KEY'),
      marketplaceApi: set('MARKETPLACE_API'),
      uploadDir: set('UPLOAD_DIR'),
    },
  });
});

// POST /api/admin/system/clear-caches — shop search cache and settings cache, e.g. after editing the DB by hand.
router.post('/clear-caches', async (req: AuthedRequest, res: Response) => {
  invalidateShopCache();
  clearSettingsCache();
  audit(req, 'system.clear-caches', 'system');
  res.json({ ok: true });
});

export default router;
