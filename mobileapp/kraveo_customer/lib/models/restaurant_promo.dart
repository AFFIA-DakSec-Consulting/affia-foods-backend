/// A promotion a restaurant runs, shown as a small banner on its page.
///
/// Expected from the API as `promotions: [{ "title", "subtitle"?, "code"?, "imageUrl"? }]` on the
/// vendor (not sent yet). The app also builds a few from real facts (free delivery, first-order
/// coupon) so the row is never invented.
class RestaurantPromo {
  const RestaurantPromo({required this.title, this.subtitle = '', this.code, this.imageUrl = '', this.emoji = '🎉'});

  final String title;
  final String subtitle;

  /// Coupon to copy, if the promotion needs one.
  final String? code;
  final String imageUrl;
  final String emoji;

  static List<RestaurantPromo> listFromJson(Object? raw) {
    if (raw is! List) return const [];
    final out = <RestaurantPromo>[];
    for (final p in raw) {
      if (p is! Map) continue;
      final title = p['title']?.toString().trim() ?? '';
      if (title.isEmpty) continue;
      final code = p['code']?.toString().trim();
      out.add(RestaurantPromo(
        title: title,
        subtitle: p['subtitle']?.toString().trim() ?? '',
        code: code == null || code.isEmpty ? null : code,
        imageUrl: p['imageUrl']?.toString() ?? '',
      ));
    }
    return out;
  }
}
