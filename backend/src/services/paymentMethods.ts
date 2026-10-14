import { CURRENCY_CODE, CURRENCY_LABEL } from '../config/currency';

/**
 * The ways a customer can pay in Senegal. While payments are SIMULATED (PAYMENT_PROVIDER=simulated) every method succeeds
 * instantly through POST /payments/simulate, CASH included (no cash is tracked yet: it is treated as paid at once).
 * The logo files live in public/payment-logos and are served under /static/payment-logos.
 */
export type PaymentMethodId = 'WAVE' | 'ORANGE_MONEY' | 'CASH';
export type PaymentMethodKind = 'MOBILE_MONEY' | 'CASH';

type MethodDef = { id: PaymentMethodId; name: string; kind: PaymentMethodKind; description: string; logo: string; logoWide: string };

export const PAYMENT_METHODS: readonly MethodDef[] = Object.freeze([
  { id: 'WAVE', name: 'Wave', kind: 'MOBILE_MONEY', description: 'Payer avec Wave', logo: 'wave.png', logoWide: 'wave-wordmark.png' },
  { id: 'ORANGE_MONEY', name: 'Orange Money', kind: 'MOBILE_MONEY', description: 'Payer avec Orange Money', logo: 'orange-money-square.png', logoWide: 'orange-money.png' },
  { id: 'CASH', name: 'Espèces', kind: 'CASH', description: 'Payer en espèces à la livraison', logo: 'cash.png', logoWide: 'cash.png' },
]);

export const isPaymentMethod = (v: unknown): v is PaymentMethodId => PAYMENT_METHODS.some((m) => m.id === v);

/** `baseUrl` is the public origin of this server (taken from the request, so it works from an emulator, a phone or a browser). */
export const paymentMethodsView = (baseUrl: string, simulated: boolean) => ({
  currency: CURRENCY_CODE,
  currencyLabel: CURRENCY_LABEL,
  simulated,
  methods: PAYMENT_METHODS.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    description: m.description,
    logoUrl: `${baseUrl}/static/payment-logos/${m.logo}`,
    logoWideUrl: `${baseUrl}/static/payment-logos/${m.logoWide}`,
  })),
});
