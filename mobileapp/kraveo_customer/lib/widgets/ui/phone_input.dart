import 'package:flutter/services.dart';

/// Digits-only formatter for a 10-digit Indian mobile field. Pasting "+91 98765 43210",
/// "919876543210" or "09876543210" keeps just the 10 subscriber digits.
class IndianPhoneInputFormatter extends TextInputFormatter {
  const IndianPhoneInputFormatter();

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final text = normalizeIndianPhone(newValue.text);
    if (text == newValue.text) return newValue;
    return TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
  }
}

/// Strips formatting and a leading country code / trunk zero, capped at 10 digits.
String normalizeIndianPhone(String raw) {
  var digits = raw.replaceAll(RegExp(r'\D'), '');
  if (digits.length > 10 && digits.startsWith('91')) {
    digits = digits.substring(2);
  } else if (digits.length > 10 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  return digits.length > 10 ? digits.substring(0, 10) : digits;
}

/// Returns a user-facing problem with [phone], or null when it is a plausible Indian mobile.
String? validateIndianMobile(String phone) {
  if (!RegExp(r'^\d{10}$').hasMatch(phone)) return 'Enter your 10-digit Indian mobile number.';
  if (!RegExp(r'^[6-9]').hasMatch(phone)) return 'Indian mobile numbers start with 6, 7, 8 or 9.';
  return null;
}

/// Digits-only formatter for a 9-digit Senegalese mobile field (the +221 is shown separately).
/// Pasting "+221 77 123 45 67", "221771234567" or "00221771234567" keeps the 9 subscriber digits.
class SenegalPhoneInputFormatter extends TextInputFormatter {
  const SenegalPhoneInputFormatter();

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final text = normalizeSenegalPhone(newValue.text);
    if (text == newValue.text) return newValue;
    return TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
  }
}

/// Strips formatting and a leading 00221 / 221 country code, capped at 9 digits. A leading 0 is
/// kept (the server refuses it, so validation tells the student).
String normalizeSenegalPhone(String raw) {
  var digits = raw.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('00221') && digits.length > 9) {
    digits = digits.substring(5);
  } else if (digits.startsWith('221') && digits.length > 9) {
    digits = digits.substring(3);
  }
  return digits.length > 9 ? digits.substring(0, 9) : digits;
}

/// Returns a user-facing problem with [phone] (9 digits), or null when it is a Senegalese mobile
/// (starts with 70, 75, 76, 77 or 78).
String? validateSenegalMobile(String phone) {
  if (!RegExp(r'^\d{9}$').hasMatch(phone)) return 'Enter your 9-digit mobile number.';
  if (!RegExp(r'^7[05678]').hasMatch(phone)) return 'Mobile numbers start with 70, 75, 76, 77 or 78.';
  return null;
}
