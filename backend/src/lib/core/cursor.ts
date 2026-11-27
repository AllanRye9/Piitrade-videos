/**
 * Keyset pagination cursor for newest-first lists: "<createdAt ms>_<id>".
 *
 * The old cursor was just a video id, resolved by Prisma as "start after this
 * row". If that video was deleted between page loads (an admin removal, the
 * uploader deleting it) Prisma found no cursor row and returned an EMPTY page,
 * so the feed silently stopped. A (createdAt, id) pair needs no row to exist.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.getTime()}_${id}`;
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== 'string') return null;
  const i = raw.indexOf('_');
  if (i <= 0) return null;
  const ms = Number(raw.slice(0, i));
  const id = raw.slice(i + 1);
  if (!Number.isFinite(ms) || ms <= 0 || !id) return null;
  const createdAt = new Date(ms);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

/** Prisma `where` fragment selecting rows strictly older than the cursor (matching createdAt desc, id desc ordering). */
export function olderThan(cursor: Cursor) {
  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
  };
}
