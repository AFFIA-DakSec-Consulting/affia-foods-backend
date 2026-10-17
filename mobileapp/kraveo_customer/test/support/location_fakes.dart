import 'dart:async';

import 'package:customer_app/models/delivery_address.dart';
import 'package:customer_app/services/location_service.dart';

/// Scriptable [LocationService]: returns [next] (optionally after [gate] completes).
class FakeLocationService implements LocationService {
  LocationFix next = const LocationFix.ok(DeliveryAddress(lat: 14.7886, lng: -16.926, street: 'Rue 10', quartier: 'Escale', city: 'Thiès', accuracyMeters: 12));
  Completer<void>? gate;
  int locateCalls = 0;
  int appSettingsCalls = 0;
  int locationSettingsCalls = 0;

  @override
  Future<LocationFix> locate() async {
    locateCalls++;
    if (gate != null) await gate!.future;
    return next;
  }

  @override
  Future<bool> openAppSettings() async {
    appSettingsCalls++;
    return true;
  }

  @override
  Future<bool> openLocationSettings() async {
    locationSettingsCalls++;
    return true;
  }
}
