-- CreateTable
CREATE TABLE "ServiceArea" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceArea_isActive_idx" ON "ServiceArea"("isActive");

-- The module. Default = all of Senegal (no restriction): the former "8 km around Thiès" rule is gone. Thiès is kept as a ready-made area
-- so that narrowing the app down to it, if wanted, is one switch.
INSERT INTO "PlatformModule" ("code","parentCode","name","description","category","isEnabled","isCore","requires","requiresMode","sortOrder") VALUES
('delivery.service_areas', NULL, 'Zones de service', 'Décide où l’application est disponible. Par défaut : tout le Sénégal. Vous pouvez la limiter volontairement à certaines zones (villes ou rayons) : les restaurants et les adresses de livraison hors de ces zones sont alors refusés.', 'delivery', TRUE, FALSE, '{}', 'ALL', 5);

INSERT INTO "ModuleSetting" ("id","moduleCode","key","value","valueType","unit","label","description","minValue","maxValue","options") VALUES
(gen_random_uuid()::text, 'delivery.service_areas', 'mode', '"COUNTRY"'::jsonb, 'string', NULL, 'Disponibilité', 'COUNTRY = tout le Sénégal. AREAS = seulement les zones actives de la liste. Il faut au moins une zone active pour limiter.', NULL, NULL, '["COUNTRY","AREAS"]'::jsonb),
(gen_random_uuid()::text, 'delivery.service_areas', 'apply_to_customers', 'true'::jsonb, 'boolean', NULL, 'Limiter les adresses de livraison', 'En mode limité : une commande dont l’adresse (position sur la carte) est hors des zones est refusée.', NULL, NULL, NULL),
(gen_random_uuid()::text, 'delivery.service_areas', 'apply_to_vendors', 'true'::jsonb, 'boolean', NULL, 'Limiter les restaurants', 'En mode limité : un restaurant dont la position est hors des zones est refusé (inscription et changement de position).', NULL, NULL, NULL),
(gen_random_uuid()::text, 'delivery.service_areas', 'require_pin', 'false'::jsonb, 'boolean', NULL, 'Exiger une position sur la carte', 'En mode limité : le client doit placer son adresse sur la carte, sinon on ne peut pas vérifier qu’on livre chez lui.', NULL, NULL, NULL),
(gen_random_uuid()::text, 'delivery.service_areas', 'outside_message', '"Affia Foods n’est pas encore disponible à cet endroit."'::jsonb, 'string', NULL, 'Message hors zone', 'Texte montré quand une adresse ou un restaurant est hors des zones (200 caractères au plus).', NULL, NULL, NULL);

INSERT INTO "ServiceArea" ("id","name","lat","lng","radiusKm","isActive","sortOrder","updatedAt") VALUES
(gen_random_uuid()::text, 'Thiès', 14.7886, -16.926, 8, TRUE, 10, CURRENT_TIMESTAMP);
