import 'customization.dart';

class MenuItemModel {
  final String id;
  final String vendorId;
  final String name;
  final double price;
  final String category;
  final String description;
  final String imageUrl;
  final bool isAvailable;
  final bool isVeg;
  final List<CustomizationGroup> customizationGroups;

  /// Dish rating and how many ratings it has (both null when unknown).
  final double? rating;

  /// Price before a promotion (`originalPrice`, or `compareAtPrice`), only when higher than
  /// [price]. Not sent by the API yet: the UI shows promos as soon as it is.
  final double? originalPrice;
  final int? ratingCount;

  const MenuItemModel({
    required this.id,
    required this.vendorId,
    required this.name,
    required this.price,
    required this.category,
    required this.description,
    required this.imageUrl,
    required this.isAvailable,
    this.isVeg = true,
    this.customizationGroups = const [],
    this.rating,
    this.originalPrice,
    this.ratingCount,
  });

  bool get hasCustomizations => customizationGroups.isNotEmpty;

  /// True when the dish is on promotion.
  bool get onPromo => originalPrice != null && originalPrice! > price;

  /// Whole-percent discount ("-20 %"), 0 when not on promotion.
  int get discountPercent => onPromo ? (((originalPrice! - price) / originalPrice!) * 100).round() : 0;

  static double? _promoPrice(Object? raw, double price) {
    final v = raw is num ? raw.toDouble() : double.tryParse('${raw ?? ''}');
    return v != null && v > price ? v : null;
  }

  factory MenuItemModel.fromJson(Map<String, dynamic> json) {
    return MenuItemModel(
      id: json['id'] ?? '',
      vendorId: json['vendorId'] ?? '',
      name: json['name'] ?? '',
      price: (json['price'] ?? 0).toDouble(),
      category: json['category'] ?? '',
      description: json['description'] ?? '',
      imageUrl: json['imageUrl'] ?? '',
      isAvailable: json['isAvailable'] ?? true,
      isVeg: json['isVeg'] ?? true,
      customizationGroups: (json['customizationGroups'] as List<dynamic>?)
              ?.map((cg) => CustomizationGroup.fromJson(cg as Map<String, dynamic>))
              .toList() ??
          [],
      rating: json['rating'] is num ? (json['rating'] as num).toDouble() : null,
      originalPrice: _promoPrice(json['originalPrice'] ?? json['compareAtPrice'], (json['price'] ?? 0).toDouble()),
      ratingCount: json['ratingCount'] is num ? (json['ratingCount'] as num).round() : null,
    );
  }
}
