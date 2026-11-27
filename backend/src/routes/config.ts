import { Router, Request, Response } from 'express';
import { getSettings } from '../lib/core/settings';

/**
 * GET /api/config — what the web and mobile apps need to know at start-up: when to ask guests to sign in,
 * whether the site is in maintenance, the announcement banner, feature switches and the app version policy.
 * Public and cheap (cached server-side and for a short time by clients/CDN); contains nothing private.
 */
const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const s = await getSettings();
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ ...s, serverTime: new Date().toISOString() });
});

export default router;
