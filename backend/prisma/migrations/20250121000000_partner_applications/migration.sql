-- Self-service partner applications: a shop/app submits its listing API, we verify it against the open
-- listing spec, and an admin approves it into a Site (partner) that Piitrade Videos then promotes.

CREATE TABLE "PartnerApplication" (
  "id"                  TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "baseUrl"             TEXT NOT NULL,
  "host"                TEXT NOT NULL,
  "apiBase"             TEXT NOT NULL,
  "country"             TEXT NOT NULL DEFAULT '',
  "currency"            TEXT NOT NULL DEFAULT '',
  "contactName"         TEXT NOT NULL DEFAULT '',
  "contactEmail"        TEXT NOT NULL,
  "notes"               TEXT NOT NULL DEFAULT '',
  "status"              TEXT NOT NULL DEFAULT 'pending',
  "reviewNote"          TEXT NOT NULL DEFAULT '',
  "tokenHash"           TEXT NOT NULL,
  "verification"        TEXT NOT NULL DEFAULT '',
  "siteId"              TEXT,
  "credentialsClaimedAt" TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt"          TIMESTAMP(3),
  CONSTRAINT "PartnerApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartnerApplication_status_createdAt_idx" ON "PartnerApplication"("status", "createdAt");
CREATE INDEX "PartnerApplication_host_idx" ON "PartnerApplication"("host");
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
