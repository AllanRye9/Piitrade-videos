-- Site.embedOrigins exists in schema.prisma (and is read by /v/:id, /embed/:id and the click redirect)
-- but no migration ever created the column, so those routes failed on any migrated database.
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "embedOrigins" TEXT NOT NULL DEFAULT '';
