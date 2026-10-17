import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import '../models/auth_results.dart';
import '../providers/session_provider.dart';
import '../widgets/ui/display_text.dart';
import '../widgets/ui/error_line.dart';
import '../widgets/ui/k_icon_button.dart';
import '../widgets/ui/otp_boxes.dart';

/// Phone sign-in, step 2: the 6-digit code. [phone] is the canonical number the server returned
/// from /auth/otp/request and goes back to /auth/otp/verify unchanged. The code is only ever sent
/// to verify; it is never stored or logged.
class OtpCodeScreen extends StatefulWidget {
  const OtpCodeScreen({super.key, required this.phone, this.resendAfterSeconds = 45, this.expiresInSeconds = 300, this.debugCode});

  static const int codeLength = 6;

  final String phone;
  final int resendAfterSeconds;
  final int expiresInSeconds;

  /// Code returned by a development backend (console sender). Shown in debug builds only.
  final String? debugCode;

  @override
  State<OtpCodeScreen> createState() => _OtpCodeScreenState();
}

class _OtpCodeScreenState extends State<OtpCodeScreen> {
  final _code = TextEditingController();
  Timer? _ticker;
  late int _expiresIn = widget.expiresInSeconds;
  late int _resendIn = widget.resendAfterSeconds;
  bool _verifying = false;
  bool _resending = false;
  String? _error;
  String? _info;
  int _errorTick = 0;
  late String? _debugCode = widget.debugCode;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (_expiresIn == 0 && _resendIn == 0) return;
      setState(() {
        if (_expiresIn > 0) _expiresIn--;
        if (_resendIn > 0) _resendIn--;
      });
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _code.dispose();
    super.dispose();
  }

  bool get _busy => _verifying || _resending;

  void _fail(String message) {
    _code.clear();
    setState(() {
      _error = message;
      _info = null;
      _errorTick++;
    });
  }

  Future<void> _verify() async {
    final code = _code.text;
    if (_busy || code.length != OtpCodeScreen.codeLength) return;
    setState(() {
      _verifying = true;
      _error = null;
    });
    final result = await context.read<SessionProvider>().verifyOtp(widget.phone, code);
    if (!mounted) return;
    if (result.success) {
      // AuthGate now shows sign-up or Home; close the login screens that sit above it.
      Navigator.of(context).popUntil((route) => route.isFirst);
      return;
    }
    setState(() => _verifying = false);
    if (result.locked) _resendIn = 0; // five wrong tries: only a new code helps
    _fail(_verifyMessage(result));
  }

  static String _verifyMessage(OtpVerifyResult r) {
    if (r.networkError) return 'We couldn\'t reach Kraveo. Check your connection and try again.';
    if (r.partnerAccount) return r.message ?? 'This number belongs to a Kraveo partner. Please use the partner app.';
    if (r.locked) return 'Too many wrong tries. Please request a new code.';
    if (r.invalidCode) return 'Incorrect or expired code. Check it, or request a new one.';
    if (r.field == 'code') return r.message ?? 'Enter the 6-digit code.';
    if (r.rateLimited) return r.message ?? 'Too many attempts. Please wait a moment and try again.';
    if (r.unavailable || (r.statusCode != null && r.statusCode! >= 500)) return 'Kraveo is unavailable right now. Please try again in a little while.';
    return r.message ?? 'We couldn\'t verify the code. Please try again.';
  }

  Future<void> _resend() async {
    if (_busy || _resendIn > 0) return;
    setState(() {
      _resending = true;
      _error = null;
      _info = null;
    });
    final result = await context.read<SessionProvider>().requestOtp(widget.phone);
    if (!mounted) return;
    setState(() => _resending = false);
    if (result.success) {
      _code.clear();
      setState(() {
        _expiresIn = result.expiresInSeconds;
        _resendIn = result.resendAfterSeconds;
        _debugCode = result.debugCode ?? _debugCode;
        _info = 'A new code is on its way.';
      });
      return;
    }
    if (result.tooSoon || result.rateLimited) {
      final wait = result.retryAfterSeconds;
      if (wait != null) setState(() => _resendIn = wait);
    }
    final String message;
    if (result.networkError) {
      message = 'We couldn\'t reach Kraveo. Check your connection and try again.';
    } else if (result.partnerAccount) {
      message = result.message ?? 'This number belongs to a Kraveo partner. Please use the partner app.';
    } else if (result.unavailable) {
      message = 'We couldn\'t send the code. Please try again in a moment.';
    } else {
      message = result.message ?? 'We couldn\'t send a new code. Please try again.';
    }
    setState(() => _error = message);
  }

  static String _mmss(int seconds) => '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final expired = _expiresIn == 0;
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
                  child: KIconButton(icon: LucideIcons.arrowLeft, semanticLabel: 'Back', onTap: _verifying ? null : () => Navigator.of(context).maybePop()),
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(KSpace.gutter, 20, KSpace.gutter, 16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    KDisplayText('Enter the\n6-digit code', style: KraveoType.displayMd.copyWith(color: k.ink)),
                    const SizedBox(height: 10),
                    Text('Sent on WhatsApp to ${widget.phone}.', style: KraveoType.body.copyWith(color: k.inkMuted)),
                    const SizedBox(height: 28),
                    OtpBoxes(
                      key: const ValueKey('login-code-boxes'),
                      controller: _code,
                      length: OtpCodeScreen.codeLength,
                      boxHeight: 60,
                      enabled: !_verifying,
                      hasError: _error != null,
                      errorTick: _errorTick,
                      onChanged: (_) {
                        if (_error != null) setState(() => _error = null);
                      },
                      onCompleted: (_) => _verify(),
                    ),
                    KErrorLine(message: _error),
                    // Development backends send nothing (console sender): show the code they returned.
                    if (kDebugMode && _debugCode != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: KPressable(
                          onTap: () {
                            _code.text = _debugCode!;
                            _verify();
                          },
                          semanticLabel: 'Code de développement ${_debugCode!}, toucher pour l\'utiliser',
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(color: k.brandSoft, borderRadius: BorderRadius.circular(KRadius.md)),
                            child: Row(children: [
                              Icon(LucideIcons.bug, size: 16, color: k.brand),
                              const SizedBox(width: 8),
                              Expanded(child: Text('Dev : code ${_debugCode!} (toucher pour l\'utiliser)', style: KraveoType.bodySm.copyWith(color: k.brand, fontWeight: FontWeight.w700))),
                            ]),
                          ),
                        ),
                      ),
                    if (_info != null && _error == null)
                      Padding(padding: const EdgeInsets.only(top: 10), child: Text(_info!, style: KraveoType.bodySm.copyWith(color: k.inkMuted))),
                    const SizedBox(height: 18),
                    Text(
                      expired ? 'This code has expired. Request a new one.' : 'The code expires in ${_mmss(_expiresIn)}.',
                      key: const ValueKey('code-expiry'),
                      style: KraveoType.bodySm.copyWith(color: k.inkMuted),
                    ),
                    const SizedBox(height: 6),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton(
                        key: const ValueKey('resend-code'),
                        onPressed: _busy || _resendIn > 0 ? null : _resend,
                        child: Text(_resending ? 'Sending…' : (_resendIn > 0 ? 'Resend the code in ${_resendIn}s' : 'Resend the code')),
                      ),
                    ),
                  ]),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(KSpace.gutter, 8, KSpace.gutter, 20),
                child: AnimatedBuilder(
                  animation: _code,
                  builder: (_, __) => KButton(
                    label: 'Verify',
                    loading: _verifying,
                    onPressed: _code.text.length == OtpCodeScreen.codeLength && !_resending ? _verify : null,
                  ),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
