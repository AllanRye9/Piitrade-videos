import fs from 'fs';
import path from 'path';
import { prisma } from '../../db';
import { deleteFromR2ByUrl } from '../../lib/core/r2';

/** Deletes a stored file from R2 (when the DB holds an R2 URL) or from local disk (when it holds a filename). Legacy ImageKit URLs are left alone. */
export async function removeStoredFile(value: string, localDir: string): Promise<void> {
  if (/^https?:\/\//i.test(value)) {
    await deleteFromR2ByUrl(value);
    return;
  }
  const file = path.join(localDir, path.basename(value));
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Recomputes Video.comments from the real comment rows (top-level + replies),
 *  so counters stay right after deletions that cascade to replies. */
export async function recountComments(videoIds: string[]): Promise<void> {
  for (const id of new Set(videoIds)) {
    const count = await prisma.comment.count({ where: { videoId: id } });
    await prisma.video.update({ where: { id }, data: { comments: count } }).catch(() => {});
  }
}

/** Empty string / null → null (clear), otherwise the trimmed value. undefined → undefined (leave alone). */
export function optionalId(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return String(v);
}
