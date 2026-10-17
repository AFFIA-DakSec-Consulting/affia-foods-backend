# 27 · Zones de service : où l'application est disponible

Le produit n'est plus limité à Thiès : par défaut, **tout le Sénégal** est servi. Le back-office peut, volontairement, limiter l'application à certaines zones.
Module `delivery.service_areas` (« Zones de service »), table `ServiceArea`, migration `20261022_service_areas`.

## 1. La règle

| Mode | Effet |
|---|---|
| `COUNTRY` (défaut) | Une position est acceptée si elle est dans la boîte du Sénégal (`SENEGAL_BOUNDS` : lat 12,2 à 16,8 ; lng −17,7 à −11,3). Cela écarte une position à l'étranger, en mer ou à 0,0. |
| `AREAS` | En plus, la position doit être dans **au moins une zone active** (un cercle : centre + rayon en km). |

Le module désactivé équivaut à `COUNTRY`. L'ancienne règle « à moins de 8 km du centre de Thiès » (restaurants seulement) est supprimée ; Thiès reste disponible comme zone toute prête (8 km, active) pour ceux qui voudraient limiter à cette ville.

Réglages du module (modifiables dans Modules ou sur la page Zones de service) : `mode` (`COUNTRY` | `AREAS`), `apply_to_customers`, `apply_to_vendors`, `require_pin` (le client doit placer son adresse sur la carte), `outside_message` (texte montré hors zone, 200 caractères au plus, français par défaut).

## 2. Où elle s'applique

| Ce qui est contrôlé | Routes | Réglage |
|---|---|---|
| Position d'un restaurant | `POST /auth/partner-signup`, `PUT /partner/vendor/location`, `PATCH /admin/vendors/:id/location`, `POST /vendors`, `POST /admin/partners` | `apply_to_vendors` |
| Adresse de livraison d'un client (épingle) | `POST /orders`, `POST /order-groups`, `POST /auth/addresses` | `apply_to_customers` |

- Une adresse **sans épingle** reste acceptée (le texte seul est permis par `ADRESSES_LIVRAISON.md`), sauf si `require_pin` est actif en mode `AREAS` : réponse `400 PIN_REQUIRED`, `field: "lat"`.
- Hors du pays : `400 OUTSIDE_COUNTRY` (client) ou `400 field: "location"` « The location must be inside Senegal. » (restaurant).
- Hors zone en mode `AREAS` : `400 OUTSIDE_SERVICE_AREA`, `field: "lat"`, `message` = le texte du back-office. Pour un restaurant : `field: "location"`.
- Le devis (`POST /orders/quote`) ne reçoit pas d'adresse : il n'est pas concerné. Les commandes déjà passées ne changent jamais.

## 3. API apps

`GET /api/campus` (jeton requis, cache 60 s) renvoie en plus `data.service` :

```json
{ "mode": "COUNTRY|AREAS", "appliesToCustomers": false, "appliesToVendors": false, "pinRequired": false,
  "message": "Affia Foods n’est pas encore disponible à cet endroit.",
  "areas": [ { "id": "…", "name": "Thiès", "lat": 14.7886, "lng": -16.926, "radiusKm": 8 } ],
  "country": { "name": "Sénégal", "bounds": { "minLat": 12.2, "maxLat": 16.8, "minLng": -17.7, "maxLng": -11.3 } } }
```
`areas` est vide en mode `COUNTRY`. Les apps peuvent s'en servir pour prévenir avant l'envoi ; **le serveur re-vérifie toujours**.

## 4. API admin (`/api/admin/service-areas`, section « marketing » des rôles d'équipe)

- `GET /admin/service-areas` → `{ data: [zones], meta: { restricted, bounds, maxAreas: 50 } }`
- `POST /admin/service-areas` `{ name, lat, lng, radiusKm, isActive? }` · `PATCH /admin/service-areas/:id` · `DELETE /admin/service-areas/:id`
  - Le centre doit être dans le Sénégal ; rayon de 0,5 à 500 km ; nom de 2 à 60 caractères ; 50 zones au plus ; champ inconnu refusé.
  - Les coordonnées gardent toutes leurs décimales (pas la règle « 2 décimales » des montants).
- `POST /admin/service-areas/check` `{ lat, lng }` → `{ restricted, inCountry, vendor: { served, area | reason, message }, customer: {…} }`. Ne modifie rien ; compte comme une **lecture** pour les rôles en lecture seule.
- Passer en mode limité : `PATCH /admin/modules/delivery.service_areas/settings/mode` `{ "value": "AREAS" }`.

Garde-fous : `409 NO_ACTIVE_AREA` si on veut limiter l'application sans aucune zone active ; `409 LAST_ACTIVE_AREA` si on veut désactiver ou supprimer la dernière zone active pendant que l'application est limitée. Toutes les modifications sont dans le journal du module (`CREATE/UPDATE/DELETE_SERVICE_AREA`, `UPDATE_SETTING`).

## 5. Tableau de bord

Page **Zones de service** (`/zones-de-service`, groupe Expansion) : choix « Tout le Sénégal » / « Seulement certaines zones » avec confirmation, liste des zones (interrupteur, modification, suppression), ajout à partir d'une liste de 23 villes du Sénégal (centre et rayon conseillés) ou d'un point libre, réglages « à qui s'applique la limite », et un **testeur d'adresse** (restaurant et client, avec la règle actuelle).
Ne pas confondre avec **Zones de livraison** (`/zones`), qui est la grille de tarifs par distance.
La saisie d'une position de restaurant dans le tableau de bord ne juge plus la distance : le serveur décide. Elle signale seulement des coordonnées probablement inversées (latitude et longitude).

## 6. Limites connues

- Les zones sont des cercles, pas des polygones. Une frontière de quartier précise demande plusieurs cercles.
- Pas de carte dans la page : les zones se lisent par leur centre et leur rayon, et le testeur répond pour un point donné.
- La boîte du Sénégal est un rectangle un peu large : elle accepte aussi de petites bandes des pays voisins. En mode `AREAS`, les zones corrigent cela.
- Les distances sont à vol d'oiseau. L’app mobile restaurant garde une pré-vérification locale héritée du projet campus : voir `Docs/28_service_areas_mobile_restaurant.md`. Le serveur reste l’autorité.
