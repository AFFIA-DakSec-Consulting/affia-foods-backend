import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:forui/forui.dart';
import 'package:kraveo_ui/kraveo_ui.dart';

/// Forui theme built from the Kraveo tokens, so forui widgets (buttons, badges...) speak the
/// same royal blue / gold / cream language as the rest of the app. Primary = gold CTA.
FThemeData kraveoForuiTheme(KraveoTokens k) => FThemeData(
      touch: true,
      debugLabel: 'Kraveo Customer',
      colors: FColors(
        brightness: k.isDark ? Brightness.dark : Brightness.light,
        systemOverlayStyle: k.isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
        barrier: const Color(0x33000000),
        background: k.bg,
        foreground: k.ink,
        primary: k.cta,
        primaryForeground: k.onCta,
        secondary: k.brandSoft,
        secondaryForeground: k.brand,
        muted: k.surfaceAlt,
        mutedForeground: k.inkMuted,
        destructive: KraveoPalette.danger,
        destructiveForeground: Colors.white,
        error: KraveoPalette.danger,
        errorForeground: Colors.white,
        card: k.surface,
        border: k.line,
      ),
      // Plain family name: forui merges its styles into the Material text theme, which already
      // carries the `kraveo_ui` package, so a `packages/...` prefix here would be applied twice.
      typography: FTypography(fontFamily: 'Jakarta'),
    );

/// Scopes the Kraveo forui theme to [child].
class KForui extends StatelessWidget {
  const KForui({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => FTheme(data: kraveoForuiTheme(context.k), child: child);
}
