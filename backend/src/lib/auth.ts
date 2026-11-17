import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

const INSECURE_DEFAULT = 'dev-only-insecure-secret-change-me';
const TOKEN_TTL = '7d';

// The default secret is public (it's in this repo and docker-compose.yml), so
// anyone could forge an admin token with it. In production, if no real secret
// is configured, use a random per-process one instead: the service stays up,
// the admin dashboard is not forgeable, and admins just have to sign in again
// after each restart until JWT_SECRET is set.
const configured = process.env.JWT_SECRET;
const insecure = !configured || configured === INSECURE_DEFAULT;
const JWT_SECRET = insecure && process.env.NODE_ENV === 'production' ? randomBytes(48).toString('hex') : configured || INSECURE_DEFAULT;

if (insecure && process.env.NODE_ENV === 'production') {
  console.warn(
    'WARNING: JWT_SECRET is not set (or is the public default). Using a random per-process secret — admin sessions will not survive a restart. Set JWT_SECRET to a long random string.'
  );
}

/** The token only identifies the admin; role/permissions/disabled are always
 *  re-read from the database (see middleware/requireAdmin.ts) so changes take
 *  effect immediately instead of when the token expires. */
export interface AdminTokenPayload {
  sub: string; // admin user id
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AdminTokenPayload;
}

/** A real bcrypt hash of a random string — used to burn equal CPU time when a login names an unknown account. */
export const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 12);
