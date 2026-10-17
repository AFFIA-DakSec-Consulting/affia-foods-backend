import 'dart:io';

import 'package:customer_app/providers/session_provider.dart';
import 'package:customer_app/screens/auth_screen.dart';
import 'package:customer_app/screens/otp_code_screen.dart';
import 'package:customer_app/screens/phone_login_screen.dart';
import 'package:customer_app/screens/profile_setup_screen.dart';
import 'package:customer_app/services/customer_api_service.dart';
import 'package:customer_app/widgets/ui/phone_input.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'account_flow_test.dart' show FakeBackend, loadKraveoFonts, newSession, pumpWithProviders, reply, settle, userJson;

const _phone = '+221 771234567';

Map<String, dynamic> _sent({int resend = 45, int expires = 300}) => {
      'success': true,
      'message': 'Code sent.',
      'phone': _phone,
      'channel': 'whatsapp',
      'expiresInSeconds': expires,
      'resendAfterSeconds': resend,
    };

Map<String, dynamic> _session({bool needsProfile = true}) => {
      'success': true,
      'token': 'jwt-otp',
      'user': userJson(
          name: needsProfile ? null : 'Awa Diop',
          phone: _phone,
          email: null,
          hostel: needsProfile ? null : 'Escale',
          isStudent: null,
          avatarId: needsProfile ? null : 3),
      'isNewUser': needsProfile,
      'needsProfile': needsProfile,
    };

void main() {
  setUpAll(loadKraveoFonts);

  late FakeBackend backend;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await CustomerApiService.clearToken();
    backend = FakeBackend();
    CustomerApiService.httpClientOverride = backend.client;
    CustomerApiService.onUnauthorized = null;
  });

  tearDown(() {
    CustomerApiService.httpClientOverride = null;
    CustomerApiService.onUnauthorized = null;
  });

  group('Senegalese phone helpers', () {
    test('normalise pasted forms down to the 9 subscriber digits', () {
      expect(normalizeSenegalPhone('77 123 45 67'), '771234567');
      expect(normalizeSenegalPhone('+221 77 123 45 67'), '771234567');
      expect(normalizeSenegalPhone('221771234567'), '771234567');
      expect(normalizeSenegalPhone('00221771234567'), '771234567');
      expect(normalizeSenegalPhone('7712345678999'), '771234567');
    });

    test('validate length and the 70/75/76/77/78 prefixes; a leading 0 is refused', () {
      for (final ok in ['701234567', '751234567', '761234567', '771234567', '781234567']) {
        expect(validateSenegalMobile(ok), isNull, reason: ok);
      }
      expect(validateSenegalMobile('77123456'), isNotNull);
      expect(validateSenegalMobile('771234'), isNotNull);
      expect(validateSenegalMobile('721234567'), isNotNull);
      expect(validateSenegalMobile('071234567'), isNotNull);
      expect(validateSenegalMobile(''), isNotNull);
    });
  });

  group('CustomerApiService OTP', () {
    test('requestOtp posts the phone and parses the canonical number and timings', () async {
      backend.on('POST /auth/otp/request', (_) => reply(200, _sent(resend: 30, expires: 240)));
      final r = await CustomerApiService.requestOtp('771234567');
      expect(r.success, isTrue);
      expect(r.phone, _phone);
      expect(r.channel, 'whatsapp');
      expect(r.expiresInSeconds, 240);
      expect(r.resendAfterSeconds, 30);
      expect(backend.bodyOf(backend.requests.single), {'phone': '771234567'});
    });

    test('requestOtp failures keep the server code, field and retry delay', () async {
      backend.on('POST /auth/otp/request', (_) => reply(400, {'success': false, 'code': 'BAD_REQUEST', 'field': 'phone', 'message': 'Invalid phone'}));
      var r = await CustomerApiService.requestOtp('1');
      expect(r.success, isFalse);
      expect(r.field, 'phone');
      expect(r.message, 'Invalid phone');

      backend.on('POST /auth/otp/request', (_) => reply(403, {'success': false, 'code': 'PARTNER_ACCOUNT', 'message': 'Partner'}));
      r = await CustomerApiService.requestOtp('771234567');
      expect(r.partnerAccount, isTrue);

      backend.on('POST /auth/otp/request', (_) => reply(429, {'success': false, 'code': 'OTP_TOO_SOON', 'retryAfterSeconds': 20}));
      r = await CustomerApiService.requestOtp('771234567');
      expect(r.tooSoon, isTrue);
      expect(r.rateLimited, isTrue);
      expect(r.retryAfterSeconds, 20);

      backend.on('POST /auth/otp/request', (_) => reply(503, {'success': false, 'code': 'OTP_SEND_FAILED'}));
      r = await CustomerApiService.requestOtp('771234567');
      expect(r.unavailable, isTrue);
    });

    test('verifyOtp sends the code as text, saves the token and returns the user', () async {
      backend.on('POST /auth/otp/verify', (_) => reply(200, _session()));
      final r = await CustomerApiService.verifyOtp(_phone, '012345');
      expect(r.success, isTrue);
      expect(r.isNewUser, isTrue);
      expect(r.needsProfile, isTrue);
      expect(backend.requests.single.body, contains('"code":"012345"'));
      expect(backend.bodyOf(backend.requests.single)['phone'], _phone);
      expect(await CustomerApiService.getSavedToken(), 'jwt-otp');
    });

    test('verifyOtp failures never save a token and are told apart by code', () async {
      backend.on('POST /auth/otp/verify', (_) => reply(400, {'success': false, 'code': 'OTP_INVALID', 'message': 'Wrong'}));
      var r = await CustomerApiService.verifyOtp(_phone, '111111');
      expect(r.invalidCode, isTrue);

      backend.on('POST /auth/otp/verify', (_) => reply(429, {'success': false, 'code': 'OTP_LOCKED'}));
      r = await CustomerApiService.verifyOtp(_phone, '111111');
      expect(r.locked, isTrue);

      backend.on('POST /auth/otp/verify', (_) => reply(200, {..._session(), 'user': userJson(role: 'VENDOR')}));
      r = await CustomerApiService.verifyOtp(_phone, '111111');
      expect(r.success, isFalse);
      expect(r.partnerAccount, isTrue);
      expect(await CustomerApiService.getSavedToken(), isNull);
    });

    test('the current backend role CLIENT is a customer: verify, session restore and Google all accept it', () async {
      final client = userJson(name: 'Awa Diop', phone: _phone, email: null, hostel: 'Escale', isStudent: null, avatarId: 3, role: 'CLIENT');
      backend.on('POST /auth/otp/verify', (_) => reply(200, {..._session(needsProfile: false), 'user': client}));
      final r = await CustomerApiService.verifyOtp(_phone, '123456');
      expect(r.success, isTrue, reason: 'CLIENT is the renamed STUDENT role, not a partner');
      expect(r.partnerAccount, isFalse);
      expect(await CustomerApiService.getSavedToken(), 'jwt-otp');

      backend.on('GET /auth/profile', (_) => reply(200, {'success': true, 'user': client, 'needsProfile': false}));
      final s = newSession();
      await s.restore();
      expect(s.status, SessionStatus.signedIn, reason: 'a CLIENT token survives an app restart');

      backend.on('POST /auth/google', (_) => reply(200, {'success': true, 'token': 'jwt-g', 'user': client, 'isNewUser': false, 'needsProfile': false}));
      expect((await CustomerApiService.googleSignIn('id-token')).success, isTrue);

      backend.on('POST /auth/otp/verify', (_) => reply(200, {..._session(), 'user': userJson(role: 'VENDOR')}));
      expect((await CustomerApiService.verifyOtp(_phone, '123456')).partnerAccount, isTrue, reason: 'real partners are still refused');
    });

    test('offline is reported as a network error', () async {
      CustomerApiService.httpClientOverride = MockClient((_) async => throw const SocketException('offline'));
      final r = await CustomerApiService.requestOtp('771234567');
      expect(r.success, isFalse);
      expect(r.networkError, isTrue);
      final v = await CustomerApiService.verifyOtp(_phone, '123456');
      expect(v.networkError, isTrue);
    });
  });

  group('phone sign-in screens', () {
    Future<SessionProvider> openPhoneScreen(WidgetTester tester) async {
      final session = newSession();
      await pumpWithProviders(tester, const AuthScreen(), session: session);
      await tester.tap(find.byKey(const ValueKey('continue-with-phone')));
      await settle(tester);
      expect(find.byType(PhoneLoginScreen), findsOneWidget);
      return session;
    }

    Future<void> requestCode(WidgetTester tester, {String phone = '771234567'}) async {
      await tester.enterText(find.byKey(const ValueKey('login-phone-field')), phone);
      await tester.tap(find.widgetWithText(KButton, 'Get the code'));
      await settle(tester);
    }

    testWidgets('the welcome offers phone sign-in next to Google, without overflow', (tester) async {
      await pumpWithProviders(tester, const AuthScreen());
      expect(find.text('Continue with phone number'), findsOneWidget);
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an invalid number is refused on the spot and nothing is sent', (tester) async {
      await openPhoneScreen(tester);
      expect(find.text('+221'), findsOneWidget);
      await requestCode(tester, phone: '721234567');
      expect(find.textContaining('start with 70, 75, 76, 77 or 78'), findsOneWidget);
      await requestCode(tester, phone: '7712');
      expect(find.textContaining('9-digit'), findsOneWidget);
      expect(backend.requests, isEmpty);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a valid number opens the code screen with the canonical number', (tester) async {
      backend.on('POST /auth/otp/request', (_) => reply(200, _sent()));
      await openPhoneScreen(tester);
      await requestCode(tester, phone: '+221 77 123 45 67');
      expect(backend.bodyOf(backend.requests.single), {'phone': '771234567'});
      expect(find.byType(OtpCodeScreen), findsOneWidget);
      expect(find.textContaining(_phone), findsOneWidget);
      expect(find.byKey(const ValueKey('code-expiry')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('server refusals show a message and keep the student on the number screen', (tester) async {
      backend.on('POST /auth/otp/request', (_) => reply(403, {'success': false, 'code': 'PARTNER_ACCOUNT', 'message': 'Use the partner app.'}));
      await openPhoneScreen(tester);
      await requestCode(tester);
      expect(find.text('Use the partner app.'), findsOneWidget);
      expect(find.byType(OtpCodeScreen), findsNothing);

      backend.on('POST /auth/otp/request', (_) => reply(503, {'success': false, 'code': 'OTP_SEND_FAILED'}));
      await requestCode(tester);
      expect(find.textContaining('try again in a moment'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('"code sent a moment ago" goes straight to the code screen', (tester) async {
      backend.on('POST /auth/otp/request', (_) => reply(429, {'success': false, 'code': 'OTP_TOO_SOON', 'retryAfterSeconds': 20}));
      await openPhoneScreen(tester);
      await requestCode(tester);
      expect(find.byType(OtpCodeScreen), findsOneWidget);
      expect(find.textContaining('+221 771234567'), findsOneWidget);
      expect(find.text('Resend the code in 20s'), findsOneWidget);
    });

    testWidgets('a development backend (console sender) code is shown in debug builds and fills the boxes', (tester) async {
      backend.on('POST /auth/otp/request', (_) => reply(200, {..._sent(), 'channel': 'console', 'debugCode': '482913'}));
      backend.on('POST /auth/otp/verify', (_) => reply(200, _session()));
      final session = await openPhoneScreen(tester);
      await requestCode(tester);
      expect(find.textContaining('482913'), findsOneWidget);
      await tester.tap(find.textContaining('482913'));
      await settle(tester);
      expect(backend.bodyOf(backend.to('POST /auth/otp/verify').single), {'phone': _phone, 'code': '482913'});
      expect(session.status, SessionStatus.signedIn);
    });

    testWidgets('a correct code signs in, closes the login screens and goes straight to Home (no sign-up)', (tester) async {
      backend.on('POST /auth/otp/request', (_) => reply(200, _sent()));
      backend.on('POST /auth/otp/verify', (_) => reply(200, _session()));
      final session = await openPhoneScreen(tester);
      await requestCode(tester);
      await tester.enterText(find.byType(EditableText).first, '123456');
      await settle(tester);
      expect(backend.bodyOf(backend.to('POST /auth/otp/verify').single), {'phone': _phone, 'code': '123456'});
      expect(session.status, SessionStatus.signedIn, reason: 'even though the server says needsProfile');
      expect(session.user?.phone, _phone);
      expect(find.byType(OtpCodeScreen), findsNothing);
      expect(find.byType(PhoneLoginScreen), findsNothing);
      expect(await CustomerApiService.getSavedToken(), 'jwt-otp');
    });

    testWidgets('a phone account still incomplete on the server opens Home again after a restart', (tester) async {
      await CustomerApiService.saveToken('jwt-otp');
      backend.on('GET /auth/profile', (_) => reply(200, {'success': true, 'user': userJson(name: 'Client', phone: _phone, email: null, isStudent: null, hostel: null, avatarId: null, role: 'CLIENT'), 'needsProfile': true}));
      final s = newSession();
      await s.restore();
      expect(s.status, SessionStatus.signedIn);
    });

    testWidgets('a complete profile goes straight in', (tester) async {
      backend.on('POST /auth/otp/request', (_) => reply(200, _sent()));
      backend.on('POST /auth/otp/verify', (_) => reply(200, _session(needsProfile: false)));
      final session = await openPhoneScreen(tester);
      await requestCode(tester);
      await tester.enterText(find.byType(EditableText).first, '123456');
      await settle(tester);
      expect(session.status, SessionStatus.signedIn);
    });

    testWidgets('a wrong code explains itself, clears the boxes and keeps the screen', (tester) async {
      backend.on('POST /auth/otp/request', (_) => reply(200, _sent()));
      backend.on('POST /auth/otp/verify', (_) => reply(400, {'success': false, 'code': 'OTP_INVALID', 'message': 'x'}));
      final session = await openPhoneScreen(tester);
      await requestCode(tester);
      await tester.enterText(find.byType(EditableText).first, '000000');
      await settle(tester);
      expect(find.textContaining('Incorrect or expired code'), findsOneWidget);
      expect(find.byType(OtpCodeScreen), findsOneWidget);
      expect(session.status, SessionStatus.signedOut);
      expect(await CustomerApiService.getSavedToken(), isNull);
      expect(tester.widget<EditableText>(find.byType(EditableText).first).controller.text, isEmpty);
    });

    testWidgets('resend is greyed out until the delay passes, then asks for a new code', (tester) async {
      var sends = 0;
      backend.on('POST /auth/otp/request', (_) {
        sends++;
        return reply(200, _sent(resend: 3));
      });
      await openPhoneScreen(tester);
      await requestCode(tester);
      expect(sends, 1);
      TextButton resend() => tester.widget<TextButton>(find.byKey(const ValueKey('resend-code')));
      expect(resend().onPressed, isNull);
      expect(find.textContaining('Resend the code in'), findsOneWidget);

      await tester.pump(const Duration(seconds: 4));
      expect(find.text('Resend the code'), findsOneWidget);
      expect(resend().onPressed, isNotNull);
      await tester.tap(find.byKey(const ValueKey('resend-code')));
      await settle(tester);
      expect(sends, 2);
      expect(find.text('A new code is on its way.'), findsOneWidget);
      expect(resend().onPressed, isNull, reason: 'the delay starts again');
    });

    testWidgets('five wrong tries lock the code and allow requesting a new one at once', (tester) async {
      backend.on('POST /auth/otp/request', (_) => reply(200, _sent()));
      backend.on('POST /auth/otp/verify', (_) => reply(429, {'success': false, 'code': 'OTP_LOCKED'}));
      await openPhoneScreen(tester);
      await requestCode(tester);
      await tester.enterText(find.byType(EditableText).first, '999999');
      await settle(tester);
      expect(find.textContaining('request a new code'), findsOneWidget);
      expect(tester.widget<TextButton>(find.byKey(const ValueKey('resend-code'))).onPressed, isNotNull);
    });

    testWidgets('the countdown ends with an expired message', (tester) async {
      backend.on('POST /auth/otp/request', (_) => reply(200, _sent(resend: 1, expires: 2)));
      await openPhoneScreen(tester);
      await requestCode(tester);
      expect(find.textContaining('expires in'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      expect(find.textContaining('has expired'), findsOneWidget);
    });
  });

  group('sign-up after a phone login', () {
    testWidgets('the verified number is not asked for again', (tester) async {
      final session = newSession()
        ..beginForTest(userJson(name: null, phone: _phone, email: null, hostel: null, isStudent: null, avatarId: null), needsProfile: true);
      await pumpWithProviders(tester, const ProfileSetupScreen(), session: session);
      expect(find.byKey(const ValueKey('name-field')), findsOneWidget);
      expect(find.byKey(const ValueKey('phone-field')), findsNothing);
      expect(find.text('MOBILE NUMBER'), findsNothing);
      await tester.enterText(find.byKey(const ValueKey('name-field')), 'Awa Diop');
      await tester.tap(find.widgetWithText(KButton, 'Continue'));
      await settle(tester);
      expect(find.textContaining('student?'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
