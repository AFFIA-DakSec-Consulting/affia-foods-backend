import 'package:customer_app/models/dhaba.dart';
import 'package:customer_app/models/menu_item.dart';
import 'package:customer_app/models/opening_hours.dart';
import 'package:customer_app/models/restaurant_promo.dart';
import 'package:customer_app/providers/cart_provider.dart';
import 'package:customer_app/providers/dhaba_provider.dart';
import 'package:customer_app/providers/order_provider.dart';
import 'package:customer_app/providers/session_provider.dart';
import 'package:customer_app/screens/dhaba_menu_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import 'account_flow_test.dart' show loadKraveoFonts;

MenuItemModel _dish(String id, String name, String category, double price, {double? was, int? ratings}) => MenuItemModel(
    id: id, vendorId: 'k1', name: name, price: price, category: category, description: '', imageUrl: '', isAvailable: true, originalPrice: was, ratingCount: ratings);

Dhaba _kitchen({List<RestaurantPromo> promos = const []}) => Dhaba(
      id: 'k1',
      name: 'Chez Fatou',
      category: 'Sénégalais · Grillades',
      rating: 4.7,
      eta: '20-25 min',
      bannerUrl: '',
      isAcceptingOrders: true,
      address: 'Escale, Thiès',
      deliveryFee: 500,
      description: 'Cuisine maison, thieb et yassa tous les jours.',
      ratingsCount: 128,
      openingHours: OpeningHours.fromJson({
        for (final d in OpeningHours.keys) d: [{'open': '00:00', 'close': '23:59'}],
      }),
      promotions: promos,
    );

Future<DhabaProvider> _pump(WidgetTester tester, {List<MenuItemModel>? menu, List<RestaurantPromo> promos = const []}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
  final kitchen = _kitchen(promos: promos);
  final dhabas = DhabaProvider(dhabas: [kitchen], menus: {
    'k1': menu ??
        [
          _dish('t1', 'Thiéboudienne', 'Plats', 2500),
          _dish('t2', 'Yassa poulet', 'Plats', 2000, was: 2500),
          _dish('d1', 'Bissap', 'Boissons', 500),
          _dish('d2', 'Bouye', 'Boissons', 600),
          _dish('s1', 'Thiakry', 'Desserts', 700),
        ],
  });
  await tester.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider<SessionProvider>.value(value: SessionProvider(initial: SessionStatus.signedIn)),
      ChangeNotifierProvider<DhabaProvider>.value(value: dhabas),
      ChangeNotifierProvider<CartProvider>.value(value: CartProvider()),
      ChangeNotifierProvider<OrderProvider>.value(value: OrderProvider()),
    ],
    child: MaterialApp(theme: KraveoTheme.customer(), home: DhabaMenuScreen(dhaba: kitchen, selectedHostel: 'Escale')),
  ));
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 200));
  }
  return dhabas;
}

void main() {
  setUpAll(loadKraveoFonts);

  group('OpeningHours', () {
    final hours = OpeningHours.fromJson({
      'mon': [{'open': '08:00', 'close': '14:00'}, {'open': '18:00', 'close': '02:00'}],
      'tue': [{'open': '08:00', 'close': '14:00'}],
    })!;
    // 2026-10-12 is a Monday.
    test('open now, opening later, closed for the day, closed all day', () {
      expect(hours.statusAt(DateTime(2026, 10, 12, 9)), 'Ouvert jusqu\'à 14:00');
      expect(hours.statusAt(DateTime(2026, 10, 12, 15)), 'Ouvre à 18:00');
      expect(hours.statusAt(DateTime(2026, 10, 12, 20)), 'Ouvert jusqu\'à 02:00');
      expect(hours.statusAt(DateTime(2026, 10, 13, 1)), 'Ouvert jusqu\'à 02:00', reason: "Monday's late slot runs past midnight");
      expect(hours.statusAt(DateTime(2026, 10, 13, 15)), 'Fermé pour aujourd\'hui');
      expect(hours.statusAt(DateTime(2026, 10, 14, 12)), 'Fermé aujourd\'hui');
    });

    test('bad values are ignored', () {
      expect(OpeningHours.fromJson(null), isNull);
      expect(OpeningHours.fromJson({'mon': [{'open': 'x', 'close': '10:00'}]})!.slotsOn(1), isEmpty);
    });
  });

  test('a dish is on promo only when the original price is higher', () {
    final d = MenuItemModel.fromJson({'id': 'a', 'name': 'Yassa', 'price': 2000, 'originalPrice': 2500});
    expect(d.onPromo, isTrue);
    expect(d.discountPercent, 20);
    expect(MenuItemModel.fromJson({'id': 'b', 'name': 'X', 'price': 2000, 'originalPrice': 1500}).onPromo, isFalse);
    expect(MenuItemModel.fromJson({'id': 'c', 'name': 'X', 'price': 2000}).onPromo, isFalse);
  });

  test('restaurant fields from the API: description, hours, ratings, promotions', () {
    final d = Dhaba.fromJson({
      'id': 'v',
      'name': 'Chez Fatou',
      'description': '  Cuisine maison  ',
      'totalRatingsCount': 42,
      'lat': 14.79,
      'lng': -16.93,
      'openingHours': {'mon': [{'open': '08:00', 'close': '14:00'}]},
      'promotions': [{'title': '-10 % le midi', 'code': 'MIDI'}, {'subtitle': 'no title'}],
    });
    expect(d.description, 'Cuisine maison');
    expect(d.ratingsCount, 42);
    expect(d.location?.lat, 14.79);
    expect(d.openingHours?.slotsOn(1), hasLength(1));
    expect(d.promotions.map((p) => p.title), ['-10 % le midi']);
  });

  group('restaurant page', () {
    testWidgets('logo, key facts, promo section and banners, tabs per category', (tester) async {
      await _pump(tester, promos: const [RestaurantPromo(title: '-10 % le midi', subtitle: 'Sur les plats', code: 'MIDI')]);
      expect(find.text('Chez Fatou'), findsWidgets);
      expect(find.text('CF'), findsWidgets, reason: 'default logo with initials');
      expect(find.text('128 avis'), findsOneWidget);
      expect(find.text('500 FCFA'), findsWidgets);
      expect(find.textContaining('Ouvert jusqu'), findsOneWidget);
      expect(find.text('-10 % le midi'), findsOneWidget);
      for (final tab in ['Promos', 'Plats', 'Boissons', 'Desserts']) {
        expect(find.text(tab), findsWidgets, reason: tab);
      }
      expect(find.text('-20 %'), findsWidgets, reason: 'Yassa poulet is 2 000 instead of 2 500');
      expect(tester.takeException(), isNull);
    });

    testWidgets('tapping a tab scrolls to its section', (tester) async {
      await _pump(tester);
      final dessertsTitle = find.text('Thiakry');
      expect(tester.getTopLeft(dessertsTitle).dy, greaterThan(844), reason: 'below the fold at first');
      await tester.ensureVisible(find.bySemanticsLabel('Desserts'));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.bySemanticsLabel('Desserts'));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(tester.getTopLeft(dessertsTitle).dy, lessThan(780), reason: 'the Desserts section is on screen');
      expect(find.bySemanticsLabel(RegExp(r'^Desserts, sélectionné')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('scrolling down past sections keeps the page where the finger left it (no jump back to the top)', (tester) async {
      await _pump(tester, menu: [
        for (var i = 0; i < 6; i++) _dish('p$i', 'Plat $i', 'Plats', 2000),
        for (var i = 0; i < 6; i++) _dish('b$i', 'Boisson $i', 'Boissons', 500),
        for (var i = 0; i < 6; i++) _dish('d$i', 'Dessert $i', 'Desserts', 700),
      ]);
      final scroll = tester.widget<CustomScrollView>(find.byType(CustomScrollView)).controller!;
      for (var step = 0; step < 4; step++) {
        await tester.drag(find.byType(CustomScrollView), const Offset(0, -500));
        for (var i = 0; i < 10; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
      }
      expect(scroll.offset, greaterThan(1500), reason: 'the page stays scrolled down');
      expect(find.bySemanticsLabel(RegExp(r'^(Boissons|Desserts), sélectionné')), findsOneWidget, reason: 'the tab followed the scroll');
      expect(tester.takeException(), isNull);
    });

    testWidgets('the heart saves the restaurant to favourites', (tester) async {
      final dhabas = await _pump(tester);
      expect(dhabas.byId('k1')!.isFavorite, isFalse);
      await tester.tap(find.byIcon(LucideIcons.heart).first);
      await tester.pump(const Duration(milliseconds: 300));
      expect(dhabas.byId('k1')!.isFavorite, isTrue);
      expect(find.textContaining('ajouté à vos favoris'), findsOneWidget);
    });

    testWidgets('the search hides in the tab bar and filters the menu', (tester) async {
      await _pump(tester);
      await tester.tap(find.bySemanticsLabel('Rechercher dans le menu'));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.enterText(find.byKey(const ValueKey('menu-search-field')), 'bis');
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Bissap'), findsOneWidget);
      expect(find.text('Thiéboudienne'), findsNothing);
      expect(find.text('Résultats'), findsOneWidget);
    });

    testWidgets('the info sheet lists the week hours and the address', (tester) async {
      await _pump(tester);
      await tester.tap(find.bySemanticsLabel('Infos sur Chez Fatou'));
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('Horaires'), findsOneWidget);
      expect(find.text('Lundi'), findsOneWidget);
      expect(find.text('Escale, Thiès'), findsOneWidget);
      expect(find.text('Présentation'), findsOneWidget);
    });
  });
}
