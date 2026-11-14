/**
 * One-off: copies every video, poster and avatar that still lives on
 * ImageKit (or any other http URL that isn't already R2) into R2, then
 * rewrites the DB row to the new R2 URL.
 *
 *   npm run storage:migrate            # do it
 *   npm run storage:migrate -- --dry   # just list what would move
 *
 * Safe to re-run: rows already pointing at R2 are skipped, and a row is
 * only updated after its upload succeeded. Old ImageKit files are NOT
 * deleted — remove them from the ImageKit dashboard once you have
 * verified the app plays everything from R2.
 */
import path from 'path';
import { v4 as uuid } from 'uuid';
import { prisma } from '../src/db';
import { isR2Configured, r2PublicUrl, uploadToR2, Folder } from '../src/lib/r2';

const dry = process.argv.includes('--dry');

async function copyToR2(url: string, folder: Folder): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(new URL(url).pathname) || (folder === 'videos' ? '.mp4' : '.jpg');
  const uploaded = await uploadToR2(buffer, `${uuid()}${ext}`, folder);
  if (!uploaded) throw new Error('R2 is not configured');
  return uploaded.url;
}

function needsMigration(value: string | null | undefined, publicUrl: string): value is string {
  return !!value && /^https?:\/\//i.test(value) && !value.startsWith(publicUrl + '/');
}

async function main() {
  if (!isR2Configured()) throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_URL first.');
  const publicUrl = r2PublicUrl()!;
  let moved = 0;
  let failed = 0;

  const videos = await prisma.video.findMany({ select: { id: true, filename: true, posterFilename: true } });
  for (const v of videos) {
    const data: { filename?: string; posterFilename?: string } = {};
    try {
      if (needsMigration(v.filename, publicUrl)) {
        console.log(`video ${v.id}: ${v.filename}`);
        if (!dry) data.filename = await copyToR2(v.filename, 'videos');
        moved++;
      }
      if (needsMigration(v.posterFilename, publicUrl)) {
        console.log(`poster ${v.id}: ${v.posterFilename}`);
        if (!dry) data.posterFilename = await copyToR2(v.posterFilename, 'posters');
        moved++;
      }
      if (!dry && Object.keys(data).length) await prisma.video.update({ where: { id: v.id }, data });
    } catch (err) {
      failed++;
      console.error(`  ! video ${v.id} skipped:`, err instanceof Error ? err.message : err);
    }
  }

  const profiles = await prisma.sessionProfile.findMany({ where: { avatar: { not: null } }, select: { sessionId: true, avatar: true } });
  for (const p of profiles) {
    if (!needsMigration(p.avatar, publicUrl)) continue;
    try {
      console.log(`avatar ${p.sessionId}: ${p.avatar}`);
      if (!dry) {
        const url = await copyToR2(p.avatar, 'avatars');
        await prisma.sessionProfile.update({ where: { sessionId: p.sessionId }, data: { avatar: url } });
      }
      moved++;
    } catch (err) {
      failed++;
      console.error(`  ! avatar ${p.sessionId} skipped:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`${dry ? 'Would migrate' : 'Migrated'} ${moved} asset(s); ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
