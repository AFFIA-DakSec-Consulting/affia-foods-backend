# Affia Foods

Plateforme de livraison de repas à **Thiès (Sénégal)** : des restaurants partenaires, des livreurs, des clients, et une équipe d'administration. Un restaurant prépare, un livreur récupère, le client reçoit et donne un **code à 4 chiffres** au livreur à la porte.

> Le projet s'appelait « Kraveo ». Les noms techniques hérités (`kraveo_*`, classes `kraveo-*`, `api.kraveo.site`, codes promo `KRAVEO20`) sont conservés tant qu'ils n'ont pas été migrés.

## Organisation du dépôt (monorepo)

```
affia-foods/
├── backend/            API Node.js + temps réel (Socket.io)               -> api.<domaine>
├── web/
│   ├── landing/        Site vitrine public (Vite, JS)                      -> <domaine>
│   └── super_admin/    Tableau de bord admin + espace restaurant (React)   -> admin.<domaine>
├── flutter/            Applications mobiles (client, restaurant, livreur) + design system
├── mobileapp/          Copie des applications Flutter (à clarifier : doublon de flutter/)
└── Docs/               Spécifications et contrats d'API (Docs/14 à Docs/24)
```

Tous les clients (applications Flutter et tableau de bord) parlent au même backend via REST (`/api`) et Socket.io.

## Déploiement

Chaque site web est déployé **séparément**, depuis son sous-dossier, avec son propre domaine. Un changement dans `web/super_admin` ne doit pas reconstruire `web/landing`, et inversement.

### Netlify (actuel)

Créer **deux sites** Netlify à partir du même dépôt Git. Chaque site lit le `netlify.toml` de son dossier (build, publication, redirections, en-têtes de sécurité) : seul le « Base directory » est à renseigner.

| Site Netlify | Base directory | Commande / dossier publié | Domaine (à définir) |
|---|---|---|---|
| affia-landing | `web/landing` | `npm run build` / `dist` | `<domaine>` |
| affia-admin | `web/super_admin` | `npm run build` / `dist` | `admin.<domaine>` |

Réglage conseillé pour chaque site : *Site configuration > Build & deploy > Build settings > Ignore builds* avec la commande `git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- .` : le site ne se reconstruit que si son propre dossier a changé.

L'adresse de l'API est dans `web/super_admin/netlify.toml` (`VITE_API_BASE_URL`, `VITE_SOCKET_URL`, la règle `/api/*` et `connect-src`). **Elle doit être changée aux quatre endroits** quand le domaine de l'API change.

### Dokploy (prévu : serveur auto-hébergé)

Chaque site a un `Dockerfile` (construction avec Node, service avec nginx) : `web/landing/Dockerfile` et `web/super_admin/Dockerfile`. Dans Dokploy, créer une application par site, source Git, *Build type* = Dockerfile, *Build path* = le sous-dossier.

- **Tableau de bord** : arguments de build `VITE_API_BASE_URL` et `VITE_SOCKET_URL` ; variables d'exécution `API_ORIGIN` (ex. `https://api.exemple.com`) et `API_WS_ORIGIN` (ex. `wss://api.exemple.com`), reprises par la règle de sécurité et le relais `/api`.
- **Backend** : `backend/Dockerfile` et `backend/docker-compose.yml` (PostgreSQL + API). Monter un **volume persistant** sur `/app/public/uploads` (photos des restaurants) et fournir les variables de `backend/.env.example`.

## Développement local

```bash
cd backend && docker compose up -d --build        # API sur http://localhost:5001
cd web/super_admin && npm install && npm run dev  # http://localhost:3000
cd web/landing && npm install && npm run dev      # http://localhost:5173
```

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
