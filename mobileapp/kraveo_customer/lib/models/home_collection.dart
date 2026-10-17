import 'dhaba.dart';
import 'menu_item.dart';

/// What a Home collection lists.
enum HomeCollectionKind { kitchens, dishes }

/// A themed horizontal row on Home ("Lunch break 🍛", "Student budget 💸"...).
///
/// Today the app builds them itself (`buildHomeCollections`); the shape is meant to be served by
/// the backend later (`GET /home/collections`: id, title, emoji, subtitle, kind, ids), at which
/// point only the builder changes.
class HomeCollection {
  const HomeCollection({
    required this.id,
    required this.title,
    required this.emoji,
    required this.subtitle,
    required this.kind,
    this.kitchens = const [],
    this.dishes = const [],
    this.highlight,
  });

  final String id;
  final String title;
  final String emoji;
  final String subtitle;
  final HomeCollectionKind kind;
  final List<Dhaba> kitchens;

  /// Dishes with the kitchen each one comes from.
  final List<(MenuItemModel, Dhaba)> dishes;

  /// Small tag next to the title ("Right now"), or null.
  final String? highlight;

  bool get isEmpty => kind == HomeCollectionKind.kitchens ? kitchens.isEmpty : dishes.isEmpty;
}
