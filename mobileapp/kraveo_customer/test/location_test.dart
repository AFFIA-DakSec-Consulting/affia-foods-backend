import 'dart:async';
import 'dart:convert';

import 'package:customer_app/models/delivery_address.dart';
import 'package:customer_app/providers/cart_provider.dart';
import 'package:customer_app/providers/dhaba_provider.dart';
import 'package:customer_app/providers/location_provider.dart';
import 'package:customer_app/providers/order_provider.dart';
import 'package:customer_app/providers/session_provider.dart';
import 'package:customer_app/screens/home_screen.dart';
import 'package:customer_app/services/location_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'account_flow_test.dart' show loadKraveoFonts;
import 'support/location_fakes.dart';
import 'support/sample_catalog.dart';

Future<void> _pumpHome(WidgetTester tester, DeliveryLocationProvider location) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
  final session = SessionProvider(initial: SessionStatus.checking)
    ..beginForTest({'id': 'u', 'name': 'Awa Diop', 'role': 'STUDENT', 'isStudent': true, 'hostelBlock': 'Block 1', 'avatarId': 2});
  await tester.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider<SessionProvider>.value(value: session),
      ChangeNotifierProvider<DhabaProvider>.value(value: sampleCatalogProvider()),
      ChangeNotifierProvider<CartProvider>.value(value: CartProvider()),
      ChangeNotifierProvider<OrderProvider>.value(value: OrderProvider()),
      ChangeNotifierProvider<DeliveryLocationProvider>.value(value: location),
    ],
    child: MaterialApp(theme: KraveoTheme.customer(), home: const HomeScreen()),
  ));
  await tester.pump(const Duration(milliseconds: 100));
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 250));
  }
}

void main() {
  setUpAll(loadKraveoFonts);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('DeliveryAddress', () {
    test('title / subtitle pick the most precise readable parts', () {
      const a = DeliveryAddress(lat: 1, lng: 2, street: 'Rue 10', quartier: 'Escale', city: 'Thiès');
      expect(a.title, 'Rue 10');
      expect(a.subtitle, 'Escale, Thiès');
      const b = DeliveryAddress(lat: 1, lng: 2, quartier: 'Escale', city: 'Thiès');
      expect(b.title, 'Escale');
      expect(b.subtitle, 'Thiès');
      expect(const DeliveryAddress(lat: 1, lng: 2).title, 'Position actuelle');
    });

    test('plus codes and "Unnamed Road" are not addresses', () {
      expect(DeliveryAddress.clean('8QJ2+7F Thiès'), isNull);
      expect(DeliveryAddress.clean('Unnamed Road'), isNull);
      expect(DeliveryAddress.clean('  Avenue   Léopold Senghor '), 'Avenue Léopold Senghor');
    });

    test('JSON round trip; bad coordinates are refused', () {
      const a = DeliveryAddress(lat: 14.79, lng: -16.93, street: 'Rue 10', quartier: 'Escale', city: 'Thiès', accuracyMeters: 8);
      final back = DeliveryAddress.fromJson(jsonDecode(jsonEncode(a.toJson())))!;
      expect(back.title, 'Rue 10');
      expect(back.subtitle, 'Escale, Thiès');
      expect(back.accuracyMeters, 8);
      expect(DeliveryAddress.fromJson({'lat': 200, 'lng': 0}), isNull);
      expect(DeliveryAddress.fromJson('nope'), isNull);
    });
  });

  group('DeliveryLocationProvider', () {
    test('locates once automatically, saves the address, and a failure keeps the last one', () async {
      final service = FakeLocationService();
      final p = DeliveryLocationProvider(service: service);
      await p.ensureLocated();
      await p.ensureLocated();
      expect(service.locateCalls, 1);
      expect(p.status, LocationStatus.ready);
      expect(p.address?.title, 'Rue 10');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('kraveo_delivery_address'), contains('Rue 10'));

      service.next = const LocationFix.fail(LocationOutcome.deniedForever);
      await p.locate();
      expect(p.status, LocationStatus.deniedForever);
      expect(p.address?.title, 'Rue 10', reason: 'the last known address stays');
    });

    test('the saved address is shown at once on the next launch; sign-out forgets it', () async {
      SharedPreferences.setMockInitialValues({
        'kraveo_delivery_address': jsonEncode(const DeliveryAddress(lat: 14.8, lng: -16.9, street: 'Rue 3', city: 'Thiès').toJson()),
      });
      final p = DeliveryLocationProvider(service: FakeLocationService());
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(p.address?.title, 'Rue 3');
      p.resetForLogout();
      expect(p.address, isNull);
      expect(p.status, LocationStatus.idle);
    });

    test('concurrent locate calls share one attempt', () async {
      final service = FakeLocationService()..gate = Completer<void>();
      final p = DeliveryLocationProvider(service: service, restoreSaved: false);
      final a = p.locate();
      final b = p.locate();
      expect(p.isLocating, isTrue);
      service.gate!.complete();
      await Future.wait([a, b]);
      expect(service.locateCalls, 1);
    });
  });

  group('Home header', () {
    testWidgets('Home locates on open: "Locating you…" with a pulsing pin, then the street', (tester) async {
      final service = FakeLocationService()..gate = Completer<void>();
      final location = DeliveryLocationProvider(service: service, restoreSaved: false);
      await _pumpHome(tester, location);
      await tester.pump();
      expect(service.locateCalls, 1);
      expect(find.text('LIVRER À'), findsOneWidget);
      expect(find.text('Localisation en cours…'), findsOneWidget);
      service.gate!.complete();
      await _settle(tester);
      expect(find.text('Rue 10'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the sheet shows the address and locates again; refusal offers the settings', (tester) async {
      final service = FakeLocationService();
      final location = DeliveryLocationProvider(service: service, restoreSaved: false);
      await _pumpHome(tester, location);
      await _settle(tester);
      await tester.tap(find.text('Rue 10'));
      await _settle(tester);
      expect(find.text('Adresse de livraison'), findsOneWidget);
      expect(find.text('Escale, Thiès'), findsOneWidget);
      expect(find.textContaining('environ 12 m'), findsOneWidget);

      service.next = const LocationFix.fail(LocationOutcome.deniedForever);
      await tester.tap(find.text('Utiliser ma position actuelle'));
      await _settle(tester);
      expect(service.locateCalls, 2);
      expect(find.text('Ouvrir les réglages'), findsOneWidget);
      await tester.tap(find.text('Ouvrir les réglages'));
      await tester.pump();
      expect(service.appSettingsCalls, 1);
      expect(find.text('Choisir un point de livraison'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('no address and location off: "Set your address", and the sheet can turn location on', (tester) async {
      final service = FakeLocationService()..next = const LocationFix.fail(LocationOutcome.serviceOff);
      final location = DeliveryLocationProvider(service: service, restoreSaved: false);
      await _pumpHome(tester, location);
      await _settle(tester);
      expect(find.text('Définir votre adresse'), findsOneWidget);
      await tester.tap(find.text('Définir votre adresse'));
      await _settle(tester);
      await tester.tap(find.text('Activer la localisation'));
      await tester.pump();
      expect(service.locationSettingsCalls, 1);
    });

    // Notification bell is commented out on Home for now.
    // testWidgets('the notification bell sits next to the avatar, without a bubble when nothing is in progress', (tester) async {
    //   await _pumpHome(tester, DeliveryLocationProvider(service: FakeLocationService(), restoreSaved: false));
    //   await _settle(tester);
    //   expect(find.byIcon(LucideIcons.bell), findsOneWidget);
    //   final bubble = tester.widget<AnimatedScale>(find.ancestor(of: find.text('0'), matching: find.byType(AnimatedScale)).first);
    //   expect(bubble.scale, 0);
    // });
  });
}
