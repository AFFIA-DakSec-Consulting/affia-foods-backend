import 'package:flutter/material.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../models/dhaba.dart';
import '../models/menu_item.dart';
import 'ui/dhaba_art.dart';
import 'ui/food_emoji.dart';
import 'ui/format.dart';
import 'ui/k_image.dart';

export 'ui/food_emoji.dart' show categoryEmoji;

/// One entry of the category rail: a big emoji with its label underneath (Yassir style, no
/// tile). The selected one pops a little and its label turns brand blue with a small bar.
class CategoryTile extends StatelessWidget {
  const CategoryTile({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    // "All" is the provider's id for no category; shown in French.
    final display = label == 'All' ? 'Tout' : label;
    return KPressable(
      onTap: onTap,
      semanticLabel: '$display${selected ? ', sélectionné' : ''}',
      child: SizedBox(
        width: 70,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          AnimatedScale(
            scale: selected ? 1.1 : 1,
            duration: KMotion.base,
            curve: KMotion.spring,
            child: SizedBox(
              height: 34,
              child: Center(child: ExcludeSemantics(child: Text(categoryEmoji(label), style: const TextStyle(fontSize: 27, height: 1)))),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            display,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: KraveoType.label.copyWith(color: selected ? k.brand : k.ink, fontSize: 13, letterSpacing: 0, fontWeight: selected ? FontWeight.w800 : FontWeight.w600),
          ),
          const SizedBox(height: 4),
          AnimatedContainer(
            duration: KMotion.base,
            curve: KMotion.emphasized,
            width: selected ? 22 : 0,
            height: 3,
            decoration: BoxDecoration(color: k.brand, borderRadius: BorderRadius.circular(KRadius.pill)),
          ),
        ]),
      ),
    );
  }
}

/// Outlined filter pill ("Sort by ⌄", "Open now"...). Selected = soft brand fill.
class FilterPill extends StatelessWidget {
  const FilterPill({super.key, required this.label, required this.onTap, this.icon, this.selected = false, this.dropdown = false});

  final String label;
  final IconData? icon;
  final bool selected;
  final bool dropdown;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final fg = selected ? k.brand : k.ink;
    return KPressable(
      onTap: onTap,
      semanticLabel: '$label${selected ? ', activé' : ''}',
      child: AnimatedContainer(
        duration: KMotion.base,
        curve: KMotion.emphasized,
        height: 34,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          color: selected ? k.brandSoft : k.surface,
          borderRadius: BorderRadius.circular(KRadius.pill),
          border: Border.all(color: selected ? k.brand : k.line, width: selected ? 1.6 : 1.3),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: 13, color: fg), const SizedBox(width: 5)],
          Text(label, style: KraveoType.bodySm.copyWith(color: fg, fontWeight: FontWeight.w600)),
          if (dropdown) ...[const SizedBox(width: 6), Icon(LucideIcons.chevronDown, size: 13, color: fg)],
        ]),
      ),
    );
  }
}

/// Round outlined arrow button used at the end of section headers.
class SectionArrow extends StatelessWidget {
  const SectionArrow({super.key, required this.onTap, required this.semanticLabel});

  final VoidCallback onTap;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return KPressable(
      onTap: onTap,
      semanticLabel: semanticLabel,
      child: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(color: k.surface, shape: BoxShape.circle, border: Border.all(color: k.line, width: 1.3)),
        child: Icon(LucideIcons.arrowRight, size: 17, color: k.brand),
      ),
    );
  }
}

/// "Brown's Food / Items selected for you →": a kitchen's round logo, name and arrow.
class KitchenSectionHeader extends StatelessWidget {
  const KitchenSectionHeader({super.key, required this.dhaba, required this.onOpen});

  final Dhaba dhaba;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Padding(
      padding: const EdgeInsets.fromLTRB(KSpace.gutter, 28, KSpace.gutter, 14),
      child: Row(children: [
        DhabaLogo(dhaba: dhaba, size: 52, ring: 2),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(dhaba.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.titleLg.copyWith(color: k.ink)),
            const SizedBox(height: 2),
            Text('Sélectionnés pour vous', maxLines: 1, style: KraveoType.body.copyWith(color: k.inkMuted)),
          ]),
        ),
        const SizedBox(width: 10),
        SectionArrow(onTap: onOpen, semanticLabel: 'Ouvrir ${dhaba.name}'),
      ]),
    );
  }
}

/// Square dish photo with a round "+" on it, name and price below. [quantity] > 0 swaps the
/// "+" for the count already in the cart.
class DishTile extends StatelessWidget {
  const DishTile({super.key, required this.item, required this.onAdd, required this.onOpen, this.quantity = 0, this.caption});

  final MenuItemModel item;
  final VoidCallback onAdd;
  final VoidCallback onOpen;
  final int quantity;

  /// Small line under the price (the kitchen's name in mixed rows).
  final String? caption;

  static const double size = 128;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return SizedBox(
      width: size,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Stack(children: [
          KPressable(
            onTap: onOpen,
            scale: 0.97,
            semanticLabel: '${item.name}, ${fcfa(item.price)}',
            child: Container(
              width: size,
              height: size,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: k.surface,
                borderRadius: BorderRadius.circular(KRadius.md),
                border: Border.all(color: k.line.withValues(alpha: 0.9)),
              ),
              child: KImage(item.imageUrl),
            ),
          ),
          Positioned(
            right: 6,
            bottom: 6,
            child: KPressable(
              onTap: onAdd,
              semanticLabel: 'Ajouter ${item.name} au panier',
              child: AnimatedContainer(
                duration: KMotion.base,
                curve: KMotion.spring,
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: quantity > 0 ? k.cta : k.surface,
                  shape: BoxShape.circle,
                  boxShadow: KShadow.soft(k.shadowTint),
                ),
                child: AnimatedSwitcher(
                  duration: KMotion.fast,
                  transitionBuilder: (c, a) => ScaleTransition(scale: CurvedAnimation(parent: a, curve: KMotion.spring), child: c),
                  child: quantity > 0
                      ? Text('$quantity', key: ValueKey(quantity), style: KraveoType.titleMd.copyWith(color: k.onCta))
                      : Icon(LucideIcons.plus, key: const ValueKey('plus'), size: 18, color: k.brand),
                ),
              ),
            ),
          ),
        ]),
        const SizedBox(height: 10),
        Text(item.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.titleMd.copyWith(color: k.ink, fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text(fcfa(item.price), style: KraveoType.titleMd.copyWith(color: k.ink)),
        if (caption != null) ...[
          const SizedBox(height: 2),
          Text(caption!, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.bodySm.copyWith(color: k.inkMuted)),
        ],
      ]),
    );
  }
}

/// Header of a themed row: title with its emoji, a "Right now" tag when it is the moment of the
/// day, and a one-line subtitle.
class CollectionHeader extends StatelessWidget {
  const CollectionHeader({super.key, required this.title, required this.emoji, required this.subtitle, this.highlight});

  final String title;
  final String emoji;
  final String subtitle;
  final String? highlight;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Padding(
      padding: const EdgeInsets.fromLTRB(KSpace.gutter, 30, KSpace.gutter, 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (highlight != null) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: BoxDecoration(color: k.brand, borderRadius: BorderRadius.circular(KRadius.pill)),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Container(width: 6, height: 6, decoration: BoxDecoration(color: k.cta, shape: BoxShape.circle)),
              const SizedBox(width: 6),
              Text(highlight!.toUpperCase(), style: KraveoType.caption.copyWith(color: k.onBrand, fontSize: 10, letterSpacing: 0.9)),
            ]),
          ),
          const SizedBox(height: 8),
        ],
        Text.rich(
          TextSpan(children: [
            TextSpan(text: '$title '),
            TextSpan(text: emoji, style: const TextStyle(fontSize: 22)),
          ]),
          style: KraveoType.headlineSm.copyWith(color: k.ink),
        ),
        const SizedBox(height: 2),
        Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.bodySm.copyWith(color: k.inkMuted)),
      ]),
    );
  }
}
