-- AlterTable: expand Affiliate with contact/Stripe Connect fields
ALTER TABLE "Affiliate" ADD COLUMN "address" TEXT;
ALTER TABLE "Affiliate" ADD COLUMN "phone" TEXT;
ALTER TABLE "Affiliate" ADD COLUMN "website" TEXT;
ALTER TABLE "Affiliate" ADD COLUMN "stripeAccountId" TEXT;
ALTER TABLE "Affiliate" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending_stripe';

-- CreateTable: Commission
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "affiliateCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Commission_stripeInvoiceId_key" ON "Commission"("stripeInvoiceId");
CREATE INDEX "Commission_affiliateCode_status_idx" ON "Commission"("affiliateCode", "status");

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_affiliateCode_fkey" FOREIGN KEY ("affiliateCode") REFERENCES "Affiliate"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
