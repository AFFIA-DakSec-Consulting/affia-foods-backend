# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kraveo (customer app, students) — standalone Flutter app (Android is the primary target; an iOS project exists under `ios/`, bundle id `site.kraveo.customer`), part of the Kraveo campus food-delivery platform. State uses `provider` (`lib/providers/`: session, dhaba, cart, order, quote). Orders can span several restaurants (order groups, server price quotes). Maps go through a `MapViewFactory` with a stylised fallback.

The shared design system is vendored in `packages/kraveo_ui` (a copy, also present in the sibling Kraveo apps: changes must be mirrored by hand). The launcher icon source is `assets/icon/launcher.png`. Backend API contracts live in the Kraveo `Docs/` folder (code comments cite `Docs/NN`).

## Commands

```bash
flutter pub get
flutter run
flutter analyze
flutter test
flutter test test/<file>_test.dart                      # single file
flutter test test/<file>_test.dart --plain-name "name"  # single test
flutter build apk --release                             # APK in build/app/outputs/flutter-apk/
dart run flutter_launcher_icons                         # regenerate launcher icons
```

## Configuration

- Backend URL: `lib/config/api_config.dart`. `isProduction = true` → `https://api.kraveo.site`; `false` (currently set) → the dev host in `_localHost` (the hosted dev server over http on `*.sslip.io`, allowed by an ATS exception in `Info.plist` and the debug manifest's cleartext flag; override with `--dart-define=API_HOST=...`, e.g. `http://localhost:5001`) (iOS simulator; for an Android emulator run `adb reverse tcp:5001 tcp:5001`; on a physical phone pass the Mac's Wi-Fi address: `flutter run --dart-define=API_HOST=http://<mac-ip>:5001`). REST uses the `/api` suffix; Socket.IO uses the bare host. Set `isProduction = true` before a release build.
- Google Sign-In normally reads the web client id from `google-services.json`; only if absent pass `--dart-define=GOOGLE_SERVER_CLIENT_ID=...`.
- Firebase push: `android/app/google-services.json`; iOS needs `ios/Runner/GoogleService-Info.plist` (git-ignored, must be added to the Runner target in Xcode) plus an APNs key uploaded in the Firebase console and the Push Notifications capability (`Runner.entitlements`; set `aps-environment` to `production` for release).
- iOS secrets: copy `ios/Flutter/Secrets.xcconfig.example` to `ios/Flutter/Secrets.xcconfig` (git-ignored) and fill `MAPS_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_REVERSED_CLIENT_ID` (Info.plist and `AppDelegate.swift` read them). Without a Maps key the app shows its stylised map. The `site.kraveo.customer/system` MethodChannel is implemented natively in `MainActivity.kt` and `AppDelegate.swift`: keep both in sync.

- Money is shown in FCFA (XOF, whole amounts, `fcfa()` in `lib/widgets/ui/format.dart`, same format as the backend's `fcfa`).
- Language: Home (screen, its rows, kitchen cards, address header and sheet) and the restaurant page are in French; the other screens are still in English. No i18n yet.

## Architecture

- `lib/main.dart` is the composition root and the test seam: the root widget takes optional dependencies (auth, backend, socket, push, location, payout…). `null` = real implementation; tests inject fakes from `test/support/`. New network/plugin dependencies follow the same pattern: abstract interface in `lib/services/`, real implementation, optional constructor parameter, fake in `test/support/`.
- Customer accounts have role `CLIENT` on the current backend (formerly `STUDENT`; `isCustomerRole` in `lib/models/customer_user.dart` accepts both, any other role is a partner and is refused).
- A top-level gate switches on session status; a 401 goes through a static `onUnauthorized` hook back to login, and sign-out must reset all user-scoped state.
- Auth: two ways in, both ending in `SessionProvider._begin`. Google (`/auth/google`) and phone + code (`/auth/otp/request` then `/auth/otp/verify`, screens `phone_login_screen` → `otp_code_screen`; Senegalese +221 numbers, 6-digit code sent by WhatsApp, test account 77 000 00 00 / 123456 on the dev server). The login screens are pushed above `AuthGate`, so a successful verify pops back to the root. A phone + code sign-in goes straight to Home, also after a restart: the sign-up screens (`ProfileSetupScreen`) are only shown to Google accounts (`_showsSignUp` in `SessionProvider`), whatever the server's `needsProfile` says.
- Delivery address: geolocated automatically on Home (`DeliveryLocationProvider` + `LocationService`, real `DeviceLocationService` = geolocator + geocoding, `location: null` in tests → Home falls back to the drop-point picker). The last address is kept in SharedPreferences and cleared on sign-out; it is not sent to the server yet.
- Home is built from themed horizontal rows (`HomeCollection`, `lib/models/home_collection.dart`): today computed on the phone by `buildHomeCollections` (`lib/services/home_collections.dart`, moment of the day first, then budget / drinks / favourites / speed / sweets / free delivery); the model is shaped to be served by the backend later. A search or filter switches Home to a vertical result list. Kitchen banner and logo (`logoUrl`) fall back to drawn defaults (`lib/widgets/ui/dhaba_art.dart`).
- Restaurant page (`dhaba_menu_screen.dart`): sections per menu category with sticky tabs and a scroll spy (all sections are built at once so a tab can jump to any of them), search hidden in the tab bar, promos ready for the API (`MenuItemModel.originalPrice`, `Dhaba.promotions`, `lib/models/restaurant_promo.dart`), opening hours parsed by `lib/models/opening_hours.dart` (Dakar time). Favourites are still kept in memory only (`DhabaProvider`).
- Data: REST is the source of truth; Socket.IO and FCM push only trigger refreshes. Push is optional (starts after first frame, failures swallowed, `push: null` in tests).
- Models parse defensively (unknown fields ignored, malformed body → null). Shared test fakes/sample data live in `test/support/` (`order_fakes`, `push_fakes`, `sample_catalog`).
- Adding a dish to the cart goes through `addDishToCart` (`lib/widgets/add_to_cart.dart`: closed kitchen, other-restaurant cart, options sheet), shared by the menu and the Home "+" buttons; `KCartBar` is the gold cart bar on both.
- Payments: Razorpay is gone. Checkout lists the Senegal methods from `GET /payments/methods` (Wave, Orange Money, Espèces, with logos; `lib/models/payment_method.dart`, defaults until loaded) and pays with `OrderProvider.payForOrder(method: ...)` → `POST /payments/simulate` (servers with `PAYMENT_PROVIDER=simulated`; a 404 means no real provider yet). `PaymentGateway` (`lib/services/payment_gateway.dart`) is kept as the seam for a future real Wave / Orange Money integration (open the provider, then the server verifies); the app wires no gateway today.
- UI uses `kraveo_ui` tokens/widgets (`KSpace`, `KButton`, …) and `lucide_icons_flutter`. `forui` widgets (e.g. Home badges) are themed from the Kraveo tokens by `KForui` (`lib/widgets/ui/forui_theme.dart`, applied app-wide in `main.dart`); its font family must stay the bare `Jakarta` name. Primary CTAs use the gold `k.cta` / `k.onCta` tokens, blue stays for secondary actions and links.
