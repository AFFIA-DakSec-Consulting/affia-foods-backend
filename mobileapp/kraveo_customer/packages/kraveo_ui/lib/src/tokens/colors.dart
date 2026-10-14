import 'package:flutter/material.dart';

/// Raw brand palette. Royal blue + gold yellow.
/// Variable names (g*, y*) kept from the previous green palette so no screen needs refactoring.
/// Screens should NOT use these directly - read semantic roles via `context.k`.
class KraveoPalette {
  KraveoPalette._();

  // Royal blue ramp (brand = 800)
  static const g50 = Color(0xFFEEF2FE);
  static const g100 = Color(0xFFE0E7FD);
  static const g200 = Color(0xFFC2D0FB);
  static const g300 = Color(0xFF93ACF5);
  static const g400 = Color(0xFF5F84EC);
  static const g500 = Color(0xFF2F5BE0);
  static const g600 = Color(0xFF2A4FCF);
  static const g700 = Color(0xFF2549BD);
  static const g800 = Color(0xFF1C3A9A); // brand
  static const g900 = Color(0xFF142A73);
  static const g950 = Color(0xFF0C1A4A);

  // Gold yellow ramp (brand = 400)
  static const y100 = Color(0xFFFDF1CC);
  static const y200 = Color(0xFFFBDB7D);
  static const y300 = Color(0xFFF8C93F);
  static const y400 = Color(0xFFF5B70A); // brand
  static const y500 = Color(0xFFD99E00);
  static const y700 = Color(0xFF7A5800);

  // Warm neutrals (light)
  static const cream = Color(0xFFFBF8F1);
  static const paper = Color(0xFFFFFFFF);
  static const sand = Color(0xFFF2ECDF);
  static const line = Color(0xFFE6E1D5);
  static const ink = Color(0xFF141A30);
  static const ink2 = Color(0xFF474D64);
  static const ink3 = Color(0xFF7B8095);

  // Blue-black neutrals (dark)
  static const nightBg = Color(0xFF070A14);
  static const nightSurface = Color(0xFF0F1424);
  static const nightSurface2 = Color(0xFF181E33);
  static const nightLine = Color(0xFF252C45);
  static const nightInk = Color(0xFFF3F5FA);
  static const nightInk2 = Color(0xFFB3B9CC);
  static const nightInk3 = Color(0xFF7B829A);

  // CTA (primary buttons) - gold yellow with navy text. Never white text on yellow.
  static const cta = y400;
  static const ctaPressed = y500;
  static const ctaDisabled = y100;
  static const onCta = g950;
  static const onCtaDisabled = y700;

  // Semantic
  // success is no longer the brand ramp (blue would not read as "success").
  static const success = Color(0xFF16A34A);
  static const warning = Color(0xFFEA7A0B); // orange, distinct from the gold brand yellow
  static const danger = Color(0xFFE5484D);
  static const info = g500;
}

/// One status colour language shared by every Kraveo surface (apps + dashboard).
enum KStatus { placed, accepted, preparing, ready, pickedUp, atGate, delivered, cancelled }

extension KStatusX on KStatus {
  Color get color => switch (this) {
    KStatus.placed => const Color(0xFFF5B70A),
    KStatus.accepted => const Color(0xFF14B8A6),
    KStatus.preparing => const Color(0xFFF97316),
    KStatus.ready => const Color(0xFF84CC16),
    KStatus.pickedUp => const Color(0xFF2F5BE0),
    KStatus.atGate => const Color(0xFF8B5CF6),
    KStatus.delivered => const Color(0xFF16A34A),
    KStatus.cancelled => const Color(0xFFE5484D),
  };

  String get label => switch (this) {
    KStatus.placed => 'Placed',
    KStatus.accepted => 'Accepted',
    KStatus.preparing => 'Preparing',
    KStatus.ready => 'Ready',
    KStatus.pickedUp => 'On the way',
    KStatus.atGate => 'At gate',
    KStatus.delivered => 'Delivered',
    KStatus.cancelled => 'Cancelled',
  };

  /// Tolerant parser for backend strings (PLACED, READY_FOR_PICKUP, ARRIVED_AT_GATE ...).
  static KStatus parse(String raw) {
    final s = raw.toUpperCase().replaceAll(' ', '_');
    if (s.contains('CANCEL')) return KStatus.cancelled;
    if (s.contains('DELIVERED')) return KStatus.delivered;
    if (s.contains('GATE')) return KStatus.atGate;
    if (s.contains('PICKED') || s.contains('TRANSIT') || s.contains('WAY')) return KStatus.pickedUp;
    if (s.contains('READY')) return KStatus.ready;
    if (s.contains('PREPAR')) return KStatus.preparing;
    if (s.contains('ACCEPT') || s.contains('ASSIGN')) return KStatus.accepted;
    return KStatus.placed;
  }
}