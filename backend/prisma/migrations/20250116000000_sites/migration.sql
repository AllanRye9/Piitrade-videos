-- Admin-managed marketplaces/stores that videos link to.
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL DEFAULT '',
    "apiType" TEXT NOT NULL DEFAULT 'piitrade',
    "country" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT '',
    "listingPath" TEXT NOT NULL DEFAULT '/listings/{id}',
    "searchPath" TEXT NOT NULL DEFAULT '/listings?q={q}',
    "sellPath" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Site_slug_key" ON "Site"("slug");

ALTER TABLE "Video" ADD COLUMN "siteId" TEXT,
ADD COLUMN "productUrl" TEXT,
ADD COLUMN "productTitle" TEXT;

CREATE INDEX "Video_siteId_idx" ON "Video"("siteId");

ALTER TABLE "Video" ADD CONSTRAINT "Video_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
