-- CreateTable
CREATE TABLE "SessionProfile" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "avatar" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionProfile_sessionId_key" ON "SessionProfile"("sessionId");
