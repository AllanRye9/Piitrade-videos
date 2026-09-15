-- AlterTable
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "uploaderSessionId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Video_uploaderSessionId_idx" ON "Video"("uploaderSessionId");
