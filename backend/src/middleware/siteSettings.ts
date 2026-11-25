import { Request, Response, NextFunction } from 'express';
import { getSettings } from '../lib/settings';

// Reads are always allowed; only writes can be paused.
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
// Admins must always be able to sign in and turn maintenance off; partners' signed sale reports and analytics
// pings must keep flowing (a missed conversion is lost money; an analytics ping is harmless).
const ALWAYS = /^\/api\/(admin|auth|config|health|events|attribution\/conversion)(\/|$)/;

const FEATURE_ROUTES: Array<{ feature: 'signups' | 'uploads' | 'comments' | 'partnerApplications'; test: RegExp; message: string; code: string }> = [
  { feature: 'signups', test: /^\/api\/account\/signup$/, message: 'New sign-ups are paused right now. Please try again later.', code: 'SIGNUPS_CLOSED' },
  { feature: 'uploads', test: /^\/api\/videos$/, message: 'Uploads are paused right now. Please try again later.', code: 'UPLOADS_CLOSED' },
  { feature: 'comments', test: /^\/api\/videos\/[^/]+\/comments$/, message: 'Comments are paused right now.', code: 'COMMENTS_CLOSED' },
  { feature: 'partnerApplications', test: /^\/api\/partners\/apply$/, message: 'Partner applications are closed right now.', code: 'PARTNER_APPLICATIONS_CLOSED' },
];

/**
 * Applies the admin's maintenance mode and feature switches to the public API (mounted on /api).
 * Fails open: if settings can't be read the request goes through — a settings outage must not take the site down.
 */
export async function enforceSiteSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (SAFE.has(req.method)) return next();
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
  if (ALWAYS.test(path)) return next();
  const s = await getSettings();
  if (s.maintenance.enabled) {
    res.status(503).json({ error: s.maintenance.message || 'Down for maintenance', code: 'MAINTENANCE' });
    return;
  }
  for (const r of FEATURE_ROUTES) {
    if (req.method === 'POST' && r.test.test(path) && !s.features[r.feature]) {
      res.status(403).json({ error: r.message, code: r.code });
      return;
    }
  }
  next();
}
