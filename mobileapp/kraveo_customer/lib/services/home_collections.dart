import '../models/dhaba.dart';
import '../models/home_collection.dart';
import '../models/menu_item.dart';

/// Moments of the day, each with the food that fits it.
enum DayMoment { morning, lunch, afterClass, dinner, lateNight }

DayMoment dayMomentAt(DateTime t) {
  final h = t.hour;
  if (h >= 5 && h < 11) return DayMoment.morning;
  if (h >= 11 && h < 15) return DayMoment.lunch;
  if (h >= 15 && h < 19) return DayMoment.afterClass;
  if (h >= 19 && h < 23) return DayMoment.dinner;
  return DayMoment.lateNight;
}

class _Theme {
  const _Theme(this.id, this.title, this.emoji, this.subtitle, this.kind, this.words);

  final String id;
  final String title;
  final String emoji;
  final String subtitle;
  final HomeCollectionKind kind;
  final List<String> words;
}

const Map<DayMoment, _Theme> _moments = {
  DayMoment.morning: _Theme('morning', 'Bien commencer la journée', '☀️', 'Petit-déj et boisson chaude avant les cours', HomeCollectionKind.dishes,
      ['breakfast', 'egg', 'omelette', 'paratha', 'poha', 'upma', 'dosa', 'idli', 'toast', 'sandwich', 'coffee', 'tea', 'chai', 'juice', 'croissant', 'pain']),
  DayMoment.lunch: _Theme('lunch', 'Pause déjeuner', '🍛', 'De vrais plats pour recharger entre deux cours', HomeCollectionKind.kitchens,
      ['thali', 'meal', 'rice', 'biryani', 'curry', 'dal', 'combo', 'north indian', 'south indian', 'thieb', 'yassa', 'mafe', 'plat']),
  DayMoment.afterClass: _Theme('after-class', 'Retour de l\'école', '🎒', 'Des snacks à partager sur le chemin', HomeCollectionKind.dishes,
      ['snack', 'fries', 'roll', 'wrap', 'burger', 'pizza', 'momo', 'samosa', 'shake', 'sandwich', 'fast food', 'chaat', 'pastry']),
  DayMoment.dinner: _Theme('dinner', 'Le dîner est servi', '🌙', 'Des plats généreux pour la soirée', HomeCollectionKind.kitchens,
      ['thali', 'biryani', 'curry', 'pizza', 'burger', 'chicken', 'grill', 'tandoor', 'noodle', 'chinese', 'north indian', 'dibi']),
  DayMoment.lateNight: _Theme('late-night', 'Fringale de minuit', '🦉', 'Encore en cuisine pendant vos révisions', HomeCollectionKind.kitchens,
      ['night', 'late', 'maggi', 'noodle', 'roll', 'burger', 'fries', 'tea', 'chai', 'coffee']),
};

const _budget = _Theme('budget', 'Petit budget', '💸', 'Des plats à 1 500 FCFA ou moins', HomeCollectionKind.dishes, []);
const _thirsty = _Theme('thirsty', 'Envie de boire ?', '🥤', 'Boissons fraîches, jus et milkshakes', HomeCollectionKind.dishes,
    ['beverage', 'drink', 'juice', 'shake', 'lassi', 'soda', 'cold', 'smoothie', 'bissap', 'bouye', 'gingembre', 'coffee', 'tea']);
const _sweet = _Theme('sweet', 'Petit plaisir sucré', '🍰', 'Des desserts qui valent le détour', HomeCollectionKind.dishes,
    ['dessert', 'sweet', 'cake', 'pastry', 'ice cream', 'brownie', 'gulab', 'kheer', 'halwa', 'chocolate', 'thiakry']);
const _topRated = _Theme('top-rated', 'Les chouchous du quartier', '⭐', 'Les restaurants les mieux notés près de vous', HomeCollectionKind.kitchens, []);
const _fast = _Theme('fast', 'Livré en un éclair', '⚡', 'Livraison en 20 minutes ou moins', HomeCollectionKind.kitchens, []);
const _freeDelivery = _Theme('free-delivery', 'Livraison offerte', '🛵', 'Aucun frais de livraison chez ces restaurants', HomeCollectionKind.kitchens, []);

const int _maxItems = 10;

/// Most expensive dish in the "Student budget" row.
const double budgetMaxFcfa = 1500;

/// First number of an ETA such as "15-20 mins".
int etaMinutes(String eta) => int.tryParse(RegExp(r'\d+').firstMatch(eta)?.group(0) ?? '') ?? 999;

bool _hits(String text, List<String> words) {
  final t = text.toLowerCase();
  return words.any(t.contains);
}

bool _dishHits(MenuItemModel item, List<String> words) => _hits('${item.category} ${item.name}', words);

bool _kitchenHits(Dhaba d, List<MenuItemModel> menu, List<String> words) =>
    _hits('${d.name} ${d.category} ${d.tags.join(' ')}', words) || menu.any((i) => _dishHits(i, words));

/// Picks dishes in turn from each kitchen so one menu cannot fill a whole row.
List<(MenuItemModel, Dhaba)> _roundRobin(List<List<(MenuItemModel, Dhaba)>> queues) {
  final out = <(MenuItemModel, Dhaba)>[];
  for (var round = 0; out.length < _maxItems; round++) {
    var any = false;
    for (final q in queues) {
      if (round < q.length) {
        out.add(q[round]);
        any = true;
        if (out.length == _maxItems) break;
      }
    }
    if (!any) break;
  }
  return out;
}

/// Builds Home's themed rows from the live catalog: the moment of the day first (tagged
/// "Right now"), then budget, drinks, favourites, speed, sweets, free delivery. Only open
/// kitchens and available dishes with a photo are used; empty rows are left out.
List<HomeCollection> buildHomeCollections({
  required List<Dhaba> kitchens,
  required List<MenuItemModel> Function(String kitchenId) menuOf,
  required DateTime now,
}) {
  final open = [for (final d in kitchens) if (d.isAcceptingOrders) d];
  final menus = {for (final d in open) d.id: menuOf(d.id)};
  List<MenuItemModel> shown(Dhaba d) => [for (final i in menus[d.id]!) if (i.isAvailable && i.imageUrl.trim().isNotEmpty) i];

  HomeCollection make(_Theme t, {String? highlight, bool Function(MenuItemModel)? dish, bool Function(Dhaba)? kitchen, int Function(Dhaba, Dhaba)? order}) {
    if (t.kind == HomeCollectionKind.dishes) {
      final test = dish ?? (MenuItemModel i) => _dishHits(i, t.words);
      final queues = [
        for (final d in open) [for (final i in shown(d)) if (test(i)) (i, d)],
      ];
      return HomeCollection(id: t.id, title: t.title, emoji: t.emoji, subtitle: t.subtitle, kind: t.kind, dishes: _roundRobin(queues), highlight: highlight);
    }
    final test = kitchen ?? (Dhaba d) => _kitchenHits(d, menus[d.id]!, t.words);
    final list = [for (final d in open) if (test(d)) d];
    if (order != null) list.sort(order);
    return HomeCollection(id: t.id, title: t.title, emoji: t.emoji, subtitle: t.subtitle, kind: t.kind, kitchens: list.take(_maxItems).toList(), highlight: highlight);
  }

  final moment = dayMomentAt(now);
  final rows = <HomeCollection>[
    make(_moments[moment]!, highlight: 'En ce moment', kitchen: moment == DayMoment.lateNight ? (_) => true : null),
    make(_budget, dish: (i) => i.price <= budgetMaxFcfa),
    make(_thirsty),
    make(_topRated, kitchen: (d) => d.rating >= 4.5, order: (a, b) => b.rating.compareTo(a.rating)),
    make(_fast, kitchen: (d) => etaMinutes(d.eta) <= 20, order: (a, b) => etaMinutes(a.eta).compareTo(etaMinutes(b.eta))),
    make(_sweet),
    make(_freeDelivery, kitchen: (d) => d.deliveryFee <= 0),
  ];
  return [for (final r in rows) if (!r.isEmpty) r];
}
