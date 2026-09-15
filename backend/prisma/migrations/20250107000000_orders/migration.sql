-- CreateTable
CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sellerId" TEXT,
    "sellerName" TEXT,
    "sellerContact" TEXT,
    "marketplaceOrderId" TEXT,
    "marketplaceOrderNumber" TEXT,
    "deliveryName" TEXT NOT NULL,
    "deliveryPhone" TEXT NOT NULL,
    "deliveryAddress" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "paymentLast4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "price" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_sessionId_idx" ON "Order"("sessionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'OrderItem_orderId_fkey'
    ) THEN
        ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
