import { AUTO_PAYOUT_AVAILABLE } from './pricing';

/**
 * Payout provider hook (Docs/21 section 5). `manual` is always available: the admin pays by Wave, Orange Money or bank transfer
 * and records the reference (mark-paid). `wave` and `orange_money` are stubs that report "not configured" until a business
 * payout API (Wave Business / Orange Money API) is activated and its keys exist; `AUTO_PAYOUT` mode is refused by the settings
 * validation (services/pricing.ts) for as long as no provider that can send is enabled.
 */
export type PayoutProvider = {
  name: 'manual' | 'wave' | 'orange_money';
  enabled: boolean;
  /** Why the provider cannot be used (null when enabled). */
  reason: string | null;
  /** Sends the money for a settlement. The manual provider cannot: the admin does it outside and records the reference. */
  send: (settlement: { id: string; netPayable: number }) => Promise<{ ok: false; code: string; message: string }>;
};

export const manualProvider: PayoutProvider = {
  name: 'manual',
  enabled: true,
  reason: null,
  send: async () => ({ ok: false, code: 'MANUAL_PAYOUT', message: 'Pay this settlement by Wave, Orange Money or bank transfer, then record the reference with mark-paid.' }),
};

const notConfigured = (name: 'wave' | 'orange_money', label: string): PayoutProvider => ({
  name,
  enabled: AUTO_PAYOUT_AVAILABLE,
  reason: AUTO_PAYOUT_AVAILABLE ? null : `${label} automatic payouts are not configured.`,
  send: async () => ({ ok: false, code: 'PROVIDER_NOT_CONFIGURED', message: `${label} automatic payouts are not configured.` }),
});

export const waveProvider = notConfigured('wave', 'Wave');
export const orangeMoneyProvider = notConfigured('orange_money', 'Orange Money');

export const payoutProviders = (): PayoutProvider[] => [manualProvider, waveProvider, orangeMoneyProvider];
export const payoutProviderStatus = () => payoutProviders().map((p) => ({ name: p.name, enabled: p.enabled, reason: p.reason }));
