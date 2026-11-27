import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const TOKEN_TTL = '7d';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  // Fail loudly rather than silently signing tokens with a known,
  // publicly-visible default secret in production.
  console.warn(
    'WARNING: JWT_SECRET is not set. Using an insecure default — set JWT_SECRET in production before exposing this service.'
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
