# Architecture modulaire Kraveo : récapitulatif pour le front

Source de référence : `KRAVEO_SPEC_MODULES.md` (à la racine du backend). Ce document dit **ce qui est fait côté backend**, **ce qui change (ou pas) pour les apps** et **les écrans à construire dans le dashboard admin**.

## 1. En une minute

- Les prix, frais, zones, promotions et la rémunération des livreurs ne sont plus à écrire dans le code : ils vivent en base et se modifient depuis le back-office, **sans déploiement**.
- Chaque fonctionnalité est un **module** qu'on active ou désactive (17 modules). Le marketing est un bloc totalement séparé du calcul du prix.
- **Trois montants distincts** sur chaque commande : ce que paie le client, ce que gagne le livreur, ce que finance la plateforme. La rémunération du livreur ne dépend **jamais** de ce que paie le client.
- **Rien ne change pour les apps client / restaurant / livreur aujourd'hui.** Le calcul actuel reste celui qui facture (mode « shadow »). Le nouveau moteur tourne en parallèle, compare, et enregistre son résultat. La bascule se fera plus tard, quand l'écart est nul pendant 7 jours.

## 2. Ce qui est livré (backend)

| Bloc | Contenu |
|---|---|
| Socle | tables `PlatformModule`, `ModuleSetting`, `ModuleAuditLog` ; 17 modules et 39 réglages, chacun avec libellé et description en français ; cache invalidé à chaque écriture |
| Livraison | tarification de base (base + km), zones, majoration (pluie, heures de pointe), commande multi-restaurants |
| Livreur | rémunération de base (par zone / par km / fixe), bonus, rémunération des tournées |
| Marketing | promotions (codes, 1re commande, livraison gratuite, cofinancement restaurant), abonnement, fidélité (ledger de coins), campagnes (stockage), parrainage (table) |
| Contrôle | snapshot figé sur chaque commande, `PricingParityLog` (comparaison ancien / nouveau), simulateur |
| Données migrées | les 4 coupons existants (`BIENVENUE`, `VITFIRST`, `KRAVEO50`, `KRAVEO20`) avec leurs règles exactes ; les soldes de Kraveo Coins en lignes d'ouverture du ledger |

Valeurs de départ = **comportement actuel**, pas l'idéal : frais fixes 500 FCFA (`price_per_km` = 0), +300 FCFA par restaurant en plus. La grille de rémunération livreur (700 / 1 000 / 1 400 FCFA) est une **proposition à valider par le métier**.

## 3. Ce qui n'est pas encore fait (à savoir)

1. **Bascule** : le nouveau moteur ne facture pas encore. Il faut 7 jours à 0 écart dans `PricingParityLog`.
2. **Coins** : le ledger et son service existent, mais l'attribution à la livraison et l'échange (`redeem-coins`) utilisent encore le compteur existant. À brancher à la bascule.
3. **Parrainage, expiration des coins, analytics (marge par commande)** : tables prêtes, logique à écrire.
4. **Distance** : calculée à vol d'oiseau entre le restaurant et le point de livraison. Si le restaurant n'a pas de position réelle, la distance vaut 0 et le snapshot porte l'avertissement `DISTANCE_UNKNOWN`.
5. `freeFeeAbove` de l'ancien réglage `fees` n'est pas repris (il vaut 0 par défaut).

## 4. Apps client, restaurant, livreur

Aucun appel existant ne change. Pistes pour plus tard, quand le front le décide :
- Livreur : afficher `courierPayout` (gain de la course) une fois l'endpoint ouvert côté livreur.
- Client : codes promo inchangés (`couponCode`), mêmes messages d'erreur.
- Ne jamais afficher de configuration (zones, budgets, coût plateforme) côté client : tout est réservé à l'admin.

## 5. Dashboard admin : écrans à construire

Tous les appels : `Authorization: Bearer <token admin>`, préfixe `/api`. Réponses `{ success, data }` ; erreurs `{ success:false, code, message, field? }`. Les montants sont des **FCFA entiers**.

### 5.1 Modules (écran principal)
- `GET /admin/modules` → liste : `code, parentCode, name, description, category, isEnabled, isCore, effective, requires, requiresMode, settingsCount, blockedBy`.
  - `isEnabled` = l'interrupteur du module ; `effective` = vraiment actif (parent actif ET dépendances satisfaites). Afficher `blockedBy` quand `isEnabled` est vrai mais `effective` faux.
  - Regrouper par `category` (delivery, courier, marketing, analytics) ; `marketing.*` sous le parent `marketing`.
- `PATCH /admin/modules/:code/toggle` `{ "enabled": true, "cascade": false }`
  - 409 `MODULE_CORE` : module obligatoire (switch grisé).
  - 409 `MODULE_DEPENDENCY` + `missing[]` : activer d'abord ces modules.
  - 409 `MODULE_DEPENDENTS` + `dependents[]` : ces modules en dépendent ; demander confirmation puis renvoyer avec `cascade: true`.
  - Réponse : `changed[]` (modules modifiés) et la liste à jour.

### 5.2 Réglages d'un module
- `GET /admin/modules/:code/settings` → `key, value, valueType (number|money|boolean|string|json), unit, label, description, min, max, options`.
  - Générer le champ selon `valueType` ; `options` = liste de choix pour un texte ; afficher `unit`, `min`, `max`.
- `PATCH /admin/modules/:code/settings/:key` `{ "value": 600 }` → `{ changed, data: { key, value, previous } }`. Erreur 400 avec `field` et un message lisible (montant non entier, hors bornes, min > max...).
- `rush_hours` : `[{ "from": "12:00", "to": "14:00" }]` ; `quiet_hours` : `{ "from": "22:00", "to": "07:00" }` (heure de Dakar).

### 5.3 Zones de livraison
- `GET /admin/delivery-zones?city=default`
- `PUT /admin/delivery-zones` `{ "city": "default", "zones": [{ "label": "0–2 km", "minKm": 0, "maxKm": 2, "fee": 700, "courierPayout": 700 }, ..., { "label": "8 km et +", "minKm": 8, "maxKm": null, "fee": null, "courierPayout": null }] }`
  - Remplace toute la grille. Règles : commence à 0, zones contiguës, seule la dernière a `maxKm: null`, 1 à 12 zones. `fee` = ce que paie le client, `courierPayout` = ce que gagne le livreur.
  - Formulaire : tableau éditable, une ligne par zone, la borne de départ se remplit seule.

### 5.4 Promotions
- `GET /admin/promotions?page=&pageSize=` · `POST /admin/promotions` · `PATCH /admin/promotions/:id` · `GET /admin/promotions/:id/stats`
- Création : `moduleCode` (`marketing.promo_codes` | `marketing.first_order` | `marketing.free_delivery`), `type` (`FREE_DELIVERY`, `PERCENT_OFF_DELIVERY`, `FIXED_OFF_DELIVERY`, `PERCENT_OFF_CART`, `FIXED_OFF_CART`), `value`, `name`, `description`, `code` (3 à 40 : A-Z, 0-9, `-`, `_`) ou vide pour une promo automatique.
- Conditions optionnelles : `minCartAmount`, `maxDistanceKm`, `maxDiscountAmount`, `eligibleCities`, `eligibleMerchants`, `firstOrderOnly`, `maxUsesTotal`, `maxUsesPerUser`, `budgetTotal`, `startsAt`, `endsAt`, `priority`, `stackable`, `isActive`.
- Financement : `fundedBy` = `PLATFORM` | `MERCHANT` | `SPLIT` + `merchantSharePct` (plafonné par le réglage `max_merchant_share_pct` ; module `marketing.merchant_funded` requis, sinon 409 `MODULE_DISABLED`).
- `code`, `type` et `moduleCode` ne sont **pas modifiables** après création (400 si envoyés au PATCH). On désactive avec `isActive: false`, on ne supprime jamais.
- Erreurs : 409 `CODE_TAKEN`, 400 avec `field`. Une promo automatique doit avoir un budget ou une date de fin.
- Stats : `uses, distinctUsers, discountTotal, platformCost, merchantCost, budgetSpent, budgetLeft`.

### 5.5 Autres écrans
- Plans d'abonnement : `GET/POST /admin/subscription-plans`, `PATCH /admin/subscription-plans/:id` `{ isActive }`.
- Plans d'abonnement : CRUD complet. `DELETE` refusé (409 `PLAN_HAS_SUBSCRIBERS`) s'il a des abonnés : le désactiver (`isActive: false`). Un changement de prix ou de quota ne touche que les futurs abonnements.
- Règles de fidélité : `GET/POST /admin/loyalty-rules`, `PATCH` et `DELETE /admin/loyalty-rules/:id`.
- Bonus livreur : `GET/POST /admin/courier-bonuses`, `PATCH` (tous les champs) et `DELETE /admin/courier-bonuses/:id`. Types : `RAIN`, `NIGHT` / `RUSH_HOUR` (`conditions: { from, to }`), `ZONE` (`conditions: { zoneId }`), `MANUAL`.
- Promotions : en plus, `GET /admin/promotions/:id` et `DELETE /admin/promotions/:id` (refusé 409 `PROMOTION_USED` si elle a servi : la désactiver).

### 5.5 bis Campagnes (CRUD + envoi)
- `GET/POST /admin/campaigns`, `GET/PATCH/DELETE /admin/campaigns/:id`. Segment accepté : `last_order_days_gt` (inactifs depuis N jours, parmi ceux qui ont déjà commandé), `min_orders`, `max_orders`, `city` (texte contenu dans l'adresse du profil). Titre 65 caractères max, message 240.
- Statuts : `DRAFT` → `SCHEDULED` (date + titre + message requis, module `marketing.campaigns` actif) → `SENDING` → `SENT`; `CANCELLED`. Suppression seulement en `DRAFT` / `CANCELLED` (409 `CAMPAIGN_NOT_DELETABLE`). Une campagne `SENT` n'est plus modifiable.
- `POST /admin/campaigns/:id/send` : envoi immédiat. Une campagne `SCHEDULED` dont la date est passée part automatiquement (vérification chaque minute). Réponse : `{ recipients, sent, skipped, failed, deferred? }`. `deferred: "QUIET_HOURS"` = rien n'est parti (heures silencieuses), la campagne reste en l'état.
- `GET /admin/campaigns/:id/stats` : `sent, failed, skipped, opened, converted, conversionRate`. « Converti » = le client a passé une commande dans les 72 h après la notification.
- Garde-fous côté serveur : un client ne reçoit une campagne qu'une fois ; plafond `daily_push_cap` par client et par 24 h ; aucun envoi pendant `quiet_hours` ; les clients qui ont coupé le marketing ou sans appareil sont ignorés. Les notifications de suivi de commande n'utilisent pas ce circuit et ne sont jamais coupées.
- **App client** : (1) `PUT /auth/profile { "marketingOptOut": true|false }` pour le réglage « notifications promotionnelles » (`user.marketingOptOut` est renvoyé par le profil) ; (2) quand le client ouvre une notification de campagne (`data.event == "MARKETING"`, `data.campaignId`), appeler `POST /campaigns/:id/opened` ; (3) créer un canal de notification Android `marketing`.
- Journal : `GET /admin/modules/audit-log?module=&page=&pageSize=` → qui a changé quoi (`oldValue`, `newValue`, `changedBy`, `changedAt`).

### 5.6 Simulateur (à mettre en avant)
`POST /admin/pricing/simulate`
```json
{ "distance_km": 4, "cart_amount": 10000, "restaurants_count": 1, "user_id": null, "promo_code": null,
  "overrides": { "marketing.free_delivery": true }, "at": "2026-10-15T12:30:00Z", "commission_amount": 1500 }
```
Réponse : `step1_delivery` (frais avant promo), `step2_courier` (gain livreur), `step3_marketing` (promos retenues, ou `null` si le marketing est coupé), `customerPays { food, delivery, total }`, `courierPayout`, `deliverySubsidy`, `merchantContribution`, `margin { value, deficit, formula }`, `snapshot`.
- `overrides` permet d'essayer un module **avant** de l'activer. Le simulateur n'écrit rien.
- Afficher la marge en rouge quand `margin.deficit` est vrai.
- Erreurs métier : `OUT_OF_RANGE`, `TOO_MANY_RESTAURANTS`, `DETOUR_TOO_LONG`.

## 6. Sécurité (ce qui est en place)

- Toutes les routes : JWT + rôle `ADMIN`. L'identifiant de l'auteur vient du jeton, jamais du corps de la requête.
- Corps strictement validés : champ inconnu, mauvais type, montant non entier, hors bornes, texte avec `<` `>` ou caractères de contrôle → 400.
- Chaque modification est écrite dans le journal d'audit avec l'ancienne et la nouvelle valeur.
- Écritures dans une transaction avec verrou : deux admins en même temps ne se marchent pas dessus (dépendances des modules, réglages, zones, promotions).
- Limites de débit : 60 modifications / 10 min et 120 simulations / 10 min par admin.
- Protections de rentabilité : plafond de subvention par commande, budget par promo et budget mensuel de livraison gratuite (une promo qui dépasse **ne s'applique pas**, elle n'est jamais rognée en silence), plancher et plafond de rémunération livreur, bornes min/max sur chaque réglage.
- Budgets, quotas d'abonnement et coins : consommés par une seule requête SQL conditionnelle, donc sans dépassement même en cas de commandes simultanées. Un coin n'est crédité qu'une fois par commande, même si l'événement est rejoué.
- Snapshot de commande écrit une seule fois (jamais réécrit) : changer un prix demain ne modifie pas l'historique.
- Le marketing n'est jamais appelé par le calcul du prix ni par celui du livreur ; le couper ne touche pas aux notifications de suivi de commande.
- Ne jamais exposer ces routes ou leurs réponses côté apps client / restaurant / livreur.

## 6 bis. Rappels de contrat (changements récents du produit)

- Rôle `CLIENT` partout (plus de `STUDENT`). `GET /analytics` : `activeClients`.
- Adresses de livraison libres (enregistrée / récente / ponctuelle, avec épingle GPS facultative) : voir `docs/ADRESSES_LIVRAISON.md`.

## 7. Variables d'environnement

- `PRICING_ENGINE_MODE` = `shadow` (défaut) ou `off`. Désactivé automatiquement pendant les tests.
- `MODULE_CACHE_TTL_MS` (défaut 30 000) : durée de vie du cache des modules.

## 8. Pour l'équipe : vérifier le shadow

```sql
SELECT "hasDiff", count(*) FROM "PricingParityLog" GROUP BY 1;
SELECT "diffFields", "legacyResult", "newResult" FROM "PricingParityLog" WHERE "hasDiff" ORDER BY "createdAt" DESC LIMIT 20;
```
Bascule possible seulement quand `hasDiff = true` n'apparaît plus pendant 7 jours.
