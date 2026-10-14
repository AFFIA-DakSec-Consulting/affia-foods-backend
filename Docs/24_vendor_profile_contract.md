# 24 — Profil public d'un restaurant (logo, bannière, description, contact, horaires)

Date : 2026-10-14. Additif uniquement : aucune route existante ne change de comportement.

## Données (table `Vendor`, colonnes nullables)

| Champ | Type | Règles |
|---|---|---|
| `bannerImage` | texte (existait) | lien `http(s)://` valide, 500 caractères max, **obligatoire** (ne peut pas être vidé) |
| `logoUrl` | texte | même règles, mais peut être vidé (`null` ou `""`) |
| `description` | texte | 300 caractères max, espaces retirés, `""` = vidé |
| `name` | texte | 2 à 60 caractères, espaces multiples réduits |
| `category` | texte | type de cuisine, 2 à 60 caractères |
| `address` | texte | adresse écrite, 3 à 140 caractères (la **position GPS** reste gérée par `Docs/20`) |
| `eta` | texte | temps de préparation affiché aux clients, `"20-25 min"` : deux nombres de 1 à 180, le premier plus petit |
| `pickupNotes` | texte | consignes pour le livreur (« porte bleue, 2e étage »), 200 caractères max, vue du restaurant et de l'admin |
| `phone` | texte | mobile sénégalais, enregistré sous la forme `+221 7XXXXXXXX`. **Jamais visible des clients.** |
| `openingHours` | JSON | voir ci-dessous. `null` = jamais renseigné |

### Envoi d'images

- `POST /api/admin/vendors/:id/image?kind=logo|banner` (ADMIN) et `POST /api/partner/vendor/image?kind=logo|banner` (VENDOR, son restaurant).
- Corps = **les octets de l'image**, `Content-Type: image/png | image/jpeg | image/webp`, 3 Mo maximum. Réponse `201 { data: { url } }`.
- Le type est lu dans les premiers octets du fichier (jamais le nom ni l'en-tête). SVG refusé. Erreurs : 400 `kind`, 413 trop gros, 415 type refusé.
- Le fichier est écrit dans `public/uploads/vendors/` (variable `UPLOAD_DIR` pour un autre dossier), servi sous `/static/uploads/vendors/...`. Avec Docker, le dossier est un **volume** (`uploads`). L'envoi ne modifie pas la fiche : l'application enregistre ensuite l'URL avec `PATCH/PUT …/profile`, et l'ancien fichier envoyé par nous est supprimé à ce moment.
- Un stockage externe (Cloudinary, Supabase Storage, S3…) pourra remplacer le disque sans changer ces routes.

### `openingHours`

```json
{ "mon": [{ "open": "08:00", "close": "14:00" }, { "open": "18:00", "close": "23:00" }], "sat": [{ "open": "10:00", "close": "22:00" }] }
```

Jours : `mon tue wed thu fri sat sun`. Un jour absent ou `[]` = fermé. Heure locale **Africa/Dakar**. Maximum 3 périodes par jour, `HH:MM` sur 24 h, `open` strictement avant `close`, périodes sans chevauchement (triées par le serveur).

## Routes

- `PATCH /api/admin/vendors/:id/profile` — ADMIN. Remplit la fiche à la place du restaurant. Audit `VENDOR_PROFILE_SET`.
- `PUT /api/partner/vendor/profile` — VENDOR, **son restaurant uniquement** (jamais un id du corps). Autorisé en `PENDING` et `APPROVED` ; `REJECTED` / `SUSPENDED` → 403 `PARTNER_NOT_APPROVED`.

Mise à jour **partielle** : seules les clés présentes sont modifiées. Au moins une clé parmi `name, category, address, eta, pickupNotes, logoUrl, bannerImage, description, phone, openingHours` est requise. Réponse : `{ success: true, data: { id, bannerImage, logoUrl, description, phone, openingHours } }`. Erreur de validation : `400 { success:false, field, message }`.

## Qui voit quoi

- Client : `logoUrl`, `description`, `openingHours` (dans `publicVendorView`). Pas `phone`.
- Administrateur et restaurant propriétaire : la ligne complète, `phone` compris. `GET /api/partner/me` renvoie aussi `bannerImage`, `logoUrl`, `description`, `phone`, `openingHours`.

## À faire côté applications Flutter

Les applications ignorent ces champs pour l'instant (additif). L'application restaurant pourra appeler `PUT /api/partner/vendor/profile`.
