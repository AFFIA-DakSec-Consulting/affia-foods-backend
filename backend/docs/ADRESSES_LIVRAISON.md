# Adresses de livraison : adresse enregistrée, récente ou ponctuelle

Il n'y a plus de liste de quartiers imposée. `GET /api/campus` renvoie `dropPoints: []`, la ville (`Thiès`) et le centre de la carte. Le client livre où il veut : l'app propose trois façons de choisir.

## 1. Les trois sources d'adresse

| Source | D'où elle vient | Endpoint |
|---|---|---|
| **Enregistrée** | carnet d'adresses du client (10 max : Maison, Bureau...) | `GET/POST /auth/addresses`, `PUT/DELETE /auth/addresses/:id` |
| **Récente** | déduite des 50 dernières commandes, sans doublon, la plus récente en premier | `GET /auth/recent-addresses` → `[{ address, lat, lng, notes }]` |
| **Ponctuelle** | saisie par le client pour cette commande seulement | directement dans la commande |

Quelle que soit la source, l'app envoie **la même chose** à la commande :

```json
POST /api/orders   (ou /api/order-groups, ou /api/orders/quote)
{ "vendorId": "...", "items": [...], "dropoffHostel": "12 Rue des Fleurs, Thiès",
  "lat": 14.79, "lng": -16.93, "dropoffNotes": "Portail bleu, 2e étage", "clientRequestId": "..." }
```

- `dropoffHostel` : le texte de l'adresse (nom historique du champ). 2 à 200 caractères. Les espaces multiples sont nettoyés.
- `lat` + `lng` : épingle GPS **facultative**, mais complète (les deux ou aucune) et réelle (|lat| ≤ 90, |lng| ≤ 180). Sinon 400 avec `field: "lat"`.
- `dropoffNotes` : repère, étage, consignes (300 caractères).
- Sans `dropoffHostel`, le serveur utilise l'adresse du profil (`hostelBlock`). S'il n'y en a pas : 400 `field: "dropoffHostel"`.

Rejeté (400) : texte vide ou d'un seul caractère, plus de 200 caractères, retour à la ligne ou caractères de contrôle, `<` et `>`.

## 2. Ce que renvoie la commande

`dropoff` vaut `{ name, lat, lng }` quand une épingle a été envoyée, sinon `null` (le texte `dropoffHostel` reste toujours présent). Les apps livreur et restaurant doivent gérer `dropoff: null` : afficher l'adresse en texte, sans bouton « ouvrir la carte ».

## 3. Recommandations pour l'app client

1. **Écran d'adresse** : trois blocs : « Mes adresses », « Récentes », « Autre adresse » (champ texte + bouton « utiliser ma position »).
2. **Géofencing** : plus de liste fixe pour le calculer. Se baser sur l'épingle (`lat`/`lng`) quand elle existe. Le centre de la carte (`center` de `/campus`) sert à cadrer la carte au départ.
3. **Enregistrer** une adresse ponctuelle : proposer « Enregistrer cette adresse » après la commande (`POST /auth/addresses`).
4. L'épingle d'une adresse enregistrée (`lat`, `lng`) se renvoie telle quelle dans la commande.
5. Une adresse sans épingle fonctionne, mais le calcul de distance (frais selon la zone, gain livreur) n'a alors pas de point d'arrivée : le snapshot de la commande porte l'avertissement `DISTANCE_UNKNOWN`. Encourager l'épingle.

## 4. Impact backend (fait)

- `normalizeDropPoint` accepte tout texte lisible ; un ancien nom de quartier reste valide (c'est juste un texte).
- Commandes simples, groupes et devis : épingle validée et enregistrée (`dropoffLat`, `dropoffLng`).
- Adresses enregistrées : mêmes règles de texte (libellé 2 à 50 caractères) et d'épingle.
- Rejouer la même commande (`clientRequestId`) avec la même adresse (espaces mis à part) renvoie la commande existante ; une adresse différente donne 409 `CLIENT_REQUEST_MISMATCH`.
- Le rôle `STUDENT` n'existe plus : c'est `CLIENT` partout. `GET /analytics` renvoie `activeClients` (ancien `activeStudents`).
