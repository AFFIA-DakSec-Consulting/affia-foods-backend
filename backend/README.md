# Kraveo – Backend

API REST + serveur temps réel unique utilisé par les 3 apps Flutter et le dashboard admin. Toutes les routes sont sous `/api`.

**Stack :** Node 20, Express, TypeScript, Prisma (PostgreSQL), Socket.io, Razorpay, Firebase Admin (FCM).

## Démarrer

```bash
npm install
npx prisma migrate deploy      # base de données à jour
npx prisma generate            # après toute modification de prisma/schema.prisma
npm run dev                    # http://localhost:5000
npm run build && npm start     # production (dist/)
npx tsc --noEmit               # vérification des types
```

Variables obligatoires (`.env`) hors tests : `JWT_SECRET`, `DATABASE_URL`, `ADMIN_PASSCODE`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
Optionnelles : `GOOGLE_WEB_CLIENT_ID` (connexion Google), `FIREBASE_KEY_PATH` ou `FIREBASE_SERVICE_ACCOUNT` (push ; sans elles le push est désactivé).

## Tests

Jest + supertest sur une **vraie base PostgreSQL** (pas de base en mémoire) :

```bash
DATABASE_URL=... NODE_ENV=test RAZORPAY_WEBHOOK_SECRET=test_webhook_secret \
GOOGLE_WEB_CLIENT_ID=test-client-id.apps.googleusercontent.com npx jest --runInBand
# un fichier :  ... npx jest --runInBand test/e2e/order_flow_v1.test.ts
# un test    :  ... -t "nom du test"
```

- `test/harness/` : app de test, seed de la base, jetons, sockets, parcours complets.
- `test/e2e/` : une suite par fonctionnalité (nommée d'après le contrat `Docs/` correspondant).
- `test/unit/` : calculs d'argent et chiffrement.

## Organisation du code (`src/`)

| Dossier / fichier | Contenu |
|---|---|
| `index.ts` | Configuration Express, CORS, en-têtes de sécurité, Socket.io, tâche de maintenance toutes les 60 s |
| `routes/` | Routes fines : `api.ts` (auth, divers), `orders`, `partners`, `catalog`, `finance`, `devices` |
| `services/orderFlow.ts` | **Tous** les changements de statut d'une commande (transactions avec verrou de ligne) + code OTP de porte |
| `services/orderView.ts` | Le **seul** format JSON de commande renvoyé aux clients |
| `services/orderGroups.ts` | Commandes multi-restaurants (un panier, plusieurs dhabas) |
| `services/payment*`, `refundService.ts` | Razorpay : création, webhook signé, réconciliation, remboursements automatiques |
| `services/pricing.ts`, `settlement.ts`, `payout*` | Prix recalculés côté serveur, commissions, reversements aux partenaires |
| `services/push/` | Notifications FCM (envoyées après commit, sans doublon) |
| `realtime.ts` | Socket.io : salons `order_<id>`, `vendor_<id>`, `drivers` |
| `middleware/` | Auth JWT + rôles (`CLIENT`, `VENDOR`, `DRIVER`, `ADMIN`), limitation de débit, erreurs |
| `config/campus.ts` | Points de dépôt du campus (source unique) |
| `prisma/` | Schéma et migrations (`AAAAMMJJ_nom`, toujours additives) |

`store.ts` est un ancien jeu de données en mémoire, plus utilisé.

Référence détaillée (variables, maintenance, remboursements, guide admin) : `ORDER_FLOW_NOTES.md`.

## Documentation pour les apps

- [`docs/CONNEXION_CLIENT_OTP.md`](docs/CONNEXION_CLIENT_OTP.md) : connexion client par numéro + code (écrans, endpoints, erreurs, client de test). À donner au développeur Flutter.
