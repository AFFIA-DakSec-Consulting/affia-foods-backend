import 'package:customer_app/models/dhaba.dart';
import 'package:customer_app/models/home_collection.dart';
import 'package:customer_app/models/menu_item.dart';
import 'package:customer_app/services/home_collections.dart';
import 'package:customer_app/widgets/ui/dhaba_art.dart';
import 'package:flutter_test/flutter_test.dart';

Dhaba _k(String id, {bool open = true, double rating = 4.2, String eta = '25-30 mins', double fee = 25, String category = ''}) =>
    Dhaba(id: id, name: 'Kitchen $id', category: category, rating: rating, eta: eta, bannerUrl: '', isAcceptingOrders: open, address: '', deliveryFee: fee);

MenuItemModel _d(String id, String vendor, String name, String category, double price, {bool available = true, String image = 'x.jpg'}) =>
    MenuItemModel(id: id, vendorId: vendor, name: name, price: price, category: category, description: '', imageUrl: image, isAvailable: available);

void main() {
  final kitchens = [
    _k('a', rating: 4.8, eta: '15-20 mins', fee: 0),
    _k('b', rating: 4.1, eta: '30-40 mins'),
    _k('c', open: false, rating: 4.9),
  ];
  final menus = {
    'a': [_d('a1', 'a', 'Masala Chai', 'Beverages', 500), _d('a2', 'a', 'Veg Thali', 'Thalis', 2500), _d('a3', 'a', 'Gulab Jamun', 'Desserts', 1000)],
    'b': [_d('b1', 'b', 'Cheese Burger', 'Fast Food', 2000), _d('b2', 'b', 'Cold Coffee', 'Beverages', 1200, available: false), _d('b3', 'b', 'Fries', 'Snacks', 800, image: '')],
    'c': [_d('c1', 'c', 'Lassi', 'Beverages', 700)],
  };
  List<HomeCollection> build(DateTime now) => buildHomeCollections(kitchens: kitchens, menuOf: (id) => menus[id] ?? const [], now: now);

  test('the moment of the day comes first, tagged "Right now"', () {
    expect(dayMomentAt(DateTime(2026, 1, 1, 8)), DayMoment.morning);
    expect(dayMomentAt(DateTime(2026, 1, 1, 13)), DayMoment.lunch);
    expect(dayMomentAt(DateTime(2026, 1, 1, 16)), DayMoment.afterClass);
    expect(dayMomentAt(DateTime(2026, 1, 1, 20)), DayMoment.dinner);
    expect(dayMomentAt(DateTime(2026, 1, 1, 2)), DayMoment.lateNight);

    final lunch = build(DateTime(2026, 1, 1, 13));
    expect(lunch.first.id, 'lunch');
    expect(lunch.first.highlight, 'En ce moment');
    expect(lunch.first.kitchens.map((d) => d.id), ['a'], reason: 'a has a thali; c is closed');

    final night = build(DateTime(2026, 1, 1, 1));
    expect(night.first.id, 'late-night');
    expect(night.first.kitchens.map((d) => d.id), ['a', 'b'], reason: 'late night lists every open kitchen');
  });

  test('closed kitchens, sold-out dishes and dishes without a photo never show', () {
    final rows = build(DateTime(2026, 1, 1, 16));
    final dishIds = {for (final r in rows) for (final (i, _) in r.dishes) i.id};
    final kitchenIds = {for (final r in rows) for (final d in r.kitchens) d.id};
    expect(dishIds, isNot(contains('c1')));
    expect(dishIds, isNot(contains('b2')));
    expect(dishIds, isNot(contains('b3')));
    expect(kitchenIds, isNot(contains('c')));
  });

  test('budget, drinks, favourites, speed, sweets and free delivery rows', () {
    final rows = {for (final r in build(DateTime(2026, 1, 1, 13))) r.id: r};
    expect(rows['budget']!.dishes.map((e) => e.$1.id), containsAll(['a1', 'a3']));
    expect(rows['budget']!.dishes.map((e) => e.$1.id), isNot(contains('a2')));
    expect(rows['thirsty']!.dishes.map((e) => e.$1.id), ['a1']);
    expect(rows['top-rated']!.kitchens.map((d) => d.id), ['a']);
    expect(rows['fast']!.kitchens.map((d) => d.id), ['a']);
    expect(rows['sweet']!.dishes.map((e) => e.$1.id), ['a3']);
    expect(rows['free-delivery']!.kitchens.map((d) => d.id), ['a']);
  });

  test('empty rows are left out', () {
    final rows = buildHomeCollections(kitchens: [_k('z', open: false)], menuOf: (_) => const [], now: DateTime(2026, 1, 1, 13));
    expect(rows, isEmpty);
  });

  test('default logo initials', () {
    expect(DhabaLogo.initials('Sharma Highway Dhaba'), 'SH');
    expect(DhabaLogo.initials('Chez Fatou'), 'CF');
    expect(DhabaLogo.initials('burger'), 'B');
    expect(DhabaLogo.initials('  '), 'K');
  });
}
