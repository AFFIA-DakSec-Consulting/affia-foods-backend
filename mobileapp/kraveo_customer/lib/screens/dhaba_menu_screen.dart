import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import '../models/dhaba.dart';
import '../models/geo.dart';
import '../models/menu_item.dart';
import '../models/opening_hours.dart';
import '../models/restaurant_promo.dart';
import '../providers/cart_provider.dart';
import '../providers/dhaba_provider.dart';
import '../providers/location_provider.dart';
import '../providers/order_provider.dart';
import '../widgets/add_to_cart.dart';
import '../widgets/cart_sheet.dart';
import '../widgets/dhaba_card.dart';
import '../widgets/ui/add_stepper.dart';
import '../widgets/ui/dhaba_art.dart';
import '../widgets/ui/floating_bar.dart';
import '../widgets/ui/format.dart';
import '../widgets/ui/k_icon_button.dart';
import '../widgets/ui/k_image.dart';
import '../widgets/ui/sheet_chrome.dart';
import '../widgets/ui/snack.dart';
import '../widgets/ui/veg_mark.dart';

/// A restaurant's page: banner, logo and key facts, then the menu grouped by category with
/// sticky tabs that follow the scroll (tap a tab to jump to its section). The search hides
/// behind a small icon in the tab bar.
class DhabaMenuScreen extends StatefulWidget {
  final Dhaba dhaba;

  /// Saved drop-off point; null when none is chosen yet (checkout asks).
  final String? selectedHostel;

  const DhabaMenuScreen({
    super.key,
    required this.dhaba,
    required this.selectedHostel,
  });

  @override
  State<DhabaMenuScreen> createState() => _DhabaMenuScreenState();
}

class _DhabaMenuScreenState extends State<DhabaMenuScreen> {
  static const double _heroHeight = 230;
  static const double _tabsHeight = 54;
  static const String _popular = 'Les plus aimés';
  static const String _promos = 'Promos';

  final ScrollController _scroll = ScrollController();
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocus = FocusNode();
  final Map<String, GlobalKey> _sectionKeys = {};
  final Map<String, GlobalKey> _tabKeys = {};

  bool _searching = false;
  String _query = '';
  String? _current;

  /// True while a tab tap scrolls the page, so the scroll spy does not fight it.
  bool _jumping = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    // Opening a menu refreshes the catalog: open / closed and sold-out dishes may have changed
    // since Home last loaded it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(context.read<DhabaProvider>().loadCatalog());
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    _searchController.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  /// The kitchen as the catalog says right now (it may have closed since the card was tapped).
  Dhaba get _dhaba => context.read<DhabaProvider>().byId(widget.dhaba.id) ?? widget.dhaba;

  /// Adds an item with the shared cart rules (closed kitchen, other restaurant, options).
  Future<void> _addItem(CartProvider cart, MenuItemModel item) => addDishToCart(context, cart: cart, dhaba: _dhaba, item: item);

  void _removeOne(CartProvider cart, MenuItemModel item) {
    final matching = cart.items.where((i) => i.item.id == item.id);
    if (matching.isNotEmpty) cart.decrementItem(matching.last.cartItemId);
  }

  /// Bottom of the pinned area (status bar + collapsed bar + tabs), in global coordinates.
  double get _pinnedBottom => MediaQuery.paddingOf(context).top + kToolbarHeight + _tabsHeight;

  GlobalKey _sectionKey(String c) => _sectionKeys.putIfAbsent(c, () => GlobalKey(debugLabel: 'section-$c'));
  GlobalKey _tabKey(String c) => _tabKeys.putIfAbsent(c, () => GlobalKey(debugLabel: 'tab-$c'));

  double? _topOf(GlobalKey key) {
    final box = key.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.attached) return null;
    return box.localToGlobal(Offset.zero).dy;
  }

  bool _spyScheduled = false;

  /// Scroll spy, run after the frame so the section positions match the new scroll offset (during
  /// the scroll notification they are still those of the previous frame).
  void _onScroll() {
    if (_spyScheduled) return;
    _spyScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _spyScheduled = false;
      if (mounted) _spy();
    });
  }

  /// The current tab is the last section whose title has reached the tabs.
  void _spy() {
    if (_jumping || _searching) return;
    String? current;
    for (final entry in _sectionKeys.entries) {
      final top = _topOf(entry.value);
      if (top != null && top <= _pinnedBottom + 12) current = entry.key;
    }
    current ??= _sectionKeys.keys.isEmpty ? null : _sectionKeys.keys.first;
    // At the very bottom the last sections can never reach the tabs. Keep the tab the student
    // picked if its section is on screen, otherwise the last section is current.
    if (_scroll.hasClients && _scroll.offset >= _scroll.position.maxScrollExtent - 4 && _sectionKeys.isNotEmpty) {
      final picked = _current == null ? null : _topOf(_sectionKey(_current!));
      final viewportBottom = MediaQuery.sizeOf(context).height;
      current = picked != null && picked < viewportBottom ? _current : _sectionKeys.keys.last;
    }
    if (current != _current) {
      setState(() => _current = current);
      _revealTab(current);
    }
  }

  /// Centres the current tab in the tab row. Only the row scrolls: `Scrollable.ensureVisible`
  /// would also scroll the page itself (the tabs are pinned, so it would jump back to the top).
  void _revealTab(String? category) {
    final ctx = category == null ? null : _tabKeys[category]?.currentContext;
    final box = ctx?.findRenderObject();
    if (ctx == null || box == null) return;
    final row = Scrollable.maybeOf(ctx);
    if (row == null || row.position.axis != Axis.horizontal) return;
    unawaited(row.position.ensureVisible(box, alignment: 0.5, duration: KMotion.base, curve: KMotion.emphasized));
  }

  Future<void> _jumpTo(String category) async {
    final top = _topOf(_sectionKey(category));
    setState(() => _current = category);
    _revealTab(category);
    if (top == null || !_scroll.hasClients) return;
    final target = (_scroll.offset + top - _pinnedBottom - 4).clamp(0.0, _scroll.position.maxScrollExtent);
    _jumping = true;
    await _scroll.animateTo(target, duration: KMotion.slow, curve: KMotion.emphasized);
    _jumping = false;
  }

  void _toggleSearch() {
    setState(() {
      _searching = !_searching;
      if (!_searching) {
        _searchController.clear();
        _query = '';
      }
    });
    if (_searching) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _searchFocus.requestFocus());
    } else {
      FocusScope.of(context).unfocus();
    }
  }

  void _toggleFavourite(DhabaProvider provider, Dhaba dhaba) {
    provider.toggleFavorite(dhaba.id);
    showKSnack(
      context,
      dhaba.isFavorite ? '${dhaba.name} retiré de vos favoris' : '${dhaba.name} ajouté à vos favoris',
      icon: LucideIcons.heart,
    );
  }

  /// Menu sections in the menu's own order; sold-out dishes go to the end of their section.
  /// A "Les plus aimés" section comes first when the dishes have ratings.
  List<(String, List<MenuItemModel>)> _sections(List<MenuItemModel> items) {
    final order = <String>[];
    final byCategory = <String, List<MenuItemModel>>{};
    for (final i in items) {
      final c = i.category.trim().isEmpty ? 'Autres' : i.category.trim();
      if (!byCategory.containsKey(c)) order.add(c);
      byCategory.putIfAbsent(c, () => []).add(i);
    }
    final sections = [
      for (final c in order) (c, [...byCategory[c]!.where((i) => i.isAvailable), ...byCategory[c]!.where((i) => !i.isAvailable)]),
    ];
    final rated = [
      for (final i in items)
        if (i.isAvailable && (i.ratingCount ?? 0) > 0) i
    ]..sort((a, b) => (b.ratingCount ?? 0).compareTo(a.ratingCount ?? 0));
    if (rated.length >= 2 && sections.length > 1) sections.insert(0, (_popular, rated.take(3).toList()));
    final promos = [
      for (final i in items)
        if (i.isAvailable && i.onPromo) i
    ]..sort((a, b) => b.discountPercent.compareTo(a.discountPercent));
    if (promos.isNotEmpty) sections.insert(0, (_promos, promos));
    return sections;
  }

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final dhabaProvider = Provider.of<DhabaProvider>(context);
    final cart = Provider.of<CartProvider>(context);
    final dhaba = dhabaProvider.byId(widget.dhaba.id) ?? widget.dhaba;
    final allItems = dhabaProvider.getMenuItemsForDhaba(dhaba.id);
    final open = dhaba.isAcceptingOrders;
    final sections = _sections(allItems);
    final categories = [for (final (c, _) in sections) c];
    _sectionKeys.removeWhere((c, _) => !categories.contains(c));
    final current = categories.contains(_current) ? _current : (categories.isEmpty ? null : categories.first);
    final here = context.watch<DeliveryLocationProvider?>()?.address;
    final distance = dhaba.location == null || here == null ? null : distanceMeters(GeoPoint(here.lat, here.lng), dhaba.location!);

    final q = _query.trim().toLowerCase();
    final results = q.isEmpty
        ? const <MenuItemModel>[]
        : [
            for (final i in allItems)
              if (i.name.toLowerCase().contains(q) || i.description.toLowerCase().contains(q) || i.category.toLowerCase().contains(q)) i,
          ];

    final safeBottom = MediaQuery.paddingOf(context).bottom;
    final showCartBar = cart.itemCount > 0;

    Widget row(MenuItemModel item, int index) => KReveal(
          key: ValueKey('row-${item.id}'),
          index: index,
          child: _MenuRow(
            item: item,
            quantity: cart.getItemQuantityInCart(item.id),
            kitchenOpen: open,
            onAdd: () => _addItem(cart, item),
            onRemove: () => _removeOne(cart, item),
          ),
        );

    return Scaffold(
      backgroundColor: k.bg,
      body: Stack(children: [
        CustomScrollView(
          controller: _scroll,
          // Bouncy, so pulling down stretches the banner.
          physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
          slivers: [
            SliverAppBar(
              pinned: true,
              stretch: true,
              expandedHeight: _heroHeight,
              backgroundColor: k.bg,
              surfaceTintColor: Colors.transparent,
              automaticallyImplyLeading: false,
              leadingWidth: 64,
              leading: Padding(
                padding: const EdgeInsets.only(left: 16),
                child: Center(
                  child: KIconButton(
                    icon: LucideIcons.arrowLeft,
                    semanticLabel: 'Back',
                    background: k.surface.withValues(alpha: 0.94),
                    bordered: false,
                    onTap: () => Navigator.of(context).maybePop(),
                  ),
                ),
              ),
              actions: [
                KIconButton(
                  icon: LucideIcons.info,
                  semanticLabel: 'Infos sur ${dhaba.name}',
                  background: k.surface.withValues(alpha: 0.94),
                  bordered: false,
                  onTap: () => _showInfo(context, dhaba),
                ),
                const SizedBox(width: 8),
                KIconButton(
                  icon: LucideIcons.heart,
                  semanticLabel: dhaba.isFavorite ? 'Retirer ${dhaba.name} des favoris' : 'Ajouter ${dhaba.name} aux favoris',
                  background: k.surface.withValues(alpha: 0.94),
                  bordered: false,
                  color: dhaba.isFavorite ? KraveoPalette.danger : k.ink,
                  onTap: () => _toggleFavourite(dhabaProvider, dhaba),
                ),
                const SizedBox(width: 16),
              ],
              flexibleSpace: _MenuHeader(dhaba: dhaba),
            ),
            SliverToBoxAdapter(
              child: _InfoBlock(
                dhaba: dhaba,
                distanceMeters: distance,
                selectedHostel: widget.selectedHostel,
                onMore: () => _showInfo(context, dhaba),
              ),
            ),
            SliverToBoxAdapter(child: _PromoBanners(promos: _bannersFor(dhaba))),
            SliverPersistentHeader(
              pinned: true,
              delegate: _TabsHeader(
                height: _tabsHeight,
                background: k.bg,
                child: _TabsBar(
                  categories: categories,
                  current: current,
                  tabKey: _tabKey,
                  onTap: _jumpTo,
                  searching: _searching,
                  searchController: _searchController,
                  searchFocus: _searchFocus,
                  onQuery: (v) => setState(() => _query = v),
                  onToggleSearch: _toggleSearch,
                ),
              ),
            ),
            if (allItems.isEmpty)
              const SliverToBoxAdapter(
                child: KEmptyState(
                  icon: LucideIcons.chefHat,
                  title: 'Menu bientôt disponible',
                  message: 'Ce restaurant n\'a pas encore publié son menu. Essayez un autre restaurant en attendant.',
                ),
              )
            else if (_searching && q.isNotEmpty)
              results.isEmpty
                  ? SliverToBoxAdapter(
                      child: KEmptyState(
                        icon: LucideIcons.searchX,
                        title: 'Aucun plat trouvé',
                        message: 'Rien ne correspond à « ${_query.trim()} » dans ce menu.',
                        action: KButton(label: 'Voir tout le menu', kind: KButtonKind.tonal, expand: false, onPressed: _toggleSearch),
                      ),
                    )
                  : SliverPadding(
                      padding: const EdgeInsets.fromLTRB(KSpace.gutter, 16, KSpace.gutter, 0),
                      sliver: SliverList.list(children: [
                        _SectionTitle(title: 'Résultats', count: results.length),
                        for (final (i, item) in results.indexed) row(item, i),
                      ]),
                    )
            else
              // All sections are built at once (menus are short) so a tab can scroll to any of them.
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(KSpace.gutter, 8, KSpace.gutter, 0),
                sliver: SliverToBoxAdapter(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    for (final (category, items) in sections)
                      Column(key: _sectionKey(category), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        _SectionTitle(title: category, count: items.length, emoji: category == _popular ? '⭐' : (category == _promos ? '🔥' : null)),
                        for (final (i, item) in items.indexed) row(item, i),
                      ]),
                  ]),
                ),
              ),
            SliverToBoxAdapter(child: SizedBox(height: (showCartBar ? 112 : 40) + safeBottom)),
          ],
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: safeBottom + 12,
          child: KBarSwitcher(
            visible: showCartBar,
            child: showCartBar
                ? KCartBar(cart: cart, kitchenName: dhaba.name, onTap: () => CartSheet.show(context, selectedHostel: widget.selectedHostel))
                : const SizedBox.shrink(),
          ),
        ),
      ]),
    );
  }

  /// The restaurant's own promotions, then banners built from real facts: free delivery here,
  /// and the first-order coupon for a student who has not ordered yet.
  List<RestaurantPromo> _bannersFor(Dhaba dhaba) {
    final orders = context.watch<OrderProvider>();
    return [
      ...dhaba.promotions,
      if (dhaba.deliveryFee <= 0) RestaurantPromo(title: 'Livraison offerte', subtitle: 'Sur toutes vos commandes chez ${dhaba.name}', emoji: '🛵'),
      if (orders.isFirstTimeCustomer)
        const RestaurantPromo(title: '-20 % sur votre 1ʳᵉ commande', subtitle: 'Dès 100 FCFA, jusqu\'à 50 FCFA', code: 'VITFIRST', emoji: '🎁'),
    ];
  }

  void _showInfo(BuildContext context, Dhaba dhaba) {
    showKSheet<void>(context, builder: (_) => _InfoSheet(dhaba: dhaba));
  }
}

/// Row of small promotion banners (gold / blue / navy gradients). A banner with a code copies
/// it on tap. Hidden when there is nothing to promote.
class _PromoBanners extends StatelessWidget {
  const _PromoBanners({required this.promos});

  final List<RestaurantPromo> promos;

  static const _ways = [
    (KraveoPalette.y300, KraveoPalette.y500, KraveoPalette.g950),
    (KraveoPalette.g600, KraveoPalette.g900, Colors.white),
    (KraveoPalette.g800, KraveoPalette.g950, Colors.white),
  ];

  @override
  Widget build(BuildContext context) {
    if (promos.isEmpty) return const SizedBox(height: 6);
    final single = promos.length == 1;
    return Padding(
      padding: const EdgeInsets.only(top: 14, bottom: 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: KSpace.gutter),
        child: Row(children: [
          for (final (i, p) in promos.indexed) ...[
            if (i > 0) const SizedBox(width: 12),
            KReveal(
                index: i,
                child: _PromoBanner(promo: p, colors: _ways[i % _ways.length], width: single ? MediaQuery.sizeOf(context).width - 2 * KSpace.gutter : 270)),
          ],
        ]),
      ),
    );
  }
}

class _PromoBanner extends StatelessWidget {
  const _PromoBanner({required this.promo, required this.colors, required this.width});

  final RestaurantPromo promo;
  final (Color, Color, Color) colors;
  final double width;

  @override
  Widget build(BuildContext context) {
    final (from, to, ink) = colors;
    final code = promo.code;
    return KPressable(
      onTap: code == null
          ? null
          : () {
              Clipboard.setData(ClipboardData(text: code));
              showKSnack(context, '$code copié. Ajoutez-le dans votre panier.', icon: LucideIcons.ticket);
            },
      scale: 0.98,
      semanticLabel: '${promo.title}${promo.subtitle.isEmpty ? '' : '. ${promo.subtitle}'}${code == null ? '' : '. Code $code, toucher pour copier'}',
      child: Container(
        width: width,
        constraints: const BoxConstraints(minHeight: 92),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [from, to]),
          borderRadius: BorderRadius.circular(KRadius.lg),
        ),
        child: Stack(children: [
          Positioned(
              right: -24,
              top: -30,
              child: Container(width: 110, height: 110, decoration: BoxDecoration(shape: BoxShape.circle, color: ink.withValues(alpha: 0.08)))),
          if (promo.imageUrl.isNotEmpty)
            Positioned(right: 0, top: 0, bottom: 0, width: 92, child: KImage(promo.imageUrl))
          else
            Positioned(
                right: 16,
                top: 0,
                bottom: 0,
                child: Center(child: ExcludeSemantics(child: Text(promo.emoji, style: const TextStyle(fontSize: 38, height: 1))))),
          Padding(
            padding: EdgeInsets.fromLTRB(16, 12, promo.imageUrl.isNotEmpty ? 104 : 70, 12),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(promo.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.titleMd.copyWith(color: ink)),
              if (promo.subtitle.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(promo.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.bodySm.copyWith(color: ink.withValues(alpha: 0.82))),
              ],
              if (code != null) ...[
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(border: Border.all(color: ink.withValues(alpha: 0.6)), borderRadius: BorderRadius.circular(KRadius.pill)),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(code, style: KraveoType.label.copyWith(color: ink, fontSize: 11, letterSpacing: 1)),
                    const SizedBox(width: 4),
                    Icon(LucideIcons.copy, size: 11, color: ink),
                  ]),
                ),
              ],
            ]),
          ),
        ]),
      ),
    );
  }
}

/// Collapsing hero: full-bleed banner that fades into the page as it scrolls away; the name
/// takes its place in the collapsed bar.
class _MenuHeader extends StatelessWidget {
  const _MenuHeader({required this.dhaba});

  final Dhaba dhaba;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final settings = context.dependOnInheritedWidgetOfExactType<FlexibleSpaceBarSettings>();
    final range = settings == null ? 1.0 : (settings.maxExtent - settings.minExtent);
    final t = settings == null || range <= 0 ? 1.0 : ((settings.currentExtent - settings.minExtent) / range).clamp(0.0, 1.0);
    final top = MediaQuery.paddingOf(context).top;

    return ClipRect(
      child: Stack(fit: StackFit.expand, children: [
        Hero(tag: DhabaCard.heroTagFor(dhaba.id), child: DhabaBanner(dhaba: dhaba, grayscale: !dhaba.isAcceptingOrders)),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [KraveoPalette.g950.withValues(alpha: 0.40), Colors.transparent, KraveoPalette.g950.withValues(alpha: 0.25)],
              stops: const [0, 0.45, 1],
            ),
          ),
        ),
        // Solidifies into the page colour as the header collapses.
        IgnorePointer(child: Opacity(opacity: (1 - t).clamp(0.0, 1.0), child: ColoredBox(color: k.bg))),
        // Collapsed title, between the back button and the actions.
        Positioned(
          left: 72,
          right: 120,
          top: top,
          height: kToolbarHeight,
          child: Opacity(
            opacity: ((0.3 - t) / 0.3).clamp(0.0, 1.0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(dhaba.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.titleLg.copyWith(color: k.ink)),
            ),
          ),
        ),
        // Rounded lip so the banner tucks under the page.
        Positioned(
          left: 0,
          right: 0,
          bottom: -1,
          height: 26,
          child: Opacity(
            opacity: t,
            child: DecoratedBox(decoration: BoxDecoration(color: k.bg, borderRadius: const BorderRadius.vertical(top: Radius.circular(26)))),
          ),
        ),
        // Logo sitting on the banner's bottom edge, fading out as the header collapses.
        Positioned(
          left: KSpace.gutter,
          bottom: 4,
          child: Opacity(
            opacity: ((t - 0.4) / 0.6).clamp(0.0, 1.0),
            child: DhabaLogo(dhaba: dhaba, size: 76, ring: 4, grayscale: !dhaba.isAcceptingOrders),
          ),
        ),
      ]),
    );
  }
}

/// Logo overlapping the banner, name and status, the three key numbers, today's hours, a short
/// description and the drop-off reminder.
class _InfoBlock extends StatelessWidget {
  const _InfoBlock({required this.dhaba, required this.distanceMeters, required this.selectedHostel, required this.onMore});

  final Dhaba dhaba;
  final double? distanceMeters;
  final String? selectedHostel;
  final VoidCallback onMore;

  static String _distance(double m) => m < 1000 ? '${(m / 10).round() * 10} m' : '${(m / 1000).toStringAsFixed(1).replaceAll('.', ',')} km';

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final open = dhaba.isAcceptingOrders;
    final hours = dhaba.openingHours?.statusAt(DateTime.now());
    return Stack(clipBehavior: Clip.none, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(KSpace.gutter, 10, KSpace.gutter, 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Text(dhaba.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: KraveoType.headline.copyWith(color: k.ink)),
            ),
            const SizedBox(width: 10),
            Padding(padding: const EdgeInsets.only(top: 4), child: _StatusPill(open: open)),
          ]),
          if (dhaba.category.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(dhaba.category, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.body.copyWith(color: k.inkMuted)),
          ],
          const SizedBox(height: 16),
          // Three key facts in one card.
          Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(color: k.surface, borderRadius: BorderRadius.circular(KRadius.lg), border: Border.all(color: k.line)),
            child: IntrinsicHeight(
              child: Row(children: [
                Expanded(
                  child: _Fact(
                    icon: LucideIcons.star,
                    iconColor: KraveoPalette.y500,
                    value: dhaba.rating.toStringAsFixed(1),
                    label: dhaba.ratingsCount > 0 ? '${dhaba.ratingsCount} avis' : 'Note',
                  ),
                ),
                VerticalDivider(width: 1, color: k.line),
                Expanded(child: _Fact(icon: LucideIcons.clock, value: dhaba.eta, label: 'Livraison')),
                VerticalDivider(width: 1, color: k.line),
                Expanded(
                  child: _Fact(
                    icon: LucideIcons.package,
                    value: dhaba.deliveryFee <= 0 ? 'Offerte' : fcfa(dhaba.deliveryFee),
                    label: 'Frais',
                  ),
                ),
              ]),
            ),
          ),
          const SizedBox(height: 14),
          Wrap(spacing: 14, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            if (hours != null) _Line(icon: LucideIcons.clock3, text: hours, color: hours.startsWith('Ouvert') ? KraveoPalette.success : k.inkMuted),
            if (distanceMeters != null) _Line(icon: LucideIcons.navigation, text: 'À ${_distance(distanceMeters!)}', color: k.inkMuted),
            _Line(icon: LucideIcons.mapPin, text: selectedHostel == null ? 'Point de livraison au paiement' : 'Livré à $selectedHostel', color: k.brand),
          ]),
          if (dhaba.description.isNotEmpty) ...[
            const SizedBox(height: 12),
            KPressable(
              onTap: onMore,
              semanticLabel: 'Lire la présentation de ${dhaba.name}',
              child: Text.rich(
                TextSpan(children: [
                  TextSpan(text: dhaba.description.length > 110 ? '${dhaba.description.substring(0, 110).trimRight()}… ' : '${dhaba.description} '),
                  TextSpan(text: 'Plus d\'infos', style: TextStyle(color: k.brand, fontWeight: FontWeight.w700)),
                ]),
                style: KraveoType.bodySm.copyWith(color: k.inkMuted),
              ),
            ),
          ],
          if (!open) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: KraveoPalette.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(KRadius.md)),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Icon(LucideIcons.moon, size: 18, color: kDangerInk),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Ce restaurant ne prend pas de commande pour le moment. Vous pouvez parcourir le menu et revenir bientôt.',
                    style: KraveoType.bodySm.copyWith(color: kDangerInk, fontWeight: FontWeight.w600),
                  ),
                ),
              ]),
            ),
          ],
        ]),
      ),
    ]);
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.open});

  final bool open;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final color = open ? KraveoPalette.success : k.inkMuted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(KRadius.pill)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 7, height: 7, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text(open ? 'Ouvert' : 'Fermé', style: KraveoType.label.copyWith(color: color, fontSize: 12.5)),
      ]),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.value, required this.label, this.iconColor});

  final IconData icon;
  final String value;
  final String label;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Column(mainAxisSize: MainAxisSize.min, children: [
      Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 15, color: iconColor ?? k.brand),
        const SizedBox(width: 5),
        Flexible(child: Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.titleMd.copyWith(color: k.ink))),
      ]),
      const SizedBox(height: 2),
      Text(label, maxLines: 1, style: KraveoType.caption.copyWith(color: k.inkMuted)),
    ]);
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.icon, required this.text, required this.color});

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 15, color: color),
        const SizedBox(width: 5),
        Text(text, style: KraveoType.bodySm.copyWith(color: color, fontWeight: FontWeight.w600)),
      ]);
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, required this.count, this.emoji});

  final String title;
  final int count;
  final String? emoji;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Padding(
      padding: const EdgeInsets.only(top: 18, bottom: 12),
      child: Row(children: [
        Flexible(
          child: Text(
            emoji == null ? title : '$title $emoji',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: KraveoType.headlineSm.copyWith(color: k.ink),
          ),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(color: k.surfaceAlt, borderRadius: BorderRadius.circular(KRadius.pill)),
          child: Text('$count', style: KraveoType.label.copyWith(color: k.inkMuted, fontSize: 12)),
        ),
      ]),
    );
  }
}

class _TabsHeader extends SliverPersistentHeaderDelegate {
  _TabsHeader({required this.height, required this.background, required this.child});

  final double height;
  final Color background;
  final Widget child;

  @override
  double get minExtent => height;
  @override
  double get maxExtent => height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final k = context.k;
    // The header must be exactly [height] tall.
    return SizedBox.expand(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: background,
          border: Border(bottom: BorderSide(color: k.line)),
          boxShadow:
              overlapsContent || shrinkOffset > 0 ? [BoxShadow(color: k.shadowTint.withValues(alpha: 0.06), blurRadius: 10, offset: const Offset(0, 4))] : null,
        ),
        child: child,
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _TabsHeader old) => true;
}

/// Category tabs (underlined when current) with a small search icon on the right; the search
/// field replaces the tabs while it is open.
class _TabsBar extends StatelessWidget {
  const _TabsBar({
    required this.categories,
    required this.current,
    required this.tabKey,
    required this.onTap,
    required this.searching,
    required this.searchController,
    required this.searchFocus,
    required this.onQuery,
    required this.onToggleSearch,
  });

  final List<String> categories;
  final String? current;
  final GlobalKey Function(String) tabKey;
  final ValueChanged<String> onTap;
  final bool searching;
  final TextEditingController searchController;
  final FocusNode searchFocus;
  final ValueChanged<String> onQuery;
  final VoidCallback onToggleSearch;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return AnimatedSwitcher(
      duration: KMotion.base,
      child: searching
          ? Padding(
              key: const ValueKey('search'),
              padding: const EdgeInsets.fromLTRB(KSpace.gutter, 7, 8, 7),
              child: Row(children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('menu-search-field'),
                    controller: searchController,
                    focusNode: searchFocus,
                    onChanged: onQuery,
                    textInputAction: TextInputAction.search,
                    style: KraveoType.body.copyWith(color: k.ink),
                    decoration: InputDecoration(
                      isDense: true,
                      hintText: 'Rechercher dans le menu',
                      prefixIcon: Icon(LucideIcons.search, size: 17, color: k.inkMuted),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(KRadius.pill), borderSide: BorderSide(color: k.line)),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(KRadius.pill), borderSide: BorderSide(color: k.line)),
                      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(KRadius.pill), borderSide: BorderSide(color: k.brand, width: 1.4)),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                _SmallIcon(icon: LucideIcons.x, semanticLabel: 'Fermer la recherche', onTap: onToggleSearch),
              ]),
            )
          : Row(key: const ValueKey('tabs'), children: [
              Expanded(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.only(left: KSpace.gutter - 4, right: 8),
                  child: Row(children: [
                    for (final c in categories)
                      KPressable(
                        key: tabKey(c),
                        onTap: () => onTap(c),
                        semanticLabel: '$c${c == current ? ', sélectionné' : ''}',
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 10),
                          child: SizedBox(
                            height: 52,
                            child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                              Text(
                                c,
                                style: KraveoType.titleMd.copyWith(
                                  fontSize: 14.5,
                                  color: c == current ? k.brand : k.inkMuted,
                                  fontWeight: c == current ? FontWeight.w800 : FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 12),
                              AnimatedContainer(
                                duration: KMotion.base,
                                curve: KMotion.emphasized,
                                height: 3,
                                width: c == current ? 28 : 0,
                                decoration: BoxDecoration(color: k.brand, borderRadius: BorderRadius.circular(KRadius.pill)),
                              ),
                            ]),
                          ),
                        ),
                      ),
                  ]),
                ),
              ),
              Container(width: 1, height: 22, color: k.line),
              _SmallIcon(icon: LucideIcons.search, semanticLabel: 'Rechercher dans le menu', onTap: onToggleSearch),
              const SizedBox(width: 8),
            ]),
    );
  }
}

class _SmallIcon extends StatelessWidget {
  const _SmallIcon({required this.icon, required this.semanticLabel, required this.onTap});

  final IconData icon;
  final String semanticLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => KPressable(
        onTap: onTap,
        semanticLabel: semanticLabel,
        child: SizedBox(width: 44, height: 44, child: Icon(icon, size: 19, color: context.k.ink)),
      );
}

/// "Infos" sheet: presentation, opening hours of the week (today in bold), address.
class _InfoSheet extends StatelessWidget {
  const _InfoSheet({required this.dhaba});

  final Dhaba dhaba;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final hours = dhaba.openingHours;
    final today = DateTime.now().weekday;
    Widget heading(String t) => Padding(
          padding: const EdgeInsets.only(top: 18, bottom: 8),
          child: Text(t, style: KraveoType.titleMd.copyWith(color: k.ink)),
        );
    return KSheetFrame(
      title: dhaba.name,
      subtitle: dhaba.category.isEmpty ? null : Text(dhaba.category, style: KraveoType.bodySm.copyWith(color: k.inkMuted)),
      children: [
        Row(children: [DhabaLogo(dhaba: dhaba, size: 56, ring: 3)]),
        if (dhaba.description.isNotEmpty) ...[
          heading('Présentation'),
          Text(dhaba.description, style: KraveoType.body.copyWith(color: k.inkMuted)),
        ],
        heading('Horaires'),
        if (hours == null)
          Text('Horaires non renseignés par le restaurant.', style: KraveoType.bodySm.copyWith(color: k.inkMuted))
        else
          for (var d = 1; d <= 7; d++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Expanded(
                  child: Text(
                    OpeningHours.frenchDays[d - 1],
                    style: KraveoType.body.copyWith(color: k.ink, fontWeight: d == today ? FontWeight.w800 : FontWeight.w500),
                  ),
                ),
                Text(
                  hours.slotsOn(d).isEmpty ? 'Fermé' : hours.slotsOn(d).map((s) => s.label).join(', '),
                  style: KraveoType.body
                      .copyWith(color: hours.slotsOn(d).isEmpty ? k.inkFaint : k.ink, fontWeight: d == today ? FontWeight.w800 : FontWeight.w500),
                ),
              ]),
            ),
        if (dhaba.address.isNotEmpty) ...[
          heading('Adresse'),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(padding: const EdgeInsets.only(top: 2), child: Icon(LucideIcons.mapPin, size: 16, color: k.brand)),
            const SizedBox(width: 8),
            Expanded(child: Text(dhaba.address, style: KraveoType.body.copyWith(color: k.inkMuted))),
          ]),
        ],
        heading('Note'),
        Row(children: [
          const Icon(LucideIcons.star, size: 16, color: KraveoPalette.y500),
          const SizedBox(width: 6),
          Text(
            dhaba.ratingsCount > 0 ? '${dhaba.rating.toStringAsFixed(1)} · ${dhaba.ratingsCount} avis' : dhaba.rating.toStringAsFixed(1),
            style: KraveoType.body.copyWith(color: k.ink, fontWeight: FontWeight.w600),
          ),
        ]),
      ],
    );
  }
}

class _MenuRow extends StatelessWidget {
  const _MenuRow({
    required this.item,
    required this.quantity,
    required this.kitchenOpen,
    required this.onAdd,
    required this.onRemove,
  });

  final MenuItemModel item;
  final int quantity;
  final bool kitchenOpen;
  final VoidCallback onAdd;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final soldOut = !item.isAvailable;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Opacity(
        opacity: soldOut ? 0.6 : 1,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: k.surface,
            borderRadius: BorderRadius.circular(KRadius.xl),
            boxShadow: soldOut ? null : KShadow.soft(k.shadowTint),
            border: soldOut ? Border.all(color: k.line) : null,
          ),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  VegMark(isVeg: item.isVeg),
                  if (item.hasCustomizations) ...[
                    const SizedBox(width: 8),
                    Icon(LucideIcons.slidersHorizontal, size: 13, color: k.inkFaint),
                    const SizedBox(width: 4),
                    Flexible(
                        child: Text('Personnalisable', maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.caption.copyWith(color: k.inkMuted))),
                  ],
                ]),
                const SizedBox(height: 8),
                Text(item.name, style: KraveoType.titleMd.copyWith(color: k.ink)),
                const SizedBox(height: 4),
                Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, runSpacing: 4, children: [
                  Text(fcfa(item.price),
                      style: KraveoType.numericSm.copyWith(color: soldOut ? k.inkFaint : (item.onPromo ? KraveoPalette.danger : k.ink), fontSize: 20)),
                  if (item.onPromo) ...[
                    Text(
                      fcfa(item.originalPrice!),
                      style: KraveoType.bodySm.copyWith(color: k.inkFaint, decoration: TextDecoration.lineThrough, decorationColor: k.inkFaint),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(color: KraveoPalette.danger, borderRadius: BorderRadius.circular(KRadius.pill)),
                      child: Text('-${item.discountPercent} %', style: KraveoType.label.copyWith(color: Colors.white, fontSize: 11)),
                    ),
                  ],
                ]),
                if (item.description.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(item.description, maxLines: 2, overflow: TextOverflow.ellipsis, style: KraveoType.bodySm.copyWith(color: k.inkMuted)),
                ],
              ]),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 112,
              height: 130,
              child: Stack(children: [
                Positioned(
                  left: 0,
                  right: 0,
                  top: 0,
                  height: 104,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(KRadius.lg),
                    child: KImage(item.imageUrl, grayscale: soldOut),
                  ),
                ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: soldOut
                      ? Container(
                          height: 40,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(color: k.surfaceAlt, borderRadius: BorderRadius.circular(KRadius.pill)),
                          child: Text('Épuisé', style: KraveoType.label.copyWith(color: k.inkMuted, fontSize: 13)),
                        )
                      : KAddButton(quantity: quantity, onAdd: onAdd, onRemove: onRemove, enabled: kitchenOpen, itemName: item.name),
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
