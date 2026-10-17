/// Seam for an external payment provider: open its payment screen, wait for the result, then the
/// server verifies it. Razorpay was removed (no FCFA); checkout pays with a method instead
/// (`OrderProvider.payForOrder(method: ...)`). A real Wave / Orange Money integration plugs in here.
library;

import 'order_api.dart';

enum GatewayResultKind { success, cancelled, failed, externalWallet }

/// What the payment sheet reported. Only [proof] (on success) is trusted, and only after the
/// server has verified its signature.
class GatewayResult {
  const GatewayResult.success(PaymentProof this.proof)
      : kind = GatewayResultKind.success,
        networkProblem = false;
  const GatewayResult.cancelled()
      : kind = GatewayResultKind.cancelled,
        proof = null,
        networkProblem = false;
  const GatewayResult.failed({this.networkProblem = false})
      : kind = GatewayResultKind.failed,
        proof = null;
  const GatewayResult.externalWallet()
      : kind = GatewayResultKind.externalWallet,
        proof = null,
        networkProblem = false;

  final GatewayResultKind kind;
  final PaymentProof? proof;
  final bool networkProblem;
}

/// Opens the payment sheet for one [PaymentSession] and completes with what happened.
abstract class PaymentGateway {
  Future<GatewayResult> pay(PaymentSession session, {String? contact});
}
