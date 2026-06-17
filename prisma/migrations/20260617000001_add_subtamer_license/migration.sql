-- CreateTable
CREATE TABLE "SubTamerLicense" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "licenseKey" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubTamerLicense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubTamerLicense_email_key" ON "SubTamerLicense"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SubTamerLicense_licenseKey_key" ON "SubTamerLicense"("licenseKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubTamerLicense_stripeCustomerId_key" ON "SubTamerLicense"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "SubTamerLicense_stripeSubscriptionId_key" ON "SubTamerLicense"("stripeSubscriptionId");
