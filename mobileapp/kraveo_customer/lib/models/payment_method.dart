/// How the customer pays (Senegal): Wave, Orange Money or cash on delivery.
/// From `GET /payments/methods` (backend `paymentMethods.ts`).
enum PaymentMethodKind { mobileMoney, cash }

class PaymentMethod {
  const PaymentMethod({required this.id, required this.name, required this.kind, this.description = '', this.logoUrl = '', this.logoWideUrl = ''});

  /// `WAVE`, `ORANGE_MONEY` or `CASH`: what `POST /payments/simulate` expects as `method`.
  final String id;
  final String name;
  final PaymentMethodKind kind;
  final String description;
  final String logoUrl;
  final String logoWideUrl;

  bool get isCash => kind == PaymentMethodKind.cash;

  static PaymentMethod? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id']?.toString().trim() ?? '';
    final name = raw['name']?.toString().trim() ?? '';
    if (id.isEmpty || name.isEmpty) return null;
    return PaymentMethod(
      id: id,
      name: name,
      kind: raw['kind']?.toString().toUpperCase() == 'CASH' ? PaymentMethodKind.cash : PaymentMethodKind.mobileMoney,
      description: raw['description']?.toString() ?? '',
      logoUrl: raw['logoUrl']?.toString() ?? '',
      logoWideUrl: raw['logoWideUrl']?.toString() ?? '',
    );
  }

  /// Shown until the server's list arrives (and if it cannot be loaded): same ids, no logos.
  static const List<PaymentMethod> defaults = [
    PaymentMethod(id: 'WAVE', name: 'Wave', kind: PaymentMethodKind.mobileMoney, description: 'Payer avec Wave'),
    PaymentMethod(id: 'ORANGE_MONEY', name: 'Orange Money', kind: PaymentMethodKind.mobileMoney, description: 'Payer avec Orange Money'),
    PaymentMethod(id: 'CASH', name: 'Espèces', kind: PaymentMethodKind.cash, description: 'Payer en espèces à la livraison'),
  ];
}

/// `GET /payments/methods`: the methods, and whether payments are simulated on this server
/// (`PAYMENT_PROVIDER=simulated`: every method succeeds at once and nobody is charged).
class PaymentMethodsInfo {
  const PaymentMethodsInfo({required this.methods, required this.simulated});

  final List<PaymentMethod> methods;
  final bool simulated;

  static PaymentMethodsInfo? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final list = raw['methods'];
    if (list is! List) return null;
    final methods = list.map(PaymentMethod.fromJson).whereType<PaymentMethod>().toList();
    if (methods.isEmpty) return null;
    return PaymentMethodsInfo(methods: methods, simulated: raw['simulated'] == true);
  }
}
