-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "courierPayout" INTEGER,
ADD COLUMN     "deliveryFeeCustomer" INTEGER,
ADD COLUMN     "deliveryFeeOriginal" INTEGER,
ADD COLUMN     "deliverySubsidy" INTEGER,
ADD COLUMN     "merchantContribution" INTEGER,
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "promotionId" TEXT,
ADD COLUMN     "subscriptionId" TEXT;

-- AlterTable
ALTER TABLE "OrderGroup" ADD COLUMN     "courierPayout" INTEGER,
ADD COLUMN     "deliveryFeeCustomer" INTEGER,
ADD COLUMN     "deliveryFeeOriginal" INTEGER,
ADD COLUMN     "deliverySubsidy" INTEGER,
ADD COLUMN     "merchantContribution" INTEGER,
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "promotionId" TEXT,
ADD COLUMN     "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "PlatformModule" (
    "code" TEXT NOT NULL,
    "parentCode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isCore" BOOLEAN NOT NULL DEFAULT false,
    "requires" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresMode" TEXT NOT NULL DEFAULT 'ALL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformModule_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ModuleSetting" (
    "id" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" TEXT NOT NULL,
    "unit" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "options" JSONB,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleAuditLog" (
    "id" TEXT NOT NULL,
    "moduleCode" TEXT,
    "settingKey" TEXT,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'default',
    "label" TEXT NOT NULL,
    "minKm" DOUBLE PRECISION NOT NULL,
    "maxKm" DOUBLE PRECISION,
    "fee" INTEGER,
    "courierPayout" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierBonus" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "conditions" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CourierBonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "code" TEXT,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "fundedBy" TEXT NOT NULL DEFAULT 'PLATFORM',
    "merchantSharePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minCartAmount" INTEGER,
    "maxDistanceKm" DOUBLE PRECISION,
    "maxDiscountAmount" INTEGER,
    "eligibleCities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibleMerchants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "coinsCost" INTEGER,
    "requiresRedemption" BOOLEAN NOT NULL DEFAULT false,
    "maxUsesTotal" INTEGER,
    "maxUsesPerUser" INTEGER DEFAULT 1,
    "budgetTotal" INTEGER,
    "budgetSpent" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "platformShare" INTEGER NOT NULL,
    "merchantShare" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "coinsAmount" INTEGER,
    "coinsPercent" DOUBLE PRECISION,
    "minCart" INTEGER,
    "maxCoins" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LoyaltyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "orderRef" TEXT,
    "promotionId" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 30,
    "freeDeliveriesQuota" INTEGER,
    "minCartAmount" INTEGER,
    "maxDistanceKm" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "deliveriesUsed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PUSH',
    "segment" JSONB NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "promotionId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "openedCount" INTEGER NOT NULL DEFAULT 0,
    "convertedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingParityLog" (
    "id" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "legacyResult" JSONB NOT NULL,
    "newResult" JSONB NOT NULL,
    "hasDiff" BOOLEAN NOT NULL,
    "diffFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingParityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModuleSetting_moduleCode_key_key" ON "ModuleSetting"("moduleCode", "key");

-- CreateIndex
CREATE INDEX "ModuleAuditLog_changedAt_idx" ON "ModuleAuditLog"("changedAt");

-- CreateIndex
CREATE INDEX "ModuleAuditLog_moduleCode_changedAt_idx" ON "ModuleAuditLog"("moduleCode", "changedAt");

-- CreateIndex
CREATE INDEX "DeliveryZone_city_sortOrder_idx" ON "DeliveryZone"("city", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE INDEX "PromotionRedemption_userId_promotionId_idx" ON "PromotionRedemption"("userId", "promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRedemption_promotionId_orderRef_key" ON "PromotionRedemption"("promotionId", "orderRef");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_userId_createdAt_idx" ON "LoyaltyTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyTransaction_userId_orderRef_reason_key" ON "LoyaltyTransaction"("userId", "orderRef", "reason");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_refereeId_key" ON "Referral"("refereeId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "PricingParityLog_hasDiff_createdAt_idx" ON "PricingParityLog"("hasDiff", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformModule" ADD CONSTRAINT "PlatformModule_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "PlatformModule"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleSetting" ADD CONSTRAINT "ModuleSetting_moduleCode_fkey" FOREIGN KEY ("moduleCode") REFERENCES "PlatformModule"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_moduleCode_fkey" FOREIGN KEY ("moduleCode") REFERENCES "PlatformModule"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =====================================================================================================================
-- Seed (KRAVEO_SPEC_MODULES.md section 6, rule 8): reproduces the CURRENT behaviour, not the ideal one.
--   * base fee, extra-restaurant fee, small-order fee and restaurant limit are read from the legacy AppSetting 'fees' row when present.
--   * price_per_km = 0: today's fee does not depend on distance. Raise it from the back-office AFTER the cut-over.
--   * Coupons: the real rules of utils/validation.ts (the spec's draft values for KRAVEO20 / KRAVEO50 differed).
-- =====================================================================================================================
INSERT INTO "PlatformModule" ("code","parentCode","name","description","category","isEnabled","isCore","requires","requiresMode","sortOrder") VALUES
('delivery.base_pricing', NULL, 'Tarification de base', 'Calcule les frais de livraison : frais de prise en charge + (distance × prix/km). Module obligatoire.', 'delivery', TRUE, TRUE, '{}', 'ALL', 10),
('delivery.zone_pricing', NULL, 'Tarification par zones', 'Remplace le calcul base + km par une grille de tarifs par tranche de distance (table des zones). Prix plus lisibles pour le client.', 'delivery', FALSE, FALSE, '{delivery.base_pricing}', 'ALL', 20),
('delivery.surge_pricing', NULL, 'Majoration dynamique', 'Ajoute un supplément ou un multiplicateur selon la pluie, l''heure de pointe, la nuit ou la pénurie de livreurs.', 'delivery', FALSE, FALSE, '{delivery.base_pricing}', 'ALL', 30),
('delivery.multi_restaurant', NULL, 'Commande multi-restaurants', 'Regroupe plusieurs restaurants dans un même groupe de commande et calcule le coût de la tournée au niveau du groupe.', 'delivery', TRUE, FALSE, '{delivery.base_pricing}', 'ALL', 40),
('courier.base_payout', NULL, 'Rémunération de base du livreur', 'Définit ce que gagne le livreur par course (grille fixe, par distance ou mixte). Indépendant de ce que paie le client. Module obligatoire.', 'courier', TRUE, TRUE, '{}', 'ALL', 10),
('courier.bonuses', NULL, 'Bonus livreur', 'Ajoute des bonus à la rémunération (pluie, nuit, heure de pointe, zone difficile).', 'courier', FALSE, FALSE, '{courier.base_payout}', 'ALL', 20),
('courier.batch_payout', NULL, 'Rémunération des tournées', 'Calcule la rémunération au niveau du groupe de commandes puis la répartit, pour éviter double paiement ou sous-rémunération.', 'courier', FALSE, FALSE, '{courier.base_payout,delivery.multi_restaurant}', 'ALL', 30),
('marketing', NULL, 'Marketing (interrupteur général)', 'Interrupteur parent. Désactivé = aucune promotion, aucun code, aucun abonnement, aucune campagne n''est appliqué, même si les sous-modules sont actifs. N''affecte jamais les notifications de statut de commande.', 'marketing', TRUE, FALSE, '{}', 'ALL', 100),
('marketing.free_delivery', 'marketing', 'Livraison gratuite', 'Le client paie 0 FCFA de livraison selon des conditions (panier minimum, distance max, période). Le livreur est payé normalement ; la différence est financée par la plateforme et/ou le restaurant.', 'marketing', FALSE, FALSE, '{marketing}', 'ALL', 110),
('marketing.promo_codes', 'marketing', 'Codes promo', 'Codes saisis par le client donnant une réduction (montant ou pourcentage) sur la livraison ou le panier.', 'marketing', TRUE, FALSE, '{marketing}', 'ALL', 120),
('marketing.first_order', 'marketing', 'Offre première commande', 'Réduction ou livraison offerte à la première commande d''un nouveau client (promotions réservées à la première commande).', 'marketing', TRUE, FALSE, '{marketing}', 'ALL', 130),
('marketing.loyalty_coins', 'marketing', 'Kraveo Coins (fidélité)', 'Accumulation de points de fidélité et échange contre des coupons. Règles d''attribution et taux configurables.', 'marketing', TRUE, FALSE, '{marketing}', 'ALL', 140),
('marketing.subscription', 'marketing', 'Abonnement (Kraveo Plus)', 'Le client paie un abonnement et bénéficie de livraisons gratuites (quota ou illimité) sur les commandes éligibles.', 'marketing', FALSE, FALSE, '{marketing}', 'ALL', 150),
('marketing.referral', 'marketing', 'Parrainage', 'Un client parraine un nouvel utilisateur ; les deux reçoivent une récompense en coins à la première commande du filleul.', 'marketing', FALSE, FALSE, '{marketing.loyalty_coins}', 'ALL', 160),
('marketing.campaigns', 'marketing', 'Campagnes & push ciblé', 'Notifications marketing à des segments d''utilisateurs depuis le back-office, avec promotion attachée et mesure de conversion. Ne couvre jamais les notifications de statut de commande.', 'marketing', FALSE, FALSE, '{marketing}', 'ALL', 170),
('marketing.merchant_funded', 'marketing', 'Promotions cofinancées restaurant', 'Permet à un restaurant de financer tout ou partie d''une promotion. La part du restaurant est déduite de son reversement.', 'marketing', FALSE, FALSE, '{marketing.free_delivery,marketing.promo_codes}', 'ANY', 180),
('analytics', NULL, 'Rapports & statistiques', 'Consolide les stats commandes, le taux d''utilisation des coupons, le coût réel des promotions et la marge par commande.', 'analytics', TRUE, FALSE, '{}', 'ALL', 200);

INSERT INTO "ModuleSetting" ("id","moduleCode","key","value","valueType","unit","label","description","minValue","maxValue","options")
SELECT gen_random_uuid()::text, s.m, s.k, s.val, s.t, s.u, s.l, s.d, s.mn, s.mx, s.o FROM (VALUES
('delivery.base_pricing','base_fee',to_jsonb(COALESCE((SELECT "value"->>'baseFee' FROM "AppSetting" WHERE "key"='fees')::numeric, 500)),'money','FCFA','Frais de prise en charge','Montant fixe facturé pour toute livraison, quelle que soit la distance.',0,10000,NULL::jsonb),
('delivery.base_pricing','price_per_km','0'::jsonb,'money','FCFA/km','Prix par kilomètre','Montant ajouté par kilomètre entre le restaurant et le client. 0 = les frais ne dépendent pas de la distance (comportement actuel).',0,2000,NULL),
('delivery.base_pricing','min_fee','0'::jsonb,'money','FCFA','Frais minimum','Plancher des frais avant promotion.',0,10000,NULL),
('delivery.base_pricing','max_fee','5000'::jsonb,'money','FCFA','Frais maximum','Plafond des frais avant promotion.',0,50000,NULL),
('delivery.base_pricing','max_delivery_distance','100'::jsonb,'number','km','Distance maximale de livraison','Au-delà, la commande est refusée.',1,100,NULL),
('delivery.base_pricing','rounding','1'::jsonb,'number','FCFA','Arrondi','Les frais sont arrondis au multiple le plus proche.',1,500,NULL),
('delivery.base_pricing','small_order_below',to_jsonb(COALESCE((SELECT "value"->>'smallOrderBelow' FROM "AppSetting" WHERE "key"='fees')::numeric, 0)),'money','FCFA','Seuil petite commande','Sous ce sous-total, des frais de petite commande s''ajoutent. 0 = désactivé.',0,200000,NULL),
('delivery.base_pricing','small_order_fee',to_jsonb(COALESCE((SELECT "value"->>'smallOrderFee' FROM "AppSetting" WHERE "key"='fees')::numeric, 0)),'money','FCFA','Frais petite commande','Montant ajouté sous le seuil de petite commande.',0,5000,NULL),
('delivery.zone_pricing','fallback_to_formula','true'::jsonb,'boolean',NULL,'Repli sur la formule','Si la distance dépasse la dernière zone, utilise la formule base + km.',NULL,NULL,NULL),
('delivery.surge_pricing','rain_mode','false'::jsonb,'boolean',NULL,'Mode pluie','Interrupteur manuel : quand il est actif, le supplément pluie s''ajoute aux frais.',NULL,NULL,NULL),
('delivery.surge_pricing','rain_surcharge','200'::jsonb,'money','FCFA','Supplément pluie','Ajouté aux frais quand le mode pluie est actif.',0,3000,NULL),
('delivery.surge_pricing','rush_multiplier','1.2'::jsonb,'number','x','Multiplicateur heure de pointe','Multiplie les frais pendant les heures de pointe.',1,3,NULL),
('delivery.surge_pricing','rush_hours','[{"from":"12:00","to":"14:00"},{"from":"19:00","to":"21:30"}]'::jsonb,'json',NULL,'Heures de pointe','Plages horaires locales (heure de Dakar) de majoration.',NULL,NULL,NULL),
('delivery.surge_pricing','max_surge_total','800'::jsonb,'money','FCFA','Plafond de majoration','Les majorations cumulées ne peuvent pas dépasser ce montant.',0,5000,NULL),
('delivery.multi_restaurant','max_restaurants_per_group',to_jsonb(COALESCE((SELECT "value"->>'maxRestaurantsPerOrder' FROM "AppSetting" WHERE "key"='fees')::numeric, 3)),'number',NULL,'Restaurants max par commande','Nombre maximum de restaurants dans un même groupe.',2,6,NULL),
('delivery.multi_restaurant','extra_stop_fee',to_jsonb(COALESCE((SELECT "value"->>'extraRestaurantFee' FROM "AppSetting" WHERE "key"='fees')::numeric, 300)),'money','FCFA','Frais par arrêt supplémentaire','Facturé au client pour chaque restaurant au-delà du premier.',0,3000,NULL),
('delivery.multi_restaurant','max_detour_km','20'::jsonb,'number','km','Détour maximum','Distance max entre deux restaurants d''un même groupe.',0,20,NULL),
('courier.base_payout','mode','"per_zone"'::jsonb,'string',NULL,'Mode de calcul','per_zone (grille des zones), per_km (base + km) ou flat (montant fixe).',NULL,NULL,'["per_zone","per_km","flat"]'::jsonb),
('courier.base_payout','flat_amount','1000'::jsonb,'money','FCFA','Montant fixe par course','Utilisé si mode = flat.',0,10000,NULL),
('courier.base_payout','base_amount','400'::jsonb,'money','FCFA','Base livreur','Utilisé si mode = per_km (et en repli d''une zone sans montant).',0,10000,NULL),
('courier.base_payout','per_km','120'::jsonb,'money','FCFA/km','Prix/km livreur','Utilisé si mode = per_km (et en repli d''une zone sans montant).',0,2000,NULL),
('courier.base_payout','min_payout','700'::jsonb,'money','FCFA','Rémunération minimum','Un livreur ne gagne jamais moins par course, même si la livraison est gratuite pour le client.',0,10000,NULL),
('courier.base_payout','max_payout','10000'::jsonb,'money','FCFA','Rémunération maximum','Plafond de sécurité d''une course (protège contre une erreur de saisie).',0,50000,NULL),
('courier.batch_payout','extra_stop_payout','250'::jsonb,'money','FCFA','Rémunération arrêt supplémentaire','Ajoutée à la rémunération par restaurant supplémentaire.',0,3000,NULL),
('courier.batch_payout','split_strategy','"proportional_to_distance"'::jsonb,'string',NULL,'Répartition','equal ou proportional_to_distance.',NULL,NULL,'["equal","proportional_to_distance"]'::jsonb),
('marketing.free_delivery','default_min_cart','8000'::jsonb,'money','FCFA','Panier minimum par défaut','Panier minimum pour qu''une livraison gratuite s''applique.',0,100000,NULL),
('marketing.free_delivery','default_max_distance','5'::jsonb,'number','km','Distance maximale par défaut','Au-delà, la livraison gratuite ne s''applique pas.',0,50,NULL),
('marketing.free_delivery','max_subsidy_per_order','1200'::jsonb,'money','FCFA','Subvention max par commande','Plafond de ce que la plateforme finance par commande.',0,10000,NULL),
('marketing.free_delivery','monthly_budget','500000'::jsonb,'money','FCFA','Budget mensuel','Budget épuisé = livraison gratuite désactivée automatiquement jusqu''au mois suivant.',0,100000000,NULL),
('marketing.promo_codes','allow_stacking','false'::jsonb,'boolean',NULL,'Cumul de codes','Autorise le cumul de plusieurs promotions sur une même commande.',NULL,NULL,NULL),
('marketing.loyalty_coins','coins_value','20'::jsonb,'money','FCFA','Valeur indicative d''un coin','Équivalence utilisée pour le reporting du coût réel.',0,1000,NULL),
('marketing.loyalty_coins','expiry_days','0'::jsonb,'number','jours','Expiration des coins','Les coins non utilisés expirent après ce délai. 0 = jamais (comportement actuel).',0,3650,NULL),
('marketing.loyalty_coins','max_balance','100000'::jsonb,'number','coins','Solde maximum','Plafond du solde d''un utilisateur.',0,1000000,NULL),
('marketing.subscription','grace_period_days','2'::jsonb,'number','jours','Période de grâce','Jours de validité après expiration.',0,15,NULL),
('marketing.referral','referrer_reward','50'::jsonb,'number','coins','Récompense parrain','Coins versés au parrain à la première commande du filleul.',0,5000,NULL),
('marketing.referral','referee_reward','50'::jsonb,'number','coins','Récompense filleul','Coins versés au nouveau client.',0,5000,NULL),
('marketing.campaigns','daily_push_cap','2'::jsonb,'number',NULL,'Push marketing max/jour','Maximum de notifications marketing par utilisateur et par jour (hors statut de commande).',0,10,NULL),
('marketing.campaigns','quiet_hours','{"from":"22:00","to":"07:00"}'::jsonb,'json',NULL,'Heures silencieuses','Aucun push marketing pendant cette plage.',NULL,NULL,NULL),
('marketing.merchant_funded','max_merchant_share_pct','50'::jsonb,'number','%','Part max du restaurant','Un restaurant ne peut pas financer plus de ce pourcentage d''une promotion.',0,100,NULL)
) AS s(m,k,val,t,u,l,d,mn,mx,o);

-- Zones (courier payout grid: a business decision to confirm; customer fees only matter once delivery.zone_pricing is enabled).
INSERT INTO "DeliveryZone" ("id","city","label","minKm","maxKm","fee","courierPayout","sortOrder") VALUES
(gen_random_uuid()::text,'default','0–2 km',0,2,700,700,1),
(gen_random_uuid()::text,'default','2–5 km',2,5,1100,1000,2),
(gen_random_uuid()::text,'default','5–8 km',5,8,1600,1400,3),
(gen_random_uuid()::text,'default','8 km et +',8,NULL,NULL,NULL,4);

-- The four legacy coupons, with the rules of utils/validation.ts.
INSERT INTO "Promotion" ("id","moduleCode","name","description","code","type","value","minCartAmount","maxDiscountAmount","firstOrderOnly","maxUsesPerUser","coinsCost","requiresRedemption","priority","updatedAt") VALUES
(gen_random_uuid()::text,'marketing.first_order','Offre de bienvenue','20 % de réduction sur la première commande, plafonnée à 1000 FCFA.','BIENVENUE','PERCENT_OFF_CART',20,2500,1000,TRUE,1,NULL,FALSE,50,now()),
(gen_random_uuid()::text,'marketing.first_order','Offre de bienvenue (alias)','Alias historique de l''offre de bienvenue.','VITFIRST','PERCENT_OFF_CART',20,2500,1000,TRUE,1,NULL,FALSE,50,now()),
(gen_random_uuid()::text,'marketing.promo_codes','Kraveo 50','Réduction fixe de 1000 FCFA dès 3500 FCFA, une fois par client.','KRAVEO50','FIXED_OFF_CART',1000,3500,1000,FALSE,1,NULL,FALSE,30,now()),
(gen_random_uuid()::text,'marketing.promo_codes','Kraveo 20','Réduction fixe de 500 FCFA dès 2000 FCFA, débloquée par échange de 50 Kraveo Coins.','KRAVEO20','FIXED_OFF_CART',500,2000,500,FALSE,NULL,50,TRUE,30,now());

INSERT INTO "LoyaltyRule" ("id","name","description","triggerType","coinsAmount","isActive") VALUES
(gen_random_uuid()::text,'Commande livrée','Coins attribués à chaque commande livrée.','ORDER_COMPLETED',10,TRUE),
(gen_random_uuid()::text,'Parrainage','Coins versés au parrain à la première commande du filleul.','REFERRAL',50,FALSE);

-- Opening balances: one ledger row per existing balance, never an UPDATE of the legacy counter.
INSERT INTO "LoyaltyTransaction" ("id","userId","amount","reason","balanceAfter")
SELECT gen_random_uuid()::text, u."id", u."kraveoCoins", 'OPENING', u."kraveoCoins" FROM "User" u WHERE u."kraveoCoins" > 0;
