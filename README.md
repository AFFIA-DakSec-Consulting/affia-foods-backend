# Kraveo

Plateforme de livraison de repas pour le campus de **VIT Bhopal** : les dhabas (restaurants) de l'autoroute Ashta–Kothri livrent les étudiants jusqu'aux points de dépôt des résidences (BH1…BH8, Special Block, GH1, GH2). Les livreurs n'entrent pas dans les résidences : la remise se fait à la porte avec un **code OTP à 4 chiffres** vérifié par le serveur.

## Organisation du dossier

```
kraevoapp/
├── backend/            API Node.js + temps réel (Socket.io)
├── web/
│   ├── super_admin/    Tableau de bord administrateur (React)
│   └── landing/        Site vitrine public
├── flutter/
│   ├── apps/
│   │   ├── customer_app/   App étudiant (commande)
│   │   ├── vendor_app/     App restaurant partenaire
│   │   └── driver_app/     App livreur
│   ├── packages/kraveo_ui/ Design system partagé par les 3 apps
│   ├── scripts/build_mobile_apks.sh
│   └── *.png               Logos utilisés pour les icônes des apps
└── Docs/               Spécifications et contrats d'API (Docs/14 à Docs/22)
```

Tous les clients (3 apps Flutter + dashboard web) parlent au même backend via REST (`/api`) et Socket.io.
Production : `https://api.kraveo.site`.

---

## Backend (`backend/`)

**Stack :** Node 20, Express, TypeScript, Prisma (PostgreSQL), Socket.io, Razorpay (paiement), Firebase Admin (notifications push FCM).

```bash
cd backend
npm install
npx prisma migrate deploy      # appliquer les migrations
npm run dev                    # serveur sur http://localhost:5000
npm run build && npm start     # production
npx tsc --noEmit               # vérification des types
```

Hors tests, le serveur refuse de démarrer sans un `.env` contenant :
`JWT_SECRET`, `DATABASE_URL`, `ADMIN_PASSCODE`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
Les notifications push sont désactivées tant que `FIREBASE_KEY_PATH` (ou `FIREBASE_SERVICE_ACCOUNT`) n'est pas défini.

**Tests** (Jest + supertest, sur une **vraie base PostgreSQL**) :
```bash
DATABASE_URL=... NODE_ENV=test RAZORPAY_WEBHOOK_SECRET=test_webhook_secret \
GOOGLE_WEB_CLIENT_ID=test-client-id.apps.googleusercontent.com npx jest --runInBand
# un seul fichier : ajouter test/e2e/order_flow_v1.test.ts   — un seul test : -t "nom"
```

**Points clés de l'architecture :**
- `src/routes/` : routes fines (auth, commandes, partenaires, catalogue, finance, appareils) ; la logique est dans `src/services/`.
- `services/orderFlow.ts` : **tous** les changements de statut d'une commande, en transaction avec verrou de ligne.
- `services/orderView.ts` : le **seul** format JSON de commande renvoyé aux clients (visibilité selon le rôle).
- `services/orderGroups.ts` : commandes multi-restaurants (un panier, plusieurs dhabas, un livreur).
- Paiements : prix toujours recalculés côté serveur, webhook Razorpay signé, réconciliation et remboursements automatiques.
- Une tâche de maintenance tourne toutes les 60 s (expiration des commandes non payées, remboursements, relances push).
- Rôles : `STUDENT`, `VENDOR`, `DRIVER`, `ADMIN` (JWT `Authorization: Bearer ...`).
- Référence détaillée : `backend/ORDER_FLOW_NOTES.md`.

---

## Web (`web/`)

### Tableau de bord admin (`web/super_admin`)
**Stack :** Vite, React 18, TypeScript, Tailwind, Leaflet (carte), Vitest.
Suivi des commandes en direct, commandes à problème, validation des partenaires, catalogue, livreurs, finances / reversements, réglages.

```bash
cd web/super_admin
npm install
npm run dev     # http://localhost:3000
npm test        # vitest
npm run build
```
URL de l'API : variables `VITE_API_BASE_URL` / `VITE_SOCKET_URL` (par défaut `localhost:5000` en dev, `api.kraveo.site` en prod).

### Site vitrine (`web/landing`)
Vite + JavaScript + GSAP. Pages : accueil, contact, confidentialité, remboursements, CGU.
```bash
cd web/landing && npm install && npm run dev
```

Les deux sites se déploient sur Vercel (`vercel.json`).

---

## Flutter (`flutter/`)

| App | Nom installé | Rôle |
|---|---|---|
| `customer_app` | Kraveo | L'étudiant choisit un dhaba, commande (même chez plusieurs restaurants), paie via Razorpay, suit le livreur sur la carte et donne le code OTP à la porte. |
| `vendor_app` | Kraveo Restaurant Partner | Le restaurant reçoit les commandes avec alarme sonore forte, accepte / refuse (gros boutons), gère le stock, voit ses ventes et reversements. |
| `driver_app` | Kraveo Delivery Partner | Le livreur passe en ligne, accepte une course, récupère chez un ou plusieurs restaurants, partage sa position GPS et valide la livraison avec le code OTP. |

Les trois apps utilisent le package partagé `packages/kraveo_ui` (via un chemin relatif `../../packages/kraveo_ui` — garder cette structure).

```bash
cd flutter/apps/customer_app   # ou vendor_app / driver_app / ../packages/kraveo_ui
flutter pub get
flutter run
flutter analyze
flutter test
```

- L'URL du backend est dans `lib/config/api_config.dart` : `isProduction = true` par défaut. Passer à `false` pour pointer sur un backend local (`http://10.0.2.2:5000` depuis l'émulateur Android).
- Build des APK de release, nommés par rôle et version (`Kraveo-Customer-v1.8.0-build14-release.apk`, etc.) :
  ```bash
  cd flutter && ./scripts/build_mobile_apks.sh    # sortie dans flutter/build/apks/
  ```
- Les trois `pubspec.yaml` partagent le même numéro de version, à monter ensemble.

---

## Documentation (`Docs/`)

Les fonctionnalités sont définies par des contrats : authentification (14–15), cycle de commande (16), notifications push (18), cartes du campus (19), localisation des restaurants (20), prix / catalogue / reversements (21), commandes multi-restaurants (22). À lire avant de modifier un endpoint, et à garder cohérent entre backend, dashboard et apps.
