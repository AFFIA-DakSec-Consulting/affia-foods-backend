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

- Backend URL: `lib/config/api_config.dart`. `isProduction = true` → `https://api.kraveo.site`; `false` (currently set) → `http://localhost:5001` (iOS simulator; for an Android emulator run `adb reverse tcp:5001 tcp:5001`). REST uses the `/api` suffix; Socket.IO uses the bare host. Set `isProduction = true` before a release build.
- Google Sign-In normally reads the web client id from `google-services.json`; only if absent pass `--dart-define=GOOGLE_SERVER_CLIENT_ID=...`.
- Firebase push: `android/app/google-services.json`; iOS needs `ios/Runner/GoogleService-Info.plist` (git-ignored, must be added to the Runner target in Xcode) plus an APNs key uploaded in the Firebase console and the Push Notifications capability (`Runner.entitlements`; set `aps-environment` to `production` for release).
- iOS secrets: copy `ios/Flutter/Secrets.xcconfig.example` to `ios/Flutter/Secrets.xcconfig` (git-ignored) and fill `MAPS_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_REVERSED_CLIENT_ID` (Info.plist and `AppDelegate.swift` read them). Without a Maps key the app shows its stylised map. The `site.kraveo.customer/system` MethodChannel is implemented natively in `MainActivity.kt` and `AppDelegate.swift`: keep both in sync.
- iOS Razorpay: not configured yet (UPI `LSApplicationQueriesSchemes` is commented out in `Info.plist`).

## Architecture

- `lib/main.dart` is the composition root and the test seam: the root widget takes optional dependencies (auth, backend, socket, push, location, payout…). `null` = real implementation; tests inject fakes from `test/support/`. New network/plugin dependencies follow the same pattern: abstract interface in `lib/services/`, real implementation, optional constructor parameter, fake in `test/support/`.
- A top-level gate switches on session status; a 401 goes through a static `onUnauthorized` hook back to login, and sign-out must reset all user-scoped state.
- Auth: two ways in, both ending in `SessionProvider._begin`. Google (`/auth/google`) and phone + code (`/auth/otp/request` then `/auth/otp/verify`, screens `phone_login_screen` → `otp_code_screen`; Senegalese +221 numbers, 6-digit code sent by WhatsApp, test account 77 000 00 00 / 123456 on the dev server). The login screens are pushed above `AuthGate`, so a successful verify pops back to the root. A phone-verified user (`phone` starts with `+221`) skips the phone field in `ProfileSetupScreen`.
- Data: REST is the source of truth; Socket.IO and FCM push only trigger refreshes. Push is optional (starts after first frame, failures swallowed, `push: null` in tests).
- Models parse defensively (unknown fields ignored, malformed body → null). Shared test fakes/sample data live in `test/support/` (`order_fakes`, `push_fakes`, `sample_catalog`).
- Payments: `PaymentGateway` (Razorpay) only yields a proof; the server verifies its signature before an order counts as paid. A fresh Razorpay instance is used per attempt.
- UI uses `kraveo_ui` tokens/widgets (`KSpace`, `KButton`, …) and `lucide_icons_flutter`.
