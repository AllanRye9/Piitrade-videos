-- Client-generated key per upload attempt: a retry after a timeout returns the
-- video that was already created instead of creating a duplicate.
ALTER TABLE "Video" ADD COLUMN "uploadKey" TEXT;
CREATE UNIQUE INDEX "Video_uploadKey_key" ON "Video"("uploadKey");
