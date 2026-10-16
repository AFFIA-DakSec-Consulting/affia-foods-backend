-- AlterTable
ALTER TABLE "User" ADD COLUMN     "marketingOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CampaignDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignDelivery_userId_sentAt_idx" ON "CampaignDelivery"("userId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignDelivery_campaignId_userId_key" ON "CampaignDelivery"("campaignId", "userId");

