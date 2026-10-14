import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'google_tracking_map_view.dart';
import 'map_view.dart';

/// The production [MapViewFactory]: the real Google map, but only when the native side
/// (MainActivity.kt / AppDelegate.swift) reports that a Maps key was built into this app (and,
/// on Android, that Google Play services are installed).
///
/// Anything else (no key, no Play services, a test, desktop) answers "not available" and
/// the tracking screen shows the stylised map without ever creating a platform view.
class GoogleMapViewFactory extends MapViewFactory {
  const GoogleMapViewFactory();

  static const MethodChannel _channel = MethodChannel('site.kraveo.customer/system');
  static Future<bool>? _cached;

  @override
  Future<bool> isAvailable() {
    if (kIsWeb || (defaultTargetPlatform != TargetPlatform.android && defaultTargetPlatform != TargetPlatform.iOS)) return Future.value(false);
    return _cached ??= _ask();
  }

  static Future<bool> _ask() async {
    try {
      return (await _channel.invokeMethod<bool>('mapsAvailable')) == true;
    } catch (_) {
      return false; // MissingPluginException in tests, or any platform error
    }
  }

  @override
  Widget build(BuildContext context, MapViewSpec spec) => GoogleTrackingMapView(spec: spec);

  /// Test helper: forget the cached answer.
  @visibleForTesting
  static void resetCache() => _cached = null;
}
