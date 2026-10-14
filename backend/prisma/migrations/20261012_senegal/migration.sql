-- Senegal (Thies) version: payment method of a payment, and the default map pin of a restaurant is now the centre of Thies.
ALTER TABLE "Payment" ADD COLUMN "method" TEXT;
ALTER TABLE "Vendor" ALTER COLUMN "lat" SET DEFAULT 14.7886;
ALTER TABLE "Vendor" ALTER COLUMN "lng" SET DEFAULT -16.926;
