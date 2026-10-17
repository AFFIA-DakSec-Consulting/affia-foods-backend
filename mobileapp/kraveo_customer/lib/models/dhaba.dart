import 'geo.dart';
import 'opening_hours.dart';
import 'restaurant_promo.dart';

class Dhaba {
  final String id;
  final String name;
  final String category;
  final double rating;
  final String eta;
  final String bannerUrl;

  /// Restaurant logo (`logoUrl`, optional on the server). Empty = the app draws a default one.
  final String logoUrl;
  final bool isAcceptingOrders;
  final String address;
  final double deliveryFee;
  final double minOrder;
  final bool isFavorite;
  final List<String> tags;

  /// Short presentation written by the restaurant (`description`), empty when not set.
  final String description;

  /// Weekly opening hours, or null when the restaurant never set them.
  final OpeningHours? openingHours;

  /// Number of ratings behind [rating] (`totalRatingsCount`), 0 when unknown.
  final int ratingsCount;

  /// Where the restaurant is (`lat` / `lng`), or null.
  final GeoPoint? location;

  /// Promotions published by the restaurant (`promotions`, not sent by the API yet).
  final List<RestaurantPromo> promotions;

  Dhaba({
    required this.id,
    required this.name,
    required this.category,
    required this.rating,
    required this.eta,
    required this.bannerUrl,
    this.logoUrl = '',
    required this.isAcceptingOrders,
    required this.address,
    this.deliveryFee = 25.0,
    this.minOrder = 99.0,
    this.isFavorite = false,
    this.tags = const [],
    this.description = '',
    this.openingHours,
    this.ratingsCount = 0,
    this.location,
    this.promotions = const [],
  });

  Dhaba copyWith({
    String? id,
    String? name,
    String? category,
    double? rating,
    String? eta,
    String? bannerUrl,
    String? logoUrl,
    bool? isAcceptingOrders,
    String? address,
    double? deliveryFee,
    double? minOrder,
    bool? isFavorite,
    List<String>? tags,
  }) {
    return Dhaba(
      id: id ?? this.id,
      name: name ?? this.name,
      category: category ?? this.category,
      rating: rating ?? this.rating,
      eta: eta ?? this.eta,
      bannerUrl: bannerUrl ?? this.bannerUrl,
      logoUrl: logoUrl ?? this.logoUrl,
      isAcceptingOrders: isAcceptingOrders ?? this.isAcceptingOrders,
      address: address ?? this.address,
      deliveryFee: deliveryFee ?? this.deliveryFee,
      minOrder: minOrder ?? this.minOrder,
      isFavorite: isFavorite ?? this.isFavorite,
      tags: tags ?? this.tags,
      description: description,
      openingHours: openingHours,
      ratingsCount: ratingsCount,
      location: location,
      promotions: promotions,
    );
  }

  factory Dhaba.fromJson(Map<String, dynamic> json) {
    return Dhaba(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      category: json['category'] ?? '',
      rating: (json['rating'] ?? 4.5).toDouble(),
      eta: json['eta'] ?? '25-30 mins',
      bannerUrl: json['bannerImage'] ?? json['bannerUrl'] ?? '',
      logoUrl: json['logoUrl'] is String ? json['logoUrl'] as String : '',
      isAcceptingOrders: json['isAcceptingOrders'] ?? true,
      address: json['address'] ?? '',
      deliveryFee: (json['deliveryFee'] ?? 25.0).toDouble(),
      minOrder: (json['minOrder'] ?? 99.0).toDouble(),
      isFavorite: json['isFavorite'] ?? false,
      tags: (json['tags'] as List<dynamic>?)?.map((t) => t.toString()).toList() ?? [],
      description: json['description'] is String ? (json['description'] as String).trim() : '',
      openingHours: OpeningHours.fromJson(json['openingHours']),
      ratingsCount: json['totalRatingsCount'] is num ? (json['totalRatingsCount'] as num).round() : 0,
      promotions: RestaurantPromo.listFromJson(json['promotions']),
      location: json['lat'] is num && json['lng'] is num ? GeoPoint((json['lat'] as num).toDouble(), (json['lng'] as num).toDouble()) : null,
    );
  }
}
