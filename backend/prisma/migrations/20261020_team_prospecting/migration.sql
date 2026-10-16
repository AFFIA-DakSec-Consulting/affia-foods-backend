-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminRole" TEXT,
ADD COLUMN     "adminPasscodeHash" TEXT,
ADD COLUMN     "adminDisabledAt" TIMESTAMP(3),
ADD COLUMN     "adminLastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RESTAURANT',
    "businessName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Thiès',
    "district" TEXT,
    "category" TEXT,
    "source" TEXT,
    "fit" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'TO_CONTACT',
    "nextFollowUpAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "assignedTo" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectEvent" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prospect_stage_nextFollowUpAt_idx" ON "Prospect"("stage", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "Prospect_kind_stage_idx" ON "Prospect"("kind", "stage");

-- CreateIndex
CREATE INDEX "ProspectEvent_prospectId_createdAt_idx" ON "ProspectEvent"("prospectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProspectEvent" ADD CONSTRAINT "ProspectEvent_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
