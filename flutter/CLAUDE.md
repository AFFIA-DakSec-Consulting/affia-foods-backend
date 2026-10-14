# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Flutter side of Kraveo, a campus food-delivery platform (VIT Bhopal). It holds three Android apps and one shared UI package. There is no Melos or workspace tool: each package is a standalone Flutter project.

| Folder | Installed name | Users |
|---|---|---|
| `apps/customer_app` | Kraveo | Students: Google sign-in, ordering from a dhaba (multi-restaurant carts allowed), Razorpay, live rider tracking, gate OTP |
| `apps/vendor_app` | Kraveo Restaurant Partner | Restaurants: loud new-order alarm, accept/reject, kitchen queue, stock, sales, settlements |
| `apps/driver_app` | Kraveo Delivery Partner | Riders: on/off duty, accept trips, multi-restaurant pickups, live GPS, OTP validation, earnings |
| `packages/kraveo_ui` | – | Shared design system (tokens, `KraveoTheme.customer()/vendor()/…`, `K*` widgets) |

The apps depend on `../../packages/kraveo_ui` by path, and their launcher icons point to `../../*.png` at the repo root. **Keep this folder layout.**

The sibling directories `../backend` (Node/Jest API, with its own CLAUDE.md), `../web` and `../Docs` belong to the same product. Code comments often cite `Docs/NN`, which means `../Docs/NN_*.md`. These are the API contracts the apps implement, for example 16 order flow, 18 push, 19 campus maps, 20 vendor location, 21 pricing/settlement and 22 multi-restaurant orders. Read the relevant contract before you change API parsing or flows.

## Commands

Run these from inside one package (`apps/<app>` or `packages/kraveo_ui`):

```bash
flutter pub get
flutter run
flutter analyze                                   # flutter_lints
flutter test
flutter test test/order_provider_test.dart        # single file
flutter test test/order_provider_test.dart --plain-name "part of test name"   # single test
```

- Release APKs for all three apps: `./scripts/build_mobile_apks.sh`, which writes to `build/apks/`. It names the files `Kraveo-{Customer,Restaurant-Partner,Delivery-Partner}-v<ver>-build<n>-release.apk` from `pubspec.yaml`. Never distribute files still named `app-release.apk`.
- All three apps share one version (`version:` in each `pubspec.yaml`). Bump the three together.
- Vendor alarm tone: `python3 tool/generate_alarm.py <out_dir>` (in `vendor_app`). The same tone lives in `assets/audio/new_order_alarm.ogg` and `android/app/src/main/res/raw/new_order_alarm.ogg`.

## Configuration

- Backend URL: `lib/config/api_config.dart` in each app. `isProduction = true` uses `https://api.kraveo.site/api` for REST and the same host for Socket.IO. Set it to `false` for a local backend at `http://10.0.2.2:5000` from the Android emulator.
- Firebase (FCM push) needs `android/app/google-services.json` per app.
- Google Sign-In (customer) can take an optional `--dart-define=GOOGLE_SERVER_CLIENT_ID=...`.
- Only Android is targeted (`ios: false` for icons).

## Architecture

**State management differs per app.**
- The customer app uses `provider`/`ChangeNotifier` (`lib/providers/`: session, dhaba, cart, order, quote).
- The vendor and driver apps use no provider package. They have plain controllers (`session/session_controller.dart`, `state/rider_controller.dart`, `services/*_controller.dart`) that are passed down explicitly.

**`main.dart` is the composition root and the test seam.** Each root widget (`KraveoCustomerApp`, `KraveoVendorApp`, `KraveoDriverApp`) takes optional dependencies such as auth, backend, socket factory, alarm, push, location and payout API. `null` means "use the real implementation". Tests build the real app widget and inject fakes from `test/support/`. When you add a network, platform or plugin dependency, follow the same pattern:
- define an abstract interface in `lib/services/...` (see `VendorBackend`, `RiderOrdersApi`, `RiderSocket`, `LocationSource`, `PushMessaging`, `MapViewFactory`);
- write a real implementation;
- add an optional constructor parameter;
- add a fake in `test/support/`.

**Session gate.** Each app has a top-level gate driven by session status (checking / unreachable / signed out / needs profile or application pending / signed in). A 401 from any authenticated call goes through a static `onUnauthorized` hook (for example `CustomerApiService.onUnauthorized`), which pops to the root and expires the session. Sign-out must reset every user-scoped controller so no data leaks between accounts.

**Real-time data comes from three layered sources:**
- REST, which is the source of truth;
- Socket.IO (`order_realtime.dart`, `order_socket.dart`, `rider_socket.dart`);
- FCM push.

Push is optional by design. Firebase starts after the first frame, failures are swallowed, and `push: null` (the default in tests) means the app runs without push. A push never carries state; it only triggers a refresh of the order through the normal REST path, and taps are routed after sign-in. Each app's `services/push/` separates the FCM seam, payload parsing, the background handler and the controller.

**Maps.** Google Maps is used behind a `MapViewFactory` (customer and driver). If no Maps key or Play services are present, or on any error, the UI falls back to a stylised map, so tests never create platform views. The vendor app has no Maps key and only opens external Maps links.

**Multi-restaurant orders (Docs/22).** One customer checkout can create an order *group* split into one order per restaurant (`order_group.dart`, `quote_controller.dart`). The vendor app sees only its own part, with a group note. The driver picks up from several restaurants. Pricing quotes come from the server (`POST /orders/quote`). Local fallbacks are marked as estimates.

**Model parsing is defensive.** Unknown fields are ignored, and a body missing essential fields becomes `null` instead of a half-filled object. JSON fixtures in `test/fixtures/` are copied from the backend's e2e tests so they match the real API shapes. Update them from the backend rather than inventing shapes.

**UI.** Use `kraveo_ui` tokens and widgets (`KSpace`, `KButton`, `KEmptyState`, `KBrandMark`, …) and `lucide_icons_flutter` for icons. App-specific small widgets live in each app's `lib/widgets/ui/`. User-facing strings are in English; the repo README is in French.
