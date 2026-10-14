-- Restaurant profile, part 2: pickup notes for riders (Docs/24_vendor_profile_contract.md, 2026-10-15).
-- Additive only: one nullable column, no default, no data rewrite.
ALTER TABLE "Vendor" ADD COLUMN "pickupNotes" TEXT;
