import { COUPONS } from '../../src/utils/validation';
import { DEFAULT_SETTINGS } from '../../src/services/pricing';

/**
 * Some suites were written around worked examples in the small amounts of the first version (a delivery fee of 25, a coupon worth
 * 20% up to 50 on a cart of 100, ...). Their subject is the money maths, the payment and refund machinery and who may see which
 * number, not the Senegal price level. These helpers put the first version's numbers back for the duration of a suite; the real
 * FCFA rules (default fees, coupon minimums, whole-FCFA input) are tested by the suites that do not call them.
 * Each returns the function that restores the real values.
 */
export const useLegacyCoupons = (): (() => void) => {
  const saved = { ...COUPONS };
  const legacy: typeof COUPONS = {
    VITFIRST: { minSubtotal: 100, discount: (sub) => Math.min(sub * 0.2, 50) },
    BIENVENUE: { minSubtotal: 100, discount: (sub) => Math.min(sub * 0.2, 50) },
    KRAVEO20: { minSubtotal: 80, discount: () => 20 },
    KRAVEO50: { minSubtotal: 150, discount: () => 50 },
  };
  for (const k of Object.keys(COUPONS)) delete COUPONS[k];
  Object.assign(COUPONS, legacy);
  return () => {
    for (const k of Object.keys(COUPONS)) delete COUPONS[k];
    Object.assign(COUPONS, saved);
  };
};

/** Default fee settings of the first version: all-in fee 25, 15 for each extra restaurant. */
export const useLegacyFees = (): (() => void) => {
  const saved = { ...DEFAULT_SETTINGS.fees };
  Object.assign(DEFAULT_SETTINGS.fees, { baseFee: 25, extraRestaurantFee: 15, gstOnFeesPercent: 18, gstOnFoodPercent: 5 });
  return () => { Object.assign(DEFAULT_SETTINGS.fees, saved); };
};

/** Coupons and default fees of the first version together. */
export const useLegacyEconomics = (): (() => void) => {
  const a = useLegacyCoupons();
  const b = useLegacyFees();
  return () => { b(); a(); };
};
