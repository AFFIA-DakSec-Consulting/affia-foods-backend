-- Restaurant profile: logo, description, contact phone, opening hours (Docs/24_vendor_profile_contract.md, 2026-10-14).
-- Additive only: four nullable columns, no default, no data rewrite (a nullable ADD COLUMN is metadata-only).
ALTER TABLE "Vendor" ADD COLUMN "logoUrl" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "openingHours" JSONB;
