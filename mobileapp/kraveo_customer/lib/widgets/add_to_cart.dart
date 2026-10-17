import 'package:flutter/material.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../models/dhaba.dart';
import '../models/menu_item.dart';
import '../providers/cart_provider.dart';
import 'customization_modal.dart';
import 'ui/floating_bar.dart';
import 'ui/format.dart';
import 'ui/money_text.dart';
import 'ui/sheet_chrome.dart';
import 'ui/snack.dart';

/// Adds [item] from [dhaba] to the cart with the app's rules, from any screen (menu, Home):
/// a closed kitchen explains itself, a cart from another kitchen is replaced only after asking
/// (or refused at the restaurant limit), and customisable dishes go through the options sheet.
/// Returns true when something was added (or the options sheet was opened).
Future<bool> addDishToCart(BuildContext context, {required CartProvider cart, required Dhaba dhaba, required MenuItemModel item}) async {
  if (!dhaba.isAcceptingOrders) {
    showKSnack(context, '${dhaba.name} is not taking orders right now.', error: true, icon: LucideIcons.moon);
    return false;
  }
  if (!cart.canAddMore(item.id) && cart.hasRestaurant(dhaba.id)) {
    showKSnack(context, CartProvider.maxQuantityMessage, icon: LucideIcons.info);
    return false;
  }
  if (cart.wouldReplaceCart(dhaba.id)) {
    // Ordering from several restaurants is off (the server's limit is 1): the old behaviour.
    final replace = await showKConfirm(
      context,
      title: 'Start a new cart?',
      message: 'Your cart has items from another restaurant. Start a new cart?',
      confirmLabel: 'Start new cart',
      cancelLabel: 'Keep my cart',
    );
    if (replace != true || !context.mounted) return false;
  } else if (!cart.canAddRestaurant(dhaba.id)) {
    // Already at the most restaurants one order may hold: say so instead of adding.
    showKSnack(context, cart.maxRestaurantsMessage, icon: LucideIcons.info);
    return false;
  }
  if (item.hasCustomizations) {
    CustomizationModal.show(
      context,
      item: item,
      onAddToCart: (selectedOptions, notes) {
        cart.addItem(
          item: item,
          dhabaId: dhaba.id,
          dhabaName: dhaba.name,
          selectedOptions: selectedOptions,
          specialInstructions: notes,
        );
      },
    );
  } else {
    cart.addItem(item: item, dhabaId: dhaba.id, dhabaName: dhaba.name);
  }
  return true;
}

/// Gold "View cart" bar: item count, subtotal, where the items come from.
/// [kitchenName] is the kitchen on screen (the menu), to say "From X" when the cart is elsewhere.
class KCartBar extends StatelessWidget {
  const KCartBar({super.key, required this.cart, this.kitchenName, required this.onTap});

  final CartProvider cart;
  final String? kitchenName;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final multi = cart.isMultiRestaurant;
    final fromOther = !multi && cart.dhabaName != null && cart.dhabaName != kitchenName;
    final count = cart.itemCount;
    return KFloatingBar(
      cta: true,
      semanticLabel: 'View cart, $count ${count == 1 ? 'item' : 'items'}, ${fcfa(cart.subtotal)}',
      onTap: onTap,
      leading: Container(
        width: 44,
        height: 44,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: k.onCta.withValues(alpha: 0.12), shape: BoxShape.circle),
        child: AnimatedSwitcher(
          duration: KMotion.fast,
          transitionBuilder: (child, anim) => ScaleTransition(scale: CurvedAnimation(parent: anim, curve: KMotion.spring), child: child),
          child: Text('$count', key: ValueKey(count), style: KraveoType.numericSm.copyWith(color: k.onCta, fontSize: 19)),
        ),
      ),
      title: KMoneyText(value: cart.subtotal, style: KraveoType.numericSm.copyWith(color: k.onCta, fontSize: 21)),
      subtitle: multi
          ? '${cart.restaurantCount} restaurants · ${count == 1 ? '1 item' : '$count items'}'
          : (fromOther ? 'From ${cart.dhabaName}' : '${count == 1 ? '1 item' : '$count items'} · plus fees'),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        Text('View cart', style: KraveoType.button.copyWith(color: k.onCta, fontSize: 14)),
        const SizedBox(width: 6),
        Icon(LucideIcons.shoppingBag, size: 18, color: k.onCta),
      ]),
    );
  }
}
