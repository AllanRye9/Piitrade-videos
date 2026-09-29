-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerSessionId" TEXT NOT NULL,
    "followingSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerSessionId_followingSessionId_key" ON "Follow"("followerSessionId", "followingSessionId");

-- CreateIndex
CREATE INDEX "Follow_followingSessionId_idx" ON "Follow"("followingSessionId");

-- CreateIndex
CREATE INDEX "Follow_followerSessionId_idx" ON "Follow"("followerSessionId");
