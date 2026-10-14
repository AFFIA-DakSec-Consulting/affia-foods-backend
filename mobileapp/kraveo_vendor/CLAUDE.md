# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kraveo Restaurant Partner (vendor app) — standalone Flutter (Android only) app, part of the Kraveo campus food-delivery platform. No provider package: plain controllers. Loud new-order alarm (`assets/audio/new_order_alarm.ogg`, also in `android/app/src/main/res/raw/`; regenerate with `python3 tool/generate_alarm.py <out_dir>`). No Maps key: only external Maps links.

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

- Backend URL: `lib/config/api_config.dart` (`isProduction = true` → `https://api.kraveo.site`; `false` → `http://10.0.2.2:5000` for the Android emulator).
- Firebase push: `android/app/google-services.json`.

## Architecture

- `lib/main.dart` is the composition root and the test seam: the root widget takes optional dependencies (auth, backend, socket, push, location, payout…). `null` = real implementation; tests inject fakes from `test/support/`. New network/plugin dependencies follow the same pattern: abstract interface in `lib/services/`, real implementation, optional constructor parameter, fake in `test/support/`.
- A top-level gate switches on session status; a 401 goes through a static `onUnauthorized` hook back to login, and sign-out must reset all user-scoped state.
- Data: REST is the source of truth; Socket.IO and FCM push only trigger refreshes. Push is optional (starts after first frame, failures swallowed, `push: null` in tests).
- Models parse defensively (unknown fields ignored, malformed body → null). Fixtures in `test/fixtures/` mirror the backend's e2e tests.
- UI uses `kraveo_ui` tokens/widgets (`KSpace`, `KButton`, …) and `lucide_icons_flutter`.
