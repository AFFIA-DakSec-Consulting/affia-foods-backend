import 'dart:async';

import 'package:flutter/material.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../models/dhaba.dart';
import '../models/menu_item.dart';
import '../providers/cart_provider.dart';
import '../providers/dhaba_provider.dart';
import '../providers/session_provider.dart';
import '../widgets/add_to_cart.dart';
import '../widgets/cart_sheet.dart';
import '../widgets/dhaba_card.dart';
import '../widgets/home_sections.dart';
import '../widgets/ui/floating_bar.dart';
import '../widgets/ui/format.dart';
import '../widgets/ui/k_icon_button.dart';
import '../widgets/ui/k_image.dart';
import 'dhaba_menu_screen.dart';

/// Full-screen search opened from the bottom bar's pill: suggestions while empty, then the
/// matching kitchens and dishes (dishes can be added straight to the cart).
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _set(String q) {
    _controller.value = TextEditingValue(text: q, selection: TextSelection.collapsed(offset: q.length));
    setState(() => _query = q);
  }

  static bool _has(String text, String q) => text.toLowerCase().contains(q);

  List<Dhaba> _kitchens(DhabaProvider p, String q) => [
        for (final d in p.allDhabas)
          if (_has(d.name, q) ||
              _has(d.category, q) ||
              d.tags.any((t) => _has(t, q)) ||
              p.getMenuItemsForDhaba(d.id).any((i) => _has(i.name, q) || _has(i.category, q)))
            d,
      ];

  List<(MenuItemModel, Dhaba)> _dishes(DhabaProvider p, String q) => [
        for (final d in p.allDhabas)
          for (final i in p.getMenuItemsForDhaba(d.id))
            if (i.isAvailable && (_has(i.name, q) || _has(i.category, q))) (i, d),
      ].take(30).toList();

  void _openKitchen(Dhaba d) {
    final hostel = context.read<SessionProvider>().deliveryPoint;
    Navigator.push(context, MaterialPageRoute(builder: (_) => DhabaMenuScreen(dhaba: d, selectedHostel: hostel)));
  }

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final p = context.watch<DhabaProvider>();
    final cart = context.watch<CartProvider>();
    final q = _query.trim().toLowerCase();
    final kitchens = q.isEmpty ? const <Dhaba>[] : _kitchens(p, q);
    final dishes = q.isEmpty ? const <(MenuItemModel, Dhaba)>[] : _dishes(p, q);
    final suggestions = [for (final c in p.categories) if (c != 'All') c];
    final showCart = cart.itemCount > 0;

    return Scaffold(
      backgroundColor: k.bg,
      body: SafeArea(
        child: Stack(children: [
          Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, KSpace.gutter, 8),
              child: Row(children: [
                KIconButton(icon: LucideIcons.arrowLeft, semanticLabel: 'Retour', onTap: () => Navigator.of(context).maybePop(), bordered: false),
                const SizedBox(width: 4),
                Expanded(
                  child: TextField(
                    key: const ValueKey('search-field'),
                    controller: _controller,
                    autofocus: true,
                    textInputAction: TextInputAction.search,
                    onChanged: (v) => setState(() => _query = v),
                    decoration: InputDecoration(
                      hintText: 'Rechercher restaurants, plats…',
                      prefixIcon: Icon(LucideIcons.search, size: 20, color: k.ink),
                      suffixIcon: _query.isEmpty
                          ? null
                          : IconButton(tooltip: 'Effacer', icon: Icon(LucideIcons.x, size: 18, color: k.inkMuted), onPressed: () => _set('')),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(KRadius.pill), borderSide: BorderSide(color: k.line)),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(KRadius.pill), borderSide: BorderSide(color: k.line, width: 1.3)),
                      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(KRadius.pill), borderSide: BorderSide(color: k.brand, width: 1.6)),
                    ),
                  ),
                ),
              ]),
            ),
            Expanded(
              child: q.isEmpty
                  ? ListView(
                      padding: const EdgeInsets.fromLTRB(KSpace.gutter, 12, KSpace.gutter, 24),
                      children: [
                        if (suggestions.isNotEmpty) ...[
                          Text('Envies du moment', style: KraveoType.titleLg.copyWith(color: k.ink)),
                          const SizedBox(height: 12),
                          Wrap(spacing: 8, runSpacing: 10, children: [
                            for (final c in suggestions)
                              KPressable(
                                onTap: () => _set(c),
                                semanticLabel: 'Rechercher $c',
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                                  decoration: BoxDecoration(color: k.surface, borderRadius: BorderRadius.circular(KRadius.pill), border: Border.all(color: k.line)),
                                  child: Text('${categoryEmoji(c)}  $c', style: KraveoType.bodySm.copyWith(color: k.ink, fontWeight: FontWeight.w600)),
                                ),
                              ),
                          ]),
                        ],
                      ],
                    )
                  : (kitchens.isEmpty && dishes.isEmpty)
                      ? ListView(children: [
                          KEmptyState(
                            icon: LucideIcons.searchX,
                            title: 'Aucun résultat',
                            message: 'Rien ne correspond à « ${_query.trim()} ». Essayez un autre mot, par exemple un plat ou une cuisine.',
                          ),
                        ])
                      : ListView(
                          padding: EdgeInsets.fromLTRB(KSpace.gutter, 8, KSpace.gutter, showCart ? 110 : 24),
                          children: [
                            if (kitchens.isNotEmpty) ...[
                              _Heading('Restaurants', kitchens.length),
                              for (final d in kitchens)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 16),
                                  child: DhabaCard(dhaba: d, onTap: () => _openKitchen(d), onFavoriteToggle: () => p.toggleFavorite(d.id)),
                                ),
                            ],
                            if (dishes.isNotEmpty) ...[
                              _Heading('Plats', dishes.length),
                              for (final (item, d) in dishes)
                                _DishRow(
                                  item: item,
                                  dhaba: d,
                                  quantity: cart.hasRestaurant(d.id) ? cart.getItemQuantityInCart(item.id) : 0,
                                  onOpen: () => _openKitchen(d),
                                  onAdd: () => unawaited(addDishToCart(context, cart: cart, dhaba: p.byId(d.id) ?? d, item: item)),
                                ),
                            ],
                          ],
                        ),
            ),
          ]),
          Positioned(
            left: 0,
            right: 0,
            bottom: 12,
            child: KBarSwitcher(
              visible: showCart,
              child: showCart
                  ? KCartBar(cart: cart, onTap: () => CartSheet.show(context, selectedHostel: context.read<SessionProvider>().deliveryPoint))
                  : const SizedBox.shrink(),
            ),
          ),
        ]),
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.title, this.count);

  final String title;
  final int count;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 12),
      child: Row(children: [
        Text(title, style: KraveoType.headlineSm.copyWith(color: k.ink)),
        const SizedBox(width: 8),
        Text('$count', style: KraveoType.titleMd.copyWith(color: k.inkMuted)),
      ]),
    );
  }
}

class _DishRow extends StatelessWidget {
  const _DishRow({required this.item, required this.dhaba, required this.quantity, required this.onOpen, required this.onAdd});

  final MenuItemModel item;
  final Dhaba dhaba;
  final int quantity;
  final VoidCallback onOpen;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return KPressable(
      onTap: onOpen,
      semanticLabel: '${item.name}, ${fcfa(item.price)}, chez ${dhaba.name}',
      child: Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Row(children: [
          Container(
            width: 72,
            height: 72,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(KRadius.md), border: Border.all(color: k.line)),
            child: KImage(item.imageUrl),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(item.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.titleMd.copyWith(color: k.ink)),
              const SizedBox(height: 2),
              Text(dhaba.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.bodySm.copyWith(color: k.inkMuted)),
              const SizedBox(height: 4),
              Text(fcfa(item.price), style: KraveoType.titleMd.copyWith(color: k.brand)),
            ]),
          ),
          const SizedBox(width: 10),
          KPressable(
            onTap: onAdd,
            semanticLabel: 'Ajouter ${item.name} au panier',
            child: Container(
              width: 38,
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: quantity > 0 ? k.cta : k.surface,
                shape: BoxShape.circle,
                border: Border.all(color: quantity > 0 ? k.cta : k.line, width: 1.3),
              ),
              child: quantity > 0
                  ? Text('$quantity', style: KraveoType.titleMd.copyWith(color: k.onCta))
                  : Icon(LucideIcons.plus, size: 18, color: k.brand),
            ),
          ),
        ]),
      ),
    );
  }
}
