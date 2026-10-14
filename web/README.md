# AFFIA FOODS– Web

Deux sites indépendants, déployés sur Vercel (`vercel.json` dans chacun).

## `super_admin/` – Tableau de bord administrateur

**Stack :** Vite, React 18, TypeScript, Tailwind, Leaflet, Recharts, Socket.io client, Vitest.

Fonctions : centre de commande en direct (carte, livreurs), tableau des commandes et commandes à problème, commandes groupées multi-restaurants, validation des restaurants et livreurs, catalogue et commissions, finances / reversements, clients, réglages.

```bash
cd super_admin
npm install
npm run dev       # http://localhost:3000
npm test          # vitest run
npx vitest run src/components/CatalogPanel.test.tsx   # un seul fichier
npm run build     # tsc + vite build
```

- Appels API centralisés dans `src/services/api.ts`.
- URL du backend : `VITE_API_BASE_URL` et `VITE_SOCKET_URL` (par défaut `http://localhost:5000` en dev, `https://api.kraveo.site` en prod).
- `assetsInlineLimit: 0` dans `vite.config.ts` est volontaire : la politique de sécurité (CSP) de prod interdit les polices intégrées en data URI.

## `landing/` – Site vitrine

**Stack :** Vite, JavaScript, GSAP, Lenis.
Pages : accueil, `contact/`, `privacy/`, `refunds/`, `terms/`, `404.html`.

```bash
cd landing
npm install
npm run dev
npm run build
```
