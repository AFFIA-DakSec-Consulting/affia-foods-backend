import Flutter
import UIKit
import GoogleMaps

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Google Maps key comes from Info.plist (MAPS_API_KEY <- Secrets.xcconfig). Empty = no Google
    // map; the app falls back to its stylised map.
    if let key = Bundle.main.object(forInfoDictionaryKey: "MAPS_API_KEY") as? String,
       !key.trimmingCharacters(in: .whitespaces).isEmpty {
      GMSServices.provideAPIKey(key)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    // Mirror of MainActivity.kt: the Dart side asks the platform about notification settings
    // and whether a Google Maps key was built in.
    let channel = FlutterMethodChannel(
      name: "site.kraveo.customer/system",
      binaryMessenger: engineBridge.applicationRegistrar.messenger())
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "openNotificationSettings":
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
          result(false)
          return
        }
        UIApplication.shared.open(url, options: [:]) { ok in result(ok) }
      case "hasPermissionDialog":
        result(true)
      case "mapsAvailable":
        let key = Bundle.main.object(forInfoDictionaryKey: "MAPS_API_KEY") as? String ?? ""
        result(!key.trimmingCharacters(in: .whitespaces).isEmpty)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}
