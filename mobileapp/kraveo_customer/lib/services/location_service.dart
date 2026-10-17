import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart' show Locale;
import 'package:geocoding/geocoding.dart' as geo;
import 'package:geolocator/geolocator.dart';

import '../models/delivery_address.dart';

/// Why a location attempt did not give an address.
enum LocationOutcome { ok, denied, deniedForever, serviceOff, failed }

class LocationFix {
  const LocationFix.ok(DeliveryAddress this.address) : outcome = LocationOutcome.ok;
  const LocationFix.fail(this.outcome) : address = null;

  final LocationOutcome outcome;
  final DeliveryAddress? address;
}

/// The phone's location, turned into a readable address. Real implementation:
/// [DeviceLocationService]; tests use a fake from `test/support/location_fakes.dart`.
abstract class LocationService {
  /// Asks for permission if needed, reads the position and reverse-geocodes it.
  /// Never throws: every problem comes back as a [LocationFix.fail].
  Future<LocationFix> locate();

  /// Opens this app's settings page (after a permanent "Don't allow").
  Future<bool> openAppSettings();

  /// Opens the system location settings (location turned off).
  Future<bool> openLocationSettings();
}

class DeviceLocationService implements LocationService {
  DeviceLocationService({geo.Geocoding? geocoding}) : _geocoding = geocoding ?? geo.Geocoding(locale: const Locale('fr', 'SN'));

  final geo.Geocoding _geocoding;

  @override
  Future<LocationFix> locate() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return const LocationFix.fail(LocationOutcome.serviceOff);
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.deniedForever) return const LocationFix.fail(LocationOutcome.deniedForever);
      if (permission == LocationPermission.denied || permission == LocationPermission.unableToDetermine) {
        return const LocationFix.fail(LocationOutcome.denied);
      }

      Position? position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
        );
      } on TimeoutException {
        position = await Geolocator.getLastKnownPosition();
      }
      if (position == null) return const LocationFix.fail(LocationOutcome.failed);
      return LocationFix.ok(await _describe(position));
    } catch (e) {
      debugPrint('[Location] locate failed: ${e.runtimeType}');
      return const LocationFix.fail(LocationOutcome.failed);
    }
  }

  /// Reverse geocoding is best effort: without it the address is just the coordinates.
  Future<DeliveryAddress> _describe(Position p) async {
    String? street, quartier, city;
    try {
      final marks = await _geocoding.placemarkFromCoordinates(p.latitude, p.longitude).timeout(const Duration(seconds: 10));
      if (marks.isNotEmpty) {
        final m = marks.first;
        final road = DeliveryAddress.clean(m.thoroughfare);
        final number = DeliveryAddress.clean(m.subThoroughfare);
        street = road != null ? (number != null ? '$number $road' : road) : DeliveryAddress.clean(m.street) ?? DeliveryAddress.clean(m.name);
        quartier = DeliveryAddress.clean(m.subLocality);
        city = DeliveryAddress.clean(m.locality) ?? DeliveryAddress.clean(m.subAdministrativeArea);
      }
    } catch (e) {
      debugPrint('[Location] reverse geocoding failed: ${e.runtimeType}');
    }
    return DeliveryAddress(
      lat: p.latitude,
      lng: p.longitude,
      street: street,
      quartier: quartier,
      city: city,
      accuracyMeters: p.accuracy,
      updatedAt: DateTime.now(),
    );
  }

  @override
  Future<bool> openAppSettings() async {
    try {
      return await Geolocator.openAppSettings();
    } catch (_) {
      return false;
    }
  }

  @override
  Future<bool> openLocationSettings() async {
    try {
      return await Geolocator.openLocationSettings();
    } catch (_) {
      return false;
    }
  }
}
