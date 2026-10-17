import 'package:flutter/material.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import '../models/auth_results.dart';
import '../providers/session_provider.dart';
import '../widgets/ui/display_text.dart';
import '../widgets/ui/error_line.dart';
import '../widgets/ui/k_icon_button.dart';
import '../widgets/ui/phone_input.dart';
import 'otp_code_screen.dart';

/// Phone sign-in, step 1: the student types their mobile number and asks for a code. The code
/// arrives by WhatsApp; [OtpCodeScreen] takes it from there.
class PhoneLoginScreen extends StatefulWidget {
  const PhoneLoginScreen({super.key});

  @override
  State<PhoneLoginScreen> createState() => _PhoneLoginScreenState();
}

class _PhoneLoginScreenState extends State<PhoneLoginScreen> {
  final _phone = TextEditingController();
  final _focus = FocusNode();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _focus.dispose();
    super.dispose();
  }

  String get _digits => normalizeSenegalPhone(_phone.text);

  Future<void> _openCodeScreen(String phone, {required int resendAfter, required int expiresIn, String? debugCode}) async {
    await Navigator.of(context).push<void>(MaterialPageRoute<void>(
      builder: (_) => OtpCodeScreen(phone: phone, resendAfterSeconds: resendAfter, expiresInSeconds: expiresIn, debugCode: debugCode),
    ));
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _send() async {
    if (_busy) return;
    final problem = validateSenegalMobile(_digits);
    if (problem != null) {
      setState(() => _error = problem);
      _focus.requestFocus();
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await context.read<SessionProvider>().requestOtp(_digits);
    if (!mounted) return;
    if (result.success) {
      await _openCodeScreen(result.phone!, resendAfter: result.resendAfterSeconds, expiresIn: result.expiresInSeconds, debugCode: result.debugCode);
      return;
    }
    // A code was sent a moment ago: the code screen is where the student should be.
    if (result.tooSoon) {
      await _openCodeScreen('+221 $_digits', resendAfter: result.retryAfterSeconds ?? 45, expiresIn: 300);
      return;
    }
    setState(() {
      _busy = false;
      _error = _failureMessage(result);
    });
  }

  static String _failureMessage(OtpRequestResult r) {
    if (r.networkError) return 'We couldn\'t reach Kraveo. Check your connection and try again.';
    if (r.partnerAccount) return r.message ?? 'This number belongs to a Kraveo partner. Please use the partner app.';
    if (r.rateLimited) {
      final wait = r.retryAfterSeconds;
      return r.message ?? 'Too many codes requested.${wait == null ? '' : ' Try again in ${_wait(wait)}.'}';
    }
    if (r.unavailable || (r.statusCode != null && r.statusCode! >= 500)) return 'We couldn\'t send the code. Please try again in a moment.';
    return r.message ?? 'We couldn\'t send the code. Please try again.';
  }

  static String _wait(int seconds) => seconds >= 90 ? '${(seconds / 60).ceil()} minutes' : '$seconds seconds';

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Scaffold(
      backgroundColor: k.bg,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(KSpace.gutter, 12, KSpace.gutter, 0),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: KIconButton(icon: LucideIcons.arrowLeft, semanticLabel: 'Back', onTap: _busy ? null : () => Navigator.of(context).maybePop()),
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(KSpace.gutter, 20, KSpace.gutter, 16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    KDisplayText('What\'s your\nmobile number?', style: KraveoType.displayMd.copyWith(color: k.ink)),
                    const SizedBox(height: 10),
                    Text('We\'ll send you a 6-digit code on WhatsApp.', style: KraveoType.body.copyWith(color: k.inkMuted)),
                    const SizedBox(height: 28),
                    TextField(
                      key: const ValueKey('login-phone-field'),
                      controller: _phone,
                      focusNode: _focus,
                      autofocus: true,
                      enabled: !_busy,
                      keyboardType: TextInputType.phone,
                      textInputAction: TextInputAction.done,
                      autofillHints: const [AutofillHints.telephoneNumberNational],
                      inputFormatters: const [SenegalPhoneInputFormatter()],
                      style: KraveoType.titleLg.copyWith(color: k.ink, letterSpacing: 1),
                      onChanged: (_) {
                        if (_error != null) setState(() => _error = null);
                      },
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        hintText: '77 123 45 67',
                        prefixIcon: Padding(
                          padding: const EdgeInsets.only(left: 18, right: 10),
                          child: Row(mainAxisSize: MainAxisSize.min, children: [
                            Text('+221', style: KraveoType.titleLg.copyWith(color: k.inkMuted)),
                            const SizedBox(width: 10),
                            Container(width: 1.4, height: 24, color: k.line),
                          ]),
                        ),
                        prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
                        enabledBorder: _error != null ? OutlineInputBorder(borderRadius: KRadius.control, borderSide: const BorderSide(color: KraveoPalette.danger, width: 1.6)) : null,
                      ),
                    ),
                    KErrorLine(message: _error),
                  ]),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(KSpace.gutter, 8, KSpace.gutter, 20),
                child: KButton(label: 'Get the code', icon: LucideIcons.messageCircle, loading: _busy, onPressed: _send),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
