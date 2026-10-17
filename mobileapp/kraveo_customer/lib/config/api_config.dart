class ApiConfig {
  static const bool isProduction = false;

  /// Development backend host (currently the hosted dev server, plain http on sslip.io, so the
  /// simulator and a physical phone both reach it). Override at launch, e.g. the Mac on the Wi-Fi:
  /// `flutter run --dart-define=API_HOST=http://192.168.1.3:5001` (or `http://localhost:5001`).
  static const String _localHost = String.fromEnvironment('API_HOST', defaultValue: 'http://s598n3mrwe6p76b2bv2exazh.192.162.70.47.sslip.io');

  static const String _localBaseUrl = '$_localHost/api';
  // REST and Socket.IO both go through the dedicated HTTPS API hostname.
  static const String _productionBaseUrl = 'https://api.kraveo.site/api';

  static String get baseUrl => isProduction ? _productionBaseUrl : _localBaseUrl;

  static const String _localSocketUrl = _localHost;
  static const String _productionSocketUrl = 'https://api.kraveo.site';

  static String get socketUrl => isProduction ? _productionSocketUrl : _localSocketUrl;

  /// Optional Web OAuth client id for Google Sign-In, passed as `serverClientId`.
  /// On Android the plugin reads it from google-services.json (`default_web_client_id`), so this
  /// only needs to be set when that file has no web client:
  /// `--dart-define=GOOGLE_SERVER_CLIENT_ID=xxxx.apps.googleusercontent.com`.
  static const String googleServerClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');
}
