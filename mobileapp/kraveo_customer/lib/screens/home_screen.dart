import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:forui/forui.dart';
import '../models/dhaba.dart';
import '../models/home_collection.dart';
import '../models/menu_item.dart';
import '../providers/cart_provider.dart';
import '../providers/dhaba_provider.dart';
import '../providers/location_provider.dart';
import '../providers/order_provider.dart';
import '../providers/session_provider.dart';
import '../services/home_collections.dart';
import '../widgets/add_to_cart.dart';
import '../widgets/cart_sheet.dart';
import '../widgets/delivery_address_sheet.dart';
import '../widgets/dhaba_card.dart';
import '../widgets/home_bottom_bar.dart';
import '../widgets/home_sections.dart';
import '../widgets/ui/format.dart';
import '../widgets/ui/forui_theme.dart';
import '../widgets/ui/floating_bar.dart';
import '../widgets/ui/hostel_pill.dart';
import '../widgets/ui/sheet_chrome.dart';
import '../widgets/ui/snack.dart';
import '../widgets/ui/status_map.dart';
import 'dhaba_menu_screen.dart';
import 'live_tracking_screen.dart';
import 'order_history_screen.dart';
import 'profile_screen.dart';
import 'search_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {

  /// Catch up on order changes and the kitchen catalog (open / closed, sold out, new kitchens)
  /// when the app returns to the foreground (contract 3).
  late final AppLifecycleListener _lifecycle = AppLifecycleListener(onResume: () {
    if (!mounted) return;
    context.read<OrderProvider>().onAppResumed();
    unawaited(context.read<DhabaProvider>().loadCatalog());
  });

  @override
  void initState() {
    super.initState();
    _lifecycle; // start listening
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(Provider.of<DhabaProvider>(context, listen: false).loadCatalog());
      // Find the delivery address automatically (asks for permission the first time).
      unawaited(context.read<DeliveryLocationProvider?>()?.ensureLocated());
    });
  }

  /// Pull-to-refresh on Home: kitchens and orders. Says so when the kitchens could not be refreshed.
  Future<void> _refreshHome() async {
    final orders = context.read<OrderProvider>();
    final dhabas = context.read<DhabaProvider>();
    unawaited(orders.refreshActive());
    final ok = await dhabas.loadCatalog();
    if (!mounted || ok) return;
    showKSnack(context, 'Impossible d\'actualiser les restaurants. Vérifiez votre connexion et réessayez.', error: true);
  }

  final List<String> hostelBlocks = kHostelBlocks;

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }


  /// Drop-off point changes made from Home are saved to the profile too, so the Me tab,
  /// checkout and the next launch all agree. Reverts (with a message) if saving fails.
  Future<void> _changeHostel(String block) async {
    final result = await context.read<SessionProvider>().changeHostel(block);
    if (!mounted || result.success || result.unauthorized) return;
    showKSnack(
      context,
      result.networkError ? 'Impossible d\'enregistrer votre point de livraison. Vérifiez votre connexion.' : (result.message ?? 'Impossible d\'enregistrer votre point de livraison.'),
      error: true,
    );
  }

  Future<void> _pickDropPoint(String? current) async {
    final picked = await showHostelPicker(context, blocks: hostelBlocks, selected: current ?? '');
    if (picked != null && mounted) await _changeHostel(picked);
  }

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final selectedHostel = context.select<SessionProvider, String?>((s) => s.deliveryPoint);
    // Forui widgets (filters, badges) read the Kraveo forui theme.
    return KForui(child: _buildScaffold(context, k, selectedHostel));
  }

  // Profile, orders and tracking open as full pages (own back button, no bottom bar).
  void _openProfile() => Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => ProfileScreen(onOpenOrders: _openOrders, onTrackOrder: _openTracking),
      ));

  void _openOrders() => Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (ctx) => OrderHistoryScreen(
          selectedHostel: context.read<SessionProvider>().deliveryPoint,
          onTrackOrder: _openTracking,
          onExplore: () => Navigator.of(ctx).popUntil((r) => r.isFirst),
        ),
      ));

  void _openTracking() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const LiveTrackingScreen()));

  Widget _buildScaffold(BuildContext context, KraveoTokens k, String? selectedHostel) {
    return Scaffold(
      backgroundColor: k.bg,
      body: Builder(builder: _buildHomeFeed),
      // Yassir-style bar: Home, a search pill, favourites. Orders and tracking are reached from
      // the profile (avatar) and the active-order bar.
      bottomNavigationBar: Builder(builder: (context) {
        final dhabas = context.watch<DhabaProvider>();
        final cart = context.watch<CartProvider>();
        return HomeBottomBar(
          cartCount: cart.itemCount,
          favouritesOn: dhabas.showFavoritesOnly,
          onCart: () => CartSheet.show(context, selectedHostel: context.read<SessionProvider>().deliveryPoint),
          onSearch: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SearchScreen())),
          onFavourites: dhabas.toggleFavoritesOnly,
        );
      }),
    );
  }

  /// Home-only filters, applied on top of the provider's search / category / favourites.
  bool _openOnly = false;
  bool _topRated = false;
  bool _freeDelivery = false;
  bool _fast = false;
  bool _budget = false;
  _SortBy _sortBy = _SortBy.recommended;

  static const double _topRatedFrom = 4.5;

  List<Dhaba> _visibleDhabas(DhabaProvider p) {
    final list = [
      for (final d in p.dhabas)
        if ((!_openOnly || d.isAcceptingOrders) &&
            (!_topRated || d.rating >= _topRatedFrom) &&
            (!_freeDelivery || d.deliveryFee <= 0) &&
            (!_fast || etaMinutes(d.eta) <= 20) &&
            (!_budget || p.getMenuItemsForDhaba(d.id).any((i) => i.isAvailable && i.price <= budgetMaxFcfa)))
          d,
    ];
    switch (_sortBy) {
      case _SortBy.recommended:
        break;
      case _SortBy.rating:
        list.sort((a, b) => b.rating.compareTo(a.rating));
      case _SortBy.fastest:
        list.sort((a, b) => etaMinutes(a.eta).compareTo(etaMinutes(b.eta)));
      case _SortBy.deliveryFee:
        list.sort((a, b) => a.deliveryFee.compareTo(b.deliveryFee));
    }
    return list;
  }

  /// Open kitchens that have dishes with a photo, each with up to 8 of those dishes
  /// ("Items selected for you" rows). At most 3 kitchens, best rated first.
  List<(Dhaba, List<MenuItemModel>)> _kitchenShelves(DhabaProvider p) {
    final shelves = <(Dhaba, List<MenuItemModel>)>[];
    final open = [for (final d in p.allDhabas) if (d.isAcceptingOrders) d]..sort((a, b) => b.rating.compareTo(a.rating));
    for (final d in open) {
      final dishes = [
        for (final item in p.getMenuItemsForDhaba(d.id))
          if (item.isAvailable && item.imageUrl.trim().isNotEmpty) item,
      ];
      if (dishes.isEmpty) continue;
      shelves.add((d, dishes.take(8).toList()));
      if (shelves.length == 3) break;
    }
    return shelves;
  }

  void _openKitchen(BuildContext context, Dhaba dhaba, String? selectedHostel) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (context) => DhabaMenuScreen(dhaba: dhaba, selectedHostel: selectedHostel)),
    );
  }

  void _clearFilters(DhabaProvider dhabaProvider) {
    dhabaProvider.setSearchQuery('');
    dhabaProvider.setSelectedCategoryIndex(0);
    if (dhabaProvider.showFavoritesOnly) dhabaProvider.toggleFavoritesOnly();
    setState(() {
      _openOnly = _topRated = _freeDelivery = _fast = _budget = false;
      _sortBy = _SortBy.recommended;
    });
  }

  Future<void> _pickSort() async {
    final picked = await showKSheet<_SortBy>(
      context,
      builder: (ctx) {
        final k = ctx.k;
        return KSheetFrame(
          title: 'Trier les restaurants par',
          children: [
            for (final option in _SortBy.values)
              KPressable(
                onTap: () => Navigator.of(ctx).pop(option),
                semanticLabel: option.label,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  child: Row(children: [
                    Icon(option.icon, size: 20, color: k.inkMuted),
                    const SizedBox(width: 14),
                    Expanded(child: Text(option.label, style: KraveoType.body.copyWith(color: k.ink, fontWeight: FontWeight.w600))),
                    if (option == _sortBy) Icon(LucideIcons.check, size: 20, color: k.brand),
                  ]),
                ),
              ),
          ],
        );
      },
    );
    if (picked != null && mounted) setState(() => _sortBy = picked);
  }

  static const double _kitchenCardWidth = 286;

  Widget _collectionRow(BuildContext context, HomeCollection c, CartProvider cart, DhabaProvider dhabas, String? selectedHostel) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      CollectionHeader(title: c.title, emoji: c.emoji, subtitle: c.subtitle, highlight: c.highlight),
      if (c.kind == HomeCollectionKind.kitchens)
        _HorizontalRow(children: [
          for (final d in c.kitchens)
            DhabaCard(
              key: ValueKey('${c.id}-${d.id}'),
              dhaba: d,
              width: _kitchenCardWidth,
              onFavoriteToggle: () => dhabas.toggleFavorite(d.id),
              onTap: () => _openKitchen(context, d, selectedHostel),
            ),
        ])
      else
        _HorizontalRow(spacing: 14, children: [
          for (final (item, d) in c.dishes) _dishTile(context, item, d, cart, dhabas, selectedHostel, caption: d.name),
        ]),
    ]);
  }

  Widget _shelfRow(BuildContext context, (Dhaba, List<MenuItemModel>) shelf, CartProvider cart, DhabaProvider dhabas, String? selectedHostel) {
    final (dhaba, dishes) = shelf;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      KitchenSectionHeader(dhaba: dhaba, onOpen: () => _openKitchen(context, dhaba, selectedHostel)),
      _HorizontalRow(spacing: 14, children: [
        for (final item in dishes) _dishTile(context, item, dhaba, cart, dhabas, selectedHostel),
      ]),
    ]);
  }

  Widget _dishTile(BuildContext context, MenuItemModel item, Dhaba dhaba, CartProvider cart, DhabaProvider dhabas, String? selectedHostel, {String? caption}) {
    return DishTile(
      item: item,
      caption: caption,
      quantity: cart.hasRestaurant(dhaba.id) ? cart.getItemQuantityInCart(item.id) : 0,
      onOpen: () => _openKitchen(context, dhaba, selectedHostel),
      onAdd: () => addDishToCart(context, cart: cart, dhaba: dhabas.byId(dhaba.id) ?? dhaba, item: item),
    );
  }

  Widget _buildHomeFeed(BuildContext context) {
    final k = context.k;
    final dhabaProvider = Provider.of<DhabaProvider>(context);
    final orderProvider = Provider.of<OrderProvider>(context);
    final cart = Provider.of<CartProvider>(context);
    final session = context.watch<SessionProvider>();
    final selectedHostel = session.deliveryPoint;
    final activeOrder = orderProvider.activeOrder;
    final showActiveBar = activeOrder != null && activeOrder.status.isLive;
    final dhabas = _visibleDhabas(dhabaProvider);
    final catalogLoading = dhabaProvider.isCatalogLoading;
    final catalogFailed = dhabaProvider.hasCatalogFailed;
    final noKitchens = dhabaProvider.allDhabas.isEmpty;
    final chips = dhabaProvider.categories;
    final filtering = dhabaProvider.searchQuery.trim().isNotEmpty ||
        dhabaProvider.selectedCategoryIndex != 0 ||
        dhabaProvider.showFavoritesOnly ||
        _openOnly ||
        _topRated ||
        _freeDelivery ||
        _fast ||
        _budget;
    final shelves = filtering || catalogLoading ? const <(Dhaba, List<MenuItemModel>)>[] : _kitchenShelves(dhabaProvider);
    // Browsing (no search / filter, catalog loaded): themed horizontal rows. Otherwise the plain
    // vertical result list with its empty / error states.
    final browsing = !filtering && !catalogLoading && dhabas.isNotEmpty;
    final collections = browsing
        ? buildHomeCollections(kitchens: dhabaProvider.allDhabas, menuOf: dhabaProvider.getMenuItemsForDhaba, now: DateTime.now())
        : const <HomeCollection>[];
    // With extendBody the scaffold reports the floating nav's height as bottom padding.
    final navInset = MediaQuery.paddingOf(context).bottom;
    final bars = showActiveBar ? 84.0 : 0.0;

    return Scaffold(
      backgroundColor: k.bg,
      body: Stack(children: [
        RefreshIndicator(
          onRefresh: _refreshHome,
          edgeOffset: 64,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              // ---- Delivery point (pinned) ---------------------------------------------------
              SliverAppBar(
                pinned: true,
                toolbarHeight: 64,
                backgroundColor: k.bg,
                surfaceTintColor: Colors.transparent,
                automaticallyImplyLeading: false,
                titleSpacing: KSpace.gutter,
                title: Row(children: [
                  Expanded(
                    child: Align(
                      alignment: Alignment.centerLeft,
                      // With geolocation the header shows the located address; without it (tests,
                      // or no location service) the drop-point picker as before.
                      child: context.watch<DeliveryLocationProvider?>() != null
                          ? LocatedAddressButton(onChooseDropPoint: () => _pickDropPoint(selectedHostel))
                          : _DeliverTo(selectedHostel: selectedHostel, blocks: hostelBlocks, onChanged: _changeHostel),
                    ),
                  ),
                  // Notification bell, disabled for now (no notification list yet).
                  // _NotificationBell(
                  //   count: orderProvider.liveOrders.length,
                  //   // Live orders open tracking; otherwise the order list.
                  //   onTap: orderProvider.liveOrders.isNotEmpty ? _openTracking : _openOrders,
                  // ),
                  // const SizedBox(width: 10),
                  KPressable(
                    onTap: _openProfile,
                    semanticLabel: 'Ouvrir votre profil',
                    // A thin brand-blue ring with a white gap around the avatar.
                    child: Container(
                      padding: const EdgeInsets.all(1.5),
                      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: k.brand, width: 1.5)),
                      child: KAvatar(id: session.user?.avatarId, size: 34),
                    ),
                  ),
                ]),
              ),
              SliverToBoxAdapter(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Container(
                    color: k.bg,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      // ---- Category rail (from the live menus) ---------------------------
                      if (chips.length > 1)
                        KReveal(
                          index: 1,
                          child: SizedBox(
                            height: 86,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              padding: const EdgeInsets.fromLTRB(KSpace.gutter - 10, 8, KSpace.gutter - 10, 0),
                              itemCount: chips.length,
                              separatorBuilder: (_, __) => const SizedBox(width: 2),
                              itemBuilder: (context, index) => CategoryTile(
                                label: chips[index],
                                selected: dhabaProvider.selectedCategoryIndex == index,
                                onTap: () => dhabaProvider.setSelectedCategoryIndex(index),
                              ),
                            ),
                          ),
                        ),
                    ]),
                  ),
                  // ---- Filter pills --------------------------------------------------------
                  KReveal(
                    index: 2,
                    child: SizedBox(
                      height: 44,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.fromLTRB(KSpace.gutter, 2, KSpace.gutter, 8),
                        children: [
                          FilterPill(
                            label: _sortBy == _SortBy.recommended ? 'Trier' : _sortBy.label,
                            icon: LucideIcons.arrowDownUp,
                            dropdown: true,
                            selected: _sortBy != _SortBy.recommended,
                            onTap: _pickSort,
                          ),
                          const SizedBox(width: 8),
                          FilterPill(label: 'Ouvert', icon: LucideIcons.store, selected: _openOnly, onTap: () => setState(() => _openOnly = !_openOnly)),
                          const SizedBox(width: 8),
                          FilterPill(label: 'Mieux notés', icon: LucideIcons.star, selected: _topRated, onTap: () => setState(() => _topRated = !_topRated)),
                          const SizedBox(width: 8),
                          FilterPill(label: 'Livraison offerte', icon: LucideIcons.package, selected: _freeDelivery, onTap: () => setState(() => _freeDelivery = !_freeDelivery)),
                          const SizedBox(width: 8),
                          FilterPill(label: 'Moins de 20 min', icon: LucideIcons.zap, selected: _fast, onTap: () => setState(() => _fast = !_fast)),
                          const SizedBox(width: 8),
                          FilterPill(label: 'Petit budget', icon: LucideIcons.wallet, selected: _budget, onTap: () => setState(() => _budget = !_budget)),
                        ],
                      ),
                    ),
                  ),
                  // The first-order promo is only shown to a student who has no earlier order (the
                  // server refuses VITFIRST otherwise); while that is unknown it stays hidden.
                  if (!filtering && orderProvider.isFirstTimeCustomer) const KReveal(index: 3, child: _PromoCard()),
                  // ---- Themed rows: the moment of the day first, kitchen shelves in between ----
                  ...() {
                    final rows = <Widget>[];
                    var shelf = 0;
                    for (final (i, c) in collections.indexed) {
                      rows.add(KReveal(index: 4 + i, child: _collectionRow(context, c, cart, dhabaProvider, selectedHostel)));
                      // A kitchen's "Items selected for you" after the 1st and the 3rd row.
                      if ((i == 0 || i == 2) && shelf < shelves.length) {
                        rows.add(KReveal(index: 5 + i, child: _shelfRow(context, shelves[shelf++], cart, dhabaProvider, selectedHostel)));
                      }
                    }
                    while (shelf < shelves.length && shelf < 2) {
                      rows.add(_shelfRow(context, shelves[shelf++], cart, dhabaProvider, selectedHostel));
                    }
                    return rows;
                  }(),
                  // ---- All kitchens ---------------------------------------------------------
                  Padding(
                    padding: const EdgeInsets.fromLTRB(KSpace.gutter, 30, KSpace.gutter, 16),
                    child: Row(children: [
                      Expanded(
                        child: Text(
                          dhabaProvider.showFavoritesOnly ? 'Vos favoris' : 'Restaurants près de vous',
                          style: KraveoType.headlineSm.copyWith(color: k.ink),
                        ),
                      ),
                      if (!catalogLoading && !catalogFailed)
                        FBadge(
                          variant: FBadgeVariant.secondary,
                          child: Text(dhabas.length == 1 ? '1 restaurant' : '${dhabas.length} restaurants'),
                        ),
                    ]),
                  ),
                  if (browsing)
                    _HorizontalRow(children: [
                      for (final d in dhabas)
                        DhabaCard(
                          key: ValueKey('all-${d.id}'),
                          dhaba: d,
                          heroTag: DhabaCard.heroTagFor(d.id),
                          width: _kitchenCardWidth,
                          onFavoriteToggle: () => dhabaProvider.toggleFavorite(d.id),
                          onTap: () => _openKitchen(context, d, selectedHostel),
                        ),
                    ]),
                ]),
              ),
              if (catalogLoading)
                const SliverPadding(padding: EdgeInsets.symmetric(horizontal: KSpace.gutter), sliver: _SkeletonList())
              else if (catalogFailed && noKitchens)
                SliverToBoxAdapter(
                  child: KEmptyState(
                    icon: LucideIcons.wifiOff,
                    title: 'Impossible de charger les restaurants',
                    message: 'Vérifiez votre connexion puis réessayez. Vous pouvez aussi tirer vers le bas pour actualiser.',
                    action: KButton(
                      label: 'Réessayer',
                      kind: KButtonKind.tonal,
                      expand: false,
                      icon: LucideIcons.rotateCcw,
                      onPressed: () => unawaited(dhabaProvider.loadCatalog()),
                    ),
                  ),
                )
              else if (noKitchens)
                SliverToBoxAdapter(
                  child: KEmptyState(
                    icon: LucideIcons.store,
                    title: 'Aucun restaurant ouvert pour le moment',
                    message: 'Les restaurants apparaîtront ici dès leur ouverture. Tirez vers le bas pour vérifier.',
                    action: KButton(
                      label: 'Actualiser',
                      kind: KButtonKind.tonal,
                      expand: false,
                      icon: LucideIcons.rotateCcw,
                      onPressed: _refreshHome,
                    ),
                  ),
                )
              else if (dhabas.isEmpty)
                SliverToBoxAdapter(
                  child: KEmptyState(
                    icon: dhabaProvider.showFavoritesOnly ? LucideIcons.heartOff : LucideIcons.searchX,
                    title: dhabaProvider.showFavoritesOnly ? 'Pas encore de favoris' : 'Aucun restaurant trouvé',
                    message: dhabaProvider.showFavoritesOnly
                        ? 'Touchez le cœur d\'un restaurant pour le retrouver ici et recommander vite.'
                        : 'Essayez une autre catégorie ou un autre filtre, ou effacez les filtres pour tout voir.',
                    action: KButton(
                      label: 'Effacer les filtres',
                      kind: KButtonKind.tonal,
                      expand: false,
                      icon: LucideIcons.rotateCcw,
                      onPressed: () => _clearFilters(dhabaProvider),
                    ),
                  ),
                )
              else if (!browsing)
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: KSpace.gutter),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) {
                        final dhaba = dhabas[index];
                        return KReveal(
                          key: ValueKey(dhaba.id),
                          index: index,
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 18),
                            child: DhabaCard(
                              dhaba: dhaba,
                              heroTag: DhabaCard.heroTagFor(dhaba.id),
                              onFavoriteToggle: () => dhabaProvider.toggleFavorite(dhaba.id),
                              onTap: () => _openKitchen(context, dhaba, selectedHostel),
                            ),
                          ),
                        );
                      },
                      childCount: dhabas.length,
                    ),
                  ),
                ),
              SliverToBoxAdapter(child: SizedBox(height: navInset + 24 + bars)),
            ],
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: navInset + 8,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            KBarSwitcher(
              visible: showActiveBar,
              child: showActiveBar ? _ActiveOrderBar(orderProvider: orderProvider, onTap: _openTracking) : const SizedBox.shrink(),
            ),
          ]),
        ),
      ]),
    );
  }
}

/// Bell with a red count bubble (live orders). The bubble pops in, and the bell rings once each
/// time the count goes up.
// ignore: unused_element
class _NotificationBell extends StatefulWidget {
  const _NotificationBell({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  State<_NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends State<_NotificationBell> with SingleTickerProviderStateMixin {
  late final AnimationController _ring = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));

  @override
  void didUpdateWidget(covariant _NotificationBell old) {
    super.didUpdateWidget(old);
    if (widget.count > old.count) _ring.forward(from: 0);
  }

  @override
  void dispose() {
    _ring.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final count = widget.count;
    return KPressable(
      onTap: widget.onTap,
      semanticLabel: count == 0 ? 'Notifications' : 'Notifications, $count commande${count == 1 ? '' : 's'} en cours',
      child: SizedBox(
        width: 42,
        height: 42,
        child: Stack(clipBehavior: Clip.none, children: [
          Container(
            width: 40,
            height: 40,
            margin: const EdgeInsets.only(top: 2),
            decoration: BoxDecoration(
              color: k.surface,
              shape: BoxShape.circle,
              border: Border.all(color: k.line, width: 1.3),
              boxShadow: KShadow.soft(k.shadowTint),
            ),
            child: AnimatedBuilder(
              animation: _ring,
              // A damped swing: the bell rocks left/right a few times and settles.
              builder: (_, child) => Transform.rotate(
                angle: math.sin(_ring.value * math.pi * 6) * 0.35 * (1 - _ring.value),
                alignment: Alignment.topCenter,
                child: child,
              ),
              child: Icon(LucideIcons.bell, size: 18, color: k.ink),
            ),
          ),
          Positioned(
            top: -2,
            right: -4,
            child: AnimatedScale(
              scale: count > 0 ? 1 : 0,
              duration: KMotion.base,
              curve: KMotion.spring,
              child: Container(
                constraints: const BoxConstraints(minWidth: 20),
                height: 20,
                padding: const EdgeInsets.symmetric(horizontal: 5),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: KraveoPalette.danger,
                  borderRadius: BorderRadius.circular(KRadius.pill),
                  border: Border.all(color: k.bg, width: 2),
                ),
                child: Text(
                  count > 9 ? '9+' : '$count',
                  style: KraveoType.caption.copyWith(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w800, height: 1),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Horizontal carousel that sizes to its tallest child (no fixed height, so larger text never
/// overflows). Rows hold at most a dozen cards, so building them all is fine.
class _HorizontalRow extends StatelessWidget {
  const _HorizontalRow({required this.children, this.spacing = 14});

  final List<Widget> children;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(KSpace.gutter, 0, KSpace.gutter, 8),
      clipBehavior: Clip.none,
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final (i, c) in children.indexed) ...[if (i > 0) SizedBox(width: spacing), c],
      ]),
    );
  }
}

enum _SortBy {
  recommended('Recommandés', LucideIcons.sparkles),
  rating('Note', LucideIcons.star),
  fastest('Livraison la plus rapide', LucideIcons.timer),
  deliveryFee('Frais de livraison', LucideIcons.package);

  const _SortBy(this.label, this.icon);

  final String label;
  final IconData icon;
}

/// "DELIVERING TO / BH1 ⌄": the delivery point as plain bold text, like an address line.
class _DeliverTo extends StatelessWidget {
  const _DeliverTo({required this.selectedHostel, required this.blocks, required this.onChanged});

  final String? selectedHostel;
  final List<String> blocks;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final chosen = selectedHostel;
    final value = chosen == null ? null : (blocks.contains(chosen) ? chosen : (blocks.isNotEmpty ? blocks.first : chosen));
    return KPressable(
      semanticLabel: value == null ? 'Point de livraison non choisi. Choisir un point' : 'Livrer à $value. Changer de point de livraison',
      onTap: () async {
        final picked = await showHostelPicker(context, blocks: blocks, selected: value ?? '');
        if (picked != null) onChanged(picked);
      },
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(value == null ? 'POINT DE LIVRAISON' : 'LIVRER À', style: KraveoType.caption.copyWith(color: k.inkMuted, letterSpacing: 0.6, fontSize: 10)),
        const SizedBox(height: 2),
        Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(LucideIcons.mapPin, size: 14, color: k.brand),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              value ?? 'Choisir un point',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: KraveoType.titleMd.copyWith(color: value == null ? k.inkMuted : k.ink),
            ),
          ),
          const SizedBox(width: 4),
          Icon(LucideIcons.chevronDown, size: 15, color: k.ink),
        ]),
      ]),
    );
  }
}

/// The one promo we actually have: the VITFIRST coupon that the cart understands.
/// Royal-blue ticket with a gold code stub; tapping copies the code.
class _PromoCard extends StatelessWidget {
  const _PromoCard();

  static const String _code = 'VITFIRST';

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Padding(
      padding: const EdgeInsets.fromLTRB(KSpace.gutter, 18, KSpace.gutter, 0),
      child: KPressable(
        semanticLabel: 'Copier le code promo $_code',
        onTap: () {
          Clipboard.setData(const ClipboardData(text: _code));
          showKSnack(context, '$_code copié. Ajoutez-le dans votre panier.', icon: LucideIcons.ticket);
        },
        scale: 0.98,
        child: Container(
          width: double.infinity,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [KraveoPalette.g700, KraveoPalette.g900],
            ),
            borderRadius: BorderRadius.circular(KRadius.xl + 4),
            boxShadow: KShadow.lift(k.shadowTint),
          ),
          child: Stack(children: [
            Positioned(
              right: -40,
              top: -50,
              child: Container(width: 170, height: 170, decoration: BoxDecoration(color: KraveoPalette.y400.withValues(alpha: 0.18), shape: BoxShape.circle)),
            ),
            const Positioned(
              right: 18,
              top: 18,
              child: ExcludeSemantics(child: Text('🍔', style: TextStyle(fontSize: 58, height: 1))),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(KRadius.pill)),
                  child: Text('PREMIÈRE COMMANDE', style: KraveoType.caption.copyWith(color: Colors.white, letterSpacing: 1.2)),
                ),
                const SizedBox(height: 10),
                Text('-20 %,\njusqu\'à 50 FCFA', style: KraveoType.headline.copyWith(color: Colors.white)),
                const SizedBox(height: 4),
                Text('Dès 100 FCFA de commande.', style: KraveoType.bodySm.copyWith(color: Colors.white.withValues(alpha: 0.82))),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(color: k.cta, borderRadius: BorderRadius.circular(KRadius.pill)),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(_code, style: KraveoType.button.copyWith(color: k.onCta, fontSize: 14, letterSpacing: 1.2)),
                    const SizedBox(width: 8),
                    Icon(LucideIcons.copy, size: 15, color: k.onCta),
                  ]),
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

class _SkeletonList extends StatelessWidget {
  const _SkeletonList();

  @override
  Widget build(BuildContext context) {
    return SliverList(
      delegate: SliverChildListDelegate([
        for (var i = 0; i < 3; i++)
          const Padding(
            padding: EdgeInsets.only(bottom: 18),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              KSkeleton(height: 210, radius: KRadius.xl),
              SizedBox(height: 12),
              KSkeleton(width: 190, height: 16),
              SizedBox(height: 8),
              KSkeleton(width: 120, height: 12),
            ]),
          ),
      ]),
    );
  }
}

class _ActiveOrderBar extends StatelessWidget {
  const _ActiveOrderBar({required this.orderProvider, required this.onTap});

  final OrderProvider orderProvider;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final order = orderProvider.activeOrder!;
    return KFloatingBar(
      semanticLabel: 'Commande en cours chez ${order.title} : ${orderHeadline(order)}. Ouvrir le suivi',
      onTap: onTap,
      leading: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(color: k.onBrand.withValues(alpha: 0.16), shape: BoxShape.circle),
        child: Icon(LucideIcons.bike, size: 22, color: k.onBrand),
      ),
      title: Text(orderHeadline(order), maxLines: 1, overflow: TextOverflow.ellipsis, style: KraveoType.titleMd.copyWith(color: k.onBrand)),
      subtitle: order.otpCode != null
          ? 'Code de livraison ${order.otpCode}'
          : (order.awaitsPayment ? 'Payer avant ${clockLabel(order.paymentDeadline)} · ${order.title}' : order.title),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        Text('Suivre', style: KraveoType.button.copyWith(color: k.onBrand, fontSize: 14)),
        const SizedBox(width: 4),
        Icon(LucideIcons.arrowRight, size: 18, color: k.onBrand),
      ]),
    );
  }
}
