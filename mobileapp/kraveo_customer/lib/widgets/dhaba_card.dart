import 'package:flutter/material.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../models/dhaba.dart';
import 'ui/dhaba_art.dart';
import 'ui/format.dart';
import 'ui/k_icon_button.dart';

/// Kitchen card: banner (photo or drawn default) with the round logo overlapping its bottom
/// edge, a status chip, favourite and ETA on the banner; name, rating, cuisine and delivery fee
/// below. [width] fixes the width for horizontal carousels; null fills the parent.
class DhabaCard extends StatelessWidget {
  final Dhaba dhaba;
  final VoidCallback onTap;
  final VoidCallback? onFavoriteToggle;
  final double? width;

  const DhabaCard({
    super.key,
    required this.dhaba,
    required this.onTap,
    this.onFavoriteToggle,
    this.width,
    this.heroTag,
  });

  /// Hero tag for the banner's flight into the menu, or null for no Hero. A kitchen can appear in
  /// several Home rows, and two Heroes with one tag on a screen is an error, so only one card per
  /// kitchen (the "Kitchens near campus" one, or the result list) passes [DhabaCard.heroTagFor].
  final String? heroTag;

  static String heroTagFor(String dhabaId) => 'dhaba-image-$dhabaId';

  /// Banner height for a card of [width] (fixed ratio so carousels line up).
  static double bannerHeight(double width) => width * 0.5;

  /// Rating from which a kitchen gets the "Top rated" chip.
  static const double topRatedFrom = 4.7;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final open = dhaba.isAcceptingOrders;
    final card = LayoutBuilder(builder: (context, box) {
      final w = width ?? box.maxWidth;
      final bannerH = bannerHeight(w);
      final (String chipLabel, IconData chipIcon, Color chipBg, Color chipFg)? chip = !open
          ? ('Fermé', LucideIcons.moon, k.surface.withValues(alpha: 0.95), k.ink)
          : dhaba.deliveryFee <= 0
              ? ('Livraison offerte', LucideIcons.package, k.cta, k.onCta)
              : dhaba.rating >= topRatedFrom
                  ? ('Top noté', LucideIcons.flame, k.cta, k.onCta)
                  : null;
      return Container(
        width: w,
        decoration: BoxDecoration(
          color: k.surface,
          borderRadius: BorderRadius.circular(KRadius.xl - 2),
          border: Border.all(color: k.line.withValues(alpha: 0.8)),
          boxShadow: KShadow.soft(k.shadowTint),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          SizedBox(
            height: bannerH + 26,
            child: Stack(clipBehavior: Clip.none, children: [
              Positioned(
                left: 0,
                right: 0,
                top: 0,
                height: bannerH,
                child: ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(KRadius.xl - 3)),
                  child: Stack(fit: StackFit.expand, children: [
                    if (heroTag != null) Hero(tag: heroTag!, child: DhabaBanner(dhaba: dhaba, grayscale: !open)) else DhabaBanner(dhaba: dhaba, grayscale: !open),
                    // Soft scrim so the chips stay readable on any photo.
                    DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [KraveoPalette.g950.withValues(alpha: 0.22), Colors.transparent, KraveoPalette.g950.withValues(alpha: 0.30)],
                          stops: const [0, 0.45, 1],
                        ),
                      ),
                    ),
                    if (chip != null)
                      Positioned(top: 10, left: 10, child: _Chip(label: chip.$1, icon: chip.$2, background: chip.$3, foreground: chip.$4)),
                    Positioned(
                      right: 10,
                      bottom: 10,
                      child: _Chip(label: dhaba.eta, icon: LucideIcons.clock, background: k.surface.withValues(alpha: 0.95), foreground: k.ink),
                    ),
                  ]),
                ),
              ),
              if (onFavoriteToggle != null)
                Positioned(
                  top: 6,
                  right: 6,
                  child: KIconButton(
                    icon: LucideIcons.heart,
                    semanticLabel: dhaba.isFavorite ? 'Retirer ${dhaba.name} des favoris' : 'Ajouter ${dhaba.name} aux favoris',
                    onTap: onFavoriteToggle,
                    background: k.surface.withValues(alpha: 0.94),
                    bordered: false,
                    color: dhaba.isFavorite ? KraveoPalette.danger : k.inkMuted,
                  ),
                ),
              // Logo overlapping the banner's bottom edge.
              Positioned(left: 14, bottom: 0, child: DhabaLogo(dhaba: dhaba, size: 56, grayscale: !open)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
                Expanded(
                  child: Text(dhaba.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.titleLg.copyWith(color: k.ink, fontSize: 17)),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: KraveoPalette.y100, borderRadius: BorderRadius.circular(KRadius.pill)),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(LucideIcons.star, size: 13, color: KraveoPalette.y700),
                    const SizedBox(width: 3),
                    Text(dhaba.rating.toStringAsFixed(1), style: KraveoType.label.copyWith(color: KraveoPalette.g950, fontSize: 12.5)),
                  ]),
                ),
              ]),
              if (dhaba.category.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(dhaba.category, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.bodySm.copyWith(color: k.inkMuted)),
              ],
              const SizedBox(height: 10),
              Row(children: [
                Icon(LucideIcons.package, size: 14, color: k.brand),
                const SizedBox(width: 5),
                Flexible(
                  child: Text(
                    dhaba.deliveryFee <= 0 ? 'Livraison offerte' : 'Livraison ${fcfa(dhaba.deliveryFee)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: KraveoType.bodySm.copyWith(color: k.ink, fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(width: 12),
                Container(width: 7, height: 7, decoration: BoxDecoration(color: open ? KraveoPalette.success : k.inkFaint, shape: BoxShape.circle)),
                const SizedBox(width: 5),
                Text(open ? 'Ouvert' : 'Fermé', style: KraveoType.bodySm.copyWith(color: open ? KraveoPalette.success : k.inkMuted, fontWeight: FontWeight.w600)),
              ]),
            ]),
          ),
        ]),
      );
    });
    return KPressable(
      onTap: onTap,
      scale: 0.98,
      semanticLabel: '${dhaba.name}, ${open ? 'ouvert' : 'fermé'}, noté ${dhaba.rating}, ${dhaba.eta}',
      child: width != null ? SizedBox(width: width, child: card) : card,
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.icon, required this.background, required this.foreground});

  final String label;
  final IconData icon;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(KRadius.pill)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 13, color: foreground),
          const SizedBox(width: 4),
          Text(label, style: KraveoType.label.copyWith(color: foreground, fontSize: 12)),
        ]),
      );
}
