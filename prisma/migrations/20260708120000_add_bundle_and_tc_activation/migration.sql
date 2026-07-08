-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "subtamerKeyUsed" TEXT;

-- CreateTable
CREATE TABLE "TCExtensionActivation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activationKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TCExtensionActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TCExtensionActivation_userId_key" ON "TCExtensionActivation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TCExtensionActivation_activationKey_key" ON "TCExtensionActivation"("activationKey");

-- AddForeignKey
ALTER TABLE "TCExtensionActivation" ADD CONSTRAINT "TCExtensionActivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
