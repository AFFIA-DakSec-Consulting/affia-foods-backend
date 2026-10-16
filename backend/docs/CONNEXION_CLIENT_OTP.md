# Connexion client par numéro + code (OTP)

Consigne pour l'app Flutter **client**. Le backend est prêt. Il reste deux écrans à faire : l'écran « numéro » et l'écran « code ».
Le code est envoyé par WhatsApp. Tant que WhatsApp n'est pas branché, utiliser le client de test (section 6).

Base de l'API en local : `http://localhost:5001/api` (émulateur Android : `http://10.0.2.2:5001/api`).
Toutes les réponses sont en JSON. En cas d'erreur : `{ "success": false, "code": "...", "message": "...", "field": "..." }`.

---

## 1. Le parcours à implémenter

```
Écran 1 : numéro ──POST /auth/otp/request──► Écran 2 : code ──POST /auth/otp/verify──► token
                                                                       │
                                          needsProfile == true ? ──► écran profil (PUT /auth/profile)
                                          needsProfile == false ?──► accueil
```

1. L'utilisateur saisit son numéro (écran 1) et appuie sur « Recevoir le code ».
2. L'app appelle `/auth/otp/request`. Si c'est bon, elle ouvre l'écran 2 en lui passant le numéro canonique reçu dans `phone`.
3. L'utilisateur saisit les 6 chiffres. L'app appelle `/auth/otp/verify`.
4. L'app enregistre le `token` (stockage sécurisé) et l'envoie ensuite dans l'en-tête `Authorization: Bearer <token>` de tous les appels.
5. Si `needsProfile` vaut `true`, l'app affiche l'écran de profil (nom, avatar, quartier). Sinon, elle va à l'accueil.

La connexion Google reste disponible à côté (`POST /auth/google`). Les deux donnent la même réponse.

---

## 2. Écran 1 : demander le code

`POST /auth/otp/request`

```json
{ "phone": "77 123 45 67" }
```

Numéros acceptés : mobiles sénégalais, 9 chiffres commençant par `70`, `75`, `76`, `77` ou `78`. Les espaces, `+221`, `221` et `00221` devant sont tolérés. Un `0` devant n'est pas accepté. Afficher un indicatif +221 fixe devant le champ, et ne saisir que les 9 chiffres.

Réponse 200 :

```json
{
  "success": true,
  "message": "Code sent.",
  "phone": "+221 771234567",
  "channel": "whatsapp",
  "expiresInSeconds": 300,
  "resendAfterSeconds": 45
}
```

- `phone` : numéro canonique. **Le renvoyer tel quel à l'étape 2.**
- `expiresInSeconds` : durée de vie du code (5 minutes). Afficher un compte à rebours.
- `resendAfterSeconds` : délai avant de pouvoir redemander un code. Griser le bouton « Renvoyer le code » pendant ce délai.
- `debugCode` : présent seulement en développement, quand le serveur n'envoie pas encore de message. **Ne jamais s'en servir dans l'app finale.**

Erreurs :

| Statut | `code` | Quand | Que faire |
|---|---|---|---|
| 400 | `BAD_REQUEST` (`field: "phone"`) | Numéro invalide | Afficher `message` sous le champ |
| 403 | `PARTNER_ACCOUNT` | Le numéro est celui d'un restaurant ou d'un livreur | Dire d'utiliser l'app partenaire |
| 429 | `OTP_TOO_SOON` | Un code vient d'être envoyé | Rester sur l'écran 2, utiliser `retryAfterSeconds` pour le compte à rebours |
| 429 | `RATE_LIMITED` | 5 codes demandés dans l'heure | Afficher `message`, `retryAfterSeconds` donne le délai |
| 503 | `OTP_SEND_FAILED` / `OTP_NOT_CONFIGURED` | Le message n'a pas pu partir | « Réessayez dans un instant » |

---

## 3. Écran 2 : vérifier le code

`POST /auth/otp/verify`

```json
{ "phone": "+221 771234567", "code": "123456" }
```

`code` : exactement 6 chiffres, **en texte** (pas un nombre, sinon un code qui commence par 0 perd son zéro).

Réponse 200 :

```json
{
  "success": true,
  "message": "Welcome to Kraveo!",
  "token": "eyJhbGciOi...",
  "user": {
    "id": "…", "name": "Client", "email": null, "phone": "+221 771234567",
    "role": "CLIENT", "isStudent": null, "hostelBlock": null, "avatarId": null, "kraveoCoins": 0
  },
  "isNewUser": true,
  "needsProfile": true
}
```

- `token` : à garder. Valable 30 jours.
- `isNewUser` : `true` à la toute première connexion (le compte vient d'être créé).
- `needsProfile` : `true` tant que le nom, l'avatar ou le quartier manque. Dans ce cas, ouvrir l'écran de profil avant l'accueil.
- `hostelBlock` est le champ du **quartier de livraison** (nom historique conservé).

Erreurs :

| Statut | `code` | Quand | Que faire |
|---|---|---|---|
| 400 | `BAD_REQUEST` (`field: "code"`) | Pas 6 chiffres | Message sous le champ |
| 400 | `OTP_INVALID` | Code faux, expiré, déjà utilisé ou jamais demandé | « Code incorrect ou expiré », proposer « Renvoyer le code » |
| 429 | `OTP_LOCKED` | 5 essais faux sur ce code | Obliger à redemander un code (retour écran 1 ou bouton « Renvoyer ») |
| 403 | `PARTNER_ACCOUNT` | Numéro de partenaire | Utiliser l'app partenaire |

Un code ne marche qu'une fois. Il a 5 essais. Quand le code est bon, il ne peut plus resservir.

---

## 4. Écran de profil (si `needsProfile` est `true`)

`PUT /auth/profile` avec l'en-tête `Authorization: Bearer <token>`. Envoyer uniquement les champs à changer :

```json
{ "name": "Awa Diop", "avatarId": 3, "hostelBlock": "Randoulène" }
```

- `name` : 2 à 60 caractères, sans symboles.
- `avatarId` : entier de 1 à 15.
- `hostelBlock` : un des quartiers renvoyés par `GET /campus` (voir ci-dessous). Les accents et la casse ne comptent pas.
- `phone` n'est pas à renvoyer : il est déjà enregistré.

La liste des quartiers : `GET /campus` (avec le token) renvoie `data.dropPoints[]` (`name`, `lat`, `lng`) et `data.center`. L'utilisateur choisit son quartier dans cette liste. Le détail de l'adresse (rue, repère) se met dans `dropoffNotes` à la commande.

La réponse contient `needsProfile` mis à jour. Quand il vaut `false`, aller à l'accueil.

---

## 5. Règles à respecter côté app

- **Écran 2** : champ de 6 chiffres (`keyboardType: number`, `maxLength: 6`), compte à rebours de validité, bouton « Renvoyer le code » grisé pendant `resendAfterSeconds`. Le renvoi appelle de nouveau `/auth/otp/request`.
- **Ne pas** envoyer le code ailleurs que dans `/auth/otp/verify`. Ne pas le stocker ni le journaliser.
- **Token** : stockage sécurisé (`flutter_secure_storage`). Au démarrage, si un token existe, appeler `GET /auth/profile` : si 401, retourner à l'écran 1.
- **Déconnexion** : `POST /auth/logout`, puis supprimer le token local.
- **Textes** : afficher le `message` du serveur pour les erreurs de saisie, ou vos propres textes en français selon le `code`.
- **Réseau** : prévoir un indicateur de chargement et un message si le serveur ne répond pas (503, ou pas de réseau).

Exemple d'appel avec `http` :

```dart
final res = await http.post(
  Uri.parse('$baseUrl/auth/otp/request'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({'phone': phone}),
);
final body = jsonDecode(res.body) as Map<String, dynamic>;
if (res.statusCode == 200) {
  // aller à l'écran code avec body['phone'] et body['resendAfterSeconds']
} else {
  // afficher body['message'] ; selon body['code'] adapter l'écran
}
```

---

## 6. Tester sans WhatsApp : le client de test

| | |
|---|---|
| Numéro | `77 000 00 00` |
| Code | `123456` |

- Aucun message n'est envoyé. Le code est toujours `123456`.
- Son profil est déjà complet (nom « Client Test », avatar, quartier Escale, 100 pièces) : `needsProfile` vaut `false`, l'app va directement à l'accueil.
- Il fonctionne seulement sur le serveur de développement. En production il est désactivé.

Autres numéros : tant que WhatsApp n'est pas branché, le serveur écrit le code dans ses logs et le renvoie dans la réponse (`debugCode`), pour pouvoir tester le parcours complet. Voir le code avec : `docker compose logs backend | grep "\[otp\]"`.

---

## 7. À savoir sur la suite (WhatsApp)

Quand l'envoi WhatsApp sera branché côté serveur, **l'app Flutter ne change pas** : les deux appels restent identiques et `channel` passera de `console` à `whatsapp`. Le champ `debugCode` disparaîtra.

Pour l'équipe backend (réglages dans `.env`) : `OTP_SENDER=whatsapp`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE` (modèle « authentification » approuvé par Meta), `WHATSAPP_OTP_LANG` (par défaut `fr`).

---

## 8. Récapitulatif des endpoints

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/auth/otp/request` | Envoie le code au numéro |
| POST | `/auth/otp/verify` | Vérifie le code, renvoie le token |
| PUT | `/auth/profile` | Complète le profil (nom, avatar, quartier) |
| GET | `/auth/profile` | Relit le profil, vérifie que le token est valable |
| GET | `/campus` | Liste des quartiers de livraison |
| POST | `/auth/logout` | Déconnexion |
| POST | `/auth/google` | Connexion Google (reste disponible) |
