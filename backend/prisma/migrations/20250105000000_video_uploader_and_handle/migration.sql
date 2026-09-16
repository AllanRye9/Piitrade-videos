-- AlterTable
ALTER TABLE "Video" ADD COLUMN "uploaderSessionId" TEXT;

-- CreateIndex
CREATE INDEX "Video_uploaderSessionId_idx" ON "Video"("uploaderSessionId");

-- AlterTable
ALTER TABLE "SessionProfile" ADD COLUMN "handle" TEXT;
ALTER TABLE "SessionProfile" ADD COLUMN "bio" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SessionProfile_handle_key" ON "SessionProfile"("handle");
