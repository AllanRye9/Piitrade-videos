import rateLimit from 'express-rate-limit';

// Identity here is whatever X-Session-Id the caller sends, not IP —
// this app is anonymous-by-default (see SessionProfile), so limiting
// by session is what actually stops one abusive session from hammering
// an endpoint, without punishing everyone behind the same NAT/CGNAT IP
// (common on mobile networks in the app's target market). Falls back
// to IP only for requests with no session header at all.
function keyBySession(req: { header(name: string): string | undefined; ip?: string }): string {
  return req.header('x-session-id')?.trim() || req.ip || 'unknown';
}

// Video uploads: expensive (transcode + storage) and the clearest
// spam/abuse vector on an otherwise-unauthenticated endpoint.
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyBySession,
  message: { error: 'Too many uploads — please try again later.' },
});

// Comments/reports/handle claims: cheap individually but easy to
// script against an anonymous session.
export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyBySession,
  message: { error: 'Too many requests — please slow down and try again shortly.' },
});

// Signup/login: brute-force/credential-stuffing protection. Keyed by
// IP (not session) since the whole point of login is to arrive from a
// session that doesn't yet know the account's real identity.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  message: { error: 'Too many attempts — please try again later.' },
});
