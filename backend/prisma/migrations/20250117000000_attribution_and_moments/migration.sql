-- Shoppable moments: several products per video, optionally timed and positioned.
CREATE TABLE "VideoProduct" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "startMs" INTEGER NOT NULL DEFAULT 0,
    "endMs" INTEGER,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VideoProduct_videoId_idx" ON "VideoProduct"("videoId");
CREATE INDEX "VideoProduct_siteId_idx" ON "VideoProduct"("siteId");
CREATE INDEX "VideoProduct_url_idx" ON "VideoProduct"("url");

ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing single product links become one product covering the whole video.
INSERT INTO "VideoProduct" ("id", "videoId", "siteId", "url", "title", "startMs", "position")
SELECT 'vp' || md5(v."id" || random()::text), v."id", v."siteId", v."productUrl", v."productTitle", 0, 0
FROM "Video" v
WHERE v."siteId" IS NOT NULL AND v."productUrl" IS NOT NULL;

-- Attribution: commission + postback secret per site.
ALTER TABLE "Site" ADD COLUMN "commissionPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "postbackSecret" TEXT NOT NULL DEFAULT '';

UPDATE "Site" SET "postbackSecret" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE "postbackSecret" = '';

-- Click log and sales ledger.
CREATE TABLE "Click" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "productId" TEXT,
    "siteId" TEXT NOT NULL,
    "creatorSessionId" TEXT,
    "viewerHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Click_token_key" ON "Click"("token");
CREATE INDEX "Click_videoId_createdAt_idx" ON "Click"("videoId", "createdAt");
CREATE INDEX "Click_siteId_createdAt_idx" ON "Click"("siteId", "createdAt");
CREATE INDEX "Click_creatorSessionId_createdAt_idx" ON "Click"("creatorSessionId", "createdAt");
CREATE INDEX "Click_viewerHash_productId_idx" ON "Click"("viewerHash", "productId");

CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "clickId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "creatorSessionId" TEXT,
    "externalOrderId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT '',
    "commissionMinor" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversion_siteId_externalOrderId_key" ON "Conversion"("siteId", "externalOrderId");
CREATE INDEX "Conversion_creatorSessionId_status_idx" ON "Conversion"("creatorSessionId", "status");
CREATE INDEX "Conversion_siteId_createdAt_idx" ON "Conversion"("siteId", "createdAt");
CREATE INDEX "Conversion_videoId_idx" ON "Conversion"("videoId");

ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
