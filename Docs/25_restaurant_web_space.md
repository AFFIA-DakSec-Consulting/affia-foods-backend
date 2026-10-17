# Espace restaurant sur le web (admin dashboard)

Un restaurant s'inscrit, attend la validation de l'équipe, puis gère ses commandes et sa fiche depuis le navigateur.
Même site que l'admin (`web/super_admin`), même jeton : `Root.tsx` choisit l'espace d'après la session (`kraveo_session_role`).

## Pages
| Adresse | Qui | Contenu |
|---|---|---|
| `/restaurant/inscription` | public | Inscription en 2 étapes (vous, puis restaurant : nom, cuisine, adresse, NINEA facultatif, position GPS facultative) |
| `/restaurant/connexion` | public | Téléphone + mot de passe. « Mot de passe oublié » : contacter l'équipe (pas de réinitialisation libre-service) |
| écran d'attente | restaurant PENDING / REJECTED / SUSPENDED | État du dossier, motif du refus, correction et renvoi, rafraîchi toutes les 20 s |
| `/restaurant/dashboard`, `/profile`, `/hours`, `/settings` | restaurant APPROVED | Commandes en direct, fiche publique, horaires, ouverture |

## Appels (tous existaient déjà côté serveur)
`POST /api/auth/partner-signup`, `POST /api/auth/partner-login` (role VENDOR), `GET /api/partner/me`, `PUT /api/partner/application`,
`GET /api/orders` (le restaurant ne voit que ses commandes payées), `PATCH /api/orders/:id/status`, `POST /api/orders/:id/reject`,
`PATCH /api/vendors/:id/status`, `PUT /api/partner/vendor/profile`, `POST /api/partner/vendor/image`, `PUT /api/partner/vendor/location`.
Temps réel : socket `order_updated` / `new_order_alert` (salle `vendor_<id>`, rejointe automatiquement si APPROVED) ; le sondage de 10 s reste la source de vérité.

## Côté équipe Affia Foods
Page **Inscriptions** : contrôle du dossier (NINEA, adresse, position), Approuver / Refuser avec motif, Suspendre, **Réinitialiser le mot de passe**
(le serveur invalide toutes les sessions : le restaurant revient à la connexion), bouton **Lien d'inscription** (copie `<site>/restaurant/inscription`).

## Règles
- Le NINEA est stocké dans la colonne `fssaiNumber` (nom hérité) : 7 à 14 lettres ou chiffres.
- Un livreur ou un client qui essaie de se connecter ici est refusé (leurs applications mobiles).
- Le panneau de commande du restaurant n'affiche ni code de livraison, ni données de paiement, ni frais : seulement les plats, la note du client, ce que le restaurant gagne et le prénom du client.
- La position GPS doit être à moins de 8 km du centre de Thiès, sinon le serveur la refuse (l'inscription peut se faire sans).
- En production, `Permissions-Policy` autorise `geolocation=(self)` (sans cela le bouton « Utiliser ma position » est bloqué).
- Test : `backend/test/e2e/restaurant_web_lifecycle.test.ts`.
