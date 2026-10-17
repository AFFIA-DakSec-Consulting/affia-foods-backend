/// Where the student is, as found by the phone's location: coordinates plus a readable
/// address (street, quartier, city) from reverse geocoding. Any text part may be missing.
class DeliveryAddress {
  const DeliveryAddress({
    required this.lat,
    required this.lng,
    this.street,
    this.quartier,
    this.city,
    this.accuracyMeters,
    this.updatedAt,
  });

  final double lat;
  final double lng;
  final String? street;

  /// Neighbourhood (`subLocality`), e.g. "Escale" or "Randoulène".
  final String? quartier;
  final String? city;
  final double? accuracyMeters;
  final DateTime? updatedAt;

  /// Google-style plus codes ("8QJ2+7F") are not addresses a person reads.
  static final RegExp _plusCode = RegExp(r'^[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}\b');

  static String? clean(String? raw) {
    final v = raw?.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (v == null || v.isEmpty || v.toLowerCase() == 'unnamed road' || _plusCode.hasMatch(v)) return null;
    return v;
  }

  /// Main line: the street, else the quartier, else the city.
  String get title => street ?? quartier ?? city ?? 'Position actuelle';

  /// Second line: quartier and city not already in [title].
  String get subtitle {
    final parts = <String>[];
    for (final p in [quartier, city]) {
      if (p != null && p != title && !parts.contains(p)) parts.add(p);
    }
    return parts.join(', ');
  }

  Map<String, dynamic> toJson() => {
        'lat': lat,
        'lng': lng,
        if (street != null) 'street': street,
        if (quartier != null) 'quartier': quartier,
        if (city != null) 'city': city,
        if (accuracyMeters != null) 'accuracy': accuracyMeters,
        if (updatedAt != null) 'updatedAt': updatedAt!.toIso8601String(),
      };

  /// Null when the stored value is unusable (no valid coordinates).
  static DeliveryAddress? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final lat = raw['lat'];
    final lng = raw['lng'];
    if (lat is! num || lng is! num || lat.abs() > 90 || lng.abs() > 180) return null;
    final acc = raw['accuracy'];
    return DeliveryAddress(
      lat: lat.toDouble(),
      lng: lng.toDouble(),
      street: clean(raw['street']?.toString()),
      quartier: clean(raw['quartier']?.toString()),
      city: clean(raw['city']?.toString()),
      accuracyMeters: acc is num ? acc.toDouble() : null,
      updatedAt: DateTime.tryParse('${raw['updatedAt'] ?? ''}'),
    );
  }
}
