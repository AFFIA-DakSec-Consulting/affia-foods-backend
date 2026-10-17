# 26 · Tableau de bord admin : modules, marketing, support, statistiques et espace restaurant

Récapitulatif de ce qui a été branché dans `web/super_admin` à partir des docs du backend
(`backend/docs/MODULES_RECAP_FRONT.md`, `backend/docs/ADMIN_SUPPORT_STATS.md`, `backend/docs/ADRESSES_LIVRAISON.md`).
Tous les appels passent par `src/services/api.ts` (`apiService.*`) ; les réponses sont lues par `src/lib/platformParse.ts`
(jamais de donnée serveur brute dans un composant). Devise : franc CFA (XOF, « FCFA »), voir la section 7.

## 1. Écrans administrateur construits

| Écran (URL) | Fichier | Endpoints utilisés |
|---|---|---|
| Modules `/modules` | `ModulesPanel.tsx` | `GET /admin/modules`, `PATCH /admin/modules/:code/toggle`, `GET/PATCH /admin/modules/:code/settings[/:key]` |
| Simulateur de prix `/simulateur` | `SimulatorPanel.tsx` | `POST /admin/pricing/simulate` |
| Zones de livraison `/zones` | `ZonesPanel.tsx` | `GET/PUT /admin/delivery-zones` |
| Zones de service `/zones-de-service` | `ServiceAreasPanel.tsx` | `/admin/service-areas` (voir `Docs/27_service_areas_contract.md`) |
| Codes promo `/codes-promo` | `PromotionsPanel.tsx` | `GET/POST/PATCH/DELETE /admin/promotions`, `…/:id/stats` |
| Offres restaurants `/offres` | `PromotionsPanel.tsx` (`merchantOnly`) | idem, filtré sur `fundedBy ≠ PLATFORM` |
| Abonnements `/abonnements`, Fidélité `/fidelite`, Primes livreurs `/primes-livreurs` | `RulesCrud.tsx` | `/admin/subscription-plans`, `/admin/loyalty-rules`, `/admin/courier-bonuses` |
| Parrainage `/parrainage` | `ReferralPanel.tsx` | `GET /admin/referrals`, `GET /admin/referrals/stats`, `POST /admin/referrals/:id/cancel` (routes ajoutées, voir 4) + réglages du module `marketing.referral` |
| Campagnes `/campagnes` | `CampaignsPanel.tsx` | `/admin/campaigns` (CRUD), `POST …/:id/send`, `GET …/:id/stats` |
| Notifications `/notifications` | `AdminExtraPages.tsx` | résumé des campagnes envoyées + réglages `marketing.campaigns` (plafond de push, heures silencieuses) |
| Réclamations `/reclamations` | `TicketsPanel.tsx` | `/admin/support/tickets` (liste, détail, PATCH, messages), `GET /admin/support/stats` |
| Avis clients `/avis` | `ReviewsPanel.tsx` | `GET /admin/reviews`, `GET /admin/reviews/stats`, `PATCH /admin/reviews/:id/flag` |
| Remboursements `/remboursements` | `FinanceExtraPanels.tsx` | commandes déjà chargées (`refundStatus`) + `POST /admin/orders/:id/retry-refund` |
| Commissions `/commissions` | `FinanceExtraPanels.tsx` | `GET /admin/finance/by-restaurant` |
| Documents légaux (Réglages) et Contrats `/contrats` | `LegalDocumentsPanel.tsx` | `/admin/legal-documents` (liste, détail, création, brouillon, publier, dépublier, activer, supprimer) |
| Centre d'aide `/aide` | `HelpCenterPanel.tsx` | `/admin/help-articles` (CRUD) |
| Équipe & accès `/equipe` | `TeamPanel.tsx`, `lib/permissions.ts` | `GET/POST /admin/team`, `PATCH /admin/team/:id`, `POST /admin/team/:id/reset-passcode`, `GET /admin/team/me` |
| Restaurants à recruter `/prospection` | `ProspectsPanel.tsx` | `/admin/prospects` (liste, stats, détail, création, modification, historique, suppression) |
| Segments clients `/segments` | `SegmentsPanel.tsx`, `lib/segments.ts` | `GET /admin/customers` (segments calculés côté tableau de bord, voir 9) |
| Journal d'activité `/journal` | `AuditPanel.tsx` | `GET /admin/modules/audit-log` et `GET /admin/audit-log` |
| Statistiques `/statistiques` (haut de page) | `OverviewStats.tsx` | `GET /admin/stats/overview?range=` |
| Tableau de bord `/tableau-de-bord` (bandeau) | `LiveCountersBar.tsx` | `GET /admin/orders/live?list=false`, rafraîchi toutes les 30 s |
| Alertes `/alertes` (bloc) | `ReconcilePanel.tsx` | `GET /admin/payments/reconcile` (lecture seule) |
| Réglages › Règles de commande, Moyens de paiement, Export | `AdminExtraPages.tsx` | réglages des modules `delivery.*`, `GET /admin/payout-providers`, `GET /admin/settlements/export.csv` |

## 2. Espace « Mon restaurant » (aperçu)

Écrans de `RestaurantPages.tsx`, pour le restaurant choisi en haut de page. Ils n'affichent que ce qu'un restaurant a le droit de voir
(ses prix et ses gains, jamais le prix client, les frais ni la commission, voir `Docs/21`).

| Écran | Source |
|---|---|
| Commandes en cours / Historique / Retours & annulations | commandes déjà chargées par l'application |
| Statistiques | idem, 7 derniers jours (ventes, panier moyen, plats populaires) |
| Avis clients | `GET /admin/reviews?vendorId=` |
| Paiements | `GET /admin/settlements?vendorId=` |
| Menu & plats (lecture seule) | `GET /admin/catalog?vendorId=` |
| Promotions | `GET /admin/promotions`, filtré sur les offres actives qui concernent le restaurant |

## 3. Encore « bientôt » (pas d'endpoint côté backend)

Modèles de messages, et les réglages : Sécurité, Entreprise & marque, Attribution des livreurs,
Horaires de la plateforme, Politique de remboursement, Taxes, Critères de validation, Catégories, Véhicules, Expéditeurs,
Langues, Intégrations, Maintenance. Côté restaurant : Équipe, Aide & support, et les 4 réglages `r-settings-*`.
Chacune de ces pages affiche ce qu'elle réglera et ce que le serveur doit fournir d'abord.

## 4. Changements côté backend

- `src/modules/marketing/referral-admin.service.ts` (nouveau) et 3 routes dans `src/routes/modulesAdmin.ts` :
  liste paginée des parrainages (filtre `status`), statistiques (total, en attente, récompensés, annulés, taux de conversion,
  meilleurs parrains), annulation d'un parrainage encore en attente (écrite dans le journal d'audit).
  La récompense n'est pas versée par ces routes : la logique d'attribution reste à écrire (règles de fidélité `REFERRAL`).
- `src/core/modules/admin-catalogs.service.ts` : le nom de ville accepte désormais les lettres de tout alphabet
  (« Thiès » était refusé comme ville de campagne ou de zone).
- `src/routes/content.ts` (nouveau, monté dans `src/routes/api.ts`), migration `20261019_legal_help`, modèles `LegalDocument` et `HelpArticle` :
  - Documents légaux (CGU, confidentialité, remboursements, contrat restaurant, contrat livreur), par langue, en versions.
    Cycle : brouillon (modifiable, supprimable) → publié (jamais modifié : un changement est une nouvelle version) → activé (une seule version affichée par type et langue).
    On ne peut pas repasser en brouillon la version affichée. Chaque action est écrite dans `GET /admin/audit-log`.
  - Articles d'aide : slug unique, thème, public (tous, clients, restaurants, livreurs), publié ou non, ordre.
  - Routes publiques pour les apps, sans jeton : `GET /api/legal/:type?locale=fr` (version activée) et `GET /api/help/articles?audience=CLIENT` (articles publiés).
  - Les textes refusent `<`, `>` et les caractères de contrôle. Pas de suivi des signatures (qui a signé quelle version) pour l'instant.
- **Équipe & accès** : `src/services/adminTeam.ts` (rôles, groupes, mots de passe) et `src/routes/team.ts`, migration `20261020_team_prospecting`.
  - Le propriétaire (compte ADMIN sans code personnel) se connecte avec `ADMIN_PASSCODE` et garde tous les droits : rien ne change pour l'existant.
    Un membre se connecte avec son **téléphone** (champ `identifier` de `POST /auth/admin-login`) et un **code personnel** de 12 caractères, généré par le serveur, affiché **une seule fois** et stocké haché (scrypt).
  - 5 rôles : SUPER_ADMIN, OPERATIONS, FINANCE, SUPPORT, MARKETING. Chacun ouvre des groupes de routes : ops, finance, marketing, support, content, prospecting, stats, team.
  - **Appliqué par le serveur** : un garde (`adminPermissionGuard`) est monté sur tout `/api/admin/*` avant les autres routeurs et répond `403 PERMISSION_DENIED` hors des droits du rôle.
    Le rôle est relu à chaque requête (cache de 10 s). Le tableau de bord n'affiche que ce que le rôle peut ouvrir, et ne déconnecte pas sur ce 403.
  - Suspendre un membre ou régénérer son code coupe ses sessions tout de suite. Garde-fous : on ne modifie pas le propriétaire ni soi-même, et il reste toujours un super admin actif.
  - Le code général ne connecte plus un membre : il ouvre uniquement le compte propriétaire.
- **Prospection** : `src/routes/prospects.ts`, modèles `Prospect` et `ProspectEvent`. Suivi manuel (restaurants et livreurs) : étapes à contacter, contacté, à relancer, intéressé, signé, refusé; potentiel A/B/C; date de relance;
  historique daté (note, appel, visite, WhatsApp) et changements d'étape. Pas d'envoi automatique de messages.
- Tests backend ajoutés : `test/unit/admin_team.test.ts` (groupes, rôles, codes). Pas de test backend pour les routes de parrainage, documents légaux, aide, équipe et prospection.

## 5. Données de démonstration (base Docker locale uniquement)

Modules activés : `courier.bonuses`, `marketing.campaigns`, `marketing.subscription`, `marketing.referral`, `delivery.zone_pricing`,
`delivery.surge_pricing`, `marketing.free_delivery`, `marketing.merchant_funded`. Ajoutés : 5 primes livreurs, 4 abonnements, 4 règles de fidélité,
4 membres d'équipe (Finance, Opérations, Support, Marketing), 8 contacts de prospection, 4 campagnes, 5 documents légaux activés (+ 1 brouillon de CGU v2), 7 articles d'aide (1 non publié), 8 commandes livrées avec 8 avis (2 signalés), 4 réclamations avec fil de discussion, 6 parrainages.
Les ids de démonstration commencent par `seed-`. Ces données ne doivent pas aller en production.

## 6. Environnement de développement

- Le tableau de bord appelle `http://localhost:5001` : c'est le conteneur Docker `backend-backend-1` (5001→5000).
  Après toute modification du backend : `docker compose up -d --build backend` dans `backend/` (les migrations Prisma s'appliquent au démarrage).
  Une image ancienne répond « Route … not found » sur les nouvelles routes.
- Tests : `npm test` dans `web/super_admin` (629 tests). Les tests de l'application doivent mocker `fetchLiveCounts` :
  le bandeau en direct appelle le serveur, et un 401 réel déconnecterait la session de test.

## 7. Devise

Franc CFA (XOF), affiché « FCFA », sans centimes. Le backend calcule en entiers à l'échelle ×100 (noms historiques `amountPaise`,
`amountInPaise` : 100 « paise » = 1 FCFA, voir `backend/src/config/currency.ts`). Les montants affichés dans le tableau de bord sont en FCFA entiers ;
la réconciliation des paiements divise `amountPaise` par 100.

## 8. Points d'attention

- Les avis par plat ne contiennent que l'identifiant du plat (pas son nom) : l'écran affiche « Plat » avec la note.
- Remboursements et espace restaurant se basent sur les commandes chargées par l'application (récentes), pas sur tout l'historique.
- Le moteur de prix est en mode « shadow » : il ne facture pas encore (bascule après 7 jours sans écart dans `PricingParityLog`).
- Le rendu visuel n'a pas été vérifié dans un navigateur ; les écrans sont couverts par des tests de logique et de composants.

## 9. Inspiration : le dashboard Eylos

Le dashboard Eylos (`wisourcing/eylos-monorepo/apps/dashboard`, Angular) a la même organisation de pages : avis, tickets, centre d'aide,
documents légaux et contrats, segments clients, campagnes, prospection, journal d'audit, commissions, versements, remboursements, parrainage
(invitations et filleuls), équipe et rôles (RBAC), modération.

- **Repris :** les segments clients automatiques (nouveaux, 1re commande, récurrents, fidèles, à risque) avec le tableau
  commandes / total payé / panier moyen / dernière commande. Calculés à partir de `GET /admin/customers` (300 clients au plus,
  l'écran indique quand il y en a davantage). Pas de segment « panier abandonné » : le backend n'a pas cette donnée.
- **Repris aussi :** les documents légaux versionnés (brouillon, publié, activé) et le centre d'aide par thème.
- **Bonnes pistes pour la suite**, chacune demande d'abord des tables et routes côté backend :
  suivi des signatures des contrats, équipe & rôles (RBAC), prospection de restaurants, file de modération.

## 10. Sécurité de l'équipe : lecture seule, double authentification, sessions

Migration `20261021_admin_security` (colonnes sur `User` et table `AdminSession`), `src/services/adminTeam.ts`, `src/routes/team.ts`.

- **Lecture seule par section.** Chaque rôle a un niveau par section : `write` (tout) ou `read` (consultation). Une requête `GET` est une lecture, de même que
  `POST /pricing/simulate` et `POST /catalog/preview` (ils ne font que calculer). Tout le reste est une modification. Le serveur répond
  `403 READ_ONLY` à une modification en lecture seule, et `403 PERMISSION_DENIED` hors des sections du rôle. Aucun des deux ne déconnecte l'utilisateur.
  Nouveau rôle **VIEWER** (« Lecture seule ») : consulte tout sauf l'équipe. Le rôle Marketing consulte maintenant les clients (segments), Finance consulte les opérations,
  Opérations consulte la finance et le marketing. Le tableau de bord affiche un bandeau « Lecture seule » sur ces écrans.
- **Double authentification (TOTP, RFC 6238).** Page Réglages › Sécurité. Activation en deux temps (clé à saisir dans une application d'authentification, puis un premier code),
  8 codes de secours affichés une seule fois (stockés hachés, usage unique). La clé est chiffrée au repos avec `PAYOUT_ENC_KEY` (sans cette clé : `503 TWO_FACTOR_UNAVAILABLE`).
  À la connexion, le serveur répond `401 OTP_REQUIRED` puis demande le code ; un code ne sert qu'une fois (on enregistre le pas de 30 s) ; une erreur compte dans la limite de tentatives.
  Le propriétaire peut l'activer aussi. Un super admin peut réinitialiser celle d'un membre qui a perdu son téléphone (`POST /admin/team/:id/reset-2fa`), ce qui coupe ses sessions.
  Pas de QR code : la clé se saisit à la main.
- **Sessions.** Chaque connexion crée une ligne `AdminSession` et le jeton porte son identifiant (`sid`). Page Sécurité : liste (appareil, adresse, dernière activité), fermeture d'une session
  ou de toutes les autres. Une session fermée est refusée tout de suite (`401 TOKEN_REVOKED`). Suspendre un membre ou régénérer son code ferme toutes ses sessions.
  Les jetons émis avant cette version n'ont pas de `sid` et restent acceptés jusqu'à leur expiration.
- **Propriétaire en double.** Le propriétaire est le plus ancien compte admin sans code personnel. Les autres comptes admin sans code sont marqués « Sans code » : ils ne peuvent pas se connecter
  tant qu'on ne leur donne pas un code (« Donner un code »), ce qui en fait des membres normaux. Le garde-fou « dernier super admin » ne compte que les comptes qui peuvent vraiment se connecter.
- **Limites de débit** ajoutées : modifications de l'équipe, tentatives de double authentification, modifications de contenus (documents légaux, aide, prospection, parrainage).

### Tests
- Backend, unitaires : `test/unit/admin_team.test.ts` (sections, lecture/écriture, codes, vecteurs de référence RFC 6238, codes de secours).
- Backend, e2e : `test/e2e/admin_team.test.ts` (23 scénarios : connexion propriétaire et membres, droits par rôle, suspension, protection du propriétaire et du dernier super admin,
  double authentification complète avec rejeu refusé, sessions, prospection, documents légaux, articles d'aide, parrainage).
  **Les tests e2e touchent la base : ne les lancez jamais sur la base de démonstration.** Créez une base à part et migrez-la :
  `CREATE DATABASE kraveo_test;` puis `DATABASE_URL=postgresql://kraveo:kraveo@localhost:5433/kraveo_test npx prisma migrate deploy`
  (sur une base neuve, marquer d'abord `20260904_align_legacy_schema` et `20260904_clear_legacy_gate_otps` comme appliquées avec `prisma migrate resolve --applied`), puis
  `DATABASE_URL=… npx jest --runInBand`.

### Connexions en direct et récupération
- **Sockets.** Une session fermée est refusée à la connexion en direct, et les connexions déjà ouvertes sont coupées au moment de la fermeture
  (fermer une session, fermer les autres, suspendre un membre, régénérer un code, réinitialiser la double authentification). Chaque socket admin rejoint la salle `session_<sid>`.
- **Récupération côté serveur.** Pour un compte qui a perdu son téléphone et ses codes de secours, quand aucun autre super admin ne peut le réinitialiser :
  `docker compose exec backend node dist/utils/adminReset2fa.js owner` (le propriétaire) ou `… adminReset2fa.js "77 123 45 67"` (un membre).
  La commande efface la double authentification de ce seul compte, ferme ses sessions et écrit le journal d'audit. Le tableau de bord avertit quand il n'y a qu'un seul super admin utilisable.
- **Tests.** `test/setup-env.js` fixe `JWT_SECRET` et `RAZORPAY_WEBHOOK_SECRET` aux valeurs attendues par les suites (un `.env` local n'a plus d'effet sur elles)
  et désactive la réutilisation des connexions HTTP (voir « Stabilité de la suite » plus bas).

### Stabilité de la suite backend (état au moment de la rédaction)
- Lancés **un fichier par processus**, sur une base de test neuve : 35 à 37 fichiers sur 38 passent, les échecs tombent sur des fichiers différents d'un passage à l'autre, et chaque fichier repasse quand on le relance.
- Lancée **en un seul processus** (`npx jest --runInBand`) : 0 à 3 échecs aléatoires par passage, dans des fichiers sans rapport avec l'équipe (`pricing_catalog`, `vendor_location`, `settlement`, `payments_adversarial`…).
  Symptômes : une réponse 404 ou 403 inattendue, ou `Parse Error: Expected HTTP/`. Cause probable : des connexions HTTP réutilisées entre les petits serveurs éphémères de `supertest` (Node 20 les garde ouvertes). La désactivation de cette réutilisation a réduit les échecs sans les supprimer.
- **Ce n'est pas dû au garde de droits** : `pricing_catalog` échoue 1 fois sur 8 avec le garde désactivé comme avec le garde actif (8 passages chacun).
- Reste à faire : trouver la cause racine (a priori dans `test/harness/app.ts` et l'usage de `supertest`) avant de brancher la suite sur un contrôle automatique.
- Après une exécution interrompue, un compte admin de la base de test peut garder une double authentification activée et fausser la connexion du propriétaire dans les autres fichiers : `UPDATE "User" SET "adminTotpEnabledAt" = NULL, "adminTotpSecret" = NULL, "adminBackupCodes" = '{}' WHERE role = 'ADMIN';`. `admin_team.test.ts` nettoie désormais cet état à la fin.

## 11. Limites connues

- Les droits sont par section et par niveau (lecture ou écriture), pas par action : un rôle qui modifie une section peut y tout modifier.
- Pas de liste d'adresses autorisées, ni de changement du code général du propriétaire depuis le tableau de bord (il se règle dans `ADMIN_PASSCODE`).
- Pas de nouvelle saisie d'un code pour les actions sensibles (afficher un numéro de compte, marquer un règlement payé, suspendre un partenaire).
- Le code d'accès général reste partagé par tous ceux qui le connaissent : à terme, le remplacer par un compte propriétaire personnel avec double authentification.
