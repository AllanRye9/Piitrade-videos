-- Idempotent reconciliation migration.
--
-- WHY THIS EXISTS: during development, the SQL content of the
-- MarketplaceLink and SessionProfile migrations was revised several
-- times UNDER THE SAME migration filenames (rather than as new
-- migrations) while the schema was still being designed. If
-- `prisma migrate deploy` was ever run against an OLDER version of
-- those files, Prisma's migration tracker (`_prisma_migrations`)
-- permanently marks that migration ID as "already applied" and will
-- NEVER re-run it — even though its content later changed. That
-- leaves a live database silently stuck on an older column shape
-- while the generated Prisma Client (built from the current
-- schema.prisma) expects the newer one, which surfaces as a generic
-- "Internal server error" on anything touching those tables (e.g.
-- checkout's `GET /api/marketplace/account` call).
--
-- Every statement below is written to be safe to run regardless of
-- the database's actual starting state: a clean database with neither
-- table, a database with an older column shape, or a database already
-- fully caught up. This migration should always be a no-op once
-- applied — it is a one-time reconciliation, not a moving target.
-- From this point on, schema changes get NEW migration files, never
-- edits to old ones.

-- Drop artifacts from an abandoned in-development redesign (a
-- multi-marketplace-per-profile model) that was never part of any
-- released schema.prisma but may have been applied to a database
-- mid-development.
ALTER TABLE IF EXISTS "MarketplaceLink" DROP CONSTRAINT IF EXISTS "MarketplaceLink_sourceId_fkey";
DROP INDEX IF EXISTS "MarketplaceLink_sessionId_sourceId_key";
ALTER TABLE IF EXISTS "MarketplaceLink" DROP COLUMN IF EXISTS "sourceId";
DROP TABLE IF EXISTS "MarketplaceSource" CASCADE;

-- MarketplaceLink: ensure the table and every current column exist.
CREATE TABLE IF NOT EXISTS "MarketplaceLink" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "marketplaceToken" TEXT NOT NULL,
    "marketplaceUserId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketplaceLink_pkey" PRIMARY KEY ("id")
);

-- Added after the table may already have existed without it — default
-- to '' for any pre-existing rows (they'll simply be asked to log in
-- again on their next checkout, the same graceful path already used
-- for an expired/invalid refresh token), then drop the default so new
-- rows must supply a real value going forward.
ALTER TABLE "MarketplaceLink" ADD COLUMN IF NOT EXISTS "marketplaceRefreshToken" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MarketplaceLink" ALTER COLUMN "marketplaceRefreshToken" DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'MarketplaceLink_sessionId_key') THEN
    CREATE UNIQUE INDEX "MarketplaceLink_sessionId_key" ON "MarketplaceLink"("sessionId");
  END IF;
END $$;

-- SessionProfile: ensure the table and every current column exist.
CREATE TABLE IF NOT EXISTS "SessionProfile" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "avatar" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SessionProfile" ADD COLUMN IF NOT EXISTS "displayName" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'SessionProfile_sessionId_key') THEN
    CREATE UNIQUE INDEX "SessionProfile_sessionId_key" ON "SessionProfile"("sessionId");
  END IF;
END $$;
