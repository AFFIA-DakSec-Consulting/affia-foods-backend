# Kraveo — Spécification d'architecture modulaire
## Livraison · Rémunération livreur · Marketing

> **Document de référence unique.** Il remplace et fusionne la spécification cible et le plan de migration. À remettre tel quel à l'agent chargé de retravailler l'architecture.

---

## 0. Mission

### Contexte

Kraveo est une application de livraison de repas (marché sénégalais, FCFA). Le backend existant fonctionne :

- **OrderGroups** : panier multi-restaurants, `POST /api/order-groups` crée un `OrderGroup` parent et N `Order` enfants.
- **Paiement unifié** : une seule transaction client, `splitGroupMoney` répartit l'argent entre restaurants en déduisant les commissions.
- **Frais groupés** : Base Fee pour le premier restaurant, Extra Fee réduite pour les suivants.
- **Coupons** : codés en dur dans `src/utils/validation.ts` (`BIENVENUE`/`VITFIRST` 20 % plafonné 1000 FCFA panier min 2500, `KRAVEO50` 1000 FCFA usage unique, `KRAVEO20` nécessitant 50 Kraveo Coins).
- **Kraveo Coins** : points de fidélité sur le profil, échange via `POST /api/coupons/redeem-coins`.
- **Push FCM** : `src/services/push/`, statuts de commande + messages ciblés sur `deviceTokens`.
- **Pricing** : `src/pricing.ts`, valeurs en dur, seuils de livraison gratuite inclus.
- **Stats** : recent addresses, stats commandes, taux d'utilisation des coupons.

### Problème

La logique métier est correcte mais **codée en dur et dispersée**. Conséquences :

1. Changer un prix ou créer un coupon exige un déploiement.
2. Le marketing est mélangé au calcul des prix ; impossible de le couper proprement.
3. 🔴 **La rémunération du livreur est dérivée de ce que paie le client.** C'est le défaut structurel principal : il rend toute livraison gratuite impossible à financer sainement.

### Objectif

Une architecture **modulaire pilotée par la base de données** :

- un module par responsabilité, activable/désactivable individuellement ;
- tous les paramètres (distances, prix, seuils, plafonds) modifiables depuis un back-office, sans déploiement ;
- un **module Marketing totalement séparé** du calcul de base ;
- chaque module et chaque paramètre porte sa **description lisible** en base ;
- aucune régression sur l'existant.

### Règles non négociables

| # | Règle |
|---|---|
| 1 | **Trois montants distincts** : ce que le client paie, ce que le livreur gagne, ce que la plateforme finance. Jamais confondus. |
| 2 | **La rémunération du livreur ne dépend JAMAIS de ce que paie le client.** Elle dépend du travail effectué. |
| 3 | **Aucune valeur monétaire ou de distance en dur** dans le code. Tout vient de `module_settings` ou `delivery_zones`. |
| 4 | **Le marketing s'applique APRÈS** le calcul de base, comme une couche de réduction. Il n'est jamais appelé par le moteur de prix. |
| 5 | **Snapshot immuable** : chaque commande fige les montants et la config utilisée. Changer un prix demain ne modifie jamais l'historique. |
| 6 | **Les notifications transactionnelles ne sont pas du marketing.** Couper le module marketing ne doit jamais empêcher un client de suivre sa commande. |
| 7 | **Migration sans régression** : shadow mode obligatoire, bascule uniquement à 0 écart sur 7 jours. |
| 8 | **Le seed reproduit le comportement ACTUEL**, pas le comportement idéal. Les prix s'ajustent après la bascule, depuis le back-office. |

---

## Sommaire

1. [État des lieux : existant vs cible](#1-état-des-lieux--existant-vs-cible)
2. [Mapping code actuel → module cible](#2-mapping-code-actuel--module-cible)
3. [Architecture de dossiers cible](#3-architecture-de-dossiers-cible)
4. [Registre des modules](#4-registre-des-modules)
5. [Schéma de base de données](#5-schéma-de-base-de-données)
6. [Données initiales (seed)](#6-données-initiales-seed)
7. [Détail fonctionnel de chaque module](#7-détail-fonctionnel-de-chaque-module)
8. [Pipeline de calcul d'une commande](#8-pipeline-de-calcul-dune-commande)
9. [Snapshot enregistré sur la commande](#9-snapshot-enregistré-sur-la-commande)
10. [API d'administration](#10-api-dadministration)
11. [Garde-fous de rentabilité](#11-garde-fous-de-rentabilité)
12. [Exemple complet chiffré](#12-exemple-complet-chiffré)
13. [Stratégie de migration](#13-stratégie-de-migration)
14. [Plan par phases](#14-plan-par-phases)
15. [Points techniques critiques](#15-points-techniques-critiques)
16. [Risques et parades](#16-risques-et-parades)
17. [Checklist de démarrage](#17-checklist-de-démarrage)

---

## 1. État des lieux : existant vs cible

| Domaine | Existant | Statut | Action |
|---|---|---|---|
| Groupes de commandes | `OrderGroup` + `Order` enfants | ✅ Solide | **Conserver**, encapsuler dans `delivery.multi_restaurant` |
| Paiement unifié | Transaction unique | ✅ Solide | Conserver |
| Split d'argent | `splitGroupMoney` | ⚠️ À étendre | Doit gérer subvention plateforme et contribution restaurant |
| Frais groupés | Base Fee + Extra Fee en dur | ⚠️ À externaliser | → `module_settings.extra_stop_fee` |
| Calcul des prix | `pricing.ts` | ⚠️ Valeurs en dur | → `delivery.base_pricing` + `delivery.zone_pricing` |
| Coupons | `validation.ts` | ❌ En dur | → table `promotions` + `marketing.promo_codes` |
| Offre 1re commande | `BIENVENUE` / `VITFIRST` | ❌ En dur | → `marketing.first_order` |
| Kraveo Coins | Compteur profil + redeem | ⚠️ Partiel | → `marketing.loyalty_coins` avec ledger |
| Push FCM | `services/push/` | ⚠️ Mélangé | → scinder transactionnel / `marketing.campaigns` |
| Stats / rapports | Dispersés | ⚠️ Dispersé | → module `analytics` |
| Livraison gratuite | Seuils dans `pricing.ts` | ❌ En dur | → `marketing.free_delivery` |
| Rémunération livreur | Dérivée des frais client | 🔴 **À corriger** | → `courier.base_payout`, découplée |
| Abonnement | Inexistant | ❌ | → `marketing.subscription` |
| Promo cofinancée resto | Inexistante | ❌ | → `marketing.merchant_funded` |
| Parrainage | Inexistant | ❌ | → `marketing.referral` |
| Registre de modules | Inexistant | ❌ | → `platform_modules` + `module_settings` |

---

## 2. Mapping code actuel → module cible

| Code actuel | Devient | Nature du changement |
|---|---|---|
| `src/utils/validation.ts` (coupons) | `modules/marketing/promotions/promotion.validator.ts` | Les règles restent, les **valeurs** viennent de `promotions` |
| `BIENVENUE` 20 % / 1000 FCFA / panier 2500 | Ligne `promotions` : `type=PERCENT_OFF_CART`, `value=20`, `max_discount_amount=1000`, `min_cart_amount=2500`, `first_order_only=true` | Donnée, plus code |
| `KRAVEO50` 1000 FCFA usage unique | Ligne `promotions` : `type=FIXED_OFF_CART`, `value=1000`, `max_uses_per_user=1` | Donnée |
| `KRAVEO20` (50 coins) | Ligne `promotions` : `coins_cost=50`, `requires_redemption=true` | Donnée |
| `POST /api/coupons/redeem-coins` | `modules/marketing/loyalty/` | URL conservée, délègue au module |
| `pricing.ts` — base fee, extra fee | `modules/delivery/pricing/` + `module_settings` | Valeurs externalisées |
| `pricing.ts` — seuil livraison gratuite | `marketing.free_delivery` | **Sort du pricing**, passe côté marketing |
| `splitGroupMoney` | `modules/marketing/funding/` + `orders/` | Étendu : `delivery_subsidy` + `merchant_contribution` |
| `src/services/push/` | `core/notifications/` (transactionnel) **et** `modules/marketing/campaigns/` (marketing) | **Scission obligatoire** (règle n°6) |
| Stats commandes / recent addresses | `modules/analytics/` | Regroupement |
| `POST /api/order-groups` | Inchangé | Consomme `PricingPipeline` |

---

## 3. Architecture de dossiers cible

```
src/
├─ core/
│  ├─ modules/
│  │  ├─ module-registry.service.ts   # isEnabled(), getSetting(), cache
│  │  ├─ module-guard.ts              # @RequiresModule('marketing.free_delivery')
│  │  ├─ module-audit.service.ts
│  │  └─ admin/                       # toggle, settings, audit-log
│  └─ notifications/                  # push TRANSACTIONNEL — jamais coupé
│
├─ modules/
│  ├─ delivery/
│  │  ├─ pricing/                     # base_pricing, zone_pricing
│  │  ├─ surge/                       # surge_pricing
│  │  ├─ groups/                      # multi_restaurant (EXISTANT, déplacé)
│  │  └─ delivery-pricing.engine.ts   # orchestrateur étape 1
│  │
│  ├─ courier/
│  │  ├─ payout/                      # base_payout
│  │  ├─ bonuses/                     # bonuses
│  │  └─ batch/                       # batch_payout
│  │
│  ├─ marketing/                      # ← module totalement à part
│  │  ├─ promotions/                  # promo_codes, free_delivery, first_order
│  │  ├─ loyalty/                     # Kraveo Coins
│  │  ├─ subscriptions/               # Kraveo Plus
│  │  ├─ campaigns/                   # push MARKETING, segments
│  │  ├─ referral/                    # parrainage
│  │  ├─ funding/                     # merchant_funded, répartition
│  │  └─ marketing.engine.ts          # orchestrateur étapes 3 & 4
│  │
│  ├─ analytics/                      # rapports, marge, budget promo
│  └─ orders/                         # existant, consomme les engines
│
└─ shared/
   └─ pricing/
      ├─ pricing.pipeline.ts          # delivery → courier → marketing
      └─ pricing-snapshot.ts
```

**Règle d'isolation** : `orders/` ne connaît ni les prix ni les promos. Il appelle `PricingPipeline.compute(context)` et reçoit un résultat figé.

---

## 4. Registre des modules

```
┌─────────────────────────────────────────────────────────────┐
│ DELIVERY                                                    │
│  ├─ delivery.base_pricing        [core, non désactivable]   │
│  ├─ delivery.zone_pricing        zones tarifaires           │
│  ├─ delivery.surge_pricing       majoration (pluie, rush)   │
│  └─ delivery.multi_restaurant    commande multi-restaurants │
├─────────────────────────────────────────────────────────────┤
│ COURIER                                                     │
│  ├─ courier.base_payout          [core, non désactivable]   │
│  ├─ courier.bonuses              bonus (pluie, nuit, rush)  │
│  └─ courier.batch_payout         paiement des tournées      │
├─────────────────────────────────────────────────────────────┤
│ MARKETING (module à part)                                   │
│  ├─ marketing                    [interrupteur parent]      │
│  ├─ marketing.free_delivery      livraison gratuite         │
│  ├─ marketing.promo_codes        codes promo                │
│  ├─ marketing.first_order        offre 1re commande         │
│  ├─ marketing.loyalty_coins      Kraveo Coins               │
│  ├─ marketing.subscription       abonnement Kraveo Plus     │
│  ├─ marketing.referral           parrainage                 │
│  ├─ marketing.campaigns          push ciblé / campagnes     │
│  └─ marketing.merchant_funded    promos cofinancées resto   │
├─────────────────────────────────────────────────────────────┤
│ ANALYTICS                                                   │
│  └─ analytics                    rapports & pilotage        │
└─────────────────────────────────────────────────────────────┘
```

### Dépendances

| Module | Requiert | Mode |
|---|---|---|
| `marketing.*` (tous les sous-modules) | `marketing` | ALL |
| `marketing.merchant_funded` | `marketing.free_delivery` **ou** `marketing.promo_codes` | ANY |
| `marketing.referral` | `marketing.loyalty_coins` | ALL |
| `courier.batch_payout` | `courier.base_payout` + `delivery.multi_restaurant` | ALL |
| `delivery.zone_pricing`, `delivery.surge_pricing`, `delivery.multi_restaurant` | `delivery.base_pricing` | ALL |

> Si `marketing` est désactivé, **tous** ses sous-modules sont ignorés, quel que soit leur état individuel.

---

## 5. Schéma de base de données

PostgreSQL. Adaptable à TypeORM, Prisma ou Django ORM.

### 5.1 Socle

```sql
CREATE TABLE platform_modules (
  code              VARCHAR(64) PRIMARY KEY,              -- 'marketing.free_delivery'
  parent_code       VARCHAR(64) REFERENCES platform_modules(code),
  name              VARCHAR(120) NOT NULL,
  description       TEXT NOT NULL,                        -- explication lisible back-office
  category          VARCHAR(32) NOT NULL,                 -- delivery | courier | marketing | analytics
  is_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  is_core           BOOLEAN NOT NULL DEFAULT FALSE,       -- TRUE = non désactivable
  requires          VARCHAR(64)[] NOT NULL DEFAULT '{}',
  requires_mode     VARCHAR(3) NOT NULL DEFAULT 'ALL',    -- ALL | ANY
  sort_order        INT NOT NULL DEFAULT 0,
  updated_by        UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE module_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code    VARCHAR(64) NOT NULL REFERENCES platform_modules(code) ON DELETE CASCADE,
  key            VARCHAR(80) NOT NULL,
  value          JSONB NOT NULL,
  value_type     VARCHAR(16) NOT NULL,                    -- number|boolean|string|json|money
  unit           VARCHAR(16),                             -- FCFA | km | % | min | coins
  label          VARCHAR(120) NOT NULL,
  description    TEXT NOT NULL,
  min_value      NUMERIC,
  max_value      NUMERIC,
  updated_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module_code, key)
);

CREATE TABLE module_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code  VARCHAR(64),
  setting_key  VARCHAR(80),
  action       VARCHAR(24) NOT NULL,                      -- ENABLE|DISABLE|UPDATE_SETTING|UPDATE_ZONE
  old_value    JSONB,
  new_value    JSONB,
  changed_by   UUID,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.2 Livraison

```sql
CREATE TABLE delivery_zones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city           VARCHAR(80) NOT NULL DEFAULT 'default',  -- grille par ville (Dakar, Thiès…)
  label          VARCHAR(80) NOT NULL,
  min_km         NUMERIC(6,2) NOT NULL,
  max_km         NUMERIC(6,2),                            -- NULL = illimité
  fee            INTEGER,                                 -- FCFA ; NULL = calcul spécifique
  courier_payout INTEGER,                                 -- rémunération livreur pour la zone
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INT NOT NULL DEFAULT 0
);

CREATE TABLE courier_bonuses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(80) NOT NULL,
  description  TEXT NOT NULL,
  trigger_type VARCHAR(24) NOT NULL,                      -- RAIN|NIGHT|RUSH_HOUR|ZONE|MANUAL
  amount       INTEGER NOT NULL,
  conditions   JSONB,                                     -- {"from":"22:00","to":"06:00"}
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);
```

### 5.3 Marketing — promotions

```sql
CREATE TABLE promotions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code         VARCHAR(64) NOT NULL REFERENCES platform_modules(code),
  name                VARCHAR(120) NOT NULL,
  description         TEXT NOT NULL,
  code                VARCHAR(40) UNIQUE,                 -- NULL si automatique
  type                VARCHAR(24) NOT NULL,
    -- FREE_DELIVERY | PERCENT_OFF_DELIVERY | FIXED_OFF_DELIVERY
    -- PERCENT_OFF_CART | FIXED_OFF_CART
  value               NUMERIC,
  funded_by           VARCHAR(16) NOT NULL DEFAULT 'PLATFORM', -- PLATFORM|MERCHANT|SPLIT
  merchant_share_pct  NUMERIC(5,2) DEFAULT 0,
  -- Conditions
  min_cart_amount     INTEGER,
  max_distance_km     NUMERIC(6,2),
  max_discount_amount INTEGER,
  eligible_cities     VARCHAR(80)[],
  eligible_merchants  UUID[],
  first_order_only    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Fidélité
  coins_cost          INT,                                -- NULL = non achetable en coins
  requires_redemption BOOLEAN NOT NULL DEFAULT FALSE,
  -- Limites
  max_uses_total      INT,
  max_uses_per_user   INT DEFAULT 1,
  budget_total        INTEGER,
  budget_spent        INTEGER NOT NULL DEFAULT 0,
  -- Période & priorité
  starts_at           TIMESTAMPTZ,
  ends_at             TIMESTAMPTZ,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  priority            INT NOT NULL DEFAULT 0,
  stackable           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE promotion_redemptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id    UUID NOT NULL REFERENCES promotions(id),
  user_id         UUID NOT NULL,
  order_group_id  UUID NOT NULL,
  discount_amount INTEGER NOT NULL,
  platform_share  INTEGER NOT NULL,
  merchant_share  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.4 Marketing — fidélité (Kraveo Coins)

```sql
CREATE TABLE loyalty_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(80) NOT NULL,
  description   TEXT NOT NULL,
  trigger_type  VARCHAR(32) NOT NULL,     -- ORDER_COMPLETED|SIGNUP|REFERRAL|REVIEW
  coins_amount  INT,
  coins_percent NUMERIC(5,2),             -- % du panier converti en coins
  min_cart      INTEGER,
  max_coins     INT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE loyalty_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  amount         INT NOT NULL,            -- + gain, − dépense
  reason         VARCHAR(32) NOT NULL,    -- EARNED_ORDER|REDEEMED_COUPON|EXPIRED|ADMIN|REFERRAL
  order_group_id UUID,
  promotion_id   UUID,
  balance_after  INT NOT NULL,            -- audit
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, order_group_id, reason) -- idempotence
);
```

### 5.5 Marketing — abonnement, campagnes, parrainage

```sql
CREATE TABLE subscription_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(80) NOT NULL,
  description           TEXT NOT NULL,
  price                 INTEGER NOT NULL,
  duration_days         INT NOT NULL DEFAULT 30,
  free_deliveries_quota INT,                    -- NULL = illimité
  min_cart_amount       INTEGER,
  max_distance_km       NUMERIC(6,2),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  plan_id         UUID NOT NULL REFERENCES subscription_plans(id),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  deliveries_used INT NOT NULL DEFAULT 0,
  status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'  -- ACTIVE|EXPIRED|CANCELLED
);

CREATE TABLE campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(120) NOT NULL,
  description     TEXT NOT NULL,
  channel         VARCHAR(16) NOT NULL DEFAULT 'PUSH',   -- PUSH|SMS|IN_APP
  segment         JSONB NOT NULL,                        -- {"last_order_days_gt":30,"city":"Dakar"}
  title           VARCHAR(120),
  body            TEXT,
  promotion_id    UUID REFERENCES promotions(id),
  scheduled_at    TIMESTAMPTZ,
  status          VARCHAR(16) NOT NULL DEFAULT 'DRAFT',  -- DRAFT|SCHEDULED|SENT|CANCELLED
  sent_count      INT DEFAULT 0,
  opened_count    INT DEFAULT 0,
  converted_count INT DEFAULT 0
);

CREATE TABLE referrals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id    UUID NOT NULL,
  referee_id     UUID NOT NULL UNIQUE,
  code           VARCHAR(40) NOT NULL,
  status         VARCHAR(16) NOT NULL DEFAULT 'PENDING', -- PENDING|REWARDED|CANCELLED
  rewarded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.6 Contrôle de migration

```sql
CREATE TABLE pricing_parity_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_group_id UUID NOT NULL,
  legacy_result  JSONB NOT NULL,
  new_result     JSONB NOT NULL,
  has_diff       BOOLEAN NOT NULL,
  diff_fields    VARCHAR(64)[],
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.7 Extension de `order_groups`

```sql
ALTER TABLE order_groups
  ADD COLUMN delivery_fee_original  INTEGER,
  ADD COLUMN delivery_fee_customer  INTEGER,
  ADD COLUMN courier_payout         INTEGER,
  ADD COLUMN delivery_subsidy       INTEGER DEFAULT 0,
  ADD COLUMN merchant_contribution  INTEGER DEFAULT 0,
  ADD COLUMN promotion_id           UUID REFERENCES promotions(id),
  ADD COLUMN subscription_id        UUID REFERENCES subscriptions(id),
  ADD COLUMN pricing_snapshot       JSONB;
```

---

## 6. Données initiales (seed)

### 6.1 Modules

```sql
INSERT INTO platform_modules (code, parent_code, name, description, category, is_enabled, is_core, requires, requires_mode, sort_order) VALUES

-- DELIVERY
('delivery.base_pricing', NULL, 'Tarification de base',
 'Calcule les frais de livraison : frais de prise en charge + (distance × prix/km). Module obligatoire.',
 'delivery', TRUE, TRUE, '{}', 'ALL', 10),

('delivery.zone_pricing', NULL, 'Tarification par zones',
 'Remplace le calcul base + km par une grille de tarifs par tranche de distance (table delivery_zones). Prix plus lisibles pour le client.',
 'delivery', FALSE, FALSE, '{delivery.base_pricing}', 'ALL', 20),

('delivery.surge_pricing', NULL, 'Majoration dynamique',
 'Ajoute un supplément ou un multiplicateur selon la pluie, l''heure de pointe, la nuit ou la pénurie de livreurs.',
 'delivery', FALSE, FALSE, '{delivery.base_pricing}', 'ALL', 30),

('delivery.multi_restaurant', NULL, 'Commande multi-restaurants',
 'Regroupe plusieurs restaurants dans un même OrderGroup et calcule le coût de la tournée au niveau du groupe.',
 'delivery', TRUE, FALSE, '{delivery.base_pricing}', 'ALL', 40),

-- COURIER
('courier.base_payout', NULL, 'Rémunération de base du livreur',
 'Définit ce que gagne le livreur par course (grille fixe, par distance ou mixte). Indépendant de ce que paie le client. Module obligatoire.',
 'courier', TRUE, TRUE, '{}', 'ALL', 10),

('courier.bonuses', NULL, 'Bonus livreur',
 'Ajoute des bonus à la rémunération (pluie, nuit, heure de pointe, zone difficile).',
 'courier', FALSE, FALSE, '{courier.base_payout}', 'ALL', 20),

('courier.batch_payout', NULL, 'Rémunération des tournées',
 'Calcule la rémunération au niveau du groupe de commandes puis la répartit, pour éviter double paiement ou sous-rémunération.',
 'courier', FALSE, FALSE, '{courier.base_payout,delivery.multi_restaurant}', 'ALL', 30),

-- MARKETING
('marketing', NULL, 'Marketing (interrupteur général)',
 'Interrupteur parent. Désactivé = aucune promotion, aucun code, aucun abonnement, aucune campagne n''est appliqué, même si les sous-modules sont actifs. N''affecte jamais les notifications de statut de commande.',
 'marketing', TRUE, FALSE, '{}', 'ALL', 100),

('marketing.free_delivery', 'marketing', 'Livraison gratuite',
 'Le client paie 0 FCFA de livraison selon des conditions (panier minimum, distance max, période). Le livreur est payé normalement ; la différence est financée par la plateforme et/ou le restaurant.',
 'marketing', FALSE, FALSE, '{marketing}', 'ALL', 110),

('marketing.promo_codes', 'marketing', 'Codes promo',
 'Codes saisis par le client donnant une réduction (montant ou pourcentage) sur la livraison ou le panier.',
 'marketing', TRUE, FALSE, '{marketing}', 'ALL', 120),

('marketing.first_order', 'marketing', 'Offre première commande',
 'Réduction ou livraison offerte automatiquement à la première commande d''un nouveau client.',
 'marketing', TRUE, FALSE, '{marketing}', 'ALL', 130),

('marketing.loyalty_coins', 'marketing', 'Kraveo Coins (fidélité)',
 'Accumulation de points de fidélité et échange contre des coupons. Règles d''attribution et taux configurables.',
 'marketing', TRUE, FALSE, '{marketing}', 'ALL', 140),

('marketing.subscription', 'marketing', 'Abonnement (Kraveo Plus)',
 'Le client paie un abonnement et bénéficie de livraisons gratuites (quota ou illimité) sur les commandes éligibles.',
 'marketing', FALSE, FALSE, '{marketing}', 'ALL', 150),

('marketing.referral', 'marketing', 'Parrainage',
 'Un client parraine un nouvel utilisateur ; les deux reçoivent une récompense en coins à la première commande du filleul.',
 'marketing', FALSE, FALSE, '{marketing.loyalty_coins}', 'ALL', 160),

('marketing.campaigns', 'marketing', 'Campagnes & push ciblé',
 'Envoi de notifications marketing à des segments d''utilisateurs depuis le back-office, avec promotion attachée et mesure de conversion. Ne couvre jamais les notifications de statut de commande.',
 'marketing', FALSE, FALSE, '{marketing}', 'ALL', 170),

('marketing.merchant_funded', 'marketing', 'Promotions cofinancées restaurant',
 'Permet à un restaurant de financer tout ou partie d''une promotion. La part du restaurant est déduite de son reversement.',
 'marketing', FALSE, FALSE, '{marketing.free_delivery,marketing.promo_codes}', 'ANY', 180),

-- ANALYTICS
('analytics', NULL, 'Rapports & statistiques',
 'Consolide les stats commandes, le taux d''utilisation des coupons, le coût réel des promotions et la marge par commande.',
 'analytics', TRUE, FALSE, '{}', 'ALL', 200);
```

> ⚠️ `is_enabled` ci-dessus reflète **l'existant** (coupons, first order, coins, multi-restaurants déjà en production). Les modules nouveaux partent à `FALSE`.

### 6.2 Paramètres

```sql
INSERT INTO module_settings (module_code, key, value, value_type, unit, label, description, min_value, max_value) VALUES

-- delivery.base_pricing
('delivery.base_pricing','base_fee','500','money','FCFA','Frais de prise en charge','Montant fixe facturé pour toute livraison, quelle que soit la distance.',0,10000),
('delivery.base_pricing','price_per_km','150','money','FCFA/km','Prix par kilomètre','Montant ajouté par kilomètre entre le restaurant et le client.',0,2000),
('delivery.base_pricing','min_fee','500','money','FCFA','Frais minimum','Plancher des frais avant promotion.',0,10000),
('delivery.base_pricing','max_fee','5000','money','FCFA','Frais maximum','Plafond des frais avant promotion.',0,50000),
('delivery.base_pricing','max_delivery_distance','10','number','km','Distance maximale de livraison','Au-delà, la commande est refusée.',1,100),
('delivery.base_pricing','rounding','50','number','FCFA','Arrondi','Les frais sont arrondis au multiple le plus proche.',1,500),

-- delivery.zone_pricing
('delivery.zone_pricing','fallback_to_formula','true','boolean',NULL,'Repli sur la formule','Si la distance dépasse la dernière zone, utilise la formule base + km.',NULL,NULL),

-- delivery.surge_pricing
('delivery.surge_pricing','rain_surcharge','200','money','FCFA','Supplément pluie','Ajouté aux frais quand le mode pluie est activé par l''admin.',0,3000),
('delivery.surge_pricing','rush_multiplier','1.2','number','x','Multiplicateur heure de pointe','Multiplie les frais pendant les heures de pointe.',1,3),
('delivery.surge_pricing','rush_hours','[{"from":"12:00","to":"14:00"},{"from":"19:00","to":"21:30"}]','json',NULL,'Heures de pointe','Plages horaires locales de majoration.',NULL,NULL),
('delivery.surge_pricing','max_surge_total','800','money','FCFA','Plafond de majoration','Les majorations cumulées ne peuvent pas dépasser ce montant.',0,5000),

-- delivery.multi_restaurant
('delivery.multi_restaurant','max_restaurants_per_group','3','number',NULL,'Restaurants max par commande','Nombre maximum de restaurants dans un même groupe.',2,6),
('delivery.multi_restaurant','extra_stop_fee','300','money','FCFA','Frais par arrêt supplémentaire','Facturé au client pour chaque restaurant au-delà du premier (Extra Fee actuelle).',0,3000),
('delivery.multi_restaurant','max_detour_km','3','number','km','Détour maximum','Distance max entre deux restaurants d''un même groupe.',0,20),

-- courier.base_payout
('courier.base_payout','mode','"per_zone"','string',NULL,'Mode de calcul','"per_zone" (grille delivery_zones), "per_km" (base + km) ou "flat" (montant fixe).',NULL,NULL),
('courier.base_payout','flat_amount','1000','money','FCFA','Montant fixe par course','Utilisé si mode = flat.',0,10000),
('courier.base_payout','base_amount','400','money','FCFA','Base livreur','Utilisé si mode = per_km.',0,10000),
('courier.base_payout','per_km','120','money','FCFA/km','Prix/km livreur','Utilisé si mode = per_km.',0,2000),
('courier.base_payout','min_payout','700','money','FCFA','Rémunération minimum','Un livreur ne gagne jamais moins par course, même si la livraison est gratuite pour le client.',0,10000),

-- courier.batch_payout
('courier.batch_payout','extra_stop_payout','250','money','FCFA','Rémunération arrêt supplémentaire','Ajoutée à la rémunération par restaurant supplémentaire.',0,3000),
('courier.batch_payout','split_strategy','"proportional_to_distance"','string',NULL,'Répartition','"equal" ou "proportional_to_distance".',NULL,NULL),

-- marketing.free_delivery
('marketing.free_delivery','default_min_cart','8000','money','FCFA','Panier minimum par défaut','Panier minimum pour qu''une livraison gratuite s''applique.',0,100000),
('marketing.free_delivery','default_max_distance','5','number','km','Distance maximale par défaut','Au-delà, la livraison gratuite ne s''applique pas.',0,50),
('marketing.free_delivery','max_subsidy_per_order','1200','money','FCFA','Subvention max par commande','Plafond de ce que la plateforme finance par commande.',0,10000),
('marketing.free_delivery','monthly_budget','500000','money','FCFA','Budget mensuel','Budget épuisé = livraison gratuite désactivée automatiquement jusqu''au mois suivant.',0,NULL),

-- marketing.promo_codes
('marketing.promo_codes','allow_stacking','false','boolean',NULL,'Cumul de codes','Autorise plusieurs codes sur une même commande.',NULL,NULL),

-- marketing.first_order
('marketing.first_order','reward_type','"PERCENT_OFF_CART"','string',NULL,'Type de récompense','Reproduit l''offre BIENVENUE actuelle.',NULL,NULL),
('marketing.first_order','percent','20','number','%','Pourcentage','Réduction appliquée au panier.',0,100),
('marketing.first_order','max_discount','1000','money','FCFA','Plafond de réduction','Montant maximum de la réduction.',0,20000),
('marketing.first_order','min_cart','2500','money','FCFA','Panier minimum','Panier minimum pour déclencher l''offre.',0,100000),

-- marketing.loyalty_coins
('marketing.loyalty_coins','coins_per_order','10','number','coins','Coins par commande','Coins attribués à chaque commande livrée.',0,1000),
('marketing.loyalty_coins','coins_value','20','money','FCFA','Valeur indicative d''un coin','Équivalence utilisée pour le reporting du coût réel.',0,1000),
('marketing.loyalty_coins','expiry_days','180','number','jours','Expiration des coins','Les coins non utilisés expirent après ce délai. 0 = jamais.',0,3650),
('marketing.loyalty_coins','max_balance','5000','number','coins','Solde maximum','Plafond du solde d''un utilisateur.',0,100000),

-- marketing.subscription
('marketing.subscription','grace_period_days','2','number','jours','Période de grâce','Jours de validité après expiration.',0,15),

-- marketing.referral
('marketing.referral','referrer_reward','50','number','coins','Récompense parrain','Coins versés au parrain à la première commande du filleul.',0,5000),
('marketing.referral','referee_reward','50','number','coins','Récompense filleul','Coins versés au nouveau client.',0,5000),

-- marketing.campaigns
('marketing.campaigns','daily_push_cap','2','number',NULL,'Push marketing max/jour','Maximum de notifications marketing par utilisateur et par jour (hors statut de commande).',0,10),
('marketing.campaigns','quiet_hours','{"from":"22:00","to":"07:00"}','json',NULL,'Heures silencieuses','Aucun push marketing pendant cette plage.',NULL,NULL),

-- marketing.merchant_funded
('marketing.merchant_funded','max_merchant_share_pct','50','number','%','Part max du restaurant','Un restaurant ne peut pas financer plus de ce pourcentage d''une promotion.',0,100);
```

### 6.3 Zones de livraison

```sql
INSERT INTO delivery_zones (city, label, min_km, max_km, fee, courier_payout, sort_order) VALUES
('default','0–2 km',   0, 2,    700,  700, 1),
('default','2–5 km',   2, 5,   1100, 1000, 2),
('default','5–8 km',   5, 8,   1600, 1400, 3),
('default','8 km et +',8, NULL, NULL, NULL, 4);
```

### 6.4 Migration des coupons existants

```sql
INSERT INTO promotions (module_code, name, description, code, type, value,
                        min_cart_amount, max_discount_amount, first_order_only,
                        max_uses_per_user, coins_cost, requires_redemption, priority) VALUES
('marketing.first_order','Offre de bienvenue','20 % de réduction sur la première commande, plafonnée à 1000 FCFA.',
 'BIENVENUE','PERCENT_OFF_CART',20, 2500, 1000, TRUE, 1, NULL, FALSE, 50),
('marketing.first_order','Offre de bienvenue (alias)','Alias historique de l''offre de bienvenue.',
 'VITFIRST','PERCENT_OFF_CART',20, 2500, 1000, TRUE, 1, NULL, FALSE, 50),
('marketing.promo_codes','Kraveo 50','Réduction fixe de 1000 FCFA, une fois par utilisateur.',
 'KRAVEO50','FIXED_OFF_CART',1000, NULL, 1000, FALSE, 1, NULL, FALSE, 30),
('marketing.promo_codes','Kraveo 20','Coupon débloqué par échange de 50 Kraveo Coins.',
 'KRAVEO20','PERCENT_OFF_CART',20, NULL, NULL, FALSE, 1, 50, TRUE, 30);
```

> **Vérifier en Phase 0** les conditions réelles de `KRAVEO50` et `KRAVEO20` dans `validation.ts` avant de figer ce seed.

### 6.5 Règles de fidélité

```sql
INSERT INTO loyalty_rules (name, description, trigger_type, coins_amount, min_cart, is_active) VALUES
('Commande livrée','Coins attribués à chaque commande livrée.','ORDER_COMPLETED',10,NULL,TRUE),
('Parrainage','Coins versés au parrain à la première commande du filleul.','REFERRAL',50,NULL,FALSE);
```

---

## 7. Détail fonctionnel de chaque module

### 7.1 `delivery.base_pricing` (core)

```
frais = clamp(base_fee + (distance_km × price_per_km), min_fee, max_fee)
frais = arrondir(frais, rounding)
```
Exemple : 4 km → 500 + (4 × 150) = **1 100 FCFA**.

### 7.2 `delivery.zone_pricing`

Cherche la ligne de `delivery_zones` où `min_km ≤ distance < max_km` et utilise `fee`. Si aucune zone ne correspond (`fee` NULL) et `fallback_to_formula = true`, retombe sur la formule de base.

### 7.3 `delivery.surge_pricing`

```
frais = frais × (hors pointe ? 1 : rush_multiplier)
frais = frais + rain_surcharge (si mode pluie ON)
majoration_totale = min(majoration_totale, max_surge_total)
```

### 7.4 `delivery.multi_restaurant`

Coût calculé **au niveau du groupe** :
```
frais_groupe = frais(distance_totale_tournée) + (nb_restaurants − 1) × extra_stop_fee
```
Encapsule l'`OrderGroup` existant ; seules les valeurs sortent en base.

### 7.5 `courier.base_payout` (core)

Selon `mode` :
- `per_zone` → `delivery_zones.courier_payout`
- `per_km` → `base_amount + distance × per_km`
- `flat` → `flat_amount`

Puis `max(résultat, min_payout)`.

### 7.6 `courier.bonuses`

Additionne les bonus actifs dont la condition est remplie (pluie, nuit, heure de pointe, zone).

### 7.7 `courier.batch_payout`

```
paiement_tournée = paiement_base(distance_totale)
                 + (nb_arrêts − 1) × extra_stop_payout
                 + bonus
```
Réparti entre commandes selon `split_strategy`.

### 7.8 `marketing` (interrupteur parent)

Simple `is_enabled`. Si `FALSE`, le pipeline saute **toute** l'étape marketing. N'affecte jamais `core/notifications/`.

### 7.9 `marketing.free_delivery`

Promotion `FREE_DELIVERY` éligible si **toutes** ces conditions sont vraies :
- `panier ≥ min_cart_amount`
- `distance ≤ max_distance_km`
- date dans `[starts_at, ends_at]`
- `max_uses_per_user` et `max_uses_total` non atteints
- `budget_spent < budget_total` et budget mensuel du module non épuisé
- subvention de la commande `≤ max_subsidy_per_order`

Effet : `delivery_fee_customer = 0`, le coût est reporté sur `delivery_subsidy` et `merchant_contribution`.

### 7.10 `marketing.promo_codes`

Validation des mêmes conditions, puis réduction selon `type`, plafonnée par `max_discount_amount`. Reprend les règles de `validation.ts` avec des valeurs en base.

### 7.11 `marketing.first_order`

Détecte l'absence de commande livrée pour l'utilisateur et applique la promo `first_order_only`.

### 7.12 `marketing.loyalty_coins`

- **Attribution** : à chaque déclencheur de `loyalty_rules`, écrit une ligne dans `loyalty_transactions`.
- **Échange** : `POST /api/coupons/redeem-coins` débite les coins (`amount` négatif) et rend éligible la promo dont `coins_cost` est couvert.
- **Solde** = somme des transactions, jamais un compteur mutable isolé.
- **Expiration** : job périodique créant des transactions `EXPIRED`.

### 7.13 `marketing.subscription`

Si abonnement `ACTIVE` (ou dans la période de grâce), commande conforme au plan et quota restant : livraison gratuite, `deliveries_used += 1`. Le modèle tient parce que tous les abonnés n'épuisent pas leur quota — suivre le **coût moyen réel par abonné** dans `analytics`.

### 7.14 `marketing.referral`

À la première commande livrée du filleul : récompense les deux parties en coins, `referrals.status = REWARDED`.

### 7.15 `marketing.campaigns`

Segmentation sur `segment` (JSONB), planification, envoi via FCM, respect de `daily_push_cap` et `quiet_hours`, mesure `sent/opened/converted` via `promotion_id`.

### 7.16 `marketing.merchant_funded`

Autorise `funded_by = MERCHANT | SPLIT`. Part restaurant plafonnée par `max_merchant_share_pct` et **déduite de son reversement** dans `splitGroupMoney`.

### 7.17 `analytics`

Marge par commande, coût réel des promos, taux d'utilisation des coupons, budget consommé, commandes déficitaires, coût moyen par abonné.

---

## 8. Pipeline de calcul d'une commande

Ordre strict. **Une étape dont le module est désactivé est sautée.**

```
┌────────────────────────────────────────────────────────────┐
│ ÉTAPE 1  COÛT CLIENT DE BASE                               │
│   delivery.zone_pricing ? zone : base_pricing              │
│   + delivery.multi_restaurant (arrêts supplémentaires)     │
│   + delivery.surge_pricing    (majorations)                │
│   => delivery_fee_original                                 │
├────────────────────────────────────────────────────────────┤
│ ÉTAPE 2  RÉMUNÉRATION LIVREUR (indépendante du client)     │
│   courier.base_payout                                      │
│   + courier.batch_payout  (si groupe)                      │
│   + courier.bonuses                                        │
│   => courier_payout                                        │
├────────────────────────────────────────────────────────────┤
│ ÉTAPE 3  MARKETING (si module « marketing » actif)         │
│   a. abonnement actif ?          (subscription)            │
│   b. première commande ?         (first_order)             │
│   c. livraison gratuite ?        (free_delivery)           │
│   d. code promo saisi ?          (promo_codes)             │
│   -> meilleure promo retenue (ou cumul si stackable)       │
│   => discount_amount                                       │
├────────────────────────────────────────────────────────────┤
│ ÉTAPE 4  FINANCEMENT DE LA RÉDUCTION                       │
│   répartition plateforme / restaurant (merchant_funded)    │
│   => delivery_subsidy, merchant_contribution               │
├────────────────────────────────────────────────────────────┤
│ ÉTAPE 5  GARDE-FOUS                                        │
│   plafonds, budget, marge minimale                         │
├────────────────────────────────────────────────────────────┤
│ ÉTAPE 6  SNAPSHOT + attribution des coins                  │
└────────────────────────────────────────────────────────────┘
```

```
delivery_fee_customer = max(0, delivery_fee_original − discount_amount)
delivery_subsidy      = discount_amount − merchant_contribution
coût_livraison_réel   = courier_payout
```

---

## 9. Snapshot enregistré sur la commande

| Champ | Description |
|---|---|
| `delivery_fee_original` | Frais calculés avant toute réduction |
| `delivery_fee_customer` | Frais réellement payés par le client |
| `courier_payout` | Rémunération prévue du livreur |
| `delivery_subsidy` | Part financée par la plateforme |
| `merchant_contribution` | Part financée par le(s) restaurant(s) |
| `promotion_id` | Promotion appliquée (nullable) |
| `subscription_id` | Abonnement utilisé (nullable) |
| `pricing_snapshot` | Modules actifs + paramètres utilisés au moment du calcul |

```json
{
  "calculated_at": "2026-10-15T13:35:00Z",
  "modules_enabled": ["delivery.base_pricing","courier.base_payout","marketing","marketing.free_delivery"],
  "settings": { "base_fee": 500, "price_per_km": 150, "min_payout": 700 },
  "distance_km": 4,
  "restaurants_count": 1
}
```

---

## 10. API d'administration

Préfixe `/admin`, rôle `ADMIN` requis, chaque écriture alimente `module_audit_log`.

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/admin/modules` | Liste des modules + état + dépendances + description |
| `PATCH` | `/admin/modules/:code/toggle` | Active/désactive (refus si `is_core` ou dépendance non satisfaite) |
| `GET` | `/admin/modules/:code/settings` | Paramètres avec libellés et descriptions |
| `PATCH` | `/admin/modules/:code/settings/:key` | Modifie une valeur (validée par `value_type`, `min_value`, `max_value`) |
| `GET` `PUT` | `/admin/delivery-zones` | Grille tarifaire |
| `GET` `POST` `PATCH` | `/admin/promotions` | Gestion des promotions |
| `GET` | `/admin/promotions/:id/stats` | Utilisations, budget consommé, coût réel |
| `GET` `POST` | `/admin/subscription-plans` | Plans d'abonnement |
| `GET` `POST` `PATCH` | `/admin/campaigns` | Campagnes push |
| `GET` `POST` | `/admin/loyalty-rules` | Règles d'attribution de coins |
| `GET` | `/admin/modules/audit-log` | Historique des changements |
| `POST` | `/admin/pricing/simulate` | **Simulateur** |

### Simulateur

```json
POST /admin/pricing/simulate
{
  "distance_km": 4,
  "cart_amount": 10000,
  "restaurants_count": 1,
  "user_id": "…",
  "promo_code": null,
  "overrides": { "marketing.free_delivery": true }
}
```
Réponse : détail étape par étape + marge simplifiée. Les `overrides` permettent de tester un module **avant** de l'activer réellement.

### Règles de validation au toggle

1. `is_core = TRUE` → refus.
2. Activation : dépendances satisfaites selon `requires_mode` (`ALL` / `ANY`).
3. Désactivation : refus si un module actif en dépend, sauf `cascade=true` explicite.
4. Toute action écrit dans `module_audit_log`.

---

## 11. Garde-fous de rentabilité

| Garde-fou | Où |
|---|---|
| Panier minimum | `promotions.min_cart_amount` |
| Distance maximale | `promotions.max_distance_km` |
| Plafond de réduction par commande | `promotions.max_discount_amount` |
| Subvention max par commande | `marketing.free_delivery.max_subsidy_per_order` |
| Budget par campagne | `promotions.budget_total` |
| Budget mensuel global | `marketing.free_delivery.monthly_budget` |
| Nombre d'usages | `max_uses_total`, `max_uses_per_user` |
| Durée limitée | `starts_at`, `ends_at` |
| Rémunération livreur plancher | `courier.base_payout.min_payout` |
| Plafond solde coins | `marketing.loyalty_coins.max_balance` |

**Règle d'or** : fixer la rémunération du livreur selon le travail réalisé, puis construire les promotions autour. Jamais l'inverse.

---

## 12. Exemple complet chiffré

**Données** : panier 10 000 FCFA · 4 km · 1 restaurant.
**Modules actifs** : `delivery.base_pricing`, `courier.base_payout` (mode `per_zone`), `marketing`, `marketing.free_delivery`, `marketing.merchant_funded`.
**Promo** « Livraison offerte » : `min_cart_amount = 8000`, `max_distance_km = 5`, `funded_by = SPLIT`, part restaurant 300 FCFA.

| Étape | Résultat |
|---|---|
| 1. Frais client de base | 500 + 4×150 = **1 100 FCFA** |
| 2. Rémunération livreur (zone 2–5 km) | **1 000 FCFA** |
| 3. Promo éligible (10 000 ≥ 8 000 ; 4 ≤ 5) | réduction = 1 100 |
| 4. Financement | restaurant **300** · plateforme **800** |
| 5. Client paie | **0 FCFA** |

Bilan plateforme (commission 15 %, frais de service 200 FCFA) :

| Ligne | Montant |
|---|---|
| Commission restaurant (15 % de 10 000) | +1 500 |
| Frais de service client | +200 |
| Livraison payée par le client | 0 |
| Rémunération livreur | −1 000 |
| Contribution restaurant à la livraison | +300 |
| Autres coûts opérationnels | −300 |
| **Marge simplifiée** | **+700** |

> Même commande avec `marketing` désactivé : le client paie 1 100 FCFA, le livreur touche toujours 1 000 FCFA, aucune subvention.

---

## 13. Stratégie de migration

On ne remplace rien tant que le nouveau ne donne pas **exactement** le même résultat que l'ancien.

```
Étape A — Socle en lecture seule
  Tables modules/settings créées, seedées avec les valeurs ACTUELLES du code.
  Aucun appel en production. Risque : nul.

Étape B — Double calcul (shadow mode)
  Chaque commande est calculée par l'ancien code (qui fait foi) ET le nouveau.
  Les écarts sont loggés dans pricing_parity_log.
  Durée : 1 à 2 semaines de trafic réel.

Étape C — Bascule
  0 écart sur 100 % des commandes pendant 7 jours → le nouveau moteur fait foi.
  L'ancien reste appelable via un flag de secours.

Étape D — Nettoyage
  Suppression de l'ancien code et du shadow mode.
```

---

## 14. Plan par phases

### Phase 0 — Cadrage (2–3 jours)

- [ ] Inventorier **toutes** les valeurs en dur de `pricing.ts` et `validation.ts` (une ligne par constante)
- [ ] Lister les coupons actifs en production et leurs conditions réelles
- [ ] Figer la grille de rémunération livreur cible (décision métier)
- [ ] Vérifier le comportement de `splitGroupMoney` sur une commande avec coupon
- [ ] Exporter les soldes Kraveo Coins actuels (contrôle avant/après migration)

**Livrable** : tableau « constante → module → clé de setting → valeur de seed ».

### Phase 1 — Socle de modules (1 semaine) · *aucun impact fonctionnel*

- [ ] Migrations `platform_modules`, `module_settings`, `module_audit_log`
- [ ] Seed des modules et paramètres (section 6)
- [ ] `ModuleRegistryService` avec cache invalidé à l'écriture
- [ ] Garde `@RequiresModule(code)`
- [ ] Endpoints admin : liste, toggle, settings, audit-log
- [ ] Écran back-office : liste des modules avec switch + description

**Recette** : toggle fonctionnel, dépendances validées, production inchangée.

### Phase 2 — Découpler le livreur du client (1,5 semaine) · 🔴 *priorité absolue*

- [ ] `delivery_zones` + seed reproduisant la tarification actuelle
- [ ] `modules/delivery/pricing/` : `base_pricing` + `zone_pricing`
- [ ] `modules/courier/payout/` : `base_payout` avec `min_payout`
- [ ] Champs snapshot sur `order_groups`
- [ ] `PricingPipeline` étapes 1 et 2
- [ ] Shadow mode + `pricing_parity_log`
- [ ] `POST /admin/pricing/simulate`

**Recette** : 0 écart sur 7 jours ; `courier_payout` stocké séparément et non dérivé des frais client.

### Phase 3 — Extraction du marketing (2 semaines)

- [ ] `promotions`, `promotion_redemptions`
- [ ] Migration de `BIENVENUE`, `VITFIRST`, `KRAVEO50`, `KRAVEO20` en base — aucun code promo ne doit cesser de fonctionner
- [ ] `promo_codes`, `first_order`, `free_delivery`
- [ ] `marketing.engine.ts` (étapes 3 et 4) + interrupteur parent branché
- [ ] Suivi atomique du budget (`UPDATE … WHERE budget_spent + :x <= budget_total`)
- [ ] `splitGroupMoney` étendu : réduction proportionnelle + `merchant_contribution`
- [ ] Back-office : CRUD promotions + stats

**Recette** : un coupon créé en back-office fonctionne sans déploiement ; désactiver `marketing` supprime toutes les réductions sans casser une commande.

### Phase 4 — Fidélité, abonnement, campagnes (2 semaines)

- [ ] `loyalty_rules`, `loyalty_transactions` ; migration des soldes (une transaction d'ouverture par utilisateur, jamais d'`UPDATE` destructif)
- [ ] `marketing.loyalty_coins` : attribution idempotente, échange via `coins_cost`
- [ ] `subscription_plans`, `subscriptions` → Kraveo Plus
- [ ] **Scission de `services/push/`** : `core/notifications/` vs `modules/marketing/campaigns/`
- [ ] `campaigns` : segments, planification, `daily_push_cap`, `quiet_hours`, conversion
- [ ] `marketing.referral`
- [ ] `marketing.merchant_funded`

**Recette** : une campagne ciblée avec promo attachée est créée en back-office et son taux de conversion est mesuré ; couper `marketing` n'interrompt aucun push de statut.

### Phase 5 — Logistique avancée (1,5 semaine)

- [ ] `delivery.multi_restaurant` : encapsuler l'existant, externaliser Base Fee / Extra Fee / `max_detour_km`
- [ ] `courier.batch_payout` : rémunération au niveau de la tournée puis répartition
- [ ] `delivery.surge_pricing`, `courier.bonuses`

**Recette** : sur un groupe de 2 restaurants, `courier_payout` = tournée + arrêt supplémentaire, pas deux courses pleines.

### Phase 6 — Analytics & nettoyage (1 semaine)

- [ ] `modules/analytics/` : marge par commande, coût réel des promos, taux d'utilisation, coût moyen par abonné
- [ ] Tableau de bord + alerte si la marge moyenne passe sous un seuil
- [ ] Désactivation du shadow mode, suppression de l'ancien code
- [ ] Documentation back-office pour l'équipe non technique

### Récapitulatif

| Phase | Durée | Risque | Valeur |
|---|---|---|---|
| 0 — Cadrage | 3 j | Nul | Visibilité |
| 1 — Socle | 1 sem | Nul | Fondation |
| 2 — Découplage livreur | 1,5 sem | Moyen | 🔴 Débloque tout le reste |
| 3 — Marketing extrait | 2 sem | Moyen | Promos sans déploiement |
| 4 — Fidélité / abo / campagnes | 2 sem | Faible | Rétention |
| 5 — Logistique avancée | 1,5 sem | Faible | Marge sur les tournées |
| 6 — Analytics & nettoyage | 1 sem | Nul | Pilotage |

**Total : environ 9 semaines**, livrable et testable à chaque phase.

---

## 15. Points techniques critiques

### 15.1 `splitGroupMoney` doit gérer quatre flux

```
Reçu du client        = sous-total − réduction panier + delivery_fee_customer + frais de service
Versé aux restaurants = (sous-total par resto − commission) − merchant_contribution
Versé au livreur      = courier_payout            (indépendant du client)
Supporté plateforme   = delivery_subsidy + réduction panier non cofinancée
```
La contribution promo d'un restaurant se **déduit de son reversement** ; elle ne sort pas de la poche de la plateforme.

### 15.2 Répartition proportionnelle et arrondi

Répartir 1 000 FCFA sur 3 commandes produit des décimales. Règle : arrondir à l'entier inférieur par commande, affecter le **reliquat à la plus grosse commande**, vérifier `Σ réparti == réduction`. Test unitaire obligatoire sur des montants premiers entre eux.

### 15.3 Cache et cohérence

`ModuleRegistryService` lit en cache (mémoire ou Redis), invalidé à chaque `PATCH` admin, avec publication d'événement si plusieurs instances. Ne jamais requêter la base à chaque calcul de prix.

### 15.4 Idempotence des coins

Contrainte unique `(user_id, order_group_id, reason)` : une commande ne crédite jamais deux fois, même si le webhook de livraison est rejoué.

### 15.5 Priorité des promotions

Ordre d'évaluation : `subscription` → `first_order` → `free_delivery` → `promo_codes`. Retenir **la plus avantageuse pour le client**, sauf `stackable = true`. Décision explicite dans le code et couverte par des tests.

### 15.6 Concurrence sur les budgets

Décrémentation atomique du budget promo et du quota d'abonnement :
```sql
UPDATE promotions SET budget_spent = budget_spent + :x
WHERE id = :id AND budget_spent + :x <= budget_total;
```
Zéro ligne affectée = promo refusée.

### 15.7 Argent

Entiers en FCFA, aucune décimale, arrondi centralisé dans un helper unique.

### 15.8 Tests

Un jeu de tests par combinaison de modules : tout ON, `marketing` OFF, zones ON/OFF, groupe 1 vs 3 restaurants, promo + abonnement simultanés.

---

## 16. Risques et parades

| Risque | Parade |
|---|---|
| Régression sur les prix en production | Shadow mode obligatoire (Phases 2 et 3), bascule à 0 écart sur 7 jours |
| Perte des soldes Kraveo Coins | Migration par transaction d'ouverture, jamais d'`UPDATE` destructif ; export de contrôle avant/après |
| Un coupon actif cesse de fonctionner | Migrer les coupons **avant** de couper l'ancien validateur ; test automatisé sur chaque code existant |
| Push de statut coupés par le toggle marketing | Scission stricte transactionnel / marketing (Phase 4), règle n°6 |
| Promo rendant une commande déficitaire | Garde-fous obligatoires : panier min, distance max, plafond de subvention, budget |
| Admin qui casse la tarification | `min_value`/`max_value` sur chaque setting, simulateur avant activation, audit log |
| Désactivation d'un module dont un autre dépend | Validation des dépendances au toggle, `cascade` explicite |
| Double crédit de coins sur webhook rejoué | Contrainte d'unicité (15.4) |

---

## 17. Checklist de démarrage

L'agent qui reprend ce document commence par la **Phase 0**, dans cet ordre :

1. Lire `src/pricing.ts` et `src/utils/validation.ts` en entier.
2. Produire le tableau « constante → module → clé de setting → valeur de seed ». Ce tableau conditionne tout le reste : c'est lui qui garantit que le shadow mode part d'une parité exacte.
3. Lire `splitGroupMoney` et documenter les flux actuels avant de les étendre.
4. Confirmer avec le métier la grille de rémunération livreur cible.
5. Seulement ensuite : écrire les migrations de la Phase 1.

> Toutes les valeurs monétaires de ce document sont des **exemples de simulation**, à remplacer par les valeurs réelles relevées en Phase 0.
