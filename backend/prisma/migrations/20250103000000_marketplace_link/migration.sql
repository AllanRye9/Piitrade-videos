-- CreateTable
CREATE TABLE "MarketplaceLink" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "marketplaceToken" TEXT NOT NULL,
    "marketplaceUserId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceLink_sessionId_key" ON "MarketplaceLink"("sessionId");
