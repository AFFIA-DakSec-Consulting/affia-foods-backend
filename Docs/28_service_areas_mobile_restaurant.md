# 28 · Zones de service : ce que l'app mobile restaurant doit changer

Note pour la personne qui adapte `mobileapp/kraveo_vendor`. **Rien n'a été modifié dans les apps mobiles** : tout ce qui suit est à faire de ce côté.
Le contrat complet côté serveur est dans `Docs/27_service_areas_contract.md`. Ici : le problème, ce qui change pour l'app restaurant, et la liste exacte des fichiers.

## 1. Le problème

Le backend ne limite plus les restaurants à « 8 km autour de Thiès » : par défaut, **tout le Sénégal est accepté**, et l'administration peut ensuite limiter l'application à certaines zones.
Mais l'app restaurant a gardé une **pré-vérification locale** héritée du projet « campus » (Inde) : elle refuse toute position à plus de 3 km d'un campus indien.
Résultat actuel : au Sénégal, la position détectée par le téléphone est **toujours jugée « loin du campus »**, l'écran « This is not near the campus » s'affiche et la position n'est jamais envoyée au serveur.
Tant que ce n'est pas corrigé, aucun restaurant ne peut enregistrer sa position depuis l'app, même si le serveur l'accepterait.

## 2. Ce que fait maintenant le serveur (à connaître)

Un restaurant peut envoyer sa position à ces endroits ; la règle est la même partout :

| Route | Quand |
|---|---|
| `POST /api/auth/partner-signup` (`role: "VENDOR"`, `lat`, `lng`, `locationAccuracyM` facultatifs) | inscription |
| `PUT /api/partner/vendor/location` (`lat`, `lng`, `accuracyM`) | le restaurant fixe ou change sa position |

Réponses d'erreur (HTTP 400, corps `{ success: false, field, message }`) :

| `field` | `message` | Cause |
|---|---|---|
| `lat` ou `lng` | « Latitude must be a number between -90 and 90. » (ou longitude) | valeur absente, texte ou hors bornes |
| `location` | « The location must be inside Senegal. » | position hors du Sénégal (boîte `lat 12,2…16,8` ; `lng -17,7…-11,3`) |
| `location` | **un texte français défini par l'administration**, par défaut « Affia Foods n'est pas encore disponible à cet endroit. » | l'application est **limitée à des zones** et la position est hors de toutes les zones actives |
| `accuracyM` / `locationAccuracyM` | « …accuracy… » | précision invalide (0 à 5000 m) |

- Le texte du champ `location` peut donc être **déjà en français** (cas des zones) ou **en anglais** (cas « hors du Sénégal »). Il faut afficher le français : traduire « The location must be inside Senegal. » côté app, et afficher tel quel le texte reçu dans l'autre cas.
- Les règles sont lues à chaque requête : une modification dans le tableau de bord s'applique tout de suite. L'app ne doit **rien mémoriser** de la règle au-delà de la session.
- Le serveur reste **l'autorité** : toute pré-vérification locale ne sert qu'à éviter un aller-retour inutile.

## 3. Ce qu'il faut changer dans l'app

### 3.1 Supprimer la règle « près du campus »

Fichier `lib/services/location/campus_geo.dart` :

- `kCampusPins`, `kCampusCenter`, `kNearCampusKm = 3`, `distanceToCampusKm(...)`, `isNearCampus(...)` : **à retirer** (coordonnées d'un campus indien, sans objet au Sénégal).
- Garder `distanceKm(...)` si elle sert ailleurs.
- Option recommandée : la remplacer par une vérification **minimale et indulgente** (la boîte du Sénégal, mêmes bornes que le serveur) :

```dart
/// Boîte du Sénégal (mêmes bornes que le serveur : SENEGAL_BOUNDS). Sert seulement à éviter d'envoyer une position absurde.
const double kMinLat = 12.2, kMaxLat = 16.8, kMinLng = -17.7, kMaxLng = -11.3;
bool isInSenegal(double lat, double lng) =>
    lat.isFinite && lng.isFinite && lat >= kMinLat && lat <= kMaxLat && lng >= kMinLng && lng <= kMaxLng;
```

- Alternative encore plus simple : **ne plus faire de pré-vérification** et laisser le serveur répondre. C'est le plus sûr, car la règle des zones peut changer sans publier de nouvelle version de l'app.

### 3.2 L'écran de détection de position

Fichier `lib/widgets/location_sheet.dart` :

- Ligne ~138 : `_phase = isNearCampus(fix.lat, fix.lng) ? _Phase.result : _Phase.outside;` → utiliser `isInSenegal(...)` (ou toujours `_Phase.result` si on retire la pré-vérification).
- Ligne ~409 (`_outsideView`) : l'écran calcule « environ X km du campus » avec `distanceToCampusKm`. À réécrire sans distance au campus. Texte proposé : « Cet endroit n'est pas dans une zone où nous livrons. Placez-vous dans votre cuisine puis réessayez. »
- Le titre « This is not near the campus » / son équivalent hindi : à remplacer (« Hors zone »). La clé de test `kLocationOutsideKey = ValueKey('location-outside-campus')` peut être renommée (mettre à jour les tests).
- **Surtout** : quand le serveur répond `400` avec `field: "location"` à l'enregistrement, afficher le **`message` reçu** dans la zone d'erreur de sauvegarde (c'est le texte de l'administration quand l'application est limitée). L'écran gère déjà un message d'erreur de sauvegarde (`kLocationSaveErrorKey`) : vérifier qu'il montre le message du serveur et non un texte figé « within 3 km of the campus ».

### 3.3 Inscription

- Le message de refus de position à l'inscription (champ `location`) doit être affiché tel quel ou traduit comme au 3.2.
- L'inscription reste possible **sans position** (comportement inchangé) : proposer « continuer sans position » après un refus.

### 3.4 Facultatif : prévenir avant d'envoyer

`GET /api/campus` (jeton requis, cache 60 s) renvoie `data.service` :

```json
{ "mode": "COUNTRY | AREAS", "appliesToVendors": false, "message": "Affia Foods n’est pas encore disponible à cet endroit.",
  "areas": [ { "id": "…", "name": "Thiès", "lat": 14.7886, "lng": -16.926, "radiusKm": 8 } ],
  "country": { "name": "Sénégal", "bounds": { "minLat": 12.2, "maxLat": 16.8, "minLng": -17.7, "maxLng": -11.3 } } }
```

- `mode: "COUNTRY"` (défaut) : rien à vérifier au-delà du pays.
- `mode: "AREAS"` et `appliesToVendors: true` : la position doit être dans un des cercles de `areas` (distance à vol d'oiseau ≤ `radiusKm`). Afficher `message` sinon.
- À n'utiliser que pour **prévenir** : toujours envoyer et laisser le serveur trancher (la règle a pu changer entre-temps).

## 4. Tests à mettre à jour

Les tests utilisent des coordonnées du campus indien et des messages de l'ancienne règle. Après le changement, ils échoueront tant qu'ils ne sont pas adaptés :

| Fichier | Ce qui est à changer |
|---|---|
| `test/support/location_fakes.dart` | `kKitchenLat = 23.0741` (et la longitude voisine) : prendre des coordonnées de **Thiès** (par ex. `14.7945`, `-16.9590`) |
| `test/support/fakes.dart`, `test/fixtures/vendor_order_samples.json` | coordonnées `23.07…, 76.85…` à remplacer par des coordonnées sénégalaises |
| `test/location_capture_test.dart` (≈ lignes 216-221) | tests de `isNearCampus` / `distanceToCampusKm` : les remplacer par des tests de `isInSenegal` (Dakar `14.6937,-17.4441` vrai ; Paris `48.8566,2.3522` faux ; `NaN` et `95` faux) |
| `test/signup_location_test.dart` (≈ 174, 183) | le message simulé « The location must be within 3 km of the campus. » : utiliser « The location must be inside Senegal. » puis le texte français de zone |
| `test/location_sheet_test.dart` (≈ 272-279) | idem pour le message de sauvegarde refusée ; le cas « hors zone » avec des coordonnées étrangères |
| `test/restaurant_location_app_test.dart` (≈ 230-234) | idem |

Ajouter au moins ces cas :

1. Position à Dakar, Mbour, Saint-Louis ou Ziguinchor : **acceptée** (envoyée au serveur).
2. Le serveur répond `400 { field: "location", message: "<texte de zone>" }` : le texte est affiché, l'écran reste utilisable, et « continuer sans position » est proposé.
3. Position hors du Sénégal : refus local **ou** refus du serveur, avec un texte en français.

## 5. Autres restes du projet « campus » dans l'app restaurant (hors sujet, à noter)

- Textes **hindi / anglais** à deux langues (par ex. dans `location_sheet.dart`) : le produit est au Sénégal, en français.
- Données d'exemple des tests avec des noms et des coordonnées indiens.
- Si d'autres écrans parlent de « campus », « hostel » ou « BH1 » : ce vocabulaire n'existe plus côté serveur (`dropPoints` est vide, les adresses sont libres, voir `Docs/ADRESSES_LIVRAISON.md`).

## 6. Pour l'app client (rappel court)

Même principe pour l'adresse de livraison : `POST /api/orders` et `POST /api/order-groups` peuvent répondre `400` avec `code: "OUTSIDE_SERVICE_AREA"` (message de l'administration, `field: "lat"`), `OUTSIDE_COUNTRY`, ou `PIN_REQUIRED` (l'administration exige une épingle sur la carte). Afficher le `message` reçu. `POST /api/auth/addresses` applique la même règle à l'épingle d'une adresse enregistrée.

## 7. Comment tester contre le serveur de démonstration

1. Tableau de bord → **Zones de service** : choisir « Tout le Sénégal » (état par défaut) ou « Seulement certaines zones ».
2. Même page → **Tester une adresse** : indique si un restaurant situé à cet endroit serait accepté.
3. Pour provoquer un refus de zone : passer en « Seulement certaines zones » avec la seule zone « Thiès », puis envoyer une position à Mbour (`14.4167, -16.9667`).
4. Remettre « Tout le Sénégal » ensuite.
