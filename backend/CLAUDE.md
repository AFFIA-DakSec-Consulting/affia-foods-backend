# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Backend Kraveo : une seule API REST + serveur Socket.io pour une plateforme de livraison de repas à Thiès (Sénégal). Le produit venait d'une version campus en Inde : les noms de champs/fichiers hérités (`hostelBlock`, `dropoffHostel`, `/api/campus`, `fssaiNumber`, `upiId`, `razorpay*`, `*Paise`) sont gardés pour les apps ; lisez-les comme quartier, quartier de livraison, NINEA, numéro Wave/Orange Money, identifiants du fournisseur de paiement, centièmes de FCFA. Il sert les trois apps Flutter (client/STUDENT, VENDOR, DRIVER) et le dashboard admin web, qui se trouvent dans les dossiers voisins `../flutter` et `../web`. Toutes les routes sont montées sous `/api`. Stack : Node 20, Express, TypeScript (strict, CommonJS), Prisma/PostgreSQL, Socket.io, Razorpay, Firebase Admin (FCM).

Les contrats de fonctionnalités sont dans `../Docs/` (par ex. `16_order_flow_contract.md`, `18_push_notifications_contract.md`, `21_pricing_catalog_settlement_contract.md`, `22_multi_restaurant_orders_contract.md`). Les commentaires du code les citent sous la forme `Docs/NN`. Lisez le contrat correspondant avant de modifier un comportement. `ORDER_FLOW_NOTES.md` est la référence d'exploitation : constantes et variables d'environnement, tâche de maintenance, politique de relance des remboursements, guide admin « needs-attention » et notes par version. Mettez-le à jour quand vous modifiez l'un de ces points.

## Commandes

```bash
npm run dev                    # ts-node-dev sur src/index.ts, http://localhost:5000
npm run build && npm start     # tsc -> dist/, puis node dist/index.js
npx tsc --noEmit               # vérification des types (il n'y a pas de linter)
npx prisma migrate deploy      # applique les migrations
npx prisma generate            # obligatoire après toute modification de prisma/schema.prisma
```

Hors `NODE_ENV=test`, le serveur refuse de démarrer si `.env` ne définit pas `JWT_SECRET`, `DATABASE_URL`, `ADMIN_PASSCODE`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` et `RAZORPAY_WEBHOOK_SECRET`. Le push est désactivé (un seul avertissement au démarrage) si ni `FIREBASE_KEY_PATH` ni `FIREBASE_SERVICE_ACCOUNT` n'est défini.

### Docker

```bash
docker compose up -d --build   # Postgres 16 + backend ; migrations appliquées au démarrage
docker compose logs -f backend
docker compose down            # ajouter -v pour effacer la base
```

- API : `http://localhost:5001`. Le port 5000 de l'hôte est pris par AirPlay sur macOS ; dans le conteneur, le serveur écoute sur 5000.
- Postgres est accessible depuis l'hôte : `postgresql://kraveo:kraveo@localhost:5433/kraveo`. C'est aussi le `DATABASE_URL` de `.env`, donc `npm run dev` et les commandes `npx prisma` locales l'utilisent. Dans le conteneur, compose le remplace par l'hôte `db`.
- Le conteneur lit les secrets dans `.env` (modèle : `.env.example`).
- `docker/entrypoint.sh` lance `prisma migrate deploy`, puis le serveur. Sur une base neuve, il marque d'abord `20260904_align_legacy_schema` et `20260904_clear_legacy_gate_otps` comme appliquées. Ces deux migrations visent les anciennes bases créées par `db push`, et l'ordre alphabétique les fait passer avant la migration initiale `20260904_make_order_otp_nullable`. Sans ce marquage, `migrate deploy` échoue sur une base vide.

### Données de démo

`npm run seed:demo` (`src/utils/seedDemoData.ts`) remplit la base de `.env` : 6 restaurants, 33 plats, 3 livreurs, 6 étudiants et 17 commandes (historique sur 7 jours, plus des commandes en cours). Il est rejouable : tout est upserté par id fixe et les commandes déjà présentes ne sont pas recréées. Il refuse de tourner avec `NODE_ENV=production`. Les ids commencent par `demo-`.

- Les images sont dans `public/seed-images/`, servies par le backend sous `/static` (`src/index.ts`) et copiées dans l'image Docker. Les URLs enregistrées en base viennent de `SEED_IMAGE_BASE` (défaut `http://localhost:5001/static/seed-images`). Les apps Flutter locales visent `10.0.2.2` et le dashboard web `localhost` : pour un émulateur Android, relancez avec `SEED_IMAGE_BASE=http://10.0.2.2:5001/static/seed-images`.
- Les comptes vendeurs et livreurs partagent un mot de passe, écrit avec les numéros dans `DEMO_ACCOUNTS.local.txt` (ignoré par git). Les étudiants se connectent via Google, ils n'ont pas de mot de passe.

### Tests

Jest + supertest + de vraies connexions `socket.io-client`, sur une **vraie base PostgreSQL**. Il n'y a pas de base en mémoire. Le harnais supprime les commandes et les utilisateurs : faites pointer `DATABASE_URL` vers une base jetable.

```bash
DATABASE_URL=... NODE_ENV=test RAZORPAY_WEBHOOK_SECRET=test_webhook_secret \
GOOGLE_WEB_CLIENT_ID=test-client-id.apps.googleusercontent.com npx jest --runInBand
# un fichier : ajouter test/e2e/order_flow_v1.test.ts
# un test :    ajouter -t "nom du test"
# WRITE_ORDER_FIXTURES=1 avec order_flow_v1.test.ts régénère ../Docs/fixtures/order_flow_samples.json
```

Passez toujours `--runInBand`, car les suites partagent une seule base. Comportement en mode test :
- Les limites de débit sont désactivées, sauf si le `RL_*_MAX` de la règle est défini.
- Le TTL du cache d'auth est 0.
- La tâche de maintenance ne tourne pas. Les tests appellent eux-mêmes `runOrderMaintenance(now)`.
- Les vrais fournisseurs Razorpay et FCM ne sont jamais créés. Les tests injectent des faux avec `setPaymentProvider(createSimulatedProvider())` et `setPushProvider(...)`.
- `__waitForBackgroundWork()` (refundService) attend la fin des remboursements et des push lancés en arrière-plan avant les assertions.

Organisation du harnais :
- `test/harness/` : app de test, seed et nettoyage de la base, helpers JWT, sockets, parcours de bout en bout.
- `test/e2e/` : une suite par fonctionnalité ou contrat.
- `test/unit/` : calculs d'argent et chiffrement.

## Version Sénégal (à savoir avant de toucher à l'argent, aux numéros ou aux adresses)

- **Monnaie : FCFA (XOF)**, sans centimes. Calculs internes toujours en entiers ×100 (`config/currency.ts`) ; les prix, frais, remises, reversements saisis par une personne doivent être des FCFA entiers. Frais par défaut 500 FCFA (+300 par restaurant en plus), TVA 18 % sur les frais. Pour un vrai fournisseur FCFA, ne convertir (÷100) que dans `paymentService.ts`. L'adaptateur Razorpay ne gère pas le FCFA.
- **Paiements simulés** : `PAYMENT_PROVIDER=simulated` dans `.env` (refusé si `NODE_ENV=production` sauf `ALLOW_SIMULATED_PAYMENTS=true`). `GET /api/payments/methods` (Wave, Orange Money, espèces + logos de `public/payment-logos`) et `POST /api/payments/simulate {orderId, method}` paient la commande sans débiter personne. Les espèces sont traitées comme payées d'un coup.
- **Téléphones** : mobiles sénégalais `+221 7[05678]XXXXXXX` (`utils/phone.ts`, clé = 9 derniers chiffres `phoneKey`).
- **Adresses** : 14 quartiers de Thiès dans `config/campus.ts` (coordonnées approximatives à corriger). Fuseau Africa/Dakar = UTC+0 (`utils/time.ts`, `LOCAL_OFFSET_MS`).
- **Reversements** : Wave, Orange Money ou banque (IBAN/RIB), plus d'UPI/IFSC. Coupons : `BIENVENUE` (ancien `VITFIRST` toujours valable), `KRAVEO20`, `KRAVEO50`.
- **Tests** : `test/setup-env.js` force `PAYMENT_PROVIDER=razorpay`. Certaines suites dont le sujet est la mécanique de l'argent appellent `useLegacyEconomics()` (`test/harness/legacyEconomics.ts`) pour retrouver les petits montants de la première version. Les fixtures partagées ont un plat à 4000 FCFA pour passer les minimums de coupons.

## Architecture

**Chemin d'une requête.** `src/index.ts` configure Express : `trust proxy` = 1 (nginx), en-têtes de sécurité, CORS, et un parseur JSON qui conserve `rawBody` pour vérifier la signature des webhooks. Il monte ensuite `routes/api.ts`, qui intègre les routeurs `orders`, `partners`, `catalog`, `finance` et `devices`. Il attache aussi Socket.io (`realtime.ts`) et lance la tâche de maintenance toutes les 60 s. Les routes restent fines : valider l'entrée, appeler un service, répondre avec `fail(res, err, what)` de `utils/http.ts`. Lever une `AppError`/`OrderFlowError` donne une réponse typée `{code, message}`. Toute autre erreur est journalisée sans données de requête et devient une 500 générique. L'auth repose sur un JWT et un contrôle de rôle (`middleware/auth.ts`). Les jetons portent `tv` (le `tokenVersion` de l'utilisateur) : l'incrémenter révoque tous les jetons et sockets actifs de cet utilisateur.

**Statut des commandes.** Tout changement de statut passe par `services/orderFlow.ts`. N'écrivez `Order.status` nulle part ailleurs. Chaque changement s'exécute dans `withOrderLock`, une transaction Prisma qui pose un verrou de ligne `SELECT ... FOR UPDATE` et revérifie ses conditions sous ce verrou. Un changement renvoie un `ChangeResult`, et `finishChange` exécute les effets de bord **après le commit** : émissions socket, push mis en file, remboursements. Le graphe des transitions est dans `utils/stateMachine.ts` (PLACED → ACCEPTED → PREPARING → READY_FOR_PICKUP → PICKED_UP → ARRIVED_AT_GATE → DELIVERED, avec CANCELLED possible avant l'arrivée à la porte). Le code OTP de porte est créé à ARRIVED_AT_GATE.

**Commandes multi-restaurants (Docs/22).** Un panier peut devenir un `OrderGroup` avec plusieurs `Order` enfants. `services/orderGroups.ts` gère le devis, la création et le format GroupView, mais les changements de statut d'un groupe restent dans `orderFlow.ts`. Les verrous sont toujours pris dans cet ordre : ligne `DriverPartner` du livreur → ligne `OrderGroup` → commandes enfants par id croissant (`groupLock.ts`). Respectez le même ordre dans toute nouvelle transaction, sinon vous risquez des interblocages.

**Format de réponse.** `services/orderView.ts` construit le seul JSON de commande envoyé aux clients, masqué selon qui le consulte. Ne sérialisez jamais directement une ligne de commande Prisma.

**Argent.**
- Tous les montants sont des paise entiers.
- Prix, frais, coupons et commissions sont toujours recalculés côté serveur (`services/pricing.ts`, `utils/validation.ts`). Les totaux envoyés par le client ne sont jamais pris tels quels.
- Les totaux d'un groupe sont répartis par la méthode du plus fort reste (`splitGroupMoney`).
- Le règlement et les reversements sont dans `settlement.ts`, `finance.ts` et `payout*.ts`. Les données de compte de reversement sont chiffrées avec `payoutCrypto.ts`.

**Paiements et remboursements.**
- Razorpay est appelé via le fournisseur injectable de `paymentService.ts`.
- Une commande ne passe à PAID que par `markOrderPaid`, depuis trois sources : le webhook signé, `verify-signature` (après récupération ou capture chez Razorpay), ou la réconciliation (`paymentReconcile.ts`).
- `refundService.ts` rembourse chaque paiement au plus une fois, grâce à un bail en base et une vérification chez le fournisseur. Les erreurs temporaires du fournisseur sont relancées avec un délai croissant. Les erreurs définitives s'arrêtent après 3 tentatives.
- `providerPool.ts` limite le nombre d'appels simultanés au fournisseur et contient un disjoncteur.
- `orderMaintenance.ts` (la tâche toutes les 60 s) fait d'abord le travail en base seule (expirer les commandes non payées, annuler les commandes payées que personne n'a acceptées), puis la phase fournisseur (remboursements, remboursement des paiements en double, réconciliation, relance des push, nettoyage).

**Temps réel et push.**
- Les salons Socket.io sont `order_<id>`, `vendor_<id>` (restaurants approuvés uniquement) et `drivers` (livreurs approuvés et ONLINE). La connexion socket vérifie le JWT et `tv` comme l'auth HTTP.
- Le push FCM (`services/push/`) ne fait qu'ajouter des notifications en plus des sockets et du polling. Il ne modifie jamais une commande.
- Les push sont mis en file après le commit, jamais attendus, et ne lèvent jamais d'erreur. Les doublons sont évités par la clé unique `PushLog.key = orderId:event:userId`.

**Autres points.**
- Les actions admin et système sont écrites dans le journal d'audit (`services/audit.ts`).
- Les points de dépôt du campus ont une seule source : `config/campus.ts`.
- Les constantes du flux de commande sont dans `config/orderFlow.ts`.
- `src/store.ts` est un ancien jeu de données en mémoire que plus rien n'utilise.

**Migrations.** Les dossiers de `prisma/migrations/` sont nommés `AAAAMMJJ_nom`, et chaque migration est uniquement additive. La production exécute `prisma migrate deploy`. `prisma/README.md` explique comment marquer une base existante comme déjà migrée (baseline).
