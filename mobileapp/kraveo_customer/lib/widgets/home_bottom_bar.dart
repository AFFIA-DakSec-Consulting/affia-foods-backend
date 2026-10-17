import 'package:flutter/material.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

/// Yassir-style bottom bar: the cart (with its item count) on the left, a search pill in the
/// middle, favourites on the right. All three share one height, border and fill so they line up
/// exactly. Orders and tracking are reached from the profile and from the active-order bar.
class HomeBottomBar extends StatelessWidget {
  const HomeBottomBar({
    super.key,
    required this.cartCount,
    required this.onCart,
    required this.onSearch,
    required this.onFavourites,
    this.favouritesOn = false,
  });

  final int cartCount;
  final VoidCallback onCart;
  final VoidCallback onSearch;
  final VoidCallback onFavourites;
  final bool favouritesOn;

  /// Height of every control in the bar.
  static const double controlHeight = 38;

  /// Height of the white fade painted above the bar.
  static const double fadeHeight = 28;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final bar = DecoratedBox(
      decoration: BoxDecoration(
        color: k.surface,
        // No hard line: a soft shadow lifts the bar off the page (Yassir style).
        boxShadow: [
          BoxShadow(color: k.shadowTint.withValues(alpha: 0.07), blurRadius: 24, offset: const Offset(0, -6)),
          BoxShadow(color: k.shadowTint.withValues(alpha: 0.04), blurRadius: 4, offset: const Offset(0, -1)),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(KSpace.gutter, 14, KSpace.gutter, 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
            _CartButton(count: cartCount, onTap: onCart),
            const SizedBox(width: 10),
            Expanded(
              child: KPressable(
                onTap: onSearch,
                scale: 0.98,
                semanticLabel: 'Rechercher des restaurants ou des plats',
                child: Container(
                  height: controlHeight,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: _controlDecoration(k),
                  child: Row(children: [
                    Icon(LucideIcons.search, size: 15, color: k.ink),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Un plat, un restaurant…',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: KraveoType.bodySm.copyWith(color: k.inkMuted, fontSize: 13),
                      ),
                    ),
                  ]),
                ),
              ),
            ),
            const SizedBox(width: 10),
            _RoundButton(
              semanticLabel: favouritesOn ? 'Afficher tous les restaurants' : 'Afficher mes favoris',
              onTap: onFavourites,
              active: favouritesOn,
              activeColor: KraveoPalette.danger,
              child: Icon(LucideIcons.heart, size: 16, color: favouritesOn ? KraveoPalette.danger : k.ink),
            ),
          ]),
        ),
      ),
    );
    // The page fades into the bar: a short white gradient just above it, so cards scrolling
    // underneath soften instead of being cut by an edge.
    return Stack(clipBehavior: Clip.none, children: [
      Positioned(
        left: 0,
        right: 0,
        top: -fadeHeight,
        height: fadeHeight,
        child: IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [k.surface.withValues(alpha: 0), k.surface.withValues(alpha: 0.85)],
              ),
            ),
          ),
        ),
      ),
      bar,
    ]);
  }
}

BoxDecoration _controlDecoration(KraveoTokens k, {Color? border, Color? fill}) => BoxDecoration(
      color: fill ?? k.bg,
      borderRadius: BorderRadius.circular(KRadius.pill),
      border: Border.all(color: border ?? k.line, width: 1.3),
    );

/// Circle of the bar's height with the same border and fill as the search pill.
class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.semanticLabel, required this.onTap, required this.child, this.active = false, this.activeColor});

  final String semanticLabel;
  final VoidCallback onTap;
  final Widget child;
  final bool active;
  final Color? activeColor;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final on = activeColor ?? k.brand;
    return KPressable(
      onTap: onTap,
      semanticLabel: semanticLabel,
      child: AnimatedContainer(
        duration: KMotion.base,
        curve: KMotion.emphasized,
        width: HomeBottomBar.controlHeight,
        height: HomeBottomBar.controlHeight,
        alignment: Alignment.center,
        decoration: _controlDecoration(k, border: active ? on : null, fill: active ? on.withValues(alpha: 0.10) : null),
        child: child,
      ),
    );
  }
}

/// The cart: a bag in the same circle, with the number of items in a gold bubble that pops
/// each time it changes.
class _CartButton extends StatelessWidget {
  const _CartButton({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return SizedBox(
      width: HomeBottomBar.controlHeight,
      height: HomeBottomBar.controlHeight,
      child: Stack(clipBehavior: Clip.none, children: [
        _RoundButton(
          semanticLabel: count == 0 ? 'Panier vide' : 'Panier, $count article${count == 1 ? '' : 's'}',
          onTap: onTap,
          active: count > 0,
          child: Icon(LucideIcons.shoppingCart, size: 16, color: count > 0 ? k.brand : k.ink),
        ),
        Positioned(
          top: -5,
          right: -5,
          child: IgnorePointer(
            child: AnimatedScale(
              scale: count > 0 ? 1 : 0,
              duration: KMotion.base,
              curve: KMotion.spring,
              child: AnimatedSwitcher(
                duration: KMotion.fast,
                transitionBuilder: (c, a) => ScaleTransition(scale: CurvedAnimation(parent: a, curve: KMotion.spring), child: c),
                child: Container(
                  key: ValueKey(count),
                  constraints: const BoxConstraints(minWidth: 16),
                  height: 16,
                  padding: const EdgeInsets.symmetric(horizontal: 5),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: k.cta,
                    borderRadius: BorderRadius.circular(KRadius.pill),
                    border: Border.all(color: k.surface, width: 2),
                  ),
                  child: Text(
                    count > 99 ? '99+' : '$count',
                    style: KraveoType.caption.copyWith(color: k.onCta, fontSize: 9.5, fontWeight: FontWeight.w800, height: 1),
                  ),
                ),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}
