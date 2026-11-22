-- Saved items: products a viewer saved from a video to review later.
CREATE TABLE "SavedItem" (
  "id"        TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "videoId"   TEXT,
  "siteId"    TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "urlKey"    TEXT NOT NULL,
  "title"     TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavedItem_sessionId_urlKey_key" ON "SavedItem"("sessionId", "urlKey");
CREATE INDEX "SavedItem_sessionId_createdAt_idx" ON "SavedItem"("sessionId", "createdAt");
CREATE INDEX "SavedItem_siteId_createdAt_idx" ON "SavedItem"("siteId", "createdAt");
ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_siteId_fkey"  FOREIGN KEY ("siteId")  REFERENCES "Site"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
