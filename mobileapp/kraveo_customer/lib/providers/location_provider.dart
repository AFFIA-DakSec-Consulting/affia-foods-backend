import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/delivery_address.dart';
import '../services/location_service.dart';

enum LocationStatus { idle, locating, ready, denied, deniedForever, serviceOff, failed }

/// The delivery address found by geolocation. Home locates automatically on first show; the
/// last address is kept on the phone so the header is filled at once on the next launch, then
/// refreshed. (Saving it on the server comes with the API change.)
class DeliveryLocationProvider with ChangeNotifier {
  DeliveryLocationProvider({required LocationService service, bool restoreSaved = true}) : _service = service {
    if (restoreSaved) unawaited(_restore());
  }

  static const String _prefKey = 'kraveo_delivery_address';

  final LocationService _service;
  LocationStatus _status = LocationStatus.idle;
  DeliveryAddress? _address;
  Future<void>? _inFlight;

  LocationStatus get status => _status;
  DeliveryAddress? get address => _address;
  bool get isLocating => _status == LocationStatus.locating;

  /// Locates once per app run (Home calls this on every show; only the first one does work).
  Future<void> ensureLocated() {
    if (_status != LocationStatus.idle) return Future.value();
    return locate();
  }

  /// Reads the position now. Concurrent calls share one attempt. A failure keeps the last
  /// known address on screen.
  Future<void> locate() => _inFlight ??= _locate().whenComplete(() => _inFlight = null);

  Future<void> _locate() async {
    _status = LocationStatus.locating;
    notifyListeners();
    final fix = await _service.locate();
    final found = fix.address;
    if (found != null) {
      _address = found;
      _status = LocationStatus.ready;
      unawaited(_save(found));
    } else {
      _status = switch (fix.outcome) {
        LocationOutcome.denied => LocationStatus.denied,
        LocationOutcome.deniedForever => LocationStatus.deniedForever,
        LocationOutcome.serviceOff => LocationStatus.serviceOff,
        _ => LocationStatus.failed,
      };
    }
    notifyListeners();
  }

  Future<bool> openAppSettings() => _service.openAppSettings();
  Future<bool> openLocationSettings() => _service.openLocationSettings();

  /// Sign-out: forget the address (another student may use this phone).
  void resetForLogout() {
    _address = null;
    _status = LocationStatus.idle;
    unawaited(_clear());
    notifyListeners();
  }

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_prefKey);
      if (raw == null || _address != null) return;
      final saved = DeliveryAddress.fromJson(jsonDecode(raw));
      if (saved == null) return;
      _address = saved;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> _save(DeliveryAddress a) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, jsonEncode(a.toJson()));
    } catch (_) {}
  }

  Future<void> _clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_prefKey);
    } catch (_) {}
  }
}
