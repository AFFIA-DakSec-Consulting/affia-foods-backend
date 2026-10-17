# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

`web/` holds two independent Vite sites, each with its own `package.json` and `Dockerfile` (built with Node and served by nginx, deployed separately on Dokploy; there is no Netlify or Vercel). There is no root package — run commands inside the sub-folder. Sibling folders in the monorepo: `../backend` (API at `http://s598n3mrwe6p76b2bv2exazh.192.162.70.47.sslip.io`), `../flutter` (customer / restaurant / rider apps), `../Docs` (specs and contracts).

## Commands

```bash
# super_admin/ — admin dashboard (Vite + React 18 + TS + Tailwind)
npm run dev                                       # http://localhost:3000
npm test                                          # vitest run (all)
npx vitest run src/components/CatalogPanel.test.tsx   # single file
npx vitest run -t "shows paise"                   # single test by name
npm run build                                     # tsc (typecheck) + vite build

# landing/ — marketing site (Vite, plain JS, GSAP, Lenis)
npm run dev
npm run build
```

There is no linter configured; `tsc` in `npm run build` is the type check for `super_admin`.

## super_admin architecture

- **`src/App.tsx`** is the hub: it owns auth state, the active tab (`TabType`), and the shared data (orders, vendors, riders, rider map pins, badge counts). It runs the Socket.io connection (joins the `admins` room; listens to `order_updated`, `new_order_alert`, `driver_location_update`, `partner_application*`, `driver_duty_update`) **and** a 15 s REST poll while the page is visible — sockets are only a speed-up, the poll is the source of truth. Panels in `src/components/` receive data and callbacks as props.
- **`src/services/api.ts`** is the only place that calls the network. `apiService.*` methods go through `send()` (20 s timeout, `ApiError` with `status`/`code`/`field` from the server's `{ success:false, message, code?, field? }` body). The token lives in `localStorage` (`kraveo_admin_token`) with an in-memory fallback when storage is blocked. Only 401/403 end the session (`isSessionRejected`); network errors, 5xx and 429 must not log the admin out.
- **Raw server data is never used directly.** It goes through `normalize*` in `src/types.ts` or `parse*` in `src/lib/*Parse.ts` (`catalogParse`, `financeParse`, `groupView`, `orderGroups`, `orderProblems`). Add a parser when adding an endpoint.
- **`src/lib/`** holds pure, React-free logic (order merging by `updatedAt`, status transitions, pricing/commission validation, finance input, rider markers, user-facing messages in `adminMessages.ts`). Logic goes here so it can be unit-tested without the DOM.
- **Design tokens**: Tailwind theme in `tailwind.config.js`; `src/lib/tokens.ts` mirrors the same hex values for Recharts/SVG/inline styles and must stay in sync (both mirror `packages/kraveo_ui` in the Flutter apps). Status class strings in `tokens.ts` are written as literals so Tailwind's scanner sees them. Shared primitives are in `src/components/ui/`.
- **Specs**: comments like "contract 3" or "contract 1.1" refer to sections of `../Docs/16_order_flow_contract.md`. Other features have their own contract docs in `../Docs` (pricing/catalog/settlement `21_…`, multi-restaurant orders `22_…`, campus maps `19_…`, vendor location `20_…`). Read the relevant one before changing behavior.

### Tests

- Vitest has no config file; the default environment is node. Component tests opt into the DOM with a `// @vitest-environment jsdom` first-line comment.
- Component tests don't use Testing Library: they use the helpers in `src/test/dom.tsx` (`mount` wraps in `ToastProvider`, `click`, `type`, `flush`, `byText`, `byId`) and fixtures from `src/test/fixtures.ts`, and mock the network with `vi.spyOn(apiService, …)`.

### Production constraints

- `assetsInlineLimit: 0` in `vite.config.ts` is deliberate: the CSP in `super_admin/nginx.conf.template` only allows `font-src 'self'`, so fonts must not be inlined as data URIs.
- The CSP also limits `connect-src` to the API origin (`API_ORIGIN` / `API_WS_ORIGIN`, set in the `Dockerfile`, overridable in Dokploy) and `img-src` to OpenStreetMap tiles. Any new external host (API, map tiles, fonts, scripts) must be added to `nginx.conf.template` or it will break in production only.
- Backend URLs: `VITE_API_BASE_URL` / `VITE_SOCKET_URL` (Docker build arguments in the `Dockerfile`), defaulting to `http://localhost:5001` in dev and `http://s598n3mrwe6p76b2bv2exazh.192.162.70.47.sslip.io` in prod. The API is on `http`: the dashboard must be served over `http` too, or the browser blocks the calls (mixed content).

## landing architecture

Multi-page static site: each page is its own HTML entry (`index.html`, `privacy/`, `terms/`, `refunds/`, `contact/`, `404.html`) registered in `rollupOptions.input` in `vite.config.js` — a new page must be added there or it won't be built. Scripts: `src/main.js` (home, GSAP + Lenis), `src/legal.js` (legal pages and 404), `src/contact.js`; styles in `src/styles.css`. Images are served from `public/`.
