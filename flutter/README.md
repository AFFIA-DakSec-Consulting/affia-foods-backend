# Kraveo – Applications Flutter

Trois applications mobiles (Android) et un package d'interface partagé.

| Dossier | Nom installé | Pour qui | Fonctions principales |
|---|---|---|---|
| `apps/customer_app` | Kraveo | Étudiants | Connexion Google, choix du dhaba, panier (même multi-restaurants), paiement Razorpay, suivi du livreur sur carte, code OTP à donner à la porte, historique |
| `apps/vendor_app` | Kraveo Restaurant Partner | Restaurants | Inscription + localisation, alarme sonore forte pour les nouvelles commandes, boutons ACCEPTER / REFUSER, file cuisine, stock, ventes, reversements |
| `apps/driver_app` | Kraveo Delivery Partner | Livreurs | Inscription, en ligne / hors ligne, accepter une course, récupération chez un ou plusieurs restaurants, GPS en direct, validation OTP, gains |
| `packages/kraveo_ui` | – | Les 3 apps | Design system commun (couleurs, typo, composants) |

Les apps dépendent de `../../packages/kraveo_ui` et des logos `../../*.png` pour leurs icônes : **garder cette structure de dossiers**.

## Commandes

```bash
cd apps/customer_app          # ou vendor_app, driver_app, ../packages/kraveo_ui
flutter pub get
flutter run
flutter analyze
flutter test
flutter test test/order_provider_test.dart     # un seul fichier
```

## Configuration

- URL du backend : `lib/config/api_config.dart` de chaque app. `isProduction = true` → `https://api.kraveo.site`. Mettre `false` pour un backend local (`http://10.0.2.2:5000` depuis l'émulateur Android).
- Firebase (push) : `android/app/google-services.json` dans chaque app.
- Google Sign-In (optionnel) : `--dart-define=GOOGLE_SERVER_CLIENT_ID=...`.

## Build des APK de release

```bash
./scripts/build_mobile_apks.sh     # sortie dans build/apks/
```
Produit `Kraveo-Customer-…`, `Kraveo-Restaurant-Partner-…`, `Kraveo-Delivery-Partner-…` avec version et numéro de build lus dans `pubspec.yaml`. Ne jamais distribuer trois fichiers `app-release.apk`. Les trois apps partagent le même numéro de version (actuellement `1.8.0+14`), à monter ensemble.

## Tests

Chaque app a son dossier `test/` (logique, widgets, push, paiements). Les fixtures JSON dans `test/fixtures/` sont copiées des tests e2e du backend pour coller au vrai format de l'API.
