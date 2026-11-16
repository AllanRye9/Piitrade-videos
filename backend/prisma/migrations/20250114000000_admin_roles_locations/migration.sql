-- Admin roles & permissions, audit log, locations, user suspension.

CREATE TYPE "AdminRole" AS ENUM ('PRIMARY', 'SECONDARY');

ALTER TABLE "AdminUser"
  ADD COLUMN "name"        TEXT NOT NULL DEFAULT '',
  ADD COLUMN "role"        "AdminRole" NOT NULL DEFAULT 'SECONDARY',
  ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "disabled"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- Existing deployments: the oldest admin becomes the primary admin; any other
-- existing admin keeps the access they had before (everything except managing
-- admins) as a secondary admin.
UPDATE "AdminUser" SET "role" = 'PRIMARY'
 WHERE "id" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1);

UPDATE "AdminUser" SET "permissions" = ARRAY[
  'users.view','users.create','users.edit','users.delete',
  'videos.view','videos.edit','videos.delete',
  'comments.view','comments.edit','comments.delete',
  'reports.view','reports.delete',
  'products.view','products.create','products.edit','products.delete',
  'locations.view','locations.create','locations.edit','locations.delete'
]::TEXT[] WHERE "role" = 'SECONDARY';

-- At most one primary admin, enforced by the database (also closes the race
-- where two first-registrations arrive at the same moment).
CREATE UNIQUE INDEX "AdminUser_single_primary" ON "AdminUser"("role") WHERE "role" = 'PRIMARY';

CREATE TABLE "AuditLog" (
  "id"         TEXT NOT NULL,
  "adminId"    TEXT,
  "adminEmail" TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId"   TEXT,
  "detail"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");

CREATE TABLE "Location" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "country"   TEXT NOT NULL DEFAULT '',
  "city"      TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

ALTER TABLE "User"           ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Video"          ADD COLUMN "locationId"  TEXT;
ALTER TABLE "SessionProfile" ADD COLUMN "locationId"  TEXT;

CREATE INDEX "Video_locationId_idx" ON "Video"("locationId");

ALTER TABLE "Video" ADD CONSTRAINT "Video_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SessionProfile" ADD CONSTRAINT "SessionProfile_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
