# Kraveo Customer App — AGENTS.md

## 1. Project Overview

Kraveo Customer is a Flutter mobile application for customers of a food delivery platform.

The application provides restaurant discovery, menus, cart management, order placement, delivery tracking, and customer account management.

### Core Technologies

- **Framework:** Flutter / Dart
- **State management:** Provider (`ChangeNotifier`)
- **UI and theming:** re:Swift theme system and `kraveo_ui`
- **Icons:** Lucide Icons Flutter
- **Backend communication:** REST API
- **Real-time updates:** Socket.IO and Firebase Cloud Messaging (FCM)
- **Testing:** Flutter unit and widget tests
- **Platforms:** Android and iOS

## 2. Project Structure

- `lib/` — Application source code, screens, providers, models, widgets, and services.
- `packages/kraveo_ui/` — Shared UI package used across related applications.
- `android/` — Android-specific configuration.
- `ios/` — iOS-specific configuration.
- `test/` — Automated tests.
- `test/support/` — Test fixtures, fakes, and sample data.

### Main Entry Points

- `lib/main.dart` — Application entry point and root provider configuration.
- `AuthGate` — Controls screen routing according to authentication and session status.
- `lib/config/api_config.dart` — API host and environment configuration.

Inspect the actual source code when these descriptions are insufficient or potentially outdated.

## 3. Architecture and State Management

### Provider Pattern

The application uses `Provider` and `ChangeNotifier` for state management.

| Provider | Responsibility |
|---|---|
| `SessionProvider` | Authentication state, customer profile, delivery point, logout and reset |
| `DhabaProvider` | Restaurant catalog, search, filters and favorites |
| `CartProvider` | Cart state and dish selection across restaurants |
| `OrderProvider` | Active orders, order history and tracking states |
| `DeliveryLocationProvider` | Optional geolocation and delivery address |

Providers are registered through `MultiProvider` at the application root.

Before modifying a provider, inspect its existing responsibilities and identify which screens or services depend on it.

### Backend Communication

- The REST API is the source of truth for persistent application data.
- Socket.IO and FCM notify the application of updates and trigger local refreshes.
- Providers synchronize application state with backend data.
- Do not treat push notifications or socket events as authoritative replacements for API data.
- Preserve existing API contracts and error-handling behavior.

### Authentication Gateway

`AuthGate` routes the customer according to session status:

- `checking` — Splash screen.
- `unreachable` — Connection error and retry or account-switch options.
- `signedOut` — Google login screen.
- `needsProfile` — Profile setup screen.
- `signedIn` — Home screen.

Preserve this flow when changing authentication, logout, or navigation behavior.

## 4. UI and Design Conventions

- Use the existing re:Swift theme system rather than introducing Flutter's default styling independently.
- Reuse components from `packages/kraveo_ui/` where appropriate.
- Preserve existing `KButton`, `KSnack`, `_KForui`, and related UI conventions.
- Use the project's existing Lucide icon package.
- Maintain consistency with the existing spacing, colors, typography, and component patterns.
- Avoid duplicating widgets or introducing a second design system.
- Do not redesign unrelated screens when fixing a specific feature.

### Localization

French is currently implemented for Home and restaurant pages. Other screens may remain in English.

No localization framework is currently documented. Inspect the implementation before changing localization behavior, and do not introduce a new framework without a clear requirement.

### Currency

All customer-facing monetary amounts use FCFA (XOF) with whole amounts.

Use the existing helper:

`fcfa()` from `lib/widgets/ui/format.dart`

Do not introduce a separate currency-formatting implementation without a specific reason.

## 5. Home Screen Features

The Home screen includes:

- Pull-to-refresh for restaurants and active orders.
- Horizontal restaurant or kitchen rows with dish images.
- Filtered or dashed vertical lists for search and filtering.
- Sorting and filters for open restaurants, ratings, free delivery, delivery time under 20 minutes, and budget.
- Delivery point selection through geolocation or a hostel drop-off location.
- A floating active-order bar when an order is in progress.

When modifying Home, inspect only the relevant widgets, providers, and services. Preserve unrelated filtering and layout behavior.

## 6. API and Environment Configuration

API configuration is maintained in:

`lib/config/api_config.dart`

- Production uses `isProduction = true` and the production API host.
- Development uses `isProduction = false` and a development host, potentially overridden with `--dart-define=API_HOST=...`.
- Device and simulator networking may require different host configuration.

Backend contract references may appear in source comments as `Docs/NN`.

- REST endpoints use the `/api` suffix.
- Socket.IO connects to the base host without that suffix.

Never expose secrets, access tokens, or private environment values in generated documentation, logs, or responses.

Do not change production URLs or environment settings unless explicitly required by the task.

## 7. Testing Conventions

Test code lives in `test/`.

Fixtures and fakes include:

- `test/support/order_fakes.dart`
- `test/support/push_fakes.dart`
- `test/support/sample_catalog.dart`

Prefer unit tests for isolated logic and widget tests for UI behavior. Use integration tests where appropriate.

`SessionProvider` exposes `beginForTest()` to bypass network initialization in relevant unit tests.

When changing behavior:

1. Identify the smallest relevant test file.
2. Run the targeted test first.
3. Run `flutter analyze` when appropriate.
4. Run the full test suite only when justified by the scope or risk of the change.

Never claim that a test passed unless it was actually executed successfully.

## 8. Developer Commands

Install dependencies:

`flutter pub get`

Analyze code:

`flutter analyze`

Run all tests:

`flutter test`

Run a specific test file:

`flutter test test/<file>_test.dart`

Run a test by name:

`flutter test test/<file>_test.dart --plain-name "test_name"`

Build the release APK:

`flutter build apk --release`

Regenerate launcher icons:

`dart run flutter_launcher_icons`

Do not run builds or full test suites automatically for simple questions or documentation-only tasks.

## 9. Git and Version Control

- Follow existing project conventions and standard commit practices.
- Inspect `git status` before potentially disruptive changes.
- Do not overwrite unrelated user changes.
- Do not reset, clean, or discard user modifications without explicit authorization.
- Keep changes focused on the requested task.
- Do not commit or push unless explicitly requested.

## 10. Mandatory AI Agent Workflow

### A. Understand the Request

Determine the requested outcome before inspecting files.

For simple questions, answer directly using the current context when sufficient.

Do not initiate a full repository analysis for a localized question or bug.

### B. Explore Only Relevant Files

Start with the smallest useful inspection:

1. Identify the relevant screen, widget, provider, service, or model.
2. Read the directly related implementation.
3. Follow imports, API calls, and dependencies only as needed.
4. Inspect relevant tests if behavior or correctness is involved.

Do not repeatedly list the entire repository or reread unrelated files.

Do not assume a file exists without checking when its exact location matters.

### C. Exclude Generated and Irrelevant Files

Avoid scanning these directories by default:

- `build/`
- `.dart_tool/`
- `.git/`
- `ios/Pods/`
- `android/.gradle/`

Also avoid dependency caches, generated files, binaries, and large assets unless the task explicitly concerns them.

These are exploration guidelines, not absolute prohibitions when a specific issue requires inspection.

### D. Keep Context Small

- Do not request or generate a full architecture report for every task.
- Do not dump entire source files when only a relevant section is needed.
- Prefer targeted searches and limited command output.
- Avoid repeating findings already established in the current session.
- Summarize only the information needed to make the next decision.
- Do not launch broad searches, builds, or tests without a task-related reason.
- Reuse existing project knowledge, but verify details against source code when correctness matters.

### E. Plan Before Modifying

For non-trivial tasks:

1. Briefly identify the cause or uncertainty.
2. List the files that need to change.
3. Explain the proposed modification.
4. Wait for approval before editing if the user requested diagnosis only.

For straightforward implementation requests, proceed without unnecessary confirmation.

### F. Make Minimal Changes

- Modify only the files necessary to satisfy the request.
- Preserve existing naming, architecture, and coding conventions.
- Avoid unrelated refactoring, formatting changes, or dependency upgrades.
- Do not add packages when existing Flutter or Dart capabilities are sufficient.
- Do not replace Provider or introduce another state-management system without explicit justification.
- Preserve compatibility with existing screens, services, and API contracts.

### G. Validate Proportionally

Choose validation according to the change:

- Documentation-only change: inspect the resulting diff.
- Isolated logic change: run the relevant unit test.
- UI change: run the relevant widget test when available.
- Cross-cutting change: consider `flutter analyze` and broader tests.

If validation cannot run, explain why. Do not imply that unexecuted checks succeeded.

### H. Final Response

Keep the final response concise and include:

- What was changed or discovered.
- The files involved.
- The checks actually performed.
- Any remaining issue or uncertainty.

Do not provide a long architecture explanation unless requested.

## 11. Safety and Scope

- Do not execute destructive commands without explicit authorization.
- Do not modify unrelated user work.
- Do not expose credentials or sensitive configuration.
- Do not invent API behavior, business rules, or test results.
- When the available evidence is insufficient, inspect the smallest relevant area before drawing conclusions.

## 12. Primary Objective

Work as a focused development agent, not as a repository-wide auditor.

**Understand the smallest relevant part of the application, solve the requested problem, preserve existing conventions, and validate only what is necessary.**