-- Shops, click attribution, conversions, creator ledger and pinned products.

CREATE TABLE "Site" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "slug"           TEXT NOT NULL,
  "baseUrl"        TEXT NOT NULL,
  "apiBase"        TEXT NOT NULL DEFAULT '',
  "apiType"        TEXT NOT NULL DEFAULT 'piitrade',
  "country"        TEXT NOT NULL DEFAULT '',
  "currency"       TEXT NOT NULL DEFAULT '',
  "commissionPct"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "postbackSecret" TEXT NOT NULL,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Site_slug_key" ON "Site"("slug");

CREATE TABLE "VideoProduct" (
  "id"        TEXT NOT NULL,
  "videoId"   TEXT NOT NULL,
  "siteId"    TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "urlKey"    TEXT NOT NULL,
  "title"     TEXT NOT NULL DEFAULT '',
  "startMs"   INTEGER NOT NULL DEFAULT 0,
  "endMs"     INTEGER,
  "x"         DOUBLE PRECISION,
  "y"         DOUBLE PRECISION,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoProduct_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VideoProduct_videoId_idx" ON "VideoProduct"("videoId");
CREATE INDEX "VideoProduct_urlKey_idx" ON "VideoProduct"("urlKey");

CREATE TABLE "Click" (
  "id"               TEXT NOT NULL,
  "token"            TEXT NOT NULL,
  "videoId"          TEXT,
  "siteId"           TEXT NOT NULL,
  "productId"        TEXT,
  "creatorSessionId" TEXT,
  "viewerHash"       TEXT,
  "ipHash"           TEXT,
  "url"              TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Click_token_key" ON "Click"("token");
CREATE INDEX "Click_videoId_idx" ON "Click"("videoId");
CREATE INDEX "Click_siteId_createdAt_idx" ON "Click"("siteId", "createdAt");
CREATE INDEX "Click_creatorSessionId_idx" ON "Click"("creatorSessionId");

CREATE TABLE "Conversion" (
  "id"              TEXT NOT NULL,
  "clickId"         TEXT NOT NULL,
  "siteId"          TEXT NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "amountMinor"     BIGINT NOT NULL,
  "currency"        TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Conversion_siteId_externalOrderId_key" ON "Conversion"("siteId", "externalOrderId");

CREATE TABLE "PayoutEntry" (
  "id"               TEXT NOT NULL,
  "conversionId"     TEXT NOT NULL,
  "creatorSessionId" TEXT NOT NULL,
  "amountMinor"      BIGINT NOT NULL,
  "currency"         TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayoutEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayoutEntry_conversionId_key" ON "PayoutEntry"("conversionId");
CREATE INDEX "PayoutEntry_creatorSessionId_status_idx" ON "PayoutEntry"("creatorSessionId", "status");

ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_siteId_fkey"  FOREIGN KEY ("siteId")  REFERENCES "Site"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Click"        ADD CONSTRAINT "Click_videoId_fkey"        FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Click"        ADD CONSTRAINT "Click_siteId_fkey"         FOREIGN KEY ("siteId")  REFERENCES "Site"("id")  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversion"   ADD CONSTRAINT "Conversion_clickId_fkey"   FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversion"   ADD CONSTRAINT "Conversion_siteId_fkey"    FOREIGN KEY ("siteId")  REFERENCES "Site"("id")  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayoutEntry"  ADD CONSTRAINT "PayoutEntry_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "Conversion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
