-- AlterTable
ALTER TABLE "Video" ADD COLUMN "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
-- GIN index for array-containment queries (Prisma's `has`/`hasSome`
-- filters on hashtags, used by GET /api/videos/hashtag/:tag) — a
-- plain btree index doesn't help array-containment lookups.
CREATE INDEX "Video_hashtags_idx" ON "Video" USING GIN ("hashtags");
